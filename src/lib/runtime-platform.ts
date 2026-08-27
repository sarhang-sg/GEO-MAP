
import { Capacitor } from "@capacitor/core";

export type NativeRuntimeKind = "web" | "ios" | "android" | "windows";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    __NAV_KURD_FLUTTER__?: boolean;
  }
}

export function isFlutterAndroidRuntime(): boolean {
  return typeof window !== "undefined" && window.__NAV_KURD_FLUTTER__ === true;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

export function nativeRuntimeKind(): NativeRuntimeKind {
  if (isFlutterAndroidRuntime()) return "android";
  if (Capacitor.isNativePlatform()) {
    const platform = Capacitor.getPlatform();
    if (platform === "ios") return "ios";
    if (platform === "android") return "android";
  }
  if (isTauriRuntime()) return "windows";
  return "web";
}

export function isNativeAppRuntime(): boolean {
  return nativeRuntimeKind() !== "web";
}
