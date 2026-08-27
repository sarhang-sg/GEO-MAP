import type { TutorialMapDemoController } from "./tutorial-map-demo-controller";

type TutorialLanguage = "ku" | "ar" | "en";
type TutorialCopy = {
  title: string;
  next: string;
  back: string;
  skip: string;
  finish: string;
  steps: Array<{ title: string; body: string }>;
};
type TutorialOptions = {
  getLanguage: () => TutorialLanguage;
  openAbout: () => void;
  closeAbout: () => void;
  isMapActionsExpanded: () => boolean;
  setMapActionsExpanded: (expanded: boolean) => void;
  mapDemo: TutorialMapDemoController;
  onCompleted?: () => void;
};
type TutorialTargetSpec = {
  selector: string;
  openAbout?: boolean;
  allowTargetScroll?: boolean;
  expandActions?: boolean;
  demo?: "pin" | "modes3d";
  padding?: number;
};

const COPY: Record<TutorialLanguage, TutorialCopy> = {
  ku: {
    title: "ڕێنمایی پیشەیی NAV KURD", next: "دواتر", back: "پێشوو", skip: "تێپەڕاندن", finish: "دەست پێ بکە",
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
    title: "الدليل الاحترافي لـ NAV KURD", next: "التالي", back: "السابق", skip: "تخطي", finish: "ابدأ الاستخدام",
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
    title: "NAV KURD professional guide", next: "Next", back: "Back", skip: "Skip", finish: "Start exploring",
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
  { selector: "#userAccountButton" },
  { selector: "#brandAboutButton" },
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
function tutorialVisual(step: number): string {
  const paths = [
    '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18h14"/><path d="M6 6h3M15 6h3"/>',
    '<circle cx="12" cy="8" r="3"/><path d="M6.5 19c.6-4 2.4-6 5.5-6s4.9 2 5.5 6M18 4.5l2 1v2.3c0 1.8-.8 3.1-2 3.7-1.2-.6-2-1.9-2-3.7V5.5l2-1Z"/>',
    '<circle cx="12" cy="12" r="9"/><path d="M12 10v6m0-9.5v.2M6.5 18.2l11-12.4"/>',
    '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4.5 4.5M7.5 10.5h6M10.5 7.5v6"/>',
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
    '<path d="m4 7 8-4 8 4-8 4-8-4Zm0 5 8 4 8-4M4 17l8 4 8-4"/>',
    '<path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/>',
    '<path d="m4 8 8-5 8 5-8 5-8-5Zm0 0v8l8 5 8-5V8M12 13v8"/>'
  ];
  return `<div class="nav-tutorial__visual" aria-hidden="true"><span class="nav-tutorial__visual-orbit"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[step] ?? paths[0]}</svg></div>`;
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
    if (!active || suspended || overlay.hidden) return false;
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
    if (!active || suspended || resizeFrame !== null) return;
    resizeFrame = window.requestAnimationFrame(() => { resizeFrame = null; position(); });
  };

  const prepareStep = (): void => {
    if (currentSpec().openAbout) options.openAbout(); else options.closeAbout();
    options.setMapActionsExpanded(currentSpec().expandActions ? true : actionsExpandedBeforeTutorial);
  };

  const startStepDemo = (): void => {
    if (suspended) return;
    if (currentSpec().demo === "pin") options.mapDemo.showPinDemo();
    if (currentSpec().demo === "modes3d") {
      options.mapDemo.startModes3dDemo((selector) => {
        if (!active || suspended || currentSpec().demo !== "modes3d") return;
        dynamicTargetSelector = selector;
        observeTarget(null);
        schedulePosition();
      });
    }
  };

  const settlePosition = async (serial: number): Promise<void> => {
    await waitForDocumentLayout();
    if (!active || suspended || serial !== renderSerial) return;
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
    renderSerial += 1;
    if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    resizeFrame = null;
    dynamicTargetSelector = null;
    observeTarget(null);
    overlay.hidden = true;
    overlay.classList.remove("is-positioned", "is-target-missing");
    options.closeAbout();
    options.setMapActionsExpanded(actionsExpandedBeforeTutorial);
    void options.mapDemo.cleanup();
    if (completed) {
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* private mode */ }
    }
    if (completed && announceCompletion) options.onCompleted?.();
  };

  const render = async (): Promise<void> => {
    if (!active || suspended) return;
    const serial = ++renderSerial;
    dynamicTargetSelector = null;
    await options.mapDemo.cleanup();
    if (!active || suspended || serial !== renderSerial) return;
    prepareStep();
    const localized = copy();
    const step = localized.steps[index];
    overlay.classList.remove("is-positioned", "is-target-missing");
    overlay.hidden = false;
    overlay.dir = language() === "en" ? "ltr" : "rtl";
    overlay.innerHTML = `
      <div class="nav-tutorial__veil" aria-hidden="true"></div>
      <div class="nav-tutorial__ring" aria-hidden="true"></div>
      <section class="nav-tutorial__card" data-tutorial-step="${index + 1}" role="dialog" aria-live="polite" aria-label="${localized.title}">
        <div class="nav-tutorial__topline"><div class="nav-tutorial__progress">${index + 1}/${TARGETS.length}</div><div class="nav-tutorial__progress-track" role="progressbar" aria-valuemin="1" aria-valuemax="${TARGETS.length}" aria-valuenow="${index + 1}"><span style="width:${((index + 1) / TARGETS.length) * 100}%"></span></div></div>
        <div class="nav-tutorial__content">${tutorialVisual(index)}<div><h3>${step.title}</h3><p>${step.body}</p></div></div>
        <div class="nav-tutorial__actions">
          <button type="button" data-tutorial-action="skip">${localized.skip}</button>
          <div>${index > 0 ? `<button type="button" data-tutorial-action="back">${localized.back}</button>` : ""}
          <button class="is-primary" type="button" data-tutorial-action="next">${index === TARGETS.length - 1 ? localized.finish : localized.next}</button></div>
        </div>
      </section>`;
    observeTarget(null);
    overlay.querySelectorAll<HTMLButtonElement>("[data-tutorial-action]").forEach((button) => button.addEventListener("click", () => {
      const action = button.dataset.tutorialAction;
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
  window.addEventListener("pageshow", () => { if (active && !document.hidden) { suspended = false; overlay.hidden = false; schedulePosition(); } });
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
    if (active && suspended) { suspended = false; void render(); }
    else if (autoStartPending) scheduleAutoStart();
  });
  document.addEventListener("keydown", (event) => { if (active && event.key === "Escape") finish(true); });

  return { start, maybeStart, stop: () => finish(true) };
}
