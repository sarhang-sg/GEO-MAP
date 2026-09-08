import type { FeatureCollection } from "geojson";
import type { StyleSpecification } from "maplibre-gl";
import type { SatelliteSource } from "./satellite";
import type { MapMode } from "./types";
import { BASE_POI_CLUSTER_COUNT_LAYER_ID, BASE_POI_CLUSTER_LAYER_ID, BASE_POI_DOT_LAYER_ID, BASE_POI_DOT_OPACITY, BASE_POI_SOURCE_ID, NAMED_POI_FILTER, NATURAL_POI_DOT_LAYER_ID, NATURAL_POI_SOURCE_ID, REVIEWED_POI_DOT_LAYER_ID, REVIEWED_POI_SOURCE_ID, SECURITY_POI_DOT_LAYER_ID, SECURITY_POI_SOURCE_ID } from "./poi-source";
import { dataAssetUrl } from "./release";

export type StaticCoverageSources = {
  mask: FeatureCollection;
  boundary: FeatureCollection;
  boundaryLine: FeatureCollection;
  governorates: FeatureCollection;
  districts: FeatureCollection;
};

export type KriMapStyleOptions = {
  mode: MapMode;
  pmtilesUrl: string;
  roadsPmtilesUrl: string;
  satelliteEnabled: boolean;
  satelliteSource: SatelliteSource;
  basemapVisible: boolean;
  administrativeVisible: boolean;
  placesVisible: boolean;
  lowPowerProfile: boolean;
  deferBasePoiData?: boolean;
  deferNaturalPoiData?: boolean;
  coverage?: StaticCoverageSources | null;
};

const secondaryRoadClasses = ["secondary", "tertiary"] as const;
const localRoadClasses = ["residential", "service", "unclassified", "track", "other"] as const;
const EMPTY_POINT_COLLECTION: FeatureCollection = { type: "FeatureCollection", features: [] };

function sourceData(path: string, data: FeatureCollection | undefined): string | FeatureCollection {
  return data ?? dataAssetUrl(path);
}

