import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

export type GeolocationProvider = Pick<
  Geolocation,
  "getCurrentPosition" | "watchPosition" | "clearWatch"
>;

type NativeWatchState = {
  cancelled: boolean;
  nativeId: string | null;
};

const nativeWatches = new Map<number, NativeWatchState>();
let nextNativeWatchId = 100_000;

function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

function permissionError(
  message = "Location permission was denied.",
): GeolocationPositionError {
  return {
    code: 1,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

function normalizeError(error: unknown): GeolocationPositionError {
  const message =
    error instanceof Error
      ? error.message
      : String(error ?? "Location is unavailable.");
  const normalized = message.toLowerCase();
  const code =
    normalized.includes("permission") || normalized.includes("denied")
      ? 1
      : normalized.includes("timeout")
        ? 3
        : 2;
  return {
    code,
    message,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  };
}

function toWebPosition(
  position: Awaited<ReturnType<typeof Geolocation.getCurrentPosition>>,
): GeolocationPosition {
  return {
    coords: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      altitude: position.coords.altitude ?? null,
      altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
      heading: position.coords.heading ?? null,
      speed: position.coords.speed ?? null,
      toJSON: () => ({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude ?? null,
        altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
        heading: position.coords.heading ?? null,
        speed: position.coords.speed ?? null,
      }),
    },
    timestamp: position.timestamp,
    toJSON: () => ({
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        altitude: position.coords.altitude ?? null,
        altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
        heading: position.coords.heading ?? null,
        speed: position.coords.speed ?? null,
      },
      timestamp: position.timestamp,
    }),
  };
}

async function ensureNativePermission(): Promise<void> {
  const current = await Geolocation.checkPermissions();
  if (current.location === "granted" || current.coarseLocation === "granted")
    return;
  const requested = await Geolocation.requestPermissions({
    permissions: ["location", "coarseLocation"],
  });
  if (
    requested.location !== "granted" &&
    requested.coarseLocation !== "granted"
  )
    throw permissionError();
}

const nativeProvider: GeolocationProvider = {
  getCurrentPosition(success, error, options): void {
    void (async () => {
      try {
        await ensureNativePermission();
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeout ?? 18_000,
          maximumAge: options?.maximumAge ?? 0,
        });
        success(toWebPosition(position));
      } catch (caught) {
        error?.(normalizeError(caught));
      }
    })();
  },
  watchPosition(success, error, options): number {
    const localId = nextNativeWatchId++;
    const state: NativeWatchState = { cancelled: false, nativeId: null };
    nativeWatches.set(localId, state);
    void (async () => {
      try {
        await ensureNativePermission();
        const nativeId = await Geolocation.watchPosition(
          {
            enableHighAccuracy: options?.enableHighAccuracy ?? true,
            timeout: options?.timeout ?? 18_000,
            maximumAge: options?.maximumAge ?? 0,
            interval: 500,
            minimumUpdateInterval: 250,
          },
          (position, caught) => {
            if (state.cancelled) return;
            if (caught) {
              error?.(normalizeError(caught));
              return;
            }
            if (position) success(toWebPosition(position));
          },
        );
        state.nativeId = nativeId;
        if (state.cancelled) await Geolocation.clearWatch({ id: nativeId });
      } catch (caught) {
        if (!state.cancelled) error?.(normalizeError(caught));
      }
    })();
    return localId;
  },
  clearWatch(localId: number): void {
    const state = nativeWatches.get(localId);
    if (!state) return;
    state.cancelled = true;
    nativeWatches.delete(localId);
    if (state.nativeId) void Geolocation.clearWatch({ id: state.nativeId });
  },
};

export function getGeolocationProvider(): GeolocationProvider | null {
  if (isNativeRuntime()) return nativeProvider;
  return typeof navigator !== "undefined"
    ? (navigator.geolocation ?? null)
    : null;
}
