#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import {
  ROOT, assert, fileExists, importSpecifiers, posixPath, readJson, readText,
  resolveLocalImport, sha256, walk
} from "../lib/project.mjs";

const release = await readJson("release.config.json");
const pkg = await readJson("package.json");
const manifest = await readJson("public/manifest.webmanifest");
assert(pkg.version === release.appVersion, "package.json and release.config.json versions differ.");
assert(manifest.version === release.appVersion, "PWA manifest version differs from release.config.json.");
assert(release.serviceWorkerRelease === release.appVersion, "Service worker release differs from app version.");
assert(/^\d+\.\d+\.\d+$/u.test(release.appVersion), "App version is not semantic.");
assert(release.cacheSchemaVersion >= 90, "Cache schema must invalidate legacy service-worker shells.");
assert(release.offlinePackVersion === "2027.13", "Offline pack identity differs from the current verified map release.");

const isVercelDeploymentBuild = process.env.VERCEL === "1"
  && process.env.NAV_KURD_DEPLOYMENT_BUILD === "1";
const gitIgnoreExists = await fileExists(".gitignore");
const gitIgnore = gitIgnoreExists ? await readText(".gitignore") : "";
const envIgnoreRules = gitIgnore.split(/\r?\n/u)
  .map((line) => line.trim())
  .filter((line) => [".env", ".env*", ".env.*", "!.env.example"].includes(line));
const envExampleExists = await fileExists(".env.example");
const releasePackager = await readText("tools/release/package-release.py");
assert(
  gitIgnoreExists || isVercelDeploymentBuild,
  "Tracked .gitignore is missing outside the Vercel deployment bundle."
);
assert(
  envExampleExists || isVercelDeploymentBuild,
  "Tracked environment template .env.example is missing outside the Vercel deployment bundle."
);
assert(
  !gitIgnoreExists || envIgnoreRules.at(-1) === "!.env.example",
  ".gitignore must re-include .env.example after every .env ignore rule."
);
assert(
  releasePackager.includes("REQUIRED_HIDDEN_SOURCE_FILES={'.env.example','.gitignore'}")
    && releasePackager.includes("missing_hidden"),
  "Release packaging does not fail closed when Vercel metadata is absent."
);

const activeRoots = ["src", "tools", "docs", "api", "public/legal"];
const activeFiles = (await Promise.all(activeRoots.map((path) => walk(resolve(ROOT, path))))).flat();
const revisionName = /(?:^|[-_.])(?:r|rev|revision)\d+(?:[-_.]\d+)*(?:[-_.]|$)/iu;
const obsoleteName = /(?:^|[-_.])(?:old|backup|bak|legacy|changelog|final[-_.]?r\d+)(?:[-_.]|$)/iu;
const forbiddenNames = activeFiles
  .map(posixPath)
  .filter((path) => revisionName.test(basename(path)) || obsoleteName.test(basename(path)));
assert(forbiddenNames.length === 0, `Revision/obsolete filenames remain:\n${forbiddenNames.join("\n")}`);

const codeFiles = activeFiles.filter((path) => /\.(?:ts|tsx|js|mjs)$/u.test(path));
const brokenImports = [];
for (const absolute of codeFiles) {
  const path = posixPath(absolute);
  const source = await readFile(absolute, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (specifier.startsWith(".") && !(await resolveLocalImport(path, specifier))) {
      brokenImports.push(`${path} -> ${specifier}`);
    }
  }
}
assert(brokenImports.length === 0, `Broken local imports:\n${brokenImports.join("\n")}`);

