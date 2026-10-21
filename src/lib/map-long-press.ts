export type MapHoldPoint = { x: number; y: number };

type MapHoldOptions = {
  isEnabled: () => boolean;
  onHold: (point: MapHoldPoint) => void;
  suppressClickUntil: (time: number) => void;
};

const HOLD_MS = 560;
const MOVE_PX = 12;
const CLICK_GUARD_MS = 750;

/** A single hold recognizer shared by mobile WebView, browser and mouse. */
export function installMapLongPress(canvas: HTMLElement, options: MapHoldOptions): void {
  let timer: number | null = null;
  let start: (MapHoldPoint & { id: number; fired: boolean }) | null = null;
  let lastHoldAt = -Infinity;
  const pointers = new Set<number>();
  const suppressClick = () => options.suppressClickUntil(performance.now() + CLICK_GUARD_MS);
  const cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    // Guard from RELEASE, not only from the timer: a finger may stay down for
    // seconds after opening the prompt. Its eventual click must not close it.
    if (start?.fired) suppressClick();
    start = null;
  };
  const fire = (point: MapHoldPoint) => {
    if (!options.isEnabled()) return;
    lastHoldAt = performance.now();
    suppressClick();
    options.onHold(point);
  };
  const begin = (id: number, x: number, y: number) => {
    cancel();
    if (!options.isEnabled()) return;
    start = { id, x, y, fired: false };
    timer = window.setTimeout(() => {
      timer = null;
      if (!start || !options.isEnabled()) { cancel(); return; }
      start.fired = true;
      fire(start);
    }, HOLD_MS);
  };
  const move = (id: number, x: number, y: number) => {
    if (start?.id === id && Math.hypot(x - start.x, y - start.y) > MOVE_PX) cancel();
  };

  if (typeof window.PointerEvent === "function") {
    canvas.addEventListener("pointerdown", (event) => {
      pointers.add(event.pointerId);
      if (!event.isPrimary || pointers.size > 1) { cancel(); return; }
      if (event.button === 0) begin(event.pointerId, event.clientX, event.clientY);
    }, { capture: true, passive: true });
    window.addEventListener("pointermove", (event) => move(event.pointerId, event.clientX, event.clientY), { passive: true });
    const end = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (start?.id === event.pointerId) cancel();
    };
    window.addEventListener("pointerup", end, { capture: true, passive: true });
    window.addEventListener("pointercancel", end, { capture: true, passive: true });
    canvas.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") end(event);
    }, { passive: true });
  } else {
    canvas.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = event.touches[0];
      begin(touch.identifier, touch.clientX, touch.clientY);
    }, { capture: true, passive: true });
    canvas.addEventListener("touchmove", (event) => {
      if (event.touches.length !== 1) { cancel(); return; }
      const touch = event.touches[0];
      move(touch.identifier, touch.clientX, touch.clientY);
    }, { passive: true });
    window.addEventListener("touchend", cancel, { capture: true, passive: true });
    window.addEventListener("touchcancel", cancel, { capture: true, passive: true });
  }
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    // Android may emit contextmenu before or after the hold timer.
    if (start?.fired || performance.now() - lastHoldAt < CLICK_GUARD_MS) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    if (start) start.fired = true;
    fire({ x: event.clientX, y: event.clientY });
  }, { capture: true });
  window.addEventListener("blur", () => { cancel(); pointers.clear(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancel(); pointers.clear(); }
  });
}
