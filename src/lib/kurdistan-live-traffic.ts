import type { Map as MapLibreMap } from "maplibre-gl";
import type { Language } from "./types";

const SOURCE = "nav-kurd-live-traffic";
const LAYER = "nav-kurd-live-traffic-flow";
const COPY = {
  ku: { label: "ترافیکی زیندوو", off: "پیشاندانی ترافیک", on: "شاردنەوەی ترافیک", note: "Mapbox · نزیکەی هەر 8 خولەک نوێ دەبێتەوە" },
  ar: { label: "حركة المرور", off: "عرض الازدحام", on: "إخفاء الازدحام", note: "Mapbox · تحديث كل 8 دقائق تقريباً" },
  en: { label: "Live traffic", off: "Show traffic", on: "Hide traffic", note: "Mapbox · updated approximately every 8 minutes" }
} as const;

/** Opt-in network traffic overlay. Never models an unknown road as clear.
 * The Mapbox source is created only while visible to limit tile charges.
 */
export function installKurdistanLiveTraffic(options: {
  map: MapLibreMap;
  mapShell: HTMLElement;
  accessToken: string;
  getLanguage: () => Language;
}): { destroy(): void; refreshLanguage(): void } {
  const { map, mapShell, getLanguage } = options;
  const accessToken = options.accessToken.trim();
  if (!accessToken.startsWith("pk.")) return { destroy() {}, refreshLanguage() {} };

  let enabled = false;
  let destroyed = false;
  const holder = document.createElement("div");
  holder.className = "nav-traffic-control";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "nav-traffic-control__toggle";
  toggle.setAttribute("aria-pressed", "false");
  const label = document.createElement("span");
  const dot = document.createElement("span");
  dot.className = "nav-traffic-control__dot";
  dot.setAttribute("aria-hidden", "true");
  toggle.append(dot, label);
  const note = document.createElement("small");
  note.className = "nav-traffic-control__note";
  note.hidden = true;
  holder.append(toggle, note);
  mapShell.append(holder);

  const refreshLanguage = (): void => {
    const copy = COPY[getLanguage()];
    label.textContent = copy.label;
    toggle.title = enabled ? copy.on : copy.off;
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-pressed", String(enabled));
    note.textContent = copy.note;
    note.hidden = !enabled;
    holder.classList.toggle("is-enabled", enabled);
    holder.dir = getLanguage() === "en" ? "ltr" : "rtl";
  };

  const unload = (): void => {
    try {
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    } catch { /* Style can change or be removed while requests are pending. */ }
  };
  const load = (): void => {
    if (destroyed || !enabled || !map.getStyle()?.layers) return;
    try {
      if (!map.getSource(SOURCE)) map.addSource(SOURCE, {
        type: "vector",
        url: `https://api.mapbox.com/v4/mapbox.mapbox-traffic-v1.json?access_token=${encodeURIComponent(accessToken)}`,
        attribution: '© <a href="https://www.mapbox.com/about/maps/">Mapbox</a>'
      });
      if (!map.getLayer(LAYER)) map.addLayer({
        id: LAYER,
        type: "line",
        source: SOURCE,
        "source-layer": "traffic",
        minzoom: 7,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "closed"], "yes"], "#a474dc",
            ["match", ["get", "congestion"],
              "low", "#42cd82",
              "moderate", "#f4cb57",
              "heavy", "#f2913a",
              "severe", "#f25764", "#8293a3"]
          ],
          "line-opacity": [
            "case", ["any", ["has", "congestion"], ["==", ["get", "closed"], "yes"]], 0.93, 0
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 1.4, 12, 2.8, 16, 5.0],
          "line-offset": ["interpolate", ["linear"], ["zoom"], 7, 0.5, 14, 1.3]
        }
      }, map.getLayer("nav-route-line-glow") ? "nav-route-line-glow" : undefined);
    } catch {
      // A remote or inaccessible tileset must never blank the base map.
      enabled = false;
      unload();
      refreshLanguage();
    }
  };

  const onStyle = (): void => { if (enabled) load(); };
  const onToggle = (): void => {
    enabled = !enabled;
    if (enabled) load(); else unload();
    refreshLanguage();
  };
  toggle.addEventListener("click", onToggle);
  for (const name of ["pointerdown", "touchstart", "mousedown", "dblclick", "wheel"]) {
    holder.addEventListener(name, event => event.stopPropagation(), { passive: true });
  }
  map.on("styledata", onStyle);
  map.once("remove", () => {
    destroyed = true;
    holder.remove();
  });
  refreshLanguage();
  return {
    refreshLanguage,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      toggle.removeEventListener("click", onToggle);
      map.off("styledata", onStyle);
      unload();
      holder.remove();
    }
  };
}
