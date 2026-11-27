// The board's offline worker (/plus): the page, the board's and the reviews' scripts, fonts, and the cards' pictures and
// sounds, kept so reviews work with no signal. Network first for the page and code (always the newest when there's
// signal), the cache when there's none, or when the network is slow (3 s) or answers with an error. The cards themselves
// live in IndexedDB (src/cbp/review/store.ts).
const V = 'cbp-plus-3';
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
// network first, but a slow or failing network (a weak signal, a 5xx) doesn't hold the page: after 3 s, or on an error
// status, the kept copy answers; the network's answer still lands in the cache when it comes, so a deploy reaches him
const fresh = (req, e) => {
  const net = fetch(req, { cache: 'no-cache' }).then(async (res) => {
    if (res.ok) await (await caches.open(V)).put(req, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const slow = new Promise((ok) => setTimeout(ok, 3000, 'slow'));
  return Promise.race([net.catch(() => null), slow]).then(async (res) => {
    if (res && res !== 'slow' && res.ok) return res;
    const hit = await caches.open(V).then((c) => c.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    // nothing kept: the network's answer after all, whatever it is
    if (res === 'slow') return net.catch(() => Response.error());
    return res ?? Response.error();
  });
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/plus/media/')) return e.respondWith(cacheFirst(req, 'cbp-media'));
    // the pinyin lexicon: big and versioned (?v=), so kept once and read from the device after that
    if (u.pathname === '/plus/pinyin.txt') return e.respondWith(cacheFirst(req, 'cbp-pinyin'));
    if (u.pathname === '/plus' || u.pathname === '/plus.js' || (u.pathname.startsWith('/plus/') && u.pathname !== '/plus/sw.js')) return e.respondWith(fresh(req, e));
    return;
  }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') return e.respondWith(cacheFirst(req, 'cbp-fonts'));
});

// Habit: the evening nudge (src/cbp/push.ts sends it; Settings › Habit turns it on for this phone). A tap opens the
// board, or brings it forward when it's already open.
self.addEventListener('push', (e) => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch {
    m = { body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(self.registration.showNotification(m.title || 'Chinese', { body: m.body || '', tag: m.tag || 'nudge', icon: '/plus/icon-192.png', badge: '/plus/icon-192.png', data: { url: m.url || '/plus' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/plus', location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find((x) => new URL(x.url).pathname.startsWith('/plus'));
      return c ? c.focus() : self.clients.openWindow(url);
    }),
  );
});
// (end Habit)
