#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from "./typescript-transform.mjs";
import { navigationGeo as geo, navigationTracking as tracking, loadNavigationModule as load } from './navigation-harness.mjs';
const root = new URL('../../', import.meta.url);
const read = name => fs.readFileSync(new URL(name, root), 'utf8');
const progress = load('src/lib/route-progress.ts', {...geo,...tracking}, 'measureRouteProgress,routeCoordinateAt,RerouteConfirmation');
const meters = (east=0,north=0) => [44+east/89959,36+north/111195];
for (const [mode,speed] of [['walking',1.2],['bicycle',4],['car',12]]) {
  const snapshot = {headingDegrees:90,headingSource:'gps-course',headingConfidence:1,accuracyMeters:5,speedMetersPerSecond:speed};
  assert.equal(tracking.trustedTravelCourse(snapshot,mode),90);
  for (const extra of [{speedMetersPerSecond:0},{headingSource:'compass'},{accuracyMeters:80},{headingConfidence:.2},{headingDegrees:NaN}])
    assert.equal(tracking.trustedTravelCourse({...snapshot,...extra},mode),null);
  console.log(`PASS ${mode}: reliable course accepted; stationary, compass, inaccurate and invalid courses held`);
  const c = new progress.RerouteConfirmation(); let confirmed=false;
  for (let n=0;n<6;n++) confirmed ||= c.update({mode,offRoute:true,coordinate:meters(n*speed*1.3),accuracy:5,now:10000+n*1300,timestamp:100000+n*1300,lastRequestAt:0,decisive:true});
  assert.equal(confirmed,true);c.reset();
  for(let n=0;n<8;n++) assert.equal(c.update({mode,offRoute:true,coordinate:meters(),accuracy:5,now:10000+n*1300,timestamp:100000+n*1300,lastRequestAt:0,decisive:true}),false);
  console.log(`PASS ${mode}: moving departure confirmed; stationary drift cannot reroute`);
}
{
  const c = new tracking.MovementCourseTracker(); let result;
  for(let n=0;n<=5;n++) result=c.update(meters(n),10000+n*1000,4,1,'walking');
  assert.ok(result && Math.abs(result.heading-90)<1,'Walking fixes must accumulate a meaningful course');
  for(let n=1;n<=6;n++) result=c.update(meters(5,n),15000+n*1000,4,1,'walking');
  assert.ok(result && Math.abs(result.heading)<1,'Recent baseline follows the turn');
  assert.equal(c.update(meters(5,6),22000,4,0,'walking'),null);
  assert.equal(c.update(meters(6,6),23000,4,1,'walking'),null,'No old baseline after stopping');
  assert.equal(tracking.followCameraBearing(358,2),362);
  assert.equal(tracking.followCameraBearing(90,null),90);
  assert.equal(tracking.followCameraBearing(90,91),90);
  console.log('PASS slow walking accumulation, recent-turn course, stop reset and shortest north-wrap camera arc');
}
{
  const c=new progress.RerouteConfirmation();
  const fix=(timestamp,extra={})=>c.update({offRoute:true,coordinate:meters(timestamp/1000),accuracy:5,now:timestamp+10000,timestamp,lastRequestAt:0,...extra});
  assert.equal(fix(1000),false);assert.equal(fix(2000),false);assert.equal(fix(2000),false);assert.equal(fix(20000),false);
  assert.equal(fix(21000,{accuracy:NaN}),false);assert.equal(fix(22000),false);
  console.log('PASS timestamp duplicates, long receiver gaps and invalid accuracy reset confirmation evidence');
}
{
  const source=read('src/lib/routing-controller.ts');
  const method=source.match(/  private startNavigation\([\s\S]*?\n  \}/)[0];
  const context=vm.createContext({Date,navigator:{},UI:{en:{routeStarted:'started'}}});
  vm.runInContext(stripTypeScriptTypes(`class Route {${method}};globalThis.c=new Route();`,{mode:'transform'}),context);
  const c=context.c,events=[];
  Object.assign(c,{navigating:false,destination:meters(500),getLocationSnapshot:()=>({coordinate:meters()}),hasRenderedRoute:()=>true,
    advisory:{setActive(){}},navigationClockTask:{start(){}},setPinMode(){},mapShell:{classList:{add(){}}},syncRouteVisualState(){events.push('state');},requestLocation(){events.push('focus');},
    startRouteAnimation(){},startDestinationAnimation(){},updateLocation(){},renderPanel(){},renderNavigationHud(){},getLanguage:()=> 'en',setMessage(){}});
  c.startNavigation();assert.deepEqual(events,['state','focus']);
  console.log('PASS navigation state is delivered before initial camera focus');
}
for(const [mode,speed] of [['walking',1.2],['bicycle',4],['car',12]]) {
  const source=read('src/lib/routing-controller.ts'),method=source.match(/  updateLocation\([\s\S]*?\n  \}/)[0];
  let now=10000,epoch=100000,requests=0;
  const context=vm.createContext({...geo,...tracking,...progress,Date:{now:()=>epoch},window:{performance:{now:()=>now}},
    ROUTE_REROUTE_METERS:25,ROUTE_FAILURE_RETRY_MS:12000,ROUTE_REFRESH_MS:90000,ROUTING_PROVIDER:'mapbox'});
  vm.runInContext(stripTypeScriptTypes(`class Route {${method}};globalThis.c=new Route();`,{mode:'transform'}),context);
  const c=context.c,destination=meters(0,1000);
  Object.assign(c,{destination,navigating:true,travelMode:mode,lastDistance:1000,routeData:{features:[{}]},routeCoordinates:[meters(),destination],progressAt:0,progressMeters:0,
    rerouteConfirmation:new progress.RerouteConfirmation(),lastRouteAttemptAt:0,lastRouteAt:now,lastRouteOrigin:meters(),routeRequestInFlight:false,
    guidance:{clear(){},hideLabel(){}},updateLiveRemainingMetrics(){},finishNavigationAtDestination(){throw Error('Premature arrival');},
    scheduleRouteRefresh(){requests++;this.routeRequestInFlight=true;}});
  for(let n=0;n<7;n++){now+=1300;epoch+=1300;c.updateLocation({coordinate:meters(60+n*speed*1.3,20),accuracyMeters:5,speedMetersPerSecond:speed,
    headingConfidence:1,headingSource:'gps-course',headingDegrees:90,sampledAt:epoch});}
  assert.equal(requests,1);assert.deepEqual(c.destination,destination);assert.equal(c.travelMode,mode);
  c.routeRequestInFlight=false;c.rerouteConfirmation.reset();
  for(let n=0;n<6;n++){now+=1500;epoch+=1500;c.updateLocation({coordinate:meters(150+n*20,20),accuracyMeters:5,speedMetersPerSecond:speed,sampledAt:epoch-20000});}
  assert.equal(requests,1);
  console.log(`PASS actual ${mode} route controller: one request for confirmed wrong road, same destination, stale fixes ignored`);
}
{
  const result=JSON.parse(read('src/data/road-hazards.json'));
  const source=new Map();
  for(const path of ['public/data/kri/kri-security-features.geojson','public/data/kri/kri-pois-render.geojson'])
    for(const f of JSON.parse(read(path)).features)source.set(f.properties.id,f);
  assert.equal(result.features.length,142);assert.equal(result.metadata.counts.speed_camera,98);assert.equal(result.metadata.counts.surveillance_camera,3);
  const ids=new Set();for(const f of result.features){assert.ok(!ids.has(f.properties.id));ids.add(f.properties.id);
    assert.ok(f.properties.source_url.startsWith('https://www.openstreetmap.org/'));
    assert.deepEqual(f.geometry.coordinates,source.get(f.properties.source_ids[0]).geometry.coordinates);}
  assert.equal(result.features.filter(f=>f.properties.road_hazard==='speed_bump').length,0,'Unmapped speed bumps must not be invented');
  console.log('PASS 142 unique attributed points preserve source coordinates; speed and surveillance cameras separated; no invented bumps');
}
