import {
  atlasErrorMessage,
  atlasPlaceWithRevisionPreview,
  deleteAtlasNotification,
  deleteManagedAtlasFeedback,
  deleteManagedAtlasPhoto,
  deleteManagedAtlasPlace,
  getAtlasAuthIdentity,
  isAtlasBackendConfigured,
  loadAtlasNotifications,
  loadManagedAtlasFeedback,
  loadManagedAtlasPlace,
  loadManagedAtlasPlaces,
  markAllAtlasNotificationsRead,
  markAtlasNotificationRead,
  deleteReadAtlasNotifications,
  orderedAtlasPhotos,
  reorderManagedAtlasPhotos,
  reviewManagedAtlasPlace,
  reviewManagedAtlasPlaceRevision,
  saveManagedAtlasPlace,
  setManagedAtlasPlaceCover,
  signInAtlasWithGoogle,
  signOutAtlasOwner,
  subscribeToAtlasAuth,
  subscribeToAtlasPlaces,
  updateManagedAtlasFeedback,
  updateManagedAtlasPhoto,
  updateManagedAtlasPlaceStatus,
  uploadManagedAtlasPhoto,
  type AtlasCategory,
  type AtlasFeedback,
  type AtlasFeedbackStatus,
  type AtlasNotification,
  type AtlasOwnerIdentity,
  type AtlasPlace,
  type AtlasPlaceMetadata,
  type AtlasPlaceStatus
} from "./atlas-places";
import {
  categoryLabel,
  createBlankCoordinate,
  escapeText,
  getStudioCopy,
  languageDirection,
  statusLabel,
  type PendingConfirmation,
  type StudioCoordinate,
  type StudioCopy,
  type StudioLanguage,
  type StudioView
} from "./owner-studio-copy";
import { renderOwnerMedia, renderOwnerMediaPlaceholder } from "./owner-studio-media";
import { ATLAS_TAXONOMY, ATLAS_TAXONOMY_GROUPS, atlasPlaceTypeGroup, atlasPlaceTypeSearchTerms, atlasPlaceTypeSections, atlasTaxonomyEntry, type AtlasEditorSection } from "./atlas-taxonomy";
import { ATLAS_METADATA_FIELDS, atlasEditorSectionLabel, atlasMetadataFieldsForSections, type AtlasMetadataFieldDefinition } from "./atlas-editor-fields";
import { ATLAS_TAG_LIMITS, ATLAS_TEXT_LIMITS, atlasLimitAttributes, atlasMetadataTextLimit, atlasNumericPolicy, countAtlasWords, normalizeAtlasTags, parseAtlasNumber } from "./atlas-content-policy";
import { captureOwnerFormFields, clearOwnerEditorDraft, loadOwnerEditorDraft, loadOwnerListTab, ownerDraftKey, ownerDraftValue, saveOwnerEditorDraft, saveOwnerListTab, type OwnerEditorDraft, type OwnerListTab } from "./owner-studio-persistence";
import { ownerName } from "./geo-format";
import { atlasMarkerAssetUrl } from "./atlas-marker-catalog";
import { prepareAtlasImage } from "./atlas-image-processor";
import { restoreClampedScroll } from "./mobile-dialog-layout";


type StudioOptions = {
  getLanguage: () => StudioLanguage;
  requestMapPoint: (onPick: (coordinate: StudioCoordinate) => void) => void;
  onPlacesChanged: () => Promise<void> | void;
  onNonAdminIdentity?: () => Promise<void> | void;
};

type OwnerChoiceKind = "group" | "type";
type OwnerWorkspaceTab = "review" | "places" | "messages" | "notifications";

