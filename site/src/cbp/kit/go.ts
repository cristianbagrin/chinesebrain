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
