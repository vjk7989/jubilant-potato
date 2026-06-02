create table if not exists public.investor_submissions (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone_number text not null,
  email text,
  amount_invested numeric(14, 2) not null check (amount_invested >= 0),
  case_filed boolean not null default false,
  case_types text[] not null default '{}',
  case_details text,
  proof_link text not null,
  entered_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  device_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.investor_submissions
add column if not exists case_types text[] not null default '{}';

alter table public.investor_submissions
add column if not exists case_details text;

alter table public.investor_submissions enable row level security;

drop policy if exists "Allow public investor submissions" on public.investor_submissions;
create policy "Allow public investor submissions"
on public.investor_submissions
for insert
to anon, authenticated
with check (
  full_name <> ''
  and phone_number <> ''
  and proof_link <> ''
);

drop policy if exists "Block public reads" on public.investor_submissions;
create policy "Block public reads"
on public.investor_submissions
for select
to anon, authenticated
using (false);

create index if not exists investor_submissions_created_at_idx
on public.investor_submissions (created_at desc);

create index if not exists investor_submissions_phone_number_idx
on public.investor_submissions (phone_number);

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
