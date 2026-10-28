import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const release = JSON.parse(await readFile('release.config.json', 'utf8'));
let commit = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
if (!commit) {
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8', stdio:['ignore','pipe','ignore']}).trim(); }
  catch { commit = null; }
}
if (commit && !/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Invalid deployment commit.');
if (process.env.VERCEL === '1' && !commit) throw new Error('Vercel deployment is missing its source commit.');
await writeFile('dist/release-identity.json', JSON.stringify({schema:1,
  appVersion:release.appVersion, androidVersionCode:release.androidVersionCode,
  releaseId:release.releaseId, gitCommit:commit}) + '\n');
console.log('PASS deployment release identity.');
