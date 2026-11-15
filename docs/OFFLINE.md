# Offline system

The Service Worker caches the application shell and bounded runtime data. The optional full map pack downloads the configured PMTiles files to OPFS with resumable range requests.

A file is complete only when its byte length, PMTiles v3 header and SHA-256 digest match `release.config.json`. Runtime-shell verification reports missing paths and explicit failure codes.

Durable PMTiles and current-version data are never removed during active map use. Transient cache maintenance begins only after at least ten minutes of inactivity. A new Service Worker is checked on resume and activated only through the controlled update flow.
