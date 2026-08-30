import releaseConfig from "../../release.config.json";
import { documentBaseUrl, safeUrl } from "./app-url";

export type OfflineMapFileConfig = {
  id: "base" | "roads";
  path: string;
  fileName: string;
  bytes: number;
  sha256: string;
};

export type ReleaseConfig = {
  appVersion: string;
  releaseId: string;
  mapEdition: string;
  mapDataVersion: string;
  cacheSchemaVersion: number;
  offlinePackVersion: string;
  serviceWorkerRelease: string;
  offlineMapFiles: OfflineMapFileConfig[];
  offlineRuntimeBytes: number;
};

const config = releaseConfig as ReleaseConfig;

export const APP_VERSION = config.appVersion;
export const MAP_EDITION = config.mapEdition;
export const MAP_DATA_VERSION = config.mapDataVersion;
export const CACHE_SCHEMA_VERSION = config.cacheSchemaVersion;
export const OFFLINE_PACK_VERSION = config.offlinePackVersion;
export const OFFLINE_MAP_FILES = config.offlineMapFiles;
export const OFFLINE_RUNTIME_BYTES = config.offlineRuntimeBytes;

export function versionedAssetUrl(url: string, version: string): string {
  const parsed = safeUrl(url, documentBaseUrl());
  if (!parsed) return url;
  parsed.searchParams.set("v", version);
  return parsed.toString();
}

export function dataAssetUrl(path: string): string {
  const base = `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;
  return versionedAssetUrl(base, MAP_DATA_VERSION);
}
