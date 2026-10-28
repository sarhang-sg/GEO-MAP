import { Popup, type Map as MapLibreMap } from "maplibre-gl";
import type { Language } from "./types";
import type { LngLatTuple } from "./location";
import { nearestRoadInformation, roadInformationLabel, ROAD_COPY } from "./road-information";

export function readMapRoadInformation(map: MapLibreMap, coordinate: LngLatTuple, heading: number | null = null) {
  if (map.getZoom() < 13) return null;
  const layers = ["kri-road-local","kri-road-tertiary","kri-road-primary","kri-road-major"].filter(id => map.getLayer(id));
  if (!layers.length) return null;
  const p = map.project(coordinate);
  return nearestRoadInformation(map.queryRenderedFeatures([[p.x-12,p.y-12],[p.x+12,p.y+12]],{ layers }),coordinate,heading);
}
export function installRoadInformation(map: MapLibreMap, shell: HTMLElement, getLanguage: () => Language): void {
  let popup: Popup | null = null;
  map.on("click", event => {
    if (event.defaultPrevented || shell.classList.contains("is-navigating") || shell.dataset.coordinatePicker === "active") return;
    if (map.queryRenderedFeatures(event.point).some(f => f.geometry.type === "Point")) return;
    const info = readMapRoadInformation(map,[event.lngLat.lng,event.lngLat.lat]); if (!info) return;
    const language = getLanguage(), copy = ROAD_COPY[language];
    const element = document.createElement("section"); element.className = "road-information"; element.dir = language === "en" ? "ltr" : "rtl";
    const title = document.createElement("strong"); title.textContent = info.name || copy.road;
    const text = document.createElement("p"); text.textContent = roadInformationLabel(info,language);
    const surface = document.createElement("p"); surface.textContent = info.surface ? "" : `${copy.surface}: ${copy.unknown}`; surface.hidden = !!info.surface;
    const source = document.createElement("small"); source.textContent = copy.source;
    element.append(title,text,surface,source); popup?.remove(); popup = new Popup({ className: "nav-kurd-road-popup", maxWidth: "280px", offset: 12 }).setLngLat(event.lngLat).setDOMContent(element).addTo(map);
  });
  map.on("remove",() => popup?.remove());
}
