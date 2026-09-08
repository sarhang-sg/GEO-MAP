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

const handoffTarget = androidOAuthHandoffUrl();
if (handoffTarget) {
  window.__NAV_KURD_AUTH_HANDOFF__ = true;
  renderHandoffFallback(handoffTarget);
  window.location.replace(handoffTarget);
} else {
  void import("./main");
}

export {};
