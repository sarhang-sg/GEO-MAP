import type { FeatureCollection, Point, Polygon } from "geojson";

export type LngLatTuple = [number, number];

export type LocationPointProperties = {
  accuracy: number;
  heading: number;
  hasHeading: boolean;
};

const EARTH_RADIUS_METERS = 6_371_008.8;

export function distanceMeters(from: LngLatTuple, to: LngLatTuple): number {
  const lat1 = (from[1] * Math.PI) / 180;
  const lat2 = (to[1] * Math.PI) / 180;
  const dLat = lat2 - lat1;
  const dLng = ((to[0] - from[0]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function bearingBetween(
  from: LngLatTuple,
  to: LngLatTuple,
): number | null {
  const lng1 = (from[0] * Math.PI) / 180;
  const lat1 = (from[1] * Math.PI) / 180;
  const lng2 = (to[0] * Math.PI) / 180;
  const lat2 = (to[1] * Math.PI) / 180;
  const dLng = lng2 - lng1;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return Number.isFinite(bearing) ? normalizeHeading(bearing) : null;
}

export function blendCoordinate(
  from: LngLatTuple,
  to: LngLatTuple,
  amount: number,
): LngLatTuple {
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
  ];
}

export function normalizeHeading(heading: number): number {
  return ((heading % 360) + 360) % 360;
}

/** Signed shortest turn from `from` to `to`, constrained to [-180, 180). */
export function shortestHeadingDelta(from: number, to: number): number {
  return (
    ((((normalizeHeading(to) - normalizeHeading(from)) % 360) + 540) % 360) -
    180
  );
}

/** Blend headings across the 0/360 seam without taking the long way around. */
export function blendHeading(from: number, to: number, amount: number): number {
  return normalizeHeading(
    normalizeHeading(from) +
      shortestHeadingDelta(from, to) * Math.max(0, Math.min(1, amount)),
  );
}

/**
 * ScreenOrientation.angle is clockwise. Subtracting it converts a hardware-top
 * compass heading into the direction of the current visual top edge. The old
 * implementation added the angle, which mirrors landscape headings by 180°.
 */
export function applyScreenOrientation(
  heading: number,
  screenAngle = 0,
): number {
  return normalizeHeading(
    heading - (Number.isFinite(screenAngle) ? screenAngle : 0),
  );
}

/**
 * W3C Z-X'-Y'' device-orientation projection. It remains valid while the phone
 * is tilted; a flat-device fallback uses 360-alpha. Only absolute earth-frame
 * samples should be passed to this function.
 */
export function deviceCompassHeading(
  alpha: number,
  beta: number,
  gamma: number,
  screenAngle = 0,
): number | null {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const degreesToRadians = Math.PI / 180;
  const x = beta * degreesToRadians;
  const y = gamma * degreesToRadians;
  const z = alpha * degreesToRadians;
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);
  const vectorX = -cZ * sY - sZ * sX * cY;
  const vectorY = -sZ * sY + cZ * sX * cY;
  const horizontalMagnitude = Math.hypot(vectorX, vectorY);
  if (horizontalMagnitude > 0.08) {
    // The projected back-of-screen vector is already independent of display
    // rotation, so applying ScreenOrientation here would rotate it twice.
    return normalizeHeading((Math.atan2(vectorX, vectorY) * 180) / Math.PI);
  }
  return applyScreenOrientation(360 - alpha, screenAngle);
}

export type CircularHeadingSummary = {
  heading: number;
  spread: number;
};

/** Circular mean plus maximum angular deviation, used as compass confidence. */
export function summarizeHeadings(
  headings: readonly number[],
): CircularHeadingSummary | null {
  const finite = headings.filter(Number.isFinite).map(normalizeHeading);
  if (finite.length === 0) return null;
  const vector = finite.reduce(
    (sum, heading) => {
      const radians = (heading * Math.PI) / 180;
      sum.x += Math.sin(radians);
      sum.y += Math.cos(radians);
      return sum;
    },
    { x: 0, y: 0 },
  );
  if (Math.hypot(vector.x, vector.y) < 1e-6) return null;
  const heading = normalizeHeading(
    (Math.atan2(vector.x, vector.y) * 180) / Math.PI,
  );
  const spread = finite.reduce(
    (maximum, sample) =>
      Math.max(maximum, Math.abs(shortestHeadingDelta(heading, sample))),
    0,
  );
  return { heading, spread };
}

export function clampAccuracy(accuracy = 0): number {
  return Math.max(15, Math.min(240, accuracy || 30));
}

export type StabilizedCoordinateSample = {
  coordinate: LngLatTuple;
  rejectedJump: boolean;
};

/**
 * Stabilize one GPS sample without allowing a short-lived receiver teleport to
 * move the marker or route origin. The threshold intentionally remains
 * conservative enough for motorway travel and imprecise mobile fixes.
 */
export function stabilizeCoordinateSample(
  previous: LngLatTuple | null,
  incoming: LngLatTuple,
  accuracy = 0,
  interactionLocked = false,
  elapsedMs = Number.POSITIVE_INFINITY,
  reportedSpeed: number | null = null,
): StabilizedCoordinateSample {
  if (!previous) return { coordinate: incoming, rejectedJump: false };
  const distance = distanceMeters(previous, incoming);
  const finiteSpeed =
    typeof reportedSpeed === "number" &&
    Number.isFinite(reportedSpeed) &&
    reportedSpeed >= 0
      ? reportedSpeed
      : 0;
  const accuracyMeters = Math.max(0, accuracy || 0);
  const gpsJitterThreshold =
    finiteSpeed >= 2
      ? Math.max(1.2, Math.min(5, accuracyMeters * 0.06))
      : finiteSpeed >= 0.35
        ? Math.max(1.8, Math.min(8, accuracyMeters * 0.1))
        : Math.max(2.5, Math.min(12, accuracyMeters * 0.16));
  if (distance <= gpsJitterThreshold)
    return { coordinate: previous, rejectedJump: false };
  if (interactionLocked && distance <= Math.max(28, gpsJitterThreshold * 1.8)) {
    return { coordinate: previous, rejectedJump: false };
  }

  const elapsedSeconds = Number.isFinite(elapsedMs)
    ? Math.max(0, elapsedMs) / 1000
    : Number.POSITIVE_INFINITY;
  if (elapsedSeconds <= 120) {
    const plausibleMetersPerSecond = Math.max(
      90,
      Math.min(140, finiteSpeed * 3 + 25),
    );
    const accuracyAllowance = Math.min(Math.max(accuracy || 0, 0), 240) * 4;
    const maximumPlausibleDistance = Math.max(
      220,
      accuracyAllowance,
      elapsedSeconds * plausibleMetersPerSecond + 120,
    );
    if (distance > maximumPlausibleDistance)
      return { coordinate: previous, rejectedJump: true };
  }

  if (distance <= 90) {
    const amount =
      finiteSpeed >= 8 ? 0.9 :
      finiteSpeed >= 2 ? 0.78 :
      finiteSpeed >= 0.65 ? 0.64 : 0.5;
    return {
      coordinate: blendCoordinate(previous, incoming, amount),
      rejectedJump: false,
    };
  }
  return { coordinate: incoming, rejectedJump: false };
}

export function emptyLocationPointCollection(): FeatureCollection<
  Point,
  LocationPointProperties
> {
  return { type: "FeatureCollection", features: [] };
}

export function locationPointFeature(
  center: LngLatTuple,
  heading: number | null,
  accuracy: number,
): FeatureCollection<Point, LocationPointProperties> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          accuracy: clampAccuracy(accuracy),
          heading: heading === null ? 0 : normalizeHeading(heading),
          hasHeading: heading !== null,
        },
        geometry: { type: "Point", coordinates: center },
      },
    ],
  };
}

