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

  // Satellite sources exist only while selected. Removing them cancels pending
  // imagery requests and releases their tile cache without resetting GPS/routes.
  const modeSourceIds = ["kri-satellite-fallback", "kri-satellite", "kri-satellite-detail", "kri-vector"];
  for (const id of modeSourceIds) {
    if (map.getSource(id) && !style.sources[id]) {
      for (const layer of currentLayers) {
        if ("source" in layer && layer.source === id) map.removeLayer(layer.id);
      }
      map.removeSource(id);
    }
  }
  for (const id of modeSourceIds) {
    if (style.sources[id] && !map.getSource(id)) map.addSource(id, style.sources[id]);
  }
  for (const layer of style.layers ?? []) {
    if ("source" in layer && modeSourceIds.includes(layer.source) && !map.getLayer(layer.id)) {
      const index = style.layers.indexOf(layer);
      const before = style.layers.slice(index + 1).find(candidate => map.getLayer(candidate.id));
      map.addLayer(layer, before?.id);
    }
  }
  let applied = 0;
  for (const specification of style.layers ?? []) {
    const layer = specification as unknown as MutableStyleLayer;
    if (!map.getLayer(layer.id)) continue;

    map.setLayerZoomRange(layer.id, layer.minzoom ?? 0, layer.maxzoom ?? 24);
    if (layer.filter !== undefined) map.setFilter(layer.id, layer.filter as never);

    for (const [property, value] of Object.entries(layer.layout ?? {})) {
      map.setLayoutProperty(layer.id, property as never, value as never);
    }
    for (const [property, value] of Object.entries(layer.paint ?? {})) {
      map.setPaintProperty(layer.id, property as never, value as never);
    }
    applied += 1;
  }

  map.triggerRepaint();
  return applied > 0;
}
