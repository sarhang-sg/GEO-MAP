import type { Map as MapLibreMap } from "maplibre-gl";
import { ATLAS_MARKER_LAYER_IDS } from "./atlas-marker-icon-controller";
import { LOCATION_ACCURACY_LAYER_IDS, LOCATION_PUCK_LAYER_IDS } from "./live-location-layers";
import { ALL_POI_ICON_LAYER_IDS } from "./poi-icon-catalog";
import { ROUTE_DESTINATION_LAYER_IDS, ROUTE_RENDER_LAYER_IDS } from "./routing-controller";

/**
 * Canonical visual stack for dynamic map layers.
 *
 * Base-map paint stays at the bottom. The large GPS accuracy surface and route
 * strokes sit below place icons, so neither can cover a locality, shop, or
 * checkpoint. Destination markers and the compact live puck remain above
 * place icons. DOM labels are independently decluttered by LabelController.
 */
export const DYNAMIC_VISUAL_LAYER_ORDER = [
  ...LOCATION_ACCURACY_LAYER_IDS,
  ...ROUTE_RENDER_LAYER_IDS,
  ...ALL_POI_ICON_LAYER_IDS,
  ...ATLAS_MARKER_LAYER_IDS,
  ...ROUTE_DESTINATION_LAYER_IDS,
  ...LOCATION_PUCK_LAYER_IDS
] as const;

export function normalizeDynamicMapLayerPriority(map: MapLibreMap): void {
  if (!map.isStyleLoaded()) return;
  for (const layerId of DYNAMIC_VISUAL_LAYER_ORDER) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}
