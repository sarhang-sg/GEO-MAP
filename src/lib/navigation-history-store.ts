import {
  getAtlasAuthIdentity,
  loadAtlasNavigationHistory,
  syncAtlasNavigationHistory,
  type AtlasNavigationHistory,
  type AtlasNavigationHistoryInput
} from "./atlas-places";

const STORAGE_KEY = "nav-kurd-navigation-history-v1";
const LIMIT = 40;
type PendingHistory = AtlasNavigationHistoryInput & { userId?: string | null };

export function loadPendingNavigationHistory(userId?: string): PendingHistory[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): PendingHistory[] => {
      if (!value || typeof value !== "object") return [];
      const item = value as Partial<PendingHistory>;
      if (typeof item.id !== "string" || !item.id.trim()
        || (item.status !== "arrived" && item.status !== "cancelled")
        || !Number.isFinite(item.startedAt) || !Number.isFinite(item.endedAt)
        || typeof item.destination !== "string") return [];
      if (userId !== undefined && item.userId !== userId) return [];
      const coordinate = Array.isArray(item.coordinate)
        && item.coordinate.length === 2
        && Number.isFinite(Number(item.coordinate[0]))
        && Number.isFinite(Number(item.coordinate[1]))
        ? [Number(item.coordinate[0]), Number(item.coordinate[1])] as [number, number]
        : null;
      return [{
        userId: typeof item.userId === "string" ? item.userId : null,
        id: item.id,
        status: item.status,
        startedAt: Number(item.startedAt),
        endedAt: Number(item.endedAt),
        destination: item.destination,
        coordinate,
        travelMode: item.travelMode === "bicycle" || item.travelMode === "walking" ? item.travelMode : "car",
        plannedDistanceMeters: Number(item.plannedDistanceMeters) || 0,
        remainingDistanceMeters: Number(item.remainingDistanceMeters) || 0,
        plannedDurationSeconds: Number(item.plannedDurationSeconds) || 0,
        elapsedSeconds: Number(item.elapsedSeconds) || 0
      }];
    }).slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function queueNavigationHistory(entry: AtlasNavigationHistoryInput, userId: string | null = null): boolean {
  try {
    const history = loadPendingNavigationHistory().filter((item) => item.id !== entry.id || item.userId !== userId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ ...entry, userId }, ...history].slice(0, LIMIT)));
    return true;
  } catch { return false; }
}

export function removePendingNavigationHistory(id?: string, userId?: string): void {
  try {
    if (!userId) return;
    const remaining = loadPendingNavigationHistory().filter((entry) => (userId !== undefined && entry.userId !== userId) || (id !== undefined && entry.id !== id));
    if (remaining.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* The database remains authoritative. */ }
}

function pendingRows(entries: readonly AtlasNavigationHistoryInput[], userId: string): AtlasNavigationHistory[] {
  return entries.map((entry) => ({
    user_id: userId,
    id: entry.id,
    status: entry.status,
    started_at: new Date(entry.startedAt).toISOString(),
    ended_at: new Date(entry.endedAt).toISOString(),
    destination: entry.destination,
    destination_longitude: entry.coordinate?.[0] ?? null,
    destination_latitude: entry.coordinate?.[1] ?? null,
    travel_mode: entry.travelMode,
    planned_distance_meters: entry.plannedDistanceMeters,
    remaining_distance_meters: entry.remainingDistanceMeters,
    planned_duration_seconds: entry.plannedDurationSeconds,
    elapsed_seconds: entry.elapsedSeconds,
    created_at: new Date(entry.endedAt).toISOString()
  }));
}

// Share concurrent panel refreshes and back off failures without losing queued routes.
const loads = new Map<string, Promise<AtlasNavigationHistory[]>>();
const retryAt = new Map<string, number>();
export function loadSynchronizedNavigationHistory(userId: string): Promise<AtlasNavigationHistory[]> {
  const active = loads.get(userId);
  if (active) return active;
  const pending = loadPendingNavigationHistory(userId);
  if (Date.now() < (retryAt.get(userId) ?? 0)) return Promise.resolve(pendingRows(pending, userId));
  const task = (async () => {
    try {
      if (pending.length > 0) {
        const synced = await syncAtlasNavigationHistory(pending, userId);
        if (synced > 0) pending.forEach(entry => removePendingNavigationHistory(entry.id, userId));
      }
      const rows = await loadAtlasNavigationHistory(100, userId);
      retryAt.delete(userId);
      return rows;
    } catch (error) {
      retryAt.set(userId, Date.now() + 60_000);
      console.error("Navigation history synchronization failed; queued routes are retained and retry is delayed.", error);
      return pendingRows(loadPendingNavigationHistory(userId), userId);
    }
  })().finally(() => { loads.delete(userId); });
  loads.set(userId, task);
  return task;
}

/** One queue/sync path for route completion and account panels. Legacy unowned
 * entries stay on-device; they are never assigned to a different signed-in user. */
export async function persistNavigationHistory(entry: AtlasNavigationHistoryInput): Promise<void> {
  let userId: string | null = null;
  try {
    userId = (await getAtlasAuthIdentity())?.userId ?? null;
  } catch (error) {
    console.error("Navigation history identity unavailable; keeping the route on this device.", error);
  }
  const queued = queueNavigationHistory(entry, userId);
  if (userId) {
    if (queued) await loadSynchronizedNavigationHistory(userId);
    else await syncAtlasNavigationHistory([entry], userId);
  }
}
