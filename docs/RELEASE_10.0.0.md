# NAV KURD Web 10.0.0

Release ID: `2026-10-02-nav-kurd-v10.0.0`  
Source release date: `2026-10-02`

## Changes from the supplied 9.1.0 baseline

- Keep marker layers alive through repeated zoom/filter reconciliation; update only changed filters and zoom limits.
- Serialize locality viewport writes, retain bounded loaded data while hidden, and restore it after a map style change.
- Cap render pixel ratio at 2, or 1.5 on constrained devices, to reduce rendering work.
- Separate account activity from map-data refreshes while sharing the existing Supabase client and realtime channel.
- Ignore token-refresh events that previously remounted account editors; discard replies belonging to an account that has signed out.
- Complete local sign-out when the local session has cleared even if remote revocation is unavailable.
- Relay the authenticated inbox to Android notification channels without copying authentication tokens into native storage.
- Show a direct V10 APK only after the established CI certificate, binary hashes and source identity have been verified. An unavailable direct APK does not imply that V10 is already in the external store.
- Use version 10.0.0 / Android code 100000 throughout the active runtime and release metadata.

The existing visual language and layout remain. Cache schema 91 and offline-map version 2027.13 remain compatible with the existing downloaded maps.

## Verification and limits

`npm run build:vercel` runs typechecking and the source, style, data, mobile, critical-runtime, search, V10 regression, security, dependency and PMTiles checks. The real Chromium smoke test exercises dark/light controls, three languages, tutorial, support/legal pages, offline reload and explicit recovery after WebGL startup failure. Desktop smoke also covers search and repeated zoom without document reload.

All 226 city/town records have Kurdish names. Arabic and English locality labels are present for all 12,125 locality records. A further 5,176 minor locality records lack a verified Kurdish translation and retain the existing source-name fallback; this release does not invent translations.

Authenticated server writes, physical-device GPS, background delivery under manufacturer battery restrictions and temperature/battery measurements still require device/account acceptance testing. Passing source contracts is not a claim that those tests occurred.

For the coordinated signed release, use `RUN-TERMUX.sh` in `NAV-KURD-10.0.0-RELEASE-KIT.zip`. It publishes Android first, verifies its signed APK/AAB, and then updates this repository with the verified download receipt through the existing Vercel integration.
