import type { Language } from "./types";
export type DrivingWeather = { observedAt: number; timezone?: string; stale: boolean; temperature: number; weatherCode: number; windGusts: number | null; hours: Array<{ at: number; temperature: number; weatherCode: number }> };
export type WeatherAdvisory = { kind: "rain" | "snow" | "storm" | "heat" | "ice" | "wind"; at: number; forecast: boolean; severity: number };
export const NAVIGATION_COPY = {
  ku: { arrivalShort: "گەیشتن", destination: "لە شوێنی مەبەست", selected: "لە شوێنی هەڵبژێردراو", arrival: "گەیشتنی پێشبینیکراو", speed: "خێرایی ئێستا", limit: "سنوور", weather: "ئاگاداریی کەش‌وهەوا", forecast: "پێشبینیی نزیک شوێنت", observed: "لە نزیک شوێنت", source: "Open-Meteo · پێشبینیی مۆدێل", close: "داخستن", ahead: "لە پێشەوە", rain: "بارانی زۆر؛ خێرایی کەم بکەوە و دووریی نێوان ئۆتۆمبێلەکان زیاد بکە.", snow: "بەفری زۆر؛ ئاگاداری کەمبوونی بینین و خلیسکانی ڕێگا بە.", storm: "هەورەتریشقە؛ ئاگاداری باران و کەمبوونی بینین بە.", heat: "گەرمای زۆر؛ گەرمیی ئۆتۆمبێلەکە چاودێری بکە و پشوو بدە.", ice: "ئەگەری بەستەڵەک؛ بە هێواشی بڕۆ و لە بریککردنی لەناکاو خۆ بپارێزە.", wind: "بای توند؛ بە تایبەتی لە ڕێگا کراوەکان ئاگادار بە." },
  ar: { arrivalShort: "الوصول", destination: "في الوجهة", selected: "في المكان المحدد", arrival: "الوصول المتوقع", speed: "السرعة الآن", limit: "الحد", weather: "تنبيه طقس", forecast: "توقعات قرب موقعك", observed: "قرب موقعك", source: "Open-Meteo · توقعات نموذجية", close: "إغلاق", ahead: "أمامك", rain: "أمطار غزيرة؛ خفف السرعة وزد مسافة الأمان.", snow: "ثلوج كثيفة؛ انتبه لضعف الرؤية وانزلاق الطريق.", storm: "عواصف رعدية؛ انتبه للأمطار وضعف الرؤية.", heat: "حرارة شديدة؛ راقب حرارة السيارة وخذ استراحة.", ice: "احتمال تجمد؛ قد بهدوء وتجنب الفرملة المفاجئة.", wind: "رياح قوية؛ توخ الحذر خصوصاً على الطرق المكشوفة." },
  en: { arrivalShort: "Arrival", destination: "At your destination", selected: "At the selected place", arrival: "Estimated arrival", speed: "Current speed", limit: "Limit", weather: "Weather advisory", forecast: "Forecast near you", observed: "Near your location", source: "Open-Meteo · model forecast", close: "Dismiss", ahead: "ahead", rain: "Heavy rain. Slow down and increase your following distance.", snow: "Heavy snow. Watch for poor visibility and slippery roads.", storm: "Thunderstorms. Watch for heavy rain and reduced visibility.", heat: "Extreme heat. Monitor vehicle temperature and take breaks.", ice: "Possible ice. Drive gently and avoid sudden braking.", wind: "Strong gusts. Take care on exposed roads." }
};
function condition(code: number, temperature: number): Pick<WeatherAdvisory,"kind" | "severity"> | null {
  if ([66,67,56,57].includes(code)) return { kind: "ice", severity: 5 };
  if ([75,86].includes(code)) return { kind: "snow", severity: 5 };
  if ([95,96,99].includes(code)) return { kind: "storm", severity: 4 };
  if ([65,82].includes(code)) return { kind: "rain", severity: 4 };
  if (Number.isFinite(temperature) && temperature >= 40 && temperature <= 65) return { kind: "heat", severity: 2 };
  return null;
}
/** Local model-based advice; stale/offline weather cannot issue a new alert. */
export function drivingWeatherAdvisory(reading: DrivingWeather, now: number, horizonHours = 2): WeatherAdvisory | null {
  if (reading.stale || !Number.isFinite(reading.observedAt) || now-reading.observedAt > 90*60_000 || reading.observedAt > now+5*60_000) return null;
  let warning = condition(reading.weatherCode,reading.temperature);
  if ((!warning || warning.severity < 3) && reading.windGusts !== null && reading.windGusts >= 70 && reading.windGusts <= 400) warning = { kind: "wind", severity: 3 };
  if (warning) return { ...warning, at: reading.observedAt, forecast: false };
  const horizon = Number.isFinite(horizonHours) ? Math.min(24, Math.max(0, horizonHours)) : 2;
  for (const hour of [...reading.hours].sort((a, b) => a.at - b.at)) {
    if (!Number.isFinite(hour.at) || hour.at <= now || hour.at > now+horizon*3600_000) continue;
    const next = condition(hour.weatherCode,hour.temperature);
    if (next) return { ...next, at: hour.at, forecast: true };
  }
  return null;
}
export function navigationClock(at: number, language: Language, timezone = "Asia/Baghdad"): string {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : language === "ar" ? "ar-IQ" : "ckb-IQ", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(at);
}

/** Explicit Kurdish names avoid English weekday fallback in Android WebView. */
export function forecastWeekday(at: number, timezone: string, language: Language): string {
  if (language === "ku") {
    const names: Record<string, string> = { Sun: "یەکشەممە", Mon: "دووشەممە", Tue: "سێشەممە", Wed: "چوارشەممە", Thu: "پێنجشەممە", Fri: "هەینی", Sat: "شەممە" };
    return names[new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short" }).format(at)];
  }
  return new Intl.DateTimeFormat(language === "ar" ? "ar-IQ" : "en-GB", { timeZone: timezone, weekday: "short" }).format(at);
}
