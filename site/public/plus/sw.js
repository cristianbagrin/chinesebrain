// The board's offline worker (/plus): the page, the board's and the reviews' scripts, fonts, and the cards' pictures and
// sounds, kept so reviews work with no signal. Network first for the page and code (always the newest when there's
// signal), the cache when there's none. The cards themselves live in IndexedDB (src/cbp/review/store.ts).
const V = 'cbp-plus-2';
const SHELL = ['/plus', '/plus.js', '/plus/anki.js', '/plus/anki.css', '/plus/review.js', '/plus/review.css', '/plus/runtime.js', '/plus/kit.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => /^cbp-(review|plus)-/.test(k) && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
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
    const res = await fetch(req, { cache: 'no-cache' });
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
    // the pinyin lexicon: big and versioned (?v=), so kept once and read from the device after that
    if (u.pathname === '/plus/pinyin.txt') return e.respondWith(cacheFirst(req, 'cbp-pinyin'));
    if (u.pathname === '/plus' || u.pathname === '/plus.js' || (u.pathname.startsWith('/plus/') && u.pathname !== '/plus/sw.js')) return e.respondWith(fresh(req));
    return;
  }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') return e.respondWith(cacheFirst(req, 'cbp-fonts'));
});
