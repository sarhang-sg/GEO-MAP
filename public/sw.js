/* Build placeholders are replaced in dist/sw.js by tools/build/build-offline-runtime.mjs. */
const RELEASE_ID = "__KRI_RELEASE_ID__";
const CACHE_SCHEMA = "__KRI_CACHE_SCHEMA__";
const MAP_DATA_VERSION = "__KRI_MAP_DATA_VERSION__";
const OFFLINE_PACK_VERSION = "__KRI_OFFLINE_PACK_VERSION__";
const CACHE_PREFIX = "nav-kurd-";
const OWNED_CACHE_PREFIXES = [CACHE_PREFIX, "kri-map-", "geo-map-"];
const SHELL_CACHE = `${CACHE_PREFIX}shell-s${CACHE_SCHEMA}-${RELEASE_ID}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-s${CACHE_SCHEMA}-${RELEASE_ID}`;
const DATA_CACHE = `${CACHE_PREFIX}data-s${CACHE_SCHEMA}-${MAP_DATA_VERSION}`;
const SATELLITE_CACHE = `${CACHE_PREFIX}satellite-s${CACHE_SCHEMA}`;
const SATELLITE_CACHE_LIMIT = 256;
const RUNTIME_CACHE_LIMIT = 320;
const TRANSPARENT_TILE_BYTES = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Avz7WQAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0));
const BASE = self.registration.scope;
const BACKGROUND_SYNC_TAG = "nav-kurd-runtime-sync";
const PERIODIC_SYNC_TAG = "nav-kurd-periodic-refresh";
const WIDGET_TAG = "nav-kurd-atlas";
const OFFLINE_FALLBACK_PATH = "offline.html";
const OFFLINE_READY_MARKER_PATH = "__nav-kurd-offline-pack-ready__.json";
const NETWORK_TIMEOUT_MS = 8_000;
const VERSIONED_DATA_TIMEOUT_MS = 45_000;
const INSTALL_FETCH_TIMEOUT_MS = 12_000;
const PRECACHE = __KRI_PRECACHE__;
const REQUIRED_SHELL_PATHS = new Set(
  PRECACHE
    .filter((entry) => entry.required === true && typeof entry.path === "string")
    .map((entry) => new URL(entry.path.replace(/^\//, ""), self.registration.scope).pathname)
);
let offlineRuntimeAborter = null;

const absolute = (path) => new URL(path.replace(/^\//, ""), BASE).toString();
const isSameOrigin = (request) => new URL(request.url).origin === self.location.origin;
const workerIsOffline = () => self.navigator?.onLine === false;

async function fetchWithTimeout(input, init = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const timeoutController = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => timeoutController.abort(upstreamSignal?.reason);
  if (upstreamSignal) {
    if (upstreamSignal.aborted) abortFromUpstream();
    else upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }
  const timer = setTimeout(() => timeoutController.abort(new DOMException("Network timeout", "TimeoutError")), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: timeoutController.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
  }
}
const isPmtilesRequest = (request) => {
  const url = new URL(request.url);
  return url.pathname.endsWith(".pmtiles") || request.headers.has("range");
};
const isHashedBuildAsset = (url) => /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(?:js|css)$/.test(url.pathname);
const isRequiredShellAsset = (url) => REQUIRED_SHELL_PATHS.has(url.pathname);
const isStaticVisualAsset = (url) => /\/(?:icons|fonts)\//.test(url.pathname) || /\.(?:png|jpe?g|webp|svg|woff2?|ttf|webmanifest)$/.test(url.pathname);
const isVersionedDataAsset = (url) => url.pathname.includes("/data/kri/") && !url.pathname.endsWith(".pmtiles");
const isSentinelTileRequest = (url) => url.pathname.endsWith("/api/sentinel2") && url.searchParams.has("z") && url.searchParams.has("x") && url.searchParams.has("y");
const isMapTilerSatelliteRequest = (url) => url.origin === "https://api.maptiler.com" && /^\/tiles\/satellite-v2\/\d+\/\d+\/\d+\.jpg$/u.test(url.pathname);

function offlineFailureResponse(request, message = "Resource unavailable while offline") {
  const url = new URL(request.url);
  const jsonLike = /\.(?:json|geojson)$/u.test(url.pathname) || request.headers.get("accept")?.includes("application/json");
  return new Response(jsonLike ? JSON.stringify({ error: message }) : message, {
    status: 504,
    statusText: "Offline Gateway Timeout",
    headers: {
      "Content-Type": jsonLike ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-NAV-KURD-Offline": "1"
    }
  });
}

async function cacheEntry(cache, path, required, signal = undefined) {
  try {
    const response = await fetchWithTimeout(absolute(path), { cache: "reload", credentials: "same-origin", signal }, INSTALL_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      if (required) throw new Error(`Required offline asset failed: ${path}`);
      return false;
    }
    await cache.put(absolute(path), response.clone());
    return true;
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) throw error;
    if (required) throw error;
    return false;
  }
}

async function runBounded(entries, concurrency, worker) {
  let cursor = 0;
  const results = new Array(entries.length);
  const runners = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor++;
      results[index] = await worker(entries[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function installRequiredShell() {
  const cache = await caches.open(SHELL_CACHE);
  const entries = PRECACHE.filter((item) => item.required);
  try {
    await runBounded(entries, 3, (entry) => cacheEntry(cache, entry.path, true));
  } catch (error) {
    // Never leave a partially installed candidate cache behind. The previous
    // active worker remains intact and the browser can retry this release later.
    await caches.delete(SHELL_CACHE);
    throw error;
  }
}

async function warmOptionalShell() {
  const cache = await caches.open(SHELL_CACHE);
  const entries = PRECACHE.filter((item) => !item.required && item.warm !== false);
  const results = await runBounded(entries, 4, (entry) => cacheEntry(cache, entry.path, false));
  return results.filter(Boolean).length;
}

function normalizedLanguage(value) {
  return ["ku", "ar", "en"].includes(value) ? value : "ku";
}

function offlineRuntimeEntries(language = "ku") {
  const selected = normalizedLanguage(language);
  return PRECACHE.filter((entry) => entry.offlineRuntime === true && (!entry.language || entry.language === selected));
}

function languageAssetEntries(language = "ku", assetKind = "all") {
  const selected = normalizedLanguage(language);
  return PRECACHE.filter((entry) => entry.language === selected
    && entry.languageAsset
    && (assetKind === "all" || entry.languageAsset === assetKind));
}

async function inspectLanguageAssets(cache, language = "ku", assetKind = "all") {
  const selected = normalizedLanguage(language);
  const entries = languageAssetEntries(selected, assetKind);
  let cachedEntries = 0;
  const missing = [];
  for (const entry of entries) {
    if (await cache.match(absolute(entry.path))) cachedEntries += 1;
    else missing.push(entry);
  }
  return {
    language: selected,
    cached: entries.length > 0 && cachedEntries === entries.length,
    cachedEntries,
    totalEntries: entries.length,
    missing
  };
}

async function inspectOfflineRuntime(cache, entries = offlineRuntimeEntries("ku")) {
  let cachedBytes = 0;
  let cachedEntries = 0;
  const missing = [];
  for (const entry of entries) {
    const cached = await cache.match(absolute(entry.path));
    if (cached) {
      cachedEntries += 1;
      cachedBytes += Number(entry.bytes) || 0;
    } else {
      missing.push(entry);
    }
  }
  return {
    cachedBytes,
    totalBytes: entries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0),
    cachedEntries,
    totalEntries: entries.length,
    missing
  };
}

async function readOfflineRuntimeMarker(cache) {
  const response = await cache.match(absolute(OFFLINE_READY_MARKER_PATH));
  if (!response) return null;
  try {
    const marker = await response.json();
    if (marker?.release !== RELEASE_ID
      || marker?.mapDataVersion !== MAP_DATA_VERSION
      || marker?.offlinePackVersion !== OFFLINE_PACK_VERSION) return null;
    if (marker.schema === 1
      && Array.isArray(marker.preparedLanguages)
      && marker.languages
      && typeof marker.languages === "object") return marker;
  } catch { /* invalid marker is treated as absent */ }
  return null;
}

async function writeOfflineRuntimeMarker(cache, marker) {
  const url = absolute(OFFLINE_READY_MARKER_PATH);
  if (!marker || marker.preparedLanguages.length === 0) {
    await cache.delete(url);
    return;
  }
  await cache.put(url, new Response(JSON.stringify(marker), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  }));
}

async function hasOfflineRuntimeMarker(language = null) {
  const cache = await caches.open(DATA_CACHE);
  const marker = await readOfflineRuntimeMarker(cache);
  if (!marker) return false;
  const selectedLanguages = language === null ? marker.preparedLanguages : [normalizedLanguage(language)];
  if (selectedLanguages.length === 0) return false;
  for (const selected of selectedLanguages) {
    if (!marker.preparedLanguages.includes(selected)) continue;
    const state = await inspectOfflineRuntime(cache, offlineRuntimeEntries(selected));
    const saved = marker.languages[selected];
    if (saved
      && saved.cachedBytes === state.totalBytes
      && saved.cachedEntries === state.totalEntries
      && state.cachedBytes === state.totalBytes
      && state.cachedEntries === state.totalEntries) return true;
  }
  return false;
}

async function setOfflineRuntimeMarker(ready, state = null, language = "ku") {
  const selected = normalizedLanguage(language);
  const cache = await caches.open(DATA_CACHE);
  const currentMarker = await readOfflineRuntimeMarker(cache);
  const marker = currentMarker ?? {
    schema: 1,
    release: RELEASE_ID,
    mapDataVersion: MAP_DATA_VERSION,
    offlinePackVersion: OFFLINE_PACK_VERSION,
    preparedLanguages: [],
    languages: {}
  };
  marker.preparedLanguages = marker.preparedLanguages.filter((entry) => entry !== selected);
  delete marker.languages[selected];
  if (ready) {
    const current = state ?? await inspectOfflineRuntime(cache, offlineRuntimeEntries(selected));
    marker.preparedLanguages.push(selected);
    marker.preparedLanguages.sort();
    marker.languages[selected] = {
      cachedBytes: current.cachedBytes,
      cachedEntries: current.cachedEntries,
      cachedAt: new Date().toISOString()
    };
  }
  await writeOfflineRuntimeMarker(cache, marker);
}

async function clearOfflineRuntimeMarker() {
  const cache = await caches.open(DATA_CACHE);
  await cache.delete(absolute(OFFLINE_READY_MARKER_PATH));
}

async function warmFullOfflineRuntime(reply, signal, language = "ku") {
  const selected = normalizedLanguage(language);
  const entries = offlineRuntimeEntries(selected);
  const cache = await caches.open(DATA_CACHE);
  let state = await inspectOfflineRuntime(cache, entries);
  await setOfflineRuntimeMarker(false, null, selected);
  reply({ type: "progress", ...state });

  await runBounded(state.missing, 2, async (entry) => {
    signal.throwIfAborted();
    const cached = await cacheEntry(cache, entry.path, false, signal);
    if (cached) {
      state.cachedEntries += 1;
      state.cachedBytes += Number(entry.bytes) || 0;
      reply({ type: "progress", cachedBytes: state.cachedBytes, totalBytes: state.totalBytes, cachedEntries: state.cachedEntries, totalEntries: state.totalEntries });
    }
    return cached;
  });

  state = await inspectOfflineRuntime(cache, entries);
  const complete = state.totalEntries > 0 && state.cachedEntries === state.totalEntries && state.cachedBytes === state.totalBytes;
  await setOfflineRuntimeMarker(complete, state, selected);
  return { ok: complete, cachedBytes: state.cachedBytes, totalBytes: state.totalBytes, cachedEntries: state.cachedEntries, totalEntries: state.totalEntries };
}

async function cancelFullOfflineRuntime() {
  offlineRuntimeAborter?.abort(new DOMException("Offline runtime download paused", "AbortError"));
  offlineRuntimeAborter = null;
}

async function clearFullOfflineRuntime() {
  const cache = await caches.open(DATA_CACHE);
  const entries = PRECACHE.filter((entry) => entry.offlineRuntime === true);
  await Promise.all(entries.map((entry) => cache.delete(absolute(entry.path))));
  await clearOfflineRuntimeMarker();
}

async function deleteOldCaches() {
  const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, DATA_CACHE, SATELLITE_CACHE]);
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => OWNED_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) && !keep.has(key))
    .map((key) => caches.delete(key)));
}

