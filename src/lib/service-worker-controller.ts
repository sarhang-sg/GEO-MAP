import { APP_VERSION } from "./release";
import { recordRuntimeDiagnostic } from "./runtime-diagnostics";
import { ensureServiceWorkerRegistration, isTransientServiceWorkerAvailabilityError } from "./service-worker-registration";

export type ServiceWorkerRuntimeSnapshot = {
  supported: boolean;
  registered: boolean;
  controlling: boolean;
  updateReady: boolean;
  activationPending: boolean;
  lastUpdateCheckAt: number;
  error: string | null;
};

type ServiceWorkerControllerOptions = {
  isSafeToActivate: () => boolean;
  onStateChange?: (snapshot: ServiceWorkerRuntimeSnapshot) => void;
};

const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const VISIBILITY_RECHECK_MS = 30 * 60 * 1000;
const BACKGROUND_SYNC_TAG = "nav-kurd-runtime-sync";
const PERIODIC_SYNC_TAG = "nav-kurd-periodic-refresh";
const PERIODIC_SYNC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;
const INACTIVE_CACHE_TRIM_THRESHOLD_MS = 10 * 60 * 1000;

type SyncManagerLike = { register: (tag: string) => Promise<void> };
type PeriodicSyncManagerLike = { register: (tag: string, options: { minInterval: number }) => Promise<void> };
type ExtendedServiceWorkerRegistration = ServiceWorkerRegistration & {
  sync?: SyncManagerLike;
  periodicSync?: PeriodicSyncManagerLike;
};

export class ServiceWorkerController {
  private readonly options: ServiceWorkerControllerOptions;
  private registration: ServiceWorkerRegistration | null = null;
  private waitingWorker: ServiceWorker | null = null;
  private activationRetryTimer: number | null = null;
  private registrationRetryTimer: number | null = null;
  private updateRetryTimer: number | null = null;
  private updateIntervalTimer: number | null = null;
  private cacheMaintenanceTimer: number | null = null;
  private initialUpdateTimer: number | null = null;
  private disposed = false;
  private registerPromise: Promise<void> | null = null;
  private globalEventsBound = false;
  private lastCacheMaintenanceAt = 0;
  private hiddenAt = document.hidden ? Date.now() : 0;
  private resilienceTasksRegistered = false;
  private registrationRetryCount = 0;
  private updateRetryCount = 0;
  private readonly handleControllerChange = (): void => {
    this.snapshotState.controlling = Boolean(navigator.serviceWorker.controller);
    this.snapshotState.activationPending = false;
    this.snapshotState.updateReady = false;
    this.waitingWorker = null;
    this.resilienceTasksRegistered = false;
    this.emit();
    void this.registerResilienceTasks();
  };
  private readonly handleServiceWorkerMessage = (event: MessageEvent): void => {
    if (event.data?.type === "NAV_KURD_SW_ACTIVATED") {
      this.snapshotState.controlling = true;
      this.emit();
    }
  };
  private readonly handleOnline = (): void => {
    void this.checkForUpdates();
    this.requestCacheMaintenance(0);
  };
  private readonly handleVisibilityChange = (): void => {
    if (document.hidden) {
      if (!this.hiddenAt) this.hiddenAt = Date.now();
      this.tryActivateWaitingWorker();
      return;
    }
    const inactiveForMs = this.hiddenAt ? Math.max(0, Date.now() - this.hiddenAt) : 0;
    this.hiddenAt = 0;
    if (Date.now() - this.snapshotState.lastUpdateCheckAt >= VISIBILITY_RECHECK_MS) {
      void this.checkForUpdates();
    }
    this.requestCacheMaintenance(inactiveForMs);
    this.tryActivateWaitingWorker();
  };

  private snapshotState: ServiceWorkerRuntimeSnapshot = {
    supported: "serviceWorker" in navigator,
    registered: false,
    controlling: Boolean(navigator.serviceWorker?.controller),
    updateReady: false,
    activationPending: false,
    lastUpdateCheckAt: 0,
    error: null
  };

  constructor(options: ServiceWorkerControllerOptions) {
    this.options = options;
  }

  snapshot(): ServiceWorkerRuntimeSnapshot {
    return { ...this.snapshotState };
  }

  start(): void {
    if (this.disposed || !this.snapshotState.supported || this.registration || this.registerPromise) return;
    this.registerPromise = this.register().finally(() => {
      this.registerPromise = null;
    });
  }

