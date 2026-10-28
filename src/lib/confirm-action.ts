type Language = "ku" | "ar" | "en";
type Action = "remove-photo" | "delete-read" | "withdraw" | "reject";
const COPY = {
  ku: { cancel: "پاشگەزبوونەوە", confirm: "پشتڕاستکردنەوە", title: "دڵنیایت؟", "remove-photo": "وێنە هەڵبژێردراوەکە لاببرێت؟", "delete-read": "هەموو ئاگادارکردنەوە خوێندراوەکان بسڕدرێنەوە؟", withdraw: "ئەم شوێنە یان دەستکارییە بکشێنرێتەوە؟", reject: "ئەم داواکارییە ڕەت بکرێتەوە؟" },
  ar: { cancel: "إلغاء", confirm: "تأكيد", title: "هل أنت متأكد؟", "remove-photo": "إزالة الصورة المحددة؟", "delete-read": "حذف جميع الإشعارات المقروءة؟", withdraw: "سحب هذا المكان أو التعديل؟", reject: "رفض هذا الطلب؟" },
  en: { cancel: "Cancel", confirm: "Confirm", title: "Are you sure?", "remove-photo": "Remove the selected image?", "delete-read": "Delete all read notifications?", withdraw: "Withdraw this place or edit?", reject: "Reject this submission?" }
};
let pending: Promise<boolean> | null = null;

/** Missing destructive flows share a top-layer confirmation and focus handling. */
export function confirmAction(action: Action, language: Language): Promise<boolean> {
  // A second click must never inherit the approval for the first operation.
  if (pending) return Promise.resolve(false);
  const copy = COPY[language];
  const previous = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "action-confirm";
  dialog.dir = language === "en" ? "ltr" : "rtl";
  dialog.setAttribute("aria-labelledby", "actionConfirmTitle");
  dialog.setAttribute("aria-describedby", "actionConfirmMessage");
  const title = document.createElement("h3"); title.id = "actionConfirmTitle"; title.textContent = copy.title;
  const message = document.createElement("p"); message.id = "actionConfirmMessage"; message.textContent = copy[action];
  const actions = document.createElement("div");
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = copy.cancel; cancel.autofocus = true;
  const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = copy.confirm; confirm.className = "action-confirm__proceed";
  actions.append(cancel, confirm); dialog.append(title, message, actions); document.body.append(dialog);
  pending = new Promise<boolean>(resolve => {
    let settled = false;
    const finish = (approved: boolean) => {
      if (settled) return; settled = true;
      dialog.close(); dialog.remove(); pending = null;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
      resolve(approved);
    };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(false); });
    dialog.addEventListener("close", () => finish(false));
    dialog.addEventListener("click", event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) finish(false); } });
    dialog.showModal(); cancel.focus();
  });
  return pending;
}

/** Keep accessible names/tooltips while repeated utility actions use icons. */
export function compactUtilityActions(root: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
    const action = button.dataset.userAction ?? button.dataset.ownerAction ?? "";
    if (!button.querySelector("svg") || !/^(signout|delete|delete-place|delete-request|feedback-delete|notification-delete|photo-delete|photo-clear|history-delete|history-clear)$/.test(action)) continue;
    const label = button.getAttribute("aria-label") || button.textContent?.trim() || "";
    if (!label) continue;
    button.setAttribute("aria-label", label); button.title = label;
    button.classList.add("compact-utility-action");
  }
}

/** Keep a custom confirmation above its parent studio for keyboard users too. */
export function bindConfirmationKeyboard(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>('[role="alertdialog"]');
  if (!panel) { root.onkeydown = null; return; }
  for (const sibling of root.children) {
    if (sibling instanceof HTMLElement && !sibling.contains(panel)) sibling.inert = true;
  }
  const cancel = panel.querySelector<HTMLButtonElement>('button[data-owner-action="confirm-cancel"],button[data-user-action="confirm-cancel"]');
  cancel?.focus({ preventScroll: true });
  root.onkeydown = event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel?.click(); return; }
    if (event.key !== "Tab") return;
    const items = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
    if (!items.length) { event.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!panel.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    event.stopPropagation();
  };
}