async function notifyClients(type, detail = {}) {
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) client.postMessage({ type, ...detail });
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  if (!workerIsOffline()) {
    try {
      const response = await fetchWithTimeout(request, { cache: "no-store" });
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch { /* Cache fallback below. */ }
  }
  return (await cache.match(request)) || (fallbackUrl ? await caches.match(fallbackUrl) : undefined) || offlineFailureResponse(request);
}

async function offlineNavigation(event) {
  const request = event.request;
  const runtime = await caches.open(RUNTIME_CACHE);
  if (!workerIsOffline()) {
    try {
      // Navigation preload starts in parallel with worker boot. Consume it
      // before issuing a fallback fetch so one navigation never creates two
      // competing network requests.
      const preloaded = await event.preloadResponse;
      if (preloaded) {
        if (preloaded.ok) await runtime.put(request, preloaded.clone());
        return preloaded;
      }
      const response = await fetchWithTimeout(request, { cache: "no-store" }, NETWORK_TIMEOUT_MS);
      if (response.ok) await runtime.put(request, response.clone());
      return response;
    } catch { /* Deterministic offline response below. */ }
  }
  if (await hasOfflineRuntimeMarker(null)) {
    return (await caches.match(absolute("index.html"))) || (await caches.match(absolute(OFFLINE_FALLBACK_PATH))) || offlineFailureResponse(request);
  }
  return (await caches.match(absolute(OFFLINE_FALLBACK_PATH))) || (await caches.match(absolute("index.html"))) || offlineFailureResponse(request);
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  if (workerIsOffline()) return offlineFailureResponse(request);
  try {
    const response = await fetchWithTimeout(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || offlineFailureResponse(request);
  }
}

function canonicalDataUrl(request) {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function cacheFirstVersionedData(request) {
  const cache = await caches.open(DATA_CACHE);
  const key = canonicalDataUrl(request);
  const cached = (await cache.match(key)) || (await cache.match(request));
  if (cached) return cached;
  if (workerIsOffline()) return offlineFailureResponse(request);

  try {
    // Language/property packs are immutable and can exceed one MiB. A short API
    // timeout used to abort valid mobile downloads and reject the FetchEvent.
    const response = await fetchWithTimeout(
      request,
      { cache: "no-store", credentials: "same-origin" },
      VERSIONED_DATA_TIMEOUT_MS
    );
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    // A FetchEvent must always resolve with a Response. Recheck the cache in
    // case another tab completed the same immutable request while this one ran.
    return (await cache.match(key)) || (await cache.match(request)) || offlineFailureResponse(request);
  }
}

async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function staleWhileRevalidate(request, cacheName, limit = 0, lifetimeEvent = null) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (workerIsOffline()) return cached || offlineFailureResponse(request);
  const network = fetchWithTimeout(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
        if (limit > 0) await trimCache(cache, limit);
      }
      return response;
    })
    .catch(() => undefined);
  if (cached && lifetimeEvent) lifetimeEvent.waitUntil(network.then(() => undefined));
  return cached || (await network) || offlineFailureResponse(request);
}

