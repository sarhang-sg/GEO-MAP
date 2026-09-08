export class ServiceError extends Error {
  readonly status?: number;
  readonly resource: string;
  readonly offline: boolean;

  constructor(message: string, options: { resource: string; status?: number; offline?: boolean; cause?: unknown }) {
    super(message);
    this.name = "ServiceError";
    this.status = options.status;
    this.resource = options.resource;
    this.offline = Boolean(options.offline);
    this.cause = options.cause;
  }
}


export function isAbortError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "name" in error
    && (error as { name?: unknown }).name === "AbortError"
  );
}

function networkOffline(): boolean {
  return typeof navigator !== "undefined" && "onLine" in navigator && !navigator.onLine;
}

export function serviceErrorMessage(error: unknown, fallback = "Service request failed."): string {
  if (error instanceof ServiceError) return fallback;
  if (error instanceof Error && error.message.trim()) return fallback;
  if (typeof error === "string" && error.trim()) return fallback;
  return fallback;
}

export async function fetchJson<T>(resource: string, init: RequestInit = {}, label = resource): Promise<T> {
  try {
    const response = await fetch(resource, {
      credentials: "same-origin",
      cache: init.cache ?? "no-cache",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      throw new ServiceError(`${label} request failed (${response.status}).`, {
        resource,
        status: response.status,
        offline: networkOffline()
      });
    }
    return (await response.json()) as T;
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof ServiceError) throw error;
    const offline = networkOffline();
    throw new ServiceError(offline ? `${label} is offline.` : `${label} could not be loaded.`, {
      resource,
      offline,
      cause: error
    });
  }
}
