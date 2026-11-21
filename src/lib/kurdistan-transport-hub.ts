import type { Map as MapLibreMap } from "maplibre-gl";
import type { Language } from "./types";

const AIRPORTS = [
  { code: "EBL", lat: 36.2376, lng: 43.9632, official: {
    ku: "https://www.eia.krd/kurdish/flight-information",
    ar: "https://www.eia.krd/arabic/flight-information",
    en: "https://www.eia.krd/english/flight-information"
  } },
  { code: "ISU", lat: 35.5600, lng: 45.3150, official: {
    ku: "https://jta.krd/KU/default.aspx",
    ar: "https://www.jta.krd/AR/Departures.aspx",
    en: "https://jta.krd/Departures.aspx"
  } }
] as const;

const COPY = {
  ku: {
    transport: "گواستنەوە", title: "گواستنەوەی هەرێم", airports: "فڕۆکەخانەکان",
    flight: "دۆخی فڕین لە ماڵپەڕی فەرمی", locate: "نیشاندان لە نەخشە", close: "داخستن",
    erbil: "فڕۆکەخانەی نێودەوڵەتی هەولێر", sulaimani: "فڕۆکەخانەی نێودەوڵەتی جەلال تاڵەبانی",
    rail: "شەمەندەفەر", planned: "هێڵەکانی شەمەندەفەر لە هەرێم لە قۆناغی پلان و پڕۆژەدان؛ خزمەتگوزاریی ڕێکخراوی گەشتیاری پشتڕاست نەکراوەتەوە.",
    note: "فڕینەکان لەسەر ماڵپەڕی فەرمی دەکرێنەوە؛ ئەم پانێڵە پێگەی زیندووی فڕۆکە نیشان نادات."
  },
  ar: {
    transport: "النقل", title: "النقل في الإقليم", airports: "المطارات",
    flight: "حالة الرحلات من المصدر الرسمي", locate: "إظهار على الخريطة", close: "إغلاق",
    erbil: "مطار أربيل الدولي", sulaimani: "مطار جلال طالباني الدولي",
    rail: "السكك الحديدية", planned: "خطوط السكك في الإقليم قيد التخطيط؛ لا تتوفر خدمة ركاب عاملة موثقة.",
    note: "روابط الرحلات تفتح المواقع الرسمية؛ هذه اللوحة ليست خدمة تتبع الطائرات مباشرة."
  },
  en: {
    transport: "Transport", title: "Kurdistan transport", airports: "Airports",
    flight: "Official flight status", locate: "Show on map", close: "Close",
    erbil: "Erbil International Airport", sulaimani: "Jalal Talabani International Airport",
    rail: "Railways", planned: "Regional railway links are proposed/planned. No verified operating passenger train service is available.",
    note: "Flight links open official airport sites; this panel does not claim live aircraft positions."
  }
} as const;

/** Verified Kurdistan airport directory; never invents flight times or rail services. */
export function installKurdistanTransportHub(options: {
  map: MapLibreMap;
  mapShell: HTMLElement;
  getLanguage: () => Language;
}): { destroy(): void; refreshLanguage(): void } {
  const { map, mapShell, getLanguage } = options;
  const actions = mapShell.querySelector<HTMLElement>(".map-actions");
  if (!actions) return { destroy() {}, refreshLanguage() {} };

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "round-button nav-transport-trigger";
  trigger.setAttribute("aria-expanded", "false");
  trigger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m3 13 7 2 8.5 6 1.8-1.2-5.8-8 5.8-3.4c1.8-1.1 2.1-3.3.8-4.5-1.1-1.1-3.5-.8-4.6 1L12 10.4 4 7.3 2.5 9l6 5.1" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
  actions.append(trigger);

  const panel = document.createElement("aside");
  panel.className = "nav-transport-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.innerHTML = `
    <header>
      <strong data-transport-title></strong>
      <button type="button" data-transport-close aria-label="Close">×</button>
    </header>
    <h3 data-transport-airports></h3>
    <div data-transport-airport-list></div>
    <h3 data-transport-rail></h3>
    <p data-transport-rail-status></p>
    <small data-transport-note></small>`;
  mapShell.append(panel);
  const list = panel.querySelector<HTMLElement>("[data-transport-airport-list]")!;
  const close = panel.querySelector<HTMLButtonElement>("[data-transport-close]")!;

  const setOpen = (value: boolean): void => {
    panel.hidden = !value;
    trigger.setAttribute("aria-expanded", String(value));
    if (value) close.focus();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !panel.hidden) { setOpen(false); trigger.focus(); event.preventDefault(); }
  };
  const refreshLanguage = (): void => {
    const language = getLanguage();
    const copy = COPY[language];
    panel.dir = language === "en" ? "ltr" : "rtl";
    trigger.title = copy.transport;
    trigger.setAttribute("aria-label", copy.transport);
    panel.querySelector<HTMLElement>("[data-transport-title]")!.textContent = copy.title;
    panel.querySelector<HTMLElement>("[data-transport-airports]")!.textContent = copy.airports;
    panel.querySelector<HTMLElement>("[data-transport-rail]")!.textContent = copy.rail;
    panel.querySelector<HTMLElement>("[data-transport-rail-status]")!.textContent = copy.planned;
    panel.querySelector<HTMLElement>("[data-transport-note]")!.textContent = copy.note;
    close.setAttribute("aria-label", copy.close);
    list.replaceChildren();
    AIRPORTS.forEach((airport, i) => {
      const card = document.createElement("article");
      card.className = "nav-transport-panel__airport";
      const heading = document.createElement("strong");
      heading.textContent = i === 0 ? copy.erbil : copy.sulaimani;
      const code = document.createElement("small");
      code.textContent = airport.code;
      const actionsRow = document.createElement("div");
      const external = document.createElement("a");
      external.href = airport.official[language];
      external.target = "_blank";
      external.rel = "noopener noreferrer";
      external.textContent = copy.flight;
      const locate = document.createElement("button");
      locate.type = "button";
      locate.textContent = copy.locate;
      locate.addEventListener("click", () => {
        setOpen(false);
        map.flyTo({ center: [airport.lng, airport.lat], zoom: 14, duration: 800, essential: true });
      });
      actionsRow.append(external, locate);
      card.append(heading, code, actionsRow);
      list.append(card);
    });
  };
  const onTrigger = (): void => setOpen(panel.hidden);
  trigger.addEventListener("click", onTrigger);
  close.addEventListener("click", () => { setOpen(false); trigger.focus(); });
  window.addEventListener("keydown", onKeyDown);
  for (const name of ["pointerdown", "touchstart", "mousedown", "dblclick", "wheel"]) {
    panel.addEventListener(name, event => event.stopPropagation(), { passive: true });
  }
  map.once("remove", () => { panel.remove(); trigger.remove(); window.removeEventListener("keydown", onKeyDown); });
  refreshLanguage();
  return {
    refreshLanguage,
    destroy: () => {
      window.removeEventListener("keydown", onKeyDown);
      trigger.removeEventListener("click", onTrigger);
      trigger.remove(); panel.remove();
    }
  };
}
