import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from './typescript-transform.mjs';

const account=fs.readFileSync('supabase/functions/delete-atlas-account/index.ts','utf8');
const shared=fs.readFileSync('supabase/functions/_shared/http.ts','utf8');
const confirmation=/const DELETE_CONFIRMATION\s*=\s*["']([^"']+)["']/u.exec(account)[1];
function compile(source) {
  return stripTypeScriptTypes(source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gmu,''))
    .replace(/\bexport /gu,'');
}
async function exercise({invalid=false, owner=false, revokeError=false, token=true}={}) {
  const events=[];
  const user={id:'00000000-0000-0000-0000-000000000001'};
  const admin={auth:{getUser:async()=>{events.push('authenticate');return {data:{user:invalid?null:user},error:null};},admin:{
    signOut:async(jwt,scope)=>{assert.equal(scope,'global');events.push('revoke-sessions');return {error:revokeError?new Error('fixture session revocation failed'):null};},
    deleteUser:async()=>{events.push('delete-auth');return {error:null};}
  }},storage:{from:()=>({list:async()=>({data:[],error:null}),remove:async()=>({error:null})})},from(table) {
    const query={select(){return this;},eq(){return this;},in(){return this;},
      delete(){events.push('delete-'+table);return this;},insert(){return this;},
      maybeSingle:async()=>({data:owner?{user_id:user.id}:null,error:null}),
      then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject);}};
    return query;
  }};
  let handler;
  const context=vm.createContext({Request,Response,Headers,TextEncoder,Map,Set,Error,Date,Promise,console:{error(){}},
    APP_VERSION:'10.4.4',createClient:()=>admin,
    Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://fixture.supabase.co':key==='SUPABASE_SERVICE_ROLE_KEY'?'fixture-server-key':''},serve:callback=>{handler=callback;}},
    PRIVATE_MEDIA_BUCKET:'atlas-user-media',mediaBucket:()=>null,addMediaPath(){},
    listPrivateUserMediaPaths:async()=>[],removeStoragePaths:async()=>{}
  });
  vm.runInContext(compile(shared)+'\n'+compile(account),context);
  const response=await handler(new Request('https://fixture.supabase.co/functions/v1/delete-atlas-account',{
    method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer fixture-user-token'}:{})},
    body:JSON.stringify({confirmation})
  }));
  return {response,events};
}
let result=await exercise();assert.equal(result.response.status,200);
assert.ok(result.events.indexOf('revoke-sessions')<result.events.indexOf('delete-atlas_places'));
assert.ok(result.events.indexOf('delete-auth')>result.events.indexOf('revoke-sessions'));
result=await exercise({revokeError:true});assert.equal(result.response.status,500);assert.deepEqual(result.events,['authenticate','revoke-sessions']);
result=await exercise({owner:true});assert.equal(result.response.status,403);assert.deepEqual(result.events,['authenticate']);
result=await exercise({invalid:true});assert.equal(result.response.status,401);assert.deepEqual(result.events,['authenticate']);
result=await exercise({token:false});assert.equal(result.response.status,401);assert.deepEqual(result.events,[]);
console.log('PASS account Edge Function: 5 auth/deletion cases; global session revocation precedes all data deletion.');
