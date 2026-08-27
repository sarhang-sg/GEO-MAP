type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
type IdleRequestCallbackLike = (deadline: IdleDeadlineLike) => void;
type WindowWithIdleCallbacks = Window & typeof globalThis & {
  requestIdleCallback?: (callback: IdleRequestCallbackLike, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};
type NavigatorScheduling = Navigator & { scheduling?: { isInputPending?: () => boolean } };
type IdleTask = { id: number; task: () => void | Promise<void>; timeout: number; cancelled: boolean };

const idleWindow = window as WindowWithIdleCallbacks;
const idleQueue: IdleTask[] = [];
let idleTaskSequence = 0;
let idleQueueRunning = false;

function scheduleQueueTurn(callback: () => void, timeout: number): () => void {
  if (typeof idleWindow.requestIdleCallback === "function") {
    const handle = idleWindow.requestIdleCallback(() => callback(), { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }
  const handle = window.setTimeout(callback, Math.min(timeout, 900));
  return () => window.clearTimeout(handle);
}

function pumpIdleQueue(): void {
  if (idleQueueRunning) return;
  const entry = idleQueue.find((candidate) => !candidate.cancelled);
  if (!entry) return;
  idleQueueRunning = true;

  scheduleQueueTurn(() => {
    if (entry.cancelled) {
      idleQueue.splice(idleQueue.indexOf(entry), 1);
      idleQueueRunning = false;
      pumpIdleQueue();
      return;
    }
    const inputPending = (navigator as NavigatorScheduling).scheduling?.isInputPending?.() === true;
    if (document.hidden || inputPending) {
      idleQueueRunning = false;
      window.setTimeout(pumpIdleQueue, document.hidden ? 600 : 120);
      return;
    }

    idleQueue.splice(idleQueue.indexOf(entry), 1);
    Promise.resolve().then(entry.task).catch(() => undefined).finally(() => {
      idleQueueRunning = false;
      // Leave a frame between optional tasks so map input/rendering can win.
      window.requestAnimationFrame(() => window.setTimeout(pumpIdleQueue, 40));
    });
  }, entry.timeout);
}

/**
 * Runs optional work through one cooperative queue. Tasks pause while the page
 * is hidden or user input is pending, and never start in parallel. This keeps
 * map gestures, language switching and GPS work ahead of non-critical warming.
 */
export function scheduleIdleTask(task: () => void | Promise<void>, timeout = 1600): () => void {
  const entry: IdleTask = { id: ++idleTaskSequence, task, timeout, cancelled: false };
  idleQueue.push(entry);
  pumpIdleQueue();
  return () => { entry.cancelled = true; };
}
type SchedulerWithYield = { yield?: () => Promise<void> };

/**
 * Cooperatively returns control to input, animation and MapLibre rendering.
 * scheduler.yield() is preferred when available; the zero-delay task fallback
 * keeps the same semantics in older Android/WebView engines.
 */
export async function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & { scheduler?: SchedulerWithYield }).scheduler;
  if (typeof scheduler?.yield === "function") {
    await scheduler.yield();
    return;
  }
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}

export function debounceAsync<T extends unknown[]>(callback: (...args: T) => Promise<void> | void, delay = 100): (...args: T) => void {
  let timer: number | null = null;
  return (...args: T) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void callback(...args);
    }, delay);
  };
}

type RuntimePerformanceGuardOptions = {
  map: { getCanvas: () => HTMLCanvasElement; resize: () => void; triggerRepaint: () => void };
  shell: HTMLElement;
  onRecovered?: () => void;
};

export const RUNTIME_PERFORMANCE_MODE_EVENT = "nav-kurd:performance-mode";

/**
 * Runtime guard for weak/old devices. It preserves layout and colors, and only
 * reduces expensive motion/glow work after sustained frame drops or long tasks.
 * The observers are event-driven, so diagnostics add no permanent RAF sampler.
 */
export function installRuntimePerformanceGuard(options: RuntimePerformanceGuardOptions): () => void {
  const { map, shell, onRecovered } = options;
  let stopped = false;
  const observers: PerformanceObserver[] = [];
  let recoveryTimer: number | null = null;
  let degradedUntil = 0;
  let longTaskCount = 0;
  let longestLongTask = 0;
  let longAnimationFrameCount = 0;
  let longestAnimationFrame = 0;
  const runtimeReady = (): boolean => shell.dataset.loadState === "ready";

  const setDiagnosticNumber = (key: string, value: number): void => {
    const next = String(Math.round(value));
    if (shell.dataset[key] !== next) shell.dataset[key] = next;
  };

  const apply = (degraded: boolean): void => {
    if (stopped) return;
    const changed = shell.classList.contains("is-runtime-low-power") !== degraded;
    shell.classList.toggle("is-runtime-low-power", degraded);
    shell.dataset.runtimePerformance = degraded ? "reduced" : "normal";
    if (changed) {
      document.dispatchEvent(new CustomEvent(RUNTIME_PERFORMANCE_MODE_EVENT, { detail: { degraded } }));
    }
  };
  const scheduleRecovery = (): void => {
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    recoveryTimer = window.setTimeout(() => {
      recoveryTimer = null;
      if (!stopped && performance.now() >= degradedUntil) apply(false);
    }, Math.max(250, degradedUntil - performance.now()));
  };
  const degrade = (durationMs = 15_000): void => {
    if (!runtimeReady() || stopped) return;
    degradedUntil = Math.max(degradedUntil, performance.now() + durationMs);
    apply(true);
    scheduleRecovery();
  };

  try {
    if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskCount += 1;
          longestLongTask = Math.max(longestLongTask, entry.duration);
        }
        setDiagnosticNumber("longTaskCount", longTaskCount);
        setDiagnosticNumber("longestLongTaskMs", longestLongTask);
        const longest = list.getEntries().reduce((maximum, entry) => Math.max(maximum, entry.duration), 0);
        if (longest >= 180) degrade(20_000);
        else if (longest >= 90) degrade(12_000);
      });
      observer.observe({ entryTypes: ["longtask"] });
      observers.push(observer);
    }

    if ("PerformanceObserver" in window && PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longAnimationFrameCount += 1;
          longestAnimationFrame = Math.max(longestAnimationFrame, entry.duration);
        }
        setDiagnosticNumber("longAnimationFrameCount", longAnimationFrameCount);
        setDiagnosticNumber("longestAnimationFrameMs", longestAnimationFrame);
        const longest = list.getEntries().reduce((maximum, entry) => Math.max(maximum, entry.duration), 0);
        if (longest >= 250) degrade(20_000);
        else if (longest >= 120) degrade(12_000);
      });
      observer.observe({ entryTypes: ["long-animation-frame"] });
      observers.push(observer);
    }
  } catch {
    observers.forEach((observer) => observer.disconnect());
    observers.length = 0;
  }

  const canvas = map.getCanvas();
  const onContextLost = (event: Event): void => {
    event.preventDefault();
    shell.dataset.webglContext = "lost";
    degrade(30_000);
  };
  const onContextRestored = (): void => {
    shell.dataset.webglContext = "restored";
    window.setTimeout(() => {
      if (stopped) return;
      map.resize();
      map.triggerRepaint();
      onRecovered?.();
      shell.dataset.webglContext = "ready";
    }, 80);
  };
  canvas.addEventListener("webglcontextlost", onContextLost, false);
  canvas.addEventListener("webglcontextrestored", onContextRestored, false);

  return () => {
    stopped = true;
    if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
    observers.forEach((observer) => observer.disconnect());
    canvas.removeEventListener("webglcontextlost", onContextLost, false);
    canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
  };
}
