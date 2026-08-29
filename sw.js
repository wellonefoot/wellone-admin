'use strict';
const CACHE_VERSION='wellone-admin-v96-simple-products';
const SHELL_CACHE=`${CACHE_VERSION}-shell`;
const RUNTIME_CACHE=`${CACHE_VERSION}-runtime`;
const IMAGE_CACHE=`${CACHE_VERSION}-images`;
const SHELL_ASSETS=[
  './','./index.html','./css/admin.css?v=96','./js/admin-config.js?v=96','./js/admin.bundle.js?v=96','./js/pwa-install.js?v=96',
  './manifest.webmanifest','./assets/logo.png?v=96','./assets/favicon/favicon.ico'
];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>Promise.allSettled(SHELL_ASSETS.map(x=>cache.add(x)))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('wellone-admin-')&&!k.startsWith(CACHE_VERSION)).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
function urlOf(request){try{return new URL(request.url);}catch(_e){return null;}}
function isSupabaseRequest(request){const u=urlOf(request);return Boolean(u&&u.hostname.endsWith('.supabase.co'));}
function isPublicStorage(request){const u=urlOf(request);return Boolean(u&&u.hostname.endsWith('.supabase.co')&&u.pathname.includes('/storage/v1/object/public/'));}
async function networkFirst(request,fallback){
  const cache=await caches.open(RUNTIME_CACHE);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response&&response.ok)cache.put(request,response.clone()).catch(()=>{});
    return response;
  }catch(error){
    const hit=await cache.match(request);
    if(hit)return hit;
    if(fallback){const fb=await caches.match(fallback);if(fb)return fb;}
    throw error;
  }
}
async function imageCache(request){
  const cache=await caches.open(IMAGE_CACHE);
  const hit=await cache.match(request);
  if(hit)return hit;
  const response=await fetch(request,{cache:'no-cache'});
  if(response&&(response.ok||response.type==='opaque')){
    cache.put(request,response.clone()).catch(()=>{});
    cache.keys().then(keys=>{if(keys.length>180)Promise.all(keys.slice(0,keys.length-180).map(k=>cache.delete(k))).catch(()=>{});}).catch(()=>{});
  }
  return response;
}
self.addEventListener('fetch',event=>{
  const request=event.request;
  // Supabase auth/database/storage API traffic always goes directly to the network.
  // Do not cache or proxy authenticated responses.
  if(isSupabaseRequest(request)&&!isPublicStorage(request)){
    event.respondWith(fetch(request,{cache:'no-store'}));
    return;
  }
  if(request.method!=='GET')return;
  const url=urlOf(request);
  if(!url)return;
  if(request.mode==='navigate'){
    event.respondWith(networkFirst(request,'./index.html'));
    return;
  }
  if(request.destination==='image'||isPublicStorage(request)){
    event.respondWith(imageCache(request));
    return;
  }
  if(url.origin===self.location.origin&&['script','style','manifest'].includes(request.destination)){
    event.respondWith(networkFirst(request));
  }
});
