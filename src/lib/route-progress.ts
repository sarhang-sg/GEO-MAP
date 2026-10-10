import { bearingBetween, distanceMeters, shortestHeadingDelta, type LngLatTuple } from "./location";

export type RouteProgressMeasurement = {
  totalMeters: number; progressedMeters: number; remainingMeters: number;
  offRouteMeters: number; segmentIndex: number; fraction: number; coordinate: LngLatTuple;
};
export type RouteProgressHint = { previousMeters: number; maxAdvanceMeters: number; heading?: number | null; accuracy?: number };
const lengths = new WeakMap<readonly LngLatTuple[], { segments: number[]; cumulative: number[]; total: number }>();
function routeLengths(route: readonly LngLatTuple[]) {
  let cached = lengths.get(route);
  if (!cached) {
    const segments: number[] = [], cumulative = [0]; let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const length = distanceMeters(route[i], route[i + 1]); segments.push(length); total += length; cumulative.push(total);
    }
    cached = { segments, cumulative, total }; lengths.set(route, cached);
  }
  return cached;
}

/** GPS projection with continuity: crossings must not jump to a later lap. */
export function measureRouteProgress(position: LngLatTuple, route: readonly LngLatTuple[], hint?: RouteProgressHint): RouteProgressMeasurement | null {
  if (route.length < 2) return null;
  const { segments, cumulative, total } = routeLengths(route);
  if (!(total > 0)) return null;
  const scaleY = Math.PI / 180 * 6_371_008.8, scaleX = scaleY * Math.max(0.2, Math.cos(position[1] * Math.PI / 180));
  let bestScore = Infinity, best: RouteProgressMeasurement | null = null;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] <= 0) continue;
    const a = route[i], b = route[i + 1];
    const ax = (a[0] - position[0]) * scaleX, ay = (a[1] - position[1]) * scaleY;
    const dx = (b[0] - a[0]) * scaleX, dy = (b[1] - a[1]) * scaleY;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    const offRoute = Math.hypot(ax + fraction * dx, ay + fraction * dy);
    const progress = cumulative[i] + fraction * segments[i];
    let score = offRoute;
    if (hint) {
      const change = progress - hint.previousMeters;
      score += Math.max(0, change - hint.maxAdvanceMeters) * 0.7;
      score += Math.max(0, -change - Math.max(15, hint.accuracy ?? 15)) * 0.45;
      const bearing = bearingBetween(a, b);
      if (bearing !== null && hint.heading != null) score += Math.abs(shortestHeadingDelta(hint.heading, bearing)) / 180 * 12;
    }
    // On the first fix, the earliest equally close segment is the safe choice.
    if (score >= bestScore - 0.01) continue;
    bestScore = score;
    best = { totalMeters: total, progressedMeters: progress, remainingMeters: Math.max(0, total - progress), offRouteMeters: offRoute,
      segmentIndex: i, fraction, coordinate: [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])] };
  }
  return best;
}

export function routeCoordinateAt(route: readonly LngLatTuple[], meters: number): LngLatTuple | null {
  if (!route.length) return null;
  const { segments, cumulative, total } = routeLengths(route);
  const at = Math.max(0, Math.min(total, meters));
  for (let i = 0; i < segments.length; i++) if (segments[i] > 0 && at <= cumulative[i + 1]) {
    const t = (at - cumulative[i]) / segments[i];
    return [route[i][0] + t * (route[i + 1][0] - route[i][0]), route[i][1] + t * (route[i + 1][1] - route[i][1])];
  }
  return [...route[route.length - 1]];
}

export function routeSlice(route: readonly LngLatTuple[], start: number, end = Infinity): LngLatTuple[] {
  const first = routeCoordinateAt(route, start), last = routeCoordinateAt(route, end);
  if (!first || !last || end <= start) return [];
  const { cumulative } = routeLengths(route);
  return [first, ...route.filter((_, i) => cumulative[i] > start && cumulative[i] < end), last]
    .filter((point, i, all) => i === 0 || distanceMeters(all[i - 1], point) > 0.05);
}

/** Three independent fixes and a short dwell reject GPS drift at junctions. */
export class RerouteConfirmation {
  private since = 0; private samples = 0; private first: LngLatTuple | null = null; private lastTimestamp = 0;
  reset(): void { this.since = 0; this.samples = 0; this.first = null; this.lastTimestamp = 0; }
  update(input: { offRoute: boolean; coordinate: LngLatTuple; accuracy: number; now: number; timestamp: number; lastRequestAt: number }): boolean {
    if (!input.offRoute || input.accuracy > 60) { this.reset(); return false; }
    if (input.timestamp <= this.lastTimestamp) return false;
    this.lastTimestamp = input.timestamp;
    if (!this.samples) { this.since = input.now; this.first = input.coordinate; }
    this.samples++;
    return this.samples >= 3 && input.now - this.since >= 1800 && input.now - input.lastRequestAt >= 6000
      && this.first !== null && distanceMeters(this.first, input.coordinate) >= Math.max(8, input.accuracy * 0.5);
  }
  get pending(): boolean { return this.samples >= 2; }
}
