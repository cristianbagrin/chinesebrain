/* Shortcuts to the pages, from anywhere (KEYS 'page.*', his to change): Shift and the page's first letter, Shift+T Today,
   Shift+R Reviews, Shift+B Reviews › Browse, Shift+C Cards, Shift+E Essays, Shift+P Progress (Shift+A, the Tutor, is in
   tutor/main.ts). They step aside while he types in a field, over a dialog other than Settings (which closes for them), and
   for any key a page used first: this listens last, on window, and lets a handled key (defaultPrevented) be (KEYS.free). */
import { KEYS } from './keys.ts';
import { SETTINGS } from './settings.ts';

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
function step(d: number) {
  const i = at + d;
  const p = PLACES[i];
  if (!p) return;
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