const sourceFiles = (await walk(resolve(ROOT, "src"))).filter((path) => /\.ts$/u.test(path));
const sourceSet = new Set(sourceFiles.map(posixPath));
const graph = new Map();
for (const absolute of sourceFiles) {
  const path = posixPath(absolute);
  const source = await readFile(absolute, "utf8");
  const deps = [];
  for (const specifier of importSpecifiers(source)) {
    const resolved = await resolveLocalImport(path, specifier);
    if (resolved && sourceSet.has(resolved)) deps.push(resolved);
  }
  graph.set(path, deps);
}
const entrypoints = ["src/bootstrap.ts", "src/pwa-register.ts", "src/workers/search.worker.ts"];
const reachable = new Set();
const stack = entrypoints.filter((path) => sourceSet.has(path));
while (stack.length) {
  const current = stack.pop();
  if (!current || reachable.has(current)) continue;
  reachable.add(current);
  for (const dep of graph.get(current) ?? []) stack.push(dep);
}
const deadModules = [...sourceSet].filter((path) => !reachable.has(path) && path !== "src/vite-env.d.ts");
assert(deadModules.length === 0, `Unreachable TypeScript modules:\n${deadModules.join("\n")}`);

const runtimeTextFiles = [
  ...(await walk(resolve(ROOT, "src"))).filter((path) => /\.(?:ts|css)$/u.test(path)),
  ...(await walk(resolve(ROOT, "docs"))).filter((path) => /\.(?:md|txt)$/u.test(path)),
  ...(await walk(resolve(ROOT, "api"))).filter((path) => /\.(?:js|mjs)$/u.test(path)),
  resolve(ROOT, "public/sw.js"),
  resolve(ROOT, "public/pwa-init.js"),
  resolve(ROOT, "README.md"),
  resolve(ROOT, "TERMUX.sh"),
  ...(envExampleExists ? [resolve(ROOT, ".env.example")] : []),
  resolve(ROOT, "release.config.json"),
];
const staleRuntimeText = /(?:ROOT[-_ ]?CLEAN|runtime-sprite-r\d|verified-r\d|2026-07-19-nav-kurd-kirkuk-language-icon-r26-2027|\bR(?:43|46|47|48)(?:\D|$)|\b7\.1\.[0-4]\b)/iu;
const staleRuntimeFiles = [];
for (const absolute of runtimeTextFiles) {
  const source = await readFile(absolute, "utf8");
  if (staleRuntimeText.test(source)) staleRuntimeFiles.push(posixPath(absolute));
}
assert(staleRuntimeFiles.length === 0, `Superseded runtime text remains:\n${staleRuntimeFiles.join("\n")}`);

const tokenCss = await readText("src/styles/tokens.css");
const zDefinitions = [...tokenCss.matchAll(/(--z-[a-z0-9-]+)\s*:\s*(-?\d+)\s*;/gu)]
  .map((match) => ({ token: match[1], value: Number(match[2]) }));
const definedZ = new Set(zDefinitions.map(({ token }) => token));
assert(definedZ.size >= 20, "Central z-index token set is incomplete.");
assert(zDefinitions.every(({ value }) => Number.isInteger(value) && value >= 0), "z-index tokens must start at zero and use non-negative integers only.");
for (const prefix of ["--z-local-", "--z-"]) {
  const values = zDefinitions.filter(({ token }) => prefix === "--z-" ? !token.startsWith("--z-local-") : token.startsWith(prefix)).map(({ value }) => value);
  assert(values.length === new Set(values).size, `Duplicate z-index values exist in ${prefix === "--z-" ? "application" : "local"} scope.`);
}
const localStackValues = zDefinitions
  .filter(({ token }) => token.startsWith("--z-local-"))
  .map(({ value }) => value)
  .sort((left, right) => left - right);
assert(localStackValues.every((value, index) => value === index), "Local z-index stack must be contiguous from zero.");
const applicationStackValues = zDefinitions
  .filter(({ token }) => !token.startsWith("--z-local-"))
  .map(({ value }) => value)
  .sort((left, right) => left - right);