/** Builds one deterministic MapLibre style from the unified NAV KURD vector source. */
export function buildKriMapStyle(options: KriMapStyleOptions): StyleSpecification {
  const mode = options.mode;
  const night = mode === "night";
  const satelliteAvailable = options.satelliteEnabled && Boolean(options.satelliteSource.source);
  const satelliteDetailAvailable = satelliteAvailable && options.satelliteSource.enabled && Boolean(options.satelliteSource.detailSource);
  const satellite = mode === "satellite" && satelliteAvailable;
  const palette = night
    ? { background: "#07111F", land: "#0D1A2B", water: "#173E5F", waterLine: "#4A8DBB", building: "#12243A", outline: "#20344E", casing: "#20344E", local: "#71829A", tertiary: "#C9B98F", primary: "#F0B95A", major: "#F0B95A", poi: "#4CCBFF" }
    : satellite
      ? { background: "#DDE7EF", land: "#DCE8DA", water: "#A8D5E8", waterLine: "#6FA5C0", building: "#DADAD5", outline: "#AEB9C4", casing: "#87745F", local: "#E9EEF3", tertiary: "#E7C88E", primary: "#D9A95B", major: "#D9A95B", poi: "#4CCBFF" }
      : { background: "#F4F7FA", land: "#EEF3F0", water: "#D8EEF8", waterLine: "#91BED3", building: "#E7ECF1", outline: "#C5CFD9", casing: "#C8B79E", local: "#E4E9EF", tertiary: "#E6D2AA", primary: "#D9B36B", major: "#D9B36B", poi: "#2789F5" };

  // Road/source zooms are intentionally identical on desktop and mobile.  The
  // previous viewport-specific thresholds made mobile look broken while desktop looked fine.
  const siteMinZoom = options.lowPowerProfile ? 10.2 : 9.6;
  const buildingMinZoom = options.lowPowerProfile ? 13.6 : 13.2;
  const localRoadMinZoom = satellite ? 13.35 : 12.85;
  const tertiaryRoadMinZoom = 7.25;
  const majorRoadMinZoom = 5.0;
  const poiMinZoom = options.lowPowerProfile ? 10.6 : 10.0;
  const roadOpacity = satellite ? 0.92 : 0.98;

  const sources: StyleSpecification["sources"] = {
    "kri-vector": { type: "vector", url: `pmtiles://${options.pmtilesUrl}`, attribution: "© OpenStreetMap contributors" },
    "kri-road-vector": { type: "vector", url: `pmtiles://${options.roadsPmtilesUrl}`, attribution: "© OpenStreetMap contributors" },
    [BASE_POI_SOURCE_ID]: { type: "geojson", data: options.deferBasePoiData ? EMPTY_POINT_COLLECTION : dataAssetUrl("data/kri/kri-pois-render.geojson"), attribution: "© OpenStreetMap contributors", cluster: true, clusterMaxZoom: options.lowPowerProfile ? 12 : 13, clusterRadius: options.lowPowerProfile ? 68 : 54, clusterMinPoints: 3 },
    "kri-mask-source": { type: "geojson", data: sourceData("data/kri/kri-outside-mask.geojson", options.coverage?.mask) },
    "kri-boundary-source": { type: "geojson", data: sourceData("data/kri/kri-boundary.geojson", options.coverage?.boundary) },
    "kri-boundary-line-source": { type: "geojson", data: sourceData("data/kri/kri-boundary-line.geojson", options.coverage?.boundaryLine) },
    "kri-governorate-source": { type: "geojson", data: sourceData("data/kri/kri-governorates.geojson", options.coverage?.governorates) },
    "kri-district-source": { type: "geojson", data: sourceData("data/kri/kri-districts.geojson", options.coverage?.districts) },
    [NATURAL_POI_SOURCE_ID]: { type: "geojson", data: options.deferNaturalPoiData ? EMPTY_POINT_COLLECTION : dataAssetUrl("data/kri/kri-natural-features.geojson"), attribution: "OpenStreetMap contributors and GeoNames" },
    [SECURITY_POI_SOURCE_ID]: { type: "geojson", data: dataAssetUrl("data/kri/kri-security-features.geojson"), attribution: "© OpenStreetMap contributors" },
    [REVIEWED_POI_SOURCE_ID]: { type: "geojson", data: dataAssetUrl("data/kri/kri-reviewed-poi-corrections.geojson"), attribution: "NAV KURD reviewed community corrections · © OpenStreetMap contributors" }
  };
  const addRasterSource = (id: string, source: NonNullable<Extract<SatelliteSource, { enabled: true }>["source"]>, attribution: string): void => {
    sources[id] = source.kind === "tilejson"
      ? { type: "raster", url: source.url, tileSize: 256, attribution }
      : { type: "raster", tiles: [source.url], tileSize: source.tileSize ?? 256, minzoom: source.minzoom ?? 0, maxzoom: source.maxzoom ?? 20, attribution };
  };
  if (satelliteAvailable && options.satelliteSource.enabled) {
    addRasterSource("kri-satellite", options.satelliteSource.source, options.satelliteSource.attribution);
    if (options.satelliteSource.fallbackSource) addRasterSource("kri-satellite-fallback", options.satelliteSource.fallbackSource, options.satelliteSource.attribution);
    if (options.satelliteSource.detailSource) addRasterSource("kri-satellite-detail", options.satelliteSource.detailSource, options.satelliteSource.detailAttribution || options.satelliteSource.attribution);
  }

  const satelliteLayers: StyleSpecification["layers"] = [];
  if (satelliteAvailable && options.satelliteSource.enabled) {
    const transitionZoom = options.satelliteSource.transitionZoom ?? 13;
    const contextOverlay = satelliteDetailAvailable && options.satelliteSource.composition === "context-overlay";
    if (options.satelliteSource.fallbackSource) satelliteLayers.push({
      id: "kri-satellite-fallback", type: "raster", source: "kri-satellite-fallback", maxzoom: 24,
      layout: { visibility: "none" },
      paint: {
        "raster-opacity": 1, "raster-resampling": "linear", "raster-fade-duration": 0,
        "raster-saturation": 0.01, "raster-contrast": 0.12, "raster-brightness-min": 0.03, "raster-brightness-max": 0.99
      }
    });
    satelliteLayers.push({
      id: "kri-satellite", type: "raster", source: "kri-satellite", maxzoom: contextOverlay || !satelliteDetailAvailable ? 24 : transitionZoom + 0.35,
      layout: { visibility: satellite ? "visible" : "none" },
      paint: {
        // In context-overlay mode the global raster never fades out. This is the
        // guaranteed far/near-zoom satellite layer and the Sentinel source is additive.
        "raster-opacity": contextOverlay || !satelliteDetailAvailable ? 1 : ["interpolate", ["linear"], ["zoom"], transitionZoom - 0.28, 1, transitionZoom + 0.14, 0],
        "raster-resampling": "linear", "raster-fade-duration": 0,
        "raster-saturation": 0.01, "raster-contrast": 0.14, "raster-brightness-min": 0.03, "raster-brightness-max": 0.99
      }
    });
    if (satelliteDetailAvailable) satelliteLayers.push(contextOverlay ? {
      id: "kri-satellite-detail", type: "raster", source: "kri-satellite-detail", minzoom: 6.45, maxzoom: 24,
      layout: { visibility: satellite ? "visible" : "none" },
      paint: {
        // Keep a low-opacity Sentinel safety layer after its native zoom. If
        // the high-resolution provider is blocked by a domain restriction, the
        // controller promotes this layer to full opacity instead of leaving a
        // blank dark map.
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], 6.45, 0, transitionZoom, 0.72, 12.15, 0.72, 14.5, 0.28, 20, 0.18],
        "raster-resampling": "linear", "raster-fade-duration": 0,
        "raster-saturation": 0.02, "raster-contrast": 0.10, "raster-brightness-min": 0.02, "raster-brightness-max": 1
      }
    } : {
      id: "kri-satellite-detail", type: "raster", source: "kri-satellite-detail", minzoom: transitionZoom - 0.4,
      layout: { visibility: satellite ? "visible" : "none" },
      paint: {
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], transitionZoom - 0.22, 0, transitionZoom + 0.14, 1],
        "raster-resampling": "linear", "raster-fade-duration": 0,
        "raster-saturation": 0.03, "raster-contrast": 0.12, "raster-brightness-min": 0.02, "raster-brightness-max": 1
      }
    });
  }

  const layers: StyleSpecification["layers"] = [
    { id: "kri-background", type: "background", paint: { "background-color": palette.background } },
    ...satelliteLayers,

    { id: "kri-sites", type: "fill", source: "kri-vector", "source-layer": "sites", minzoom: siteMinZoom, layout: { visibility: options.basemapVisible ? "visible" : "none" }, paint: { "fill-color": palette.land, "fill-opacity": satellite ? 0.08 : night ? 0.34 : 0.48 } },
    { id: "kri-water", type: "fill", source: "kri-vector", "source-layer": "water_polygons", layout: { visibility: options.basemapVisible ? "visible" : "none" }, paint: { "fill-color": palette.water, "fill-opacity": satellite ? 0.34 : 0.9 } },
    { id: "kri-water-lines", type: "line", source: "kri-vector", "source-layer": "water_lines", layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": palette.waterLine, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.32, 12, 1.15, 15, 2.15], "line-opacity": night ? 0.66 : 0.58 } },
    { id: "kri-buildings", type: "fill", source: "kri-vector", "source-layer": "buildings", minzoom: buildingMinZoom, layout: { visibility: options.basemapVisible ? "visible" : "none" }, paint: { "fill-color": palette.building, "fill-outline-color": palette.outline, "fill-opacity": satellite ? 0.18 : night ? 0.46 : 0.68 } },

    { id: "kri-road-local-casing", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: localRoadMinZoom, filter: ["match", ["get", "class"], [...localRoadClasses], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": night ? "#172334" : palette.casing, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.35, 14, 1.05, 17, 2.35], "line-opacity": satellite ? 0.54 : 0.46 } },
    { id: "kri-road-local", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: localRoadMinZoom, filter: ["match", ["get", "class"], [...localRoadClasses], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": palette.local, "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.14, 14, 0.46, 17, 1.1], "line-opacity": satellite ? 0.72 : night ? 0.58 : 0.78 } },

    { id: "kri-road-tertiary-casing", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: tertiaryRoadMinZoom, filter: ["match", ["get", "class"], [...secondaryRoadClasses], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": night ? "#624e34" : "#b98f55", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.58, 11, 1.55, 15, 3.25], "line-opacity": 0.72 } },
    { id: "kri-road-tertiary", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: tertiaryRoadMinZoom, filter: ["match", ["get", "class"], [...secondaryRoadClasses], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": palette.tertiary, "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.25, 11, 0.88, 15, 2.0], "line-opacity": roadOpacity } },

    { id: "kri-road-primary-casing", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: majorRoadMinZoom, filter: ["match", ["get", "class"], ["primary"], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": night ? "#6c4f3a" : "#a77745", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.86, 10, 2.12, 14, 4.45], "line-opacity": 0.86 } },
    { id: "kri-road-primary", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: majorRoadMinZoom, filter: ["match", ["get", "class"], ["primary"], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": palette.primary, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.46, 10, 1.28, 14, 3.3], "line-opacity": 1 } },
    { id: "kri-road-major-casing", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: majorRoadMinZoom, filter: ["match", ["get", "class"], ["motorway", "trunk"], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": night ? "#6c4f3a" : "#9d6f40", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1.05, 10, 2.65, 14, 5.15], "line-opacity": 0.9 } },
    { id: "kri-road-major", type: "line", source: "kri-road-vector", "source-layer": "streets", minzoom: majorRoadMinZoom, filter: ["match", ["get", "class"], ["motorway", "trunk"], true, false], layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": palette.major, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.62, 10, 1.58, 14, 3.72], "line-opacity": 1 } },
    { id: "kri-bridges", type: "line", source: "kri-road-vector", "source-layer": "bridges", minzoom: 9.4, layout: { "line-cap": "round", "line-join": "round", visibility: options.basemapVisible ? "visible" : "none" }, paint: { "line-color": "#ffe098", "line-width": ["interpolate", ["linear"], ["zoom"], 9, 0.45, 14, 2.4], "line-opacity": 0.9 } },
    { id: BASE_POI_CLUSTER_LAYER_ID, type: "circle", source: BASE_POI_SOURCE_ID, minzoom: options.lowPowerProfile ? 8.8 : 8.2, maxzoom: options.lowPowerProfile ? 12.05 : 12.65, filter: ["has", "point_count"], layout: { visibility: options.placesVisible ? "visible" : "none" }, paint: { "circle-color": ["step", ["get", "point_count"], "#2789F5", 20, "#2D8CFF", 100, "#3DA7FF", 500, "#4CCBFF"], "circle-radius": ["step", ["get", "point_count"], 10, 20, 14, 100, 18, 500, 23], "circle-stroke-color": night ? "#07111F" : "#FFFFFF", "circle-stroke-width": 1.3, "circle-opacity": 0.88 } },
    { id: BASE_POI_CLUSTER_COUNT_LAYER_ID, type: "symbol", source: BASE_POI_SOURCE_ID, minzoom: options.lowPowerProfile ? 8.8 : 8.2, maxzoom: options.lowPowerProfile ? 12.05 : 12.65, filter: ["has", "point_count"], layout: { visibility: options.placesVisible ? "visible" : "none", "text-field": ["get", "point_count_abbreviated"], "text-size": 10.5, "text-allow-overlap": true }, paint: { "text-color": "#10142f", "text-halo-color": "rgba(255,255,255,0.45)", "text-halo-width": 0.4 } },
    { id: BASE_POI_DOT_LAYER_ID, type: "circle", source: BASE_POI_SOURCE_ID, minzoom: poiMinZoom, filter: ["all", ["!", ["has", "point_count"]], NAMED_POI_FILTER], layout: { visibility: options.placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.15, 12, 2.15, 14, 3.25], "circle-color": palette.poi, "circle-stroke-color": night ? "#0b1426" : "#fff", "circle-stroke-width": 0.9, "circle-opacity": BASE_POI_DOT_OPACITY } },
    { id: NATURAL_POI_DOT_LAYER_ID, type: "circle", source: NATURAL_POI_SOURCE_ID, minzoom: poiMinZoom, filter: NAMED_POI_FILTER, layout: { visibility: options.placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.15, 12, 2.15, 14, 3.25], "circle-color": palette.poi, "circle-stroke-color": night ? "#0b1426" : "#fff", "circle-stroke-width": 0.9, "circle-opacity": BASE_POI_DOT_OPACITY } },
    { id: SECURITY_POI_DOT_LAYER_ID, type: "circle", source: SECURITY_POI_SOURCE_ID, minzoom: Math.max(9.2, poiMinZoom - 0.8), filter: NAMED_POI_FILTER, layout: { visibility: options.placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 12, 2.6, 14, 3.8], "circle-color": "#e08a73", "circle-stroke-color": night ? "#0b1426" : "#fff", "circle-stroke-width": 1.0, "circle-opacity": BASE_POI_DOT_OPACITY } },
    { id: REVIEWED_POI_DOT_LAYER_ID, type: "circle", source: REVIEWED_POI_SOURCE_ID, minzoom: poiMinZoom, filter: NAMED_POI_FILTER, layout: { visibility: options.placesVisible ? "visible" : "none" }, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 12, 2.25, 14, 3.4], "circle-color": palette.poi, "circle-stroke-color": night ? "#0b1426" : "#fff", "circle-stroke-width": 1.0, "circle-opacity": BASE_POI_DOT_OPACITY } },

    // The outside mask is slightly translucent so neighboring terrain remains readable without letting outside map data dominate the KRI + Kirkuk coverage.
    { id: "kri-mask", type: "fill", source: "kri-mask-source", paint: { "fill-color": satellite ? "#0a1624" : night ? "#08111e" : "#0b1420", "fill-opacity": satellite ? 0.88 : night ? 0.93 : 0.90 } },
    { id: "kri-boundary-fill", type: "fill", source: "kri-boundary-source", paint: { "fill-color": "#2D8CFF", "fill-opacity": options.basemapVisible ? 0.025 : 0.14 } },
    { id: "kri-districts", type: "line", source: "kri-district-source", layout: { visibility: options.administrativeVisible ? "visible" : "none" }, paint: { "line-color": "#c7cff2", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.34, 13, 1.05], "line-opacity": night ? 0.38 : 0.46, "line-dasharray": [2.1, 1.8] } },
    { id: "kri-governorates", type: "line", source: "kri-governorate-source", layout: { visibility: options.administrativeVisible ? "visible" : "none" }, paint: { "line-color": "#f4ca74", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.9, 14, 2.7], "line-opacity": 0.94 } },
    { id: "kri-boundary-halo", type: "line", source: "kri-boundary-line-source", paint: { "line-color": satellite ? "#02050a" : "#5f6fa5", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 4.4, 14, 10.8], "line-opacity": satellite ? 0.86 : 0.24, "line-blur": 1.1 } },
    { id: "kri-boundary", type: "line", source: "kri-boundary-line-source", paint: { "line-color": "#fff8dc", "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.35, 14, 3.7], "line-opacity": 0.98 } }
  ];
  return { version: 8, sources, layers };
}
