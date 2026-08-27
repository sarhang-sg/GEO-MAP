import maplibregl, { type Map as MapLibreMap, type Marker } from "maplibre-gl";
import { KRI_BOUNDS, type KriLayers } from "./kri";
import { languageDirection } from "./i18n";
import { labelKey, languageValue, placeRank, pointKind } from "./geo-format";
import { localizeNameValue } from "./map-language";
import type { AdministrativeLabelFeature, Language, LocalityFeature, RoadLabelFeature } from "./types";
import type { LngLatTuple } from "./location";
import { yieldToMainThread } from "./performance";

type LabelControllerOptions = {
  map: MapLibreMap;
  getLayers: () => KriLayers | null;
  getLocalities: () => readonly LocalityFeature[];
  getLanguage: () => Language;
  getBasemapVisible: () => boolean;
  getAdministrativeVisible: () => boolean;
  getPlacesVisible: () => boolean;
  isMobileViewport: () => boolean;
  lowPowerProfile: boolean;
  focusLocality: (feature: LocalityFeature) => void;
  getRouteSegments?: () => readonly (readonly LngLatTuple[])[];
};

/**
 * Owns all DOM markers used as text labels above the MapLibre data layers.
 * The shared registry prevents locality, administrative and road labels from
 * drawing on top of each other while keeping the map fast on mobile devices.
 */
export class LabelController {
  private readonly map: MapLibreMap;
  private readonly getLayers: () => KriLayers | null;
  private readonly getLocalities: () => readonly LocalityFeature[];
  private readonly getLanguage: () => Language;
  private readonly getBasemapVisible: () => boolean;
  private readonly getAdministrativeVisible: () => boolean;
  private readonly getPlacesVisible: () => boolean;
  private readonly isMobileViewport: () => boolean;
  private readonly lowPowerProfile: boolean;
  private readonly focusLocality: (feature: LocalityFeature) => void;
  private readonly getRouteSegments: () => readonly (readonly LngLatTuple[])[];
  private readonly localityMarkers = new globalThis.Map<string, Marker>();
  private readonly administrativeMarkers = new globalThis.Map<string, Marker>();
  private readonly roadLabelMarkers = new globalThis.Map<string, Marker>();
  private readonly visibleLabelNameKeys = new Set<string>();
  private readonly occupiedLabelCells = new Set<string>();
  private labelsRefreshQueued = false;
  private labelsRefreshPending = false;
  private administrativeRefreshQueued = false;
  private protectedRouteSegments: Array<Array<{ x: number; y: number }>> = [];
  private frameWidth = 1;
  private frameHeight = 1;
  private frameZoom = 0;
  private frameCompact = false;
  private localityOrderSource: readonly LocalityFeature[] | null = null;
  private localityOrder: readonly LocalityFeature[] = [];
  private roadOrderLayer: KriLayers["roadLabels"] | null = null;
  private roadOrder: readonly RoadLabelFeature[] = [];

  constructor(options: LabelControllerOptions) {
    this.map = options.map;
    this.getLayers = options.getLayers;
    this.getLocalities = options.getLocalities;
    this.getLanguage = options.getLanguage;
    this.getBasemapVisible = options.getBasemapVisible;
    this.getAdministrativeVisible = options.getAdministrativeVisible;
    this.getPlacesVisible = options.getPlacesVisible;
    this.isMobileViewport = options.isMobileViewport;
    this.lowPowerProfile = options.lowPowerProfile;
    this.focusLocality = options.focusLocality;
    this.getRouteSegments = options.getRouteSegments ?? (() => []);
  }

  queue(): void {
    if (!this.getLayers()) return;
    if (this.labelsRefreshQueued) {
      this.labelsRefreshPending = true;
      return;
    }
    this.labelsRefreshQueued = true;
    void this.runQueuedRefresh();
  }

  private captureFrameContext(): void {
    const canvas = this.map.getCanvas();
    const pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    this.frameWidth = Math.max(1, canvas.width / pixelRatio);
    this.frameHeight = Math.max(1, canvas.height / pixelRatio);
    this.frameZoom = this.map.getZoom();
    this.frameCompact = this.isMobileViewport() || this.lowPowerProfile;
  }

