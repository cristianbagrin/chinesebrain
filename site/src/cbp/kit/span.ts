/** Which months and weeks the year views show across the turn of a year (pure dates, no DOM).
 *  In January and February "this year" is nearly empty, so Progress shows the twelve months ending with this one and
 *  Today's tracker reaches back into the last year when its weeks outnumber this year's. */
import { columns } from '../habit.ts';

export type Col = ReturnType<typeof columns>[number];
export const EARLY = 2; // months (Jan, Feb) that still show the year before

/** The twelve months Progress shows for `today`: January to December, or in the first weeks the twelve ending now. */
export function months(today: string): { y: number; m: number }[] {
  const y = +today.slice(0, 4), m = +today.slice(5, 7) - 1;
  return Array.from({ length: 12 }, (_, i) => {
    const k = m < EARLY ? m - 11 + i : i;
    return { y: y + Math.floor(k / 12), m: ((k % 12) + 12) % 12 };
  });
}

/** The heatmap's columns. `full` is Progress (the whole year, or the twelve months while it is early); otherwise Today's
 *  (up to today; with `cap` columns wanted and this year short of them, the last year's come first).
 *  `n0` columns belong to the year before; `ranges` is each shown month's first and last column (null: none yet). */
export function heat(today: string, full: boolean, cap = 0) {
  const y = +today.slice(0, 4), early = +today.slice(5, 7) - 1 < EARLY, shown = months(today);
  let cols = columns(y, full && !early ? `${y}-12-31` : today), before: Col[] = [];
  if (full && early) before = columns(y - 1, `${y - 1}-12-31`).filter((c) => c.month >= shown[0].m);
  else if (!full && cap && cols.length < cap) before = columns(y - 1, `${y - 1}-12-31`);
  const n0 = before.length;
  cols = [...before, ...cols];
  const ranges = shown.map(({ y: yy, m }) => {
    let a = -1, b = -1;
    cols.forEach((c, i) => {
      if (c.month !== m || (i < n0 ? y - 1 : y) !== yy) return;
      if (a < 0) a = i;
      b = i;
    });
    return a < 0 ? null : ([a, b] as [number, number]);
  });
  return { cols, n0, ranges };
}
