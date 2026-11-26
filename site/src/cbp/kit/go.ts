/* Shortcuts to the pages, from anywhere (KEYS 'go.*', his to change): T Today, C Cards, R Reviews, B Reviews › Browse.
   They step aside while he types in a field, while a dialog is open, and for any key a page used first (a test's B and C
   are its choices): this listens last, on window, and lets a handled key (defaultPrevented) be. */
import { KEYS } from './keys.ts';

declare const VIEWS: string[];
declare const VIEW: string;
declare function setView(v: string): void;
declare function sfx(k: string): void;

const TO: [string, string, string?][] = [
  ['go.today', 'today'],
  ['go.cards', 'cards'],
  ['go.reviews', 'reviews', 'review'],
  ['go.browse', 'reviews', 'browse'],
];
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing || e.repeat) return;
  const t = e.target as HTMLElement | null;
  if (t?.closest?.(TYPING) || document.querySelector('dialog[open]')) return;
  const hit = TO.find(([id]) => KEYS.is(e, id));
  if (!hit || !VIEWS.includes(hit[1])) return;
  e.preventDefault();
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
