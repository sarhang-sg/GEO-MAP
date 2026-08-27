import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import type { LngLatTuple } from "./location";

export type ShareLocationOptions = {
  coordinate: LngLatTuple;
  title?: string;
  text?: string;
};

function publicAppUrl(): URL {
  const configured = import.meta.env.VITE_PUBLIC_APP_URL?.trim();
  const base = configured || (typeof window !== "undefined" ? window.location.origin : "https://geo-map-two.vercel.app");
  return new URL(base);
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
  const url = locationDeepLink(options);
  const text = options.text?.trim() || `${title}\n${options.coordinate[1].toFixed(6)}, ${options.coordinate[0].toFixed(6)}`;
  try {
    if (Capacitor.isNativePlatform()) {
      await Share.share({ title, text, url, dialogTitle: title });
      return true;
    }
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
  }
  return clipboardFallback(`${text}\n${url}`);
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
