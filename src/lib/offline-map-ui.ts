import { UI, languageDirection } from "./i18n";
import type { OfflineMapPackManager, OfflinePackSnapshot } from "./offline-map-pack";
import type { Language } from "./types";
import { appUrl } from "./app-url";

type OfflineMapPackUiOptions = {
  manager: OfflineMapPackManager;
  getLanguage: () => Language;
};

function formatBytes(bytes: number, language: Language): string {
  const locale = language === "en" ? "en-US" : language === "ar" ? "ar-IQ" : "ckb-IQ";
  const mb = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
}

function setDeleteButtonCopy(button: HTMLButtonElement, label: string): void {
  const icon = document.createElement("img");
  icon.className = "nav-delete-icon";
  icon.src = appUrl("assets/icons/nav-kurd/delete.svg");
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  icon.draggable = false;
  const text = document.createElement("span");
  text.className = "visually-hidden";
  text.textContent = label;
  button.replaceChildren(icon, text);
  button.setAttribute("aria-label", label);
  button.title = label;
}

export class OfflineMapPackUiController {
  private readonly manager: OfflineMapPackManager;
  private readonly getLanguage: () => Language;
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly size: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressTrack: HTMLElement;
  private readonly persistence: HTMLElement;
  private readonly storage: HTMLElement;
  private readonly note: HTMLElement;
  private readonly downloadButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly deleteConfirmRoot: HTMLElement;
  private readonly deleteConfirmTitle: HTMLElement;
  private readonly deleteConfirmMessage: HTMLElement;
  private readonly deleteConfirmCancel: HTMLButtonElement;
  private readonly deleteConfirmProceed: HTMLButtonElement;
  private latest: OfflinePackSnapshot;
  private showCompletedMessage = false;
  private completedMessageTimer: number | null = null;
  private deleteInProgress = false;
  private deleteReturnFocus: HTMLElement | null = null;

