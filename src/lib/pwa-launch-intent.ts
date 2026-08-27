import type { LngLatTuple } from "./location";

export type PwaLaunchIntentHandlers = {
  focusSearch: (value?: string) => void;
  focusCoordinate: (coordinate: LngLatTuple, label?: string) => void;
  locate: () => void;
  fitRegion: () => void;
  openMapFiles: (files: readonly File[]) => Promise<void> | void;
  newPlaceNote: () => Promise<void> | void;
};

export type LaunchParams = {
  action: string;
  searchText: string;
  coordinate: LngLatTuple | null;
  label: string;
};

type FileSystemFileHandleLike = {
  getFile: () => Promise<File>;
};

type LaunchQueueParams = {
  targetURL: string;
  files?: readonly FileSystemFileHandleLike[];
};

type LaunchQueueLike = {
  setConsumer: (consumer: (params: LaunchQueueParams) => Promise<void> | void) => void;
};

declare global {
  interface Window {
    launchQueue?: LaunchQueueLike;
    __navKurdPendingNativeUrls?: string[];
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function protocolToSearchText(value: string): string {
  const decoded = safeDecode(value.trim());
  if (!decoded) return "";
  return decoded.replace(/^web\+navkurd:(?:\/\/)?/i, "").replace(/^\/+/, "").trim();
}

function finiteCoordinate(params: URLSearchParams): LngLatTuple | null {
  const latitude = Number(params.get("lat"));
  const longitude = Number(params.get("lng") ?? params.get("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return [longitude, latitude];
}

export function parsePwaLaunchParams(urlValue: string): LaunchParams {
  const url = new URL(urlValue, window.location.origin);
  const params = url.searchParams;
  const schemeAction = url.protocol === "navkurd:" ? (url.hostname || url.pathname.replace(/^\/+/, "")) : "";
  const action = (params.get("action")?.trim() || schemeAction).toLowerCase();
  const shareText = [params.get("share_title"), params.get("share_text"), params.get("share_url")]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ")
    .trim();
  const protocolText = protocolToSearchText(params.get("protocol") ?? "");
  const label = safeDecode(params.get("label")?.trim() ?? "");
  return { action, searchText: shareText || protocolText, coordinate: finiteCoordinate(params), label };
}

export function installPwaLaunchIntentHandler(handlers: PwaLaunchIntentHandlers): () => void {
  const apply = (url: string): void => {
    const intent = parsePwaLaunchParams(url);
    if (intent.coordinate && ["coordinate", "place", "location", "share"].includes(intent.action)) {
      handlers.focusCoordinate(intent.coordinate, intent.label || undefined);
      return;
    }
    if (intent.searchText) {
      handlers.focusSearch(intent.searchText);
      return;
    }
    if (intent.action === "search") handlers.focusSearch();
    else if (intent.action === "locate") handlers.locate();
    else if (intent.action === "fit") handlers.fitRegion();
    else if (intent.action === "new-place-note") void handlers.newPlaceNote();
  };

  const nativeUrlListener = (event: Event): void => {
    const url = (event as CustomEvent<{ url?: string }>).detail?.url;
    if (url) apply(url);
  };

  apply(window.location.href);
  const pendingNativeUrls = window.__navKurdPendingNativeUrls?.splice(0) ?? [];
  pendingNativeUrls.forEach(apply);
  window.addEventListener("nav-kurd:native-url", nativeUrlListener as EventListener);
  window.launchQueue?.setConsumer(async ({ targetURL, files }) => {
    if (files?.length) {
      const opened = await Promise.all(files.map((handle) => handle.getFile()));
      await handlers.openMapFiles(opened);
      return;
    }
    if (targetURL) apply(targetURL);
  });
  return () => window.removeEventListener("nav-kurd:native-url", nativeUrlListener as EventListener);
}
