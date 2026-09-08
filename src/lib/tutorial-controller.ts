import type { TutorialMapDemoController } from "./tutorial-map-demo-controller";

type TutorialLanguage = "ku" | "ar" | "en";
type TutorialCopy = {
  title: string;
  next: string;
  back: string;
  skip: string;
  finish: string;
  minimize: string;
  restore: string;
  steps: Array<{ title: string; body: string }>;
};
type TutorialOptions = {
  getLanguage: () => TutorialLanguage;
  openAbout: () => void;
  closeAbout: () => void;
  openAccount: () => void | Promise<void>;
  closeAccount: () => void;
  isMapActionsExpanded: () => boolean;
  setMapActionsExpanded: (expanded: boolean) => void;
  mapDemo: TutorialMapDemoController;
  onCompleted?: () => void;
};
type TutorialTargetSpec = {
  selector: string;
  openAbout?: boolean;
  openAccount?: boolean;
  adaptiveAccount?: boolean;
  iconSelector?: string;
  allowTargetScroll?: boolean;
  expandActions?: boolean;
  demo?: "pin" | "modes3d";
  padding?: number;
};

const COPY: Record<TutorialLanguage, TutorialCopy> = {
  ku: {
    title: "ڕێنمایی پیشەیی NAV KURD", next: "دواتر", back: "پێشوو", skip: "تێپەڕاندن", finish: "دەست پێ بکە", minimize: "بچووککردنەوە", restore: "گەڕاندنەوەی ڕێنمایی",
    steps: [
      { title: "ماپی ئۆفلاین یەکجار ئامادە بکە", body: "تەنها یەکجار پێویستی بە دابەزاندنە بۆ ئەوەی ئەپەکە باشتر لەسەر ئامێرەکەت کار بکات و خێراتر بێت تکایە ئەم بەشە داونلۆد بکە!" },
      { title: "هەژمار و بەشداریی پارێزراو", body: "بچۆ ژوورەوە بۆ پێشنیارکردنی شوێنی نوێ، بارکردنی وێنە و بەدواداچوونی دۆخی پێداچوونەوە؛ هەر داواکارییەک پێش بڵاوکردنەوە پشکنین دەکرێت." },
      { title: "زانیاری، تایبەتمەندی و پشتگیری", body: "لە پەڕەی ناساندندا وەشان، داتای ماپ، بەشی ئۆفلاین، سیاسەتی تایبەتمەندی و ڕێگاکانی پەیوەندی دەبینیت." },
      { title: "گەڕانی ورد بە زمانی هەڵبژێردراو", body: "ناوی شار، گوند، شەقام یان هەر شوێنێک بنووسە. ئەنجامەکان بە ناوی پشتڕاستکراوی هەمان زمان پیشان دەدرێن." },
      { title: "GPS و ئاراستەی ڕاستەوخۆ", body: "ڕێگەی شوێن و حسکەرەکانی ئاراستە بدە تا شوێن، وردی و ئاراستەی مۆبایل بە ڕاستەوخۆ نوێ بکرێنەوە. دوور لە کانزا و کەیسی مگناتیسی وردی باشترە." },
      { title: "ئامراز و لایەرەکانی ماپ", body: "لایەرەکان، شوێنەکان، شێوازی پیشاندان و کۆنترۆڵە زیادەکان لەم پەنێڵە بەڕێوە ببە؛ تەنها ئەوەی پێویستتە چالاک بکە." },
      { title: "دیاریکردنی خاڵ و زیادکردنی شوێن", body: "دوگمەی پین هەڵبژێرە، دواتر خاڵەکە لەسەر ماپ دیاری بکە. دەتوانیت وەک مەبەست بەکاری بهێنیت یان شوێنێکی نوێ بە زانیاری و ئایکۆنی گونجاو زیاد بکەیت." },
      { title: "شێوازەکان، سەتەلایت و 3D", body: "نێوان ڕێگا، شەو و سەتەلایت بگۆڕە و دیمەنی 3D چالاک بکە. هەڵبژاردەکانت دەپارێزرێن و لە کردنەوەی داهاتوودا دەگەڕێنەوە." }
    ]
  },
  ar: {
    title: "الدليل الاحترافي لـ NAV KURD", next: "التالي", back: "السابق", skip: "تخطي", finish: "ابدأ الاستخدام", minimize: "تصغير", restore: "إعادة فتح الدليل",
    steps: [
      { title: "جهّز الخريطة بلا إنترنت مرة واحدة", body: "يلزم تنزيل هذا القسم مرة واحدة فقط كي يعمل التطبيق بشكل أفضل وأسرع على جهازك. يرجى تنزيله!" },
      { title: "حساب ومساهمات محمية", body: "سجّل الدخول لاقتراح مكان جديد وإرفاق الصور ومتابعة المراجعة. تخضع كل مساهمة للتحقق قبل نشرها." },
      { title: "المعلومات والخصوصية والدعم", body: "يعرض قسم التعريف رقم الإصدار وبيانات الخريطة والتنزيل بلا إنترنت وسياسة الخصوصية ووسائل الدعم." },
      { title: "بحث دقيق باللغة المختارة", body: "ابحث عن مدينة أو قرية أو شارع أو أي مكان. تظهر النتائج بالأسماء الموثقة للغة التي اخترتها." },
      { title: "GPS واتجاه مباشر", body: "اسمح بالموقع ومستشعرات الاتجاه لتحديث موضعك ودقته واتجاه الهاتف مباشرة. تتحسن البوصلة بعيداً عن المعادن والأغطية المغناطيسية." },
      { title: "أدوات وطبقات الخريطة", body: "أدر الطبقات والأماكن وأنماط العرض والأدوات الإضافية من هذه اللوحة، وفعّل ما تحتاجه فقط." },
      { title: "تحديد نقطة وإضافة مكان", body: "اختر زر الدبوس ثم حدد النقطة على الخريطة. استخدمها كوجهة أو أضف مكاناً جديداً بمعلوماته وأيقونته المناسبة." },
      { title: "الأنماط والقمر الصناعي و3D", body: "بدّل بين الطرق والليل والقمر الصناعي وفعّل العرض ثلاثي الأبعاد. تحفظ اختياراتك تلقائياً للتشغيلات التالية." }
    ]
  },
  en: {
    title: "NAV KURD professional guide", next: "Next", back: "Back", skip: "Skip", finish: "Start exploring", minimize: "Minimize", restore: "Resume guide",
    steps: [
      { title: "Prepare offline maps once", body: "Download this section once so the app runs better and faster on your device." },
      { title: "Secure account & contributions", body: "Sign in to suggest a place, attach photos, and track its review status. Every contribution is verified before publication." },
      { title: "Information, privacy & support", body: "The About panel contains the release version, map-data details, offline controls, privacy information, and support options." },
      { title: "Precise selected-language search", body: "Search for a city, village, street, or place. Results use verified names for the language you selected." },
      { title: "Live GPS & device direction", body: "Allow location and orientation sensors to update your position, accuracy, and phone direction live. Compass accuracy improves away from metal and magnetic cases." },
      { title: "Map tools & layers", body: "Manage layers, places, display modes, and additional controls here. Keep only the tools you need enabled." },
      { title: "Pick a point or add a place", body: "Choose the pin tool, then select a point on the map. Use it as a destination or add a new place with the appropriate details and icon." },
      { title: "Styles, Satellite & 3D", body: "Switch among Roads, Night, and Satellite, and enable the 3D view. Your choices are saved automatically for future launches." }
    ]
  }
};

