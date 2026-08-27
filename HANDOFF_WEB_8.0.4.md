# Fresh-chat handoff — NAV KURD web 8.0.4

Use this file when continuing the web work in a new chat.

## Product identity

- Vite/TypeScript/MapLibre/PMTiles app at this repository root
- Version: `8.0.4`
- Release source of truth: `release.config.json`
- Current canonical deployment: `https://geo-map-kappa.vercel.app`
- Canonical private GitHub repository: `sarhang-sg/GEO-MAP`
- Production command: `npm run build:vercel` (publishes `dist/`)

## Important 8.0.4 files

- `src/lib/live-location-controller.ts` — stale-watch/background recovery.
- `src/lib/live-location-layers.ts` and `map-layer-priority.ts` — GPS/route/POI
  ordering.
- `src/lib/place-weather.ts`, `public/assets/weather/` and
  `src/styles/place-weather.css` — animated weather/season visual system.
- `src/lib/android-release-experience.ts` and `public/releases/latest.json` —
  direct/APKPure links, tutorial completion promotion and old-version checks.
- `src/lib/native-platform.ts` and `hardware-profile.ts` — Flutter Android
  capability integration with browser fallback.
- `public/legal/privacy.html`, `terms.html`, `legal-i18n.js` — complete
  Kurdish/Arabic/English legal copy.
- `src/lib/tutorial-controller.ts` — target-aware tutorial and SVG progress UI.

## Fresh infrastructure order

1. Publish this source to private `sarhang-sg/GEO-MAP` with
   `NAV-KURD-v8.0.4-FRESH-SETUP.sh web`.
2. Follow `docs/FRESH_INFRASTRUCTURE_CKB.md`: migrate/configure the new Supabase
   project and import the private repo into the new Vercel account.
3. Record the exact new Vercel production URL and patch every canonical origin,
   OAuth/App Link redirect and allowed-origin value in both projects.
4. Obtain the signed universal APK from the green Android 8.0.4 Actions run.
5. Verify its certificate and SHA-256, then add it as
   `public/downloads/NAV-KURD-8.0.4.apk`. Never create a dummy file.
6. Run `npm ci`, `npm run build`, `npm audit --omit=dev`, and deploy `dist/`.
7. Verify `/releases/latest.json` and `/downloads/NAV-KURD-8.0.4.apk` on the
   production origin and compare the downloaded SHA-256.
8. Smoke-test all three languages, GPS resume, POI ordering, the real offline
   download, legal pages, tutorial completion promo, About links and native
   update behavior.

## Configuration and secrets

Recreate Vercel/Supabase settings from `.env.example` and the fresh-stack guide;
do not copy service-role or signing secrets into source. Browser code may
contain only the public Supabase URL and publishable key. Android App Links use
the public certificate fingerprint from the Android repository.

## Product boundaries

The Flutter Android app intentionally hosts this canonical GIS engine instead
of maintaining a second divergent map implementation. Web and Android share
map/search/offline/account behavior; Android supplies native lifecycle,
permissions, downloads, notifications, widget and hardware integration.

## Current release checkpoint — 2026-08-27

- TypeScript type-check: PASS.
- Production source/data/runtime/security/platform/PMTiles/dependency/release
  gates: PASS.
- Production output: `dist/`.
- Signed APK embedding is still pending; no placeholder or fake APK was added.
- Exact next step: run the fresh bootstrap `web` command, then configure the new
  Supabase/Vercel project without changing the old canonical URL until the new
  production URL is known.
