# Coordinated release — NAV KURD 10.4.4 (100404)

Now updated — reviewed 14 October 2026.

The supplied `NAV-KURD-10.4.4-UPDATE.sh` contains the reviewed source patches.
Use its matching SHA-256 launch command in Termux; no additional source ZIP is
needed. The updater verifies repository IDs, baselines, source trees, existing
signing identity and the exact Vercel project before making remote changes.

This owner-requested refresh replaces `main` in GEO-ANDROID and GEO-MAP with
one owner-authored commit named `Now updated — NAV KURD 10.4.4`. It uses an exact
force-with-lease guard, stops on concurrent changes, and does not alter branch
protection. Existing clones must be synchronized to the new main history.
GitHub contributor statistics may take about 24 hours to reflect the change.

Android is uploaded first. Its CI validates the real Git LFS catalog, code,
assets, APK/AAB versions and established signing certificate, then stages a
source-specific private candidate draft. The existing public APK is retained
until the candidate passes all checks. The coordinator promotes the verified
candidate to v10.4.4, binds the exact receipt to Web, and uploads its new main.
A brief transition can occur while the new web deployment becomes ready.

The web build, browser tests and database migrations must pass. The backend
release and live production commit are checked before removing the superseded
release and eligible old Actions, caches, artifacts and deployments. Exactly
one GitHub deployment record identifies the live Vercel site; protected GitHub
environments and their secrets remain configured. The new APK is downloaded
with byte-count and SHA-256 verification. Interrupted steps resume from the
same saved checkpoint without starting a duplicate build.

`UPDATE-REPORT.json` records source commits, workflow IDs, production identity,
cleanup results and the download receipt. Provider audit logs and cached Git
objects follow provider retention. Database migration history, geographic data
provenance, required signing metadata and third-party licenses remain intact.
Managed PostGIS and leaked-password settings are separate platform controls.

The app remains 10.4.4 / Android version code 100404. This refresh does not claim
new geographic observations, a new dependency version or a different signing
key. Device GPS, camera and launcher behavior still require physical-device QA.