  constructor(options: OfflineMapPackUiOptions) {
    this.manager = options.manager;
    this.getLanguage = options.getLanguage;
    this.root = document.querySelector<HTMLElement>("#offlineMapPack")!;
    this.title = document.querySelector<HTMLElement>("#offlinePackTitle")!;
    this.status = document.querySelector<HTMLElement>("#offlinePackStatus")!;
    this.size = document.querySelector<HTMLElement>("#offlinePackSize")!;
    this.progress = document.querySelector<HTMLElement>("#offlinePackProgress")!;
    this.progressTrack = this.progress.parentElement!;
    this.persistence = document.querySelector<HTMLElement>("#offlinePackPersistence")!;
    this.storage = document.querySelector<HTMLElement>("#offlinePackStorage")!;
    this.note = document.querySelector<HTMLElement>("#offlinePackNote")!;
    this.downloadButton = document.querySelector<HTMLButtonElement>("#offlinePackDownload")!;
    this.pauseButton = document.querySelector<HTMLButtonElement>("#offlinePackPause")!;
    this.resumeButton = document.querySelector<HTMLButtonElement>("#offlinePackResume")!;
    this.deleteButton = document.querySelector<HTMLButtonElement>("#offlinePackDelete")!;
    this.deleteConfirmRoot = document.querySelector<HTMLElement>("#offlinePackDeleteConfirm")!;
    this.deleteConfirmTitle = document.querySelector<HTMLElement>("#offlinePackDeleteConfirmTitle")!;
    this.deleteConfirmMessage = document.querySelector<HTMLElement>("#offlinePackDeleteConfirmMessage")!;
    this.deleteConfirmCancel = document.querySelector<HTMLButtonElement>("#offlinePackDeleteConfirmCancel")!;
    this.deleteConfirmProceed = document.querySelector<HTMLButtonElement>("#offlinePackDeleteConfirmProceed")!;
    document.body.append(this.deleteConfirmRoot);
    this.latest = this.manager.snapshot();

    this.downloadButton.addEventListener("click", () => { void this.manager.download(); });
    this.pauseButton.addEventListener("click", () => this.manager.pause());
    this.resumeButton.addEventListener("click", () => { void this.manager.download(); });
    this.deleteButton.addEventListener("click", () => this.openDeleteConfirmation());
    this.deleteConfirmRoot.querySelectorAll<HTMLElement>('[data-offline-pack-confirm="cancel"]').forEach((element) => {
      element.addEventListener("click", () => this.closeDeleteConfirmation());
    });
    this.deleteConfirmProceed.addEventListener("click", () => { void this.confirmDelete(); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.deleteConfirmRoot.hidden && !this.deleteInProgress) {
        event.preventDefault();
        this.closeDeleteConfirmation();
      }
    });
    this.manager.subscribe((snapshot) => {
      const previousStatus = this.latest.status;
      this.latest = snapshot;

      if (snapshot.status === "ready" && previousStatus !== "ready") {
        this.showCompletedMessage = true;
        if (this.completedMessageTimer !== null) window.clearTimeout(this.completedMessageTimer);
        this.completedMessageTimer = window.setTimeout(() => {
          this.completedMessageTimer = null;
          this.showCompletedMessage = false;
          this.render();
        }, 4200);
      } else if (snapshot.status !== "ready") {
        this.showCompletedMessage = false;
        if (this.completedMessageTimer !== null) {
          window.clearTimeout(this.completedMessageTimer);
          this.completedMessageTimer = null;
        }
      }

      this.render();
    });
  }

  refreshLanguage(): void {
    this.render();
  }

  private renderDeleteConfirmation(language: Language): void {
    const copy = UI[language];
    this.deleteConfirmRoot.dir = languageDirection(language);
    this.deleteConfirmTitle.textContent = copy.offlinePackDeleteConfirmTitle;
    if (!this.deleteInProgress && this.deleteConfirmMessage.dataset.state !== "error") {
      this.deleteConfirmMessage.textContent = copy.offlinePackDeleteConfirmMessage;
    }
    this.deleteConfirmCancel.textContent = copy.offlinePackDeleteConfirmCancel;
    setDeleteButtonCopy(
      this.deleteConfirmProceed,
      this.deleteInProgress ? copy.offlinePackDeleting : copy.offlinePackDeleteConfirmAction,
    );
  }

  private openDeleteConfirmation(): void {
    if (this.deleteInProgress || this.deleteButton.hidden) return;
    const language = this.getLanguage();
    this.deleteReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : this.deleteButton;
    this.deleteConfirmMessage.dataset.state = "normal";
    this.deleteConfirmMessage.textContent = UI[language].offlinePackDeleteConfirmMessage;
    this.deleteConfirmRoot.hidden = false;
    this.renderDeleteConfirmation(language);
    requestAnimationFrame(() => this.deleteConfirmCancel.focus({ preventScroll: true }));
  }

  private closeDeleteConfirmation(): void {
    if (this.deleteInProgress || this.deleteConfirmRoot.hidden) return;
    this.deleteConfirmRoot.hidden = true;
    this.deleteConfirmMessage.dataset.state = "normal";
    const focusTarget = this.deleteReturnFocus;
    this.deleteReturnFocus = null;
    focusTarget?.focus({ preventScroll: true });
  }

  private async confirmDelete(): Promise<void> {
    if (this.deleteInProgress || this.deleteConfirmRoot.hidden) return;
    const language = this.getLanguage();
    const copy = UI[language];
    this.deleteInProgress = true;
    this.deleteConfirmRoot.setAttribute("aria-busy", "true");
    this.deleteConfirmCancel.disabled = true;
    this.deleteConfirmProceed.disabled = true;
    this.deleteConfirmMessage.dataset.state = "normal";
    this.renderDeleteConfirmation(language);
    try {
      await this.manager.delete();
      this.deleteConfirmRoot.hidden = true;
      this.deleteConfirmMessage.dataset.state = "normal";
      this.deleteReturnFocus = null;
    } catch {
      this.deleteConfirmMessage.dataset.state = "error";
      this.deleteConfirmMessage.textContent = copy.offlinePackDeleteFailed;
    } finally {
      this.deleteInProgress = false;
      this.deleteConfirmRoot.removeAttribute("aria-busy");
      this.deleteConfirmCancel.disabled = false;
      this.deleteConfirmProceed.disabled = false;
      this.renderDeleteConfirmation(this.getLanguage());
      if (!this.deleteConfirmRoot.hidden) this.deleteConfirmCancel.focus({ preventScroll: true });
    }
  }

  private render(): void {
    const language = this.getLanguage();
    const copy = UI[language];
    const snapshot = this.latest;
    this.root.dir = languageDirection(language);
    this.root.dataset.status = snapshot.status;
    this.title.textContent = copy.offlinePackTitle;
    this.size.textContent = `${formatBytes(snapshot.downloadedBytes, language)} / ${formatBytes(snapshot.totalBytes, language)}`;
    const progressPercent = Math.max(0, Math.min(100, Math.round(snapshot.progress * 100)));
    this.progress.style.setProperty("--offline-progress", `${progressPercent}%`);
    this.progressTrack.setAttribute("aria-valuenow", String(progressPercent));
    this.progressTrack.setAttribute("aria-label", copy.offlinePackTitle);
    this.root.dataset.progressPhase = snapshot.status === "ready" || progressPercent >= 100
      ? "complete"
      : progressPercent >= 50
        ? "middle"
        : "start";
    this.persistence.textContent = snapshot.persisted ? copy.offlinePackPersistent : copy.offlinePackBestEffort;
    this.persistence.dataset.state = snapshot.persisted ? "protected" : "best-effort";
    this.storage.textContent = snapshot.storageAvailableBytes === null
      ? copy.offlinePackStorageUnknown
      : `${copy.offlinePackFreeStorage}: ${formatBytes(snapshot.storageAvailableBytes, language)}`;
    this.note.textContent = snapshot.status === "ready"
      ? copy.offlinePackRedownloadHint
      : copy.offlinePackOneTimeNote;

    const statusKey = snapshot.status === "ready"
      ? "offlinePackReady"
      : snapshot.status === "downloading"
        ? "offlinePackDownloading"
        : snapshot.status === "paused"
          ? "offlinePackPaused"
          : snapshot.status === "unsupported"
            ? "offlinePackUnsupported"
            : snapshot.status === "error"
              ? "offlinePackError"
              : "offlinePackNotReady";
    this.status.textContent = snapshot.status === "error" && snapshot.error?.startsWith("offline-pack-storage-insufficient")
      ? copy.offlinePackStorageInsufficient
      : snapshot.status === "ready" && this.showCompletedMessage
        ? copy.offlinePackCompleted
        : copy[statusKey];

    this.downloadButton.textContent = copy.offlinePackDownload;
    this.pauseButton.textContent = copy.offlinePackPause;
    this.resumeButton.textContent = copy.offlinePackResume;
    setDeleteButtonCopy(this.deleteButton, copy.offlinePackDelete);
    if (!this.deleteConfirmRoot.hidden) this.renderDeleteConfirmation(language);

    this.downloadButton.hidden = snapshot.status !== "idle" && snapshot.status !== "error";
    this.pauseButton.hidden = snapshot.status !== "downloading";
    this.resumeButton.hidden = snapshot.status !== "paused";
    this.deleteButton.hidden = snapshot.status !== "ready" && snapshot.status !== "paused" && snapshot.status !== "error";
    this.downloadButton.disabled = snapshot.status === "unsupported";
  }
}