  private async runQueuedRefresh(): Promise<void> {
    try {
      do {
        this.labelsRefreshPending = false;
        this.captureFrameContext();
        this.resetVisualReservations();
        this.refreshProtectedRouteSegments();
        this.refreshAdministrativeLabels();
        await yieldToMainThread();
        this.refreshLocalityLabels();
        await yieldToMainThread();
        this.refreshRoadLabels();
      } while (this.labelsRefreshPending && this.getLayers());
    } finally {
      this.labelsRefreshQueued = false;
      if (this.labelsRefreshPending) this.queue();
    }
  }

  /**
   * Refreshes only administrative labels after the administrative-layer toggle.
   * Existing locality and road labels are reserved first, so toggling boundary
   * lines never causes unrelated yellow/road labels to jump to different
   * candidates or visual cells.
   */
  queueAdministrative(): void {
    // Administrative labels share collision reservations with locality and road
    // labels. One cooperative transaction avoids a second layout pass.
    if (this.administrativeRefreshQueued) return;
    this.administrativeRefreshQueued = true;
    this.queue();
    window.queueMicrotask(() => { this.administrativeRefreshQueued = false; });
  }

  clear(): void {
    this.localityMarkers.forEach((marker) => marker.remove());
    this.administrativeMarkers.forEach((marker) => marker.remove());
    this.roadLabelMarkers.forEach((marker) => marker.remove());
    this.localityMarkers.clear();
    this.administrativeMarkers.clear();
    this.roadLabelMarkers.clear();
    this.visibleLabelNameKeys.clear();
    this.occupiedLabelCells.clear();
  }

  private resetVisualReservations(): void {
    this.visibleLabelNameKeys.clear();
    this.occupiedLabelCells.clear();
  }


  /** One shared projected grid prevents cross-layer visual label collisions. */
  private visualCell(point: { x: number; y: number }): string {
    const unit = this.frameCompact
      ? (this.frameZoom < 7.6 ? 148 : this.frameZoom < 9.2 ? 132 : this.frameZoom < 11.5 ? 114 : this.frameZoom < 13.5 ? 100 : 90)
      : (this.frameZoom < 7.6 ? 126 : this.frameZoom < 9.2 ? 112 : this.frameZoom < 11.5 ? 96 : this.frameZoom < 13.5 ? 84 : 76);
    return `${Math.floor(point.x / unit)}:${Math.floor(point.y / unit)}`;
  }

  private refreshProtectedRouteSegments(): void {
    this.protectedRouteSegments = this.getRouteSegments()
      .map((segment) => segment.map((coordinate) => this.map.project(coordinate)))
      .filter((segment) => segment.length >= 2);
  }

  private distanceToSegment(
    point: { x: number; y: number },
    start: { x: number; y: number },
    end: { x: number; y: number }
  ): number {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    const nearestX = start.x + t * dx;
    const nearestY = start.y + t * dy;
    return Math.hypot(point.x - nearestX, point.y - nearestY);
  }

  private intersectsProtectedRoute(point: { x: number; y: number }, keys: readonly string[]): boolean {
    if (!this.protectedRouteSegments.length) return false;
    const longestLabel = keys.reduce((max, key) => Math.max(max, Array.from(key.trim()).length), 0);
    const clearance = Math.min(this.frameCompact ? 46 : 54, Math.max(this.frameCompact ? 22 : 24, 16 + longestLabel * (this.frameCompact ? 1.55 : 1.85)));
    for (const segment of this.protectedRouteSegments) {
      for (let index = 1; index < segment.length; index += 1) {
        if (this.distanceToSegment(point, segment[index - 1], segment[index]) <= clearance) return true;
      }
    }
    return false;
  }

  private isLabelAnchorInsideSafeViewport(point: { x: number; y: number }, keys: readonly string[]): boolean {
    const longestLabel = keys.reduce((max, key) => Math.max(max, Array.from(key.trim()).length), 0);
    const horizontalPadding = Math.min(118, Math.max(this.frameCompact ? 52 : 44, 28 + longestLabel * 3.7));
    const topPadding = this.frameCompact ? 42 : 34;
    const bottomPadding = this.frameCompact ? 38 : 30;
    return point.x >= horizontalPadding &&
      point.x <= this.frameWidth - horizontalPadding &&
      point.y >= topPadding &&
      point.y <= this.frameHeight - bottomPadding;
  }

