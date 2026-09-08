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
