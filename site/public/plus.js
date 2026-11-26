// Chinese Brain Plus. Shows nothing until the server says this account has the `plus` switch; anyone else gets the
// not-found page, so the address gives nothing away. Then the board's scripts load, in order (scripts/cbp-board.py).
// With no signal it opens with the switches this device last saw, so the reviews (kept on the device) still work.
(async () => {
  const board = document.currentScript.dataset.board.split(' ');
  let token = '';
  try {
    token = localStorage.getItem('cb-token') ?? '';
  } catch {}
  // signed out: sign in, then come back; signed in without the switch: nothing here
  const signIn = () => location.replace('/account?next=' + encodeURIComponent(location.pathname));
  if (!token) return signIn();
  const res = await fetch('/api/plus/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
  if (res?.status === 401) return signIn();
  let flags = null;
  if (res?.ok) {
    ({ flags = [] } = await res.json().catch(() => ({})));
    try {
      localStorage.setItem('cbp-flags', JSON.stringify(flags));
    } catch {}
  } else if (!res) {
    try {
      flags = JSON.parse(localStorage.getItem('cbp-flags') ?? 'null');
    } catch {}
  }
  if (!flags) return location.replace('/404');
  const reviews = flags.includes('plus.anki');
  // no signal: straight to the reviews, the part that works offline
  if (!res && reviews && !location.hash) history.replaceState(null, '', '#reviews');
  // the board's scripts, the reviews tab (plus/anki.js) just before boot.js so the board can open on it, then the
  // review card that hooks into the Cards page (plus/review.js)
  const srcs = board.map((f) => `/plus/board/${f}`);
  // the shared parts (plus/kit.js: settings, shortcuts, sound, press and hold, pinyin) right after core.js
  srcs.splice(srcs.indexOf('/plus/board/js/core.js') + 1, 0, '/plus/kit.js?v=11');
  if (reviews) srcs.splice(srcs.indexOf('/plus/board/js/boot.js'), 0, '/plus/anki.js?v=13');
  // the tutor (plus/tutor.js), behind its own switch
  const tutor = flags.includes('plus.tutor');
  if (tutor) srcs.splice(srcs.indexOf('/plus/board/js/boot.js'), 0, '/plus/tutor.js?v=10');
  for (const src of [...srcs, '/plus/review.js']) {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.body.append(s);
  }
  const link = (rel, href) => {
    const l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    document.head.append(l);
  };
  link('stylesheet', '/plus/review.css?v=3');
  if (tutor) link('stylesheet', '/plus/tutor.css?v=8');
  if (reviews) {
    link('stylesheet', '/plus/anki.css?v=13');
    link('manifest', '/plus/app.webmanifest');
  }
  document.documentElement.classList.remove('locked');
})();
