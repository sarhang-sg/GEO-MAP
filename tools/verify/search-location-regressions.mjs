#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../../', import.meta.url);
function load(path, globals, exports) {
  const source = fs.readFileSync(new URL(path, root), 'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, '');
  const context = vm.createContext(globals);
  vm.runInContext(stripTypeScriptTypes(source, {mode:'transform'}).replace(/\bexport /g, '') + `\nglobalThis.api={${exports}}`, context);
  return context.api;
}
const search = load('src/lib/static-search.ts', {ATLAS_TAXONOMY:[]}, 'normalizeStaticSearch,phoneticSearchGroups,prepareStaticSearchQuery,scoreStaticSearchProfile');
for (const [latin, ku, ar] of [
  ['Victoria','ڤیکتۆریا','فيكتوريا'], ['Cambridge','کامبریج','كامبريدج'],
  ['Sarhang','سەرهەنگ','سرهنگ'], ['London','لەندەن','لندن'],
  ['Duhok','دهۆک','دهوك'], ['Zakho','زاخۆ','زاخو'],
  ['Halabja','هەڵەبجە','حلبجة'], ['Rawanduz','ڕەواندز','رواندوز'],
  ['Qaladiza','قەڵادزێ','قالاديزا'], ['Koya','کۆیا','كويا']
]) {
  const name = search.normalizeStaticSearch(latin);
  const profile = {primary:name,all:name,primaryName:name,allNames:name,phoneticKeys:[...new Set(search.phoneticSearchGroups(name).flat())]};
  for (const term of [latin, ku, ar]) assert.ok(search.scoreStaticSearchProfile(profile,search.prepareStaticSearchQuery(term),'place') > 0, `${latin}: ${term}`);
  assert.ok(search.scoreStaticSearchProfile(profile,search.prepareStaticSearchQuery(latin),'place') > search.scoreStaticSearchProfile(profile,search.prepareStaticSearchQuery(ar),'place'));
}
assert.equal(search.normalizeStaticSearch(' كِرْكُوك ي '), search.normalizeStaticSearch('کرکوک ی'));
assert.ok(search.scoreStaticSearchProfile({primary:'sarhang',all:'sarhang',primaryName:'sarhang',allNames:'sarhang',phoneticKeys:['srhng']}, search.prepareStaticSearchQuery('Sar'),'place')>0);
console.log('PASS generalized Kurdish/Arabic/Latin phonetics, normalization, prefix and exact ranking');
for (const native of [false,true]) {
  let callback, calls=0, oneShots=0, centers=0;
  const gps = load('src/lib/live-location-controller.ts', {distanceMeters:()=>0,window:{__NAV_KURD_FLUTTER__:native},localStorage:{setItem(){}},Date,UI:{en:{locating:'locating',locationReady:'ready',locationDenied:'denied'}}}, 'LiveLocationController');
  const controller = Object.create(gps.LiveLocationController.prototype);
  Object.assign(controller, {geolocation:{watchPosition(fn){calls++;callback=fn;return 1;},getCurrentPosition(){oneShots++;},clearWatch(){}},getLanguage:()=> 'en',watchGeneration:0,watchId:null,requestInFlight:false,lastCoordinate:null,lastPositionAt:0,lastAcceptedPositionTimestamp:0,lastHeading:null,lastHeadingConfidence:0,lastRawCoordinate:null,lastRawPositionAt:0,locationReadyAnnounced:false,
    setFollowEnabled(value){this.followEnabled=value;},setMessage(){},requestOrientationPermission(){},shouldRejectDegradedFix:()=>false,stableCoordinate:coordinate=>({coordinate,rejectedJump:false}),resolveCourseHeading:()=>null,courseHeadingLocked:()=>false,
    show(coordinate){this.lastCoordinate=coordinate;},recenter(){if(this.followEnabled) centers++;}
  });
  controller.locate(); controller.locate();
  assert.equal(calls,1);assert.equal(oneShots,0);
  callback({timestamp:Date.now(),coords:{longitude:44.2,latitude:36.2,accuracy:120,speed:0}});
  assert.equal(centers,1);assert.equal(controller.requestInFlight,false);
  controller.stopFollow();
  callback({timestamp:Date.now(),coords:{longitude:44.2,latitude:36.2,accuracy:80,speed:0}});
  assert.equal(centers,1);
  controller.locate();assert.equal(calls,1);assert.equal(centers,2);
  controller.stopFollow();controller.watchId=null;controller.locate(false);
  assert.equal(controller.followEnabled,false);assert.equal(controller.pendingCameraFocus,false);
  console.log(`PASS ${native?'native-flag':'web'} GPS request sharing, initial/cached centering and manual-pan recovery (mock provider)`);
}
