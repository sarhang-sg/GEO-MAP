import assert from 'node:assert/strict';
import { loadNavigationModule as load } from './navigation-harness.mjs';

const taxonomy = load('src/lib/atlas-taxonomy.ts', {}, 'ATLAS_TAXONOMY,atlasPlaceTypeSearchTerms');
const matching = load('src/lib/static-search.ts', taxonomy,
  'normalizeStaticSearch,phoneticSearchGroups,prepareStaticSearchQuery,scoreStaticSearchProfile,searchIntentIdsForCategory');
const languageHelpers = load('src/lib/map-language.ts', {}, 'localizeNameValue');
const names = load('src/lib/geo-format.ts', languageHelpers, 'ownerName,languageValue,placeRank');
const { SearchService } = load('src/lib/search-service.ts', {
  ...taxonomy, ...matching, ...names, localCoreEnabled: false,
  ROAD_HAZARD_DATA: { features: [] }, yieldToMainThread: async () => {}
}, 'SearchService');

let language = 'ku';
const records = [
  { id: 'water', category: 'water_well', name_ku: 'بیری هەژار', longitude: 44, latitude: 36 },
  { id: 'oil', category: 'oil_field', name_ku: 'کێڵگەی دڵشاد', longitude: 44.01, latitude: 36 },
  { id: 'factory', category: 'factory', name_en: 'Silver Birch', longitude: 44.02, latitude: 36 }
];
const localities = [];
let places = records;
const service = new SearchService({ getLanguage: () => language, getLocalities: () => localities,
  getOwnerPlaces: () => places, searchStatic: async () => [] });
const ids = results => Array.from(results, x => x.place.id);
for (const [lang, terms] of Object.entries({ en: ['water well','oil field','factory'],
  ar: ['بئر ماء','حقل نفط','مصنع'], ku: ['بیری ئاو','کێڵگەی نەوت','کارگە'] })) {
  language = lang;
  for (const [i, term] of terms.entries()) {
    assert.deepEqual(ids(await service.searchFast(term)), [records[i].id], term);
    assert.deepEqual(ids(await service.search(term)), [records[i].id], term);
  }
}
assert.equal(names.ownerName(records[2], 'ku'), 'Silver Birch');
const anchor = { coordinate: [44,36], score: 1 };
assert.deepEqual(ids(service.searchOwnerPlaces(matching.prepareStaticSearchQuery('factory'), anchor)), ['factory']);
assert.deepEqual(ids(await service.searchFast('xqzvpl')), []);
places = [{ ...records[2], id: 'new', name_en: 'New Cyan Foundry' }];
assert.deepEqual(ids(await service.searchFast('factory')), ['new']);
assert.deepEqual(ids(await service.search('New Cyan Foundry')), ['new']);
for (let n=0; n<40; n++) await service.searchFast('fixture'+n);
assert.ok(service.ownerResults.size <= 24);
console.log('PASS multilingual category results, published snapshot replacement, bounded cache and nearby relevance');

const { readKeysetPages } = load('src/lib/keyset-pages.ts', { AbortController, setTimeout, clearTimeout }, 'readKeysetPages');
const rows = Array.from({ length: 1003 }, (_, i) => ({ id: String(i+1).padStart(4, '0') }));
const fetched = await readKeysetPages((after, size) => Promise.resolve({
  data: rows.filter(r => after === null || r.id > after).slice(0, Math.min(size,97)), error: null }));
assert.deepEqual(Array.from(fetched, x => x.id), rows.map(x => x.id));
await assert.rejects(readKeysetPages(async () => ({ data: rows.slice(0,1) })), /advance/);
await assert.rejects(readKeysetPages(async () => ({ data: null, error: Error('offline') })), /offline/);
await assert.rejects(readKeysetPages(async () => ({ data: rows.slice(0,3) }), 3, 2), /budget/);
console.log('PASS complete pagination despite server cap, failure and nonadvancing cursor');

const hooks = new Map();
const attrs = {};
const button = { dataset:{}, classList:{ toggle() {} },
  setAttribute(k,v) { attrs[k] = v; }, addEventListener(k,f) { hooks.set(k,f); },
  removeEventListener(k) { hooks.delete(k); } };
