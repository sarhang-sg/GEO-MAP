import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const repository = 'sarhang-sg/GEO-ANDROID';
const certificate = 'A24575438CD4E1AFD611FE2EC8F72EEF70D5C11F3FE9BAEF0E75D576ECCE1246';
export function assertPublicAndroid(release, receipt, artifact, version='10.4.4', code=100404) {
  assert.equal(release.draft, false, 'APK is still a draft');
  assert.equal(release.prerelease, false, 'APK is a prerelease');
  assert.equal(release.tag_name, `v${version}`);
  assert.ok(release.published_at && Number.isFinite(Date.parse(release.published_at)), 'missing real publication time');
  assert.equal(receipt.versionName, version);
  assert.equal(receipt.versionCode, code);
  assert.equal(receipt.packageId, 'com.navkurd.app');
  assert.equal(receipt.gitCommit, artifact.gitCommit);
  assert.equal(receipt.signingCertificateSha256, certificate);
  assert.equal(artifact.signingCertificateSha256, certificate);
  assert.match(artifact.gitCommit, /^[a-f0-9]{40}$/u);
  const apk = receipt.files?.apk;
  assert.equal(apk?.name, `NAV-KURD-${version}.apk`);
  assert.equal(apk.bytes, artifact.bytes);
  assert.equal(apk.sha256, artifact.sha256);
  assert.ok(Number.isSafeInteger(apk.bytes) && apk.bytes >= 10*1024*1024 && apk.bytes <= 256*1024*1024);
  assert.match(apk.sha256, /^[a-f0-9]{64}$/u);
  const url = `https://github.com/${repository}/releases/download/v${version}/${apk.name}`;
  assert.equal(artifact.url, url);
  const assets = release.assets.filter(a => a.name === apk.name);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].size, apk.bytes);
  assert.equal(assets[0].digest, `sha256:${apk.sha256}`);
  assert.equal(assets[0].state, 'uploaded');
  assert.equal(assets[0].browser_download_url, url);
  return release.published_at;
}

async function getJson(url) {
  const response = await fetch(url, {headers:{'User-Agent':'NAV-KURD-release-verifier'}, signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`Release check returned HTTP ${response.status}`);
  return response.json();
}
async function main() {
  const metadata = JSON.parse(await readFile('public/releases/latest.json', 'utf8'));
  const config = JSON.parse(await readFile('release.config.json', 'utf8'));
  const production = process.env.VERCEL_ENV === 'production' || process.env.GITHUB_REF === 'refs/heads/main';
  if (!metadata.artifact) {
    if (production) throw new Error('Production requires a CI-verified Android receipt binding. Run the coordinated Termux updater.');
    console.log('PASS source preview: Android download remains unavailable until publication.');
    return;
  }
  // The web push precedes publication. Wait for the same verified draft to
  // become public; an interrupted updater cannot expose a dead APK link.
  const deadline = Date.now() + 15*60*1000;
  let lastError;
  do {
    try {
      const release = await getJson(`https://api.github.com/repos/${repository}/releases/tags/v${config.appVersion}`);
      const asset = release.assets.find(a => a.name === 'DOWNLOAD-RECEIPT.json');
      assert.ok(asset && asset.size <= 32768, 'verified receipt missing');
      const receipt = await getJson(asset.browser_download_url);
      const published = assertPublicAndroid(release, receipt, metadata.artifact, config.appVersion, config.androidVersionCode);
      const download = await fetch(metadata.artifact.url, {method:'HEAD', signal:AbortSignal.timeout(20000)});
      assert.ok(download.ok, 'published APK is not downloadable');
      await writeFile('dist/releases/latest.json', JSON.stringify({...metadata, publishedAt:published}, null, 2)+'\n');
      console.log('PASS public signed Android identity, asset digest and download.');
      return;
    } catch (error) { lastError = error; }
    if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10000));
  } while (Date.now() < deadline);
  throw lastError;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
