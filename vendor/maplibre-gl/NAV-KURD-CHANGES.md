# NAV KURD pinned MapLibre build

Base: the project-resolved MapLibre GL JS 6.6.0 source. Package version: 6.6.0-navkurd.1. The existing BSD license and upstream notices are retained.

Changes are limited to `src/ui/map.ts` constructor failure cleanup/throw and cancelability guards in `touch_pan`, `two_fingers_touch`, `tap_drag_zoom` and `tap_zoom`. The API and existing gesture listener semantics are unchanged. There is no runtime monkey patch or parallel renderer.

`web/tools/vendor/build-maplibre.mjs` builds the production ES modules and worker from this source using the project-resolved Rolldown. The application lockfile selects only `file:vendor/maplibre-gl`; both Android's bundled presentation and the Web build consume it.

Broad renderer/device QA is deferred. A successful source build is not a device-rendering verification.
