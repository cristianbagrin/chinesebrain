// Rules for a card that two devices answer (pure, so tests/cbp-review-sync.test.ts can hold them to it).
import type { Card } from '../sched.ts';

const ids = (c: Card | null | undefined) => new Set((c?.revs ?? []).map((r) => r[0]));

/** The reviews a change takes off the server as it's applied: only an undo drops any, and only the ones the step
 *  itself added (in its `after`, not in its `before`). Doing or redoing never drops one: a review in the server's copy
 *  that this step doesn't hold is another device's. */
export function drops(side: 'before' | 'after', before: Card | null | undefined, after: Card | null | undefined): number[] | undefined {
  if (side !== 'before') return undefined;
  const had = ids(before);
  const out = [...ids(after)].filter((x) => !had.has(x));
  return out.length ? out : undefined;
}

/** The same moment of one card: no review has come or gone between them (another device's answer would). */
export const sameReviews = (a: Card, b: Card) => a.reps === b.reps && a.revs.length === b.revs.length && a.revs.at(-1)?.[0] === b.revs.at(-1)?.[0];
