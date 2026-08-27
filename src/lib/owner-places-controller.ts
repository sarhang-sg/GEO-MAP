import type { FeatureCollection, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import { atlasErrorMessage, isAtlasBackendConfigured, loadPublishedAtlasPlaces, type AtlasPlace } from "./atlas-places";
import { isMeaningfulMapName } from "./geo-format";
import { atlasMarkerProfile } from "./atlas-marker-catalog";
import { UI } from "./i18n";
import type { Language, OwnerFeature } from "./types";

export type OwnerPlacesControllerOptions = {
  map: MapLibreMap;
  countElement: HTMLElement;
  backendStateElement: HTMLElement;
  getLanguage: () => Language;
  onWarning?: (message: string) => void;
  onPlacesChanged?: (places: readonly AtlasPlace[]) => void;
  sourceId?: string;
};

function hasPublicName(place: AtlasPlace): boolean {
  return [place.name_ku, place.name_ar, place.name_en].some((name) => isMeaningfulMapName(name));
}

/**
 * Owns public owner/checkpoint synchronization and its MapLibre source updates.
 * It keeps Supabase latency out of the boot path and gives the app one canonical
 * place for owner-place collection, lookup and status rendering.
 */
export class OwnerPlacesController {
  private readonly map: MapLibreMap;
  private readonly countElement: HTMLElement;
  private readonly backendStateElement: HTMLElement;
  private readonly getLanguage: () => Language;
  private readonly onWarning?: (message: string) => void;
  private readonly onPlacesChanged?: (places: readonly AtlasPlace[]) => void;
  private readonly sourceId: string;
  private places: AtlasPlace[] = [];
  private refreshTimer: number | null = null;

  constructor(options: OwnerPlacesControllerOptions) {
    this.map = options.map;
    this.countElement = options.countElement;
    this.backendStateElement = options.backendStateElement;
    this.getLanguage = options.getLanguage;
    this.onWarning = options.onWarning;
    this.onPlacesChanged = options.onPlacesChanged;
    this.sourceId = options.sourceId ?? "atlas-places-source";
  }

  get isConfigured(): boolean {
    return isAtlasBackendConfigured;
  }

  getItems(): AtlasPlace[] {
    return this.places;
  }

  setLanguageStatus(): void {
    const language = this.getLanguage();
    const state = this.backendStateElement.dataset.serviceState;
    if (!isAtlasBackendConfigured) {
      this.setBackendState(UI[language].localBase, "local");
      return;
    }
    if (state === "error") this.setBackendState(UI[language].ownerBackendOffline, "error");
    else this.setBackendState(UI[language].connected, "connected");
  }

  collection(): FeatureCollection<Point, OwnerFeature["properties"]> {
    return {
      type: "FeatureCollection",
      features: this.places
        .filter((place) => hasPublicName(place) && Number.isFinite(place.longitude) && Number.isFinite(place.latitude))
        .map((place) => {
          const marker = atlasMarkerProfile(place.category);
          return {
            type: "Feature" as const,
            properties: {
              id: place.id,
              category: marker.id,
              name_ku: place.name_ku,
              name_ar: place.name_ar,
              name_en: place.name_en,
              marker_icon: marker.imageId,
              marker_tier: marker.tier,
              marker_color: marker.color,
              marker_priority: marker.priority
            },
            geometry: { type: "Point" as const, coordinates: [place.longitude, place.latitude] }
          };
        })
    };
  }

  byId(id: unknown): AtlasPlace | null {
    const normalizedId = typeof id === "string" || typeof id === "number" ? String(id) : "";
    if (!normalizedId) return null;
    return this.places.find((place) => place.id === normalizedId) ?? null;
  }

  async refresh(): Promise<void> {
    const language = this.getLanguage();
    if (!isAtlasBackendConfigured) {
      this.places = [];
      this.countElement.textContent = "0";
      this.setBackendState(UI[language].localBase, "local");
      this.updateMapSource();
      this.onPlacesChanged?.(this.places);
      return;
    }

    try {
      const nextPlaces = await loadPublishedAtlasPlaces();
      this.places = nextPlaces.filter(hasPublicName);
      this.countElement.textContent = new Intl.NumberFormat("en-US").format(this.places.length);
      this.setBackendState(UI[language].connected, "connected");
      this.updateMapSource();
      this.onPlacesChanged?.(this.places);
    } catch (error) {
      // Keep the last good owner-place collection visible; a temporary Supabase/network
      // failure must never clear the map or break static KRI data.
      this.setBackendState(UI[language].ownerBackendOffline, "error");
      this.onWarning?.(atlasErrorMessage(error, UI[language].ownerBackendOffline));
      this.updateMapSource();
    }
  }

  queueRefresh(delayMs = 650): void {
    if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => { void this.refresh(); }, delayMs);
  }

  private setBackendState(label: string, state: "connected" | "local" | "error"): void {
    this.backendStateElement.textContent = label;
    this.backendStateElement.dataset.serviceState = state;
  }

  private updateMapSource(): void {
    const source = this.map.getSource(this.sourceId) as GeoJSONSource | undefined;
    source?.setData(this.collection());
  }
}
