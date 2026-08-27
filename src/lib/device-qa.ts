import type { Map as MapLibreMap } from "maplibre-gl";
import { languageDirection } from "./i18n";
import type { Language } from "./types";
import type { LiveLocationDiagnosticSnapshot } from "./live-location-controller";
import { hardwareProfileLabel, readHardwareProfile } from "./hardware-profile";

type QaLevel = "pass" | "warn" | "info";

type QaRow = {
  label: string;
  level: QaLevel;
  detail: string;
};

type QaCopy = {
  title: string;
  subtitle: string;
  open: string;
  close: string;
  refresh: string;
  gps: string;
  copy: string;
  copied: string;
  noGps: string;
};

type DeviceQaPanelOptions = {
  map: MapLibreMap;
  mapShell: HTMLElement;
  getLanguage: () => Language;
  getMapDataVersion: () => string;
  getLocalityCount: () => number;
  getOwnerPlaceCount: () => number;
  getSearchIndexReady: () => boolean;
  lowPowerProfile: boolean;
  satelliteEnabled: boolean;
  locate: () => void;
  locationSnapshot: () => LiveLocationDiagnosticSnapshot;
};

const copy: Record<Language, QaCopy> = {
  ku: {
    title: "تاقیکردنەوەی مۆبایل",
    subtitle: "Panel ـی شاردراو بۆ QA ـی GPS، zoom، offline و داتای ماپ.",
    open: "QA",
    close: "داخستن",
    refresh: "نوێکردنەوە",
    gps: "تاقی GPS بکە",
    copy: "کۆپی report",
    copied: "report کۆپی کرا.",
    noGps: "GPS هێشتا coordinate ـی زۆر نوێی نییە. دووبارە locate بکە."
  },
  ar: {
    title: "فحص الهاتف",
    subtitle: "لوحة مخفية لاختبار GPS والتكبير ووضع عدم الاتصال وبيانات الخريطة.",
    open: "QA",
    close: "إغلاق",
    refresh: "تحديث",
    gps: "اختبار GPS",
    copy: "نسخ التقرير",
    copied: "تم نسخ التقرير.",
    noGps: "لا يوجد إحداثي GPS حديث بعد. جرّب زر الموقع مرة أخرى."
  },
  en: {
    title: "Mobile device QA",
    subtitle: "Hidden real-device panel for GPS, zoom, offline and map-data checks.",
    open: "QA",
    close: "Close",
    refresh: "Refresh",
    gps: "Test GPS",
    copy: "Copy report",
    copied: "Report copied.",
    noGps: "No fresh GPS coordinate yet. Press locate again."
  }
};

function qaEnabled(): boolean {
  // Production QA is opt-in only. Authentication, localStorage state and URL hash
  // must never make the developer panel appear for an ordinary user.
  const params = new URLSearchParams(window.location.search);
  return params.get("qa") === "1" || params.get("deviceQa") === "1";
}

function levelLabel(level: QaLevel): string {
  return level === "pass" ? "PASS" : level === "warn" ? "CHECK" : "INFO";
}

function formatNumber(value: number, maximumFractionDigits = 2): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function coordinateText(snapshot: LiveLocationDiagnosticSnapshot): string {
  if (!snapshot.coordinate) return "not captured";
  return `${snapshot.coordinate[1].toFixed(6)}, ${snapshot.coordinate[0].toFixed(6)} · ±${formatNumber(snapshot.accuracyMeters, 1)}m`;
}

function sourceState(map: MapLibreMap, id: string): boolean {
  return Boolean(map.getSource(id));
}

function layerState(map: MapLibreMap, id: string): boolean {
  return Boolean(map.getLayer(id));
}

export class DeviceQaPanel {
  private readonly options: DeviceQaPanelOptions;
  private readonly root: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly rows: HTMLDivElement;
  private readonly message: HTMLParagraphElement;
  private isOpen = false;

  constructor(options: DeviceQaPanelOptions) {
    this.options = options;
    this.toggleButton = document.createElement("button");
    this.toggleButton.type = "button";
    this.toggleButton.className = "device-qa-toggle";
    this.toggleButton.textContent = copy[this.options.getLanguage()].open;
    this.toggleButton.setAttribute("aria-expanded", "false");

    this.root = document.createElement("aside");
    this.root.className = "device-qa-panel";
    this.root.hidden = true;
    this.root.setAttribute("aria-live", "polite");

    this.rows = document.createElement("div");
    this.rows.className = "device-qa-panel__rows";
    this.message = document.createElement("p");
    this.message.className = "device-qa-panel__message";

    this.options.mapShell.append(this.toggleButton, this.root);
    this.toggleButton.addEventListener("click", () => this.toggle());
    window.addEventListener("online", () => this.refresh(), { passive: true });
    window.addEventListener("offline", () => this.refresh(), { passive: true });
    window.addEventListener("resize", () => this.refresh(), { passive: true });
    this.options.map.on("zoomend", () => this.refresh());
    this.options.map.on("moveend", () => this.refresh());
    this.render();
  }

