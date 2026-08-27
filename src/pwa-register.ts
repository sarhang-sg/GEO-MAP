import { ensureServiceWorkerRegistration } from "./lib/service-worker-registration";

/** Start one resilient Service Worker registration before the application controller is created. */
const nativeWrapper = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__) || ["capacitor:", "tauri:"].includes(window.location.protocol);
if (!nativeWrapper && "serviceWorker" in navigator) {
  const devHost = /^(localhost|127\.0\.0\.1)$/iu.test(window.location.hostname);
  const pwaDevelopmentEnabled = new URLSearchParams(window.location.search).has("pwa-dev");
  if (!devHost || pwaDevelopmentEnabled) {
    window.__NAV_KURD_SW_REGISTRATION__ = ensureServiceWorkerRegistration();
  }
}
