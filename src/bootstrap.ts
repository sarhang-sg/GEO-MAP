import { UI, languageDirection } from "./lib/i18n";
import { readAppLifecycleSnapshot } from "./lib/app-lifecycle-controller";

declare global {
  interface Window {
    __NAV_KURD_FLUTTER__?: boolean;
    __NAV_KURD_AUTH_HANDOFF__?: boolean;
  }
}

const callbackKeys = ["code", "error", "error_code", "error_description"] as const;
const nativeHandoffMarker = "nav_kurd_native_auth";

function androidOAuthHandoffUrl(): string | null {
  if (window.__NAV_KURD_FLUTTER__ === true) return null;

  const current = new URL(window.location.href);
  // Only an OAuth request explicitly started by the Flutter shell may leave the
  // web origin through the custom scheme. An Android user-agent or a temporarily
  // missing PKCE verifier is not sufficient: both occur during ordinary mobile
  // browser sign-in and previously stranded users on an "Open NAV KURD" page.
  if (current.searchParams.get(nativeHandoffMarker) !== "1") return null;
  const hasCallback = callbackKeys.some((key) => current.searchParams.has(key));
  if (!hasCallback) return null;

  const callback = new URL("navkurd://auth/callback");
  for (const key of callbackKeys) {
    const value = current.searchParams.get(key);
    if (value) callback.searchParams.set(key, value.slice(0, 4096));
  }
  return callback.toString();
}

function renderHandoffFallback(target: string): void {
  document.documentElement.style.cssText = "color-scheme:dark;background:#090d19";
  document.body.innerHTML = "";
  const link = document.createElement("a");
  link.href = target;
  link.textContent = "Open NAV KURD";
  link.style.cssText = "position:fixed;inset:0;display:grid;place-items:center;color:#fff;background:#090d19;font:700 18px system-ui;text-decoration:none";
  document.body.append(link);
}

async function updateWorkerBeforeRetry(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const worker = navigator.serviceWorker;
  if (!worker.controller) return;
  const registration = await worker.getRegistration().catch(() => undefined);
  if (!registration) return;
  let updateTimer: number | undefined;
  await Promise.race([
    registration.update().then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => { updateTimer = window.setTimeout(resolve, 45_000); })
  ]);
  window.clearTimeout(updateTimer);
  const waiting = registration.waiting;
  if (waiting) {
    const url = new URL(waiting.scriptURL);
    if (url.origin === window.location.origin && url.pathname.endsWith("/sw.js")) {
      waiting.postMessage({ type: "SKIP_WAITING" });
    }
  }
  if (!registration.waiting && !registration.installing) return;
  await new Promise<void>((resolve) => {
    let timer: number;
    const onChange = () => { window.clearTimeout(timer); worker.removeEventListener("controllerchange", onChange); resolve(); };
    worker.addEventListener("controllerchange", onChange, { once: true });
    timer = window.setTimeout(onChange, 45_000);
  });
}

function renderStartupFailure(error: unknown): void {
  // Module evaluation includes map construction. A renderer/chunk failure can
  // happen before main installs its normal loading recovery controls.
  let language: keyof typeof UI = "ku";
  try { language = readAppLifecycleSnapshot()?.language ?? "ku"; } catch { /* fallback must survive damaged preferences */ }
  const copy = UI[language];
  const rendererUnavailable = error instanceof Error &&
    ["MapRendererUnavailableError", "GPUInitializationError"].includes(error.name);
  const surface = document.createElement("section");
  surface.id = "mapLoading";
  surface.className = "map-loading";
  surface.dataset.phase = "failed";
  surface.dataset.startupError = rendererUnavailable ? "renderer" : "application";
  surface.dir = languageDirection(language);
  surface.setAttribute("role", "alert");
  surface.setAttribute("aria-labelledby", "startupErrorTitle");
  const content = document.createElement("div");
  content.className = "map-loading__content";
  const title = document.createElement("h1");
  title.id = "startupErrorTitle";
  title.className = "map-loading__title";
  title.textContent = copy.statusError;
  const message = document.createElement("p");
  message.className = "map-loading__message";
  message.textContent = rendererUnavailable ? copy.mapRendererUnavailable : copy.appStartupError;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "map-loading__retry";
  retry.textContent = copy.loadingRetry;
  // An ES module whose evaluation failed cannot be imported again in the same
  // document. Reload ONLY on this explicit fatal-startup retry, never on a timer,
  // connectivity change, or while a healthy map is running. Keep all stored data.
  retry.addEventListener("click", () => {
    retry.disabled = true;
    const reloadDocument = () => window.location.reload();
    if (rendererUnavailable || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      reloadDocument();
      return;
    }
    void updateWorkerBeforeRetry().finally(reloadDocument);
  }, { once: true });
  content.append(title, message, retry);
  surface.append(content);
  (document.getElementById("app") ?? document.body).replaceChildren(surface);
  retry.focus({ preventScroll: true });
}

const handoffTarget = androidOAuthHandoffUrl();
if (handoffTarget) {
  window.__NAV_KURD_AUTH_HANDOFF__ = true;
  renderHandoffFallback(handoffTarget);
  window.location.replace(handoffTarget);
} else {
  void import("./main").catch((error: unknown) => {
    console.error("NAV KURD startup failed", error);
    renderStartupFailure(error);
  });
}

export {};
