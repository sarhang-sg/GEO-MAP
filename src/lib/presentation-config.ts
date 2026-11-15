// Only the packaged WebView resolves browser-public deployment settings at runtime.
declare const __ANDROID_PRESENTATION__: boolean;
declare global {
  interface Window { __NAV_KURD_PUBLIC_CONFIG__: Record<string, string> }
}
const cacheKey = 'nav-kurd:deployment-settings';
export async function preparePresentationConfig(): Promise<void> {
  if (!__ANDROID_PRESENTATION__) return;
  let cached: Record<string,string> = {};
  try { cached = JSON.parse(localStorage.getItem(cacheKey) || '{}') || {}; } catch { /* Storage can be unavailable. */ }
  window.__NAV_KURD_PUBLIC_CONFIG__ = cached;
  const refresh = async () => {
    try {
      const response = await fetch('/client-config.json', {signal:AbortSignal.timeout(3500)});
      if (!response.ok) return;
      const settings:unknown = await response.json();
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return;
      const values = Object.fromEntries(Object.entries(settings).filter(([key,v])=>/^VITE_[A-Z_]+$/.test(key) && typeof v === 'string'));
      window.__NAV_KURD_PUBLIC_CONFIG__ = values;
      localStorage.setItem(cacheKey, JSON.stringify(values));
    } catch { /* Cached settings and the bundled offline map remain available. */ }
  };
  if (Object.keys(cached).length) void refresh();
  else await refresh();
}
