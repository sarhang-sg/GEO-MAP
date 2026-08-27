export type JsonRecord = Record<string, unknown>;

const DEFAULT_ALLOWED_ORIGINS = [
  "https://geo-map-two.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
] as const;

function configuredAllowedOrigins(): Set<string> {
  const allowed = new Set<string>(DEFAULT_ALLOWED_ORIGINS);
  try {
    const configured = Deno.env.get("NAV_KURD_ALLOWED_ORIGINS") ?? "";
    for (const value of configured.split(",")) {
      const origin = value.trim().replace(/\/$/u, "");
      if (/^https:\/\/[a-z0-9.-]+$/iu.test(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/u.test(origin)) {
        allowed.add(origin);
      }
    }
  } catch { /* environment access is best effort */ }
  return allowed;
}

const ALLOWED_ORIGINS = configuredAllowedOrigins();

export function isAllowedOrigin(origin: string | null): boolean {
  return origin === null || ALLOWED_ORIGINS.has(origin.replace(/\/$/u, ""));
}

export function corsHeaders(origin: string | null): HeadersInit {
  const normalizedOrigin = origin?.replace(/\/$/u, "") ?? null;
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  };
  if (normalizedOrigin && ALLOWED_ORIGINS.has(normalizedOrigin)) headers["Access-Control-Allow-Origin"] = normalizedOrigin;
  return headers;
}

export function json(origin: string | null, status: number, body: JsonRecord): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

export function rejectDisallowedOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (isAllowedOrigin(origin)) return null;
  return json(null, 403, { ok: false, error: "Origin is not allowed." });
}

export function handlePreflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const blocked = rejectDisallowedOrigin(request);
  if (blocked) return blocked;
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonRecord> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RequestBodyError(413, "Request body is too large.");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new RequestBodyError(413, "Request body is too large.");
  }
  if (!raw.trim()) throw new RequestBodyError(400, "A JSON request body is required.");

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RequestBodyError(400, "The JSON request body must be an object.");
    }
    return parsed as JsonRecord;
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "Invalid JSON request.");
  }
}

export class RequestBodyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RequestBodyError";
    this.status = status;
  }
}

export function safeLogMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim().slice(0, 500);
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return String((error as { message: string }).message).trim().slice(0, 500);
  }
  return "Unknown server error.";
}

export function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
