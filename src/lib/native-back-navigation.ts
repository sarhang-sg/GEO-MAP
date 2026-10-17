declare global {
  interface Window { __navKurdHandleBack?: () => boolean; }
}

// Use each surface's existing Cancel/Close action so drafts, nested confirmation
// state and focus follow the same path as a tap. Android Back owns one surface.
const surfaces = [
  [".user-confirm", 'button[data-user-action="confirm-cancel"]'],
  [".owner-confirm", 'button[data-owner-action="confirm-cancel"]'],
  [".offline-pack-confirm", 'button[data-offline-pack-confirm="cancel"]'],
  [".map-coordinate-picker", "button[data-coordinate-picker-cancel]"],
  [".feedback-studio", 'button[data-feedback-action="close"]'],
  [".owner-studio", 'button[data-owner-action="close"]'],
  [".user-contribution-studio", 'button[data-user-action="close"]'],
  [".about-dialog", "#aboutCloseButton"],
  [".nav-tutorial:not(.is-minimized)", 'button[data-tutorial-action="skip"]'],
] as const;

function visible(element: HTMLElement): boolean {
  return !element.closest("[hidden], [inert]") && element.getClientRects().length > 0;
}

export function handleNativeBack(): boolean {
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
  const dialog = dialogs.at(-1);
  if (dialog) {
    // Match Escape, including a prevented cancel while a save is in progress.
    if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
    return true;
  }
  for (const [selector, closeSelector] of surfaces) {
    const surface = [...document.querySelectorAll<HTMLElement>(selector)].find(visible);
    if (!surface) continue;
    const button = surface.querySelector<HTMLButtonElement>(closeSelector);
    if (button && !button.disabled) button.click();
    return true;
  }
  return false;
}

export function installNativeBackNavigation(): void {
  window.__navKurdHandleBack = handleNativeBack;
  window.addEventListener("beforeunload", () => { delete window.__navKurdHandleBack; }, { once: true });
}
