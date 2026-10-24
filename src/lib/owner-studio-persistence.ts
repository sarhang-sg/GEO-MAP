export type OwnerListTab = "review" | "work" | "published";

export type OwnerEditorDraft = {
  version: 2;
  updatedAt: number;
  fields: Record<string, string>;
};

const DRAFT_PREFIX = "nav-kurd-owner-editor-draft-v2:";
const LIST_TAB_KEY = "nav-kurd-owner-list-tab-v1";

function safeStorage(): Storage | null {
  try {
    const storage = window.localStorage;
    const key = "__nav_kurd_storage_probe__";
    storage.setItem(key, "1");
    storage.removeItem(key);
    return storage;
  } catch {
    return null;
  }
}

export function ownerDraftKey(placeId?: string | null): string {
  return `${DRAFT_PREFIX}${placeId ? `edit:${placeId}` : "new"}`;
}

export function loadOwnerEditorDraft(key: string): OwnerEditorDraft | null {
  const storage = safeStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OwnerEditorDraft>;
    if (parsed.version !== 2 || !parsed.fields || typeof parsed.fields !== "object") return null;
    const fields: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed.fields)) {
      if (!/^[a-z0-9_:-]{1,96}$/i.test(name) || typeof value !== "string") continue;
      fields[name] = value.slice(0, 5000);
    }
    return { version: 2, updatedAt: Number(parsed.updatedAt) || 0, fields };
  } catch {
    return null;
  }
}

export function saveOwnerEditorDraft(key: string, fields: Record<string, string>): OwnerEditorDraft {
  const draft: OwnerEditorDraft = { version: 2, updatedAt: Date.now(), fields };
  const storage = safeStorage();
  if (storage) {
    try { storage.setItem(key, JSON.stringify(draft)); } catch { /* storage quota/private mode */ }
  }
  return draft;
}

export function clearOwnerEditorDraft(key: string): void {
  try { safeStorage()?.removeItem(key); } catch { /* no-op */ }
}

export function captureOwnerFormFields(form: HTMLFormElement): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
    if (!element.name || element.disabled) continue;
    if (element instanceof HTMLInputElement && ["file", "password"].includes(element.type)) continue;
    fields[element.name] = element.value;
  }
  return fields;
}

export function ownerDraftValue(draft: OwnerEditorDraft | null, name: string, fallback: string): string {
  return draft?.fields[name] ?? fallback;
}

export function loadOwnerListTab(): OwnerListTab {
  try {
    const value = safeStorage()?.getItem(LIST_TAB_KEY);
    return value === "published" || value === "review" ? value : "work";
  } catch { return "work"; }
}

export function saveOwnerListTab(tab: OwnerListTab): void {
  try { safeStorage()?.setItem(LIST_TAB_KEY, tab); } catch { /* no-op */ }
}