export function emptyAccuracyCollection(): FeatureCollection<
  Polygon,
  { accuracy: number }
> {
  return { type: "FeatureCollection", features: [] };
}

function destinationPoint(
  center: LngLatTuple,
  bearingDegrees: number,
  distanceMeters: number,
): LngLatTuple {
  const bearing = (bearingDegrees * Math.PI) / 180;
  const lng = (center[0] * Math.PI) / 180;
  const lat = (center[1] * Math.PI) / 180;
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const nextLat = Math.asin(
    Math.sin(lat) * Math.cos(angularDistance) +
      Math.cos(lat) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLng =
    lng +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat),
      Math.cos(angularDistance) - Math.sin(lat) * Math.sin(nextLat),
    );
  return [
    (((nextLng * 180) / Math.PI + 540) % 360) - 180,
    (nextLat * 180) / Math.PI,
  ];
}

export function accuracyCircleFeature(
  center: LngLatTuple,
  radiusMeters: number,
): FeatureCollection<Polygon, { accuracy: number }> {
  const radius = clampAccuracy(radiusMeters);
  const coordinates: LngLatTuple[] = [];
  for (let step = 0; step <= 72; step += 1)
    coordinates.push(destinationPoint(center, (step / 72) * 360, radius));
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { accuracy: radius },
        geometry: { type: "Polygon", coordinates: [coordinates] },
      },
    ],
  };
}
