import { coreCall, localCoreEnabled } from "../android/local-provider";
import type { LngLatTuple } from "./location";
import type { Language } from "./types";
import { absoluteAppUrl, safeUrl } from "./app-url";

const DEFAULT_WEATHER_API_BASE_URL = absoluteAppUrl("api/weather");
const configuredWeatherUrl = import.meta.env.VITE_KRI_WEATHER_API_BASE_URL?.trim() ?? "";
const WEATHER_API_BASE_URL = safeUrl(configuredWeatherUrl)?.protocol === "https:"
  ? configuredWeatherUrl
  : DEFAULT_WEATHER_API_BASE_URL;
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const STALE_TTL_MS = 10 * 60 * 60 * 1000;
const CACHE_KEY = "nav-kurd:weather:v3";
const MAX_CACHE_ENTRIES = 240;

type WeatherCondition =
  | "clear"
  | "partly-cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "freezing-rain"
  | "snow"
  | "showers"
  | "thunderstorm"
  | "hail"
  | "dust"
  | "dust-rain"
  | "strong-wind"
  | "tornado"
  | "hot"
  | "cold";

type ForecastHour = { at: number; temperature: number; weatherCode: number; isDay: boolean; chance: number | null };

type WeatherReading = {
  observedAt: number;
  timezone: string;
  humidity: number | null;
  apparent: number | null;
  hours: ForecastHour[];
  stale: boolean;
  temperature: number;
  weatherCode: number;
  isDay: boolean;
  windSpeed: number | null;
  windGusts: number | null;
  dust: number | null;
};

type CacheEntry = {
  expiresAt: number;
  value: WeatherReading;
};

