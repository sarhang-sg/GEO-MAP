export type NativeRuntimeKind = "web" | "android";

declare global {
  interface Window {
    __NAV_KURD_FLUTTER__?: boolean;
  }
}

export function isFlutterAndroidRuntime(): boolean {
  return typeof window !== "undefined" && window.__NAV_KURD_FLUTTER__ === true;
}

export function nativeRuntimeKind(): NativeRuntimeKind {
  return isFlutterAndroidRuntime() ? "android" : "web";
}

export function isNativeAppRuntime(): boolean {
  return isFlutterAndroidRuntime();
}
