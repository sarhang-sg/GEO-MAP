
import { App } from "@capacitor/app";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { Network, type ConnectionStatus } from "@capacitor/network";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import type { Language } from "./types";
import { isFlutterAndroidRuntime, isNativeAppRuntime, isTauriRuntime, nativeRuntimeKind, type NativeRuntimeKind } from "./runtime-platform";

interface NavKurdNativePlugin {
  cacheStatus(): Promise<{ memoryBytes: number; diskBytes: number }>;
  clearTransientCache(): Promise<{ cleared: boolean }>;
  openSettings(): Promise<void>;
  showError(options: { title: string; message: string; retryLabel: string; settingsLabel: string }): Promise<void>;
  safeAreaInsets(): Promise<{ top: number; right: number; bottom: number; left: number }>;
}

const NavKurdNative = registerPlugin<NavKurdNativePlugin>("NavKurdNative");

declare global {
  interface Window {
    __navKurdPendingNativeUrls?: string[];
    flutter_inappwebview?: { callHandler: (name: string, payload?: unknown) => Promise<unknown> };
  }
}

type FlutterRuntimeInfo = {
  cacheBytes?: number;
  appStorageBytes?: number;
  safeArea?: { top?: number; right?: number; bottom?: number; left?: number };
};

export function isNativeWindows(): boolean { return nativeRuntimeKind() === "windows"; }
export { nativeRuntimeKind };

async function tauriInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

async function flutterInvoke<T>(handler: string, payload: unknown = {}): Promise<T> {
  const bridge = window.flutter_inappwebview;
  if (!bridge?.callHandler) throw new Error("Flutter bridge is unavailable");
  return bridge.callHandler(handler, payload) as Promise<T>;
}