type OpenMeteoResponse = {
  available?: boolean; stale?: boolean; timezone?: string; utc_offset_seconds?: number;
  current?: Record<string, unknown>;
  hourly?: Record<string, unknown[]>;
};
const VALID_CODES = new Set([0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]);
const DETAILS = {
  ku: { more: "وردەکاری و پێشبینی", forecast: "پێشبینیی کاتژمێرەکانی داهاتوو", cached: "پاشەکەوتکراو", updated: "داتا", humidity: "شێ", feels: "هەستپێکراو", wind: "با", unavailable: "کەش‌وهەوا بەردەست نییە", retry: "دووبارە هەوڵدان", estimate: "پێشبینیی مۆدێل · دەکرێت بگۆڕێت", rain: "ئەگەری باران" },
  ar: { more: "التفاصيل والتوقعات", forecast: "توقعات الساعات القادمة", cached: "بيانات محفوظة", updated: "البيانات", humidity: "الرطوبة", feels: "المحسوسة", wind: "الرياح", unavailable: "الطقس غير متاح", retry: "إعادة المحاولة", estimate: "توقعات نموذجية · قابلة للتغير", rain: "احتمال المطر" },
  en: { more: "Details & forecast", forecast: "Hourly forecast", cached: "Cached", updated: "Observed", humidity: "Humidity", feels: "Feels like", wind: "Wind", unavailable: "Weather unavailable", retry: "Retry", estimate: "Model forecast · may change", rain: "Rain chance" }
};
function weatherTime(value: unknown, offset = 0): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value * 1000;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = Date.parse(hasZone ? value : value + "Z");
  return Number.isFinite(parsed) ? parsed - (hasZone ? 0 : offset * 1000) : null;
}
function clock(at: number, timezone: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : language === "ar" ? "ar-IQ" : "ckb-IQ",
    { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(at);
}
function decodeReading(payload: OpenMeteoResponse): WeatherReading {
  if (payload.available === false) throw new Error("weather-unavailable");
  const temperature = optionalNumber(payload.current?.temperature_2m);
  const weatherCode = optionalNumber(payload.current?.weather_code);
  const day = optionalNumber(payload.current?.is_day);
  const observedAt = weatherTime(payload.current?.time, payload.utc_offset_seconds);
  const timezone = payload.timezone;
  if (typeof timezone !== "string" || !timezone) throw new Error("weather-invalid-timezone");
  // Validate the provider's timezone; never silently use the phone's timezone.
  clock(Date.now(), timezone, "en");
  if (temperature === null || temperature < -90 || temperature > 65 || weatherCode === null || !VALID_CODES.has(weatherCode)
    || (day !== 0 && day !== 1) || observedAt === null || observedAt > Date.now() + 3600000 || observedAt < Date.now() - STALE_TTL_MS) {
    throw new Error("weather-invalid-current");
  }
  const hours: ForecastHour[] = [];
  for (let i = 0; i < Math.min(payload.hourly?.time?.length ?? 0, 24); i++) {
    const at = weatherTime(payload.hourly?.time?.[i], payload.utc_offset_seconds);
    const temp = optionalNumber(payload.hourly?.temperature_2m?.[i]);
    const code = optionalNumber(payload.hourly?.weather_code?.[i]);
    const isDay = optionalNumber(payload.hourly?.is_day?.[i]);
    const chance = optionalNumber(payload.hourly?.precipitation_probability?.[i]);
    if (at === null || at <= Date.now() || at > Date.now() + 10 * 3600000 || (hours.length && at <= hours[hours.length - 1].at)
      || temp === null || temp < -90 || temp > 65 || code === null || !VALID_CODES.has(code) || (isDay !== 0 && isDay !== 1)) continue;
    hours.push({ at, temperature: temp, weatherCode: code, isDay: isDay === 1,
      chance: chance !== null && chance >= 0 && chance <= 100 ? chance : null });
  }
  return { temperature, weatherCode, isDay: day === 1, observedAt, timezone, hours,
    stale: payload.stale === true || Date.now() - observedAt > 90 * 60000,
    windSpeed: optionalNumber(payload.current?.wind_speed_10m), windGusts: optionalNumber(payload.current?.wind_gusts_10m),
    dust: optionalNumber(payload.current?.dust), humidity: optionalNumber(payload.current?.relative_humidity_2m),
    apparent: optionalNumber(payload.current?.apparent_temperature) };
}

const DUST_THRESHOLD = 50;
const STRONG_WIND_KMH = 40;
const STRONG_GUST_KMH = 60;

const CONDITION_COPY: Record<Language, Record<Exclude<WeatherCondition, "clear">, string>> = {
  ku: {
    "partly-cloudy": "نیمچە هەوراوی",
    cloudy: "هەوراوی",
    fog: "تەم",
    drizzle: "نمەباران",
    rain: "باران",
    "freezing-rain": "بارانی بەستوو",
    snow: "بەفر",
    showers: "بارانی پچڕپچڕ",
    thunderstorm: "برووسکە و باران",
    hail: "تەرزە و برووسکە",
    dust: "خۆڵ و تۆز",
    "dust-rain": "بارانی خۆڵاوی",
    "strong-wind": "بای بەهێز",
    tornado: "گێژەڵووکە و ڕەشەبا",
    hot: "گەرمێکی توند",
    cold: "سەرمای توند"
  },
  ar: {
    "partly-cloudy": "غائم جزئياً",
    cloudy: "غائم",
    fog: "ضباب",
    drizzle: "رذاذ",
    rain: "مطر",
    "freezing-rain": "مطر متجمد",
    snow: "ثلج",
    showers: "زخات مطر",
    thunderstorm: "عاصفة رعدية",
    hail: "برد وعاصفة رعدية",
    dust: "غبار",
    "dust-rain": "مطر محمل بالغبار",
    "strong-wind": "رياح قوية",
    tornado: "إعصار قمعي ورياح شديدة",
    hot: "حر شديد",
    cold: "برد قارس"
  },
  en: {
    "partly-cloudy": "Partly cloudy",
    cloudy: "Cloudy",
    fog: "Fog",
    drizzle: "Drizzle",
    rain: "Rain",
    "freezing-rain": "Freezing rain",
    snow: "Snow",
    showers: "Rain showers",
    thunderstorm: "Thunderstorm",
    hail: "Thunderstorm with hail",
    dust: "Dusty",
    "dust-rain": "Dusty rain",
    "strong-wind": "Strong wind",
    tornado: "Tornado and severe wind",
    hot: "Extreme heat",
    cold: "Extreme cold"
  }
};

const CLEAR_COPY: Record<Language, { day: string; night: string }> = {
  ku: { day: "خۆرەتاو", night: "ئاسمانی ڕوون" },
  ar: { day: "مشمس", night: "سماء صافية" },
  en: { day: "Sunny", night: "Clear sky" }
};

const UI_COPY: Record<Language, { loading: string; current: string }> = {
  ku: { loading: "کەش‌وهەوا…", current: "پلەی گەرمی ئێستا" },
  ar: { loading: "الطقس…", current: "درجة الحرارة الآن" },
  en: { loading: "Weather…", current: "Current temperature" }
};

function baseWeatherCondition(code: number): WeatherCondition {
  if (code === 19) return "tornado";
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly-cloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code === 56 || code === 57 || code === 66 || code === 67) return "freezing-rain";
  if (code >= 61 && code <= 65) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 80 && code <= 82) return "showers";
  if (code >= 96 && code <= 99) return "hail";
  if (code === 95) return "thunderstorm";
  return "cloudy";
}

