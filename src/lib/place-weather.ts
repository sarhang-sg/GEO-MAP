import type { LngLatTuple } from "./location";
import type { Language } from "./types";

const DEFAULT_WEATHER_API_BASE_URL = new URL("api/weather", new URL(import.meta.env.BASE_URL, window.location.origin)).toString();
const WEATHER_API_BASE_URL = import.meta.env.VITE_KRI_WEATHER_API_BASE_URL?.trim() || DEFAULT_WEATHER_API_BASE_URL;
const CACHE_TTL_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5500;
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

type WeatherReading = {
  temperature: number;
  apparentTemperature: number | null;
  weatherCode: number;
  isDay: boolean;
  observedAt: string;
  timezone: string;
  timezoneAbbreviation: string;
  humidity: number | null;
  precipitation: number | null;
  rain: number | null;
  showers: number | null;
  snowfall: number | null;
  cloudCover: number | null;
  windSpeed: number | null;
  windGusts: number | null;
  dust: number | null;
  pm10: number | null;
};

type CacheEntry = {
  expiresAt: number;
  value: WeatherReading;
};

export type PlaceWeatherBadgeMeta = {
  placeIconSrc?: string;
  placeIconLabel?: string;
};

type OpenMeteoResponse = {
  available?: boolean;
  timezone?: unknown;
  timezone_abbreviation?: unknown;
  current?: {
    temperature_2m?: unknown;
    apparent_temperature?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
    time?: unknown;
    relative_humidity_2m?: unknown;
    precipitation?: unknown;
    rain?: unknown;
    showers?: unknown;
    snowfall?: unknown;
    cloud_cover?: unknown;
    wind_speed_10m?: unknown;
    wind_gusts_10m?: unknown;
    dust?: unknown;
    pm10?: unknown;
  };
};

type SeasonName = "spring" | "summer" | "autumn" | "winter";
type WeatherFact = { icon: "temperature" | "humidity" | "wind" | "dust"; value: string };

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

const SEASON_COPY: Record<Language, Record<SeasonName, string>> = {
  ku: { spring: "بەهار", summer: "هاوین", autumn: "پاییز", winter: "زستان" },
  ar: { spring: "الربيع", summer: "الصيف", autumn: "الخريف", winter: "الشتاء" },
  en: { spring: "Spring", summer: "Summer", autumn: "Autumn", winter: "Winter" }
};

const PHASE_COPY: Record<Language, { day: string; night: string }> = {
  ku: { day: "ڕۆژ", night: "شەو" },
  ar: { day: "نهار", night: "ليل" },
  en: { day: "Day", night: "Night" }
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
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function localeFor(language: Language): string {
  return language === "en" ? "en-US" : language === "ar" ? "ar-IQ" : "ckb-IQ";
}

function localMonth(timezone: string): number {
  try {
    const value = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "numeric" })
      .format(new Date());
    const month = Number(value);
    return Number.isInteger(month) && month >= 1 && month <= 12 ? month : new Date().getMonth() + 1;
  } catch {
    return new Date().getMonth() + 1;
  }
}

function seasonFor(latitude: number, timezone: string): { name: SeasonName; asset: string } {
  const month = localMonth(timezone);
  const northernMonth = latitude < 0 ? ((month + 5) % 12) + 1 : month;
  const name: SeasonName = northernMonth >= 3 && northernMonth <= 5
    ? "spring"
    : northernMonth >= 6 && northernMonth <= 8
      ? "summer"
      : northernMonth >= 9 && northernMonth <= 11
        ? "autumn"
        : "winter";
  return { name, asset: `${import.meta.env.BASE_URL}assets/weather/seasons/${name}.svg` };
}

function localTime(reading: WeatherReading, language: Language): string {
  try {
    return new Intl.DateTimeFormat(localeFor(language), {
      timeZone: reading.timezone,
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    const match = reading.observedAt.match(/T(\d{2}:\d{2})/u);
    return match?.[1] || "—:—";
  }
}

function weatherDetails(reading: WeatherReading, language: Language): WeatherFact[] {
  const number = new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 0 });
  const details: WeatherFact[] = [];
  if (reading.apparentTemperature !== null) {
    const prefix = language === "ku" ? "هەستپێکراو" : language === "ar" ? "المحسوسة" : "Feels";
    details.push({ icon: "temperature", value: `${prefix} ${number.format(reading.apparentTemperature)}°` });
  }
  if (reading.humidity !== null) details.push({ icon: "humidity", value: `${number.format(reading.humidity)}%` });
  if (reading.windSpeed !== null) details.push({ icon: "wind", value: `${number.format(reading.windSpeed)} km/h` });
  if (reading.dust !== null && reading.dust >= DUST_THRESHOLD) {
    details.push({ icon: "dust", value: `${number.format(reading.dust)} µg/m³` });
  }
  return details;
}

