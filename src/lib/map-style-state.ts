import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";

type MutableStyleLayer = {
  id: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
};

/**
 * Applies the static NAV KURD mode palette in place.
 *
 * Dynamic route/GPS/owner layers are deliberately not replaced, so changing
 * Roads/Night/Satellite never clears live navigation state or waits for a full
 * style reload.
 */
export function applyKriStyleState(map: MapLibreMap, style: StyleSpecification): boolean {
  // `isStyleLoaded()` is false while raster/vector tiles are still loading.
  // That is not a style failure and must not trigger a full setStyle recovery.
  // A usable style is identified by the presence of its current layer graph.
  const currentLayers = map.getStyle()?.layers;
  if (!currentLayers || currentLayers.length === 0) return false;

  let applied = 0;
  for (const specification of style.layers ?? []) {
    const layer = specification as unknown as MutableStyleLayer;
    if (!map.getLayer(layer.id)) continue;

    map.setLayerZoomRange(layer.id, layer.minzoom ?? 0, layer.maxzoom ?? 24);
    if (layer.filter !== undefined) map.setFilter(layer.id, layer.filter as never);

    for (const [property, value] of Object.entries(layer.layout ?? {})) {
      map.setLayoutProperty(layer.id, property, value as never);
    }
    for (const [property, value] of Object.entries(layer.paint ?? {})) {
      map.setPaintProperty(layer.id, property, value as never);
    }
    applied += 1;
  }

  map.triggerRepaint();
  return applied > 0;
}
