import type { Language } from "./types";
import { APP_VERSION } from "./release";

declare global {
  interface Window { __NAV_KURD_FLUTTER__?: boolean; }
}
type LatestRelease = {
  version: string;
  minimumVersion: string;
  directApkAvailable: boolean;
  directApkUrl: string | null;
  apkBytes: number | null;
  apkSha256: string | null;
  apkPureUrl: string;
};

type ReleaseCopy = {
  title: string;
  summary: string;
  direct: string;
  directSub: string;
  store: string;
  storeSub: string;
  promoTitle: string;
  promoBody: string;
  promoDownload: string;
  promoClose: string;
  updateTitle: string;
  updateBody: (version: string) => string;
  updateNow: string;
  updateLater: string;
  notificationTitle: string;
};

const APKPURE_URL = "https://apkpure.com/nav-kurd/com.navkurd.app/download";
const MINIMUM_DIRECT_APK_BYTES = 10 * 1024 * 1024;
const COPY: Record<Language, ReleaseCopy> = {
  ku: {
    title: "ئەپی Android دابگرە",
    summary: "وەشانی واژۆکراو و پشتڕاستکراو بۆ Android 7 و نوێتر",
    direct: "APK دابگرە",
    directSub: `ڕاستەوخۆ · v${APP_VERSION}`,
    store: "لە کۆگای APKPure",
    storeSub: `APKPure · v${APP_VERSION}`,
    promoTitle: "NAV KURD لە Android لەگەڵتە",
    promoBody: "ماپی خێراتر، ویجێتی کەش‌وهەوا و کارکردنی باشتر لە دەرەوەی وێبگەڕ.",
    promoDownload: "ئێستا APK دابگرە",
    promoClose: "دواتر",
    updateTitle: "وەشانی نوێی NAV KURD بەردەستە",
    updateBody: (version) => `وەشانی ${version} چاکسازیی GPS، ویجێت، ئۆفلاین و پاراستنی زیاتری تێدایە.`,
    updateNow: "ئێستا نوێی بکەرەوە",
    updateLater: "دواتر بیرم بخەرەوە",
    notificationTitle: "نوێکردنەوەی NAV KURD",
  },
  ar: {
    title: "تنزيل تطبيق Android",
    summary: "نسخة موقعة وموثقة لنظام Android 7 أو أحدث",
    direct: "تنزيل APK",
    directSub: `مباشر · v${APP_VERSION}`,
    store: "من متجر APKPure",
    storeSub: `APKPure · v${APP_VERSION}`,
    promoTitle: "NAV KURD معك على Android",
    promoBody: "خريطة أسرع وطقس على الشاشة الرئيسية وتجربة أفضل خارج المتصفح.",
    promoDownload: "تنزيل APK الآن",
    promoClose: "لاحقاً",
    updateTitle: "يتوفر إصدار جديد من NAV KURD",
    updateBody: (version) => `يتضمن الإصدار ${version} تحسينات GPS والودجت والعمل دون اتصال والأمان.`,
    updateNow: "التحديث الآن",
    updateLater: "ذكّرني لاحقاً",
    notificationTitle: "تحديث NAV KURD",
  },
  en: {
    title: "Download the Android app",
    summary: "Signed and verified for Android 7 or newer",
    direct: "Download APK",
    directSub: `Direct · v${APP_VERSION}`,
    store: "Get it from APKPure",
    storeSub: `APKPure · v${APP_VERSION}`,
    promoTitle: "Take NAV KURD with you on Android",
    promoBody: "Faster maps, live weather on your home screen, and a smoother experience outside the browser.",
    promoDownload: "Download the APK",
    promoClose: "Later",
    updateTitle: "A new NAV KURD version is available",
    updateBody: (version) => `Version ${version} improves GPS recovery, widgets, offline maps, and security.`,
    updateNow: "Update now",
    updateLater: "Remind me later",
    notificationTitle: "NAV KURD update",
  },
};

function nativeAndroid(): boolean {
  return window.__NAV_KURD_FLUTTER__ === true;
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part) || 0);
  const b = right.split(".").map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function installedAndroidVersion(): string | null {
  const match = navigator.userAgent.match(/NAV-KURD-(?:Flutter|Native)\/([0-9]+(?:\.[0-9]+){1,3})/iu);
  return match?.[1] ?? null;
}

function absoluteReleaseUrl(value: string): string {
  try { return new URL(value, window.location.origin).toString(); }
  catch { return ""; }
}