assert(applicationStackValues[0] === 10 && applicationStackValues.at(-1) === 250, "Application z-index stack must stay inside the documented 10–250 bands.");
const styleFiles = (await walk(resolve(ROOT, "src/styles"))).filter((path) => path.endsWith(".css"));
const styleEntry = await readText("src/styles.css");
const importedStyles = new Set([...styleEntry.matchAll(/@import\s+["']\.\/(styles\/[^"']+\.css)["']/gu)].map((match) => `src/${match[1]}`));
const stylePaths = new Set(styleFiles.map(posixPath));
const unownedStyles = [...stylePaths].filter((path) => !importedStyles.has(path));
const missingStyles = [...importedStyles].filter((path) => !stylePaths.has(path));
assert(unownedStyles.length === 0 && missingStyles.length === 0, `Stylesheet ownership mismatch: unowned=${unownedStyles.join(", ")} missing=${missingStyles.join(", ")}`);
let rootOwnerCount = 0;
for (const absolute of styleFiles) {
  const source = await readFile(absolute, "utf8");
  if (/(?:^|\})\s*:root\s*\{/mu.test(source)) rootOwnerCount += 1;
}
assert(rootOwnerCount === 1 && /:root\s*\{/u.test(tokenCss), "Design tokens do not have one canonical :root owner.");
const zFailures = [];
const usedZ = new Set();
for (const absolute of styleFiles) {
  const path = posixPath(absolute);
  const source = await readFile(absolute, "utf8");
  if (path !== "src/styles/tokens.css") {
    for (const match of source.matchAll(/z-index\s*:\s*([^;}{]+)/gu)) {
      const value = match[1].trim();
      const token = /^var\((--z-[a-z0-9-]+)\)$/u.exec(value)?.[1];
      if (!token) zFailures.push(`${path}: z-index:${value}`);
      else usedZ.add(token);
    }
  }
}
for (const token of usedZ) if (!definedZ.has(token)) zFailures.push(`undefined z-index token ${token}`);
for (const token of definedZ) if (!usedZ.has(token)) zFailures.push(`unused z-index token ${token}`);
assert(zFailures.length === 0, `Non-central or unused z-index values:\n${zFailures.join("\n")}`);

const finalUi = await readText("src/styles/modal-scroll.css");
const appShell = await readText("src/lib/app-shell.ts");
const ownerStudio = await readText("src/lib/owner-studio.ts");
const userStudio = await readText("src/lib/user-contribution-studio.ts");
const mobileDialogLayout = await readText("src/lib/mobile-dialog-layout.ts");
const feedbackStudio = await readText("src/lib/feedback-studio.ts");
const placeDetail = await readText("src/lib/place-detail.ts");
const deviceQa = await readText("src/lib/device-qa.ts");
const dialogCloseIcon = await readText("src/lib/dialog-close-icon.ts");
const luxeUi = await readText("src/styles/luxe-ui.css");
assert(appShell.includes('class="about-dialog__scroll"'), "About/Offline dialog is missing its masked inner scroll viewport.");
assert(ownerStudio.includes('class="owner-studio__scroll"'), "Owner studio is missing its masked inner scroll viewport.");
assert(feedbackStudio.includes('class="feedback-studio__scroll"'), "Feedback studio is missing its masked inner scroll viewport.");
assert(finalUi.includes('.owner-studio__scroll') && finalUi.includes('.feedback-studio__scroll'), "Modal inset scrollbar ownership is missing.");
assert(finalUi.includes('.map-sheet::-webkit-scrollbar') && finalUi.includes('scrollbar-width: none !important'), "Main map card scrollbar suppression is missing.");
assert(finalUi.includes('.map-shell.is-about-open .feedback-quick-button'), "Feedback quick control is not hidden behind the About/Offline modal.");
assert(finalUi.includes('filter: none !important') && finalUi.includes('.map-left-control-rail__extras .map-3d-button'), "3D/Hide control filter normalization is missing.");
assert(
  appShell.includes('assets/android-app-icon.png')
    && await fileExists("public/assets/android-app-icon.png"),
  "The Android download card is missing the approved launcher artwork."
);
assert(
  dialogCloseIcon.includes('class="dialog-close-icon"')
    && dialogCloseIcon.includes('d="m7 7 10 10M17 7 7 17"')
    && [appShell, ownerStudio, userStudio, feedbackStudio, placeDetail, deviceQa]
      .every((source) => source.includes("dialogCloseIcon()")),
  "Every modal must use the canonical Info close icon."
);
assert(
  /\.about-dialog__close-row\s*\{[\s\S]*?position:\s*relative;[\s\S]*?background:\s*transparent;[\s\S]*?backdrop-filter:\s*none;/u.test(luxeUi),
  "About close row must not render a sticky dark strip or blur."
);
assert(
  appShell.includes('assets/native/info.svg')
    && appShell.includes('assets/native/clear.svg')
    && appShell.includes('assets/native/settings.svg')
    && await fileExists("public/assets/native/info.svg")
    && await fileExists("public/assets/native/clear.svg")
    && await fileExists("public/assets/native/settings.svg"),
  "Native app panel does not use the approved info/clear/settings icon assets."
);
assert(
  /openNewPlace\(\): void \{[\s\S]*?this\.view = "editor";\s*this\.choice = null;[\s\S]*?this\.render\(\);/.test(userStudio)
    && /if \(action === "add"\) \{ this\.openNewPlace\(\); return; \}/.test(userStudio)
    && /async openNewPlace\(\): Promise<void> \{[\s\S]*?this\.view = "editor";\s*this\.choiceKind = null;[\s\S]*?this\.render\(\);/.test(ownerStudio)
    && /if \(action === "add"\) \{ this\.choiceKind = null;[\s\S]*?this\.view = "editor";[\s\S]*?this\.render\(\); return; \}/.test(ownerStudio),
  "New-place flows must open the editor form directly for both user and owner studios."
);
assert(
  userStudio.includes("restoreEditorAfterPhotoPicker")
    && userStudio.includes("armPhotoPickerFallbackRestore")
    && userStudio.includes('window.addEventListener("nav-kurd:native-resume"')
    && userStudio.includes('this.photoPickerScroll = null')
    && !userStudio.includes('content.dataset.nativePickerRestored')
    && /try \{[\s\S]*?await normalizeAtlasImageFile\(selected\)[\s\S]*?\} finally \{[\s\S]*?restoreEditorAfterPhotoPicker\(selectionEpoch\)/.test(userStudio)
    && userStudio.includes("data-user-photo-preview")
    && !userStudio.includes("waitForUsableVisualViewport")
    && mobileDialogLayout.includes("restoreClampedScroll")
    && !mobileDialogLayout.includes("minimumUsableHeight"),
  "Mobile gallery selection must recover every picker exit without remounting the form."
);
const zValue = (token) => zDefinitions.find((entry) => entry.token === token)?.value ?? -1;
assert(zValue("--z-route-prompt") > zValue("--z-sheet") && zValue("--z-route-prompt") > zValue("--z-controls-raised"), "Destination/add-place prompt must stack above map cards and controls.");

const mainSource = await readText("src/main.ts");
const bootstrapSource = await readText("src/bootstrap.ts");
const atlasPlacesSource = await readText("src/lib/atlas-places.ts");
const assetLinksSource = await readText("api/assetlinks.js");
assert(
  bootstrapSource.includes('new URL("navkurd://auth/callback")')
    && bootstrapSource.includes('const nativeHandoffMarker = "nav_kurd_native_auth"')
    && bootstrapSource.includes('current.searchParams.get(nativeHandoffMarker) !== "1"')
    && bootstrapSource.includes("handoffTarget")
    && atlasPlacesSource.includes('nativeRedirect.searchParams.set("nav_kurd_native_auth", "1")'),
  "Android OAuth callback handoff is incomplete or can capture ordinary mobile-browser sign-in."
);
assert(atlasPlacesSource.includes('flowType: "pkce"') && atlasPlacesSource.includes("skipBrowserRedirect: isFlutterAndroid") && atlasPlacesSource.includes("window.navKurdAndroid.openExternal(authUrl)"), "Google OAuth is not using the native PKCE/browser bridge.");
assert(assetLinksSource.includes("RELEASE_FINGERPRINT") && assetLinksSource.includes("delegate_permission/common.handle_all_urls"), "Android App Link certificate fallback is missing.");
const overlayLayout = await readText("src/lib/map-overlay-layout-controller.ts");
const attributionCss = await readText("src/styles/interaction-attribution.css");
assert(appShell.includes('id="mapAttributionSlot"') && appShell.includes('class="map-sheet__attribution-slot"'), "Map card is missing its attribution slot.");
assert(mainSource.includes('toggle.dataset.compactLabel = "DEVELOPER: SARHANG IO"') && mainSource.includes("attribution.open = !this.sheetCollapsed") && mainSource.includes("mapAttributionSlot.append(attribution)"), "Collapsed/expanded attribution is not owned by the map card.");
assert(overlayLayout.includes("mobileSheetHeight") && overlayLayout.includes("MOBILE_COLLAPSED_SHEET_HEIGHT = 116") && overlayLayout.includes("MOBILE_EXPANDED_SHEET_VIEWPORT_RATIO") && !overlayLayout.includes("attributionHost") && !overlayLayout.includes("--nav-kurd-credit-bottom"), "Overlay layout still owns detached attribution geometry.");
assert(attributionCss.includes(".map-sheet__attribution-slot") && attributionCss.includes("content: attr(data-compact-label)") && attributionCss.includes(".map-sheet:not(.is-collapsed)") && attributionCss.includes(".maplibregl-ctrl-bottom-left") && attributionCss.includes("display: none !important;"), "Card-owned attribution presentation contract is incomplete.");

const prohibitedRuntimePatterns = [
  [/(?:window\.)?location\.reload\s*\(/u, "document reload"],
  [/\beval\s*\(/u, "eval"],
  [/\bnew\s+Function\s*\(/u, "dynamic Function constructor"],
  [/document\.write\s*\(/u, "document.write"]
];
const prohibitedRuntimeHits = [];
for (const absolute of sourceFiles) {
  const path = posixPath(absolute);
  const source = await readFile(absolute, "utf8");
  for (const [pattern, label] of prohibitedRuntimePatterns) {
    if (pattern.test(source)) prohibitedRuntimeHits.push(`${path}: ${label}`);
  }
}
assert(prohibitedRuntimeHits.length === 0, `Unsafe or reload-based runtime code remains:
${prohibitedRuntimeHits.join("\n")}`);

const duplicateScope = ["src", "tools", "docs", "api"];
const duplicateFiles = (await Promise.all(duplicateScope.map((path) => walk(resolve(ROOT, path))))).flat()
  .filter((path) => !/\.(?:png|jpe?g|webp|gif|ttf|woff2?|pmtiles)$/iu.test(path));
const hashes = new Map();
for (const file of duplicateFiles) {
  const body = await readFile(file);
  if (body.length === 0) continue;
  const hash = sha256(body);
  const group = hashes.get(hash) ?? [];
  group.push(posixPath(file));
  hashes.set(hash, group);
}
const duplicates = [...hashes.values()].filter((group) => group.length > 1);
assert(duplicates.length === 0, `Exact duplicate source files:\n${duplicates.map((g) => g.join(" = ")).join("\n")}`);

for (const obsoleteDoc of ["INSTALL_TERMUX.md", "QA_REPORT.md", "docs/README.md", "docs/QA.md"]) {
  assert(!(await fileExists(obsoleteDoc)), `Duplicate or superseded documentation remains: ${obsoleteDoc}`);
}
assert(!(await fileExists(".node-version")), "Duplicate Node version file .node-version remains; .nvmrc is canonical.");
console.log(`PASS source architecture: ${sourceFiles.length} TypeScript modules reachable, ${styleFiles.length} style modules, ${definedZ.size} centralized stack tokens.`);
