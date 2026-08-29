export const MANIFEST_ID = "./";
export const MANIFEST_START_URL = "./?source=pwa";
export const MANIFEST_SCOPE = "./";
export const CANONICAL_ORIGIN = "https://geo-map-kappa.vercel.app";
export const CANONICAL_APP_ID = `${CANONICAL_ORIGIN}/`;
export const DISPLAY_OVERRIDE = Object.freeze([
  "window-controls-overlay",
  "tabbed",
  "standalone",
  "minimal-ui"
]);
export const EDGE_SIDE_PANEL = Object.freeze({ preferred_width: 480 });
// Previous production origin retained as a verified cross-origin PWA scope.
// It serves the reciprocal web-app-origin-association file from this source.
export const SCOPE_EXTENSIONS = Object.freeze([
  Object.freeze({ type: "origin", origin: "https://geo-map-two.vercel.app" })
]);
