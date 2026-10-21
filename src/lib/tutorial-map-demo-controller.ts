import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { MapMode } from "./types";

export type TutorialMapDemoController = {
  showPinDemo: () => void;
  startModes3dDemo: (onFocusTarget: (selector: string) => void) => void;
  cleanup: () => Promise<void>;
};

type TutorialMapDemoOptions = {
  map: MapLibreMap;
  getMapMode: () => MapMode;
  setMapMode: (mode: MapMode) => Promise<void>;
  satelliteEnabled: boolean;
};

const ACTIVE_3D_PITCH = 52;
const ACTIVE_PITCH_THRESHOLD = 14;
const MODE_VISIBLE_MS = 920;
const SATELLITE_VISIBLE_MS = 1_180;
const MODE_RESTORE_SETTLE_MS = 320;
const THREE_D_SETTLE_MS = 720;
const MAP_IDLE_TIMEOUT_MS = 1_800;

export function installTutorialMapDemoController(options: TutorialMapDemoOptions): TutorialMapDemoController {
  const { map, getMapMode, setMapMode, satelliteEnabled } = options;
  const pendingTimers = new Map<number, () => void>();
  let serial = 0;
  let demoPin: Marker | null = null;
  let originalMode: MapMode | null = null;
  let originalPitch: number | null = null;
  let cleanupQueue: Promise<void> = Promise.resolve();

  const pause = (milliseconds: number, expectedSerial: number): Promise<boolean> => new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      pendingTimers.delete(timer);
      resolve(expectedSerial === serial);
    }, milliseconds);
    pendingTimers.set(timer, () => resolve(false));
  });

  const clearTimers = (): void => {
    pendingTimers.forEach((resolve, timer) => {
      window.clearTimeout(timer);
      resolve();
    });
    pendingTimers.clear();
  };

  const waitForMapSettle = (expectedSerial: number): Promise<boolean> => new Promise((resolve) => {
    if (expectedSerial !== serial) { resolve(false); return; }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      map.off("idle", finish);
      window.clearTimeout(timer);
      resolve(expectedSerial === serial);
    };
    const timer = window.setTimeout(finish, MAP_IDLE_TIMEOUT_MS);
    map.once("idle", finish);
    if (map.loaded() && map.areTilesLoaded()) window.requestAnimationFrame(finish);
    map.triggerRepaint();
  });

  const clearModeFocus = (): void => {
    document.querySelectorAll<HTMLElement>("[data-map-mode].is-tutorial-demo-focus")
      .forEach((element) => element.classList.remove("is-tutorial-demo-focus"));
  };

  const focusMode = (mode: MapMode): void => {
    clearModeFocus();
    document.querySelector<HTMLElement>(`[data-map-mode="${mode}"]`)?.classList.add("is-tutorial-demo-focus");
  };

  const removePin = (): void => {
    demoPin?.remove();
    demoPin = null;
  };

  const showPinDemo = (): void => {
    removePin();
    const canvas = map.getCanvas();
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const demoPoint = map.unproject([
      Math.round(width * 0.48),
      Math.round(Math.min(height * 0.48, Math.max(170, height * 0.38)))
    ]);
    const element = document.createElement("div");
    element.className = "nav-tutorial-demo-pin";
    element.setAttribute("aria-hidden", "true");
    element.innerHTML = '<span class="nav-tutorial-demo-pin__pulse"></span><span class="nav-tutorial-demo-pin__body"><span></span></span>';
    demoPin = new maplibregl.Marker({ element, anchor: "bottom" }).setLngLat(demoPoint).addTo(map);
  };

  const restoreModeAndPitch = async (modeToRestore: MapMode | null, pitchToRestore: number | null): Promise<void> => {
    clearModeFocus();
    if (modeToRestore && getMapMode() !== modeToRestore) {
      try { await setMapMode(modeToRestore); } catch { /* Keep the usable current style. */ }
    }
    if (pitchToRestore !== null && Math.abs(map.getPitch() - pitchToRestore) > 0.5) {
      map.stop();
      map.easeTo({ pitch: pitchToRestore, duration: 360, essential: true });
    }
  };

  const cleanup = (): Promise<void> => {
    serial += 1;
    clearTimers();
    removePin();
    const modeToRestore = originalMode;
    const pitchToRestore = originalPitch;
    originalMode = null;
    originalPitch = null;
    const task = cleanupQueue.then(() => restoreModeAndPitch(modeToRestore, pitchToRestore));
    cleanupQueue = task.catch(() => undefined);
    return task;
  };

  const switchMode = async (mode: MapMode, localSerial: number): Promise<boolean> => {
    if (localSerial !== serial) return false;
    focusMode(mode);
    try {
      await setMapMode(mode);
      if (!(await waitForMapSettle(localSerial))) return false;
    } catch {
      // A temporarily unavailable satellite endpoint must not break the tutorial.
      if (mode !== "satellite") return false;
    }
    return pause(mode === "satellite" ? SATELLITE_VISIBLE_MS : MODE_VISIBLE_MS, localSerial);
  };

  const runModes3dDemo = async (onFocusTarget: (selector: string) => void): Promise<void> => {
    await cleanup();
    const localSerial = ++serial;
    originalMode = getMapMode();
    originalPitch = map.getPitch();

    const modes: MapMode[] = ["street", "night"];
    if (satelliteEnabled && navigator.onLine !== false) modes.push("satellite");

    onFocusTarget(".style-picker");
    for (const mode of modes) {
      if (!(await switchMode(mode, localSerial))) return;
    }

    clearModeFocus();
    if (originalMode && getMapMode() !== originalMode) {
      try {
        await setMapMode(originalMode);
        if (!(await waitForMapSettle(localSerial))) return;
        if (!(await pause(MODE_RESTORE_SETTLE_MS, localSerial))) return;
      } catch { /* The app remains on the last usable mode. */ }
    }

    onFocusTarget("#threeDButton");
    const currentPitch = map.getPitch();
    if (currentPitch >= ACTIVE_PITCH_THRESHOLD) {
      map.stop();
      map.easeTo({ pitch: 0, duration: 260, essential: true });
      if (!(await pause(320, localSerial))) return;
    }
    map.stop();
    map.easeTo({ pitch: ACTIVE_3D_PITCH, duration: 460, essential: true });
    await pause(THREE_D_SETTLE_MS, localSerial);
  };

  return {
    showPinDemo,
    startModes3dDemo: (onFocusTarget) => { void runModes3dDemo(onFocusTarget); },
    cleanup
  };
}
