import {coreCall} from './local-provider';
import type {OfflineMapPackController,OfflinePackSnapshot} from '../lib/offline-map-pack';
import {recordRuntimeDiagnostic} from '../lib/runtime-diagnostics';

/** Presentation of the native installer. There is no browser download, map
 * store or verification engine in this adapter. */
export class NativeOfflineMapPack implements OfflineMapPackController {
  private readonly listeners=new Set<(snapshot:OfflinePackSnapshot)=>void>();
  private downloadTask:Promise<void>|undefined;
  private constructor(private current:OfflinePackSnapshot){
    window.addEventListener('nav-kurd:native-map-pack',this.onProgress);
  }
  static async create():Promise<NativeOfflineMapPack>{
    return new NativeOfflineMapPack(await coreCall<OfflinePackSnapshot>('mapPackSnapshot'));
  }
  private readonly onProgress=(event:Event):void=>{this.accept((event as CustomEvent<OfflinePackSnapshot>).detail);};
  private accept(snapshot:OfflinePackSnapshot):void{
    if(!snapshot||!['idle','downloading','paused','ready','error'].includes(snapshot.status)||
      !Number.isFinite(snapshot.totalBytes)||snapshot.totalBytes<=0||
      !Number.isFinite(snapshot.downloadedBytes)||snapshot.downloadedBytes<0||snapshot.downloadedBytes>snapshot.totalBytes){
      recordRuntimeDiagnostic('local-map-pack','Invalid native map installation status.','error');
      throw new Error('Invalid native map installation status.');
    }
    const previous=this.current;
    if(previous.status===snapshot.status&&previous.downloadedBytes===snapshot.downloadedBytes&&
      previous.totalBytes===snapshot.totalBytes&&previous.progress===snapshot.progress&&
      previous.persisted===snapshot.persisted&&previous.storageUsageBytes===snapshot.storageUsageBytes&&
      previous.storageQuotaBytes===snapshot.storageQuotaBytes&&previous.storageAvailableBytes===snapshot.storageAvailableBytes&&
      previous.verifiedAt===snapshot.verifiedAt&&previous.error===snapshot.error&&
      previous.mapDataVersion===snapshot.mapDataVersion&&previous.packVersion===snapshot.packVersion)return;
    this.current=snapshot;
    this.listeners.forEach(listener=>listener(this.snapshot()));
  }
  snapshot():OfflinePackSnapshot{return {...this.current};}
  subscribe(listener:(snapshot:OfflinePackSnapshot)=>void):()=>void{
    this.listeners.add(listener);listener(this.snapshot());return ()=>this.listeners.delete(listener);
  }
  async initialize():Promise<OfflinePackSnapshot>{
    this.accept(await coreCall<OfflinePackSnapshot>('mapPackSnapshot'));return this.snapshot();
  }
  download():Promise<void>{
    return this.downloadTask??=this.action('mapPackDownload').finally(()=>{this.downloadTask=undefined;});
  }
  async pause():Promise<void>{await this.action('mapPackPause');}
  async delete():Promise<void>{await this.action('mapPackDelete');}
  private async action(operation:string):Promise<void>{
    try{this.accept(await coreCall<OfflinePackSnapshot>(operation));}
    catch(error){recordRuntimeDiagnostic('local-map-pack',error,'error');await this.initialize();throw error;}
  }
  dispose():void{window.removeEventListener('nav-kurd:native-map-pack',this.onProgress);this.listeners.clear();}
}
