#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const root=new URL('../../',import.meta.url);
{
 const handlers=new Map(),channels=[];let resident=null,releaseRemoval,removing=false;
 const navigator={onLine:true};
 const client={channel(){
  if(resident)return resident;
  const c={joined:false,on(){assert.equal(this.joined,false,'Listeners cannot be added to a joined channel');return this;},subscribe(){this.joined=true;return this;},track:async()=>{},untrack:async()=>{},presenceState:()=>({}),teardown(){if(resident===this)resident=null;}};
  channels.push(c);resident=c;return c;
 },removeChannel:async c=>{if(removing)await new Promise(resolve=>{releaseRemoval=resolve;});c.teardown();}};
 const {installRealtimePresenceController}=load('src/lib/realtime-presence-controller.ts',{atlasSupabase:client,getAtlasAuthIdentity:async()=>null,subscribeToAtlasAuth:()=>()=>{},navigator,document:{hidden:false,addEventListener(){},removeEventListener(){}},window:{localStorage:{getItem:()=> 'device'},addEventListener:(event,fn)=>handlers.set(event,fn),removeEventListener:event=>handlers.delete(event),setInterval:()=>1,clearInterval(){},setTimeout:()=>2,clearTimeout(){}},crypto,TextEncoder,Date},'installRealtimePresenceController');
 const controller=installRealtimePresenceController({onChange(){}});
 await controller.refreshIdentity();assert.equal(channels.length,1);
 removing=true;navigator.onLine=false;handlers.get('offline')();
 navigator.onLine=true;handlers.get('online')();handlers.get('online')();
 for(let i=0;i<20;i++)await Promise.resolve();
 assert.equal(channels.length,1,'Reconnect must wait for the prior asynchronous channel removal');
 removing=false;releaseRemoval();
 for(let i=0;i<30;i++)await Promise.resolve();
 assert.equal(channels.length,2,'Only one replacement subscription is created after reconnect');
 controller.destroy();
 console.log('PASS rapid offline/online events serialize presence teardown and prevent duplicate subscriptions');
}
{
 const source=fs.readFileSync(new URL('src/bootstrap.ts',root),'utf8').split('const handoffTarget =')[0].replace(/^import[^\n]+\n/gm,'');
 for(const stalled of ['registration','update','activation','none']){
  let now=0,sequence=0,done=false;const timers=new Map(),listeners=new Map();
  const registration={update:()=>stalled==='update'?new Promise(()=>{}):Promise.resolve(),waiting:{scriptURL:'https://example.test/sw.js',postMessage(){}},installing:null};
  if(stalled==='none')registration.waiting=null;
  const worker={controller:{},getRegistration:()=>stalled==='registration'?new Promise(()=>{}):Promise.resolve(registration),addEventListener:(name,callback)=>listeners.set(name,callback),removeEventListener:name=>listeners.delete(name)};
  const context=vm.createContext({URL,navigator:{serviceWorker:worker},window:{location:{origin:'https://example.test'},setTimeout:(callback,ms)=>{const id=++sequence;timers.set(id,{callback,at:now+ms});return id;},clearTimeout:id=>timers.delete(id)}});
  vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'})+'\nglobalThis.retry=updateWorkerBeforeRetry;',context);
  const completion=context.retry().then(()=>{done=true;});
  for(let step=0;step<6&&!done;step++){
   for(let flush=0;flush<20;flush++)await Promise.resolve();
   if(done)break;
   assert.ok(timers.size,'A stalled worker request needs an owned deadline');
   const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;timer.callback();
  }
  await completion;assert.ok(now<=8500);assert.equal(timers.size,0);assert.equal(listeners.size,0);
 }
 console.log('PASS startup retry bounds stalled worker discovery/update/activation and cleans timers/listeners');
}
function load(path,globals,exports){
 const code=fs.readFileSync(new URL(path,root),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
 const context=vm.createContext(globals);
 vm.runInContext(stripTypeScriptTypes(code,{mode:'transform'}).replace(/\bexport /g,'')+`\nglobalThis.api={${exports}}`,context);
 return context.api;
}
{
 const {mapViewportSize}=load('src/lib/map-viewport.ts',{},'mapViewportSize');
 for(const ratio of [1,1.25,1.5,2]){
  const size=mapViewportSize({getCanvas:()=>({width:390*ratio,height:844*ratio,style:{width:'390px',height:'844px'}}),getPixelRatio:()=>ratio});
  assert.equal(size.width,390);assert.equal(size.height,844);
 }
 const gpuClamp=mapViewportSize({getCanvas:()=>({width:512,height:1024,style:{width:'800px',height:'1600px'}}),getPixelRatio:()=>2});
 assert.equal(gpuClamp.width,800);assert.equal(gpuClamp.height,1600);
 console.log('PASS CSS viewport stays correct at capped DPR and GPU-clamped canvas sizes');
}
{
 const api=load('src/lib/route-maneuvers.ts',{},'routeManeuvers,nextManeuver,maneuverLabel');
 const steps=api.routeManeuvers([{steps:[{distance:100,maneuver:{type:'depart'}},{distance:200,name:'A',maneuver:{type:'turn',modifier:'left'}},{distance:50,maneuver:{type:'turn',modifier:'uturn'}},{distance:20,maneuver:{type:'roundabout',exit:3}},{distance:0,maneuver:{type:'arrive'}}]}]);
 assert.equal(steps.length,4);assert.deepEqual(Array.from(steps,s=>s.atMeters),[100,300,350,370]);
 assert.equal(api.nextManeuver(steps,120).modifier,'uturn');
 for(const lang of ['ku','ar','en'])for(const step of steps){assert.ok(api.maneuverLabel(step,lang).length>3);}
 assert.equal(api.maneuverLabel(steps[1],'en'),'Make a U-turn');
 assert.match(api.maneuverLabel(steps[2],'en'),/exit 3/);
 assert.equal(api.nextManeuver([],0),null);
 console.log('PASS provider maneuver distance, U-turn/roundabout/arrival and three-language instructions');
}
for(const native of [false,true]){
 let bounds=[0,0,2,1],center={lng:0.5,lat:0.5},zoom=12,loads=0,commits=0;
 const feature=id=>({type:'Feature',id,properties:{id,icon_id:'poi-test'},geometry:{type:'Point',coordinates:[id==='a'?0.5:1.5,0.5]}});
 const leaves=['a','b'].map((key,i)=>({key,z:1,x:i,y:0,bbox:[i,0,i+1,1],file:`data/kri/viewport-poi-shards/${key}.json`,records:1,bytes:100,sha256:'0'.repeat(64)}));
 const manifest={schema:'NAV KURD viewport POI shards v1',release:'test',datasets:{base:{runtime_minzoom:8,leaves}}};
 const get=async url=>{if(url==='manifest'||url==='poiManifest')return manifest;loads++;const id=url==='a'||String(url).endsWith('/a.json')?'a':'b';return{type:'FeatureCollection',version:'test',features:[feature(id)]};};
 const handlers=new Map();
 const source={setData:async()=>{commits++;},updateData:async()=>{commits++;}};
 const map={getSource:()=>source,getZoom:()=>zoom,getCenter:()=>center,getBounds:()=>({getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3]}),on:(event,fn)=>handlers.set(event,fn),off:event=>handlers.delete(event)};
 const api=load('src/lib/viewport-poi-source.ts',{localCoreEnabled:native,coreCall:(op,args)=>get(op==='poiManifest'?op:args.key),fetchPersistentJson:get,MAP_DATA_VERSION:'test',dataAssetUrl:p=>p,debounceAsync:fn=>fn,AbortController,performance,window:{addEventListener(){},removeEventListener(){}},isAbortError:()=>false,recordRuntimeDiagnostic(){}},'installViewportPoiSourceController');
 const c=api.installViewportPoiSourceController({map,sourceId:'poi',datasetId:'base',manifestUrl:'manifest',lowPowerProfile:true,getVisible:()=>true});
 await c.start();assert.equal(loads,2);assert.equal(commits,1);
 // Reverse nearest-leaf order, then zoom down to a strict subset and back.
 center={lng:1.6,lat:0.5};await c.refresh();
 bounds=[0.4,0.4,0.6,0.6];zoom=16;await c.refresh();
 zoom=6;await c.refresh();zoom=12;bounds=[0,0,2,1];await c.refresh();
 assert.equal(loads,2);assert.equal(commits,1,'Ordinary zooms must retain the cluster index');
 c.setVisible(false);await c.refresh();c.setVisible(true);await c.refresh();
 assert.equal(loads,2);assert.equal(commits,1);
 await handlers.get('style.load')();await c.refresh();await Promise.resolve();
 assert.equal(loads,2,'New style must reuse loaded data');
 c.destroy();assert.equal(handlers.size,0);
 console.log(`PASS ${native?'native bridge':'web'} POI shard order/subset/zoom/hide retain data with no repeated loads or source writes`);
}

