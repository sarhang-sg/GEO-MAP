export type GeolocationProvider = Pick<
  Geolocation,
  "getCurrentPosition" | "watchPosition" | "clearWatch"
>;

/** Flutter's WebView and ordinary browsers both expose the standards API. */
export function getGeolocationProvider(): GeolocationProvider | null {
  return typeof navigator === "undefined" ? null : (navigator.geolocation ?? null);
}
