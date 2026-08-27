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
  if (viewportWidth <= 360) return 42;
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
      mapActions.classList.remove("is-sheet-bounded");
    }
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
      removeProperties(mapShell, [
        "--nav-kurd-visual-viewport-height", "--nav-kurd-mobile-control-size", "--nav-kurd-mobile-side-gap",
        "--nav-kurd-actions-max-height", "--nav-kurd-sheet-bottom", "--nav-kurd-sheet-collapsed-bottom",
        "--nav-kurd-sheet-visibility-lift"
      ]);
      delete mapShell.dataset.visualViewportMeasured;
      mapActions.classList.remove("is-sheet-bounded");
    }
  };
}
