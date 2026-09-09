export type HardwareProfile = Readonly<{
  logicalProcessors: number | null;
  deviceMemoryGb: number | null;
  screen: Readonly<{
    cssWidth: number;
    cssHeight: number;
    physicalWidth: number;
    physicalHeight: number;
    devicePixelRatio: number;
    colorDepth: number | null;
  }>;
  gpu: Readonly<{
    vendor: string | null;
    renderer: string | null;
    version: string | null;
    maxTextureSize: number | null;
  }>;
}>;

declare global {
  interface Window {
    __NAV_KURD_NATIVE_HARDWARE__?: Record<string, unknown>;
    __NAV_KURD_FLUTTER__?: boolean;
  }
}

let cachedProfile: HardwareProfile | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("nav-kurd:native-hardware", () => {
    cachedProfile = null;
  });
}

function boundedNumber(value: unknown, minimum: number, maximum: number, integer = false): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  const bounded = Math.min(maximum, Math.max(minimum, value));
  return integer ? Math.round(bounded) : bounded;
}

function readScreenProfile(): HardwareProfile["screen"] {
  const ratio = boundedNumber(window.devicePixelRatio, 0.5, 8) ?? 1;
  const cssWidth = Math.max(1, Math.round(window.screen?.width || window.innerWidth || 1));
  const cssHeight = Math.max(1, Math.round(window.screen?.height || window.innerHeight || 1));
  return Object.freeze({
    cssWidth,
    cssHeight,
    physicalWidth: Math.max(1, Math.round(cssWidth * ratio)),
    physicalHeight: Math.max(1, Math.round(cssHeight * ratio)),
    devicePixelRatio: ratio,
    colorDepth: boundedNumber(window.screen?.colorDepth, 1, 64, true),
  });
}

function readGpuProfile(): HardwareProfile["gpu"] {
  const unavailable = Object.freeze({ vendor: null, renderer: null, version: null, maxTextureSize: null });
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { powerPreference: "high-performance" })
      ?? canvas.getContext("webgl", { powerPreference: "high-performance" });
    if (!gl) return unavailable;
    const debug = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
    const clean = (value: unknown): string | null => typeof value === "string" && value.trim()
      ? value.trim().replace(/\s+/gu, " ").slice(0, 160)
      : null;
    const profile = Object.freeze({
      vendor: clean(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      renderer: clean(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      version: clean(gl.getParameter(gl.VERSION)),
      maxTextureSize: boundedNumber(gl.getParameter(gl.MAX_TEXTURE_SIZE), 256, 65_536, true),
    });
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return profile;
  } catch { return unavailable; }
}

function unavailableGpuProfile(): HardwareProfile["gpu"] {
  return Object.freeze({ vendor: null, renderer: null, version: null, maxTextureSize: null });
}

function readNativeProfile(): HardwareProfile | null {
  if (typeof window === "undefined") return null;
  const native = window.__NAV_KURD_NATIVE_HARDWARE__;
  if (!native) return null;
  const screenValue = native.screen;
  const gpuValue = native.gpu;
  if (!screenValue || typeof screenValue !== "object" || !gpuValue || typeof gpuValue !== "object") return null;
  const screen = screenValue as Record<string, unknown>;
  const gpu = gpuValue as Record<string, unknown>;
  const physicalWidth = boundedNumber(screen.widthPixels, 1, 32_768, true);
  const physicalHeight = boundedNumber(screen.heightPixels, 1, 32_768, true);
  const density = boundedNumber(screen.density, 0.5, 8);
  if (physicalWidth === null || physicalHeight === null || density === null) return null;
  const clean = (value: unknown): string | null => typeof value === "string" && value.trim()
    ? value.trim().replace(/\s+/gu, " ").slice(0, 160)
    : null;
  const totalMemoryBytes = boundedNumber(native.totalMemoryBytes, 1, 256 * 1024 ** 3);
  return Object.freeze({
    logicalProcessors: boundedNumber(native.logicalProcessors, 1, 128, true),
    deviceMemoryGb: totalMemoryBytes === null ? null : Number((totalMemoryBytes / 1024 ** 3).toFixed(2)),
    screen: Object.freeze({
      cssWidth: Math.max(1, Math.round(physicalWidth / density)),
      cssHeight: Math.max(1, Math.round(physicalHeight / density)),
      physicalWidth,
      physicalHeight,
      devicePixelRatio: density,
      colorDepth: boundedNumber(window.screen?.colorDepth, 1, 64, true),
    }),
    gpu: Object.freeze({
      vendor: clean(gpu.vendor),
      renderer: clean(gpu.renderer),
      version: clean(gpu.version),
      maxTextureSize: boundedNumber(gpu.maxTextureSize, 256, 65_536, true),
    }),
  });
}

