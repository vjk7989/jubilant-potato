# Shares Bazaar Investor Data Collection

A no-login investor submission website for collecting Shares Bazaar loss details.

## Files

- `index.html`, `styles.css`, `app.js` - static website.
- `districts.js` - Indian state and union territory district mapping used by the dependent district dropdown.
- `supabase/schema.sql` - table, indexes, and row-level security policies.
- `supabase/functions/collect-investor/index.ts` - optional Edge Function that stores IP address and user agent server-side.
- `SETUP_SUPABASE.sql` - one-click database setup for the submission table, uploaded-file metadata table, private proof Storage bucket, RLS, upload policy, and masked public ledger functions.
- `UPDATED_SUPABASE_SETUP.sql` - same setup as above, kept as the latest clearly named SQL file to run in Supabase.

## Supabase setup

1. Open the Supabase SQL editor for `https://bnvnwkzeadpvxxssueif.supabase.co`.
2. Run `UPDATED_SUPABASE_SETUP.sql` from the project root. It creates the submission table, `investor_proof_files` table, private `investor-proofs` Storage bucket, public upload-only policy, insert policy, masked public ledger RPC functions, the 20 MB proof-upload limit, and the 3-submissions-per-device-per-day database trigger.
3. For best IP collection, deploy the Edge Function in `supabase/functions/collect-investor`.
4. Set the Edge Function secret `SUPABASE_SERVICE_ROLE_KEY` to your Supabase secret key.

## Troubleshooting saves

If the form says it cannot save and Supabase returns `404 Not Found`, the `investor_submissions` table is not available through the Supabase API yet. Run `supabase/schema.sql` in the Supabase SQL editor, then refresh the website and submit again.

If the public ledger says setup is pending, run `SETUP_SUPABASE.sql` again so Supabase creates `get_public_investor_summary()` and `get_public_investor_ledger(...)`.

If proof upload fails with a bucket or policy error, run `SETUP_SUPABASE.sql` again so Supabase creates the private `investor-proofs` bucket and allows anonymous uploads.

The secret key must never be placed in `app.js` or any frontend file. Only the publishable key is safe for browser code.

The form uses Supabase SDK inserts/RPC calls instead of building raw SQL strings. The page also uses a strict Content Security Policy and DOM text rendering (`textContent`) for dynamic content to reduce XSS risk.

## Data notes

The form collects name, phone number, optional email, amount invested, state or union territory, district, TDS details by financial year, case-filed status, case or complaint type, optional case details, uploaded proof document metadata, entry date, public IP where available, and every browser-exposed metadata field the site can read without asking for extra permission. This includes user agent/client hints, language, platform, device memory, CPU count, touch support, screen and viewport data, timezone, current page/referrer, storage availability and quota, network connection details, battery status where supported, media-device inventory where supported, permission states where supported, plugins, MIME types, and WebGL graphics details.

TDS details are stored in `public.investor_submissions.tds_details` as a JSON array, and location details are stored in `resident_state` and `resident_district`.

The browser creates a persistent local device ID and a browser-fingerprint hash. Supabase stores these in `device_id`, `device_fingerprint`, `device_submission_day`, and `device_daily_key`, then rejects a 4th submission from the same detected device/fingerprint on the same day.

Proof files are uploaded into the private Supabase Storage bucket `investor-proofs`. Each submission is limited to 20 MB total uploaded files. The optional `proof_link` field can store a Google Drive link for larger proofs such as video calls, meeting recordings, long videos, audio records, or other evidence. The public ledger only shows masked contact information, amount, case status, and submitted date. It does not expose names, phone numbers, proof files, IP addresses, proof links, or raw device metadata.

Admins can view uploaded file metadata in the Supabase table `public.investor_proof_files`. Each row has the `submission_id`, original file name, MIME type, size, bucket name, and Storage object path. The full private files are in Supabase Storage under the `investor-proofs` bucket.

Browsers cannot read a visitor's MAC address. IP address collection requires the Edge Function or another trusted server layer.
