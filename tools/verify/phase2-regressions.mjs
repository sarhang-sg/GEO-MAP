#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { stripTypeScriptTypes } from "node:module";
import postcss from "postcss";

const root = new URL("../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");
function loadSearch() {
  const source = read("src/lib/static-search.ts").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const context = vm.createContext({ ATLAS_TAXONOMY: [] });
  vm.runInContext(
    stripTypeScriptTypes(source, { mode: "transform" }).replace(/\bexport /g, "")
      + "\nglobalThis.searchApi={normalizeStaticSearch,phoneticSearchGroups,prepareStaticSearchQuery,scoreStaticSearchProfile}",
    context
  );
  return context.searchApi;
}

function loadKurdishPlaceLabels() {
  const taxonomySource = read("src/lib/atlas-taxonomy.ts").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const taxonomyContext = vm.createContext({});
  vm.runInContext(
    stripTypeScriptTypes(taxonomySource, { mode: "transform" }).replace(/\bexport /g, "")
      + "\nglobalThis.taxonomyApi={ATLAS_TAXONOMY}",
    taxonomyContext
  );
  const source = read("src/lib/map-language.ts").replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const context = vm.createContext({
    ATLAS_TAXONOMY: taxonomyContext.taxonomyApi.ATLAS_TAXONOMY,
    POI_NAME_PROPERTY_KEYS: [],
    atlasPlaceTypeLabel: () => ""
  });
  vm.runInContext(
    stripTypeScriptTypes(source, { mode: "transform" }).replace(/\bexport /g, "")
      + "\nglobalThis.languageApi={toKurdishScript,localizeNameValue}",
    context
  );
  return context.languageApi;
}

const search = loadSearch();
const kurdishLabels = loadKurdishPlaceLabels();
const payload = JSON.parse(read("public/data/kri/kri-search-runtime-ku.json"));
assert.equal(payload.schema, "NAV KURD compact search runtime v1");
assert.equal(payload.items.length, payload.records);

const runtimeCases = [
  ["VICToRIA beauty", "ڤیکتۆریا", "فيكتوريا"],
  ["Cambridge", "کامبریج", "كامبريدج"],
  ["Sarhang", "سەرهەنگ", "سرهنگ"],
  ["London Street", "لەندەن", "لندن"],
  ["Duhok Center", "دهۆک", "دهوك"],
  ["Gali Zakho", "زاخۆ", "زاخو"],
  ["Halabja Technical College", "هەڵەبجە", "حلبجة"],
  ["Rawanduz canyon view", "ڕەواندز", "رواندوز"],
  ["Qaladiza Substation", "قەڵادزێ", "قالاديزا"],
  ["Hawler-Koya road", "کۆیا", "كويا"]
];
for (const [target, ku, ar] of runtimeCases) {
  const row = payload.items.find((item) => item[0] === target);
  assert.ok(row, `real runtime row is missing: ${target}`);
  const name = search.normalizeStaticSearch(row[0]);
  const profile = {
    primary: name,
    all: name,
    primaryName: name,
    allNames: name,
    phoneticKeys: [...new Set(search.phoneticSearchGroups(name).flat())]
  };
  for (const query of [ku, ar]) {
    assert.ok(search.scoreStaticSearchProfile(profile, search.prepareStaticSearchQuery(query), "place") > 0, `${target}: ${query}`);
  }
}

const startedAt = performance.now();
let generatedKeys = 0;
for (const row of payload.items) generatedKeys += search.phoneticSearchGroups(String(row[0] ?? "")).flat().length;
const elapsed = performance.now() - startedAt;
const isAndroidTermux = process.platform === "android"
  || String(process.env.PREFIX ?? "").includes("/com.termux/");