async function cacheFirstVisual(request, lifetimeEvent = null) {
  const [shell, runtime] = await Promise.all([caches.open(SHELL_CACHE), caches.open(RUNTIME_CACHE)]);
  const cached = (await shell.match(request)) || (await runtime.match(request));
  if (cached) return cached;
  if (workerIsOffline()) return offlineFailureResponse(request);
  try {
    // Visual assets are immutable and browser-cacheable. Do not impose the
    // general 4.5-second API timeout on fonts/icons over constrained mobile links.
    const response = await fetch(request, { cache: "force-cache", credentials: "same-origin" });
    if (response.ok) {
      const write = runtime.put(request, response.clone()).then(() => trimCache(runtime, RUNTIME_CACHE_LIMIT));
      if (lifetimeEvent) lifetimeEvent.waitUntil(write);
      else await write;
    }
    return response;
  } catch {
    return offlineFailureResponse(request);
  }
}

function satelliteCacheRequest(request) {
  const url = new URL(request.url);
  url.searchParams.delete("key");
  return new Request(url.toString(), { method: "GET", mode: "no-cors", credentials: "omit", referrerPolicy: "no-referrer" });
}

function transparentSatelliteTile() {
  return new Response(TRANSPARENT_TILE_BYTES.slice(0), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-NAV-KURD-Satellite-Cache": "offline-transparent"
    }
  });
}

