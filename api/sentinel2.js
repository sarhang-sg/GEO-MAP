const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";
const COVERAGE_BOUNDS = Object.freeze({ west: 41.285802647, south: 33.305386992, east: 46.348729776, north: 37.377264006 });
const MIN_ZOOM = 5;
const MAX_NATIVE_ZOOM = 13;
const DEFAULT_LOOKBACK_DAYS = 45;
const MIN_LOOKBACK_DAYS = 10;
const MAX_LOOKBACK_DAYS = 120;
const TILE_CACHE_LIMIT = 192;
const TILE_CACHE_TTL_MS = 30 * 60 * 1000;
const CLIENT_RATE_LIMIT = 180;
const CLIENT_RATE_WINDOW_MS = 60 * 1000;
const CLIENT_BUCKET_LIMIT = 512;
const MAX_UPSTREAM_CONCURRENCY = 6;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_MS = 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 22 * 1000;
const TRANSPARENT_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Avz7WQAAAABJRU5ErkJggg==", "base64"));

let tokenState = { value: "", expiresAt: 0 };
let tokenRequest = null;
const warmTileCache = new Map();
const clientBuckets = new Map();
const inFlightTiles = new Map();
let upstreamActive = 0;
const upstreamQueue = [];
let circuitState = { failures: 0, openUntil: 0 };
const metrics = { requests: 0, cacheHits: 0, coalesced: 0, rateLimited: 0, upstream: 0, upstreamFailures: 0 };

