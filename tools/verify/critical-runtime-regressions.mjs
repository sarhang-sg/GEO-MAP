#!/usr/bin/env node
// Production methods with controlled providers; no claim of on-device timing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../../', import.meta.url);
function load(path, globals, exports) {
  const source = fs.readFileSync(new URL(path, root),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'');
  const context=vm.createContext(globals);
  vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport /g,'')+`\nglobalThis.api={${exports}}`,context);
  return context.api;
}
function gpsHarness() {
  const watches=[], moves=[], messages=[];
  const gps=load('src/lib/live-location-controller.ts',{distanceMeters:()=>0,Date,window:{performance:{now:()=>10000}},localStorage:{setItem(){}},UI:{en:{locating:'locating',locationReady:'ready',locationDenied:'denied',locationTimeout:'timeout',locationUnavailable:'unavailable'}}},'LiveLocationController');
  const c=Object.create(gps.LiveLocationController.prototype);
  Object.assign(c,{watchGeneration:0,watchId:null,requestInFlight:false,lastCoordinate:null,lastPositionAt:0,lastAcceptedPositionTimestamp:0,lastHeading:null,lastHeadingConfidence:0,lastRawCoordinate:null,lastRawPositionAt:0,lastAccuracy:120,
    geolocation:{watchPosition(success,error,options){watches.push({success,error,options,active:true});return watches.length;},clearWatch(id){watches[id-1].active=false;},getCurrentPosition(){throw Error('Duplicate one-shot request');}},
    getLanguage:()=> 'en',setFollowEnabled(value){this.followEnabled=value;},setMessage(m){messages.push(m);},requestOrientationPermission(){},shouldRejectDegradedFix:()=>false,stableCoordinate:coordinate=>({coordinate,rejectedJump:false}),resolveCourseHeading:()=>null,courseHeadingLocked:()=>false,
    show(coordinate){this.lastCoordinate=coordinate;},recenter(){moves.push(this.lastCoordinate);}
  });
  const fix=(watch=watches.at(-1),age=0)=>watch.success({timestamp:Date.now()-age,coords:{longitude:44.2,latitude:36.2,accuracy:120,speed:0}});
  return {c,gps,watches,moves,messages,fix};
}
for (const code of [1,2,3]) {
  const h=gpsHarness();
  for(let i=0;i<1000;i++)h.c.locate();
  assert.equal(h.watches.length,1);assert.equal(h.messages[0],'locating');
  h.watches[0].error({code,PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3});
  assert.equal(h.messages.at(-1),['','denied','unavailable','timeout'][code]);
  assert.equal(h.c.watchId,null);assert.equal(h.c.requestInFlight,false);assert.equal(h.watches[0].active,false);
  h.c.locate();assert.equal(h.watches.length,2);
  h.fix(h.watches[0]);assert.equal(h.moves.length,0,'Cancelled callback must not move map');
  h.fix(h.watches[1],60000);assert.equal(h.moves.length,0,'Stale cache must not move map');
  h.fix();assert.equal(h.moves.length,1);assert.equal(h.c.requestInFlight,false);
  h.c.stopFollow();h.fix();assert.equal(h.moves.length,1);
  h.c.locate();assert.equal(h.moves.length,2);assert.equal(h.watches.length,2);
}
console.log('PASS GPS first feedback, 1000 repeated taps share one request, error distinctions, retry, stale callbacks/cache, success/cached focus and manual-pan state');
{
  const h=gpsHarness();const listeners=new Set();const camera=[];
  Object.assign(h.c,{lastCoordinate:[44,36],finishCameraMove(){h.c.programmaticMove=false;},map:{stop(){},off(_,fn){listeners.delete(fn);},once(_,fn){listeners.add(fn);},getZoom:()=>8,easeTo(options){camera.push(options);for(const fn of listeners)fn();listeners.clear();},isMoving:()=>false}});
  for(let i=0;i<200;i++)h.gps.LiveLocationController.prototype.recenter.call(h.c,true);
  assert.equal(listeners.size,0);assert.equal(h.c.programmaticMove,false);assert.equal(camera[0].zoom,15.5);assert.equal(camera[0].duration,480);
  console.log('PASS actual camera method centers/zooms smoothly with no accumulated moveend listeners');
}
class Events {
  handlers=new Map();
  addEventListener(type,fn){const set=this.handlers.get(type)??new Set();set.add(fn);this.handlers.set(type,set);}
  removeEventListener(type,fn){this.handlers.get(type)?.delete(fn);}
  emit(type,event={}){for(const fn of this.handlers.get(type)??[])fn(event);}
}
{
  const win=new Events();const media=new Events();media.matches=true;const frames=new Map();let serial=0,writes=0;
  const values=new Map();const element={dataset:{},style:{getPropertyValue:key=>values.get(key),setProperty(key,value){values.set(key,value);writes++;}}};
  Object.assign(win,{PointerEvent:function(){},matchMedia:()=>media,innerWidth:390,innerHeight:844,visualViewport:new Events()});
  const api=load('src/lib/input-mode-controller.ts',{window:win,document:{documentElement:element},requestAnimationFrame(fn){frames.set(++serial,fn);return serial;},cancelAnimationFrame(id){frames.delete(id);}},'installInputModeController');
  const dispose=api.installInputModeController();
  for(let i=0;i<200;i++)win.emit('resize');assert.equal(frames.size,1);
  for(const [id,fn]of frames){frames.delete(id);fn();}assert.equal(writes,4);
  win.emit('resize');for(const [id,fn]of frames){frames.delete(id);fn();}assert.equal(writes,4);
  assert.equal(win.handlers.has('touchstart'),false);assert.equal(win.handlers.has('mousemove'),false);
  win.emit('pointerdown',{pointerType:'touch'});assert.equal(element.dataset.inputMode,'touch');
  dispose();assert.ok([...win.handlers.values()].every(set=>set.size===0));
  console.log('PASS modern touch has one event stream, viewport events coalesce without duplicate writes, listeners clean up');
}
{
  const storage=new Map();let reads=0,syncs=0,release;let fail=true;const errors=[];
  const api=load('src/lib/navigation-history-store.ts',{Date,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},console:{error:(...args)=>errors.push(args)},loadAtlasNavigationHistory:async()=>{reads++;return [];},syncAtlasNavigationHistory:async entries=>{syncs++;await new Promise(resolve=>release=resolve);if(fail)throw Error('PGRST205 test');return entries.length;}},'queueNavigationHistory,loadPendingNavigationHistory,loadSynchronizedNavigationHistory');
  const entry={id:'one',status:'arrived',startedAt:1,endedAt:2,destination:'test',travelMode:'walking'};
  api.queueNavigationHistory(entry, "account-a");
  const a=api.loadSynchronizedNavigationHistory('account-a');const b=api.loadSynchronizedNavigationHistory('account-a');assert.equal(a,b);
  release();await a;assert.equal(syncs,1);assert.equal(reads,0);assert.equal(errors.length,1);
  for(let i=0;i<100;i++)await api.loadSynchronizedNavigationHistory('account-a');
  assert.equal(syncs,1);assert.equal(api.loadPendingNavigationHistory().length,1);
  fail=false;api.queueNavigationHistory({...entry,id:"account-b-entry"},"account-b");const next=api.loadSynchronizedNavigationHistory('account-b');api.queueNavigationHistory({...entry,id:'new-during-upload'},"account-b");release();await next;
  assert.equal(reads,1);assert.equal(api.loadPendingNavigationHistory('account-b')[0].id,'new-during-upload');assert.equal(api.loadPendingNavigationHistory('account-a')[0].id,'one');
  console.log('PASS history concurrent requests deduplicate, failures back off, no failed GET loop and in-flight queue additions survive');
}
{
  const source=fs.readFileSync(new URL('src/main.ts',root),'utf8');
  const start=source.indexOf('const releaseTouchControl =');
  const snippet=source.slice(start,source.indexOf('\n};',start)+3);
  const frames=[];let blurs=0;
  const button={isConnected:true,blur(){blurs++;}};
  class Element {closest(){return button;}}
  const document={documentElement:{dataset:{inputMode:'touch'}},activeElement:button};
  const context=vm.createContext({Element,document,window:{requestAnimationFrame:fn=>frames.push(fn)}});
  vm.runInContext(stripTypeScriptTypes(snippet)+'\nglobalThis.release=releaseTouchControl;',context);
  context.release({target:new Element()});
  // The click opens a dialog and focuses its input before the next frame.
  document.activeElement={blur(){throw Error('Dialog input lost focus');}};
  frames.shift()();assert.equal(blurs,0);
  document.activeElement=button;context.release({target:new Element()});frames.shift()();assert.equal(blurs,1);
  console.log('PASS post-click touch cleanup preserves a newly opened dialog input focus');
}
