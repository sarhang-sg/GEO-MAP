import type { Language } from "./types";
import {
  isFlutterAndroidRuntime,
  isNativeAppRuntime,
  nativeRuntimeKind
} from "./runtime-platform";

declare global {
  interface Window {
    flutter_inappwebview?: {
      callHandler: (name: string, payload?: unknown) => Promise<unknown>;
    };
  }
}

type FlutterRuntimeInfo = {
  cacheBytes?: number;
  appStorageBytes?: number;
  safeArea?: { top?: number; right?: number; bottom?: number; left?: number };
};

type ConnectionStatus = {
  connected: boolean;
  connectionType: "none" | "unknown";
};

export { nativeRuntimeKind };

async function flutterInvoke<T>(handler: string, payload: unknown = {}): Promise<T> {
  const bridge = window.flutter_inappwebview;
  if (!bridge?.callHandler) throw new Error("Flutter bridge is unavailable");
  return bridge.callHandler(handler, payload) as Promise<T>;
}

function normalizedConnection(connected: boolean): ConnectionStatus {
  return { connected, connectionType: connected ? "unknown" : "none" };
}

function connectionLabel(status: ConnectionStatus, language: Language): string {
  if (!status.connected) {
    return language === "ar" ? "غير متصل" : language === "en" ? "Offline" : "ئۆفلاین";
  }
  return language === "ar" ? "متصل" : language === "en" ? "Online" : "ئۆنلاین";
}

