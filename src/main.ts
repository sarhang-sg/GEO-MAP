import "./pwa-register";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

import maplibregl, { type LngLatBoundsLike, type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { loadBrandFonts } from "./lib/font";
import { KRI_BOUNDS, isInsideKri, loadKriLayers, type KriLayers } from "./lib/kri";
import { atlasPhotoMediaUrl, consumeAtlasAuthIntent, getAtlasAuthIdentity, orderedAtlasPhotos, subscribeToAtlasAuth, subscribeToAtlasPlaces, type AtlasAuthIdentity, type AtlasPlace } from "./lib/atlas-places";
import { PlaceDetailPanel } from "./lib/place-detail";
import { loadStaticSearchManifest } from "./lib/static-search";
import { resolveSatelliteSource, validateSatelliteSource } from "./lib/satellite";
import { buildKriMapStyle } from "./lib/map-style";
import { applyKriStyleState } from "./lib/map-style-state";
import { distanceMeters, type LngLatTuple } from "./lib/location";
import { LiveLocationController } from "./lib/live-location-controller";
import { renderAppShell } from "./lib/app-shell";
import { installSelectionAndImageLocks, query } from "./lib/dom";
import { UI, languageDirection } from "./lib/i18n";
import { categoryValue, coordinateLabel, districtValue, escapeText, governorateValue, isMeaningfulMapName, languageValue, ownerDescription, ownerName, ownerPhotoCaption, stringProperty } from "./lib/geo-format";
import { localizedPoiName, localizedRecordName, localizedStaticCategory, localizedStaticName } from "./lib/map-language";
import type { BasePoiFeature, Language, LocalityFeature, LocalityProperties, MapMode, SearchChoice } from "./lib/types";
import { installRuntimePerformanceGuard, scheduleIdleTask } from "./lib/performance";
import { installSearchController } from "./lib/search-controller";
import { applyMapUiLanguage } from "./lib/ui-language";
import { LabelController } from "./lib/label-controller";
import { installKriDynamicLayers } from "./lib/kri-layer-installer";
import { installMapInteractions } from "./lib/map-interactions";
import { ADMINISTRATIVE_LAYER_IDS, PLACE_VISIBILITY_LAYER_IDS } from "./lib/map-layer-ids";
import { OwnerPlacesController } from "./lib/owner-places-controller";
import { SearchService } from "./lib/search-service";
import { SearchWorkerClient } from "./lib/search-worker-client";
import { LocalityLanguagePackController } from "./lib/locality-language-pack";
import { installLanguageTransitionController } from "./lib/language-transition-controller";
import { LanguageAssetCacheController } from "./lib/language-asset-cache";
import { AppHealthController } from "./lib/app-health";
import { installDeviceQaPanel, type DeviceQaPanel } from "./lib/device-qa";
import { RoutingController } from "./lib/routing-controller";
import { normalizeDynamicMapLayerPriority } from "./lib/map-layer-priority";
import { installPremiumShellController } from "./lib/ui-shell-controller";
import { installTutorialController } from "./lib/tutorial-controller";
import { installTutorialMapDemoController, type TutorialMapDemoController } from "./lib/tutorial-map-demo-controller";
import { installMapExperienceController, type FocusCoordinate } from "./lib/map-experience-controller";
import { installPoiIconController, type PoiIconController } from "./lib/poi-icon-controller";
import { installAtlasMarkerIconController, type AtlasMarkerIconController } from "./lib/atlas-marker-icon-controller";
import { poiIconIdForProperties } from "./lib/poi-icon-catalog";
import { BASE_POI_SOURCE_ID, NATURAL_POI_SOURCE_ID } from "./lib/poi-source";
import { installViewportPoiSourceController, type ViewportPoiSourceController } from "./lib/viewport-poi-source";
import { installLocalityViewportSourceController, type LocalityViewportSourceController } from "./lib/locality-viewport-source";
import { atlasMarkerAssetUrl } from "./lib/atlas-marker-catalog";
import { APP_VERSION, MAP_DATA_VERSION, MAP_EDITION, versionedAssetUrl } from "./lib/release";
import { ServiceWorkerController } from "./lib/service-worker-controller";
import { OfflineMapPackManager } from "./lib/offline-map-pack";
import { OfflineMapPackUiController } from "./lib/offline-map-ui";
import { installMapCameraController } from "./lib/map-camera-controller";
import { installMapOverlayLayoutController, type MapOverlayLayoutController } from "./lib/map-overlay-layout-controller";
import { installMapLeftControlRail } from "./lib/map-left-control-rail";
import { installPwaLaunchIntentHandler } from "./lib/pwa-launch-intent";
import { PwaMapFileController } from "./lib/pwa-file-handler";
import { PlaceWeatherService, type PlaceWeatherBadgeMeta } from "./lib/place-weather";
import { installRuntimeDiagnostics, recordRuntimeDiagnostic } from "./lib/runtime-diagnostics";
import { installSupportHub } from "./lib/support-hub";
import { createPopupShareButton, shareMapLocation } from "./lib/native-share";
import { hideNativeSplash, initializeNativePlatform, installNativeSettingsPanel, showNativeFatalError } from "./lib/native-platform";
import { installInputModeController } from "./lib/input-mode-controller";
import { RuntimeStateController } from "./lib/runtime-state";
import { MapAnimationScheduler } from "./lib/map-animation-scheduler";
import { MapCoordinatePicker } from "./lib/map-coordinate-picker";
import { installAppLifecycleController, readAppLifecycleSnapshot, type AppLifecycleSnapshot } from "./lib/app-lifecycle-controller";
import { isConstrainedHardware, readHardwareProfile, recommendedMapTileCacheSize } from "./lib/hardware-profile";
import { installAndroidReleaseExperience } from "./lib/android-release-experience";

type PopupAnchor = "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

const brandLogoSrc = `${import.meta.env.BASE_URL}icons/nav-kurd-logo.png`;
const appReleaseVersion = APP_VERSION;
const app = query<HTMLDivElement>("#app");
renderAppShell(app, brandLogoSrc, appReleaseVersion, MAP_EDITION);
installSelectionAndImageLocks();
installRuntimeDiagnostics();
installInputModeController();

const mapShell = query<HTMLElement>(".map-shell");
const runtimeState = new RuntimeStateController(mapShell);
const mapElement = query<HTMLDivElement>("#map");
const mapLoading = query<HTMLDivElement>("#mapLoading");
const mapLoadingRetry = query<HTMLButtonElement>("#mapLoadingRetry");
const mapSheet = query<HTMLElement>("#mapSheet");
const currentWeatherDock = query<HTMLElement>("#currentWeatherDock");
const mapAttributionSlot = query<HTMLElement>("#mapAttributionSlot");
const mapActions = query<HTMLElement>(".map-actions");
const topbar = query<HTMLElement>(".topbar");
const searchCard = query<HTMLElement>(".search-card");
const appHealth = query<HTMLDivElement>("#appHealth");
const sheetToggle = query<HTMLButtonElement>("#sheetToggle");
const status = query<HTMLDivElement>("#mapStatus");
const message = query<HTMLParagraphElement>("#mapMessage");
const searchInput = query<HTMLInputElement>("#placeSearch");
const clearSearchButton = query<HTMLButtonElement>("#clearSearch");
const searchResults = query<HTMLDivElement>("#searchResults");
const localityCount = query<HTMLElement>("#localityCount");
const baseSearchCount = query<HTMLElement>("#baseSearchCount");
const ownerPlaceCount = query<HTMLElement>("#ownerPlaceCount");
const backendState = query<HTMLElement>("#backendState");
const baseMapButton = query<HTMLButtonElement>("#baseMapButton");
const layersButton = query<HTMLButtonElement>("#layersButton");
const placesButton = query<HTMLButtonElement>("#placesButton");
const userAccountButton = query<HTMLButtonElement>("#userAccountButton");
const userAccountDot = userAccountButton.querySelector<HTMLElement>(".user-account-button__dot");
const ownerStudioButton = query<HTMLButtonElement>("#ownerStudioButton");
const actionsToggleButton = query<HTMLButtonElement>("#actionsToggleButton");
const routePinButton = query<HTMLButtonElement>("#routePinButton");
const locateButton = query<HTMLButtonElement>("#locateButton");
const shareLocationButton = query<HTMLButtonElement>("#shareLocationButton");
const sheetLocateButton = query<HTMLButtonElement>("#sheetLocateButton");
const sheetShareLocationButton = query<HTMLButtonElement>("#sheetShareLocationButton");
const fitButton = query<HTMLButtonElement>("#fitButton");
const threeDButton = query<HTMLButtonElement>("#threeDButton");
const controlsVisibilityButton = query<HTMLButtonElement>("#controlsVisibilityButton");
const sheetFitButton = query<HTMLButtonElement>("#sheetFitButton");
const languageButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-language]"));
const recoveredLifecycleState = readAppLifecycleSnapshot();
if (recoveredLifecycleState) {
  languageButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.language === recoveredLifecycleState.language));
}
const languageTransition = installLanguageTransitionController();
const languageAssetCache = new LanguageAssetCacheController();
const mapStyleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-map-mode]"));
const brandAboutButton = query<HTMLButtonElement>("#brandAboutButton");
const aboutDialog = query<HTMLElement>("#aboutDialog");
const aboutCloseButton = query<HTMLButtonElement>("#aboutCloseButton");
const aboutDoneButton = query<HTMLButtonElement>("#aboutDoneButton");
const tutorialRestartButton = query<HTMLButtonElement>("#tutorialRestartButton");
const feedbackButton = query<HTMLButtonElement>("#feedbackButton");
const feedbackQuickButton = query<HTMLButtonElement>("#feedbackQuickButton");
const supportButton = query<HTMLButtonElement>("#supportButton");
const pendingAuthIntent = consumeAtlasAuthIntent();
const supportHub = installSupportHub({ getLanguage: currentLanguage });
const adminAccessMode = new URLSearchParams(window.location.search).get("admin") === "1" || pendingAuthIntent === "admin";
const feedbackAccessMode = pendingAuthIntent === "feedback";
ownerStudioButton.hidden = true;

mapShell.dataset.mapMode = recoveredLifecycleState?.mapMode ?? "street";
const asset = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
const configuredMapDataVersion = import.meta.env.VITE_KRI_MAP_DATA_VERSION?.trim();
const mapDataVersion = configuredMapDataVersion === MAP_DATA_VERSION ? configuredMapDataVersion : MAP_DATA_VERSION;
const pmtilesBaseUrl = import.meta.env.VITE_KRI_PMTILES_URL?.trim() || asset("data/kri/kri-base.pmtiles");
const roadsPmtilesBaseUrl = import.meta.env.VITE_KRI_ROADS_PMTILES_URL?.trim() || asset("data/kri/kri-roads.pmtiles");
const remotePmtilesUrl = versionedAssetUrl(pmtilesBaseUrl, mapDataVersion);
const remoteRoadsPmtilesUrl = versionedAssetUrl(roadsPmtilesBaseUrl, mapDataVersion);
const offlineMapPack = new OfflineMapPackManager({ baseRemoteUrl: remotePmtilesUrl, roadsRemoteUrl: remoteRoadsPmtilesUrl });
const satelliteSource = resolveSatelliteSource();
const satelliteEnabled = satelliteSource.enabled;
const SATELLITE_RUNTIME_SOURCE_IDS = ["kri-satellite", "kri-satellite-fallback", "kri-satellite-detail"] as const;
const isSatelliteRuntimeSource = (sourceId: string | undefined): boolean => sourceId !== undefined && SATELLITE_RUNTIME_SOURCE_IDS.includes(sourceId as (typeof SATELLITE_RUNTIME_SOURCE_IDS)[number]);
const pmtilesProtocol = new Protocol();
const offlinePmtilesSources = offlineMapPack.registerPmtilesSources(pmtilesProtocol);
const pmtilesUrl = offlinePmtilesSources.baseSourceKey;
const roadsPmtilesUrl = offlinePmtilesSources.roadsSourceKey;
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

function currentLanguage(): Language {
  return (languageButtons.find((button) => button.classList.contains("is-active"))?.dataset.language as Language | undefined) ?? "ku";
}