async function cachedMapTilerSatellite(request, lifetimeEvent = null) {
  const cache = await caches.open(SATELLITE_CACHE);
  const key = satelliteCacheRequest(request);
  const cached = await cache.match(key);
  if (workerIsOffline()) return cached || transparentSatelliteTile();
  const network = fetchWithTimeout(request)
    .then(async (response) => {
      if (response.ok || response.type === "opaque") {
        await cache.put(key, response.clone());
        await trimCache(cache, SATELLITE_CACHE_LIMIT);
      }
      return response;
    })
    .catch(() => undefined);
  if (cached && lifetimeEvent) lifetimeEvent.waitUntil(network.then(() => undefined));
  return cached || (await network) || transparentSatelliteTile();
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await installRequiredShell();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await deleteOldCaches();
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch { /* optional capability */ }
    }
    await self.clients.claim();
    await updateNavKurdWidgets();
    await notifyClients("NAV_KURD_SW_ACTIVATED", {
      release: RELEASE_ID,
      mapDataVersion: MAP_DATA_VERSION,
      cacheSchema: CACHE_SCHEMA,
      offlinePackVersion: OFFLINE_PACK_VERSION
    });
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const reply = (payload) => event.ports?.[0]?.postMessage(payload);

  if (data.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
    return;
  }

  if (data.type === "GET_RUNTIME_INFO") {
    reply({
      release: RELEASE_ID,
      mapDataVersion: MAP_DATA_VERSION,
      cacheSchema: CACHE_SCHEMA,
      offlinePackVersion: OFFLINE_PACK_VERSION,
      shellCache: SHELL_CACHE,
      runtimeCache: RUNTIME_CACHE,
      dataCache: DATA_CACHE
    });
    return;
  }

  if (data.type === "CLEAR_RUNTIME_CACHES") {
    event.waitUntil((async () => {
      await Promise.all([caches.delete(RUNTIME_CACHE), caches.delete(DATA_CACHE), caches.delete(SATELLITE_CACHE)]);
      reply({ ok: true });
    })());
    return;
  }

  if (data.type === "MAINTAIN_RUNTIME_CACHES") {
    event.waitUntil((async () => {
      await deleteOldCaches();
      const inactiveForMs = Math.max(0, Number(data.inactiveForMs) || 0);
      if (inactiveForMs >= 10 * 60 * 1000) {
        const [runtime, satellite] = await Promise.all([
          caches.open(RUNTIME_CACHE),
          caches.open(SATELLITE_CACHE)
        ]);
        await Promise.all([
          trimCache(runtime, RUNTIME_CACHE_LIMIT),
          trimCache(satellite, SATELLITE_CACHE_LIMIT)
        ]);
      }
      reply({ ok: true, release: RELEASE_ID, cacheSchema: CACHE_SCHEMA, inactiveForMs });
    })());
    return;
  }

  if (data.type === "WARM_OFFLINE_SHELL") {
    event.waitUntil((async () => {
      const cached = await warmOptionalShell();
      reply({ ok: true, cached });
    })());
    return;
  }

  if (data.type === "WARM_OFFLINE_RUNTIME") {
    event.waitUntil((async () => {
      await cancelFullOfflineRuntime();
      const controller = new AbortController();
      const language = normalizedLanguage(data.language);
      offlineRuntimeAborter = controller;
      try {
        const result = await warmFullOfflineRuntime(reply, controller.signal, language);
        reply({ type: "complete", ...result });
      } catch (error) {
        const cache = await caches.open(DATA_CACHE);
        const state = await inspectOfflineRuntime(cache, offlineRuntimeEntries(language));
        const cancelled = error?.name === "AbortError";
        reply({
          type: "complete",
          ok: false,
          cancelled,
          reason: cancelled ? "cancelled" : (error?.message || "runtime-cache-write-failed"),
          missingPaths: state.missing.map((entry) => entry.path),
          cachedBytes: state.cachedBytes,
          totalBytes: state.totalBytes,
          cachedEntries: state.cachedEntries,
          totalEntries: state.totalEntries
        });
      } finally {
        if (offlineRuntimeAborter === controller) offlineRuntimeAborter = null;
      }
    })());
    return;
  }

  if (data.type === "CANCEL_OFFLINE_RUNTIME") {
    event.waitUntil((async () => { await cancelFullOfflineRuntime(); reply({ ok: true, cancelled: true }); })());
    return;
  }

  if (data.type === "CLEAR_OFFLINE_RUNTIME") {
    event.waitUntil((async () => { await cancelFullOfflineRuntime(); await clearFullOfflineRuntime(); reply({ ok: true }); })());
    return;
  }

  if (data.type === "CHECK_OFFLINE_RUNTIME") {
    event.waitUntil((async () => {
      const language = normalizedLanguage(data.language);
      const cache = await caches.open(DATA_CACHE);
      const state = await inspectOfflineRuntime(cache, offlineRuntimeEntries(language));
      const markerValid = await hasOfflineRuntimeMarker(language);
      const entriesComplete = state.totalEntries > 0
        && state.cachedEntries === state.totalEntries
        && state.cachedBytes === state.totalBytes;
      reply({
        ok: markerValid && entriesComplete,
        language,
        reason: !entriesComplete ? "runtime-assets-missing" : !markerValid ? "runtime-marker-missing" : "ready",
        missingPaths: state.missing.map((entry) => entry.path),
        ...state
      });
    })());
    return;
  }

  if (data.type === "CHECK_LANGUAGE_ASSETS") {
    event.waitUntil((async () => {
      const language = normalizedLanguage(data.language);
      const assetKind = data.assetKind === "search" ? "search" : "properties";
      const cache = await caches.open(DATA_CACHE);
      const state = await inspectLanguageAssets(cache, language, assetKind);
      reply({ ok: true, assetKind, ...state });
    })());
    return;
  }

  if (data.type === "WARM_LANGUAGE_SEARCH") {
    event.waitUntil((async () => {
      const language = normalizedLanguage(data.language);
      const cache = await caches.open(DATA_CACHE);
      let state = await inspectLanguageAssets(cache, language, "search");
      if (state.missing.length > 0) {
        await runBounded(state.missing, 2, (entry) => cacheEntry(cache, entry.path, false));
        state = await inspectLanguageAssets(cache, language, "search");
      }
      reply({ ok: state.cached, assetKind: "search", ...state });
    })());
    return;
  }
});


