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

/** Descriptive context, not an official weather alert or a replacement for WMO. */
export function weatherContext(temperature: number | null, wind: number | null, gusts: number | null, language: Language): string[] {
  const labels: string[] = [], t = descriptions.contextThresholds, c = descriptions.context;
  const add = (key: keyof typeof c): void => { labels.push(c[key][language]); };
  if (temperature !== null && Number.isFinite(temperature)) {
    if (temperature <= t.extremeColdC) add("extremeCold");
    else if (temperature <= t.coldC) add("cold");
    else if (temperature < t.coolC) add("cool");
    else if (temperature >= t.extremeHeatC) add("extremeHeat");
    else if (temperature >= t.hotC) add("hot");
  }
  if (wind !== null && Number.isFinite(wind) && wind >= t.strongWindKmh) add("strongWind");
  else if (gusts !== null && Number.isFinite(gusts) && gusts >= t.strongGustsKmh) add("gusts");
  return labels;
}
