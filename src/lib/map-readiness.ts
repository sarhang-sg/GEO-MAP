import type { Map as MapLibreMap } from "maplibre-gl";

/** One bounded, cancellable listener group for a map's initial readiness event. */
export function waitForMapReadiness(
  map: MapLibreMap,
  events: readonly ("render" | "load" | "style.load")[],
  isReady: () => boolean,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (isReady()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      for (const event of events) map.off(event, onReady);
      signal?.removeEventListener("abort", onAbort);
      if (error !== undefined) reject(error);
      else resolve();
    };
    const onReady = (): void => finish();
    const onAbort = (): void => finish(signal?.reason ?? new Error("Map readiness cancelled"));
    const timer = window.setTimeout(() => finish(new Error("Map readiness timed out")), 30_000);
    for (const event of events) map.on(event, onReady);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else if (isReady()) finish();
  });
}
