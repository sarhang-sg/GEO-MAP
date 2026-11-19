import type { Map as MapLibreMap, Popup } from "maplibre-gl";

const visibleBounds = (element: Element): DOMRect | null => {
  const style = getComputedStyle(element), rect = element.getBoundingClientRect();
  return rect.width && rect.height && style.visibility !== "hidden" && Number(style.opacity) !== 0 ? rect : null;
};

/** Keep the geographic anchor, while fitting the card between map controls. */
export function keepPlacePopupClear(map: MapLibreMap, popup: Popup): void {
  const element = popup.getElement(), container = map.getContainer();
  const shell = container.closest<HTMLElement>(".map-shell") ?? container;
  let frame = 0, disposed = false, dx = 0, dy = 0, boundsDirty = true;
  let safe = { left: 0, right: 0, top: 0, bottom: 0, surfaces: [] as DOMRect[] };
  const controls = ".topbar,.feedback-quick-button,.maplibregl-ctrl-top-left,.map-left-control-rail,.map-actions,.map-sheet,.route-panel,.route-destination-prompt,.route-navigation-hud";
  const measureControls = (): void => {
    const rect = container.getBoundingClientRect(), viewport = window.visualViewport;
    const viewTop = viewport?.offsetTop ?? 0, viewLeft = viewport?.offsetLeft ?? 0;
    safe = {
      left: Math.max(rect.left, viewLeft) + 10,
      right: Math.min(rect.right, viewLeft + (viewport?.width ?? innerWidth)) - 10,
      top: Math.max(rect.top, viewTop) + 10,
      bottom: Math.min(rect.bottom, viewTop + (viewport?.height ?? innerHeight)) - 10,
      surfaces: []
    };
    for (const control of shell.querySelectorAll(controls)) {
      const box = visibleBounds(control);
      if (!box) continue;
      if (control.matches(".topbar,.feedback-quick-button,.route-navigation-hud")) safe.top = Math.max(safe.top, box.bottom + 8);
      else if (control.matches(".maplibregl-ctrl-top-left,.map-left-control-rail")) safe.left = Math.max(safe.left, box.right + 8);
      else if (control.matches(".map-actions")) safe.right = Math.min(safe.right, box.left - 8);
      else safe.surfaces.push(box);
    }
    boundsDirty = false;
  };
  const layout = (): void => {
    frame = 0;
    if (disposed || !element.isConnected) return;
    if (boundsDirty) measureControls();
    // Read before writes. Cached control bounds avoid per-frame style/layout
    // queries while dragging; ResizeObserver schedules a second size pass.
    const card = element.getBoundingClientRect(), width = Math.max(140, Math.min(280, safe.right - safe.left));
    const baseX = card.left - dx, baseY = card.top - dy;
    const x = Math.max(safe.left, Math.min(baseX, safe.right - width));
    let bottom = safe.bottom;
    for (const box of safe.surfaces) if (box.left < x + width && box.right > x) bottom = Math.min(bottom, box.top - 8);
    const maxHeight = Math.max(68, Math.min(420, bottom - safe.top - 12));
    const y = Math.max(safe.top, Math.min(baseY, bottom - Math.min(card.height, maxHeight + 12)));
    dx = x - baseX; dy = y - baseY;
    const set = (key: string, value: string): void => { if (element.style.getPropertyValue(key) !== value) element.style.setProperty(key, value); };
    set("--place-popup-width", `${width}px`); set("--place-popup-max-height", `${maxHeight}px`);
    set("translate", `${dx}px ${dy}px`);
    element.dataset.shifted = String(Math.abs(dx) > 1 || Math.abs(dy) > 1);
  };
  const refresh = (): void => { if (!disposed && !frame) frame = requestAnimationFrame(layout); };
  const invalidate = (): void => { boundsDirty = true; refresh(); };
  const cardObserver = new ResizeObserver(refresh), controlsObserver = new ResizeObserver(invalidate);
  cardObserver.observe(element); controlsObserver.observe(container);
  const state = new MutationObserver(invalidate);
  state.observe(shell, { attributes: true, attributeFilter: ["class", "data-map-mode"] });
  for (const control of shell.querySelectorAll(controls)) {
    controlsObserver.observe(control);
    state.observe(control, { attributes: true, attributeFilter: ["class", "style", "hidden"] });
  }
  map.on("move", refresh); map.on("resize", invalidate);
  window.visualViewport?.addEventListener("resize", invalidate);
  window.visualViewport?.addEventListener("scroll", invalidate);
  window.addEventListener("nav-kurd:appearance-change", invalidate);
  const dispose = (): void => {
    disposed = true; cancelAnimationFrame(frame); cardObserver.disconnect(); controlsObserver.disconnect(); state.disconnect();
    map.off("move", refresh); map.off("resize", invalidate); map.off("remove", dispose);
    window.visualViewport?.removeEventListener("resize", invalidate);
    window.visualViewport?.removeEventListener("scroll", invalidate);
    window.removeEventListener("nav-kurd:appearance-change", invalidate);
  };
  popup.on("close", dispose); map.on("remove", dispose); refresh();
}