const STORAGE_KEY = "nav-kurd:tutorial:completed";
const AUTO_START_DELAY_MS = 220;
const TARGETS: readonly TutorialTargetSpec[] = [
  { selector: "#offlineMapPack", openAbout: true, allowTargetScroll: true, padding: 7 },
  { selector: "#userAccountButton", adaptiveAccount: true, expandActions: true, padding: 6 },
  { selector: "#brandAboutButton", padding: 6 },
  { selector: ".search-card", padding: 8 },
  { selector: "#locateButton" },
  { selector: "#actionsToggleButton" },
  { selector: "#routePinButton", expandActions: true, demo: "pin", padding: 8 },
  { selector: ".style-picker", expandActions: true, demo: "modes3d", padding: 8 }
] as const;
const EDGE_GAP = 10;
const TARGET_CARD_GAP = 16;
const INITIAL_LAYOUT_TIMEOUT_MS = 600;

export type TutorialController = { start: () => void; maybeStart: () => void; stop: () => void };
type ViewportRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(maximum, Math.max(minimum, value)); }
function currentViewportRect(): ViewportRect {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  return { left, top, right: left + width, bottom: top + height, width, height };
}
function nextFrame(): Promise<void> { return new Promise((resolve) => window.requestAnimationFrame(() => resolve())); }
function timeout(ms: number): Promise<void> { return new Promise((resolve) => window.setTimeout(resolve, ms)); }
function tutorialVisual(targetSelector: string): string {
  const target = document.querySelector<HTMLElement>(targetSelector);
  const source = target?.matches("img, svg")
    ? target
    : target?.querySelector<HTMLElement>("img.nav-ui-icon, img.map-button__logo, img.brand-card__logo, svg");
  if (source) {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    clone.setAttribute("aria-hidden", "true");
    clone.classList.add("nav-tutorial__matched-icon");
    return `<div class="nav-tutorial__visual" aria-hidden="true">${clone.outerHTML}</div>`;
  }
  return `<div class="nav-tutorial__visual" aria-hidden="true"><svg class="nav-tutorial__matched-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg></div>`;
}
async function waitForDocumentLayout(): Promise<void> {
  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  await Promise.race([fontsReady.then(() => undefined), timeout(INITIAL_LAYOUT_TIMEOUT_MS)]);
  await nextFrame();
  await nextFrame();
}

