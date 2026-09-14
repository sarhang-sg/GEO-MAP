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

{
  const { RuntimeStateController } = load('src/lib/runtime-state.ts', { navigator: { onLine: true } }, 'RuntimeStateController');
  const attributes = new Map();
  const shell = { dataset: {}, setAttribute: (key, value) => attributes.set(key, value) };
  const state = new RuntimeStateController(shell);
  let runs = 0;
  let release;
  const task = async () => { runs++; await new Promise(resolve => { release = resolve; }); state.fail(); };
  const first = state.runBootAttempt(task);
  for (let i = 0; i < 1000; i++) assert.equal(state.runBootAttempt(task), first);
  await Promise.resolve();
  assert.equal(runs, 1);
  release(); await first;
  state.markReady();
  assert.equal(state.snapshot().load, 'error', 'a late background callback must not clear a boot error');
  state.setNetworkState('offline');
  state.setUpdateState('available');
  const retry = state.runBootAttempt(async () => {
    runs++;
    assert.equal(state.snapshot().load, 'booting');
    state.markMapFirstFrame(); state.markInteractive(); state.markReady();
  });
  await retry;
  assert.equal(runs, 2);
  assert.equal(shell.dataset.loadState, 'ready');
  assert.equal(attributes.get('aria-busy'), 'false');
  assert.equal(state.snapshot().network, 'offline');
  assert.equal(state.snapshot().update, 'available');
  await state.runBootAttempt(task);
  assert.equal(runs, 2, 'completed boots must not repeat background initialization');
  const rejected = new RuntimeStateController(shell);
  await assert.rejects(rejected.runBootAttempt(() => { throw Error('synchronous failure'); }), /synchronous failure/);
  await rejected.runBootAttempt(async () => rejected.markReady());
  assert.equal(rejected.snapshot().load, 'ready', 'a synchronous throw must release the attempt gate');
  console.log('PASS boot coalesces 1000 retries, explicit retry clears error, ready finalizes once and preserves network/update state');
}

{
  const timers = new Map();
  let serial = 0;
  const { waitForMapReadiness } = load('src/lib/map-readiness.ts', {
    window: { setTimeout(fn, ms) { assert.equal(ms, 30000); timers.set(++serial, fn); return serial; }, clearTimeout(id) { timers.delete(id); } }
  }, 'waitForMapReadiness');
  const handlers = new Map();
  const map = {
    on(event, fn) { const group = handlers.get(event) ?? new Set(); group.add(fn); handlers.set(event, group); },
    off(event, fn) { handlers.get(event)?.delete(fn); }
  };
  const listenerCount = () => [...handlers.values()].reduce((count, group) => count + group.size, 0);
  const initial = waitForMapReadiness(map, ['load', 'style.load'], () => false);
  for (const fn of handlers.get('style.load')) fn();
  await initial;
  assert.equal(listenerCount(), 0, 'both style/load listeners must be removed after either wins');
  assert.equal(timers.size, 0);
  for (let i = 0; i < 100; i++) {
    const abort = new AbortController();
    const pending = waitForMapReadiness(map, ['render'], () => false, abort.signal);
    const rejected = assert.rejects(pending, /cancel/);
    abort.abort(Error('cancel'));
    await rejected;
    assert.equal(listenerCount(), 0);
    assert.equal(timers.size, 0);
  }
  const timedOut = waitForMapReadiness(map, ['render'], () => false);
  const timeoutAssertion = assert.rejects(timedOut, /timed out/);
  [...timers.values()][0](); await timeoutAssertion;
  assert.equal(listenerCount(), 0); assert.equal(timers.size, 0);
  await waitForMapReadiness(map, ['render'], () => true);
  assert.equal(listenerCount(), 0); assert.equal(timers.size, 0);
  const cancelled = new AbortController(); cancelled.abort(Error('cancel'));
  await assert.rejects(waitForMapReadiness(map, ['render'], () => true, cancelled.signal), /cancel/);
  assert.equal(listenerCount(), 0);
  console.log('PASS readiness events/timeouts/100 cancellations clean all observers and timers; already-ready maps do no work');
}

