import type { Map as MapLibreMap, RasterSourceSpecification, ErrorEvent as MapErrorEvent } from "maplibre-gl";
import type { AppearancePreferences } from "./appearance-state";

export type SatelliteQuality = "high" | "medium" | "low";
export const SATELLITE_QUALITY = {
  high: { tileScale: 0.5, levels: 2, tileRatio: 4, filterPitch: 0, pixels: 24_000_000 },
  medium: { tileScale: 1, levels: 4, tileRatio: 3, filterPitch: 20, pixels: 8_000_000 },
  low: { tileScale: 2, levels: 6, tileRatio: 1.25, filterPitch: 70, pixels: 2_000_000 }
} as const;

export function resolveSatelliteQuality(value: AppearancePreferences["satelliteQuality"], baseline: number, degraded: boolean): SatelliteQuality {
  if (value !== "auto") return value;
  return degraded || baseline < 1.25 ? "low" : baseline >= 2 ? "high" : "medium";
}

export function renderingRatio(requested: number, width: number, height: number, budget: number): number {
  return Math.max(0.25, Math.min(requested, Math.sqrt(budget / Math.max(1, width * height))));
}

type RasterState = { source: unknown; original: RasterSourceSpecification; quality: SatelliteQuality; highDetail: boolean };
type QualityOptions = {
  highDetail?: RasterSourceSpecification | null;
  onDetailChange?: (active: boolean) => void;
};

/** Change only imagery resolution/LOD. Preserve the route, GPS and camera. */
export function createSatelliteQualityController(map: MapLibreMap, options: QualityOptions = {}): (quality: SatelliteQuality, clear: boolean, preferHighDetail?: boolean) => void {
  const states = new Map<string, RasterState>();
  let failed = false;
  let active = false;
  let removed = false;
  let lastRequest: [SatelliteQuality, boolean, boolean] | undefined;
  const apply = (quality: SatelliteQuality, clear: boolean, preferHighDetail = false): void => {
    if (removed) return;
    lastRequest = [quality, clear, preferHighDetail];
    const profile = SATELLITE_QUALITY[quality];
    map.setAnisotropicFilterPitch(profile.filterPitch);
    let detailActive = false;
    for (const id of ["kri-satellite", "kri-satellite-detail", "kri-satellite-fallback"]) {
      const style = map.getStyle();
      const spec = style?.sources[id];
      let source = map.getSource(id);
      if (!source || spec?.type !== "raster") { states.delete(id); continue; }
      const previous = states.get(id);
      const original = previous?.source === source ? previous.original : spec;
      const highDetail = id === "kri-satellite" && quality === "high" && preferHighDetail && !failed && Boolean(options.highDetail);
      const desired = highDetail ? options.highDetail! : original;
      // Smaller display tiles request finer geographic tiles, independently of DPR.
      // Keep the provider's native zoom limits, URLs and attribution intact.
      const tileSize = Math.max(64, Math.min(1024, (desired.tileSize ?? 256) * profile.tileScale));
      const wasHighDetail = previous?.source === source && previous.highDetail;
      if (spec.tileSize !== tileSize || highDetail !== Boolean(wasHighDetail)) {
        const layers = style.layers.filter(layer => "source" in layer && layer.source === id);
        const removed = new Set(layers.map(layer => layer.id));
        const anchors = new Map(layers.map(layer => [layer.id,
          style.layers.slice(style.layers.indexOf(layer) + 1).find(next => !removed.has(next.id))?.id]));
        for (const layer of layers) map.removeLayer(layer.id);
        map.removeSource(id);
        map.addSource(id, { ...desired, tileSize });
        for (const layer of layers) map.addLayer(layer, anchors.get(layer.id));
        source = map.getSource(id);
      }
      if (previous?.source !== source || previous?.quality !== quality) {
        map.setSourceTileLodParams(profile.levels, profile.tileRatio, id);
      }
      states.set(id, { source, original, quality, highDetail });
      detailActive ||= highDetail;
      for (const layer of map.getStyle().layers) {
        if (layer.type !== "raster" || layer.source !== id) continue;
        // Retain shadow and highlight detail instead of washing out the photograph.
        map.setPaintProperty(layer.id, "raster-contrast", clear ? 0.12 : 0);
        map.setPaintProperty(layer.id, "raster-brightness-min", 0);
        map.setPaintProperty(layer.id, "raster-brightness-max", 1);
        map.setPaintProperty(layer.id, "raster-resampling", "linear");
      }
    }
    if (active !== detailActive) {
      active = detailActive;
      options.onDetailChange?.(active);
    }
  };
  // Once per map session: denied tokens, rate limits, missing tiles or a failed
  // connection return to the original imagery without a retry loop. Defer the
  // source swap until MapLibre has finished dispatching the failing tile event.
  const onError = (event: MapErrorEvent & { sourceId?: string }): void => {
    if (!active || failed || event.sourceId !== "kri-satellite") return;
    failed = true;
    queueMicrotask(() => { if (!removed && lastRequest) apply(...lastRequest); });
  };
  map.on("error", onError);
  map.on("remove", () => {
    removed = true;
    states.clear();
    map.off("error", onError);
    if (active) options.onDetailChange?.(false);
  });
  return apply;
}
