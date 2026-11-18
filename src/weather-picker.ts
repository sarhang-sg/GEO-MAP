import "./styles.css";
import { preparePresentationConfig } from "./lib/presentation-config";

import { cityFeature, cityMatches, cityName, type WeatherCity } from "./lib/weather-cities";
import type { Language } from "./lib/types";

await preparePresentationConfig();
const [{installWeatherDirectory},{PlaceWeatherService}] = await Promise.all([import("./lib/weather-directory"),import("./lib/place-weather")]);
const params = new URLSearchParams(location.search);
const lang = params.get("lang");
const language:Language = lang === "en" || lang === "ar" ? lang : "ku";
document.documentElement.lang = language === "ku" ? "ckb" : language;
document.documentElement.dir = language === "en" ? "ltr" : "rtl";
let catalog:Promise<WeatherCity[]> | undefined;
const native = () => window.flutter_inappwebview;
const hosted = Boolean(native()) || params.has("native");
const bridgeReady = async () => {
  if (!native() && hosted) await new Promise<void>(resolve => { const done=() => { window.removeEventListener("flutterInAppWebViewPlatformReady",done); resolve(); }; window.addEventListener("flutterInAppWebViewPlatformReady",done,{once:true}); window.setTimeout(done,2000); });
  return native();
};
const directory = installWeatherDirectory({
  shell:document.getElementById("weather-picker")!, getLanguage:()=>language,
  service:new PlaceWeatherService(), embedded:hosted,
  search: async term => {
    catalog ??= (await bridgeReady())?.callHandler("weatherLocalities").then(list=>Array.isArray(list)?list:[]).catch(()=>[]) ?? Promise.resolve([]);
    return (await catalog).filter(city=>cityMatches(city,term)).slice(0,32).map(cityFeature);
  },
  selectCity:hosted ? city=>{ void native()?.callHandler("weatherSelect",{lat:city.lat,lon:city.lon,name:cityName(city,language),names:{ku:city.name,ar:city.ar,en:city.en}}); } : undefined,
  onGps:hosted ? ()=>{ void native()?.callHandler("weatherGps"); } : undefined,
  onClose:()=>{ if(hosted) void native()?.callHandler("weatherBack"); else location.assign("./"); }
});
directory.open();
