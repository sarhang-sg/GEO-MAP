/**
 * Brand fonts are declared in CSS and preloaded from index.html so the first
 * visible application frame already uses the local typefaces. This helper only
 * waits for the browser font set; it never registers a second late FontFace.
 */
const FONT_WAIT_TIMEOUT_MS = 1200;

function timeout(ms: number): Promise<boolean> {
  return new Promise((resolve) => window.setTimeout(() => resolve(false), ms));
}

export async function loadBrandFonts(): Promise<boolean> {
  const fonts = document.fonts;
  if (!fonts) {
    document.documentElement.dataset.brandFonts = "fallback";
    return false;
  }
  try {
    const loaded = await Promise.race([
      Promise.all([
        fonts.load('700 1em "NAVKurd Arabic"'),
        fonts.load('700 1em "NAVKurd Latin"')
      ]).then((rows) => rows.every((row) => row.length > 0)),
      timeout(FONT_WAIT_TIMEOUT_MS)
    ]);
    document.documentElement.dataset.brandFonts = loaded ? "loaded" : "fallback";
    return loaded;
  } catch {
    document.documentElement.dataset.brandFonts = "fallback";
    return false;
  }
}
