declare global {
  interface Window {
    __NAV_KURD_FLUTTER__?: boolean;
    __NAV_KURD_AUTH_HANDOFF__?: boolean;
  }
}

const callbackKeys = ["code", "error", "error_code", "error_description"] as const;
const verifierKeyFragment = "auth-token-code-verifier";

function hasPkceVerifier(): boolean {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (window.localStorage.key(index)?.includes(verifierKeyFragment)) return true;
    }
  } catch { /* A blocked storage area is treated as a missing verifier. */ }
  return false;
}

function androidOAuthHandoffUrl(): string | null {
  if (window.__NAV_KURD_FLUTTER__ === true) return null;
  if (!/\bAndroid\b/iu.test(navigator.userAgent)) return null;

  const current = new URL(window.location.href);
  const hasCallback = callbackKeys.some((key) => current.searchParams.has(key));
  if (!hasCallback || hasPkceVerifier()) return null;

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
