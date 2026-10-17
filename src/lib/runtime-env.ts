/**
 * Canonical browser-environment contract.
 *
 * Only variables declared here may be consumed by browser code. Historical
 * aliases and misspellings are intentionally rejected so Vercel configuration
 * errors cannot be hidden by fallback chains.
 */
function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanHttpsUrl(value: unknown): string {
  const candidate = clean(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString().replace(/\/$/u, "") : "";
  } catch {
    return "";
  }
}

export const browserEnv = Object.freeze({
  supabaseUrl: cleanHttpsUrl(import.meta.env.VITE_SUPABASE_URL),
  supabasePublishableKey: clean(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  publicMediaBucket: clean(import.meta.env.VITE_KRI_MEDIA_BUCKET) || "kri-place-media",
  privateMediaBucket: clean(import.meta.env.VITE_KRI_PRIVATE_MEDIA_BUCKET) || "kri-place-media-private",
  publicAppUrl: cleanHttpsUrl(import.meta.env.VITE_PUBLIC_APP_URL),
  weatherApiBaseUrl: cleanHttpsUrl(import.meta.env.VITE_KRI_WEATHER_API_BASE_URL)
});

export function isCanonicalSupabaseConfigured(): boolean {
  return browserEnv.supabaseUrl.length > 0 && browserEnv.supabasePublishableKey.length > 20;
}
