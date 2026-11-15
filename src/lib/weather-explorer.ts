import { absoluteAppUrl } from "./app-url";
import { cityKey, type WeatherCity } from "./weather-cities";
import type { Language } from "./types";

export type CityReading = {key:string; temperature:number; code:number; day:boolean; at:number; offset:number; high:number|null; low:number|null};
const readings = new Map<string,CityReading>();
try {
  for (const row of JSON.parse(localStorage.getItem("nav-kurd:city-readings") || "[]") as CityReading[]) {
    if (row && Number.isFinite(row.at) && Math.abs(Date.now() - row.at*1000) < 10*3600_000) readings.set(row.key,row);
  }
} catch { /* Storage is optional. */ }
export function cachedReading(city:WeatherCity): CityReading | undefined {
  const row = readings.get(cityKey(city));
  return row && Date.now()-row.at*1000 < 10*3600_000 ? row : undefined;
}
export async function cityReadings(cities:WeatherCity[], signal:AbortSignal):Promise<void> {
  const missing = cities.filter(c => !readings.has(cityKey(c)) || Date.now()-readings.get(cityKey(c))!.at*1000 >= 20*60_000);
  if (!missing.length) return;
  const url = new URL(absoluteAppUrl("api/cities"));
  url.searchParams.set("points",missing.map(cityKey).join("|"));
  const res = await fetch(url,{signal});
  if (!res.ok) throw new Error("weather-unavailable");
  for (const row of await res.json() as CityReading[]) {
    if (!row || !Number.isFinite(row.temperature) || !Number.isFinite(row.at) || Date.now()-row.at*1000 > 10*3600_000) continue;
    readings.delete(row.key); readings.set(row.key,row);
  }
  while (readings.size > 200) readings.delete(readings.keys().next().value!);
  try { localStorage.setItem("nav-kurd:city-readings", JSON.stringify([...readings.values()])); } catch { /* Use in-memory results. */ }
}
export async function globalCities(q:string, lang:Language, signal:AbortSignal):Promise<WeatherCity[]> {
  const url = new URL(absoluteAppUrl("api/cities"));
  url.search = new URLSearchParams({q,lang}).toString();
  const res = await fetch(url,{signal});
  if (!res.ok) throw new Error("geocoder-unavailable");
  return res.json();
}
export function skyMesh(temperature:number,code:number,at:number,offset:number,latitude:number):string {
  const local = new Date((at + offset)*1000), hour = local.getUTCHours();
  const phase = [5,7,10,12,15,17,19,24].findIndex(end => hour < end);
  const season = (Math.floor(((local.getUTCMonth()+1)%12)/3)+(latitude<0?2:0))%4;
  const base = [243,286,194,205,212,224,312,248][phase];
  const hue = code >= 95 ? 254 : code >= 71 && code <= 77 ? 212 : code >= 45 ? 207 : base;
  const glow = (base + [15,40,75,-30][season] + Math.min(35,Math.max(-20,temperature)) + 360)%360;
  return `radial-gradient(ellipse at 88% 4%,hsl(${glow} 47% 31%),transparent 65%),radial-gradient(ellipse at 3% 82%,hsl(${hue} 51% 23%),transparent 74%),linear-gradient(130deg,hsl(${base} 48% 18%),#111e34)`;
}
