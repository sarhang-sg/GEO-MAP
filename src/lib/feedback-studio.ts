import {
  atlasErrorMessage,
  getAtlasAuthIdentity,
  isAtlasBackendConfigured,
  signInAtlasWithGoogle,
  submitAtlasFeedback,
  type AtlasAuthIdentity,
  type AtlasFeedbackCategory
} from "./atlas-places";
import { appUrl } from "./app-url";
import { escapeText, languageDirection, type StudioLanguage } from "./owner-studio-copy";
import { APP_VERSION, MAP_DATA_VERSION } from "./release";
import { collectRuntimeDiagnostics, formatRuntimeDiagnosticsText, type RuntimeDiagnosticsSnapshot } from "./runtime-diagnostics";

const SUPPORT_EMAIL = "sarhang.salah9@gmail.com";
const DRAFT_KEY = "nav-kurd-feedback-draft-v1";

function diagnosticsPreviewHtml(value: string): string {
  return value.split("\n").map((line) => {
    const severity = line.startsWith("[ERROR]") ? "error"
      : line.startsWith("[WARN]") ? "warning"
      : line.startsWith("[OK]") ? "ok"
      : line.startsWith("[INFO]") ? "info"
      : "meta";
    return `<span class="diagnostic-line diagnostic-line--${severity}">${escapeText(line || " ")}</span>`;
  }).join("\n");
}

type FeedbackStudioOptions = { getLanguage: () => StudioLanguage };

type Copy = {
  title: string;
  subtitle: string;
  close: string;
  category: string;
  categories: Record<AtlasFeedbackCategory, string>;
  message: string;
  placeholder: string;
  diagnostics: string;
  diagnosticsHelp: string;
  previewTitle: string;
  previewHelp: string;
  previewPending: string;
  collect: string;
  collected: string;
  refresh: string;
  copy: string;
  copied: string;
  copyFailed: string;
  submit: string;
  signInSubmit: string;
  email: string;
  emailHelp: string;
  sent: string;
  required: string;
  unavailable: string;
  privacy: string;
};

