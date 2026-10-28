# NAV KURD 10.4.4

Now updated — NAV KURD 10.4.4 · Reviewed 14 October 2026.

Application **10.4.4**, Android version code **100404**, source release
**2026-10-13-nav-kurd-v10.4.4**.

- Logout and account switching invalidate pending identity requests. Late
  responses cannot restore the previous profile, role or notifications.
- Offline worker discovery supports Pause and a deadline. Status/cancellation
  requests have bounded deadlines. Replies for a previous language cannot mark
  the current language downloaded.
- Android Back uses existing Cancel/Close controls, handles the top dialog first
  and retains editor draft handling. Busy confirmations consume Back.
- Native resume restores map/GPS lifecycle state when OEM WebView visibility
  events are missing. Listener cleanup is included.
- Web/native camera preferences reject impossible zoom/pitch and future dates.
- GeoJSON imports validate geometry, closed polygon rings, coordinates, nesting
  and size before rendering. Slow old imports cannot overwrite a new selection.
- Android uses the matching rebuilt web presentation. Old generated chunks are
  replaced. Original styles, fonts, colors and artwork are retained.
- The catalog omitted from the uploaded GitHub ZIP is restored from Git LFS and
  verified against its existing SHA-256 inventory. Source archives include the
  actual database rather than a pointer.

Compatible current dependencies are locked. Flutter is stable 3.47.7.
TypeScript 6.0.3 is pinned for the supported Android/Termux workflow.

The immutable geographic catalog retains its own provenance and data version.
Historical SQL migrations remain necessary for reproducible upgrades. No
geographic coordinates or weather readings are invented or relabeled as new.

## Publication and QA

Source version 10.4.4 is separate from a signed APK. Download metadata remains
unavailable for this version until release CI verifies and publishes the APK
with the established key. Never substitute a previous APK or debug key.

Validation covers builds, source/data contracts, maintenance regressions,
Chromium mobile/desktop flows and native Dart/Flutter checks. Android pull
requests also compile without release signing secrets. Physical GPS, camera,
launcher widgets and authenticated server operations need device/account QA.

## Source and documentation refresh

- Current 10.4.4 README, deployment instructions and disclosure contacts.
- Consistent policy version/date on Android and Web; existing legal terms and
  third-party rights remain in force.
- Android local-core instructions describe the integrated runtime and locked SQLite 3.7.0 package.
- Unreachable older Android presentation chunks are removed.
- Signed rebuilds are staged by source identity before replacing the public APK.
- Only the verified live Vercel deployment record is retained on GitHub.
