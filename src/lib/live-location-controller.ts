import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { UI } from "./i18n";
import {
  ensureLiveLocationLayers,
  liveLocationLayersReady,
  LOCATION_ACCURACY_SOURCE,
  LOCATION_POINT_SOURCE,
} from "./live-location-layers";
import {
  accuracyCircleFeature,
  applyScreenOrientation,
  bearingBetween,
  blendCoordinate,
  blendHeading,
  clampAccuracy,
  deviceCompassHeading,
  distanceMeters,
  emptyAccuracyCollection,
  emptyLocationPointCollection,
  locationPointFeature,
  normalizeHeading,
  shortestHeadingDelta,
  stabilizeCoordinateSample,
  summarizeHeadings,
  type LngLatTuple,
  type StabilizedCoordinateSample,
} from "./location";
import type { Language } from "./types";
import {
  getGeolocationProvider,
  type GeolocationProvider,
} from "./native-geolocation";

export type LocationMessageKind = "normal" | "error" | "success";

export type HeadingSource =
  | "gps-course"
  | "movement-course"
  | "compass"
  | "held"
  | "none";

export type LiveLocationDiagnosticSnapshot = {
  watching: boolean;
  following: boolean;
  hasCoordinate: boolean;
  coordinate: LngLatTuple | null;
  accuracyMeters: number;
  headingDegrees: number | null;
  headingSource: HeadingSource;
  headingConfidence: number;
  speedMetersPerSecond: number;
};

type LiveLocationControllerOptions = {
  map: MapLibreMap;
  getLanguage: () => Language;
  setMessage: (message: string, kind?: LocationMessageKind) => void;
  trackingButtons: readonly HTMLElement[];
  onLocationUpdate?: (snapshot: LiveLocationDiagnosticSnapshot) => void;
};

const INITIAL_FIX_MAX_AGE_MS = 30_000;
const INITIAL_FIX_MAX_ACCURACY_METERS = 650;
const TRACKING_PREFERENCE_KEY = "nav-kurd:gps:active";
const STALE_WATCH_MS = 22_000;

function readTrackingPreference(): boolean {
  try { return localStorage.getItem(TRACKING_PREFERENCE_KEY) === "1"; }
  catch { return false; }
}

function writeTrackingPreference(active: boolean): void {
  try {
    if (active) localStorage.setItem(TRACKING_PREFERENCE_KEY, "1");
    else localStorage.removeItem(TRACKING_PREFERENCE_KEY);
  } catch { /* GPS remains usable when browser storage is unavailable. */ }
}

/** Owns GPS state, follow mode and MapLibre location sources/layers. */
export class LiveLocationController {
  private readonly map: MapLibreMap;
  private readonly getLanguage: () => Language;
  private readonly setMessage: (
    message: string,
    kind?: LocationMessageKind,
  ) => void;
  private readonly trackingButtons: readonly HTMLElement[];
  private readonly onLocationUpdate?: (
    snapshot: LiveLocationDiagnosticSnapshot,
  ) => void;
  private readonly geolocation: GeolocationProvider | null =
    getGeolocationProvider();
  private watchId: number | null = null;
  private watchWanted = readTrackingPreference();
  private requestInFlight = false;
  private lastPositionAt = 0;
  private orientationPermissionRequested = false;
  private lastAbsoluteOrientationAt = 0;
  private watchStartedAt = 0;
  private watchdogTimer = 0;
  private locationReadyAnnounced = false;
  private followEnabled = false;
  private pendingCameraFocus = false;
  private watchGeneration = 0;
  private readonly finishCameraMove = (): void => { this.programmaticMove = false; };
  private lastCoordinate: LngLatTuple | null = null;
  private lastHeading: number | null = null;
  private lastHeadingSource: HeadingSource = "none";
  private lastHeadingConfidence = 0;
  private lastSpeed = 0;
  private lastAccuracy = 0;
  private lastRenderedAccuracyCoordinate: LngLatTuple | null = null;
  private lastRenderedAccuracyMeters = Number.NaN;
  private lastAcceptedPositionTimestamp = 0;
  private lastRawCoordinate: LngLatTuple | null = null;
  private lastRawPositionAt = 0;
  private pendingJump: { coordinate: LngLatTuple; accuracy: number; at: number } | null = null;
  private lastGoodAccuracy = Number.POSITIVE_INFINITY;
  private lastGoodAccuracyAt = 0;
  private lastCourseHeadingAt = 0;
  private lastOrientationHeading: number | null = null;
  private lastOrientationAt = 0;
  private lastOrientationPaintAt = 0;
  private orientationConfidence = 0;
  private lastStableCompassHeading: number | null = null;
  private compassCalibrationOffset = 0;
  private compassCalibrationReady = false;
  private readonly orientationSamples: Array<{ heading: number; at: number }> =
    [];
  private lastRecenterAt = 0;
  private interactionLockUntil = 0;
  private programmaticMove = false;
  private restoreFrame: number | null = null;

