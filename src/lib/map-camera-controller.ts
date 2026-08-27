import type { Map as MapLibreMap } from "maplibre-gl";

type MapCameraControllerOptions = {
  map: MapLibreMap;
  button: HTMLButtonElement;
};

type MapWithOptionalTouchPitch = MapLibreMap & {
  touchPitch?: { enable: () => void };
};

const ACTIVE_3D_PITCH = 52;
const ACTIVE_PITCH_THRESHOLD = 14;

/**
 * Owns user camera gestures and the dedicated 2D/3D control.
 *
 * This controller does not touch GPS, routes, POI data or map style state. It
 * only configures the MapLibre camera so two-finger rotate/pitch works and a
 * deterministic left-side 3D button can toggle the pitch without duplicating
 * camera state elsewhere in the application.
 */
export function installMapCameraController(options: MapCameraControllerOptions): void {
  const { map, button } = options;

  map.touchZoomRotate.enable();
  map.touchZoomRotate.enableRotation();
  (map as MapWithOptionalTouchPitch).touchPitch?.enable();
  map.dragRotate.enable();

  const syncButtonState = (): void => {
    const active = map.getPitch() >= ACTIVE_PITCH_THRESHOLD;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.dataset.cameraMode = active ? "3d" : "2d";
  };

  button.addEventListener("click", () => {
    const nextPitch = map.getPitch() >= ACTIVE_PITCH_THRESHOLD ? 0 : ACTIVE_3D_PITCH;
    map.stop();
    map.easeTo({
      pitch: nextPitch,
      duration: 420,
      essential: true
    });
  });

  map.on("pitch", syncButtonState);
  map.on("pitchend", syncButtonState);
  map.on("style.load", syncButtonState);
  syncButtonState();
}
