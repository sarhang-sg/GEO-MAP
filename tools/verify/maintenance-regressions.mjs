import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "./typescript-transform.mjs";
import { loadNavigationModule } from "./navigation-harness.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = fs.readFileSync(new URL("../../src/lib/atlas-places.ts", import.meta.url), "utf8");
const region = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const authSource = region("const AUTH_IDENTITY_CACHE_TTL_MS", "function browserStorage")
  + region("export async function getAtlasAuthIdentity", "export async function signInAtlasWithGoogle")
  + region("export async function signOutAtlasUser", "export async function getAtlasUserProfile");
let user = {id:"A",email:"a@example.test",user_metadata:{}};
let userTask = null, roleTask = deferred(), logoutTask = null, roleReads = 0;
const auth = vm.createContext({
  Date, Promise, Error, window:{setTimeout},
  currentAtlasAuthUser: () => userTask?.promise ?? Promise.resolve(user),
  isLikelyNetworkError: () => false, isAuthSessionMissing: () => false,
  clearAtlasAuthNavigationState: () => {},
  atlasSupabase:{
    from:()=>({select(){return this;},eq(){return this;},maybeSingle(){roleReads++;return roleTask.promise;}}),
    auth:{signOut:()=>logoutTask?.promise ?? Promise.resolve({error:null}),getSession:async()=>({data:{session:null},error:null})},
  },
});
vm.runInContext(stripTypeScriptTypes(authSource,{mode:"transform"}).replace(/\bexport /g,"")
  + "\nglobalThis.api={getAtlasAuthIdentity,signOutAtlasUser,clearAtlasAuthIdentityCache,cache:()=>authIdentityCache};",auth);
const a = auth.api;
const oldRole = roleTask;
const pending = Array.from({length:100},()=>a.getAtlasAuthIdentity());
await tick(); assert.equal(roleReads,1);
await a.signOutAtlasUser();
user={id:"B",email:"b@example.test",user_metadata:{}};roleTask=deferred();
const next=a.getAtlasAuthIdentity();await tick();roleTask.resolve({data:null,error:null});
assert.equal((await next).userId,"B");
oldRole.resolve({data:{user_id:"A"},error:null});
assert.ok((await Promise.all(pending)).every(value=>value===null));
assert.equal(a.cache().userId,"B");
userTask=deferred();a.clearAtlasAuthIdentityCache();const staleUser=a.getAtlasAuthIdentity();
await a.signOutAtlasUser();userTask.resolve(user);assert.equal(await staleUser,null);userTask=null;
logoutTask=deferred();const logout=a.signOutAtlasUser();
assert.equal(await a.getAtlasAuthIdentity(),null);logoutTask.resolve({error:null});await logout;
assert.equal(a.cache(),null);
console.log("PASS account races: 100 role reads coalesce; delayed session/role results cannot restore a logged-out account or replace a new account");

const readyApi=loadNavigationModule("src/lib/service-worker-ready.ts",{Promise,DOMException,setTimeout,clearTimeout},"waitForServiceWorkerReady");
const blocked=deferred(),aborter=new AbortController();
const aborted=readyApi.waitForServiceWorkerReady(blocked.promise,aborter.signal,1000);
aborter.abort();await assert.rejects(aborted,e=>e.name==="AbortError");blocked.reject(new Error("late registration failure"));await tick();
await assert.rejects(readyApi.waitForServiceWorkerReady(new Promise(()=>{}),undefined,5),e=>e.name==="TimeoutError");
const registration={active:{}};assert.equal(await readyApi.waitForServiceWorkerReady(Promise.resolve(registration),undefined,1000),registration);
console.log("PASS offline registration: missing worker times out; Pause aborts discovery; late failures are handled; ready workers clear their timer");

