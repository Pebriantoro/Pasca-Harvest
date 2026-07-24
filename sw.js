/* =====================================================================
   SERVICE WORKER — Sistem Informasi Terpadu Estate 2
   Strategi:
   - File APP (html/js/css sendiri) -> NETWORK-FIRST: selalu coba ambil
     versi terbaru dari server dulu; kalau offline/gagal baru jatuh ke
     cache. Ini biar staff/spv/superintendent yang pin app di home
     screen HP selalu dapat update instan begitu online, gak nyangkut
     di versi lama nunggu siklus update Service Worker.
   - Aset statis besar & jarang berubah (logo, font/chart CDN, geojson
     petak) -> tetap cache-first, biar app tetap ringan & bisa dibuka
     offline tanpa nunggu network.
   - Request ke Supabase (data) -> selalu network (data harus fresh),
     TIDAK di-cache. Kalau gagal karena offline, biarkan request itu
     gagal secara normal -> app.js/estate2-addons.js yang menangani
     (mis. menaruh perubahan ke antrean offline lokal).
   - Naik versi CACHE_NAME setiap kali file app di-deploy ulang (WAJIB,
     terutama utk aset cache-first di atas).
   ===================================================================== */

const CACHE_NAME = 'estate2-shell-v21';
const STATIC_ASSETS = [
  './manifest.json',
  './logo.png',
  './petak-boundaries.geojson',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {
      // Kalau salah satu file gagal (mis. logo.png belum ada), jangan gagalkan
      // seluruh instalasi -> cache file lain satu-satu.
      return Promise.allSettled(STATIC_ASSETS.map((url) => cache.add(url)));
    }))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

function isSupabaseRequest(url){
  return url.hostname.endsWith('.supabase.co');
}
function isStaticAsset(url){
  return STATIC_ASSETS.some((path) => url.pathname.endsWith(path.replace('./', '/')));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if(req.method !== 'GET') return; // POST/PATCH/DELETE (tulis data) tidak pernah dicache

  const url = new URL(req.url);
  if(isSupabaseRequest(url)) return; // biarkan lewat langsung ke network, jangan dicampuri

  // Aset statis jarang berubah -> cache-first (cepat, hemat data, bisa offline).
  if(url.origin === self.location.origin && isStaticAsset(url)){
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if(res && res.status === 200){
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // File app (html/js/css sendiri + CDN script/style) -> network-first,
  // biar update fitur langsung kepakai begitu online. Cache cuma jadi
  // fallback offline, bukan sumber utama.
  event.respondWith(
    fetch(req).then((res) => {
      if(res && res.status === 200 && (url.origin === self.location.origin || req.destination === 'script' || req.destination === 'style')){
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => {
      return caches.match(req).then((cached) => {
        if(cached) return cached;
        // Offline & tidak ada di cache: untuk navigasi halaman, jatuhkan ke index.html
        if(req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'Offline' });
      });
    })
  );
});

/* =====================================================================
   WEB PUSH — tampilkan notifikasi sistem meski app/tab sedang tertutup.
   Payload dikirim oleh Supabase Edge Function `send-push` sebagai JSON:
   { title, body, url, tag? }
   ===================================================================== */
self.addEventListener('push', (event) => {
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch(e){ data = { title: 'Notifikasi', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Sistem Informasi Terpadu Estate 2';
  const options = {
    body: data.body || '',
    icon: './logo.png',
    badge: './logo.png',
    tag: data.tag || undefined, // notif dgn tag sama akan saling menimpa, bukan menumpuk
    data: { url: data.url || './index.html' },
    vibrate: [80, 40, 80],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './index.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.registration.scope));
      if(existing){
        existing.postMessage({ type: 'push-notification-click', url: targetUrl });
        return existing.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