const androidReleaseExperience = installAndroidReleaseExperience(currentLanguage);


function setStatus(kind: "loading" | "ready" | "error", label: string): void {
  status.dataset.state = kind;
  status.querySelector("span:last-child")!.textContent = label;
}

function setMessage(value: string, kind: "normal" | "error" | "success" = "normal"): void {
  message.textContent = value;
  message.dataset.kind = kind;
}

const placeDetail = new PlaceDetailPanel({
  getLanguage: currentLanguage,
  onShare: async (place, title) => {
    await shareMapLocation({ coordinate: [place.longitude, place.latitude], title });
  }
});
const health = new AppHealthController({
  container: appHealth,
  mapShell,
  runtimeState,
  getLanguage: currentLanguage,
  setMessage,
  setStatus
});

void initializeNativePlatform(currentLanguage);
installNativeSettingsPanel(currentLanguage);

class KurdistanAtlasController {
  private readonly map: MapLibreMap;
  private readonly animationScheduler: MapAnimationScheduler;
  private readonly liveLocation: LiveLocationController;
  private readonly coordinatePicker: MapCoordinatePicker;
  private readonly routing: RoutingController;
  private readonly poiIcons: PoiIconController;
  private readonly basePoiViewport: ViewportPoiSourceController;
  private readonly naturalPoiViewport: ViewportPoiSourceController;
  private readonly localityViewport: LocalityViewportSourceController;
  private viewportPoiActivation: Promise<void> | null = null;
  private readonly atlasMarkers: AtlasMarkerIconController;
  private readonly labelController: LabelController;
  private readonly pwaMapFiles: PwaMapFileController;
  private readonly tutorialMapDemo: TutorialMapDemoController;
  private readonly overlayLayout: MapOverlayLayoutController;
  private readonly weather = new PlaceWeatherService();
  private ambientWeatherCoordinate: LngLatTuple | null = null;
  private ambientWeatherRenderedAt = 0;
  private layers: KriLayers | null = null;
  private localities: LocalityFeature[] = [];
  private localityById = new Map<string, LocalityFeature>();
  private readonly hardwareProfile = readHardwareProfile();
  private readonly lowPowerProfile = isConstrainedHardware(this.hardwareProfile);
  private readonly localityLanguagePacks = new LocalityLanguagePackController(this.hardwareProfile);
  private readonly ownerPlaces: OwnerPlacesController;
  private readonly searchService: SearchService;
  private readonly searchWorker: SearchWorkerClient;
  private language: Language = recoveredLifecycleState?.language ?? "ku";
  private mapMode: MapMode = recoveredLifecycleState?.mapMode === "satellite" && satelliteEnabled ? "satellite" : "street";
  private satelliteValidated: boolean | null = satelliteEnabled ? null : false;
  private satelliteSourceHealthy = false;
  private satelliteSourceErrorCount = 0;
  private satelliteLastHealthyAt = 0;
  private satelliteErrorTimer: number | null = null;
  private readonly satelliteSourceHealth = new Map<string, boolean>();
  private satelliteFallbackActive = false;
  private lastSoftRefreshAt = 0;
  private basemapVisible = recoveredLifecycleState?.basemapVisible ?? true;
  private administrativeVisible = recoveredLifecycleState?.administrativeVisible ?? true;
  private placesVisible = recoveredLifecycleState?.placesVisible ?? true;
  private interactionsInstalled = false;
  private sheetCollapsed = recoveredLifecycleState?.sheetCollapsed ?? false;
  private searchOverlayOpen = false;
  private routeOverlayActive = false;
  private destinationPromptOpen = false;
  private initialRenderObserved = false;
  private attributionNormalizeFrame: number | null = null;
  private viewportResizeFrame: number | null = null;
  private viewportResizeTimer: number | null = null;
  private lastViewportResizeAt = 0;
  private readonly deviceQa: DeviceQaPanel | null;
  private initializationPromise: Promise<void> | null = null;
  private initialized = false;
  private atlasSubscriptionInstalled = false;

  constructor() {
    this.map = new maplibregl.Map({
      container: mapElement,
      style: this.styleFor(this.mapMode),
      ...(recoveredLifecycleState
        ? {
            center: recoveredLifecycleState.camera.center,
            zoom: recoveredLifecycleState.camera.zoom,
            bearing: recoveredLifecycleState.camera.bearing,
            pitch: recoveredLifecycleState.camera.pitch
          }
        : {
            bounds: KRI_BOUNDS,
            fitBoundsOptions: { padding: this.fitPadding(), duration: 0, maxZoom: this.coverageFitMaxZoom() }
          }),
      maxBounds: KRI_BOUNDS,
      minZoom: this.coverageMinZoom(),
      maxZoom: 18,
      // Required geographic-data attribution remains visible. The custom project statement is additive.
      attributionControl: false,
      renderWorldCopies: false,
      dragRotate: true,
      pitchWithRotate: false,
      cooperativeGestures: false,
      clickTolerance: 10,
      fadeDuration: this.lowPowerProfile ? 0 : 90,
      refreshExpiredTiles: false,
      maxTileCacheSize: recommendedMapTileCacheSize(this.hardwareProfile),
      validateStyle: false
    });
    this.animationScheduler = new MapAnimationScheduler({
      map: this.map,
      diagnosticsHost: mapShell,
      isConstrained: () => mapShell.classList.contains("is-runtime-low-power")
    });
    this.coordinatePicker = new MapCoordinatePicker({ map: this.map, mapShell, getLanguage: currentLanguage });
    this.map.once("render", () => {
      this.initialRenderObserved = true;
    });
    installRuntimePerformanceGuard({
      map: this.map,
      shell: mapShell,
      onRecovered: () => { this.queueLabels(); }
    });
    this.map.dragPan.enable();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-left");
    installMapLeftControlRail({ map: this.map, threeDButton, visibilityButton: controlsVisibilityButton });
    installMapCameraController({ map: this.map, button: threeDButton });
    this.tutorialMapDemo = installTutorialMapDemoController({
      map: this.map,
      getMapMode: () => this.mapMode,
      setMapMode: (mode) => this.setMapMode(mode),
      satelliteEnabled
    });
    this.overlayLayout = installMapOverlayLayoutController({
      mapShell,
      mapSheet,
      mapActions,
      getSheetCollapsed: () => this.sheetCollapsed
    });
    this.map.addControl(new maplibregl.AttributionControl({
      customAttribution: UI.ku.mapSourceCredit
    }), "bottom-left");
    this.pwaMapFiles = new PwaMapFileController({
      map: this.map,
      getLanguage: () => this.language,
      setMessage
    });
    const mapExperience = installMapExperienceController({ map: this.map, mapShell, lowPowerProfile: this.lowPowerProfile });
    this.poiIcons = installPoiIconController({
      map: this.map,
      lowPowerProfile: this.lowPowerProfile,
      getPlacesVisible: () => this.placesVisible
    });
    this.basePoiViewport = installViewportPoiSourceController({
      map: this.map,
      sourceId: BASE_POI_SOURCE_ID,
      datasetId: "base",
      diagnosticsHost: mapShell,
      lowPowerProfile: this.lowPowerProfile,
      getVisible: () => this.placesVisible,
      onDataChanged: (snapshot) => {
        mapShell.dataset.poiDataState = snapshot.state;
        mapShell.dataset.poiViewportRecords = String(snapshot.records);
        mapShell.dataset.poiViewportShards = String(snapshot.shards);
        if (snapshot.iconIds.size > 0) void this.reconcilePoiIcons(snapshot.iconIds);
        this.deviceQa?.refreshSoon(420);
      }
    });
    this.localityViewport = installLocalityViewportSourceController({
      map: this.map,
      getLocalities: () => this.localities,
      getVisible: () => this.placesVisible
    });
    this.naturalPoiViewport = installViewportPoiSourceController({
      map: this.map,
      sourceId: NATURAL_POI_SOURCE_ID,
      datasetId: "natural",
      diagnosticsHost: mapShell,
      lowPowerProfile: this.lowPowerProfile,
      getVisible: () => this.placesVisible,
      onDataChanged: (snapshot) => {
        mapShell.dataset.naturalPoiDataState = snapshot.state;
        mapShell.dataset.naturalPoiViewportRecords = String(snapshot.records);
        if (snapshot.iconIds.size > 0) void this.reconcilePoiIcons(snapshot.iconIds);
        this.deviceQa?.refreshSoon(460);
      }
    });
    this.normalizeAttributionCard();
    this.liveLocation = new LiveLocationController({
      map: this.map,
      animationScheduler: this.animationScheduler,
      getLanguage: () => this.language,
      setMessage,
      trackingButtons: [locateButton, sheetLocateButton],
      onLocationUpdate: (snapshot) => {
        this.routing.updateLocation(snapshot);
        const coordinate = snapshot.coordinate ? [...snapshot.coordinate] as FocusCoordinate : null;
        mapExperience.setFocusCoordinate(coordinate);
        if (coordinate) this.refreshAmbientWeather(coordinate);
      }
    });
    this.routing = new RoutingController({
      map: this.map,
      animationScheduler: this.animationScheduler,
      mapShell,
      routeButton: routePinButton,
      getLanguage: () => this.language,
      getLocationSnapshot: () => this.liveLocation.diagnosticSnapshot(),
      setMessage,
      requestLocation: () => this.liveLocation.locate(),
      isDestinationAllowed: (coordinate) => Boolean(this.layers && isInsideKri(coordinate, this.layers.boundary)),
      onRouteVisualChange: () => { this.labelController?.queue(); normalizeDynamicMapLayerPriority(this.map); },
      onRouteStateChange: (active) => {
        this.routeOverlayActive = active;
        if (active) {
          this.sheetCollapsed = true;
          this.applySheetState();
          mapShell.classList.remove("map-actions-expanded");
          actionsToggleButton.classList.remove("is-active");
          actionsToggleButton.setAttribute("aria-expanded", "false");
        }
        this.syncPrimaryMapSurfaces();
      },
      onDestinationPromptStateChange: (open) => {
        this.destinationPromptOpen = open;
        if (open) {
          this.sheetCollapsed = true;
          this.applySheetState();
        }
        this.syncPrimaryMapSurfaces();
      }
    });
    this.ownerPlaces = new OwnerPlacesController({
      map: this.map,
      countElement: ownerPlaceCount,
      backendStateElement: backendState,
      getLanguage: () => this.language,
      onWarning: (label) => health.warnSilently(label),
      onPlacesChanged: () => { void this.reconcileAtlasMarkers(); }
    });
    this.atlasMarkers = installAtlasMarkerIconController({
      map: this.map,
      lowPowerProfile: this.lowPowerProfile,
      getPlacesVisible: () => this.placesVisible,
      getActiveCategories: () => this.ownerPlaces.getItems().map((place) => place.category),
      isMobileViewport: () => this.isMobileViewport()
    });
    this.searchWorker = new SearchWorkerClient({
      manifestUrl: versionedAssetUrl(asset("data/kri/kri-search-shards-manifest.json"), mapDataVersion)
    });
    this.searchService = new SearchService({
      getLanguage: () => this.language,
      getLocalities: () => this.localities,
      getOwnerPlaces: () => this.ownerPlaces.getItems(),
      searchStatic: (term, language, limit) => this.searchWorker.search(term, language, limit)
    });
    this.deviceQa = installDeviceQaPanel({
      map: this.map,
      mapShell,
      getLanguage: () => this.language,
      getMapDataVersion: () => mapDataVersion,
      getLocalityCount: () => this.localities.length,
      getOwnerPlaceCount: () => this.ownerPlaces.getItems().length,
      getSearchIndexReady: () => this.isSearchIndexReady(),
      lowPowerProfile: this.lowPowerProfile,
      satelliteEnabled,
      locate: () => this.liveLocation.locate(),
      locationSnapshot: () => this.liveLocation.diagnosticSnapshot()
    });
    this.labelController = new LabelController({
      map: this.map,
      getLayers: () => this.layers,
      getLocalities: () => this.localities,
      getLanguage: () => this.language,
      getBasemapVisible: () => this.basemapVisible,
      getAdministrativeVisible: () => this.administrativeVisible,
      getPlacesVisible: () => this.placesVisible,
      isMobileViewport: () => this.isMobileViewport(),
      lowPowerProfile: this.lowPowerProfile,
      focusLocality: (feature) => this.focusLocality(feature),
      getRouteSegments: () => this.routing.getRenderedRouteSegments()
    });
    if (!recoveredLifecycleState) this.sheetCollapsed = window.matchMedia("(max-width: 700px)").matches;
    this.applySheetState();
    this.map.on("moveend", () => {
      if (!this.liveLocation.isProgrammaticCameraMove) this.queueLabels();
      this.normalizeAttributionCard();
    });
    this.map.on("zoomend", () => {
      if (!this.liveLocation.isProgrammaticCameraMove) this.queueLabels();
      this.normalizeAttributionCard();
      if (this.liveLocation.isFollowing && !this.liveLocation.isProgrammaticCameraMove) this.liveLocation.recenter(false);
    });
    this.map.on("pitchend", () => { if (!this.liveLocation.isProgrammaticCameraMove) this.queueLabels(); });
    this.map.on("styledata", () => this.normalizeAttributionCard());
    this.map.on("sourcedata", (event) => {
      const sourceEvent = event as { sourceId?: string; isSourceLoaded?: boolean; sourceDataType?: string };
      if (!isSatelliteRuntimeSource(sourceEvent.sourceId) || this.mapMode !== "satellite") return;
      if (sourceEvent.isSourceLoaded === true || sourceEvent.sourceDataType === "content") this.markSatelliteSourceHealthy(sourceEvent.sourceId);
    });
    this.map.on("idle", () => {
      if (this.mapMode !== "satellite") return;
      try {
        const loadedSource = SATELLITE_RUNTIME_SOURCE_IDS.find((sourceId) => this.map.getSource(sourceId) && this.map.isSourceLoaded(sourceId));
        if (loadedSource) this.markSatelliteSourceHealthy(loadedSource);
      } catch {
        // Source can disappear during an intentional style transition.
      }
    });
    const stopLocationFollow = () => { if (!this.liveLocation.isProgrammaticCameraMove) this.liveLocation.stopFollow(); this.liveLocation.lockAgainstGpsJitter(); };
    this.map.on("dragstart", stopLocationFollow);
    this.map.on("rotatestart", stopLocationFollow);
    this.map.on("zoomstart", () => this.liveLocation.lockAgainstGpsJitter());
    window.addEventListener("resize", () => this.scheduleViewportResize(), { passive: true });
    window.addEventListener("online", () => this.softRefreshContent(250), { passive: true });
    this.map.on("error", (event) => {
      const sourceId = (event as { sourceId?: string; error?: unknown }).sourceId;
      if (isSatelliteRuntimeSource(sourceId) && this.mapMode === "satellite") {
        this.noteSatelliteSourceError(sourceId);
        return;
      }
      // MapLibre can emit transient tile cancellation/network events while a
      // style changes or a browser tab resumes. Record them for the secure
      // diagnostics report without replacing the usable UI with a reconnect
      // warning. Critical readiness is handled by the boot/source gates.
      recordRuntimeDiagnostic(`maplibre.${sourceId || "runtime"}`, (event as { error?: unknown }).error ?? "Map runtime event", "warning");
    });
  }

