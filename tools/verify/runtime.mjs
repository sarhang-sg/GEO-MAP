#!/usr/bin/env node
import { assert, fileExists, fileMeta, readJson, readText } from "../lib/project.mjs";

const release = await readJson("release.config.json");
const manifest = await readJson("public/manifest.webmanifest");
const offline = await readJson("public/offline-manifest.json");
const androidRelease = await readJson("public/releases/latest.json");
const sw = await readText("public/sw.js");
const pwaInit = await readText("public/pwa-init.js");
const indexHtml = await readText("index.html");
const offlineBuilder = await readText("tools/build/build-offline-runtime.mjs");
const lifecycle = await readText("src/lib/app-lifecycle-controller.ts");
const main = await readText("src/main.ts");
const scheduler = await readText("src/lib/map-animation-scheduler.ts");
const overlay = await readText("src/lib/map-overlay-layout-controller.ts");
const leftRail = await readText("src/lib/map-left-control-rail.ts");
const tutorial = await readText("src/lib/tutorial-controller.ts");
const presence = await readText("src/lib/realtime-presence-controller.ts");
const shell = await readText("src/lib/app-shell.ts");
const layout = await readText("src/styles/layout-runtime.css");
const loader = await readText("src/styles/components/loader.css");
const base = await readText("src/styles/base.css");
const userContribution = await readText("src/lib/user-contribution-studio.ts");
const mobileDialogLayout = await readText("src/lib/mobile-dialog-layout.ts");
const userContributionStyles = await readText("src/styles/user-contribution.css");
const controlRail = await readText("src/styles/components/map-control-rail.css");
const surfaceState = await readText("src/styles/components/map-surface-state.css");
const feedback = await readText("src/lib/feedback-studio.ts");
const visual = await readText("src/styles/visual-system.css");
const layers = await readText("src/lib/kri-layer-installer.ts");
const routing = await readText("src/lib/routing-controller.ts");
const atlasPlaces = await readText("src/lib/atlas-places.ts");
const localityViewport = await readText("src/lib/locality-viewport-source.ts");
const gps = await readText("src/lib/live-location-controller.ts");
const offlinePack = await readText("src/lib/offline-map-pack.ts");
const hardware = await readText("src/lib/hardware-profile.ts");
const sprite = await readJson("public/assets/icons/atlas/runtime-sprite/nav-kurd-poi-runtime.json");

