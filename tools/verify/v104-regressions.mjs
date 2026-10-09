#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const root=new URL('../../',import.meta.url);
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
 const api=load('src/lib/route-maneuvers.ts',{},'routeManeuvers,nextManeuver,maneuverLabel,maneuverArrow');
 const steps=api.routeManeuvers([{steps:[{distance:100,maneuver:{type:'depart'}},{distance:200,name:'A',maneuver:{type:'turn',modifier:'left'}},{distance:50,maneuver:{type:'turn',modifier:'uturn'}},{distance:20,maneuver:{type:'roundabout',exit:3}},{distance:0,maneuver:{type:'arrive'}}]}]);
 assert.equal(steps.length,4);assert.deepEqual(Array.from(steps,s=>s.atMeters),[100,300,350,370]);
 assert.equal(api.nextManeuver(steps,120).modifier,'uturn');
 for(const lang of ['ku','ar','en'])for(const step of steps){assert.ok(api.maneuverLabel(step,lang).length>3);assert.ok(api.maneuverArrow(step).startsWith('<svg'));}
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
