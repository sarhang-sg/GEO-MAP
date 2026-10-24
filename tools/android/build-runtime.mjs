import {build} from 'vite';
import {readFileSync,writeFileSync,existsSync,readdirSync,mkdirSync,renameSync,statSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
const option=key=>{const i=args.indexOf(key);if(i<0||!args[i+1])throw Error(`Required ${key}`);return resolve(args[i+1]);};
const output=option('--output'),configPath=option('--config'),stage=output+'.building';
if(existsSync(output)||existsSync(stage))throw Error('Runtime output must be a new directory.');
const config=JSON.parse(readFileSync(configPath,'utf8'));
if(config.schema!==1||typeof config.values!=='object'||!Array.isArray(config.evidence)||!config.evidence.length)throw Error('Production public configuration requires provenance.');
const declarations=readFileSync(join(root,'src/vite-env.d.ts'),'utf8');
const allowed=new Set([...declarations.matchAll(/readonly (VITE_\w+)\?/g)].map(m=>m[1]));
const define={};
for(const [key,value] of Object.entries(config.values)){
 if(!allowed.has(key)||(value!==null&&typeof value!=='string'))throw Error(`Unexpected public configuration field: ${key}`);
 if(typeof value==='string'&&/YOUR_|PLACEHOLDER|sb_secret_/i.test(value))throw Error(`Unsafe or template configuration: ${key}`);
}
for(const key of allowed){if(!(key in config.values))throw Error(`Unresolved production browser field: ${key}`);define[`import.meta.env.${key}`]=config.values[key]===null?'undefined':JSON.stringify(config.values[key]);}
for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY','VITE_KRI_ENABLE_SATELLITE','VITE_KRI_ROUTING_PROVIDER'])if(!config.values[key])throw Error(`Required production value: ${key}`);
const key=config.values.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!key.startsWith('sb_publishable_')){
 const payload=JSON.parse(Buffer.from(key.split('.')[1]??'','base64url').toString());
 if(payload.role!=='anon')throw Error('Only a Supabase public/anon key may be bundled.');
}
if(config.values.VITE_KRI_ENABLE_SATELLITE==='true'&&config.values.VITE_KRI_SATELLITE_PROVIDER==='maptiler'&&!config.values.VITE_KRI_MAPTILER_API_KEY)throw Error('MapTiler production key is required.');
if(config.values.VITE_KRI_ROUTING_PROVIDER==='mapbox'&&!config.values.VITE_KRI_MAPBOX_ACCESS_TOKEN?.startsWith('pk.'))throw Error('Mapbox public token is required.');
mkdirSync(dirname(output),{recursive:true});
await build({root,configFile:join(root,'vite.config.ts'),base:'/',publicDir:false,define,plugins:[{name:'android-presentation-entry',transformIndexHtml:{order:'pre',handler:html=>html.replace(/<script src="%BASE_URL%pwa-init\.js"><\/script>/,'')}}],build:{outDir:stage,emptyOutDir:false,sourcemap:false,reportCompressedSize:false}});
writeFileSync(join(stage,'manifest.webmanifest'),readFileSync(join(root,'public/manifest.webmanifest')));
mkdirSync(join(stage,'legal'));
writeFileSync(join(stage,'legal/privacy.html'),readFileSync(join(root,'public/legal/privacy.html')));
const sha=b=>createHash('sha256').update(b).digest('hex'),files=[];
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else{const bytes=readFileSync(path);files.push({path:path.slice(stage.length+1),bytes:bytes.length,sha256:sha(bytes)});}}}
walk(stage);files.sort((a,b)=>a.path.localeCompare(b.path));
if(!files.some(f=>f.path==='index.html'))throw Error('Runtime HTML was not emitted.');
const release=JSON.parse(readFileSync(join(root,'release.config.json'),'utf8'));
writeFileSync(join(stage,'manifest.json'),JSON.stringify({schema:1,appVersion:release.appVersion,releaseId:release.releaseId,configurationHash:sha(readFileSync(configPath)),contentHash:sha(files.map(f=>`${f.path}\0${f.bytes}\0${f.sha256}\n`).join('')),files})+'\n');
renameSync(stage,output);
console.log(JSON.stringify({output,files:files.length,bytes:files.reduce((n,f)=>n+f.bytes,0)+statSync(join(output,'manifest.json')).size}));
