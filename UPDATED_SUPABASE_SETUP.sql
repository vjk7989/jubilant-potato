-- Shares Bazaar investor registry database setup
-- Updated: includes submissions, TDS/location fields, proof file metadata,
-- private Supabase Storage bucket, upload policies, and masked public ledger.
-- Run in Supabase Dashboard > SQL Editor > New query.

create table if not exists public.investor_submissions (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_number text not null,
  email text,
  amount_invested numeric(14, 2) not null check (amount_invested >= 0),
  resident_state text not null default '',
  resident_district text not null default '',
  tds_details jsonb not null default '[]'::jsonb,
  case_filed boolean not null default false,
  case_types text[] not null default '{}',
  case_details text,
  proof_link text,
  proof_files jsonb not null default '[]'::jsonb,
  device_id text not null default '',
  device_fingerprint text not null default '',
  device_submission_day date not null default current_date,
  device_daily_key text not null default '',
  entered_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  device_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.investor_submissions
add column if not exists case_types text[] not null default '{}';

alter table public.investor_submissions
add column if not exists resident_state text not null default '';

alter table public.investor_submissions
add column if not exists resident_district text not null default '';

alter table public.investor_submissions
add column if not exists tds_details jsonb not null default '[]'::jsonb;

alter table public.investor_submissions
add column if not exists case_details text;

alter table public.investor_submissions
add column if not exists proof_files jsonb not null default '[]'::jsonb;

alter table public.investor_submissions
add column if not exists device_id text not null default '';

alter table public.investor_submissions
add column if not exists device_fingerprint text not null default '';

alter table public.investor_submissions
add column if not exists device_submission_day date not null default current_date;

alter table public.investor_submissions
add column if not exists device_daily_key text not null default '';

alter table public.investor_submissions
alter column proof_link drop not null;

alter table public.investor_submissions enable row level security;

create table if not exists public.investor_proof_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.investor_submissions(id) on delete cascade,
  bucket_id text not null default 'investor-proofs',
  object_path text not null,
  original_name text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

alter table public.investor_proof_files enable row level security;

insert into storage.buckets (id, name, public, file_size_limit)
values ('investor-proofs', 'investor-proofs', false, 20971520)
on conflict (id) do update
set public = false,
    file_size_limit = 20971520;

drop policy if exists "Allow public proof uploads" on storage.objects;
create policy "Allow public proof uploads"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'investor-proofs');

drop policy if exists "Block public proof reads" on storage.objects;
create policy "Block public proof reads"
on storage.objects
for select
to anon, authenticated
using (false);

drop policy if exists "Allow public investor submissions" on public.investor_submissions;
create policy "Allow public investor submissions"
on public.investor_submissions
for insert
to anon, authenticated
with check (
  full_name <> ''
  and phone_number <> ''
  and resident_state <> ''
  and resident_district <> ''
  and jsonb_typeof(tds_details) = 'array'
  and jsonb_array_length(tds_details) > 0
  and jsonb_typeof(proof_files) = 'array'
  and jsonb_array_length(proof_files) > 0
  and device_id <> ''
  and device_fingerprint <> ''
  and device_daily_key <> ''
);

drop policy if exists "Block public reads" on public.investor_submissions;
create policy "Block public reads"
on public.investor_submissions
for select
to anon, authenticated
using (false);

drop policy if exists "Allow public proof file records" on public.investor_proof_files;
create policy "Allow public proof file records"
on public.investor_proof_files
for insert
to anon, authenticated
with check (
  bucket_id = 'investor-proofs'
  and object_path <> ''
  and original_name <> ''
);

drop policy if exists "Block public proof file record reads" on public.investor_proof_files;
create policy "Block public proof file record reads"
on public.investor_proof_files
for select
to anon, authenticated
using (false);

create index if not exists investor_submissions_created_at_idx
on public.investor_submissions (created_at desc);