  private isMobileViewport(): boolean { return window.matchMedia("(max-width: 700px)").matches; }

  /** Allow the full canonical coverage to fit on narrow mobile screens. */
  private coverageMinZoom(): number {
    if (!this.isMobileViewport()) return 5.35;
    const width = window.visualViewport?.width ?? window.innerWidth;
    return width <= 380 ? 4.95 : 5.10;
  }

  /** Keep full coverage—including Kirkuk—above the mobile sheet. */
  private coverageFitMaxZoom(): number { return this.isMobileViewport() ? 7.15 : 8.2; }

  private fitPadding(): { top: number; right: number; bottom: number; left: number } {
    if (!this.isMobileViewport()) {
      return this.sheetCollapsed
        ? { top: 124, right: 72, bottom: 138, left: 72 }
        : { top: 124, right: 72, bottom: 268, left: 72 };
    }
    return this.sheetCollapsed ? { top: 128, right: 20, bottom: 146, left: 20 } : { top: 128, right: 20, bottom: 344, left: 20 };
  }

  private applySheetState(): void {
    const collapsed = this.sheetCollapsed;
    mapSheet.classList.toggle("is-collapsed", collapsed);
    mapShell.classList.toggle("map-sheet-collapsed", collapsed);
    mapSheet.dataset.sheetState = collapsed ? "collapsed" : "expanded";
    sheetToggle.setAttribute("aria-expanded", String(!collapsed));
    sheetToggle.classList.toggle("is-collapsed", collapsed);

    const attribution = mapElement.querySelector<HTMLDetailsElement>(".maplibregl-ctrl-attrib.nav-kurd-attribution");
    if (attribution) {
      attribution.open = !collapsed;
      attribution.dataset.sheetState = collapsed ? "collapsed" : "expanded";
    }
    this.overlayLayout.refresh();
  }

  private scheduleViewportResize(): void {
    if (this.viewportResizeFrame !== null || this.viewportResizeTimer !== null) return;
    const minimumInterval = this.lowPowerProfile ? 120 : 80;
    const delay = Math.max(0, minimumInterval - (performance.now() - this.lastViewportResizeAt));
    const requestFrame = (): void => {
      this.viewportResizeTimer = null;
      if (document.hidden) return;
      this.viewportResizeFrame = window.requestAnimationFrame(() => {
        this.viewportResizeFrame = null;
        this.lastViewportResizeAt = performance.now();
        this.map.setMinZoom(this.coverageMinZoom());
        if (!this.isMobileViewport() && this.sheetCollapsed) {
          this.sheetCollapsed = false;
          this.applySheetState();
        }
        this.overlayLayout.refresh();
        this.map.resize();
        this.queueLabels();
      });
    };
    if (delay > 4) this.viewportResizeTimer = window.setTimeout(requestFrame, delay);
    else requestFrame();
  }

  private clearSatelliteErrorTimer(): void {
    if (this.satelliteErrorTimer === null) return;
    window.clearTimeout(this.satelliteErrorTimer);
    this.satelliteErrorTimer = null;
  }

  private resetSatelliteHealthCycle(): void {
    this.clearSatelliteErrorTimer();
    this.satelliteSourceHealthy = false;
    this.satelliteSourceErrorCount = 0;
    this.satelliteLastHealthyAt = 0;
    this.satelliteSourceHealth.clear();
    this.satelliteFallbackActive = false;
  }

  private canonicalSatelliteDetailOpacity(): unknown[] {
    const transitionZoom = satelliteSource.enabled ? satelliteSource.transitionZoom ?? 7.2 : 7.2;
    return ["interpolate", ["linear"], ["zoom"], 6.45, 0, transitionZoom, 0.72, 12.15, 0.72, 14.5, 0.28, 20, 0.18];
  }

  private applySatelliteFallback(active: boolean): void {
    this.satelliteFallbackActive = active;
    try {
      if (this.map.getLayer("kri-satellite-fallback")) {
        this.map.setLayoutProperty("kri-satellite-fallback", "visibility", active && this.mapMode === "satellite" ? "visible" : "none");
      }
      if (this.map.getLayer("kri-satellite-detail")) {
        this.map.setPaintProperty("kri-satellite-detail", "raster-opacity", active ? 0.96 : this.canonicalSatelliteDetailOpacity());
        this.map.setLayoutProperty("kri-satellite-detail", "visibility", this.mapMode === "satellite" ? "visible" : "none");
      }
      this.map.triggerRepaint();
    } catch {
      // A style transition can temporarily detach raster layers. Source/style
      // events call this method again after the graph is ready.
    }
  }

  private markSatelliteSourceHealthy(sourceId?: string): void {
    if (this.mapMode !== "satellite") return;
    if (sourceId) this.satelliteSourceHealth.set(sourceId, true);
    const primaryHealthy = this.satelliteSourceHealth.get("kri-satellite") === true;
    const fallbackHealthy = this.satelliteSourceHealth.get("kri-satellite-fallback") === true;
    const detailHealthy = this.satelliteSourceHealth.get("kri-satellite-detail") === true;
    this.satelliteSourceHealthy = primaryHealthy || fallbackHealthy || detailHealthy;
    if (!this.satelliteSourceHealthy) return;
    this.satelliteSourceErrorCount = 0;
    this.satelliteLastHealthyAt = Date.now();
    this.clearSatelliteErrorTimer();
    if (primaryHealthy && this.satelliteFallbackActive) this.applySatelliteFallback(false);
    setMessage(UI[this.language].satelliteReady, "success");
  }

  private noteSatelliteSourceError(sourceId?: string): void {
    if (this.mapMode !== "satellite") return;
    this.satelliteSourceErrorCount += 1;

    // Raster sources report individual cancelled/missing tile requests while a
    // pinch-zoom is in flight. Treating one tile as a dead provider made the
    // fallback layer switch on/off and visually resembled Night mode. A source
    // is demoted only after a sustained burst with no successful tile event.
    const recentlyHealthy = this.satelliteLastHealthyAt > 0 && Date.now() - this.satelliteLastHealthyAt < 5_000;
    if (recentlyHealthy || this.satelliteSourceErrorCount < 6) return;
    if (sourceId) this.satelliteSourceHealth.set(sourceId, false);
    if (this.satelliteErrorTimer !== null) return;

    this.satelliteErrorTimer = window.setTimeout(() => {
      this.satelliteErrorTimer = null;
      if (this.mapMode !== "satellite") return;
      try {
        const loadedSource = SATELLITE_RUNTIME_SOURCE_IDS.find((candidate) => this.map.getSource(candidate) && this.map.isSourceLoaded(candidate));
        if (loadedSource) {
          this.markSatelliteSourceHealthy(loadedSource);
          return;
        }
      } catch {
        // A source can be between render states; a later source event resolves it.
      }

      if (satelliteSource.enabled && (satelliteSource.fallbackSource || satelliteSource.detailSource)) {
        this.applySatelliteFallback(true);
        setMessage(UI[this.language].satelliteLoading, "normal");
        return;
      }
      setMessage(navigator.onLine ? UI[this.language].satelliteError : UI[this.language].offline, navigator.onLine ? "error" : "normal");
      if (navigator.onLine) health.warn(UI[this.language].satelliteError);
    }, 4_000);
  }

  private normalizeAttributionCard(): void {
    if (this.attributionNormalizeFrame !== null) return;
    this.attributionNormalizeFrame = window.requestAnimationFrame(() => {
      this.attributionNormalizeFrame = null;
      const attribution = mapElement.querySelector<HTMLDetailsElement>(".maplibregl-ctrl-attrib");
      const inner = attribution?.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-inner");
      const toggle = attribution?.querySelector<HTMLElement>(".maplibregl-ctrl-attrib-button");
      if (!attribution || !inner || !toggle) return;

      const copy = UI[this.language];
      attribution.classList.add("nav-kurd-attribution");
      if (attribution.parentElement !== mapAttributionSlot) mapAttributionSlot.append(attribution);
      attribution.dir = languageDirection(this.language);
      attribution.dataset.language = this.language;
      attribution.dataset.sheetState = this.sheetCollapsed ? "collapsed" : "expanded";
      attribution.open = !this.sheetCollapsed;
      inner.innerHTML = `<span class="nav-kurd-attribution__project">${escapeText(copy.mapProjectCredit)}</span><span class="nav-kurd-attribution__source">${escapeText(copy.mapSourceCredit)}</span>`;

      // Preserve MapLibre's real <details>/<summary> structure while making the
      // map-card state authoritative: collapsed shows one compact developer
      // credit; expanded automatically exposes the fuller project/source credit.
      toggle.textContent = "";
      toggle.dataset.compactLabel = "DEVELOPER: SARHANG IO";
      toggle.setAttribute("aria-label", `${copy.mapDetails} — ${copy.mapDeveloperCredit}`);
      toggle.setAttribute("title", copy.mapDetails);
      attribution.setAttribute("aria-label", `${copy.mapProjectCredit} · ${copy.mapSourceCredit}`);
      this.overlayLayout.refresh();
    });
  }

