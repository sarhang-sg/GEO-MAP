import type { Map as MapLibreMap } from "maplibre-gl";

type MapExperienceOptions = {
  map: MapLibreMap;
  mapShell: HTMLElement;
  lowPowerProfile: boolean;
};

export type FocusCoordinate = [number, number];

export type MapExperienceController = {
  refreshZoomVisuals: () => void;
  setFocusCoordinate: (coordinate: FocusCoordinate | null) => void;
};

const BOUNDARY_LAYER = "kri-boundary";
const BOUNDARY_HALO_LAYER = "kri-boundary-halo";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Owns premium map-only visual state. It never mutates route/GPS GeoJSON,
 * feature visibility, navigation requests or canonical application state.
 */
export function installMapExperienceController(options: MapExperienceOptions): MapExperienceController {
  const { map, mapShell, lowPowerProfile } = options;
  const reducedMotion = lowPowerProfile || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const minimumVisualIntervalMs = lowPowerProfile ? 80 : 48;
  let visualFrame: number | null = null;
  let visualTimer: number | null = null;
  let lastVisualRefreshAt = 0;
  let zoomVisualDirty = true;
  let focusVisualDirty = true;
  let boundaryIntroPlayed = false;
  const edgeIntroSurface = mapShell.querySelector<HTMLElement>(".map-edge-frame > span");
  let focusCoordinate: FocusCoordinate | null = null;
  const activeInteractions = new Set<string>();

  mapShell.classList.toggle("is-low-power-visual", lowPowerProfile);

  const setShellProperty = (property: string, value: string): void => {
    if (mapShell.style.getPropertyValue(property) !== value) mapShell.style.setProperty(property, value);
  };

  const refreshZoomVisualsNow = (): void => {
    const zoom = map.getZoom();
    const intensity = clamp01((zoom - 12.0) / 5.2);
    setShellProperty("--map-focus-intensity", intensity.toFixed(3));
    mapShell.classList.toggle("is-deep-zoom", zoom >= 12.0);
    const visualZoom = zoom.toFixed(2);
    if (mapShell.dataset.visualZoom !== visualZoom) mapShell.dataset.visualZoom = visualZoom;
  };

  const syncLocationFocusVisual = (): void => {
    if (!focusCoordinate || !Number.isFinite(focusCoordinate[0]) || !Number.isFinite(focusCoordinate[1])) {
      setShellProperty("--map-location-focus-opacity", "0");
      return;
    }

    const zoom = map.getZoom();
    const deepZoomFactor = clamp01((zoom - 11.15) / 4.4);
    if (deepZoomFactor <= 0) {
      setShellProperty("--map-location-focus-opacity", "0");
      return;
    }

    const projected = map.project(focusCoordinate);
    // MapLibre already keeps the canvas backing size current. Reading it avoids
    // clientWidth/clientHeight, which can force layout while a gesture is active.
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const canvas = map.getCanvas();
    const width = Math.max(1, canvas.width / pixelRatio);
    const height = Math.max(1, canvas.height / pixelRatio);
    const padding = 90;
    const inView = projected.x >= -padding && projected.x <= width + padding && projected.y >= -padding && projected.y <= height + padding;
    if (!inView) {
      setShellProperty("--map-location-focus-opacity", "0");
      return;
    }

    setShellProperty("--map-location-focus-x", `${((projected.x / width) * 100).toFixed(2)}%`);
    setShellProperty("--map-location-focus-y", `${((projected.y / height) * 100).toFixed(2)}%`);
    setShellProperty("--map-location-focus-opacity", deepZoomFactor.toFixed(3));
  };

  const runVisualRefresh = (): void => {
    lastVisualRefreshAt = performance.now();
    if (zoomVisualDirty) {
      zoomVisualDirty = false;
      refreshZoomVisualsNow();
    }
    if (focusVisualDirty) {
      focusVisualDirty = false;
      syncLocationFocusVisual();
    }
  };

  const scheduleVisualRefresh = (force = false): void => {
    if (document.hidden) return;
    if (force) {
      if (visualTimer !== null) window.clearTimeout(visualTimer);
      if (visualFrame !== null) window.cancelAnimationFrame(visualFrame);
      visualTimer = null;
      visualFrame = null;
    } else if (visualFrame !== null || visualTimer !== null) return;

    const elapsed = performance.now() - lastVisualRefreshAt;
    const delay = force ? 0 : Math.max(0, minimumVisualIntervalMs - elapsed);
    const requestFrame = (): void => {
      visualTimer = null;
      if (document.hidden) return;
      visualFrame = window.requestAnimationFrame(() => {
        visualFrame = null;
        runVisualRefresh();
      });
    };
    if (delay > 4) visualTimer = window.setTimeout(requestFrame, delay);
    else requestFrame();
  };

  const scheduleLocationFocusVisual = (): void => {
    focusVisualDirty = true;
    scheduleVisualRefresh();
  };

  const refreshZoomVisuals = (): void => {
    zoomVisualDirty = true;
    focusVisualDirty = true;
    scheduleVisualRefresh();
  };

  const syncInteractionClass = (): void => {
    mapShell.classList.toggle("is-map-interacting", activeInteractions.size > 0);
  };

  const beginInteraction = (kind: string, event: { originalEvent?: Event }): void => {
    // Programmatic camera moves (GPS follow/recenter, fit bounds, 3D toggle) must not
    // fade the UI. Only a real pointer/wheel/touch event owns interaction visuals.
    if (!event.originalEvent) return;
    activeInteractions.add(kind);
    syncInteractionClass();
  };

  const endInteraction = (kind: string): void => {
    activeInteractions.delete(kind);
    syncInteractionClass();
    zoomVisualDirty = true;
    focusVisualDirty = true;
    scheduleVisualRefresh(true);
  };

  const restoreBoundaryOpacity = (): void => {
    if (map.getLayer(BOUNDARY_LAYER)) map.setPaintProperty(BOUNDARY_LAYER, "line-opacity", 0.98);
    if (map.getLayer(BOUNDARY_HALO_LAYER)) {
      map.setPaintProperty(BOUNDARY_HALO_LAYER, "line-opacity", mapShell.dataset.mapMode === "satellite" ? 0.86 : 0.24);
    }
  };

  const playBoundaryIntro = (): void => {
    if (boundaryIntroPlayed) return;
    boundaryIntroPlayed = true;
    restoreBoundaryOpacity();
    if (reducedMotion) return;

    mapShell.classList.add("is-boundary-intro");
    edgeIntroSurface?.addEventListener("animationend", () => {
      mapShell.classList.remove("is-boundary-intro");
    }, { once: true });
  };

  map.on("movestart", (event) => beginInteraction("move", event as { originalEvent?: Event }));
  map.on("moveend", () => endInteraction("move"));
  map.on("zoomstart", (event) => beginInteraction("zoom", event as { originalEvent?: Event }));
  map.on("zoomend", () => endInteraction("zoom"));
  map.on("rotatestart", (event) => beginInteraction("rotate", event as { originalEvent?: Event }));
  map.on("rotateend", () => endInteraction("rotate"));
  map.on("pitchstart", (event) => beginInteraction("pitch", event as { originalEvent?: Event }));
  map.on("pitchend", () => endInteraction("pitch"));
  map.on("move", scheduleLocationFocusVisual);
  map.on("zoom", refreshZoomVisuals);
  map.on("styledata", refreshZoomVisuals);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    zoomVisualDirty = true;
    focusVisualDirty = true;
    scheduleVisualRefresh(true);
  }, { passive: true });

  if (map.loaded()) window.requestAnimationFrame(playBoundaryIntro);
  else map.once("load", () => window.requestAnimationFrame(playBoundaryIntro));

  runVisualRefresh();

  return {
    refreshZoomVisuals,
    setFocusCoordinate: (coordinate) => {
      focusCoordinate = coordinate ? [coordinate[0], coordinate[1]] : null;
      scheduleLocationFocusVisual();
    }
  };
}
