import { atlasSupabase, recordAtlasUserActivity, type AtlasActivityKind } from "./atlas-places";
import { appUrl } from "./app-url";
import { query } from "./dom";
import { UI } from "./i18n";
import type { Language } from "./types";
import { installRealtimePresenceController, type PresenceActivityKind, type PresenceConnectionState } from "./realtime-presence-controller";

type SupportHubOptions = {
  getLanguage: () => Language;
};

type ActivityRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  last_seen_at: string | null;
  is_online?: boolean | null;
  total_count?: number | string | null;
};

type SupporterRow = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  note: string | null;
};

type VisitorPage = {
  rows: ActivityRow[];
  total: number;
};

const VISITOR_PAGE_SIZE = 24;
const VISITOR_REFRESH_LIMIT = 96;
// Migration 000018+ provides the privacy RPC. Treat it as enabled by default so
// a missing optional Vercel variable cannot silently disable the visitor list.
// Set the variable explicitly to "false" only during a controlled rollback.
const DIRECTORY_CONSENT_RPC_ENABLED = import.meta.env.VITE_KRI_PUBLIC_DIRECTORY_CONSENT_RPC !== "false";

function directoryConsentUnavailableCopy(language: Language): string {
  return language === "ar"
    ? "تعذر تحميل إعداد ظهورك الآن؛ ستبقى آخر قيمة محفوظة في قاعدة البيانات."
    : language === "en"
      ? "Your visibility setting could not be loaded; the last value saved in the database remains active."
      : "ڕێکخستنی دەرکەوتنت ئێستا بار نەبوو؛ کۆتا هەڵبژاردەی پاشەکەوتکراو لە داتابەیس بەردەوام دەبێت.";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean).slice(0, 2);
  return (parts.map((part) => Array.from(part)[0] ?? "").join("") || "•").toUpperCase();
}

