/* Android's only worker responsibility is the existing online satellite cache.
 * Core data, search, presentation and download state belong to the Dart runtime.
 * Replaces the PWA worker at the same scope; never registers a parallel owner. */
const CACHE_SCHEMA = __NAV_KURD_CACHE_SCHEMA__;
const CACHE = `nav-kurd-satellite-s${CACHE_SCHEMA}`;
const OWNED = ['nav-kurd-', 'kri-map-', 'geo-map-'];
const isSatelliteCache = name => OWNED.some(prefix => name.startsWith(`${prefix}satellite-`));
const satellite = url => (url.origin === 'https://api.maptiler.com' && /^\/tiles\/satellite-v2\/\d+\/\d+\/\d+\.jpg$/.test(url.pathname))
  || (url.origin === self.location.origin && url.pathname.endsWith('/api/sentinel2') && ['z','x','y'].every(key => url.searchParams.has(key)));
const keyFor = request => { const url = new URL(request.url); url.searchParams.delete('key'); return new Request(url.href, {credentials:'omit',mode:'no-cors'}); };
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  // Preserve even opaque legacy tile responses, which cannot be exported from
  // browser JS into Dart. The same CacheStorage owner continues to serve them.
  const cache = await caches.open(CACHE);
  for (const name of await caches.keys()) {
    if (!OWNED.some(prefix => name.startsWith(prefix)) || name === CACHE) continue;
    if (isSatelliteCache(name)) {
      const previous = await caches.open(name);
      for (const request of await previous.keys()) {
        const response = await previous.match(request);
        if (response && !await cache.match(keyFor(request))) await cache.put(keyFor(request), response);
      }
    }
    await caches.delete(name);
  }
  await self.clients.claim();
})()));
async function responseFor(request,event) {
  const cache=await caches.open(CACHE),key=keyFor(request),cached=await cache.match(key);
  const refresh=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(request,{signal:controller.signal});
      if(response.ok||response.type==='opaque'){
        await cache.put(key,response.clone());
        const keys=await cache.keys();for(const oldest of keys.slice(0,Math.max(0,keys.length-256)))await cache.delete(oldest);
      }
      return response;
    }catch(error){
      if(!cached)console.warn('satellite-unavailable',error);
      return cached||new Response('Satellite tiles are unavailable offline.',{status:504,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    }finally{clearTimeout(timer);}
  })();
  if(cached){event.waitUntil(refresh.then(()=>undefined));return cached;}
  return refresh;
}
self.addEventListener('fetch',event=>{
  if(event.request.method==='GET'&&satellite(new URL(event.request.url)))event.respondWith(responseFor(event.request,event));
});
self.addEventListener('message',event=>{
  if(event.data?.type==='CANCEL_OFFLINE_RUNTIME')event.ports[0]?.postMessage({ok:true,cancelled:true,owner:'native-satellite'});
  if(event.data?.type==='NAV_KURD_NATIVE_WORKER')event.ports[0]?.postMessage({owner:'native-satellite',schema:1});
});
