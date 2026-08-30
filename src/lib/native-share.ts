import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { LngLatTuple } from "./location";
import { browserEnv } from "./runtime-env";

export type ShareLocationOptions = {
  coordinate: LngLatTuple;
  title?: string;
  text?: string;
};

const CANONICAL_APP_URL = "https://geo-map-kappa.vercel.app/";

function publicAppUrl(): URL {
  const candidates = [
    browserEnv.publicAppUrl,
    typeof window !== "undefined" ? window.location.origin : "",
    CANONICAL_APP_URL
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed;
    } catch {
      // A malformed deployment variable must never break the share action.
    }
  }
  return new URL(CANONICAL_APP_URL);
}

export function locationDeepLink(options: ShareLocationOptions): string {
  const url = publicAppUrl();
  url.search = "";
  url.hash = "";
  url.searchParams.set("action", "coordinate");
  url.searchParams.set("lng", options.coordinate[0].toFixed(6));
  url.searchParams.set("lat", options.coordinate[1].toFixed(6));
  if (options.title?.trim()) url.searchParams.set("label", options.title.trim());
  return url.toString();
}

async function clipboardFallback(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }
}

export async function shareMapLocation(options: ShareLocationOptions): Promise<boolean> {
  const title = options.title?.trim() || "NAV KURD";
  const text = options.text?.trim() || `${title}\n${options.coordinate[1].toFixed(6)}, ${options.coordinate[0].toFixed(6)}`;
  try {
    const url = locationDeepLink(options);
    const flutterWindow = window as unknown as {
      __NAV_KURD_FLUTTER__?: boolean;
      navKurdAndroid?: { share?: (data: { title: string; text: string; url: string }) => Promise<boolean> };
    };
    if (flutterWindow.__NAV_KURD_FLUTTER__ === true && flutterWindow.navKurdAndroid?.share) {
      const handled = await flutterWindow.navKurdAndroid.share({ title, text, url });
      if (handled) return true;
    }
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text, url, dialogTitle: title });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    return clipboardFallback(`${text}\n${url}`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError" && window.__NAV_KURD_FLUTTER__ !== true) return false;
    const fallback = new URL(CANONICAL_APP_URL);
    fallback.searchParams.set("action", "coordinate");
    fallback.searchParams.set("lng", options.coordinate[0].toFixed(6));
    fallback.searchParams.set("lat", options.coordinate[1].toFixed(6));
    return clipboardFallback(`${text}\n${fallback.toString()}`);
  }
}

export function createPopupShareButton(options: ShareLocationOptions, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "place-popup__share";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void shareMapLocation(options);
  });
  return button;
}
