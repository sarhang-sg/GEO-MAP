import type { LineString } from "geojson";
import { distanceMeters, type LngLatTuple } from "./location";

type RouteShape = { geometry?: LineString; legs?: Array<{ steps?: Array<{ geometry?: LineString }> }> };
const valid = (p: number[]): p is LngLatTuple => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

/** Preserve full provider geometry. Use denser steps only if they form the same
 * complete, continuous route; never draw a shortcut or snap to aerial imagery. */
export function preciseRouteGeometry(route: RouteShape): LineString | null {
  const overview = route.geometry;
  if (overview?.type !== "LineString" || overview.coordinates.length < 2 || !overview.coordinates.every(valid)) return null;
  const coordinates: LngLatTuple[] = [];
  for (const leg of route.legs ?? []) for (const step of leg.steps ?? []) {
    const points = step.geometry?.coordinates;
    if (step.geometry?.type !== "LineString" || !points?.length || !points.every(valid)) return overview;
    if (coordinates.length && distanceMeters(coordinates.at(-1)!, points[0]) > 0.2) return overview;
    for (const point of points) {
      const last = coordinates.at(-1);
      if (!last || last[0] !== point[0] || last[1] !== point[1]) coordinates.push([point[0], point[1]]);
    }
  }
  if (coordinates.length <= overview.coordinates.length
    || distanceMeters(coordinates[0], overview.coordinates[0] as LngLatTuple) > 0.2
    || distanceMeters(coordinates.at(-1)!, overview.coordinates.at(-1)! as LngLatTuple) > 0.2) return overview;
  return { type: "LineString", coordinates };
}
