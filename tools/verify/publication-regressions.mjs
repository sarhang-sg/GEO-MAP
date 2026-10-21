import assert from 'node:assert/strict';
import { assertPublicAndroid } from '../release/verify-published-android.mjs';
const cert='A24575438CD4E1AFD611FE2EC8F72EEF70D5C11F3FE9BAEF0E75D576ECCE1246';
const url='https://github.com/sarhang-sg/GEO-ANDROID/releases/download/v10.4.4/NAV-KURD-10.4.4.apk';
const artifact={gitCommit:'a'.repeat(40),signingCertificateSha256:cert,url,bytes:20*1024*1024,sha256:'b'.repeat(64)};
const receipt={versionName:'10.4.4',versionCode:100404,packageId:'com.navkurd.app',gitCommit:artifact.gitCommit,
  signingCertificateSha256:cert, files:{apk:{name:'NAV-KURD-10.4.4.apk',bytes:artifact.bytes,sha256:artifact.sha256}}};
const release={draft:false,prerelease:false,tag_name:'v10.4.4',published_at:'2026-10-13T10:00:00Z',assets:[{
  name:'NAV-KURD-10.4.4.apk',size:artifact.bytes,digest:'sha256:'+artifact.sha256,state:'uploaded',browser_download_url:url}]};
assert.equal(assertPublicAndroid(release,receipt,artifact),release.published_at);
const cases=[
  [ {...release,draft:true},receipt,artifact ],
  [ {...release,prerelease:true},receipt,artifact ],
  [ {...release,published_at:null},receipt,artifact ],
  [ release,{...receipt,gitCommit:'c'.repeat(40)},artifact ],
  [ release,{...receipt,versionCode:100403},artifact ],
  [ release,{...receipt,packageId:'other.app'},artifact ],
  [ {...release,assets:[{...release.assets[0],digest:'sha256:'+'c'.repeat(64)}]},receipt,artifact ],
  [ release,receipt,{...artifact,url:'https://example.com/fake.apk'} ],
];
for (const args of cases) assert.throws(()=>assertPublicAndroid(...args));
console.log(`PASS Android publication regressions: ${cases.length+1} cases / zero skipped.`);
