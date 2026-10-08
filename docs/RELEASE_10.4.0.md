# NAV KURD 10.4.0

## Changes

- Fix label viewport calculations when renderer pixel ratio differs from screen density.
- Close the cluster-to-place visibility gap and keep a bounded resident POI index across ordinary zooms.
- Show local roads and important places earlier while preserving collision decluttering.
- Add cancellable GPS acquisition, a fixed deadline, retry and manual map selection. Coarse browser positions retain their real uncertainty.
- Add persisted font, text-size, accent, motion and rendering-quality preferences.
- Keep controls visible by default, with optional auto-hide in preferences. Reject incomplete shared coordinates.
- Add desktop shortcuts and mouse guidance. Scroll the control rail when the information card occupies its space.
- Render real provider turn, U-turn, roundabout and arrival instructions. Filter inaccurate navigation fixes and reduce unnecessary rerouting/traffic refreshes.
- Add report copying in the owner dashboard, including the unsaved reply and diagnostic details.
- Correct desktop loading-art sizing and honor reduced-motion preferences.
- Respect the configured satellite tileset and use its provider metadata and bounded probe timeouts.
- Ship the same interface in Android with a clearer widget clock, quieter seasonal artwork and bounded artwork caches.
- Update active account notifications when language changes, preserve dismissed notifications, and reschedule daily weather at local morning time.
- Publish signed APK/AAB only after source, signature, version and bundled-asset gates. Termux downloads the APK independently, with restart-safe progress.

## Data and compatibility

Existing user wording, accounts, saved places, downloaded map data and signing identity are retained. The geographic data release is unchanged; this is not a claim of newly surveyed places, cameras or satellite capture dates. Kurdish names remain incomplete in the source dataset. Historical migration files and third-party package versions are not relabeled as application versions.

## Verification boundary

The source kit is not a signed APK. Local TypeScript, production build, regression and Chromium checks are recorded in the delivery QA report. Android compilation, Flutter analysis/tests and signing must pass the existing GitHub workflow before publication. Physical-device performance, launcher rendering and authenticated backend delivery require device/account validation. Continuous widget animation and always-on remote account push are not claimed.
