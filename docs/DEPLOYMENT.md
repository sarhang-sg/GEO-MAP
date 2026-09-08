# Deployment

## Web production

Use Node.js 24 and npm 11:

```bash
npm ci
npm run build:vercel
```

Vercel publishes `dist` and applies the headers in `vercel.json`. The repository
contains one workflow only: `.github/workflows/release.yml`. It verifies the
production build, runs the browser smoke suite and executes all Supabase
migrations against a local instance.

## Supabase production

Database migrations are immutable history and must not be renamed after they
have been applied. A production push is available only from the manual workflow
form when `deploy_supabase` is enabled and the operator types `DEPLOY`. The job
requires the protected repository secrets and performs a database dry run before
applying migrations and deploying Edge Functions.

## Android

Android source, signing and release automation live in the separate
`GEO-ANDROID` repository. The Web repository does not contain a second Android,
iOS or Windows wrapper.

## Termux

Extract and build in the Termux home directory, never in shared Android storage,
because `node_modules` requires filesystem features that `/sdcard` does not
provide. `TERMUX.sh` is the canonical local check/build entry point; the final
one-shot release script performs clean GitHub uploads for both repositories.
