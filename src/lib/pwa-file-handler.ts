import type { Feature, FeatureCollection, GeoJsonProperties, Geometry, Position } from "geojson";
import type { Map as MapLibreMap } from "maplibre-gl";
import { UI } from "./i18n";
import type { Language } from "./types";
import type { LngLatTuple } from "./location";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FEATURES = 10_000;
const SOURCE_ID = "nav-kurd-imported-geojson";
const FILL_LAYER_ID = "nav-kurd-imported-geojson-fill";
const LINE_LAYER_ID = "nav-kurd-imported-geojson-line";
const POINT_LAYER_ID = "nav-kurd-imported-geojson-point";

type MessageKind = "normal" | "error" | "success";

type PwaMapFileControllerOptions = {
  map: MapLibreMap;
  getLanguage: () => Language;
  setMessage: (value: string, kind?: MessageKind) => void;
};

type ParsedGeoJson = FeatureCollection<Geometry, GeoJsonProperties>;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isGeometry(value: unknown): value is Geometry {
  if (!isObject(value) || typeof value.type !== "string") return false;
  return ["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"].includes(value.type);
}

function normalizeGeoJson(value: unknown): ParsedGeoJson {
  if (!isObject(value) || typeof value.type !== "string") throw new Error("invalid-geojson");
  if (value.type === "FeatureCollection") {
    if (!Array.isArray(value.features)) throw new Error("invalid-geojson");
    return value as unknown as ParsedGeoJson;
  }
  if (value.type === "Feature") {
    const feature = value as unknown as Feature<Geometry, GeoJsonProperties>;
    return { type: "FeatureCollection", features: [feature] };
  }
  if (isGeometry(value)) {
    return {
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: value, properties: {} }]
    };
  }
  throw new Error("invalid-geojson");
}

function featureCount(collection: ParsedGeoJson): number {
  return collection.features.length;
}

function visitPositions(geometry: Geometry | null, callback: (position: Position) => void): void {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach((child) => visitPositions(child, callback));
    return;
  }

  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      callback(value as Position);
      return;
    }
    value.forEach(visit);
  };
  visit(geometry.coordinates);
}

function validateAndBounds(collection: ParsedGeoJson): [LngLatTuple, LngLatTuple] {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  let positions = 0;

  for (const feature of collection.features) {
    if (!feature || feature.type !== "Feature" || !feature.geometry) continue;
    visitPositions(feature.geometry, (position) => {
      const lng = position[0];
      const lat = position[1];
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
        throw new Error("invalid-geojson");
      }
      positions += 1;
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
    });
  }

  if (positions === 0) throw new Error("no-geometry");
  return [[west, south], [east, north]];
}

function extension(file: File): string {
  const name = file.name.toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function isSupportedFile(file: File): boolean {
  const ext = extension(file);
  return ext === ".geojson" || ext === ".json" || file.type === "application/geo+json" || file.type === "application/json";
}

export class PwaMapFileController {
  private readonly options: PwaMapFileControllerOptions;

  constructor(options: PwaMapFileControllerOptions) {
    this.options = options;
  }

  async openFiles(files: readonly File[]): Promise<void> {
    const file = files.find(isSupportedFile);
    if (!file) {
      this.fail("pwaFileInvalid");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      this.fail("pwaFileTooLarge");
      return;
    }

    try {
      const text = await file.text();
      const parsed = normalizeGeoJson(JSON.parse(text) as unknown);
      if (featureCount(parsed) > MAX_FEATURES) throw new Error("too-many-features");
      const bounds = validateAndBounds(parsed);
      this.render(parsed, bounds);
      this.options.setMessage(UI[this.options.getLanguage()].pwaFileImported, "success");
    } catch (error) {
      const code = error instanceof Error ? error.message : "invalid-geojson";
      if (code === "too-many-features") this.fail("pwaFileTooManyFeatures");
      else if (code === "no-geometry") this.fail("pwaFileNoGeometry");
      else this.fail("pwaFileInvalid");
    }
  }

  private render(collection: ParsedGeoJson, bounds: [LngLatTuple, LngLatTuple]): void {
    const source = this.options.map.getSource(SOURCE_ID);
    if (source && "setData" in source) {
      (source as { setData: (data: ParsedGeoJson) => void }).setData(collection);
    } else {
      this.options.map.addSource(SOURCE_ID, { type: "geojson", data: collection });
    }

    if (!this.options.map.getLayer(FILL_LAYER_ID)) {
      this.options.map.addLayer({
        id: FILL_LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: {
          "fill-color": "#8a5cff",
          "fill-opacity": 0.18
        }
      });
    }
    if (!this.options.map.getLayer(LINE_LAYER_ID)) {
      this.options.map.addLayer({
        id: LINE_LAYER_ID,
        type: "line",
        source: SOURCE_ID,
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
        paint: {
          "line-color": "#ffe19e",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6, 1.5, 14, 3.5],
          "line-opacity": 0.95
        }
      });
    }
    if (!this.options.map.getLayer(POINT_LAYER_ID)) {
      this.options.map.addLayer({
        id: POINT_LAYER_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-color": "#7d54ff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 5, 14, 9],
          "circle-stroke-color": "#fff4d0",
          "circle-stroke-width": 2
        }
      });
    }

    this.options.map.fitBounds(bounds, {
      padding: 56,
      maxZoom: 15,
      duration: 650,
      essential: true
    });
  }

  private fail(key: "pwaFileInvalid" | "pwaFileTooLarge" | "pwaFileTooManyFeatures" | "pwaFileNoGeometry"): void {
    this.options.setMessage(UI[this.options.getLanguage()][key], "error");
  }
}