function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${Math.max(0.01, bytes / 1_048_576).toFixed(bytes >= 10_485_760 ? 1 : 2)} MB`;
}

function normalizedConnection(connected: boolean, connectionType: ConnectionStatus["connectionType"] = "unknown"): ConnectionStatus {
  return { connected, connectionType };
}

function connectionLabel(status: ConnectionStatus, language: Language): string {
  if (!status.connected) return language === "ar" ? "غير متصل" : language === "en" ? "Offline" : "ئۆفلاین";
  if (status.connectionType === "wifi") return "Wi‑Fi";
  if (status.connectionType === "cellular") return language === "ar" ? "شبكة الهاتف" : language === "en" ? "Cellular" : "تۆڕی مۆبایل";
  return language === "ar" ? "متصل" : language === "en" ? "Online" : "ئۆنلاین";
}

async function bridgeCacheStatus(): Promise<{ memoryBytes: number; diskBytes: number }> {
  if (isTauriRuntime()) return tauriInvoke("cache_status");
  if (isFlutterAndroidRuntime()) {
    const info = await flutterInvoke<FlutterRuntimeInfo>("nativeRuntimeInfo");
    return { memoryBytes: 0, diskBytes: Math.max(0, Number(info.appStorageBytes ?? info.cacheBytes ?? 0)) };
  }
  return NavKurdNative.cacheStatus();
}
async function bridgeClearCache(): Promise<{ cleared: boolean }> {
  if (isTauriRuntime()) return tauriInvoke("clear_transient_cache");
  if (isFlutterAndroidRuntime()) return flutterInvoke("nativeClearTransientCache");
  return NavKurdNative.clearTransientCache();
}
async function bridgeOpenSettings(): Promise<void> {
  if (isTauriRuntime()) return tauriInvoke("open_location_settings");
  if (isFlutterAndroidRuntime()) { await flutterInvoke("nativeOpenSettings"); return; }
  return NavKurdNative.openSettings();
}
async function bridgeSafeArea(): Promise<{ top: number; right: number; bottom: number; left: number }> {
  if (isTauriRuntime()) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (isFlutterAndroidRuntime()) {
    const info = await flutterInvoke<FlutterRuntimeInfo>("nativeRuntimeInfo");
    const value = info.safeArea ?? {};
    return {
      top: Math.max(0, Number(value.top ?? 0)),
      right: Math.max(0, Number(value.right ?? 0)),
      bottom: Math.max(0, Number(value.bottom ?? 0)),
      left: Math.max(0, Number(value.left ?? 0)),
    };
  }
  return NavKurdNative.safeAreaInsets();
}

async function applySafeAreaInsets(): Promise<void> {
  if (!isNativeAppRuntime()) return;
  try {
    const insets = await bridgeSafeArea();
    const style = document.documentElement.style;
    style.setProperty("--native-safe-top", `${Math.max(0, insets.top)}px`);
    style.setProperty("--native-safe-right", `${Math.max(0, insets.right)}px`);
    style.setProperty("--native-safe-bottom", `${Math.max(0, insets.bottom)}px`);
    style.setProperty("--native-safe-left", `${Math.max(0, insets.left)}px`);
  } catch { /* CSS env() remains the fallback. */ }
}

function publishUrl(url: string): void {
  if (!url.trim()) return;
  const pending = window.__navKurdPendingNativeUrls ?? [];
  if (!pending.includes(url)) pending.push(url);
  window.__navKurdPendingNativeUrls = pending.slice(-8);
  window.dispatchEvent(new CustomEvent("nav-kurd:native-url", { detail: { url } }));
}

async function initializeTauriDeepLinks(): Promise<void> {
  const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
  const current = await getCurrent();
  for (const url of current ?? []) publishUrl(url);
  await onOpenUrl((urls) => urls.forEach(publishUrl));
}

function installExternalLinkGuard(): void {
  if (!isNativeWindows()) return;
  document.addEventListener("click", (event) => {
    const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target !== "_blank") return;
    let target: URL;
    try { target = new URL(anchor.href, window.location.href); } catch { return; }
    if (!["http:", "https:", "mailto:", "tel:"].includes(target.protocol)) return;
    event.preventDefault();
    void tauriInvoke("open_external_url", { url: target.toString() });
  }, true);
}

export async function initializeNativePlatform(getLanguage: () => Language): Promise<void> {
  const runtime = nativeRuntimeKind();
  if (runtime === "web") return;
  const root = document.documentElement;
  root.classList.add("is-native-app", `is-native-${runtime}`);
  if (isFlutterAndroidRuntime()) root.classList.add("is-flutter-android");
  else if (runtime === "android") root.classList.add("is-capacitor-android");
  root.dataset.nativeRuntime = runtime;

  if (Capacitor.isNativePlatform()) {
    try {
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: Style.Light });
    } catch { /* non-fatal */ }
  }
  await applySafeAreaInsets();
  window.addEventListener("resize", () => { void applySafeAreaInsets(); }, { passive: true });

  const publishNetwork = (status: ConnectionStatus): void => {
    window.dispatchEvent(new CustomEvent("nav-kurd:native-network", { detail: status }));
    root.dataset.nativeConnection = status.connected ? status.connectionType : "none";
    const label = document.querySelector<HTMLElement>("#nativeConnectionValue");
    if (label) label.textContent = connectionLabel(status, getLanguage());
  };

  if (Capacitor.isNativePlatform()) {
    try {
      publishNetwork(await Network.getStatus());
      await Network.addListener("networkStatusChange", publishNetwork);
    } catch { publishNetwork(normalizedConnection(navigator.onLine)); }
  } else {
    const browserStatus = (): void => publishNetwork(normalizedConnection(navigator.onLine));
    browserStatus();
    window.addEventListener("online", browserStatus);
    window.addEventListener("offline", browserStatus);
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const launch = await App.getLaunchUrl();
      if (launch?.url) window.setTimeout(() => publishUrl(launch.url), 0);
      await App.addListener("appUrlOpen", ({ url }) => publishUrl(url));
      await App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) { void applySafeAreaInsets(); window.dispatchEvent(new Event("nav-kurd:native-resume")); }
      });
    } catch { /* normal web URLs remain supported */ }
  } else if (isTauriRuntime()) {
    try { await initializeTauriDeepLinks(); } catch { /* regular HTTPS links remain supported */ }
    window.addEventListener("focus", () => window.dispatchEvent(new Event("nav-kurd:native-resume")));
    installExternalLinkGuard();
  } else {
    window.addEventListener("focus", () => window.dispatchEvent(new Event("nav-kurd:native-resume")));
    const synchronizeLanguage = (): void => { void flutterInvoke("nativeSetLanguage", { language: getLanguage() }).catch(() => undefined); };
    synchronizeLanguage();
    window.addEventListener("nav-kurd:language-change", synchronizeLanguage);
  }
}

export async function hideNativeSplash(): Promise<void> {
  if (!isNativeAppRuntime()) return;
  if (isFlutterAndroidRuntime()) return;
  try {
    if (isTauriRuntime()) await tauriInvoke("set_app_ready");
    else await SplashScreen.hide({ fadeOutDuration: 280 });
  } catch { /* web loading UI is the fallback */ }
}

export async function showNativeFatalError(message: string, language: Language): Promise<void> {
  if (!isNativeAppRuntime()) return;
  if (isFlutterAndroidRuntime()) return;
  const copy = language === "ar"
    ? { title: "تعذر فتح NAV KURD", retry: "إعادة المحاولة", settings: "الإعدادات" }
    : language === "en"
      ? { title: "NAV KURD could not open", retry: "Retry", settings: "Settings" }
      : { title: "NAV KURD نەکرایەوە", retry: "دووبارە هەوڵدان", settings: "ڕێکخستنەکان" };
  try {
    if (isTauriRuntime()) await tauriInvoke("show_native_error", { title: copy.title, message, retryLabel: copy.retry, settingsLabel: copy.settings });
    else await NavKurdNative.showError({ title: copy.title, message, retryLabel: copy.retry, settingsLabel: copy.settings });
  } catch { /* in-web error remains visible */ }
}

type PlatformCopy = { eyebrow: string; heading: string; network: string; storage: string; clear: string; settings: string; note: string };
function platformCopy(runtime: NativeRuntimeKind, language: Language): PlatformCopy {
  const platform = runtime === "ios" ? "iPhone / iPad" : runtime === "android" ? "Android" : "Windows";
  if (language === "ar") return { eyebrow: `${platform.toUpperCase()} NATIVE`, heading: `إعدادات تطبيق ${platform}`, network: "الشبكة", storage: "التخزين", clear: "مسح الذاكرة المؤقتة", settings: "فتح الإعدادات", note: `يدير ${platform} إذن GPS وحالة الاتصال والروابط العميقة. مسح الذاكرة المؤقتة لا يحذف حزمة الخرائط دون اتصال.` };
  if (language === "en") return { eyebrow: `${platform.toUpperCase()} NATIVE`, heading: `${platform} app settings`, network: "Network", storage: "Storage", clear: "Clear transient cache", settings: "Open Settings", note: `${platform} manages GPS permission, connectivity and deep links. Clearing transient cache does not delete the offline map pack.` };
  return { eyebrow: `${platform.toUpperCase()} NATIVE`, heading: `ڕێکخستنەکانی ئەپی ${platform}`, network: "تۆڕ", storage: "خەزن", clear: "پاککردنەوەی cache ـی کاتی", settings: "کردنەوەی Settings", note: `GPS permission، network status و deep links لە ڕێگەی ${platform} بەڕێوە دەبرێن. پاککردنەوەی cache ـی کاتی پەکی ماپی ئۆفلاین ناسڕێتەوە.` };
}

export function installNativeSettingsPanel(getLanguage: () => Language): void {
  const panel = document.querySelector<HTMLElement>("#nativeIosPanel");
  if (!panel) return;
  const runtime = nativeRuntimeKind();
  panel.hidden = runtime === "web";
  if (runtime === "web") return;
  const eyebrow = panel.querySelector<HTMLElement>("#nativePlatformEyebrow");
  const heading = panel.querySelector<HTMLElement>("#nativeIosHeading");
  const connectionTerm = panel.querySelector<HTMLElement>("#nativeConnectionTerm");
  const storageTerm = panel.querySelector<HTMLElement>("#nativeStorageTerm");
  const connection = panel.querySelector<HTMLElement>("#nativeConnectionValue");
  const cache = panel.querySelector<HTMLElement>("#nativeCacheValue");
  const clear = panel.querySelector<HTMLButtonElement>("#nativeClearCacheButton");
  const settings = panel.querySelector<HTMLButtonElement>("#nativeOpenSettingsButton");
  const clearLabel = panel.querySelector<HTMLElement>("#nativeClearCacheLabel");
  const settingsLabel = panel.querySelector<HTMLElement>("#nativeOpenSettingsLabel");
  const note = panel.querySelector<HTMLElement>("#nativeIosNote");

  const updateCopy = (): void => {
    const copy = platformCopy(runtime, getLanguage());
    if (eyebrow) eyebrow.textContent = copy.eyebrow;
    if (heading) heading.textContent = copy.heading;
    if (connectionTerm) connectionTerm.textContent = copy.network;
    if (storageTerm) storageTerm.textContent = copy.storage;
    if (clearLabel) clearLabel.textContent = copy.clear;
    if (settingsLabel) settingsLabel.textContent = copy.settings;
    if (clear) { clear.setAttribute("aria-label", copy.clear); clear.title = copy.clear; }
    if (settings) { settings.setAttribute("aria-label", copy.settings); settings.title = copy.settings; }
    if (note) note.textContent = copy.note;
  };

  const refresh = async (): Promise<void> => {
    updateCopy();
    const connected = normalizedConnection(navigator.onLine);
    try {
      const status = Capacitor.isNativePlatform() ? await Network.getStatus() : connected;
      if (connection) connection.textContent = connectionLabel(status, getLanguage());
    } catch { if (connection) connection.textContent = connectionLabel(connected, getLanguage()); }
    try {
      const native = await bridgeCacheStatus();
      const estimate = await navigator.storage?.estimate?.();
      if (cache) cache.textContent = formatMegabytes(native.diskBytes + native.memoryBytes + (estimate?.usage ?? 0));
    } catch { if (cache) cache.textContent = "—"; }
  };

  clear?.addEventListener("click", () => {
    clear.disabled = true;
    void (async () => {
      try {
        await bridgeClearCache();
        if ("caches" in window) {
          const keys = await caches.keys();
          const transient = keys.filter((key) => key.includes("runtime") || key.includes("satellite"));
          await Promise.all(transient.map((key) => caches.delete(key)));
        }
        await refresh();
      } finally { clear.disabled = false; }
    })();
  });
  settings?.addEventListener("click", () => { void bridgeOpenSettings(); });
  window.addEventListener("nav-kurd:native-network", () => { void refresh(); });
  window.addEventListener("nav-kurd:language-change", () => { void refresh(); });
  void refresh();
}