function weatherCondition(reading: WeatherReading): WeatherCondition {
  const base = baseWeatherCondition(reading.weatherCode);
  if (base === "tornado") return base;
  const dusty = reading.dust !== null && reading.dust >= DUST_THRESHOLD;
  if (dusty && ["drizzle", "rain", "freezing-rain", "showers"].includes(base)) {
    return "dust-rain";
  }
  if (dusty && ["clear", "partly-cloudy", "cloudy"].includes(base)) return "dust";
  const strongWind = (reading.windSpeed ?? 0) >= STRONG_WIND_KMH
    || (reading.windGusts ?? 0) >= STRONG_GUST_KMH;
  if (strongWind && ["clear", "partly-cloudy", "cloudy"].includes(base)) return "strong-wind";
  if (reading.temperature >= 42 && ["clear", "partly-cloudy", "cloudy"].includes(base)) return "hot";
  if (reading.temperature <= -5 && ["clear", "partly-cloudy", "cloudy"].includes(base)) return "cold";
  return base;
}

function weatherConditionLabel(condition: WeatherCondition, isDay: boolean, language: Language): string {
  if (condition === "clear") return CLEAR_COPY[language][isDay ? "day" : "night"];
  return CONDITION_COPY[language][condition];
}

function weatherIconAsset(condition: WeatherCondition, isDay: boolean): string {
  const fileName = condition === "clear"
    ? isDay ? "clear-day.svg" : "clear-night.svg"
    : condition === "partly-cloudy"
      ? isDay ? "partly-cloudy-day.svg" : "partly-cloudy-night.svg"
      : condition === "drizzle" || condition === "showers" || condition === "dust-rain"
        ? "rain.svg"
        : condition === "freezing-rain"
          ? "freezing-rain.svg"
        : condition === "hail"
          ? "hail.svg"
          : condition === "dust"
            ? "dust.svg"
            : condition === "strong-wind"
              ? "wind.svg"
          : `${condition}.svg`;
  return `${import.meta.env.BASE_URL}assets/weather/${fileName}`;
}