assert(manifest.version === release.appVersion, "PWA version mismatch.");
assert(manifest.id === "./" && manifest.scope === "./", "PWA scope is not deployment-safe.");
assert(manifest.display_override?.includes("window-controls-overlay") && manifest.display_override?.includes("tabbed"), "Advanced desktop display modes are missing.");
assert(manifest.edge_side_panel?.preferred_width >= 376, "Edge side-panel manifest capability is missing.");
assert(manifest.scope_extensions?.some((entry) => entry.type === "origin" && entry.origin === "https://geo-map-two.vercel.app"), "Previous production origin is not a valid PWA scope extension.");
assert(offline.release === release.appVersion, "Offline manifest version mismatch.");
assert(indexHtml.includes('<script src="%BASE_URL%pwa-init.js"></script>'), "Early service-worker bootstrap is not loaded from HTML.");
assert(pwaInit.includes("navigator.serviceWorker.register") && pwaInit.includes('new URL("sw.js", scriptUrl)'), "Early service-worker registration is incomplete.");
assert(offlineBuilder.includes('"pwa-init.js"'), "Early service-worker bootstrap is not in the atomic offline shell.");
assert(sw.includes("__KRI_RELEASE_ID__") && sw.includes("__KRI_PRECACHE__"), "Service worker build placeholders are incomplete.");
assert(sw.includes("isReleaseBinaryRequest") && sw.includes("isPrivateOrMutableRequest"), "Service worker can cache installers or private API responses.");
assert(!/LEGACY_VIEWPORT|isLegacyViewport|canonicalViewportShardRequest/u.test(sw), "Obsolete viewport compatibility remains in service worker.");
assert(sw.includes("inactiveForMs") && sw.includes("MAINTAIN_RUNTIME_CACHES"), "Inactive-cache maintenance contract is missing.");
assert(sw.includes("schema: 1") && !/marker\?\.schema\s*[<>=!]+\s*[2345]/u.test(sw), "Offline readiness marker is not on the single current schema.");
assert(lifecycle.includes("visibilitychange") && lifecycle.includes("pageshow") && lifecycle.includes("pagehide"), "Lifecycle restoration is incomplete.");
assert(lifecycle.includes("sessionStorage") && lifecycle.includes('const STORAGE_KEY = "nav-kurd:app-session"'), "Lifecycle state is not session-persistent under the canonical key.");
assert(/destroy:\s*\(\)\s*=>\s*\{[\s\S]*?persist\(\);[\s\S]*?destroyed\s*=\s*true/u.test(lifecycle), "Lifecycle destroy does not persist before teardown.");
assert(!main.includes("window.location.reload()"), "Document reload remains in the app runtime.");
assert(scheduler.includes("NORMAL_FRAME_BUDGET_MS") && scheduler.includes("CONSTRAINED_FRAME_BUDGET_MS") && scheduler.includes('task.priority === "visual"') && scheduler.includes("this.map.isMoving()"), "Central animation/camera frame budgeting is missing.");
assert(overlay.includes("requestAnimationFrame") && !overlay.includes("setInterval"), "Overlay layout is not event-coalesced.");
assert(!overlay.includes("getBoundingClientRect") && !overlay.includes("ResizeObserver"), "Overlay layout still forces rendered-box measurement.");
assert(!/observe\(card\)/u.test(tutorial) && tutorial.includes("targetInfo") && tutorial.includes("cardRect"), "Tutorial layout is not target-only/coalesced.");
assert(presence.includes('status === "CHANNEL_ERROR" || status === "TIMED_OUT"') && presence.includes('setState(navigator.onLine ? "connecting" : "offline")'), "Realtime transient recovery can publish a false offline state.");
assert(!presence.includes('| "error"') && !presence.includes('setState("error")'), "Realtime presence still exposes an unreachable false-red error state.");
assert(shell.indexOf('id="mapOnlineIndicator"') < shell.indexOf('id="brandAboutButton"'), "Header DOM order is not status/online/brand.");
assert(layout.includes('grid-template-areas: "status online brand"') && layout.includes('grid-area: brand') && layout.includes('justify-self: end'), "Brand card is not physically anchored to the upper-right.");
assert(shell.includes('class="map-loading__word"') && shell.includes('class="map-loading__slice"') && shell.includes('class="map-loading__line"') && shell.includes('class="map-loading__equation"') && shell.includes('dir="ltr"') && shell.includes('2 + 2 = 1'), "Nine-slice Loading composition is incomplete.");
assert(!shell.includes('map-loading__identity') && !shell.includes('map-loading__ambient') && !/nav-kurd-loader(?:-offline|-restored)?\.(?:gif|webp)/u.test(shell), "Loader still depends on removed card, glow, or animated media assets.");
assert(loader.includes('.map-loading__slice:nth-child(9)') && loader.includes('.map-loading__equation') && loader.includes('nav-kurd-loading-wobble') && loader.includes('rgba(37, 0, 43, .95)') && loader.includes('rgba(0, 5, 56, .95)') && loader.includes('"Droid Logo"'), "New Loading component states are incomplete.");
assert(base.includes('url("/fonts/DroidLogo-Bold.ttf")') && indexHtml.includes('%BASE_URL%fonts/DroidLogo-Bold.ttf') && offlineBuilder.includes('"fonts/DroidLogo-Bold.ttf"') && await fileExists("public/fonts/DroidLogo-Bold.ttf"), "The supplied loader equation font is not bundled for online and offline use.");
assert(userContribution.includes('"name_ku", copy.nameKu') && userContribution.includes('ATLAS_TEXT_LIMITS.name, "kurdish"') && userContribution.includes('ATLAS_TEXT_LIMITS.description, "kurdish"') && userContribution.includes('ATLAS_TEXT_LIMITS.caption, "kurdish"'), "Kurdish contribution fields are not validated with the Kurdish policy.");
assert(
  userContribution.includes("waitForUsableVisualViewport")
    && userContribution.includes("restoreClampedScroll")
    && mobileDialogLayout.includes("near-zero visual viewport")
    && mobileDialogLayout.includes("minimumUsableHeight")
    && userContributionStyles.includes("height: min(92svh,850px)"),
  "Mobile gallery return can still collapse the contribution editor."
);
assert(loader.includes('transform: translateX(-90%)') && loader.includes('@media (prefers-reduced-motion: reduce)'), "Loader animation is not transform-based or reduced-motion safe.");
assert(!loader.includes('.map-loading__identity') && !loader.includes('.map-loading__ambient') && !loader.includes('.map-loading__spinner') && !loader.includes('.map-loading__signal') && !loader.includes('.map-loading__orbit'), "Legacy loader CSS remains in the canonical loader owner.");
assert(!(offline.assets ?? []).some((entry) => /nav-kurd-loader(?:-offline|-restored)?\.(?:gif|webp)$/u.test(entry.path ?? "")), "Offline runtime still catalogs obsolete loader media.");
assert(leftRail.includes('maplibregl-ctrl map-left-control-rail__extras') && leftRail.includes('extras.append(threeDButton)') && leftRail.includes('extras.append(visibilityButton)') && leftRail.includes('style.pointerEvents = \"auto\"'), "3D and visibility controls are not mounted into an interactive MapLibre control surface.");
assert(!overlay.includes('--nav-kurd-3d-top') && !overlay.includes('--nav-kurd-hide-top') && !overlay.includes('--nav-kurd-left-rail-top'), "Viewport layout still owns obsolete absolute left-rail offsets.");
assert(controlRail.includes('position: static !important') && controlRail.includes('display: flex !important') && controlRail.includes('--nav-kurd-left-rail-gap') && controlRail.includes('pointer-events: auto !important') && controlRail.includes('touch-action: manipulation'), "Left rail is not normal-flow aligned or touch-interactive.");
assert(controlRail.includes('.map-shell.map-controls-hidden .maplibregl-ctrl-top-left[data-nav-kurd-rail="ready"] > .maplibregl-ctrl-group') && controlRail.includes('.controls-visibility-button'), "Hidden-control state does not preserve the restore button in the canonical rail.");
assert(surfaceState.includes('.map-shell.map-controls-hidden .map-sheet') && surfaceState.includes('margin-inline: auto !important') && !surfaceState.includes('translateX(-50%)'), "Map-sheet hide/restore is not center-anchored.");
assert(main.includes('this.destinationPromptOpen || controlsHidden') && main.includes('controller.syncPrimaryMapSurfaces()'), "Hide-control state is not synchronized with the bottom map card and accessibility state.");
assert(routing.includes('"candidate"') && routing.includes('CANDIDATE_LAYER') && !routing.includes('candidateMarker'), "Long-press candidate pin is not a stable GeoJSON map layer.");
assert(atlasPlaces.includes('ATLAS_AUTH_INTENT_MAX_AGE_MS') && atlasPlaces.includes('createdAt: Date.now()'), "OAuth intent expiry is missing; stale account panels may reopen.");
assert(feedback.includes('dialog-close-button feedback-studio__close') && visual.includes('Canonical modal close affordance shared'), "Feedback does not use the canonical close control.");
assert(layers.includes("kri-localities-major-runtime.geojson") && layers.includes("kri-localities-cluster-runtime.geojson") && layers.includes('data: { type: "FeatureCollection", features: [] }') && !layers.includes("dynamic: true"), "Locality MapLibre sources are not partitioned/precomputed or contain unsupported source options.");
assert(localityViewport.includes("moveend") && localityViewport.includes("MIN_DETAIL_ZOOM") && !localityViewport.includes("setInterval"), "Detailed localities are not viewport-bounded.");
assert(hardware.includes("logicalProcessors: null") && hardware.includes("deviceMemoryGb: null") && !/\|\|\s*8|\?\?\s*8/u.test(hardware), "Hardware capability hints use fabricated fallback values.");
assert(!/deviceMemory\s*\|\||hardwareConcurrency\s*\|\|/u.test(main), "Main runtime still fabricates hardware capability values.");
assert(gps.includes("pendingJump") && gps.includes("blendCoordinate"), "Confirmed-jump GPS protection is missing.");
assert(offlinePack.includes("offline-pack-file-hash") && offlinePack.includes("verificationFailures"), "Offline verification diagnostics are incomplete.");
assert(!/LEGACY_STORAGE_KEYS|offline-map-pack-v[2345]/u.test(offlinePack), "Obsolete offline metadata compatibility remains.");
assert(sprite.release === release.appVersion && sprite.count >= 150, "Runtime sprite release/count is invalid.");
for (const variant of sprite.variants ?? []) {
  assert(variant.image.startsWith("nav-kurd-poi-runtime-") && !/r\d/iu.test(variant.image), "Runtime sprite uses a revision filename.");
}

const apkPath = `public/downloads/NAV-KURD-${release.appVersion}.apk`;
if (androidRelease.directApkAvailable === true) {
  assert(androidRelease.directApkUrl === `/downloads/NAV-KURD-${release.appVersion}.apk`, "Direct APK URL is not canonical.");
  assert(/^[a-f0-9]{64}$/u.test(androidRelease.apkSha256 ?? ""), "Direct APK hash is missing.");
  assert(await fileExists(apkPath), "Direct APK metadata points to a missing file.");
  const apk = await fileMeta(apkPath);
  assert(apk.bytes === androidRelease.apkBytes && apk.sha256 === androidRelease.apkSha256, "Direct APK metadata does not match the signed file.");
} else {
  assert(androidRelease.directApkUrl === null && !(await fileExists(apkPath)), "Unavailable direct APK state still exposes a broken installer.");
}
console.log(`PASS runtime contracts: PWA/offline ${release.appVersion}, lifecycle restore, frame budget, GPS jump confirmation and verified offline pack.`);
