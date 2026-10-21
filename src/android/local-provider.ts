import type {FeatureCollection} from 'geojson';
import type {Language,SearchChoice} from '../lib/types';
import type {StaticSearchItem} from '../lib/static-search';

declare global { interface Window { __NAV_KURD_LOCAL_CORE__?: number } }
export const localCoreEnabled=typeof window!=="undefined" && window.__NAV_KURD_LOCAL_CORE__===1;
const ready=localCoreEnabled?new Promise<void>(resolve=>{
  if(window.flutter_inappwebview?.callHandler)resolve();
  else window.addEventListener('flutterInAppWebViewPlatformReady',()=>resolve(),{once:true});
}):null;
export async function coreCall<T>(operation:string,args:Record<string,unknown>={}):Promise<T>{
  if(!ready)throw new Error('The native local runtime is unavailable.');
  await ready;
  const reply=await window.flutter_inappwebview!.callHandler('nativeLocalCore',{operation,...args}) as {ok:boolean;value:T;error?:{code:string;message:string}};
  if(!reply?.ok)throw Object.assign(new Error(reply?.error?.message||'Invalid native local response.'),{code:reply?.error?.code});
  return reply.value;
}
export type LocalStatistics={datasets:Record<string,number>;search:Record<Language,number>};
let statistics:Promise<LocalStatistics>|undefined;
export const coreStatistics=():Promise<LocalStatistics>=>statistics??=coreCall<LocalStatistics>('statistics');
export type LocalRanking={choices:SearchChoice[];anchor:{coordinate:[number,number];score:number}|null};
export const nativeLocalities=(term:string,language:Language,quick:boolean):Promise<LocalRanking>=>coreCall('localitySearch',{text:term,language,quick});

/** A transport for the single Dart index; no JS worker, corpus or fallback. */
export class NativeSearchProvider{
  private ready=false;
  private generation=0;
  private readonly cache=new Map<string,Promise<StaticSearchItem[]>>();
  private static readonly maximumCachedQueries=24;
  get isReady():boolean{return this.ready;}
  async activateLanguage(language:Language):Promise<number>{const stats=await coreStatistics();this.ready=true;return stats.search[language];}
  warm(language:Language='ku'):Promise<number>{return this.activateLanguage(language);}
  reset():void{this.ready=false;this.generation+=1;this.cache.clear();}
  search(text:string,language:Language,limit=12):Promise<StaticSearchItem[]>{
    const key=`${language}\u0000${limit}\u0000${text}`;
    const cached=this.cache.get(key);
    if(cached){this.cache.delete(key);this.cache.set(key,cached);return cached;}
    const generation=this.generation;
    let request:Promise<StaticSearchItem[]>;
    request=coreCall<Array<Record<string,unknown>>>('search',{text,language,limit}).then(rows=>{
      if(generation===this.generation)this.ready=true;
      return rows.map(row=>({...row,[`n_${language}`]:row.n,[`q_${language}`]:row.q,[`c_${language}`]:row.c}) as StaticSearchItem);
    },error=>{
      if(this.cache.get(key)===request)this.cache.delete(key);
      throw error;
    });
    this.cache.set(key,request);
    while(this.cache.size>NativeSearchProvider.maximumCachedQueries)this.cache.delete(this.cache.keys().next().value!);
    return request;
  }
}

/** Pages are bounded by the native repository and consumed by one UI caller. */
export async function localCollection(datasets:string[],language:Language,bounds:[number,number,number,number],signal?:AbortSignal,minimumLocalityRank=0):Promise<FeatureCollection>{
  const features:FeatureCollection['features']=[];let after=0;
  while(true){
    signal?.throwIfAborted();
    const page=await coreCall<{features:FeatureCollection['features'];hasMore:boolean;nextId:number}>('viewport',{datasets,language,bounds,after,limit:256,minimumLocalityRank});
    signal?.throwIfAborted();features.push(...page.features);
    if(!page.hasMore)break;
    if(page.nextId<=after)throw new Error('Native place cursor did not advance.');
    after=page.nextId;
  }
  return {type:'FeatureCollection',features};
}
