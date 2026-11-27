/* Shortcuts to the pages, from anywhere (KEYS 'page.*', his to change): Shift and the tab's place, Shift+1 Today,
   Shift+2 Reviews, Shift+3 Cards, Shift+4 Essays, Shift+5 Progress, and Shift+B Reviews › Browse (Shift+6, the Tutor, is in
   tutor/main.ts). They step aside while he types in a field, over a dialog other than Settings (which closes for them), and
   for any key a page used first: this listens last, on window, and lets a handled key (defaultPrevented) be (KEYS.free). */
import { KEYS } from './keys.ts';
import { SETTINGS } from './settings.ts';
import { swipe } from './swipe.ts';

declare const VIEWS: string[];
declare const VIEW: string;
declare function setView(v: string): void;
declare function sfx(k: string): void;

const TO: [string, string, string?][] = [
  ['page.today', 'today'],
  ['page.reviews', 'reviews', 'review'],
  ['page.browse', 'reviews', 'browse'],
  ['page.cards', 'cards'],
  ['page.essays', 'essays'],
  ['page.progress', 'progress'],
];
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

addEventListener('keydown', (e) => {
  const hit = TO.find(([id]) => KEYS.is(e, id));
  if (!hit || !VIEWS.includes(hit[1]) || !KEYS.free(e)) return;
  e.preventDefault();
  SETTINGS.close(true);
  const [, view, sub] = hit;
  if (view !== VIEW) {
    try {
      sfx('tap');
    } catch {}
    setView(view);
  }
  // inside Reviews: Review or Browse, through the tab's own switch (review/main.ts), as a click would
  const b = sub && document.querySelector<HTMLElement>(`#view-reviews [data-v="${sub}"]`);
  if (b && b.getAttribute('aria-current') !== 'true') b.click();
});

/* Back and Forward (KEYS 'back' ⌘[ and 'forward' ⌘], his to change): the pages he was on, the way a browser keeps them,
   inside Plus. A place is a page, plus where on it: Reviews' Review, Browse or Card designs; the word on the Cards page.
   Pages say they moved with BUS 'view' (core.js) and 'place' (review/main.ts, cards.js); one tick later the place is
   noted, so a page and its inner place count as one step. The browser's own ⌘[ and ⌘] (leave the app) never run here.
   While he types in a field or a dialog is open the keys do nothing. */
declare const BUS: { on(e: string, f: (...a: any[]) => void): void };
declare const CD: { cur?: string | null } | undefined;
declare function openCard(word: string, src?: string, opt?: { write?: boolean }): void;
declare function cardOf(word: string): { dropped?: boolean } | null | undefined;
type Place = { v: string; sub: string };
const PLACES: Place[] = [];
let at = -1;
let moving = false;
let noteT = 0;
function here(): Place | null {
  if (!VIEW) return null;
  if (VIEW === 'reviews') return { v: VIEW, sub: document.querySelector<HTMLElement>('#view-reviews .rx')?.dataset.rx || 'review' };
  if (VIEW === 'cards') return { v: VIEW, sub: (typeof CD !== 'undefined' && CD?.cur) || '' };
  return { v: VIEW, sub: '' };
}
const same = (a: Place | undefined, b: Place) => !!a && a.v === b.v && a.sub === b.sub;
function note() {
  clearTimeout(noteT);
  noteT = window.setTimeout(() => {
    const p = here();
    if (moving || !p || same(PLACES[at], p)) return;
    // the Cards page's first paint has no word yet: that place becomes the word's
    if (PLACES[at]?.v === 'cards' && p.v === 'cards' && !PLACES[at].sub) PLACES[at] = p;
    else {
      PLACES.splice(at + 1);
      PLACES.push(p);
      if (PLACES.length > 60) PLACES.shift();
      at = PLACES.length - 1;
    }
  }, 0);
}
BUS.on('view', note);
BUS.on('place', note);
function step(d: number): boolean {
  const i = at + d;
  const p = PLACES[i];
  if (!p) return false;
  if (!VIEWS.includes(p.v)) {
    // a page that's gone (a switch went off): skip it
    PLACES.splice(i, 1);
    if (i < at) at--;
    return step(d);
  }
  at = i;
  moving = true;
  try {
    sfx('tap');
  } catch {}
  try {
    if (p.v === 'cards' && p.sub && typeof openCard === 'function' && !(typeof cardOf === 'function' && cardOf(p.sub)?.dropped)) openCard(p.sub, undefined, { write: false });
    else if (p.v !== VIEW) setView(p.v);
    const rx = (window as unknown as { RX_go?: (v: string) => void }).RX_go;
    if (p.v === 'reviews' && p.sub && rx) rx(p.sub);
  } finally {
    // the moves above note themselves a tick later; they aren't new places
    window.setTimeout(() => (moving = false), 0);
  }
  return true;
}
addEventListener(
  'keydown',
  (e) => {
    const d = KEYS.is(e, 'back') ? -1 : KEYS.is(e, 'forward') ? 1 : 0;
    if (!d) return;
    // never the browser's: it would leave Plus
    e.preventDefault();
    const t = e.target as HTMLElement | null;
    if (e.repeat || t?.closest?.(TYPING) || document.querySelector('dialog[open]')) return;
    step(d);
  },
  true,
);

