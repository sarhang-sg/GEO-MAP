(function registerNavKurdServiceWorker() {
  "use strict";

  if (!("serviceWorker" in navigator)) return;
  if (window.__NAV_KURD_FLUTTER__ === true) return;
  if (!["http:", "https:"].includes(window.location.protocol)) return;

  const currentScript = document.currentScript;
  const scriptUrl = currentScript instanceof HTMLScriptElement
    ? new URL(currentScript.src, window.location.href)
    : new URL("pwa-init.js", window.location.href);
  const localDevelopment = /^(localhost|127\.0\.0\.1)$/iu.test(window.location.hostname)
    && /^517\d$/u.test(window.location.port)
    && !new URLSearchParams(window.location.search).has("pwa-dev");
  if (localDevelopment) return;

  const workerUrl = new URL("sw.js", scriptUrl);
  const scopePath = new URL("./", workerUrl).pathname;
  window.__NAV_KURD_SW_REGISTRATION__ ??= navigator.serviceWorker.register(workerUrl, {
    scope: scopePath,
    updateViaCache: "none"
  }).then((registration) => ({
    registration,
    transientUnavailable: false,
    error: null
  })).catch((error) => ({
    registration: null,
    transientUnavailable: true,
    error
  }));
}());
