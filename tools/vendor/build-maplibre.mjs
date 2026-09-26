// Upstream 6.6.0 production entry/output configuration, unchanged public types.
import { rolldown } from 'rolldown';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const vendor=resolve(root,'vendor/maplibre-gl');
const bundle=await rolldown({cwd:vendor,input:{'maplibre-gl':'src/index.ts','maplibre-gl-worker':'src/source/worker.ts'},platform:'browser',treeshake:true});
try{await bundle.write({dir:resolve(vendor,'dist'),format:'es',sourcemap:false,minify:true,entryFileNames:'[name].mjs',chunkFileNames:'maplibre-gl-shared.mjs',banner:'/*! MapLibre GL JS 6.6.0-navkurd.1 | BSD-3-Clause | See LICENSE.txt */'});}finally{await bundle.close();}