const COPY: Record<StudioLanguage, Copy> = {
  ku: {
    title: "فیدباک و ڕاپۆرتی کێشە",
    subtitle: "کێشەی ماپ، داتا، چوونەژوورەوە، GPS یان UI بنێرە بۆ NAV KURD.",
    close: "داخستن",
    category: "جۆری کێشە",
    categories: { bug: "گلیچ/هەڵە", data: "داتای ماپ", place: "ناو یان شوێن", search: "گەڕان", login: "چوونەژوورەوە", offline: "ئۆفلاین", gps: "GPS و ڕێنیشاندان", ui: "UI و شاشە", other: "شتی تر" },
    message: "وردەکاری",
    placeholder: "چی ڕوویدا؟ هەنگاوەکانی دووبارەکردنەوە و ئەنجامی چاوەڕوانکراو بنووسە…",
    diagnostics: "ڕاپۆرتی تەکنیکی لەگەڵی بنێرە",
    diagnosticsHelp: "ڤێرژن، جۆری وێبگەڕ، قەبارەی شاشە، network و هەڵە نوێیەکان. شوێنی ورد، پاسوۆرد، token یان دەقی تایبەتی کۆ ناکرێتەوە.",
    previewTitle: "پریڤیوی ڕاستەوخۆی ڕاپۆرت",
    previewHelp: "ئەم داتایە هەمان ئەوەیە کە کۆپی یان لەگەڵ فیدباک دەنێردرێت.",
    previewPending: "خەریکە داتای پارێزراوی ئامێر کۆدەکرێتەوە…",
    collect: "کۆکردنەوەی داتای مۆبایل",
    collected: "ڕاپۆرتی مۆبایل نوێ کرایەوە.",
    refresh: "نوێکردنەوە",
    copy: "کۆپیکردنی ڕاپۆرت",
    copied: "ڕاپۆرت کۆپی کرا.",
    copyFailed: "کۆپیکردنی خۆکار سەرکەوتوو نەبوو؛ دەقەکە هەڵبژێرە و کۆپی بکە.",
    submit: "ناردنی فیدباک",
    signInSubmit: "بە Google بچۆ ژوورەوە و بنێرە",
    email: "ناردن بە ئیمەیڵ",
    emailHelp: "بۆ زانیاریی زیاتر یان فایلی وێنە، ئیمەیڵ بەکاربهێنە.",
    sent: "فیدباکەکەت نێردرا. سوپاس بۆ یارمەتیدان بە باشترکردنی NAV KURD.",
    required: "تکایە لانیکەم ٢٠ پیت وردەکاری بنووسە.",
    unavailable: "خزمەتی ناردنی ناوخۆ ئێستا بەردەست نییە؛ دەتوانیت ڕاپۆرتەکە کۆپی بکەیت یان بە ئیمەیڵ بینێریت.",
    privacy: "سیاسەتی تایبەتمەندی"
  },
  ar: {
    title: "الملاحظات والإبلاغ عن مشكلة",
    subtitle: "أرسل مشكلة في الخريطة أو البيانات أو تسجيل الدخول أو GPS أو الواجهة.",
    close: "إغلاق",
    category: "نوع المشكلة",
    categories: { bug: "خلل/خطأ", data: "بيانات الخريطة", place: "اسم أو مكان", search: "البحث", login: "تسجيل الدخول", offline: "دون اتصال", gps: "GPS والملاحة", ui: "الواجهة والشاشة", other: "أخرى" },
    message: "التفاصيل",
    placeholder: "ماذا حدث؟ اكتب خطوات إعادة المشكلة والنتيجة المتوقعة…",
    diagnostics: "إرفاق تقرير تقني",
    diagnosticsHelp: "يتضمن الإصدار والمتصفح وحجم الشاشة والشبكة والأخطاء الحديثة. لا يجمع الموقع الدقيق أو كلمات المرور أو الرموز أو المحتوى الخاص.",
    previewTitle: "معاينة مباشرة للتقرير",
    previewHelp: "هذه هي البيانات نفسها التي ستُنسخ أو تُرسل مع الملاحظة.",
    previewPending: "جارٍ جمع بيانات الجهاز الآمنة…",
    collect: "جمع بيانات الجهاز",
    collected: "تم تحديث تقرير الجهاز.",
    refresh: "تحديث",
    copy: "نسخ التقرير",
    copied: "تم نسخ التقرير.",
    copyFailed: "تعذر النسخ التلقائي؛ حدّد النص وانسخه يدويًا.",
    submit: "إرسال الملاحظة",
    signInSubmit: "المتابعة عبر Google والإرسال",
    email: "الإرسال بالبريد الإلكتروني",
    emailHelp: "استخدم البريد لإضافة صور أو ملفات أو معلومات أخرى.",
    sent: "تم إرسال ملاحظتك. شكرًا لمساعدتنا في تحسين NAV KURD.",
    required: "اكتب ما لا يقل عن 20 حرفًا من التفاصيل.",
    unavailable: "الإرسال داخل التطبيق غير متاح الآن؛ يمكنك نسخ التقرير أو إرساله بالبريد.",
    privacy: "سياسة الخصوصية"
  },
  en: {
    title: "Feedback and issue report",
    subtitle: "Report a map, data, sign-in, GPS, offline or interface problem.",
    close: "Close",
    category: "Issue type",
    categories: { bug: "Bug or glitch", data: "Map data", place: "Place or name", search: "Search", login: "Sign-in", offline: "Offline", gps: "GPS and navigation", ui: "UI and display", other: "Other" },
    message: "Details",
    placeholder: "What happened? Include reproduction steps and the result you expected…",
    diagnostics: "Include a technical report",
    diagnosticsHelp: "Includes app version, browser, screen size, network state and recent errors. It does not collect precise location, passwords, tokens or private content.",
    previewTitle: "Live report preview",
    previewHelp: "This is the same data that will be copied or attached to the feedback report.",
    previewPending: "Collecting safe device data…",
    collect: "Collect device data",
    collected: "The device report was refreshed.",
    refresh: "Refresh",
    copy: "Copy report",
    copied: "Report copied.",
    copyFailed: "Automatic copying failed; select the preview text and copy it manually.",
    submit: "Send feedback",
    signInSubmit: "Continue with Google and send",
    email: "Send by email",
    emailHelp: "Use email when you need to attach screenshots, files or additional information.",
    sent: "Your feedback was sent. Thank you for helping improve NAV KURD.",
    required: "Please enter at least 20 characters of detail.",
    unavailable: "In-app submission is unavailable right now; you can copy the report or send it by email.",
    privacy: "Privacy Policy"
  }
};