async function refreshResilienceData() {
  const cached = await warmOptionalShell();
  await notifyClients("NAV_KURD_BACKGROUND_REFRESH", { cached, release: RELEASE_ID });
  return cached;
}

function safeNotificationUrl(value) {
  try {
    const url = new URL(value || "", BASE);
    return url.origin === self.location.origin ? url.toString() : BASE;
  } catch {
    return BASE;
  }
}

function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch {
    try { return { body: event.data.text() }; } catch { return {}; }
  }
}

async function focusOrOpenClient(targetUrl) {
  const target = safeNotificationUrl(targetUrl);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (new URL(client.url).origin !== self.location.origin) continue;
    if ("focus" in client) {
      await client.focus();
      if ("navigate" in client && client.url !== target) await client.navigate(target);
      return;
    }
  }
  await self.clients.openWindow(target);
}

async function renderWidget(widget) {
  if (!self.widgets || !widget?.definition || widget.definition.tag !== WIDGET_TAG) return;
  const templateUrl = widget.definition.msAcTemplate;
  const dataUrl = widget.definition.data;
  if (!templateUrl || !dataUrl) return;
  const [templateResponse, dataResponse] = await Promise.all([fetch(templateUrl), fetch(dataUrl)]);
  if (!templateResponse.ok || !dataResponse.ok) return;
  const [template, data] = await Promise.all([templateResponse.text(), dataResponse.text()]);
  await self.widgets.updateByTag(widget.definition.tag, { template, data });
}

