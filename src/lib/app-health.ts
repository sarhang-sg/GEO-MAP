import { UI } from "./i18n";
import { languageDirection } from "./i18n";
import type { Language } from "./types";
import { ServiceError, serviceErrorMessage } from "./service-state";
import { recordRuntimeDiagnostic } from "./runtime-diagnostics";
import type { RuntimeStateController } from "./runtime-state";

export type AppHealthLevel = "ready" | "warning" | "error" | "offline";
export type NetworkVisualState = "online" | "offline" | "restored";

export type AppHealthControllerOptions = {
  container: HTMLElement;
  mapShell: HTMLElement;
  runtimeState: RuntimeStateController;
  getLanguage: () => Language;
  setMessage: (value: string, kind?: "normal" | "error" | "success") => void;
  setStatus: (kind: "loading" | "ready" | "error", label: string) => void;
};

export class AppHealthController {
  private readonly container: HTMLElement;
  private readonly mapShell: HTMLElement;
  private readonly getLanguage: () => Language;
  private readonly runtimeState: RuntimeStateController;
  private readonly setMessage: AppHealthControllerOptions["setMessage"];
  private readonly setStatus: AppHealthControllerOptions["setStatus"];
  private readonly dismissDelay = 4200;
  private readonly restoredVisualDuration = 1600;
  private clearTimer: number | null = null;
  private networkVisualTimer: number | null = null;
  private nativeConnected: boolean | null = null;
  private disposed = false;
  private readonly handleOffline = (): void => this.offline();
  private readonly handleOnline = (): void => this.online();
  private readonly handleNativeNetwork = (event: Event): void => {
    const connected = Boolean((event as CustomEvent<{ connected?: boolean }>).detail?.connected);
    const changed = this.nativeConnected !== null && this.nativeConnected !== connected;
    this.nativeConnected = connected;
    if (!connected) this.offline();
    else if (changed || this.mapShell.dataset.health === "offline") this.online();
    else this.setNetworkVisualState("online");
  };

  constructor(options: AppHealthControllerOptions) {
    this.container = options.container;
    this.mapShell = options.mapShell;
    this.getLanguage = options.getLanguage;
    this.runtimeState = options.runtimeState;
    this.setMessage = options.setMessage;
    this.setStatus = options.setStatus;
    const initiallyOffline = typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine;
    this.setNetworkVisualState(initiallyOffline ? "offline" : "online");
    this.installNetworkListeners();
    this.installGlobalErrorListeners();
    if (initiallyOffline) this.offline(false);
  }

  refreshLanguage(): void {
    if (!this.container.hidden) this.container.dir = languageDirection(this.getLanguage());
  }

  ready(message?: string): void {
    this.mapShell.dataset.health = "ready";
    if (message) this.show("ready", message, true);
  }

  warn(message: string, sticky = false): void {
    this.mapShell.dataset.health = "warning";
    this.show("warning", message, sticky);
  }

  warnSilently(message: string): void {
    // Optional/background failures belong in the diagnostic report, not in the
    // user-facing connection state and not as noisy production-console output.
    recordRuntimeDiagnostic("app-health.background", message, "warning");
  }

  fail(error: unknown, fallback?: string): void {
    const language = this.getLanguage();
    const message = serviceErrorMessage(error, fallback ?? UI[language].mapLoadError);
    this.mapShell.dataset.health = error instanceof ServiceError && error.offline ? "offline" : "error";
    if (this.mapShell.dataset.health === "offline") this.setNetworkVisualState("offline");
    this.setStatus("error", UI[language].statusError);
    this.setMessage(message, "error");
    this.show(this.mapShell.dataset.health === "offline" ? "offline" : "error", message, true);
  }

  offline(sticky = true): void {
    const language = this.getLanguage();
    const text = UI[language].offline;
    this.setNetworkVisualState("offline");
    this.mapShell.dataset.health = "offline";
    this.show("offline", text, sticky);
  }

  private online(): void {
    const language = this.getLanguage();
    this.setNetworkVisualState("restored");
    this.mapShell.dataset.health = "ready";
    this.show("ready", UI[language].online, false);
    this.networkVisualTimer = window.setTimeout(() => {
      this.networkVisualTimer = null;
      if (this.nativeConnected !== false && navigator.onLine !== false) this.setNetworkVisualState("online");
    }, this.restoredVisualDuration);
  }

  private setNetworkVisualState(state: NetworkVisualState): void {
    if (this.networkVisualTimer !== null) {
      window.clearTimeout(this.networkVisualTimer);
      this.networkVisualTimer = null;
    }
    this.runtimeState.setNetworkState(state);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("nav-kurd:native-network", this.handleNativeNetwork);
    if (this.clearTimer !== null) window.clearTimeout(this.clearTimer);
    if (this.networkVisualTimer !== null) window.clearTimeout(this.networkVisualTimer);
    this.clearTimer = null;
    this.networkVisualTimer = null;
  }

  private installNetworkListeners(): void {
    window.addEventListener("offline", this.handleOffline, { passive: true });
    window.addEventListener("online", this.handleOnline, { passive: true });
    window.addEventListener("nav-kurd:native-network", this.handleNativeNetwork);
  }

  private installGlobalErrorListeners(): void {
    // RuntimeDiagnostics owns global error/rejection capture once. Duplicating
    // listeners here used to turn optional failures into a misleading reconnect
    // state and duplicate the same issue in the console.
  }

  private show(level: AppHealthLevel, message: string, sticky: boolean): void {
    if (this.clearTimer !== null) window.clearTimeout(this.clearTimer);
    this.container.hidden = false;
    this.container.dataset.level = level;
    this.container.dir = languageDirection(this.getLanguage());
    this.container.textContent = message;
    if (!sticky) {
      this.clearTimer = window.setTimeout(() => {
        this.container.hidden = true;
        this.clearTimer = null;
      }, this.dismissDelay);
    }
  }
}
