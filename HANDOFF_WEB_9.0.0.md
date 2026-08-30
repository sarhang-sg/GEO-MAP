# Fresh-chat handoff — NAV KURD web 9.0.0

Use this file when continuing the web work in a new chat.

## Product identity

- Vite/TypeScript/MapLibre/PMTiles app at this repository root
- Version: `9.0.0`
- Release source of truth: `release.config.json`
- Current canonical deployment: `https://geo-map-kappa.vercel.app`
- Canonical private GitHub repository: `sarhang-sg/GEO-MAP`
- Production command: `npm run build:vercel` (publishes `dist/`)

## Important 9.0.0 files

- `src/lib/live-location-controller.ts` — stale-watch/background recovery.
- `src/lib/live-location-layers.ts` and `map-layer-priority.ts` — GPS/route/POI
  ordering.
- `src/lib/place-weather.ts` and `src/styles/place-weather.css` — compact
  selected-place temperature plus condition/day-night icon. Full weather facts
  remain an Android-widget responsibility and are not rendered in map panels.
- `src/lib/android-release-experience.ts` and `public/releases/latest.json` —
  direct/APKPure links, tutorial completion promotion and old-version checks.
- `src/lib/native-platform.ts` and `hardware-profile.ts` — Flutter Android
  capability integration with browser fallback.
- `public/legal/privacy.html`, `terms.html`, `legal-i18n.js` — complete
  Kurdish/Arabic/English legal copy.
- `src/lib/tutorial-controller.ts` — target-aware tutorial and SVG progress UI.

## Fresh infrastructure order

1. Publish this source to private `sarhang-sg/GEO-MAP` with
   `NAV-KURD-v9.0.0-FRESH-SETUP.sh web`.
2. Follow `docs/FRESH_INFRASTRUCTURE_CKB.md`: migrate/configure the new Supabase
   project and import the private repo into the new Vercel account.
3. Record the exact new Vercel production URL and patch every canonical origin,
   OAuth/App Link redirect and allowed-origin value in both projects.
4. Obtain the signed universal APK from the green Android 9.0.0 Actions run.
5. Verify its certificate and SHA-256, then add it as
   `public/downloads/NAV-KURD-9.0.0.apk`. Never create a dummy file.
6. Run `npm ci`, `npm run build`, `npm audit --omit=dev`, and deploy `dist/`.
7. Verify `/releases/latest.json` and `/downloads/NAV-KURD-9.0.0.apk` on the
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

## Current release checkpoint — 2026-08-28

- TypeScript type-check: PASS.
- Production source/data/runtime/security/platform/PMTiles/dependency/release
  gates: PASS.
- Production output: `dist/`.
- Mobile OAuth now keeps ordinary Chrome sign-in on the web origin. The
  `navkurd://` handoff runs only for an OAuth request explicitly marked by the
  Flutter shell, so switching Chrome desktop mode can no longer strand the user
  on the `Open NAV KURD` fallback.
- Account hydration tolerates transient profile/notification failures and the
  owner-role lookup fails closed to an ordinary user during a short outage,
  preventing the post-login red/stuck loading state without granting admin
  privileges.
- Pending long-press coordinates survive Google OAuth and reopen the add-place
  form after sign-in/legal acceptance.
- Migration `20260828_000023_release_runtime_fixes.sql` repairs trusted
  approve/reject transitions and makes Arabic/English names, descriptions and
  photo captions independently optional while retaining exact-language and
  server-side validation.
- Account deletion and contribution guidelines now render one complete
  Kurdish, Arabic or English document at a time. Internal legal links retain
  the selected language.
- The redundant small APK signature/package sentence is removed. In-map full
  weather/season/ambient panels are removed; only compact selected-place
  temperature and condition/day-night icon remain.
- Signed APK embedding is still pending; no placeholder or fake APK was added.
- Fresh Supabase schema and Edge Functions deploy successfully; migration
  `20260828_000022_fresh_backend_owner_contract.sql` now supplies the missing
  fresh-project owner bootstrap and validates Auth/Realtime/notifications/RLS
  and both production Storage buckets.
- Canonical Web production URL: `https://geo-map-kappa.vercel.app`.
- Changed runtime files: `src/bootstrap.ts`, `src/main.ts`,
  `src/lib/atlas-places.ts`, `src/lib/app-shell.ts`,
  `src/lib/android-release-experience.ts`,
  `src/lib/user-contribution-studio.ts`, `src/lib/place-weather.ts`,
  `src/styles.css`, `src/styles/android-release.css`,
  `src/styles/place-weather.css`, `public/manifest.webmanifest`,
  `public/legal/account-deletion.html`,
  `public/legal/contribution-guidelines.html`, `public/legal/legal-i18n.js`,
  `tools/verify/source.mjs`, and migration `000023`.
- Removed obsolete source: `src/styles/ambient-weather.css`.
- Remaining: publish this source, deploy migration `000023` and current Edge
  Functions, let Vercel redeploy `main`, then smoke-test mobile Google login,
  pending-coordinate resume, approve/reject (with and without media), all three
  legal languages and compact selected-place weather.
- Exact next step: run the supplied Termux publish script, then verify the new
  Supabase workflow and Vercel deployment are green.

## PWA/direct-download checkpoint — 2026-08-29

- `public/pwa-init.js` now registers `/sw.js` synchronously from the document
  head, before the heavy map bundle. The runtime controller reuses that single
  promise instead of creating a duplicate registration. This fixes the short
  PWABuilder Puppeteer window that previously reported no Service Worker.
- The existing production worker remains the canonical offline owner and still
  implements atomic shell caching, offline fallback, background sync, periodic
  sync, push notifications and Windows widget events. Installer binaries,
  byte-range traffic, `/api`, `/auth` and mutable release metadata are now
  explicitly excluded from CacheStorage.
- The manifest now opts into Edge Side Panel, Window Controls Overlay, Tabbed
  Display and the verified previous-production-origin scope extension. The
  reciprocal `web-app-origin-association` file contains the canonical app ID.
- IARC deliberately remains environment-gated. Set
  `NAV_KURD_IARC_RATING_ID` only after IARC issues a real certificate; never
  invent an ID merely to turn an optional analyzer item green.
- Direct APK release metadata is now artifact-gated. Without a real APK the
  direct button is hidden and no broken 0.08 KB download is exposed. With
  `public/downloads/NAV-KURD-9.0.0.apk`, the build validates ZIP/APK structure,
  requires a 10–95 MiB size, computes SHA-256 and publishes exact byte/hash
  metadata. The browser performs a same-origin HEAD/size/MIME check before it
  reveals the direct button.
- The canonical signed APK must come from the successful GEO-ANDROID workflow
  release directory and use certificate SHA-256
  `A2:45:75:43:8C:D4:E1:AF:D6:11:FE:2E:C8:F7:2E:EF:70:D5:C1:1F:3F:E9:BA:EF:0E:75:D5:76:EC:CE:12:46`.
- Native Capacitor/iOS/Windows web builds remove the standalone APK from their
  generated `dist/`, preventing an installer from being recursively bundled
  inside another native package. The Vercel web build retains it.
- Exact next step: run `NAV-KURD-v9.0.0-WEB-FIRST.sh` before the Android
  publisher. It merges the complete v9 Web source only after quality,
  browser-smoke and migration checks pass. The Android publisher then builds
  the signed APK and makes a final certificate-verified direct-download update.
