import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import {bytesToHeader, tileIdToZxy} from 'pmtiles';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';

function readVarint(state) {
  const b=state.buf; let val=0, shift=0;
  while (true) { const byte=b[state.pos++]; val += (byte & 0x7f) * 2 ** shift; if (byte < 0x80) return val; shift += 7; if (shift>49) throw new Error('varint too long'); }
}
function deserializeIndex(buffer) {
  const s={buf:new Uint8Array(buffer),pos:0}; const count=readVarint(s); const entries=[]; let lastId=0;
  for(let i=0;i<count;i++){const d=readVarint(s); lastId+=d; entries.push({tileId:lastId,offset:0,length:0,runLength:1});}
  for(let i=0;i<count;i++) entries[i].runLength=readVarint(s);
  for(let i=0;i<count;i++) entries[i].length=readVarint(s);
  for(let i=0;i<count;i++){const o=readVarint(s); entries[i].offset=o===0&&i>0?entries[i-1].offset+entries[i-1].length:o-1;}
  return entries;
}
function decompress(buf, comp){ if(comp===1||comp===0) return buf; if(comp===2) return zlib.gunzipSync(buf); if(comp===3) return zlib.brotliDecompressSync(buf); throw new Error('compression '+comp); }
async function readAt(handle, offset,length){const b=Buffer.alloc(length); await handle.read(b,0,length,offset); return b;}
async function scan(file){
 const h=await fs.open(file,'r');
 const headBuf=await readAt(h,0,127); const header=bytesToHeader(headBuf.buffer.slice(headBuf.byteOffset,headBuf.byteOffset+headBuf.byteLength));
 const rootRaw=await readAt(h,header.rootDirectoryOffset,header.rootDirectoryLength); const root=deserializeIndex(decompress(rootRaw,header.internalCompression));
 const entries=[];
 for(const e of root){
  if(e.runLength===0){ const raw=await readAt(h,header.leafDirectoryOffset+e.offset,e.length); const leaf=deserializeIndex(decompress(raw,header.internalCompression)); entries.push(...leaf); }
  else entries.push(e);
 }
 console.log('\n',file, header, 'entries',entries.length);
 let scanned=0, offenders=0; let maxAbs=0; const samples=[];
 const seenContent=new Set();
 for(const e of entries){
  const contentKey=`${e.offset}:${e.length}`; if(seenContent.has(contentKey)) continue; seenContent.add(contentKey);
  const raw=await readAt(h,header.tileDataOffset+e.offset,e.length); const tileBuf=decompress(raw,header.tileCompression);
  let vt; try {vt=new VectorTile(new PbfReader(tileBuf));} catch(err){console.error('decode fail',e,err.message); continue;}
  const [z,x,y]=tileIdToZxy(e.tileId);
  for(const [layerName,layer] of Object.entries(vt.layers)){
   for(let i=0;i<layer.length;i++){
    const feat=layer.feature(i); let geom;
    try {geom=feat.loadGeometry();} catch {continue;}
    const scale=8192/feat.extent;
    for(const ring of geom) for(const p of ring){
      const sx=Math.round(p.x*scale), sy=Math.round(p.y*scale); const a=Math.max(Math.abs(sx),Math.abs(sy)); if(a>maxAbs) maxAbs=a;
      if(sx < -32768 || sx > 32767 || sy < -32768 || sy > 32767){ offenders++; if(samples.length<30) samples.push({z,x,y,layer:layerName,feature:i,extent:feat.extent,raw:[p.x,p.y],scaled:[sx,sy],props:feat.properties}); }
    }
   }
  }
  scanned++; if(scanned%1000===0) console.log('scanned',scanned,'offenders',offenders,'maxAbs',maxAbs);
 }
 console.log('DONE scanned contents',scanned,'offenders',offenders,'maxAbs',maxAbs,'samples',JSON.stringify(samples,null,2));
 await h.close();
}
for(const f of process.argv.slice(2)) await scan(f);
