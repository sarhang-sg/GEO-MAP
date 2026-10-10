import { coreCall, localCoreEnabled } from "../android/local-provider";
import { languageValue, districtValue, governorateValue, categoryValue, placeRank } from "./geo-format";
import type { LocalityFeature, Language } from "./types";
import type { PlaceWeatherService } from "./place-weather";
import type { LngLatTuple } from "./location";

const COPY = {
  ku: { title: "لیستی کەش‌وهەوا", search: "گەڕان بە ناوی شار، پارێزگا، قەزا، ناحیە یان گوند", close: "داخستن", loading: "بارکردنی شوێنەکان…", empty: "هیچ شوێنێک نەدۆزرایەوە؛ ناوێکی وردتر بنووسە.", choose: "شوێنێک هەڵبژێرە بۆ کەش‌وهەوا و پێشبینیی کاتژمێرەکانی داهاتوو.", place: "شوێن", ready: "شوێن", unavailable: "لیستی شوێنەکان بەردەست نییە. دووبارە هەوڵ بدە.", retry: "هەوڵدانەوە" },
  ar: { title: "قائمة الطقس", search: "ابحث عن مدينة أو محافظة أو قضاء أو ناحية أو قرية", close: "إغلاق", loading: "تحميل الأماكن…", empty: "لم يتم العثور على مكان؛ اكتب اسماً أدق.", choose: "اختر مكاناً لعرض الطقس وتوقعات الساعات القادمة.", place: "مكان", ready: "أماكن", unavailable: "قائمة الأماكن غير متاحة. حاول مجدداً.", retry: "إعادة المحاولة" },
  en: { title: "Weather list", search: "Search city, governorate, district, subdistrict or village", close: "Close", loading: "Loading places…", empty: "No places found; try a more specific name.", choose: "Choose a place for weather and the hourly forecast.", place: "Place", ready: "places", unavailable: "The place list is unavailable. Please retry.", retry: "Retry" }
};
const WEATHER_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M9 1v2M2 8H0m4-5 1.5 1.5M14 3l-1.5 1.5M5 18h12a4 4 0 0 0 0-8 5 5 0 0 0-9-1 4.5 4.5 0 0 0-3 9Zm4 3v1m6-1v1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
export function installWeatherDirectory(options: {
  shell: HTMLElement; getLanguage: () => Language; getLocalities: () => LocalityFeature[];
  search: (term: string) => Promise<LocalityFeature[]>; service: PlaceWeatherService;
}): void {
  const button = document.createElement("button"); button.type = "button"; button.id = "weatherListButton";
  button.className = "round-button weather-list-button"; button.innerHTML = WEATHER_ICON;
  options.shell.querySelector(".map-actions")?.append(button);
  const dialog = document.createElement("dialog"); dialog.id = "weatherDirectory";
  dialog.className = "navigation-preferences weather-directory"; dialog.setAttribute("aria-labelledby", "weatherDirectoryTitle");
  options.shell.append(dialog);
  let generation = 0, timer = 0, input: HTMLInputElement, list: HTMLElement, details: HTMLElement, status: HTMLElement;
  let nativeDefaults: { language: Language; rows: LocalityFeature[] } | null = null;
  const defaults = async (): Promise<LocalityFeature[]> => {
    const language = options.getLanguage();
    if (localCoreEnabled) {
      if (nativeDefaults?.language === language) return nativeDefaults.rows;
      // A single bounded native query; never transfer the full village catalog.
      const result = await coreCall<{ features: LocalityFeature[] }>("viewport", { datasets: ["locality"], language, bounds: [42, 34, 47, 38], limit: 128, after: 0, minimumLocalityRank: 80 });
      nativeDefaults = { language, rows: result.features }; return result.features;
    }
    return options.getLocalities().filter(feature => ["city", "town"].includes(feature.properties.place ?? ""));
  };
  const choose = (feature: LocalityFeature): void => {
    const language = options.getLanguage(), name = languageValue(feature.properties, language);
    const title = document.createElement("h3"); title.textContent = name;
    const path = document.createElement("p"); path.className = "weather-directory__path";
    path.textContent = [...new Set([districtValue(feature.properties, language), governorateValue(feature.properties, language)].filter(Boolean))].join(" · ");
    details.replaceChildren(title, path);
    details.append(options.service.createBadge(feature.geometry.coordinates.slice(0, 2) as LngLatTuple, language));
    details.hidden = false;
    for (const row of list.querySelectorAll<HTMLButtonElement>("button[data-place-id]")) row.setAttribute("aria-pressed", String(row.dataset.placeId === feature.properties.id));
    details.scrollIntoView({ block: "nearest", behavior: "instant" });
  };
  const showRows = (rows: LocalityFeature[], isDefault: boolean): void => {
    const language = options.getLanguage(), copy = COPY[language];
    const unique = new Map(rows.map(feature => [feature.properties.id, feature]));
    const candidates = [...unique.values()];
    if (isDefault) candidates.sort((a, b) => placeRank(b.properties.place) - placeRank(a.properties.place));
    const visible = candidates.filter(feature => languageValue(feature.properties, language) !== "—").slice(0, 32);
    const fragment = document.createDocumentFragment();
    for (const feature of visible) {
      const row = document.createElement("button"); row.type = "button"; row.className = "weather-directory__place";
      row.dataset.placeId = feature.properties.id; row.setAttribute("aria-pressed", "false");
      const name = document.createElement("strong"); name.textContent = languageValue(feature.properties, language);
      const context = document.createElement("small");
      context.textContent = [...new Set([categoryValue(feature.properties.place, language, copy.place),
        String(feature.properties[`admin_subdistrict_${language}`] ?? ""), districtValue(feature.properties, language), governorateValue(feature.properties, language)].filter(Boolean))].join(" · ");
      row.append(name, context); row.addEventListener("click", () => choose(feature)); fragment.append(row);
    }
    list.replaceChildren(fragment); status.textContent = visible.length ? `${visible.length} ${copy.ready}` : copy.empty;
  };
  const search = async (): Promise<void> => {
    const serial = ++generation, copy = COPY[options.getLanguage()], term = input.value.trim(); status.textContent = copy.loading;
    try {
      const rows = term.length >= 2 ? await options.search(term) : await defaults();
      if (serial !== generation || !dialog.open) return;
      showRows(rows, term.length < 2);
    } catch {
      if (serial !== generation || !dialog.open) return;
      status.textContent = copy.unavailable;
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = copy.retry;
      retry.addEventListener("click", () => { void search(); }); list.replaceChildren(retry);
    }
  };
  const render = (): void => {
    const copy = COPY[options.getLanguage()]; button.title = copy.title; button.setAttribute("aria-label", copy.title);
    dialog.dir = options.getLanguage() === "en" ? "ltr" : "rtl";
    dialog.replaceChildren();
    const header = document.createElement("header"), title = document.createElement("h2"), close = document.createElement("button");
    title.id = "weatherDirectoryTitle"; title.textContent = copy.title; close.type = "button"; close.textContent = copy.close;
    close.addEventListener("click", () => dialog.close()); header.append(title, close);
    input = document.createElement("input"); input.type = "search"; input.placeholder = copy.search; input.setAttribute("aria-label", copy.search); input.autocomplete = "off";
    input.addEventListener("input", () => { generation++; window.clearTimeout(timer); timer = window.setTimeout(() => { void search(); }, 220); });
    status = document.createElement("p"); status.className = "weather-directory__status"; status.setAttribute("role", "status");
    list = document.createElement("div"); list.className = "weather-directory__list";
    details = document.createElement("section"); details.className = "weather-directory__details"; details.setAttribute("aria-live", "polite");
    const hint = document.createElement("p"); hint.textContent = copy.choose; details.append(hint);
    const content = document.createElement("div"); content.className = "weather-directory__content"; content.append(list, details);
    dialog.append(header, input, status, content);
  };
  button.addEventListener("click", () => { render(); dialog.showModal(); void search(); input.focus(); });
  dialog.addEventListener("close", () => { generation++; window.clearTimeout(timer); details.replaceChildren(); button.focus(); });
  window.addEventListener("nav-kurd:language-change", () => { render(); if (dialog.open) void search(); });
  render();
}