/**
 * Browser hardware values are optional, privacy-reduced capability hints—not
 * authoritative device specifications. Unknown values remain null instead of
 * being replaced by invented RAM or CPU numbers.
 */
export function readHardwareProfile(): HardwareProfile {
  if (cachedProfile) return cachedProfile;
  const nativeProfile = readNativeProfile();
  if (nativeProfile) {
    cachedProfile = nativeProfile;
    return cachedProfile;
  }
  if (typeof navigator === "undefined") {
    cachedProfile = Object.freeze({
      logicalProcessors: null,
      deviceMemoryGb: null,
      screen: Object.freeze({ cssWidth: 1, cssHeight: 1, physicalWidth: 1, physicalHeight: 1, devicePixelRatio: 1, colorDepth: null }),
      gpu: Object.freeze({ vendor: null, renderer: null, version: null, maxTextureSize: null }),
    });
    return cachedProfile;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const nativeShell = window.__NAV_KURD_FLUTTER__ === true;
  cachedProfile = Object.freeze({
    logicalProcessors: boundedNumber(nav.hardwareConcurrency, 1, 64, true),
    deviceMemoryGb: boundedNumber(nav.deviceMemory, 0.25, 64),
    screen: readScreenProfile(),
    // Flutter's full-screen WebView will create MapLibre's production context
    // immediately. Do not allocate a second probe context on its critical path.
    gpu: nativeShell ? unavailableGpuProfile() : readGpuProfile(),
  });
  return cachedProfile;
}

export function isConstrainedHardware(profile: HardwareProfile = readHardwareProfile()): boolean {
  return (typeof window !== "undefined" && window.__NAV_KURD_FLUTTER__ === true)
    || (profile.logicalProcessors !== null && profile.logicalProcessors <= 4)
    || (profile.deviceMemoryGb !== null && profile.deviceMemoryGb <= 4)
    || (profile.gpu.maxTextureSize !== null && profile.gpu.maxTextureSize < 4096);
}

/** Balanced default for privacy-reduced browsers; smaller/larger values require actual hints. */
export function recommendedMapTileCacheSize(profile: HardwareProfile = readHardwareProfile()): number {
  if (typeof window !== "undefined" && window.__NAV_KURD_FLUTTER__ === true) return 96;
  const { logicalProcessors: cores, deviceMemoryGb: memory } = profile;
  if ((memory !== null && memory <= 3) || (cores !== null && cores <= 4)) return 96;
  if ((memory !== null && memory <= 6) || (cores !== null && cores <= 6)) return 160;
  if (memory === null && cores === null) return 160;
  return 256;
}

export function recommendedLanguagePackLimit(profile: HardwareProfile = readHardwareProfile()): 1 | 2 | 3 {
  const memory = profile.deviceMemoryGb;
  if (memory === null) return 2;
  if (memory >= 6) return 3;
  if (memory >= 4) return 2;
  return 1;
}

export function hardwareProfileLabel(profile: HardwareProfile = readHardwareProfile()): string {
  const cores = profile.logicalProcessors === null ? "unreported CPU" : `${profile.logicalProcessors} CPU threads`;
  const memory = profile.deviceMemoryGb === null ? "unreported memory" : `${profile.deviceMemoryGb}GB memory hint`;
  const screen = `${profile.screen.physicalWidth}×${profile.screen.physicalHeight}@${profile.screen.devicePixelRatio.toFixed(2)}`;
  const gpu = profile.gpu.renderer ?? "unreported GPU";
  return `${cores} · ${memory} · ${screen} · ${gpu}`;
}
