#!/usr/bin/env node
import { assert, fileExists, readJson, readText } from "../lib/project.mjs";

for (const path of [
  "android/app/src/main/AndroidManifest.xml",
  "android/app/src/main/res/xml/network_security_config.xml",
  "ios/App/App/Info.plist",
  "ios/App/App/PrivacyInfo.xcprivacy",
  "src-tauri/tauri.conf.json",
  "capacitor.config.ts",
  "api/assetlinks.js",
  "api/apple-app-site-association.js"
]) assert(await fileExists(path), `Platform source missing: ${path}`);

const android = await readText("android/app/src/main/AndroidManifest.xml");
assert(android.includes('android:usesCleartextTraffic="false"'), "Android cleartext traffic is not disabled.");
assert(android.includes("android.permission.ACCESS_FINE_LOCATION"), "Android fine-location permission is missing.");
const network = await readText("android/app/src/main/res/xml/network_security_config.xml");
assert(network.includes('cleartextTrafficPermitted="false"'), "Android network security permits cleartext traffic.");
const ios = await readText("ios/App/App/Info.plist");
assert(ios.includes("NSLocationWhenInUseUsageDescription"), "iOS location disclosure is missing.");
const privacy = await readText("ios/App/App/PrivacyInfo.xcprivacy");
assert(privacy.includes("NSPrivacyAccessedAPITypes"), "iOS privacy manifest is incomplete.");
const release = await readJson("release.config.json");
const capacitor = await readText("capacitor.config.ts");
assert(capacitor.includes(`NAV-KURD-Native/${release.appVersion}`), "Capacitor user-agent release mismatch.");
const tauri = await readJson("src-tauri/tauri.conf.json");
assert(tauri.productName === "NAV KURD", "Windows product identity mismatch.");
assert(tauri.version === release.appVersion, "Tauri version mismatch.");
console.log("PASS platform contracts: Android, iOS, Capacitor and Windows source policies are aligned.");
