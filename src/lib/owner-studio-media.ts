import { atlasPhotoMediaUrl, orderedAtlasPhotos, type AtlasPhoto, type AtlasPlace } from "./atlas-places";
import { ownerPhotoCaption } from "./geo-format";
import { escapeText, type StudioCopy, type StudioLanguage } from "./owner-studio-copy";
import { ATLAS_TEXT_LIMITS, atlasLimitAttributes, countAtlasWords } from "./atlas-content-policy";

export interface PendingOwnerPhoto {
  file: File; preview: string; caption_ku: string; caption_ar: string; caption_en: string;
}
export function renderOwnerMediaFields(copy: StudioCopy, pending: PendingOwnerPhoto | undefined, busy: boolean, progress: number | null, status: string): string {
  const captions = (["ku","ar","en"] as const).map(locale => {
    const key = `caption_${locale}` as const, value = pending?.[key] ?? "";
    const label = locale === "ku" ? copy.photoCaptionKu : locale === "ar" ? copy.photoCaptionAr : copy.photoCaptionEn;
    return `<label><span>${escapeText(label)}<small>${escapeText(copy.optional)}</small></span><input name="${key}" value="${escapeText(value)}" ${captionLimit(key)}>${captionCounter(key,value)}</label>`;
  }).join("");
  return `<section class="owner-editor-section owner-media__upload">
    <div class="owner-editor-section__heading"><span>${escapeText(copy.media)}</span><small>${escapeText(copy.optional)}</small></div>
    <label class="owner-media__file-field"><span>${escapeText(copy.photoFile)}</span><span class="owner-media__file-shell"><span class="owner-media__file-name" data-file-name>${escapeText(pending?.file.name ?? copy.noFileChosen)}</span><span class="owner-media__file-button" aria-hidden="true">${escapeText(copy.chooseFile)}</span><input class="owner-media__file-input" name="photo_file" type="file" accept="image/jpeg,image/png,image/webp" ${busy ? "disabled" : ""}></span></label>
    ${pending ? `<div class="owner-media__pending"><img src="${escapeText(pending.preview)}" alt="${escapeText(copy.photoFile)}"><button type="button" data-owner-action="pending-photo-remove" aria-label="${escapeText(copy.removePhoto)}" title="${escapeText(copy.removePhoto)}" ${busy ? "disabled" : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg></button></div><details class="owner-media__captions"><summary>${escapeText(copy.photoCaptionKu)} · ${escapeText(copy.optional)}</summary><div class="owner-studio__form-grid">${captions}</div></details>` : ""}
    <p class="owner-studio__hint">${escapeText(copy.uploadHint)}</p>
    ${status ? `<div class="owner-media__upload-progress" role="status" aria-live="polite"><div><span>${escapeText(status)}</span><b>${progress === null ? "" : `${Math.round(progress)}%`}</b></div><progress max="100"${progress === null ? "" : ` value="${Math.max(0,Math.min(100,progress))}"`}></progress></div>` : ""}
  </section>`;
}

function captionLimit(name: string): string {
  const limit = ATLAS_TEXT_LIMITS.caption;
  return `${atlasLimitAttributes(limit)} aria-describedby="${name}-limit"`;
}

function captionCounter(name: string, value = ""): string {
  const limit = ATLAS_TEXT_LIMITS.caption;
  return `<small id="${name}-limit" class="owner-editor__limit" data-limit-output="${name}">${value.length}/${limit.maxChars} · ${countAtlasWords(value)}/${limit.maxWords}</small>`;
}

export function renderOwnerMedia(
  copy: StudioCopy,
  place: AtlasPlace,
  busy: boolean,
  language: StudioLanguage
): string {
  const photos = orderedAtlasPhotos(place);
  const gallery = photos.length
    ? photos.map((photo, index) => renderOwnerPhotoCard(copy, place, photo, index, photos.length, busy, language)).join("")
    : `<p class="owner-studio__empty">${escapeText(copy.noPhotos)}</p>`;

  return `
    <section class="owner-media">
      <div class="owner-media__heading"><div><p>NAV KURD MEDIA</p><h3>${escapeText(copy.media)}</h3></div><span>${photos.length}</span></div>
      <h4>${escapeText(copy.gallery)} <span>${photos.length}</span></h4>
      <div class="owner-media__gallery">${gallery}</div>
    </section>`;
}

function renderOwnerPhotoCard(copy: StudioCopy, place: AtlasPlace, photo: AtlasPhoto, index: number, total: number, busy: boolean, language: StudioLanguage): string {
  const photoUrl = atlasPhotoMediaUrl(photo);
  const cover = place.cover_photo_path === photo.storage_path;
  const savedCaption = ownerPhotoCaption(photo, language);
  const captionRows = [
    ["KU", photo.caption_ku],
    ["AR", photo.caption_ar],
    ["EN", photo.caption_en]
  ].filter((item): item is [string, string] => typeof item[1] === "string" && item[1].trim().length > 0);
  return `
    <article class="owner-photo-card" data-photo-id="${escapeText(photo.id)}">
      <div class="owner-photo-card__visual">
        ${photoUrl ? `<img src="${escapeText(photoUrl)}" alt="${escapeText(savedCaption)}" loading="lazy">` : `<div class="owner-photo-card__missing"></div>`}
        ${savedCaption ? `<p class="owner-photo-card__caption-current"><span>${escapeText(copy.savedCaption)}</span>${escapeText(savedCaption)}</p>` : `<p class="owner-photo-card__caption-current is-empty"><span>${escapeText(copy.savedCaption)}</span>${escapeText(copy.noSavedCaption)}</p>`}
        ${captionRows.length ? `<div class="owner-photo-card__caption-languages">${captionRows.map(([code, value]) => `<p><b>${code}</b><span>${escapeText(value)}</span></p>`).join("")}</div>` : ""}
      </div>
      <details class="owner-photo-card__editor"><summary>${escapeText(copy.photoSave)}</summary><form class="owner-studio__form owner-photo-card__form" data-owner-photo-form="${escapeText(photo.id)}">
        <div class="owner-photo-card__status">${cover ? `<strong>${escapeText(copy.coverCurrent)}</strong>` : `<button type="button" data-owner-action="photo-cover" data-id="${escapeText(photo.id)}">${escapeText(copy.cover)}</button>`}</div>
        <label><span>${escapeText(copy.photoCaptionKu)}</span><input name="caption_ku" value="${escapeText(photo.caption_ku ?? "")}" ${captionLimit(`photo_${photo.id}_ku`)}>${captionCounter(`photo_${photo.id}_ku`, photo.caption_ku ?? "")}</label>
        <label><span>${escapeText(copy.photoCaptionAr)}</span><input name="caption_ar" value="${escapeText(photo.caption_ar ?? "")}" ${captionLimit(`photo_${photo.id}_ar`)}>${captionCounter(`photo_${photo.id}_ar`, photo.caption_ar ?? "")}</label>
        <label><span>${escapeText(copy.photoCaptionEn)}</span><input name="caption_en" value="${escapeText(photo.caption_en ?? "")}" ${captionLimit(`photo_${photo.id}_en`)}>${captionCounter(`photo_${photo.id}_en`, photo.caption_en ?? "")}</label>
        <div class="owner-photo-card__actions">
          <button class="owner-studio__secondary" type="submit" ${busy ? "disabled" : ""}>${escapeText(copy.photoSave)}</button>
          <button type="button" data-owner-action="photo-up" data-id="${escapeText(photo.id)}" ${index === 0 || busy ? "disabled" : ""}>${escapeText(copy.moveEarlier)}</button>
          <button type="button" data-owner-action="photo-down" data-id="${escapeText(photo.id)}" ${index === total - 1 || busy ? "disabled" : ""}>${escapeText(copy.moveLater)}</button>
          <button type="button" data-owner-action="photo-delete" data-id="${escapeText(photo.id)}" ${busy ? "disabled" : ""}><svg class="owner-ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg><span>${escapeText(copy.removePhoto)}</span></button>
        </div>
      </form></details>
    </article>`;
}
