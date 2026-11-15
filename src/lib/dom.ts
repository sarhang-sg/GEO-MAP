function editableElement(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof HTMLElement ? target : null;
  return element?.closest<HTMLElement>('input, textarea, select, [contenteditable="true"], [data-text-selectable="true"]') ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const element = editableElement(target);
  if (!element) return false;
  if (element instanceof HTMLInputElement) {
    const nonTextInputTypes = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);
    return !nonTextInputTypes.has(element.type.toLocaleLowerCase("en-US"));
  }
  return !(element instanceof HTMLSelectElement);
}

export function installSelectionAndImageLocks(): void {
  const protectedSelector = ".map-shell, .place-detail, .owner-studio, .user-contribution-studio, .feedback-studio";
  document.addEventListener("contextmenu", (event) => {
    // Mobile browsers expose copy/paste/select through the long-press context
    // menu. Never suppress that menu for an editable field.
    if (isEditableTarget(event.target)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(protectedSelector)) event.preventDefault();
  }, { capture: true });
  document.addEventListener("dragstart", (event) => {
    if (isEditableTarget(event.target)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest(protectedSelector)) event.preventDefault();
  }, { capture: true });
  document.addEventListener("selectstart", (event) => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  }, { capture: true });
}

export function query<T extends Element>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

/** Keep measurements together inside sentences in all three writing directions. */
export function measurement(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.dir = "ltr"; span.className = "measurement"; span.textContent = text;
  return span;
}

export function setMeasuredText(element: HTMLElement, text: string): void {
  const parts = text.split(/([+−-]?[\p{Nd}]+(?:[.,٫][\p{Nd}]+)?\s*(?:km\/h|µg\/m³|km|m|min|h|°C|°|%)(?![\p{L}]))/gu);
  element.replaceChildren(...parts.map((part,index) => index % 2 ? measurement(part) : part));
}

export function historyDate(value: string, lang: "ku" | "ar" | "en"): string {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "";
  if (lang !== "ku") return new Intl.DateTimeFormat(lang==="ar"?"ar-IQ":"en-GB",{dateStyle:"medium",timeStyle:"short"}).format(date);
  const months=["کانوونی دووەم","شوبات","ئادار","نیسان","ئایار","حوزەیران","تەمموز","ئاب","ئەیلوول","تشرینی یەکەم","تشرینی دووەم","کانوونی یەکەم"];
  const digits = new Intl.NumberFormat("ar-IQ-u-nu-arab",{useGrouping:false});
  const time = new Intl.DateTimeFormat("ar-IQ-u-nu-arab",{hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(date);
  return `${digits.format(date.getDate())}ی ${months[date.getMonth()]}ی ${digits.format(date.getFullYear())} · ${time}`;
}
