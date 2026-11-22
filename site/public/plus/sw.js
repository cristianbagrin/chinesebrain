// The review page's offline worker (/plus/review): the page, its script and fonts, and the cards' pictures and sounds,
// kept so reviews work with no signal. The cards themselves live in IndexedDB (src/cbp/review/store.ts).
const V = 'cbp-review-1';
const SHELL = ['/plus/review', '/plus/anki.js', '/plus/anki-gate.js', '/plus/anki.css', '/plus/review.webmanifest', '/plus/icon-192.png', '/apple-touch-icon.png', '/icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('cbp-review-') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const cacheFirst = async (req, name) => {
  const c = await caches.open(name);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') c.put(req, res.clone());
  return res;
};
const fresh = async (req) => {
  const c = await caches.open(V);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch {
    return (await c.match(req, { ignoreSearch: true })) ?? Response.error();
  }
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/plus/media/')) return e.respondWith(cacheFirst(req, 'cbp-media'));
    if (u.pathname === '/plus/review' || SHELL.includes(u.pathname)) return e.respondWith(fresh(req));
    return;
  }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') return e.respondWith(cacheFirst(req, 'cbp-fonts'));
});