  refresh(): void {
    if (!this.isOpen) return;
    this.render();
  }

  refreshSoon(delay = 1800): void {
    window.setTimeout(() => this.refresh(), delay);
  }

  private toggle(): void {
    this.isOpen = !this.isOpen;
    this.root.hidden = !this.isOpen;
    this.toggleButton.setAttribute("aria-expanded", String(this.isOpen));
    this.toggleButton.classList.toggle("is-active", this.isOpen);
    if (this.isOpen) this.render();
  }

  private snapshot(): QaRow[] {
    const map = this.options.map;
    const location = this.options.locationSnapshot();
    const hardware = readHardwareProfile();
    const viewport = `${Math.round(window.innerWidth)}×${Math.round(window.innerHeight)} · DPR ${formatNumber(window.devicePixelRatio || 1, 2)}`;
    const center = map.getCenter();
    const dynamicGpsReady = sourceState(map, "location-point-source") && sourceState(map, "location-accuracy-source") && layerState(map, "location-dot") && layerState(map, "location-accuracy-fill");
    const baseVectorReady = sourceState(map, "kri-vector") && sourceState(map, "kri-road-vector");
    const runtimePerformance = this.options.mapShell.dataset.runtimePerformance || "normal";
    const longTaskCount = Number(this.options.mapShell.dataset.longTaskCount || 0);
    const longestLongTaskMs = Number(this.options.mapShell.dataset.longestLongTaskMs || 0);
    const longAnimationFrameCount = Number(this.options.mapShell.dataset.longAnimationFrameCount || 0);
    const longestAnimationFrameMs = Number(this.options.mapShell.dataset.longestAnimationFrameMs || 0);
    const runningAnimations = Number(this.options.mapShell.dataset.animationRunningCount || 0);
    const animationTasks = Number(this.options.mapShell.dataset.animationTaskCount || 0);
    const basePoiCommits = Number(this.options.mapShell.dataset.basePoiSourceCommits || 0);
    const naturalPoiCommits = Number(this.options.mapShell.dataset.naturalPoiSourceCommits || 0);
    const basePoiCommitMs = Number(this.options.mapShell.dataset.basePoiLastCommitMs || 0);
    const naturalPoiCommitMs = Number(this.options.mapShell.dataset.naturalPoiLastCommitMs || 0);
    const domLabelCount = this.options.mapShell.querySelectorAll(".locality-label, .road-label, .administrative-label").length;
    const rows: QaRow[] = [
      { label: "Release data version", level: "info", detail: this.options.getMapDataVersion() },
      { label: "Viewport", level: "info", detail: viewport },
      { label: "Device profile", level: this.options.lowPowerProfile ? "warn" : "pass", detail: hardwareProfileLabel(hardware) },
      { label: "Runtime performance", level: runtimePerformance === "reduced" ? "warn" : "pass", detail: `${runtimePerformance} · long tasks ${longTaskCount} (max ${formatNumber(longestLongTaskMs, 0)}ms) · long frames ${longAnimationFrameCount} (max ${formatNumber(longestAnimationFrameMs, 0)}ms)` },
      { label: "Shared map animation scheduler", level: runningAnimations <= animationTasks ? "pass" : "warn", detail: `${runningAnimations}/${animationTasks} active · gesture pause ${this.options.mapShell.dataset.animationInteractionPaused || "false"}` },
      { label: "POI worker source commits", level: Math.max(basePoiCommitMs, naturalPoiCommitMs) > 250 ? "warn" : "pass", detail: `base ${basePoiCommits} × ${formatNumber(basePoiCommitMs, 0)}ms · natural ${naturalPoiCommits} × ${formatNumber(naturalPoiCommitMs, 0)}ms` },
      { label: "DOM map labels", level: domLabelCount > 120 ? "warn" : "pass", detail: `${domLabelCount} active labels` },
      { label: "Network state", level: navigator.onLine ? "pass" : "warn", detail: navigator.onLine ? "online" : "offline" },
      { label: "Secure geolocation origin", level: window.isSecureContext ? "pass" : "warn", detail: window.isSecureContext ? "HTTPS/secure context" : "location requires HTTPS or localhost" },
      { label: "Geolocation API", level: "geolocation" in navigator ? "pass" : "warn", detail: "geolocation" in navigator ? "available" : "not available in this browser" },
      { label: "Map loaded", level: map.loaded() ? "pass" : "warn", detail: `zoom ${formatNumber(map.getZoom(), 2)} · center ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}` },
      { label: "PMTiles vector sources", level: baseVectorReady ? "pass" : "warn", detail: baseVectorReady ? "base map and unified KRI+Kirkuk road sources present" : "one or more vector sources are not mounted yet" },
      { label: "GPS MapLibre layers", level: dynamicGpsReady ? "pass" : "warn", detail: dynamicGpsReady ? "point, halo and accuracy layers are active" : "GPS GeoJSON sources/layers are not ready" },
      { label: "DOM GPS marker check", level: document.querySelector(".location-marker") ? "warn" : "pass", detail: document.querySelector(".location-marker") ? "unexpected DOM marker found" : "no unexpected DOM marker in runtime" },
      { label: "Location snapshot", level: location.hasCoordinate ? "pass" : "info", detail: `${coordinateText(location)} · following ${location.following ? "on" : "off"} · watching ${location.watching ? "on" : "off"}` },
      { label: "Search index", level: this.options.getSearchIndexReady() ? "pass" : "info", detail: this.options.getSearchIndexReady() ? "full index loaded" : "lazy; loads on first search or idle desktop time" },
      { label: "Static localities", level: this.options.getLocalityCount() > 0 ? "pass" : "warn", detail: formatNumber(this.options.getLocalityCount(), 0) },
      { label: "Owner checkpoints", level: sourceState(map, "atlas-places-source") ? "pass" : "warn", detail: `${formatNumber(this.options.getOwnerPlaceCount(), 0)} loaded · source ${sourceState(map, "atlas-places-source") ? "ready" : "missing"}` },
      { label: "Satellite gate", level: this.options.satelliteEnabled ? "info" : "pass", detail: this.options.satelliteEnabled ? "licensed raster provider is enabled" : "disabled until a licensed restricted provider is configured" }
    ];
    return rows;
  }

