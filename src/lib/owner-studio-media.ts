import { atlasPhotoMediaUrl, orderedAtlasPhotos, type AtlasPhoto, type AtlasPlace } from "./atlas-places";
import { ownerPhotoCaption } from "./geo-format";
import { escapeText, type StudioCopy, type StudioLanguage } from "./owner-studio-copy";
import { ATLAS_TEXT_LIMITS, atlasLimitAttributes, countAtlasWords } from "./atlas-content-policy";
import { appUrl } from "./app-url";

export function renderOwnerMediaPlaceholder(copy: StudioCopy): string {
  return `<section class="owner-media owner-media--placeholder"><div class="owner-media__heading"><div><p>NAV KURD MEDIA</p><h3>${escapeText(copy.media)}</h3></div><span>0</span></div><p class="owner-studio__hint">${escapeText(copy.mediaSaveFirst)}</p></section>`;
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
  language: StudioLanguage,
  uploadProgress: number | null = null,
  uploadStatus = "",
  compressionInfo = ""
): string {
  const photos = orderedAtlasPhotos(place);
  const gallery = photos.length
    ? photos.map((photo, index) => renderOwnerPhotoCard(copy, place, photo, index, photos.length, busy, language)).join("")
    : `<p class="owner-studio__empty">${escapeText(copy.noPhotos)}</p>`;

  return `
    <section class="owner-media">
      <div class="owner-media__heading"><div><p>NAV KURD MEDIA</p><h3>${escapeText(copy.media)}</h3></div><span>${photos.length}</span></div>
      <form class="owner-studio__form owner-media__upload" data-owner-form="upload">
        <label class="owner-media__file-field"><span>${escapeText(copy.photoFile)}</span><span class="owner-media__file-shell"><span class="owner-media__file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m5 18 4.5-4.5 3.2 3.2 2.3-2.3L19 18"/></svg></span><span class="owner-media__file-name" data-file-name>${escapeText(copy.noFileChosen)}</span><span class="owner-media__file-button" aria-hidden="true">${escapeText(copy.chooseFile)}</span><input class="owner-media__file-input" name="photo_file" type="file" accept="image/jpeg,image/png,image/webp" required></span>${compressionInfo ? `<small class="owner-media__compression-info">${escapeText(compressionInfo)}</small>` : ""}</label>
        <div class="owner-studio__form-grid"><label><span>${escapeText(copy.photoCaptionKu)}<small class="owner-editor__optional">${escapeText(copy.optional)}</small></span><input name="caption_ku" ${captionLimit("caption_ku")}>${captionCounter("caption_ku")}</label><label><span>${escapeText(copy.photoCaptionAr)}<small class="owner-editor__optional">${escapeText(copy.optional)}</small></span><input name="caption_ar" ${captionLimit("caption_ar")}>${captionCounter("caption_ar")}</label></div>
        <label><span>${escapeText(copy.photoCaptionEn)}<small class="owner-editor__optional">${escapeText(copy.optional)}</small></span><input name="caption_en" ${captionLimit("caption_en")}>${captionCounter("caption_en")}</label>
        <p class="owner-studio__hint">${escapeText(copy.uploadHint)}</p>
        ${uploadStatus ? `<div class="owner-media__upload-progress" role="status" aria-live="polite"><div><span>${escapeText(uploadStatus)}</span><b>${uploadProgress === null ? "" : `${Math.round(uploadProgress)}%`}</b></div><progress max="100"${uploadProgress === null ? "" : ` value="${Math.max(0, Math.min(100, uploadProgress))}"`}></progress></div>` : ""}
        <button class="owner-studio__secondary" type="submit" ${busy ? "disabled" : ""}>${escapeText(copy.upload)}</button>
      </form>
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
      <form class="owner-studio__form owner-photo-card__form" data-owner-photo-form="${escapeText(photo.id)}">
        <div class="owner-photo-card__status">${cover ? `<strong>${escapeText(copy.coverCurrent)}</strong>` : `<button type="button" data-owner-action="photo-cover" data-id="${escapeText(photo.id)}">${escapeText(copy.cover)}</button>`}</div>
        <label><span>${escapeText(copy.photoCaptionKu)}</span><input name="caption_ku" value="${escapeText(photo.caption_ku ?? "")}" ${captionLimit(`photo_${photo.id}_ku`)}>${captionCounter(`photo_${photo.id}_ku`, photo.caption_ku ?? "")}</label>
        <label><span>${escapeText(copy.photoCaptionAr)}</span><input name="caption_ar" value="${escapeText(photo.caption_ar ?? "")}" ${captionLimit(`photo_${photo.id}_ar`)}>${captionCounter(`photo_${photo.id}_ar`, photo.caption_ar ?? "")}</label>
        <label><span>${escapeText(copy.photoCaptionEn)}</span><input name="caption_en" value="${escapeText(photo.caption_en ?? "")}" ${captionLimit(`photo_${photo.id}_en`)}>${captionCounter(`photo_${photo.id}_en`, photo.caption_en ?? "")}</label>
        <div class="owner-photo-card__actions">
          <button class="owner-studio__secondary" type="submit" ${busy ? "disabled" : ""}>${escapeText(copy.photoSave)}</button>
          <button type="button" data-owner-action="photo-up" data-id="${escapeText(photo.id)}" ${index === 0 || busy ? "disabled" : ""}>${escapeText(copy.moveEarlier)}</button>
          <button type="button" data-owner-action="photo-down" data-id="${escapeText(photo.id)}" ${index === total - 1 || busy ? "disabled" : ""}>${escapeText(copy.moveLater)}</button>
          <button type="button" data-owner-action="photo-delete" data-id="${escapeText(photo.id)}" ${busy ? "disabled" : ""}><img class="owner-ui-icon owner-ui-icon--asset" src="${appUrl("assets/icons/nav-kurd/delete.svg")}" alt="" aria-hidden="true" draggable="false"><span>${escapeText(copy.removePhoto)}</span></button>
        </div>
      </form>
    </article>`;
}