{
 const api=load('src/lib/pwa-launch-intent.ts',{URL,documentBaseUrl:()=>"https://example.test/",safeUrl:(url,base)=>new URL(url,base)},'parsePwaLaunchParams');
 for(const query of ['action=place','action=place&lat=36','action=place&lat=&lng=44','action=place&lat=999&lng=44'])assert.equal(api.parsePwaLaunchParams('https://example.test/?'+query).coordinate,null);
 const position=api.parsePwaLaunchParams('https://example.test/?action=place&lat=36.19&lng=44.01').coordinate;
 assert.deepEqual(Array.from(position),[44.01,36.19]);
 console.log('PASS incomplete shared coordinates never become a false zero-degree location');
}

{
 let bounds=[0,0,2,1], writes=0,releaseWrite;
 const wait=new Promise(resolve=>{releaseWrite=resolve;});
 const leaves=['a','b'].map((key,i)=>({key,bbox:[i,0,i+1,1],file:`data/kri/viewport-poi-shards/${key}.json`,records:1,bytes:1}));
 const source={setData:async()=>{writes++;await wait;},updateData:async()=>{writes++;}};
 const map={getSource:()=>source,getZoom:()=>15,getCenter:()=>({lng:.5,lat:.5}),getBounds:()=>({getWest:()=>bounds[0],getSouth:()=>bounds[1],getEast:()=>bounds[2],getNorth:()=>bounds[3]}),on(){},off(){}};
 const fetchPersistentJson=async url=>url==='manifest'?{schema:'NAV KURD viewport POI shards v1',release:'test',datasets:{base:{runtime_minzoom:8,leaves}}}:{type:'FeatureCollection',features:[{id:url,properties:{id:url},geometry:{type:'Point',coordinates:[.5,.5]}}]};
 const api=load('src/lib/viewport-poi-source.ts',{localCoreEnabled:false,fetchPersistentJson,MAP_DATA_VERSION:'test',dataAssetUrl:p=>p,debounceAsync:fn=>fn,AbortController,performance,window:{addEventListener(){},removeEventListener(){}},isAbortError:()=>false,recordRuntimeDiagnostic(){}},'installViewportPoiSourceController');
 const controller=api.installViewportPoiSourceController({map,sourceId:'poi',datasetId:'base',manifestUrl:'manifest',lowPowerProfile:true,getVisible:()=>true});
 const starting=controller.start();
 for(let i=0;i<30&&writes===0;i++)await Promise.resolve();
 assert.equal(writes,1,'Initial worker transaction started');
 controller.setPaused(true);bounds=[.4,.4,.6,.6];controller.setPaused(false);
 releaseWrite();await starting;await controller.refresh();
 assert.equal(writes,1,'A gesture during an in-flight transaction must not discard resident sibling leaves');
 controller.destroy();
 console.log('PASS zoom during an asynchronous POI worker write retains the existing cluster index');
}

