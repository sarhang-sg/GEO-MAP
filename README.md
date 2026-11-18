# NAV KURD 11.0.0

NAV KURD is Sarhang Salah’s Kurdish-first map of Southern Kurdistan. The web application supports Kurdish, Arabic and English. It provides place search, location tracking, navigation, offline map downloads, weather, moderated contributions and account history. The Android app packages the same map presentation and adds a native offline catalog, hardware location services and launcher widgets.

[Open NAV KURD](https://geo-map-kappa.vercel.app/) · [Android source](https://github.com/sarhang-sg/GEO-ANDROID)

## Architecture

The Android WebView uses the same route rendering and turn guidance as the browser. When connectivity is unavailable, it requests driving, cycling and walking directions from the installed regional OpenStreetMap road graph. Browser routes and Android routes outside that graph use the configured online providers.

| Component | Responsibility |
| --- | --- |
| Vite, TypeScript and MapLibre GL JS | Browser/PWA shell, map layers, 3D location geometry, camera, search and settings |
| PMTiles and the search worker | Regional vector tiles and multilingual local search, including downloaded data |
| Supabase | Authenticated contributions, moderation, visitor preferences and private weather favorites |
| Vercel functions | Weather and geocoding requests, coordinated city forecasts and configured satellite services |
| Open-Meteo | Current conditions, hourly and daily forecasts, and air-quality observations |
| Android presentation | A verified build of this UI with a native bridge to SQLite, PMTiles and device services |

The weather directory opens independently of GPS. It includes 19 cities and districts in Kurdistan and Iraq, worldwide city search and saved places. Cached readings retain their observation time. The regional map has an explicit coverage boundary.

## Development

Use Node.js 24, npm 12 and Python 3. Copy `.env.example` to `.env.local` and configure the browser-public values for your deployment. Keep server credentials in the deployment environment.

```sh
npm ci
npm run dev
```

`npm run build` checks TypeScript, prepares canonical data, builds the PWA, and verifies the release. `npm run verify:browser` exercises the built application in Chromium using Python Playwright. In Termux, run `bash TERMUX.sh setup`, then `bash TERMUX.sh check` or `bash TERMUX.sh build`. `bash TERMUX.sh package` writes a source archive with checksums.

## Release and operation

`release.config.json` identifies the application, cache schema and offline data edition. `RELEASE_MANIFEST.json` records source integrity. The offline data edition has its own lifecycle. Vercel builds with `npm run build:vercel`. `/release-identity.json` identifies the deployed source commit. `/releases/latest.json` describes the public signed Android download and its independently verified certificate and digest.

The Linux or Termux build can be used alongside the Android repository to regenerate the packaged presentation. Follow the Android README before making a coordinated release. For vulnerabilities, private reporting and credential handling, see [SECURITY.md](SECURITY.md).

Developer: Sarhang Salah. Map data attribution and provider terms are displayed in the application. Weather attribution is Open-Meteo · Developer: Sarhang Salah.

## Owner publication maintenance

After the verified Android 11.0.0 release appears on the website, `bash TERMUX.sh finalize` updates the GitHub repository descriptions and removes superseded deployment records. Install `python` and `gh` in Termux and sign in with `gh auth login` first. The script requests a Vercel token locally using hidden input, checks the `sarhang` team and `geo-map` project against the live commit, and retains the active production deployment. It also retains deployments serving other custom domains and active builds. Credentials stay in the owner’s terminal environment.
