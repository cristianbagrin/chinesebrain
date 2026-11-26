// The habit's rules, in one place: the board (HABIT, through plus/kit.js), the server's evening nudge (push.ts) and the
// tests share them. Pure: no DOM, no database.
//   A day is done when its reviews are cleared and the essay is written. A test that day deepens its color.
//   One rest day a week (Monday to Sunday): the first missed day of the week is a rest, so the streak holds (with no
//   streak to hold, a missed day is just missed).
//   Never miss twice: after a miss (one no rest covered), the next day's bar is lower: reviews cleared and three sentences.
// Days are 'YYYY-MM-DD' (the essay day: it turns over at 4 am).

/** What a day holds. cleared: no review was left due when it ended (or today: the queue is empty). */
export type Day = { rv: number; cleared: boolean; chars: number; sent: number; cards: number; test: boolean };
export type Status = 'pre' | 'done' | 'rest' | 'partial' | 'miss' | 'open';
export type DayState = { st: Status; low: boolean; deep: boolean };

export const LOW_SENTENCES = 3;
const HAN = /[㐀-鿿豈-﫿]/g;
/** Chinese characters only: English inside an essay isn't writing Chinese. */
export const han = (t: unknown) => (String(t ?? '').match(HAN) ?? []).length;
/** Sentences with Chinese in them, split at 。！？!? ; and line breaks. */
export const sentences = (t: unknown) => String(t ?? '').split(/[。！？!?；;\n]+/).filter((s) => han(s) > 0).length;

export const blank = (): Day => ({ rv: 0, cleared: true, chars: 0, sent: 0, cards: 0, test: false });
const active = (d: Day) => d.rv > 0 || d.chars > 0 || d.cards > 0 || d.test;
/** The day's bar: normal (the essay written) or low (three sentences, the day after a miss). */
export const met = (d: Day, low: boolean) => d.cleared && (low ? d.sent >= LOW_SENTENCES : d.chars > 0);

// ---------- dates ----------
const P = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const K = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s: string, n: number) => K(P(s) + n * 864e5);
/** Monday of the week a day is in. */
export const monday = (s: string) => addDays(s, -((new Date(P(s)).getUTCDay() + 6) % 7));
/** The habit day of a moment (ms) where he is (minutes east of UTC; Taipei 480), turning over at `rollover` o'clock. */
export const dayOf = (ms: number, tzMin = 480, rollover = 4) => K(ms + tzMin * 60e3 - rollover * 3600e3);

/** Every day from the first essay to `today`: its status, its bar, and the streak.
 *  `today` is still open: it is done the moment it meets its bar, and never a miss or a rest yet.
 *  The streak counts done days in a row; rest days hold it without adding to it. */
export function walk(days: Record<string, Day | undefined>, today: string) {
  const out: Record<string, DayState> = {};
  // the habit starts with his first essay: before it, reviews alone were the whole routine, not a missed day
  const start = Object.keys(days).filter((k) => k <= today && days[k] && days[k]!.chars > 0).sort()[0];
  if (!start) return { days: out, streak: 0, start: null as string | null, low: false };
  let prev: Status = 'pre', restWeek = '';
  for (let k = start; k <= today; k = addDays(k, 1)) {
    const d = days[k] ?? blank(), low = prev === 'miss';
    let st: Status;
    if (met(d, low)) st = 'done';
    else if (k === today) st = 'open';
    else if (restWeek !== monday(k) && (prev === 'done' || prev === 'rest')) {
      st = 'rest';
      restWeek = monday(k);
    } else st = active(d) ? 'partial' : 'miss';
    out[k] = { st, low, deep: st === 'done' && d.test };
    // a partial day is a miss too, for the streak and for tomorrow's bar
    prev = st === 'partial' ? 'miss' : st;
  }
  let streak = 0;
  for (let k = today; out[k]; k = addDays(k, -1)) {
    const s = out[k].st;
    if (s === 'done') streak++;
    else if (s === 'rest' || s === 'open') continue;
    else break;
  }
  return { days: out, streak, start, low: out[today]?.low ?? false };
}

