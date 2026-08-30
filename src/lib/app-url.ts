/** Resolve an application-owned path against Vite's deployment base URL. */
export function appUrl(path: string): string {
  const baseUrl = import.meta.env.BASE_URL || "/";
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${path.replace(/^\/+/, "")}`;
}

const CANONICAL_APP_URL = "https://geo-map-kappa.vercel.app/";

export function safeUrl(value: string, base?: string): URL | null {
  try {
    return base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
}

export function documentBaseUrl(): string {
  if (typeof window !== "undefined") {
    const current = safeUrl(window.location.href);
    if (current && ["http:", "https:"].includes(current.protocol)) return current.toString();
  }
  return CANONICAL_APP_URL;
}

export function absoluteAppUrl(path: string): string {
  return safeUrl(appUrl(path), documentBaseUrl())?.toString()
    ?? safeUrl(path.replace(/^\/+/, ""), CANONICAL_APP_URL)?.toString()
    ?? CANONICAL_APP_URL;
}
