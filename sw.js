'use strict';
const CACHE_VERSION='wellone-admin-v82-exact-variant-sync';
const SHELL_CACHE=`${CACHE_VERSION}-shell`;
const RUNTIME_CACHE=`${CACHE_VERSION}-runtime`;
const SHELL=[
  './',
  './index.html',
  './css/admin.css?v=82',
  './js/admin.bundle.js?v=82',
  './js/pwa-install.js?v=82',
  './manifest.webmanifest',
  './assets/logo.png?v=82',
  './assets/favicon/favicon.ico'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('wellone-admin-')&&!key.startsWith(CACHE_VERSION)).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});
function isSupabase(request){try{return new URL(request.url).hostname.endsWith('.supabase.co');}catch(_e){return false;}}
async function trim(name,max=140){const cache=await caches.open(name);const keys=await cache.keys();if(keys.length>max)await Promise.all(keys.slice(0,keys.length-max).map(k=>cache.delete(k)));}
async function cacheFirst(request){
  const cached=await caches.match(request);
  if(cached)return cached;
  const response=await fetch(request);
  if(response&&(response.ok||response.type==='opaque')){const cache=await caches.open(RUNTIME_CACHE);cache.put(request,response.clone()).then(()=>trim(RUNTIME_CACHE)).catch(()=>{});}
  return response;
}
async function staleWhileRevalidate(request,fallback){
  const cache=await caches.open(RUNTIME_CACHE);
  const cached=(await caches.match(request))||(fallback?await caches.match(fallback):null);
  const network=fetch(request).then(response=>{
    if(response&&(response.ok||response.type==='opaque'))cache.put(request,response.clone()).then(()=>trim(RUNTIME_CACHE)).catch(()=>{});
    return response;
  }).catch(()=>cached);
  return cached||network;
}
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(isSupabase(request)){event.respondWith(fetch(request,{cache:'no-store'}));return;}
  if(request.mode==='navigate'){event.respondWith(staleWhileRevalidate(request,'./index.html'));return;}
  const same=url.origin===self.location.origin;
  const versioned=same&&/\?v=82(?:&|$)/.test(url.search);
  const staticAsset=same&&['script','style','manifest','font'].includes(request.destination);
  const image=request.destination==='image'||url.pathname.includes('/storage/v1/object/public/');
  const cdnScript=url.hostname==='cdn.jsdelivr.net';
  if(versioned||staticAsset||cdnScript){event.respondWith(cacheFirst(request));return;}
  if(image||same)event.respondWith(staleWhileRevalidate(request));
});