  private reserveVisualLabel(coordinate: LngLatTuple, keys: readonly string[]): boolean {
    const point = this.map.project(coordinate);
    if (!this.isLabelAnchorInsideSafeViewport(point, keys)) return false;
    if (this.intersectsProtectedRoute(point, keys)) return false;
    const cell = this.visualCell(point);
    const normalizedKeys = keys.map(labelKey).filter(Boolean);
    if (this.occupiedLabelCells.has(cell) || normalizedKeys.some((key) => this.visibleLabelNameKeys.has(key))) return false;
    this.occupiedLabelCells.add(cell);
    normalizedKeys.forEach((key) => this.visibleLabelNameKeys.add(key));
    return true;
  }

  private refreshLocalityLabels(): void {
    if (!this.getPlacesVisible()) {
      this.localityMarkers.forEach((marker) => marker.remove());
      this.localityMarkers.clear();
      return;
    }
    const language = this.getLanguage();
    const zoom = this.map.getZoom();
    const bounds = this.map.getBounds();
    const padded = new maplibregl.LngLatBounds(
      [Math.max(KRI_BOUNDS[0][0], bounds.getWest() - 0.18), Math.max(KRI_BOUNDS[0][1], bounds.getSouth() - 0.12)],
      [Math.min(KRI_BOUNDS[1][0], bounds.getEast() + 0.18), Math.min(KRI_BOUNDS[1][1], bounds.getNorth() + 0.12)]
    );
    const compact = this.isMobileViewport() || this.lowPowerProfile;
    const minimumRank = zoom < 7.6 ? 100 : zoom < 9.2 ? 90 : zoom < 10.8 ? 80 : zoom < 13 ? 55 : 45;
    const maxLabels = compact
      ? (zoom < 7.6 ? 6 : zoom < 9.2 ? 10 : zoom < 10.8 ? 18 : zoom < 13 ? 30 : 48)
      : (zoom < 7.6 ? 8 : zoom < 9.2 ? 16 : zoom < 10.8 ? 28 : zoom < 13 ? 46 : 72);
    const seenNames = new Set<string>();
    const selected: LocalityFeature[] = [];
    const selectedIds = new Set<string>();
    const localitySource = this.getLocalities();
    if (this.localityOrderSource !== localitySource) {
      this.localityOrderSource = localitySource;
      this.localityOrder = [...localitySource].sort((a, b) => placeRank(b.properties.place) - placeRank(a.properties.place));
    }
    const candidates = this.localityOrder
      .filter((entry) => padded.contains(entry.geometry.coordinates as LngLatTuple))
      .filter((entry) => placeRank(entry.properties.place) >= minimumRank);
    const candidateById = new Map(candidates.map((feature) => [feature.properties.id, feature] as const));
    const trySelect = (feature: LocalityFeature): void => {
      if (selected.length >= maxLabels || selectedIds.has(feature.properties.id)) return;
      const coordinate = feature.geometry.coordinates as LngLatTuple;
      const name = languageValue(feature.properties, language);
      const nameKey = labelKey(name);
      if (!nameKey || seenNames.has(nameKey)) return;
      if (!this.reserveVisualLabel(coordinate, [name])) return;
      seenNames.add(nameKey);
      selectedIds.add(feature.properties.id);
      selected.push(feature);
    };

    // Preserve already-visible labels first whenever they are still eligible.
    // This hysteresis prevents small pans and GPS recenter moves from replacing
    // a place name with a different nearby candidate in the same visual cell.
    for (const id of this.localityMarkers.keys()) {
      const feature = candidateById.get(id);
      if (feature) trySelect(feature);
    }
    for (const feature of candidates) {
      trySelect(feature);
      if (selected.length >= maxLabels) break;
    }
    const desired = new Set(selected.map((feature) => feature.properties.id));
    this.localityMarkers.forEach((marker, id) => {
      if (!desired.has(id)) { marker.remove(); this.localityMarkers.delete(id); }
    });
    selected.forEach((feature) => {
      const id = feature.properties.id;
      const name = languageValue(feature.properties, language);
      const kind = pointKind(feature.properties.place);
      const current = this.localityMarkers.get(id);
      if (current) {
        const element = current.getElement();
        if (element.textContent !== name) element.textContent = name;
        if (element.dataset.kind !== kind) element.dataset.kind = kind;
        if (element.dataset.language !== language) element.dataset.language = language;
        const direction = languageDirection(language);
        if (element.dir !== direction) element.dir = direction;
        return;
      }
      const element = document.createElement("button");
      element.type = "button";
      element.className = "locality-label";
      element.dataset.kind = kind;
      element.dataset.language = language;
      element.dir = languageDirection(language);
      element.textContent = name;
      element.setAttribute("aria-label", name);
      element.addEventListener("click", () => this.focusLocality(feature));
      this.localityMarkers.set(id, new maplibregl.Marker({ element, anchor: "bottom", offset: [0, -3] }).setLngLat(feature.geometry.coordinates as LngLatTuple).addTo(this.map));
    });
  }

