import type { Map as MapLibreMap } from "maplibre-gl";

export type MapAnimationTaskPriority = "operational" | "visual";

export type MapAnimationTaskOptions = {
  id: string;
  intervalMs: number;
  priority?: MapAnimationTaskPriority;
  pauseDuringInteraction?: boolean;
  run: (now: number) => boolean | void;
};

export type MapAnimationHandle = {
  start: () => void;
  stop: () => void;
  destroy: () => void;
  setInterval: (intervalMs: number) => void;
  isRunning: () => boolean;
};

type ScheduledTask = {
  id: string;
  intervalMs: number;
  priority: MapAnimationTaskPriority;
  pauseDuringInteraction: boolean;
  run: (now: number) => boolean | void;
  active: boolean;
  lastRunAt: number;
};

type MapAnimationSchedulerOptions = {
  map: MapLibreMap;
  diagnosticsHost?: HTMLElement;
  isConstrained?: () => boolean;
};

const MIN_INTERVAL_MS = 32;
const NORMAL_FRAME_BUDGET_MS = 7;
const CONSTRAINED_FRAME_BUDGET_MS = 5;
const MAX_SLEEP_MS = 250;
const RUNTIME_PERFORMANCE_MODE_EVENT = "nav-kurd:performance-mode";

/**
 * One cooperative animation owner for all continuously animated MapLibre paint
 * properties. A timeout sleeps until the next task is due and a single RAF then
 * batches every due paint update into the same browser frame.
 *
 * This removes competing permanent RAF loops, pauses decorative work during map
 * gestures/hidden-tab periods and preserves the exact visual expressions used by
 * each controller.
 */
export class MapAnimationScheduler {
  private readonly map: MapLibreMap;
  private readonly isConstrained: () => boolean;
  private readonly diagnosticsHost?: HTMLElement;
  private readonly tasks = new Map<string, ScheduledTask>();
  private raf: number | null = null;
  private timer: number | null = null;
  private interacting = false;
  private destroyed = false;

  constructor(options: MapAnimationSchedulerOptions) {
    this.map = options.map;
    this.diagnosticsHost = options.diagnosticsHost;
    this.isConstrained = options.isConstrained ?? (() => false);
    this.map.on("movestart", this.onInteractionStart);
    this.map.on("zoomstart", this.onInteractionStart);
    this.map.on("rotatestart", this.onInteractionStart);
    this.map.on("pitchstart", this.onInteractionStart);
    this.map.on("moveend", this.onInteractionEnd);
    this.map.on("zoomend", this.onInteractionEnd);
    this.map.on("rotateend", this.onInteractionEnd);
    this.map.on("pitchend", this.onInteractionEnd);
    document.addEventListener("visibilitychange", this.onVisibilityChange, { passive: true });
    document.addEventListener(RUNTIME_PERFORMANCE_MODE_EVENT, this.onPerformanceModeChange);
    this.syncDiagnostics();
  }

  register(options: MapAnimationTaskOptions): MapAnimationHandle {
    if (this.tasks.has(options.id)) throw new Error(`Map animation task id is duplicated: ${options.id}`);
    const task: ScheduledTask = {
      id: options.id,
      intervalMs: Math.max(MIN_INTERVAL_MS, options.intervalMs),
      priority: options.priority ?? "visual",
      pauseDuringInteraction: options.pauseDuringInteraction !== false,
      run: options.run,
      active: false,
      lastRunAt: 0
    };
    this.tasks.set(task.id, task);

    return {
      start: () => {
        if (this.destroyed || task.active) return;
        task.active = true;
        task.lastRunAt = 0;
        this.syncDiagnostics();
        this.schedule();
      },
      stop: () => {
        if (!task.active) return;
        task.active = false;
        task.lastRunAt = 0;
        this.syncDiagnostics();
        this.schedule();
      },
      destroy: () => {
        task.active = false;
        this.tasks.delete(task.id);
        this.syncDiagnostics();
        this.schedule();
      },
      setInterval: (intervalMs: number) => {
        task.intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs);
        this.schedule();
      },
      isRunning: () => task.active
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelScheduledTurn();
    this.tasks.clear();
    this.syncDiagnostics();
    this.map.off("movestart", this.onInteractionStart);
    this.map.off("zoomstart", this.onInteractionStart);
    this.map.off("rotatestart", this.onInteractionStart);
    this.map.off("pitchstart", this.onInteractionStart);
    this.map.off("moveend", this.onInteractionEnd);
    this.map.off("zoomend", this.onInteractionEnd);
    this.map.off("rotateend", this.onInteractionEnd);
    this.map.off("pitchend", this.onInteractionEnd);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    document.removeEventListener(RUNTIME_PERFORMANCE_MODE_EVENT, this.onPerformanceModeChange);
  }