  private smoothHeading(nextHeading: number, amount = 0.26): number {
    const normalized = normalizeHeading(nextHeading);
    if (this.lastHeading === null || !Number.isFinite(this.lastHeading))
      return normalized;
    return blendHeading(
      this.lastHeading,
      normalized,
      Math.max(0.05, Math.min(1, amount)),
    );
  }

  constructor(options: LiveLocationControllerOptions) {
    this.map = options.map;
    this.getLanguage = options.getLanguage;
    this.setMessage = options.setMessage;
    this.trackingButtons = options.trackingButtons;
    this.onLocationUpdate = options.onLocationUpdate;
    this.installOrientationTracking();
    this.installWatchRecovery();
    this.map.on("style.load", () => this.scheduleVisualRestore());
    this.map.on("styledata", () => {
      if (this.lastCoordinate && !liveLocationLayersReady(this.map))
        this.scheduleVisualRestore();
    });
  }

  get isFollowing(): boolean {
    return this.followEnabled;
  }
  get isProgrammaticCameraMove(): boolean {
    return this.programmaticMove;
  }

  diagnosticSnapshot(): LiveLocationDiagnosticSnapshot {
    return {
      watching: this.watchId !== null,
      following: this.followEnabled,
      hasCoordinate: this.lastCoordinate !== null,
      coordinate: this.lastCoordinate
        ? ([...this.lastCoordinate] as LngLatTuple)
        : null,
      accuracyMeters: this.lastAccuracy,
      headingDegrees: this.lastHeading,
      headingSource: this.lastHeadingSource,
      headingConfidence: this.lastHeadingConfidence,
      speedMetersPerSecond: this.lastSpeed,
    };
  }

  lockAgainstGpsJitter(): void {
    this.interactionLockUntil = window.performance.now() + 1600;
  }

  stopFollow(): void {
    this.pendingCameraFocus = false;
    this.setFollowEnabled(false);
  }