async function updateNavKurdWidgets() {
  if (!self.widgets?.getByTag) return;
  const widget = await self.widgets.getByTag(WIDGET_TAG);
  if (widget) await renderWidget(widget);
}

async function installNavKurdWidget(widget) {
  if (!widget?.definition || widget.definition.tag !== WIDGET_TAG) return;
  if (self.registration.periodicSync && Number.isFinite(widget.definition.update)) {
    try {
      const tags = await self.registration.periodicSync.getTags();
      if (!tags.includes(WIDGET_TAG)) {
        await self.registration.periodicSync.register(WIDGET_TAG, { minInterval: widget.definition.update * 1000 });
      }
    } catch {
      // Widget rendering still works when periodic sync is unsupported or denied.
    }
  }
  await renderWidget(widget);
}

async function uninstallNavKurdWidget(widget) {
  if (!widget?.definition || widget.definition.tag !== WIDGET_TAG || !self.registration.periodicSync) return;
  if (widget.instances?.length === 1) {
    try { await self.registration.periodicSync.unregister(WIDGET_TAG); } catch { /* optional capability */ }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag !== BACKGROUND_SYNC_TAG) return;
  event.waitUntil(refreshResilienceData());
});

self.addEventListener("periodicsync", (event) => {
  if (event.tag === PERIODIC_SYNC_TAG) {
    event.waitUntil(refreshResilienceData());
    return;
  }
  if (event.tag === WIDGET_TAG) event.waitUntil(updateNavKurdWidgets());
});