function feedbackIcon(name: "close" | "copy" | "mail" | "send" | "device"): string {
  const paths: Record<string, string> = {
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    send: '<path d="m3 11 18-8-8 18-2.5-7.5L3 11Z"/><path d="m10.5 13.5 4-4"/>',
    device: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 18h4"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</g></svg>`;
}

export class FeedbackStudio {
  private readonly host = document.createElement("div");
  private readonly options: FeedbackStudioOptions;
  private identity: AtlasAuthIdentity | null = null;
  private diagnostics: RuntimeDiagnosticsSnapshot | null = null;
  private busy = false;
  private message = "";
  private messageKind: "normal" | "error" | "success" = "normal";

  constructor(options: FeedbackStudioOptions) {
    this.options = options;
    this.host.className = "feedback-studio";
    this.host.hidden = true;
    document.body.append(this.host);
  }

  isOpenOrBusy(): boolean { return !this.host.hidden || this.busy; }

  async openRoadReport(coordinate: readonly [number, number]): Promise<void> {
    const [longitude, latitude] = coordinate;
    const language = this.options.getLanguage();
    const coordinateLabel = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    const message = language === "ar"
      ? `بلاغ طريق عند: ${coordinateLabel}\nنوع المشكلة: ازدحام / طريق مغلق / أعمال طريق / خطر\nالتفاصيل: `
      : language === "en"
        ? `Road report at: ${coordinateLabel}\nIssue type: congestion / closure / roadworks / hazard\nDetails: `
        : `ڕاپۆرتی ڕێگا لەم شوێنە: ${coordinateLabel}\nجۆری کێشە: قەرەباڵغی / ڕێگای داخراو / چاککردنەوە / مەترسی\nوردەکاری: `;
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ category: "data", message, includeDiagnostics: true }));
    } catch { /* storage may be unavailable */ }
    await this.open();
  }

  async open(): Promise<void> {
    this.host.hidden = false;
    this.diagnostics = null;
    try { this.identity = await getAtlasAuthIdentity(); } catch { this.identity = null; }
    this.render();
    void this.updateDiagnosticsPreview(true);
  }

  close(): void { this.persistDraft(); this.host.hidden = true; }

  private copy(): Copy { return COPY[this.options.getLanguage()]; }

  private readDraft(): { category: AtlasFeedbackCategory; message: string; includeDiagnostics: boolean } {
    try {
      const value = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null") as { category?: AtlasFeedbackCategory; message?: string; includeDiagnostics?: boolean } | null;
      const category = value?.category && Object.hasOwn(this.copy().categories, value.category) ? value.category : "bug";
      return { category, message: String(value?.message ?? "").slice(0, 2000), includeDiagnostics: value?.includeDiagnostics !== false };
    } catch { return { category: "bug", message: "", includeDiagnostics: true }; }
  }

  private persistDraft(): void {
    const form = this.host.querySelector<HTMLFormElement>("[data-feedback-form]");
    if (!form) return;
    const data = new FormData(form);
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
        category: String(data.get("category") ?? "bug"),
        message: String(data.get("message") ?? "").slice(0, 2000),
        includeDiagnostics: data.get("include_diagnostics") === "on"
      }));
    } catch { /* storage may be unavailable */ }
  }

  private clearDraft(): void {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* no-op */ }
  }

  private render(): void {
    const copy = this.copy();
    const language = this.options.getLanguage();
    const draft = this.readDraft();
    const options = (Object.keys(copy.categories) as AtlasFeedbackCategory[])
      .map((category) => `<option value="${category}" ${category === draft.category ? "selected" : ""}>${escapeText(copy.categories[category])}</option>`)
      .join("");
    const submitLabel = this.identity ? copy.submit : copy.signInSubmit;
    this.host.innerHTML = `<div class="feedback-studio__backdrop" data-feedback-action="close"></div>
      <section class="feedback-studio__panel" role="dialog" aria-modal="true" aria-labelledby="feedbackTitle" dir="${languageDirection(language)}">
        <div class="feedback-studio__scroll">
          <header><div><p>NAV KURD</p><h2 id="feedbackTitle">${escapeText(copy.title)}</h2><span>${escapeText(copy.subtitle)}</span></div><button class="dialog-close-button feedback-studio__close" type="button" data-feedback-action="close" aria-label="${escapeText(copy.close)}">${feedbackIcon("close")}</button></header>
          ${this.message ? `<p class="feedback-studio__message" data-kind="${this.messageKind}">${escapeText(this.message)}</p>` : ""}
          <form data-feedback-form>
          <label><span>${escapeText(copy.category)}</span><select name="category">${options}</select></label>
          <label><span>${escapeText(copy.message)}</span><textarea name="message" minlength="20" maxlength="2000" rows="6" required placeholder="${escapeText(copy.placeholder)}">${escapeText(draft.message)}</textarea><small><b data-feedback-count>${draft.message.length}</b>/2000</small></label>
          <label class="feedback-studio__diagnostic-toggle"><input name="include_diagnostics" type="checkbox" ${draft.includeDiagnostics ? "checked" : ""}><span><strong>${escapeText(copy.diagnostics)}</strong><small>${escapeText(copy.diagnosticsHelp)}</small></span></label>
          <section class="feedback-studio__diagnostics-preview" aria-labelledby="feedbackPreviewTitle">
            <header><div><strong id="feedbackPreviewTitle">${escapeText(copy.previewTitle)}</strong><small>${escapeText(copy.previewHelp)}</small></div><div class="feedback-studio__preview-actions"><button type="button" data-feedback-action="refresh">${feedbackIcon("device")}<span>${escapeText(copy.refresh)}</span></button><button type="button" data-feedback-action="copy">${feedbackIcon("copy")}<span>${escapeText(copy.copy)}</span></button></div></header>
            <pre data-feedback-preview tabindex="0" dir="ltr">${escapeText(copy.previewPending)}</pre>
          </section>
          <div class="feedback-studio__actions feedback-studio__actions--secondary">
            <button type="button" data-feedback-action="collect">${feedbackIcon("device")}<span>${escapeText(copy.collect)}</span></button>
            <button type="button" data-feedback-action="copy">${feedbackIcon("copy")}<span>${escapeText(copy.copy)}</span></button>
            <button type="button" data-feedback-action="email">${feedbackIcon("mail")}<span>${escapeText(copy.email)}</span></button>
          </div>
          <small class="feedback-studio__email-help">${escapeText(copy.emailHelp)} · <a href="${appUrl("legal/privacy.html")}" target="_blank" rel="noopener">${escapeText(copy.privacy)}</a></small>
            <button class="feedback-studio__submit" type="submit" ${this.busy ? "disabled" : ""}>${feedbackIcon("send")}<span>${escapeText(submitLabel)}</span></button>
          </form>
        </div>
      </section>`;
    this.attachEvents();
  }

  private attachEvents(): void {
    this.host.querySelectorAll<HTMLElement>("[data-feedback-action]").forEach((element) => {
      element.addEventListener("click", () => { void this.handleAction(element.dataset.feedbackAction ?? ""); });
    });
    const form = this.host.querySelector<HTMLFormElement>("[data-feedback-form]");
    form?.addEventListener("submit", (event) => { event.preventDefault(); void this.submit(form); });
    const textarea = form?.querySelector<HTMLTextAreaElement>('textarea[name="message"]');
    const counter = form?.querySelector<HTMLElement>("[data-feedback-count]");
    textarea?.addEventListener("input", () => {
      if (counter) counter.textContent = String(textarea.value.length);
      this.persistDraft();
      void this.updateDiagnosticsPreview(false);
    });
    form?.querySelectorAll("select,input").forEach((element) => element.addEventListener("change", () => {
      this.persistDraft();
      void this.updateDiagnosticsPreview(false);
    }));
    void this.updateDiagnosticsPreview(false);
  }

  private async ensureDiagnostics(): Promise<RuntimeDiagnosticsSnapshot> {
    if (this.diagnostics) return this.diagnostics;
    this.diagnostics = await collectRuntimeDiagnostics({ appVersion: APP_VERSION, mapDataVersion: MAP_DATA_VERSION, language: this.options.getLanguage() });
    return this.diagnostics;
  }

  private formSnapshot(form: HTMLFormElement): { category: AtlasFeedbackCategory; message: string; includeDiagnostics: boolean } {
    const data = new FormData(form);
    return {
      category: String(data.get("category") ?? "bug") as AtlasFeedbackCategory,
      message: String(data.get("message") ?? "").trim().slice(0, 2000),
      includeDiagnostics: data.get("include_diagnostics") === "on"
    };
  }

  private formatReport(snapshot: { category: AtlasFeedbackCategory; message: string; includeDiagnostics: boolean }): string {
    const diagnostics = snapshot.includeDiagnostics
      ? this.diagnostics ? formatRuntimeDiagnosticsText(this.diagnostics) : this.copy().previewPending
      : "Diagnostics not included by the user.";
    return [
      "NAV KURD feedback report",
      `Category: ${snapshot.category}`,
      `Message: ${snapshot.message || "(No message entered)"}`,
      "",
      "--- Technical diagnostics ---",
      diagnostics
    ].join("\n").slice(0, 16000);
  }

  private async reportText(form: HTMLFormElement, collectDiagnostics: boolean): Promise<string> {
    const snapshot = this.formSnapshot(form);
    if (snapshot.includeDiagnostics && collectDiagnostics) await this.ensureDiagnostics();
    return this.formatReport(snapshot);
  }

  private async updateDiagnosticsPreview(collectDiagnostics: boolean): Promise<void> {
    const form = this.host.querySelector<HTMLFormElement>("[data-feedback-form]");
    const preview = this.host.querySelector<HTMLElement>("[data-feedback-preview]");
    if (!form || !preview) return;
    const snapshot = this.formSnapshot(form);
    if (snapshot.includeDiagnostics && collectDiagnostics) {
      preview.dataset.state = "loading";
      preview.innerHTML = diagnosticsPreviewHtml(this.copy().previewPending);
      try { await this.ensureDiagnostics(); }
      catch { /* the preview remains useful without optional fields */ }
    }
    if (!preview.isConnected || !form.isConnected) return;
    preview.dataset.state = snapshot.includeDiagnostics && !this.diagnostics ? "loading" : "ready";
    preview.innerHTML = diagnosticsPreviewHtml(this.formatReport(this.formSnapshot(form)));
  }

  private async copyText(payload: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(payload);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = payload;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      let copied = false;
      try { copied = document.execCommand("copy"); } catch { copied = false; }
      textarea.remove();
      return copied;
    }
  }

  private async handleAction(action: string): Promise<void> {
    if (action === "close") { this.close(); return; }
    if (action === "collect" || action === "refresh") {
      this.diagnostics = null;
      await this.updateDiagnosticsPreview(true);
      this.message = this.copy().collected;
      this.messageKind = "success";
      this.render();
      return;
    }
    if (action === "copy") {
      const form = this.host.querySelector<HTMLFormElement>("[data-feedback-form]");
      if (!form) return;
      const payload = await this.reportText(form, true);
      const copied = await this.copyText(payload);
      this.message = copied ? this.copy().copied : this.copy().copyFailed;
      this.messageKind = copied ? "success" : "error";
      this.render();
      return;
    }
    if (action === "email") {
      const form = this.host.querySelector<HTMLFormElement>("[data-feedback-form]");
      if (!form) return;
      this.persistDraft();
      const snapshot = this.formSnapshot(form);
      const subject = `NAV KURD feedback — ${this.copy().categories[snapshot.category]}`;
      const body = await this.reportText(form, true);
      window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
  }

  private async submit(form: HTMLFormElement): Promise<void> {
    const copy = this.copy();
    const data = new FormData(form);
    const category = String(data.get("category") ?? "bug") as AtlasFeedbackCategory;
    const detail = String(data.get("message") ?? "").trim();
    if (detail.length < 20) { this.message = copy.required; this.messageKind = "error"; this.render(); return; }
    this.persistDraft();
    if (!this.identity) {
      if (!isAtlasBackendConfigured) { this.message = copy.unavailable; this.messageKind = "error"; this.render(); return; }
      await signInAtlasWithGoogle("feedback");
      return;
    }
    this.busy = true;
    this.message = "";
    this.render();
    try {
      const includeDiagnostics = data.get("include_diagnostics") === "on";
      await submitAtlasFeedback({
        category,
        message: detail,
        diagnostics: includeDiagnostics ? await this.ensureDiagnostics() : {},
        locale: this.options.getLanguage(),
        appVersion: APP_VERSION,
        mapDataVersion: MAP_DATA_VERSION
      });
      this.clearDraft();
      this.diagnostics = null;
      this.message = copy.sent;
      this.messageKind = "success";
    } catch (error) {
      this.message = atlasErrorMessage(error);
      this.messageKind = "error";
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
