// Chinese Brain Plus, Stage 5: the Tutor, a pane that slides in from the right on any page of the board at /plus (see
// "the pane" below). plus.js loads this before the board's boot.js. A scene that needs this week's words, he answers first, the tutor challenges after
// (src/cbp/tutor.ts on the server). Any ⟦word⟧ the tutor gives, or any Chinese he selects in the chat, becomes a
// card with one tap: the Cards page's card maker opens on it. Conversations are kept in the database (`tutor`).
declare const KEYS: { is(e: KeyboardEvent, id: string): boolean; free(e: KeyboardEvent): boolean };
declare const SETTINGS: { close(now?: boolean): void };
declare function setView(v: string, first?: boolean): void;
declare function openCard(word: string, src: string, opt?: Record<string, unknown>): void;
declare function sfx(k: string): void;
declare const BUS: { on(e: string, f: (...a: any[]) => void): void };
declare const RUBY: { on(el: Element | null): Promise<void>; shown(): boolean };

type Msg = { role: 'user' | 'assistant'; content: string };
type Mode = 'scene' | 'ask';
type Talk = { id: string; started: string; msgs: Msg[]; mode?: Mode };

const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const token = () => {
  try {
    return localStorage.getItem('cb-token') ?? '';
  } catch {
    return '';
  }
};
async function api(path: string, body?: unknown) {
  const r = await fetch('/api/plus/' + path, body === undefined ? { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' } : { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'It didn’t come through.');
  return j;
}

// ---------- the pane: off screen until he calls it ----------
/* Laptop: the bottom-right corner is a hot corner. The pointer there shows a small round button; a click slides the
   Tutor in from the right, over the page (the page stays usable). A click elsewhere sends it away, unless it's pinned.
   Phone: a swipe left from the right edge pulls it in, full height. Either way a swipe right (finger, mouse drag on its
   top bar, or two fingers on a trackpad), Escape or × sends it away, and the KEYS 'page.tutor' shortcut (Shift+6) toggles it. Hidden,
   it keeps everything: the conversation, the mode, what he was typing. */
const PANE = document.createElement('aside');
PANE.className = 'tu-pane';
PANE.id = 'tutor';
PANE.setAttribute('aria-label', 'Tutor');
PANE.inert = true;
const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6M10 4v6l-3 4h10l-3-4V4M12 14v6"/></svg>';
const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
PANE.innerHTML = `<div class="tu-top">
    <div class="tu-mode" role="radiogroup" aria-label="Mode">
      <button type="button" role="radio" data-mode="scene">Scene</button>
      <button type="button" role="radio" data-mode="ask">Ask</button>
    </div>
    <button type="button" class="tu-new">New</button>
    <button type="button" class="tu-ic tu-pin" aria-label="Pin" aria-pressed="false">${PIN}</button>
    <button type="button" class="tu-ic tu-x" aria-label="Close">${X}</button>
  </div>
  <div class="tu-scroll"><div class="tu">
    <div class="tu-log" aria-live="polite"></div>
    <button type="button" class="tu-card" hidden>Card it</button>
  </div></div>
  <div class="tu-dock">
    <form class="tu-in">
      <textarea rows="1" lang="zh-Hant" aria-label="Your answer"></textarea>
      <button type="submit" class="tu-send" aria-label="Send"></button>
    </form>
  </div>`;
const FAB = document.createElement('button');
FAB.type = 'button';
FAB.className = 'tu-fab';
FAB.setAttribute('aria-label', 'Tutor');
FAB.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/></svg>';
document.body.append(PANE, FAB);
const LOG = $('.tu-log', PANE), FORM = $<HTMLFormElement>('.tu-in', PANE), BOX = $<HTMLTextAreaElement>('textarea', PANE);
const CARD = $<HTMLButtonElement>('.tu-card', PANE), SCROLL = $('.tu-scroll', PANE), PINB = $('.tu-pin', PANE);
// the box grows with what he types, up to a few lines, and shrinks back when it's sent
function fit() {
  BOX.style.height = 'auto';
  BOX.style.height = `${Math.min(BOX.scrollHeight, innerHeight * 0.4)}px`;
  FORM.classList.toggle('empty', !BOX.value.trim());
}
FORM.classList.add('empty');
BOX.addEventListener('input', fit);

const FINE = matchMedia('(hover: hover) and (pointer: fine)');
const WIDE = matchMedia('(min-width: 900px)');
const isOpen = () => PANE.classList.contains('open');
// the pin is remembered on this device (versioned, so a later change to what's saved starts clean)
const PIN_V = 1;
let pinned = (() => {
  try {
    const p = JSON.parse(localStorage.getItem('tutor-pane') ?? 'null');
    return p?.v === PIN_V && p.pin === true;
  } catch {
    return false;
  }
})();
function setPin(on: boolean) {
  pinned = on;
  PINB.setAttribute('aria-pressed', String(on));
  try {
    localStorage.setItem('tutor-pane', JSON.stringify({ v: PIN_V, pin: on }));
  } catch {}
}
function openPane(focus = true) {
  PANE.style.transform = '';
  PANE.classList.remove('drag');
  PANE.inert = false;
  PANE.classList.add('open');
  FAB.classList.remove('show');
  document.documentElement.classList.add('tu-on');
  if (!loaded) load();
  // the keyboard only where there's a real one: on a phone it would cover the conversation
  if (focus && FINE.matches) setTimeout(() => BOX.focus({ preventScroll: true }), 60);
}
function closePane() {
  PANE.style.transform = '';
  PANE.classList.remove('drag', 'open');
  CARD.hidden = true;
  if (PANE.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  PANE.inert = true;
  document.documentElement.classList.remove('tu-on');
  if (pinned) setPin(false);
}
const toggle = () => (isOpen() ? closePane() : openPane());
PINB.addEventListener('click', () => {
  try {
    sfx('tap');
  } catch {}
  setPin(!pinned);
});
$('.tu-x', PANE).addEventListener('click', () => {
  try {
    sfx('tap');
  } catch {}
  closePane();
});
FAB.addEventListener('click', () => {
  try {
    sfx('tap');
  } catch {}
  openPane();
});

// the hot corner: the pointer in the bottom-right corner shows the button; leaving the corner hides it again
let fabT = 0;
addEventListener(
  'pointermove',
  (e) => {
    if (e.pointerType !== 'mouse' || isOpen()) return;
    const near = e.clientX > innerWidth - 96 && e.clientY > innerHeight - 96;
    const around = e.clientX > innerWidth - 200 && e.clientY > innerHeight - 200;
    if (near) {
      clearTimeout(fabT);
      FAB.classList.add('show');
    } else if (!around && FAB.classList.contains('show')) {
      clearTimeout(fabT);
      fabT = window.setTimeout(() => FAB.classList.remove('show'), 250);
    }
  },
  { passive: true },
);
document.documentElement.addEventListener('pointerleave', () => FAB.classList.remove('show'));

// a click on the page sends an unpinned pane away (not one inside a dialog it opened, nor on the button)
document.addEventListener(
  'pointerdown',
  (e) => {
    const t = e.target as Element;
    if (!isOpen() || pinned || PANE.contains(t) || FAB.contains(t) || t.closest?.('dialog') || swiping) return;
    closePane();
  },
  true,
);
// Escape: away, from inside the pane or from a page with nothing else to close
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !isOpen() || e.defaultPrevented || document.querySelector('dialog[open]')) return;
  const a = document.activeElement;
  if (PANE.contains(a) || !a || a === document.body) {
    e.preventDefault();
    closePane();
  }
});
// the shortcut (KEYS 'page.tutor', Shift+6), like the page keys (kit/go.ts): not while typing (its own box included), not
// over a dialog other than Settings (which closes for it), not for a key a page used
addEventListener('keydown', (e) => {
  if (!KEYS.is(e, 'page.tutor') || !KEYS.free(e)) return;
  e.preventDefault();
  SETTINGS.close(true);
  toggle();
});

