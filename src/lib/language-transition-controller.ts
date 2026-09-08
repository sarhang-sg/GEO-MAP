import type { Language } from "./types";

type TransitionMode = "download" | "switch";
type TransitionCopy = Record<TransitionMode, { title: string; body: string }>;

const COPY: Record<Language, TransitionCopy> = {
  ku: {
    download: { title: "زمانی کوردی ئامادە دەکرێت", body: "داتای پێویست تەنها بۆ یەکەم جار دادەبەزێت." },
    switch: { title: "زمانی کوردی هەڵبژێردرا", body: "ماپ و گەڕان نوێ دەکرێنەوە." }
  },
  ar: {
    download: { title: "جارٍ إعداد العربية", body: "سيتم تنزيل البيانات المطلوبة مرة واحدة فقط." },
    switch: { title: "تم اختيار العربية", body: "يتم تحديث الخريطة والبحث الآن." }
  },
  en: {
    download: { title: "Preparing English", body: "The required data is downloaded only the first time." },
    switch: { title: "English selected", body: "The map and search are being updated." }
  }
};

export type LanguageTransitionController = {
  show: (language: Language, mode?: TransitionMode) => void;
  hide: () => Promise<void>;
};

export function installLanguageTransitionController(): LanguageTransitionController {
  const root = document.createElement("div");
  root.className = "language-transition";
  root.hidden = true;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-atomic", "true");
  root.innerHTML = `
    <div class="language-transition__panel">
      <span class="language-transition__spinner" aria-hidden="true"></span>
      <div><strong></strong><small></small></div>
    </div>`;
  document.body.append(root);

  let showTimer: number | null = null;
  let hideTimer: number | null = null;

  const show = (language: Language, mode: TransitionMode = "download"): void => {
    if (showTimer !== null) window.clearTimeout(showTimer);
    if (hideTimer !== null) { window.clearTimeout(hideTimer); hideTimer = null; }
    const copy = COPY[language][mode];
    root.dataset.mode = mode;
    root.dataset.language = language;
    root.lang = language === "ku" ? "ckb-Arab-IQ" : language === "ar" ? "ar-IQ" : "en";
    root.dir = language === "en" ? "ltr" : "rtl";
    root.querySelector("strong")!.textContent = copy.title;
    root.querySelector("small")!.textContent = copy.body;

    // Cached language changes commonly finish within one frame. Delaying the
    // toast prevents a distracting flash without hiding genuine downloads.
    showTimer = window.setTimeout(() => {
      showTimer = null;
      root.hidden = false;
      window.requestAnimationFrame(() => root.classList.add("is-visible"));
    }, mode === "switch" ? 90 : 140);
  };

  const hide = (): Promise<void> => new Promise((resolve) => {
    if (showTimer !== null) {
      window.clearTimeout(showTimer);
      showTimer = null;
    }
    if (root.hidden) {
      root.removeAttribute("data-mode");
      resolve();
      return;
    }
    root.classList.remove("is-visible");
    hideTimer = window.setTimeout(() => {
      hideTimer = null;
      root.hidden = true;
      root.removeAttribute("data-mode");
      resolve();
    }, 120);
  });

  return { show, hide };
}