create index if not exists investor_submissions_phone_number_idx
on public.investor_submissions (phone_number);

create index if not exists investor_submissions_location_idx
on public.investor_submissions (resident_state, resident_district);

create index if not exists investor_submissions_device_day_idx
on public.investor_submissions (device_id, device_submission_day);

create index if not exists investor_submissions_device_fingerprint_day_idx
on public.investor_submissions (device_fingerprint, device_submission_day)
where device_fingerprint <> '';

create index if not exists investor_proof_files_submission_id_idx
on public.investor_proof_files (submission_id);

create index if not exists investor_proof_files_created_at_idx
on public.investor_proof_files (created_at desc);

create or replace function public.enforce_device_daily_submission_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_count integer;
  total_proof_bytes bigint;
begin
  new.device_id := left(coalesce(nullif(btrim(new.device_id), ''), ''), 128);
  new.device_fingerprint := left(coalesce(nullif(btrim(new.device_fingerprint), ''), ''), 128);

  if new.device_id = '' or new.device_fingerprint = '' then
    raise exception 'Missing device verification details for daily submission limit.';
  end if;

  if new.device_submission_day is null then
    new.device_submission_day := current_date;
  end if;

  new.device_daily_key := new.device_id || ':' || new.device_submission_day::text;

  select coalesce(sum(greatest((file_item.value ->> 'size_bytes')::bigint, 0)), 0)
  into total_proof_bytes
  from jsonb_array_elements(coalesce(new.proof_files, '[]'::jsonb)) as file_item(value)
  where file_item.value ? 'size_bytes';

  if total_proof_bytes > 20971520 then
    raise exception 'Total proof upload size cannot exceed 20 MB.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(new.device_fingerprint),
    hashtext(new.device_submission_day::text)
  );

  select count(*)::integer into submission_count
  from public.investor_submissions
  where device_submission_day = new.device_submission_day
    and (
      device_id = new.device_id
      or device_fingerprint = new.device_fingerprint
    );

  if submission_count >= 3 then
    raise exception 'Daily submission limit reached for this device.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_device_daily_submission_limit_trigger on public.investor_submissions;
create trigger enforce_device_daily_submission_limit_trigger
before insert on public.investor_submissions
for each row
execute function public.enforce_device_daily_submission_limit();

create or replace function public.get_public_investor_summary()
returns table (
  total_victims bigint,
  total_amount numeric,
  cases_filed bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*)::bigint as total_victims,
    coalesce(sum(amount_invested), 0)::numeric as total_amount,
    count(*) filter (where case_filed)::bigint as cases_filed
  from public.investor_submissions;
$$;

create or replace function public.get_public_investor_ledger(row_limit integer default 100)
returns table (
  submission_id uuid,
  masked_contact text,
  amount_invested numeric,
  case_filed boolean,
  case_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with cleaned as (
    select
      id,
      email,
      regexp_replace(phone_number, '\D', '', 'g') as clean_phone,
      amount_invested,
      case_filed,
      created_at
    from public.investor_submissions
    order by created_at desc
    limit least(greatest(coalesce(row_limit, 100), 1), 200)
  )
  select
    id as submission_id,
    case
      when email is not null and position('@' in email) > 1 then
        lower(left(email, 2)) || '***' || substring(email from position('@' in email))
      when length(clean_phone) >= 4 then
        left(clean_phone, 2) || repeat('*', greatest(length(clean_phone) - 4, 3)) || right(clean_phone, 2)
      else
        'Masked investor'
    end as masked_contact,
    amount_invested,
    case_filed,
    case when case_filed then 'Yes (Active)' else 'No / Pending' end as case_status,
    created_at
  from cleaned
  order by created_at desc;
$$;

grant execute on function public.get_public_investor_summary() to anon, authenticated;
grant execute on function public.get_public_investor_ledger(integer) to anon, authenticated;

notify pgrst, 'reload schema';
