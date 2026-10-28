# Deployment — NAV KURD 10.4.4

Now updated — reviewed 14 October 2026.

## Web production

Use Node.js 24 and npm 12.2.0 with the committed lockfile:

```bash
npm ci
npm run build:vercel
```

Vercel publishes `dist` at https://geo-map-kappa.vercel.app and applies the
headers and routing in `vercel.json`. Its Git integration publishes `main`.
`.github/workflows/release.yml` checks the production build, browser flows and
all database migrations, then deploys the backend from the same source commit.
`.github/workflows/cleanup.yml` verifies that deployed identity before removing
obsolete app-owned functions. Both jobs use the protected production environment.

## Supabase production

The release workflow checks the exact project ID, previews migrations with
`supabase db push --linked --include-all --dry-run`, applies them, deploys the
current Edge Functions and records the verified Android/web source identities.
Credentials stay in protected GitHub secrets. The current workflow has no
`deploy_supabase` or `DEPLOY` input.

Keep applied migration SQL and its deployed version identifiers intact; they
are the upgrade history used to reproduce and check the current schema.

## Android and downloads

Android source and signed builds live in `sarhang-sg/GEO-ANDROID`. The coordinated
release verifies APK/AAB versions, source inventory and the established signing
certificate before binding `public/releases/latest.json` to their byte counts
and SHA-256 digests. A refreshed build of 10.4.4 is staged as a private draft;
the current public APK remains available until the new signed build is verified.

## Cleanup

After production and backend checks pass, retain one GitHub deployment record
for the verified live Vercel deployment. Successful backend jobs also create
GitHub deployment records; their obsolete records can be removed without
deleting the production environment, its secrets or its protection rules.
Retain the current signed Android evidence and the current web/cleanup evidence.

## Termux

Run the supplied version-matched updater from Downloads. Its isolated checkout
belongs under Termux home; shared Android storage does not support the symlinks
needed by Node packages. `TERMUX.sh` provides local validation and build commands.
The updater stops if a remote source changes and resumes from a saved checkpoint.
