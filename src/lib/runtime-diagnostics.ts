import type { Language } from "./types";

export type RuntimeDiagnosticKind = "error" | "warning" | "network" | "rejection" | "manual";

export type RuntimeDiagnosticIssue = {
  at: string;
  kind: RuntimeDiagnosticKind;
  scope: string;
  message: string;
};

export type RuntimeDiagnosticsSnapshot = {
  captured_at: string;
  app_version: string;
  map_data_version: string;
  language: Language;
  page: string;
  online: boolean;
  secure_context: boolean;
  display_mode: "standalone" | "browser";
  document_visibility: DocumentVisibilityState;
  viewport: { width: number; height: number; dpr: number };
  device: {
    platform: string;
    user_agent: string;
    hardware_concurrency: number | null;
    device_memory_gb: number | null;
    touch_points: number;
  };
  network: {
    effective_type: string | null;
    downlink_mbps: number | null;
    rtt_ms: number | null;
    save_data: boolean | null;
  };
  storage: {
    quota_bytes: number | null;
    usage_bytes: number | null;
  };
  service_worker: {
    supported: boolean;
    controlled: boolean;
    lifecycle: string | null;
  };
  runtime: {
    load_state: string | null;
    map_mode: string | null;
    network_state: string | null;
    performance_profile: string | null;
    long_task_count: number | null;
    longest_long_task_ms: number | null;
    long_animation_frame_count: number | null;
    longest_animation_frame_ms: number | null;
    animation_running_count: number | null;
    animation_task_count: number | null;
    base_poi_source_commits: number | null;
    base_poi_last_commit_ms: number | null;
    natural_poi_source_commits: number | null;
    natural_poi_last_commit_ms: number | null;
    webgl_context: string | null;
    poi_icon_state: string | null;
    atlas_marker_state: string | null;
    presence_state: string | null;
    online_count: number | null;
  };
  summary: {
    errors: number;
    warnings: number;
    network_failures: number;
    total: number;
  };
  recent_issues: RuntimeDiagnosticIssue[];
};

const MAX_ISSUES = 30;
const issues: RuntimeDiagnosticIssue[] = [];
let installed = false;
let originalFetch: typeof window.fetch | null = null;

function safeUrl(value: string): string {
  try {
    const url = new URL(value, window.location.href);
    return `${url.origin}${url.pathname}`.slice(0, 260);
  } catch {
    return String(value).split("?")[0].slice(0, 260);
  }
}

function safeMessage(value: unknown): string {
  let raw: string;
  if (value instanceof Error) raw = `${value.name}: ${value.message}`;
  else if (typeof value === "string") raw = value;
  else {
    try { raw = JSON.stringify(value); }
    catch { raw = Object.prototype.toString.call(value); }
  }
  return String(raw || "Unknown runtime issue")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer <redacted>")
    .replace(/([?&](?:key|token|access_token|apikey|api_key|secret|authorization)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email-redacted>")
    .replace(/[A-Za-z0-9_-]{40,}/g, "<redacted>")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 700);
}

function issueKey(issue: RuntimeDiagnosticIssue): string {
  return `${issue.kind}|${issue.scope}|${issue.message}`;
}

function isAbortError(value: unknown): boolean {
  return Boolean(
    value
    && typeof value === "object"
    && "name" in value
    && (value as { name?: unknown }).name === "AbortError"
  );
}

function fetchWasCancelled(input: RequestInfo | URL, init: RequestInit | undefined, error: unknown): boolean {
  if (isAbortError(error) || init?.signal?.aborted) return true;
  return input instanceof Request && input.signal.aborted;
}

export function recordRuntimeDiagnostic(scope: string, error: unknown, kind: RuntimeDiagnosticKind = "manual"): void {
  const issue: RuntimeDiagnosticIssue = {
    at: new Date().toISOString(),
    kind,
    scope: safeMessage(scope).slice(0, 100),
    message: safeMessage(error)
  };
  const key = issueKey(issue);
  const duplicateIndex = issues.findIndex((entry) => issueKey(entry) === key);
  if (duplicateIndex >= 0) issues.splice(duplicateIndex, 1);
  issues.unshift(issue);
  if (issues.length > MAX_ISSUES) issues.length = MAX_ISSUES;
}

function installFetchDiagnostics(): void {
  if (originalFetch || typeof window.fetch !== "function") return;
  originalFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const rawUrl = input instanceof Request ? input.url : String(input);
    try {
      const response = await originalFetch!(input, init);
      if (response.status >= 400) {
        recordRuntimeDiagnostic(`fetch.${method}`, `${response.status} ${response.statusText || "Request failed"} — ${safeUrl(rawUrl)}`, "network");
      }
      return response;
    } catch (error) {
      // MapLibre and PMTiles intentionally abort superseded range requests during
      // style/camera transitions and browser lifecycle changes. A cancelled
      // request is not a network failure and must not appear as a red diagnostic.
      if (!fetchWasCancelled(input, init, error)) {
        recordRuntimeDiagnostic(`fetch.${method}`, `${safeUrl(rawUrl)} — ${safeMessage(error)}`, "network");
      }
      throw error;
    }
  }) as typeof window.fetch;
}