  locate(focus = true): void {
    const language = this.getLanguage();
    this.watchWanted = true;
    writeTrackingPreference(true);
    const geolocation = this.geolocation;
    if (!geolocation) {
      this.watchWanted = false;
      writeTrackingPreference(false);
      this.setMessage(UI[language].locationUnavailable, "error");
      return;
    }
    this.setFollowEnabled(focus);
    this.pendingCameraFocus = focus;
    this.interactionLockUntil = 0;
    this.lastRecenterAt = 0;
    this.setMessage(UI[language].locating);
    this.requestOrientationPermission();
    // A deliberate locate tap always recenters immediately when a confirmed fix
    // is already available. A parallel fresh request can refine it afterwards.
    if (focus && this.lastCoordinate && Date.now() - this.lastPositionAt <= INITIAL_FIX_MAX_AGE_MS) {
      this.recenter(true);
      this.pendingCameraFocus = false;
      this.setMessage(UI[language].locationReady, "success");
    }
    if (this.requestInFlight) return;
    if (this.watchId !== null) return;
    this.requestInFlight = true;
    const requestGeneration = ++this.watchGeneration;

    const onSuccess = (position: GeolocationPosition): void => {
      if (requestGeneration !== this.watchGeneration || !this.watchWanted) return;
      const explicitRequest = this.requestInFlight;
      const firstFix = this.lastCoordinate === null;

      const receivedAt = Date.now();
      const sampleTimestamp =
        Number.isFinite(position.timestamp) && position.timestamp > 0
          ? position.timestamp
          : receivedAt;
      const rawAccuracy =
        typeof position.coords.accuracy === "number" &&
        Number.isFinite(position.coords.accuracy)
          ? Math.max(0, position.coords.accuracy)
          : 999;
      const sampleAgeMs = Math.max(0, receivedAt - sampleTimestamp);

      // Paint a recent network/cached position immediately, then refine it with
      // the high-accuracy request and watch. The earlier strict 80 m gate forced a
      // visible 4–10 second wait even when Android already had a useful fix.
      if (firstFix) {
        if (sampleAgeMs > INITIAL_FIX_MAX_AGE_MS) return;
        if (rawAccuracy > INITIAL_FIX_MAX_ACCURACY_METERS) return;
      }

      this.requestInFlight = false;
      if (
        this.shouldRejectDegradedFix(sampleTimestamp, rawAccuracy, receivedAt)
      )
        return;

      const incomingCoordinate: LngLatTuple = [
        position.coords.longitude,
        position.coords.latitude,
      ];
      const elapsedMs =
        this.lastPositionAt > 0
          ? Math.max(0, receivedAt - this.lastPositionAt)
          : Number.POSITIVE_INFINITY;
      const reportedSpeed =
        typeof position.coords.speed === "number" &&
        Number.isFinite(position.coords.speed) &&
        position.coords.speed >= 0
          ? position.coords.speed
          : null;
      let stabilized = this.stableCoordinate(
        incomingCoordinate,
        rawAccuracy,
        elapsedMs,
        reportedSpeed ?? 0,
      );
      if (stabilized.rejectedJump) {
        const pending = this.pendingJump;
        const confirmationRadius = Math.max(45, Math.min(220, rawAccuracy * 1.4, (pending?.accuracy ?? rawAccuracy) * 1.4));
        const confirmsPending = pending
          && receivedAt - pending.at <= 8_000
          && distanceMeters(pending.coordinate, incomingCoordinate) <= confirmationRadius;
        if (!confirmsPending) {
          this.pendingJump = { coordinate: incomingCoordinate, accuracy: rawAccuracy, at: receivedAt };
          return;
        }
        // Two independent, spatially consistent fixes confirm a genuine
        // relocation after resume while a single receiver teleport is ignored.
        stabilized = { coordinate: blendCoordinate(pending.coordinate, incomingCoordinate, 0.65), rejectedJump: false };
      }
      this.pendingJump = null;

      const previousRawCoordinate = this.lastRawCoordinate;
      const rawElapsedMs =
        this.lastRawPositionAt > 0
          ? Math.max(1, sampleTimestamp - this.lastRawPositionAt)
          : Number.POSITIVE_INFINITY;
      const rawMovedMeters = previousRawCoordinate
        ? distanceMeters(previousRawCoordinate, incomingCoordinate)
        : 0;
      const calculatedSpeed =
        Number.isFinite(rawElapsedMs) && rawElapsedMs > 0
          ? rawMovedMeters / (rawElapsedMs / 1000)
          : 0;
      const effectiveSpeed =
        reportedSpeed === null
          ? calculatedSpeed
          : Math.max(reportedSpeed, calculatedSpeed * 0.75);
      const course = this.resolveCourseHeading(
        position,
        previousRawCoordinate,
        incomingCoordinate,
        rawMovedMeters,
        rawElapsedMs,
        effectiveSpeed,
        rawAccuracy,
      );

      this.lastPositionAt = receivedAt;
      this.lastAcceptedPositionTimestamp = Math.max(
        this.lastAcceptedPositionTimestamp,
        sampleTimestamp,
      );
      this.lastRawCoordinate = incomingCoordinate;
      this.lastRawPositionAt = sampleTimestamp;
      this.lastSpeed = Math.max(0, Math.min(120, effectiveSpeed || 0));
      if (rawAccuracy <= 100) {
        this.lastGoodAccuracy = rawAccuracy;
        this.lastGoodAccuracyAt = receivedAt;
      }

      let heading = this.lastHeading;
      let headingSource: HeadingSource = heading === null ? "none" : "held";
      let headingConfidence = Math.max(0, this.lastHeadingConfidence * 0.985);
      if (course) {
        this.lastCourseHeadingAt = receivedAt;
        this.calibrateCompassAgainstCourse(course.heading, effectiveSpeed);
        heading = course.heading;
        headingSource = course.source;
        headingConfidence = course.confidence;
      } else if (
        !this.courseHeadingLocked(receivedAt) &&
        effectiveSpeed < 0.8 &&
        this.lastHeadingSource === "compass" &&
        this.lastHeading !== null
      ) {
        // Keep the already-vetted stationary compass result. Raw orientation
        // samples are never promoted from the GPS callback, which prevents an
        // unstable sensor burst from rotating the marker between fixes.
        heading = this.lastHeading;
        headingSource = "compass";
        headingConfidence = this.lastHeadingConfidence;
      }

      this.show(
        stabilized.coordinate,
        heading,
        rawAccuracy,
        this.followEnabled,
        headingSource,
        headingConfidence,
        effectiveSpeed,
      );
      if (this.pendingCameraFocus && this.followEnabled) {
        this.pendingCameraFocus = false;
        this.recenter(true);
      }
      if (firstFix || explicitRequest || !this.locationReadyAnnounced) {
        this.locationReadyAnnounced = true;
        this.setMessage(UI[this.getLanguage()].locationReady, "success");
      }
    };
    const onError = (error: GeolocationPositionError): void => {
      if (requestGeneration !== this.watchGeneration) return;
      const explicitRequest = this.requestInFlight;
      this.requestInFlight = false;
      if (error.code === error.PERMISSION_DENIED) {
        this.watchWanted = false;
        writeTrackingPreference(false);
        if (this.watchId !== null) geolocation.clearWatch(this.watchId);
        this.watchId = null;
        this.pendingCameraFocus = false;
        this.setFollowEnabled(false);
        this.setMessage(UI[this.getLanguage()].locationDenied, "error");
        return;
      }
      // A failed initial request ends acquisition; an explicit tap can retry.
      // A running navigation watch retains its last valid position.
      if (!this.lastCoordinate) {
        this.watchWanted = false;
        writeTrackingPreference(false);
        if (this.watchId !== null) geolocation.clearWatch(this.watchId);
        this.watchId = null;
        this.pendingCameraFocus = false;
        this.setFollowEnabled(false);
      }
      if (explicitRequest || !this.lastCoordinate) {
        const copy = UI[this.getLanguage()];
        this.setMessage(error.code === error.TIMEOUT ? copy.locationTimeout : copy.locationUnavailable, "error");
      }
    };
    // One provider watch supplies the initial cached/fresh fix and subsequent
    // updates. Repeated taps reuse it; no concurrent one-shot receivers exist.
    const watchOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 15_000,
    };
    this.watchStartedAt = Date.now();
    if (this.watchId === null) {
      try {
        this.watchId = geolocation.watchPosition(onSuccess, onError, watchOptions);
      } catch {
        this.requestInFlight = false;
        this.watchWanted = false;
        writeTrackingPreference(false);
        this.pendingCameraFocus = false;
        this.setFollowEnabled(false);
        this.setMessage(UI[this.getLanguage()].locationUnavailable, "error");
      }
    }
  }

  updateLayers(): void {
    if (!this.map.isStyleLoaded()) {
      this.scheduleVisualRestore();
      return;
    }
    // Snapshot the mutable coordinate once so TypeScript and the renderer use
    // the same confirmed GPS fix throughout this update cycle.
    const currentCoordinate = this.lastCoordinate;
    const accuracyData = currentCoordinate
      ? accuracyCircleFeature(currentCoordinate, this.lastAccuracy)
      : emptyAccuracyCollection();
    const pointData = currentCoordinate
      ? locationPointFeature(
          currentCoordinate,
          this.lastHeading,
          this.lastAccuracy,
        )
      : emptyLocationPointCollection();
    ensureLiveLocationLayers(this.map, pointData, accuracyData);
    const accuracySource = this.map.getSource(LOCATION_ACCURACY_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    const pointSource = this.map.getSource(LOCATION_POINT_SOURCE) as
      | maplibregl.GeoJSONSource
      | undefined;
    const shouldUpdateAccuracy = currentCoordinate !== null && (
      this.lastRenderedAccuracyCoordinate === null
      || distanceMeters(this.lastRenderedAccuracyCoordinate, currentCoordinate) >= 0.75
      || !Number.isFinite(this.lastRenderedAccuracyMeters)
      || Math.abs(this.lastRenderedAccuracyMeters - this.lastAccuracy) >= 0.5
    );
    if (shouldUpdateAccuracy && currentCoordinate) {
      accuracySource?.setData(accuracyData);
      this.lastRenderedAccuracyCoordinate = [currentCoordinate[0], currentCoordinate[1]];
      this.lastRenderedAccuracyMeters = this.lastAccuracy;
    }
    pointSource?.setData(pointData);
  }

  /** Re-assert the last confirmed GPS coordinate after a style/mode mutation. */
  restoreVisualState(): void {
    this.updateLayers();
    this.scheduleVisualRestore();
  }

  recenter(initialCenter = false): void {
    if (!this.lastCoordinate) return;
    const now = window.performance.now();
    if (!initialCenter && now - this.lastRecenterAt <= 2600) return;
    this.lastRecenterAt = now;
    this.map.stop();
    this.map.off("moveend", this.finishCameraMove);
    this.programmaticMove = true;
    this.map.once("moveend", this.finishCameraMove);
    const focusZoom = this.lastAccuracy <= 60
      ? 16.0
      : this.lastAccuracy <= 180
        ? 15.5
        : this.lastAccuracy <= 400
          ? 14.8
          : 14.2;
    this.map.easeTo({
      center: this.lastCoordinate,
      zoom: initialCenter
        ? Math.max(this.map.getZoom(), focusZoom)
        : this.map.getZoom(),
      duration: initialCenter ? 480 : 220,
      essential: true,
    });
    if (!this.map.isMoving()) {
      this.map.off("moveend", this.finishCameraMove);
      this.finishCameraMove();
    }
  }

  private installWatchRecovery(): void {
    let hiddenAt = document.hidden ? Date.now() : 0;
    const recover = (force = false): void => {
      // GPS must continue to work while map/network data is offline. Geolocation
      // is a device capability and must never be gated by connectivity state.
      const geolocation = this.geolocation;
      if (!this.watchWanted || document.hidden || !geolocation) return;
      const now = Date.now();
      const waitingTooLong =
        this.lastPositionAt === 0 &&
        this.watchStartedAt > 0 &&
        now - this.watchStartedAt > STALE_WATCH_MS;
      const stale =
        this.lastPositionAt > 0 && now - this.lastPositionAt > STALE_WATCH_MS;
      if (!force && this.watchId !== null && !stale && !waitingTooLong) return;
      if (this.watchId !== null) geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.watchStartedAt = 0;
      this.requestInFlight = false;
      this.locate(this.followEnabled);
    };
    const startWatchdog = (): void => {
      if (this.watchdogTimer !== 0) return;
      this.watchdogTimer = window.setInterval(() => recover(false), 15_000);
    };
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) {
          hiddenAt = Date.now();
          return;
        }
        const hiddenFor = hiddenAt > 0 ? Date.now() - hiddenAt : 0;
        hiddenAt = 0;
        // Android may leave a non-null WebView watch ID backed by a dead
        // provider after process suspension. A sufficiently long background
        // interval is therefore a real restart condition, not a healthy watch.
        recover(hiddenFor >= 8_000);
      },
      { passive: true },
    );
    window.addEventListener("focus", () => recover(false), { passive: true });
    window.addEventListener("nav-kurd:native-resume", () => {
      const stale = this.lastPositionAt === 0 || Date.now() - this.lastPositionAt >= 8_000;
      recover(stale);
    }, {
      passive: true,
    });
    window.addEventListener(
      "pagehide",
      () => {
        if (this.watchdogTimer !== 0) window.clearInterval(this.watchdogTimer);
        this.watchdogTimer = 0;
      },
      { passive: true },
    );
    window.addEventListener(
      "pageshow",
      () => {
        startWatchdog();
        recover(false);
      },
      { passive: true },
    );
    startWatchdog();
    if (this.watchWanted && !document.hidden) {
      window.setTimeout(() => recover(true), 0);
    }
    try {
      void navigator.permissions
        ?.query({ name: "geolocation" as PermissionName })
        .then((permission) => {
          permission.addEventListener("change", () => {
            if (permission.state === "denied") {
              this.watchWanted = false;
              this.watchGeneration += 1;
              this.requestInFlight = false;
              this.pendingCameraFocus = false;
              writeTrackingPreference(false);
              if (this.watchId !== null)
                this.geolocation?.clearWatch(this.watchId);
              this.watchId = null;
              this.watchStartedAt = 0;
              this.setFollowEnabled(false);
            } else if (this.watchWanted) recover(true);
          });
        }).catch(() => undefined);
    } catch {
      /* Permissions API is optional. */
    }
  }

  private requestOrientationPermission(): void {
    if (this.orientationPermissionRequested) return;
    const orientationConstructor =
      window.DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: (
          absolute?: boolean,
        ) => Promise<"granted" | "denied">;
      };
    if (typeof orientationConstructor?.requestPermission !== "function") return;
    this.orientationPermissionRequested = true;
    void orientationConstructor
      .requestPermission(true)
      .catch(() => orientationConstructor.requestPermission?.())
      .catch(() => "denied");
  }

  private screenOrientationAngle(): number {
    const modernAngle = window.screen.orientation?.angle;
    if (typeof modernAngle === "number" && Number.isFinite(modernAngle))
      return modernAngle;
    const fallbackAngle = (window as Window & { orientation?: number })
      .orientation;
    return typeof fallbackAngle === "number" && Number.isFinite(fallbackAngle)
      ? fallbackAngle
      : 0;
  }

  private installOrientationTracking(): void {
    const handleOrientation = (rawEvent: Event): void => {
      const event = rawEvent as DeviceOrientationEvent & {
        webkitCompassHeading?: number;
        webkitCompassAccuracy?: number;
      };
      const now = window.performance.now();
      const screenAngle = this.screenOrientationAngle();
      const webkitAccuracy =
        typeof event.webkitCompassAccuracy === "number" &&
        Number.isFinite(event.webkitCompassAccuracy)
          ? Math.abs(event.webkitCompassAccuracy)
          : null;
      const webkitHeading =
        typeof event.webkitCompassHeading === "number" &&
        Number.isFinite(event.webkitCompassHeading) &&
        (webkitAccuracy === null || webkitAccuracy <= 45)
          ? applyScreenOrientation(event.webkitCompassHeading, screenAngle)
          : null;

      if (rawEvent.type === "deviceorientationabsolute")
        this.lastAbsoluteOrientationAt = now;
      else if (
        webkitHeading === null &&
        now - this.lastAbsoluteOrientationAt < 1800
      )
        return;

      const absoluteReference =
        rawEvent.type === "deviceorientationabsolute" ||
        event.absolute === true;
      const projectedHeading =
        absoluteReference &&
        typeof event.alpha === "number" &&
        Number.isFinite(event.alpha) &&
        typeof event.beta === "number" &&
        Number.isFinite(event.beta) &&
        typeof event.gamma === "number" &&
        Number.isFinite(event.gamma)
          ? deviceCompassHeading(
              event.alpha,
              event.beta,
              event.gamma,
              screenAngle,
            )
          : null;
      const heading = webkitHeading ?? projectedHeading;
      if (heading === null) return;

      this.orientationSamples.push({ heading, at: now });
      while (
        this.orientationSamples.length > 4 ||
        (this.orientationSamples[0] &&
          now - this.orientationSamples[0].at > 320)
      ) {
        this.orientationSamples.shift();
      }
      const summary = summarizeHeadings(
        this.orientationSamples.map((sample) => sample.heading),
      );
      if (!summary || this.orientationSamples.length < 2) return;
      const accuracyPenalty =
        webkitAccuracy === null ? 0 : Math.min(0.45, webkitAccuracy / 90);
      const spreadPenalty = Math.min(0.8, summary.spread / 55);
      this.orientationConfidence = Math.max(
        0,
        Math.min(1, 1 - accuracyPenalty - spreadPenalty),
      );
      if (summary.spread > 34 || this.orientationConfidence < 0.30) return;
      // Two coherent recent samples remove the slow initial rotation while the
      // circular spread gate still rejects magnetic spikes.
      if (summary.spread > 28 || this.orientationConfidence < 0.38) return;

      if (this.lastOrientationHeading !== null) {
        const jump = Math.abs(
          shortestHeadingDelta(this.lastOrientationHeading, summary.heading),
        );
        if (jump > 115 && now - this.lastOrientationAt < 90) return;
      }
      this.lastOrientationHeading = summary.heading;
      this.lastOrientationAt = now;

      // Compass samples are retained for stationary use and calibration, but
      // they never override a recent GPS/movement course. This is the core fix
      // for the arrow spinning or pointing sideways while the user is moving.
      if (this.courseHeadingLocked(Date.now())) return;
      if (!this.watchWanted || !this.lastCoordinate) return;
      if (now - this.lastOrientationPaintAt < 32) return;
      const calibrated = this.calibratedCompassHeading();
      if (calibrated === null) return;
      const stableHeading = this.acceptResponsiveCompass(calibrated);
      if (stableHeading === null) return;
      this.lastOrientationPaintAt = now;
      this.lastHeading = this.smoothHeading(stableHeading, 0.76);
      this.lastHeadingSource = "compass";
      this.lastHeadingConfidence = this.orientationConfidence;
      this.updateLayers();
    };
    window.addEventListener("deviceorientationabsolute", handleOrientation as EventListener, { passive: true });
    window.addEventListener(
      "deviceorientation",
      handleOrientation as EventListener,
      { passive: true },
    );
    const resetForScreenRotation = (): void => {
      this.orientationSamples.length = 0;
      this.lastOrientationHeading = null;
      this.lastStableCompassHeading = null;
      this.lastOrientationPaintAt = 0;
    };
    window.screen.orientation?.addEventListener("change", resetForScreenRotation);
    window.addEventListener("orientationchange", resetForScreenRotation, { passive: true });
  }

  private acceptResponsiveCompass(heading: number): number | null {
    const normalized = normalizeHeading(heading);
    const reference = this.lastStableCompassHeading ?? this.lastHeading;
    if (reference === null) {
      this.lastStableCompassHeading = normalized;
      return normalized;
    }

    const delta = Math.abs(shortestHeadingDelta(reference, normalized));
    // Hold sub-degree magnetometer chatter, not intentional phone rotation.
    if (delta <= 1.35) return null;

    const amount =
      delta >= 70 ? 0.92 :
      delta >= 35 ? 0.82 :
      delta >= 15 ? 0.72 :
      delta >= 6 ? 0.60 : 0.48;
    this.lastStableCompassHeading = blendHeading(reference, normalized, amount);
    return this.lastStableCompassHeading;
  }

  private setFollowEnabled(enabled: boolean): void {
    this.followEnabled = enabled;
    this.trackingButtons.forEach((button) =>
      button.classList.toggle("is-tracking", enabled),
    );
  }

  private stableCoordinate(
    incoming: LngLatTuple,
    accuracy = 0,
    elapsedMs = Number.POSITIVE_INFINITY,
    speed = 0,
  ): StabilizedCoordinateSample {
    const interactionLocked =
      window.performance.now() < this.interactionLockUntil;
    return stabilizeCoordinateSample(
      this.lastCoordinate,
      incoming,
      accuracy,
      interactionLocked,
      elapsedMs,
      speed,
    );
  }

  private shouldRejectDegradedFix(
    sampleTimestamp: number,
    accuracy: number,
    receivedAt: number,
  ): boolean {
    if (sampleTimestamp + 1 < this.lastAcceptedPositionTimestamp) return true;
    const recentAccurateFix =
      this.lastGoodAccuracyAt > 0 &&
      receivedAt - this.lastGoodAccuracyAt < 15_000;
    if (!recentAccurateFix) return false;
    const degradedLimit = Math.max(80, this.lastGoodAccuracy * 2.6);
    return accuracy > degradedLimit;
  }

  private resolveCourseHeading(
    position: GeolocationPosition,
    previousRawCoordinate: LngLatTuple | null,
    incomingCoordinate: LngLatTuple,
    movedMeters: number,
    elapsedMs: number,
    speed: number,
    accuracy: number,
  ): {
    heading: number;
    source: "gps-course" | "movement-course";
    confidence: number;
  } | null {
    const reportedHeading =
      typeof position.coords.heading === "number" &&
      Number.isFinite(position.coords.heading)
        ? normalizeHeading(position.coords.heading)
        : null;
    if (reportedHeading !== null && speed >= 0.55 && accuracy <= 70) {
      const confidence = Math.max(
        0.55,
        Math.min(1, 1 - accuracy / 140 + Math.min(speed, 12) / 30),
      );
      return { heading: reportedHeading, source: "gps-course", confidence };
    }

    const movementThreshold = Math.max(3.5, Math.min(16, accuracy * 0.24));
    const elapsedIsUseful =
      Number.isFinite(elapsedMs) && elapsedMs >= 250 && elapsedMs <= 10_000;
    if (
      !previousRawCoordinate ||
      !elapsedIsUseful ||
      movedMeters < movementThreshold ||
      speed < 0.45 ||
      accuracy > 85
    )
      return null;
    const heading = bearingBetween(previousRawCoordinate, incomingCoordinate);
    if (heading === null) return null;
    const confidence = Math.max(
      0.5,
      Math.min(0.96, movedMeters / Math.max(12, accuracy * 0.8)),
    );
    return { heading, source: "movement-course", confidence };
  }

  private courseHeadingLocked(now = Date.now()): boolean {
    const lockMs =
      this.lastSpeed >= 8 ? 2400 : this.lastSpeed >= 2 ? 1500 : 700;
    return (
      this.lastCourseHeadingAt > 0 && now - this.lastCourseHeadingAt <= lockMs
    );
  }

  private calibrateCompassAgainstCourse(
    courseHeading: number,
    speed: number,
  ): void {
    if (
      speed < 2.5 ||
      this.lastOrientationHeading === null ||
      window.performance.now() - this.lastOrientationAt > 1400
    )
      return;
    const targetOffset = shortestHeadingDelta(
      this.lastOrientationHeading,
      courseHeading,
    );
    if (Math.abs(targetOffset) > 38) return;
    this.compassCalibrationOffset = this.compassCalibrationReady
      ? shortestHeadingDelta(
          0,
          blendHeading(this.compassCalibrationOffset, targetOffset, 0.08),
        )
      : targetOffset;
    this.compassCalibrationReady = true;
  }

  private calibratedCompassHeading(): number | null {
    if (this.lastOrientationHeading === null) return null;
    return normalizeHeading(
      this.lastOrientationHeading +
        (this.compassCalibrationReady ? this.compassCalibrationOffset : 0),
    );
  }

  private show(
    coordinate: LngLatTuple,
    heading: number | null,
    accuracy = 0,
    recenter = false,
    headingSource: HeadingSource = "held",
    headingConfidence = 0,
    speed = 0,
  ): void {
    const previousCoordinate = this.lastCoordinate;
    this.lastCoordinate = coordinate;
    this.lastAccuracy = clampAccuracy(accuracy);
    this.lastSpeed = Math.max(0, Math.min(120, speed || 0));
    if (heading !== null && Number.isFinite(heading)) {
      const amount =
        headingSource === "gps-course"
          ? this.lastSpeed >= 8
            ? 0.72
            : 0.68
          : headingSource === "movement-course"
            ? 0.62
            : headingSource === "compass"
              ? 0.76
              : previousCoordinate
                ? 0.24
                : 1;
      this.lastHeading = this.smoothHeading(heading, amount);
      this.lastHeadingSource = headingSource;
      this.lastHeadingConfidence = Math.max(0, Math.min(1, headingConfidence));
    } else if (this.lastHeading !== null) {
      this.lastHeadingSource = "held";
      this.lastHeadingConfidence *= 0.985;
    }
    this.updateLayers();
    this.onLocationUpdate?.(this.diagnosticSnapshot());
    window.dispatchEvent(
      new CustomEvent("nav-kurd:user-activity", {
        detail: { kind: "gps", at: Date.now() },
      }),
    );
    if (recenter && !this.pendingCameraFocus) this.recenter(previousCoordinate === null);
  }

  private scheduleVisualRestore(): void {
    if (this.restoreFrame !== null) return;
    this.restoreFrame = window.requestAnimationFrame(() => {
      this.restoreFrame = window.requestAnimationFrame(() => {
        this.restoreFrame = null;
        if (!this.map.isStyleLoaded()) return;
        this.updateLayers();
      });
    });
  }

}