const offline=loadNavigationModule("src/lib/offline-map-pack.ts",{
  navigator:{storage:{getDirectory:()=>{}}},window:{isSecureContext:true,localStorage:{getItem:()=>null,setItem:()=>{}},setTimeout,clearTimeout},
  MAP_DATA_VERSION:"test-map",OFFLINE_PACK_VERSION:"test-pack",OFFLINE_RUNTIME_BYTES:100,
  OFFLINE_MAP_FILES:[{id:"base",bytes:10,sha256:"x"},{id:"roads",bytes:10,sha256:"y"}],
  Date,Error,Number,DOMException,waitForServiceWorkerReady:readyApi.waitForServiceWorkerReady,
},"OfflineMapPackManager");
const manager=new offline.OfflineMapPackManager({baseRemoteUrl:"https://example.test/base",roadsRemoteUrl:"https://example.test/roads"});
const reply={language:"ku",generation:0,ok:true,totalBytes:100,cachedBytes:100};
manager.setLanguage("ar");manager.setLanguage("ku");await tick();
manager.applyRuntimeReply(reply);assert.equal(manager.metadata.runtime.complete,false);
manager.applyRuntimeReply({...reply,generation:2});assert.equal(manager.metadata.runtime.complete,true);
await manager.clearOfflineRuntime();manager.applyRuntimeReply({...reply,generation:2});
assert.equal(manager.metadata.runtime.complete,false);
console.log("PASS offline language/delete races: switching back to a language or deleting data cannot accept stale completion replies");

const windowEvents=new EventTarget(),documentEvents=new EventTarget();documentEvents.hidden=false;
let frames=[],resumes=[];
Object.assign(windowEvents,{requestAnimationFrame:fn=>(frames.push(fn),frames.length),cancelAnimationFrame:()=>{},sessionStorage:{getItem:()=>null}});
const lifecycle=loadNavigationModule("src/lib/app-lifecycle-controller.ts",{
  Date,window:windowEvents,document:documentEvents,localCoreEnabled:true,
  nativeUiSnapshot:()=>null,saveNativeUiSnapshot:()=>{},
},"validSnapshot,installAppLifecycleController");
const snapshot={schema:1,savedAt:Date.now(),camera:{center:[44,36],zoom:10,bearing:0,pitch:0},language:"ku",mapMode:"night",sheetCollapsed:true,basemapVisible:true,administrativeVisible:true,placesVisible:true,controlsHidden:false};
assert.ok(lifecycle.validSnapshot(snapshot));
for(const bad of [ {...snapshot,savedAt:Date.now()+120000}, {...snapshot,camera:{...snapshot.camera,pitch:90}}, {...snapshot,camera:{...snapshot.camera,zoom:-1}} ]) assert.equal(lifecycle.validSnapshot(bad),false);
const controller=lifecycle.installAppLifecycleController({capture:()=>snapshot,onResume:value=>resumes.push(value)});
windowEvents.dispatchEvent(new Event("nav-kurd:native-suspend"));windowEvents.dispatchEvent(new Event("nav-kurd:native-resume"));
frames.splice(0).forEach(fn=>fn());assert.equal(resumes.length,1);
controller.destroy();windowEvents.dispatchEvent(new Event("nav-kurd:native-resume"));assert.equal(frames.length,0);
console.log("PASS lifecycle: OEM native resume recovers state without a browser visibility event; listeners clean up; invalid camera and future snapshots are rejected");

const mapCalls=[],messages=[],mapSource={setData:data=>mapCalls.push(data)};
const geo=loadNavigationModule("src/lib/pwa-file-handler.ts",{
  UI:{en:{pwaFileImported:"ok",pwaFileInvalid:"invalid",pwaFileNoGeometry:"empty"}},Error,JSON,Number,
},"normalizeGeoJson,validateAndBounds,PwaMapFileController");
const feature=coordinates=>({type:"Feature",geometry:{type:"Point",coordinates},properties:{}});
const collection=features=>({type:"FeatureCollection",features});
assert.deepEqual(Array.from(geo.validateAndBounds(collection([feature([44,36])])),x=>Array.from(x)),[[44,36],[44,36]]);
const polygon={type:"Feature",properties:{},geometry:{type:"Polygon",coordinates:[[[44,36],[45,36],[45,37],[44,36]]]}};
geo.validateAndBounds(collection([polygon]));
for(const malformed of [feature([181,36]),{...feature([44,36]),geometry:{type:"Unknown",coordinates:[44,36]}},{...feature([44,36]),geometry:{type:"LineString",coordinates:[[44,36]]}},{...polygon,geometry:{type:"Polygon",coordinates:[[[44,36],[45,36],[45,37],[44,37]]]}}]) assert.throws(()=>geo.validateAndBounds(collection([feature([44,36]),malformed])));
let nested={type:"Point",coordinates:[44,36]};for(let i=0;i<18;i++)nested={type:"GeometryCollection",geometries:[nested]};
assert.throws(()=>geo.validateAndBounds(collection([{type:"Feature",geometry:nested,properties:{}}])));
const fileController=new geo.PwaMapFileController({map:{getSource:()=>mapSource,getLayer:()=>({}),fitBounds:()=>{}},getLanguage:()=>"en",setMessage:message=>messages.push(message)});
const oldFile=deferred();const first=fileController.openFiles([{name:"old.geojson",size:10,text:()=>oldFile.promise}]);
await fileController.openFiles([{name:"new.geojson",size:10,text:async()=>JSON.stringify(collection([feature([45,37])]))}]);
oldFile.resolve(JSON.stringify(collection([feature([44,36])])));await first;
assert.equal(mapCalls.length,1);assert.equal(mapCalls[0].features[0].geometry.coordinates[0],45);assert.equal(messages.length,1);
console.log("PASS imported places: malformed/mixed geometries and deep nesting rejected before rendering; a slow old file cannot overwrite the new selection");