function installConsoleDiagnostics(): void {
  const wrap = (level: "warn" | "error", kind: RuntimeDiagnosticKind): void => {
    const consoleMethod = console[level].bind(console);
    console[level] = ((...args: unknown[]) => {
      try { recordRuntimeDiagnostic(`console.${level}`, args.map(safeMessage).join(" "), kind); }
      catch { /* Diagnostics must never interfere with console output. */ }
      consoleMethod(...args);
    }) as typeof console[typeof level];
  };
  wrap("warn", "warning");
  wrap("error", "error");
}

export function installRuntimeDiagnostics(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    const source = event.filename ? `${safeUrl(event.filename)}:${event.lineno || 0}:${event.colno || 0}` : "window";
    recordRuntimeDiagnostic(source, event.error ?? event.message, "error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordRuntimeDiagnostic("window.unhandledrejection", event.reason, "rejection");
  });
  installFetchDiagnostics();
  installConsoleDiagnostics();
}

function finiteOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function datasetValue(element: HTMLElement | null, key: string): string | null {
  const value = element?.dataset[key]?.trim();
  return value || null;
}

export async function collectRuntimeDiagnostics(options: {
  appVersion: string;
  mapDataVersion: string;
  language: Language;
}): Promise<RuntimeDiagnosticsSnapshot> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
    mozConnection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
    webkitConnection?: { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean };
  };
  const connection = nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    const estimate = await navigator.storage?.estimate?.();
    quota = finiteOrNull(estimate?.quota);
    usage = finiteOrNull(estimate?.usage);
  } catch {
    // Storage estimates are optional and must never block feedback.
  }
  const mapShell = document.querySelector<HTMLElement>(".map-shell");
  const onlineCount = document.querySelector<HTMLElement>("#mapOnlineIndicatorCount");
  const snapshotIssues = issues.slice();
  const errors = snapshotIssues.filter((issue) => issue.kind === "error" || issue.kind === "rejection").length;
  const warnings = snapshotIssues.filter((issue) => issue.kind === "warning").length;
  const networkFailures = snapshotIssues.filter((issue) => issue.kind === "network").length;
  return {
    captured_at: new Date().toISOString(),
    app_version: options.appVersion,
    map_data_version: options.mapDataVersion,
    language: options.language,
    page: window.location.pathname,
    online: navigator.onLine,
    secure_context: window.isSecureContext,
    display_mode: window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser",
    document_visibility: document.visibilityState,
    viewport: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
      dpr: Number((window.devicePixelRatio || 1).toFixed(2))
    },
    device: {
      platform: String(nav.platform || "unknown").slice(0, 120),
      user_agent: String(nav.userAgent || "unknown").slice(0, 500),
      hardware_concurrency: finiteOrNull(nav.hardwareConcurrency),
      device_memory_gb: finiteOrNull(nav.deviceMemory),
      touch_points: Math.max(0, Number(nav.maxTouchPoints || 0))
    },
    network: {
      effective_type: connection?.effectiveType ? String(connection.effectiveType).slice(0, 30) : null,
      downlink_mbps: finiteOrNull(connection?.downlink),
      rtt_ms: finiteOrNull(connection?.rtt),
      save_data: typeof connection?.saveData === "boolean" ? connection.saveData : null
    },
    storage: { quota_bytes: quota, usage_bytes: usage },
    service_worker: {
      supported: "serviceWorker" in navigator,
      controlled: Boolean(navigator.serviceWorker?.controller),
      lifecycle: datasetValue(mapShell, "serviceWorker")
    },
    runtime: {
      load_state: datasetValue(mapShell, "loadState"),
      map_mode: datasetValue(mapShell, "mapMode"),
      network_state: datasetValue(mapShell, "networkState"),
      performance_profile: datasetValue(mapShell, "runtimePerformance") ?? datasetValue(mapShell, "performanceProfile"),
      long_task_count: finiteOrNull(mapShell?.dataset.longTaskCount),
      longest_long_task_ms: finiteOrNull(mapShell?.dataset.longestLongTaskMs),
      long_animation_frame_count: finiteOrNull(mapShell?.dataset.longAnimationFrameCount),
      longest_animation_frame_ms: finiteOrNull(mapShell?.dataset.longestAnimationFrameMs),
      animation_running_count: finiteOrNull(mapShell?.dataset.animationRunningCount),
      animation_task_count: finiteOrNull(mapShell?.dataset.animationTaskCount),
      base_poi_source_commits: finiteOrNull(mapShell?.dataset.basePoiSourceCommits),
      base_poi_last_commit_ms: finiteOrNull(mapShell?.dataset.basePoiLastCommitMs),
      natural_poi_source_commits: finiteOrNull(mapShell?.dataset.naturalPoiSourceCommits),
      natural_poi_last_commit_ms: finiteOrNull(mapShell?.dataset.naturalPoiLastCommitMs),
      webgl_context: datasetValue(mapShell, "webglContext"),
      poi_icon_state: datasetValue(mapShell, "poiIconState"),
      atlas_marker_state: datasetValue(mapShell, "atlasMarkerState"),
      presence_state: datasetValue(document.querySelector<HTMLElement>("#mapOnlineIndicator"), "state"),
      online_count: finiteOrNull(onlineCount?.textContent)
    },
    summary: { errors, warnings, network_failures: networkFailures, total: snapshotIssues.length },
    recent_issues: snapshotIssues
  };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "n/a";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}

