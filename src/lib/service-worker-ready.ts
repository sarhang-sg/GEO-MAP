/** Registration discovery also needs a deadline: ready can remain pending forever. */
export function waitForServiceWorkerReady(
  ready: Promise<ServiceWorkerRegistration>,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = (): void => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new DOMException("Offline worker registration timed out", "TimeoutError"));
    }, timeoutMs);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    ready.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
