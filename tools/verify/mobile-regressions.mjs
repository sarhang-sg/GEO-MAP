#!/usr/bin/env node
// Deterministic event/state regression tests. No account, network or upload.
// These exercise production methods, but do not emulate an OEM compositor.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { stripTypeScriptTypes } from "node:module";

const root = new URL("../../", import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, root), "utf8");
let passed = 0;
const test = async (name, run) => { await run(); passed++; console.log(`PASS ${name}`); };
class Events {
  listeners = new Map();
  addEventListener(name, fn) { const list = this.listeners.get(name) ?? []; list.push(fn); this.listeners.set(name, list); }
  emit(name, fields = {}) { const e = {preventDefault() {}, ...fields}; for (const fn of this.listeners.get(name) ?? []) fn(e); }
}
function environment(pointer = true) {
  let now = 0, serial = 0;
  const timers = new Map();
  const window = new Events();
  const document = new Events();
  document.hidden = false;
  document.visibilityState = "visible";
  window.PointerEvent = pointer ? function PointerEvent() {} : undefined;
  window.setTimeout = (fn, delay) => { const id = ++serial; timers.set(id, {fn, at: now + delay}); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  const advance = (ms) => { now += ms; for (const [id,timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } };
  return {window,document,performance:{now:()=>now},advance};
}
function holdHarness(pointer = true) {
  const env = environment(pointer), canvas = new Events(), calls = [];
  let enabled = true, guard = 0;
  const context = vm.createContext({...env});
  vm.runInContext(stripTypeScriptTypes(read("src/lib/map-long-press.ts")).replace(/export /g, "") + "\nglobalThis.install = installMapLongPress;", context);
  context.install(canvas, {isEnabled:()=>enabled,onHold:(point)=>calls.push({...point}),suppressClickUntil:(at)=>guard=at});
  const down = (extra = {}) => canvas.emit("pointerdown", {pointerId:1,isPrimary:true,button:0,clientX:120,clientY:200,...extra});
  return {...env,canvas,calls,down,guard:()=>guard,disable:()=>enabled=false};
}
await test("touch hold opens once and release after 3 seconds keeps the prompt", () => {
  const h = holdHarness(); h.down(); h.advance(559); assert.equal(h.calls.length,0); h.advance(1); assert.equal(h.calls.length,1);
  h.canvas.emit("contextmenu",{clientX:120,clientY:200}); assert.equal(h.calls.length,1);
  h.advance(3000); h.window.emit("pointerup",{pointerId:1}); assert.ok(h.guard()>h.performance.now());
});
await test("drag, pinch, cancellation, hidden page and picker mode do not create pins", () => {
  for (const cancel of [h=>h.window.emit("pointermove",{pointerId:1,clientX:145,clientY:200}),h=>h.down({pointerId:2,isPrimary:false}),h=>h.window.emit("pointercancel",{pointerId:1}),h=>{h.document.hidden=true;h.document.emit("visibilitychange");},h=>h.disable()]) {
    const h=holdHarness(); h.down(); cancel(h); h.advance(1000); assert.equal(h.calls.length,0);
  }
});
await test("short tap stays a tap; right-click and pre-timer contextmenu open once", () => {
  const h=holdHarness();h.down();h.advance(120);h.window.emit("pointerup",{pointerId:1});h.advance(1000);assert.equal(h.calls.length,0);
  h.canvas.emit("contextmenu",{clientX:80,clientY:90});assert.equal(h.calls.length,1);
  const j=holdHarness();j.down();j.advance(400);j.canvas.emit("contextmenu",{clientX:120,clientY:200});j.advance(1000);assert.equal(j.calls.length,1);
});
await test("touch-only fallback works without PointerEvent", () => {
  const h=holdHarness(false);h.canvas.emit("touchstart",{touches:[{identifier:8,clientX:50,clientY:70}]});h.advance(560);assert.equal(h.calls.length,1);
  h.advance(1500);h.window.emit("touchend");assert.ok(h.guard()>h.performance.now());
});

const studioSource = read("src/lib/user-contribution-studio.ts");
const classSource = stripTypeScriptTypes(studioSource.slice(studioSource.indexOf("export class UserContributionStudio")), {mode:"transform"}).replace("export class", "class");
function pickerHarness() {
  const env=environment(), context=vm.createContext({...env,URL,ATLAS_MEDIA_POLICY:{maxBytes:25*1024*1024},formatFileSize:n=>`${n}`,atlasErrorMessage:e=>e.message});
  let mounts=0, syncs=0, restored=null;
  context.restoreClampedScroll=(_host,positions)=>restored=positions;
  context.normalizeAtlasImageFile=async file=>file;
  context.prepareAtlasImage=async file=>({file,compressed:false,outputBytes:file.size});
  vm.runInContext(classSource+"\nglobalThis.Studio = UserContributionStudio;",context);
  const s=Object.create(context.Studio.prototype);
  const input={files:[],disabled:false,value:""}, form={typed:"هەڵەبجە"};
  Object.assign(s,{view:"editor",photoSelectionEpoch:7,photoPickerActive:true,photoProcessing:false,photoPickerReleaseTimer:null,photoPickerScroll:{panel:440,content:0},host:{hidden:false,querySelector:selector=>selector==="[data-user-photo-input]"?input:null},pendingPhotoFile:null,photoPreviewUrl:null,message:"",busy:false});
  s.copy=()=>({photoCompressing:"Processing",photoCompressed:"Ready"});
  s.captureEditorDraft=()=>{};s.validatePhoto=()=>true;s.updateUploadProgress=()=>{};
  s.syncPhotoSelectionUi=()=>{syncs++;input.disabled=s.photoProcessing;};s.render=()=>{mounts++;throw Error("Unexpected form remount");};
  return {...env,context,s,input,form,mounts:()=>mounts,syncs:()=>syncs,restored:()=>restored};
}
await test("cancel/back preserves form and existing selected image without remount", () => {
  const h=pickerHarness(), old=new File(["old"],"old.png",{type:"image/png"});h.s.pendingPhotoFile=old;
  h.s.restoreEditorAfterPhotoPicker(7);assert.equal(h.s.photoPickerActive,false);assert.equal(h.s.pendingPhotoFile,old);assert.equal(h.form.typed,"هەڵەبجە");assert.equal(h.mounts(),0);assert.equal(h.restored()[0].value,440);
});
await test("selected file retains preview and unlocks after processing", async () => {
  const h=pickerHarness(),file=new File(["image"],"picked.png",{type:"image/png"});h.input.files=[file];
  await h.s.handlePhotoSelection(h.input);assert.equal(h.s.pendingPhotoFile,file);assert.ok(h.s.photoPreviewUrl.startsWith("blob:"));assert.equal(h.s.photoProcessing,false);assert.equal(h.s.photoPickerActive,false);assert.equal(h.mounts(),0);URL.revokeObjectURL(h.s.photoPreviewUrl);
});
await test("normalization rejection always restores the form", async () => {
  const h=pickerHarness();h.input.files=[new File(["x"],"bad.png")];h.context.normalizeAtlasImageFile=async()=>{throw Error("Provider stream closed");};
  await h.s.handlePhotoSelection(h.input);assert.equal(h.s.message,"Provider stream closed");assert.equal(h.s.photoProcessing,false);assert.equal(h.s.photoPickerActive,false);assert.equal(h.input.disabled,false);assert.equal(h.mounts(),0);
});
await test("change while hidden unlocks and scroll is restored on resume", async () => {
  const h=pickerHarness();h.document.visibilityState="hidden";h.s.restoreEditorAfterPhotoPicker(7);assert.equal(h.s.photoPickerActive,false);assert.ok(h.s.photoPickerScroll);
  h.document.visibilityState="visible";h.s.armPhotoPickerFallbackRestore();assert.equal(h.s.photoPickerScroll,null);assert.equal(h.mounts(),0);
});
await test("missing cancel uses fallback; a late change still reaches the same input", async () => {
  const h=pickerHarness();h.s.armPhotoPickerFallbackRestore();h.advance(1100);assert.equal(h.s.photoPickerActive,false);
  const file=new File(["late"],"late.png",{type:"image/png"});h.input.files=[file];await h.s.handlePhotoSelection(h.input);assert.equal(h.s.pendingPhotoFile,file);assert.equal(h.mounts(),0);URL.revokeObjectURL(h.s.photoPreviewUrl);
});
await test("stale picker callbacks cannot release a newer selection", () => {
  const h=pickerHarness();h.s.restoreEditorAfterPhotoPicker(6);assert.equal(h.s.photoPickerActive,true);assert.equal(h.syncs(),0);
});
await test("mobile layout uses a visible input hit area and a single panel scroller", () => {
  assert.match(read("src/styles/layout-detail.css"),/\.maplibregl-canvas\s*\{\s*touch-action:\s*none/);
  const css=read("src/styles/modal-scroll.css");assert.match(css,/\(pointer:coarse\)/);assert.match(css,/overflow-y: auto !important/);assert.match(css,/\.user-contrib__content\s*\{\s*overflow: visible/);
  const fileCss=read("src/styles/user-contribution.css").match(/\.user-contrib__file-input\s*\{([^}]+)\}/)[1];assert.match(fileCss,/width: 100%/);assert.doesNotMatch(fileCss,/clip:|margin: -1px/);
  assert.match(studioSource,/<label class="user-contrib__file-picker"[^\n]+<input[^\n]+data-user-photo-input[^\n]+<\/label>/);
});
console.log(`PASS ${passed} mobile regression groups (event/state and source contracts; not an on-device test).`);
