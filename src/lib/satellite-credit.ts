import type { Map as MapLibreMap } from "maplibre-gl";
// Unmodified Mapbox GL JS artwork: https://docs.mapbox.com/help/dive-deeper/attribution/
import mapboxWordmark from "../assets/mapbox-wordmark.svg?raw";

export const ATTRIBUTION_CHANGE_EVENT = "nav-kurd:attribution-change";
const installed = new WeakMap<MapLibreMap, (active: boolean) => void>();
const normalized = new WeakMap<HTMLElement, string>();

/** Keep source-provided credits; deduplicate links and make plain credits clickable. */
export function normalizeAttributionLinks(inner: HTMLElement): void {
  if (normalized.get(inner) === inner.innerHTML) return;
  const output = document.createDocumentFragment();
  const seen = new Set<string>();
  const add = (label: string, href?: string): void => {
    label = label.replace(/^[\s|·]+|[\s|·]+$/g, "");
    if (!label || /^(?:and|©)$/i.test(label)) return;
    let url: URL | undefined;
    if (href) { try { url = new URL(href); } catch { /* Keep malformed links as text. */ } }
    if (url && !["https:", "http:"].includes(url.protocol)) url = undefined;
    const host = url?.hostname.replace(/^www\./, "");
    const known = host === "openstreetmap.org" ? "OpenStreetMap contributors"
      : host === "geonames.org" ? "GeoNames"
      : host === "mapbox.com" ? "Mapbox"
      : host === "maxar.com" ? "Maxar"
      : host === "maptiler.com" ? "MapTiler" : null;
    if (known) label = `© ${known}`;
    const key = known ?? (url ? `${url.origin}${url.pathname.replace(/\/$/, "")}` : label);
    if (seen.has(key)) return;
    seen.add(key);
    if (output.childNodes.length) output.append(document.createTextNode(" · "));
    if (url) {
      const anchor = document.createElement("a");
      anchor.href = url.href; anchor.textContent = label;
      anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
      output.append(anchor);
    } else output.append(document.createTextNode(label));
  };
  const plain = (text: string): void => {
    const pattern = /(?:©\s*)?(OpenStreetMap(?:\s+contributors)?|GeoNames|MapTiler|Mapbox|Maxar)/g;
    let start = 0;
    for (const match of text.matchAll(pattern)) {
      add(text.slice(start, match.index));
      const name = match[1];
      const href = name.startsWith("OpenStreetMap") ? "https://www.openstreetmap.org/copyright"
        : name === "GeoNames" ? "https://www.geonames.org/"
        : name === "MapTiler" ? "https://www.maptiler.com/copyright/"
        : name === "Mapbox" ? "https://www.mapbox.com/about/maps/" : "https://www.maxar.com/";
      add(name, href); start = match.index! + match[0].length;
    }
    add(text.slice(start));
  };
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) { plain(node.textContent ?? ""); return; }
    if (!(node instanceof Element) || /^(SCRIPT|STYLE|IFRAME|OBJECT)$/.test(node.tagName)) return;
    if (node.tagName === "A") { add(node.textContent ?? "", node.getAttribute("href") ?? undefined); return; }
    for (const child of node.childNodes) visit(child);
  };
  for (const node of inner.childNodes) visit(node);
  inner.replaceChildren(output);
  normalized.set(inner, inner.innerHTML);
}

export function updateAttributionFeedback(map: MapLibreMap, slot: HTMLElement): void {
  const center = map.getCenter();
  for (const anchor of slot.querySelectorAll<HTMLAnchorElement>('a[href^="https://apps.mapbox.com/feedback/"]')) {
    anchor.href = `https://apps.mapbox.com/feedback/#/${center.lng.toFixed(5)}/${center.lat.toFixed(5)}/${map.getZoom().toFixed(2)}`;
  }
}

/** The mandatory logo belongs to the existing slot; no independent satellite card. */
export function installSatelliteCredit(map: MapLibreMap): (active: boolean) => void {
  const previous = installed.get(map);
  if (previous) return previous;
  const container = map.getContainer();
  const shell = container.closest(".map-shell") ?? container;
  const slot = shell.querySelector<HTMLElement>("#mapAttributionSlot");
  if (!slot) throw new Error("The map attribution slot is missing.");
  const logo = document.createElement("a");
  logo.className = "nav-kurd-attribution__logo";
  logo.href = "https://www.mapbox.com/";
  logo.target = "_blank"; logo.rel = "noopener noreferrer"; logo.hidden = true;
  const image = document.createElement("img");
  image.src = `data:image/svg+xml,${encodeURIComponent(mapboxWordmark)}`;
  image.alt = "Mapbox"; image.height = 30;
  logo.append(image); slot.prepend(logo);
  let removed = false;
  const updateFeedback = (): void => updateAttributionFeedback(map, slot);
  const update = (active: boolean): void => {
    if (removed) return;
    logo.hidden = !active; slot.dataset.mapbox = String(active);
    updateFeedback(); container.dispatchEvent(new Event(ATTRIBUTION_CHANGE_EVENT));
  };
  const onRemove = (): void => {
    removed = true; map.off("moveend", updateFeedback);
    logo.remove(); delete slot.dataset.mapbox; installed.delete(map);
  };
  map.on("moveend", updateFeedback); map.on("remove", onRemove);
  installed.set(map, update);
  return update;
}
