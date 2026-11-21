# NAV KURD 11.0.0

The release identifier is `2026-11-20-nav-kurd-v11.0.0-build.110003`. The corresponding Android release uses version code `110003`.

## Changes

- Local and remote search results merge by query. Kurdish, Arabic and English names use a nonempty fallback, and the directory recognizes Latin spellings of Hajiawa.
- All eight color schemes have distinct foreground and surface colors in both map modes. Search docks while a place card is open. Account tabs keep Kurdish labels on a single line. Navigation measurements use isolated left-to-right spans.
- Location geometry stays extruded through zoom and pitch. Base satellite imagery remains under higher-resolution tiles during transitions.
- The city directory contains 19 regional entries and supports worldwide search. City summaries share a batched request. Favorites persist locally and synchronize with the signed-in account under row-level security.
- The Android weather widget lays out its clock, current conditions, forecast and controls for the space the launcher provides. Narrow, tall cards stack the hourly forecast. Wide strips show hours alongside current conditions when space permits. Cached artwork is reused only for matching dimensions.
- Tapping the widget forecast opens the weather screen directly. In-route notifications describe the detected weather hazard in the selected language.

## Verification and publication

`npm run build` verifies TypeScript, canonical map assets, application and service-worker versions, production dependencies and the source manifest. The Chromium suite covers all eight palettes in light and dark modes. GitHub Actions also applies the SQL migrations against a disposable Supabase instance.

Vercel exposes the deployed commit in `/release-identity.json`. The public APK link in `/releases/latest.json` is bound to its published GitHub receipt, SHA-256, byte count and signing identity. The map data edition and APK signing identity are maintained independently of the web release.

[Build and Termux commands](../README.md)