function env(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function normalizedOrigin(value) {
  if (!value) return "";
  try { return new URL(value).origin.toLowerCase(); } catch { return ""; }
}

function configuredSentinelOrigins() {
  return new Set(env("NAV_KURD_SENTINEL_ALLOWED_ORIGINS")
    .split(",")
    .map((value) => normalizedOrigin(value.trim()))
    .filter(Boolean));
}

function sameOriginRequestAllowed(request) {
  const requestOrigin = new URL(request.url).origin.toLowerCase();
  const allowed = configuredSentinelOrigins();
  allowed.add(requestOrigin);
  const canonicalOrigin = normalizedOrigin(env("NAV_KURD_CANONICAL_ORIGIN"));
  if (canonicalOrigin) allowed.add(canonicalOrigin);

  const fetchSite = (request.headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = normalizedOrigin(request.headers.get("origin"));
  if (origin) return allowed.has(origin);

  const referer = normalizedOrigin(request.headers.get("referer"));
  if (referer) return allowed.has(referer);

  if (fetchSite === "same-origin") return true;
  return env("NAV_KURD_ALLOW_ORIGINLESS_SENTINEL").toLowerCase() === "true";
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function parseTileRequest(request) {
  const url = new URL(request.url);
  const z = Number.parseInt(url.searchParams.get("z") ?? "", 10);
  const x = Number.parseInt(url.searchParams.get("x") ?? "", 10);
  const y = Number.parseInt(url.searchParams.get("y") ?? "", 10);
  if (![z, x, y].every(Number.isInteger)) return null;
  if (z < 0 || z > 22) return null;
  const edge = 2 ** z;
  if (x < 0 || y < 0 || x >= edge || y >= edge) return null;
  return { z, x, y };
}

function tileBounds(z, x, y) {
  const n = 2 ** z;
  const west = x / n * 360 - 180;
  const east = (x + 1) / n * 360 - 180;
  const north = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  const south = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
  return { west, south, east, north };
}

function intersectsCoverage(bounds) {
  return bounds.east >= COVERAGE_BOUNDS.west && bounds.west <= COVERAGE_BOUNDS.east && bounds.north >= COVERAGE_BOUNDS.south && bounds.south <= COVERAGE_BOUNDS.north;
}

function isoRange(lookbackDays) {
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function requestAccessToken(clientId, clientSecret, signal) {
  const now = Date.now();
  if (tokenState.value && tokenState.expiresAt - now > 60000) return tokenState.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
    const response = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal });
    if (!response.ok) throw new Error(`token-${response.status}`);
    const payload = await response.json();
    if (!payload || typeof payload.access_token !== "string" || !payload.access_token) throw new Error("token-invalid-response");
    const expiresIn = clampInteger(payload.expires_in, 60, 86400, 300);
    tokenState = { value: payload.access_token, expiresAt: Date.now() + expiresIn * 1000 };
    return tokenState.value;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}

function evalscript() {
  return `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B03", "B02", "SCL", "dataMask"] }],
    output: { bands: 3, sampleType: "AUTO" },
    mosaicking: "ORBIT"
  };
}
function isClear(sample) {
  return sample.dataMask === 1 && ![0, 1, 3, 7, 8, 9, 10].includes(sample.SCL);
}
function enhance(value) {
  var normalized = Math.max(0, Math.min(1, value * 2.55));
  return Math.pow(normalized, 0.90);
}
function render(sample) {
  return [enhance(sample.B04), enhance(sample.B03), enhance(sample.B02)];
}
function evaluatePixel(samples) {
  var fallback = null;
  for (var i = 0; i < samples.length; i++) {
    var sample = samples[i];
    if (sample.dataMask !== 1) continue;
    if (fallback === null) fallback = sample;
    if (isClear(sample)) return render(sample);
  }
  return fallback === null ? [0, 0, 0] : render(fallback);
}`;
}

function processBody(bounds, lookbackDays) {
  return {
    input: {
      bounds: { bbox: [bounds.west, bounds.south, bounds.east, bounds.north], properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
      data: [{
        type: "sentinel-2-l2a",
        dataFilter: { timeRange: isoRange(lookbackDays), mosaickingOrder: "mostRecent", maxCloudCoverage: 60 },
        processing: { upsampling: "BILINEAR", downsampling: "BILINEAR", harmonizeValues: true }
      }]
    },
    output: { width: 256, height: 256, responses: [{ identifier: "default", format: { type: "image/jpeg" } }] },
    evalscript: evalscript()
  };
}

function utcCacheDay() { return new Date().toISOString().slice(0, 10); }
function tileEtag(tile, lookbackDays, contentType) {
  const kind = contentType.includes("jpeg") ? "jpg" : "png";
  return `W/"nav-kurd-s2-${utcCacheDay()}-${lookbackDays}-${tile.z}-${tile.x}-${tile.y}-${kind}"`;
}

function imageHeaders(lookbackDays, contentType, cacheable = true, etag = "", cacheStatus = "miss") {
  const headers = new Headers({
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    "X-NAV-KURD-Satellite-Provider": "sentinel-2-l2a",
    "X-NAV-KURD-Satellite-Lookback-Days": String(lookbackDays),
    "X-NAV-KURD-Satellite-Native-Max-Zoom": String(MAX_NATIVE_ZOOM),
    "X-NAV-KURD-Satellite-Render": "jpeg-256-bilinear",
    "X-NAV-KURD-Satellite-Cache": cacheStatus,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Vary": "Origin, Referer"
  });
  if (etag) headers.set("ETag", etag);
  if (cacheable) {
    headers.set("Cache-Control", "public, max-age=21600, stale-while-revalidate=86400");
    headers.set("CDN-Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=2592000");
    headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800, stale-if-error=2592000");
  } else headers.set("Cache-Control", "no-store");
  return headers;
}

function transparentTile(tile, lookbackDays, request) {
  const etag = tileEtag(tile, lookbackDays, "image/png");
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: imageHeaders(lookbackDays, "image/png", true, etag, "revalidated") });
  return new Response(TRANSPARENT_PNG, { status: 200, headers: imageHeaders(lookbackDays, "image/png", true, etag, "transparent") });
}

function transparentFailureTile(tile, lookbackDays, code, retryAfter = "30") {
  const headers = imageHeaders(lookbackDays, "image/png", false, "", "degraded");
  headers.set("Cache-Control", "public, max-age=15, stale-while-revalidate=45");
  headers.set("CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  headers.set("Vercel-CDN-Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
  headers.set("Retry-After", retryAfter);
  headers.set("X-NAV-KURD-Satellite-Error", code);
  headers.set("X-NAV-KURD-Satellite-Tile", `${tile.z}/${tile.x}/${tile.y}`);
  // Return a valid transparent image instead of a 5xx response. The stable
  // MapTiler base remains visible and MapLibre does not flood the browser
  // console or toggle raster layers during an upstream outage.
  return new Response(TRANSPARENT_PNG, { status: 200, headers });
}

function requestClientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "anonymous";
}

function enforceClientRate(request) {
  const now = Date.now();
  const key = requestClientKey(request);
  let bucket = clientBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= CLIENT_RATE_WINDOW_MS) bucket = { startedAt: now, count: 0 };
  bucket.count += 1;
  clientBuckets.delete(key); clientBuckets.set(key, bucket);
  while (clientBuckets.size > CLIENT_BUCKET_LIMIT) clientBuckets.delete(clientBuckets.keys().next().value);
  return { allowed: bucket.count <= CLIENT_RATE_LIMIT, remaining: Math.max(0, CLIENT_RATE_LIMIT - bucket.count), resetSeconds: Math.max(1, Math.ceil((bucket.startedAt + CLIENT_RATE_WINDOW_MS - now) / 1000)) };
}

