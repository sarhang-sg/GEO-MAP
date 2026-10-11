# NAV KURD 10.4.2

Application version: **10.4.2**. Android version code: **100402**.

- Restored the original nine-slice startup word and progress line, including original size, spacing, equation and default background. Desktop reduced-motion settings slow the same animation instead of freezing it. The loader appears before the map module downloads.
- Navigation routes render above place icons; destination and live-location markers remain above the route. An unchanged layer stack performs no repeated reordering.
- Appearance & controls now opens from About, with correct nested-dialog Escape/Tab focus handling. The keyboard shortcut remains available.
- Blue (شینی ئاوی), green (سەوز), amber, purple (مۆر), pink (پەمەیی) and red (سوور) palettes apply to cards, popups, controls, dialogs, progress and loader surfaces in light, dark and satellite UI. Original colors remain available. Saved preferences apply before the first loading frame. Reset appearance changes only presentation settings.
- Font, larger text, reduced motion and rendering quality preferences remain available. They do not reload the map or discard saved data.
- Town markers, locality clusters, major POIs and contributed-place icons become visible earlier. Collision management and bounded viewport loading remain in use. Owner marker fallbacks remain visible before icon thresholds.
- Reconnect and short background trips reuse fresh owner data. Unchanged map geometry no longer rebuilds the source/cluster index. Real updates still refresh, failures retain the previous data and healthy satellite layers are not reset on every foreground event.
- Fast offline/online changes wait for the previous presence channel to close before subscribing again, preventing duplicate presence handlers and uncaught reconnect errors.
- Route progress follows the current leg through crossings. Accurate moving GPS samples avoid duplicate smoothing, remaining route geometry updates locally, and old/stale fixes cannot advance navigation.
- Rerouting to the same destination requires distinct accurate fixes, a short dwell, real movement and a cooldown. Clear deviations with accurate moving GPS can confirm in two fixes; ordinary deviations require three. Poor or stationary GPS drift does not trigger repeated route changes. The provider's actual road geometry replaces artificial straight connectors to off-road pins.
- Turn arrows follow the road at the real maneuver, with a compact map-anchored label. A small distance/ETA summary replaces the separate instruction panel. Live location and destination pulses use the shared animation scheduler.
- Weather moves from every place/shop popup into one searchable Weather list for catalog cities, districts, subdistricts and villages. Visible rows load current icons and temperatures with at most two background requests at a time; selecting a place opens the next 24 hours. Closing the list cancels its pending queue; cached results and shared requests are reused. Major city/province popups also link to this forecast. Shops do not fetch weather.
- Web weather, Android widget and weather notifications share all 28 WMO code descriptions in Kurdish, Arabic and English. Mainly clear, partly cloudy, rain intensity and freezing precipitation are distinct. Airborne dust remains a separate metric and never changes the rain/cloud description.
- Superseded release-note files are consolidated into this current document. The web source and Android bundled presentation share the same release. Native offline data and existing user wording are retained.

- The weather entry is visible beside location controls in desktop and mobile web as well as Android, with the supplied SVG. Two localized tutorial steps explain weather and appearance.
- Active fresh GPS plus a search selection previews destination distance and ETA without starting guidance. Navigation camera following responds sooner while retaining heading when GPS confidence is low.
- Widget hourly icons reflect each provider code; future dates, local time, sunrise/sunset day phases and seasons are aligned. Heat, cold and wind are separate context labels, never substitutes for rain or cloud conditions. Tornadoes are not inferred from ordinary wind.
- The reviewed MapLibre build guards stale feature indexes and missing retained symbol buckets. Its generated struct arrays preserve initialized buffers through explicit TypeScript class-field semantics.
- Production output must contain exactly one current main module, preventing obsolete chunks from entering the Android presentation or offline shell. Existing geographic review dates and immutable offline map data are retained.

## Validation and publication

See the delivered QA report for actual checks and boundaries. The owner-run updater waits for Android analysis, tests, compilation, signing and exact asset verification, then binds the website to that verified APK. A source kit is not a prebuilt signed APK. A failed CI job stops publication and records its log.

No database migration is required. Map data, offline-pack and third-party dependency versions describe their own unchanged artifacts; they are not relabeled as an application release.