function metadataValue(metadata: AtlasPlaceMetadata | undefined, key: string): string {
  const value = metadata?.[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function parseTags(value: FormDataEntryValue | null): string[] {
  const values = String(value ?? "")
    .split(/[,،;\n]+/u)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const tags = normalizeAtlasTags(values);
  const userTagLimit = Math.max(1, ATLAS_TAG_LIMITS.maxItems - 10);
  if (tags.length > userTagLimit) throw new Error(`Use no more than ${userTagLimit} custom tags.`);
  return tags;
}

function taxonomySystemTags(category: string): string[] {
  return normalizeAtlasTags([
    category,
    atlasPlaceTypeGroup(category),
    ...atlasPlaceTypeSearchTerms(category)
      .slice(0, 8)
      .map((term) => term.toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_"))
  ].filter(Boolean));
}

function customTagsForEditor(place: AtlasPlace | null, category: string): string[] {
  const systemTags = new Set(taxonomySystemTags(category));
  return (place?.tags ?? []).filter((tag) => !systemTags.has(tag));
}

function renderLimitCounter(name: string, value: string, maxChars: number, maxWords: number): string {
  return `<small class="owner-editor__limit" data-limit-output="${escapeText(name)}">${value.length}/${maxChars} · ${countAtlasWords(value)}/${maxWords}</small>`;
}

function renderMetadataField(field: AtlasMetadataFieldDefinition, metadata: AtlasPlaceMetadata, language: StudioLanguage, copy: StudioCopy, draft: OwnerEditorDraft | null): string {
  const baseValue = metadataValue(metadata, field.key);
  const name = `metadata_${field.key}`;
  const value = ownerDraftValue(draft, name, baseValue);
  const label = escapeText(field.label[language]);
  const placeholder = escapeText(field.placeholder?.[language] ?? "");
  const optional = `<small class="owner-editor__optional">${escapeText(copy.optional)}</small>`;
  const numericPolicy = atlasNumericPolicy(field);
  if (numericPolicy) {
    return `<label data-meta-field="${escapeText(field.key)}"><span>${label}${optional}</span><input name="${escapeText(name)}" type="number" inputmode="numeric" step="${numericPolicy.integerOnly ? "1" : "any"}" min="${numericPolicy.min}" max="${numericPolicy.max}" value="${escapeText(value)}" data-numeric-only></label>`;
  }
  if (field.type === "select") {
    const options = field.options ?? [];
    return `<fieldset class="owner-option-field" data-meta-field="${escapeText(field.key)}"><legend>${label}${optional}</legend><input type="hidden" name="${escapeText(name)}" value="${escapeText(value)}"><div class="owner-option-grid">${options.map((option) => `<button class="owner-option-chip ${option.value === value ? "is-active" : ""}" type="button" data-meta-option data-name="${escapeText(name)}" data-value="${escapeText(option.value)}" aria-pressed="${option.value === value ? "true" : "false"}">${escapeText(option.label[language])}</button>`).join("")}</div></fieldset>`;
  }
  const limit = atlasMetadataTextLimit(field) ?? ATLAS_TEXT_LIMITS.metadata;
  const type = field.type === "textarea" ? "textarea" : "input";
  const inputType = field.type === "textarea" ? "" : field.type;
  const control = type === "textarea"
    ? `<textarea name="${escapeText(name)}" rows="2" ${atlasLimitAttributes(limit)} placeholder="${placeholder}">${escapeText(value)}</textarea>`
    : `<input name="${escapeText(name)}" type="${inputType}" value="${escapeText(value)}" ${atlasLimitAttributes(limit)} placeholder="${placeholder}" ${field.type === "tel" ? 'inputmode="tel"' : ""}>`;
  return `<label data-meta-field="${escapeText(field.key)}"><span>${label}${optional}</span>${control}${renderLimitCounter(name, value, limit.maxChars, limit.maxWords)}</label>`;
}

function hasSectionValue(section: AtlasEditorSection, metadata: AtlasPlaceMetadata, draft: OwnerEditorDraft | null): boolean {
  return ATLAS_METADATA_FIELDS
    .filter((field) => field.section === section)
    .some((field) => ownerDraftValue(draft, `metadata_${field.key}`, metadataValue(metadata, field.key)).trim().length > 0);
}

function statusSortValue(status: AtlasPlaceStatus): number {
  return status === "published" ? 0 : status === "draft" ? 1 : 2;
}

function ownerUtilityIcon(name: "readAll" | "trash" | "close" | "chevron" | "signout"): string {
  const paths: Record<string, string> = {
    readAll: '<path d="m3 12 4 4 6-7M11 16l2 2 8-10"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    signout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>'
  };
  return `<svg class="owner-ui-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function ownerGoogleIcon(): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.36l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.13H3.06v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.41 13.93A6.02 6.02 0 0 1 6.1 12c0-.67.12-1.32.31-1.93V7.45H3.06A10 10 0 0 0 2 12c0 1.61.39 3.13 1.06 4.55l3.35-2.62Z"/><path fill="#EA4335" d="M12 5.94c1.47 0 2.8.51 3.84 1.5l2.88-2.88C16.95 2.91 14.7 2 12 2a10 10 0 0 0-8.94 5.45l3.35 2.62C7.2 7.7 9.4 5.94 12 5.94Z"/></svg>`;
}


export class OwnerStudio {
  private readonly host: HTMLDivElement;
  private readonly options: StudioOptions;
  private identity: AtlasOwnerIdentity | null = null;
  private places: AtlasPlace[] = [];
  private notifications: AtlasNotification[] = [];
  private feedback: AtlasFeedback[] = [];
  private editing: AtlasPlace | null = null;
  private chosenCoordinate: StudioCoordinate = createBlankCoordinate();
  private view: StudioView = "signin";
  private message = "";
  private messageKind: "normal" | "error" | "success" = "normal";
  private busy = false;
  private pendingConfirmation: PendingConfirmation | null = null;
  private choiceKind: OwnerChoiceKind | null = null;
  private activeListTab: OwnerListTab = loadOwnerListTab();
  private activeWorkspaceTab: OwnerWorkspaceTab = "review";
  private draftSaveTimer: number | null = null;
  private mediaUploadProgress: number | null = null;
  private mediaUploadStatus = "";
  private mediaCompressionInfo = "";

  constructor(options: StudioOptions) {
    this.options = options;
    this.host = document.createElement("div");
    this.host.className = "owner-studio";
    this.host.hidden = true;
    document.body.append(this.host);
    subscribeToAtlasAuth(() => { if (!this.host.hidden) void this.refresh(); });
    subscribeToAtlasPlaces(() => { if (!this.host.hidden && this.identity && !this.busy) void this.refresh(); });
    window.addEventListener("pagehide", () => { if (this.view === "editor") this.captureEditorDraft(); }, { passive: true });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && this.view === "editor") this.captureEditorDraft(); });
  }

  isOpenOrBusy(): boolean {
    return !this.host.hidden || this.busy;
  }

  async open(): Promise<void> {
    this.host.hidden = false;
    await this.refresh();
  }

  async openNewPlace(): Promise<void> {
    this.host.hidden = false;
    await this.refresh();
    if (!this.identity || !isAtlasBackendConfigured) return;
    this.editing = null;
    this.chosenCoordinate = createBlankCoordinate();
    this.pendingConfirmation = null;
    this.view = "editor";
    this.choiceKind = "group";
    this.setMessage("");
    this.render();
  }

  close(): void {
    this.pendingConfirmation = null;
    this.host.hidden = true;
  }

  private currentCopy(): StudioCopy {
    return getStudioCopy(this.options.getLanguage());
  }

  private currentDraftKey(): string {
    return ownerDraftKey(this.editing?.id);
  }

  private currentDraft(): OwnerEditorDraft | null {
    return loadOwnerEditorDraft(this.currentDraftKey());
  }

  private captureEditorDraft(form = this.host.querySelector<HTMLFormElement>('[data-owner-form="checkpoint"]')): OwnerEditorDraft | null {
    if (!form) return this.currentDraft();
    return saveOwnerEditorDraft(this.currentDraftKey(), captureOwnerFormFields(form));
  }

  private patchEditorDraft(fields: Record<string, string>): OwnerEditorDraft {
    const current = this.currentDraft();
    return saveOwnerEditorDraft(this.currentDraftKey(), { ...(current?.fields ?? {}), ...fields });
  }

  private queueEditorDraftSave(form: HTMLFormElement): void {
    if (this.draftSaveTimer !== null) window.clearTimeout(this.draftSaveTimer);
    this.draftSaveTimer = window.setTimeout(() => {
      this.draftSaveTimer = null;
      saveOwnerEditorDraft(this.currentDraftKey(), captureOwnerFormFields(form));
    }, 180);
  }

  private async refresh(): Promise<void> {
    if (!isAtlasBackendConfigured) {
      this.identity = null;
      this.view = "unavailable";
      this.render();
      return;
    }
    try {
      const authIdentity = await getAtlasAuthIdentity();
      if (!authIdentity) {
        this.identity = null;
        this.setMessage("");
        this.view = "signin";
        this.render();
        return;
      }
      if (authIdentity.role !== "admin") {
        // A valid user session must never be rendered as a failed admin login.
        // Close this role-specific surface and hand the verified session to the
        // normal account dashboard without another OAuth round-trip.
        this.identity = null;
        this.setMessage("");
        this.view = "signin";
        this.close();
        await this.options.onNonAdminIdentity?.();
        return;
      }
      this.identity = { ...authIdentity, role: "admin" };
      this.setMessage("");
      [this.places, this.notifications, this.feedback] = await Promise.all([
        loadManagedAtlasPlaces(),
        loadAtlasNotifications(),
        loadManagedAtlasFeedback()
      ]);
      if (this.view === "editor" && this.editing) {
        this.editing = this.places.find((place) => place.id === this.editing?.id) ?? this.editing;
      } else {
        this.view = "list";
      }
      this.render();
    } catch (error) {
      this.identity = null;
      this.places = [];
      this.notifications = [];
      this.feedback = [];
      this.editing = null;
      this.setMessage(atlasErrorMessage(error), "error");
      this.view = "signin";
      this.render();
    }
  }

  private setMessage(value: string, kind: "normal" | "error" | "success" = "normal"): void {
    this.message = value;
    this.messageKind = kind;
  }

  private render(): void {
    const previousScroll = this.host.querySelector<HTMLElement>(".owner-studio__scroll");
    const previousContent = this.host.querySelector<HTMLElement>(".owner-studio__content");
    const previousScrollTop = previousScroll?.scrollTop ?? 0;
    const previousContentScroll = previousContent?.scrollTop ?? 0;
    const language = this.options.getLanguage();
    const copy = this.currentCopy();
    const body = this.view === "unavailable"
      ? this.renderUnavailable(copy)
      : this.view === "signin"
        ? this.renderSignin(copy)
        : this.view === "editor"
          ? this.renderEditor(copy)
          : this.renderList(copy, language);
    this.host.innerHTML = `
      <div class="owner-studio__backdrop" data-owner-action="close"></div>
      <section class="owner-studio__panel" role="dialog" aria-modal="true" aria-labelledby="ownerStudioTitle" dir="${languageDirection(language)}">
        <div class="owner-studio__scroll">
          <header class="owner-studio__header">
            <div><p class="owner-studio__eyebrow">NAV KURD</p><h2 id="ownerStudioTitle">${escapeText(copy.title)}</h2><p>${escapeText(copy.subtitle)}</p></div>
            <button class="owner-studio__icon-button" type="button" data-owner-action="close" aria-label="${escapeText(copy.close)}">${ownerUtilityIcon("close")}</button>
          </header>
          ${this.message ? `<p class="owner-studio__message" data-kind="${this.messageKind}">${escapeText(this.message)}</p>` : ""}
          <div class="owner-studio__content">${body}</div>
        </div>
      </section>
      ${this.renderChoiceDialog(copy, language)}
      ${this.renderConfirmation(copy, language)}`;
    this.attachEvents();
    // Re-rendering form choices must not throw the user back to the top.
    // Restore both possible scroll owners after the new DOM has been laid out.
    restoreClampedScroll(this.host, [
      { selector: ".owner-studio__scroll", value: previousScrollTop },
      { selector: ".owner-studio__content", value: previousContentScroll }
    ]);
  }

  private renderChoiceDialog(copy: StudioCopy, language: StudioLanguage): string {
    if (!this.choiceKind || this.view !== "editor") return "";
    const draft = this.currentDraft();
    const selectedType = ownerDraftValue(draft, "category", atlasTaxonomyEntry(this.editing?.category)?.id ?? "village");
    const selectedGroup = ownerDraftValue(draft, "category_group", atlasPlaceTypeGroup(selectedType) || ATLAS_TAXONOMY_GROUPS[0].id);
    const isGroup = this.choiceKind === "group";
    const title = isGroup ? copy.categoryGroup : copy.placeType;
    const options = isGroup
      ? ATLAS_TAXONOMY_GROUPS.map((group) => {
          const firstType = ATLAS_TAXONOMY.find((entry) => entry.group === group.id)?.id ?? "other";
          return { value: group.id, label: group.label[language], keywords: `${group.label.ku} ${group.label.ar} ${group.label.en}`, icon: atlasMarkerAssetUrl(firstType) };
        })
      : ATLAS_TAXONOMY.filter((entry) => entry.group === selectedGroup).map((entry) => ({ value: entry.id, label: entry.label[language], keywords: `${entry.label.ku} ${entry.label.ar} ${entry.label.en} ${entry.aliases.join(" ")}`, icon: atlasMarkerAssetUrl(entry.id) }));
    const selected = isGroup ? selectedGroup : selectedType;
    return `<div class="owner-choice" role="presentation">
      <div class="owner-choice__backdrop" data-owner-action="choice-close"></div>
      <section class="owner-choice__panel" role="dialog" aria-modal="true" aria-labelledby="ownerChoiceTitle" dir="${languageDirection(language)}">
        <header class="owner-choice__header"><div><p>NAV KURD</p><h3 id="ownerChoiceTitle">${escapeText(title)}</h3></div><button type="button" data-owner-action="choice-close" aria-label="${escapeText(copy.choiceClose)}">${ownerUtilityIcon("close")}</button></header>
        <label class="owner-choice__search"><span class="visually-hidden">${escapeText(copy.choiceSearch)}</span><input id="ownerChoiceSearch" name="owner_choice_search" type="search" placeholder="${escapeText(copy.choiceSearch)}" data-owner-choice-search autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <div class="owner-choice__list" role="listbox">${options.map((option) => `<button type="button" class="owner-choice__item ${option.value === selected ? "is-selected" : ""}" data-owner-action="choice-select" data-id="${escapeText(option.value)}" data-search-text="${escapeText(option.keywords.toLocaleLowerCase("en-US"))}" role="option" aria-selected="${option.value === selected ? "true" : "false"}"><img src="${escapeText(option.icon)}" alt="" aria-hidden="true" loading="lazy"><span>${escapeText(option.label)}</span>${option.value === selected ? "<b>✓</b>" : ""}</button>`).join("")}</div>
      </section>
    </div>`;
  }

  private renderConfirmation(copy: StudioCopy, language: StudioLanguage): string {
    const pending = this.pendingConfirmation;
    if (!pending) return "";
    const isSignOut = pending.kind === "signout";
    const feedbackDelete = language === "ar" ? "حذف رسالة المستخدم نهائياً؟" : language === "en" ? "Permanently delete this user message?" : "نامەی بەکارهێنەر بە هەمیشەیی بسڕدرێتەوە؟";
    const notificationDelete = language === "ar" ? "حذف هذا الإشعار؟" : language === "en" ? "Delete this notification?" : "ئەم ئاگادارکردنەوەیە بسڕدرێتەوە؟";
    const title = isSignOut ? copy.signOutConfirmTitle : copy.confirmTitle;
    const detail = isSignOut ? copy.signOutConfirmBody
      : pending.kind === "place" ? copy.deleteConfirm
      : pending.kind === "photo" ? copy.removePhotoConfirm
      : pending.kind === "feedback" ? feedbackDelete
      : notificationDelete;
    return `<div class="owner-confirm" role="presentation">
      <div class="owner-confirm__backdrop" data-owner-action="confirm-cancel"></div>
      <section class="owner-confirm__panel" role="alertdialog" aria-modal="true" aria-labelledby="ownerConfirmTitle" aria-describedby="ownerConfirmMessage" dir="${languageDirection(language)}">
        <p class="owner-confirm__eyebrow">NAV KURD</p>
        <h3 id="ownerConfirmTitle">${escapeText(title)}</h3>
        <p id="ownerConfirmMessage">${escapeText(detail)}</p>
        <div class="owner-confirm__actions"><button class="owner-confirm__cancel" type="button" data-owner-action="confirm-cancel" ${this.busy ? "disabled" : ""}>${escapeText(copy.confirmCancel)}</button><button class="owner-confirm__delete ${isSignOut ? "is-signout" : ""}" type="button" data-owner-action="confirm-proceed" ${this.busy ? "disabled" : ""}>${escapeText(isSignOut ? copy.signOutConfirmAction : copy.confirmProceed)}</button></div>
      </section>
    </div>`;
  }

  private renderUnavailable(copy: StudioCopy): string {
    return `<article class="owner-studio__state"><strong>${escapeText(copy.unavailable)}</strong><p>${escapeText(copy.noOwner)}</p></article>`;
  }

  private renderSignin(copy: StudioCopy): string {
    return `
      <section class="owner-studio__form owner-studio__signin">
        <div class="owner-studio__signin-mark" aria-hidden="true">${ownerGoogleIcon()}</div>
        <h3>${escapeText(copy.loginTitle)}</h3>
        <p class="owner-studio__muted">${escapeText(copy.loginHint)}</p>
        <button class="owner-studio__primary owner-studio__google" type="button" data-owner-action="google-signin" ${this.busy ? "disabled" : ""}><span>${ownerGoogleIcon()}</span>${escapeText(copy.signIn)}</button>
      </section>`;
  }

  private renderList(copy: StudioCopy, language: StudioLanguage): string {
    const reviewPlaces = this.places
      .filter((place) => place.submission_source === "user" && (place.review_status === "pending" || place.active_revision?.review_status === "pending"))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const workPlaces = this.places
      .filter((place) => place.review_status !== "pending" && place.status !== "published")
      .sort((a, b) => statusSortValue(a.status) - statusSortValue(b.status) || b.updated_at.localeCompare(a.updated_at));
    const publishedPlaces = this.places
      .filter((place) => place.status === "published")
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    const workspaceLabels: Record<OwnerWorkspaceTab, string> = language === "ar"
      ? { review: "المراجعة", places: "الأماكن", messages: "الرسائل", notifications: "الإشعارات" }
      : language === "en"
        ? { review: "Review", places: "Places", messages: "Messages", notifications: "Notifications" }
        : { review: "ڕیڤیو", places: "شوێنەکان", messages: "نامەکان", notifications: "ئاگادارکردنەوەکان" };

    const renderPlaceRows = (selectedPlaces: AtlasPlace[], reviewMode: boolean, emptyMessage: string): string => selectedPlaces.length
      ? selectedPlaces.map((place) => {
        const isRevisionReview = reviewMode && place.active_revision?.review_status === "pending";
        const isNewSubmissionReview = reviewMode && place.review_status === "pending";
        const isReview = isRevisionReview || isNewSubmissionReview;
        const displayPlace = isRevisionReview ? atlasPlaceWithRevisionPreview(place) : place;
        const actions = isReview
          ? `<button type="button" class="owner-review-action owner-review-action--approve" data-owner-action="review-approve" data-id="${escapeText(place.id)}">${escapeText(copy.approve)}</button><button type="button" class="owner-review-action owner-review-action--reject" data-owner-action="review-reject" data-id="${escapeText(place.id)}">${escapeText(copy.reject)}</button>${isRevisionReview ? "" : `<button type="button" data-owner-action="edit" data-id="${escapeText(place.id)}">${escapeText(copy.edit)}</button>`}`
          : `<button type="button" data-owner-action="edit" data-id="${escapeText(place.id)}">${escapeText(copy.edit)}</button><button type="button" data-owner-action="delete" data-id="${escapeText(place.id)}">${escapeText(copy.delete)}</button>`;
        const contributor = place.created_by_profile;
        const contributorName = contributor?.display_name || place.created_by || (language === "ar" ? "مستخدم" : language === "en" ? "User" : "بەکارهێنەر");
        const contributorAvatar = contributor?.avatar_url
          ? `<img src="${escapeText(contributor.avatar_url)}" alt="" referrerpolicy="no-referrer" loading="lazy">`
          : `<span>${escapeText(contributorName.slice(0, 1).toUpperCase())}</span>`;
        const contributorLabel = language === "ar" ? "أرسله" : language === "en" ? "Submitted by" : "ناردراوە لەلایەن";
        return `<article class="owner-place-row" data-status="${place.status}" data-review="${isRevisionReview ? "revision-pending" : place.review_status}">
          <img class="owner-place-row__marker" src="${escapeText(atlasMarkerAssetUrl(displayPlace.category))}" alt="" aria-hidden="true" loading="lazy">
          <div class="owner-place-row__body"><div class="owner-place-row__title"><strong>${escapeText(ownerName(displayPlace, language))}</strong><em>${escapeText(isReview ? copy.reviewTab : statusLabel(place.status, copy))}</em></div><span>${escapeText(categoryLabel(displayPlace.category, language))}</span><small>${displayPlace.latitude.toFixed(5)}, ${displayPlace.longitude.toFixed(5)} · ${orderedAtlasPhotos(place).length} ${escapeText(copy.media)}</small>${isReview ? `<div class="owner-review-contributor"><span class="owner-review-contributor__avatar">${contributorAvatar}</span><span><small>${escapeText(contributorLabel)}</small><strong>${escapeText(contributorName)}</strong></span></div>` : ""}</div>
          <div class="owner-place-row__actions">${actions}</div>
        </article>`;
      }).join("")
      : `<p class="owner-studio__empty">${escapeText(emptyMessage)}</p>`;

    const feedbackStatus = (status: AtlasFeedbackStatus): string => {
      if (language === "ar") return status === "new" ? "جديد" : status === "in_progress" ? "قيد المعالجة" : status === "resolved" ? "تم الحل" : "مغلق";
      if (language === "en") return status === "new" ? "New" : status === "in_progress" ? "In progress" : status === "resolved" ? "Resolved" : "Closed";
      return status === "new" ? "نوێ" : status === "in_progress" ? "لەژێر چارەسەر" : status === "resolved" ? "چارەسەرکراو" : "داخراو";
    };
    const categoryLabelForFeedback = (category: AtlasFeedback["category"]): string => {
      const labels: Record<AtlasFeedback["category"], [string, string, string]> = {
        bug: ["گلیچ/هەڵە", "خلل/خطأ", "Bug/glitch"], data: ["داتای ماپ", "بيانات الخريطة", "Map data"], place: ["ناو/شوێن", "اسم/مكان", "Place/name"], search: ["گەڕان", "البحث", "Search"], login: ["چوونەژوورەوە", "تسجيل الدخول", "Sign-in"], offline: ["ئۆفلاین", "دون اتصال", "Offline"], gps: ["GPS/ڕێنیشاندان", "GPS/الملاحة", "GPS/navigation"], ui: ["UI/شاشە", "الواجهة/الشاشة", "UI/display"], other: ["شتی تر", "أخرى", "Other"]
      };
      return labels[category][language === "ar" ? 1 : language === "en" ? 2 : 0];
    };
    const noteLabel = language === "ar" ? "رد الإدارة أو ملاحظتها" : language === "en" ? "Administrator reply or note" : "وەڵام یان تێبینی بەڕێوەبەر";
    const saveNoteLabel = language === "ar" ? "حفظ الرد" : language === "en" ? "Save reply" : "پاراستنی وەڵام";
    const deleteMessageLabel = language === "ar" ? "حذف الرسالة" : language === "en" ? "Delete message" : "سڕینەوەی نامە";
    const deviceReportLabel = language === "ar" ? "بيانات الجهاز" : language === "en" ? "Device report" : "ڕاپۆرتی ئامێر";
    const feedbackRows = this.feedback.slice(0, 100).map((item) => {
      const date = new Date(item.updated_at || item.created_at).toLocaleString(language === "ar" ? "ar-IQ" : language === "en" ? "en-GB" : "ckb-IQ");
      return `<article class="owner-feedback" data-status="${escapeText(item.status)}">
        <div class="owner-feedback__heading"><strong>${escapeText(categoryLabelForFeedback(item.category))}</strong><span>${escapeText(feedbackStatus(item.status))}</span></div>
        <p>${escapeText(item.message)}</p>
        <small>${escapeText(date)} · ${escapeText(item.app_version)} · ${escapeText(item.map_data_version)}</small>
        <label class="owner-feedback__note"><span>${escapeText(noteLabel)}</span><textarea data-owner-feedback-note data-id="${escapeText(item.id)}" maxlength="1200">${escapeText(item.admin_note ?? "")}</textarea></label>
        <details><summary>${escapeText(deviceReportLabel)}</summary><pre>${escapeText(JSON.stringify(item.diagnostics, null, 2))}</pre></details>
        <div class="owner-feedback__actions">
          <button type="button" data-owner-action="feedback-save" data-id="${escapeText(item.id)}">${escapeText(saveNoteLabel)}</button>
          ${item.status !== "in_progress" ? `<button type="button" data-owner-action="feedback-in_progress" data-id="${escapeText(item.id)}">${escapeText(feedbackStatus("in_progress"))}</button>` : ""}
          ${item.status !== "resolved" ? `<button type="button" data-owner-action="feedback-resolved" data-id="${escapeText(item.id)}">${escapeText(feedbackStatus("resolved"))}</button>` : ""}
          ${item.status !== "closed" ? `<button type="button" data-owner-action="feedback-closed" data-id="${escapeText(item.id)}">${escapeText(feedbackStatus("closed"))}</button>` : ""}
          <button type="button" class="is-danger" data-owner-action="feedback-delete" data-id="${escapeText(item.id)}">${escapeText(deleteMessageLabel)}</button>
        </div>
      </article>`;
    }).join("") || `<p class="owner-studio__empty">${escapeText(language === "ar" ? "لا توجد رسائل." : language === "en" ? "No messages." : "هیچ نامەیەک نییە.")}</p>`;

    const unreadNotifications = this.notifications.filter((item) => !item.is_read).length;
    const notificationDeleteLabel = language === "ar" ? "حذف الإشعار" : language === "en" ? "Delete notification" : "سڕینەوەی ئاگادارکردنەوە";
    const notificationRows = this.notifications.slice(0, 100).map((notification) => {
      const title = language === "ar" ? notification.title_ar : language === "en" ? notification.title_en : notification.title_ku;
      const body = language === "ar" ? notification.body_ar : language === "en" ? notification.body_en : notification.body_ku;
      return `<article class="owner-notification ${notification.is_read ? "is-read" : "is-unread"}"><button type="button" class="owner-notification__read" data-owner-action="notification-read" data-id="${escapeText(notification.id)}"><span class="owner-notification__state" aria-hidden="true"></span><span class="owner-notification__copy"><strong>${escapeText(title)}</strong>${body ? `<span>${escapeText(body)}</span>` : ""}</span></button><button type="button" class="owner-notification__delete" data-owner-action="notification-delete" data-id="${escapeText(notification.id)}" aria-label="${escapeText(notificationDeleteLabel)}">${ownerUtilityIcon("trash")}</button></article>`;
    }).join("") || `<p class="owner-studio__empty">${escapeText(language === "ar" ? "لا توجد إشعارات." : language === "en" ? "No notifications." : "هیچ ئاگادارکردنەوەیەک نییە.")}</p>`;

    const reviewPanel = `<section class="owner-private-panel"><div class="owner-studio__toolbar owner-studio__toolbar--actions"><h3>${escapeText(workspaceLabels.review)} <span>${reviewPlaces.length}</span></h3><button type="button" class="owner-studio__secondary" data-owner-action="refresh">${escapeText(copy.refresh)}</button></div><div class="owner-studio__list">${renderPlaceRows(reviewPlaces, true, copy.noReviewPlaces)}</div></section>`;
    const placeRows = this.activeListTab === "published" ? publishedPlaces : workPlaces;
    const placeEmpty = this.activeListTab === "published" ? copy.noPublishedPlaces : copy.noWorkPlaces;
    const placesPanel = `<section class="owner-private-panel"><div class="owner-studio__toolbar owner-studio__toolbar--actions"><h3>${escapeText(workspaceLabels.places)} <span>${this.places.length}</span></h3><div><button type="button" class="owner-studio__secondary" data-owner-action="refresh">${escapeText(copy.refresh)}</button><button type="button" class="owner-studio__primary" data-owner-action="add">${escapeText(copy.add)}</button></div></div><div class="owner-list-tabs" role="tablist"><button type="button" role="tab" data-owner-action="list-tab" data-id="work" aria-selected="${this.activeListTab === "work" ? "true" : "false"}" class="${this.activeListTab === "work" ? "is-active" : ""}">${escapeText(copy.workTab)} <span>${workPlaces.length}</span></button><button type="button" role="tab" data-owner-action="list-tab" data-id="published" aria-selected="${this.activeListTab === "published" ? "true" : "false"}" class="${this.activeListTab === "published" ? "is-active" : ""}">${escapeText(copy.publishedTab)} <span>${publishedPlaces.length}</span></button></div><div class="owner-studio__list">${renderPlaceRows(placeRows, false, placeEmpty)}</div></section>`;
    const messagesPanel = `<section class="owner-private-panel owner-feedback-section"><h3>${escapeText(workspaceLabels.messages)} <span>${this.feedback.filter((item) => item.status === "new").length}</span></h3><div class="owner-feedback-list">${feedbackRows}</div></section>`;
    const notificationActions = this.notifications.length ? `<div class="owner-notification-actions">${unreadNotifications ? `<button type="button" data-owner-action="notifications-read-all">${ownerUtilityIcon("readAll")}<span>${escapeText(language === "ar" ? "تحديد الكل كمقروء" : language === "en" ? "Mark all as read" : "هەموویان وەک خوێندراو")}</span></button>` : ""}<button type="button" data-owner-action="notifications-delete-read">${ownerUtilityIcon("trash")}<span>${escapeText(language === "ar" ? "حذف المقروء" : language === "en" ? "Delete read" : "سڕینەوەی خوێندراوەکان")}</span></button></div>` : "";
    const notificationsPanel = `<section class="owner-private-panel owner-notification-section"><h3>${escapeText(workspaceLabels.notifications)} <span>${unreadNotifications}</span></h3>${notificationActions}<div class="owner-studio__list">${notificationRows}</div></section>`;
    const panel = this.activeWorkspaceTab === "places" ? placesPanel : this.activeWorkspaceTab === "messages" ? messagesPanel : this.activeWorkspaceTab === "notifications" ? notificationsPanel : reviewPanel;

    return `<div class="owner-studio__toolbar"><div><strong>${escapeText(this.identity?.displayName || this.identity?.email || "NAV KURD")}</strong><span>${escapeText(copy.signedIn)}</span></div><button type="button" class="owner-studio__signout" data-owner-action="signout" aria-label="${escapeText(copy.signOut)}">${ownerUtilityIcon("signout")}<span>${escapeText(copy.signOut)}</span></button></div>
      <nav class="owner-private-tabs" aria-label="${escapeText(copy.title)}">${(Object.keys(workspaceLabels) as OwnerWorkspaceTab[]).map((tab) => `<button type="button" data-owner-action="workspace-tab" data-id="${tab}" class="${this.activeWorkspaceTab === tab ? "is-active" : ""}" aria-pressed="${this.activeWorkspaceTab === tab ? "true" : "false"}"><span>${escapeText(workspaceLabels[tab])}</span>${tab === "review" ? `<b>${reviewPlaces.length}</b>` : tab === "places" ? `<b>${this.places.length}</b>` : tab === "messages" ? `<b>${this.feedback.filter((item) => item.status === "new").length}</b>` : `<b>${unreadNotifications}</b>`}</button>`).join("")}</nav>
      ${panel}`;
  }

  private renderEditor(copy: StudioCopy): string {
    const language = this.options.getLanguage();
    const place = this.editing;
    const persistedDraft = this.currentDraft();
    const placeUpdatedAt = place ? Date.parse(place.updated_at) : 0;
    const draft = persistedDraft && (!place || persistedDraft.updatedAt > placeUpdatedAt + 1000) ? persistedDraft : null;
    const value = (name: string, fallback = ""): string => ownerDraftValue(draft, name, fallback);
    const selectedTypeCandidate = value("category", atlasTaxonomyEntry(place?.category)?.id ?? "village");
    const selectedType = atlasTaxonomyEntry(selectedTypeCandidate)?.id ?? "village";
    const selectedGroupCandidate = value("category_group", atlasPlaceTypeGroup(selectedType) || ATLAS_TAXONOMY_GROUPS[0].id);
    const selectedGroup = ATLAS_TAXONOMY_GROUPS.some((group) => group.id === selectedGroupCandidate) ? selectedGroupCandidate : ATLAS_TAXONOMY_GROUPS[0].id;
    const selectedGroupLabel = ATLAS_TAXONOMY_GROUPS.find((group) => group.id === selectedGroup)?.label[language] ?? "—";
    const selectedTypeLabel = atlasTaxonomyEntry(selectedType)?.label[language] ?? "—";
    const metadata = place?.metadata ?? {};
    const activeSections = atlasPlaceTypeSections(selectedType);
    const relevantSections = activeSections.map((section) => {
      const fields = ATLAS_METADATA_FIELDS.filter((field) => field.section === section);
      if (!fields.length) return "";
      const open = hasSectionValue(section, metadata, draft) ? " open" : "";
      return `<details class="owner-editor-section owner-editor-section--optional owner-editor-section--relevant" data-editor-section="${section}"${open}><summary><span>${escapeText(atlasEditorSectionLabel(section, language))}</span><small>${escapeText(copy.optional)}</small></summary><div class="owner-editor-section__body owner-studio__form-grid">${fields.map((field) => renderMetadataField(field, metadata, language, copy, draft)).join("")}</div></details>`;
    }).filter(Boolean).join("");

    const nameKu = value("name_ku", place?.name_ku ?? "");
    const nameAr = value("name_ar", place?.name_ar ?? "");
    const nameEn = value("name_en", place?.name_en ?? "");
    const descriptionKu = value("description_ku", place?.description_ku ?? "");
    const descriptionAr = value("description_ar", place?.description_ar ?? "");
    const descriptionEn = value("description_en", place?.description_en ?? "");
    const currentTags = value("tags", customTagsForEditor(place, selectedType).join(", "));
    const longitude = value("longitude", String(place?.longitude ?? this.chosenCoordinate[0]));
    const latitude = value("latitude", String(place?.latitude ?? this.chosenCoordinate[1]));
    const hasDescription = [descriptionKu, descriptionAr, descriptionEn].some((item) => item.trim());
    const intro = place ? copy.editorIntroEdit : copy.editorIntroAdd;
    const suggestions = atlasPlaceTypeSearchTerms(selectedType).filter((term) => term !== selectedType).slice(0, 6);

    return `
      <form class="owner-studio__form owner-studio__form--checkpoint owner-studio__form--professional" data-owner-form="checkpoint" novalidate>
        <div class="owner-studio__toolbar owner-studio__toolbar--editor"><div><p class="owner-editor__eyebrow">NAV KURD · ${ATLAS_TAXONOMY.length} TYPES</p><h3>${escapeText(place ? copy.edit : copy.add)}</h3></div><button class="owner-studio__text-button" type="button" data-owner-action="list">${escapeText(copy.cancel)}</button></div>
        <p class="owner-editor__intro">${escapeText(intro)}</p>
        <p class="owner-editor__persistence ${draft ? "is-restored" : ""}">${escapeText(draft ? copy.restoredDraft : copy.draftProtected)}</p>
        <input name="id" type="hidden" value="${escapeText(place?.id ?? "")}">
        <input name="slug" type="hidden" value="${escapeText(place?.slug ?? "")}">

        <section class="owner-editor-section owner-editor-section--required">
          <div class="owner-editor-section__heading"><span>${escapeText(copy.sectionBasics)}</span><b>${escapeText(copy.required)}</b></div>
          <label><span>${escapeText(copy.nameKu)}<small class="owner-editor__required">${escapeText(copy.required)}</small></span><input name="name_ku" required value="${escapeText(nameKu)}" ${atlasLimitAttributes(ATLAS_TEXT_LIMITS.name)}>${renderLimitCounter("name_ku", nameKu, ATLAS_TEXT_LIMITS.name.maxChars, ATLAS_TEXT_LIMITS.name.maxWords)}</label>
          <div class="owner-studio__form-grid">
            <label><span>${escapeText(copy.nameAr)}<small class="owner-editor__optional">${escapeText(copy.optional)}</small></span><input name="name_ar" value="${escapeText(nameAr)}" ${atlasLimitAttributes(ATLAS_TEXT_LIMITS.name)}>${renderLimitCounter("name_ar", nameAr, ATLAS_TEXT_LIMITS.name.maxChars, ATLAS_TEXT_LIMITS.name.maxWords)}</label>
            <label><span>${escapeText(copy.nameEn)}<small class="owner-editor__optional">${escapeText(copy.optional)}</small></span><input name="name_en" value="${escapeText(nameEn)}" ${atlasLimitAttributes(ATLAS_TEXT_LIMITS.name)}>${renderLimitCounter("name_en", nameEn, ATLAS_TEXT_LIMITS.name.maxChars, ATLAS_TEXT_LIMITS.name.maxWords)}</label>
          </div>
          <div class="owner-studio__form-grid">
            <label class="owner-choice-field"><span>${escapeText(copy.categoryGroup)}<small class="owner-editor__required">${escapeText(copy.required)}</small></span><input type="hidden" name="category_group" value="${escapeText(selectedGroup)}" data-taxonomy-group><button class="owner-choice-trigger" type="button" data-owner-action="choice-open" data-id="group" aria-haspopup="dialog"><span>${escapeText(selectedGroupLabel)}</span><b>${ownerUtilityIcon("chevron")}</b></button></label>
            <label class="owner-choice-field"><span>${escapeText(copy.placeType)}<small class="owner-editor__required">${escapeText(copy.required)}</small></span><input type="hidden" name="category" value="${escapeText(selectedType)}" data-taxonomy-type><button class="owner-choice-trigger" type="button" data-owner-action="choice-open" data-id="type" aria-haspopup="dialog"><span>${escapeText(selectedTypeLabel)}</span><b>${ownerUtilityIcon("chevron")}</b></button></label>
          </div>
          <label><span>${escapeText(copy.tags)}<small class="owner-editor__optional">${escapeText(copy.optional)}</small></span><input name="tags" value="${escapeText(currentTags)}" ${atlasLimitAttributes(ATLAS_TEXT_LIMITS.tags)} placeholder="emergency, public, 24h"><small class="owner-editor__field-hint">${escapeText(copy.tagsHint)}</small>${renderLimitCounter("tags", currentTags, ATLAS_TEXT_LIMITS.tags.maxChars, ATLAS_TEXT_LIMITS.tags.maxWords)}</label>
          <div class="owner-editor__suggestions" data-taxonomy-suggestions ${suggestions.length ? "" : "hidden"}>${suggestions.map((term) => `<span>${escapeText(term)}</span>`).join("")}</div>
        </section>

        <details class="owner-editor-section owner-editor-section--optional" ${hasDescription ? "open" : ""}>
          <summary><span>${escapeText(copy.sectionDescription)}</span><small>${escapeText(copy.optional)}</small></summary>
          <div class="owner-editor-section__body">
            <label><span>${escapeText(copy.descriptionKu)}</span><textarea name="description_ku" rows="3" ${atlasLimitAttributes(ATLAS_TEXT_LIMITS.description)}>${escapeText(descriptionKu)}</textarea>${renderLimitCounter("description_ku", descriptionKu, ATLAS_TEXT_LIMITS.description.maxChars, ATLAS_TEXT_LIMITS.description.maxWords)}</label>
            <label><span>${escapeText(copy.descriptionAr)}</span><textarea name="description_ar" rows="2" ${atlasLimitAttributes(ATLAS_TEXT_LIMITS.description)}>${escapeText(descriptionAr)}</textarea>${renderLimitCounter("description_ar", descriptionAr, ATLAS_TEXT_LIMITS.description.maxChars, ATLAS_TEXT_LIMITS.description.maxWords)}</label>
            <label><span>${escapeText(copy.descriptionEn)}</span><textarea name="description_en" rows="2" ${atlasLimitAttributes(ATLAS_TEXT_LIMITS.description)}>${escapeText(descriptionEn)}</textarea>${renderLimitCounter("description_en", descriptionEn, ATLAS_TEXT_LIMITS.description.maxChars, ATLAS_TEXT_LIMITS.description.maxWords)}</label>
          </div>
        </details>

        ${relevantSections ? `<section class="owner-editor-section owner-editor-section--container"><div class="owner-editor-section__heading"><span>${escapeText(copy.sectionRelevant)}</span><b>${activeSections.length}</b></div><p class="owner-editor__field-hint">${escapeText(copy.contentLimitHint)}</p>${relevantSections}</section>` : ""}

        <section class="owner-editor-section owner-editor-section--required">
          <div class="owner-editor-section__heading"><span>${escapeText(copy.sectionLocation)}</span><b>${escapeText(copy.required)}</b></div>
          <div class="owner-studio__form-grid"><label><span>${escapeText(copy.longitude)}</span><input name="longitude" type="number" inputmode="decimal" step="0.0000001" min="42.18" max="46.5" required value="${escapeText(longitude)}" data-numeric-only></label><label><span>${escapeText(copy.latitude)}</span><input name="latitude" type="number" inputmode="decimal" step="0.0000001" min="34.22" max="37.47" required value="${escapeText(latitude)}" data-numeric-only></label></div>
          <button class="owner-studio__map-pick" type="button" data-owner-action="pick">${escapeText(copy.placeOnMap)}</button>
          <p class="owner-studio__hint">${escapeText(copy.mapPickHint)}</p>
        </section>

        <button class="owner-studio__primary owner-studio__primary--sticky" type="submit" ${this.busy ? "disabled" : ""}>${escapeText(this.busy ? copy.saving : place ? copy.saveChanges : copy.saveDraftFirst)}</button>
      </form>
      ${place ? this.renderPublishingPanel(copy, place) : ""}
      ${place ? renderOwnerMedia(copy, place, this.busy, language, this.mediaUploadProgress, this.mediaUploadStatus, this.mediaCompressionInfo) : renderOwnerMediaPlaceholder(copy)}`;
  }

  private renderPublishingPanel(copy: StudioCopy, place: AtlasPlace): string {
    const actions: string[] = [];
    if (place.status !== "published") actions.push(`<button class="owner-publishing__publish" type="button" data-owner-action="status-published" data-id="${escapeText(place.id)}">${escapeText(copy.publishNow)}</button>`);
    if (place.status !== "draft") actions.push(`<button type="button" data-owner-action="status-draft" data-id="${escapeText(place.id)}">${escapeText(copy.moveToDraft)}</button>`);
    if (place.status !== "hidden") actions.push(`<button class="owner-publishing__hide" type="button" data-owner-action="status-hidden" data-id="${escapeText(place.id)}">${escapeText(copy.hidePlace)}</button>`);
    return `<section class="owner-publishing" data-status="${place.status}"><div class="owner-publishing__heading"><div><p>NAV KURD · PUBLISHING</p><h3>${escapeText(copy.publishingTitle)}</h3></div><span>${escapeText(statusLabel(place.status, copy))}</span></div><p>${escapeText(copy.publishingIntro)}</p><div class="owner-publishing__status"><small>${escapeText(copy.currentStatus)}</small><strong>${escapeText(statusLabel(place.status, copy))}</strong></div><div class="owner-publishing__actions">${actions.join("")}</div></section>`;
  }


  private attachEvents(): void {
    this.host.querySelectorAll<HTMLElement>("[data-owner-action]").forEach((element) => {
      element.addEventListener("click", () => { void this.handleAction(element.dataset.ownerAction ?? "", element.dataset.id); });
    });

    const choiceSearch = this.host.querySelector<HTMLInputElement>("[data-owner-choice-search]");
    choiceSearch?.addEventListener("input", () => {
      const needle = choiceSearch.value.trim().toLocaleLowerCase("en-US");
      this.host.querySelectorAll<HTMLElement>(".owner-choice__item").forEach((item) => {
        item.hidden = Boolean(needle) && !(item.dataset.searchText ?? "").includes(needle);
      });
    });


    const checkpointForm = this.host.querySelector<HTMLFormElement>('[data-owner-form="checkpoint"]');
    checkpointForm?.addEventListener("submit", (event) => { event.preventDefault(); void this.handleSave(checkpointForm); });
    if (checkpointForm) {
      checkpointForm.addEventListener("input", () => this.queueEditorDraftSave(checkpointForm));
      checkpointForm.addEventListener("change", () => this.queueEditorDraftSave(checkpointForm));

      checkpointForm.querySelectorAll<HTMLButtonElement>("[data-meta-option]").forEach((button) => {
        button.addEventListener("click", () => {
          const name = button.dataset.name ?? "";
          const value = button.dataset.value ?? "";
          const hidden = checkpointForm.elements.namedItem(name);
          if (!(hidden instanceof HTMLInputElement)) return;
          hidden.value = value;
          checkpointForm.querySelectorAll<HTMLButtonElement>(`[data-meta-option][data-name="${CSS.escape(name)}"]`).forEach((peer) => {
            const active = peer === button;
            peer.classList.toggle("is-active", active);
            peer.setAttribute("aria-pressed", String(active));
          });
          this.queueEditorDraftSave(checkpointForm);
        });
      });

      checkpointForm.querySelectorAll<HTMLInputElement>("[data-numeric-only]").forEach((input) => {
        input.addEventListener("input", () => {
          const decimal = input.step !== "1";
          const cleaned = decimal
            ? input.value.replace(/[^0-9.-]/gu, "").replace(/(?!^)-/gu, "").replace(/(\..*)\./gu, "$1")
            : input.value.replace(/\D/gu, "");
          if (input.value !== cleaned) input.value = cleaned;
        });
      });
    }

    this.host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-limit-counter]").forEach((control) => {
      const update = (): void => {
        const output = control.closest("label")?.querySelector<HTMLElement>(".owner-editor__limit") ?? null;
        const maxChars = Number(control.getAttribute("maxlength") ?? 0);
        const maxWords = Number(control.dataset.maxWords ?? 0);
        const words = countAtlasWords(control.value);
        if (output) {
          output.textContent = `${control.value.length}/${maxChars} · ${words}/${maxWords}`;
          output.classList.toggle("is-invalid", Boolean(maxWords && words > maxWords));
        }
        control.setCustomValidity(maxWords && words > maxWords ? `Maximum ${maxWords} words.` : "");
      };
      control.addEventListener("input", update);
      update();
    });

    const uploadForm = this.host.querySelector<HTMLFormElement>('[data-owner-form="upload"]');
    uploadForm?.addEventListener("submit", (event) => { event.preventDefault(); void this.handleUpload(uploadForm); });
    this.host.querySelectorAll<HTMLInputElement>(".owner-media__file-input").forEach((input) => {
      const fileName = input.closest(".owner-media__file-shell")?.querySelector<HTMLElement>("[data-file-name]");
      const updateFileName = (): void => {
        if (!fileName) return;
        fileName.textContent = input.files?.[0]?.name || this.currentCopy().noFileChosen;
      };
      input.addEventListener("change", updateFileName);
      updateFileName();
    });
    this.host.querySelectorAll<HTMLFormElement>("[data-owner-photo-form]").forEach((form) => {
      form.addEventListener("submit", (event) => { event.preventDefault(); void this.handlePhotoCaption(form); });
    });
  }

  private async handleAction(action: string, id?: string): Promise<void> {
    const copy = this.currentCopy();
    if (action === "google-signin") {
      if (this.busy) return;
      this.busy = true;
      this.setMessage("");
      this.render();
      try {
        await signInAtlasWithGoogle("admin");
      } catch (error) {
        this.setMessage(atlasErrorMessage(error), "error");
        this.busy = false;
        this.render();
      }
      return;
    }
    if (action === "close") { if (this.view === "editor") this.captureEditorDraft(); this.choiceKind = null; this.close(); return; }
    if (action === "refresh") { await this.refresh(); return; }
    if (action === "workspace-tab" && (id === "review" || id === "places" || id === "messages" || id === "notifications")) {
      this.activeWorkspaceTab = id;
      this.setMessage("");
      this.render();
      return;
    }
    if (action === "list-tab" && (id === "review" || id === "work" || id === "published")) {
      this.activeListTab = id;
      this.activeWorkspaceTab = id === "review" ? "review" : "places";
      saveOwnerListTab(id);
      this.render();
      return;
    }
    if (action === "list") { this.captureEditorDraft(); this.choiceKind = null; this.editing = null; this.view = "list"; this.setMessage(""); this.render(); return; }
    if (action === "add") { this.choiceKind = "group"; this.editing = null; this.chosenCoordinate = createBlankCoordinate(); this.view = "editor"; this.setMessage(""); this.render(); return; }
    if ((action === "review-approve" || action === "review-reject") && id) {
      const place = this.places.find((item) => item.id === id);
      if (!place || place.submission_source !== "user") return;
      const decision = action === "review-approve" ? "approve" : "reject";
      const pendingRevision = place.active_revision?.review_status === "pending" ? place.active_revision : null;
      if (!pendingRevision && place.review_status !== "pending") return;
      await this.runTask(async () => {
        if (pendingRevision) await reviewManagedAtlasPlaceRevision(pendingRevision.id, decision);
        else await reviewManagedAtlasPlace(place.id, decision);
        [this.places, this.notifications, this.feedback] = await Promise.all([loadManagedAtlasPlaces(), loadAtlasNotifications(), loadManagedAtlasFeedback()]);
        await this.options.onPlacesChanged();
        this.setMessage(decision === "approve" ? copy.approvedReviewSuccess : copy.rejectedReviewSuccess, "success");
      }, "list");
      return;
    }
    if (action === "feedback-save" && id) {
      const target = this.feedback.find((item) => item.id === id);
      if (!target) return;
      const note = this.host.querySelector<HTMLTextAreaElement>(`[data-owner-feedback-note][data-id="${CSS.escape(id)}"]`)?.value ?? "";
      await this.runTask(async () => {
        const updated = await updateManagedAtlasFeedback(id, target.status, note);
        this.feedback = this.feedback.map((item) => item.id === updated.id ? updated : item);
        const currentLanguage = this.options.getLanguage(); this.setMessage(currentLanguage === "ar" ? "تم حفظ الرد." : currentLanguage === "en" ? "Reply saved." : "وەڵامەکە پارێزرا.", "success");
      }, "list");
      return;
    }
    if (action === "feedback-delete" && id) {
      this.pendingConfirmation = { kind: "feedback", feedbackId: id };
      this.render();
      return;
    }
    if (action.startsWith("feedback-") && id) {
      const status = action.slice("feedback-".length) as AtlasFeedbackStatus;
      if (!(status === "in_progress" || status === "resolved" || status === "closed")) return;
      const note = this.host.querySelector<HTMLTextAreaElement>(`[data-owner-feedback-note][data-id="${CSS.escape(id)}"]`)?.value ?? "";
      await this.runTask(async () => {
        const updated = await updateManagedAtlasFeedback(id, status, note);
        this.feedback = this.feedback.map((item) => item.id === updated.id ? updated : item);
      }, "list");
      return;
    }
    if (action === "notification-delete" && id) {
      this.pendingConfirmation = { kind: "notification", notificationId: id };
      this.render();
      return;
    }
    if (action === "notification-read" && id) {
      await this.runTask(async () => {
        await markAtlasNotificationRead(id);
        this.notifications = this.notifications.map((item) => item.id === id ? { ...item, is_read: true } : item);
      }, "list");
      return;
    }
    if (action === "notifications-read-all") {
      await this.runTask(async () => {
        await markAllAtlasNotificationsRead();
        this.notifications = this.notifications.map((item) => ({ ...item, is_read: true }));
      }, "list");
      return;
    }
    if (action === "notifications-delete-read") {
      await this.runTask(async () => {
        await deleteReadAtlasNotifications();
        this.notifications = this.notifications.filter((item) => !item.is_read);
      }, "list");
      return;
    }
    if (action === "edit" && id) {
      this.choiceKind = null;
      const listed = this.places.find((place) => place.id === id) ?? null;
      this.editing = await loadManagedAtlasPlace(id) ?? listed;
      if (this.editing) this.chosenCoordinate = [this.editing.longitude, this.editing.latitude];
      this.view = "editor";
      this.setMessage("");
      this.render();
      return;
    }
    if (action === "choice-open" && (id === "group" || id === "type")) {
      this.captureEditorDraft();
      this.choiceKind = id;
      this.render();
      return;
    }
    if (action === "choice-close") { this.choiceKind = null; this.render(); return; }
    if (action === "choice-select" && id) {
      const draft = this.captureEditorDraft();
      if (this.choiceKind === "group") {
        const group = ATLAS_TAXONOMY_GROUPS.find((candidate) => candidate.id === id);
        const firstType = group ? ATLAS_TAXONOMY.find((entry) => entry.group === group.id)?.id : undefined;
        if (group && firstType) this.patchEditorDraft({ ...(draft?.fields ?? {}), category_group: group.id, category: firstType });
      } else if (this.choiceKind === "type") {
        const entry = atlasTaxonomyEntry(id);
        if (entry) this.patchEditorDraft({ ...(draft?.fields ?? {}), category_group: entry.group, category: entry.id });
      }
      this.choiceKind = null;
      this.render();
      return;
    }
    if (action === "pick") {
      this.captureEditorDraft();
      this.host.hidden = true;
      this.setMessage(copy.pickNext, "normal");
      this.options.requestMapPoint((coordinate) => {
        this.chosenCoordinate = coordinate;
        this.editing = this.editing ? { ...this.editing, longitude: coordinate[0], latitude: coordinate[1] } : null;
        this.patchEditorDraft({ longitude: coordinate[0].toFixed(7), latitude: coordinate[1].toFixed(7) });
        this.host.hidden = false;
        this.render();
      });
      return;
    }
    if (action === "confirm-cancel") {
      this.pendingConfirmation = null;
      this.render();
      return;
    }
    if (action === "confirm-proceed") {
      const pending = this.pendingConfirmation;
      this.pendingConfirmation = null;
      if (!pending) return;
      if (pending.kind === "signout") {
        try { await signOutAtlasOwner(); } catch { /* session may already be gone */ }
        this.identity = null;
        this.view = "signin";
        this.setMessage("");
        this.render();
        return;
      }
      if (pending.kind === "feedback") {
        await this.runTask(async () => {
          await deleteManagedAtlasFeedback(pending.feedbackId);
          this.feedback = this.feedback.filter((item) => item.id !== pending.feedbackId);
          this.activeWorkspaceTab = "messages";
        }, "list");
        return;
      }
      if (pending.kind === "notification") {
        await this.runTask(async () => {
          await deleteAtlasNotification(pending.notificationId);
          this.notifications = this.notifications.filter((item) => item.id !== pending.notificationId);
          this.activeWorkspaceTab = "notifications";
        }, "list");
        return;
      }
      if (pending.kind === "place") {
        const place = this.places.find((item) => item.id === pending.placeId);
        if (!place) { this.render(); return; }
        await this.runTask(async () => {
          const result = await deleteManagedAtlasPlace(place);
          await this.options.onPlacesChanged();
          this.places = await loadManagedAtlasPlaces();
          this.setMessage(result.mediaCleanupWarning ? copy.deleteCleanupWarning : copy.deleted, result.mediaCleanupWarning ? "normal" : "success");
        }, "list");
        return;
      }
      const place = this.editing && this.editing.id === pending.placeId ? this.editing : null;
      if (!place) { this.render(); return; }
      await this.runTask(async () => {
        const result = await deleteManagedAtlasPhoto(place, pending.photoId);
        await this.refreshEditingPlace();
        await this.options.onPlacesChanged();
        this.setMessage(result.mediaCleanupWarning ? copy.photoCleanupWarning : copy.photoDeleted, result.mediaCleanupWarning ? "normal" : "success");
      }, "editor");
      return;
    }
    if (action === "delete" && id) {
      if (!this.places.some((item) => item.id === id)) return;
      this.pendingConfirmation = { kind: "place", placeId: id };
      this.render();
      return;
    }
    if (action === "photo-cover" && id) {
      const place = this.editing;
      const photo = place ? orderedAtlasPhotos(place).find((item) => item.id === id) : undefined;
      if (!place || !photo) return;
      await this.runTask(async () => {
        await setManagedAtlasPlaceCover(place.id, photo.storage_path, photo.storage_bucket);
        await this.refreshEditingPlace();
        await this.options.onPlacesChanged();
        this.setMessage(copy.coverCurrent, "success");
      }, "editor");
      return;
    }
    if ((action === "photo-up" || action === "photo-down") && id) {
      const place = this.editing;
      if (!place) return;
      const photos = orderedAtlasPhotos(place);
      const index = photos.findIndex((item) => item.id === id);
      const target = action === "photo-up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= photos.length) return;
      [photos[index], photos[target]] = [photos[target], photos[index]];
      await this.runTask(async () => {
        await reorderManagedAtlasPhotos(place.id, photos.map((photo) => photo.id));
        await this.refreshEditingPlace();
        await this.options.onPlacesChanged();
      }, "editor");
      return;
    }
    if (action === "photo-delete" && id) {
      const place = this.editing;
      if (!place || !orderedAtlasPhotos(place).some((photo) => photo.id === id)) return;
      this.pendingConfirmation = { kind: "photo", placeId: place.id, photoId: id };
      this.render();
      return;
    }
    if (action.startsWith("status-") && id) {
      const status = action.slice("status-".length) as AtlasPlaceStatus;
      if (!(["draft", "published", "hidden"] as AtlasPlaceStatus[]).includes(status)) return;
      const place = this.editing?.id === id ? this.editing : this.places.find((item) => item.id === id) ?? null;
      if (!place || place.status === status) return;
      await this.runTask(async () => {
        const updated = await updateManagedAtlasPlaceStatus(place.id, status);
        this.editing = updated;
        await this.options.onPlacesChanged();
        this.places = await loadManagedAtlasPlaces();
        const message = status === "published" ? copy.publishedSuccess : status === "draft" ? copy.draftSuccess : copy.hiddenSuccess;
        this.setMessage(message, "success");
      }, "editor");
      return;
    }
    if (action === "signout") {
      if (!this.identity || this.busy) return;
      this.pendingConfirmation = { kind: "signout" };
      this.render();
      return;
    }
  }


  private async handleSave(form: HTMLFormElement): Promise<void> {
    if (!this.identity) return;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const category = String(data.get("category") ?? "village") as AtlasCategory;
    const metadata: AtlasPlaceMetadata = {};
    try {
      for (const field of atlasMetadataFieldsForSections(atlasPlaceTypeSections(category))) {
        const raw = String(data.get(`metadata_${field.key}`) ?? "").trim();
        if (!raw) continue;
        const numericPolicy = atlasNumericPolicy(field);
        if (numericPolicy) {
          const numeric = parseAtlasNumber(raw, numericPolicy, field.label.en);
          if (numeric !== null) metadata[field.key] = numeric;
        } else metadata[field.key] = raw;
      }
    } catch (error) {
      this.setMessage(atlasErrorMessage(error), "error");
      this.render();
      return;
    }

    let tags: string[];
    try {
      const userTags = parseTags(data.get("tags"));
      const systemTags = taxonomySystemTags(category);
      tags = normalizeAtlasTags([...userTags, ...systemTags]);
    } catch (error) {
      this.setMessage(atlasErrorMessage(error), "error");
      this.render();
      return;
    }

    const existingStatus = this.editing?.status ?? "draft";
    const oldDraftKey = this.currentDraftKey();
    this.busy = true;
    this.setMessage(this.currentCopy().saving, "normal");
    this.render();
    try {
      const saved = await saveManagedAtlasPlace({
        id: String(data.get("id") ?? "") || undefined,
        slug: String(data.get("slug") ?? "") || undefined,
        name_ku: String(data.get("name_ku") ?? ""),
        name_ar: String(data.get("name_ar") ?? ""),
        name_en: String(data.get("name_en") ?? ""),
        category,
        tags,
        metadata,
        description_ku: String(data.get("description_ku") ?? ""),
        description_ar: String(data.get("description_ar") ?? ""),
        description_en: String(data.get("description_en") ?? ""),
        longitude: Number(data.get("longitude")),
        latitude: Number(data.get("latitude")),
        status: existingStatus
      }, this.identity);
      clearOwnerEditorDraft(oldDraftKey);
      this.editing = await loadManagedAtlasPlace(saved.id) ?? saved;
      clearOwnerEditorDraft(ownerDraftKey(this.editing.id));
      this.chosenCoordinate = [this.editing.longitude, this.editing.latitude];
      this.view = "editor";
      this.setMessage(this.currentCopy().saved, "success");
      await this.options.onPlacesChanged();
      this.places = await loadManagedAtlasPlaces();
    } catch (error) {
      this.view = "editor";
      this.setMessage(atlasErrorMessage(error), "error");
      saveOwnerEditorDraft(oldDraftKey, captureOwnerFormFields(form));
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async handleUpload(form: HTMLFormElement): Promise<void> {
    if (!form.reportValidity()) return;
    const place = this.editing;
    if (!place) return;
    const data = new FormData(form);
    const file = data.get("photo_file");
    if (!(file instanceof File) || !file.name) {
      this.setMessage(this.currentCopy().uploadFailed, "error");
      this.render();
      return;
    }

    this.mediaUploadProgress = null;
    this.mediaUploadStatus = this.options.getLanguage() === "ar" ? "جارٍ تجهيز الصورة..." : this.options.getLanguage() === "en" ? "Preparing image..." : "ئامادەکردنی وێنە...";
    this.mediaCompressionInfo = "";
    this.busy = true;
    this.render();
    try {
      const prepared = await prepareAtlasImage(file);
      this.mediaCompressionInfo = prepared.compressed
        ? `${(prepared.originalBytes / 1048576).toFixed(2)} MB → ${(prepared.outputBytes / 1048576).toFixed(2)} MB`
        : `${(prepared.outputBytes / 1048576).toFixed(2)} MB`;
      this.mediaUploadProgress = 0;
      this.mediaUploadStatus = this.options.getLanguage() === "ar" ? "جارٍ رفع الصورة..." : this.options.getLanguage() === "en" ? "Uploading image..." : "بارکردنی وێنە...";
      this.render();
      const uploaded = await uploadManagedAtlasPhoto(place.id, prepared.file, {
        caption_ku: String(data.get("caption_ku") ?? ""),
        caption_ar: String(data.get("caption_ar") ?? ""),
        caption_en: String(data.get("caption_en") ?? "")
      }, (percent) => {
        this.mediaUploadProgress = percent;
        const progress = this.host.querySelector<HTMLProgressElement>(".owner-media__upload-progress progress");
        const label = this.host.querySelector<HTMLElement>(".owner-media__upload-progress b");
        if (progress) progress.value = percent;
        if (label) label.textContent = `${Math.round(percent)}%`;
      });
      await this.refreshEditingPlace();
      if (this.editing) {
        const photos = orderedAtlasPhotos(this.editing).filter((photo) => photo.id !== uploaded.id);
        this.editing = { ...this.editing, atlas_place_photos: [...photos, uploaded] };
      }
      await this.options.onPlacesChanged();
      this.setMessage(this.currentCopy().uploaded, "success");
    } catch (error) {
      this.setMessage(atlasErrorMessage(error), "error");
    } finally {
      this.mediaUploadProgress = null;
      this.mediaUploadStatus = "";
      this.mediaCompressionInfo = "";
      this.busy = false;
      this.view = "editor";
      this.render();
    }
  }

  private async handlePhotoCaption(form: HTMLFormElement): Promise<void> {
    if (!form.reportValidity()) return;
    const photoId = form.dataset.ownerPhotoForm;
    if (!photoId) return;
    const data = new FormData(form);
    await this.runTask(async () => {
      const updated = await updateManagedAtlasPhoto(photoId, {
        caption_ku: String(data.get("caption_ku") ?? ""),
        caption_ar: String(data.get("caption_ar") ?? ""),
        caption_en: String(data.get("caption_en") ?? "")
      });
      await this.refreshEditingPlace();
      if (this.editing) {
        const photos = orderedAtlasPhotos(this.editing).map((photo) => photo.id === updated.id ? updated : photo);
        this.editing = { ...this.editing, atlas_place_photos: photos };
      }
      await this.options.onPlacesChanged();
      this.setMessage(this.currentCopy().photoSaved, "success");
    }, "editor");
  }

  private async refreshEditingPlace(): Promise<void> {
    if (!this.editing) return;
    this.editing = await loadManagedAtlasPlace(this.editing.id) ?? this.editing;
    this.places = await loadManagedAtlasPlaces();
  }

  private async runTask(task: () => Promise<void>, view: StudioView): Promise<void> {
    this.busy = true;
    this.render();
    try {
      await task();
      this.view = view;
    } catch (error) {
      this.view = view;
      this.setMessage(atlasErrorMessage(error), "error");
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
