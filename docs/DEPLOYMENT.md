# Deployment

## Web

Use Node.js 24 and npm 11:

```bash
npm ci
npm run build:vercel
```

Vercel publishes `dist` and applies `vercel.json` headers.

## Database

Migration filenames are immutable database history and must not be renamed
after deployment. CI starts a local Supabase instance and executes the complete
migration set. Production deployment is an explicit manual action through
`.github/workflows/supabase-deploy.yml`; it performs a dry run before applying
pending migrations and deploys Edge Functions only when requested.

For a fresh infrastructure migration, follow
`docs/FRESH_INFRASTRUCTURE_CKB.md`. Database migration alone does not move
Supabase Auth users or Storage object bytes.

## Native

Use Capacitor sync commands for Android and iOS. Windows uses Tauri. Signing credentials stay in protected CI secrets and are never committed.

## Termux

Extract and build in `$HOME`, never in `/sdcard`, because shared storage cannot create npm symlinks. The canonical entry point is `TERMUX.sh`.
