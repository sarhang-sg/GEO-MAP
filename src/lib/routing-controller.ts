import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection, LineString, Point } from "geojson";
import { UI, languageDirection } from "./i18n";
import { distanceMeters, type LngLatTuple } from "./location";
import { fetchJson, isAbortError } from "./service-state";
import { installMapLongPress } from "./map-long-press";
import type { Language } from "./types";
import type { LiveLocationDiagnosticSnapshot } from "./live-location-controller";
import type {
  MapAnimationHandle,
  MapAnimationScheduler,
} from "./map-animation-scheduler";
import { appUrl } from "./app-url";
import { saveAtlasNavigationHistory } from "./atlas-places";
import { queueNavigationHistory, removePendingNavigationHistory } from "./navigation-history-store";
import type { AtlasNavigationHistoryInput } from "./atlas-places";

type TrafficLevel = "low" | "moderate" | "heavy" | "severe" | "closed" | "unknown";
type RouteFeatureCollection = FeatureCollection<LineString, { distance: number; duration: number; traffic: TrafficLevel; congestion?: number; routeId?: number; connector?: boolean }>;
type RoutePointCollection = FeatureCollection<Point, { kind: "destination" | "candidate" | "snapped-origin" | "snapped-destination" }>;
type RoutingProvider = "osrm" | "mapbox";
type TravelMode = "car" | "bicycle" | "walking";
type RouteAttemptStatus = "success" | "no-route" | "unavailable";

type RouteWaypoint = {
  name?: string;
  distance?: number;
  location?: [number, number];
};

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: LineString;
  legs?: Array<{ summary?: string }>;
};

type OsrmResponse = {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
  waypoints?: RouteWaypoint[];
};

type MapboxLegAnnotation = {
  congestion?: string[];
  congestion_numeric?: number[];
  distance?: number[];
  duration?: number[];
  speed?: number[];
};

type MapboxRoute = {
  distance?: number;
  duration?: number;
  geometry?: LineString;
  legs?: Array<{ summary?: string; annotation?: MapboxLegAnnotation }>;
};

type MapboxResponse = {
  code: string;
  message?: string;
  routes?: MapboxRoute[];
  waypoints?: RouteWaypoint[];
};

type RoutingControllerOptions = {
  map: MapLibreMap;
  animationScheduler: MapAnimationScheduler;
  mapShell: HTMLElement;
  routeButton: HTMLButtonElement;
  getLanguage: () => Language;
  getLocationSnapshot: () => LiveLocationDiagnosticSnapshot;
  setMessage: (message: string, kind?: "normal" | "error" | "success") => void;
  requestLocation: () => void;
  isDestinationAllowed: (coordinate: LngLatTuple) => boolean;
  onRouteVisualChange?: () => void;
  onRouteStateChange?: (active: boolean) => void;
  onNavigationStateChange?: (active: boolean) => void;
  onDestinationPromptStateChange?: (open: boolean) => void;
  lowPowerProfile?: boolean;
};

const ROUTE_SOURCE = "nav-route-source";
const DESTINATION_SOURCE = "nav-route-destination-source";
export const ROUTE_RENDER_LAYER_IDS = [
  "nav-route-line-glow",
  "nav-route-line-casing",
  "nav-route-line",
  "nav-route-line-sheen"
] as const;

export const ROUTE_DESTINATION_LAYER_IDS = [
  "nav-route-destination-pulse",
  "nav-route-destination-halo",
  "nav-route-destination-ring",
  "nav-route-destination",
  "nav-route-candidate-halo",
  "nav-route-candidate-ring",
  "nav-route-candidate"
] as const;

const [ROUTE_LAYER_GLOW, ROUTE_LAYER_CASING, ROUTE_LAYER, ROUTE_LAYER_SHEEN] = ROUTE_RENDER_LAYER_IDS;
const [DESTINATION_PULSE, DESTINATION_HALO, DESTINATION_RING, DESTINATION_LAYER, CANDIDATE_HALO, CANDIDATE_RING, CANDIDATE_LAYER] = ROUTE_DESTINATION_LAYER_IDS;
const rawProvider = import.meta.env.VITE_KRI_ROUTING_PROVIDER?.trim().toLowerCase();
const ROUTING_PROVIDER: RoutingProvider = rawProvider === "mapbox" ? "mapbox" : "osrm";
const OSRM_BASE_URL = (import.meta.env.VITE_KRI_ROUTING_BASE_URL?.trim() || "https://router.project-osrm.org").replace(/\/+$/g, "");
const MAPBOX_BASE_URL = "https://api.mapbox.com/directions/v5";
const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_KRI_MAPBOX_ACCESS_TOKEN?.trim() || "";
const ROUTING_PROFILE = import.meta.env.VITE_KRI_ROUTING_PROFILE?.trim() || (ROUTING_PROVIDER === "mapbox" ? "driving-traffic" : "driving");
const ROUTE_REFRESH_MS = Math.max(4_000, Number(import.meta.env.VITE_KRI_ROUTE_REFRESH_SECONDS || 8) * 1000);
const ROUTE_REROUTE_METERS = Math.max(8, Number(import.meta.env.VITE_KRI_ROUTE_REROUTE_METERS || 25));
const ROUTE_REQUEST_TIMEOUT_MS = 9_000;
const ROUTE_FAILURE_RETRY_MS = 12_000;
class RouteRequestTimeoutError extends Error {
  constructor() {
    super("Routing request timed out.");
    this.name = "RouteRequestTimeoutError";
  }
}

function emptyRoute(): RouteFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function emptyPoints(): RoutePointCollection {
  return { type: "FeatureCollection", features: [] };
}

function pointFeature(coordinate: LngLatTuple, kind: "destination" | "candidate" | "snapped-origin" | "snapped-destination"): RoutePointCollection["features"][number] {
  return { type: "Feature", properties: { kind }, geometry: { type: "Point", coordinates: coordinate } };
}

