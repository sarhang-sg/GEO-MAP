import type { Map as MapLibreMap } from "maplibre-gl";
// Official artwork: https://docs.mapbox.com/help/dive-deeper/attribution/
import mapboxWordmark from "../assets/mapbox-wordmark.svg?raw";

/** Credits remain available when map details are collapsed or navigation starts. */
export function installSatelliteCredit(map: MapLibreMap): (active: boolean) => void {
  const credit = document.createElement("div");
  credit.className = "nav-satellite-credit";
  credit.dir = "ltr";
  credit.hidden = true;
  const link = (href: string, label: string): HTMLAnchorElement => {
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = label;
    return anchor;
  };
  const logo = link("https://www.mapbox.com/", "");
  const image = document.createElement("img");
  // Bundle with the UI so cached imagery never loses its wordmark.
  image.src = `data:image/svg+xml,${encodeURIComponent(mapboxWordmark)}`;
  image.alt = "Mapbox";
  image.width = 81;
  image.height = 20;
  logo.append(image);
  const links = document.createElement("span");
  links.className = "nav-satellite-credit__links";
  const feedback = link("https://apps.mapbox.com/feedback/", "Improve this map");
  links.append(link("https://www.mapbox.com/about/maps/", "© Mapbox"), link("https://www.maxar.com/", "© Maxar"),
    link("https://www.openstreetmap.org/copyright", "© OpenStreetMap"), feedback);
  credit.append(logo, links);
  (map.getContainer().closest(".map-shell") ?? map.getContainer()).append(credit);
  const updateFeedback = (): void => {
    if (credit.hidden) return;
    const center = map.getCenter();
    feedback.href = `https://apps.mapbox.com/feedback/#/${center.lng.toFixed(5)}/${center.lat.toFixed(5)}/${map.getZoom().toFixed(2)}`;
  };
  map.on("moveend", updateFeedback);
  map.on("remove", () => { map.off("moveend", updateFeedback); credit.remove(); });
  return active => { credit.hidden = !active; updateFeedback(); };
}