let clicks=0,dialog=null;const roots=new Map();
const surface=(disabled=false)=>({closest:()=>null,getClientRects:()=>[{}],querySelector:()=>({disabled,click:()=>clicks++})});
const back=loadNavigationModule("src/lib/native-back-navigation.ts",{document:{querySelectorAll:selector=>selector==="dialog[open]"?(dialog?[dialog]:[]):(roots.get(selector)??[])},Event},"handleNativeBack");
assert.equal(back.handleNativeBack(),false);
roots.set(".about-dialog",[surface()]);roots.set(".offline-pack-confirm",[surface()]);
assert.equal(back.handleNativeBack(),true);assert.equal(clicks,1);
roots.set(".offline-pack-confirm",[surface(true)]);assert.equal(back.handleNativeBack(),true);assert.equal(clicks,1);
let closes=0;dialog={dispatchEvent:()=>false,close:()=>closes++};assert.equal(back.handleNativeBack(),true);assert.equal(closes,0);
dialog.dispatchEvent=()=>true;back.handleNativeBack();assert.equal(closes,1);
console.log("PASS Android Back: nested cancel takes priority; a disabled save consumes Back; dialog cancel vetoes and the map's normal exit path are preserved");

const workers=[];
class FakeSearchWorker {
  events={};requests=[];terminated=false;
  constructor(){workers.push(this);}
  addEventListener(type,callback){this.events[type]=callback;}
  postMessage(request){this.requests.push(request);}
  terminate(){this.terminated=true;}
  reply(type,fields={}){this.events.message({data:{type,id:this.requests.at(-1).id,...fields}});}
}
const workerSource=fs.readFileSync(new URL('../../src/lib/search-worker-client.ts',import.meta.url),'utf8')
  .replace(/^import[^\n]+\n/gm,'').replace(/import\.meta\.url/g,'"https://example.test/client.js"');
const workerContext=vm.createContext({Worker:FakeSearchWorker,URL,Date,Map,Promise,Error,window:{setTimeout,clearTimeout}});
vm.runInContext(stripTypeScriptTypes(workerSource,{mode:'transform'}).replace(/\bexport /g,'')+'\nglobalThis.SearchWorkerClient=SearchWorkerClient;',workerContext);
const searchClient=new workerContext.SearchWorkerClient({manifestUrl:'/manifest.json'});
const oldActivation=searchClient.activateLanguage('ku');
const rejectedActivation=assert.rejects(oldActivation,/language changed/);
workers[0].reply('ready',{records:1});
const newActivation=searchClient.activateLanguage('en');
await rejectedActivation;
assert.equal(searchClient.isReady,false,'Queued ready microtask must not ready the replacement worker');
workers[0].events.error({message:'late old error'});
workers[0].events.messageerror({});
assert.equal(workers[1].terminated,false,'An old worker cannot terminate the new worker');
workers[1].reply('ready',{records:2});assert.equal(await newActivation,2);
const oldResults=searchClient.search('school','en');
workers[1].reply('results',{items:[{id:'old'}]});
const lastActivation=searchClient.activateLanguage('ar');
assert.equal((await oldResults).length,0,'A queued old result cannot leak into a new language');
assert.equal(searchClient.isReady,false);
workers[2].reply('ready',{records:3});await lastActivation;
const currentResults=searchClient.search('school','ar');workers[2].reply('results',{items:[{id:'current'}]});
assert.equal((await currentResults)[0].id,'current');searchClient.reset();
console.log('PASS search worker language races: queued ready/results and late old-worker errors cannot change the current language');
