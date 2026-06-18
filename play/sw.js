/* Conway's Conquerors — service worker (PWA/TWA shell)
 * Strategy: NETWORK-FIRST for everything. The stale-code problem on mobile is
 * real, so the SW must never pin old game.js; the cache exists only as an
 * offline fallback for the app shell. /api/ is never intercepted. */
const CACHE='cc-shell-v60';
const SHELL=['/play/','/play/index.html','/play/game.js?v=60','/play/favicon.svg',
  '/play/icons/icon-192.png','/play/icons/icon-512.png'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(
    ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET')return;                 // POST /api/send pasa directo
  if(url.pathname.startsWith('/api/'))return;          // nunca interceptar la API
  e.respondWith(
    fetch(e.request).then(res=>{
      if(res.ok&&url.origin===location.origin){
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
      }
      return res;
    }).catch(()=>caches.match(e.request))
  );
});
