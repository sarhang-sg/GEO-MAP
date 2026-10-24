import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './typescript-transform.mjs';
const root=new URL('../../',import.meta.url);
function load(path,globals,names){
 const source=fs.readFileSync(new URL(path,root),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 const context=vm.createContext(globals);
 vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport /g,'')+`\nglobalThis.api={${names}}`,context);return context.api;
}
const geo=load('src/lib/location.ts',{},'distanceMeters,bearingBetween,shortestHeadingDelta');
const progress=load('src/lib/route-progress.ts',geo,'measureRouteProgress,routeSlice');
const data=JSON.parse(fs.readFileSync(new URL('src/data/road-hazards.json',root),'utf8'));
const hazards=load('src/lib/road-hazards.ts',{data},'roadHazardDetails,roadHazardKind');
const alerts=load('src/lib/route-alerts.ts',{...geo,...progress,...hazards},'projectRouteAlerts,routeAlertFeatures');
// A bent, 8 km route: highlights must follow its road vertices, not a chord.
const route=[[44,36],[44.02,36],[44.02,36.02],[44.04,36.02],[44.04,36.04]];
const points=[{id:'checkpoint',kind:'military_checkpoint',coordinate:[44.02,36.01]},
 {id:'duplicate',kind:'checkpoint',coordinate:[44.02,36.01]},
 {id:'other-road',kind:'speed_bump',coordinate:[44.022,36.01]},
 {id:'bump',kind:'speed_bump',coordinate:[44.03,36.02]},
 {id:'not-hazard',kind:'hospital',coordinate:[44.02,36.01]},
 {id:'invalid',kind:'checkpoint',coordinate:[NaN,36]}];
let projected=alerts.projectRouteAlerts(route,points,[]);
assert.equal(projected.length,2);
const checkpoint=projected.find(x=>x.kind==='checkpoint');
assert.ok(Math.abs(checkpoint.end-checkpoint.start-3000)<.01);
assert.equal(projected.some(x=>x.id==='other-road'),false);
const preview=alerts.routeAlertFeatures(route,projected);
const line=preview.features.find(f=>f.geometry.type==='LineString'&&f.properties.kind==='checkpoint');
assert.ok(line.geometry.coordinates.some(p=>p[0]===44.02&&p[1]===36));
assert.ok(line.geometry.coordinates.some(p=>p[0]===44.02&&p[1]===36.02));
const passed=alerts.routeAlertFeatures(route,projected,checkpoint.end+2000);
assert.equal(passed.features.length,0);
const clipped=alerts.routeAlertFeatures(route,projected,checkpoint.at+10);
assert.equal(clipped.features.some(f=>f.geometry.type==='Point'&&f.properties.kind==='checkpoint'),false);
assert.equal(alerts.projectRouteAlerts([],points,[]).length,0);
assert.equal(alerts.projectRouteAlerts([[44,36],[44,36]],points,[]).length,0);
const steps=[{atMeters:1800,type:'turn',modifier:'sharp right',coordinate:[44.02,36],exit:null,name:''},
 {atMeters:4000,type:'turn',modifier:'uturn',coordinate:[44.02,36.02],exit:null,name:''},
 {atMeters:0,type:'turn',modifier:'right',coordinate:[44,36],exit:null,name:''}];
projected=alerts.projectRouteAlerts(route,[],steps);
assert.deepEqual(Array.from(projected,x=>x.kind).sort(),['sharp_curve','uturn']);
for(const language of ['ku','ar','en'])assert.ok(hazards.roadHazardDetails('speed_bump',language).label.length>2);
console.log('PASS route-distance warning windows, curved road geometry, parallel-road rejection, deduplication, passed alerts, invalid routes and provider-only sharp bend/U-turn signs');
const weather=JSON.parse(fs.readFileSync(new URL('contracts/weather-descriptions.json',root),'utf8'));
assert.equal(weather.codes['2'].ku,'نیمچە هەوراوی');assert.equal(weather.codes['3'].ku,'هەوراوی');
console.log('PASS Kurdish cloudy and partly-cloudy grammar');
