/* Shortcuts to the pages, from anywhere (KEYS 'page.*', his to change): Shift and the tab's place, Shift+1 Today,
   Shift+2 Reviews, Shift+3 Cards, Shift+4 Essays, Shift+5 Progress, and Shift+B Reviews › Browse (Shift+6, the Tutor, is in
   tutor/main.ts). They step aside while he types in a field, over a dialog other than Settings (which closes for them), and
   for any key a page used first: this listens last, on window, and lets a handled key (defaultPrevented) be (KEYS.free). */
import { KEYS } from './keys.ts';
import { SETTINGS } from './settings.ts';
import { type Place, placeHash, parsePlace, samePlace, entryFor } from './place.ts';

declare const VIEWS: string[];
declare const VIEW: string;
declare function setView(v: string, first?: boolean): void;
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

/* Back and Forward are the browser's own (place.ts): each place he goes to (a page; Reviews' Review, Browse or Card
   designs; the word on the Cards page) is an entry in the browser's history with its address (#reviews/browse,
   #cards/進行), so its buttons, ⌘[ ⌘] and two fingers on a trackpad go through his places with the browser's own
   animation, and a reload or a link lands on the place. Pages say they moved with BUS 'view' (core.js) and 'place'
   (review/main.ts, cards.js); one tick later the place is written down, so a page and its inner place are one entry.
   Dialogs (Settings, Edit, the Tutor pane) are no entries: Back closes an open one and goes back a place. */
declare const BUS: { on(e: string, f: (...a: any[]) => void): void };
declare const CD: { cur?: string | null; open?: string | null; pend?: unknown } | undefined;
declare function openCard(word: string, src?: string, opt?: { write?: boolean }): void;
declare function cardOf(word: string): { dropped?: boolean } | null | undefined;
let restoring = false;
let noteT = 0;
function here(): Place | null {
  if (!VIEW) return null;
  if (VIEW === 'reviews') {
    // the tab not drawn yet: its place comes once it is (go() in review/main.ts)
    const rx = document.querySelector<HTMLElement>('#view-reviews .rx')?.dataset.rx;
    return rx ? { v: VIEW, sub: rx } : null;
  }
  if (VIEW === 'cards') return { v: VIEW, sub: (typeof CD !== 'undefined' && CD?.cur) || '' };
  return { v: VIEW, sub: '' };
}
const entry = (): Place | null => (history.state as { cbp?: Place } | null)?.cbp ?? null;
function write(p: Place, how: 'replace' | 'push') {
  const url = location.pathname + location.search + placeHash(p);
  if (how === 'push') history.pushState({ cbp: p }, '', url);
  else history.replaceState({ ...(history.state || {}), cbp: p }, '', url);
}
function note() {
  clearTimeout(noteT);
  noteT = window.setTimeout(() => {
    const p = here();
    if (!p) return;
    const how = entryFor(entry(), p, restoring);
    if (how !== 'none') write(p, how);
  }, 0);
}
BUS.on('view', note);
BUS.on('place', note);
function land(p: Place) {
  restoring = true;
  try {
    SETTINGS.close(true);
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    if (p.v === 'cards' && p.sub && typeof openCard === 'function' && !(typeof cardOf === 'function' && cardOf(p.sub)?.dropped)) openCard(p.sub, undefined, { write: false });
    else if (p.v !== VIEW) setView(p.v);
    const rx = (window as unknown as { RX_go?: (v: string) => void }).RX_go;
    if (p.v === 'reviews' && rx) rx(p.sub || 'review');
  } finally {
    // the moves above write themselves down a tick later, over this entry, not as new ones
    window.setTimeout(() => (restoring = false), 0);
  }
}
addEventListener('popstate', (e) => {
  const st = (e.state as { cbp?: Place } | null)?.cbp;
  const p = st ?? parsePlace(location.hash);
  // a link to "#" or an address that isn't a place: stay where he is
  if (!VIEWS.includes(p.v)) {
    const h = here();
    if (h) write(h, 'replace');
    return;
  }
  if (samePlace(here(), p)) return;
  try {
    sfx('tap');
  } catch {}
  land(p);
});

/* The first page (boot.js): the address's place (#cards/進行, #reviews/browse, or ?view=), else Today. Reviews opens on
   its part through sessionStorage 'cbp-rx' (review/main.ts reads it once the collection is ready). */
function start() {
  const q = new URLSearchParams(location.search).get('view');
  const p = parsePlace(location.hash || (q ? '#' + q : ''));
  if (p.v === 'reviews')
    try {
      sessionStorage.setItem('cbp-rx', p.sub || 'review');
    } catch {}
  if (p.v === 'cards' && p.sub && typeof CD !== 'undefined' && CD) {
    // shown, not written: a reload is no reason to spend on a card
    CD.cur = CD.open = p.sub;
    CD.pend = { opt: { write: false } };
  }
  setView(p.v, true);
}
Object.assign(window, { GO_start: start });