// ---------- swipes: the pane follows the finger 1:1; on release it goes where the distance or the flick says ----------
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
let swiping = false;
const paneW = () => PANE.offsetWidth + 24;
/** Moves the pane to x px right of open (0 = open, paneW() = gone). */
function at(x: number) {
  PANE.classList.add('drag');
  PANE.style.transform = `translateX(${x}px)`;
}
/** Release: open or away, on distance (past 40%) or a flick (0.4 px/ms). */
function settle(x: number, v: number) {
  PANE.classList.remove('drag');
  const away = v > 0.4 || (v > -0.4 && x > paneW() * 0.4);
  if (away) closePane();
  else openPane(false);
}
type Track = { x0: number; y0: number; x: number; t: number; v: number; from: number; axis: '' | 'x' | 'y' };
let tr: Track | null = null;
const begin = (x: number, y: number, t: number, from: number): Track => ({ x0: x, y0: y, x, t, v: 0, from, axis: '' });
function step(x: number, y: number, t: number): boolean {
  if (!tr) return false;
  if (!tr.axis) {
    const dx = x - tr.x0, dy = y - tr.y0;
    if (Math.hypot(dx, dy) < 8) return false;
    tr.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
    if (tr.axis === 'y') return false;
    swiping = true;
    PANE.inert = false;
  }
  if (tr.axis !== 'x') return false;
  const dt = t - tr.t;
  if (dt > 0) tr.v = tr.v * 0.3 + ((x - tr.x) / dt) * 0.7;
  tr.x = x;
  tr.t = t;
  let p = tr.from + (x - tr.x0);
  // past open: a little give (rubber band), never further
  if (p < 0) p = -Math.sqrt(-p) * 2;
  at(Math.min(p, paneW()));
  return true;
}
function end(e?: Event) {
  // a finger that stopped before it lifted: no flick, only the distance counts
  if (tr?.axis === 'x') settle(tr.from + (tr.x - tr.x0), e && e.timeStamp - tr.t > 100 ? 0 : tr.v);
  else if (tr && !isOpen()) PANE.inert = true;
  tr = null;
  setTimeout(() => (swiping = false));
}
// a finger: from the right edge leftward to open (20px zone: Safari's own edge swipe is on the left), or anywhere on the
// open pane rightward to close
addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length !== 1 || document.querySelector('dialog[open]')) return;
    const p = e.touches[0];
    if (isOpen()) {
      if (PANE.contains(e.target as Node) && !(e.target as Element).closest('textarea')) tr = begin(p.clientX, p.clientY, e.timeStamp, 0);
    } else if (p.clientX > innerWidth - 20) tr = begin(p.clientX, p.clientY, e.timeStamp, paneW());
  },
  { passive: true },
);
addEventListener(
  'touchmove',
  (e) => {
    if (!tr) return;
    const p = e.touches[0];
    if (step(p.clientX, p.clientY, e.timeStamp) && e.cancelable) e.preventDefault();
    else if (tr.axis === 'y') tr = null;
  },
  { passive: false },
);
addEventListener('touchend', end);
addEventListener('touchcancel', end);
// a mouse: drag the pane's top bar to the right
$('.tu-top', PANE).addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0 || (e.target as Element).closest('button')) return;
  tr = begin(e.clientX, e.clientY, e.timeStamp, 0);
  const move = (m: PointerEvent) => step(m.clientX, m.clientY, m.timeStamp);
  const up = (u: PointerEvent) => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    end(u);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
});
// two fingers on a trackpad, sideways over the pane: it follows, and lets go when the fingers stop
let wx = 0, wT = 0, wv = 0;
PANE.addEventListener(
  'wheel',
  (e) => {
    if (!isOpen() || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    wx = Math.max(-12, wx - e.deltaX);
    wv = -e.deltaX / 16;
    at(wx);
    clearTimeout(wT);
    wT = window.setTimeout(() => {
      settle(wx, wv);
      wx = 0;
    }, 120);
  },
  { passive: false },
);

let talk: Talk | null = null, busy = false, loaded = false;
let mode: Mode = (() => {
  try {
    return localStorage.getItem('tutor-mode') === 'ask' ? 'ask' : 'scene';
  } catch {
    return 'scene';
  }
})();
// per mode: the conversation that was open, so switching back finds it
const talks: Partial<Record<Mode, Talk>> = {};
function showMode() {
  for (const b of PANE.querySelectorAll<HTMLElement>('.tu-mode button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  BOX.setAttribute('aria-label', mode === 'ask' ? 'Your question' : 'Your answer');
}

/** The tutor's text with ⟦words⟧ as buttons; Chinese in the Chinese font; **bold** kept as bold. */
const zhSpan = (t: string) => t.replace(/([\u3400-\u9fff，。？！、「」『』：；…（）]+)/g, '<span class="zh">$1</span>');
function rich(t: string) {
  return t
    .split('\n')
    .map((l) =>
      l.split(/(⟦[^⟧]{1,30}⟧)/).map((part) => {
        const w = part.match(/^⟦([^⟧]+)⟧$/)?.[1];
        if (w) return `<button type="button" class="tu-w" data-w="${esc(w)}">${esc(w)}</button>`;
        return zhSpan(esc(part.replace(/\*\*/g, '\u0001'))).replace(/\u0001([^\u0001]*)\u0001/g, '<b>$1</b>').replace(/\u0001/g, '');
      }).join(''),
    )
    .map((l) => `<p>${l}</p>`)
    .join('');
}
/* Nothing said yet (Ask before his question, a scene while its first lines come): no big empty page, the composer sits in
   the middle with the Scene/Ask switch over it; with the first line they go to their places (the switch to the top bar,
   the composer to the foot), the composer sliding there. */
const MODE = $('.tu-mode', PANE), TOP = $('.tu-top', PANE), DOCK = $('.tu-dock', PANE);
function blank(on: boolean) {
  if (PANE.classList.contains('blank') === on) return;
  const y0 = FORM.getBoundingClientRect().top;
  PANE.classList.toggle('blank', on);
  if (on) DOCK.prepend(MODE);
  else TOP.prepend(MODE);
  const dy = y0 - FORM.getBoundingClientRect().top;
  if (!dy || REDUCED.matches || !isOpen()) return;
  FORM.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.32,.72,0,1)' });
}
function paint() {
  const msgs = talk?.msgs ?? [];
  blank(!msgs.length);
  LOG.innerHTML = msgs.map((m) => `<div class="tu-m ${m.role === 'user' ? 'me' : 'them'}">${m.role === 'user' ? `<p class="zh pen">${esc(m.content).replace(/\n/g, '<br>')}</p>` : rich(m.content)}</div>`).join('') + (busy ? '<div class="tu-m them tu-wait"><p>…</p></div>' : '');
  // Settings › Pinyin shown: the pinyin above the characters (kit/ruby.ts)
  if (RUBY.shown()) LOG.querySelectorAll('.tu-m.them').forEach((m) => void RUBY.on(m));
  SCROLL.scrollTo({ top: SCROLL.scrollHeight, behavior: REDUCED.matches ? 'auto' : 'smooth' });
  BOX.disabled = busy || !talk;
  FORM.classList.toggle('off', busy || !talk);
}
async function save() {
  if (!talk) return;
  await api('db', { col: 'tutor', id: talk.id, op: 'set', data: talk }).catch(() => null);
}
async function turn() {
  if (!talk) return;
  busy = true;
  paint();
  try {
    const r = await api('tutor', { messages: talk.msgs, mode: talk.mode ?? 'scene', id: talk.id });
    talk.msgs.push({ role: 'assistant', content: r.text });
    save();
  } catch (e) {
    talk.msgs.push({ role: 'assistant', content: `(${(e as Error).message})` });
  } finally {
    busy = false;
    paint();
    if (isOpen() && FINE.matches) BOX.focus({ preventScroll: true });
  }
}
async function fresh() {
  const now = new Date();
  talk = talks[mode] = { id: now.toISOString().replace(/[^0-9]/g, '').slice(0, 14), started: now.toISOString(), msgs: [], mode };
  // a scene opens with the tutor's lines; Ask waits for his question
  if (mode === 'scene') await turn();
  else paint();
}
async function load() {
  loaded = true;
  try {
    const list = (await api('db?col=tutor')) as { id: string; data: Talk }[];
    // a conversation from today carries on (the last of each mode); an older one stays in the database
    for (const { data } of list.sort((a, b) => (a.id < b.id ? -1 : 1)))
      if (data && Date.now() - Date.parse(data.started) < 18 * 3600_000 && data.msgs?.length) talks[data.mode ?? 'scene'] = data;
  } catch {}
  showMode();
  if (talks[mode]) {
    talk = talks[mode]!;
    return paint();
  }
  fresh();
}

FORM.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = BOX.value.trim();
  if (!t || busy || !talk) return;
  BOX.value = '';
  fit();
  talk.msgs.push({ role: 'user', content: t });
  turn();
});
BOX.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    FORM.requestSubmit();
  }
});
$('.tu-new', PANE).addEventListener('click', () => !busy && fresh());
$('.tu-mode', PANE).addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode as Mode | undefined;
  if (!m || m === mode || busy) return;
  mode = m;
  try {
    localStorage.setItem('tutor-mode', m);
  } catch {}
  showMode();
  if (talks[m]) {
    talk = talks[m]!;
    paint();
  } else fresh();
  if (FINE.matches) BOX.focus({ preventScroll: true });
});

