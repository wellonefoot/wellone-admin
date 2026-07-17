const CACHE_VERSION = 'wellone-admin-v69-admin-events';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const SHELL_ASSETS = [
  './', './index.html', './css/admin.css?v=69', './js/admin-config.js?v=69', './js/admin.js?v=69', './js/pwa-install.js?v=69',
  './manifest.webmanifest', './assets/logo.png?v=69', './assets/favicon/favicon.ico',
  './assets/favicon/wellone-icon-192-v46.png', './assets/favicon/wellone-icon-512-v46.png',
  './assets/favicon/wellone-icon-192-maskable-v46.png', './assets/favicon/wellone-icon-512-maskable-v46.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('wellone-admin-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isSupabaseRequest(request){
  const url = new URL(request.url);
  return url.hostname.endsWith('.supabase.co');
}

function isSameOriginCode(request){
  const url = new URL(request.url);
  return url.origin === self.location.origin && ['script', 'style', 'document', 'manifest'].includes(request.destination);
}

function isCacheableAsset(request){
  if(request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.pathname.includes('/storage/v1/object/public/');
}

async function trimCache(cacheName, maxItems){
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if(keys.length <= maxItems) return;
  await Promise.all(keys.slice(0, keys.length - maxItems).map(key => cache.delete(key)));
}

async function networkFirst(request, fallback){
  const cache = await caches.open(RUNTIME_CACHE);
  try{
    const response = await fetch(request, {cache:'no-store'});
    if(response && response.ok){
      cache.put(request, response.clone()).then(() => trimCache(RUNTIME_CACHE, 180)).catch(() => {});
    }
    return response;
  }catch(_error){
    return (await cache.match(request)) || (fallback ? await caches.match(fallback) : undefined) || Response.error();
  }
}

async function staleWhileRevalidate(request){
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(response => {
    if(response && (response.ok || response.type === 'opaque')){
      cache.put(request, response.clone()).then(() => trimCache(RUNTIME_CACHE, 180)).catch(() => {});
    }
    return response;
  }).catch(() => cached);
  return cached || network;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if(request.method !== 'GET') return;

  if(isSupabaseRequest(request)){
    event.respondWith(fetch(request, {cache:'no-store'}));
    return;
  }

  if(request.mode === 'navigate'){
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }

  if(isSameOriginCode(request)){
    event.respondWith(networkFirst(request));
    return;
  }

  if(isCacheableAsset(request)) event.respondWith(staleWhileRevalidate(request));
});