{
  const source = fs.readFileSync(new URL('src/bootstrap.ts', root), 'utf8');
  const recoverySource = source.slice(0, source.indexOf('const handoffTarget ='))
    .replace(/^import[^\n]+\n/gm, '');
  const { UI, languageDirection } = load('src/lib/i18n.ts', {}, 'UI,languageDirection');
  class Element {
    children = []; dataset = {}; attributes = new Map(); listeners = new Map(); disabled = false;
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    addEventListener(event, fn, options) { this.listeners.set(event, { fn, options }); }
    focus() { this.focused = true; }
    click() {
      if (this.disabled) return;
      const listener = this.listeners.get('click');
      if (listener?.options?.once) this.listeners.delete('click');
      listener?.fn();
    }
  }
  for (const language of ['ku', 'ar', 'en']) {
    for (const renderer of [true, false]) {
      const app = new Element();
      let reloads = 0;
      const document = { createElement: () => new Element(), getElementById: () => app, body: app };
      const context = vm.createContext({ Error, UI, languageDirection, document, readAppLifecycleSnapshot: () => ({ language }), window: { location: { reload() { reloads++; } } } });
      vm.runInContext(stripTypeScriptTypes(recoverySource, { mode: 'transform' }) + '\nglobalThis.recover = renderStartupFailure;', context);
      const error = new Error('<img src=x onerror=alert(1)>');
      error.name = renderer ? 'MapRendererUnavailableError' : 'Error';
      context.recover(error);
      const surface = app.children[0];
      const [title, message, retry] = surface.children[0].children;
      assert.equal(app.children.length, 1);
      assert.equal(surface.dataset.phase, 'failed');
      assert.equal(surface.dir, language === 'en' ? 'ltr' : 'rtl');
      assert.equal(title.textContent, UI[language].statusError);
      assert.equal(message.textContent, UI[language][renderer ? 'mapRendererUnavailable' : 'appStartupError']);
      assert.ok(!message.textContent.includes('<img'));
      assert.equal(retry.textContent, UI[language].loadingRetry);
      assert.equal(retry.focused, true);
      assert.equal(reloads, 0, 'displaying a fatal error must not reload automatically');
      retry.click(); retry.click();
      assert.equal(reloads, 1, 'one explicit activation allows only one document reload');
      assert.equal(retry.disabled, true);
    }
  }
  const main = fs.readFileSync(new URL('src/main.ts', root), 'utf8');
  assert.ok(main.indexOf('if (!this.map.dragPan)') < main.indexOf('this.animationScheduler ='), 'partial map must be rejected before installing controllers');
  assert.ok(source.includes('"./main").catch('), 'module evaluation failures must reach the startup boundary');
  assert.ok(main.includes('visualWait.abort();'), 'critical initialization failure must cancel the competing frame wait');
  console.log('PASS localized fatal startup surface, no raw error HTML, no automatic reload, explicit first-tap retry and partial-map guard');
}

{
  const { AppHealthController } = load('src/lib/app-health.ts', {}, 'AppHealthController');
  const health = Object.create(AppHealthController.prototype);
  Object.assign(health, { mapShell: { dataset: {} }, container: { dataset: { level: 'error' }, hidden: false } });
  health.ready();
  assert.equal(health.container.hidden, true, 'successful boot retry must remove its stale failure banner');
  health.container.dataset.level = 'offline'; health.container.hidden = false;
  health.ready();
  assert.equal(health.container.hidden, false, 'a real offline notice must survive successful cached-map startup');
  console.log('PASS successful recovery clears its previous error banner without hiding an active offline notice');
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
{
  const h=gpsHarness();
  const request=h.c.locate();
  h.fix();
  const snapshot=await request;
  assert.equal(Array.from(snapshot.coordinate).join(","),"44.2,36.2");
  assert.equal(h.watches.length,1);
  console.log('PASS GPS exposes the shared first-fix result without starting a second provider request');
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
{
  const source=fs.readFileSync(new URL('src/lib/routing-controller.ts',root),'utf8');
  const start=source.indexOf('  private async selectDestination');
  const end=source.indexOf('\n  private setDestination',start);
  assert.ok(start>0&&end>start,'destination selection method is missing');
  const classSource=`class Harness {\n${source.slice(start,end)}\n}`;
  const context=vm.createContext({UI:{en:{routeOutsideBoundary:'outside'}}});
  vm.runInContext(stripTypeScriptTypes(classSource,{mode:'transform'})+'\nglobalThis.Harness=Harness;',context);
  const controller=new context.Harness();
  let resolveLocation;let commits=0;let pinModeCalls=0;
  Object.assign(controller,{
    destinationSelectionSerial:0,
    getLanguage:()=> 'en',
    getLocationSnapshot:()=>({coordinate:null}),
    requestLocation:()=>new Promise(resolve=>{resolveLocation=resolve;}),
    setPinMode(){pinModeCalls++;},
    isDestinationAllowed:()=>true,
    setMessage(){},
    setDestination(){commits++;}
  });
  const selection=controller.selectDestination([44.1,36.1],'target');
  assert.equal(commits,0,'destination must not commit before the first GPS fix');
  assert.equal(pinModeCalls,1);
  resolveLocation({coordinate:[44,36]});
  await selection;
  assert.equal(commits,1,'destination must commit after GPS succeeds');

  const stale=controller.selectDestination([44.2,36.2],'stale');
  controller.destinationSelectionSerial+=1;
  resolveLocation({coordinate:[44,36]});
  await stale;
  assert.equal(commits,1,'cancelled/stale destination must never commit later');
  console.log('PASS destination waits for GPS, paints no premature marker and ignores stale selections');
}
