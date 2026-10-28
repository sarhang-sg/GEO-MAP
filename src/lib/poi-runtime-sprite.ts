import { fetchPersistentJson } from "./persistent-json-cache";
import { APP_VERSION } from "./release";

const SPRITE_MANIFEST_URL = `${import.meta.env.BASE_URL}assets/icons/atlas/runtime-sprite/nav-kurd-poi-runtime.json`;

type RuntimeSpriteEntry = {
  image_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type RuntimeSpriteVariant = {
  min_dpr: number;
  image: string;
  pixel_ratio: number;
  icon_size: number;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  icons: Record<string, RuntimeSpriteEntry>;
};

type RuntimeSpriteManifest = {
  schema: "NAV KURD POI Runtime Sprite v2";
  release: string;
  count: number;
  variants: RuntimeSpriteVariant[];
};

type RuntimeSpriteSurface = {
  variant: RuntimeSpriteVariant;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
};

export type RuntimePoiSpriteImage = {
  image: ImageData;
  pixelRatio: number;
};

let surfacePromise: Promise<RuntimeSpriteSurface> | null = null;
const iconPromises = new Map<string, Promise<RuntimePoiSpriteImage | null>>();

function spriteAssetUrl(file: string): string {
  const normalized = String(file || "").trim();
  if (!/^[a-z0-9._-]+$/iu.test(normalized)) throw new Error(`Runtime POI sprite filename is invalid: ${file}`);
  return `${import.meta.env.BASE_URL}assets/icons/atlas/runtime-sprite/${normalized}`;
}

function selectVariant(manifest: RuntimeSpriteManifest): RuntimeSpriteVariant {
  const dpr = typeof window === "undefined" ? 2 : window.devicePixelRatio || 1;
  const variants = [...manifest.variants].sort((a, b) => a.min_dpr - b.min_dpr);
  const selected = variants.filter((variant) => dpr >= variant.min_dpr).at(-1) ?? variants[0];
  if (!selected || selected.pixel_ratio < 1 || selected.icon_size < 24 || selected.width < 1 || selected.height < 1) {
    throw new Error("Runtime POI sprite has no valid density variant.");
  }
  return selected;
}

async function decodeImage(blob: Blob, sourceUrl: string): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Older Android WebViews can expose createImageBitmap but reject a PNG
      // under memory pressure. The same-origin Image fallback remains safe.
    }
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    const release = (): void => URL.revokeObjectURL(objectUrl);
    image.decoding = "async";
    image.onload = () => {
      release();
      resolve(image);
    };
    image.onerror = () => {
      release();
      reject(new Error(`Unable to decode runtime POI sprite: ${sourceUrl}`));
    };
    image.src = objectUrl;
  });
}

async function loadSurface(): Promise<RuntimeSpriteSurface> {
  const manifest = await fetchPersistentJson<RuntimeSpriteManifest>(SPRITE_MANIFEST_URL, "Runtime POI sprite manifest");
  if (manifest.schema !== "NAV KURD POI Runtime Sprite v2" || manifest.release !== APP_VERSION || manifest.count < 150) {
    throw new Error("Runtime POI sprite manifest is invalid.");
  }
  const variant = selectVariant(manifest);
  if (Object.keys(variant.icons).length !== manifest.count) throw new Error("Runtime POI sprite icon count is invalid.");
  const sourceUrl = spriteAssetUrl(variant.image);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(sourceUrl, {
      cache: "force-cache",
      credentials: "same-origin",
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`Runtime POI sprite request failed (${response.status}): ${sourceUrl}`);
  const image = await decodeImage(await response.blob(), sourceUrl);
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(variant.width, variant.height)
    : Object.assign(document.createElement("canvas"), { width: variant.width, height: variant.height });
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!context) throw new Error("Runtime POI sprite canvas is unavailable.");
  context.clearRect(0, 0, variant.width, variant.height);
  context.drawImage(image, 0, 0, variant.width, variant.height);
  if ("close" in image && typeof image.close === "function") image.close();
  return { variant, context };
}

function surface(): Promise<RuntimeSpriteSurface> {
  if (surfacePromise) return surfacePromise;
  surfacePromise = loadSurface().catch((error) => {
    surfacePromise = null;
    throw error;
  });
  return surfacePromise;
}


/** Returns one pre-rasterized category icon without another network request. */
export function runtimePoiSpriteImage(iconId: string): Promise<RuntimePoiSpriteImage | null> {
  const normalized = String(iconId || "").trim();
  if (!normalized) return Promise.resolve(null);
  const cached = iconPromises.get(normalized);
  if (cached) return cached;
  const pending = surface().then(({ variant, context }) => {
    const entry = variant.icons[normalized];
    if (!entry || entry.width !== variant.icon_size || entry.height !== variant.icon_size) return null;
    return {
      image: context.getImageData(entry.x, entry.y, entry.width, entry.height),
      pixelRatio: variant.pixel_ratio
    };
  }).catch(() => {
    iconPromises.delete(normalized);
    return null;
  });
  iconPromises.set(normalized, pending);
  return pending;
}