function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${Math.max(0.01, bytes / 1_048_576).toFixed(bytes >= 10_485_760 ? 1 : 2)} MB`;
}

async function runtimeInfo(): Promise<FlutterRuntimeInfo> {
  return flutterInvoke<FlutterRuntimeInfo>("nativeRuntimeInfo");
}

async function applySafeAreaInsets(): Promise<void> {
  if (!isNativeAppRuntime()) return;
  try {
    const value = (await runtimeInfo()).safeArea ?? {};
    const style = document.documentElement.style;
    style.setProperty("--native-safe-top", `${Math.max(0, Number(value.top ?? 0))}px`);
    style.setProperty("--native-safe-right", `${Math.max(0, Number(value.right ?? 0))}px`);
    style.setProperty("--native-safe-bottom", `${Math.max(0, Number(value.bottom ?? 0))}px`);
    style.setProperty("--native-safe-left", `${Math.max(0, Number(value.left ?? 0))}px`);
  } catch {
    // CSS env() remains the fallback when the bridge is not ready yet.
  }
}

export async function initializeNativePlatform(getLanguage: () => Language): Promise<void> {
  if (!isFlutterAndroidRuntime()) return;
  const root = document.documentElement;
  root.classList.add("is-native-app", "is-native-android", "is-flutter-android");
  root.dataset.nativeRuntime = "android";

  await applySafeAreaInsets();
  window.addEventListener("resize", () => { void applySafeAreaInsets(); }, { passive: true });

  const publishNetwork = (): void => {
    const status = normalizedConnection(navigator.onLine);
    root.dataset.nativeConnection = status.connected ? status.connectionType : "none";
    const label = document.querySelector<HTMLElement>("#nativeConnectionValue");
    if (label) label.textContent = connectionLabel(status, getLanguage());
    window.dispatchEvent(new CustomEvent("nav-kurd:native-network", { detail: status }));
  };
  publishNetwork();
  window.addEventListener("online", publishNetwork);
  window.addEventListener("offline", publishNetwork);
  window.addEventListener("focus", () => {
    void applySafeAreaInsets();
    window.dispatchEvent(new Event("nav-kurd:native-resume"));
  });

  const synchronizeLanguage = (): void => {
    void flutterInvoke("nativeSetLanguage", { language: getLanguage() }).catch(() => undefined);
  };
  synchronizeLanguage();
  window.addEventListener("nav-kurd:language-change", synchronizeLanguage);
}

/** Flutter owns the native launch surface; the browser has no native splash. */
export async function hideNativeSplash(): Promise<void> {}

/** The Flutter shell already exposes its own fatal-error surface. */
export async function showNativeFatalError(_message: string, _language: Language): Promise<void> {}

type PlatformCopy = {
  eyebrow: string;
  heading: string;
  network: string;
  storage: string;
  clear: string;
  settings: string;
  note: string;
};

function platformCopy(language: Language): PlatformCopy {
  if (language === "ar") return {
    eyebrow: "ANDROID NATIVE",
    heading: "إعدادات تطبيق Android",
    network: "الشبكة",
    storage: "التخزين",
    clear: "مسح الذاكرة المؤقتة",
    settings: "فتح الإعدادات",
    note: "يدير Android إذن GPS وحالة الاتصال والروابط العميقة. مسح الذاكرة المؤقتة لا يحذف حزمة الخرائط دون اتصال."
  };
  if (language === "en") return {
    eyebrow: "ANDROID NATIVE",
    heading: "Android app settings",
    network: "Network",
    storage: "Storage",
    clear: "Clear transient cache",
    settings: "Open Settings",
    note: "Android manages GPS permission, connectivity and deep links. Clearing transient cache does not delete the offline map pack."
  };
  return {
    eyebrow: "ANDROID NATIVE",
    heading: "ڕێکخستنەکانی ئەپی Android",
    network: "تۆڕ",
    storage: "خەزن",
    clear: "پاککردنەوەی cache ـی کاتی",
    settings: "کردنەوەی Settings",
    note: "GPS permission، network status و deep links لە ڕێگەی Android بەڕێوە دەبرێن. پاککردنەوەی cache ـی کاتی پەکی ماپی ئۆفلاین ناسڕێتەوە."
  };
}

export function installNativeSettingsPanel(getLanguage: () => Language): void {
  const panel = document.querySelector<HTMLElement>("#nativeAppPanel");
  if (!panel) return;
  panel.hidden = !isFlutterAndroidRuntime();
  if (panel.hidden) return;

  const eyebrow = panel.querySelector<HTMLElement>("#nativePlatformEyebrow");
  const heading = panel.querySelector<HTMLElement>("#nativeAppHeading");
  const connectionTerm = panel.querySelector<HTMLElement>("#nativeConnectionTerm");
  const storageTerm = panel.querySelector<HTMLElement>("#nativeStorageTerm");
  const connection = panel.querySelector<HTMLElement>("#nativeConnectionValue");
  const cache = panel.querySelector<HTMLElement>("#nativeCacheValue");
  const clear = panel.querySelector<HTMLButtonElement>("#nativeClearCacheButton");
  const settings = panel.querySelector<HTMLButtonElement>("#nativeOpenSettingsButton");
  const clearLabel = panel.querySelector<HTMLElement>("#nativeClearCacheLabel");
  const settingsLabel = panel.querySelector<HTMLElement>("#nativeOpenSettingsLabel");
  const note = panel.querySelector<HTMLElement>("#nativeAppNote");

  const updateCopy = (): void => {
    const copy = platformCopy(getLanguage());
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
    if (connection) connection.textContent = connectionLabel(normalizedConnection(navigator.onLine), getLanguage());
    try {
      const native = await runtimeInfo();
      const estimate = await navigator.storage?.estimate?.();
      const nativeBytes = Math.max(0, Number(native.appStorageBytes ?? native.cacheBytes ?? 0));
      if (cache) cache.textContent = formatMegabytes(nativeBytes + (estimate?.usage ?? 0));
    } catch {
      if (cache) cache.textContent = "—";
    }
  };

  clear?.addEventListener("click", () => {
    clear.disabled = true;
    void (async () => {
      try {
        await flutterInvoke("nativeClearTransientCache");
        if ("caches" in window) {
          const keys = await caches.keys();
          const transient = keys.filter((key) => key.includes("runtime") || key.includes("satellite"));
          await Promise.all(transient.map((key) => caches.delete(key)));
        }
        await refresh();
      } finally {
        clear.disabled = false;
      }
    })();
  });
  settings?.addEventListener("click", () => { void flutterInvoke("nativeOpenSettings"); });
  window.addEventListener("nav-kurd:native-network", () => { void refresh(); });
  window.addEventListener("nav-kurd:language-change", () => { void refresh(); });
  void refresh();
}