{
 let now=1_000_000,requests=0,writes=0,changed=0,fail=false;
 let places=[{id:'a',name_en:'Town',category:'town',longitude:44,latitude:36}];
 let source={setData(){writes++;}};
 const ui={connected:'connected',ownerBackendOffline:'offline',localBase:'local'};
 const {OwnerPlacesController}=load('src/lib/owner-places-controller.ts',{
  isAtlasBackendConfigured:true,loadPublishedAtlasPlaces:async()=>{requests++;if(fail)throw Error('offline');return places;},
  isMeaningfulMapName:name=>!!name,atlasMarkerProfile:category=>({id:category,imageId:'town',tier:'landmark',color:'#fff',priority:1}),
  atlasErrorMessage:()=>'',UI:{en:ui},Intl,Date:{now:()=>now},navigator:{onLine:true},
  window:{setTimeout,clearTimeout,queueMicrotask}
 },'OwnerPlacesController');
 const controller=new OwnerPlacesController({map:{getSource:()=>source},countElement:{textContent:''},backendStateElement:{dataset:{}},getLanguage:()=> 'en',onPlacesChanged:()=>changed++});
 await controller.refresh();assert.equal(requests,1);assert.equal(writes,1);assert.equal(changed,1);
 for(let i=0;i<10;i++)await controller.refresh({onlyIfStale:true});
 assert.equal(requests,1,'Short reconnect bursts retain fresh owner data');assert.equal(writes,1);
 now+=61_000;await controller.refresh({onlyIfStale:true});
 assert.equal(requests,2,'Expired live data is checked');assert.equal(writes,1,'Unchanged data retains the cluster index');assert.equal(changed,1);
 places=[{...places[0],description_en:'Updated details'}];await controller.refresh();
 assert.equal(changed,2,'Updated details remain available');assert.equal(writes,1,'Detail-only changes need no map worker write');
 places=[{...places[0],longitude:44.2}];await controller.refresh();assert.equal(writes,2);
 fail=true;await controller.refresh();assert.equal(writes,2,'Network failures keep visible data untouched');
 source={setData(){writes++;}};await controller.refresh({onlyIfStale:true});assert.equal(writes,3,'A replaced style source receives retained data');
 console.log('PASS owner data freshness, unchanged geometry, live edits, failure retention and source replacement');
}
{
 let layers=['base','route','icon','puck','accuracy','destination'];let writes=0;
 const {normalizeDynamicMapLayerPriority}=load('src/lib/map-layer-priority.ts',{
  LOCATION_ACCURACY_LAYER_IDS:['accuracy'],ALL_POI_ICON_LAYER_IDS:['icon'],ATLAS_MARKER_LAYER_IDS:[],
  ROUTE_GUIDANCE_LAYER_IDS:[],ROUTE_RENDER_LAYER_IDS:['route'],ROUTE_DESTINATION_LAYER_IDS:['destination'],LOCATION_PUCK_LAYER_IDS:['puck']
 },'normalizeDynamicMapLayerPriority');
 const map={isStyleLoaded:()=>false,getStyle:()=>({layers:layers.map(id=>({id}))}),moveLayer(id,before){writes++;layers.splice(layers.indexOf(id),1);layers.splice(before?layers.indexOf(before):layers.length,0,id);}};
 normalizeDynamicMapLayerPriority(map);assert.deepEqual(layers,['base','accuracy','icon','route','destination','puck']);
 const prior=writes;normalizeDynamicMapLayerPriority(map);assert.equal(writes,prior,'Stable route layering must be a no-op');
 layers.push('new-basemap');normalizeDynamicMapLayerPriority(map);
 assert.ok(layers.indexOf('route')>layers.indexOf('icon'));assert.equal(layers.at(-1),'puck');
 console.log('PASS route above POIs, puck above route, and stable stacking without repeated mutations');
}
{
 let stored=JSON.stringify({accent:'teal',font:'system',quality:'sharp',motion:'invalid'});
 const document={documentElement:{dataset:{}},body:{dataset:{}}};
 const api=load('src/lib/appearance-state.ts',{localStorage:{getItem:()=>stored,setItem:(_,value)=>{stored=value;}},document},'readAppearance,applyAppearance,saveAppearance');
 const settings=api.readAppearance();assert.equal(settings.accent,'teal');assert.equal(settings.motion,'auto');
 api.applyAppearance(settings);assert.equal(document.documentElement.dataset.accent,'teal');assert.equal(document.body.dataset.fontPreference,'system');
 stored='{invalid';assert.equal(api.readAppearance().accent,'original');
 console.log('PASS saved appearance applies before boot and corrupted preferences preserve the original design');
}

