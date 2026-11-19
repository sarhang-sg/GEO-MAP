import { WEATHER_ENTRY_ICON } from "./weather-entry-icon";
import { directoryCities, cityFeature, cityKey, cityName, cityMatches, canonicalCityQuery, exactDirectoryCity, type WeatherCity } from "./weather-cities";
import { cityReadings, cachedReading, globalCities, skyMesh } from "./weather-explorer";
import { weatherPins } from "./weather-pins";
import { weatherCodeLabel, weatherCodeKind } from "./weather-codes";
import { weatherIconAsset } from "./place-weather";
import { languageValue, districtValue, governorateValue } from "./geo-format";
import type { LocalityFeature, Language } from "./types";
import type { PlaceWeatherService } from "./place-weather";
import type { LngLatTuple } from "./location";

const COPY = {
  ku: { back: "گەڕانەوە بۆ شوێنەکان", title: "لیستی کەش‌وهەوا", search: "گەڕان بە ناوی شار، پارێزگا، قەزا، ناحیە یان گوند", close: "داخستن", loading: "بارکردنی شوێنەکان…", empty: "هیچ شوێنێک نەدۆزرایەوە؛ ناوێکی وردتر بنووسە.", choose: "شوێنێک هەڵبژێرە بۆ کەش‌وهەوا و پێشبینیی کاتژمێرەکانی داهاتوو.", place: "شوێن", ready: "شوێن", unavailable: "لیستی شوێنەکان بەردەست نییە. دووبارە هەوڵ بدە.", retry: "هەوڵدانەوە" },
  ar: { back: "العودة إلى الأماكن", title: "قائمة الطقس", search: "ابحث عن مدينة أو محافظة أو قضاء أو ناحية أو قرية", close: "إغلاق", loading: "تحميل الأماكن…", empty: "لم يتم العثور على مكان؛ اكتب اسماً أدق.", choose: "اختر مكاناً لعرض الطقس وتوقعات الساعات القادمة.", place: "مكان", ready: "أماكن", unavailable: "قائمة الأماكن غير متاحة. حاول مجدداً.", retry: "إعادة المحاولة" },
  en: { back: "Back to places", title: "Weather list", search: "Search city, governorate, district, subdistrict or village", close: "Close", loading: "Loading places…", empty: "No places found; try a more specific name.", choose: "Choose a place for weather and the hourly forecast.", place: "Place", ready: "places", unavailable: "The place list is unavailable. Please retry.", retry: "Retry" }
};
export type WeatherDirectory = { open: (feature?: LocalityFeature) => void };
export function installWeatherDirectory(options: {
  shell: HTMLElement; getLanguage: () => Language;
  search: (term: string) => Promise<LocalityFeature[]>; service: PlaceWeatherService;
  embedded?: boolean; selectCity?: (city:WeatherCity)=>void; onClose?:()=>void; onGps?:()=>void;
}): WeatherDirectory {
  const button = document.createElement("button"); button.type = "button"; button.id = "weatherListButton";
  button.className = "round-button weather-list-button"; button.innerHTML = WEATHER_ENTRY_ICON;
  const actions = options.shell.querySelector(".map-actions");
  const locate = actions?.querySelector("#locateButton");
  if (locate) locate.after(button); else actions?.prepend(button);
  const dialog = document.createElement("dialog"); dialog.id = "weatherDirectory";
  dialog.className = "navigation-preferences weather-directory"; dialog.setAttribute("aria-labelledby", "weatherDirectoryTitle");
  options.shell.append(dialog);
  let generation = 0, timer = 0, input: HTMLInputElement, list: HTMLElement, details: HTMLElement, status: HTMLElement;
  let selected: LocalityFeature | undefined;
  let previousFocus: HTMLElement | null = null;
  let controller: AbortController | undefined;
  let currentRows:WeatherCity[] = [];
  let pinsReady = false;
  const pins = weatherPins(() => { if (pinsReady && dialog.open) draw(currentRows); });
  const stopSummaries = () => { controller?.abort(); };
  const choose = (feature: LocalityFeature): void => {
    selected = feature;
    const language = options.getLanguage(), name = languageValue(feature.properties, language);
    const title = document.createElement("h3"); title.textContent = name;
    const path = document.createElement("p"); path.className = "weather-directory__path";
    path.textContent = [...new Set([districtValue(feature.properties, language), governorateValue(feature.properties, language)].filter(Boolean))].join(" · ");
    const back = document.createElement("button"); back.type = "button"; back.className = "weather-directory__back";
    back.textContent = COPY[language].back;
    back.addEventListener("click", () => {
      dialog.dataset.weatherView = "list";
      [...list.querySelectorAll<HTMLButtonElement>("button[data-place-id]")].find(row => row.dataset.placeId === selected?.properties.id)?.focus({ preventScroll: true });
    });
    details.replaceChildren(back, title, path);
    details.append(options.service.createBadge(feature.geometry.coordinates.slice(0, 2) as LngLatTuple, language, { expanded: true, placeName: name }));
    details.hidden = false; dialog.dataset.weatherView = "details"; details.scrollTop = 0;
    for (const row of list.querySelectorAll<HTMLButtonElement>("button[data-place-id]")) row.setAttribute("aria-pressed", String(row.dataset.placeId === feature.properties.id));
    if (window.matchMedia("(max-width: 600px)").matches) back.focus({ preventScroll: true });
  };
  function draw(cities:WeatherCity[]) {
    currentRows = cities;
    const language = options.getLanguage(), saved = pins.all();
    const all = new Map<string,WeatherCity>();
    for (const city of [...saved.filter(c=>!input.value || cityMatches(c,input.value)),...cities]) {
      const key=cityKey(city); if (!all.has(key)) all.set(key,city);
    }
    const visible = [...all.values()].slice(0,32), frag = document.createDocumentFragment();
    for (const city of visible) {
      const key = cityKey(city), value = cachedReading(city);
      const card = document.createElement("article"); card.className = "weather-city";
      const row = document.createElement("button"); row.type="button"; row.dataset.placeId=key;
      row.className="weather-directory__place"; row.setAttribute("aria-pressed",String(selected?.properties.id===key));
      const title = document.createElement("strong"); title.textContent=cityName(city,language);
      const context=document.createElement("small"); context.textContent=city.region || "";
      const copy=document.createElement("span"); copy.append(title,context);
      if (value) {
        const icon=document.createElement("img"); icon.alt=""; icon.width=48; icon.height=48;
        icon.src=weatherIconAsset(weatherCodeKind(value.code),value.day);
        const temp=document.createElement("span"); temp.dir="ltr"; temp.className="weather-city__temp";
        temp.textContent=`${Math.round(value.temperature)}°`;
        const condition=document.createElement("span"); condition.textContent=weatherCodeLabel(value.code,value.day,language);
        const range=document.createElement("span"); range.dir="ltr";
        if (value.high!==null && value.low!==null) range.textContent=`${Math.round(value.high)}° / ${Math.round(value.low)}°`;
        const stamp=document.createElement("time");
        stamp.textContent=new Intl.DateTimeFormat(language==="ku"?"ckb-IQ":language,{hour:"2-digit",minute:"2-digit",timeZone:"UTC",hourCycle:"h23"}).format((value.at+value.offset)*1000);
        stamp.dateTime=new Date(value.at*1000).toISOString();
        context.replaceChildren(condition," · ",stamp); copy.append(range); row.append(copy,icon,temp);
        card.style.setProperty("--city-sky",skyMesh(value.temperature,value.code,value.at,value.offset,city.lat));
      } else row.append(copy);
      row.onclick=()=>{
        if(options.selectCity) options.selectCity(city);
        else if (window.flutter_inappwebview) open(cityFeature(city));
        else choose(cityFeature(city));
      };
      const pin=document.createElement("button"); pin.className="weather-city__pin"; pin.type="button";
      const pinned=pins.has(city); pin.setAttribute("aria-pressed",String(pinned));
      pin.textContent=pinned?"★":"☆"; pin.title=({ku:"دڵخوازەکان",ar:"المفضلة",en:"Favorites"})[language]+" · "+title.textContent;
      pin.setAttribute("aria-label",pin.title); pin.onclick=()=>{pins.toggle(city); list.querySelector<HTMLButtonElement>(`button[data-place-id="${key}"] + button`)?.focus();};
      card.append(row,pin); frag.append(card);
    }
    list.replaceChildren(frag);
    status.textContent=visible.length ? "" : COPY[language].empty;
    return visible;
  }
  const search = async () => {
    stopSummaries(); controller=new AbortController();
    const signal=controller.signal, serial=++generation, term=input.value.trim(), language=options.getLanguage();
    const initial=directoryCities.filter(c=>!term || cityMatches(c,term));
    const exact=exactDirectoryCity(term);
    if (exact) initial.splice(0,0,...initial.splice(initial.indexOf(exact),1));
    const paint = async (rows:WeatherCity[]) => {
      if (signal.aborted || serial!==generation || !dialog.open) return;
      const visible=draw(rows);
      try { await cityReadings(visible,signal); if (!signal.aborted && serial===generation) draw(rows); }
      catch { if (!signal.aborted && serial===generation) status.textContent=COPY[language].unavailable; }
    };
    if (term.length<2) { await paint(initial); return; }
    draw(initial);
    const candidates = [...initial];
    const merge = (rows:WeatherCity[]) => {
      if (signal.aborted || serial!==generation) return;
      candidates.push(...rows); draw(candidates);
    };
    await Promise.allSettled([
      options.search(canonicalCityQuery(term)).then(features=>merge(features.map(f=>({
        name:languageValue(f.properties,"ku"),en:languageValue(f.properties,"en"),ar:languageValue(f.properties,"ar"),
        lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]
      })))),
      globalCities(canonicalCityQuery(term),language,signal).then(merge)
    ]);
    await paint(candidates);
  };
  const render = (): void => {
    stopSummaries();
    const copy = COPY[options.getLanguage()]; button.title = copy.title; button.setAttribute("aria-label", copy.title);
    dialog.dir = options.getLanguage() === "en" ? "ltr" : "rtl";
    dialog.replaceChildren(); dialog.dataset.weatherView = "list";
    const header = document.createElement("header"), title = document.createElement("h2"), close = document.createElement("button");
    title.id = "weatherDirectoryTitle"; title.textContent = copy.title; close.type = "button"; close.textContent = copy.close;
    close.addEventListener("click", () => dialog.close()); header.append(title, close);
    if (options.onGps) { const gps=document.createElement("button"); gps.type="button"; gps.textContent={ku:"شوێنی ئێستام",ar:"موقعي الحالي",en:"Use my location"}[options.getLanguage()]; gps.onclick=options.onGps; header.append(gps); }
    input = document.createElement("input"); input.id = "weatherDirectorySearch"; input.name = "weather-place"; input.type = "search"; input.placeholder = copy.search; input.setAttribute("aria-label", copy.search); input.autocomplete = "off";
    input.addEventListener("input", () => { generation++; stopSummaries(); window.clearTimeout(timer); timer = window.setTimeout(() => { void search(); }, 220); });
    status = document.createElement("p"); status.className = "weather-directory__status"; status.setAttribute("role", "status");
    list = document.createElement("div"); list.className = "weather-directory__list";
    details = document.createElement("section"); details.className = "weather-directory__details"; details.setAttribute("aria-live", "polite");
    const hint = document.createElement("p"); hint.textContent = copy.choose; details.append(hint);
    const content = document.createElement("div"); content.className = "weather-directory__content"; content.append(list, details);
    dialog.append(header, input, status, content);
  };
  const openWeb = (feature?: LocalityFeature): void => {
    if (!dialog.open) previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    selected = feature; render(); if (!dialog.open) dialog.showModal(); pinsReady=true; pins.sync();
    if (feature) choose(feature); void search();
    // Avoid opening the mobile keyboard until the user actually taps Search.
    if (!feature && window.matchMedia("(min-width: 701px) and (pointer: fine)").matches) input.focus();
  };
  const open = (feature?: LocalityFeature): void => {
    const native = window.flutter_inappwebview;
    if (!native || options.embedded || !feature) { openWeb(feature); return; }
    const place = feature ? {lat:feature.geometry.coordinates[1], lon:feature.geometry.coordinates[0], name:languageValue(feature.properties,options.getLanguage())} : null;
    void native.callHandler("nativeWeatherDetails", place).then(ok => { if (ok !== true) openWeb(feature); }, () => openWeb(feature));
  };
  button.addEventListener("click", () => open());
  dialog.addEventListener("close", () => { generation++; stopSummaries(); window.clearTimeout(timer); options.onClose?.(); details.replaceChildren(); (previousFocus?.isConnected && previousFocus.getClientRects().length ? previousFocus : button).focus({ preventScroll: true }); });
  window.addEventListener("nav-kurd:language-change", () => { render(); if (dialog.open) { if (selected) choose(selected); void search(); } });
  render();
  return { open };
}
