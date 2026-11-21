# NAV KURD — Smart Drive and Transport implementation ledger

**Scope:** Kurdistan Region only. Target release line: 11.0.0.
**Status:** feature branch candidate; not a verified production release.

## Implemented in this branch (awaiting CI and on-device QA)

- Traffic route coloring now consumes segment-indexed Mapbox Directions congestion annotations; it does not paint a whole trip with one dominant severity. A mismatch between annotations and geometry yields **unknown**, never guessed live traffic.
- The active trip keeps segment colors when the traveled portion is trimmed. Shared points across neighboring color sections are deduplicated for route progress.
- An optional MapLibre congestion layer uses `mapbox.mapbox-traffic-v1`, with an explicit on/off control, attribution, and no extra tile requests when disabled. It is available only with a valid, domain-restricted public Mapbox token. Lack of data is not interpreted as free-flow traffic.
- Smart Junction inset appears automatically near significant car maneuvers, displaying a schematic derived from actual route geometry. This **is not** a lane-level photorealistic 3D renderer; no unsupported lane geometry or signal phases are fabricated.
- Regional transport panel lists the two commercial international airports, opens official airport flight-status pages and pans the map to each airport. Railway status is clearly labeled planned/not verified operational; no invented schedules or GPS tracks.
- Optional `VITE_KRI_SATELLITE_PROVIDER=mapbox` permits comparison with MapTiler imagery. Neither provider guarantees current imagery without capture-date verification.

## Remaining implementation tracks (not delivered by this branch)

1. **Reliable live traffic coverage:** Test the Mapbox traffic tiles and driving-traffic ETAs on known Erbil, Sulaymaniyah, Duhok, Halabja and intercity roads at peak/off-peak hours. Confirm attribution, quota, region coverage and pricing before default-on. Design clear no-data states.
2. **Alternative route selection:** Show multiple provider routes with times and traffic-aware ETA. Never reroute based on tiny transient differences; reject stale or conflicting data.
3. **Community incidents:** Secure, moderated, time-limited reports (closure, crash, hazards, speed bumps and verified cameras). Trust/confidence, duplicate suppression and abuse monitoring. No private location history shared publicly.
4. **First-party traffic sensor analytics:** Explicit opt-in, aggregate map-matched speed samples with k-anonymity thresholds and brief retention. Respect Android background-location rules and user revocation. Require sufficient device density for any segment estimate.
5. **3D intersection map:** Render true road and bridge geometry with map pitch/camera easing, and lane indications only when validated OpenStreetMap/provider intersection lane data exists. Low-power/older Android fallback, accessibility and manual dismissal controls.
6. **Air tracking:** Contract a licensed feed (e.g. FlightRadar24/FlightAware) before claiming real-time positions and status. Server-side key protection, caching, provider timestamps and coverage/no-signal states.
7. **Public transit:** Obtain permitted GTFS/GTFS-RT schedules, bus/route manifests and optional operator GPS. Do not expose train ticketing or arrival estimates until train service is evidenced.
8. **Satellite freshness:** Compare licensed imagery capture dates for city and mountain test locations. Keep attribution and region coverage documentation; no imagery-scraping or unlicensed Google/Waze overlays.
9. **Regional safety:** Weather/ice, fog, flood, mountain-pass risk, official closure and emergency contacts. Clearly distinguish predictions from confirmed events.
10. **Kurdish speech:** Verify Sorani and Badini voice availability on devices, with optional offline TTS and reliable maneuver timing.
11. **Smart Address / Map Editor:** Verified community corrections, Kurdish transliteration normalization and audited owner approval, preserving existing POIs and all eight appearance themes.
12. **Transport/Explore:** Hiking and rescue information, verified bus stops, regional railway projects, and airport arrival assistance. Restrict exploration/reports to approved region boundary.

## Contract and compatibility checks

- Preserve **GEO-ANDROID** native SQLite, PMTiles, background GPS, BRouter, WorkManager, widgets, Android signing, `TERMUX.sh`, and release artifacts. Its WebView imports the release-bound web presentation: sync a verified GEO-MAP candidate into the Android bundle only as part of a coordinated build.
- Maintain Kurdish, Arabic and English labels. Follow the established attribution including `© OpenStreetMap contributors` and `Developer: Sarhang Salah`. Commercial provider acknowledgments are mandatory.
- Do **not** merge or deploy before running `npm run build:vercel`, browser smoke tests, Android parity checks and live GPS field tests.
- Required deployment variables: `VITE_KRI_MAPBOX_ACCESS_TOKEN` (public restricted token); `VITE_KRI_ROUTING_PROVIDER=mapbox`, `VITE_KRI_ROUTING_PROFILE=driving-traffic`; optionally `VITE_KRI_SATELLITE_PROVIDER=mapbox`.
- No secrets belong in source control or `VITE_` if they grant privileged access.

## Public source links

- Mapbox Traffic v1: https://docs.mapbox.com/data/tilesets/reference/mapbox-traffic-v1/
- Mapbox Directions: https://docs.mapbox.com/api/navigation/directions/
- Erbil airport status: https://www.eia.krd/kurdish/flight-information
- Jalal Talabani airport: https://jta.krd/
- KRG proposed rail investment: https://gov.krd/boi-en/publications/investment-opportunities/regional-investment/

## Release gate

The feature branch is a **partial implementation**, not the completion of every item discussed and not a release. Validate geographic accuracy, attribution, API charges, battery cost, RTL layout, GPS loss, offline transitions and stale/no-data presentation before shipping.