  async checkForUpdates(): Promise<void> {
    if (this.disposed || !this.registration) return;
    const now = Date.now();
    this.snapshotState.lastUpdateCheckAt = now;
    this.emit();
    try {
      await this.registration.update();
      this.updateRetryCount = 0;
      if (this.updateRetryTimer !== null) window.clearTimeout(this.updateRetryTimer);
      this.updateRetryTimer = null;
    } catch (error) {
      if (isTransientServiceWorkerAvailabilityError(error)) {
        this.snapshotState.error = null;
        this.emit();
        this.scheduleUpdateRetry();
        return;
      }
      this.recordError(error);
    }
  }

  private async register(): Promise<void> {
    const bootstrap = window.__NAV_KURD_SW_REGISTRATION__;
    const result = bootstrap ? await bootstrap : await ensureServiceWorkerRegistration();
    window.__NAV_KURD_SW_REGISTRATION__ = undefined;

    if (!result.registration) {
      this.registration = null;
      this.snapshotState.registered = false;
      this.snapshotState.controlling = Boolean(navigator.serviceWorker.controller);
      if (result.transientUnavailable) {
        // A deployment edge can briefly serve the new HTML before sw.js is
        // globally available. Keep the current page usable and retry quietly.
        this.snapshotState.error = null;
        this.emit();
      } else if (result.error) {
        this.recordError(result.error);
      }
      this.scheduleRegistrationRetry();
      return;
    }

    this.registration = result.registration;
    this.registrationRetryCount = 0;
    if (this.registrationRetryTimer !== null) window.clearTimeout(this.registrationRetryTimer);
    this.registrationRetryTimer = null;
    this.snapshotState.registered = true;
    this.snapshotState.controlling = Boolean(navigator.serviceWorker.controller);
    this.snapshotState.error = null;
    this.emit();
    this.bindRegistration(this.registration);
    this.bindGlobalEvents();
    if (this.registration.waiting) this.markUpdateReady(this.registration.waiting);
    await this.registerResilienceTasks();
    // Registration already performs the network fetch. Delay the first update
    // check so boot never issues a duplicate request for the same sw.js.
    this.initialUpdateTimer = window.setTimeout(() => {
      this.initialUpdateTimer = null;
      if (!this.disposed) void this.checkForUpdates();
    }, 12_000);
    this.requestCacheMaintenance(0);
    if (this.updateIntervalTimer === null) {
      this.updateIntervalTimer = window.setInterval(() => { void this.checkForUpdates(); }, UPDATE_INTERVAL_MS);
    }
    if (this.cacheMaintenanceTimer === null) {
      this.cacheMaintenanceTimer = window.setInterval(() => this.requestCacheMaintenance(), CACHE_MAINTENANCE_INTERVAL_MS);
    }
  }

  private isOptionalCapabilityError(error: unknown): boolean {
    return error instanceof DOMException
      && [
        "InvalidStateError",
        "NotSupportedError",
        "SecurityError",
        "NotAllowedError",
        "UnknownError",
        "AbortError"
      ].includes(error.name);
  }

