import type { FeatureCollection, Point, Polygon } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import { emptyAccuracyCollection, emptyLocationPointCollection, type LocationPointProperties } from "./location";

export const LOCATION_POINT_SOURCE = "location-point-source";
export const LOCATION_ACCURACY_SOURCE = "location-accuracy-source";
export const LOCATION_DIRECTION_IMAGE = "nav-kurd-location-direction";

export const LOCATION_ACCURACY_LAYER_IDS = [
  "location-accuracy-fill",
  "location-accuracy-line"
] as const;

export const LOCATION_PUCK_LAYER_IDS = [
  "location-direction-arrow",
  "location-dot"
] as const;

export const LIVE_LOCATION_LAYER_IDS = [
  ...LOCATION_ACCURACY_LAYER_IDS,
  ...LOCATION_PUCK_LAYER_IDS,
] as const;

function makeDirectionImage(): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(36, 36);

  // A compact navigation chevron with its own outline, so it remains legible
  // on street, night and satellite imagery without relying on glyph loading.
  context.beginPath();
  context.moveTo(0, -29);
  context.lineTo(17, 15);
  context.quadraticCurveTo(18, 20, 13, 18);
  context.lineTo(0, 12);
  context.lineTo(-13, 18);
  context.quadraticCurveTo(-18, 20, -17, 15);
  context.closePath();
  context.lineJoin = "round";
  context.lineWidth = 8;
  context.strokeStyle = "rgba(7, 25, 47, 0.92)";
  context.stroke();

  const gradient = context.createLinearGradient(0, -29, 0, 20);
  gradient.addColorStop(0, "#f5f1ff");
  gradient.addColorStop(0.34, "#78dcff");
  gradient.addColorStop(1, "#7658ff");
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  context.moveTo(0, -22);
  context.lineTo(7, 9);
  context.lineTo(0, 5);
  context.lineTo(-7, 9);
  context.closePath();
  context.fillStyle = "rgba(255, 255, 255, 0.72)";
  context.fill();
  context.restore();

  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function ensureDirectionImage(map: MapLibreMap): void {
  if (map.hasImage(LOCATION_DIRECTION_IMAGE)) return;
  const image = makeDirectionImage();
  if (!image) return;
  map.addImage(LOCATION_DIRECTION_IMAGE, image, { pixelRatio: 2 });
}

export function liveLocationLayersReady(map: MapLibreMap): boolean {
  return Boolean(
    map.getSource(LOCATION_POINT_SOURCE)
    && map.getSource(LOCATION_ACCURACY_SOURCE)
    && LIVE_LOCATION_LAYER_IDS.every((id) => map.getLayer(id))
  );
}

/**
 * Idempotently creates the GPS sources and layers. Existing sources are never
 * removed, which is essential because replacing a GeoJSON source erases the
 * current coordinate during a style or data-layer refresh.
 */
export function ensureLiveLocationLayers(
  map: MapLibreMap,
  pointData: FeatureCollection<Point, LocationPointProperties> = emptyLocationPointCollection(),
  accuracyData: FeatureCollection<Polygon> = emptyAccuracyCollection()
): void {
  if (!map.isStyleLoaded()) return;
  let layerGraphChanged = false;

  if (!map.getSource(LOCATION_ACCURACY_SOURCE)) {
    map.addSource(LOCATION_ACCURACY_SOURCE, { type: "geojson", data: accuracyData });
    layerGraphChanged = true;
  }
  if (!map.getSource(LOCATION_POINT_SOURCE)) {
    map.addSource(LOCATION_POINT_SOURCE, { type: "geojson", data: pointData });
    layerGraphChanged = true;
  }

  ensureDirectionImage(map);

  if (!map.getLayer("location-accuracy-fill")) {
    map.addLayer({
      id: "location-accuracy-fill",
      type: "fill",
      source: LOCATION_ACCURACY_SOURCE,
      paint: { "fill-color": "#6f7dff", "fill-opacity": 0.072 }
    });
    layerGraphChanged = true;
  }
  if (!map.getLayer("location-accuracy-line")) {
    map.addLayer({
      id: "location-accuracy-line",
      type: "line",
      source: LOCATION_ACCURACY_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#9bcaff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.55, 15, 1.15],
        "line-opacity": 0.38
      }
    });
    layerGraphChanged = true;
  }
  if (!map.getLayer("location-direction-arrow")) {
    map.addLayer({
      id: "location-direction-arrow",
      type: "symbol",
      source: LOCATION_POINT_SOURCE,
      filter: ["==", ["get", "hasHeading"], true],
      layout: {
        "icon-image": LOCATION_DIRECTION_IMAGE,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 6, 0.41, 14, 0.60, 18, 0.70],
        "icon-rotate": ["get", "heading"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "map",
        "icon-offset": [0, -15.5],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true
      },
      paint: { "icon-opacity": 0.98 }
    });
    layerGraphChanged = true;
  }
  if (!map.getLayer("location-dot")) {
    map.addLayer({
      id: "location-dot",
      type: "circle",
      source: LOCATION_POINT_SOURCE,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 4.2, 14, 7.2, 18, 8.4],
        "circle-color": "#4f8cff",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2.65,
        "circle-stroke-opacity": 1,
        "circle-opacity": 1,
        "circle-pitch-alignment": "map",
        "circle-pitch-scale": "map"
      }
    });
    layerGraphChanged = true;
  }

  if (layerGraphChanged) bringLiveLocationPuckToFront(map);
}

/** Keep only the compact position puck above place icons. The broad accuracy
 *  surface is ordered below route and POI layers by map-layer-priority.ts so it
 *  can never wash over a shop, locality, checkpoint, or label icon. */
export function bringLiveLocationPuckToFront(map: MapLibreMap): void {
  for (const id of LOCATION_PUCK_LAYER_IDS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}
