# NAV KURD Web 9.1.0

Release ID: `2026-09-06-nav-kurd-v9.1.0`  
Release date: `2026-09-06`

NAV KURD 9.1.0 is a coordinated Web and Android visual, reliability and native-integration release. The browser application and the Flutter Android shell keep one shared map, search, account, offline and contribution experience while Android adds native lifecycle, downloads, sharing, notifications and a launcher widget.

## Interface

- Rebuilt the application around a restrained luxe-ocean palette: deep blue glass surfaces, white/cyan hierarchy, consistent radii, spacing and type scale.
- Kept the red support/payment surface unchanged.
- Moved mobile search into the safe top region and normalized Android safe-area measurements.
- Reworked the right-side controls as compact icon-first physical controls with distinct hover, touch and active motion.
- Reorganized About and the native Android settings block; large duplicate labels were removed while accessible names remain.
- Added the supplied NAV KURD 9.1.0 cover to About and refreshed README cover/screenshots.
- Replaced the former loader with the supplied nine-slice Uiverse-style Loading composition, including reduced-motion behavior.
- Rebuilt the Android download block from the supplied Download component, removed APKPure branding from the UI, and added the supplied Android artwork.
- Recolored tutorial focus and progress to the blue/cyan release system and normalized tutorial icon geometry.

## Map, search and place workflows

- Search, shared-location and region-focus actions now stop camera-follow before moving the map, preventing GPS from snapping the camera back.
- Selected-place popup titles now show the matching category icon beside the place name.
- Place/weather cards use a small, performant night atmosphere inspired by the supplied Space component.
- Fixed the add-place photo flow so selecting/compressing an image no longer destroys the active file input or leaves an empty dialog.
- New-place actions now open the editor form directly instead of covering it with the category list; category and type remain available from their form controls.
- Hardened malformed URL handling across weather, launch intents, PWA registration and release assets; invalid values fall back to the canonical app origin instead of producing an unhandled rejection.
- Native sharing now calls the Android bridge first and falls back cleanly to browser/clipboard sharing.

## Android parity

- The Flutter shell opens the same canonical NAV KURD 9.1.0 Web runtime and exposes only trusted-origin native handlers.
- Widget taps dispatch a warm-app event instead of reloading the WebView.
- The stable WebView chooser owns image selection, and the mounted Web form updates its preview in place after Android returns from the gallery.
- Kurdish/Arabic launcher-widget text uses `UniQAIDAR-Money-Heist-002.ttf`; English widget text uses `RedHatDisplay-Variable.woff2`.
- Benign cancelled subresource requests no longer pollute native diagnostics as `net::ERR_FAILED`.
- Version identity is unified at `9.1.0` / `90100`; service-worker cache schema is `91` and offline pack identity is `2027.13`.

## Verification

Before publishing, run:

```bash
npm ci
npm run verify:static
npm run build
npm run verify:browser
npm audit --omit=dev
```

The direct APK button stays hidden until a real signed `NAV-KURD-9.1.0.apk` passes size, MIME, ZIP structure, certificate workflow and SHA-256 metadata gates.
