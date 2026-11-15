import { atlasSupabase } from "./atlas-places";
import { cityKey, type WeatherCity } from "./weather-cities";

type Pin = {city:WeatherCity; pinned:boolean; dirty:boolean};
type Pins = Record<string,Pin>;
const memory = new Map<string,Pins>();
function read(owner:string):Pins {
  if (!memory.has(owner)) {
    let pins:Pins = {};
    try { pins = JSON.parse(localStorage.getItem("nav-kurd:weather-pins:"+owner) || "{}") || {}; } catch { /* Optional storage. */ }
    memory.set(owner,pins);
  }
  return memory.get(owner)!;
}
function save(owner:string) {
  try { localStorage.setItem("nav-kurd:weather-pins:"+owner,JSON.stringify(read(owner))); } catch { /* Keep in memory. */ }
}
export function weatherPins(onChange:()=>void) {
  let owner = "guest", chain = Promise.resolve();
  const synchronize = async () => {
    const client = atlasSupabase;
    if (!client) return;
    const session = (await client.auth.getSession()).data.session;
    const id = session?.user.id || "guest";
    if (owner !== id) { owner = id; onChange(); }
    if (id === "guest") return;
    const local = read(id);
    for (const [key,item] of Object.entries(read("guest"))) {
      if (item.pinned && !(key in local)) local[key] = {...item,dirty:true};
      delete read("guest")[key];
    }
    save(id); save("guest");
    for (const [key,row] of Object.entries(local)) {
      if (!row.dirty) continue;
      const query = client.from("weather_city_favorites");
      const {error} = row.pinned
        ? await query.upsert({user_id:id,city_key:key,city:row.city},{onConflict:"user_id,city_key"})
        : await query.delete().eq("user_id",id).eq("city_key",key);
      if (!error && local[key] === row) { row.dirty = false; save(id); }
    }
    const {data,error} = await client.from("weather_city_favorites").select("city_key,city").eq("user_id",id);
    if (error || !data || owner !== id) return;
    const cloud = new Map(data.map(row=>[row.city_key,row.city as WeatherCity]));
    for (const key of Object.keys(local)) if (!local[key].dirty && !cloud.has(key)) delete local[key];
    for (const [key,city] of cloud) if (!local[key]?.dirty) local[key] = {city,pinned:true,dirty:false};
    save(id); onChange();
  };
  const sync = () => { chain = chain.then(synchronize).catch(()=>undefined); };
  atlasSupabase?.auth.onAuthStateChange((_event,session) => {
    owner = session?.user.id || "guest"; queueMicrotask(onChange); setTimeout(sync,0);
  });
  window.addEventListener("online",sync);
  return { sync, all:()=>Object.values(read(owner)).filter(row=>row.pinned).map(row=>row.city),
    has:(city:WeatherCity)=>Boolean(read(owner)[cityKey(city)]?.pinned),
    toggle:(city:WeatherCity)=>{ const key=cityKey(city), pins=read(owner); pins[key]={city,pinned:!pins[key]?.pinned,dirty:true}; save(owner); onChange(); sync(); }
  };
}