function weatherFact(asset: string, value: string): HTMLElement {
  const fact = document.createElement("span");
  const icon = document.createElement("img");
  icon.src = asset;
  icon.alt = "";
  icon.decoding = "async";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = value;
  fact.append(icon, label);
  return fact;
}

function coordinateKey([longitude, latitude]: LngLatTuple): string {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
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

function buildWeatherBadge(language: Language, meta: PlaceWeatherBadgeMeta = {}): HTMLElement {
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
  const phase = document.createElement("img");
  phase.className = "place-weather__phase";
  phase.alt = "";
  phase.decoding = "async";
  phase.setAttribute("aria-hidden", "true");
  phase.hidden = true;
  visual.append(loading, weatherImage, phase);

  const copyContainer = document.createElement("span");
  copyContainer.className = "place-weather__copy";

  const temperature = document.createElement("strong");
  temperature.textContent = "—";

  const condition = document.createElement("small");
  condition.className = "place-weather__condition";
  condition.textContent = copy.loading;

  const metaLine = document.createElement("small");
  metaLine.className = "place-weather__meta";
  metaLine.hidden = true;
  const factsLine = document.createElement("small");
  factsLine.className = "place-weather__facts";
  factsLine.hidden = true;
  copyContainer.append(temperature, condition, metaLine, factsLine);

  root.append(visual, copyContainer);

  if (meta.placeIconSrc) {
    const placeVisual = document.createElement("span");
    placeVisual.className = "place-weather__place";
    const label = meta.placeIconLabel?.trim() || "";
    if (label) placeVisual.title = label;

    const placeImage = document.createElement("img");
    placeImage.src = meta.placeIconSrc;
    placeImage.alt = label;
    placeImage.loading = "lazy";
    placeImage.decoding = "async";
    placeVisual.append(placeImage);
    root.append(placeVisual);
  }

  return root;
}

export class PlaceWeatherService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<WeatherReading>>();

  createBadge(coordinate: LngLatTuple, language: Language, meta: PlaceWeatherBadgeMeta = {}): HTMLElement {
    const root = buildWeatherBadge(language, meta);
    void this.populate(root, coordinate, language);
    return root;
  }

  private async populate(root: HTMLElement, coordinate: LngLatTuple, language: Language): Promise<void> {
    if (!validCoordinate(coordinate) || navigator.onLine === false) {
      root.remove();
      return;
    }

    try {
      const reading = await this.current(coordinate);
      if (!root.isConnected) return;
      const condition = weatherCondition(reading);
      const temperature = roundTemperature(reading.temperature, language);
      const conditionLabel = weatherConditionLabel(condition, reading.isDay, language);
      const season = seasonFor(coordinate[1], reading.timezone);
      const phaseLabel = PHASE_COPY[language][reading.isDay ? "day" : "night"];
      const timeLabel = localTime(reading, language);
      const seasonLabel = SEASON_COPY[language][season.name];
      const metaLabel = `${timeLabel} · ${phaseLabel} · ${seasonLabel}`;
      const details = weatherDetails(reading, language);
      const copy = UI_COPY[language];
      const image = root.querySelector<HTMLImageElement>(".place-weather__visual img");
      const loading = root.querySelector<HTMLElement>(".place-weather__loading");
      const phase = root.querySelector<HTMLImageElement>(".place-weather__phase");
      const temperatureElement = root.querySelector<HTMLElement>(".place-weather__copy strong");
      const conditionElement = root.querySelector<HTMLElement>(".place-weather__condition");
      const metaElement = root.querySelector<HTMLElement>(".place-weather__meta");
      const factsElement = root.querySelector<HTMLElement>(".place-weather__facts");
      if (!image || !loading || !phase || !temperatureElement || !conditionElement || !metaElement || !factsElement) return;

      image.src = weatherIconAsset(condition, reading.isDay);
      image.hidden = false;
      loading.hidden = true;
      phase.src = `${import.meta.env.BASE_URL}assets/weather/ui/${reading.isDay ? "day" : "night"}.svg`;
      phase.hidden = condition === "clear" || condition === "partly-cloudy";
      phase.dataset.phase = reading.isDay ? "day" : "night";
      temperatureElement.textContent = temperature;
      conditionElement.textContent = conditionLabel;
      metaElement.replaceChildren(
        weatherFact(`${import.meta.env.BASE_URL}assets/weather/ui/clock.svg`, timeLabel),
        weatherFact(`${import.meta.env.BASE_URL}assets/weather/ui/${reading.isDay ? "day" : "night"}.svg`, phaseLabel),
        weatherFact(season.asset, seasonLabel)
      );
      metaElement.hidden = false;
      factsElement.replaceChildren(...details.map((detail) => weatherFact(
        `${import.meta.env.BASE_URL}assets/weather/ui/${detail.icon}.svg`,
        detail.value
      )));
      factsElement.hidden = details.length === 0;
      root.dataset.state = "ready";
      root.dataset.phase = reading.isDay ? "day" : "night";
      root.dataset.season = season.name;
      root.setAttribute(
        "aria-label",
        `${copy.current}: ${temperature}. ${conditionLabel}. ${metaLabel}.${details.length > 0 ? ` ${details.map((detail) => detail.value).join(", ")}.` : ""}`
      );
      root.title = `${copy.current}: ${temperature} · ${conditionLabel} · ${metaLabel}${details.length > 0 ? ` · ${details.map((detail) => detail.value).join(" · ")}` : ""}`;
    } catch {
      if (root.isConnected) root.remove();
    }
  }

  private current(coordinate: LngLatTuple): Promise<WeatherReading> {
    const key = coordinateKey(coordinate);
    const cached = this.cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return Promise.resolve(cached.value);
    if (cached) this.cache.delete(key);

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const request = this.fetchCurrent(coordinate)
      .then((value) => {
        this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
        trimCache(this.cache);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  private async fetchCurrent([longitude, latitude]: LngLatTuple): Promise<WeatherReading> {
    const url = new URL(WEATHER_API_BASE_URL);
    url.searchParams.set("latitude", latitude.toFixed(5));
    url.searchParams.set("longitude", longitude.toFixed(5));
    url.searchParams.set(
      "current",
      "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m"
    );
    url.searchParams.set("temperature_unit", "celsius");
    url.searchParams.set("wind_speed_unit", "kmh");
    url.searchParams.set("timezone", "auto");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`Weather request failed with HTTP ${response.status}.`);
      const payload = await response.json() as OpenMeteoResponse;
      if (payload.available === false) throw new Error("Weather is temporarily unavailable.");
      const temperature = Number(payload.current?.temperature_2m);
      const weatherCode = Number(payload.current?.weather_code);
      const isDayValue = Number(payload.current?.is_day);
      if (!Number.isFinite(temperature) || !Number.isFinite(weatherCode) || !Number.isFinite(isDayValue)) {
        throw new Error("Weather response is missing current conditions.");
      }
      return {
        temperature,
        apparentTemperature: optionalNumber(payload.current?.apparent_temperature),
        weatherCode,
        isDay: isDayValue === 1,
        observedAt: typeof payload.current?.time === "string" ? payload.current.time : "",
        timezone: typeof payload.timezone === "string" && payload.timezone.trim()
          ? payload.timezone
          : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        timezoneAbbreviation: typeof payload.timezone_abbreviation === "string"
          ? payload.timezone_abbreviation
          : "",
        humidity: optionalNumber(payload.current?.relative_humidity_2m),
        precipitation: optionalNumber(payload.current?.precipitation),
        rain: optionalNumber(payload.current?.rain),
        showers: optionalNumber(payload.current?.showers),
        snowfall: optionalNumber(payload.current?.snowfall),
        cloudCover: optionalNumber(payload.current?.cloud_cover),
        windSpeed: optionalNumber(payload.current?.wind_speed_10m),
        windGusts: optionalNumber(payload.current?.wind_gusts_10m),
        dust: optionalNumber(payload.current?.dust),
        pm10: optionalNumber(payload.current?.pm10)
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