const preprocessingBudgetMs = isAndroidTermux ? 12_000 : 5_000;
assert.ok(generatedKeys > payload.items.length / 2, "phonetic preprocessing produced too few keys");
assert.ok(
  elapsed < preprocessingBudgetMs,
  `phonetic preprocessing exceeded ${isAndroidTermux ? "Android/Termux" : "desktop/CI"} worker budget: ${Math.round(elapsed)}ms >= ${preprocessingBudgetMs}ms`
);
console.log(
  `PASS ${runtimeCases.length} real multilingual runtime names; ${payload.items.length} names normalized in ${Math.round(elapsed)}ms (${preprocessingBudgetMs}ms ${isAndroidTermux ? "Android/Termux" : "desktop/CI"} budget)`
);

for (const [sourceName, expected] of [
  ["مدينة هەولێر", "شار هەولێر"],
  ["قرية الوحدة", "گوند الوحدە"],
  ["طريق دهوك - الموصل", "ڕێگا دهوک - الموصل"],
  ["مطار الفاروق العسكري", "فڕۆکەخانە الفاروق سەربازی"],
  ["تل أشور الأثري", "گرد اشور شوێنەواری"],
  ["جبل زردكان", "چیا زردکان"],
  ["وادي زاخو", "دۆڵ زاخو"]
]) {
  assert.equal(kurdishLabels.toKurdishScript(sourceName), expected, sourceName);
}
assert.equal(kurdishLabels.localizeNameValue("مدينة", "ar"), "مدينة", "Arabic mode must remain exact");
assert.equal(kurdishLabels.localizeNameValue("City", "en"), "City", "English mode must remain exact");
console.log("PASS Kurdish place display uses the canonical taxonomy for Arabic place terms without changing Arabic/English modes");

const professional = read("src/styles/nav-kurd-professional.css");
const layout = read("src/styles/layout-runtime.css");
const nativeCss = read("src/styles/native-platform.css");
const luxe = read("src/styles/luxe-ui.css");
const allStyleFiles = fs.readdirSync(new URL("src/styles/", root), { recursive: true })
  .filter((name) => String(name).endsWith(".css"));
