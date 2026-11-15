import { allowRequest, providerUrl } from "./weather.js";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const GEOCODER = "https://geocoding-api.open-meteo.com/v1/search";
const VALID = new Set([0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99]);
const pending = new Map();
const cache = new Map();
const ttl = 15 * 60_000;

async function load(key, url, decode) {
  const old = cache.get(key);
  if (old && Date.now() - old.at < ttl) return old.value;
  if (!pending.has(key)) {
    const task = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(url, {signal: AbortSignal.timeout(6000), headers: {Accept:"application/json"}});
          if (!res.ok) throw Object.assign(new Error("provider"), {status:res.status});
          const value = decode(await res.json());
          cache.delete(key);
          cache.set(key, {at:Date.now(), value});
          if (cache.size > 320) cache.delete(cache.keys().next().value);
          return value;
        } catch (err) {
          if (attempt || (err.status >= 400 && err.status < 500)) {
            if (old && Date.now() - old.at < 10 * 3600_000) return old.value;
            throw err;
          }
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    })().finally(() => pending.delete(key));
    pending.set(key, task);
  }
  return pending.get(key);
}

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options","nosniff");
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return res.status(405).end(); }
  if (!allowRequest(req)) { res.setHeader("Retry-After","60"); return res.status(429).end(); }
  const {q, lang, points} = req.query || {};
  try {
    let output;
    if (typeof q === "string" && !points) {
      if (q.trim().length < 2 || q.length > 100 || !["ku","ar","en"].includes(lang)) return res.status(400).end();
      const url = new URL(GEOCODER);
      url.search = new URLSearchParams({name:q.trim(),count:"12",language:lang === "ku" ? "ckb" : lang,format:"json"}).toString();
      output = await load(url.href, url, body => (body.results || []).filter(p =>
        typeof p.name === "string" && p.name.trim() && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
      ).map(p => ({name:p.name.trim(),lat:p.latitude,lon:p.longitude,region:[p.admin1,p.country].filter(Boolean).join(" · ")})));
    } else {
      if (typeof points !== "string" || points.length > 1500) return res.status(400).end();
      const coords = points.split("|").map(pair => pair.split(","));
      if (!coords.length || coords.length > 32 || coords.some(pair => pair.length !== 2 ||
        pair.some((n,i) => !/^-?\d{1,3}(?:\.\d{1,7})?$/.test(n) || Math.abs(Number(n)) > [90,180][i]))) return res.status(400).end();
      const url = providerUrl(FORECAST);
      for (const [key,val] of Object.entries({latitude:coords.map(p=>p[0]).join(","),longitude:coords.map(p=>p[1]).join(","),
        current:"temperature_2m,weather_code,is_day",daily:"temperature_2m_max,temperature_2m_min",forecast_days:"1",timezone:"auto",timeformat:"unixtime"})) url.searchParams.set(key,val);
      output = await load(points, url, payload => {
        const rows = Array.isArray(payload) ? payload : [payload];
        if (rows.length !== coords.length) throw new Error("incomplete-batch");
        return rows.map((r,i) => {
          const c = r.current, high=r.daily?.temperature_2m_max?.[0], low=r.daily?.temperature_2m_min?.[0];
          if (!c || !Number.isFinite(c.temperature_2m) || !Number.isFinite(c.time) || !VALID.has(c.weather_code) ||
              ![0,1].includes(c.is_day) || !Number.isFinite(r.utc_offset_seconds)) return null;
          return {key:coords[i].map(n => Number(n).toFixed(4)).join(","),temperature:c.temperature_2m,code:c.weather_code,
            day:c.is_day===1,at:c.time,offset:r.utc_offset_seconds,high:Number.isFinite(high)?high:null,low:Number.isFinite(low)?low:null};
        }).filter(Boolean);
      });
    }
    res.setHeader("Cache-Control","public, max-age=120, s-maxage=300");
    return res.status(200).json(output);
  } catch {
    res.setHeader("Cache-Control","no-store");
    return res.status(503).json({error:"provider-unavailable"});
  }
}
