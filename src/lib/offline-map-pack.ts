import { FetchSource, PMTiles, type Protocol, type RangeResponse, type Source } from "pmtiles";
import {
  MAP_DATA_VERSION,
  OFFLINE_MAP_FILES,
  OFFLINE_PACK_VERSION,
  OFFLINE_RUNTIME_BYTES,
  type OfflineMapFileConfig
} from "./release";
import { recordRuntimeDiagnostic } from "./runtime-diagnostics";
import type { Language } from "./types";

export type OfflinePackStatus = "unsupported" | "idle" | "downloading" | "paused" | "ready" | "error";

export type OfflinePackErrorCode =
  | "offline-pack-storage-unsupported"
  | "offline-pack-storage-insufficient"
  | "offline-pack-file-download"
  | "offline-pack-file-size"
  | "offline-pack-file-header"
  | "offline-pack-file-hash"
  | "offline-pack-range-unsupported"
  | "offline-pack-runtime-unavailable"
  | "offline-pack-runtime-timeout"
  | "offline-pack-runtime-incomplete"
  | "offline-pack-verification-incomplete";

export class OfflinePackError extends Error {
  readonly code: OfflinePackErrorCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(code: OfflinePackErrorCode, details: Record<string, string | number | boolean> = {}) {
    const serialized = Object.entries(details).map(([key, value]) => `${key}=${String(value)}`).join(",");
    super(serialized ? `${code}:${serialized}` : code);
    this.name = "OfflinePackError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export type OfflinePackSnapshot = {
  status: OfflinePackStatus;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  persisted: boolean;
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
  storageAvailableBytes: number | null;
  verifiedAt: number | null;
  error: string | null;
  mapDataVersion: string;
  packVersion: string;
};

type OfflinePackListener = (snapshot: OfflinePackSnapshot) => void;

type StoredPackFileMetadata = {
  bytes: number;
  complete: boolean;
  sha256: string;
  headerVerified: boolean;
};

type StoredPackRuntimeMetadata = { bytes: number; complete: boolean; language: Language; totalBytes: number; };

type StoredPackMetadata = {
  schema: 1;
  mapDataVersion: string;
  packVersion: string;
  files: Record<string, StoredPackFileMetadata>;
  runtime: StoredPackRuntimeMetadata;
  updatedAt: number;
};

type OfflineRuntimeReply = { type?: "progress" | "complete"; ok?: boolean; cancelled?: boolean; cachedBytes?: number; totalBytes?: number; cachedEntries?: number; totalEntries?: number; reason?: string; missingPaths?: string[]; };

type OfflineMapPackManagerOptions = {
  baseRemoteUrl: string;
  roadsRemoteUrl: string;
};

const STORAGE_KEY = "nav-kurd:offline-map-pack";
const PACK_DIRECTORY_PREFIX = "nav-kurd-map-pack-";
const SERVICE_WORKER_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
const PACK_DIRECTORY = `nav-kurd-map-pack-${OFFLINE_PACK_VERSION}`;
const PROGRESS_EMIT_INTERVAL_MS = 180;
const DOWNLOAD_CHUNK_BYTES = 1024 * 1024;
const DOWNLOAD_RETRY_LIMIT = 4;
const DOWNLOAD_RETRY_BASE_MS = 450;
const PMTILES_HEADER_BYTES = 8;
const PMTILES_MAGIC = "PMTiles";
const PMTILES_VERSION = 3;

function storageManager(): StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> } {
  return navigator.storage as StorageManager & { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
}

function emptyMetadata(): StoredPackMetadata {
  return {
    schema: 1, mapDataVersion: MAP_DATA_VERSION, packVersion: OFFLINE_PACK_VERSION,
    files: Object.fromEntries(OFFLINE_MAP_FILES.map((file) => [file.id, { bytes: 0, complete: false, sha256: file.sha256, headerVerified: false }])),
    runtime: { bytes: 0, complete: false, language: "ku", totalBytes: OFFLINE_RUNTIME_BYTES }, updatedAt: Date.now()
  };
}

function readStoredMetadata(): StoredPackMetadata {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyMetadata();
    const parsed = JSON.parse(raw) as Partial<StoredPackMetadata> & { schema?: number };
    if (Number(parsed.schema) !== 1 || parsed.mapDataVersion !== MAP_DATA_VERSION || parsed.packVersion !== OFFLINE_PACK_VERSION) return emptyMetadata();
    const metadata = emptyMetadata();
    for (const config of OFFLINE_MAP_FILES) {
      const stored = parsed.files?.[config.id];
      if (!stored) continue;
      metadata.files[config.id] = { bytes: Math.max(0, Math.min(Number(stored.bytes) || 0, config.bytes)), complete: Boolean(stored.complete), sha256: typeof stored.sha256 === "string" ? stored.sha256 : config.sha256, headerVerified: Boolean(stored.headerVerified) };
    }
    if (parsed.runtime) {
      const runtime = parsed.runtime as Partial<StoredPackRuntimeMetadata>;
      const totalBytes = Math.max(0, Number(runtime.totalBytes) || OFFLINE_RUNTIME_BYTES);
      metadata.runtime = {
        bytes: Math.max(0, Math.min(Number(runtime.bytes) || 0, totalBytes)),
        complete: Boolean(runtime.complete),
        language: runtime.language === "ar" || runtime.language === "en" ? runtime.language : "ku",
        totalBytes
      };
    }
    metadata.updatedAt = Number(parsed.updatedAt) || Date.now();
    return metadata;
  } catch { return emptyMetadata(); }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function hasValidPmtilesHeader(file: Blob): Promise<boolean> {
  if (file.size < PMTILES_HEADER_BYTES) return false;
  const bytes = new Uint8Array(await file.slice(0, PMTILES_HEADER_BYTES).arrayBuffer());
  const magic = new TextDecoder("ascii").decode(bytes.slice(0, 7));
  return magic === PMTILES_MAGIC && bytes[7] === PMTILES_VERSION;
}

async function hasExpectedSha256(file: Blob, expectedSha256: string): Promise<boolean> {
  if (typeof crypto === "undefined" || !crypto.subtle) return false;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual === expectedSha256.toLocaleLowerCase("en-US");
}

function validContentRange(response: Response, expectedStart: number, expectedEnd: number, expectedBytes: number): boolean {
  if (response.status !== 206) return false;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/iu.exec(response.headers.get("content-range")?.trim() ?? "");
  if (!match) return false;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  return start === expectedStart && end === expectedEnd && total === expectedBytes;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    const onAbort = () => { cleanup(); reject(signal.reason ?? new DOMException("Aborted", "AbortError")); };
    const cleanup = () => { window.clearTimeout(timer); signal.removeEventListener("abort", onAbort); };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function incompleteFileMetadata(config: OfflineMapFileConfig, bytes = 0): StoredPackFileMetadata {
  return { bytes: Math.max(0, Math.min(bytes, config.bytes)), complete: false, sha256: config.sha256, headerVerified: false };
}

class HybridPmtilesSource implements Source {
  private readonly key: string;
  private readonly fileId: OfflineMapFileConfig["id"];
  private readonly remote: FetchSource;
  private readonly manager: OfflineMapPackManager;

  constructor(key: string, fileId: OfflineMapFileConfig["id"], remoteUrl: string, manager: OfflineMapPackManager) {
    this.key = key;
    this.fileId = fileId;
    this.remote = new FetchSource(remoteUrl);
    this.manager = manager;
  }

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
    const local = await this.manager.readRange(this.fileId, offset, length, signal);
    if (local) return { data: local };
    if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error(`offline-pmtiles-range-unavailable:${this.fileId}`);
    return this.remote.getBytes(offset, length, signal, etag);
  }
}

/**
 * Owns the optional full offline PMTiles pack.
 *
 * Files are streamed into OPFS with resumable HTTP Range requests. MapLibre is
 * always connected through hybrid PMTiles sources: a verified local file wins,
 * otherwise the existing remote PMTiles URL is used without changing map logic.
 */
export class OfflineMapPackManager {
  private readonly remoteUrls: Record<OfflineMapFileConfig["id"], string>;
  private readonly listeners = new Set<OfflinePackListener>();
  private metadata = readStoredMetadata();
  private aborter: AbortController | null = null;
  private downloadPromise: Promise<void> | null = null;
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private lastProgressEmitAt = 0;
  private snapshotState: OfflinePackSnapshot;
  private language: Language;
  private runtimeExpectedBytes: number;

  constructor(options: OfflineMapPackManagerOptions) {
    this.remoteUrls = { base: options.baseRemoteUrl, roads: options.roadsRemoteUrl };
    this.language = this.metadata.runtime.language;
    this.runtimeExpectedBytes = this.metadata.runtime.totalBytes || OFFLINE_RUNTIME_BYTES;
    const supported = typeof navigator !== "undefined" && typeof storageManager().getDirectory === "function";
    const downloaded = this.currentDownloadedBytes();
    this.snapshotState = {
      status: supported ? (this.metadataComplete() ? "ready" : downloaded > 0 ? "paused" : "idle") : "unsupported",
      downloadedBytes: downloaded,
      totalBytes: this.totalBytes(),
      progress: this.totalBytes() > 0 ? downloaded / this.totalBytes() : 0,
      persisted: false,
      storageUsageBytes: null,
      storageQuotaBytes: null,
      storageAvailableBytes: null,
      verifiedAt: null,
      error: null,
      mapDataVersion: MAP_DATA_VERSION,
      packVersion: OFFLINE_PACK_VERSION
    };
  }

  snapshot(): OfflinePackSnapshot {
    return { ...this.snapshotState };
  }

  subscribe(listener: OfflinePackListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  setLanguage(language: Language): void {
    if (this.language === language) return;
    this.language = language;
    this.runtimeExpectedBytes = 0;
    this.metadata.runtime = { bytes: 0, complete: false, language, totalBytes: 0 };
    this.persistMetadata();
    this.updateProgress();
    void this.checkOfflineRuntime().then((state) => {
      this.applyRuntimeReply(state);
      this.persistMetadata();
      this.updateProgress();
    }).catch(() => undefined);
  }

  registerPmtilesSources(protocol: Protocol): { baseSourceKey: string; roadsSourceKey: string } {
    const baseSourceKey = `nav-kurd-offline-base-${MAP_DATA_VERSION}`;
    const roadsSourceKey = `nav-kurd-offline-roads-${MAP_DATA_VERSION}`;
    protocol.add(new PMTiles(new HybridPmtilesSource(baseSourceKey, "base", this.remoteUrls.base, this)));
    protocol.add(new PMTiles(new HybridPmtilesSource(roadsSourceKey, "roads", this.remoteUrls.roads, this)));
    return { baseSourceKey, roadsSourceKey };
  }

  async initialize(): Promise<OfflinePackSnapshot> {
    if (this.snapshotState.status === "unsupported") return this.snapshot();
    try {
      const persisted = await navigator.storage.persisted?.() ?? false;
      this.snapshotState.persisted = persisted;
      // Verify the active pack before removing superseded release directories. This
      // prevents a metadata or filesystem mismatch from deleting the only known
      // usable copy before the current pack has been inspected.
      await this.verifyStoredFiles();
      await this.cleanupStalePackDirectories();
      await this.refreshStorageEstimate();
      this.persistMetadata();
      this.emit();
    } catch (error) {
      this.setError(error);
    }
    return this.snapshot();
  }

  async download(): Promise<void> {
    if (this.snapshotState.status === "unsupported") throw new OfflinePackError("offline-pack-storage-unsupported");
    if (this.downloadPromise) return this.downloadPromise;
    if (this.metadataComplete()) {
      this.setStatus("ready");
      return;
    }

    await this.ensureStorageCapacity();
    this.aborter = new AbortController();
    this.snapshotState.error = null;
    this.setStatus("downloading");
    this.downloadPromise = this.runDownload(this.aborter.signal)
      .catch((error) => {
        if (isAbortError(error)) {
          this.setStatus("paused");
          return;
        }
        this.setError(error);
      })
      .finally(() => {
        this.aborter = null;
        this.downloadPromise = null;
      });
    return this.downloadPromise;
  }

  pause(): void {
    if (!this.aborter) return;
    this.aborter.abort(new DOMException("Offline download paused", "AbortError"));
    void this.cancelOfflineRuntime();
  }

  async delete(): Promise<void> {
    this.pause();
    if (this.downloadPromise) await this.downloadPromise;
    if (this.snapshotState.status === "unsupported") return;
    try {
      const root = await this.getRoot();
      await root.removeEntry(PACK_DIRECTORY, { recursive: true });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
    await this.clearOfflineRuntime();
    this.metadata = emptyMetadata();
    this.persistMetadata();
    this.snapshotState.error = null;
    this.snapshotState.verifiedAt = null;
    this.updateProgress();
    await this.refreshStorageEstimate();
    this.setStatus("idle");
  }

  async readRange(
    fileId: OfflineMapFileConfig["id"],
    offset: number,
    length: number,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    if (!this.fileComplete(fileId) || this.snapshotState.status === "unsupported") return null;
    signal?.throwIfAborted();
    const config = OFFLINE_MAP_FILES.find((file) => file.id === fileId);
    if (!config) return null;
    try {
      const directory = await this.getPackDirectory(false);
      const handle = await directory.getFileHandle(config.fileName);
      const file = await handle.getFile();
      if (file.size !== config.bytes || offset < 0 || length <= 0 || offset + length > file.size) return null;
      signal?.throwIfAborted();
      return await file.slice(offset, offset + length).arrayBuffer();
    } catch {
      this.metadata.files[fileId] = incompleteFileMetadata(config);
      this.persistMetadata();
      this.updateProgress();
      this.setStatus(this.currentDownloadedBytes() > 0 ? "paused" : "idle");
      return null;
    }
  }



  private async cleanupStalePackDirectories(): Promise<void> {
    const root = await this.getRoot();
    const iterable = root as unknown as {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    if (typeof iterable.entries !== "function") return;
    const stale: string[] = [];
    for await (const [name, handle] of iterable.entries()) {
      if (handle.kind !== "directory" || !name.startsWith(PACK_DIRECTORY_PREFIX) || name === PACK_DIRECTORY) continue;
      stale.push(name);
    }
    for (const name of stale) {
      try { await root.removeEntry(name, { recursive: true }); }
      catch (error) {
        recordRuntimeDiagnostic(`offline-map-pack.cleanup:${name}`, error, "warning");
      }
    }
  }

  private async refreshStorageEstimate(): Promise<void> {
    if (typeof navigator.storage.estimate !== "function") return;
    try {
      const estimate = await navigator.storage.estimate();
      const quota = Number.isFinite(estimate.quota) ? Math.max(0, Number(estimate.quota)) : null;
      const usage = Number.isFinite(estimate.usage) ? Math.max(0, Number(estimate.usage)) : null;
      this.snapshotState.storageQuotaBytes = quota;
      this.snapshotState.storageUsageBytes = usage;
      this.snapshotState.storageAvailableBytes = quota !== null && usage !== null ? Math.max(0, quota - usage) : null;
      this.emit();
    } catch (error) {
      recordRuntimeDiagnostic("offline-map-pack.storage-estimate", error, "warning");
    }
  }

  private async ensureStorageCapacity(): Promise<void> {
    if (typeof navigator.storage.estimate !== "function") return;
    const estimate = await navigator.storage.estimate();
    const quota = Number.isFinite(estimate.quota) ? Math.max(0, Number(estimate.quota)) : null;
    const usage = Number.isFinite(estimate.usage) ? Math.max(0, Number(estimate.usage)) : null;
    this.snapshotState.storageQuotaBytes = quota;
    this.snapshotState.storageUsageBytes = usage;
    this.snapshotState.storageAvailableBytes = quota !== null && usage !== null ? Math.max(0, quota - usage) : null;
    if (quota === null || usage === null) { this.emit(); return; }
    const remaining = Math.max(0, quota - usage);
    const missing = Math.max(0, this.totalBytes() - this.currentDownloadedBytes());
    const safetyMargin = Math.max(16 * 1024 * 1024, Math.ceil(missing * 0.15));
    if (remaining < missing + safetyMargin) {
      throw new OfflinePackError("offline-pack-storage-insufficient", { available: remaining, required: missing + safetyMargin });
    }
  }

  private async runDownload(signal: AbortSignal): Promise<void> {
    if (navigator.storage.persist) {
      try {
        this.snapshotState.persisted = await navigator.storage.persist();
      } catch {
        this.snapshotState.persisted = false;
      }
    }
    await this.refreshStorageEstimate();

    for (const config of OFFLINE_MAP_FILES) {
      signal.throwIfAborted();
      if (this.fileComplete(config.id)) continue;
      await this.downloadFile(config, this.remoteUrls[config.id], signal);
    }

    await this.warmOfflineRuntime(signal);
    await this.verifyStoredFiles();
    if (!this.metadataComplete()) {
      const failures = this.verificationFailures();
      throw new OfflinePackError("offline-pack-verification-incomplete", { failures: failures.join("|") || "unknown" });
    }
    this.snapshotState.verifiedAt = Date.now();
    await this.refreshStorageEstimate();
    this.setStatus("ready");
    this.warmOfflineShell();
  }

  private async fetchChunk(
    config: OfflineMapFileConfig,
    remoteUrl: string,
    start: number,
    end: number,
    signal: AbortSignal
  ): Promise<ArrayBuffer> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < DOWNLOAD_RETRY_LIMIT; attempt += 1) {
      signal.throwIfAborted();
      try {
        const headers = new Headers({ Range: `bytes=${start}-${end}` });
        const response = await fetch(remoteUrl, {
          headers,
          signal,
          cache: "no-store",
          credentials: "same-origin"
        });

        if (response.status === 200 && start === 0) {
          const full = await response.arrayBuffer();
          if (full.byteLength !== config.bytes) {
            throw new OfflinePackError("offline-pack-file-size", { file: config.id, actual: full.byteLength, expected: config.bytes });
          }
          return full;
        }
        if (!response.ok && response.status !== 206) {
          throw new OfflinePackError("offline-pack-file-download", { file: config.id, status: response.status });
        }
        if (!validContentRange(response, start, end, config.bytes)) {
          if (response.status === 200 && start > 0) {
            throw new OfflinePackError("offline-pack-range-unsupported", { file: config.id, offset: start });
          }
          throw new OfflinePackError("offline-pack-file-download", { file: config.id, offset: start, end, reason: "invalid-content-range" });
        }
        const chunk = await response.arrayBuffer();
        const expectedLength = end - start + 1;
        if (chunk.byteLength !== expectedLength) {
          throw new OfflinePackError("offline-pack-file-size", { file: config.id, actual: chunk.byteLength, expected: expectedLength });
        }
        return chunk;
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw error;
        lastError = error;
        if (attempt + 1 < DOWNLOAD_RETRY_LIMIT) {
          await abortableDelay(DOWNLOAD_RETRY_BASE_MS * 2 ** attempt, signal);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async commitChunk(
    handle: FileSystemFileHandle,
    offset: number,
    chunk: ArrayBuffer,
    signal: AbortSignal
  ): Promise<number> {
    signal.throwIfAborted();
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
      await writable.seek(offset);
      await writable.write(new Uint8Array(chunk));
      await writable.close();
    } catch (error) {
      try { await writable.abort(error); } catch { /* best-effort rollback */ }
      throw error;
    }
    return offset + chunk.byteLength;
  }

  private async downloadFile(config: OfflineMapFileConfig, remoteUrl: string, signal: AbortSignal): Promise<void> {
    const directory = await this.getPackDirectory(true);
    const handle = await directory.getFileHandle(config.fileName, { create: true });
    let currentFile = await handle.getFile();
    let offset = Math.min(currentFile.size, config.bytes);

    if (currentFile.size > config.bytes) {
      const truncateWriter = await handle.createWritable({ keepExistingData: false });
      await truncateWriter.truncate(0);
      await truncateWriter.close();
      offset = 0;
      currentFile = await handle.getFile();
    }

    if (offset === config.bytes) {
      const headerVerified = await hasValidPmtilesHeader(currentFile);
      const shaVerified = headerVerified && await hasExpectedSha256(currentFile, config.sha256);
      if (!shaVerified) {
        const resetWriter = await handle.createWritable({ keepExistingData: false });
        await resetWriter.truncate(0);
        await resetWriter.close();
        offset = 0;
      } else {
        this.metadata.files[config.id] = { bytes: config.bytes, complete: true, sha256: config.sha256, headerVerified: true };
        this.persistMetadata();
        this.updateProgress();
        return;
      }
    }

    try {
      while (offset < config.bytes) {
        signal.throwIfAborted();
        const end = Math.min(config.bytes - 1, offset + DOWNLOAD_CHUNK_BYTES - 1);
        const chunk = await this.fetchChunk(config, remoteUrl, offset, end, signal);
        const nextOffset = chunk.byteLength === config.bytes && offset === 0
          ? await this.commitChunk(handle, 0, chunk, signal)
          : await this.commitChunk(handle, offset, chunk, signal);
        offset = Math.min(nextOffset, config.bytes);
        this.metadata.files[config.id] = incompleteFileMetadata(config, offset);
        this.persistMetadata();
        this.updateProgressThrottled();
      }
    } catch (error) {
      const persistedFile = await handle.getFile();
      this.metadata.files[config.id] = incompleteFileMetadata(config, persistedFile.size);
      this.persistMetadata();
      this.updateProgress();
      throw error;
    }

    const completeFile = await handle.getFile();
    if (completeFile.size !== config.bytes) {
      this.metadata.files[config.id] = incompleteFileMetadata(config, completeFile.size);
      this.persistMetadata();
      this.updateProgress();
      throw new OfflinePackError("offline-pack-file-size", { file: config.id, actual: completeFile.size, expected: config.bytes });
    }

    if (!await hasValidPmtilesHeader(completeFile)) {
      this.metadata.files[config.id] = incompleteFileMetadata(config, completeFile.size);
      this.persistMetadata();
      this.updateProgress();
      throw new OfflinePackError("offline-pack-file-header", { file: config.id });
    }
    if (!await hasExpectedSha256(completeFile, config.sha256)) {
      const resetWriter = await handle.createWritable({ keepExistingData: false });
      await resetWriter.truncate(0);
      await resetWriter.close();
      this.metadata.files[config.id] = incompleteFileMetadata(config);
      this.persistMetadata();
      this.updateProgress();
      throw new OfflinePackError("offline-pack-file-hash", { file: config.id });
    }

    this.metadata.files[config.id] = { bytes: config.bytes, complete: true, sha256: config.sha256, headerVerified: true };
    this.persistMetadata();
    this.updateProgress();
  }

  private async verifyStoredFiles(): Promise<void> {
    if (this.snapshotState.status === "unsupported") return;
    let changed = false;
    for (const config of OFFLINE_MAP_FILES) {
      try {
        const directory = await this.getPackDirectory(false);
        const handle = await directory.getFileHandle(config.fileName);
        const file = await handle.getFile();
        const sized = file.size === config.bytes;
        const headerVerified = sized ? await hasValidPmtilesHeader(file) : false;
        const shaVerified = headerVerified ? await hasExpectedSha256(file, config.sha256) : false;
        const complete = sized && headerVerified && shaVerified;
        const next: StoredPackFileMetadata = {
          bytes: Math.min(file.size, config.bytes),
          complete,
          sha256: config.sha256,
          headerVerified
        };
        const current = this.metadata.files[config.id];
        if (!current || current.bytes !== next.bytes || current.complete !== next.complete || current.sha256 !== next.sha256 || current.headerVerified !== next.headerVerified) {
          this.metadata.files[config.id] = next;
          changed = true;
        }
      } catch {
        const current = this.metadata.files[config.id];
        if (!current || current.bytes !== 0 || current.complete) {
          this.metadata.files[config.id] = incompleteFileMetadata(config);
          changed = true;
        }
      }
    }
    const runtimeState = await this.checkOfflineRuntime();
    const previousRuntime = JSON.stringify(this.metadata.runtime);
    this.applyRuntimeReply(runtimeState);
    if (JSON.stringify(this.metadata.runtime) !== previousRuntime) changed = true;
    if (changed) this.persistMetadata();
    this.updateProgress();
    if (this.metadataComplete()) {
      this.snapshotState.status = "ready";
      this.snapshotState.verifiedAt = this.metadata.updatedAt || Date.now();
    }
    else if (this.currentDownloadedBytes() > 0 && this.snapshotState.status !== "downloading") this.snapshotState.status = "paused";
    else if (this.snapshotState.status !== "downloading") this.snapshotState.status = "idle";
  }

  private async requestServiceWorker(
    type: "WARM_OFFLINE_RUNTIME" | "CHECK_OFFLINE_RUNTIME" | "CLEAR_OFFLINE_RUNTIME" | "CANCEL_OFFLINE_RUNTIME",
    signal?: AbortSignal,
    onProgress?: (reply: OfflineRuntimeReply) => void
  ): Promise<OfflineRuntimeReply> {
    if (!("serviceWorker" in navigator)) throw new OfflinePackError("offline-pack-runtime-unavailable", { reason: "unsupported" });
    const registration = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller ?? registration.active ?? registration.waiting;
    if (!worker) throw new OfflinePackError("offline-pack-runtime-unavailable", { reason: "no-active-worker" });
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); channel.port1.close(); };
      const onAbort = () => {
        try { worker.postMessage({ type: "CANCEL_OFFLINE_RUNTIME", language: this.language, mapDataVersion: MAP_DATA_VERSION, packVersion: OFFLINE_PACK_VERSION }); } catch { /* best effort */ }
        cleanup();
        reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      const timer = window.setTimeout(() => { cleanup(); reject(new OfflinePackError("offline-pack-runtime-timeout", { request: type })); }, SERVICE_WORKER_REQUEST_TIMEOUT_MS);
      channel.port1.onmessage = (event: MessageEvent<OfflineRuntimeReply>) => {
        const reply = event.data ?? {};
        if (reply.type === "progress") { onProgress?.(reply); return; }
        if (type === "WARM_OFFLINE_RUNTIME" && reply.type !== "complete") return;
        cleanup(); resolve(reply);
      };
      channel.port1.start();
      if (signal?.aborted) { onAbort(); return; }
      signal?.addEventListener("abort", onAbort, { once: true });
      worker.postMessage({ type, language: this.language, mapDataVersion: MAP_DATA_VERSION, packVersion: OFFLINE_PACK_VERSION }, [channel.port2]);
    });
  }

  private applyRuntimeReply(reply: OfflineRuntimeReply): void {
    const expected = Math.max(0, Number(reply.totalBytes) || this.runtimeExpectedBytes || 0);
    if (expected > 0) this.runtimeExpectedBytes = expected;
    const bytes = Math.max(0, Math.min(Number(reply.cachedBytes) || 0, this.runtimeExpectedBytes || Number(reply.cachedBytes) || 0));
    this.metadata.runtime = {
      bytes,
      complete: reply.ok === true && this.runtimeExpectedBytes > 0 && bytes === this.runtimeExpectedBytes,
      language: this.language,
      totalBytes: this.runtimeExpectedBytes
    };
  }

  private async warmOfflineRuntime(signal: AbortSignal): Promise<void> {
    const existing = await this.checkOfflineRuntime();
    this.applyRuntimeReply(existing);
    this.persistMetadata();
    this.updateProgress();
    if (this.metadata.runtime.complete) return;

    const result = await this.requestServiceWorker("WARM_OFFLINE_RUNTIME", signal, (reply) => {
      this.applyRuntimeReply({ ...reply, ok: false });
      this.persistMetadata();
      this.updateProgressThrottled();
    });
    this.applyRuntimeReply(result);
    this.persistMetadata();
    this.updateProgress();
    if (!this.metadata.runtime.complete) {
      if (result.cancelled) throw new DOMException("Offline download paused", "AbortError");
      throw new OfflinePackError("offline-pack-runtime-incomplete", { cached: this.metadata.runtime.bytes, expected: this.runtimeExpectedBytes, reason: result.reason ?? "missing-runtime-assets", missing: result.missingPaths?.join("|") ?? "" });
    }
  }

  private async checkOfflineRuntime(): Promise<OfflineRuntimeReply> {
    try { return await this.requestServiceWorker("CHECK_OFFLINE_RUNTIME"); }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ok: false, cachedBytes: 0, totalBytes: this.runtimeExpectedBytes, reason };
    }
  }

  private async cancelOfflineRuntime(): Promise<void> {
    try { await this.requestServiceWorker("CANCEL_OFFLINE_RUNTIME"); } catch { /* best effort */ }
  }

  private async clearOfflineRuntime(): Promise<void> {
    try { await this.requestServiceWorker("CLEAR_OFFLINE_RUNTIME"); } catch { /* next cache schema removes stale data */ }
    this.metadata.runtime = { bytes: 0, complete: false, language: this.language, totalBytes: this.runtimeExpectedBytes };
  }

  private warmOfflineShell(): void {
    try {
      navigator.serviceWorker?.controller?.postMessage({
        type: "WARM_OFFLINE_SHELL",
        mapDataVersion: MAP_DATA_VERSION,
        packVersion: OFFLINE_PACK_VERSION,
        language: this.language
      });
    } catch {
      // The full PMTiles pack remains usable through OPFS even if SW warming is unavailable.
    }
  }

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.rootPromise) {
      const getDirectory = storageManager().getDirectory;
      if (!getDirectory) throw new OfflinePackError("offline-pack-storage-unsupported");
      this.rootPromise = getDirectory.call(navigator.storage);
    }
    return this.rootPromise;
  }

  private async getPackDirectory(create: boolean): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot();
    return root.getDirectoryHandle(PACK_DIRECTORY, { create });
  }

  private fileComplete(fileId: OfflineMapFileConfig["id"]): boolean {
    const config = OFFLINE_MAP_FILES.find((file) => file.id === fileId);
    const stored = this.metadata.files[fileId];
    return Boolean(config && stored?.complete && stored.headerVerified && stored.bytes === config.bytes && stored.sha256 === config.sha256);
  }

  private totalBytes(): number {
    return OFFLINE_MAP_FILES.reduce((sum, file) => sum + file.bytes, this.runtimeExpectedBytes);
  }

  private verificationFailures(): string[] {
    const failures: string[] = [];
    for (const file of OFFLINE_MAP_FILES) {
      const stored = this.metadata.files[file.id];
      if (!stored || stored.bytes !== file.bytes) failures.push(`${file.id}:size`);
      else if (!stored.headerVerified) failures.push(`${file.id}:header`);
      else if (stored.sha256 !== file.sha256 || !stored.complete) failures.push(`${file.id}:hash`);
    }
    if (this.runtimeExpectedBytes <= 0) failures.push("runtime:expected-bytes");
    else if (this.metadata.runtime.bytes !== this.runtimeExpectedBytes) failures.push("runtime:bytes");
    else if (!this.metadata.runtime.complete) failures.push("runtime:marker");
    return failures;
  }

  private metadataComplete(): boolean {
    return this.verificationFailures().length === 0;
  }

  private currentDownloadedBytes(): number {
    const pmtilesBytes = OFFLINE_MAP_FILES.reduce((sum, file) => sum + Math.min(this.metadata.files[file.id]?.bytes || 0, file.bytes), 0);
    return pmtilesBytes + Math.min(this.metadata.runtime.bytes, this.runtimeExpectedBytes || this.metadata.runtime.bytes);
  }

  private persistMetadata(writeStorage = true): void {
    this.metadata.updatedAt = Date.now();
    if (!writeStorage) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.metadata)); } catch { /* OPFS remains usable without the metadata mirror. */ }
  }

  private updateProgressThrottled(): void {
    const now = performance.now();
    if (now - this.lastProgressEmitAt < PROGRESS_EMIT_INTERVAL_MS) return;
    this.lastProgressEmitAt = now;
    this.updateProgress();
  }

  private updateProgress(): void {
    const downloaded = this.currentDownloadedBytes();
    this.snapshotState.downloadedBytes = downloaded;
    this.snapshotState.totalBytes = this.totalBytes();
    this.snapshotState.progress = this.snapshotState.totalBytes > 0 ? Math.min(1, downloaded / this.snapshotState.totalBytes) : 0;
    this.emit();
  }

  private setStatus(status: OfflinePackStatus): void {
    this.snapshotState.status = status;
    this.emit();
  }

  private setError(error: unknown): void {
    this.snapshotState.status = "error";
    this.snapshotState.error = error instanceof Error ? error.message : String(error);
    this.emit();
    recordRuntimeDiagnostic("offline-map-pack", error, "warning");
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
