import { copyText } from "./clipboard";
import type { LngLatTuple } from "./location";
import { browserEnv } from "./runtime-env";

export type ShareLocationOptions = {
  coordinate: LngLatTuple;
  title?: string;
  text?: string;
};

const CANONICAL_APP_URL = "https://geo-map-kappa.vercel.app/";

function publicAppUrl(): URL {
  const candidates = [
    browserEnv.publicAppUrl,
    typeof window !== "undefined" ? window.location.origin : "",
    CANONICAL_APP_URL
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed;
    } catch {
      // A malformed deployment variable must never break the share action.
    }
  }
  return new URL(CANONICAL_APP_URL);
}

export function locationDeepLink(options: ShareLocationOptions): string {
  const url = publicAppUrl();
  url.search = "";
  url.hash = "";
  url.searchParams.set("action", "coordinate");
  url.searchParams.set("lng", options.coordinate[0].toFixed(6));
  url.searchParams.set("lat", options.coordinate[1].toFixed(6));
  if (options.title?.trim()) url.searchParams.set("label", options.title.trim().slice(0, 180));
  return url.toString();
}

async function shareNativeLocation(options: ShareLocationOptions): Promise<boolean> {
  const title = options.title?.trim() || "NAV KURD";
  const text = options.text?.trim() || `${title}\n${options.coordinate[1].toFixed(6)}, ${options.coordinate[0].toFixed(6)}`;
  try {
    const url = locationDeepLink(options);
    const flutterWindow = window as unknown as {
      __NAV_KURD_FLUTTER__?: boolean;
      navKurdAndroid?: { share?: (data: { title: string; text: string; url: string }) => Promise<boolean> };
    };
    if (flutterWindow.__NAV_KURD_FLUTTER__ === true && flutterWindow.navKurdAndroid?.share) {
      const handled = await flutterWindow.navKurdAndroid.share({ title, text, url });
      if (handled) return true;
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    return copyText(`${text}\n${url}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && window.__NAV_KURD_FLUTTER__ !== true) return false;
    const fallback = new URL(CANONICAL_APP_URL);
    fallback.searchParams.set("action", "coordinate");
    fallback.searchParams.set("lng", options.coordinate[0].toFixed(6));
    fallback.searchParams.set("lat", options.coordinate[1].toFixed(6));
    return copyText(`${text}\n${fallback.toString()}`);
  }
}

const SHARE_COPY = {
  ku: { heading: "هاوبەشکردنی شوێن", close: "داخستن", copy: "کۆپیکردنی بەستەر", copied: "بەستەر کۆپی کرا", failed: "کۆپی نەکرا؛ بەستەرەکە هەڵبژێرە.", share: "هاوبەشکردن", scan: "QR بکەرەوە بۆ بینینی شوێن", loading: "ئامادەکردنی QR…", unavailable: "QR بەردەست نییە؛ بەستەرەکە بەکاربهێنە." },
  ar: { heading: "مشاركة الموقع", close: "إغلاق", copy: "نسخ الرابط", copied: "تم نسخ الرابط", failed: "تعذر النسخ؛ حدد الرابط.", share: "مشاركة", scan: "امسح QR لفتح الموقع", loading: "تحضير QR…", unavailable: "QR غير متاح؛ استخدم الرابط." },
  en: { heading: "Share location", close: "Close", copy: "Copy link", copied: "Link copied", failed: "Could not copy; select the link.", share: "Share", scan: "Scan QR to open this place", loading: "Preparing QR…", unavailable: "QR unavailable; use the link." }
};

/** Same local QR and sharing actions in the browser and Android WebView. */
export function shareMapLocation(options: ShareLocationOptions): Promise<boolean> {
  document.querySelector<HTMLDialogElement>("#locationShareDialog")?.close();
  const language = document.body.dataset.language || document.documentElement.lang;
  const copy = SHARE_COPY[language === "en" ? "en" : language === "ar" ? "ar" : "ku"];
  const url = locationDeepLink(options);
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.id = "locationShareDialog"; dialog.className = "location-share-dialog";
  dialog.dir = language === "en" ? "ltr" : "rtl";
  dialog.setAttribute("aria-labelledby", "locationShareTitle");
  const header = document.createElement("header"), title = document.createElement("h2");
  title.id = "locationShareTitle"; title.textContent = copy.heading;
  const close = document.createElement("button"); close.type = "button"; close.textContent = copy.close;
  close.addEventListener("click", () => dialog.close()); header.append(title, close);
  const place = document.createElement("p"); place.className = "location-share-dialog__place";
  place.textContent = options.title?.trim() || "NAV KURD";
  const code = document.createElement("div"); code.className = "location-share-dialog__qr";
  code.textContent = copy.loading;
  const hint = document.createElement("p"); hint.textContent = copy.scan;
  const link = document.createElement("input"); link.id = "locationShareUrl"; link.name = "location-share-url";
  link.type = "url"; link.readOnly = true; link.dir = "ltr"; link.value = url;
  link.setAttribute("aria-label", copy.copy); link.addEventListener("focus", () => link.select());
  const actions = document.createElement("div"); actions.className = "location-share-dialog__actions";
  const copyButton = document.createElement("button"), shareButton = document.createElement("button");
  copyButton.type = shareButton.type = "button";
  copyButton.textContent = copy.copy; shareButton.textContent = copy.share;
  shareButton.className = "location-share-dialog__native";
  const status = document.createElement("p"); status.setAttribute("role", "status");
  actions.append(copyButton, shareButton); dialog.append(header, place, code, hint, link, actions, status);
  document.body.append(dialog);
  let shared = false;
  copyButton.addEventListener("click", () => {
    void copyText(url).then(ok => { shared ||= ok; status.textContent = ok ? copy.copied : copy.failed; if (!ok) link.focus(); });
  });
  shareButton.addEventListener("click", () => {
    void shareNativeLocation(options).then(ok => { if (ok) { shared = true; dialog.close(); } });
  });
  const completed = new Promise<boolean>(resolve => dialog.addEventListener("close", () => {
    dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    resolve(shared);
  }, { once: true }));
  dialog.showModal();
  void import("../vendor/qrcodegen").then(({ qrcodegen }) => {
    if (!dialog.open) return;
    const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${qr.size + 8} ${qr.size + 8}`);
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", copy.scan);
    svg.setAttribute("shape-rendering", "crispEdges");
    const background = document.createElementNS(ns, "rect");
    background.setAttribute("width", "100%"); background.setAttribute("height", "100%"); background.setAttribute("fill", "#fff");
    const path = document.createElementNS(ns, "path"); path.setAttribute("fill", "#000");
    const modules: string[] = [];
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.getModule(x, y)) modules.push(`M${x + 4},${y + 4}h1v1h-1z`);
    path.setAttribute("d", modules.join("")); svg.append(background, path); code.replaceChildren(svg);
  }).catch(() => { if (dialog.open) code.textContent = copy.unavailable; });
  return completed;
}

export function createPopupShareButton(options: ShareLocationOptions, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "place-popup__share";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void shareMapLocation(options);
  });
  return button;
}