function scrollTargetIntoNearestContainer(target: HTMLElement): void {
  let container: HTMLElement | null = target.parentElement;
  while (container && container !== document.body) {
    const style = window.getComputedStyle(container);
    const scrollable = /(auto|scroll|overlay)/u.test(style.overflowY) && container.scrollHeight > container.clientHeight + 2;
    if (scrollable) {
      const targetRect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const targetCenter = targetRect.top - containerRect.top + container.scrollTop + targetRect.height / 2;
      container.scrollTo({ top: Math.max(0, targetCenter - container.clientHeight / 2), behavior: "auto" });
      return;
    }
    container = container.parentElement;
  }
  target.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
}

export function installTutorialController(options: TutorialOptions): TutorialController {
  const overlay = document.createElement("div");
  overlay.className = "nav-tutorial";
  overlay.hidden = true;
  document.body.append(overlay);

  let index = 0;
  let active = false;
  let suspended = false;
  let minimized = false;
  let resizeFrame: number | null = null;
  let renderSerial = 0;
  let dynamicTargetSelector: string | null = null;
  let actionsExpandedBeforeTutorial = false;
  let autoStartPending = false;
  let autoStartTimer: number | null = null;
  const positionObserver = "ResizeObserver" in window ? new ResizeObserver(() => schedulePosition()) : null;

  const language = (): TutorialLanguage => options.getLanguage();
  const copy = (): TutorialCopy => COPY[language()];
  const currentSpec = (): TutorialTargetSpec => TARGETS[index];
  const currentTargetSelector = (): string => dynamicTargetSelector ?? currentSpec().selector;
  const currentIconSelector = (): string => dynamicTargetSelector ?? currentSpec().iconSelector ?? currentSpec().selector;

  const findVisibleTarget = (): { target: HTMLElement; rect: DOMRect } | null => {
    const target = document.querySelector<HTMLElement>(currentTargetSelector());
    if (!target?.isConnected) return null;
    const style = window.getComputedStyle(target);
    const rect = target.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
      ? { target, rect }
      : null;
  };

  const observeTarget = (target: HTMLElement | null): void => {
    positionObserver?.disconnect();
    if (target) positionObserver?.observe(target);
  };

  const centerWithoutTarget = (card: HTMLElement, ring: HTMLElement): void => {
    const viewport = currentViewportRect();
    const cardRect = card.getBoundingClientRect();
    const width = Math.min(cardRect.width, viewport.width - EDGE_GAP * 2);
    const height = Math.min(cardRect.height, viewport.height - EDGE_GAP * 2);
    card.style.left = `${Math.round(viewport.left + (viewport.width - width) / 2)}px`;
    card.style.top = `${Math.round(viewport.top + (viewport.height - height) / 2)}px`;
    ring.hidden = true;
    overlay.classList.add("is-positioned", "is-target-missing");
  };

  const position = (): boolean => {
    if (!active || suspended || minimized || overlay.hidden) return false;
    const ring = overlay.querySelector<HTMLElement>(".nav-tutorial__ring");
    const card = overlay.querySelector<HTMLElement>(".nav-tutorial__card");
    if (!ring || !card) return false;
    const targetInfo = findVisibleTarget();
    if (!targetInfo) { observeTarget(null); centerWithoutTarget(card, ring); return true; }

    overlay.classList.remove("is-target-missing");
    const { target, rect } = targetInfo;
    observeTarget(target);
    const viewport = currentViewportRect();
    const pad = currentSpec().padding ?? clamp(Math.min(rect.width, rect.height) * 0.18, 7, 12);
    const ringLeft = clamp(rect.left - pad, viewport.left + 4, viewport.right - 12);
    const ringTop = clamp(rect.top - pad, viewport.top + 4, viewport.bottom - 12);
    const ringRight = clamp(rect.right + pad, ringLeft + 8, viewport.right - 4);
    const ringBottom = clamp(rect.bottom + pad, ringTop + 8, viewport.bottom - 4);
    const cardRect = card.getBoundingClientRect();
    const cardWidth = Math.min(cardRect.width, viewport.width - EDGE_GAP * 2);
    const cardHeight = Math.min(cardRect.height, viewport.height - EDGE_GAP * 2);
    const spaceBelow = viewport.bottom - ringBottom;
    const spaceAbove = ringTop - viewport.top;
    const idealTop = spaceBelow >= cardHeight + TARGET_CARD_GAP || spaceBelow >= spaceAbove
      ? ringBottom + TARGET_CARD_GAP : ringTop - cardHeight - TARGET_CARD_GAP;
    Object.assign(ring.style, {
      left: `${Math.round(ringLeft)}px`, top: `${Math.round(ringTop)}px`,
      width: `${Math.round(ringRight - ringLeft)}px`, height: `${Math.round(ringBottom - ringTop)}px`
    });
    ring.hidden = false;
    card.style.left = `${Math.round(clamp(rect.left + rect.width / 2 - cardWidth / 2, viewport.left + EDGE_GAP, viewport.right - cardWidth - EDGE_GAP))}px`;
    card.style.top = `${Math.round(clamp(idealTop, viewport.top + EDGE_GAP, viewport.bottom - cardHeight - EDGE_GAP))}px`;
    overlay.classList.add("is-positioned");
    return true;
  };

  const schedulePosition = (): void => {
    if (!active || suspended || minimized || resizeFrame !== null) return;
    resizeFrame = window.requestAnimationFrame(() => { resizeFrame = null; position(); });
  };

  const prepareStep = async (): Promise<void> => {
    const spec = currentSpec();
    if (spec.adaptiveAccount) {
      options.closeAbout();
      options.setMapActionsExpanded(true);
      await nextFrame();
      const shell = document.querySelector<HTMLElement>(".map-shell");
      const ownerButton = document.querySelector<HTMLButtonElement>("#ownerStudioButton");
      if (shell?.dataset.authState === "signed-in") {
        options.closeAccount();
        dynamicTargetSelector = ownerButton && !ownerButton.hidden ? "#ownerStudioButton" : "#userAccountButton";
      } else {
        await options.openAccount();
        dynamicTargetSelector = ".user-contrib__google";
      }
      return;
    }
    if (spec.openAccount) {
      options.closeAbout();
      await options.openAccount();
    } else {
      options.closeAccount();
      if (spec.openAbout) options.openAbout(); else options.closeAbout();
    }
    options.setMapActionsExpanded(spec.expandActions ? true : actionsExpandedBeforeTutorial);
  };

  const startStepDemo = (): void => {
    if (suspended || minimized) return;
    if (currentSpec().demo === "pin") options.mapDemo.showPinDemo();
    if (currentSpec().demo === "modes3d") {
      options.mapDemo.startModes3dDemo((selector) => {
        if (!active || suspended || minimized || currentSpec().demo !== "modes3d") return;
        dynamicTargetSelector = selector;
        observeTarget(null);
        schedulePosition();
      });
    }
  };

  const settlePosition = async (serial: number): Promise<void> => {
    await waitForDocumentLayout();
    if (!active || suspended || minimized || serial !== renderSerial) return;
    const targetInfo = findVisibleTarget();
    if (targetInfo && currentSpec().allowTargetScroll) {
      scrollTargetIntoNearestContainer(targetInfo.target);
      await nextFrame();
      await nextFrame();
    } else {
      await nextFrame();
    }
    if (!position()) schedulePosition();
  };

  const finish = (completed: boolean, announceCompletion = false): void => {
    if (autoStartTimer !== null) window.clearTimeout(autoStartTimer);
    autoStartTimer = null;
    autoStartPending = false;
    active = false;
    suspended = false;
    minimized = false;
    renderSerial += 1;
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = null;
    dynamicTargetSelector = null;
    observeTarget(null);
    overlay.hidden = true;
    overlay.classList.remove("is-positioned", "is-target-missing", "is-minimized");
    options.closeAbout();
    options.closeAccount();
    options.setMapActionsExpanded(actionsExpandedBeforeTutorial);
    void options.mapDemo.cleanup();
    if (completed) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* private mode */ }
    }
    if (completed && announceCompletion) options.onCompleted?.();
  };

  const render = async (): Promise<void> => {
    if (!active || suspended || minimized) return;
    const serial = ++renderSerial;
    dynamicTargetSelector = null;
    await options.mapDemo.cleanup();
    if (!active || suspended || minimized || serial !== renderSerial) return;
    await prepareStep();
    if (!active || suspended || minimized || serial !== renderSerial) return;
    const localized = copy();
    const step = localized.steps[index];
    overlay.classList.remove("is-positioned", "is-target-missing");
    overlay.hidden = false;
    overlay.dir = language() === "en" ? "ltr" : "rtl";
    overlay.innerHTML = `
      <div class="nav-tutorial__veil" aria-hidden="true"></div>
      <div class="nav-tutorial__ring" aria-hidden="true"></div>
      <section class="nav-tutorial__card" data-tutorial-step="${index + 1}" role="dialog" aria-live="polite" aria-label="${localized.title}">
        <div class="nav-tutorial__topline"><div class="nav-tutorial__progress">${index + 1}/${TARGETS.length}</div><div class="nav-tutorial__progress-track" role="progressbar" aria-valuemin="1" aria-valuemax="${TARGETS.length}" aria-valuenow="${index + 1}"><span style="width:${((index + 1) / TARGETS.length) * 100}%"></span></div><button class="nav-tutorial__minimize" type="button" data-tutorial-action="minimize" title="${localized.minimize}" aria-label="${localized.minimize}"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>
        <div class="nav-tutorial__content">${tutorialVisual(currentIconSelector())}<div><h3>${step.title}</h3><p>${step.body}</p></div></div>
        <div class="nav-tutorial__actions">
          <button type="button" data-tutorial-action="skip">${localized.skip}</button>
          <div>${index > 0 ? `<button type="button" data-tutorial-action="back">${localized.back}</button>` : ""}
          <button class="is-primary" type="button" data-tutorial-action="next">${index === TARGETS.length - 1 ? localized.finish : localized.next}</button></div>
        </div>
      </section>
      <button class="nav-tutorial__restore" type="button" data-tutorial-action="restore" aria-label="${localized.restore}" title="${localized.restore}" hidden><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 4.5V9H9" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${localized.restore}</span></button>`;
    observeTarget(null);
    overlay.querySelectorAll<HTMLButtonElement>("[data-tutorial-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.tutorialAction;
      if (action === "minimize") {
        minimized = true;
        renderSerial += 1;
        observeTarget(null);
        options.closeAbout();
        options.closeAccount();
        options.setMapActionsExpanded(actionsExpandedBeforeTutorial);
        void options.mapDemo.cleanup();
        overlay.classList.add("is-minimized");
        const restore = overlay.querySelector<HTMLButtonElement>(".nav-tutorial__restore");
        if (restore) restore.hidden = false;
        return;
      }
      if (action === "restore") {
        minimized = false;
        overlay.classList.remove("is-minimized");
        void render();
        return;
      }
      if (action === "skip") { finish(true); return; }
      if (action === "back") { index = Math.max(0, index - 1); void render(); return; }
      if (index >= TARGETS.length - 1) { finish(true, true); return; }
      index += 1;
      void render();
    }));
    startStepDemo();
    void settlePosition(serial);
  };

  const start = (): void => {
    if (autoStartTimer !== null) window.clearTimeout(autoStartTimer);
    autoStartTimer = null;
    autoStartPending = false;
    if (active) finish(false);
    index = 0;
    actionsExpandedBeforeTutorial = options.isMapActionsExpanded();
    active = true;
    minimized = false;
    suspended = document.hidden;
    if (!suspended) void render();
  };

  const scheduleAutoStart = (): void => {
    if (active || autoStartTimer !== null) return;
    autoStartPending = true;
    if (document.hidden) return;
    autoStartTimer = window.setTimeout(() => {
      autoStartTimer = null;
      if (document.hidden) return;
      void waitForDocumentLayout().then(() => {
        if (active || document.hidden) return;
        autoStartPending = false;
        start();
      });
    }, AUTO_START_DELAY_MS);
  };

  const maybeStart = (): void => {
    let completed = false;
    try { completed = localStorage.getItem(STORAGE_KEY) === "1"; } catch { /* private mode */ }
    if (!completed) scheduleAutoStart();
  };

  window.addEventListener("resize", schedulePosition, { passive: true });
  window.addEventListener("orientationchange", schedulePosition, { passive: true });
  window.addEventListener("scroll", schedulePosition, { passive: true, capture: true });
  window.addEventListener("pageshow", () => { if (active && !document.hidden) { suspended = false; overlay.hidden = false; if (!minimized) schedulePosition(); } });
  window.visualViewport?.addEventListener("resize", schedulePosition, { passive: true });
  window.visualViewport?.addEventListener("scroll", schedulePosition, { passive: true });
  window.addEventListener("nav-kurd:language-change", () => { if (active && !suspended) void render(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!active) return;
      suspended = true;
      renderSerial += 1;
      overlay.hidden = true;
      void options.mapDemo.cleanup();
      return;
    }
    if (active && suspended) {
      suspended = false;
      overlay.hidden = false;
      if (!minimized) void render();
    }
    else if (autoStartPending) scheduleAutoStart();
  });
  document.addEventListener("keydown", (event) => { if (active && event.key === "Escape") finish(true); });

  return { start, maybeStart, stop: () => finish(true) };
}