  private async activeRegistration(): Promise<ExtendedServiceWorkerRegistration | null> {
    if (!this.registration) return null;
    if (this.registration.active) return this.registration as ExtendedServiceWorkerRegistration;
    try {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 4_000))
      ]);
      return ready && ready.active ? ready as ExtendedServiceWorkerRegistration : null;
    } catch {
      return null;
    }
  }

  private async registerResilienceTasks(): Promise<void> {
    if (this.resilienceTasksRegistered) return;
    const registration = await this.activeRegistration();
    if (!registration?.active) return;

    if (registration.sync) {
      try {
        await registration.sync.register(BACKGROUND_SYNC_TAG);
      } catch (error) {
        if (!this.isOptionalCapabilityError(error)) recordRuntimeDiagnostic("service-worker.background-sync", error, "warning");
      }
    }

    if (registration.periodicSync && "permissions" in navigator) {
      try {
        const status = await navigator.permissions.query({ name: "periodic-background-sync" } as unknown as PermissionDescriptor);
        if (status.state === "granted") {
          await registration.periodicSync.register(PERIODIC_SYNC_TAG, { minInterval: PERIODIC_SYNC_MIN_INTERVAL_MS });
        }
      } catch (error) {
        if (!this.isOptionalCapabilityError(error)) recordRuntimeDiagnostic("service-worker.periodic-sync", error, "warning");
      }
    }
    this.resilienceTasksRegistered = true;
  }

  private bindRegistration(registration: ServiceWorkerRegistration): void {
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          this.markUpdateReady(registration.waiting || worker);
        }
      });
    });
  }

  private bindGlobalEvents(): void {
    if (this.globalEventsBound) return;
    this.globalEventsBound = true;
    navigator.serviceWorker.addEventListener("controllerchange", this.handleControllerChange);
    navigator.serviceWorker.addEventListener("message", this.handleServiceWorkerMessage);
    window.addEventListener("online", this.handleOnline, { passive: true });
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.globalEventsBound) {
      navigator.serviceWorker.removeEventListener("controllerchange", this.handleControllerChange);
      navigator.serviceWorker.removeEventListener("message", this.handleServiceWorkerMessage);
      window.removeEventListener("online", this.handleOnline);
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
      this.globalEventsBound = false;
    }
    for (const timer of [this.activationRetryTimer, this.registrationRetryTimer, this.updateRetryTimer, this.initialUpdateTimer]) {
      if (timer !== null) window.clearTimeout(timer);
    }
    if (this.updateIntervalTimer !== null) window.clearInterval(this.updateIntervalTimer);
    if (this.cacheMaintenanceTimer !== null) window.clearInterval(this.cacheMaintenanceTimer);
    this.activationRetryTimer = null;
    this.registrationRetryTimer = null;
    this.updateRetryTimer = null;
    this.initialUpdateTimer = null;
    this.updateIntervalTimer = null;
    this.cacheMaintenanceTimer = null;
    this.waitingWorker = null;
  }

  private scheduleRegistrationRetry(): void {
    if (this.registrationRetryTimer !== null || this.registration) return;
    const delay = Math.min(5 * 60_000, 15_000 * 2 ** Math.min(this.registrationRetryCount, 4));
    this.registrationRetryCount += 1;
    this.registrationRetryTimer = window.setTimeout(() => {
      this.registrationRetryTimer = null;
      this.start();
    }, delay);
  }

  private scheduleUpdateRetry(): void {
    if (this.updateRetryTimer !== null || !this.registration) return;
    const delay = Math.min(5 * 60_000, 15_000 * 2 ** Math.min(this.updateRetryCount, 4));
    this.updateRetryCount += 1;
    this.updateRetryTimer = window.setTimeout(() => {
      this.updateRetryTimer = null;
      void this.checkForUpdates();
    }, delay);
  }

  private requestCacheMaintenance(inactiveForMs = 0): void {
    const now = Date.now();
    const returningAfterLongAbsence = inactiveForMs >= INACTIVE_CACHE_TRIM_THRESHOLD_MS;
    if (!returningAfterLongAbsence && now - this.lastCacheMaintenanceAt < CACHE_MAINTENANCE_INTERVAL_MS) return;
    const worker = navigator.serviceWorker.controller ?? this.registration?.active;
    if (!worker) return;
    this.lastCacheMaintenanceAt = now;
    worker.postMessage({ type: "MAINTAIN_RUNTIME_CACHES", requestedBy: APP_VERSION, inactiveForMs });
  }

  private markUpdateReady(worker: ServiceWorker): void {
    this.waitingWorker = worker;
    this.snapshotState.updateReady = true;
    this.emit();
    this.tryActivateWaitingWorker();
  }

  private tryActivateWaitingWorker(): void {
    if (!this.waitingWorker || !this.snapshotState.updateReady) return;
    if (!this.options.isSafeToActivate()) {
      this.scheduleActivationRetry();
      return;
    }
    this.snapshotState.activationPending = true;
    this.emit();
    this.waitingWorker.postMessage({ type: "SKIP_WAITING", requestedBy: APP_VERSION });
  }

  private scheduleActivationRetry(): void {
    if (this.activationRetryTimer !== null) return;
    this.activationRetryTimer = window.setTimeout(() => {
      this.activationRetryTimer = null;
      this.tryActivateWaitingWorker();
    }, 30_000);
  }

  private recordError(error: unknown): void {
    this.snapshotState.error = error instanceof Error ? error.message : String(error);
    this.emit();
    recordRuntimeDiagnostic("service-worker", error, "warning");
  }

  private emit(): void {
    if (!this.disposed) this.options.onStateChange?.(this.snapshot());
  }
}
