import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import { languageDirection } from "./i18n";
import type { LngLatTuple } from "./location";
import type { Language } from "./types";

type CoordinatePickerOptions = {
  map: MapLibreMap;
  mapShell: HTMLElement;
  getLanguage: () => Language;
};

type PickerCopy = { title: string; body: string; cancel: string };

const COPY: Record<Language, PickerCopy> = {
  ku: { title: "شوێنەکە لەسەر ماپ هەڵبژێرە", body: "تەنها یەکجار لەسەر خاڵی ڕاست دابگرە؛ پاشان بە خۆکار دەگەڕێیتەوە بۆ فۆڕمەکە.", cancel: "هەڵوەشاندنەوە" },
  ar: { title: "اختر الموقع على الخريطة", body: "المس النقطة الصحيحة مرة واحدة، ثم ستعود تلقائياً إلى النموذج.", cancel: "إلغاء" },
  en: { title: "Choose the point on the map", body: "Tap the exact point once. You will return to the form automatically.", cancel: "Cancel" }
};

/** Reliable one-shot coordinate selection for touch, pen and mouse input. */
export class MapCoordinatePicker {
  private readonly map: MapLibreMap;
  private readonly mapShell: HTMLElement;
  private readonly getLanguage: () => Language;
  private readonly prompt: HTMLElement;
  private callback: ((coordinate: LngLatTuple) => void) | null = null;
  private pointerStart: { id: number; x: number; y: number; at: number } | null = null;
  private completing = false;

  constructor(options: CoordinatePickerOptions) {
    this.map = options.map;
    this.mapShell = options.mapShell;
    this.getLanguage = options.getLanguage;
    this.prompt = document.createElement("section");
    this.prompt.className = "map-coordinate-picker";
    this.prompt.hidden = true;
    this.prompt.setAttribute("role", "status");
    this.prompt.setAttribute("aria-live", "polite");
    this.prompt.innerHTML = `<span class="map-coordinate-picker__icon" aria-hidden="true"><i></i></span><div><strong data-coordinate-picker-title></strong><small data-coordinate-picker-body></small></div><button type="button" data-coordinate-picker-cancel></button>`;
    this.prompt.querySelector<HTMLButtonElement>("[data-coordinate-picker-cancel]")?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cancel();
    });
    this.mapShell.append(this.prompt);

    const canvas = this.map.getCanvas();
    canvas.addEventListener("pointerdown", this.onPointerDown, { capture: true, passive: true });
    canvas.addEventListener("pointercancel", this.onPointerCancel, { capture: true, passive: true });
    canvas.addEventListener("pointerup", this.onPointerUp, { capture: true, passive: false });
    this.map.on("click", this.onMapClick);
    window.addEventListener("keydown", this.onKeyDown);
  }

  get active(): boolean { return this.callback !== null; }

  start(onPick: (coordinate: LngLatTuple) => void): void {
    if (this.callback) this.cancel(false);
    this.callback = onPick;
    this.completing = false;
    this.pointerStart = null;
    const copy = COPY[this.getLanguage()];
    this.prompt.dir = languageDirection(this.getLanguage());
    this.prompt.querySelector<HTMLElement>("[data-coordinate-picker-title]")!.textContent = copy.title;
    this.prompt.querySelector<HTMLElement>("[data-coordinate-picker-body]")!.textContent = copy.body;
    this.prompt.querySelector<HTMLButtonElement>("[data-coordinate-picker-cancel]")!.textContent = copy.cancel;
    this.prompt.hidden = false;
    this.mapShell.dataset.coordinatePicker = "active";
    this.mapShell.classList.add("is-coordinate-picking");
    this.map.getCanvas().style.cursor = "crosshair";
    this.prompt.querySelector<HTMLButtonElement>("[data-coordinate-picker-cancel]")?.focus({ preventScroll: true });
  }

  cancel(restoreFocus = true): void {
    const wasActive = Boolean(this.callback);
    this.callback = null;
    this.completing = false;
    this.pointerStart = null;
    this.prompt.hidden = true;
    delete this.mapShell.dataset.coordinatePicker;
    this.mapShell.classList.remove("is-coordinate-picking");
    this.map.getCanvas().style.cursor = "";
    if (restoreFocus && wasActive) this.map.getCanvas().focus({ preventScroll: true });
  }

  destroy(): void {
    this.cancel(false);
    const canvas = this.map.getCanvas();
    canvas.removeEventListener("pointerdown", this.onPointerDown, true);
    canvas.removeEventListener("pointercancel", this.onPointerCancel, true);
    canvas.removeEventListener("pointerup", this.onPointerUp, true);
    this.map.off("click", this.onMapClick);
    window.removeEventListener("keydown", this.onKeyDown);
    this.prompt.remove();
  }

  private finish(coordinate: LngLatTuple, originalEvent?: Event): void {
    if (!this.callback || this.completing) return;
    this.completing = true;
    originalEvent?.preventDefault();
    originalEvent?.stopPropagation();
    const callback = this.callback;
    this.cancel(false);
    try { navigator.vibrate?.(18); } catch { /* optional haptic */ }
    callback(coordinate);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.callback || !event.isPrimary) return;
    this.pointerStart = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now() };
  };

  private readonly onPointerCancel = (): void => { this.pointerStart = null; };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!this.callback || !start || start.id !== event.pointerId || !event.isPrimary) return;
    const movement = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const duration = performance.now() - start.at;
    // Ignore pans, pinches and long drags. Normal taps and deliberate short
    // presses both resolve reliably even when a browser suppresses click.
    if (movement > 14 || duration > 1_250) return;
    const rect = this.map.getCanvas().getBoundingClientRect();
    const point = [event.clientX - rect.left, event.clientY - rect.top] as [number, number];
    const lngLat = this.map.unproject(point);
    this.finish([lngLat.lng, lngLat.lat], event);
  };

  private readonly onMapClick = (event: MapMouseEvent): void => {
    if (!this.callback) return;
    this.finish([event.lngLat.lng, event.lngLat.lat], event.originalEvent);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.callback) this.cancel();
  };
}