function formatLastSeen(language: Language, iso: string | null, authoritativeNowMs: number, isOnline = false): string {
  const copy = UI[language];
  if (isOnline) return copy.supportLastSeenNow;
  if (!iso) return copy.supportLastSeenNow;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return copy.supportLastSeenNow;
  const deltaMs = authoritativeNowMs - parsed;
  // Heartbeats run every 55 seconds and the directory refreshes every minute.
  // A three-minute grace window prevents a genuinely online visitor from
  // flickering to an old relative timestamp during mobile radio sleep.
  if (deltaMs <= 180_000) return copy.supportLastSeenNow;
  const minutes = Math.max(1, Math.floor(deltaMs / 60_000));
  if (minutes < 60) return copy.supportLastSeenMinutes.replace(/\{count\}|#/g, String(minutes));
  const hours = Math.max(1, Math.floor(minutes / 60));
  if (hours < 48) return copy.supportLastSeenHours.replace(/\{count\}|#/g, String(hours));
  const days = Math.max(1, Math.floor(hours / 24));
  if (days < 60) return copy.supportLastSeenDays.replace(/\{count\}|#/g, String(days));
  const months = Math.max(1, Math.floor(days / 30));
  if (months < 24) return copy.supportLastSeenMonths.replace(/\{count\}|#/g, String(months));
  const years = Math.max(1, Math.floor(days / 365));
  return copy.supportLastSeenYears.replace(/\{count\}|#/g, String(years));
}

function personAvatar(name: string, avatarUrl: string | null): string {
  if (avatarUrl) return `<img src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy">`;
  return `<span>${escapeHtml(initials(name))}</span>`;
}

function fallbackName(language: Language, userId: string, kind: "visitor" | "supporter"): string {
  const suffix = userId.trim().slice(0, 4).toUpperCase() || "0000";
  const base = kind === "supporter"
    ? (language === "ar" ? "داعم" : language === "en" ? "Supporter" : "هاوکار")
    : (language === "ar" ? "مستخدم" : language === "en" ? "User" : "بەکارهێنەر");
  return `${base} • ${suffix}`;
}

function normalizedTotal(value: ActivityRow["total_count"], fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function mergeVisitors(current: ActivityRow[], incoming: ActivityRow[]): ActivityRow[] {
  const byUser = new Map<string, ActivityRow>();
  for (const row of [...current, ...incoming]) {
    if (!row.user_id || !row.display_name?.trim()) continue;
    const previous = byUser.get(row.user_id);
    if (!previous || Date.parse(row.last_seen_at ?? "") >= Date.parse(previous.last_seen_at ?? "")) byUser.set(row.user_id, row);
  }
  return [...byUser.values()].sort((a, b) => Date.parse(b.last_seen_at ?? "") - Date.parse(a.last_seen_at ?? ""));
}

export function installSupportHub(options: SupportHubOptions) {
  const recentVisitorsList = query<HTMLElement>("#supportRecentVisitorsList");
  const visitorPrivacyControl = query<HTMLElement>("#supportVisitorPrivacyControl");
  const supportersList = query<HTMLElement>("#supportersList");
  const onlineCount = document.querySelector<HTMLElement>("#supportOnlineCount");
  const inlineOnlineCount = document.querySelector<HTMLElement>("#mapOnlineIndicatorCount");
  const inlineOnlineLabel = document.querySelector<HTMLElement>("#mapOnlineIndicatorLabel");
  const inlineOnlineIndicator = document.querySelector<HTMLElement>("#mapOnlineIndicator");
  const copyButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".support-method__copy-button"));
  const audio = typeof Audio !== "undefined" ? new Audio(`${import.meta.env.BASE_URL}assets/support/copy-asmr.wav`) : null;
  if (audio) {
    audio.preload = "auto";
    audio.volume = 0.8;
  }
  let lastVisitors: ActivityRow[] = [];
  let totalVisitorCount = 0;
  let visitorsLoading = false;
  let lastSupporters: SupporterRow[] = [];
  let lastOnlineCount = 0;
  let presenceState: PresenceConnectionState = atlasSupabase ? "connecting" : "disabled";
  let presenceSignedIn = false;
  let lastPresenceTouchAt = 0;
  let refreshTimer = 0;
  let serverClockOffsetMs = 0;
  let directoryVisible = false;
  let directoryVisibilityLoaded = false;
  let directoryVisibilitySaving = false;
  let directoryVisibilityMessage: "saved" | "error" | null = null;
  let activityLoaded = false;

  const render = (): void => {
    const language = options.getLanguage();
    const copy = UI[language];
    if (onlineCount) onlineCount.textContent = String(lastOnlineCount);
    if (inlineOnlineCount) inlineOnlineCount.textContent = String(lastOnlineCount);
    if (inlineOnlineIndicator) {
      inlineOnlineIndicator.dataset.state = lastOnlineCount > 0 ? "active" : "idle";
      inlineOnlineIndicator.dataset.connection = presenceState;
      inlineOnlineIndicator.setAttribute("aria-busy", String(presenceState === "connecting"));
    }
    if (inlineOnlineLabel) inlineOnlineLabel.textContent = copy.supportOnline;

    const privacyMessage = directoryVisibilityMessage === "saved"
      ? `<small class="support-visitors-privacy__message is-success">${escapeHtml(copy.supportVisitorPrivacySaved)}</small>`
      : directoryVisibilityMessage === "error"
        ? `<small class="support-visitors-privacy__message is-error">${escapeHtml(copy.supportVisitorPrivacyError)}</small>`
        : "";
    visitorPrivacyControl.innerHTML = presenceSignedIn && DIRECTORY_CONSENT_RPC_ENABLED
      ? `<label class="support-visitors-privacy__choice"><input id="supportVisitorVisibility" type="checkbox" ${directoryVisible ? "checked" : ""} ${directoryVisibilitySaving || !directoryVisibilityLoaded ? "disabled" : ""}><span>${escapeHtml(directoryVisibilitySaving ? copy.supportVisitorPrivacySaving : copy.supportVisitorPrivacyOptIn)}</span></label><a href="${escapeHtml(appUrl("legal/privacy.html"))}" target="_blank" rel="noopener">${escapeHtml(copy.supportVisitorPrivacyLink)}</a>${privacyMessage}`
      : presenceSignedIn
        ? `<p>${escapeHtml(directoryConsentUnavailableCopy(language))}</p><a href="${escapeHtml(appUrl("legal/privacy.html"))}" target="_blank" rel="noopener">${escapeHtml(copy.supportVisitorPrivacyLink)}</a>`
        : `<p>${escapeHtml(copy.supportVisitorPrivacySignedOut)}</p><a href="${escapeHtml(appUrl("legal/privacy.html"))}" target="_blank" rel="noopener">${escapeHtml(copy.supportVisitorPrivacyLink)}</a>`;
    visitorPrivacyControl.querySelector<HTMLInputElement>("#supportVisitorVisibility")?.addEventListener("change", (event) => {
      const input = event.currentTarget;
      if (input instanceof HTMLInputElement) void saveDirectoryVisibility(input.checked);
    });

    const visitorCards = lastVisitors.map((person) => {
      const name = person.display_name?.trim() || fallbackName(language, person.user_id, "visitor");
      const authoritativeNowMs = Date.now() + serverClockOffsetMs;
      const parsedLastSeen = Date.parse(person.last_seen_at ?? "");
      const fallbackOnline = Number.isFinite(parsedLastSeen)
        && authoritativeNowMs - parsedLastSeen >= -30_000
        && authoritativeNowMs - parsedLastSeen <= 180_000;
      const isOnline = person.is_online === true || fallbackOnline;
      const lastSeen = formatLastSeen(language, person.last_seen_at, authoritativeNowMs, isOnline);
      const detail = person.display_name?.trim() ? lastSeen : `${lastSeen} · ${language === "ar" ? "ملف مختصر" : language === "en" ? "Quick visitor profile" : "پرۆفایلی کورتی سەردانکەر"}`;
      return `<article class="support-person${isOnline ? " is-online" : ""}" role="listitem"><span class="support-person__avatar">${personAvatar(name, person.avatar_url)}${isOnline ? '<i class="support-person__online-dot" aria-hidden="true"></i>' : ""}</span><div class="support-person__body"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(detail)}</small></div></article>`;
    }).join("");
    const hasMoreVisitors = totalVisitorCount > lastVisitors.length;
    const progressText = copy.supportVisitorsProgress
      .replace("{shown}", String(lastVisitors.length))
      .replace("{total}", String(totalVisitorCount))
      .replace("#", String(lastVisitors.length))
      .replace("%", String(totalVisitorCount));
    const visitorFooter = lastVisitors.length
      ? `<div class="support-visitors__footer"><small>${escapeHtml(progressText)}</small>${hasMoreVisitors ? `<button id="supportVisitorsLoadMore" type="button" ${visitorsLoading ? "disabled" : ""}>${escapeHtml(visitorsLoading ? "…" : copy.supportVisitorsLoadMore)}</button>` : ""}</div>`
      : "";
    recentVisitorsList.innerHTML = lastVisitors.length
      ? `${visitorCards}${visitorFooter}`
      : `<p class="support-empty">${escapeHtml(activityLoaded ? copy.supportVisitorsEmpty : copy.supportVisitorsLoading)}</p>`;
    recentVisitorsList.querySelector<HTMLButtonElement>("#supportVisitorsLoadMore")?.addEventListener("click", () => { void loadMoreVisitors(); });

    supportersList.innerHTML = lastSupporters.length
      ? lastSupporters.map((person) => {
          const name = person.display_name?.trim() || fallbackName(language, person.id, "supporter");
          const note = person.note?.trim() || (language === "ar" ? "شكراً لدعمكم" : language === "en" ? "Thank you for your support" : "سوپاس بۆ پشتیوانیتان");
          return `<article class="support-person" role="listitem"><span class="support-person__avatar support-person__avatar--supporter">${personAvatar(name, person.avatar_url)}</span><div class="support-person__body"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(note)}</small></div></article>`;
        }).join("")
      : `<p class="support-empty">${escapeHtml(copy.supportSupportersEmpty)}</p>`;
    copyButtons.forEach((button) => {
      if (!button.dataset.copied) {
        button.textContent = copy.supportCopy;
        button.setAttribute("aria-label", copy.supportCopy);
      }
    });
  };

  async function copyText(button: HTMLButtonElement): Promise<void> {
    const value = button.dataset.copyValue?.trim() ?? "";
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const language = options.getLanguage();
      button.dataset.copied = "true";
      button.textContent = UI[language].supportCopied;
      button.classList.add("is-copied");
      if (audio) {
        try {
          audio.currentTime = 0;
          void audio.play();
        } catch { /* ignored */ }
      }
      window.setTimeout(() => {
        delete button.dataset.copied;
        button.classList.remove("is-copied");
        button.textContent = UI[options.getLanguage()].supportCopy;
      }, 1800);
    } catch {
      button.classList.add("is-copied");
      window.setTimeout(() => button.classList.remove("is-copied"), 1200);
    }
  }

  async function touchPresence(kind: AtlasActivityKind = "active"): Promise<void> {
    if (!atlasSupabase || !presenceSignedIn || document.hidden || !navigator.onLine) return;
    const now = Date.now();
    const minimumGap = kind === "sign_in" ? 0 : 30_000;
    if (now - lastPresenceTouchAt < minimumGap) return;
    lastPresenceTouchAt = now;
    const serverTimestamp = await recordAtlasUserActivity(kind);
    if (!serverTimestamp) {
      lastPresenceTouchAt = 0;
      return;
    }
    if (kind === "sign_in") await refreshActivity();
  }

  async function refreshDirectoryVisibility(): Promise<void> {
    if (!atlasSupabase || !presenceSignedIn || !DIRECTORY_CONSENT_RPC_ENABLED) {
      directoryVisible = false;
      directoryVisibilityLoaded = !DIRECTORY_CONSENT_RPC_ENABLED;
      directoryVisibilityMessage = null;
      return;
    }
    const result = await atlasSupabase.rpc("get_atlas_public_directory_visibility");
    if (!result.error) {
      directoryVisible = result.data === true;
      directoryVisibilityLoaded = true;
    }
  }

  async function saveDirectoryVisibility(visible: boolean): Promise<void> {
    if (!DIRECTORY_CONSENT_RPC_ENABLED || !atlasSupabase || !presenceSignedIn || directoryVisibilitySaving) return;
    directoryVisibilitySaving = true;
    directoryVisibilityMessage = null;
    render();
    try {
      const result = await atlasSupabase.rpc("set_atlas_public_directory_visibility", { p_visible: visible });
      if (result.error) throw result.error;
      directoryVisible = result.data === true;
      directoryVisibilityLoaded = true;
      directoryVisibilityMessage = "saved";
      lastVisitors = [];
      totalVisitorCount = 0;
      await refreshActivity();
    } catch {
      directoryVisibilityMessage = "error";
    } finally {
      directoryVisibilitySaving = false;
      render();
      window.setTimeout(() => {
        directoryVisibilityMessage = null;
        render();
      }, 3000);
    }
  }

  async function fetchVisitorPage(limit: number, offset: number): Promise<VisitorPage | null> {
    if (!atlasSupabase) return null;
    const directoryResult = await atlasSupabase.rpc("list_public_visitor_directory", {
      p_limit: limit,
      p_offset: offset
    });
    if (!directoryResult.error && Array.isArray(directoryResult.data)) {
      const rows = (directoryResult.data as ActivityRow[]).filter((row) => Boolean(row.display_name?.trim()));
      const total = rows.length ? normalizedTotal(rows[0]?.total_count, offset + rows.length) : offset;
      return { rows, total };
    }
    return null;
  }

  async function loadMoreVisitors(): Promise<void> {
    if (visitorsLoading || !atlasSupabase || lastVisitors.length >= totalVisitorCount) return;
    visitorsLoading = true;
    render();
    try {
      const page = await fetchVisitorPage(VISITOR_PAGE_SIZE, lastVisitors.length);
      if (page) {
        lastVisitors = mergeVisitors(lastVisitors, page.rows);
        totalVisitorCount = Math.max(page.total, lastVisitors.length);
      }
    } catch {
      // Preserve the already rendered persistent directory page.
    } finally {
      visitorsLoading = false;
      render();
    }
  }

  async function refreshActivity(): Promise<void> {
    if (!atlasSupabase) {
      render();
      return;
    }
    try {
      const requestStartedAt = Date.now();
      const retainedVisitorLimit = Math.min(Math.max(lastVisitors.length, VISITOR_PAGE_SIZE), VISITOR_REFRESH_LIMIT);
      const [visitorPage, supportersResult, clockResult] = await Promise.all([
        fetchVisitorPage(retainedVisitorLimit, 0),
        atlasSupabase.rpc("list_public_supporters", { p_limit: 18 }),
        atlasSupabase.rpc("get_atlas_server_clock"),
        refreshDirectoryVisibility()
      ]);
      const requestFinishedAt = Date.now();
      if (!clockResult.error && typeof clockResult.data === "string") {
        const serverMs = Date.parse(clockResult.data);
        if (Number.isFinite(serverMs)) {
          serverClockOffsetMs = serverMs - Math.round((requestStartedAt + requestFinishedAt) / 2);
        }
      }
      if (visitorPage) {
        lastVisitors = mergeVisitors(lastVisitors, visitorPage.rows);
        totalVisitorCount = Math.max(visitorPage.total, lastVisitors.length);
      }
      if (!supportersResult.error && Array.isArray(supportersResult.data)) lastSupporters = supportersResult.data as SupporterRow[];
      activityLoaded = true;
    } catch {
      // Keep the most recent successfully rendered values.
      activityLoaded = true;
    }
    render();
  }

  async function refreshAll(): Promise<void> {
    await touchPresence("active");
    await refreshActivity();
  }

  const presence = installRealtimePresenceController({
    onChange: (snapshot) => {
      lastOnlineCount = snapshot.onlineCount;
      presenceState = snapshot.state;
      if (presenceSignedIn !== snapshot.signedIn) {
        presenceSignedIn = snapshot.signedIn;
        directoryVisibilityLoaded = false;
        void refreshDirectoryVisibility().finally(render);
      } else {
        presenceSignedIn = snapshot.signedIn;
      }
      if (snapshot.signedIn && snapshot.state === "live") void touchPresence("heartbeat");
      render();
      window.dispatchEvent(new CustomEvent("nav-kurd:presence-change", { detail: snapshot }));
    },
    onActivity: (kind: PresenceActivityKind) => touchPresence(kind)
  });

  const handleCopyClick = (event: Event): void => {
    const button = event.currentTarget;
    if (button instanceof HTMLButtonElement) void copyText(button);
  };
  const handleVisibilityChange = (): void => {
    if (!document.hidden) void refreshAll();
  };
  const handleOnline = (): void => { void refreshAll(); };

  copyButtons.forEach((button) => button.addEventListener("click", handleCopyClick));
  document.addEventListener("visibilitychange", handleVisibilityChange, { passive: true });
  window.addEventListener("online", handleOnline, { passive: true });

  refreshTimer = window.setInterval(() => { void refreshAll(); }, 60_000);
  void refreshAll();

  return {
    refreshLanguage(): void { render(); },
    refresh(): Promise<void> { return refreshAll(); },
    destroy(): void {
      window.clearInterval(refreshTimer);
      copyButtons.forEach((button) => button.removeEventListener("click", handleCopyClick));
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      presence.destroy();
    }
  };
}
