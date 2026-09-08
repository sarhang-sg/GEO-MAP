import {
  loadAtlasNavigationHistory,
  syncAtlasNavigationHistory,
  type AtlasNavigationHistory,
  type AtlasNavigationHistoryInput
} from "./atlas-places";

const STORAGE_KEY = "nav-kurd-navigation-history-v1";
const LIMIT = 40;

export function loadPendingNavigationHistory(): AtlasNavigationHistoryInput[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): AtlasNavigationHistoryInput[] => {
      if (!value || typeof value !== "object") return [];
      const item = value as Partial<AtlasNavigationHistoryInput>;
      if (typeof item.id !== "string" || !item.id.trim()
        || (item.status !== "arrived" && item.status !== "cancelled")
        || !Number.isFinite(item.startedAt) || !Number.isFinite(item.endedAt)
        || typeof item.destination !== "string") return [];
      const coordinate = Array.isArray(item.coordinate)
        && item.coordinate.length === 2
        && Number.isFinite(Number(item.coordinate[0]))
        && Number.isFinite(Number(item.coordinate[1]))
        ? [Number(item.coordinate[0]), Number(item.coordinate[1])] as [number, number]
        : null;
      return [{
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

export function queueNavigationHistory(entry: AtlasNavigationHistoryInput): void {
  try {
    const history = loadPendingNavigationHistory().filter((item) => item.id !== entry.id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...history].slice(0, LIMIT)));
  } catch { /* Cross-device persistence still runs when local storage is unavailable. */ }
}

export function removePendingNavigationHistory(id?: string): void {
  try {
    if (!id) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const remaining = loadPendingNavigationHistory().filter((entry) => entry.id !== id);
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

export async function loadSynchronizedNavigationHistory(userId: string): Promise<AtlasNavigationHistory[]> {
  const pending = loadPendingNavigationHistory();
  if (pending.length > 0) {
    try {
      const synced = await syncAtlasNavigationHistory(pending);
      if (synced > 0) removePendingNavigationHistory();
    } catch {
      return pendingRows(pending, userId);
    }
  }
  try {
    return await loadAtlasNavigationHistory(100);
  } catch {
    return pendingRows(pending, userId);
  }
}
