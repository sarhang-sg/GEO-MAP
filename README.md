# NAV KURD

<p align="center">
  <img src="public/icons/nav-kurd-logo.png" width="116" height="116" alt="NAV KURD app logo" />
</p>

<p align="center"><strong>Production-grade multilingual map, GPS and offline platform for South Kurdistan.</strong></p>

<p align="center">
  Roads · verified places · live GPS · routing · satellite context · offline PMTiles · community contributions
</p>

<p align="center">
  <img src=".github/images/nav-kurd-v9-cover.jpg" alt="NAV KURD 9.1.0 cover" width="1080" />
</p>

## Overview

NAV KURD is a polished MapLibre-based mapping platform focused on South Kurdistan. It combines fast map rendering, verified geographic places, multilingual UI/search, live GPS, offline map packs and community place contribution workflows in one production-ready application.

## Product preview

<p align="center">
  <img src=".github/images/nav-kurd-v9-screen-1.jpg" alt="NAV KURD APK release preview" width="31%" />
  <img src=".github/images/nav-kurd-v9-screen-2.jpg" alt="NAV KURD map preview" width="31%" />
  <img src=".github/images/nav-kurd-v9-screen-3.jpg" alt="NAV KURD download preview" width="31%" />
</p>

## Release snapshot

| Field | Value |
|---|---|
| Application | `9.1.0` |
| Release | `2026-09-06-nav-kurd-v9.1.0` |
| Map edition | `2027` |
| Map data | `2026-07-22-nav-kurd-systematic-dedupe-2027` |
| Cache schema | `90` |
| Offline pack | `2027.13` |
| Toolchain | Node.js `24.x`, npm `11.x` |

`release.config.json` is the single source of truth for release identity. The web app, service worker, offline runtime and generated release artifacts must remain aligned with it.

## Key capabilities

- MapLibre rendering with bounded PMTiles basemap and road datasets.
- Kurdish, Arabic and English UI and search.
- Live GPS location, heading smoothing, route line and remaining distance.
- Automatic stale-GPS recovery after background/resume and map ordering that
  keeps accuracy/route strokes below place icons.
- Animated SVG weather for current conditions, day phase and season, plus a
  launcher-safe multilingual Android weather widget supplied by the Flutter app.
- Street, night, satellite and 3D presentation modes.
- Resumable offline map download with file-size, PMTiles header and SHA-256 verification.
- Supabase PKCE authentication, Android Chrome-to-app return, protected
  contributions, review flow and realtime presence.
- Responsive layout for mobile, tablet and desktop.
- Full Kurdish, Arabic and English Privacy Policy and Terms of Use.
- Dedicated Flutter Android shell with one signed universal APK and Android App Bundle workflow.

## Architecture

```text
src/bootstrap.ts     secure Android OAuth handoff before app initialization
src/main.ts          application composition root and map orchestration
src/lib/             feature controllers and domain services
src/styles/          centralized tokens, layout rules and feature-owned styles
src/styles/components/ map surface, loader and control-rail modules
src/workers/         isolated search work
public/data/kri/     bounded runtime data, shards and PMTiles
supabase/            migrations and Edge Functions
tools/               build, verification, data and release tooling
```

## Install and develop

```bash
npm ci
npm run verify:toolchain
npm run dev
```

## Production verification

```bash
npm run verify:static
npm run build
npm run verify:browser
npm audit --omit=dev
```

`npm run build` performs TypeScript checks, data preparation, the Vite production build, offline runtime generation and the configured production gates.

## Offline contract

The offline system has two layers:

1. A versioned service-worker app shell and bounded runtime catalog.
2. An optional PMTiles pack stored in OPFS.

A downloaded pack becomes usable only after all configured files pass size, header and SHA-256 validation.

## Security model

- Browser code receives only the public Supabase URL and publishable key.
- Android OAuth deep links carry only a short-lived, one-time PKCE code; session
  tokens are exchanged and stored inside the original trusted WebView origin.
- Public database tables use Row Level Security.
- Security-definer functions use explicit search paths.
- CSP, HSTS, frame denial, MIME protection and bounded permissions are defined in hosting configuration.
- Sensitive local files, signing credentials, caches, dependencies and build output are excluded from source packages.

See [9.1.0 release notes](docs/RELEASE_9.1.0.md), [Security](docs/SECURITY.md),
[Architecture](docs/ARCHITECTURE.md), [Data](docs/DATA.md),
[Offline](docs/OFFLINE.md) and [Deployment](docs/DEPLOYMENT.md).

## Termux build

> Build inside the Termux home directory. Android shared storage does not support the symlinks required by `node_modules`.

```bash
termux-wake-lock
cd "$HOME"
unzip -q /sdcard/Download/NAV-KURD-9.1.0-WEB-UI-R15.zip
cd NAV-KURD-9.1.0-WEB
chmod +x TERMUX.sh
bash TERMUX.sh setup
bash TERMUX.sh check
bash TERMUX.sh build
```

The production output is written to `dist/`.

## Deployment

- **GitHub Actions:** `.github/workflows/release.yml` is the only Web workflow.
- **Vercel:** the production project deploys the single clean `main` push after CI succeeds.
- **Android:** use the separate `GEO-ANDROID` source package and its signed release workflow.

## License and attribution

See [LICENSE](LICENSE). In-app map and data attribution must remain visible in runtime surfaces where required.