const popupOwners = allStyleFiles.filter((name) => read(`src/styles/${name}`).includes(".maplibregl-popup-content"));
assert.deepEqual(popupOwners, ["nav-kurd-professional.css"], "place popup wrapper has more than one CSS owner");
assert.match(professional, /data-ui-mode="light"[^\{]+maplibregl-ctrl-icon[^\{]*\{[^}]*brightness\(0\)/s);
assert.match(professional, /maplibregl-ctrl-group > button:disabled[^\{]+maplibregl-ctrl-icon/s);
assert.match(professional, /maplibregl-ctrl-group > button:where\(:hover, :focus-visible\)/);
assert.match(professional, /maplibregl-ctrl-group > button:active/);
assert.doesNotMatch(layout, /2116px/);
assert.match(layout, /\.map-sheet\.is-collapsed\s*\{[^}]*width:\s*min\(440px/s);
assert.doesNotMatch(luxe, /\.about-dialog__panel\s*\{\s*width:/);
assert.match(nativeCss, /\.native-app-panel__actions button\s*\{[^}]*width:\s*42px[^}]*height:\s*42px/s);

const nativeSource = read("src/lib/native-platform.ts");
assert.match(nativeSource, /nativeClearTransientCache/);
assert.match(nativeSource, /caches\.delete/);
assert.match(nativeSource, /nativeOpenSettings/);
const shellSource = read("src/lib/app-shell.ts");
assert.match(shellSource, /navIcon\("a1"\)/);
assert.match(shellSource, /assets\/icons\/nav-kurd\/a2\.svg/);
assert.match(shellSource, /map-loading__slice"><b data-essential-animation="true">Loading<\/b>/);
assert.match(shellSource, /map-loading__line" data-essential-animation="true"/);
const visualSystem = read("src/styles/map-visual-system.css");
assert.doesNotMatch(visualSystem, /is-runtime-low-power \*::(?:before|after)/);
assert.match(visualSystem, /is-runtime-low-power \*:not\(\[data-essential-animation="true"\]\)::before/);
assert.match(visualSystem, /is-runtime-low-power \*:not\(\[data-essential-animation="true"\]\)::after/);
const typography = read("src/styles/labels-typography.css");
assert.match(typography, /\*:not\(\[data-essential-animation="true"\]\)::before/);
assert.match(typography, /\*:not\(\[data-essential-animation="true"\]\)::after/);
assert.match(read("public/sw.js"), /const UI_REVISION = "R16-hotfix-4";/);
const routingSource = read("src/lib/routing-controller.ts");
assert.match(routingSource, /await this\.requestLocation\(\)/);
assert.match(routingSource, /selectionSerial !== this\.destinationSelectionSerial/);
const healthSource = read("src/lib/app-health.ts");
assert.match(healthSource, /if \(!offline\) this\.setMessage/);
assert.match(healthSource, /offline \? UI\[language\]\.offline : message/);
for (const icon of ["a1.svg", "a2.svg"]) {
  const svg = read(`public/assets/icons/nav-kurd/${icon}`);
  assert.match(svg, /viewBox="0 0 64 64"/);
  assert.doesNotMatch(svg, /<image\b/);
}
for (const icon of ["settings.svg", "clear.svg"]) {
  const svg = read(`public/assets/native/${icon}`);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.doesNotMatch(svg, /<image\b/);
}
console.log("PASS popup/card ownership, desktop widths, zoom states, square native controls, SVG assets and Android loader animation exemption");

// Theme contracts are measured from the production CSS, not a second fixture theme.
const confirmationCss = read("src/styles/interaction-quality.css");
const offlineCss = read("src/styles/visual-system.css");
for (const [selector, owner] of [[".offline-pack-confirm", "interaction-quality.css"], [".offline-map-pack__actions", "visual-system.css"], [".offline-map-pack__track", "visual-system.css"]]) {
  assert.deepEqual(allStyleFiles.filter((name) => read(`src/styles/${name}`).includes(selector)), [owner], `${selector} must have one style owner`);
}
const cssRules = postcss.parse(`${professional}\n${confirmationCss}\n${offlineCss}\n${read("src/styles/map-shell.css")}`);
function declarations(selector) {
  const values = {};
  cssRules.walkRules((rule) => {
    if (rule.selector !== selector) return;
    rule.walkDecls((declaration) => { values[declaration.prop] = declaration.value; });
  });
  return values;
}
function rgb(hex) {
  const full = hex.length === 4 ? hex.slice(1).split("").map((digit) => digit + digit).join("") : hex.slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255);
}
function contrast(a, b) {
  const luminance = (value) => value.map((c) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
    .reduce((sum, c, index) => sum + c * [.2126, .7152, .0722][index], 0);
  const lightness = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lightness[0] + .05) / (lightness[1] + .05);
}
for (const mode of ['html[data-nav-kurd-theme="professional"]', 'html[data-ui-mode="light"]']) {
  const theme = declarations(mode);
  const text = rgb(theme["--nk-text"]);
  const surface = rgb(theme["--nk-surface"]);
  const dangerSurface = rgb("#ff6378").map((channel, index) => channel * .17 + surface[index] * .83);
  for (const background of [surface, rgb(theme["--nk-elevated"]), dangerSurface]) {
    assert.ok(contrast(text, background) >= 4.5, `${mode}: offline text must meet AA contrast`);
  }
  assert.ok(contrast(rgb(theme["--nk-muted"]), surface) >= 4.5, `${mode}: confirmation description contrast`);
}
const primaryActions = declarations(".offline-map-pack__actions #offlinePackDownload,\n.offline-map-pack__actions #offlinePackResume");
for (const color of primaryActions.background.match(/#[0-9a-f]{6}/g)) {
  assert.ok(contrast(rgb(primaryActions.color), rgb(color)) >= 4.5, "download/resume gradient must keep readable white labels");
}
assert.equal(declarations(".offline-pack-confirm__panel h3").color, "inherit");
assert.equal(declarations(".offline-pack-confirm__actions button")["place-items"], "center");
assert.equal(declarations(".offline-map-pack__actions button").color, "var(--nk-text)");
assert.equal(declarations(".offline-map-pack__actions button")["min-height"], "44px");
assert.equal(declarations(".brand-card__logo")["border-radius"], "26%");
assert.equal(declarations('.offline-map-pack[dir="rtl"] .offline-map-pack__track > span')["transform-origin"], "right center");
assert.equal(declarations(".offline-map-pack__track > span").transform, "scaleX(var(--offline-progress, 0))");
assert.match(shellSource, /id="offlinePackStatus" role="status"/);
assert.doesNotMatch(shellSource, /id="offlineMapPack"[^>]+aria-live|data-progress-phase/);
assert.match(confirmationCss, /@media \(prefers-reduced-motion: reduce\)/);
assert.doesNotMatch(confirmationCss, /backdrop-filter/);
console.log("PASS offline actions/confirmation have one CSS owner, light/dark AA text contrast, centered labels, 44px controls, rounded Info logo and reduced-motion support (CSS contracts, not browser layout)");

// Exercise the actual offline controller with controlled DOM/storage providers.
// No real offline files or user data are deleted by this test.
function loadProduction(path, globals, exports) {
  const source = read(path).replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "");
  const context = vm.createContext(globals);
  vm.runInContext(stripTypeScriptTypes(source, { mode: "transform" }).replace(/\bexport /g, "") + `\nglobalThis.api={${exports}}`, context);
  return context.api;
}
const { UI, languageDirection } = loadProduction("src/lib/i18n.ts", {}, "UI,languageDirection");
let testDocument;
class TestElement {
  hidden = false;
  disabled = false;
  text = "";
  textWrites = 0;
  get textContent() { return this.text; }
  set textContent(value) { this.text = value; this.textWrites++; }
  dataset = {};
  attributes = new Map();
  handlers = new Map();
  children = [];
  replacements = 0;
  styles = new Map();
  style = { setProperty: (name, value) => this.styles.set(name, value) };
  addEventListener(type, handler) { this.handlers.set(type, handler); }
  fire(type, event = {}) { if (!this.disabled) this.handlers.get(type)?.(event); }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  replaceChildren(...children) { this.children = children; this.replacements++; }
  append(child) { this.children.push(child); }
  focus() { testDocument.activeElement = this; }
  querySelectorAll() { return []; }
}
const ids = [...shellSource.matchAll(/id="(offline(?:MapPack|Pack)[^"]*)"/g)].map((match) => match[1]);
const elements = new Map(ids.map((id) => [id, new TestElement()]));
const element = (id) => elements.get(id);
const backdrop = new TestElement();
element("offlinePackProgress").parentElement = new TestElement();
element("offlinePackDeleteConfirm").hidden = true;
element("offlinePackDeleteConfirm").querySelectorAll = () => [element("offlinePackDeleteConfirmCancel"), backdrop];
const frames = [];
let formatterCount = 0;
testDocument = new TestElement();
testDocument.body = new TestElement();
testDocument.querySelector = (selector) => element(selector.slice(1));
testDocument.createElement = () => new TestElement();
const { OfflineMapPackUiController } = loadProduction("src/lib/offline-map-ui.ts", {
  UI, languageDirection, document: testDocument, HTMLElement: TestElement,
  requestAnimationFrame: (callback) => frames.push(callback),
  appUrl: (path) => `/${path}`,
  window: { setTimeout: () => 1, clearTimeout() {} },
  Intl: { NumberFormat: class { constructor(locale, options) { formatterCount++; return new Intl.NumberFormat(locale, options); } } }
}, "OfflineMapPackUiController");
let language = "ku", publish, finishDelete, rejectDelete;
let downloadCalls = 0, pauseCalls = 0, deleteCalls = 0;
let snapshot = { status: "paused", progress: .3, downloadedBytes: 30, totalBytes: 100, persisted: true, storageAvailableBytes: 200, error: null };
const emit = (status = snapshot.status) => { snapshot = { ...snapshot, status }; publish(snapshot); };
const manager = {
  snapshot: () => snapshot,
  subscribe(listener) { publish = listener; listener(snapshot); },
  download() { downloadCalls++; emit("downloading"); return Promise.resolve(); },
  pause() { pauseCalls++; emit("paused"); },
  delete() { deleteCalls++; return new Promise((resolve, reject) => { finishDelete = () => { emit("idle"); resolve(); }; rejectDelete = reject; }); }
};
const controller = new OfflineMapPackUiController({ manager, getLanguage: () => language });
const flushFrames = () => { for (const frame of frames.splice(0)) frame(); };
for (let i = 0; i < 1000; i++) emit();
assert.equal(element("offlinePackDelete").replacements, 1, "progress must not recreate delete artwork");
assert.equal(formatterCount, 1, "progress must reuse number formatters");
assert.equal(element("offlinePackStatus").textWrites, 1, "progress must not announce unchanged status repeatedly");
for (const [progress, expected] of [[-.1, "0"], [0, "0"], [.3, "0.3"], [1, "1"], [1.5, "1"]]) {
  snapshot = { ...snapshot, progress };
  emit();
  assert.equal(element("offlinePackProgress").styles.get("--offline-progress"), expected);
  assert.equal(element("offlinePackProgress").parentElement.getAttribute("aria-valuenow"), String(Number(expected) * 100));
}
const cancel = element("offlinePackDeleteConfirmCancel"), proceed = element("offlinePackDeleteConfirmProceed"), dialog = element("offlinePackDeleteConfirm");
for (language of ["ku", "ar", "en"]) {
  controller.refreshLanguage();
  element("offlinePackDelete").focus();
  element("offlinePackDelete").fire("click");
  flushFrames();
  assert.equal(dialog.hidden, false);
  assert.equal(dialog.dir, languageDirection(language));
  assert.equal(cancel.textContent, UI[language].offlinePackDeleteConfirmCancel);
  assert.equal(proceed.textContent, UI[language].offlinePackDeleteConfirmAction);
  assert.equal(proceed.children.length, 0, "both confirmation actions must be visible text, not a hidden icon label");
  testDocument.fire("keydown", { key: "Tab", preventDefault() {} });
  assert.equal(testDocument.activeElement, proceed);
  testDocument.fire("keydown", { key: "Tab", shiftKey: true, preventDefault() {} });
  assert.equal(testDocument.activeElement, cancel);
  cancel.fire("click");
  assert.equal(dialog.hidden, true);
  assert.equal(testDocument.activeElement, element("offlinePackDelete"));
}
assert.equal(formatterCount, 3);
assert.equal(deleteCalls, 0, "cancel must never delete");
element("offlinePackResume").fire("click");
assert.equal(element("offlinePackPause").hidden, false);
element("offlinePackPause").fire("click");
assert.equal(downloadCalls, 1);
assert.equal(pauseCalls, 1);
element("offlinePackDelete").fire("click");
cancel.fire("click");
const returnFocus = testDocument.activeElement;
flushFrames();
assert.equal(testDocument.activeElement, returnFocus, "a stale opening frame must not refocus the closed dialog");
element("offlinePackDelete").fire("click");
flushFrames();
for (let i = 0; i < 30; i++) proceed.fire("click");
assert.equal(deleteCalls, 1);
assert.equal(proceed.disabled, true);
assert.equal(cancel.disabled, true);
assert.equal(dialog.getAttribute("aria-busy"), "true");
finishDelete();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(dialog.hidden, true);
assert.equal(testDocument.activeElement, element("offlinePackDownload"));
element("offlinePackDownload").fire("click");
assert.equal(downloadCalls, 2);
emit("error");
element("offlinePackDelete").fire("click");
flushFrames();
proceed.fire("click");
rejectDelete(new Error("Controlled storage failure"));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(dialog.hidden, false);
assert.equal(element("offlinePackDeleteConfirmMessage").dataset.state, "error");
assert.equal(element("offlinePackDeleteConfirmMessage").textContent, UI.en.offlinePackDeleteFailed);
assert.equal(proceed.disabled, false);
assert.equal(cancel.disabled, false);
testDocument.fire("keydown", { key: "Escape", preventDefault() {} });
assert.equal(dialog.hidden, true);
console.log("PASS actual offline UI controller: localized text actions, keyboard focus, cancel/confirm, single delete under repeated clicks, download/pause/resume, error recovery and 1000 progress updates without icon/formatter churn (controlled providers)");
