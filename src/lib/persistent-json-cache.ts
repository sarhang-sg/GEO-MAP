import { ServiceError, isAbortError } from "./service-state";

const inFlightJson = new Map<string, Promise<unknown>>();

function canReadServiceWorkerCache(): boolean {
  return typeof caches !== "undefined" && typeof Request !== "undefined";
}

function jsonRequest(resource: string, signal?: AbortSignal): Request {
  return new Request(resource, {
    credentials: "same-origin",
    headers: { Accept: "application/geo+json,application/json" },
    signal
  });
}

/**
 * Read-through recovery only. The service worker is the single CacheStorage
 * owner; page and worker code never opens or writes a second language cache.
 */
async function readServiceWorkerCachedJson<T>(request: Request): Promise<T | null> {
  if (!canReadServiceWorkerCache()) return null;
  try {
    const response = await caches.match(request, { ignoreVary: false, ignoreSearch: false });
    if (!response) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

async function loadJson<T>(request: Request, label: string): Promise<T> {
  try {
    // The service worker owns persistent versioned data caching. Browser HTTP
    // cache remains the fallback when the page is not yet service-worker controlled.
    const response = await fetch(request, { cache: "force-cache" });
    if (!response.ok) {
      throw new ServiceError(`${label} request failed (${response.status}).`, {
        resource: request.url,
        status: response.status,
        offline: typeof navigator !== "undefined" && !navigator.onLine
      });
    }
    return await response.json() as T;
  } catch (error) {
    // A stale viewport generation owns its AbortSignal. Once cancelled, do not
    // fall through to CacheStorage and parse the same payload anyway; that was
    // keeping superseded JSON work alive during rapid pan/zoom gestures.
    if (isAbortError(error) || request.signal.aborted) throw error;
    const recovered = await readServiceWorkerCachedJson<T>(request);
    if (recovered !== null) return recovered;
    if (error instanceof ServiceError) throw error;
    throw new ServiceError(`${label} could not be loaded.`, {
      resource: request.url,
      offline: typeof navigator !== "undefined" && !navigator.onLine,
      cause: error
    });
  }
}

/**
 * Versioned JSON loader with request coalescing.
 *
 * Cache ownership is deliberately centralized in public/sw.js. This module
 * performs no CacheStorage writes, preventing two stale versions of the same
 * language/search payload from competing after an update.
 */
export async function fetchPersistentJson<T>(
  resource: string,
  label = resource,
  options: { signal?: AbortSignal } = {}
): Promise<T> {
  const request = jsonRequest(resource, options.signal);
  // Abortable viewport work must remain owned by its generation. Sharing that
  // request globally would let one stale caller keep parsing after a new camera
  // generation has cancelled it.
  if (options.signal) return loadJson<T>(request, label);
  const key = request.url;
  const pending = inFlightJson.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const task = loadJson<T>(request, label).finally(() => {
    if (inFlightJson.get(key) === task) inFlightJson.delete(key);
  });
  inFlightJson.set(key, task);
  return task;
}