  private readonly onInteractionStart = (event: { originalEvent?: Event }): void => {
    // User gestures are recorded separately for diagnostics. Decorative paint
    // work also pauses while MapLibre reports any camera motion, including GPS
    // follow/ease operations, so camera rendering remains the highest priority.
    if (!event.originalEvent) return;
    this.interacting = true;
    this.syncDiagnostics();
    this.schedule();
  };

  private readonly onInteractionEnd = (): void => {
    // MapLibre can emit overlapping move/zoom/rotate end events. Re-check on the
    // next task so the scheduler does not resume while another gesture is active.
    window.setTimeout(() => {
      if (this.destroyed) return;
      this.interacting = this.map.isMoving();
      this.syncDiagnostics();
      this.schedule();
    }, 0);
  };

  private readonly onVisibilityChange = (): void => {
    this.schedule();
  };

  private readonly onPerformanceModeChange = (): void => {
    this.schedule();
  };

  private syncDiagnostics(): void {
    if (!this.diagnosticsHost) return;
    const active = [...this.tasks.values()].filter((task) => task.active).length;
    this.diagnosticsHost.dataset.animationTaskCount = String(this.tasks.size);
    this.diagnosticsHost.dataset.animationRunningCount = String(active);
    this.diagnosticsHost.dataset.animationInteractionPaused = String(this.interacting);
    this.diagnosticsHost.dataset.animationFrameBudgetMs = String(this.isConstrained() ? CONSTRAINED_FRAME_BUDGET_MS : NORMAL_FRAME_BUDGET_MS);
  }

  private effectiveInterval(task: ScheduledTask): number {
    return task.intervalMs * (this.isConstrained() ? 1.55 : 1);
  }

  private runnableTasks(): ScheduledTask[] {
    if (document.hidden) return [];
    const cameraBusy = this.interacting || this.map.isMoving();
    return [...this.tasks.values()].filter((task) => task.active && !(cameraBusy && task.pauseDuringInteraction));
  }

  private cancelScheduledTurn(): void {
    if (this.raf !== null) window.cancelAnimationFrame(this.raf);
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.raf = null;
    this.timer = null;
  }

  private schedule(): void {
    if (this.destroyed) return;
    this.cancelScheduledTurn();
    const tasks = this.runnableTasks();
    if (!tasks.length) return;

    const now = performance.now();
    let delay = Number.POSITIVE_INFINITY;
    for (const task of tasks) {
      const dueIn = task.lastRunAt <= 0 ? 0 : this.effectiveInterval(task) - (now - task.lastRunAt);
      delay = Math.min(delay, Math.max(0, dueIn));
    }

    const requestFrame = (): void => {
      if (this.destroyed || document.hidden) return;
      this.raf = window.requestAnimationFrame(this.tick);
    };
    if (delay <= 14) requestFrame();
    else this.timer = window.setTimeout(requestFrame, Math.min(MAX_SLEEP_MS, Math.max(8, delay - 5)));
  }

  private readonly tick = (now: number): void => {
    this.raf = null;
    if (this.destroyed || document.hidden) return;
    const tasks = this.runnableTasks()
      .filter((task) => task.lastRunAt <= 0 || now - task.lastRunAt >= this.effectiveInterval(task))
      .sort((left, right) => Number(right.priority === "operational") - Number(left.priority === "operational"));
    const frameStartedAt = performance.now();
    const frameBudgetMs = this.isConstrained() ? CONSTRAINED_FRAME_BUDGET_MS : NORMAL_FRAME_BUDGET_MS;
    for (const task of tasks) {
      const elapsed = performance.now() - frameStartedAt;
      if (task.priority === "visual" && elapsed >= frameBudgetMs) continue;
      task.lastRunAt = now;
      try {
        if (task.run(now) === false) {
          task.active = false;
          task.lastRunAt = 0;
        }
      } catch {
        // A style swap can detach a layer between getLayer() and the paint write.
        // The owning controller restarts the task when its visual state returns.
      }
    }
    if (this.diagnosticsHost) {
      this.diagnosticsHost.dataset.animationLastFrameMs = (performance.now() - frameStartedAt).toFixed(2);
    }
    this.schedule();
  };
}
