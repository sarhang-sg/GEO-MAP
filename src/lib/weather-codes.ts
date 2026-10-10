import descriptions from "../../contracts/weather-descriptions.json";
import type { Language } from "./types";
export type WeatherCondition = "clear" | "mainly-clear" | "partly-cloudy" | "cloudy" | "fog" | "drizzle" | "rain" | "freezing-rain" | "snow" | "showers" | "thunderstorm" | "hail" | "unavailable";
type CodeDescription = { kind: string; ku: string; ar: string; en: string };
const codes: Record<string, CodeDescription> = descriptions.codes;
/** Provider codes alone determine the condition; air pollution is separate. */
export function weatherCodeKind(code: number): WeatherCondition {
  return (codes[String(code)]?.kind as WeatherCondition | undefined) ?? "unavailable";
}
export function weatherCodeLabel(code: number, isDay: boolean, language: Language): string {
  if (code === 0 && isDay) return descriptions.clearDay[language];
  return codes[String(code)]?.[language] ?? descriptions.unavailable[language];
}
