import type { Feature, LineString } from "geojson";
import { distanceMeters, type LngLatTuple } from "./location";
import { preciseRouteGeometry } from "./route-geometry";
import { routeSlice } from "./route-progress";

export type TrafficLevel = "low" | "moderate" | "heavy" | "severe" | "closed" | "unknown";
export type TrafficRouteFeature = Feature<LineString, {
  distance: number;
  duration: number;
  traffic: TrafficLevel;
  congestion?: number;
  routeId?: number;
  connector?: boolean;
}>;
type RouteWithTraffic = {
  distance?: number;
  duration?: number;
  geometry?: LineString;
  legs?: Array<{ steps?: Array<{ geometry?: LineString }>; annotation?: {
    congestion?: string[];
    congestion_numeric?: number[];
    distance?: number[];
    duration?: number[];
  } }>;
};

function congestionLevel(text: string | undefined, numeric: number | undefined): TrafficLevel {
  switch (text) {
    case "low": case "moderate": case "heavy": case "severe": case "closed": return text;
    case "unknown": return "unknown";
  }
  if (typeof numeric === "number" && Number.isFinite(numeric)) {
    if (numeric >= 90) return "severe";
    if (numeric >= 70) return "heavy";
    if (numeric >= 45) return "moderate";
    if (numeric >= 0) return "low";
  }
  return "unknown";
}

/** Annotations are indexed against the provider's overview geometry.
 * A denser geometry assembled from step geometries must not be used with
 * the original annotation indices, or traffic colors move to the wrong roads.
 */
export function routeTrafficFeatures(route: RouteWithTraffic): TrafficRouteFeature[] {
  const overview = route.geometry;
  const exact = overview?.type === "LineString" && overview.coordinates.length >= 2 ? overview : null;
  const preferred = preciseRouteGeometry(route);
  if (!preferred) return [];
  const id = Date.now();
  const annotations = (route.legs ?? []).map(leg => leg.annotation);
  const categories = annotations.flatMap(a => a?.congestion ?? []);
  const numerics = annotations.flatMap(a => a?.congestion_numeric ?? []);
  const distances = annotations.flatMap(a => a?.distance ?? []);
  const durations = annotations.flatMap(a => a?.duration ?? []);
  const length = exact?.coordinates.length ?? 0;
  const aligned = length > 1 && (categories.length === length - 1 || numerics.length === length - 1);
  if (!aligned || !exact) {
    return [{ type: "Feature", properties: {
      distance: route.distance ?? 0, duration: route.duration ?? 0, traffic: "unknown", routeId: id
    }, geometry: preferred }];
  }
  const points = exact.coordinates as LngLatTuple[];
  const result: TrafficRouteFeature[] = [];
  for (let first = 0; first < points.length - 1;) {
    const severity = congestionLevel(categories[first], numerics[first]);
    let end = first + 1;
    while (end < points.length - 1 && congestionLevel(categories[end], numerics[end]) === severity) end++;
    const nums = numerics.slice(first, end).filter(Number.isFinite);
    const section = points.slice(first, end + 1);
    const fraction = (end - first) / (points.length - 1);
    const segmentDistance = distances.length === points.length - 1
      ? distances.slice(first, end).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)
      : (route.distance ?? 0) * fraction;
    const segmentDuration = durations.length === points.length - 1
      ? durations.slice(first, end).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)
      : (route.duration ?? 0) * fraction;
    result.push({ type: "Feature", properties: {
      distance: segmentDistance,
      duration: segmentDuration,
      traffic: severity,
      routeId: id,
      ...(nums.length ? { congestion: nums.reduce((s, n) => s + n, 0) / nums.length } : {})
    }, geometry: { type: "LineString", coordinates: section } });
    first = end;
  }
  return result;
}

/** Trim the traveled distance without collapsing individual traffic colors.
 * This also handles the single-feature OSRM and offline routing fallbacks.
 */
export function remainingTrafficFeatures(features: readonly TrafficRouteFeature[], traveledMeters: number): TrafficRouteFeature[] {
  let consumed = 0;
  const remaining: TrafficRouteFeature[] = [];
  for (const feature of features) {
    const points = feature.geometry.coordinates as LngLatTuple[];
    let meters = 0;
    for (let i = 1; i < points.length; i++) meters += distanceMeters(points[i - 1], points[i]);
    const localStart = Math.max(0, traveledMeters - consumed);
    consumed += meters;
    if (localStart >= meters || meters <= 0) continue;
    const coordinates = localStart > 0 ? routeSlice(points, localStart) : points;
    if (coordinates.length < 2) continue;
    remaining.push({
      ...feature,
      geometry: { type: "LineString", coordinates }
    });
  }
  return remaining;
}