let pitch=0, moving=false, reduce=false;
const moves=[];
const on = (event, handler) => hooks.set(event, handler);
const map = { touchZoomRotate:{enable(){},enableRotation(){}}, dragRotate:{enable(){}},
  getPitch: () => pitch, getZoom: () => 16, isRotating: () => false, isZooming: () => false,
  on, once:on, off(event) { hooks.delete(event); },
  stop() { moving=false; hooks.get('moveend')?.(); },
  isMoving: () => moving, easeTo(options) { moves.push(options); moving = options.duration > 0; if (!moving) pitch=options.pitch; } };
const camera = load('src/lib/map-camera-controller.ts', { window:{ matchMedia: () => ({matches:reduce}) },
  document:{body:{dataset:{}}} }, 'installMapCameraController,isCameraModeTransition');
camera.installMapCameraController({map,button});
hooks.get('click')();
assert.equal(moves.at(-1).pitch,52);
assert.equal(camera.isCameraModeTransition(map),true);
const {LiveLocationController} = load('src/lib/live-location-controller.ts',camera,'LiveLocationController');
LiveLocationController.prototype.recenter.call({ lastCoordinate:[44,36], lastAccuracy:10, map });
assert.equal(moves.length,1);
hooks.get('click')();
assert.equal(moves.at(-1).pitch,0);
assert.equal(attrs['aria-pressed'],'false');
moving=false; hooks.get('moveend')();
reduce=true; hooks.get('click')();
assert.equal(moves.at(-1).duration,0);
assert.equal(camera.isCameraModeTransition(map),false);
hooks.get('remove')(); assert.equal(hooks.has('click'),false);
console.log('PASS rapid 3D reversal, follow interruption, reduced motion and disposal');

let nextTimer=0, pendingResolve, removed=0;
const timers=new Map(), events=new Map(), calls=[];
const bridgeWindow={ flutter_inappwebview:{ async callHandler(...args) { calls.push(args); } },
  setTimeout(f) { timers.set(++nextTimer,f); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
  addEventListener(k,f) { events.set(k,f); }, removeEventListener(k) { events.delete(k); } };
const {installNativeAccountNotifications}=load('src/lib/native-account-notifications.ts', {
  window:bridgeWindow,navigator:{onLine:true}, getAtlasAuthIdentity: () => new Promise(resolve => {pendingResolve=resolve;}),
  loadAtlasNotifications:async()=>[],subscribeToAtlasAccount:()=>()=>removed++,subscribeToAtlasAuth:()=>()=>removed++
},'installNativeAccountNotifications');
const disposeFirst=installNativeAccountNotifications(()=>'en');
[...timers.values()][0]();
const disposeSecond=installNativeAccountNotifications(()=>'en');
pendingResolve({userId:'previous'}); await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.length,0);
assert.equal(removed,2); disposeFirst(); disposeSecond();
assert.equal(removed,4); assert.equal(events.size,0);
console.log('PASS stale account notification response suppressed after cleanup and double installation');

// Resolve the previous request between the next input event and its debounce.
class InputFixture {
  value=''; hidden=false; children=[]; listeners=new Map(); id='fixture';
  classList={toggle() {}};
  addEventListener(type, fn) { this.listeners.set(type,fn); }
  closest() { return null; }
  setAttribute() {}
  removeAttribute() {}
  replaceChildren(...children) { this.children=children; }
}
const input=new InputFixture(), list=new InputFixture();
let deferredRefresh, resolveOld;
const {installSearchController}=load('src/lib/search-controller.ts', {
  debounceAsync(fn) { return () => { deferredRefresh=fn; }; },
  normalize:s=>s.trim().toLowerCase(), UI:{en:{noResult:'none',searchLoading:'loading',searchError:'error'}},
  window:{matchMedia:()=>({matches:false}),queueMicrotask,addEventListener(){}},
  document:{createElement:()=>new InputFixture(),addEventListener(){}}
},'installSearchController');
installSearchController({ input, clearButton:new InputFixture(), results:list, getLanguage:()=>'en',
  adapter:{searchFast:()=>[],isSearchIndexReady:()=>false,search:()=>new Promise(resolve=>{resolveOld=resolve;})} });
input.value='old';input.listeners.get('input')();const oldRefresh=deferredRefresh();
await new Promise(resolve=>setImmediate(resolve));
input.value='new';input.listeners.get('input')();const visibleBefore=list.children;
resolveOld([]);await oldRefresh;await new Promise(resolve=>setImmediate(resolve));
assert.equal(list.children,visibleBefore,'a previous request painted during the new debounce');
console.log('PASS a stale promise cannot replace results between keystrokes');
