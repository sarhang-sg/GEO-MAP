import {coreCall,localCoreEnabled} from './local-provider';
import type {AppLifecycleSnapshot} from '../lib/app-lifecycle-controller';
import {recordRuntimeDiagnostic} from '../lib/runtime-diagnostics';

declare global { interface Window { __navKurdPersistUi?:()=>Promise<void> } }

type UiState={snapshot:AppLifecycleSnapshot|null;tutorialCompleted:boolean;trackingEnabled:boolean};
type ImportResult=UiState&{receipt:{sourceHash:string;alreadyImported:boolean};capturedSourceHash:string;invalidOrExpiredSessionDiscarded:boolean};
let current:UiState|undefined;
let pending=Promise.resolve();
let lastWriteError:unknown;
export async function initializeLocalPreferences():Promise<void>{
  if(!localCoreEnabled)return;
  const keys=['nav-kurd:app-session','nav-kurd:tutorial:completed','nav-kurd:gps:active'];
  const values=Object.fromEntries(keys.map((key,index)=>[key,(index===0?sessionStorage:localStorage).getItem(key)]));
  const imported=await coreCall<ImportResult>('importR16Preferences',{values});
  if(imported.receipt.sourceHash!==imported.capturedSourceHash&&!imported.receipt.alreadyImported)throw new Error('Native preference handoff receipt does not match.');
  current={snapshot:imported.snapshot,tutorialCompleted:imported.tutorialCompleted,trackingEnabled:imported.trackingEnabled};
  if(imported.invalidOrExpiredSessionDiscarded)recordRuntimeDiagnostic('local-preferences','The previous R16 UI session was invalid or expired.','warning');
  if(imported.receipt.sourceHash===imported.capturedSourceHash){
    keys.forEach((key,index)=>{const store=index===0?sessionStorage:localStorage;if(store.getItem(key)===values[key])store.removeItem(key);});
  }else if(Object.values(values).some(value=>value!==null)){
    recordRuntimeDiagnostic('local-preferences','Legacy UI values changed after native handoff and were retained for recovery.','warning');
  }
}
function state():UiState{if(!current)throw new Error('Native preferences are not initialized.');return current;}
export const nativeUiSnapshot=():AppLifecycleSnapshot|null=>state().snapshot;
export const nativeBoolean=(key:'tutorialCompleted'|'trackingEnabled'):boolean=>state()[key];
function enqueue(write:()=>Promise<void>):void{
  pending=pending.then(async()=>{await write();lastWriteError=undefined;}).catch(error=>{
    lastWriteError=error;
    recordRuntimeDiagnostic('local-preferences',error,'error');
    window.dispatchEvent(new CustomEvent('nav-kurd:local-storage-error',{detail:error}));
  });
}
export function saveNativeUiSnapshot(snapshot:AppLifecycleSnapshot):void{
  enqueue(async()=>{await coreCall('saveUiSnapshot',{snapshot});state().snapshot=snapshot;});
}
export function saveNativeBoolean(key:'tutorialCompleted'|'trackingEnabled',value:boolean):void{
  enqueue(async()=>{await coreCall('setPreference',{key,value});state()[key]=value;});
}
export async function flushNativePreferences():Promise<void>{await pending;if(lastWriteError)throw lastWriteError;}
