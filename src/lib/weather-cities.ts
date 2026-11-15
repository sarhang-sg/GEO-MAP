import { KRI_BOUNDS } from "./kri";
import cities from "../../contracts/weather-cities.json";
import type { Language, LocalityFeature } from "./types";

export type WeatherCity = { name: string; ar?: string; en?: string; lat: number; lon: number; aliases?: string[]; region?: string };
export const directoryCities: WeatherCity[] = cities;
export function cityKey(city: WeatherCity): string { return `${city.lat.toFixed(4)},${city.lon.toFixed(4)}`; }
export function cityName(city: WeatherCity, language: Language): string {
  return (language === "ku" ? city.name : city[language])?.trim() || city.name;
}
export function citySearchKey(name: string): string {
  return name.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").replace(/[يى]/gu,"ی")
    .replace(/ك/gu,"ک").replace(/[ةە]/gu,"ه").replace(/[^\p{L}\p{N}]/gu,"");
}
function names(city: WeatherCity): string[] { return [city.name, city.ar || "", city.en || "", ...city.aliases || []].filter(Boolean).map(citySearchKey); }
export function exactDirectoryCity(term: string): WeatherCity | undefined {
  const key = citySearchKey(term);
  return directoryCities.find(city => names(city).includes(key));
}
export function canonicalCityQuery(term: string): string { return exactDirectoryCity(term)?.en || term; }
export function cityMatches(city: WeatherCity, term: string): boolean { return names(city).some(name => name.includes(citySearchKey(term))); }
export function cityFeature(city: WeatherCity): LocalityFeature {
  return {type:"Feature", geometry:{type:"Point",coordinates:[city.lon,city.lat]},properties:{
    id:cityKey(city), name:city.name, name_ku:city.name, name_ar:city.ar, name_en:city.en,
    place:"city", search_key:city.aliases?.join("|"), admin_district_en:city.region}};
}

export function inMapCoverage(city: WeatherCity): boolean {
  const [[west,south],[east,north]] = KRI_BOUNDS;
  return city.lon >= west && city.lon <= east && city.lat >= south && city.lat <= north;
}
