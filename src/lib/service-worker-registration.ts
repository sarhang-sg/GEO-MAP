const REGISTRATION_RETRYABLE_PATTERNS = [
  /not found/iu,
  /failed to update a serviceworker/iu,
  /script.*unknown/iu,
  /404/iu
];

export type ServiceWorkerRegistrationResult = {
  registration: ServiceWorkerRegistration | null;
  transientUnavailable: boolean;
  error: unknown | null;
};

export function serviceWorkerScriptUrl(): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL("sw.js", base).toString();
}

export function serviceWorkerScope(): string {
  const base = new URL(import.meta.env.BASE_URL, window.location.origin);
  return base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
}

export function isTransientServiceWorkerAvailabilityError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return REGISTRATION_RETRYABLE_PATTERNS.some((pattern) => pattern.test(text));
}

async function existingRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration(serviceWorkerScope())) ?? null;
  } catch {
    return null;
  }
}

function registrationUsesCurrentScript(registration: ServiceWorkerRegistration): boolean {
  const expected = serviceWorkerScriptUrl();
  return [registration.installing, registration.waiting, registration.active]
    .some((worker) => worker?.scriptURL === expected);
}

/** Single registration owner shared by early bootstrap and the runtime controller. */
export async function ensureServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationResult> {
  const existing = await existingRegistration();
  if (existing && registrationUsesCurrentScript(existing)) {
    return { registration: existing, transientUnavailable: false, error: null };
  }
  try {
    const registration = await navigator.serviceWorker.register(serviceWorkerScriptUrl(), {
      scope: serviceWorkerScope(),
      updateViaCache: "none"
    });
    return { registration, transientUnavailable: false, error: null };
  } catch (error) {
    return {
      registration: null,
      transientUnavailable: isTransientServiceWorkerAvailabilityError(error),
      error
    };
  }
}
