# Shares Bazaar Investor Data Collection

A no-login investor submission website for collecting Shares Bazaar loss details.

## Files

- `index.html`, `styles.css`, `app.js` - static website.
- `supabase/schema.sql` - table, indexes, and row-level security policies.
- `supabase/functions/collect-investor/index.ts` - optional Edge Function that stores IP address and user agent server-side.
- `SETUP_SUPABASE.sql` - one-click database setup for the table, RLS, and masked public ledger functions.

## Supabase setup

1. Open the Supabase SQL editor for `https://bnvnwkzeadpvxxssueif.supabase.co`.
2. Run `SETUP_SUPABASE.sql` from the project root. It creates the table, insert policy, and masked public ledger RPC functions.
3. For best IP collection, deploy the Edge Function in `supabase/functions/collect-investor`.
4. Set the Edge Function secret `SUPABASE_SERVICE_ROLE_KEY` to your Supabase secret key.

## Troubleshooting saves

If the form says it cannot save and Supabase returns `404 Not Found`, the `investor_submissions` table is not available through the Supabase API yet. Run `supabase/schema.sql` in the Supabase SQL editor, then refresh the website and submit again.

If the public ledger says setup is pending, run `SETUP_SUPABASE.sql` again so Supabase creates `get_public_investor_summary()` and `get_public_investor_ledger(...)`.

The secret key must never be placed in `app.js` or any frontend file. Only the publishable key is safe for browser code.

## Data notes

The form collects name, phone number, optional email, amount invested, case-filed status, case or complaint type, optional case details, Google Drive proof link, entry date, public IP where available, and every browser-exposed metadata field the site can read without asking for extra permission. This includes user agent/client hints, language, platform, device memory, CPU count, touch support, screen and viewport data, timezone, current page/referrer, storage availability and quota, network connection details, battery status where supported, media-device inventory where supported, permission states where supported, plugins, MIME types, and WebGL graphics details.

The public ledger only shows masked contact information, amount, case status, and submitted date. It does not expose names, phone numbers, proof links, IP addresses, or raw device metadata.

Browsers cannot read a visitor's MAC address. IP address collection requires the Edge Function or another trusted server layer.
