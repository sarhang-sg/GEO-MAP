import type { Language, MapMode } from "./types";
import type { LngLatTuple } from "./location";

export type AppLifecycleSnapshot = {
  schema: 1;
  savedAt: number;
  camera: {
    center: LngLatTuple;
    zoom: number;
    bearing: number;
    pitch: number;
  };
  language: Language;
  mapMode: MapMode;
  sheetCollapsed: boolean;
  basemapVisible: boolean;
  administrativeVisible: boolean;
  placesVisible: boolean;
  controlsHidden: boolean;
};

type AppLifecycleControllerOptions = {
  capture: () => AppLifecycleSnapshot;
  onSuspend?: () => void;
  onResume?: (context: { hiddenForMs: number; restoredFromPageCache: boolean }) => void;
};

export type AppLifecycleController = {
  persist: () => void;
  destroy: () => void;
};

const STORAGE_KEY = "nav-kurd:app-session";
const MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LANGUAGES = new Set<Language>(["ku", "ar", "en"]);
const MAP_MODES = new Set<MapMode>(["street", "satellite"]);

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validSnapshot(value: unknown): value is AppLifecycleSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<AppLifecycleSnapshot>;
  const camera = snapshot.camera;
  return snapshot.schema === 1
    && finiteNumber(snapshot.savedAt)
    && Date.now() - snapshot.savedAt <= MAX_SNAPSHOT_AGE_MS
    && Boolean(camera)
    && Array.isArray(camera?.center)
    && camera.center.length === 2
    && finiteNumber(camera.center[0])
    && finiteNumber(camera.center[1])
    && camera.center[0] >= -180
    && camera.center[0] <= 180
    && camera.center[1] >= -90
    && camera.center[1] <= 90
    && finiteNumber(camera.zoom)
    && finiteNumber(camera.bearing)
    && finiteNumber(camera.pitch)
    && LANGUAGES.has(snapshot.language as Language)
    && MAP_MODES.has(snapshot.mapMode as MapMode)
    && typeof snapshot.sheetCollapsed === "boolean"
    && typeof snapshot.basemapVisible === "boolean"
    && typeof snapshot.administrativeVisible === "boolean"
    && typeof snapshot.placesVisible === "boolean"
    && typeof snapshot.controlsHidden === "boolean";
}

export function readAppLifecycleSnapshot(): AppLifecycleSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (validSnapshot(parsed)) return parsed;
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing and hardened storage policies may block sessionStorage.
  }
  return null;
}

export function installAppLifecycleController(options: AppLifecycleControllerOptions): AppLifecycleController {
  let hiddenAt = document.hidden ? Date.now() : 0;
  let destroyed = false;
  let resumeFrame: number | null = null;

  const persist = (): void => {
    if (destroyed) return;
    try {
      const snapshot = options.capture();
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, schema: 1, savedAt: Date.now() }));
    } catch {
      // Runtime state remains valid in memory when storage is unavailable.
    }
  };

  const suspend = (): void => {
    if (destroyed) return;
    if (!hiddenAt) hiddenAt = Date.now();
    persist();
    options.onSuspend?.();
  };

  const resume = (restoredFromPageCache: boolean): void => {
    if (destroyed || document.hidden) return;
    const hiddenForMs = hiddenAt ? Math.max(0, Date.now() - hiddenAt) : 0;
    hiddenAt = 0;
    if (resumeFrame !== null) window.cancelAnimationFrame(resumeFrame);
    resumeFrame = window.requestAnimationFrame(() => {
      resumeFrame = null;
      options.onResume?.({ hiddenForMs, restoredFromPageCache });
    });
  };

  const onVisibilityChange = (): void => {
    if (document.hidden) suspend();
    else resume(false);
  };
  const onPageHide = (): void => suspend();
  const onPageShow = (event: PageTransitionEvent): void => resume(event.persisted);
  const onFreeze = (): void => suspend();
  const onResume = (): void => resume(false);

  document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
  window.addEventListener("pagehide", onPageHide, { passive: true });
  window.addEventListener("pageshow", onPageShow, { passive: true });
  document.addEventListener("freeze", onFreeze, { passive: true });
  document.addEventListener("resume", onResume, { passive: true });

  return {
    persist,
    destroy: () => {
      if (destroyed) return;
      persist();
      destroyed = true;
      if (resumeFrame !== null) window.cancelAnimationFrame(resumeFrame);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("freeze", onFreeze);
      document.removeEventListener("resume", onResume);
    }
  };
}
