const MAX_BODY_BYTES = 16 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 30;
const buckets = new Map();

function clientKey(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "anonymous";
}
function allowed(request) {
  const now = Date.now();
  const key = clientKey(request);
  let value = buckets.get(key);
  if (!value || now - value.startedAt >= RATE_WINDOW_MS) value = { startedAt: now, count: 0 };
  value.count += 1; buckets.set(key, value);
  while (buckets.size > 256) buckets.delete(buckets.keys().next().value);
  return value.count <= RATE_LIMIT;
}
async function handle(request) {
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { "Allow": "POST", "Cache-Control": "no-store" } });
  if (!allowed(request)) return new Response(null, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  const length = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return new Response(null, { status: 413, headers: { "Cache-Control": "no-store" } });
  const text = (await request.text()).slice(0, MAX_BODY_BYTES);
  try {
    const payload = JSON.parse(text || "{}");
    const report = payload["csp-report"] || payload.body || payload;
    console.warn("[NAV KURD CSP]", JSON.stringify({
      document: String(report["document-uri"] || report.documentURL || "").slice(0, 300),
      blocked: String(report["blocked-uri"] || report.blockedURL || "").slice(0, 300),
      directive: String(report["violated-directive"] || report.effectiveDirective || "").slice(0, 120)
    }));
  } catch { console.warn("[NAV KURD CSP] invalid-report"); }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export default { fetch: handle };
