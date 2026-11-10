import assert from "node:assert/strict";
import {test} from "node:test";
import handler from "../../api/weather.js";
test("widget requests five hours; detail requests 24 hours and seven days at identical coordinates",async t=>{
  const requests=[];
  const hour=Math.floor(Date.now()/3600000)*3600;
  t.mock.method(globalThis,"fetch",async input=>{
    const u=new URL(input);requests.push(u);
    if(u.pathname.endsWith("air-quality"))return Response.json({current:{pm2_5:14,european_aqi:38}});
    const n=Number(u.searchParams.get("forecast_hours"));
    return Response.json({current:{time:hour,temperature_2m:23,weather_code:2,is_day:1},timezone:"Asia/Baghdad",utc_offset_seconds:10800,
      hourly:{time:Array.from({length:n},(_,i)=>hour+i*3600),temperature_2m:Array(n).fill(22),weather_code:Array(n).fill(2),is_day:Array(n).fill(1)},
      daily:{time:Array.from({length:7},(_,i)=>hour+i*86400),temperature_2m_min:Array(7).fill(12),temperature_2m_max:Array(7).fill(24),weather_code:Array(7).fill(1)}});
  });
  async function request(scope){let body;const res={setHeader(){},status(){return this;},send(v){body=JSON.parse(v);}};await handler({method:"GET",query:{scope,latitude:36.3,longitude:44.8},headers:{}},res);return body;}
  const widget=await request("widget"), detail=await request("detail");
  assert.equal(widget.hourly.time.length,5);assert.equal(widget.daily,undefined);
  assert.equal(requests[0].searchParams.has("daily"),false);
  assert.equal(detail.hourly.time.length,24);assert.equal(detail.daily.length,7);
  assert.equal(detail.current.pm2_5,14);assert.equal(detail.current.european_aqi,38);
  await request("widget");assert.equal(requests.length,4);
});