  private refreshRoadLabels(): void {
    const layers = this.getLayers();
    if (!layers || !this.getBasemapVisible()) {
      this.roadLabelMarkers.forEach((marker) => marker.remove());
      this.roadLabelMarkers.clear();
      return;
    }
    const zoom = this.map.getZoom();
    const roadLabelMinZoom = this.isMobileViewport() || this.lowPowerProfile ? 10.6 : 9.4;
    if (zoom < roadLabelMinZoom) {
      this.roadLabelMarkers.forEach((marker) => marker.remove());
      this.roadLabelMarkers.clear();
      return;
    }
    const bounds = this.map.getBounds();
    const padded = new maplibregl.LngLatBounds(
      [Math.max(KRI_BOUNDS[0][0], bounds.getWest() - 0.14), Math.max(KRI_BOUNDS[0][1], bounds.getSouth() - 0.10)],
      [Math.min(KRI_BOUNDS[1][0], bounds.getEast() + 0.14), Math.min(KRI_BOUNDS[1][1], bounds.getNorth() + 0.10)]
    );
    const compact = this.isMobileViewport() || this.lowPowerProfile;
    const maxLabels = compact
      ? (zoom < 11.6 ? 5 : zoom < 13 ? 10 : zoom < 15 ? 17 : 24)
      : (zoom < 10.8 ? 8 : zoom < 12.5 ? 14 : zoom < 15 ? 23 : 32);
    const selected: RoadLabelFeature[] = [];
    const selectedIds = new Set<string>();
    const usedRoadAliases = new Set<string>();
    const roadLanguage = this.getLanguage();
    if (this.roadOrderLayer !== layers.roadLabels) {
      // KriLayers is immutable for a style lifecycle; keep a stable sorted copy
      // rather than sorting every time the map stops moving.
      this.roadOrderLayer = layers.roadLabels;
      this.roadOrder = layers.roadLabels.features
        .filter((feature): feature is RoadLabelFeature => feature.geometry?.type === "Point" && Boolean(feature.properties?.id))
        .sort((a, b) => Number(b.properties.rank) - Number(a.properties.rank));
    }
    const candidates = this.roadOrder
      .filter((feature) => Boolean(feature.properties?.[`name_${roadLanguage}`]))
      .filter((feature) => Number(feature.properties.minzoom) <= zoom && padded.contains(feature.geometry.coordinates as LngLatTuple));
    const candidateById = new Map(candidates.map((feature) => [feature.properties.id, feature] as const));
    const trySelect = (feature: RoadLabelFeature): void => {
      if (selected.length >= maxLabels || selectedIds.has(feature.properties.id)) return;
      const { ref } = feature.properties;
      const name = String(feature.properties[`name_${roadLanguage}`] || "");
      const aliases = [name, ref || ""].map(labelKey).filter(Boolean);
      if (aliases.some((alias) => usedRoadAliases.has(alias))) return;
      if (!this.reserveVisualLabel(feature.geometry.coordinates as LngLatTuple, aliases)) return;
      aliases.forEach((alias) => usedRoadAliases.add(alias));
      selectedIds.add(feature.properties.id);
      selected.push(feature);
    };

    for (const id of this.roadLabelMarkers.keys()) {
      const feature = candidateById.get(id);
      if (feature) trySelect(feature);
    }
    for (const feature of candidates) {
      trySelect(feature);
      if (selected.length >= maxLabels) break;
    }
    const desired = new Set(selected.map((feature) => feature.properties.id));
    this.roadLabelMarkers.forEach((marker, id) => {
      if (!desired.has(id)) { marker.remove(); this.roadLabelMarkers.delete(id); }
    });
    selected.forEach((feature) => {
      const { id, ref, class: roadClass } = feature.properties;
      const language = this.getLanguage();
      const exactName = feature.properties[`name_${language}`];
      const localizedRoadName = localizeNameValue(exactName, language);
      const localizedRef = ref ? String(ref) : "";
      const label = localizedRef && labelKey(localizedRef) !== labelKey(localizedRoadName) ? `${localizedRoadName} · ${localizedRef}` : localizedRoadName;
      const existing = this.roadLabelMarkers.get(id);
      if (existing) {
        const element = existing.getElement();
        if (element.textContent !== label) element.textContent = label;
        if (element.dataset.class !== roadClass) element.dataset.class = roadClass;
        return;
      }
      const element = document.createElement("span");
      element.className = "road-label";
      element.dataset.class = roadClass;
      element.textContent = label;
      element.dir = "auto";
      element.setAttribute("aria-hidden", "true");
      const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(feature.geometry.coordinates as LngLatTuple).addTo(this.map);
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
      element.removeAttribute("aria-label");
      this.roadLabelMarkers.set(id, marker);
    });
  }

