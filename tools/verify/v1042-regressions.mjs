#!/usr/bin/env node
import { navigationTracking } from "./navigation-harness.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const root=new URL('../../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
const compile=source=>stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport /g,'');
function load(path,globals,exports){
 const source=read(path).replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 const context=vm.createContext({...navigationTracking,...globals});
 vm.runInContext(compile(source)+`\nglobalThis.api={${exports}}`,context);return context.api;
}
const descriptions=JSON.parse(read('contracts/weather-descriptions.json'));
const weather=load('src/lib/weather-codes.ts',{descriptions},'weatherCodeKind,weatherCodeLabel,weatherContext');
for(const lang of ['ku','ar','en']) {
 assert.equal(weather.weatherContext(22,3,8,lang).length,0);
 for(const [temperature,expected] of [[-12,'extremeCold'],[2,'cold'],[12,'cool'],[34,'hot'],[42,'extremeHeat']])
  assert.equal(weather.weatherContext(temperature,2,6,lang)[0],descriptions.context[expected][lang]);
 assert.equal(weather.weatherContext(null,42,80,lang).length,1);
 assert.equal(weather.weatherContext(null,null,65,lang)[0],descriptions.context.gusts[lang]);
 assert.equal(weather.weatherCodeLabel(61,true,lang),descriptions.codes['61'][lang]);
}
assert.equal(weather.weatherContext(NaN,NaN,NaN,'en').length,0);
console.log('PASS shared descriptive heat/cold/wind context, all languages, missing values and WMO precedence');
{
 let source=read('src/lib/place-weather.ts').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replaceAll('import.meta.env','ENV');
 const now=Date.now(),hour=Math.floor(now/3600000)*3600000;
 const context=vm.createContext({...weather,ENV:{BASE_URL:'/'},absoluteAppUrl:x=>`https://example.test/${x}`,safeUrl:x=>x?new URL(x):null,URL,Date,Intl,window:{addEventListener(){}}});
 vm.runInContext(compile(source)+'\nglobalThis.decode=decodeReading;',context);
 const payload={timezone:'Asia/Baghdad',current:{time:now/1000,temperature_2m:22,weather_code:61,is_day:1,dust:250},hourly:{time:Array.from({length:48},(_,i)=>(hour+i*3600000)/1000),temperature_2m:Array(48).fill(22),weather_code:Array(48).fill(61),is_day:Array(48).fill(1),precipitation_probability:Array(48).fill(50)}};
 const result=context.decode(payload);assert.equal(result.hours.length,24);assert.equal(result.weatherCode,61);assert.equal(result.windSpeed,null);
 assert.ok(result.hours.every(h=>h.at>now&&h.at<=now+24*3600000));
 assert.throws(()=>context.decode({...payload,timezone:'Invalid/Zone'}));
 assert.throws(()=>context.decode({...payload,current:{...payload.current,weather_code:100}}));
 assert.throws(()=>context.decode({...payload,current:{...payload.current,temperature_2m:null}}));
 console.log('PASS full next-24-hour forecast, provider timezone, rain remains rain with dust, and invalid/missing data rejection');
}
const geo=load('src/lib/location.ts',{},'distanceMeters,bearingBetween,shortestHeadingDelta');
{
 const {RerouteConfirmation}=load('src/lib/route-progress.ts',geo,'RerouteConfirmation');
 const c=new RerouteConfirmation();
 const fix=(n,extra={})=>c.update({offRoute:true,coordinate:[44+n*.0002,36],accuracy:6,now:10000+n*1300,timestamp:100+n,lastRequestAt:0,decisive:true,...extra});
 assert.equal(fix(0),false);assert.equal(fix(1),true);
 c.reset();assert.equal(fix(0),false);assert.equal(fix(1,{timestamp:100}),false);
 c.reset();assert.equal(fix(0,{accuracy:55}),false);assert.equal(fix(1),false);
 c.reset();assert.equal(fix(0),false);assert.equal(fix(1,{coordinate:[44,36]}),false);
 c.reset();assert.equal(fix(0),false);assert.equal(fix(1,{lastRequestAt:10000}),false);
 console.log('PASS decisive departure reroutes after 2 accurate moving fixes; duplicates, drift, mixed accuracy and cooldown do not');
}
{
 const method=read('src/lib/live-location-controller.ts').match(/  recenter\(initialCenter = false\): void \{[\s\S]*?\n  \}/)[0];
 let camera;const context=vm.createContext({...navigationTracking,window:{performance:{now:()=>10000}},PRECISE_FIX_METERS:80});
 vm.runInContext(compile(`class Camera {${method}};globalThis.c=new Camera();`),context);
 const c=context.c;Object.assign(c,{lastCoordinate:[44,36],lastAccuracy:6,lastRecenterAt:0,lastHeading:90,lastSpeed:8,lastHeadingSource:'gps-course',lastHeadingConfidence:1,navigationActive:true,finishCameraMove(){},map:{stop(){},off(){},once(){},getZoom:()=>16,getBearing:()=>0,getContainer:()=>({clientHeight:800}),easeTo:o=>{camera=o;},isMoving:()=>false}});
 c.recenter(true);assert.equal(camera.bearing,90);assert.equal(camera.offset[1],96);
 for(const extra of [{lastSpeed:0},{lastHeadingSource:'compass'},{lastAccuracy:100},{lastHeadingConfidence:.2},{navigationActive:false}]) {
  const old=Object.fromEntries(Object.keys(extra).map(k=>[k,c[k]]));Object.assign(c,extra);c.recenter(true);assert.equal(camera.bearing,0);Object.assign(c,old);
 }
 console.log('PASS navigation camera follows reliable moving course and holds bearing for stationary/compass/uncertain fixes');
}
{
 const source=read('vendor/maplibre-gl/src/data/feature_index.ts');
 const method=source.slice(source.indexOf('    loadMatchingFeature('),source.indexOf('\n    lookupSymbolFeatures('));
 const context=vm.createContext({EvaluationParameters:class{},Number});
 vm.runInContext(compile(`class Index {${method}\n};globalThis.c=new Index();`),context);
 const c=context.c;let decoded=0;
 Object.assign(c,{bucketLayerIDs:[['poi']],sourceLayerCoder:{decode:()=> 'places'},vtLayers:{places:{length:2,feature(i){decoded++;if(i<0||i>=2)throw Error('feature index out of bounds');return {};}}},tileID:{overscaledZ:12},getId:()=>1});
 const query=(index,bucket=0)=>c.loadMatchingFeature({},bucket,0,index,{needGeometry:false,filter:()=>false},undefined,[],{},{});
 for(const index of [-1,2,500,1.5,NaN])query(index);
 query(0,99);assert.equal(decoded,0);query(1);assert.equal(decoded,1);
 c.vtLayers.places.feature=()=>{throw Error('unrelated corrupt tile');};assert.throws(()=>query(1),/unrelated corrupt tile/);
 delete c.vtLayers.places;assert.doesNotThrow(()=>query(0));
 const lock=JSON.parse(read('package-lock.json'));
 assert.equal(lock.packages['node_modules/maplibre-gl'].resolved,'vendor/maplibre-gl');
 assert.equal(lock.packages['vendor/maplibre-gl'].version,'6.6.0-navkurd.2');
 console.log('PASS actual pinned map engine skips stale out-of-range indices without suppressing other decoding errors');
}
{
 const source=read('src/main.ts'),method=source.match(/  focusSearch\(choice: SearchChoice\): void \{[\s\S]*?\n  \}/)[0];
 const context=vm.createContext({Date,languageValue:()=> 'City'});
 vm.runInContext(compile(`class Search {${method}};globalThis.c=new Search();`),context);
 const c=context.c;let previews=0;let snapshot={watching:true,coordinate:[44,36],accuracyMeters:6,sampledAt:Date.now()};
 Object.assign(c,{language:'en',liveLocation:{diagnosticSnapshot:()=>snapshot},routing:{previewDestination(coord,name){assert.equal(name,'City');assert.equal(coord[0],44.1);previews++;}},collapseSheetForMapFocus(){},focusLocality(){}});
 const choice={type:'local',feature:{properties:{},geometry:{coordinates:[44.1,36.1]}}};
 c.focusSearch(choice);assert.equal(previews,1);
 for(const extra of [{watching:false},{accuracyMeters:1000},{sampledAt:Date.now()-90000},{coordinate:null}]){const old=snapshot;snapshot={...snapshot,...extra};c.focusSearch(choice);snapshot=old;}
 assert.equal(previews,1);
 console.log('PASS search creates destination previews only for fresh active GPS; no navigation-start call');
}
