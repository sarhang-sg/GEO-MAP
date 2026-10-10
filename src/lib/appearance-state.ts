/** Small enough for bootstrap: apply saved preferences before the first loader frame. */
export type AppearancePreferences = {
  controls: "visible" | "auto";
  font: "brand" | "system";
  size: "normal" | "large";
  accent: "original" | "blue" | "teal" | "amber";
  motion: "auto" | "reduced";
  quality: "auto" | "economy" | "sharp";
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  controls: "visible", font: "brand", size: "normal", accent: "original", motion: "auto", quality: "auto"
};
export const APPEARANCE_VALUES = {
  controls: ["visible", "auto"], font: ["brand", "system"], size: ["normal", "large"],
  accent: ["original", "blue", "teal", "amber"], motion: ["auto", "reduced"], quality: ["auto", "economy", "sharp"]
};
const STORAGE = "nav-kurd:appearance:v1";

export function readAppearance(): AppearancePreferences {
  const value = { ...DEFAULT_APPEARANCE };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    for (const key of Object.keys(APPEARANCE_VALUES) as Array<keyof AppearancePreferences>) {
      if (APPEARANCE_VALUES[key].includes(stored?.[key])) Object.assign(value, { [key]: stored[key] });
    }
  } catch { /* Private browsing or damaged preferences must not block startup. */ }
  return value;
}

export function saveAppearance(value: AppearancePreferences): void {
  try { localStorage.setItem(STORAGE, JSON.stringify(value)); } catch { /* Optional storage. */ }
}

export function applyAppearance(value: AppearancePreferences): void {
  // Root ownership makes tokens available to the early loader, map popups and
  // dialogs alike. It does not change map sources or recreate the WebView.
  document.documentElement.dataset.accent = value.accent;
  document.body.dataset.controlsPreference = value.controls;
  document.body.dataset.fontPreference = value.font;
  document.body.dataset.textSize = value.size;
  document.body.dataset.motionPreference = value.motion;
  document.body.dataset.accent = value.accent;
}
