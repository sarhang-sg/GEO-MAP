#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { stripTypeScriptTypes } from "node:module";

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
assert.match(read("public/sw.js"), /const UI_REVISION = "R16-hotfix-3";/);
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