async function directApkIsReachable(url: string, expectedBytes: number): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "error",
      credentials: "same-origin",
    });
    if (!response.ok) return false;
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    return contentLength === expectedBytes
      && (contentType.includes("android.package-archive") || contentType.includes("octet-stream"));
  } catch {
    return false;
  }
}

async function readLatestRelease(): Promise<LatestRelease | null> {
  try {
    const response = await fetch(new URL("releases/latest.json", window.location.href), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const value = await response.json() as Partial<LatestRelease>;
    if (!/^\d+\.\d+\.\d+$/u.test(value.version ?? "")) return null;
    const apkBytes = Number.isSafeInteger(value.apkBytes) ? Number(value.apkBytes) : 0;
    const apkSha256 = /^[a-f0-9]{64}$/u.test(value.apkSha256 ?? "") ? value.apkSha256! : null;
    const candidateUrl = value.directApkAvailable === true && typeof value.directApkUrl === "string"
      ? absoluteReleaseUrl(value.directApkUrl)
      : "";
    const directApkAvailable = Boolean(
      candidateUrl
      && apkBytes >= MINIMUM_DIRECT_APK_BYTES
      && apkSha256
      && await directApkIsReachable(candidateUrl, apkBytes)
    );
    return {
      version: value.version!,
      minimumVersion: /^\d+\.\d+\.\d+$/u.test(value.minimumVersion ?? "") ? value.minimumVersion! : value.version!,
      directApkAvailable,
      directApkUrl: directApkAvailable ? candidateUrl : null,
      apkBytes: directApkAvailable ? apkBytes : null,
      apkSha256: directApkAvailable ? apkSha256 : null,
      apkPureUrl: value.apkPureUrl?.startsWith("https://") ? value.apkPureUrl : APKPURE_URL,
    };
  } catch { return null; }
}

function updateSection(copy: ReleaseCopy, directAvailable: boolean): void {
  const title = document.querySelector<HTMLElement>("#androidDownloadTitle");
  const summary = document.querySelector<HTMLElement>("#androidDownloadSummary");
  const direct = document.querySelector<HTMLElement>("#androidDirectDownload strong");
  const directSub = document.querySelector<HTMLElement>("#androidDirectDownload small");
  const store = document.querySelector<HTMLElement>("#androidApkPureLabel");
  if (title) title.textContent = copy.title;
  if (summary) summary.textContent = copy.summary;
  if (direct) direct.textContent = directAvailable ? copy.direct : copy.store;
  if (directSub) directSub.textContent = directAvailable ? copy.directSub : copy.storeSub;
  if (store) store.textContent = copy.store;
}

export type AndroidReleaseExperience = {
  showPostTutorialPromotion: () => void;
  checkForUpdate: () => Promise<void>;
};

export function installAndroidReleaseExperience(getLanguage: () => Language): AndroidReleaseExperience {
  if (window.__NAV_KURD_FLUTTER__ === true) document.documentElement.classList.add("is-flutter-android");
  const directLink = document.querySelector<HTMLAnchorElement>("#androidDirectDownload");
  const storeLink = document.querySelector<HTMLAnchorElement>("#androidApkPureDownload");
  let latest: LatestRelease | null = null;
  directLink?.addEventListener("click", () => {
    directLink.classList.add("is-loading");
    directLink.setAttribute("aria-busy", "true");
    window.setTimeout(() => {
      directLink.classList.remove("is-loading");
      directLink.removeAttribute("aria-busy");
    }, 2000);
  });
  updateSection(COPY[getLanguage()], false);
  window.addEventListener("nav-kurd:language-change", () => updateSection(COPY[getLanguage()], latest?.directApkAvailable === true));

  const synchronizeLinks = (release: LatestRelease): void => {
    latest = release;
    updateSection(COPY[getLanguage()], release.directApkAvailable);
    if (directLink) {
      if (release.directApkAvailable && release.directApkUrl) {
        directLink.href = release.directApkUrl;
        directLink.download = `NAV-KURD-${release.version}.apk`;
        directLink.removeAttribute("target");
        directLink.removeAttribute("rel");
      } else {
        directLink.href = release.apkPureUrl;
        directLink.removeAttribute("download");
        directLink.target = "_blank";
        directLink.rel = "noopener noreferrer";
      }
      directLink.hidden = false;
      directLink.removeAttribute("aria-disabled");
    }
    if (storeLink) storeLink.href = release.apkPureUrl;
  };

  const showPostTutorialPromotion = (): void => {
    if (nativeAndroid()) return;
    try {
      const promoKey = `nav-kurd:android-promo:${APP_VERSION}`;
      if (sessionStorage.getItem(promoKey) === "shown") return;
      sessionStorage.setItem(promoKey, "shown");
    } catch { /* A private browser may not expose session storage. */ }
    const copy = COPY[getLanguage()];
    const overlay = document.createElement("div");
    overlay.className = "android-release-promo";
    overlay.dir = getLanguage() === "en" ? "ltr" : "rtl";
    overlay.innerHTML = `<div class="android-release-promo__backdrop" data-release-close></div><section class="android-release-promo__panel" role="dialog" aria-modal="true" aria-labelledby="androidReleasePromoTitle"><div class="android-release-promo__visual" aria-hidden="true"><span class="android-release-promo__route"></span></div><h2 id="androidReleasePromoTitle"></h2><p></p><div class="android-release-promo__actions"><a></a><button type="button" data-release-close></button></div></section>`;
    overlay.querySelector<HTMLElement>("h2")!.textContent = copy.promoTitle;
    overlay.querySelector<HTMLElement>("p")!.textContent = copy.promoBody;
    const download = overlay.querySelector<HTMLAnchorElement>("a")!;
    download.href = latest?.directApkUrl ?? storeLink?.href ?? APKPURE_URL;
    download.textContent = copy.promoDownload;
    if (latest?.directApkUrl) download.setAttribute("download", `NAV-KURD-${latest.version}.apk`);
    overlay.querySelector<HTMLButtonElement>("button")!.textContent = copy.promoClose;
    const close = (): void => { overlay.remove(); };
    overlay.querySelectorAll<HTMLElement>("[data-release-close]").forEach((element) => element.addEventListener("click", close));
    overlay.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    document.body.append(overlay);
    overlay.querySelector<HTMLAnchorElement>("a")?.focus({ preventScroll: true });
  };

  const showUpdateDialog = (release: LatestRelease, installed: string): void => {
    const key = `nav-kurd:update-dismissed:${release.version}`;
    try {
      const dismissedAt = Number(localStorage.getItem(key) ?? 0);
      if (Date.now() - dismissedAt < 24 * 60 * 60 * 1000) return;
    } catch { /* Keep the prompt available without storage. */ }
    const copy = COPY[getLanguage()];
    const overlay = document.createElement("div");
    overlay.className = "app-update-dialog";
    overlay.dir = getLanguage() === "en" ? "ltr" : "rtl";
    overlay.dataset.required = String(compareVersions(installed, release.minimumVersion) < 0);
    overlay.innerHTML = `<div class="app-update-dialog__backdrop"></div><section class="app-update-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="appUpdateTitle"><h2 id="appUpdateTitle"></h2><p></p><div class="app-update-dialog__actions"><a target="_blank" rel="noopener noreferrer"></a><button type="button"></button></div></section>`;
    overlay.querySelector<HTMLElement>("h2")!.textContent = copy.updateTitle;
    overlay.querySelector<HTMLElement>("p")!.textContent = copy.updateBody(release.version);
    const update = overlay.querySelector<HTMLAnchorElement>("a")!;
    update.href = nativeAndroid() ? release.apkPureUrl : (release.directApkUrl ?? release.apkPureUrl);
    update.textContent = copy.updateNow;
    const later = overlay.querySelector<HTMLButtonElement>("button")!;
    later.textContent = copy.updateLater;
    later.addEventListener("click", () => {
      try { localStorage.setItem(key, String(Date.now())); } catch { /* Optional. */ }
      overlay.remove();
    });
    document.body.append(overlay);
    update.focus({ preventScroll: true });
  };

  const checkForUpdate = async (): Promise<void> => {
    const release = await readLatestRelease();
    if (!release) return;
    synchronizeLinks(release);
    const installed = installedAndroidVersion();
    if (!installed || compareVersions(installed, release.version) >= 0) return;
    showUpdateDialog(release, installed);
    if ("Notification" in window && Notification.permission === "granted") {
      const notificationKey = `nav-kurd:update-notified:${release.version}`;
      try {
        if (localStorage.getItem(notificationKey) === "1") return;
        localStorage.setItem(notificationKey, "1");
      } catch { /* A visual update prompt is still shown. */ }
      new Notification(COPY[getLanguage()].notificationTitle, {
        body: COPY[getLanguage()].updateBody(release.version),
        icon: new URL("icons/nav-kurd-logo.png", window.location.href).toString(),
        tag: `nav-kurd-update-${release.version}`,
      });
    }
  };

  void readLatestRelease().then((release) => { if (release) synchronizeLinks(release); });
  return { showPostTutorialPromotion, checkForUpdate };
}
