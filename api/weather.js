const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const REQUEST_TIMEOUT_MS = 4500;
const AIR_QUALITY_TIMEOUT_MS = 3200;
const FRESH_TTL_MS = 10 * 60 * 1000;
const STALE_TTL_MS = 10 * 60 * 60 * 1000;
const CACHE_LIMIT = 320;
const RATE_LIMIT = 180;
const RATE_WINDOW_MS = 60 * 1000;

const cache = new Map();
const inflight = new Map();
const buckets = new Map();

function clientKey(request) {
  return String(request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "anonymous")
    .split(",")[0]
    .trim();
}

function allowRequest(request) {
  const now = Date.now();
  const key = clientKey(request);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  while (buckets.size > 512) buckets.delete(buckets.keys().next().value);
  return bucket.count <= RATE_LIMIT;
}

function parseCoordinate(value, minimum, maximum) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function coordinateKey(latitude, longitude) {
  return `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
}

function trimCache() {
  if (cache.size <= CACHE_LIMIT) return;
  const oldest = [...cache.entries()]
    .sort((a, b) => a[1].storedAt - b[1].storedAt)
    .slice(0, cache.size - CACHE_LIMIT);
  for (const [key] of oldest) cache.delete(key);
}

function finiteNumber(value) {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchAirQuality(latitude, longitude) {
  const url = new URL(OPEN_METEO_AIR_QUALITY_URL);
  url.searchParams.set("latitude", latitude.toFixed(5));
  url.searchParams.set("longitude", longitude.toFixed(5));
  url.searchParams.set("current", "dust,pm10");
  url.searchParams.set("timezone", "auto");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AIR_QUALITY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "NAV-KURD-Weather-Proxy/9.1.0" },
      cache: "no-store"
    });
    if (!response.ok) return { dust: null, pm10: null };
    const payload = await response.json();
    return {
      dust: finiteNumber(payload?.current?.dust),
      pm10: finiteNumber(payload?.current?.pm10)
    };
  } catch {
    return { dust: null, pm10: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchUpstream(latitude, longitude) {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set("latitude", latitude.toFixed(5));
  url.searchParams.set("longitude", longitude.toFixed(5));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m"
  );
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "auto");

  url.searchParams.set("hourly", "temperature_2m,weather_code,is_day,precipitation_probability,wind_speed_10m");
  url.searchParams.set("forecast_hours", "12");
  url.searchParams.set("timeformat", "unixtime");
  const airQualityPromise = fetchAirQuality(latitude, longitude);
  let lastError = null;
  for (let attempt = 0; attempt < 1; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json", "User-Agent": "NAV-KURD-Weather-Proxy/1.0" },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`weather-upstream-${response.status}`);
      const payload = await response.json();
      const current = payload?.current;
      const temperature = finiteNumber(current?.temperature_2m);
      const weatherCode = finiteNumber(current?.weather_code);
      const isDay = finiteNumber(current?.is_day);
      const observedAt = finiteNumber(current?.time);
      const validCodes = new Set([0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]);
      if (temperature === null || temperature < -90 || temperature > 65 || !validCodes.has(weatherCode)
        || (isDay !== 0 && isDay !== 1) || observedAt === null || observedAt <= 0
        || observedAt * 1000 > Date.now() + 3600000 || observedAt * 1000 < Date.now() - 10800000) {
        throw new Error("weather-invalid-payload");
      }
      const timezone = payload?.timezone;
      const utcOffset = finiteNumber(payload?.utc_offset_seconds);
      if (typeof timezone !== "string" || !timezone || utcOffset === null || Math.abs(utcOffset) > 50400) {
        throw new Error("weather-invalid-timezone");
      }
      try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(0); }
      catch { throw new Error("weather-invalid-timezone"); }
      const hourly = { time: [], temperature_2m: [], weather_code: [], is_day: [], precipitation_probability: [], wind_speed_10m: [] };
      for (let i = 0; i < Math.min(payload.hourly?.time?.length ?? 0, 24); i += 1) {
        const at = finiteNumber(payload.hourly.time[i]);
        const temp = finiteNumber(payload.hourly.temperature_2m?.[i]);
        const code = finiteNumber(payload.hourly.weather_code?.[i]);
        const day = finiteNumber(payload.hourly.is_day?.[i]);
        if (at === null || at * 1000 <= Date.now() || at * 1000 > Date.now() + 10 * 3600000
          || (hourly.time.length && at <= hourly.time.at(-1)) || temp === null || temp < -90 || temp > 65
          || !validCodes.has(code) || (day !== 0 && day !== 1)) continue;
        hourly.time.push(at); hourly.temperature_2m.push(temp); hourly.weather_code.push(code); hourly.is_day.push(day);
        const chance = finiteNumber(payload.hourly.precipitation_probability?.[i]);
        const wind = finiteNumber(payload.hourly.wind_speed_10m?.[i]);
        hourly.precipitation_probability.push(chance !== null && chance >= 0 && chance <= 100 ? chance : null);
        hourly.wind_speed_10m.push(wind !== null && wind >= 0 ? wind : null);
      }
      const airQuality = await airQualityPromise;
      return {
        current: {
          temperature_2m: temperature,
          weather_code: weatherCode,
          is_day: isDay,
          time: observedAt,
          relative_humidity_2m: finiteNumber(current?.relative_humidity_2m),
          apparent_temperature: finiteNumber(current?.apparent_temperature),
          precipitation: finiteNumber(current?.precipitation),
          rain: finiteNumber(current?.rain),
          showers: finiteNumber(current?.showers),
          snowfall: finiteNumber(current?.snowfall),
          cloud_cover: finiteNumber(current?.cloud_cover),
          wind_speed_10m: finiteNumber(current?.wind_speed_10m),
          wind_gusts_10m: finiteNumber(current?.wind_gusts_10m),
          dust: airQuality.dust,
          pm10: airQuality.pm10
        },
        timezone,
        timezone_abbreviation: typeof payload?.timezone_abbreviation === "string"
          ? payload.timezone_abbreviation
          : "",
        utc_offset_seconds: utcOffset,
        hourly,
        requested_location: { latitude, longitude },
        fetched_at: Date.now(),
        stale: false,
        provider: "Open-Meteo",
        available: true
      };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("weather-unavailable");
}

async function resolveWeather(latitude, longitude) {
  const key = coordinateKey(latitude, longitude);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.storedAt <= FRESH_TTL_MS) return { payload: cached.payload, cache: "hit" };

  let pending = inflight.get(key);
  if (!pending) {
    pending = fetchUpstream(latitude, longitude)
      .then((payload) => {
        cache.set(key, { payload, storedAt: Date.now() });
        trimCache();
        return payload;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }

  try {
    return { payload: await pending, cache: "miss" };
  } catch {
    if (cached && now - cached.storedAt <= STALE_TTL_MS) return { payload: { ...cached.payload, stale: true }, cache: "stale" };
    // Optional weather has an explicit unavailable state; never invent readings.
    return { payload: { available: false, current: null }, cache: "degraded" };
  }
}

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Vary", "Accept-Encoding");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.setHeader("Cache-Control", "no-store");
    response.status(405).end();
    return;
  }
  if (!allowRequest(request)) {
    response.setHeader("Retry-After", "60");
    response.setHeader("Cache-Control", "no-store");
    response.status(429).send(request.method === "HEAD" ? undefined : JSON.stringify({ available: false, current: null }));
    return;
  }

  const latitude = parseCoordinate(request.query?.latitude, -90, 90);
  const longitude = parseCoordinate(request.query?.longitude, -180, 180);
  if (latitude === null || longitude === null) {
    response.setHeader("Cache-Control", "no-store");
    response.status(400).send(request.method === "HEAD" ? undefined : JSON.stringify({ error: "invalid-coordinate" }));
    return;
  }

  const result = await resolveWeather(latitude, longitude);
  response.setHeader("X-NAV-KURD-Weather-Cache", result.cache);
  response.setHeader("Cache-Control", result.payload.available && result.cache !== "stale"
    ? "public, max-age=120, s-maxage=300" : "no-store");
  response.status(200).send(request.method === "HEAD" ? undefined : JSON.stringify(result.payload));
}