function optionalNumber(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function coordinateKey([longitude, latitude]: LngLatTuple): string {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function validCoordinate([longitude, latitude]: LngLatTuple): boolean {
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= -180 && longitude <= 180
    && latitude >= -90 && latitude <= 90;
}

function trimCache(cache: Map<string, CacheEntry>): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return;
  const oldest = [...cache.entries()]
    .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    .slice(0, cache.size - MAX_CACHE_ENTRIES);
  oldest.forEach(([key]) => cache.delete(key));
}

function roundTemperature(value: number, language: Language): string {
  const locale = language === "en" ? "en-US" : language === "ar" ? "ar-IQ" : "ckb-IQ";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value))}°C`;
}

function buildWeatherBadge(language: Language): HTMLElement {
  const copy = UI_COPY[language];
  const root = document.createElement("div");
  root.className = "place-weather";
  root.dataset.state = "loading";
  root.dir = language === "en" ? "ltr" : "rtl";

  const visual = document.createElement("span");
  visual.className = "place-weather__visual";
  visual.setAttribute("aria-hidden", "true");

  const loading = document.createElement("span");
  loading.className = "place-weather__loading";

  const weatherImage = document.createElement("img");
  weatherImage.hidden = true;
  weatherImage.alt = "";
  weatherImage.decoding = "async";
  visual.append(loading, weatherImage);

  const copyContainer = document.createElement("span");
  copyContainer.className = "place-weather__copy";

  const temperature = document.createElement("strong");
  temperature.textContent = "—";

  const condition = document.createElement("small");
  condition.className = "place-weather__condition";
  condition.textContent = copy.loading;

  copyContainer.append(temperature, condition);

  root.append(visual, copyContainer);
  // Keep weather controls inside the popup. Do not preventDefault: the native
  // summary must retain touch, mouse, Enter and Space disclosure behavior.
  for (const event of ["click", "pointerdown", "touchstart", "wheel"]) {
    root.addEventListener(event, (e) => e.stopPropagation(), { passive: true });
  }

  return root;
}


export class PlaceWeatherService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<WeatherReading>>();
  private readonly badges = new Map<HTMLElement, { coordinate: LngLatTuple; language: Language }>();
  private hydration: Promise<void> | null = null;
  private saveTimer: number | null = null;
  constructor() {
    window.addEventListener("nav-kurd:network-recovered", () => {
      for (const [root, args] of this.badges) {
        if (!root.isConnected) this.badges.delete(root);
        else if (root.dataset.state !== "ready") void this.populate(root, args.coordinate, args.language);
      }
    });
  }
  createBadge(coordinate: LngLatTuple, language: Language): HTMLElement {
    const root = buildWeatherBadge(language);
    for (const element of this.badges.keys()) if (!element.isConnected) this.badges.delete(element);
    this.badges.set(root, { coordinate, language });
    while (this.badges.size > 8) this.badges.delete(this.badges.keys().next().value!);
    void this.populate(root, coordinate, language);
    return root;
  }
  private hydrate(): Promise<void> {
    return this.hydration ??= (async () => {
      try {
        const raw: unknown = localCoreEnabled ? await coreCall("preference", { key: "weatherForecastCache" }) : JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
        if (!Array.isArray(raw)) return;
        for (const item of raw.slice(0, 10)) {
          if (!Array.isArray(item) || typeof item[0] !== "string" || !/^-?\d+\.\d{3},-?\d+\.\d{3}$/.test(item[0])) continue;
          const entry = item[1] as CacheEntry;
          const v = entry?.value;
          if (!v || !Number.isFinite(v.temperature) || !VALID_CODES.has(v.weatherCode) || typeof v.isDay !== "boolean"
            || !Number.isFinite(v.observedAt) || Date.now() - v.observedAt > STALE_TTL_MS || v.observedAt > Date.now() + 3600000
            || !Array.isArray(v.hours) || !Number.isFinite(entry.expiresAt)) continue;
          clock(v.observedAt, v.timezone, "en");
          v.hours = v.hours.filter((h) => Number.isFinite(h.at) && Number.isFinite(h.temperature) && VALID_CODES.has(h.weatherCode)
            && typeof h.isDay === "boolean" && (h.chance === null || (typeof h.chance === "number" && h.chance >= 0 && h.chance <= 100))).slice(0, 10);
          this.cache.set(item[0], entry);
        }
      } catch { /* Optional cache never blocks live weather or map startup. */ }
    })();
  }
  private persist(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      const entries = [...this.cache].filter(([,v]) => Date.now() - v.value.observedAt < STALE_TTL_MS).slice(-10);
      if (localCoreEnabled) void coreCall("setPreference", { key: "weatherForecastCache", value: entries }).catch(() => undefined);
      else { try { localStorage.setItem(CACHE_KEY, JSON.stringify(entries)); } catch { /* Storage can be full or disabled. */ } }
    }, 250);
  }
  private async populate(root: HTMLElement, coordinate: LngLatTuple, language: Language): Promise<void> {
    const words = DETAILS[language];
    if (!validCoordinate(coordinate)) { root.remove(); return; }
    try {
      const reading = await this.current(coordinate);
      if (!root.isConnected) return;
      const condition = weatherCondition(reading);
      const temperature = roundTemperature(reading.temperature, language);
      const conditionLabel = weatherConditionLabel(condition, reading.isDay, language);
      const expanded = root.querySelector<HTMLDetailsElement>(".place-weather__details")?.open ?? false;
      root.replaceChildren(...Array.from(buildWeatherBadge(language).children));
      const image = root.querySelector<HTMLImageElement>(".place-weather__visual img")!;
      image.src = weatherIconAsset(condition, reading.isDay); image.hidden = false;
      root.querySelector<HTMLElement>(".place-weather__loading")!.hidden = true;
      root.querySelector<HTMLElement>(".place-weather__copy strong")!.textContent = temperature;
      root.querySelector<HTMLElement>(".place-weather__condition")!.textContent = conditionLabel;
      root.dataset.state = reading.stale ? "cached" : "ready";
      root.dataset.phase = reading.isDay ? "day" : "night";
      const at = clock(reading.observedAt, reading.timezone, language);
      root.setAttribute("aria-label", `${temperature}. ${conditionLabel}. ${words.updated} ${at}${reading.stale ? ` · ${words.cached}` : ""}`);
      root.title = root.getAttribute("aria-label") ?? "";
      const timestamp = document.createElement("small"); timestamp.className = "place-weather__timestamp";
      timestamp.textContent = `${words.updated} ${at}${reading.stale ? ` · ${words.cached}` : ""}`;
      root.querySelector(".place-weather__copy")!.append(timestamp);
      const details = document.createElement("details"); details.className = "place-weather__details"; details.open = expanded;
      const summary = document.createElement("summary"); summary.textContent = words.more; details.append(summary);
      const body = document.createElement("div"); body.className = "place-weather__body";
      const metrics = document.createElement("div"); metrics.className = "place-weather__metrics";
      const metricValues = [
        reading.apparent !== null ? `${words.feels} ${roundTemperature(reading.apparent, language)}` : "",
        reading.humidity !== null && reading.humidity >= 0 && reading.humidity <= 100 ? `${words.humidity} ${Math.round(reading.humidity)}%` : "",
        reading.windSpeed !== null && reading.windSpeed >= 0 ? `${words.wind} ${Math.round(reading.windSpeed)} km/h` : ""
      ];
      for (const value of metricValues.filter(Boolean)) { const chip = document.createElement("span"); chip.textContent = value; metrics.append(chip); }
      if (metrics.childElementCount) body.append(metrics);
      const hours = reading.hours.filter((h) => h.at > Date.now() && h.at <= Date.now() + 10 * 3600000);
      if (hours.length) {
        const title = document.createElement("strong"); title.className = "place-weather__heading"; title.textContent = words.forecast; body.append(title);
        const row = document.createElement("div"); row.className = "place-weather__forecast"; row.dir = "ltr"; row.tabIndex = 0; row.setAttribute("aria-label", words.forecast);
        for (const hour of hours) {
          const cell = document.createElement("div"); cell.className = "place-weather__hour";
          const time = document.createElement("time"); time.dateTime = new Date(hour.at).toISOString(); time.textContent = clock(hour.at, reading.timezone, language);
          const icon = document.createElement("img"); const kind = baseWeatherCondition(hour.weatherCode);
          icon.src = weatherIconAsset(kind, hour.isDay); icon.alt = weatherConditionLabel(kind, hour.isDay, language); icon.loading = "lazy"; icon.width = 28; icon.height = 28;
          const value = document.createElement("strong"); value.textContent = roundTemperature(hour.temperature, language);
          cell.append(time, icon, value);
          if (hour.chance !== null) { const chance = document.createElement("small"); chance.textContent = `${Math.round(hour.chance)}%`; chance.title = words.rain; cell.append(chance); }
          row.append(cell);
        }
        body.append(row);
      } else {
        const empty = document.createElement("p"); empty.className = "place-weather__empty";
        empty.textContent = language === "en" ? "Hourly forecast is currently unavailable."
          : language === "ar" ? "توقعات الساعات غير متاحة حالياً." : "پێشبینیی کاتژمێری لە ئێستادا بەردەست نییە.";
        body.append(empty);
      }
      const credit = document.createElement("small"); credit.className = "place-weather__credit";
      credit.textContent = `Open-Meteo · ${words.estimate}`; body.append(credit); details.append(body); root.append(details);
    } catch {
      if (!root.isConnected) return;
      root.dataset.state = "unavailable"; root.replaceChildren();
      const message = document.createElement("span"); message.textContent = words.unavailable;
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = words.retry;
      retry.addEventListener("click", () => { retry.disabled = true; void this.populate(root, coordinate, language); });
      root.append(message, retry);
    }
  }
  private async current(coordinate: LngLatTuple): Promise<WeatherReading> {
    await this.hydrate();
    const key = coordinateKey(coordinate); const cached = this.cache.get(key); const now = Date.now();
    if (cached && cached.expiresAt > now && !cached.value.stale) return navigator.onLine === false ? { ...cached.value, stale: true } : cached.value;
    const retained = cached && now - cached.value.observedAt <= STALE_TTL_MS ? { ...cached.value, stale: true } : null;
    if (navigator.onLine === false) { if (retained) return retained; throw new Error("weather-offline"); }
    const pending = this.inflight.get(key); if (pending) return pending;
    const request = this.fetchCurrent(coordinate).then((value) => {
      this.cache.delete(key); this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      trimCache(this.cache); this.persist(); return value;
    }).catch((error: unknown) => { if (retained) return retained; throw error; }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request); return request;
  }
  private async fetchCurrent([longitude, latitude]: LngLatTuple): Promise<WeatherReading> {
    const url = new URL(WEATHER_API_BASE_URL);
    url.searchParams.set("latitude", latitude.toFixed(5)); url.searchParams.set("longitude", longitude.toFixed(5));
    url.searchParams.set("current", "temperature_2m,is_day,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,apparent_temperature");
    url.searchParams.set("hourly", "temperature_2m,weather_code,is_day,precipitation_probability");
    url.searchParams.set("forecast_hours", "12"); url.searchParams.set("timeformat", "unixtime");
    url.searchParams.set("temperature_unit", "celsius"); url.searchParams.set("wind_speed_unit", "kmh"); url.searchParams.set("timezone", "auto");
    const controller = new AbortController(); const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error(`weather-http-${response.status}`);
      return decodeReading(await response.json() as OpenMeteoResponse);
    } finally { window.clearTimeout(timeout); }
  }
}
