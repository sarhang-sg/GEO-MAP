import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const root=new URL('../../',import.meta.url);
function load(path,globals,exports){const source=fs.readFileSync(new URL(path,root),'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replaceAll('import.meta.env.BASE_URL','"/"');const context=vm.createContext(globals);vm.runInContext(stripTypeScriptTypes(source,{mode:'transform'}).replace(/\bexport /g,'')+`\nglobalThis.api={${exports}}`,context);return context.api;}
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
{
 const layers=new Map([['atlas-place-marker',{}]]),images=new Set();let adds=0,removes=0,filters=0,categories=['cafe'];
 const map={getSource:()=>({}),getLayer:id=>layers.get(id),hasImage:id=>images.has(id),addImage:id=>images.add(id),addLayer:l=>{adds++;layers.set(l.id,l);},removeLayer:id=>{removes++;layers.delete(id);},setPaintProperty(){},getLayoutProperty:(id,k)=>layers.get(id)?.layout?.[k],setLayoutProperty:(id,k,v)=>{layers.get(id).layout[k]=v;},setFilter:(id,f)=>{filters++;layers.get(id).filter=f;},setLayerZoomRange(){}};
 const {installAtlasMarkerIconController}=load('src/lib/atlas-marker-icon-controller.ts',{window:{devicePixelRatio:3},Image:class{set src(v){queueMicrotask(()=>this.onload());}},document:{createElement:()=>({getContext:()=>({clearRect(){},drawImage(){},getImageData:()=>({})})})},atlasMarkerProfilesForCategories:ids=>ids.map(id=>({id,tier:'local',imageId:'icon-'+id,asset:id+'.svg'})),atlasMarkerProfilesForTier:(tier,items)=>items.filter(p=>p.tier===tier)},'installAtlasMarkerIconController');
 const c=installAtlasMarkerIconController({map,lowPowerProfile:false,getPlacesVisible:()=>true,getActiveCategories:()=>categories,isMobileViewport:()=>true});await c.reconcile();const first=layers.get('atlas-place-marker-local');for(let i=0;i<50;i++)await c.reconcile();assert.equal(adds,1);assert.equal(removes,0);assert.equal(filters,0);assert.equal(layers.get('atlas-place-marker-local'),first);categories=['cafe','shop'];await c.reconcile();assert.equal(adds,1);assert.equal(filters,1);layers.delete('atlas-place-marker-local');await c.reconcile();assert.equal(adds,2);
 console.log('PASS V10 markers: 50 reconciliations keep layer identity; category/style changes reconcile');
}
{
 let zoom=10,west=43,frame,pending,writes=0;const deltas=[],listeners=new Map();
 const makeSource=()=>({setData(){writes++;return new Promise(r=>{pending=r;});},updateData(diff){writes++;deltas.push(diff);return Promise.resolve();}});let target=makeSource();
 const map={getZoom:()=>zoom,getBounds:()=>({getWest:()=>west,getEast:()=>west+1,getSouth:()=>35,getNorth:()=>37}),getSource:()=>target,on:(k,f)=>listeners.set(k,f),off:k=>listeners.delete(k)};
 const {installLocalityViewportSourceController}=load('src/lib/locality-viewport-source.ts',{document:{hidden:false},window:{requestAnimationFrame:f=>{frame=f;return 1;},cancelAnimationFrame:()=>{frame=null;}},recordRuntimeDiagnostic:()=>{}},'installLocalityViewportSourceController');
 const c=installLocalityViewportSourceController({map,getVisible:()=>true,getLocalities:()=>[43.5,44.5].map((x,i)=>({geometry:{coordinates:[x,36]},properties:{id:String(i),place:'village'}}))});const tick=async()=>{const f=frame;frame=null;f?.();await flush();};
 c.start();await tick();assert.equal(writes,1);west=44;c.refresh();await tick();assert.equal(writes,1);pending();await flush();await tick();assert.equal(writes,2);assert.equal(deltas[0].remove[0],'0');assert.equal(deltas[0].add[0].id,'1');zoom=8;c.refresh();await tick();c.setVisible(false);await tick();assert.equal(writes,2);zoom=10;c.setVisible(true);await tick();assert.equal(writes,2);target=makeSource();listeners.get('style.load')();await tick();assert.equal(writes,3);pending();await flush();c.destroy();assert.equal(listeners.size,0);
 console.log('PASS V10 localities: writes serialize, hide/zoom retains data, style replacement restores source');
}
{
 const {recommendedMapPixelRatio}=load('src/lib/hardware-profile.ts',{window:{addEventListener(){}},navigator:{}},'recommendedMapPixelRatio');const p={logicalProcessors:8,deviceMemoryGb:8,screen:{devicePixelRatio:3.5},gpu:{maxTextureSize:8192}};assert.equal(recommendedMapPixelRatio(p),2);assert.equal(recommendedMapPixelRatio({...p,deviceMemoryGb:3}),1.5);assert.equal(recommendedMapPixelRatio({...p,screen:{devicePixelRatio:1}}),1);console.log('PASS V10 GPU canvas budget respects hardware hints and preserves 1x screens');
}
{
 let auth,timer,userid='user-a',resolveRows;const sent=[];
 const {installNativeAccountNotifications}=load('src/lib/native-account-notifications.ts',{getAtlasAuthIdentity:async()=>userid?{userId:userid}:null,loadAtlasNotifications:()=>new Promise(r=>{resolveRows=r;}),subscribeToAtlasAuth:fn=>{auth=fn;},subscribeToAtlasAccount:()=>{},navigator:{onLine:true},window:{addEventListener(){},setTimeout:fn=>{timer=fn;return 1;},flutter_inappwebview:{callHandler:async(n,p)=>sent.push(p)}}},'installNativeAccountNotifications');
 installNativeAccountNotifications(()=> 'en');timer();await flush();userid='';auth({event:'SIGNED_OUT'});timer();await flush();resolveRows([{id:'a',user_id:'user-a',title_en:'Private',title_ku:'Private',is_read:false,created_at:new Date().toISOString()}]);await flush();timer();await flush();assert.equal(sent.filter(p=>p.items.length).length,0);assert.equal(sent.at(-1).userId,'');console.log('PASS V10 account notifications discard in-flight inbox after logout');
}
