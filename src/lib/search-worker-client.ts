import type { StaticSearchItem } from "./static-search";
import type { Language } from "./types";

type WorkerReply =
  | { type: "ready"; id: number; records: number; language?: Language }
  | { type: "results"; id: number; items: StaticSearchItem[] }
  | { type: "error"; id: number; message: string };

type PendingRequest = {
  resolve: (value: WorkerReply) => void;
  reject: (error: Error) => void;
  timeout: number;
};

type SearchWorkerClientOptions = { manifestUrl: string; timeoutMs?: number };

/**
 * Dedicated search worker client.
 *
 * The compact 5.4–6.0 MiB selected-language catalog is never parsed or indexed on the UI thread. A
 * previous fallback did exactly that after any worker timeout, turning a
 * recoverable worker/network issue into a multi-second application freeze.
 * Important/local settlement results remain available through SearchService
 * while this worker retries after a short cooldown.
 */
export class SearchWorkerClient {
  private readonly manifestUrl: string;
  private readonly timeoutMs: number;
  private readonly resultCache = new Map<string, StaticSearchItem[]>();
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, PendingRequest>();
  private readyState = false;
  private activeRecords = 0;
  private disabledUntil = 0;
  private activeLanguage: Language | null = null;
  private activationLanguage: Language | null = null;
  private activationPromise: Promise<number> | null = null;

  constructor(options: SearchWorkerClientOptions) {
    this.manifestUrl = options.manifestUrl;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  get isReady(): boolean { return this.readyState; }

  async activateLanguage(language: Language): Promise<number> {
    if (this.activationLanguage === language && this.activationPromise) return this.activationPromise;
    if (this.activeLanguage !== language) {
      this.resultCache.clear();
      this.activeLanguage = language;
      this.readyState = false;
      this.activeRecords = 0;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
        this.rejectPending(new Error("Search language changed."));
      }
      this.disabledUntil = 0;
    } else if (this.readyState) {
      return this.activeRecords;
    }

    if (Date.now() < this.disabledUntil) throw new Error("Search worker is cooling down after a failure.");
    const task = this.request({ type: "activate", manifestUrl: this.manifestUrl, language })
      .then((reply) => {
        if (reply.type !== "ready") throw new Error("Search worker did not return a ready response.");
        this.readyState = true;
        this.activeRecords = reply.records;
        return reply.records;
      })
      .catch((error) => {
        this.disableWorker(error, 4_000);
        throw error;
      })
      .finally(() => {
        if (this.activationPromise === task) {
          this.activationPromise = null;
          this.activationLanguage = null;
        }
      });
    this.activationLanguage = language;
    this.activationPromise = task;
    return task;
  }

  warm(language: Language = "ku"): Promise<number> { return this.activateLanguage(language); }

  async search(term: string, language: Language, limit = 12): Promise<StaticSearchItem[]> {
    if (this.activeLanguage !== language || !this.readyState) {
      try { await this.activateLanguage(language); }
      catch { return []; }
    }
    const cacheKey = `${language}:${limit}:${term.trim().toLocaleLowerCase("en-US")}`;
    const cached = this.resultCache.get(cacheKey);
    if (cached) return cached;
    if (Date.now() < this.disabledUntil) return [];

    try {
      const reply = await this.request({ type: "search", query: term, language, limit, manifestUrl: this.manifestUrl });
      if (reply.type !== "results") return [];
      this.readyState = true;
      this.resultCache.set(cacheKey, reply.items);
      if (this.resultCache.size > 48) this.resultCache.delete(this.resultCache.keys().next().value ?? "");
      return reply.items;
    } catch (error) {
      this.disableWorker(error, 4_000);
      return [];
    }
  }

  reset(): void {
    this.disableWorker(new Error("Search worker reset."), 0);
    this.activeLanguage = null;
    this.activeRecords = 0;
    this.activationLanguage = null;
    this.activationPromise = null;
    this.resultCache.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL("../workers/search.worker.ts", import.meta.url), { type: "module", name: "nav-kurd-search" });
    this.worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => this.handleReply(event.data));
    this.worker.addEventListener("error", (event) => this.disableWorker(new Error(event.message || "Search worker failed."), 4_000));
    this.worker.addEventListener("messageerror", () => this.disableWorker(new Error("Search worker returned an unreadable message."), 4_000));
    return this.worker;
  }

  private request(payload:
    | { type: "activate" | "init"; manifestUrl: string; language: Language }
    | { type: "search"; query: string; language: Language; limit: number; manifestUrl: string }
  ): Promise<WorkerReply> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    return new Promise<WorkerReply>((resolve, reject) => {
      const timeout = window.setTimeout(() => this.disableWorker(new Error("Search worker request timed out."), 4_000), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      worker.postMessage({ ...payload, id });
    });
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private disableWorker(error: unknown, cooldownMs: number): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.worker?.terminate();
    this.worker = null;
    this.readyState = false;
    this.activeRecords = 0;
    this.disabledUntil = cooldownMs > 0 ? Date.now() + cooldownMs : 0;
    this.rejectPending(failure);
  }

  private handleReply(reply: WorkerReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    this.pending.delete(reply.id);
    if (reply.type === "error") { pending.reject(new Error(reply.message)); return; }
    if (reply.type === "ready") {
      this.readyState = true;
      this.activeRecords = reply.records;
    }
    pending.resolve(reply);
  }
}
