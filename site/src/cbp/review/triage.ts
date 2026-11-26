// Too easy and too hard: which cards are, and why. Pure (tests/cbp-triage.test.ts); the review tab (main.ts) shows the
// result on the end screen and in Browse, with one tap to act on each word.
//
// A card is too hard when (first match wins, the flag he set by hand before anything worked out):
//   red        he flagged it red
//   leech      it lapsed `th` times (Anki's leech threshold) or more, or the note is tagged leech and it lapsed twice
//   again      Again three times running, or 2 of its last 4 answers Again with 3+ lapses
// A card is too easy when:
//   green      he flagged it green
//   easy3      Easy three times running on a review card, each answered in under FAST ms. Easy alone isn't enough: Easy
//              is his usual "got it" (3 of 4 answers on Nov 27; Easy x3 matched 754 cards, the fast ones 33).
// Hard wins over easy. Suspended cards are left out (he retired or combined them), except a leech the scheduler
// suspended. A word he waved off (`seen`, ms) comes back only for something new after that: a review streak counts its
// answers since then, a leech needs a lapse since then; flags were cleared when he waved it off.
import type { Card } from '../sched.ts';

export type Ease = 'easy' | 'hard';
export type Why = 'red' | 'leech' | 'again' | 'green' | 'easy3';
export type Verdict = { ease: Ease; why: Why } | null;
/** An answer this quick (ms, Anki's own timer) means he didn't have to think. */
export const FAST = 5000;

/** A graded answer (Again…Easy), not a manual or rescheduling entry: [ms, grade, type]. */
const answers = (c: Card, since = 0) => c.revs.filter((r) => r[1] >= 1 && r[1] <= 4 && r[6] !== 4 && r[6] !== 5 && r[0] > since);
/** A lapse: Again on a review card. */
const lapsedSince = (c: Card, since: number) => c.revs.some((r) => r[6] === 1 && r[1] === 1 && r[0] > since);

export function verdict(c: Card, tags: string[], th = 8, seen = 0): Verdict {
  const flag = c.flags & 7;
  if (flag === 1) return { ease: 'hard', why: 'red' };
  const leechy = (th > 0 && c.lapses >= th) || (c.lapses >= 2 && tags.some((t) => /^leech$/i.test(t)));
  if (c.queue === -1) return leechy && lapsedSince(c, seen) ? { ease: 'hard', why: 'leech' } : null;
  if (leechy && lapsedSince(c, seen)) return { ease: 'hard', why: 'leech' };
  const a = answers(c, seen), g = a.map((r) => r[1]);
  const last = (n: number) => g.slice(-n);
  if (g.length >= 3 && last(3).every((x) => x === 1)) return { ease: 'hard', why: 'again' };
  if (c.lapses >= 3 && g.length >= 2 && last(4).filter((x) => x === 1).length >= 2) return { ease: 'hard', why: 'again' };
  if (flag === 3) return { ease: 'easy', why: 'green' };
  if (c.type === 2 && g.length >= 3 && a.slice(-3).every((r) => r[1] === 4 && r[5] < FAST)) return { ease: 'easy', why: 'easy3' };
  return null;
}

/** One word on the list: its note, which way it's off, the cards that make it so, and when it last moved (ms). */
export type Flagged = { nid: number; ease: Ease; why: Why[]; cards: Card[]; at: number };

/** Every word that is too easy or too hard, the newest first. A word with a hard card is hard, whatever its others are.
 *  `skip` leaves out notes already on their way (a card being combined or rewritten). */
export function triage(cards: Iterable<Card>, tagsOf: (nid: number) => string[] | undefined, th: number, seen: Record<string, number> = {}, skip: Set<number> = new Set()): Flagged[] {
  const by = new Map<number, Flagged>();
  for (const c of cards) {
    if (skip.has(c.nid)) continue;
    const tags = tagsOf(c.nid);
    if (!tags) continue;
    const v = verdict(c, tags, th, seen[c.nid] ?? 0);
    if (!v) continue;
    const at = Math.max(c.revs.length ? c.revs[c.revs.length - 1][0] : 0, (c.mod < 1e12 ? c.mod * 1000 : c.mod) || 0);
    const f = by.get(c.nid);
    if (!f) by.set(c.nid, { nid: c.nid, ease: v.ease, why: [v.why], cards: [c], at });
    else if (f.ease === 'easy' && v.ease === 'hard') by.set(c.nid, { nid: c.nid, ease: 'hard', why: [v.why], cards: [c], at: Math.max(f.at, at) });
    else if (f.ease === v.ease) {
      f.cards.push(c);
      if (!f.why.includes(v.why)) f.why.push(v.why);
      f.at = Math.max(f.at, at);
    }
  }
  return [...by.values()].sort((a, b) => b.at - a.at);
}
