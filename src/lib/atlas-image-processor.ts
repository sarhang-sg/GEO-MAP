import { ATLAS_MEDIA_POLICY } from "./atlas-content-policy";

export type AtlasPreparedImage = {
  file: File;
  originalBytes: number;
  outputBytes: number;
  compressed: boolean;
  width: number | null;
  height: number | null;
};

export type AtlasImageProcessingProgress = (stage: "decode" | "compress" | "complete", percent: number) => void;

const HIGH_FIDELITY_QUALITY = 0.94;
const MAX_LONG_EDGE = 2560;
const MIN_BYTES_FOR_REENCODE = 512 * 1024;

function normalizedImageName(name: string, mime: string): string {
  const stem = name.replace(/\.[^.]+$/u, "") || "nav-kurd-image";
  const extension = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${stem}.${extension}`;
}

function targetDimensions(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_LONG_EDGE) return { width, height };
  const ratio = MAX_LONG_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  };
}

async function canvasBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
    try { return await canvas.convertToBlob({ type, quality }); } catch { return null; }
  }
  return new Promise((resolve) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => resolve(blob), type, quality);
  });
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Prepares a user-selected image for upload without introducing any fake progress.
 * The original file is retained whenever recompression would not make it smaller.
 * Large images are decoded asynchronously and re-encoded at a high-fidelity setting.
 */
export async function prepareAtlasImage(
  file: File,
  onProgress?: AtlasImageProcessingProgress
): Promise<AtlasPreparedImage> {
  if (!(ATLAS_MEDIA_POLICY.allowedMimeTypes as readonly string[]).includes(file.type)) {
    throw new Error("Use a JPEG, PNG or WebP image.");
  }
  if (file.size <= 0) throw new Error("The selected image is empty.");
  if (file.size > ATLAS_MEDIA_POLICY.maxBytes) throw new Error("Each image must be 10 MB or smaller.");

  const fallback: AtlasPreparedImage = {
    file,
    originalBytes: file.size,
    outputBytes: file.size,
    compressed: false,
    width: null,
    height: null
  };

  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    onProgress?.("complete", 100);
    return fallback;
  }

  onProgress?.("decode", 10);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    onProgress?.("complete", 100);
    return fallback;
  }

  try {
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const { width, height } = targetDimensions(originalWidth, originalHeight);

    // Small files that already fit the target dimensions are left untouched.
    if (file.size < MIN_BYTES_FOR_REENCODE && width === originalWidth && height === originalHeight) {
      onProgress?.("complete", 100);
      return { ...fallback, width: originalWidth, height: originalHeight };
    }

    onProgress?.("compress", 35);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      onProgress?.("complete", 100);
      return { ...fallback, width: originalWidth, height: originalHeight };
    }

    context.drawImage(bitmap, 0, 0, width, height);
    const outputMime = "image/webp";
    const blob = await canvasBlob(canvas, outputMime, HIGH_FIDELITY_QUALITY);
    onProgress?.("compress", 90);

    if (!blob || blob.size <= 0 || blob.size >= file.size * 0.985) {
      onProgress?.("complete", 100);
      return { ...fallback, width: originalWidth, height: originalHeight };
    }

    const processed = new File([blob], normalizedImageName(file.name, outputMime), {
      type: outputMime,
      lastModified: file.lastModified || Date.now()
    });
    onProgress?.("complete", 100);
    return {
      file: processed,
      originalBytes: file.size,
      outputBytes: processed.size,
      compressed: true,
      width,
      height
    };
  } finally {
    bitmap.close();
  }
}
