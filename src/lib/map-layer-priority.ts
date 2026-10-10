import type { Map as MapLibreMap } from "maplibre-gl";
import { ATLAS_MARKER_LAYER_IDS } from "./atlas-marker-icon-controller";
import { LOCATION_ACCURACY_LAYER_IDS, LOCATION_PUCK_LAYER_IDS } from "./live-location-layers";
import { ALL_POI_ICON_LAYER_IDS } from "./poi-icon-catalog";
import { ROUTE_GUIDANCE_LAYER_IDS } from "./route-guidance-overlay";
import { ROUTE_DESTINATION_LAYER_IDS, ROUTE_RENDER_LAYER_IDS } from "./routing-controller";

/**
 * Canonical visual stack for dynamic map layers.
 *
 * Base-map paint and the GPS accuracy surface stay below place icons. The
 * navigation route stays above icons so the path remains continuous through
 * busy areas. Destination markers and the live puck remain above the route.
 * DOM labels are independently decluttered by LabelController.
 */
export const DYNAMIC_VISUAL_LAYER_ORDER = [
  ...LOCATION_ACCURACY_LAYER_IDS,
  ...ALL_POI_ICON_LAYER_IDS,
  ...ATLAS_MARKER_LAYER_IDS,
  ...ROUTE_RENDER_LAYER_IDS,
  ...ROUTE_GUIDANCE_LAYER_IDS,
  ...ROUTE_DESTINATION_LAYER_IDS,
  ...LOCATION_PUCK_LAYER_IDS
] as const;

export function normalizeDynamicMapLayerPriority(map: MapLibreMap): void {
  // getStyle() exists once the style graph can be mutated. isStyleLoaded()
  // additionally waits for sources: using it here skipped ordering while GPS
  // or POI data was being committed, precisely when newly added layers need it.
  const style = map.getStyle();
  if (!style?.layers) return;
  const layers = style.layers.map((layer) => layer.id);
  const desired = DYNAMIC_VISUAL_LAYER_ORDER.filter((id) => layers.includes(id));
  // A stable stack is a no-op: repeated route/GPS updates must not invalidate
  // every symbol layer and trigger unnecessary placement work.
  let before: string | undefined;
  for (const id of [...desired].reverse()) {
    const index = layers.indexOf(id);
    const next = layers[index + 1];
    if (next !== before) {
      map.moveLayer(id, before);
      layers.splice(index, 1);
      layers.splice(before ? layers.indexOf(before) : layers.length, 0, id);
    }
    before = id;
  }
}
