import { CACHE_SCHEMA_VERSION, MAP_DATA_VERSION } from "./release";
import type { Language } from "./types";

type LanguageCacheReply = {
  ok?: boolean;
  language?: Language;
  cached?: boolean;
  cachedEntries?: number;
  totalEntries?: number;
};

const STORAGE_KEY = `nav-kurd-language-assets:${MAP_DATA_VERSION}:s${CACHE_SCHEMA_VERSION}`;
const REQUEST_TIMEOUT_MS = 1_500;

function readPreparedLanguages(): Set<Language> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is Language => value === "ku" || value === "ar" || value === "en"));
  } catch {
    return new Set();
  }
}

function writePreparedLanguages(languages: ReadonlySet<Language>): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...languages])); } catch { /* Private mode or full storage. */ }
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (!("serviceWorker" in navigator)) return null;
  if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS))
    ]);
    return registration?.active ?? null;
  } catch {
    return null;
  }
}

async function requestWorker(type: "CHECK_LANGUAGE_ASSETS" | "WARM_LANGUAGE_SEARCH", language: Language): Promise<LanguageCacheReply | null> {
  const worker = await activeWorker();
  if (!worker) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (reply: LanguageCacheReply | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.port1.close();
      resolve(reply);
    };
    const timer = window.setTimeout(() => finish(null), type === "CHECK_LANGUAGE_ASSETS" ? REQUEST_TIMEOUT_MS : 12_000);
    channel.port1.onmessage = (event: MessageEvent<LanguageCacheReply>) => finish(event.data ?? null);
    try {
      worker.postMessage({ type, language, assetKind: type === "CHECK_LANGUAGE_ASSETS" ? "properties" : "search", mapDataVersion: MAP_DATA_VERSION }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

/**
 * Tracks persistent language assets without keeping every parsed catalog in RAM.
 * The browser/Service Worker may retain downloaded files, while the map runtime
 * still activates only the selected language.
 */
export class LanguageAssetCacheController {
  private readonly prepared = readPreparedLanguages();

  wasPrepared(language: Language): boolean { return this.prepared.has(language); }

  markPrepared(language: Language): void {
    if (this.prepared.has(language)) return;
    this.prepared.add(language);
    writePreparedLanguages(this.prepared);
  }

  async verifyPrepared(language: Language): Promise<boolean> {
    const hint = this.prepared.has(language);
    const reply = await requestWorker("CHECK_LANGUAGE_ASSETS", language);
    if (!reply) return hint;
    const cached = reply.cached === true
      || Boolean(Number(reply.totalEntries) > 0 && reply.cachedEntries === reply.totalEntries);
    if (cached) this.markPrepared(language);
    // CacheStorage and the HTTP cache can remain valid while the Service Worker
    // is not yet controlling this tab. Never erase a successful local hint only
    // because the worker cannot currently enumerate its own cache.
    return cached || hint;
  }

  async warm(language: Language): Promise<void> {
    const reply = await requestWorker("WARM_LANGUAGE_SEARCH", language);
    const complete = reply?.ok === true
      || Boolean(reply && Number(reply.totalEntries) > 0 && reply.cachedEntries === reply.totalEntries);
    if (complete) this.markPrepared(language);
  }
}
