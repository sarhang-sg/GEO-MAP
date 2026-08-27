import { atlasPhotoMediaUrl, orderedAtlasPhotos, type AtlasPhoto, type AtlasPlace } from "./atlas-places";
import { localizedCategory, localizeNameValue, localizedOptionalBody } from "./map-language";
import { atlasMetadataFieldLabel } from "./atlas-editor-fields";
import { atlasMarkerAssetUrl } from "./atlas-marker-catalog";

export type PlaceDetailLanguage = "ku" | "ar" | "en";

type PlaceDetailOptions = {
  getLanguage: () => PlaceDetailLanguage;
  onShare?: (place: AtlasPlace, title: string) => Promise<void> | void;
};

type DetailCopy = {
  close: string;
  gallery: string;
  noPhotos: string;
  category: string;
  coordinates: string;
  viewImage: string;
  details: string;
  share: string;
};

const COPY: Record<PlaceDetailLanguage, DetailCopy> = {
  ku: {
    close: "داخستن",
    gallery: "گەلەری وێنەکان",
    noPhotos: "هێشتا وێنەیەک بۆ ئەم شوێنە زیاد نەکراوە.",
    category: "جۆر",
    coordinates: "شوێن",
    viewImage: "کردنەوەی وێنە",
    details: "زانیاری زیاتر",
    share: "هاوبەشکردنی شوێن"
  },
  ar: {
    close: "إغلاق",
    gallery: "معرض الصور",
    noPhotos: "لم تتم إضافة صور لهذا المكان بعد.",
    category: "الفئة",
    coordinates: "الموقع",
    viewImage: "فتح الصورة",
    details: "معلومات إضافية",
    share: "مشاركة المكان"
  },
  en: {
    close: "Close",
    gallery: "Photo gallery",
    noPhotos: "No photos have been added for this place yet.",
    category: "Category",
    coordinates: "Location",
    viewImage: "Open image",
    details: "More details",
    share: "Share place"
  }
};

function escapeText(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character] ?? character);
}

function direction(language: PlaceDetailLanguage): "rtl" | "ltr" {
  return language === "en" ? "ltr" : "rtl";
}

function placeName(place: AtlasPlace, language: PlaceDetailLanguage): string {
  const exact = language === "ku" ? place.name_ku : language === "ar" ? place.name_ar : place.name_en;
  return localizeNameValue(exact, language) || "—";
}

function placeDescription(place: AtlasPlace, language: PlaceDetailLanguage): string {
  const exact = language === "ku" ? place.description_ku : language === "ar" ? place.description_ar : place.description_en;
  return localizedOptionalBody(exact, language);
}

function photoCaption(photo: AtlasPhoto, language: PlaceDetailLanguage): string {
  const exact = language === "ku" ? photo.caption_ku : language === "ar" ? photo.caption_ar : photo.caption_en;
  return localizedOptionalBody(exact, language);
}

export class PlaceDetailPanel {
  private readonly host: HTMLDivElement;
  private readonly options: PlaceDetailOptions;
  private place: AtlasPlace | null = null;

  constructor(options: PlaceDetailOptions) {
    this.options = options;
    this.host = document.createElement("div");
    this.host.className = "place-detail";
    this.host.hidden = true;
    document.body.append(this.host);
  }

  open(place: AtlasPlace): void {
    this.place = place;
    this.host.hidden = false;
    this.render();
  }

  close(): void {
    this.host.hidden = true;
  }

  refresh(): void {
    if (!this.host.hidden && this.place) this.render();
  }

  private render(): void {
    const place = this.place;
    if (!place) return;
    const language = this.options.getLanguage();
    const copy = COPY[language];
    const photos = orderedAtlasPhotos(place);
    const coverPhoto = photos.find((photo) => photo.storage_path === place.cover_photo_path) ?? photos[0];
    const displayPhotos = coverPhoto
      ? [coverPhoto, ...photos.filter((photo) => photo.id !== coverPhoto.id)]
      : photos;
    const coverUrl = atlasPhotoMediaUrl(coverPhoto);
    const metadataRows = Object.entries(place.metadata ?? {})
      .filter(([, value]) => value !== null && value !== "" && value !== false)
      .slice(0, 12)
      .map(([key, value]) => `<div><dt>${escapeText(atlasMetadataFieldLabel(key, language))}</dt><dd>${escapeText(String(value))}</dd></div>`)
      .join("");
    const cards = displayPhotos.map((photo) => {
      const url = atlasPhotoMediaUrl(photo);
      if (!url) return "";
      const caption = photoCaption(photo, language);
      return `<button class="place-detail__photo" type="button" data-detail-image="${escapeText(url)}" aria-label="${escapeText(copy.viewImage)}">${`<img src="${escapeText(url)}" alt="${escapeText(caption || placeName(place, language))}" loading="lazy" draggable="false">`}${caption ? `<span>${escapeText(caption)}</span>` : ""}</button>`;
    }).join("");

    this.host.innerHTML = `
      <div class="place-detail__backdrop" data-detail-action="close"></div>
      <section class="place-detail__panel" role="dialog" aria-modal="true" aria-labelledby="placeDetailTitle" dir="${direction(language)}">
        <button class="place-detail__close" type="button" data-detail-action="close" aria-label="${escapeText(copy.close)}">×</button>
        ${coverUrl ? `<img class="place-detail__cover" src="${escapeText(coverUrl)}" alt="" loading="lazy" draggable="false">` : ""}
        <div class="place-detail__body">
          <div class="place-detail__identity"><img src="${escapeText(atlasMarkerAssetUrl(place.category))}" alt="" aria-hidden="true"><div><p class="place-detail__eyebrow">NAV KURD</p><h2 id="placeDetailTitle">${escapeText(placeName(place, language))}</h2></div></div>
          <dl class="place-detail__meta"><div><dt>${escapeText(copy.category)}</dt><dd>${escapeText(localizedCategory(place.category, language, copy.category))}</dd></div><div><dt>${escapeText(copy.coordinates)}</dt><dd>${place.latitude.toFixed(5)}, ${place.longitude.toFixed(5)}</dd></div></dl>
          <button class="place-detail__share" type="button" data-detail-action="share">${escapeText(copy.share)}</button>
          ${placeDescription(place, language) ? `<p class="place-detail__description">${escapeText(placeDescription(place, language))}</p>` : ""}
          ${metadataRows ? `<section class="place-detail__extra"><h3>${escapeText(copy.details)}</h3><dl>${metadataRows}</dl></section>` : ""}
          <section class="place-detail__gallery"><h3>${escapeText(copy.gallery)} <span>${displayPhotos.length}</span></h3>${cards ? `<div>${cards}</div>` : `<p>${escapeText(copy.noPhotos)}</p>`}</section>
        </div>
      </section>`;
    this.host.querySelectorAll<HTMLElement>('[data-detail-action="close"]').forEach((element) => {
      element.addEventListener("click", () => this.close());
    });
    this.host.querySelector<HTMLButtonElement>('[data-detail-action="share"]')?.addEventListener("click", () => {
      if (this.place) void this.options.onShare?.(this.place, placeName(this.place, this.options.getLanguage()));
    });
    this.host.querySelectorAll<HTMLButtonElement>("[data-detail-image]").forEach((button) => {
      button.addEventListener("click", (event) => {
        // Images remain visible in the gallery, but direct open/save by long press is locked in the app UI.
        event.preventDefault();
      });
    });
  }
}