self.addEventListener("push", (event) => {
  const payload = readPushPayload(event);
  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "NAV KURD";
  const body = typeof payload.body === "string" ? payload.body : "NAV KURD";
  const targetUrl = safeNotificationUrl(payload.url);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: absolute("icons/nav-kurd-icon-192.png"),
    badge: absolute("icons/favicon-32x32.png"),
    tag: typeof payload.tag === "string" ? payload.tag : "nav-kurd-update",
    renotify: false,
    data: { url: targetUrl }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(focusOrOpenClient(event.notification.data?.url));
});

self.addEventListener("widgetinstall", (event) => {
  if (event.widget?.definition?.tag !== WIDGET_TAG) return;
  event.waitUntil(Promise.all([refreshResilienceData(), installNavKurdWidget(event.widget)]));
});

self.addEventListener("widgetuninstall", (event) => {
  if (event.widget?.definition?.tag !== WIDGET_TAG) return;
  event.waitUntil(uninstallNavKurdWidget(event.widget));
});

self.addEventListener("widgetresume", (event) => {
  if (event.widget?.definition?.tag !== WIDGET_TAG) return;
  event.waitUntil(renderWidget(event.widget));
});

self.addEventListener("widgetclick", (event) => {
  if (event.widget?.definition?.tag !== WIDGET_TAG) return;
  event.waitUntil(focusOrOpenClient(BASE));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || isPmtilesRequest(request)) return;

  const url = new URL(request.url);
  if (isMapTilerSatelliteRequest(url)) {
    event.respondWith(cachedMapTilerSatellite(request, event));
    return;
  }
  if (!isSameOrigin(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(offlineNavigation(event));
    return;
  }

  if (url.pathname.endsWith("/offline-manifest.json")) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  if (isRequiredShellAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isSentinelTileRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, SATELLITE_CACHE, SATELLITE_CACHE_LIMIT, event));
    return;
  }

  if (isHashedBuildAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  if (isVersionedDataAsset(url)) {
    event.respondWith(cacheFirstVersionedData(request));
    return;
  }

  if (isStaticVisualAsset(url)) {
    event.respondWith(cacheFirstVisual(request, event));
    return;
  }

  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});
