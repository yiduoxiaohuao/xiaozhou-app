// 小舟单词 v6 — 纯网络模式（无缓存）
self.addEventListener('install',e=>{self.skipWaiting()})
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.map(x=>caches.delete(x)))).then(()=>self.clients.claim()))})
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request))})
