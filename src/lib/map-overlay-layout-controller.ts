import { mapNoticeStack } from "./map-notices";

type MapOverlayLayoutControllerOptions = {
  mapShell: HTMLElement;
  mapSheet: HTMLElement;
  mapActions: HTMLElement;
  getSheetCollapsed?: () => boolean;
};

export type MapOverlayLayoutController = {
  refresh: () => void;
  destroy: () => void;
};

const MOBILE_BREAKPOINT = 700;
const MOBILE_SHEET_MIN_BOTTOM = 34;
const MOBILE_SHEET_MAX_BOTTOM = 58;
const MOBILE_COLLAPSED_SHEET_HEIGHT = 116;
const MOBILE_EXPANDED_SHEET_MAX_HEIGHT = 560;
const MOBILE_EXPANDED_SHEET_VIEWPORT_RATIO = 0.72;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function viewportMetrics(): { width: number; height: number } {
  const viewport = window.visualViewport;
  const width = viewport?.width || window.innerWidth || document.documentElement.clientWidth || 1;
  const height = viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1;
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

function mobileControlSize(viewportWidth: number): number {
  if (viewportWidth <= 360) return 44;
  if (viewportWidth <= 430) return 44;
  return 46;
}

function mobileSideGap(viewportWidth: number): number {
  return Math.round(clamp(viewportWidth * 0.025, 12, 18));
}

function mobileSheetHeight(viewportHeight: number, collapsed: boolean): number {
  if (collapsed) return MOBILE_COLLAPSED_SHEET_HEIGHT;
  return Math.min(viewportHeight * MOBILE_EXPANDED_SHEET_VIEWPORT_RATIO, MOBILE_EXPANDED_SHEET_MAX_HEIGHT);
}

function setPixelProperty(element: HTMLElement, property: string, value: number): void {
  const next = `${Math.round(value)}px`;
  if (element.style.getPropertyValue(property) !== next) element.style.setProperty(property, next);
}

function removeProperties(element: HTMLElement | undefined, properties: readonly string[]): void {
  if (!element) return;
  for (const property of properties) element.style.removeProperty(property);
}

/**
 * Owns viewport-height, bottom-sheet and right-action-rail geometry.
 * Attribution is card-owned and follows the sheet in normal layout flow.
 */
export function installMapOverlayLayoutController(options: MapOverlayLayoutControllerOptions): MapOverlayLayoutController {
  const { mapShell, mapSheet, mapActions } = options;
  let frame: number | null = null;
  let destroyed = false;
  const notices = mapNoticeStack(mapShell);
  const visible = (element: HTMLElement): boolean => {
    const style = getComputedStyle(element);
    return !element.hidden && element.getClientRects().length > 0 && style.visibility !== "hidden" && Number(style.opacity) !== 0;
  };
  const tracked = new Set<Element>();
  const blockers = ".about-dialog,.user-contribution-studio,.owner-studio,.feedback-studio,.place-detail,.nav-tutorial,.offline-pack-confirm,.app-update-dialog,.android-release-promo,dialog";

  const attributionSlot = mapShell.querySelector<HTMLElement>("#mapAttributionSlot");
  const attributionHome = document.createComment("map attribution home");
  attributionSlot?.before(attributionHome);
  const layoutImageryCredit = (): void => {
    const credit = attributionSlot;
    if (!credit) return;
    const floating = !visible(mapSheet) || mapShell.classList.contains("is-map-interacting");
    if (!floating) {
      if (credit.parentElement !== attributionHome.parentElement) attributionHome.after(credit);
      credit.classList.remove("is-floating");
      credit.style.removeProperty("--nav-attribution-bottom");
      return;
    }
    if (credit.parentElement !== mapShell) mapShell.append(credit);
    credit.classList.add("is-floating");
    const shell = mapShell.getBoundingClientRect();
    const bounds = credit.getBoundingClientRect();
    // Read the CSS safe-area floor without carrying a previous panel offset.
    credit.style.removeProperty("--nav-attribution-bottom");
    let bottom = Number.parseFloat(getComputedStyle(credit).bottom) || 6;
    const panels = [...mapShell.querySelectorAll<HTMLElement>(".map-sheet,.route-panel,.route-destination-prompt")]
      .filter(visible).map(element => element.getBoundingClientRect()).sort((a, b) => b.bottom - a.bottom);
    for (const panel of panels) {
      if (panel.left < bounds.right && panel.right > bounds.left && panel.bottom > shell.bottom - bottom - bounds.height - 4
        && panel.top < shell.bottom - bottom) bottom = shell.bottom - panel.top + 22;
    }
    setPixelProperty(credit, "--nav-attribution-bottom", bottom);
  };

  const layoutNotices = (height: number): void => {
    const blocked = [...document.querySelectorAll<HTMLElement>(blockers)].some(element =>
      visible(element) && (element.tagName !== "DIALOG" || element.hasAttribute("open")) && !element.classList.contains("is-minimized"));
    if (notices.dataset.blocked !== String(blocked)) {
      notices.dataset.blocked = String(blocked);
      window.dispatchEvent(new CustomEvent("nav-kurd:notices-blocked", { detail: blocked }));
    }
    const shell = mapShell.getBoundingClientRect();
    const bounds = notices.getBoundingClientRect();
    const intersects = (rect: DOMRect): boolean => rect.left < bounds.right && rect.right > bounds.left;
    let bottom = Math.max(12, Number.parseFloat(getComputedStyle(mapShell).getPropertyValue("--native-safe-bottom")) || 0);
    let top = 16;
    for (const element of mapShell.querySelectorAll<HTMLElement>(".map-sheet,.route-panel,.route-destination-prompt")) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (intersects(rect)) bottom = Math.max(bottom, shell.bottom - rect.top + 10);
    }
    for (const element of mapShell.querySelectorAll<HTMLElement>(".topbar,.search-card,.route-navigation-hud")) {
      if (!visible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (intersects(rect)) top = Math.max(top, rect.bottom - shell.top + 10);
    }
    setPixelProperty(mapShell, "--nav-kurd-notice-bottom", bottom);
    setPixelProperty(mapShell, "--nav-kurd-notice-max-height", Math.max(0, Math.min(height, shell.height) - top - bottom));
    if (!blocked && [...notices.children].some(element => !element.hasAttribute("hidden"))) {
      const rail = mapActions.getBoundingClientRect();
      const notice = notices.getBoundingClientRect();
      if (rail.left < notice.right && rail.right > notice.left) {
        const current = Number.parseFloat(mapShell.style.getPropertyValue("--nav-kurd-actions-max-height"));
        setPixelProperty(mapShell, "--nav-kurd-actions-max-height", Math.max(44, Math.min(current, notice.top - rail.top - 10)));
      }
    }
  };

  const refreshNow = (): void => {
    if (destroyed || document.hidden) return;
    const viewport = viewportMetrics();
    const isMobile = viewport.width <= MOBILE_BREAKPOINT;
    setPixelProperty(mapShell, "--nav-kurd-visual-viewport-height", viewport.height);
    mapShell.dataset.visualViewportMeasured = "true";

    if (isMobile) {
      const controlSize = mobileControlSize(viewport.width);
      const sideGap = mobileSideGap(viewport.width);
      const sheetBottom = clamp(viewport.height * 0.045, MOBILE_SHEET_MIN_BOTTOM, MOBILE_SHEET_MAX_BOTTOM);
      const collapsed = options.getSheetCollapsed?.() === true;
      const sheetHeight = mobileSheetHeight(viewport.height, collapsed);
      const collapsedSheetBottom = clamp(sheetBottom + 8, 42, 66);
      const actionsTop = viewport.height <= 700 ? 116 : 128;
      const actionRailHeight = Math.max(154, viewport.height - actionsTop - sheetHeight - 20);
      setPixelProperty(mapShell, "--nav-kurd-mobile-control-size", controlSize);
      setPixelProperty(mapShell, "--nav-kurd-mobile-side-gap", sideGap);
      setPixelProperty(mapShell, "--nav-kurd-sheet-bottom", sheetBottom);
      setPixelProperty(mapShell, "--nav-kurd-sheet-collapsed-bottom", collapsedSheetBottom);
      setPixelProperty(mapShell, "--nav-kurd-sheet-visibility-lift", 0);
      setPixelProperty(mapShell, "--nav-kurd-actions-max-height", actionRailHeight);
      mapActions.classList.add("is-sheet-bounded");
    } else {
      removeProperties(mapShell, [
        "--nav-kurd-mobile-control-size", "--nav-kurd-mobile-side-gap", "--nav-kurd-actions-max-height",
        "--nav-kurd-sheet-bottom", "--nav-kurd-sheet-collapsed-bottom", "--nav-kurd-sheet-visibility-lift"
      ]);
      // Desktop sheets grow with translated text and accessibility fonts too.
      // Measure only on layout changes, never on map render/zoom frames.
      const rail = mapActions.getBoundingClientRect();
      const sheet = mapSheet.getBoundingClientRect();
      const overlaps = sheet.width > 0 && sheet.height > 0 && sheet.left < rail.right && sheet.right > rail.left;
      const bottom = overlaps ? Math.min(viewport.height - 16, sheet.top - 12) : viewport.height - 16;
      setPixelProperty(mapShell, "--nav-kurd-actions-max-height", Math.max(88, bottom - rail.top));
      mapActions.classList.add("is-sheet-bounded");
    }
    layoutImageryCredit();
    layoutNotices(viewport.height);
  };

  const refresh = (): void => {
    if (destroyed || document.hidden || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      refreshNow();
    });
  };

  const onViewportChange = (): void => refresh();
  const onSheetTransition = (): void => refresh();

  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("orientationchange", onViewportChange, { passive: true });
  window.addEventListener("pageshow", onViewportChange, { passive: true });
  window.visualViewport?.addEventListener("resize", onViewportChange, { passive: true });
  window.visualViewport?.addEventListener("scroll", onViewportChange, { passive: true });
  mapSheet.addEventListener("transitionrun", onSheetTransition, { passive: true });
  mapSheet.addEventListener("transitionend", onSheetTransition, { passive: true });
  const sizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
  sizeObserver?.observe(mapSheet);
  sizeObserver?.observe(notices);
  const surfaceObserver = new MutationObserver(refresh);
  const trackSurfaces = (): void => {
    for (const element of tracked) {
      if (!element.isConnected) {
        tracked.delete(element); sizeObserver?.unobserve(element);
        element.removeEventListener("transitionend", refresh);
        element.removeEventListener("animationend", refresh);
      }
    }
    for (const element of document.querySelectorAll(`${blockers},.map-sheet,.route-panel,.route-destination-prompt,.route-navigation-hud,.search-card,#mapAttributionSlot`)) {
      if (tracked.has(element)) continue;
      tracked.add(element);
      element.addEventListener("transitionend", refresh);
      element.addEventListener("animationend", refresh);
      surfaceObserver.observe(element, { attributes: true, attributeFilter: ["hidden", "open", "class"] });
      if (element instanceof HTMLElement) sizeObserver?.observe(element);
    }
    refresh();
  };
  surfaceObserver.observe(mapShell, { attributes: true, attributeFilter: ["class"] });
  surfaceObserver.observe(notices, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  const childrenObserver = new MutationObserver(trackSurfaces);
  childrenObserver.observe(mapShell, { childList: true });
  childrenObserver.observe(document.body, { childList: true });
  trackSurfaces();
  window.addEventListener("nav-kurd:appearance-change", onViewportChange);
  refresh();

  return {
    refresh,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      window.removeEventListener("pageshow", onViewportChange);
      window.visualViewport?.removeEventListener("resize", onViewportChange);
      window.visualViewport?.removeEventListener("scroll", onViewportChange);
      mapSheet.removeEventListener("transitionrun", onSheetTransition);
      mapSheet.removeEventListener("transitionend", onSheetTransition);
      sizeObserver?.disconnect();
      surfaceObserver.disconnect(); childrenObserver.disconnect();
      for (const element of tracked) {
        element.removeEventListener("transitionend", refresh);
        element.removeEventListener("animationend", refresh);
      }
      tracked.clear();
      window.removeEventListener("nav-kurd:appearance-change", onViewportChange);
      removeProperties(mapShell, [
        "--nav-kurd-visual-viewport-height", "--nav-kurd-mobile-control-size", "--nav-kurd-mobile-side-gap",
        "--nav-kurd-actions-max-height", "--nav-kurd-sheet-bottom", "--nav-kurd-sheet-collapsed-bottom",
        "--nav-kurd-sheet-visibility-lift", "--nav-kurd-notice-bottom", "--nav-kurd-notice-max-height"
      ]);
      if (attributionSlot && attributionHome.parentNode) {
        attributionHome.after(attributionSlot);
        attributionSlot.classList.remove("is-floating");
        attributionSlot.style.removeProperty("--nav-attribution-bottom");
      }
      attributionHome.remove();
      delete mapShell.dataset.visualViewportMeasured;
      mapActions.classList.remove("is-sheet-bounded");
    }
  };
}
