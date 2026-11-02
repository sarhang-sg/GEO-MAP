import type { Map as MapLibreMap } from "maplibre-gl";
type MapCameraControllerOptions = { map: MapLibreMap; button: HTMLButtonElement };
type MapWithOptionalTouchPitch = MapLibreMap & { touchPitch?: { enable: () => void } };
const ACTIVE_3D_PITCH = 52;
const ACTIVE_PITCH_THRESHOLD = 14;
const cameraModeTransitions = new WeakSet<MapLibreMap>();
/** GPS follow must not stop a user-requested tilt halfway through. */
export function isCameraModeTransition(map: MapLibreMap): boolean { return cameraModeTransitions.has(map); }
export function installMapCameraController({ map, button }: MapCameraControllerOptions): void {
  let requestedPitch: number | null = null;
  map.touchZoomRotate.enable();
  map.touchZoomRotate.enableRotation();
  (map as MapWithOptionalTouchPitch).touchPitch?.enable();
  map.dragRotate.enable();
  const syncButtonState = (): void => {
    const active = (requestedPitch ?? map.getPitch()) >= ACTIVE_PITCH_THRESHOLD;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.dataset.cameraMode = active ? "3d" : "2d";
  };
  const finishTransition = (): void => {
    requestedPitch = null;
    cameraModeTransitions.delete(map);
    syncButtonState();
  };
  const toggle = (): void => {
    const nextPitch = (requestedPitch ?? map.getPitch()) >= ACTIVE_PITCH_THRESHOLD ? 0 : ACTIVE_3D_PITCH;
    map.off("moveend", finishTransition);
    map.stop();
    requestedPitch = nextPitch;
    cameraModeTransitions.add(map);
    map.once("moveend", finishTransition);
    syncButtonState();
    map.easeTo({pitch: nextPitch, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.body.dataset.motionPreference === "reduced" ? 0 : 420});
    if (!map.isMoving()) finishTransition();
  };
  button.addEventListener("click", toggle);
  map.on("pitch", syncButtonState);
  map.on("pitchend", syncButtonState);
  map.on("style.load", syncButtonState);
  map.once("remove", () => {
    cameraModeTransitions.delete(map);
    button.removeEventListener("click", toggle);
    map.off("pitch", syncButtonState);
    map.off("pitchend", syncButtonState);
    map.off("style.load", syncButtonState);
    map.off("moveend", finishTransition);
  });
  syncButtonState();
}
