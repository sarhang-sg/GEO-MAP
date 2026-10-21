import { distanceMeters, type LngLatTuple } from "./location";
import { drivingWeatherAdvisory, navigationClock, forecastWeekday, NAVIGATION_COPY, type DrivingWeather } from "./navigation-weather";
import type { Language } from "./types";
import { mapNoticeStack, NoticeAutoHide } from "./map-notices";
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
  private destinationKey = ""; private destinationRequest = 0; private destinationPending: object | null = null;
  private pending: object | null = null; private currentSeverity = 0; private currentId = "";
  private readonly dismissal: NoticeAutoHide;
  constructor(shell: HTMLElement, private readonly getLanguage: () => Language, private readonly readWeather?: (coordinate: LngLatTuple) => Promise<DrivingWeather>) {
    this.element.className = "navigation-advisory"; this.element.hidden = true;
    this.element.setAttribute("role","status"); this.element.setAttribute("aria-live","polite");
    this.close.type = "button"; this.close.textContent = "×";
    const icon = document.createElement("span"); icon.className = "navigation-advisory__icon"; icon.textContent = "!"; icon.setAttribute("aria-hidden","true");
    const body = document.createElement("div"); body.append(this.title,this.message,this.detail);
    this.element.append(icon,body,this.close); mapNoticeStack(shell).append(this.element);
    this.dismissal = new NoticeAutoHide(this.element, () => this.hide());
    this.close.addEventListener("click",() => this.hide());
  }
  setActive(active: boolean): void { if (this.active === active) return; this.active = active; this.generation++; this.pending = null; this.destinationPending = null; if (!active) this.hide(); else { this.lastRequest = 0; this.destinationRequest = 0; } }
  hide(): void { this.element.hidden = true; this.currentSeverity = 0; this.currentId = ""; this.dismissal.clear(); }
  show(notice: Notice): void {
    const now = Date.now();
    if (!this.active || document.hidden || now-(this.seen.get(notice.id) ?? -Infinity) < 20*60_000 || (!this.element.hidden && notice.severity <= this.currentSeverity)) return;
    this.seen.set(notice.id,now); if (this.seen.size > 64) this.seen.delete(this.seen.keys().next().value!);
    this.currentSeverity = notice.severity; this.currentId = notice.id; this.element.dir = this.getLanguage() === "en" ? "ltr" : "rtl";
    this.title.textContent = notice.title; this.message.textContent = notice.message; this.detail.textContent = notice.detail;
    this.close.setAttribute("aria-label",NAVIGATION_COPY[this.getLanguage()].close); this.element.hidden = false;
    this.dismissal.start(14_000);
  }
  updateDestination(coordinate: LngLatTuple, name: string): void {
    const key = coordinate.map(value => value.toFixed(3)).join(","), now = Date.now();
    if (key !== this.destinationKey) {
      this.destinationKey = key; this.destinationRequest = 0; this.destinationPending = null;
      if (this.currentId.startsWith("destination:")) this.hide();
    }
    if (!this.active || !this.readWeather || this.destinationPending || document.hidden || navigator.onLine === false
      || (key === this.destinationKey && now - this.destinationRequest < 5 * 60_000)) return;
    this.destinationRequest = now; const request = {}; this.destinationPending = request;
    const generation = this.generation;
    void this.readWeather(coordinate).then(reading => {
      if (!this.active || generation !== this.generation || key !== this.destinationKey || this.destinationPending !== request) return;
      const warning = drivingWeatherAdvisory(reading, Date.now(), 24); if (!warning) return;
      const language = this.getLanguage(), copy = NAVIGATION_COPY[language];
      this.show({ id: `destination:${key}:${warning.kind}:${Math.floor(warning.at / 3600_000)}`,
        title: `${copy.weather} · ${name}`, message: copy[warning.kind], severity: warning.severity,
        detail: `${copy.destination} · ${forecastWeekday(warning.at, reading.timezone ?? "Asia/Baghdad", language)} · ${navigationClock(warning.at, language, reading.timezone)} · ${copy.source}` });
    }).catch(() => { /* An unavailable forecast must not interrupt navigation. */ }).finally(() => { if (this.destinationPending === request) this.destinationPending = null; });
  }
  updateWeather(coordinate: LngLatTuple): void {
    const now = Date.now(), elapsed = now-this.lastRequest;
    if (!this.active || !this.readWeather || this.pending || document.hidden || navigator.onLine === false || elapsed < 60_000
      || (elapsed < 5*60_000 && this.lastCoordinate && distanceMeters(coordinate,this.lastCoordinate) < 1000)) return;
    this.lastRequest = now; this.lastCoordinate = [...coordinate]; const request = {}; this.pending = request;
    const generation = this.generation;
    void this.readWeather(coordinate).then(reading => {
      if (!this.active || generation !== this.generation || this.pending !== request) return;
      const warning = drivingWeatherAdvisory(reading,Date.now()); if (!warning) return;
      const language = this.getLanguage(), copy = NAVIGATION_COPY[language];
      this.show({ id: `weather:${warning.kind}:${warning.forecast}`, title: copy.weather, message: copy[warning.kind], severity: warning.severity,
        detail: `${warning.forecast ? copy.forecast : copy.observed} · ${navigationClock(warning.at,language,reading.timezone)} · ${copy.source}` });
    }).catch(() => { /* A weather outage must not interrupt routing. */ }).finally(() => { if (this.pending === request) this.pending = null; });
  }
}
