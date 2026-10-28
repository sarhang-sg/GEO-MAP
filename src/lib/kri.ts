import type { FeatureCollection, Geometry, Position } from "geojson";
import { fetchJson } from "./service-state";
import { dataAssetUrl } from "./release";

export type KriLayers = {
  boundary: FeatureCollection;
  boundaryLine: FeatureCollection;
  governorates: FeatureCollection;
  districts: FeatureCollection;
  labels: FeatureCollection;
  roadLabels: FeatureCollection;
  mask: FeatureCollection;
};

async function getGeoJson(path: string): Promise<FeatureCollection> {
  return fetchJson<FeatureCollection>(dataAssetUrl(path), {
    headers: { Accept: "application/geo+json,application/json" }
  }, `Map layer ${path}`);
}

export async function loadKriLayers(): Promise<KriLayers> {
  const [boundary, boundaryLine, governorates, districts, labels, roadLabels, mask] = await Promise.all([
    getGeoJson("data/kri/kri-boundary.geojson"),
    getGeoJson("data/kri/kri-boundary-line.geojson"),
    getGeoJson("data/kri/kri-governorates.geojson"),
    getGeoJson("data/kri/kri-districts.geojson"),
    getGeoJson("data/kri/kri-labels.geojson"),
    getGeoJson("data/kri/kri-road-labels.geojson"),
    getGeoJson("data/kri/kri-outside-mask.geojson")
  ]);
  return { boundary, boundaryLine, governorates, districts, labels, roadLabels, mask };
}

/** Canonical operational bounds for complete Southern Kurdistan, including the configured disputed-area coverage. */
export const KRI_BOUNDS: [[number, number], [number, number]] = [
  [41.285802647000025, 33.305386992000024],
  [46.34872977600003, 37.37726400600002]
];


function pointOnSegment(point: Position, a: Position, b: Position): boolean {
  const [x, y] = point;
  const [x1, y1] = a;
  const [x2, y2] = b;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 1e-10) return false;
  return (x - x1) * (x - x2) + (y - y1) * (y - y2) <= 1e-10;
}

function pointInRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (pointOnSegment(point, a, b)) return true;
    const intersects = a[1] > point[1] !== b[1] > point[1] && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (intersects) inside = !inside;
  }
  return inside;
}

function containsCoordinate(point: Position, geometry: Geometry): boolean {
  if (geometry.type === "Polygon") {
    const [outer, ...holes] = geometry.coordinates;
    return pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole));
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some(([outer, ...holes]) => pointInRing(point, outer) && !holes.some((hole) => pointInRing(point, hole)));
  }
  return false;
}

export function isInsideKri(point: Position, boundary: FeatureCollection): boolean {
  return boundary.features.some((feature) => feature.geometry ? containsCoordinate(point, feature.geometry) : false);
}
