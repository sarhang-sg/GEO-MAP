/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly VITE_KRI_MAP_DATA_VERSION?: string;
  readonly VITE_KRI_PMTILES_URL?: string;
  readonly VITE_KRI_ROADS_PMTILES_URL?: string;
  readonly VITE_KRI_ENABLE_SATELLITE?: string;
  readonly VITE_KRI_SATELLITE_PROVIDER?: string;
  readonly VITE_KRI_MAPTILER_TILESET_ID?: string;
  readonly VITE_KRI_MAPTILER_API_KEY?: string;
  readonly VITE_KRI_ENABLE_SENTINEL_OVERLAY?: string;
  readonly VITE_KRI_ROUTING_PROVIDER?: string;
  readonly VITE_KRI_ROUTING_BASE_URL?: string;
  readonly VITE_KRI_ROUTING_PROFILE?: string;
  readonly VITE_KRI_SATELLITE_ATTRIBUTION?: string;
  readonly VITE_KRI_SATELLITE_TILE_TEMPLATE?: string;
  readonly VITE_KRI_SATELLITE_TILEJSON_URL?: string;
  readonly VITE_PUBLIC_APP_URL?: string;
  readonly VITE_KRI_MAPBOX_ACCESS_TOKEN?: string;
  readonly VITE_KRI_ROUTE_REROUTE_METERS?: string;
  readonly VITE_KRI_ROUTE_REFRESH_SECONDS?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_KRI_MEDIA_BUCKET?: string;
  readonly VITE_KRI_PRIVATE_MEDIA_BUCKET?: string;
  readonly VITE_KRI_WEATHER_API_BASE_URL?: string;
  readonly VITE_KRI_PUBLIC_DIRECTORY_CONSENT_RPC?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
  __NAV_KURD_SW_REGISTRATION__?: Promise<import("./lib/service-worker-registration").ServiceWorkerRegistrationResult>;
}