// ---------- the reviews, from Anki's review log ----------
/** One card as the collection keeps it: its queue (-1 suspended, -2/-3 buried) and its reviews
 *  [id (ms), ease, ivl (days > 0, seconds < 0), lastIvl, factor, time, type]. */
export type RevCard = { queue: number; nid?: number; revs: number[][] };

/** Reviews a day, and whether each day ended with reviews still due. Days are numbers here (Anki's day index, from
 *  `day(ms)`); `today` is open, so only days before it are judged. A card is due `ivl` days after a review; if its next
 *  review came later than that (or never, for a card still in the deck), the days between ended with it left due.
 *  Learning steps (ivl < 0) and new cards don't count; a suspended or buried card stops counting after its last review;
 *  a card whose sibling (same note) was reviewed that day was buried until the next, so it wasn't left. */
export function reviewDays(cards: Iterable<RevCard>, day: (ms: number) => number, today: number) {
  const count = new Map<number, number>();
  const diff = new Map<number, number>();
  const mark = (a: number, b: number) => {
    if (b <= a) return;
    diff.set(a, (diff.get(a) ?? 0) + 1);
    diff.set(b, (diff.get(b) ?? 0) - 1);
  };
  const list = [...cards];
  // the days each note had a review (Anki buries a reviewed card's siblings for the rest of the day)
  const byNote = new Map<number, Set<number>>();
  for (const c of list) if (c.nid != null) for (const r of c.revs ?? []) if (r[1] >= 1 && r[1] <= 4) (byNote.get(c.nid) ?? byNote.set(c.nid, new Set()).get(c.nid)!).add(day(r[0]));
  for (const c of list) {
    const sib = c.nid != null ? byNote.get(c.nid) : undefined;
    const revs = [...(c.revs ?? [])].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < revs.length; i++) {
      const r = revs[i], d = day(r[0]);
      if (r[1] >= 1 && r[1] <= 4 && r[6] <= 3) count.set(d, (count.get(d) ?? 0) + 1);
      if (!(r[2] > 0)) continue;
      let due = d + r[2];
      const next = revs[i + 1];
      const until = next ? day(next[0]) : c.queue >= 0 ? today : due;
      while (sib && due < until && sib.has(due)) due++;
      mark(due, Math.min(until, today));
    }
  }
  const open = new Set<number>();
  // walk the boundaries in order: between one and the next, the days are open while any card is left due
  const ks = [...diff.keys()].sort((a, b) => a - b);
  let run = 0;
  for (let i = 0; i < ks.length - 1; i++) {
    run += diff.get(ks[i])!;
    if (run > 0) for (let x = ks[i]; x < ks[i + 1]; x++) open.add(x);
  }
  return { count, open };
}

// ---------- the server's log ----------
/** Two reports of the same day (from different devices, or the same one later): each part keeps its best. */
export function merge(a: Partial<Day> | null | undefined, b: Partial<Day> | null | undefined): Day {
  const x = { ...blank(), cleared: false, ...(a ?? {}) }, y = { ...blank(), cleared: false, ...(b ?? {}) };
  return {
    rv: Math.max(+x.rv || 0, +y.rv || 0),
    cleared: !!(x.cleared || y.cleared),
    chars: Math.max(+x.chars || 0, +y.chars || 0),
    sent: Math.max(+x.sent || 0, +y.sent || 0),
    cards: Math.max(+x.cards || 0, +y.cards || 0),
    test: !!(x.test || y.test),
  };
}

/** The evening nudge's words: what is left today, nothing else. */
export function left(d: Day | null, low: boolean) {
  const rv = !d?.cleared, es = !(d && (low ? d.sent >= LOW_SENTENCES : d.chars > 0));
  const essay = low ? 'three sentences' : 'your essay';
  if (rv && es) return `Reviews and ${essay}.`;
  if (rv) return 'Reviews left.';
  return low ? 'Three sentences left.' : 'Your essay is left.';
}
