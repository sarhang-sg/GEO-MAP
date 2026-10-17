import { distanceMeters, type LngLatTuple } from "./location";
import { drivingWeatherAdvisory, navigationClock, NAVIGATION_COPY, type DrivingWeather } from "./navigation-weather";
import type { Language } from "./types";
type Notice = { id: string; title: string; message: string; detail: string; severity: number };
export class NavigationAdvisory {
  private readonly element = document.createElement("aside");
  private readonly title = document.createElement("strong");
  private readonly message = document.createElement("p");
  private readonly detail = document.createElement("small");
  private readonly close = document.createElement("button");
  private readonly seen = new Map<string,number>();
  private active = false; private generation = 0; private lastRequest = 0;
  private lastCoordinate: LngLatTuple | null = null;
  private pending = false; private hideTimer = 0; private currentSeverity = 0;
  constructor(shell: HTMLElement, private readonly getLanguage: () => Language, private readonly readWeather?: (coordinate: LngLatTuple) => Promise<DrivingWeather>) {
    this.element.className = "navigation-advisory"; this.element.hidden = true;
    this.element.setAttribute("role","status"); this.element.setAttribute("aria-live","polite");
    this.close.type = "button"; this.close.textContent = "×";
    const icon = document.createElement("span"); icon.className = "navigation-advisory__icon"; icon.textContent = "!"; icon.setAttribute("aria-hidden","true");
    const body = document.createElement("div"); body.append(this.title,this.message,this.detail);
    this.element.append(icon,body,this.close); shell.append(this.element);
    this.close.addEventListener("click",() => this.hide());
  }
  setActive(active: boolean): void { if (this.active === active) return; this.active = active; this.generation++; if (!active) this.hide(); else this.lastRequest = 0; }
  hide(): void { this.element.hidden = true; this.currentSeverity = 0; window.clearTimeout(this.hideTimer); }
  show(notice: Notice): void {
    const now = Date.now();
    if (!this.active || document.hidden || now-(this.seen.get(notice.id) ?? -Infinity) < 20*60_000 || (!this.element.hidden && notice.severity <= this.currentSeverity)) return;
    this.seen.set(notice.id,now); if (this.seen.size > 64) this.seen.delete(this.seen.keys().next().value!);
    this.currentSeverity = notice.severity; this.element.dir = this.getLanguage() === "en" ? "ltr" : "rtl";
    this.title.textContent = notice.title; this.message.textContent = notice.message; this.detail.textContent = notice.detail;
    this.close.setAttribute("aria-label",NAVIGATION_COPY[this.getLanguage()].close); this.element.hidden = false;
    window.clearTimeout(this.hideTimer); this.hideTimer = window.setTimeout(() => this.hide(),14_000);
  }
  updateWeather(coordinate: LngLatTuple): void {
    const now = Date.now(), elapsed = now-this.lastRequest;
    if (!this.active || !this.readWeather || this.pending || document.hidden || navigator.onLine === false || elapsed < 60_000
      || (elapsed < 5*60_000 && this.lastCoordinate && distanceMeters(coordinate,this.lastCoordinate) < 1000)) return;
    this.lastRequest = now; this.lastCoordinate = [...coordinate]; this.pending = true;
    const generation = this.generation;
    void this.readWeather(coordinate).then(reading => {
      if (!this.active || generation !== this.generation) return;
      const warning = drivingWeatherAdvisory(reading,Date.now()); if (!warning) return;
      const language = this.getLanguage(), copy = NAVIGATION_COPY[language];
      this.show({ id: `weather:${warning.kind}:${warning.forecast}`, title: copy.weather, message: copy[warning.kind], severity: warning.severity,
        detail: `${warning.forecast ? copy.forecast : copy.observed} · ${navigationClock(warning.at,language)} · ${copy.source}` });
    }).catch(() => { /* A weather outage must not interrupt routing. */ }).finally(() => { this.pending = false; });
  }
}
