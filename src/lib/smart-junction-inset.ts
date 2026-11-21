import { bearingBetween, type LngLatTuple } from "./location";
import { routeCoordinateAt, routeSlice } from "./route-progress";
import { maneuverLabel, type Maneuver } from "./route-maneuvers";
import type { Language } from "./types";

const COPY = {
  ku: { title: "پێشبینینی چوارڕێیان", detail: "شێمای ڕێگای ڕاستەقینە، نەک داتای لاین", close: "داخستنی پێشبینین" },
  ar: { title: "معاينة التقاطع", detail: "مسار حقيقي؛ لا توجد بيانات حارات مؤكدة", close: "إغلاق المعاينة" },
  en: { title: "Junction preview", detail: "Actual route geometry · lanes not verified", close: "Dismiss junction preview" }
} as const;

/** Lightweight maneuver inset. It never guesses road geometry, lane count, traffic lights
 * or intersection imagery. Uses the exact matched route already on the main map.
 */
export class SmartJunctionInset {
  private readonly root = document.createElement("aside");
  private readonly path: SVGPathElement;
  private readonly road: SVGPathElement;
  private readonly direction: HTMLElement;
  private readonly distance: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly title: HTMLElement;
  private readonly close: HTMLButtonElement;
  private dismissedAt: number | null = null;
  private shownAt: number | null = null;
  private lastRenderedAt = -Infinity;

  constructor(mapShell: HTMLElement) {
    this.root.className = "nav-junction-inset";
    this.root.hidden = true;
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Junction preview");
    this.root.innerHTML = `
      <div class="nav-junction-inset__head">
        <span class="nav-junction-inset__title" data-junction-title></span>
        <button type="button" class="nav-junction-inset__close" data-junction-close aria-label="Close">×</button>
      </div>
      <div class="nav-junction-inset__scene">
        <svg viewBox="0 0 320 210" role="img" aria-label="Upcoming route shape" preserveAspectRatio="xMidYMid meet">
          <path class="nav-junction-inset__road" data-junction-road />
          <path class="nav-junction-inset__route" data-junction-route />
          <circle cx="160" cy="175" r="6" fill="#ffffff" stroke="#2887ff" stroke-width="4" />
        </svg>
      </div>
      <div class="nav-junction-inset__foot">
        <strong data-junction-direction></strong>
        <bdi dir="ltr" data-junction-distance></bdi>
      </div>
      <small class="nav-junction-inset__note" data-junction-detail></small>`;
    this.road = this.root.querySelector<SVGPathElement>("[data-junction-road]")!;
    this.path = this.root.querySelector<SVGPathElement>("[data-junction-route]")!;
    this.title = this.root.querySelector<HTMLElement>("[data-junction-title]")!;
    this.direction = this.root.querySelector<HTMLElement>("[data-junction-direction]")!;
    this.distance = this.root.querySelector<HTMLElement>("[data-junction-distance]")!;
    this.subtitle = this.root.querySelector<HTMLElement>("[data-junction-detail]")!;
    this.close = this.root.querySelector<HTMLButtonElement>("[data-junction-close]")!;
    this.close.addEventListener("click", event => {
      event.stopPropagation();
      this.dismissedAt = this.shownAt;
      this.hide();
    });
    for (const name of ["pointerdown", "touchstart", "mousedown", "dblclick", "wheel"]) {
      this.root.addEventListener(name, event => event.stopPropagation(), { passive: true });
    }
    mapShell.append(this.root);
  }

  update(input: {
    route: readonly LngLatTuple[];
    next: Maneuver | null;
    progressMeters: number;
    speedMetersPerSecond: number;
    accuracyMeters: number;
    language: Language;
    navigating: boolean;
    driving: boolean;
  }): void {
    const { route, next, progressMeters, speedMetersPerSecond, accuracyMeters, language } = input;
    if (!input.navigating || !input.driving || !next || route.length < 3 || document.hidden || accuracyMeters > 65) {
      this.hide(); return;
    }
    const significant = next.modifier !== "straight" || /roundabout|rotary|merge|fork|ramp|exit/.test(next.type);
    if (!significant || next.type === "arrive" || next.type === "depart") { this.hide(); return; }
    const remaining = next.atMeters - progressMeters;
    const lead = Math.max(90, Math.min(350, Math.max(0, speedMetersPerSecond) * 10 + 85));
    if (remaining < 0 || remaining > lead || this.dismissedAt === next.atMeters) { this.hide(); return; }
    if (this.shownAt === next.atMeters && Math.abs(this.lastRenderedAt - progressMeters) < 12) {
      this.distance.textContent = `${Math.max(0, Math.round(remaining))} m`;
      return;
    }
    const pivot = routeCoordinateAt(route, next.atMeters);
    const before = routeCoordinateAt(route, Math.max(0, next.atMeters - 35));
    if (!pivot || !before) { this.hide(); return; }
    const bearing = bearingBetween(before, pivot);
    if (bearing === null) { this.hide(); return; }
    const points = routeSlice(route, Math.max(0, next.atMeters - 90), next.atMeters + 125);
    if (points.length < 3) { this.hide(); return; }
    const rad = bearing * Math.PI / 180;
    const meterY = 111_195;
    const meterX = meterY * Math.max(0.3, Math.cos(pivot[1] * Math.PI / 180));
    const commands = points.map(([lng, lat], index) => {
      const east = (lng - pivot[0]) * meterX;
      const north = (lat - pivot[1]) * meterY;
      const right = east * Math.cos(rad) - north * Math.sin(rad);
      const forward = east * Math.sin(rad) + north * Math.cos(rad);
      const x = 160 + right * 0.58;
      const y = 142 - forward * 0.58;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    this.road.setAttribute("d", commands);
    this.path.setAttribute("d", commands);
    this.title.textContent = COPY[language].title;
    this.subtitle.textContent = COPY[language].detail;
    this.close.setAttribute("aria-label", COPY[language].close);
    this.root.setAttribute("aria-label", COPY[language].title);
    this.direction.textContent = maneuverLabel(next, language);
    this.distance.textContent = `${Math.max(0, Math.round(remaining))} m`;
    this.root.dir = language === "en" ? "ltr" : "rtl";
    this.shownAt = next.atMeters;
    this.lastRenderedAt = progressMeters;
    this.root.hidden = false;
  }

  hide(): void { this.root.hidden = true; }
  clear(): void {
    this.hide();
    this.dismissedAt = null;
    this.shownAt = null;
    this.lastRenderedAt = -Infinity;
  }
  destroy(): void { this.root.remove(); }
}