  toggleSheet(): void {
    this.sheetCollapsed = !this.sheetCollapsed;
    this.applySheetState();
    window.setTimeout(() => { this.overlayLayout.refresh(); this.map.resize(); this.queueLabels(); }, 180);
  }

  private collapseSheetForMapFocus(): void {
    if (this.sheetCollapsed) return;
    this.sheetCollapsed = true;
    this.applySheetState();
  }

  private setLocalities(localities: LocalityFeature[]): void {
    this.localities = localities;
    this.localityById = new Map(localities.map((feature) => [feature.properties.id, feature] as const));
  }

  private resolveLocalityFeature(feature: LocalityFeature): LocalityFeature {
    const id = feature.properties?.id;
    return id ? this.localityById.get(String(id)) ?? feature : feature;
  }

  hasInitialVisualFrame(): boolean {
    return this.initialRenderObserved;
  }

  async waitForInitialVisualReady(): Promise<void> {
    if (this.initialRenderObserved) return;

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        this.map.off("render", onFirstRender);
        window.requestAnimationFrame(() => resolve());
      };
      const onFirstRender = (): void => {
        this.initialRenderObserved = true;
        finish();
      };

      this.map.on("render", onFirstRender);
      if (this.initialRenderObserved) finish();
    });
  }

  async waitForCriticalMapReady(): Promise<void> {
    if (!this.initialRenderObserved) await this.waitForInitialVisualReady();

    // A first render can still be followed by synchronous source/layer work.
    // Wait for a real idle frame (with a bounded fallback) before revealing the
    // interactive map so the loader never hands off to a briefly frozen canvas.
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.map.off("idle", finish);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      };
      const timer = window.setTimeout(finish, 2200);
      this.map.on("idle", finish);
      if (this.map.loaded() && this.map.areTilesLoaded()) window.requestAnimationFrame(finish);
      this.map.triggerRepaint();
    });

    this.overlayLayout.refresh();
    this.map.resize();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;
    const pending = this.performInitialization()
      .then(() => { this.initialized = true; })
      .finally(() => {
        if (this.initializationPromise === pending) this.initializationPromise = null;
      });
    this.initializationPromise = pending;
    return pending;
  }

  private async performInitialization(): Promise<void> {
    const [layers, localities, searchManifest] = await Promise.all([
      this.loadLayers(),
      this.localityLanguagePacks.load(this.language),
      loadStaticSearchManifest().catch(() => null)
    ]);
    this.layers = layers;
    this.setLocalities(localities);
    await this.waitForStyle();
    this.installLayers();
    this.localityViewport.start();
    this.installInteractions();
    if (!recoveredLifecycleState) this.fitToKri(false);
    else {
      this.setBasemapVisible(this.basemapVisible);
      this.setAdministrativeVisible(this.administrativeVisible);
      this.setPlacesVisible(this.placesVisible);
      this.map.jumpTo(recoveredLifecycleState.camera);
      this.map.triggerRepaint();
    }
    this.overlayLayout.refresh();
    this.map.resize();
    localityCount.textContent = new Intl.NumberFormat("en-US").format(this.localities.length);
    const searchRecords = searchManifest
      ? Math.max(
        searchManifest.files?.[this.language]?.records ?? 0,
        searchManifest.records ?? 0,
        ...Object.values(searchManifest.files ?? {}).map((entry) => entry?.records ?? 0)
      )
      : null;
    baseSearchCount.textContent = searchRecords && searchRecords > 0
      ? new Intl.NumberFormat("en-US").format(searchRecords)
      : "—";
    this.ownerPlaces.setLanguageStatus();
    mapElement.dataset.mapDataVersion = mapDataVersion;
    if (!this.atlasSubscriptionInstalled) {
      this.atlasSubscriptionInstalled = true;
      subscribeToAtlasPlaces(() => { this.ownerPlaces.queueRefresh(); this.deviceQa?.refreshSoon(1100); });
    }
    this.deviceQa?.refresh();

    // Prime the tiny viewport manifest and common icon groups as soon as the map
    // sources exist. This is intentionally non-blocking: the first visual frame
    // remains fast, while a later zoom can paint POIs immediately instead of
    // waiting for the old post-loader idle queue.
    this.localityViewport.refresh();
    void this.activateViewportPoiData();
  }

  private activateViewportPoiData(): Promise<void> {
    if (this.viewportPoiActivation) return this.viewportPoiActivation;
    const activation = Promise.all([
      this.basePoiViewport.start(),
      this.naturalPoiViewport.start(),
      this.poiIcons.start()
    ]).then(() => {
      this.deviceQa?.refreshSoon(220);
    });
    this.viewportPoiActivation = activation.catch((error) => {
      this.viewportPoiActivation = null;
      recordRuntimeDiagnostic("viewport-poi-activation", error, "warning");
    });
    return this.viewportPoiActivation;
  }

  startBackgroundTasks(): void {
    // Stage optional work well after the first interactive frame. Search still
    // loads immediately on user input, so warming is an optimization—not a
    // readiness dependency. This avoids a CPU/RAM spike directly after loader
    // dismissal on low-end phones and desktop-mode mobile browsers.
    scheduleIdleTask(() => Promise.all((["ku", "ar", "en"] as const)
      .map((language) => languageAssetCache.verifyPrepared(language))).then(() => undefined), 900);

    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const canPrefetchLanguages = !connection?.saveData
      && connection?.effectiveType !== "2g"
      && connection?.effectiveType !== "slow-2g";
    if (canPrefetchLanguages) {
      scheduleIdleTask(async () => {
        for (const language of (["ku", "ar", "en"] as const)) {
          try {
            await this.localityLanguagePacks.prepare(language);
            languageAssetCache.markPrepared(language);
          } catch {
            // Optional prefetch may be skipped on a transient connection; the
            // same single-request loader remains authoritative on user action.
          }
        }
      }, this.lowPowerProfile ? 3600 : 1100);
    }

    scheduleIdleTask(() => this.loadSearchMetadata(), 1800);
    // Full search preparation is user-triggered. Downloading/parsing a 19–22 MiB
    // language catalog during idle time still competes with map rendering on
    // mobile devices and was the source of multi-second setTimeout long tasks.
    scheduleIdleTask(() => this.ownerPlaces.refresh(), 3200);
  }

  isSearchIndexReady(): boolean { return this.searchWorker.isReady; }

  prepareSearch(): void {
    // Search is prepared only after the user opens the control. Both jobs are
    // isolated from the critical map path: localities yield between small
    // chunks and the full static catalog remains inside the dedicated worker.
    void this.searchService.warmLocalities();
    void this.searchWorker.warm(this.language)
      .then(() => { mapShell.dataset.searchLanguageReady = this.language; })
      .catch(() => { delete mapShell.dataset.searchLanguageReady; });
  }

  private async loadSearchMetadata(): Promise<void> {
    try {
      const manifest = await loadStaticSearchManifest();
      const searchRecords = Math.max(
        manifest.files?.[this.language]?.records ?? 0,
        manifest.records ?? 0,
        ...Object.values(manifest.files ?? {}).map((entry) => entry?.records ?? 0)
      );
      baseSearchCount.textContent = searchRecords > 0
        ? new Intl.NumberFormat("en-US").format(searchRecords)
        : "—";
    } catch (error) {
      baseSearchCount.textContent = "—";
      recordRuntimeDiagnostic("search-metadata", error, "warning");
    }
  }


  private async loadLayers(): Promise<KriLayers> { return loadKriLayers(); }

  // Locality geometry is language-independent. Language changes update
  // app-side labels/search/popups without re-sending 12,125 map features.

  private async waitForStyle(): Promise<void> {
    if (this.map.isStyleLoaded()) return;
    await new Promise<void>((resolve) => { this.map.once("load", () => resolve()); this.map.once("style.load", () => resolve()); });
  }

  private styleFor(mode: MapMode): StyleSpecification {
    return buildKriMapStyle({
      mode,
      pmtilesUrl,
      roadsPmtilesUrl,
      satelliteEnabled,
      satelliteSource,
      basemapVisible: this.basemapVisible,
      administrativeVisible: this.administrativeVisible,
      placesVisible: this.placesVisible,
      lowPowerProfile: this.lowPowerProfile,
      deferBasePoiData: true,
      deferNaturalPoiData: true,
      coverage: this.layers ? {
        mask: this.layers.mask,
        boundary: this.layers.boundary,
        boundaryLine: this.layers.boundaryLine,
        governorates: this.layers.governorates,
        districts: this.layers.districts
      } : null
    });
  }

  private installLayers(): void {
    if (!this.layers) return;
    installKriDynamicLayers({
      map: this.map,
      ownerPlaces: this.ownerPlaces.collection(),
      placesVisible: this.placesVisible,
      isMobileViewport: this.isMobileViewport(),
      lowPowerProfile: this.lowPowerProfile
    });
    this.routing.installLayers();
    this.liveLocation.restoreVisualState();
    normalizeDynamicMapLayerPriority(this.map);
    this.queueLabels();
    void this.reconcileAtlasMarkers();
    this.localityViewport.refresh();
  }

  private installInteractions(): void {
    if (this.interactionsInstalled) return;
    this.interactionsInstalled = true;
    installMapInteractions({
      map: this.map,
      ownerPlaceById: (id) => this.ownerPlaces.byId(id),
      showLocalityPopup: (feature) => this.showLocalityPopup(this.resolveLocalityFeature(feature)),
      showOwnerPopup: (place, coordinate) => this.showOwnerPopup(place, coordinate),
      showBasePoiPopup: (feature) => this.showBasePoiPopup(feature)
    });
  }

  private async reconcilePoiIcons(iconIds?: ReadonlySet<string>): Promise<void> {
    const result = await this.poiIcons.start(iconIds);
    normalizeDynamicMapLayerPriority(this.map);
    mapShell.dataset.poiIconState = result.state;
    mapShell.dataset.poiIconRegistered = String(result.registered);
    if (result.state === "partial" || result.state === "fallback") {
      recordRuntimeDiagnostic("poi-icons", UI[this.language].poiIconsPartial, "warning");
    }
    this.deviceQa?.refreshSoon(350);
  }

  private async reconcileAtlasMarkers(): Promise<void> {
    const result = await this.atlasMarkers.reconcile();
    normalizeDynamicMapLayerPriority(this.map);
    mapShell.dataset.atlasMarkerState = result.state;
    mapShell.dataset.atlasMarkerRegistered = String(result.registered);
    mapShell.dataset.atlasMarkerCategories = String(result.activeCategories);
    if (result.state === "partial" || result.state === "fallback") {
      recordRuntimeDiagnostic("atlas-markers", UI[this.language].poiIconsPartial, "warning");
    }
    this.deviceQa?.refreshSoon(420);
  }

  private queueLabels(): void {
    this.labelController.queue();
  }

  private readyMessageFor(language: Language = this.language): string {
    return this.mapMode === "satellite" ? UI[language].satelliteReady : UI[language].ready;
  }

  private softRefreshContent(delayMs = 120): void {
    const now = Date.now();
    // Returning from the browser background must not refetch the multi-megabyte
    // immutable locality/POI catalogs. Only live owner data and lightweight UI
    // state are refreshed; static data changes arrive with a new release URL.
    if (now - this.lastSoftRefreshAt < 4_000) {
      this.map.resize();
      this.map.triggerRepaint();
      return;
    }
    this.lastSoftRefreshAt = now;
    this.ownerPlaces.queueRefresh(delayMs);
    this.ownerPlaces.setLanguageStatus();
    if (!this.isSearchIndexReady()) void this.loadSearchMetadata();
    this.queueLabels();
    this.map.resize();
    this.map.triggerRepaint();
    this.deviceQa?.refreshSoon(Math.max(180, delayMs));
  }

  private clearTransientMapPopups(): void {
    mapElement.querySelectorAll<HTMLElement>(".maplibregl-popup").forEach((popup) => popup.remove());
  }

  private refreshLanguageSurface(): void {
    setStatus("ready", UI[this.language].statusReady);
    setMessage(this.readyMessageFor(), "success");
    this.ownerPlaces.setLanguageStatus();
    this.routing.refreshLanguage();
    this.labelController.clear();
    this.clearTransientMapPopups();
    this.queueLabels();
    placeDetail.refresh();
    health.refreshLanguage();
    this.deviceQa?.refreshSoon(160);
    this.map.triggerRepaint();
    const coordinate = this.liveLocation.diagnosticSnapshot().coordinate;
    if (coordinate) this.refreshAmbientWeather(coordinate, true);
  }

  private weatherBadgeMetaForLocality(properties: LocalityProperties): PlaceWeatherBadgeMeta {
    const category = typeof properties.place === "string" && properties.place.trim() ? properties.place.trim() : "locality";
    return {
      placeIconSrc: atlasMarkerAssetUrl(category),
      placeIconLabel: categoryValue(category, this.language, UI[this.language].place)
    };
  }

  private weatherBadgeMetaForBasePoi(properties: Record<string, unknown>): PlaceWeatherBadgeMeta {
    const category = (poiIconIdForProperties(properties)
      ?? stringProperty(properties, ["fclass", "class", "type", "amenity", "shop", "tourism", "leisure", "office", "healthcare", "historic", "natural", "category"]))
      || "other";
    return {
      placeIconSrc: atlasMarkerAssetUrl(category),
      placeIconLabel: categoryValue(category, this.language, UI[this.language].place)
    };
  }

  private weatherBadgeMetaForOwner(place: AtlasPlace): PlaceWeatherBadgeMeta {
    return {
      placeIconSrc: atlasMarkerAssetUrl(place.category),
      placeIconLabel: categoryValue(place.category, this.language, UI[this.language].place)
    };
  }

  private weatherBadgeMetaForStaticChoice(choice: SearchChoice & { type: "base" }): PlaceWeatherBadgeMeta {
    const category = typeof choice.item.c === "string" && choice.item.c.trim()
      ? choice.item.c.trim()
      : choice.item.k === "place"
        ? "locality"
        : "other";
    return {
      placeIconSrc: atlasMarkerAssetUrl(category),
      placeIconLabel: localizedStaticCategory(choice.item, this.language, UI[this.language].place)
    };
  }

  private attachWeather(container: HTMLElement, coordinate: LngLatTuple, meta: PlaceWeatherBadgeMeta): void {
    container.append(this.weather.createBadge(coordinate, this.language, meta));
  }

  private refreshAmbientWeather(coordinate: LngLatTuple, force = false): void {
    const now = Date.now();
    if (!force && this.ambientWeatherCoordinate
      && now - this.ambientWeatherRenderedAt < 5 * 60 * 1000
      && distanceMeters(this.ambientWeatherCoordinate, coordinate) < 500) return;
    this.ambientWeatherCoordinate = [coordinate[0], coordinate[1]];
    this.ambientWeatherRenderedAt = now;
    currentWeatherDock.replaceChildren(this.weather.createBadge(coordinate, this.language));
    currentWeatherDock.hidden = false;
  }

  /**
   * Keep the existing popup visuals while choosing an anchor that opens into
   * the usable map viewport. This prevents tall weather/place cards from being
   * clipped by the browser top edge or the persistent bottom sheet.
   */
  private popupAnchorForCoordinate(coordinate: LngLatTuple): PopupAnchor {
    const point = this.map.project(coordinate);
    const container = this.map.getContainer();
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const horizontal = point.x < Math.min(132, width * 0.24)
      ? "left"
      : point.x > Math.max(width - 132, width * 0.76)
        ? "right"
        : "";
    const topSafe = Math.min(230, Math.max(150, height * 0.24));
    const bottomSafe = Math.min(360, Math.max(235, height * 0.34));
    const vertical = point.y < topSafe
      ? "top"
      : point.y > height - bottomSafe
        ? "bottom"
        : "bottom";
    return `${vertical}${horizontal ? `-${horizontal}` : ""}` as PopupAnchor;
  }

  private openPlacePopup(
    coordinate: LngLatTuple,
    content: HTMLElement,
    options: { offset: number; closeButton: boolean; maxWidth: string }
  ): maplibregl.Popup {
    return new maplibregl.Popup({
      ...options,
      anchor: this.popupAnchorForCoordinate(coordinate),
      focusAfterOpen: false
    }).setLngLat(coordinate).setDOMContent(content).addTo(this.map);
  }

  currentLocationCoordinate(): LngLatTuple | null {
    const coordinate = this.liveLocation.diagnosticSnapshot().coordinate;
    return coordinate ? [coordinate[0], coordinate[1]] : null;
  }

  focusSharedCoordinate(coordinate: LngLatTuple, label?: string): void {
    if (!this.layers || !isInsideKri(coordinate, this.layers.boundary)) {
      setMessage(UI[this.language].routeOutsideBoundary, "error");
      return;
    }
    this.collapseSheetForMapFocus();
    this.map.flyTo({ center: coordinate, zoom: Math.max(this.map.getZoom(), 15), duration: 680, essential: true });
    const title = label?.trim() || (this.language === "ar" ? "الموقع المشترك" : this.language === "en" ? "Shared location" : "شوێنی هاوبەشکراو");
    const content = document.createElement("div");
    content.className = "place-popup place-popup--rich";
    content.dir = languageDirection(this.language);
    content.innerHTML = `<strong>${escapeText(title)}</strong><small>${escapeText(coordinateLabel(coordinate))}</small>`;
    content.append(createPopupShareButton({ coordinate, title }, this.shareCopy()));
    this.openPlacePopup(coordinate, content, { offset: 14, closeButton: true, maxWidth: "300px" });
  }

  private shareCopy(): string {
    return this.language === "ar" ? "مشاركة" : this.language === "en" ? "Share" : "هاوبەشکردن";
  }

  private appendShareAction(content: HTMLElement, coordinate: LngLatTuple, title: string): void {
    content.append(createPopupShareButton({ coordinate, title }, this.shareCopy()));
  }

  private showLocalityPopup(feature: LocalityFeature): void {
    const props = feature.properties;
    const coordinate = feature.geometry.coordinates as LngLatTuple;
    const title = languageValue(props, this.language);
    const district = districtValue(props, this.language);
    const governorate = governorateValue(props, this.language);
    const kind = categoryValue(props.place, this.language, UI[this.language].place);
    const content = document.createElement("div");
    content.className = "place-popup place-popup--rich";
    content.dir = languageDirection(this.language);
    content.innerHTML = `<strong>${escapeText(title)}</strong><span>${escapeText([kind, district, governorate].filter(Boolean).join(" • "))}</span><small>${escapeText(coordinateLabel(coordinate))}</small>`;
    this.appendShareAction(content, coordinate, title);
    this.attachWeather(content, coordinate, this.weatherBadgeMetaForLocality(props));
    this.openPlacePopup(coordinate, content, { offset: 14, closeButton: false, maxWidth: "300px" });
  }

  private showBasePoiPopup(feature: BasePoiFeature): boolean {
    const properties = feature.properties ?? {};
    const coordinate = feature.geometry.coordinates as LngLatTuple;
    const sourceClass = stringProperty(properties, ["fclass", "class", "type", "amenity", "shop", "tourism", "leisure", "office", "healthcare", "historic", "natural"]);
    const sourceCategory = stringProperty(properties, ["category"]);
    const category = categoryValue(poiIconIdForProperties(properties) ?? (sourceClass || sourceCategory), this.language, UI[this.language].category);
    const exactTitle = localizedPoiName(properties, this.language);
    // A POI can carry a verified name only in another source language. It must
    // not become an unclickable visible marker: use the localized category as a
    // truthful fallback until a verified Kurdish name is added.
    const title = isMeaningfulMapName(exactTitle) ? exactTitle : category;
    if (!isMeaningfulMapName(title)) return false;
    const address = localizedRecordName(properties, this.language, ["addr:full", "addr:street", "street", "neighbourhood", "neighborhood", "district", "city", "addr:city"]);
    const content = document.createElement("div");
    content.className = "place-popup place-popup--rich";
    content.dir = languageDirection(this.language);
    content.innerHTML = `<strong>${escapeText(title)}</strong><span>${escapeText([category, address].filter(Boolean).join(" • "))}</span><small>${escapeText(coordinateLabel(coordinate))}</small>`;
    this.appendShareAction(content, coordinate, title);
    this.attachWeather(content, coordinate, this.weatherBadgeMetaForBasePoi(properties));
    this.openPlacePopup(coordinate, content, { offset: 14, closeButton: false, maxWidth: "300px" });
    return true;
  }

  private showOwnerPopup(place: AtlasPlace, coordinate: LngLatTuple): void {
    const photos = orderedAtlasPhotos(place);
    const coverPhoto = photos.find((photo) => photo.storage_path === place.cover_photo_path) ?? photos[0];
    const cover = atlasPhotoMediaUrl(coverPhoto);
    const content = document.createElement("article");
    content.className = "atlas-place-popup";
    content.dir = languageDirection(this.language);
    const description = ownerDescription(place, this.language);
    const caption = ownerPhotoCaption(coverPhoto, this.language);
    const markerIcon = atlasMarkerAssetUrl(place.category);
    content.innerHTML = `${cover ? `<img class="atlas-place-popup__cover" src="${escapeText(cover)}" alt="${escapeText(caption || ownerName(place, this.language))}" loading="lazy">` : ""}<div class="atlas-place-popup__body"><div class="atlas-place-popup__identity"><span class="atlas-place-popup__text"><strong>${escapeText(ownerName(place, this.language))}</strong><small>${escapeText(categoryValue(place.category, this.language, UI[this.language].place))}</small></span><img class="atlas-place-popup__marker" src="${escapeText(markerIcon)}" alt="" aria-hidden="true"></div>${caption ? `<p class="atlas-place-popup__caption">${escapeText(caption)}</p>` : ""}${description ? `<p class="atlas-place-popup__description">${escapeText(description)}</p>` : ""}</div>`;
    const ownerPopupBody = content.querySelector<HTMLElement>(".atlas-place-popup__body") ?? content;
    this.appendShareAction(ownerPopupBody, coordinate, ownerName(place, this.language));
    this.attachWeather(ownerPopupBody, coordinate, this.weatherBadgeMetaForOwner(place));
    this.openPlacePopup(coordinate, content, { offset: 16, closeButton: true, maxWidth: "310px" });
    placeDetail.open(place);
  }

  private focusLocality(feature: LocalityFeature): void {
    this.collapseSheetForMapFocus();
    const coordinate = feature.geometry.coordinates as LngLatTuple; this.map.flyTo({ center: coordinate, zoom: Math.max(this.map.getZoom(), feature.properties.place === "city" ? 11.7 : 13), duration: 680, essential: true }); this.showLocalityPopup(feature);
  }

  searchFast(term: string): SearchChoice[] {
    return this.searchService.searchFast(term);
  }

  async search(term: string): Promise<SearchChoice[]> {
    return this.searchService.search(term);
  }

  focusSearch(choice: SearchChoice): void {
    this.collapseSheetForMapFocus();
    if (choice.type === "local") { this.focusLocality(choice.feature); return; }
    const coordinate: LngLatTuple = choice.type === "owner" ? [choice.place.longitude, choice.place.latitude] : [choice.item.x, choice.item.y];
    const zoom = choice.type === "base" && choice.item.k === "street" ? 15 : 14;
    this.map.flyTo({ center: coordinate, zoom: Math.max(this.map.getZoom(), zoom), duration: 680, essential: true });
    if (choice.type === "owner") this.showOwnerPopup(choice.place, coordinate);
    else {
      const content = document.createElement("div");
      content.className = "place-popup place-popup--rich";
      content.dir = languageDirection(this.language);
      const title = localizedStaticName(choice.item, this.language);
      content.innerHTML = `<strong>${escapeText(title)}</strong><span>${escapeText(localizedStaticCategory(choice.item, this.language, choice.item.k === "street" ? UI[this.language].street : UI[this.language].place))}</span>`;
      this.appendShareAction(content, coordinate, title);
      this.attachWeather(content, coordinate, this.weatherBadgeMetaForStaticChoice(choice));
      this.openPlacePopup(coordinate, content, { offset: 14, closeButton: false, maxWidth: "280px" });
    }
  }

  requestOwnerCoordinate(onPick: (coordinate: LngLatTuple) => void): void {
    this.collapseSheetForMapFocus();
    this.routing.cancelDestinationPrompt();
    this.coordinatePicker.start(onPick);
  }

  async refreshOwnerContent(): Promise<void> {
    await this.ownerPlaces.refresh();
  }

  async setLanguage(language: Language): Promise<void> {
    if (this.language === language) {
      this.refreshLanguageSurface();
      return;
    }

    // Commit the visible map from the compact 1.2–1.3 MiB locality property
    // pack first. The 19–22 MiB search shard is prepared afterward in the
    // worker and never blocks the language transition overlay.
    const localities = await this.localityLanguagePacks.load(language);
    this.setLocalities(localities);
    this.language = language;
    this.searchService.activateLanguage(language);
    localityCount.textContent = new Intl.NumberFormat("en-US").format(this.localities.length);
    this.refreshLanguageSurface();
    this.normalizeAttributionCard();

    // The 19–22 MiB search catalog is not downloaded during a language
    // transition. Reset the worker and prepare the selected language only when
    // the user next opens search.
    this.searchWorker.reset();
    delete mapShell.dataset.searchLanguageReady;
  }
  fitToKri(animate = true): void {
    const fit = (): void => {
      this.map.setMinZoom(this.coverageMinZoom());
      this.map.resize();
      this.map.fitBounds(KRI_BOUNDS as LngLatBoundsLike, {
        padding: this.fitPadding(),
        duration: animate ? 650 : 0,
        maxZoom: this.coverageFitMaxZoom(),
        essential: true
      });
    };
    if (this.isMobileViewport() && !this.sheetCollapsed) {
      this.sheetCollapsed = true;
      this.applySheetState();
      window.setTimeout(fit, 190);
      return;
    }
    fit();
  }
  setBasemapVisible(visible: boolean): void { this.basemapVisible = visible; this.applyCurrentStyleState(); }
  setAdministrativeVisible(visible: boolean): void { this.administrativeVisible = visible; ADMINISTRATIVE_LAYER_IDS.forEach((id) => { if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"); }); this.labelController.queueAdministrative(); }
  setPlacesVisible(visible: boolean): void { this.placesVisible = visible; PLACE_VISIBILITY_LAYER_IDS.forEach((id) => { if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", visible ? "visible" : "none"); }); this.localityViewport.setVisible(visible); this.basePoiViewport.setVisible(visible); this.naturalPoiViewport.setVisible(visible); this.poiIcons.setVisible(visible); this.atlasMarkers.setVisible(visible); this.queueLabels(); }
  async setMapMode(mode: MapMode): Promise<void> {
    if (mode === "satellite") {
      if (!satelliteEnabled) { setMessage(UI[this.language].satelliteUnavailable, "error"); return; }
      this.resetSatelliteHealthCycle();
      if (this.satelliteValidated === null) {
        void validateSatelliteSource(satelliteSource).then((valid) => {
          // The probe is advisory only: CORS/proxy policy can reject a direct
          // probe while MapLibre raster tiles still render correctly.
          this.satelliteValidated = valid;
          if (!valid) {
            recordRuntimeDiagnostic("satellite.probe", "Satellite probe did not complete; MapLibre will keep the selected source and the light vector safety underlay.", "warning");
          }
        });
      }
    } else {
      this.clearSatelliteErrorTimer();
    }
    if (mode === this.mapMode) {
      this.map.triggerRepaint();
      return;
    }
    this.mapMode = mode;
    mapShell.dataset.mapMode = mode;
    mapElement.dataset.mapMode = mode;
    mapStyleButtons.forEach((button) => { const active = button.dataset.mapMode === mode; button.classList.toggle("is-active", active); button.setAttribute("aria-pressed", String(active)); });
    setMessage(mode === "satellite" ? UI[this.language].satelliteLoading : UI[this.language].loading);
    this.applyCurrentStyleState();
  }

  private applyCurrentStyleState(): void {
    mapShell.classList.add("is-style-switching");
    const targetStyle = this.styleFor(this.mapMode);
    const applied = applyKriStyleState(this.map, targetStyle);

    if (!applied) {
      this.reloadStyleFallback(targetStyle);
      return;
    }

    // applyKriStyleState mutates only static style layers. Route/GPS sources,
    // layers, animation frames and canonical controller state stay untouched.
    this.queueLabels();
    this.normalizeAttributionCard();
    window.requestAnimationFrame(() => {
      mapShell.classList.remove("is-style-switching");
      if (this.mapMode === "satellite") {
        setMessage(this.satelliteSourceHealthy ? UI[this.language].satelliteReady : UI[this.language].satelliteLoading, this.satelliteSourceHealthy ? "success" : "normal");
      } else {
        setMessage(UI[this.language].ready, "success");
      }
    });
  }

  private reloadStyleFallback(targetStyle = this.styleFor(this.mapMode)): void {
    // Recovery path only: used if the browser reports an incomplete style.
    // Routing and GPS controllers retain their in-memory GeoJSON and restore it
    // immediately after MapLibre finishes the fallback style load.
    this.interactionsInstalled = false;
    mapShell.classList.add("is-style-switching");
    this.map.setStyle(targetStyle, { diff: true });
    this.map.once("style.load", () => {
      this.installLayers();
      this.installInteractions();
      this.routing.restoreVisualState();
      this.liveLocation.restoreVisualState();
      this.queueLabels();
      this.normalizeAttributionCard();
      window.requestAnimationFrame(() => mapShell.classList.remove("is-style-switching"));
      if (this.mapMode === "satellite") {
        setMessage(this.satelliteSourceHealthy ? UI[this.language].satelliteReady : UI[this.language].satelliteLoading, this.satelliteSourceHealthy ? "success" : "normal");
      } else {
        setMessage(UI[this.language].ready, "success");
      }
    });
  }

  locate(): void {
    this.liveLocation.locate();
    this.deviceQa?.refreshSoon();
  }

  openPwaMapFiles(files: readonly File[]): Promise<void> {
    return this.pwaMapFiles.openFiles(files);
  }

  toggleRoutePinMode(): void {
    this.collapseSheetForMapFocus();
    this.routing.togglePinMode();
  }

  syncPrimaryMapSurfaces(): void {
    mapShell.classList.toggle("has-open-search", this.searchOverlayOpen);
    mapShell.classList.toggle("has-destination-prompt", this.destinationPromptOpen);

    const controlsHidden = mapShell.classList.contains("map-controls-hidden");
    const suppressSheet = this.searchOverlayOpen || this.routeOverlayActive || this.destinationPromptOpen || controlsHidden;
    const suppressControls = this.searchOverlayOpen || controlsHidden;
    const sheetWithInert = mapSheet as HTMLElement & { inert?: boolean };
    const actionsWithInert = mapActions as HTMLElement & { inert?: boolean };
    const searchWithInert = searchCard as HTMLElement & { inert?: boolean };
    const topbarWithInert = topbar as HTMLElement & { inert?: boolean };
    sheetWithInert.inert = suppressSheet;
    actionsWithInert.inert = suppressControls;
    searchWithInert.inert = controlsHidden;
    topbarWithInert.inert = controlsHidden;
    mapSheet.setAttribute("aria-hidden", String(suppressSheet));
    mapActions.setAttribute("aria-hidden", String(suppressControls));
    searchCard.setAttribute("aria-hidden", String(controlsHidden));
    topbar.setAttribute("aria-hidden", String(controlsHidden));

    if (suppressSheet && mapSheet.contains(document.activeElement)) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
    this.overlayLayout.refresh();
  }

  setSearchOverlayOpen(open: boolean): void {
    this.searchOverlayOpen = open;
    mapShell.classList.toggle("is-search-active", open);
    this.basePoiViewport.setPaused(open);
    this.naturalPoiViewport.setPaused(open);
    if (open) {
      // Stop camera easing and defer POI source commits while the keyboard and
      // result list are active. This protects the input frame budget without
      // hiding existing map data or changing GPS/route behavior.
      this.map.stop();
      this.collapseSheetForMapFocus();
      mapShell.classList.remove("map-actions-expanded");
      actionsToggleButton.classList.remove("is-active");
      actionsToggleButton.setAttribute("aria-expanded", "false");
    }
    this.syncPrimaryMapSurfaces();
  }

  getTutorialMapDemoController(): TutorialMapDemoController {
    return this.tutorialMapDemo;
  }

  captureLifecycleState(): AppLifecycleSnapshot {
    const center = this.map.getCenter();
    return {
      schema: 1,
      savedAt: Date.now(),
      camera: {
        center: [center.lng, center.lat],
        zoom: this.map.getZoom(),
        bearing: this.map.getBearing(),
        pitch: this.map.getPitch()
      },
      language: this.language,
      mapMode: this.mapMode,
      sheetCollapsed: this.sheetCollapsed,
      basemapVisible: this.basemapVisible,
      administrativeVisible: this.administrativeVisible,
      placesVisible: this.placesVisible,
      controlsHidden: mapShell.classList.contains("map-controls-hidden")
    };
  }

  resumeFromLifecycle(hiddenForMs: number): void {
    this.map.resize();
    this.overlayLayout.refresh();
    this.routing.restoreVisualState();
    this.liveLocation.restoreVisualState();
    this.map.triggerRepaint();
    // Fresh data is requested after a meaningful absence, without discarding
    // the currently rendered map or forcing a document reload.
    this.softRefreshContent(hiddenForMs >= 10 * 60 * 1000 ? 0 : 180);
  }

  hasActiveRoute(): boolean {
    return this.routing.hasActiveRoute();
  }

}

const controller = new KurdistanAtlasController();
type OwnerStudioInstance = import("./lib/owner-studio").OwnerStudio;
type UserContributionStudioInstance = import("./lib/user-contribution-studio").UserContributionStudio;
type FeedbackStudioInstance = import("./lib/feedback-studio").FeedbackStudio;
let ownerStudio: OwnerStudioInstance | null = null;
let ownerStudioPromise: Promise<OwnerStudioInstance> | null = null;
let userContributionStudio: UserContributionStudioInstance | null = null;
let userContributionStudioPromise: Promise<UserContributionStudioInstance> | null = null;
let feedbackStudio: FeedbackStudioInstance | null = null;
let feedbackStudioPromise: Promise<FeedbackStudioInstance> | null = null;

async function loadOwnerStudio(): Promise<OwnerStudioInstance> {
  if (ownerStudio) return ownerStudio;
  if (!ownerStudioPromise) {
    ownerStudioPromise = import("./lib/owner-studio").then(({ OwnerStudio }) => {
      ownerStudio = new OwnerStudio({
        getLanguage: currentLanguage,
        requestMapPoint: (onPick) => controller.requestOwnerCoordinate(onPick),
        onPlacesChanged: () => controller.refreshOwnerContent(),
        onNonAdminIdentity: async () => { await (await loadUserContributionStudio()).open(); }
      });
      return ownerStudio;
    }).catch((error) => { ownerStudioPromise = null; throw error; });
  }
  return ownerStudioPromise;
}

async function loadUserContributionStudio(): Promise<UserContributionStudioInstance> {
  if (userContributionStudio) return userContributionStudio;
  if (!userContributionStudioPromise) {
    userContributionStudioPromise = import("./lib/user-contribution-studio").then(({ UserContributionStudio }) => {
      userContributionStudio = new UserContributionStudio({
        getLanguage: currentLanguage,
        requestMapPoint: (onPick) => controller.requestOwnerCoordinate(onPick),
        onPlacesChanged: () => controller.refreshOwnerContent(),
        onAdminRoleChange: (isAdmin) => {
          if (isAdmin === null) {
            ownerStudioButton.hidden = true;
            userAccountButton.hidden = true;
            if (userAccountDot) userAccountDot.hidden = true;
            return;
          }
          ownerStudioButton.hidden = !isAdmin;
          userAccountButton.hidden = isAdmin;
          if (isAdmin && userAccountDot) userAccountDot.hidden = true;
        },
        onUnreadCountChange: (count) => {
          if (!userAccountDot) return;
          userAccountDot.hidden = count <= 0;
          userAccountButton.dataset.unread = String(count);
          userAccountButton.setAttribute("aria-label", count > 0 ? `Account and contributions, ${count} unread notifications` : "Account and contributions");
        },
        onAdminIdentity: async () => { await (await loadOwnerStudio()).open(); }
      });
      return userContributionStudio;
    }).catch((error) => { userContributionStudioPromise = null; throw error; });
  }
  return userContributionStudioPromise;
}
async function loadFeedbackStudio(): Promise<FeedbackStudioInstance> {
  if (feedbackStudio) return feedbackStudio;
  if (!feedbackStudioPromise) {
    feedbackStudioPromise = import("./lib/feedback-studio").then(({ FeedbackStudio }) => {
      feedbackStudio = new FeedbackStudio({ getLanguage: currentLanguage });
      return feedbackStudio;
    }).catch((error) => { feedbackStudioPromise = null; throw error; });
  }
  return feedbackStudioPromise;
}

let currentAccountIdentity: AtlasAuthIdentity | null = null;
let accountSyncEpoch = 0;

function accountButtonCopy(identity: AtlasAuthIdentity | null): string {
  const language = currentLanguage();
  if (!identity) return language === "ar" ? "تسجيل الدخول والحساب" : language === "en" ? "Sign in and account" : "چوونەژوورەوە و هەژمار";
  const name = identity.displayName?.trim() || identity.email?.trim() || (language === "ar" ? "الحساب" : language === "en" ? "Account" : "هەژمار");
  return language === "ar" ? `الحساب: ${name}` : language === "en" ? `Account: ${name}` : `هەژمار: ${name}`;
}

function renderAccountPresentation(identity: AtlasAuthIdentity | null): void {
  currentAccountIdentity = identity;
  const isAdmin = identity?.role === "admin";
  ownerStudioButton.hidden = !isAdmin;
  userAccountButton.hidden = Boolean(isAdmin);
  userAccountButton.dataset.authenticated = String(Boolean(identity));
  const label = accountButtonCopy(identity);
  userAccountButton.title = label;
  userAccountButton.setAttribute("aria-label", label);
  mapShell.dataset.authState = identity ? "signed-in" : "signed-out";
  if (identity?.displayName) mapShell.dataset.accountName = identity.displayName;
  else delete mapShell.dataset.accountName;
}

async function syncAccountPresentation(): Promise<void> {
  const epoch = ++accountSyncEpoch;
  try {
    const identity = await getAtlasAuthIdentity();
    if (epoch !== accountSyncEpoch) return;
    renderAccountPresentation(identity);
  } catch {
    if (epoch !== accountSyncEpoch) return;
    renderAccountPresentation(null);
  }
}

subscribeToAtlasAuth(() => {
  void syncAccountPresentation();
  void supportHub.refresh();
  if (userContributionStudio) void userContributionStudio.handleAuthStateChange();
});
void syncAccountPresentation();

const offlineMapPackUi = new OfflineMapPackUiController({
  manager: offlineMapPack,
  getLanguage: currentLanguage
});

const serviceWorkerController = new ServiceWorkerController({
  // Activate a waiting worker only while the page is safely backgrounded.
  // The current document is never force-reloaded; the next navigation receives
  // the new application shell while active map, route and editor state survive.
  isSafeToActivate: () => document.visibilityState === "hidden"
    && !controller.hasActiveRoute()
    && !(ownerStudio?.isOpenOrBusy() ?? false)
    && !(userContributionStudio?.isOpenOrBusy() ?? false)
    && !(feedbackStudio?.isOpenOrBusy() ?? false),
  onStateChange: (snapshot) => {
    mapShell.dataset.serviceWorker = snapshot.error ? "error" : snapshot.updateReady ? "update-ready" : snapshot.controlling ? "active" : snapshot.registered ? "registered" : "idle";
    runtimeState.setUpdateState(snapshot.error ? "failed" : snapshot.activationPending ? "applying" : snapshot.updateReady ? "available" : "idle");
  }
});

// Register the production service worker before heavy map initialization so PWA analyzers
// and browsers can discover it immediately without delaying map boot.
serviceWorkerController.start();
const appLifecycle = installAppLifecycleController({
  capture: () => controller.captureLifecycleState(),
  onResume: ({ hiddenForMs }) => controller.resumeFromLifecycle(hiddenForMs)
});
window.addEventListener("beforeunload", () => {
  appLifecycle.destroy();
  health.dispose();
  serviceWorkerController.dispose();
}, { once: true });

const searchController = installSearchController({
  input: searchInput,
  clearButton: clearSearchButton,
  results: searchResults,
  getLanguage: currentLanguage,
  adapter: {
    isSearchIndexReady: () => controller.isSearchIndexReady(),
    searchFast: (term) => controller.searchFast(term),
    prepare: () => controller.prepareSearch(),
    search: (term) => controller.search(term),
    focusSearch: (choice) => controller.focusSearch(choice)
  },
  onOpenChange: (open) => controller.setSearchOverlayOpen(open)
});
const premiumShellController = installPremiumShellController({
  mapShell,
  aboutButton: brandAboutButton,
  aboutDialog,
  closeButtons: [aboutCloseButton, aboutDoneButton]
});
const supportSection = query<HTMLElement>("#supportSection");
const openSupportPanel = (): void => {
  premiumShellController.openAbout();
  window.setTimeout(() => { supportSection.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 40);
};
supportButton.addEventListener("click", openSupportPanel);
const tutorialController = installTutorialController({
  getLanguage: currentLanguage,
  openAbout: premiumShellController.openAbout,
  closeAbout: premiumShellController.closeAbout,
  isMapActionsExpanded: () => mapShell.classList.contains("map-actions-expanded"),
  setMapActionsExpanded,
  mapDemo: controller.getTutorialMapDemoController(),
  onCompleted: androidReleaseExperience.showPostTutorialPromotion
});
tutorialRestartButton.addEventListener("click", () => { premiumShellController.closeAbout(); tutorialController.start(); });
const openFeedbackStudio = (): void => {
  premiumShellController.closeAbout();
  void loadFeedbackStudio().then((studio) => studio.open());
};
feedbackButton.addEventListener("click", openFeedbackStudio);
feedbackQuickButton.addEventListener("click", openFeedbackStudio);
window.addEventListener("nav-kurd:road-report", ((event: Event) => {
  const coordinate = (event as CustomEvent<{ coordinate?: LngLatTuple }>).detail?.coordinate;
  if (!coordinate || coordinate.length < 2 || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return;
  premiumShellController.closeAbout();
  void loadFeedbackStudio().then((studio) => studio.openRoadReport([coordinate[0], coordinate[1]]));
}) as EventListener);
window.addEventListener("nav-kurd:add-place", ((event: Event) => {
  const coordinate = (event as CustomEvent<{ coordinate?: LngLatTuple }>).detail?.coordinate;
  if (!coordinate || coordinate.length < 2 || !Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return;
  premiumShellController.closeAbout();
  void loadUserContributionStudio().then((studio) => studio.openNewPlaceAt([coordinate[0], coordinate[1]]));
}) as EventListener);

function syncControlsVisibilityButtonCopy(): void {
  const controlsHidden = mapShell.classList.contains("map-controls-hidden");
  const label = controlsHidden ? UI[currentLanguage()].showMapControls : UI[currentLanguage()].hideMapControls;
  controlsVisibilityButton.title = label;
  controlsVisibilityButton.setAttribute("aria-label", label);
  controlsVisibilityButton.setAttribute("aria-pressed", String(controlsHidden));
}

function setMapControlsHidden(hidden: boolean): void {
  mapShell.classList.toggle("map-controls-hidden", hidden);
  if (hidden) setMapActionsExpanded(false);
  controller.syncPrimaryMapSurfaces();
  syncControlsVisibilityButtonCopy();
}

function applyUiLanguage(language: Language): void {
  applyMapUiLanguage({
    language,
    satelliteEnabled,
    mapStyleButtons,
    searchInput,
    backendState,
    actionsToggleButton,
    setStatus
  });
  syncControlsVisibilityButtonCopy();
  const shareTitle = query<HTMLElement>("#shareLocationTitle");
  const shareSub = query<HTMLElement>("#shareLocationSub");
  const copy = language === "ar"
    ? { title: "مشاركة الموقع", sub: "رابط لموقعك الحالي", button: "مشاركة موقعي" }
    : language === "en"
      ? { title: "Share location", sub: "Link to your current location", button: "Share my location" }
      : { title: "هاوبەشکردنی شوێن", sub: "لینکی شوێنی ئێستا", button: "هاوبەشکردنی شوێنی من" };
  shareTitle.textContent = copy.title;
  shareSub.textContent = copy.sub;
  shareLocationButton.title = copy.button;
  shareLocationButton.setAttribute("aria-label", copy.button);
  const privacyLink = query<HTMLAnchorElement>("#aboutPrivacyLink");
  const termsLink = query<HTMLAnchorElement>("#aboutTermsLink");
  privacyLink.textContent = language === "ar" ? "سياسة الخصوصية" : language === "en" ? "Privacy Policy" : "سیاسەتی تایبەتمەندی";
  termsLink.textContent = language === "ar" ? "شروط الاستخدام" : language === "en" ? "Terms of Use" : "مەرجەکانی بەکارهێنان";
  privacyLink.href = new URL(`legal/privacy.html?lang=${language}`, window.location.href).toString();
  termsLink.href = new URL(`legal/terms.html?lang=${language}`, window.location.href).toString();
  window.dispatchEvent(new CustomEvent("nav-kurd:language-change", { detail: { language } }));
}

mapStyleButtons.forEach((button) => button.addEventListener("click", () => { void controller.setMapMode(button.dataset.mapMode as MapMode); }));
function setMapActionsExpanded(expanded: boolean): void {
  mapShell.classList.toggle("map-actions-expanded", expanded);
  actionsToggleButton.classList.toggle("is-active", expanded);
  actionsToggleButton.setAttribute("aria-expanded", String(expanded));
}

sheetToggle.addEventListener("click", () => {
  controller.toggleSheet();
  if (!mapSheet.classList.contains("is-collapsed")) setMapActionsExpanded(false);
});
actionsToggleButton.addEventListener("click", () => {
  setMapActionsExpanded(!mapShell.classList.contains("map-actions-expanded"));
});
controlsVisibilityButton.addEventListener("click", () => {
  setMapControlsHidden(!mapShell.classList.contains("map-controls-hidden"));
});
baseMapButton.addEventListener("click", () => { const next = !baseMapButton.classList.contains("is-active"); baseMapButton.classList.toggle("is-active", next); baseMapButton.setAttribute("aria-pressed", String(next)); controller.setBasemapVisible(next); });
layersButton.addEventListener("click", () => { const next = !layersButton.classList.contains("is-active"); layersButton.classList.toggle("is-active", next); layersButton.setAttribute("aria-pressed", String(next)); controller.setAdministrativeVisible(next); });
placesButton.addEventListener("click", () => { const next = !placesButton.classList.contains("is-active"); placesButton.classList.toggle("is-active", next); placesButton.setAttribute("aria-pressed", String(next)); controller.setPlacesVisible(next); });
userAccountButton.addEventListener("click", () => { void loadUserContributionStudio().then((studio) => studio.open()); });
ownerStudioButton.addEventListener("click", () => { void loadOwnerStudio().then((studio) => studio.open()); });
routePinButton.addEventListener("click", () => controller.toggleRoutePinMode());
[locateButton, sheetLocateButton].forEach((button) => button.addEventListener("click", () => controller.locate()));
const shareCurrentLocation = (): void => {
  const coordinate = controller.currentLocationCoordinate();
  if (!coordinate) {
    controller.locate();
    const copy = currentLanguage() === "ar" ? "فعّل الموقع ثم اضغط المشاركة مرة أخرى." : currentLanguage() === "en" ? "Enable location, then tap Share again." : "GPS چالاک بکە، پاشان دووبارە هاوبەشکردن دابگرە.";
    setMessage(copy, "normal");
    return;
  }
  const title = currentLanguage() === "ar" ? "موقعي في NAV KURD" : currentLanguage() === "en" ? "My NAV KURD location" : "شوێنی من لە NAV KURD";
  void shareMapLocation({ coordinate, title });
};
[shareLocationButton, sheetShareLocationButton].forEach((button) => button.addEventListener("click", shareCurrentLocation));
[fitButton, sheetFitButton].forEach((button) => button.addEventListener("click", () => controller.fitToKri()));
let languageSwitchInProgress = false;
languageButtons.forEach((button) => button.addEventListener("click", () => {
  const language = button.dataset.language as Language;
  if (languageSwitchInProgress || language === currentLanguage()) return;
  searchController.dismiss();
  languageSwitchInProgress = true;
  mapShell.classList.add("is-language-switching");
  languageButtons.forEach((item) => { item.disabled = true; item.setAttribute("aria-busy", "true"); });
  languageTransition.show(language, languageAssetCache.wasPrepared(language) ? "switch" : "download");

  void controller.setLanguage(language).then(() => {
    languageButtons.forEach((item) => item.classList.toggle("is-active", item === button));
    offlineMapPack.setLanguage(language);
    applyUiLanguage(language);
    applySatelliteAvailability();
    searchController.refreshLanguage();
    offlineMapPackUi.refreshLanguage();
    supportHub.refreshLanguage();
    renderAccountPresentation(currentAccountIdentity);
    languageAssetCache.markPrepared(language);
  }).catch((error) => {
    recordRuntimeDiagnostic("language-switch", error, "warning");
    const failure = currentLanguage() === "ar"
      ? "تعذر تحميل بيانات اللغة. بقيت اللغة الحالية فعالة."
      : currentLanguage() === "en"
        ? "The language data could not be loaded. The current language remains active."
        : "داتای زمانەکە لۆد نەکرا؛ زمانی ئێستا بەردەوامە.";
    setMessage(failure, "error");
  }).finally(() => {
    languageSwitchInProgress = false;
    mapShell.classList.remove("is-language-switching");
    languageButtons.forEach((item) => { item.disabled = false; item.removeAttribute("aria-busy"); });
    void languageTransition.hide();
  });
}));

function applySatelliteAvailability(): void {
  const button = mapStyleButtons.find((item) => item.dataset.mapMode === "satellite");
  if (!button) return;
  button.classList.toggle("is-unavailable", !satelliteEnabled);
  button.dataset.ready = String(satelliteEnabled);
  button.title = satelliteEnabled ? UI[currentLanguage()].satelliteStyle : UI[currentLanguage()].satelliteUnavailable;
}

function installPwaLaunchIntents(): void {
  installPwaLaunchIntentHandler({
    focusSearch: (value) => {
      if (value) {
        searchInput.value = value;
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      searchInput.focus({ preventScroll: true });
    },
    locate: () => controller.locate(),
    focusCoordinate: (coordinate, label) => controller.focusSharedCoordinate(coordinate, label),
    fitRegion: () => controller.fitToKri(),
    openMapFiles: (files) => controller.openPwaMapFiles(files),
    newPlaceNote: () => { void loadUserContributionStudio().then((studio) => studio.openNewPlace()); }
  });
}

let brandFontsReadyPromise: Promise<boolean> | null = null;

function waitForUiFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (remaining: number): void => {
      if (remaining <= 0) { resolve(); return; }
      window.requestAnimationFrame(() => step(remaining - 1));
    };
    step(count);
  });
}

async function waitForBrandFontsBounded(): Promise<void> {
  brandFontsReadyPromise ??= loadBrandFonts();
  await Promise.race([
    brandFontsReadyPromise.then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, 420))
  ]);
}

const MAP_LOADING_MIN_VISIBLE_MS = 520;
const MAP_LOADING_EXIT_TIMEOUT_MS = 420;
let mapLoadingStartedAt = performance.now();
let mapLoadingExitPromise: Promise<void> | null = null;
let mapLoadingWatchdog: number | null = null;
let mapLoadingPhase: "loading" | "retry" | "exiting" = "loading";

function syncMapLoadingCopy(): void {
  if (!mapLoading.isConnected) return;
  const copy = UI[currentLanguage()];
  const loadingText = mapLoading.querySelector<HTMLElement>("small");
  const offline = mapShell.dataset.networkState === "offline" || navigator.onLine === false;
  mapLoading.dataset.phase = mapLoadingPhase;
  mapLoading.setAttribute("role", mapLoadingPhase === "retry" ? "alert" : "status");
  if (loadingText) loadingText.textContent = mapLoadingPhase === "retry" ? copy.mapLoadError : offline ? copy.loadingOffline : copy.loadingCard;
  mapLoadingRetry.textContent = copy.loadingRetry;
}

const refreshMapLoadingForNetwork = (): void => {
  if (mapLoadingPhase !== "retry") syncMapLoadingCopy();
};
window.addEventListener("offline", refreshMapLoadingForNetwork, { passive: true });
window.addEventListener("online", refreshMapLoadingForNetwork, { passive: true });
window.addEventListener("nav-kurd:native-network", refreshMapLoadingForNetwork);

function waitForMinimumMapLoadingVisibility(): Promise<void> {
  const elapsed = performance.now() - mapLoadingStartedAt;
  const remaining = Math.max(0, MAP_LOADING_MIN_VISIBLE_MS - elapsed);
  if (remaining <= 0) return Promise.resolve();
  return new Promise((resolve) => window.setTimeout(resolve, remaining));
}

function dismissMapLoading(): Promise<void> {
  if (mapLoadingWatchdog !== null) { window.clearTimeout(mapLoadingWatchdog); mapLoadingWatchdog = null; }
  if (mapLoadingExitPromise) return mapLoadingExitPromise;
  window.removeEventListener("offline", refreshMapLoadingForNetwork);
  window.removeEventListener("online", refreshMapLoadingForNetwork);
  window.removeEventListener("nav-kurd:native-network", refreshMapLoadingForNetwork);
  mapLoadingPhase = "exiting";
  mapLoading.dataset.phase = "exiting";
  mapLoading.setAttribute("aria-hidden", "true");
  mapLoadingExitPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      mapLoading.removeEventListener("transitionend", onTransitionEnd);
      if (mapLoading.isConnected) mapLoading.remove();
      runtimeState.markReady();
      resolve();
    };
    const onTransitionEnd = (event: TransitionEvent): void => {
      if (event.target === mapLoading && event.propertyName === "opacity") finish();
    };
    mapLoading.addEventListener("transitionend", onTransitionEnd);
    window.setTimeout(finish, MAP_LOADING_EXIT_TIMEOUT_MS);
  });
  return mapLoadingExitPromise;
}

async function syncAccountRoleAfterMapReady(): Promise<void> {
  try {
    const contributionStudio = await loadUserContributionStudio();
    const identity = await contributionStudio.syncRole();
    if (adminAccessMode) {
      if (identity?.role === "admin") await (await loadOwnerStudio()).open();
      else if (identity?.role === "user") await contributionStudio.open();
      return;
    }
    if (feedbackAccessMode) await (await loadFeedbackStudio()).open();
    // A completed Google sign-in must return to the map, not reopen the account
    // dashboard automatically. The account panel remains available only from
    // the explicit account button, preserving user control after OAuth return.
  } catch (error) {
    recordRuntimeDiagnostic("auth.background-sync", error, "warning");
  }
}

let initialVisualReadyReached = false;

async function completeTruthfulMapReadyFlow(criticalInitialization: Promise<void>): Promise<void> {
  // Start the visual-frame observer immediately while critical data/style work
  // continues in parallel. The overlay can exit only after both branches are real:
  // the critical initialization is complete and a post-install map render occurs.
  const initialVisualFrame = controller.waitForInitialVisualReady();
  await criticalInitialization;
  await initialVisualFrame;
  runtimeState.markMapFirstFrame();
  await waitForBrandFontsBounded();
  await controller.waitForCriticalMapReady();
  runtimeState.markInteractive();
  await waitForMinimumMapLoadingVisibility();
  initialVisualReadyReached = true;
  await dismissMapLoading();
  await hideNativeSplash();
  await waitForUiFrames(2);
  tutorialController.maybeStart();
}

async function completeDegradedVisualReadyFlow(): Promise<void> {
  if (!controller.hasInitialVisualFrame()) return;
  runtimeState.markMapFirstFrame();
  runtimeState.markInteractive();
  await waitForMinimumMapLoadingVisibility();
  initialVisualReadyReached = true;
  await dismissMapLoading();
  await hideNativeSplash();
  await waitForUiFrames(2);
  tutorialController.maybeStart();
}

function finalizeUsableBoot(): void {
  setStatus("ready", UI[currentLanguage()].statusReady);
  setMessage(UI[currentLanguage()].ready, "success");
  health.ready();
  installPwaLaunchIntents();
  window.setTimeout(() => { void syncAccountRoleAfterMapReady(); }, 320);
  window.setTimeout(() => controller.startBackgroundTasks(), 650);
  window.setTimeout(() => { void offlineMapPack.initialize(); }, 4200);
  window.setTimeout(() => { void androidReleaseExperience.checkForUpdate(); }, 1200);
}

mapLoadingRetry.addEventListener("click", () => {
  mapLoadingRetry.disabled = true;
  mapLoadingRetry.hidden = true;
  mapLoadingPhase = "loading";
  syncMapLoadingCopy();
  void completeTruthfulMapReadyFlow(controller.initialize())
    .then(() => finalizeUsableBoot())
    .catch((error) => {
      mapLoadingPhase = "retry";
      syncMapLoadingCopy();
      mapLoadingRetry.hidden = false;
      mapLoadingRetry.disabled = false;
      runtimeState.fail();
      health.fail(error, UI[currentLanguage()].mapLoadError);
      recordRuntimeDiagnostic("boot.retry", error, "error");
    });
});

async function boot(): Promise<void> {
  try {
    mapLoadingStartedAt = performance.now();
    mapLoadingPhase = "loading";
    mapLoadingRetry.hidden = true;
    mapLoadingRetry.disabled = false;
    syncMapLoadingCopy();
    mapLoadingWatchdog = window.setTimeout(() => {
      if (!mapLoading.isConnected) return;
      mapLoadingPhase = "retry";
      syncMapLoadingCopy();
      mapLoadingRetry.hidden = false;
      mapLoadingRetry.focus({ preventScroll: true });
    }, 18000);
    brandFontsReadyPromise ??= loadBrandFonts();
    applySatelliteAvailability();
    setStatus("loading", UI[currentLanguage()].statusLoading);
    applyUiLanguage(currentLanguage());
    offlineMapPack.setLanguage(currentLanguage());
    mapShell.classList.toggle("map-controls-hidden", recoveredLifecycleState?.controlsHidden === true);
    controller.syncPrimaryMapSurfaces();
    mapStyleButtons.forEach((button) => {
      const active = button.dataset.mapMode === (recoveredLifecycleState?.mapMode ?? "street");
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    baseMapButton.classList.toggle("is-active", recoveredLifecycleState?.basemapVisible ?? true);
    layersButton.classList.toggle("is-active", recoveredLifecycleState?.administrativeVisible ?? true);
    placesButton.classList.toggle("is-active", recoveredLifecycleState?.placesVisible ?? true);
    syncControlsVisibilityButtonCopy();

    // Critical initialization contains the real layer/locality fetches, style
    // readiness, layer installation and map preparation. Search warming, auth,
    // admin-role checks, offline-pack work and other secondary tasks stay out of
    // the loading gate so a healthy map is neither dismissed too early nor held
    // hostage by unrelated background work.
    const criticalInitialization = controller.initialize();
    await completeTruthfulMapReadyFlow(criticalInitialization);
    finalizeUsableBoot();
  } catch (error) {
    // Once MapLibre has produced a real frame, later initialization failures are
    // degraded/background failures, not proof that the map itself is unavailable.
    // Keep the usable map, GPS, routing and account UI alive without a false red
    // map-load banner. Only a pre-render failure is allowed to become fatal.
    if (initialVisualReadyReached || controller.hasInitialVisualFrame()) {
      recordRuntimeDiagnostic("boot.post-render", error, "warning");
      await completeDegradedVisualReadyFlow();
      finalizeUsableBoot();
      health.warnSilently(UI[currentLanguage()].backgroundError);
      return;
    }
    runtimeState.fail();
    health.fail(error, UI[currentLanguage()].mapLoadError);
    const message = error instanceof Error ? error.message : UI[currentLanguage()].mapLoadError;
    void showNativeFatalError(message, currentLanguage());
  }
}
void boot();
