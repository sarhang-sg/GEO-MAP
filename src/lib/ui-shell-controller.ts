type PremiumShellOptions = {
  mapShell: HTMLElement;
  aboutButton: HTMLButtonElement;
  aboutDialog: HTMLElement;
  closeButtons: readonly HTMLButtonElement[];
};

export type PremiumShellController = {
  openAbout: () => void;
  closeAbout: () => void;
};

/** Owns global premium-shell interactions without touching map or feature state. */
export function installPremiumShellController(options: PremiumShellOptions): PremiumShellController {
  const { mapShell, aboutButton, aboutDialog, closeButtons } = options;
  const scrollViewport = aboutDialog.querySelector<HTMLElement>(".about-dialog__scroll");
  let previouslyFocused: HTMLElement | null = null;

  const closeAbout = (): void => {
    if (aboutDialog.hidden) return;
    aboutDialog.hidden = true;
    if (scrollViewport) scrollViewport.scrollTop = 0;
    mapShell.classList.remove("is-about-open");
    aboutButton.setAttribute("aria-expanded", "false");
    previouslyFocused?.focus({ preventScroll: true });
    previouslyFocused = null;
  };

  const openAbout = (): void => {
    if (!aboutDialog.hidden) return;
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : aboutButton;
    aboutDialog.hidden = false;
    if (scrollViewport) scrollViewport.scrollTop = 0;
    mapShell.classList.add("is-about-open");
    aboutButton.setAttribute("aria-expanded", "true");
    closeButtons[0]?.focus({ preventScroll: true });
  };

  aboutButton.addEventListener("click", openAbout);
  closeButtons.forEach((button) => button.addEventListener("click", closeAbout));
  aboutDialog.addEventListener("click", (event) => {
    if (event.target === aboutDialog) closeAbout();
  });
  document.addEventListener("keydown", (event) => {
    if (aboutDialog.hidden) return;
    if (event.key === "Escape") {
      closeAbout();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(aboutDialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hidden);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  return { openAbout, closeAbout };
}
