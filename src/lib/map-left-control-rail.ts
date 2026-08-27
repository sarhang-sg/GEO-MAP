import type { Map as MapLibreMap } from "maplibre-gl";

type MapLeftControlRailOptions = {
  map: MapLibreMap;
  threeDButton: HTMLButtonElement;
  visibilityButton: HTMLButtonElement;
};

export type MapLeftControlRailController = {
  refresh: () => void;
  destroy: () => void;
};

const BLOCKED_MAP_EVENTS = [
  "pointerdown",
  "pointerup",
  "pointercancel",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "click",
  "dblclick",
  "contextmenu",
  "wheel"
] as const;

/**
 * Places the native MapLibre navigation group, the 3D control and the
 * visibility control in one normal-flow rail.
 *
 * MapLibre intentionally gives its corner containers `pointer-events: none`
 * and restores hit testing only on descendants carrying `.maplibregl-ctrl`.
 * The extra rail therefore is a real MapLibre control surface rather than an
 * arbitrary wrapper. This guarantees that touch, mouse, pen and keyboard
 * activation reach the 3D and visibility buttons on mobile and desktop.
 */
export function installMapLeftControlRail(options: MapLeftControlRailOptions): MapLeftControlRailController {
  const { map, threeDButton, visibilityButton } = options;
  const shell = map.getContainer().closest<HTMLElement>(".map-shell");
  let extras: HTMLElement | null = null;
  let frame: number | null = null;
  let retryTimer: number | null = null;
  let destroyed = false;

  const stopMapGesture = (event: Event): void => {
    event.stopPropagation();
  };

  const configureButton = (button: HTMLButtonElement): void => {
    button.type = "button";
    button.disabled = false;
    button.tabIndex = 0;
    button.style.pointerEvents = "auto";
    button.style.touchAction = "manipulation";
  };

  const configureExtras = (element: HTMLElement): void => {
    element.className = "maplibregl-ctrl map-left-control-rail__extras";
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Map view controls");
    element.style.pointerEvents = "auto";
    element.style.touchAction = "manipulation";
    for (const eventName of BLOCKED_MAP_EVENTS) {
      element.addEventListener(eventName, stopMapGesture, { passive: eventName !== "wheel" });
    }
  };

  const detachExtrasEvents = (element: HTMLElement): void => {
    for (const eventName of BLOCKED_MAP_EVENTS) {
      element.removeEventListener(eventName, stopMapGesture);
    }
  };

  const attach = (): boolean => {
    if (destroyed) return false;
    const corner = map.getContainer().querySelector<HTMLElement>(".maplibregl-ctrl-top-left");
    if (!corner) return false;

    extras = corner.querySelector<HTMLElement>(".map-left-control-rail__extras");
    if (!extras) {
      extras = document.createElement("div");
      configureExtras(extras);
      corner.append(extras);
    } else if (!extras.classList.contains("maplibregl-ctrl")) {
      detachExtrasEvents(extras);
      configureExtras(extras);
    }

    configureButton(threeDButton);
    configureButton(visibilityButton);
    if (threeDButton.parentElement !== extras) extras.append(threeDButton);
    if (visibilityButton.parentElement !== extras) extras.append(visibilityButton);

    corner.dataset.navKurdRail = "ready";
    shell?.setAttribute("data-left-control-rail", "ready");
    return true;
  };

  const refresh = (): void => {
    if (destroyed || frame !== null) return;
    frame = window.requestAnimationFrame(() => {
      frame = null;
      if (attach()) return;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        refresh();
      }, 24);
    });
  };

  refresh();
  map.on("styledata", refresh);

  return {
    refresh,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      map.off("styledata", refresh);
      if (extras) detachExtrasEvents(extras);
      extras?.remove();
      shell?.removeAttribute("data-left-control-rail");
    }
  };
}