  private render(): void {
    const language = this.options.getLanguage();
    const text = copy[language];
    this.root.dir = languageDirection(language);
    this.toggleButton.textContent = text.open;
    this.root.innerHTML = `<header class="device-qa-panel__header"><div><strong>${text.title}</strong><span>${text.subtitle}</span></div><button type="button" class="device-qa-panel__close">${text.close}</button></header><div class="device-qa-panel__actions"><button type="button" data-qa-action="gps">${text.gps}</button><button type="button" data-qa-action="refresh">${text.refresh}</button><button type="button" data-qa-action="copy">${text.copy}</button></div>`;
    this.rows.innerHTML = "";
    for (const row of this.snapshot()) {
      const item = document.createElement("div");
      item.className = "device-qa-panel__row";
      item.dataset.level = row.level;
      item.innerHTML = `<span>${row.label}</span><strong>${levelLabel(row.level)}</strong><small>${row.detail}</small>`;
      this.rows.append(item);
    }
    this.root.append(this.rows, this.message);
    this.root.querySelector<HTMLButtonElement>(".device-qa-panel__close")?.addEventListener("click", () => this.toggle());
    this.root.querySelector<HTMLButtonElement>('[data-qa-action="refresh"]')?.addEventListener("click", () => this.refresh());
    this.root.querySelector<HTMLButtonElement>('[data-qa-action="gps"]')?.addEventListener("click", () => this.runGpsTest());
    this.root.querySelector<HTMLButtonElement>('[data-qa-action="copy"]')?.addEventListener("click", () => { void this.copyReport(); });
  }

  private runGpsTest(): void {
    this.options.locate();
    this.message.textContent = "GPS test requested. Wait outdoors or near a window, then refresh after a few seconds.";
    this.refreshSoon(2200);
    this.refreshSoon(6200);
  }

  private async copyReport(): Promise<void> {
    const report = {
      captured_at: new Date().toISOString(),
      version: this.options.getMapDataVersion(),
      user_agent: navigator.userAgent,
      rows: this.snapshot(),
      location: this.options.locationSnapshot()
    };
    const payload = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard?.writeText(payload);
      this.message.textContent = copy[this.options.getLanguage()].copied;
    } catch {
      this.message.textContent = payload;
    }
  }
}

export function installDeviceQaPanel(options: DeviceQaPanelOptions): DeviceQaPanel | null {
  if (!qaEnabled()) return null;
  const panel = new DeviceQaPanel(options);
  (window as Window & { __NAV_KURD_DEVICE_QA__?: DeviceQaPanel }).__NAV_KURD_DEVICE_QA__ = panel;
  return panel;
}