{
 const source=fs.readFileSync(new URL('src/lib/routing-controller.ts',root),'utf8');
 const method=source.match(/  private refreshAfterConnectionRecovery\(\): void \{[\s\S]*?\n  \}/)[0];
 let now=100_000,requests=0;
 const document={hidden:false},navigator={onLine:true};
 const context=vm.createContext({document,navigator,window:{performance:{now:()=>now}},ROUTE_REFRESH_MS:90_000});
 vm.runInContext(stripTypeScriptTypes(`class Recovery {${method}}\nglobalThis.recovery=new Recovery();`,{mode:'transform'}),context);
 const c=context.recovery;Object.assign(c,{destination:[44,36],routeRequestInFlight:false,lastRouteAt:now,lastRouteAttemptAt:now,hasRenderedRoute:()=>true,scheduleRouteRefresh:()=>requests++});
 for(let i=0;i<8;i++)c.refreshAfterConnectionRecovery();assert.equal(requests,0);
 now+=95_000;c.refreshAfterConnectionRecovery();assert.equal(requests,1);
 navigator.onLine=false;c.refreshAfterConnectionRecovery();assert.equal(requests,1);
 navigator.onLine=true;c.routeRequestInFlight=true;c.refreshAfterConnectionRecovery();assert.equal(requests,1);
 c.routeRequestInFlight=false;c.hasRenderedRoute=()=>false;c.lastRouteAttemptAt=now-5_000;c.refreshAfterConnectionRecovery();assert.equal(requests,2);
 console.log('PASS route recovery retains fresh paths, coalesces active requests and retries missing/stale paths');
}