export function formatRuntimeDiagnosticsText(snapshot: RuntimeDiagnosticsSnapshot): string {
  const lines = [
    "[META] NAV KURD runtime diagnostics",
    `[META] Captured: ${snapshot.captured_at}`,
    `[META] App: ${snapshot.app_version}`,
    `[META] Map data: ${snapshot.map_data_version}`,
    `[META] Page: ${snapshot.page}`,
    `[${snapshot.online ? "OK" : "ERROR"}] Network: ${snapshot.online ? "online" : "offline"} · ${displayValue(snapshot.network.effective_type)} · RTT ${displayValue(snapshot.network.rtt_ms)} ms`,
    `[${snapshot.secure_context ? "OK" : "WARN"}] Secure context: ${displayValue(snapshot.secure_context)}`,
    `[META] Viewport: ${snapshot.viewport.width}×${snapshot.viewport.height} @${snapshot.viewport.dpr} · ${snapshot.display_mode}`,
    `[META] Device: ${snapshot.device.platform} · cores ${displayValue(snapshot.device.hardware_concurrency)} · memory ${displayValue(snapshot.device.device_memory_gb)} GB · touch ${snapshot.device.touch_points}`,
    `[${snapshot.service_worker.controlled ? "OK" : snapshot.service_worker.lifecycle === "error" ? "WARN" : "META"}] Service worker: ${snapshot.service_worker.supported ? "supported" : "unsupported"} / ${snapshot.service_worker.controlled ? "controlled" : displayValue(snapshot.service_worker.lifecycle ?? "registration pending")}`,
    `[META] Runtime: load=${displayValue(snapshot.runtime.load_state)} mode=${displayValue(snapshot.runtime.map_mode)} network=${displayValue(snapshot.runtime.network_state)} performance=${displayValue(snapshot.runtime.performance_profile)} webgl=${displayValue(snapshot.runtime.webgl_context)}`,
    `[META] Performance: longTasks=${displayValue(snapshot.runtime.long_task_count)} maxTask=${displayValue(snapshot.runtime.longest_long_task_ms)}ms longFrames=${displayValue(snapshot.runtime.long_animation_frame_count)} maxFrame=${displayValue(snapshot.runtime.longest_animation_frame_ms)}ms animations=${displayValue(snapshot.runtime.animation_running_count)}/${displayValue(snapshot.runtime.animation_task_count)}`,
    `[META] POI commits: base=${displayValue(snapshot.runtime.base_poi_source_commits)} (${displayValue(snapshot.runtime.base_poi_last_commit_ms)}ms) natural=${displayValue(snapshot.runtime.natural_poi_source_commits)} (${displayValue(snapshot.runtime.natural_poi_last_commit_ms)}ms)`,
    `[META] Markers: poi=${displayValue(snapshot.runtime.poi_icon_state)} owner=${displayValue(snapshot.runtime.atlas_marker_state)} presence=${displayValue(snapshot.runtime.presence_state)} online=${displayValue(snapshot.runtime.online_count)}`,
    `[META] Issue summary: errors=${snapshot.summary.errors} warnings=${snapshot.summary.warnings} network=${snapshot.summary.network_failures} total=${snapshot.summary.total}`
  ];
  if (!snapshot.recent_issues.length) {
    lines.push("[OK] No captured runtime errors or warnings in this session.");
  } else {
    lines.push("", "[META] Recent issues (newest first):");
    snapshot.recent_issues.forEach((issue) => {
      const label = issue.kind === "warning" ? "WARN" : issue.kind === "manual" ? "INFO" : "ERROR";
      lines.push(`[${label}] ${issue.at} · ${issue.scope} · ${issue.message}`);
    });
  }
  return lines.join("\n").slice(0, 15000);
}
