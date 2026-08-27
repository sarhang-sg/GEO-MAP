export type RuntimeLoadState = "booting" | "map-first-frame" | "interactive" | "ready" | "error";
export type RuntimeNetworkState = "online" | "offline" | "restored";
export type RuntimeUpdateState = "idle" | "available" | "applying" | "failed";

const LOAD_ORDER: Record<Exclude<RuntimeLoadState, "error">, number> = {
  booting: 0,
  "map-first-frame": 1,
  interactive: 2,
  ready: 3
};

/**
 * Single owner for boot, network and service-worker update state.
 * Visual selectors keep the stable data-load-state/data-network-state contract,
 * while detailed states are exposed separately for diagnostics and tests.
 */
export class RuntimeStateController {
  private loadState: RuntimeLoadState = "booting";
  private networkState: RuntimeNetworkState;
  private updateState: RuntimeUpdateState = "idle";

  constructor(private readonly shell: HTMLElement) {
    this.networkState = navigator.onLine === false ? "offline" : "online";
    this.commit();
  }

  markMapFirstFrame(): void { this.setLoadState("map-first-frame"); }
  markInteractive(): void { this.setLoadState("interactive"); }
  markReady(): void { this.setLoadState("ready"); }
  fail(): void { this.setLoadState("error"); }

  setNetworkState(state: RuntimeNetworkState): void {
    this.networkState = state;
    this.commit();
  }

  setUpdateState(state: RuntimeUpdateState): void {
    this.updateState = state;
    this.commit();
  }

  snapshot(): { load: RuntimeLoadState; network: RuntimeNetworkState; update: RuntimeUpdateState } {
    return { load: this.loadState, network: this.networkState, update: this.updateState };
  }

  private setLoadState(next: RuntimeLoadState): void {
    if (this.loadState === "error" && next !== "error") return;
    if (next !== "error" && this.loadState !== "error" && LOAD_ORDER[next] < LOAD_ORDER[this.loadState]) return;
    this.loadState = next;
    this.commit();
  }

  private commit(): void {
    this.shell.dataset.runtimeLoadState = this.loadState;
    this.shell.dataset.loadState = this.loadState === "ready" ? "ready" : this.loadState === "error" ? "error" : "loading";
    this.shell.dataset.networkState = this.networkState;
    this.shell.dataset.updateState = this.updateState;
    this.shell.setAttribute("aria-busy", this.loadState === "ready" || this.loadState === "error" ? "false" : "true");
  }
}
