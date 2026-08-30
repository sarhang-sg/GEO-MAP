const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const REQUEST_TIMEOUT_MS = 4500;
const AIR_QUALITY_TIMEOUT_MS = 3200;
const FRESH_TTL_MS = 10 * 60 * 1000;
const STALE_TTL_MS = 60 * 60 * 1000;
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
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function coordinateKey(latitude, longitude) {
  return `${latitude.toFixed(2)},${longitude.toFixed(2)}`;
}

function trimCache() {
  if (cache.size <= CACHE_LIMIT) return;
  const oldest = [...cache.entries()]
    .sort((a, b) => a[1].storedAt - b[1].storedAt)
    .slice(0, cache.size - CACHE_LIMIT);
  for (const [key] of oldest) cache.delete(key);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
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
      headers: { Accept: "application/json", "User-Agent": "NAV-KURD-Weather-Proxy/9.0.0" },
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

  const airQualityPromise = fetchAirQuality(latitude, longitude);
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
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
      if (temperature === null || weatherCode === null) throw new Error("weather-invalid-payload");
      const airQuality = await airQualityPromise;
      return {
        current: {
          temperature_2m: temperature,
          weather_code: weatherCode,
          is_day: Number(current?.is_day) === 1 ? 1 : 0,
          time: typeof current?.time === "string" ? current.time : new Date().toISOString(),
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
        timezone: typeof payload?.timezone === "string" ? payload.timezone : "UTC",
        timezone_abbreviation: typeof payload?.timezone_abbreviation === "string"
          ? payload.timezone_abbreviation
          : "",
        utc_offset_seconds: finiteNumber(payload?.utc_offset_seconds) ?? 0,
        available: true
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 180));
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
    if (cached && now - cached.storedAt <= STALE_TTL_MS) return { payload: cached.payload, cache: "stale" };
    // A successful same-origin response prevents an upstream 5xx from polluting
    // the browser console. The client simply omits the weather badge this time.
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
    response.status(200).send(request.method === "HEAD" ? undefined : JSON.stringify({ available: false, current: null }));
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
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=600, stale-while-revalidate=3600");
  response.status(200).send(request.method === "HEAD" ? undefined : JSON.stringify(result.payload));
}
