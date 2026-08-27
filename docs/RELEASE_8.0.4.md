# NAV KURD web 8.0.4

Release ID: `2026-08-27-nav-kurd-v8.0.4`
Cache schema: `84`
Canonical origin: `https://geo-map-two.vercel.app`

## Changes

- Live GPS remembers the user’s tracking choice, detects stale watches and
  restarts after a sufficiently long background pause or a native resume event.
  No coordinate history is persisted by this recovery mechanism.
- Map ordering now keeps GPS accuracy and route strokes below place/locality
  icons while retaining the compact live-location puck above the map.
- Place weather and the current-weather dock use animated SVG art rather than
  emoji. The condition set includes day/night clear and clouds, dawn/evening,
  fog, drizzle/rain/freezing rain, snow, showers, thunder/lightning, hail, dust,
  dust rain, strong wind, tornado art, heat/cold and all four seasons.
- The About panel provides a direct signed-APK link and the established APKPure
  listing. The direct APK control is hidden inside Android shells. A web-only
  Android promotion appears after the user completes (not skips) the tutorial.
- Installed Android builds read `releases/latest.json`; only older versions get
  an update prompt/notification.
- Flutter bridges actual Android CPU/RAM/screen/EGL/storage capability data.
  Browser privacy-reduced values remain the fallback. Unknown values stay null.
- Privacy Policy and Terms of Use now have complete, independently selectable
  Kurdish, Arabic and English versions.
- The tutorial retains its target-by-target behavior and adds unique SVG
  visuals, an animated progress rail and richer motion with reduced-motion
  compliance.
- Version identity is unified at 8.0.4 and the service-worker cache schema is
  bumped so stale 8.0.2 shells are not reused.

## Real offline-storage contract

The offline pack remains a streamed PMTiles download stored in OPFS. It becomes
ready only after configured byte counts, PMTiles headers and SHA-256 hashes
pass. Storage UI uses the browser’s real storage estimate and pack metadata;
there is no fabricated capacity or fake download state.

## Build and verification

```bash
npm ci
npm run typecheck
npm run build
npm audit --omit=dev
```

The production build regenerates release/offline manifests, builds Vite and
the offline runtime, and runs syntax, source, style, data, runtime, security,
platform, PMTiles, dependency and release checks.

## Android APK handoff

After the signed Android workflow succeeds, copy exactly
`NAV-KURD-8.0.4.apk` into `public/downloads/`, record its file SHA-256, rebuild,
and verify the deployed URL returns that same digest. Do not publish an unsigned
placeholder at the direct-download URL.
