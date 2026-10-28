import type { Map as MapLibreMap } from "maplibre-gl";

/** Keep multitouch inside the map instead of magnifying the entire document. */
export function installMapTouchGuard(map: MapLibreMap, shell: HTMLElement): () => void {
  const handlers = [map.dragPan, map.touchZoomRotate, map.touchPitch];
  let suspended: boolean[] | null = null;
  let multi = false;
  let suppressClickUntil = 0;
  const inside = (event: Event): boolean => event.target instanceof Node && shell.contains(event.target);
  const restore = (): void => {
    if (!suspended) return;
    handlers.forEach((handler, index) => { if (suspended![index]) handler.enable(); });
    suspended = null;
  };
  const handle = (event: TouchEvent): void => {
    if (!inside(event) && !multi) return;
    const count = event.touches.length;
    if (count > 1) { multi = true; suppressClickUntil = Date.now() + 400; }
    if (multi && event.cancelable) event.preventDefault();
    if (count > 2 && !suspended) {
      suspended = handlers.map(handler => handler.isEnabled());
      map.stop();
      handlers.forEach(handler => handler.disable());
    }
    // Keep 3/4-finger gestures quarantined until every finger is lifted.
    // Restoring midway would reuse an old centroid and jump the camera.
    if (suspended) event.stopImmediatePropagation();
    if (count === 0) {
      if (multi) suppressClickUntil = Date.now() + 400;
      multi = false;
      restore();
    }
  };
  const click = (event: MouseEvent): void => {
    if (event.detail > 0 && inside(event) && (multi || Date.now() < suppressClickUntil)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const gesture = (event: Event): void => { if (inside(event) && event.cancelable) event.preventDefault(); };
  const events = ["touchstart", "touchmove", "touchend", "touchcancel"] as const;
  for (const type of events) document.addEventListener(type, handle, { capture: true, passive: false });
  document.addEventListener("click", click, true);
  document.addEventListener("gesturestart", gesture, { capture: true, passive: false });
  document.addEventListener("gesturechange", gesture, { capture: true, passive: false });
  const reset = (): void => { multi = false; restore(); };
  window.addEventListener("blur", reset);
  const cleanup = (): void => {
    reset();
    for (const type of events) document.removeEventListener(type, handle, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("gesturestart", gesture, true);
    document.removeEventListener("gesturechange", gesture, true);
    window.removeEventListener("blur", reset);
  };
  map.on("remove", cleanup);
  return cleanup;
}
