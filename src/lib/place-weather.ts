import type { LngLatTuple } from "./location";
import type { Language } from "./types";
import { absoluteAppUrl, safeUrl } from "./app-url";

const DEFAULT_WEATHER_API_BASE_URL = absoluteAppUrl("api/weather");
const configuredWeatherUrl = import.meta.env.VITE_KRI_WEATHER_API_BASE_URL?.trim() ?? "";
const WEATHER_API_BASE_URL = safeUrl(configuredWeatherUrl)?.protocol === "https:"
  ? configuredWeatherUrl
  : DEFAULT_WEATHER_API_BASE_URL;
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
  available?: boolean;
  current?: {
    temperature_2m?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
    wind_speed_10m?: unknown;
    wind_gusts_10m?: unknown;
    dust?: unknown;
  };
};

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
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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

  return root;
}

export class PlaceWeatherService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<WeatherReading>>();

  createBadge(coordinate: LngLatTuple, language: Language): HTMLElement {
    const root = buildWeatherBadge(language);
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
      const copy = UI_COPY[language];
      const image = root.querySelector<HTMLImageElement>(".place-weather__visual img");
      const loading = root.querySelector<HTMLElement>(".place-weather__loading");
      const temperatureElement = root.querySelector<HTMLElement>(".place-weather__copy strong");
      const conditionElement = root.querySelector<HTMLElement>(".place-weather__condition");
      if (!image || !loading || !temperatureElement || !conditionElement) return;

      image.src = weatherIconAsset(condition, reading.isDay);
      image.hidden = false;
      loading.hidden = true;
      temperatureElement.textContent = temperature;
      conditionElement.textContent = conditionLabel;
      root.dataset.state = "ready";
      root.dataset.phase = reading.isDay ? "day" : "night";
      root.setAttribute("aria-label", `${copy.current}: ${temperature}. ${conditionLabel}.`);
      root.title = `${copy.current}: ${temperature} · ${conditionLabel}`;
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
      "temperature_2m,is_day,weather_code,wind_speed_10m,wind_gusts_10m"
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
        weatherCode,
        isDay: isDayValue === 1,
        windSpeed: optionalNumber(payload.current?.wind_speed_10m),
        windGusts: optionalNumber(payload.current?.wind_gusts_10m),
        dust: optionalNumber(payload.current?.dust)
      };
    } finally {
      window.clearTimeout(timeout);
    }
  }
}
