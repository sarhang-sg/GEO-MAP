# NAV KURD 10.4.1

Application version: **10.4.1**. Android version code: **100401**.

- Restored the original nine-slice startup word and progress line, including original size, spacing, equation and default background. Desktop reduced-motion settings slow the same animation instead of freezing it. The loader appears before the map module downloads.
- Navigation routes render above place icons; destination and live-location markers remain above the route. An unchanged layer stack performs no repeated reordering.
- Appearance & controls now opens from About, with correct nested-dialog Escape/Tab focus handling. The keyboard shortcut remains available.
- Blue, teal and amber palettes apply to cards, popups, controls, dialogs, progress and loader surfaces in light, dark and satellite UI. Original colors remain available. Saved preferences apply before the first loading frame. Reset appearance changes only presentation settings.
- Font, larger text, reduced motion and rendering quality preferences remain available. They do not reload the map or discard saved data.
- Town markers, locality clusters, major POIs and contributed-place icons become visible earlier. Collision management and bounded viewport loading remain in use. Owner marker fallbacks remain visible before icon thresholds.
- Reconnect and short background trips reuse fresh owner data. Unchanged map geometry no longer rebuilds the source/cluster index. Real updates still refresh, failures retain the previous data and healthy satellite layers are not reset on every foreground event.
- Fast offline/online changes wait for the previous presence channel to close before subscribing again, preventing duplicate presence handlers and uncaught reconnect errors.
- Route progress follows the current leg through crossings. Accurate moving GPS samples avoid duplicate smoothing, remaining route geometry updates locally, and old/stale fixes cannot advance navigation.
- Rerouting to the same destination requires three distinct accurate fixes, a short dwell, real movement and a cooldown. Poor or stationary GPS drift does not trigger repeated route changes. The provider's actual road geometry replaces artificial straight connectors to off-road pins.
- Turn arrows follow the road at the real maneuver, with a compact map-anchored label. A small distance/ETA summary replaces the separate instruction panel. Live location and destination pulses use the shared animation scheduler.
- Weather moves from every place/shop popup into one searchable Weather list for catalog cities, districts, subdistricts and villages. Only the selected place requests a forecast; cached results and shared requests are reused.
- Web weather, Android widget and weather notifications share all 28 WMO code descriptions in Kurdish, Arabic and English. Mainly clear, partly cloudy, rain intensity and freezing precipitation are distinct. Airborne dust remains a separate metric and never changes the rain/cloud description.
- Superseded release-note files are consolidated into this current document. The web source and Android bundled presentation share the same release. Native offline data and existing user wording are retained.

## Validation and publication

See the delivered QA report for actual checks and boundaries. The owner-run updater waits for Android analysis, tests, compilation, signing and exact asset verification, then binds the website to that verified APK. A source kit is not a prebuilt signed APK. A failed CI job stops publication and records its log.

No database migration is required. Map data, offline-pack and third-party dependency versions describe their own unchanged artifacts; they are not relabeled as an application release.
