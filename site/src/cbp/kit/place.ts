/* Where he is in Plus, as the address shows it (go.ts): a page, plus where on it. Reviews' Review, Browse or Card designs;
   the word on the Cards page. #today, #reviews, #reviews/browse, #reviews/designs, #cards, #cards/進行, #essays, #progress.
   Each place is a real entry in the browser's history, so its back and forward (buttons, ⌘[ ⌘], two fingers on a
   trackpad) go through his places with the browser's own animation, and a reload or a link lands on the place. */
export type Place = { v: string; sub: string };

export function placeHash(p: Place): string {
  if (p.v === 'reviews') return p.sub && p.sub !== 'review' ? `#reviews/${p.sub}` : '#reviews';
  if (p.v === 'cards') return p.sub ? `#cards/${encodeURIComponent(p.sub)}` : '#cards';
  return '#' + p.v;
}

export function parsePlace(hash: string): Place {
  const h = String(hash || '').replace(/^#/, '');
  const i = h.indexOf('/');
  const v = i < 0 ? h : h.slice(0, i);
  let sub = i < 0 ? '' : h.slice(i + 1);
  try {
    sub = decodeURIComponent(sub);
  } catch {}
  if (v === 'reviews') return { v, sub: ['browse', 'designs'].includes(sub) ? sub : 'review' };
  if (v === 'cards') return { v, sub: sub.trim() };
  return { v, sub: '' };
}

export const samePlace = (a: Place | null | undefined, b: Place | null | undefined) => !!a && !!b && a.v === b.v && a.sub === b.sub;

/** What to do with the browser's history when the app lands on `now` and the current entry holds `was`:
    nothing, replace the entry (the first place, the Cards page getting its word, or a place reached by Back/Forward)
    or push a new one. */
export function entryFor(was: Place | null | undefined, now: Place, restoring: boolean): 'none' | 'replace' | 'push' {
  if (samePlace(was, now)) return 'none';
  if (!was || restoring) return 'replace';
  if (was.v === 'cards' && now.v === 'cards' && !was.sub) return 'replace';
  return 'push';
}