function withRateHeaders(response, rate) {
  const headers = new Headers(response.headers);
  headers.set("X-RateLimit-Limit", String(CLIENT_RATE_LIMIT));
  headers.set("X-RateLimit-Remaining", String(rate.remaining));
  headers.set("X-RateLimit-Reset", String(rate.resetSeconds));
  headers.set("X-NAV-KURD-Sentinel-Metrics", `r=${metrics.requests};h=${metrics.cacheHits};c=${metrics.coalesced};u=${metrics.upstream};f=${metrics.upstreamFailures}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function acquireUpstreamSlot() {
  if (upstreamActive < MAX_UPSTREAM_CONCURRENCY) { upstreamActive += 1; return; }
  await new Promise((resolve) => upstreamQueue.push(resolve));
  upstreamActive += 1;
}
function releaseUpstreamSlot() {
  upstreamActive = Math.max(0, upstreamActive - 1);
  const next = upstreamQueue.shift(); if (next) next();
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function circuitOpen() { return circuitState.openUntil > Date.now(); }
function recordUpstreamSuccess() { circuitState = { failures: 0, openUntil: 0 }; }
function recordUpstreamFailure() {
  const failures = circuitState.failures + 1;
  circuitState = { failures, openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_OPEN_MS : 0 };
}

function errorResponse(status, code, extraHeaders = {}) {
  return Response.json({ error: code }, { status, headers: {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Vary": "Origin, Referer",
    ...extraHeaders
  } });
}

function cacheKey(tile, lookbackDays) { return `${tile.z}/${tile.x}/${tile.y}/${lookbackDays}`; }
function readWarmTile(key) {
  const entry = warmTileCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { warmTileCache.delete(key); return null; }
  warmTileCache.delete(key); warmTileCache.set(key, entry); return entry.bytes;
}
function writeWarmTile(key, bytes) {
  warmTileCache.set(key, { bytes, expiresAt: Date.now() + TILE_CACHE_TTL_MS });
  while (warmTileCache.size > TILE_CACHE_LIMIT) {
    const oldest = warmTileCache.keys().next().value;
    if (oldest === undefined) break;
    warmTileCache.delete(oldest);
  }
}

async function fetchSentinelTile(key, bounds, lookbackDays, clientId, clientSecret) {
  if (circuitOpen()) throw new Error("sentinel-circuit-open");
  const existing = inFlightTiles.get(key);
  if (existing) { metrics.coalesced += 1; return existing; }
  const task = (async () => {
    await acquireUpstreamSlot();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort("upstream-timeout"), UPSTREAM_TIMEOUT_MS);
      try {
        const token = await requestAccessToken(clientId, clientSecret, controller.signal);
        let lastStatus = 0;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          metrics.upstream += 1;
          const upstream = await fetch(PROCESS_URL, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", "Accept": "image/jpeg" },
            body: JSON.stringify(processBody(bounds, lookbackDays)), signal: controller.signal
          });
          lastStatus = upstream.status;
          if (upstream.ok) {
            const contentType = upstream.headers.get("content-type") || "";
            if (!contentType.toLowerCase().includes("image/jpeg")) throw new Error("sentinel-upstream-content-type");
            const bytes = new Uint8Array(await upstream.arrayBuffer());
            writeWarmTile(key, bytes); recordUpstreamSuccess(); return bytes;
          }
          const diagnostic = (await upstream.text()).slice(0, 500);
          console.error(`[NAV KURD Sentinel-2] upstream ${upstream.status} attempt ${attempt + 1}: ${diagnostic}`);
          if (!(upstream.status === 429 || upstream.status >= 500) || attempt === 2) break;
          const retryAfter = Number.parseInt(upstream.headers.get("retry-after") || "", 10);
          await delay(Number.isFinite(retryAfter) ? Math.min(2000, retryAfter * 1000) : [250, 750, 1500][attempt]);
        }
        throw new Error(`sentinel-upstream-${lastStatus || "failed"}`);
      } finally { clearTimeout(timeout); }
    } catch (error) {
      metrics.upstreamFailures += 1; recordUpstreamFailure(); throw error;
    } finally { releaseUpstreamSlot(); inFlightTiles.delete(key); }
  })();
  inFlightTiles.set(key, task);
  return task;
}

async function handle(request) {
  metrics.requests += 1;
  if (request.method !== "GET" && request.method !== "HEAD") return errorResponse(405, "method-not-allowed");
  if (!sameOriginRequestAllowed(request)) return errorResponse(403, "sentinel-origin-not-allowed");

  const rate = enforceClientRate(request);
  if (!rate.allowed) {
    metrics.rateLimited += 1;
    const limitedTile = parseTileRequest(request);
    const lookbackDays = clampInteger(env("CDSE_SH_LOOKBACK_DAYS"), MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS);
    return withRateHeaders(limitedTile
      ? transparentFailureTile(limitedTile, lookbackDays, "client-rate-limit", String(rate.resetSeconds))
      : errorResponse(429, "client-rate-limit", { "Retry-After": String(rate.resetSeconds) }), rate);
  }
  let response;
  {
    const tile = parseTileRequest(request);
    if (!tile) response = errorResponse(400, "invalid-tile-coordinate");
    else {
      const lookbackDays = clampInteger(env("CDSE_SH_LOOKBACK_DAYS"), MIN_LOOKBACK_DAYS, MAX_LOOKBACK_DAYS, DEFAULT_LOOKBACK_DAYS);
      const bounds = tileBounds(tile.z, tile.x, tile.y);
      if (tile.z < MIN_ZOOM || tile.z > MAX_NATIVE_ZOOM || !intersectsCoverage(bounds)) response = transparentTile(tile, lookbackDays, request);
      else {
        const clientId = env("CDSE_SH_CLIENT_ID");
        const clientSecret = env("CDSE_SH_CLIENT_SECRET");
        if (!clientId || !clientSecret) response = transparentFailureTile(tile, lookbackDays, "sentinel-credentials-missing");
        else {
          const key = cacheKey(tile, lookbackDays);
          const etag = tileEtag(tile, lookbackDays, "image/jpeg");
          if (request.headers.get("if-none-match") === etag) response = new Response(null, { status: 304, headers: imageHeaders(lookbackDays, "image/jpeg", true, etag, "revalidated") });
          else {
            const warm = readWarmTile(key);
            if (warm) {
              metrics.cacheHits += 1;
              response = request.method === "HEAD"
                ? new Response(null, { status: 200, headers: imageHeaders(lookbackDays, "image/jpeg", true, etag, "warm") })
                : new Response(warm.slice(0), { status: 200, headers: imageHeaders(lookbackDays, "image/jpeg", true, etag, "warm") });
            } else if (circuitOpen()) response = transparentFailureTile(tile, lookbackDays, "sentinel-circuit-open", String(Math.max(1, Math.ceil((circuitState.openUntil - Date.now()) / 1000))));
            else {
              try {
                const bytes = await fetchSentinelTile(key, bounds, lookbackDays, clientId, clientSecret);
                response = request.method === "HEAD"
                  ? new Response(null, { status: 200, headers: imageHeaders(lookbackDays, "image/jpeg", true, etag, "upstream") })
                  : new Response(bytes.slice(0), { status: 200, headers: imageHeaders(lookbackDays, "image/jpeg", true, etag, "upstream") });
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(`[NAV KURD Sentinel-2] ${message}`);
                response = transparentFailureTile(tile, lookbackDays, message.startsWith("sentinel-") ? message : "sentinel-request-failed");
              }
            }
          }
        }
      }
    }
  }
  return withRateHeaders(response, rate);
}

export default { fetch: handle };