/* The same steps by two fingers sideways on a trackpad (swipe.ts): fingers right, back; left, forward. Never over a dialog,
   a field, the Tutor pane (its own swipe sends it away) or anything that scrolls sideways (the Cards page's word tabs,
   Browse's table on a phone, an essay sheet), and never when the page itself is wider than the window. The browser's
   own swipe (leave Plus) is off on the page (kit.css: overscroll-behavior-x). While the fingers move the page leans a
   little their way; a step brings the next place in from that side. Reduced motion: only a fade. */
const SW = swipe();
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const viewEl = () => (VIEW ? document.getElementById('view-' + VIEW) : null);
function scrollsX(t: Element | null) {
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth + 1) return true;
  for (let n = t; n && n !== document.body && n !== root; n = n.parentElement) {
    if (n.scrollWidth <= n.clientWidth + 1) continue;
    const o = getComputedStyle(n).overflowX;
    if (o === 'auto' || o === 'scroll') return true;
  }
  return false;
}
let leanEl: HTMLElement | null = null, leanT = 0;
function lean(px: number) {
  const v = viewEl();
  if (leanEl && leanEl !== v) leanEl.style.translate = '';
  leanEl = v;
  if (v && !REDUCED.matches) v.style.translate = px ? `${px}px 0` : '';
}
function unlean() {
  const v = leanEl;
  leanEl = null;
  if (!v || !v.style.translate) return;
  const from = v.style.translate;
  v.style.translate = '';
  v.animate([{ translate: from }, { translate: '0 0' }], { duration: 180, easing: 'ease-out' });
}
addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) return; // a pinch
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerWidth : 1;
    const dx = e.deltaX * k, dy = e.deltaY * k;
    const t = e.target as Element | null;
    const side = Math.abs(dx) > Math.abs(dy);
    const blocked = side && (e.defaultPrevented || !!document.querySelector('dialog[open]') || KEYS.typing(t) || !!t?.closest?.('#tutor') || scrollsX(t));
    const f = SW.feed(dx, dy, e.timeStamp, blocked);
    if (!f.mine) return;
    e.preventDefault();
    clearTimeout(leanT);
    leanT = window.setTimeout(unlean, SW.quiet);
    if (!f.d) return lean(f.acc ? -Math.sign(f.acc) * Math.min(Math.abs(f.acc) / SW.need, 1) * 10 : 0);
    lean(0);
    leanEl = null;
    if (!step(f.d)) return;
    // the next place comes in from the side the fingers went (after the page has switched)
    window.setTimeout(() => {
      const v = viewEl();
      if (!v) return;
      const x = (f.d < 0 ? -1 : 1) * 16;
      v.animate(REDUCED.matches ? [{ opacity: 0.6 }, { opacity: 1 }] : [{ translate: `${x}px 0`, opacity: 0.6 }, { translate: '0 0', opacity: 1 }], { duration: 220, easing: 'cubic-bezier(.22,.9,.24,1)' });
    }, 0);
  },
  { passive: false },
);
