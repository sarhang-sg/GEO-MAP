# NAV KURD 10.4.4 backend

Now updated — NAV KURD 10.4.4 · Reviewed 14 October 2026.

The canonical backend source is in `sarhang-sg/GEO-MAP`. The
`.github/workflows/release.yml` workflow tests the web build, browser behavior
and a clean local database before deploying the production backend.

## Database migrations

Files in `supabase/migrations` use the same unique 14-digit versions recorded
in production. The CLI consumes this directory directly; no staging directory
or second copy is needed. Historical SQL describes the schema dependencies
of the current application and must stay in order for a fresh installation.

Create a schema change with `supabase migration new <name>`. Test it with a
local `supabase db reset`. On a push to `main`, the release workflow links the
configured project, previews pending migrations, then applies them once.
An existing migration must not be reapplied through SQL Editor or renamed
to a different version. A rerun applies only migrations missing from the
database's migration history.

Required GitHub Actions secrets are `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_ID` and `SUPABASE_DB_PASSWORD`. The production project is
`kaydgjhwnspnuqabaiqw`. Set `NAV_KURD_ALLOWED_ORIGINS` to
`https://geo-map-kappa.vercel.app` as an Actions variable.

## Authentication and functions

The release workflow deploys the three current Edge Functions, records the
exact web/Android source identities, then verifies their version and access
controls. It does not replace user accounts, places, media or navigation data.

Configure Google OAuth in the Supabase and Google dashboards:

- Auth Site URL: `https://geo-map-kappa.vercel.app`
- Auth Redirect URL: `https://geo-map-kappa.vercel.app/**`
- OAuth callback: `https://kaydgjhwnspnuqabaiqw.supabase.co/auth/v1/callback`

Only the public project URL and publishable key belong in Vercel browser
variables. Service-role keys, access tokens and database passwords must never
be committed or exposed through `VITE_*`.

## Maintenance

`.github/workflows/cleanup.yml` accepts an exact source commit and a cutoff.
It verifies the current release before removing obsolete application-owned
Edge Functions. PostGIS data and schema history remain dependencies of the
current application. Provider audit logs and internal function revision
numbers are managed by Supabase, separately from app version 10.4.4.