  private refreshAdministrativeLabels(): void {
    const layers = this.getLayers();
    if (!layers || !this.getAdministrativeVisible()) {
      this.administrativeMarkers.forEach((marker) => marker.remove());
      this.administrativeMarkers.clear();
      return;
    }
    const language = this.getLanguage();
    const zoom = this.map.getZoom();
    // Governorate anchors use the same decluttering rules across the unified coverage.
    const features = layers.labels.features
      .filter((feature): feature is AdministrativeLabelFeature => feature.geometry?.type === "Point" && Boolean(feature.properties?.id))
      .filter((feature) => {
        // Keep region text at overview and show governorate anchors at mid zoom so no area name disappears.
        return (feature.properties.level === "region" && zoom < 7.35) || (feature.properties.level === "governorate" && zoom >= 7.15 && zoom < 9.8);
      });
    const selected: AdministrativeLabelFeature[] = [];
    const selectedIds = new Set<string>();
    const featureById = new Map(features.map((feature) => [feature.properties.id, feature] as const));
    const trySelect = (feature: AdministrativeLabelFeature): void => {
      if (selectedIds.has(feature.properties.id)) return;
      const name = language === "ku" ? feature.properties.name_ku : language === "ar" ? feature.properties.name_ar : feature.properties.name_en;
      if (!this.reserveVisualLabel(feature.geometry.coordinates as LngLatTuple, [name])) return;
      selectedIds.add(feature.properties.id);
      selected.push(feature);
    };

    for (const id of this.administrativeMarkers.keys()) {
      const feature = featureById.get(id);
      if (feature) trySelect(feature);
    }
    features.forEach(trySelect);
    const desired = new Set(selected.map((feature) => feature.properties.id));
    this.administrativeMarkers.forEach((marker, id) => {
      if (!desired.has(id)) { marker.remove(); this.administrativeMarkers.delete(id); }
    });
    selected.forEach((feature) => {
      const id = feature.properties.id;
      const name = language === "ku" ? feature.properties.name_ku : language === "ar" ? feature.properties.name_ar : feature.properties.name_en;
      const existing = this.administrativeMarkers.get(id);
      if (existing) {
        const element = existing.getElement();
        if (element.textContent !== name) element.textContent = name;
        if (element.dataset.language !== language) element.dataset.language = language;
        const direction = languageDirection(language);
        if (element.dir !== direction) element.dir = direction;
        return;
      }
      const element = document.createElement("span");
      element.className = "administrative-label";
      element.dataset.language = language;
      element.dataset.level = feature.properties.level;
      element.dir = languageDirection(language);
      element.textContent = name;
      element.setAttribute("aria-hidden", "true");
      const marker = new maplibregl.Marker({ element, anchor: "center" }).setLngLat(feature.geometry.coordinates as LngLatTuple).addTo(this.map);
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
      element.removeAttribute("aria-label");
      this.administrativeMarkers.set(id, marker);
    });
  }
}
