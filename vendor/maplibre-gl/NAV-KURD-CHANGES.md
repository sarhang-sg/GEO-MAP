# NAV KURD pinned MapLibre build

Base: the project-resolved MapLibre GL JS 6.6.0 source. Package version: 6.6.0-navkurd.2. The existing BSD license and upstream notices are retained.

Changes include `src/ui/map.ts` constructor failure cleanup/throw and cancelability guards in `touch_pan`, `two_fingers_touch`, `tap_drag_zoom` and `tap_zoom`. Feature queries now reject missing buckets/layers and stale out-of-range feature indices before decoding. Missing retained symbol buckets are skipped; unrelated decoding errors are still reported. The API and gesture listener semantics are unchanged.

`tools/vendor/build-maplibre.mjs` builds production ES modules and worker into `lib/` using the project-resolved Rolldown. The vendor's explicit `useDefineForClassFields: false` is essential: generated StructArray type declarations must not overwrite typed-array views initialized by the base constructor. The web app's own TypeScript settings are separate. Unchanged public CSS and declarations come from the integrity-verified upstream 6.6.0 npm package. The application lockfile selects only `file:vendor/maplibre-gl`; Android's bundled presentation and the web build consume these same modules. Every source and built module is covered by the release manifest.

Desktop/mobile Chromium startup, interactions and weather rendering are checked in addition to the source regression suite. Real-device GPU coverage and driving verification remain necessary; a source build alone is not that verification.
