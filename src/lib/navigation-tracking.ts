import { bearingBetween, distanceMeters, normalizeHeading, shortestHeadingDelta, type LngLatTuple } from "./location";

export type TravelMode = "car" | "bicycle" | "walking";
const PROFILES = {
  walking: { courseSpeed: 0.55, courseAccuracy: 30, offRoute: 12, backwards: 12, maxAccuracy: 30, movement: 3, decisiveMovement: 4, dwell: 2400, decisiveDwell: 1800 },
  bicycle: { courseSpeed: 0.9, courseAccuracy: 40, offRoute: 18, backwards: 20, maxAccuracy: 40, movement: 5, decisiveMovement: 7, dwell: 2000, decisiveDwell: 1400 },
  car: { courseSpeed: 1.8, courseAccuracy: 40, offRoute: 25, backwards: 30, maxAccuracy: 60, movement: 8, decisiveMovement: 12, dwell: 1800, decisiveDwell: 1200 },
} as const;
export function navigationProfile(mode: TravelMode = "car") { return PROFILES[mode] ?? PROFILES.car; }

/** Accumulate enough recent movement to resolve walking course without amplifying GPS jitter. */
export class MovementCourseTracker {
  private samples: Array<{ coordinate: LngLatTuple; at: number; accuracy: number }> = [];
  reset(): void { this.samples = []; }
  update(coordinate: LngLatTuple, at: number, accuracy: number, speed: number, mode: TravelMode = "car"): { heading: number; confidence: number } | null {
    const profile = navigationProfile(mode);
    if (!Number.isFinite(at) || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > profile.courseAccuracy
      || !coordinate.every(Number.isFinite) || !Number.isFinite(speed) || speed < profile.courseSpeed) {
      this.reset(); return null;
    }
    const latest = this.samples[this.samples.length - 1];
    if (latest && at <= latest.at) return null;
    if (latest && at - latest.at > 10_000) this.reset();
    this.samples = this.samples.filter(sample => at - sample.at <= 8000).slice(-31);
    const threshold = Math.max(mode === "walking" ? 3 : 4, accuracy * 0.8);
    let result: { heading: number; confidence: number } | null = null;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      const sample = this.samples[i], seconds = (at - sample.at) / 1000;
      if (seconds < 0.75) continue;
      const moved = distanceMeters(sample.coordinate, coordinate);
      if (moved < Math.max(threshold, sample.accuracy * 0.8)) continue;
      if (moved / seconds > (mode === "walking" ? 8 : mode === "bicycle" ? 25 : 90)) { this.reset(); break; }
      const heading = bearingBetween(sample.coordinate, coordinate);
      if (heading !== null) result = { heading, confidence: Math.min(0.94, 0.65 + moved / Math.max(20, accuracy * 6) * 0.2) };
      break;
    }
    this.samples.push({ coordinate: [...coordinate], at, accuracy });
    return result;
  }
}

export function trustedTravelCourse(input: {
  headingDegrees: number | null; headingSource: string; headingConfidence: number;
  accuracyMeters: number; speedMetersPerSecond: number;
}, mode: TravelMode = "car"): number | null {
  const profile = navigationProfile(mode);
  return input.headingDegrees !== null && Number.isFinite(input.headingDegrees)
    && Number.isFinite(input.accuracyMeters) && input.accuracyMeters > 0 && input.accuracyMeters <= profile.courseAccuracy
    && Number.isFinite(input.speedMetersPerSecond) && input.speedMetersPerSecond >= profile.courseSpeed
    && Number.isFinite(input.headingConfidence) && input.headingConfidence >= 0.65
    && (input.headingSource === "gps-course" || input.headingSource === "movement-course")
    ? normalizeHeading(input.headingDegrees) : null;
}

/** Preserve orientation at rest and choose the short arc when crossing north. */
export function followCameraBearing(current: number, course: number | null): number {
  if (course === null || !Number.isFinite(course)) return current;
  const delta = shortestHeadingDelta(current, course);
  return Math.abs(delta) >= 3 ? current + delta : current;
}