// one tap: a marked word, or the Chinese he selected, goes to the card maker
function card(w: string) {
  w = w.replace(/[^㐀-鿿]/g, '');
  if (!w) return;
  try {
    sfx('tap');
  } catch {}
  CARD.hidden = true;
  // the card maker needs the page: a pane that isn't pinned (and the phone's, which covers it) steps aside
  if (!pinned || !WIDE.matches) closePane();
  setView('cards');
  openCard(w, 'tutor');
}
LOG.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.tu-w');
  if (b) card(b.dataset.w!);
});
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  const t = s && !s.isCollapsed && LOG.contains(s.anchorNode) ? s.toString().replace(/[^㐀-鿿]/g, '') : '';
  if (!t || t.length > 12) return void (CARD.hidden = true);
  const r = s!.getRangeAt(0).getBoundingClientRect(), box = $('.tu', PANE).getBoundingClientRect();
  CARD.dataset.w = t;
  CARD.hidden = false;
  // kept inside the column: past the screen's edge it made the page wider, and an iPhone zoomed out mid-selection
  const half = CARD.offsetWidth / 2, x = r.left - box.left + r.width / 2;
  CARD.style.left = `${Math.max(half, Math.min(box.width - half, x))}px`;
  CARD.style.top = `${r.top - box.top - 44}px`;
});
CARD.addEventListener('pointerdown', (e) => e.preventDefault());
CARD.addEventListener('click', () => card(CARD.dataset.w ?? ''));

BUS.on('lab', (id: string) => id === 'pinyin' && loaded && paint());
// pinned last time (on a wide screen): it's there again; an old link to the Tutor tab opens it too
if ((pinned && WIDE.matches) || location.hash === '#tutor') openPane(false);
if (pinned) PINB.setAttribute('aria-pressed', 'true');