function isLngLatTuple(value: unknown): value is LngLatTuple {
  return Array.isArray(value) && value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function formatDistance(meters: number, language: Language): string {
  const locale = language === "en" ? "en-US" : language === "ar" ? "ar-IQ" : "ckb-IQ";
  if (meters < 950) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, Math.round(meters)))} m`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

function formatDuration(seconds: number, language: Language): string {
  const locale = language === "en" ? "en-US" : language === "ar" ? "ar-IQ" : "ckb-IQ";
  const minutes = Math.max(1, Math.round(seconds / 60));
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(minutes);
  if (language === "en") return `${value} min`;
  if (language === "ar") return `${value} دقيقة`;
  return `${value} خولەک`;
}

function formatRouteSpeed(distanceMetersValue: number, durationSeconds: number, language: Language): string {
  const locale = language === "en" ? "en-US" : language === "ar" ? "ar-IQ" : "ckb-IQ";
  if (!Number.isFinite(distanceMetersValue) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return "";
  const kmh = Math.max(1, Math.round((distanceMetersValue / durationSeconds) * 3.6));
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kmh);
  return `${value} km/h`;
}

function normalizedRoadName(value: unknown, language: Language): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return UI[language].routeNearestRoadUnknown;
  return text;
}

function initialTravelMode(profile: string): TravelMode {
  const normalized = profile.toLowerCase();
  if (normalized.includes("cycl")) return "bicycle";
  if (normalized.includes("walk") || normalized.includes("foot")) return "walking";
  return "car";
}

function mapboxProfileForMode(mode: TravelMode): string {
  if (mode === "bicycle") return "mapbox/cycling";
  if (mode === "walking") return "mapbox/walking";
  return "mapbox/driving-traffic";
}

function osrmProfileForMode(mode: TravelMode): string {
  if (mode === "bicycle") return "cycling";
  if (mode === "walking") return "walking";
  const clean = ROUTING_PROFILE.replace(/^mapbox\//, "").trim();
  return clean && clean !== "driving-traffic" ? clean : "driving";
}

function trafficLevel(value: string | undefined, numeric?: number): TrafficLevel {
  const text = (value || "").toLowerCase();
  if (text === "low" || text === "moderate" || text === "heavy" || text === "severe") return text;
  if (text === "closed") return "closed";
  if (typeof numeric === "number" && Number.isFinite(numeric)) {
    if (numeric >= 90) return "severe";
    if (numeric >= 70) return "heavy";
    if (numeric >= 45) return "moderate";
    if (numeric >= 0) return "low";
  }
  return "unknown";
}

function routeFeaturesFromGeometry(geometry: LineString, distance: number, duration: number, traffic: TrafficLevel = "unknown"): RouteFeatureCollection["features"] {
  return [{ type: "Feature", properties: { distance, duration, traffic, routeId: Date.now() }, geometry }];
}

function routeFeaturesFromMapbox(route: MapboxRoute): RouteFeatureCollection["features"] {
  const geometry = route.geometry;
  const coords = geometry?.coordinates || [];
  if (!geometry || coords.length < 2) return [];
  const congestion = route.legs?.flatMap((leg) => leg.annotation?.congestion || []) || [];
  const numeric = route.legs?.flatMap((leg) => leg.annotation?.congestion_numeric || []) || [];
  const counts = new Map<TrafficLevel, number>();
  const levels = numeric.length || congestion.length
    ? Array.from({ length: Math.max(numeric.length, congestion.length) }, (_, index) => trafficLevel(congestion[index], numeric[index]))
    : ["unknown" as TrafficLevel];
  for (const level of levels) counts.set(level, (counts.get(level) || 0) + 1);
  const priority: TrafficLevel[] = ["closed", "severe", "heavy", "moderate", "low", "unknown"];
  const dominant = priority
    .filter((level) => counts.has(level))
    .sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0))[0] || "unknown";
  const averageCongestion = numeric.length ? numeric.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0) / numeric.length : undefined;
  return [{
    type: "Feature",
    properties: { distance: route.distance || 0, duration: route.duration || 0, traffic: dominant, congestion: averageCongestion, routeId: Date.now() },
    geometry
  }];
}

type RouteProgressMeasurement = {
  totalMeters: number;
  progressedMeters: number;
  remainingMeters: number;
  offRouteMeters: number;
};

function flattenedRouteCoordinates(features: RouteFeatureCollection["features"]): LngLatTuple[] {
  const coordinates: LngLatTuple[] = [];
  for (const feature of features) {
    for (const coordinate of feature.geometry.coordinates) {
      if (!isLngLatTuple(coordinate)) continue;
      const next: LngLatTuple = [coordinate[0], coordinate[1]];
      const previous = coordinates[coordinates.length - 1];
      if (!previous || distanceMeters(previous, next) > 0.05) coordinates.push(next);
    }
  }
  return coordinates;
}

/** Measure progress along the actual route polyline, not screen pixels. */
export function measureRouteProgress(coordinate: LngLatTuple, routeCoordinates: readonly LngLatTuple[]): RouteProgressMeasurement | null {
  if (routeCoordinates.length < 2) return null;
  const earthRadius = 6_371_008.8;
  const radians = Math.PI / 180;
  const cosLatitude = Math.max(0.2, Math.cos(coordinate[1] * radians));
  let totalMeters = 0;
  const segmentLengths: number[] = [];
  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const length = distanceMeters(routeCoordinates[index], routeCoordinates[index + 1]);
    segmentLengths.push(length);
    totalMeters += length;
  }
  if (!Number.isFinite(totalMeters) || totalMeters <= 0) return null;

  let bestOffRoute = Number.POSITIVE_INFINITY;
  let bestProgress = 0;
  let cumulative = 0;
  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = routeCoordinates[index];
    const end = routeCoordinates[index + 1];
    const segmentLength = segmentLengths[index];
    if (segmentLength <= 0) continue;
    const ax = (start[0] - coordinate[0]) * radians * earthRadius * cosLatitude;
    const ay = (start[1] - coordinate[1]) * radians * earthRadius;
    const bx = (end[0] - coordinate[0]) * radians * earthRadius * cosLatitude;
    const by = (end[1] - coordinate[1]) * radians * earthRadius;
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const fraction = denominator > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
    const nearestX = ax + fraction * dx;
    const nearestY = ay + fraction * dy;
    const offRoute = Math.hypot(nearestX, nearestY);
    const progress = cumulative + segmentLength * fraction;
    // At self-intersections prefer the furthest credible progress so remaining
    // distance does not jump backwards when the GPS fix sits on two segments.
    if (offRoute < bestOffRoute - 0.5 || (Math.abs(offRoute - bestOffRoute) <= 0.5 && progress > bestProgress)) {
      bestOffRoute = offRoute;
      bestProgress = progress;
    }
    cumulative += segmentLength;
  }

  return {
    totalMeters,
    progressedMeters: Math.max(0, Math.min(totalMeters, bestProgress)),
    remainingMeters: Math.max(0, totalMeters - bestProgress),
    offRouteMeters: bestOffRoute
  };
}

function connectedRouteFeatures(
  features: RouteFeatureCollection["features"],
  origin: LngLatTuple,
  destination: LngLatTuple
): RouteFeatureCollection["features"] {
  if (!features.length) return features;
  return features.map((feature, index) => {
    const coordinates = feature.geometry.coordinates.map((coordinate) => [coordinate[0], coordinate[1]] as LngLatTuple);
    if (!coordinates.length) return feature;
    if (index === 0 && distanceMeters(origin, coordinates[0]) > 2) coordinates.unshift([origin[0], origin[1]]);
    if (index === features.length - 1 && distanceMeters(coordinates[coordinates.length - 1], destination) > 2) {
      coordinates.push([destination[0], destination[1]]);
    }
    return { ...feature, geometry: { ...feature.geometry, coordinates } };
  });
}

export class RoutingController {
  private readonly map: MapLibreMap;
  private readonly mapShell: HTMLElement;
  private readonly routeButton: HTMLButtonElement;
  private readonly getLanguage: () => Language;
  private readonly getLocationSnapshot: () => LiveLocationDiagnosticSnapshot;
  private readonly setMessage: (message: string, kind?: "normal" | "error" | "success") => void;
  private readonly requestLocation: () => void;
  private readonly isDestinationAllowed: (coordinate: LngLatTuple) => boolean;
  private readonly onRouteVisualChange: () => void;
  private readonly onRouteStateChange: (active: boolean) => void;
  private readonly onNavigationStateChange: (active: boolean) => void;
  private readonly onDestinationPromptStateChange: (open: boolean) => void;
  private readonly routeAnimation: MapAnimationHandle;
  private readonly destinationAnimation: MapAnimationHandle;
  private readonly panel: HTMLElement;
  private readonly titleElement: HTMLElement;
  private readonly metricsElement: HTMLElement;
  private readonly roadElement: HTMLElement;
  private readonly startButton: HTMLButtonElement;
  private readonly modeButtons: HTMLButtonElement[];
  private readonly destinationPrompt: HTMLElement;
  private readonly navigationHud: HTMLElement;
  private readonly navigationHudDistance: HTMLElement;
  private readonly navigationHudDuration: HTMLElement;
  private readonly navigationHudDestination: HTMLElement;
  private pendingDestination: LngLatTuple | null = null;
  private suppressMapClickUntil = 0;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private pinMode = false;
  private navigating = false;
  private destination: LngLatTuple | null = null;
  private destinationName = "";
  private lastRouteOrigin: LngLatTuple | null = null;
  private lastRouteAt = 0;
  private lastDistance = 0;
  private lastDuration = 0;
  private routeProviderDistance = 0;
  private routeProviderDuration = 0;
  private routeCoordinates: LngLatTuple[] = [];
  private nearestRoad = "";
  private routeData: RouteFeatureCollection = emptyRoute();
  private pointData: RoutePointCollection = emptyPoints();
  private aborter: AbortController | null = null;
  private refreshTimer: number | null = null;
  private scheduledAnnouncement = false;
  private requestSerial = 0;
  private lastEmittedRouteState = false;
  private lastEmittedNavigationState = false;
  private lastEmittedDestinationPromptState = false;
  private travelMode: TravelMode = initialTravelMode(ROUTING_PROFILE);
  private routeRequestInFlight = false;
  private refreshQueuedAfterFlight = false;
  private lastRouteAttemptAt = 0;
  private arrivalPanelTimer: number | null = null;
  private navigationStartedAt = 0;
  private navigationPlannedDistance = 0;
  private navigationPlannedDuration = 0;

  constructor(options: RoutingControllerOptions) {
    this.map = options.map;
    this.mapShell = options.mapShell;
    this.routeButton = options.routeButton;
    this.getLanguage = options.getLanguage;
    this.getLocationSnapshot = options.getLocationSnapshot;
    this.setMessage = options.setMessage;
    this.requestLocation = options.requestLocation;
    this.isDestinationAllowed = options.isDestinationAllowed;
    this.onRouteVisualChange = options.onRouteVisualChange ?? (() => undefined);
    this.onRouteStateChange = options.onRouteStateChange ?? (() => undefined);
    this.onNavigationStateChange = options.onNavigationStateChange ?? (() => undefined);
    this.onDestinationPromptStateChange = options.onDestinationPromptStateChange ?? (() => undefined);
    this.routeAnimation = options.animationScheduler.register({
      id: "route-sheen",
      priority: "visual",
      intervalMs: options.lowPowerProfile ? 160 : 110,
      pauseDuringInteraction: true,
      run: (now) => this.paintRouteAnimation(now),
    });
    this.destinationAnimation = options.animationScheduler.register({
      id: "route-destination-pulse",
      priority: "visual",
      intervalMs: options.lowPowerProfile ? 170 : 120,
      pauseDuringInteraction: true,
      run: (now) => this.paintDestinationAnimation(now),
    });
    this.panel = this.createPanel();
    this.titleElement = this.panel.querySelector<HTMLElement>("[data-route-title]")!;
    this.metricsElement = this.panel.querySelector<HTMLElement>("[data-route-metrics]")!;
    this.roadElement = this.panel.querySelector<HTMLElement>("[data-route-road]")!;
    this.startButton = this.panel.querySelector<HTMLButtonElement>("[data-route-start]")!;
    this.modeButtons = Array.from(this.panel.querySelectorAll<HTMLButtonElement>("[data-route-mode]"));
    this.destinationPrompt = this.createDestinationPrompt();
    this.navigationHud = this.createNavigationHud();
    this.navigationHudDistance = this.navigationHud.querySelector<HTMLElement>("[data-navigation-distance]")!;
    this.navigationHudDuration = this.navigationHud.querySelector<HTMLElement>("[data-navigation-duration]")!;
    this.navigationHudDestination = this.navigationHud.querySelector<HTMLElement>("[data-navigation-destination]")!;
    this.mapShell.append(this.panel, this.destinationPrompt, this.navigationHud);
    this.installLongPressDestination();
    this.destinationPrompt.querySelectorAll<HTMLButtonElement>("[data-route-prompt-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handleDestinationPromptAction(button.dataset.routePromptAction || "cancel");
      });
    });
    this.startButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.navigating) this.cancelNavigation();
      else this.startNavigation();
    });
    this.modeButtons.forEach((button) => button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const mode = button.dataset.routeMode as TravelMode | undefined;
      if (mode) this.setTravelMode(mode);
    }));
    this.map.on("click", (event) => {
      if (this.mapShell.dataset.coordinatePicker === "active") return;
      if (window.performance.now() < this.suppressMapClickUntil) {
        event.preventDefault();
        return;
      }
      if (!this.destinationPrompt.hidden) this.hideDestinationPrompt();
      if (!this.pinMode) return;
      event.preventDefault();
      const coordinate: LngLatTuple = [event.lngLat.lng, event.lngLat.lat];
      if (!this.isDestinationAllowed(coordinate)) {
        this.setMessage(UI[this.getLanguage()].routeOutsideBoundary, "error");
        return;
      }
      this.setDestination(coordinate, UI[this.getLanguage()].routeDestination);
    });
    window.addEventListener("online", () => this.scheduleRouteRefresh(280, false), { passive: true });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) this.scheduleRouteRefresh(320, false); });
    this.refreshLanguage();
  }

  cancelDestinationPrompt(): void {
    this.pinMode = false;
    this.map.getCanvas().style.cursor = "";
    this.hideDestinationPrompt();
  }

  private createDestinationPrompt(): HTMLElement {
    const prompt = document.createElement("section");
    prompt.className = "route-destination-prompt";
    prompt.hidden = true;
    prompt.setAttribute("role", "dialog");
    prompt.setAttribute("aria-modal", "false");
    prompt.setAttribute("aria-live", "polite");
    prompt.innerHTML = `<div class="route-destination-prompt__pin" aria-hidden="true"><span></span></div>
      <div class="route-destination-prompt__copy"><strong data-route-prompt-title></strong><span data-route-prompt-description></span></div>
      <div class="route-destination-prompt__actions">
        <button type="button" data-route-prompt-action="confirm" class="is-primary"></button>
        <button type="button" data-route-prompt-action="add" class="is-add"></button>
        <button type="button" data-route-prompt-action="report"></button>
        <button type="button" data-route-prompt-action="cancel" class="is-muted"></button>
      </div>`;
    return prompt;
  }

  private installLongPressDestination(): void {
    const canvas = this.map.getCanvas();
    const coordinateFromClientPoint = (clientX: number, clientY: number): LngLatTuple => {
      // Mobile browser chrome and desktop-mode viewport changes can resize the
      // visible canvas before ResizeObserver delivery. Synchronize MapLibre's
      // transform at the exact selection moment so the chosen geographic point
      // and rendered candidate marker always refer to the same coordinate.
      this.map.resize();
      const rect = canvas.getBoundingClientRect();
      const coordinate = this.map.unproject([clientX - rect.left, clientY - rect.top]);
      return [coordinate.lng, coordinate.lat];
    };
    installMapLongPress(canvas, {
      isEnabled: () => this.mapShell.dataset.coordinatePicker !== "active",
      suppressClickUntil: (time) => { this.suppressMapClickUntil = time; },
      onHold: (point) => this.proposeDestination(coordinateFromClientPoint(point.x, point.y))
    });
  }

  private syncDestinationPromptState(): void {
    const open = !this.destinationPrompt.hidden;
    this.mapShell.classList.toggle("has-destination-prompt", open);
    if (open !== this.lastEmittedDestinationPromptState) {
      this.lastEmittedDestinationPromptState = open;
      this.onDestinationPromptStateChange(open);
    }
  }

  private proposeDestination(coordinate: LngLatTuple): void {
    if (!this.isDestinationAllowed(coordinate)) {
      this.hideDestinationPrompt();
      this.setMessage(UI[this.getLanguage()].routeOutsideBoundary, "error");
      return;
    }
    this.pendingDestination = [coordinate[0], coordinate[1]];
    this.renderSources();
    this.refreshDestinationPromptCopy();
    this.destinationPrompt.hidden = false;
    this.syncDestinationPromptState();
    try { navigator.vibrate?.(18); } catch { /* optional haptic */ }
  }

  private hideDestinationPrompt(): void {
    this.destinationPrompt.hidden = true;
    this.syncDestinationPromptState();
    this.pendingDestination = null;
    this.renderSources();
  }

  private handleDestinationPromptAction(action: string): void {
    const coordinate = this.pendingDestination ? [...this.pendingDestination] as LngLatTuple : null;
    if (!coordinate || action === "cancel") {
      this.hideDestinationPrompt();
      return;
    }
    this.hideDestinationPrompt();
    if (action === "report") {
      window.dispatchEvent(new CustomEvent("nav-kurd:road-report", { detail: { coordinate } }));
      return;
    }
    if (action === "add") {
      window.dispatchEvent(new CustomEvent("nav-kurd:add-place", { detail: { coordinate } }));
      return;
    }
    this.setDestination(coordinate, UI[this.getLanguage()].routeDestination);
  }

  private refreshDestinationPromptCopy(): void {
    const copy = UI[this.getLanguage()];
    this.destinationPrompt.dir = languageDirection(this.getLanguage());
    this.destinationPrompt.querySelector<HTMLElement>("[data-route-prompt-title]")!.textContent = copy.routeLongPressTitle;
    this.destinationPrompt.querySelector<HTMLElement>("[data-route-prompt-description]")!.textContent = copy.routeLongPressDescription;
    this.destinationPrompt.querySelector<HTMLButtonElement>("[data-route-prompt-action=confirm]")!.textContent = copy.routeLongPressConfirm;
    this.destinationPrompt.querySelector<HTMLButtonElement>("[data-route-prompt-action=add]")!.textContent = copy.routeLongPressAdd;
    this.destinationPrompt.querySelector<HTMLButtonElement>("[data-route-prompt-action=report]")!.textContent = copy.routeLongPressReport;
    this.destinationPrompt.querySelector<HTMLButtonElement>("[data-route-prompt-action=cancel]")!.textContent = copy.routeLongPressCancel;
  }

  installLayers(): void {
    if (!this.map.getSource(ROUTE_SOURCE)) this.map.addSource(ROUTE_SOURCE, { type: "geojson", data: this.routeData, lineMetrics: true });
    if (!this.map.getSource(DESTINATION_SOURCE)) this.map.addSource(DESTINATION_SOURCE, { type: "geojson", data: this.pointData });
    const beforeLocation = this.map.getLayer("location-accuracy-fill") ? "location-accuracy-fill" : undefined;
    if (!this.map.getLayer(ROUTE_LAYER_GLOW)) this.map.addLayer({ id: ROUTE_LAYER_GLOW, type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2d8cff", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 6.8, 8, 8.4, 13, 11.2, 17, 14.4], "line-opacity": 0.16, "line-blur": 1.35 } }, beforeLocation);
    if (!this.map.getLayer(ROUTE_LAYER_CASING)) this.map.addLayer({ id: ROUTE_LAYER_CASING, type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#07091a", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 4.6, 8, 5.9, 13, 8.0, 17, 10.4], "line-opacity": 0.92 } }, beforeLocation);
    if (!this.map.getLayer(ROUTE_LAYER)) this.map.addLayer({ id: ROUTE_LAYER, type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["match", ["get", "traffic"], "low", "#3d8dff", "moderate", "#675cff", "heavy", "#f0b95a", "severe", "#ff6378", "closed", "#ff315f", "#2d8cff"], "line-width": ["interpolate", ["linear"], ["zoom"], 5, 3.0, 8, 3.9, 13, 5.15, 17, 6.75], "line-opacity": 0.99 } }, beforeLocation);
    if (!this.map.getLayer(ROUTE_LAYER_SHEEN)) this.map.addLayer({ id: ROUTE_LAYER_SHEEN, type: "line", source: ROUTE_SOURCE, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.72, 8, 1.0, 13, 1.55, 17, 2.15], "line-opacity": 0.0 } }, beforeLocation);
    if (!this.map.getLayer(DESTINATION_PULSE)) this.map.addLayer({ id: DESTINATION_PULSE, type: "circle", source: DESTINATION_SOURCE, filter: ["==", ["get", "kind"], "destination"], paint: { "circle-color": "#2d8cff", "circle-radius": 17, "circle-opacity": 0.0, "circle-stroke-color": "#bcecff", "circle-stroke-width": 1.45, "circle-stroke-opacity": 0.0, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } }, beforeLocation);
    if (!this.map.getLayer(DESTINATION_HALO)) this.map.addLayer({ id: DESTINATION_HALO, type: "circle", source: DESTINATION_SOURCE, filter: ["==", ["get", "kind"], "destination"], paint: { "circle-color": "#2d8cff", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 9.4, 15, 16.2], "circle-opacity": 0.24, "circle-blur": 0.12, "circle-stroke-color": "#4ccbff", "circle-stroke-width": 1.25, "circle-stroke-opacity": 0.66, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } }, beforeLocation);
    if (!this.map.getLayer(DESTINATION_RING)) this.map.addLayer({ id: DESTINATION_RING, type: "circle", source: DESTINATION_SOURCE, filter: ["==", ["get", "kind"], "destination"], paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 6.2, 15, 10.0], "circle-stroke-color": "#f4efff", "circle-stroke-width": 2.65, "circle-stroke-opacity": 0.98, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } }, beforeLocation);
    if (!this.map.getLayer(DESTINATION_LAYER)) this.map.addLayer({ id: DESTINATION_LAYER, type: "circle", source: DESTINATION_SOURCE, filter: ["==", ["get", "kind"], "destination"], paint: { "circle-color": "#2d8cff", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4.6, 15, 7.5], "circle-stroke-color": "#07111f", "circle-stroke-width": 2.15, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } }, beforeLocation);
    if (!this.map.getLayer(CANDIDATE_HALO)) this.map.addLayer({ id: CANDIDATE_HALO, type: "circle", source: DESTINATION_SOURCE, filter: ["==", ["get", "kind"], "candidate"], paint: { "circle-color": "#2d8cff", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 8.6, 15, 14.2], "circle-opacity": 0.22, "circle-blur": 0.12, "circle-stroke-color": "#4ccbff", "circle-stroke-width": 1.1, "circle-stroke-opacity": 0.6, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } }, beforeLocation);
    if (!this.map.getLayer(CANDIDATE_RING)) this.map.addLayer({ id: CANDIDATE_RING, type: "circle", source: DESTINATION_SOURCE, filter: ["==", ["get", "kind"], "candidate"], paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 5.8, 15, 9.3], "circle-stroke-color": "#f4efff", "circle-stroke-width": 2.35, "circle-stroke-opacity": 0.92, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } }, beforeLocation);
    if (!this.map.getLayer(CANDIDATE_LAYER)) this.map.addLayer({ id: CANDIDATE_LAYER, type: "circle", source: DESTINATION_SOURCE, filter: ["==", ["get", "kind"], "candidate"], paint: { "circle-color": "#2d8cff", "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 4.4, 15, 7.1], "circle-stroke-color": "#07111f", "circle-stroke-width": 2.0, "circle-pitch-alignment": "map", "circle-pitch-scale": "map" } }, beforeLocation);
    this.renderSources();
  }

  togglePinMode(): void {
    if (this.navigating) {
      this.setMessage(UI[this.getLanguage()].routeActive, "success");
      return;
    }
    const snapshot = this.getLocationSnapshot();
    if (!snapshot.coordinate) {
      this.setMessage(UI[this.getLanguage()].routeNeedLocation, "error");
      this.requestLocation();
      return;
    }
    this.setPinMode(!this.pinMode);
    this.setMessage(this.pinMode ? UI[this.getLanguage()].routePickDestination : UI[this.getLanguage()].routePinCancelled, this.pinMode ? "normal" : "success");
  }

  updateLocation(snapshot: LiveLocationDiagnosticSnapshot): void {
    if (!snapshot.coordinate || !this.destination) return;

    if (!this.navigating) return;
    const accuracy = Math.max(0, snapshot.accuracyMeters || 0);
    const arrivalThreshold = Math.max(20, Math.min(55, accuracy + 14));
    if (distanceMeters(snapshot.coordinate, this.destination) <= arrivalThreshold) {
      this.finishNavigationAtDestination();
      return;
    }

    const now = window.performance.now();
    if (this.routeData.features.length === 0) {
      if (!this.routeRequestInFlight && (this.lastRouteAttemptAt === 0 || now - this.lastRouteAttemptAt >= ROUTE_FAILURE_RETRY_MS)) {
        this.scheduleRouteRefresh(180, false);
      }
      return;
    }

    this.updateLiveRemainingMetrics(snapshot);
    if (this.routeRequestInFlight) return;

    const moved = this.lastRouteOrigin ? distanceMeters(this.lastRouteOrigin, snapshot.coordinate) : Infinity;
    const elapsed = now - this.lastRouteAt;
    if (moved >= ROUTE_REROUTE_METERS || elapsed >= ROUTE_REFRESH_MS) this.scheduleRouteRefresh(240, false);
  }

  private updateLiveRemainingMetrics(snapshot: LiveLocationDiagnosticSnapshot): void {
    if (!snapshot.coordinate || this.routeCoordinates.length < 2 || this.routeProviderDistance <= 0 || this.routeProviderDuration <= 0) return;
    const measurement = measureRouteProgress(snapshot.coordinate, this.routeCoordinates);
    if (!measurement) return;
    const accuracy = Math.max(0, snapshot.accuracyMeters || 0);
    const credibleOffRouteLimit = Math.max(55, Math.min(180, accuracy * 1.8 + 28));
    if (measurement.offRouteMeters > credibleOffRouteLimit) return;

    const geometryScale = this.routeProviderDistance / measurement.totalMeters;
    const measuredRemaining = Math.max(0, Math.min(this.routeProviderDistance, measurement.remainingMeters * geometryScale));
    // GPS noise must not make the remaining distance oscillate upward. A true
    // detour is handled by the normal route refresh and receives a new route.
    const nextDistance = this.lastDistance > 0 ? Math.min(this.lastDistance, measuredRemaining) : measuredRemaining;
    const nextDuration = this.routeProviderDistance > 0
      ? this.routeProviderDuration * (nextDistance / this.routeProviderDistance)
      : this.lastDuration;
    if (Math.abs(this.lastDistance - nextDistance) < 0.8 && Math.abs(this.lastDuration - nextDuration) < 0.8) return;
    this.lastDistance = nextDistance;
    this.lastDuration = Math.max(0, nextDuration);
    this.renderPanel();
  }

  refreshLanguage(): void {
    const language = this.getLanguage();
    this.refreshDestinationPromptCopy();
    this.panel.dir = languageDirection(language);
    this.navigationHud.dir = languageDirection(language);
    this.routeButton.title = UI[language].routePinTitle;
    this.routeButton.setAttribute("aria-label", UI[language].routePinTitle);
    this.startButton.title = this.navigating ? UI[language].routeCancel : UI[language].routeStart;
    this.startButton.setAttribute("aria-label", this.startButton.title);
    this.startButton.querySelector<HTMLElement>("[data-route-start-label]")!.textContent = this.navigating ? UI[language].routeCancel : UI[language].routeStart;
    const labels: Record<TravelMode, string> = {
      car: UI[language].routeModeCar,
      bicycle: UI[language].routeModeBicycle,
      walking: UI[language].routeModeWalking
    };
    this.modeButtons.forEach((button) => {
      const mode = button.dataset.routeMode as TravelMode;
      const label = button.querySelector<HTMLElement>("[data-route-mode-label]");
      if (label) label.textContent = labels[mode];
      button.title = labels[mode];
      button.setAttribute("aria-label", labels[mode]);
      const active = mode === this.travelMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      button.disabled = this.navigating;
    });
    if (this.destination && this.lastDistance > 0 && this.lastDuration > 0) this.renderPanel();
    else this.renderNavigationHud();
  }

  restoreVisualState(): void {
    this.installLayers();
    this.renderExistingRoute();
  }

  hasActiveRoute(): boolean {
    return this.destination !== null || this.routeRequestInFlight || this.pinMode;
  }

  hasRenderedRoute(): boolean {
    return this.routeData.features.some((feature) => feature.geometry.coordinates.length >= 2);
  }

  getRenderedRouteSegments(): readonly (readonly LngLatTuple[])[] {
    return this.routeData.features
      .map((feature) => feature.geometry.coordinates
        .filter((coordinate): coordinate is [number, number] => isLngLatTuple(coordinate))
        .map((coordinate) => [coordinate[0], coordinate[1]] as LngLatTuple))
      .filter((coordinates) => coordinates.length >= 2);
  }

  private syncRouteVisualState(): void {
    const rendered = this.hasRenderedRoute();
    const active = this.hasActiveRoute();
    this.mapShell.classList.toggle("has-rendered-route", rendered);
    this.mapShell.classList.toggle("has-active-route", active);
    this.mapShell.classList.toggle("is-navigating", this.navigating);
    this.applyNavigationPalette();
    if (active !== this.lastEmittedRouteState) {
      this.lastEmittedRouteState = active;
      this.onRouteStateChange(active);
    }
    if (this.navigating !== this.lastEmittedNavigationState) {
      this.lastEmittedNavigationState = this.navigating;
      this.onNavigationStateChange(this.navigating);
    }
    this.onRouteVisualChange();
  }

  clearRoute(recordActiveNavigation = true, announce = true): void {
    if (recordActiveNavigation && this.navigating) this.recordNavigationHistory("cancelled");
    if (this.arrivalPanelTimer !== null) window.clearTimeout(this.arrivalPanelTimer);
    this.arrivalPanelTimer = null;
    this.hideDestinationPrompt();
    this.cancelPendingRouteRequest();
    this.navigating = false;
    this.mapShell.classList.remove("is-navigating");
    this.destination = null;
    this.destinationName = "";
    this.nearestRoad = "";
    this.lastDistance = 0;
    this.lastDuration = 0;
    this.routeProviderDistance = 0;
    this.routeProviderDuration = 0;
    this.routeCoordinates = [];
    this.navigationStartedAt = 0;
    this.navigationPlannedDistance = 0;
    this.navigationPlannedDuration = 0;
    this.lastRouteOrigin = null;
    this.lastRouteAt = 0;
    this.routeData = emptyRoute();
    this.pointData = emptyPoints();
    this.setPinMode(false);
    this.panel.hidden = true;
    this.navigationHud.hidden = true;
    this.stopRouteAnimation();
    this.stopDestinationAnimation();
    this.renderSources();
    this.syncRouteVisualState();
    if (announce) this.setMessage(UI[this.getLanguage()].routeCleared, "success");
  }

  private cancelNavigation(): void {
    if (!this.navigating) return;
    this.recordNavigationHistory("cancelled");
    this.clearRoute(false, false);
    this.setMessage(UI[this.getLanguage()].routeCancelled, "normal");
    try { navigator.vibrate?.(18); } catch { /* Optional haptic. */ }
  }

  private startNavigation(): void {
    if (this.navigating || !this.destination) return;
    const snapshot = this.getLocationSnapshot();
    if (!snapshot.coordinate) {
      this.setMessage(UI[this.getLanguage()].routeNeedLocation, "error");
      this.requestLocation();
      return;
    }
    if (!this.hasRenderedRoute()) {
      this.setMessage(UI[this.getLanguage()].routeCalculating, "normal");
      this.scheduleRouteRefresh(0, true);
      return;
    }
    this.navigationStartedAt = Date.now();
    this.navigationPlannedDistance = this.lastDistance;
    this.navigationPlannedDuration = this.lastDuration;
    this.navigating = true;
    this.setPinMode(false);
    this.mapShell.classList.add("is-navigating");
    this.requestLocation();
    this.startRouteAnimation();
    this.startDestinationAnimation();
    this.renderPanel();
    this.renderNavigationHud();
    this.setMessage(UI[this.getLanguage()].routeStarted, "success");
    try { navigator.vibrate?.([20, 45, 20]); } catch { /* Optional haptic. */ }
  }

  private finishNavigationAtDestination(): void {
    if (!this.navigating) return;
    const copy = UI[this.getLanguage()];
    this.recordNavigationHistory("arrived");
    this.hideDestinationPrompt();
    this.cancelPendingRouteRequest();
    this.navigating = false;
    this.destination = null;
    this.destinationName = "";
    this.nearestRoad = "";
    this.lastDistance = 0;
    this.lastDuration = 0;
    this.routeProviderDistance = 0;
    this.routeProviderDuration = 0;
    this.routeCoordinates = [];
    this.navigationStartedAt = 0;
    this.navigationPlannedDistance = 0;
    this.navigationPlannedDuration = 0;
    this.lastRouteOrigin = null;
    this.lastRouteAt = 0;
    this.routeData = emptyRoute();
    this.pointData = emptyPoints();
    this.setPinMode(false);
    this.stopRouteAnimation();
    this.stopDestinationAnimation();
    this.renderSources();
    this.syncRouteVisualState();
    this.navigationHud.hidden = true;
    this.panel.dataset.state = "arrived";
    this.titleElement.textContent = copy.routeArrivalTitle;
    this.metricsElement.textContent = copy.routeArrived;
    this.roadElement.textContent = "";
    this.startButton.hidden = true;
    this.panel.hidden = false;
    this.setMessage(copy.routeArrived, "success");
    try { navigator.vibrate?.([45, 60, 45]); } catch { /* Optional haptic. */ }
    try {
      if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window) {
        window.speechSynthesis.cancel();
        const announcement = new SpeechSynthesisUtterance(copy.routeArrived);
        announcement.lang = this.getLanguage() === "ku" ? "ckb-IQ" : this.getLanguage() === "ar" ? "ar-IQ" : "en-GB";
        window.speechSynthesis.speak(announcement);
      }
    } catch { /* Spoken arrival is an optional enhancement. */ }
    this.arrivalPanelTimer = window.setTimeout(() => {
      this.arrivalPanelTimer = null;
      if (this.panel.dataset.state === "arrived") this.panel.hidden = true;
    }, 8_000);
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement("section");
    panel.id = "routePanel";
    panel.className = "route-panel";
    panel.setAttribute("aria-labelledby", "routePanelHeading");
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <h2 id="routePanelHeading" class="visually-hidden">Navigation route</h2>
      <div class="route-panel__content">
        <div class="route-panel__body">
          <strong data-route-title></strong>
          <span class="route-panel__metrics"><img src="${appUrl("assets/icons/nav-kurd/speed-time.svg")}" alt="" aria-hidden="true" draggable="false"><span data-route-metrics></span></span>
          <small data-route-road></small>
        </div>
        <div class="route-panel__modes" role="group" aria-label="Route mode">
          <button type="button" data-route-mode="car" aria-pressed="true"><img src="${appUrl("assets/icons/nav-kurd/12.svg")}" alt="" aria-hidden="true" draggable="false"><span data-route-mode-label></span></button>
          <button type="button" data-route-mode="bicycle" aria-pressed="false"><img src="${appUrl("assets/icons/nav-kurd/11.svg")}" alt="" aria-hidden="true" draggable="false"><span data-route-mode-label></span></button>
          <button type="button" data-route-mode="walking" aria-pressed="false"><img src="${appUrl("assets/icons/nav-kurd/10.svg")}" alt="" aria-hidden="true" draggable="false"><span data-route-mode-label></span></button>
        </div>
        <button class="route-panel__start" type="button" data-route-start><img src="${appUrl("assets/icons/nav-kurd/speed-time.svg")}" alt="" aria-hidden="true" draggable="false"><span data-route-start-label></span></button>
      </div>`;
    return panel;
  }

  private createNavigationHud(): HTMLElement {
    const hud = document.createElement("section");
    hud.className = "route-navigation-hud";
    hud.hidden = true;
    hud.setAttribute("role", "status");
    hud.setAttribute("aria-live", "polite");
    hud.innerHTML = `<span class="route-navigation-hud__metric"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18.5c2.1-4.3 4.6-6.5 7.5-6.5 2.6 0 4.5-1.9 6.5-6.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="5" cy="18.5" r="2" stroke="currentColor" stroke-width="1.8"/><path d="m17 4 2-1 1 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><strong data-navigation-distance>—</strong></span>
      <span class="route-navigation-hud__divider" aria-hidden="true"></span>
      <span class="route-navigation-hud__metric"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5V12l3.2 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><strong data-navigation-duration>—</strong></span>
      <small data-navigation-destination></small>`;
    return hud;
  }

  private setTravelMode(mode: TravelMode): void {
    if (mode === this.travelMode || this.navigating) return;
    this.cancelPendingRouteRequest();
    this.travelMode = mode;
    this.routeProviderDistance = 0;
    this.routeProviderDuration = 0;
    this.routeCoordinates = [];
    this.routeData = emptyRoute();
    (this.map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(this.routeData);
    this.stopRouteAnimation();
    this.syncRouteVisualState();
    this.refreshLanguage();
    if (this.destination) {
      this.renderPendingPanel();
      this.scheduleRouteRefresh(0, true);
    }
  }

  private setDestination(coordinate: LngLatTuple, label: string): void {
    if (this.arrivalPanelTimer !== null) window.clearTimeout(this.arrivalPanelTimer);
    this.arrivalPanelTimer = null;
    this.cancelPendingRouteRequest();
    this.navigating = false;
    this.mapShell.classList.remove("is-navigating");
    this.destination = [coordinate[0], coordinate[1]];
    this.destinationName = label;
    this.nearestRoad = "";
    this.lastDistance = 0;
    this.lastDuration = 0;
    this.routeProviderDistance = 0;
    this.routeProviderDuration = 0;
    this.routeCoordinates = [];
    this.navigationStartedAt = 0;
    this.navigationPlannedDistance = 0;
    this.navigationPlannedDuration = 0;
    this.navigationHud.hidden = true;
    this.lastRouteOrigin = null;
    this.lastRouteAt = 0;
    this.routeData = emptyRoute();
    this.pointData = { type: "FeatureCollection", features: [pointFeature(this.destination, "destination")] };
    // Route calculation is a preview. Live navigation starts only after the
    // explicit Start action, matching familiar navigation-app behavior.
    this.setPinMode(false);
    this.stopRouteAnimation();
    this.renderSources();
    this.syncRouteVisualState();
    this.startDestinationAnimation();
    this.renderPendingPanel();
    void this.calculateRoute(true);
  }

  private scheduleRouteRefresh(delayMs: number, announce: boolean): void {
    if (!this.destination) return;
    this.scheduledAnnouncement = this.scheduledAnnouncement || announce;
    if (this.routeRequestInFlight) {
      this.refreshQueuedAfterFlight = true;
      return;
    }
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      const shouldAnnounce = this.scheduledAnnouncement;
      this.scheduledAnnouncement = false;
      this.refreshTimer = null;
      void this.calculateRoute(shouldAnnounce);
    }, delayMs);
  }

  private async calculateRoute(announce = false): Promise<void> {
    if (!this.destination) return;
    if (this.routeRequestInFlight) {
      this.refreshQueuedAfterFlight = true;
      this.scheduledAnnouncement = this.scheduledAnnouncement || announce;
      return;
    }
    if (ROUTING_PROVIDER === "mapbox" && !MAPBOX_ACCESS_TOKEN.startsWith("pk.")) {
      this.renderRouteFailurePanel(UI[this.getLanguage()].routeServiceUnavailable);
      if (announce) this.setMessage(UI[this.getLanguage()].routeServiceUnavailable, "error");
      return;
    }

    const snapshot = this.getLocationSnapshot();
    if (!snapshot.coordinate) {
      if (announce) this.setMessage(UI[this.getLanguage()].routeNeedLocation, "error");
      this.requestLocation();
      return;
    }

    const currentSerial = ++this.requestSerial;
    this.routeRequestInFlight = true;
    this.refreshQueuedAfterFlight = false;
    this.lastRouteAttemptAt = window.performance.now();
    this.aborter?.abort();
    this.aborter = new AbortController();
    const origin: LngLatTuple = [snapshot.coordinate[0], snapshot.coordinate[1]];
    const destination: LngLatTuple = [this.destination[0], this.destination[1]];
    const hadExistingRoute = this.routeData.features.length > 0;
    let outcome: RouteAttemptStatus = "unavailable";

    try {
      const useMapbox = this.travelMode !== "car" || ROUTING_PROVIDER === "mapbox";
      if (useMapbox) {
        const constrained = hadExistingRoute && this.travelMode === "car";
        outcome = await this.tryMapboxRoute(currentSerial, origin, destination, snapshot, mapboxProfileForMode(this.travelMode), constrained);

        if (outcome === "no-route" && constrained) {
          outcome = await this.tryMapboxRoute(currentSerial, origin, destination, snapshot, mapboxProfileForMode(this.travelMode), false);
        }

        // Traffic coverage or directional snapping must never block a valid road route.
        if (outcome !== "success" && this.travelMode === "car") {
          const plainDriving = await this.tryMapboxRoute(currentSerial, origin, destination, snapshot, "mapbox/driving", false);
          if (plainDriving === "success") outcome = plainDriving;
          else if (outcome === "unavailable") outcome = plainDriving;
        }

        // The configured/public OSRM fallback is driving-only. Bicycle and
        // walking always stay on their canonical Mapbox profiles instead of
        // silently requesting unsupported OSRM profile paths.
        if (outcome !== "success" && this.travelMode === "car") {
          const osrmOutcome = await this.tryOsrmRoute(currentSerial, origin, destination);
          if (osrmOutcome === "success") outcome = osrmOutcome;
          else if (outcome === "unavailable") outcome = osrmOutcome;
        }
      } else {
        outcome = await this.tryOsrmRoute(currentSerial, origin, destination);
      }

      if (!this.isCurrentRequest(currentSerial, destination)) return;
      if (outcome === "success") {
        if (announce) this.setMessage(UI[this.getLanguage()].routeReady, "success");
        return;
      }
      if (hadExistingRoute) {
        this.renderExistingRoute();
        return;
      }
      this.clearRouteLineOnly();
      this.renderRouteFailurePanel(outcome === "no-route" ? UI[this.getLanguage()].routeNoRoute : UI[this.getLanguage()].routeServiceUnavailable);
    } catch (error) {
      if (isAbortError(error)) return;
      if (!this.isCurrentRequest(currentSerial, destination)) return;
      if (hadExistingRoute) this.renderExistingRoute();
      else {
        this.clearRouteLineOnly();
        this.renderRouteFailurePanel(UI[this.getLanguage()].routeServiceUnavailable);
      }
    } finally {
      if (currentSerial === this.requestSerial) {
        this.routeRequestInFlight = false;
        this.aborter = null;
        if (this.refreshQueuedAfterFlight && this.destination) {
          this.refreshQueuedAfterFlight = false;
          this.scheduleRouteRefresh(420, false);
        }
      }
    }
  }

  private async fetchRouteJson<T>(url: string, label: string, timeoutMs = ROUTE_REQUEST_TIMEOUT_MS): Promise<T> {
    const parentSignal = this.aborter?.signal;
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = (): void => controller.abort();
    parentSignal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetchJson<T>(url, { signal: controller.signal, mode: "cors", cache: "no-store" }, label);
    } catch (error) {
      if (timedOut && !parentSignal?.aborted) throw new RouteRequestTimeoutError();
      throw error;
    } finally {
      window.clearTimeout(timeout);
      parentSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  private async tryMapboxRoute(
    currentSerial: number,
    origin: LngLatTuple,
    destination: LngLatTuple,
    snapshot: LiveLocationDiagnosticSnapshot,
    profile: string,
    constrained: boolean
  ): Promise<RouteAttemptStatus> {
    const accuracy = Math.max(60, Math.min(250, Math.round((snapshot.accuracyMeters || 30) * 2.5)));
    const coordinatePath = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
    const trafficProfile = profile === "mapbox/driving-traffic";
    const annotations = trafficProfile
      ? "duration,distance,speed,congestion,congestion_numeric"
      : "duration,distance";
    const params = new URLSearchParams({
      alternatives: "false",
      geometries: "geojson",
      overview: "full",
      access_token: MAPBOX_ACCESS_TOKEN
    });
    params.set("annotations", annotations);
    if (this.travelMode === "car") params.set("radiuses", constrained ? `${accuracy};unlimited` : "unlimited;unlimited");
    if (trafficProfile) params.set("depart_at", "now");
    const reliableHeading = constrained
      && snapshot.headingDegrees !== null
      && Number.isFinite(snapshot.headingDegrees)
      && (snapshot.headingSource === "gps-course" || snapshot.headingSource === "movement-course")
      && snapshot.headingConfidence >= 0.5
      && snapshot.accuracyMeters > 0
      && snapshot.accuracyMeters <= 45;
    if (reliableHeading) params.set("bearings", `${Math.round(snapshot.headingDegrees!)},90;`);

    try {
      const url = `${MAPBOX_BASE_URL}/${profile}/${coordinatePath}?${params.toString()}`;
      const response = await this.fetchRouteJson<MapboxResponse>(url, "Traffic routing");
      if (!this.isCurrentRequest(currentSerial, destination)) return "unavailable";
      const route = response.routes?.[0];
      if (response.code !== "Ok" || !route?.geometry || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
        return response.code === "NoRoute" || response.code === "NoSegment" ? "no-route" : "unavailable";
      }
      this.commitRoute(origin, destination, route.distance || 0, route.duration || 0, routeFeaturesFromMapbox(route), response.waypoints, response.waypoints?.[1]?.name || route.legs?.[0]?.summary);
      return "success";
    } catch (error) {
      if (isAbortError(error)) throw error;
      return "unavailable";
    }
  }

  private async tryOsrmRoute(currentSerial: number, origin: LngLatTuple, destination: LngLatTuple): Promise<RouteAttemptStatus> {
    const coordinatePath = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
    const params = new URLSearchParams({
      alternatives: "false",
      steps: "false",
      geometries: "geojson",
      overview: "full",
      annotations: "duration,distance",
      radiuses: "unlimited;unlimited"
    });
    try {
      const url = `${OSRM_BASE_URL}/route/v1/${encodeURIComponent(osrmProfileForMode(this.travelMode))}/${coordinatePath}?${params.toString()}`;
      const response = await this.fetchRouteJson<OsrmResponse>(url, "Routing", 8_000);
      if (!this.isCurrentRequest(currentSerial, destination)) return "unavailable";
      const route = response.routes?.[0];
      if (response.code !== "Ok" || !route?.geometry || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) {
        return response.code === "NoRoute" || response.code === "NoSegment" ? "no-route" : "unavailable";
      }
      this.commitRoute(origin, destination, route.distance || 0, route.duration || 0, routeFeaturesFromGeometry(route.geometry, route.distance || 0, route.duration || 0, "unknown"), response.waypoints, response.waypoints?.[1]?.name || route.legs?.[0]?.summary);
      return "success";
    } catch (error) {
      if (isAbortError(error)) throw error;
      return "unavailable";
    }
  }

  private commitRoute(origin: LngLatTuple, destination: LngLatTuple, distance: number, duration: number, features: RouteFeatureCollection["features"], waypoints: RouteWaypoint[] | undefined, roadName: unknown): void {
    if (!this.destination || !this.sameCoordinate(this.destination, destination)) return;
    const connectedFeatures = connectedRouteFeatures(features, origin, destination);
    this.lastRouteOrigin = origin;
    this.lastRouteAt = window.performance.now();
    this.lastDistance = distance;
    this.lastDuration = duration;
    this.routeProviderDistance = distance;
    this.routeProviderDuration = duration;
    this.routeCoordinates = flattenedRouteCoordinates(connectedFeatures);
    this.nearestRoad = normalizedRoadName(roadName, this.getLanguage());
    this.updateRouteSource(connectedFeatures, waypoints);
    if (this.navigating) this.startRouteAnimation();
    else this.stopRouteAnimation();
    this.startDestinationAnimation();
    this.renderPanel();
  }

  private updateRouteSource(features: RouteFeatureCollection["features"], waypoints: RouteWaypoint[] | undefined): void {
    this.routeData = { type: "FeatureCollection", features };
    const routeSource = this.map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    routeSource?.setData(this.routeData);
    this.renderPoints(waypoints);
    this.syncRouteVisualState();
  }

  private renderPoints(waypoints?: RouteWaypoint[]): void {
    const features: RoutePointCollection["features"] = [];
    if (this.destination) features.push(pointFeature(this.destination, "destination"));
    const snappedOrigin = waypoints?.[0]?.location;
    const snappedDestination = waypoints?.[1]?.location;
    if (isLngLatTuple(snappedOrigin)) features.push(pointFeature(snappedOrigin, "snapped-origin"));
    if (isLngLatTuple(snappedDestination)) features.push(pointFeature(snappedDestination, "snapped-destination"));
    this.pointData = { type: "FeatureCollection", features };
    const source = this.map.getSource(DESTINATION_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(this.pointData);
  }

  private renderSources(): void {
    const preserved = this.pointData.features.filter((feature) => feature.properties.kind !== "destination" && feature.properties.kind !== "candidate");
    const features: RoutePointCollection["features"] = [];
    if (this.destination) features.push(pointFeature(this.destination, "destination"));
    if (this.pendingDestination) features.push(pointFeature(this.pendingDestination, "candidate"));
    this.pointData = { type: "FeatureCollection", features: [...features, ...preserved] };
    const routeSource = this.map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const pointSource = this.map.getSource(DESTINATION_SOURCE) as maplibregl.GeoJSONSource | undefined;
    routeSource?.setData(this.routeData);
    pointSource?.setData(this.pointData);
  }

  private renderExistingRoute(): void {
    const routeSource = this.map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    const pointSource = this.map.getSource(DESTINATION_SOURCE) as maplibregl.GeoJSONSource | undefined;
    routeSource?.setData(this.routeData);
    pointSource?.setData(this.pointData);
    this.syncRouteVisualState();
    if (this.routeData.features.length > 0) {
      if (this.navigating) this.startRouteAnimation();
      else this.stopRouteAnimation();
      this.startDestinationAnimation();
      this.renderPanel();
    }
  }

  private clearRouteLineOnly(): void {
    this.routeData = emptyRoute();
    const routeSource = this.map.getSource(ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined;
    routeSource?.setData(this.routeData);
    this.stopRouteAnimation();
    this.syncRouteVisualState();
  }


  private startRouteAnimation(): void {
    if (this.reducedMotion) return;
    if (this.map.getLayer(ROUTE_LAYER_SHEEN)) this.map.setPaintProperty(ROUTE_LAYER_SHEEN, "line-opacity", 0.72);
    this.routeAnimation.start();
  }

  private stopRouteAnimation(): void {
    this.routeAnimation.stop();
    if (this.map.getLayer(ROUTE_LAYER_SHEEN)) this.map.setPaintProperty(ROUTE_LAYER_SHEEN, "line-opacity", 0);
  }

  private startDestinationAnimation(): void {
    if (this.reducedMotion) return;
    this.destinationAnimation.start();
  }

  private stopDestinationAnimation(): void {
    this.destinationAnimation.stop();
    if (this.map.getLayer(DESTINATION_PULSE)) {
      this.map.setPaintProperty(DESTINATION_PULSE, "circle-opacity", 0);
      this.map.setPaintProperty(DESTINATION_PULSE, "circle-stroke-opacity", 0);
    }
  }

  private paintRouteAnimation(now: number): boolean {
    if (!this.navigating || !this.destination || !this.map.getLayer(ROUTE_LAYER_SHEEN)) return false;
    const phase = (now % 3200) / 3200;
    const start = 0.001 + phase * 0.82;
    const mid = start + 0.045;
    const end = start + 0.115;
    this.map.setPaintProperty(ROUTE_LAYER_SHEEN, "line-gradient", [
      "interpolate", ["linear"], ["line-progress"],
      0, "rgba(255,255,255,0)",
      start, "rgba(255,255,255,0)",
      mid, "rgba(207,235,255,0.76)",
      end, "rgba(255,176,244,0)",
      1, "rgba(255,255,255,0)"
    ]);
    return true;
  }

  private paintDestinationAnimation(now: number): boolean {
    if (!this.destination || !this.map.getLayer(DESTINATION_PULSE)) return false;
    const phase = (now % 1950) / 1950;
    this.map.setPaintProperty(DESTINATION_PULSE, "circle-radius", 11 + phase * 21);
    this.map.setPaintProperty(DESTINATION_PULSE, "circle-opacity", 0.22 * (1 - phase));
    this.map.setPaintProperty(DESTINATION_PULSE, "circle-stroke-opacity", 0.44 * (1 - phase));
    return true;
  }

  private applyNavigationPalette(): void {
    const brand = "#7657ff";
    const primary = "#2d8cff";
    const routeColor = this.navigating
      ? brand
      : ["match", ["get", "traffic"], "low", "#3d8dff", "moderate", "#675cff", "heavy", "#f0b95a", "severe", "#ff6378", "closed", "#ff315f", primary];
    if (this.map.getLayer(ROUTE_LAYER_GLOW)) this.map.setPaintProperty(ROUTE_LAYER_GLOW, "line-color", this.navigating ? brand : primary);
    if (this.map.getLayer(ROUTE_LAYER)) this.map.setPaintProperty(ROUTE_LAYER, "line-color", routeColor as never);
    for (const layerId of [DESTINATION_PULSE, DESTINATION_HALO, DESTINATION_LAYER] as const) {
      if (this.map.getLayer(layerId)) this.map.setPaintProperty(layerId, "circle-color", this.navigating ? brand : primary);
    }
    if (this.map.getLayer(DESTINATION_HALO)) this.map.setPaintProperty(DESTINATION_HALO, "circle-stroke-color", this.navigating ? "#c4b5fd" : "#4ccbff");

    const puckColor = this.navigating ? brand : "#4f8cff";
    if (this.map.getLayer("location-dot")) this.map.setPaintProperty("location-dot", "circle-color", puckColor);
    if (this.map.getLayer("location-accuracy-fill")) this.map.setPaintProperty("location-accuracy-fill", "fill-color", puckColor);
    if (this.map.getLayer("location-accuracy-line")) this.map.setPaintProperty("location-accuracy-line", "line-color", this.navigating ? "#c4b5fd" : "#9bcaff");
  }

  private renderNavigationHud(): void {
    if (!this.navigating || !this.destination) {
      this.navigationHud.hidden = true;
      return;
    }
    const language = this.getLanguage();
    this.navigationHudDistance.textContent = formatDistance(this.lastDistance, language);
    this.navigationHudDuration.textContent = formatDuration(this.lastDuration, language);
    this.navigationHudDestination.textContent = this.destinationName || UI[language].routeDestination;
    this.navigationHud.hidden = false;
  }

  private recordNavigationHistory(status: AtlasNavigationHistoryInput["status"]): void {
    if (!this.destination || this.navigationStartedAt <= 0) return;
    const endedAt = Date.now();
    const entry: AtlasNavigationHistoryInput = {
      id: `${this.navigationStartedAt}-${endedAt}`,
      status,
      startedAt: this.navigationStartedAt,
      endedAt,
      destination: this.destinationName || UI[this.getLanguage()].routeDestination,
      coordinate: [this.destination[0], this.destination[1]],
      travelMode: this.travelMode,
      plannedDistanceMeters: Math.max(0, this.navigationPlannedDistance),
      remainingDistanceMeters: status === "arrived" ? 0 : Math.max(0, this.lastDistance),
      plannedDurationSeconds: Math.max(0, this.navigationPlannedDuration),
      elapsedSeconds: Math.max(0, Math.round((endedAt - this.navigationStartedAt) / 1000))
    };
    queueNavigationHistory(entry);
    window.dispatchEvent(new CustomEvent("nav-kurd:navigation-history", { detail: entry }));
    void saveAtlasNavigationHistory(entry).then((saved) => {
      if (saved) removePendingNavigationHistory(entry.id);
    }).catch(() => {
      // The local copy remains queued for the next authenticated studio sync.
    });
  }

  private setPinMode(active: boolean): void {
    this.pinMode = active;
    const pressed = active || this.navigating;
    this.routeButton.classList.toggle("is-active", pressed);
    this.routeButton.setAttribute("aria-pressed", String(pressed));
    this.map.getCanvas().style.cursor = active ? "crosshair" : "";
    this.syncRouteVisualState();
  }

  private cancelPendingRouteRequest(): void {
    this.requestSerial += 1;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.scheduledAnnouncement = false;
    this.refreshQueuedAfterFlight = false;
    this.routeRequestInFlight = false;
    this.aborter?.abort();
    this.aborter = null;
  }

  private sameCoordinate(a: LngLatTuple, b: LngLatTuple): boolean {
    return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  }

  private isCurrentRequest(serial: number, destination: LngLatTuple): boolean {
    return serial === this.requestSerial && this.destination !== null && this.sameCoordinate(this.destination, destination);
  }

  private renderPendingPanel(): void {
    const language = this.getLanguage();
    this.panel.dataset.state = "loading";
    this.titleElement.textContent = this.destinationName || UI[language].routeDestination;
    this.metricsElement.textContent = UI[language].routeCalculating;
    this.roadElement.textContent = "";
    this.startButton.hidden = false;
    this.startButton.disabled = true;
    this.startButton.classList.remove("is-cancel");
    this.startButton.querySelector<HTMLElement>("[data-route-start-label]")!.textContent = UI[language].routeStart;
    this.navigationHud.hidden = true;
    this.panel.hidden = false;
  }


  private renderRouteFailurePanel(message: string): void {
    const language = this.getLanguage();
    this.panel.dataset.state = "error";
    this.titleElement.textContent = this.destinationName || UI[language].routeDestination;
    this.metricsElement.textContent = message;
    this.roadElement.textContent = "";
    this.startButton.hidden = true;
    this.startButton.classList.remove("is-cancel");
    this.navigationHud.hidden = true;
    this.panel.hidden = false;
  }

  private renderPanel(): void {
    const language = this.getLanguage();
    this.panel.dataset.state = this.navigating ? "navigating" : "ready";
    this.titleElement.textContent = this.destinationName || UI[language].routeDestination;
    const speed = formatRouteSpeed(this.lastDistance, this.lastDuration, language);
    const profileLabel = this.travelMode === "bicycle"
      ? UI[language].routeModeBicycle
      : this.travelMode === "walking"
        ? UI[language].routeModeWalking
        : UI[language].routeModeCar;
    this.metricsElement.textContent = [profileLabel, formatDuration(this.lastDuration, language), formatDistance(this.lastDistance, language), speed].filter(Boolean).join(" · ");
    this.roadElement.textContent = `${UI[language].routeNearestRoad}: ${this.nearestRoad || UI[language].routeNearestRoadUnknown}`;
    this.startButton.hidden = false;
    this.startButton.disabled = false;
    this.startButton.classList.toggle("is-cancel", this.navigating);
    this.startButton.title = this.navigating ? UI[language].routeCancel : UI[language].routeStart;
    this.startButton.setAttribute("aria-label", this.startButton.title);
    this.startButton.querySelector<HTMLElement>("[data-route-start-label]")!.textContent = this.navigating ? UI[language].routeCancel : UI[language].routeStart;
    this.modeButtons.forEach((button) => { button.disabled = this.navigating; });
    this.panel.hidden = false;
    this.renderNavigationHud();
  }
}
