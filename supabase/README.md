# Supabase setup

The production project is deployed from the private `sarhang-sg/GEO-MAP`
repository. The migration filenames are immutable database history.

## Fresh empty project

1. Add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID` and
   `SUPABASE_DB_PASSWORD` as GitHub Actions secrets.
2. Run `.github/workflows/supabase-deploy.yml` with `mode=database` and
   `confirm=DEPLOY`. It stages canonical unique Supabase versions, links the
   selected project, previews the pending SQL, then applies every pending file
   in numeric order. Set `repair_legacy_history=true` only once if an earlier
   fresh deploy stopped after applying the first three legacy-named migrations.
3. Do not paste the migration set repeatedly into SQL Editor. The migration
   history table is the authority for what has already run.

## Existing production data

Running migrations creates/updates schema; it does not copy old users, rows or
Storage objects. To preserve the existing installation, back it up first and
use Supabase's supported project restore or backup/restore path. Then run the
database workflow so only genuinely pending migrations are applied. Copy
Storage objects through the Storage API/CLI separately; database backup data
contains object metadata, not the object bytes.

## Functions and runtime settings

After the final Vercel production URL is known:

1. Set the GitHub Actions variable `NAV_KURD_ALLOWED_ORIGINS` to the exact
   `https://...` origin without a trailing slash.
2. Run the same workflow with `mode=functions` and `confirm=DEPLOY`.
3. Configure Google OAuth, Auth Site URL/Redirect URLs, Realtime and Storage
   buckets in the Supabase dashboard.
4. Put only the public project URL and publishable key in Vercel browser
   variables. Never expose a secret/service-role key through `VITE_*`.

## Fresh production completion

Migration `20260828_000022_fresh_backend_owner_contract.sql` closes the
fresh-project bootstrap without using mock data. It:

- registers the verified production owner email only in the private database
  schema and grants the administrator row on first Google sign-in;
- guarantees the real public/private media buckets and limits;
- guarantees the five required Postgres Changes tables;
- aborts deployment if required Auth, notification, presence, Storage or RLS
  objects are missing.

The production dashboard values are:

- Auth Site URL: `https://geo-map-kappa.vercel.app`
- Auth Redirect URL: `https://geo-map-kappa.vercel.app/**`
- Google OAuth callback:
  `https://kaydgjhwnspnuqabaiqw.supabase.co/auth/v1/callback`

Enable Google in **Authentication → Providers → Google** using the Google Cloud
Web client ID and secret. These credentials must remain in the Supabase/Google
dashboards and must never be committed or prefixed with `VITE_`.

The migration set provides authenticated profiles, owner/admin review,
notifications, place revisions, account deletion, activity timestamps,
public-directory consent and visitor presence. Public tables use RLS and
privileged functions have explicit search paths.