{
 const geo=load('src/lib/location.ts',{},'distanceMeters,bearingBetween,shortestHeadingDelta');
 const api=load('src/lib/route-progress.ts',geo,'measureRouteProgress,routeCoordinateAt,routeSlice,RerouteConfirmation');
 const loop=[[44,36],[44.001,36],[44.001,36.001],[44,36.001],[44,36],[43.999,36]];
 const first=api.measureRouteProgress([44,36],loop);
 assert.equal(first.progressedMeters,0,'A crossing must not skip to a later lap on the first fix');
 const halfway=api.measureRouteProgress([44.0005,36],loop,{previousMeters:0,maxAdvanceMeters:70,accuracy:5});
 assert.ok(halfway.progressedMeters>40&&halfway.progressedMeters<50);
 const startAgain=api.measureRouteProgress([44,36],loop,{previousMeters:first.totalMeters-95,maxAdvanceMeters:40,accuracy:5});
 assert.ok(startAgain.progressedMeters>380,'Continuity chooses the later lap after actually traversing the loop');
 const cut=api.routeSlice(loop,halfway.progressedMeters);
 assert.ok(geo.distanceMeters(cut[0],halfway.coordinate)<.1);assert.deepEqual(Array.from(cut.at(-1)),loop.at(-1));
 assert.equal(api.measureRouteProgress([44,36],[[44,36],[44,36]]),null);
 const confirmation=new api.RerouteConfirmation();
 const fix=(n,extra={})=>confirmation.update({offRoute:true,coordinate:[44+n*.0001,36],accuracy:6,now:10_000+n*1000,timestamp:100+n,lastRequestAt:0,...extra});
 assert.equal(fix(0),false);assert.equal(fix(1),false);assert.equal(fix(1),false,'Repeated callback is not an independent fix');assert.equal(fix(2),true);
 confirmation.reset();assert.equal(fix(0),false);assert.equal(fix(1,{offRoute:false}),false);assert.equal(fix(2),false,'Returning to route clears the drift window');
 confirmation.reset();for(let n=0;n<8;n++)assert.equal(fix(n,{accuracy:100}),false);
 confirmation.reset();for(let n=0;n<8;n++)assert.equal(fix(n,{coordinate:[44,36]}),false,'Stationary drift must not reroute');
 confirmation.reset();assert.equal(fix(0),false);assert.equal(fix(1),false);assert.equal(fix(2,{lastRequestAt:11_000}),false,'Reroutes have a cooldown');
 const source=fs.readFileSync(new URL('src/lib/routing-controller.ts',root),'utf8');
 const methods=['updateLocation','updateLiveRemainingMetrics','renderActiveRouteLine'].map(name=>source.match(new RegExp('  (?:private )?'+name+'\\([^]*?\\n  \\}'))[0]);
 let now=20_000,writes=0,requests=0,clears=0;
 const context=vm.createContext({...geo,...api,Date:{now:()=>1_000_000},window:{performance:{now:()=>now}},ROUTE_SOURCE:'route',ROUTE_REROUTE_METERS:25,ROUTE_FAILURE_RETRY_MS:12_000,ROUTE_REFRESH_MS:90_000,ROUTING_PROVIDER:'osrm'});
 vm.runInContext(stripTypeScriptTypes(`class Route {${methods.join('\n')}};globalThis.route=new Route();`,{mode:'transform'}),context);
 const c=context.route,coordinates=[[44,36],[44,36.01]];
 const total=geo.distanceMeters(...coordinates);
 Object.assign(c,{destination:coordinates[1],navigating:true,travelMode:'car',routeCoordinates:coordinates,progressMeters:0,progressAt:0,lastRouteLineProgress:-1,lastDistance:total,lastDuration:200,routeProviderDistance:total,routeProviderDuration:200,routeData:{features:[{type:'Feature',properties:{traffic:'low'},geometry:{type:'LineString',coordinates}}]},rerouteConfirmation:new api.RerouteConfirmation(),routeRequestInFlight:false,lastRouteAttemptAt:0,lastRouteAt:now,lastRouteOrigin:coordinates[0],guidance:{clear(){clears++;}},map:{getSource:()=>({setData(data){writes++;assert.ok(data.features[0].geometry.coordinates[0][1]>=36.0005);}})},renderPanel(){},scheduleRouteRefresh(){requests++;},finishNavigationAtDestination(){throw Error('Not yet at destination');}});
 const snapshot={coordinate:[44,36.0005],accuracyMeters:5,speedMetersPerSecond:10,headingConfidence:1,headingSource:'gps-course',headingDegrees:0,sampledAt:999_900};
 c.updateLocation(snapshot);assert.equal(writes,1);assert.ok(c.lastDistance<total-50);assert.equal(requests,0);
 now+=1000;c.updateLocation({...snapshot,sampledAt:999_950});assert.equal(writes,1,'An unchanged GPS position does not rewrite the route');
 for(let n=0;n<3;n++){now+=1000;c.updateLocation({...snapshot,coordinate:[44.001+n*.00012,36.0005],sampledAt:1_000_000+n});}
 assert.equal(requests,1,'Confirmed departure schedules one reroute');assert.ok(clears>=3);assert.equal(writes,1,'Off-route GPS must not erase the remaining road');
 console.log('PASS crossing continuity, immediate route trimming, GPS drift rejection and confirmed rerouting');
}
{
 const descriptions=JSON.parse(fs.readFileSync(new URL('contracts/weather-descriptions.json',root),'utf8'));
 const api=load('src/lib/weather-codes.ts',{descriptions},'weatherCodeKind,weatherCodeLabel');
 assert.equal(Object.keys(descriptions.codes).length,28);
 assert.equal(api.weatherCodeKind(1),'mainly-clear');assert.equal(api.weatherCodeKind(2),'partly-cloudy');
 assert.equal(api.weatherCodeLabel(0,true,'en'),'Sunny');assert.equal(api.weatherCodeLabel(0,false,'en'),'Clear sky');
 assert.equal(api.weatherCodeLabel(61,true,'en'),'Light rain');assert.equal(api.weatherCodeKind(96),'hail');
 for(const code of Object.keys(descriptions.codes))for(const lang of ['ku','ar','en'])assert.ok(api.weatherCodeLabel(Number(code),true,lang).length>1);
 assert.equal(api.weatherCodeKind(100),'unavailable');assert.equal(api.weatherCodeLabel(NaN,true,'en'),'Weather unavailable');
 console.log('PASS all 28 WMO conditions in Kurdish/Arabic/English, clear/cloud separation and unknown-code fallback');
}
