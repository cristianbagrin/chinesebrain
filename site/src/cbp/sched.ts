// The review scheduler, as Anki runs it with FSRS on (rslib scheduler v3): learning and relearning steps, then FSRS
// intervals, Anki's rounding and fuzz, leeches, and the day's queue. Pure: the review page, the server and the tests
// share it. A card keeps Anki's own fields (type, queue, due, ivl, left...), so a collection can go back to Anki as is.
import { Fsrs, constrain, seedRand, type Memory } from './fsrs.ts';

/** One review, as Anki's revlog keeps it: [id (ms), ease 1-4, ivl, lastIvl, factor, time (ms), type].
 *  ivl < 0 is seconds (a learning step), > 0 days. type 0 learn, 1 review, 2 relearn, 3 filtered, 4 manual, 5 rescheduled. */
export type Rev = [number, number, number, number, number, number, number];
export type Card = {
  id: number; nid: number; did: number; ord: number;
  /** 0 new, 1 learning, 2 review, 3 relearning */
  type: number;
  /** -1 suspended, -2/-3 buried, 0 new, 1 learning (due = epoch seconds), 2 review, 3 learning across days (due = day) */
  queue: number;
  due: number; ivl: number; reps: number; lapses: number; left: number; flags: number; odue?: number;
  /** FSRS memory: stability, difficulty, last review (epoch seconds) */
  s?: number; d?: number; lrt?: number;
  mod: number; revs: Rev[];
};
export type Conf = {
  id: number; name: string; newPerDay: number; revPerDay: number;
  /** minutes */
  learnSteps: number[]; relearnSteps: number[];
  maxIvl: number; leechThreshold: number; leechAction: number; retention: number; w: number[]; buryNew: boolean; buryRev: boolean;
};
export type Clock = {
  /** ms */
  now: number;
  /** Anki's day number now */
  today: number;
  /** Anki's day number of a moment (ms) */
  dayOf(ms: number): number;
  /** ms when today turns over */
  dayEnd: number;
};

/** The collection's day: day 0 is `day0` (YYYY-MM-DD), each day starts at `rollover` o'clock where he is (this
 *  device's time zone, or `offsetMin` minutes east of UTC). */
export function clock(day0: string, rollover: number, now = Date.now(), offsetMin?: number): Clock {
  const base = Date.UTC(+day0.slice(0, 4), +day0.slice(5, 7) - 1, +day0.slice(8, 10)) / 864e5;
  const off = (ms: number) => (offsetMin ?? -new Date(ms).getTimezoneOffset()) * 60e3;
  const dayOf = (ms: number) => Math.floor((ms + off(ms) - rollover * 3600e3) / 864e5) - base;
  const today = dayOf(now);
  const end = (today + base + 1) * 864e5 + rollover * 3600e3 - off(now);
  return { now, today, dayOf, dayEnd: end };
}

export const LEARN_AHEAD = 20 * 60e3;

function memoryOf(c: Card): Memory | null {
  if (c.s != null && c.d != null) return { s: c.s, d: c.d };
  if (c.type === 2 || c.type === 3) return { s: Math.max(0.1, c.ivl || 1), d: 5 }; // a card with no FSRS history yet
  return null;
}

export type Answer = { card: Card; rev: Rev; leech: boolean; label: string };

/** What answering `g` (1 Again, 2 Hard, 3 Good, 4 Easy) does to the card. `ms` is the time he took. */
export function answer(c0: Card, g: number, conf: Conf, ck: Clock, ms = 0): Answer {
  const f = new Fsrs(conf.w);
  const c: Card = { ...c0, revs: c0.revs };
  const mem = memoryOf(c0);
  const t = c0.lrt ? Math.max(0, ck.today - ck.dayOf(c0.lrt * 1000)) : 0;
  const next = f.step(mem, mem ? t : 0, g);
  const rand = seedRand(c0.id, c0.reps);
  const ivlOf = (s: number, min = 1) => constrain(f.interval(s, conf.retention), min, conf.maxIvl, rand);
  const learning = c0.type === 0 || c0.type === 1;
  const steps = learning ? conf.learnSteps : conf.relearnSteps;
  const lastIvl = c0.queue === 1 ? -Math.round(stepAt(steps, c0) * 60) : c0.ivl;
  const revType = c0.type === 2 ? 1 : c0.type === 3 ? 2 : 0;
  let leech = false;

  const toStep = (mins: number, left: number) => {
    c.left = left;
    if (mins >= 1440) {
      c.queue = 3;
      c.due = ck.today + Math.round(mins / 1440);
      return Math.round(mins / 1440);
    }
    c.queue = 1;
    c.due = Math.round(ck.now / 1000 + mins * 60);
    return -Math.round(mins * 60);
  };
  const graduate = (s: number, min = 1) => {
    c.type = 2;
    c.queue = 2;
    c.left = 0;
    c.ivl = ivlOf(s, min);
    c.due = ck.today + c.ivl;
    return c.ivl;
  };

  let ivl: number;
  if (c0.type === 2) {
    if (g === 1) {
      c.lapses = c0.lapses + 1;
      c.ivl = ivlOf(next.s);
      if (conf.relearnSteps.length) {
        c.type = 3;
        ivl = toStep(conf.relearnSteps[0], conf.relearnSteps.length);
      } else ivl = graduate(next.s);
      const th = conf.leechThreshold;
      if (th > 0 && c.lapses >= th && (c.lapses - th) % Math.max(1, Math.ceil(th / 2)) === 0) {
        leech = true;
        if (conf.leechAction === 0) c.queue = -1;
      }
    } else {
      // Hard ≤ Good ≤ Easy, each at least a day more than the one before (Anki's order)
      const hard = ivlOf(f.step(mem, t, 2).s, 1);
      const good = ivlOf(f.step(mem, t, 3).s, hard + 1);
      const easy = ivlOf(f.step(mem, t, 4).s, good + 1);
      c.ivl = g === 2 ? hard : g === 3 ? good : easy;
      c.due = ck.today + c.ivl;
      ivl = c.ivl;
    }
  } else {
    // new, learning, relearning: through the steps, then graduate
    const remaining = c0.type === 0 ? steps.length : c0.left % 1000 || steps.length;
    const idx = Math.max(0, steps.length - remaining);
    if (c0.type === 0) c.type = 1;
    if (!steps.length || g === 4) ivl = graduate(next.s);
    else if (g === 1) ivl = toStep(steps[0], steps.length);
    else if (g === 2) {
      const d = idx === 0 ? (steps.length > 1 ? (steps[0] + steps[1]) / 2 : Math.min(steps[0] * 1.5, steps[0] + 1440)) : steps[idx];
      ivl = toStep(d, remaining);
    } else if (idx + 1 < steps.length) ivl = toStep(steps[idx + 1], steps.length - idx - 1);
    else ivl = graduate(next.s);
  }
  c.reps = c0.reps + 1;
  c.s = next.s;
  c.d = next.d;
  c.lrt = Math.floor(ck.now / 1000);
  c.mod = ck.now;
  const rev: Rev = [ck.now, g, ivl, lastIvl, Math.round(next.d * 1000), Math.min(ms, 60000), revType];
  c.revs = [...(c0.revs ?? []), rev];
  return { card: c, rev, leech, label: label(ivl) };
}

/** The current step's delay (minutes) of a card in learning. */
function stepAt(steps: number[], c: Card) {
  if (!steps.length) return 0;
  const remaining = c.left % 1000 || steps.length;
  return steps[Math.min(steps.length - 1, Math.max(0, steps.length - remaining))];
}

/** "10m", "3d", "1.2mo": what a button promises. */
export function label(ivl: number) {
  if (ivl < 0) {
    const m = -ivl / 60;
    return m < 60 ? `${Math.max(1, Math.round(m))}m` : `${Math.round(m / 60)}h`;
  }
  if (ivl < 30) return `${ivl}d`;
  if (ivl < 365) return `${(ivl / 30).toFixed(1).replace(/\.0$/, '')}mo`;
  return `${(ivl / 365).toFixed(1).replace(/\.0$/, '')}y`;
}

// ---------- the day's queue ----------
export type Queue = { learn: Card[]; review: Card[]; fresh: Card[] };
/** What's due: learning now (and within 20 minutes), reviews due today, new cards up to the day's limit. Only one card
 *  of a note a day when the deck buries siblings. `done` = cards answered today (ids), `newToday` = new ones started. */
export function queue(cards: Card[], conf: Conf, ck: Clock, seen: Set<number>, newToday: number, revToday: number): Queue {
  const learn: Card[] = [], review: Card[] = [], fresh: Card[] = [];
  for (const c of cards) {
    if (c.queue === 1 && c.due * 1000 <= ck.now + LEARN_AHEAD) learn.push(c);
    else if ((c.queue === 2 || c.queue === 3) && c.due <= ck.today) review.push(c);
    else if (c.queue === 0) fresh.push(c);
  }
  learn.sort((a, b) => a.due - b.due);
  // reviews: oldest due first, then a steady shuffle within a day
  review.sort((a, b) => a.due - b.due || seedRand(a.id, ck.today) - seedRand(b.id, ck.today));
  fresh.sort((a, b) => a.due - b.due || a.ord - b.ord);
  const sib = (list: Card[], bury: boolean) => {
    if (!bury) return list;
    return list.filter((c) => {
      if (seen.has(c.nid)) return false;
      seen.add(c.nid);
      return true;
    });
  };
  const blocked = new Set(seen);
  learn.forEach((c) => blocked.add(c.nid));
  const r = sib(review.filter((c) => !blocked.has(c.nid) || !conf.buryRev), conf.buryRev).slice(0, Math.max(0, conf.revPerDay - revToday));
  r.forEach((c) => blocked.add(c.nid));
  const n = sib(fresh.filter((c) => !blocked.has(c.nid) || !conf.buryNew), conf.buryNew).slice(0, Math.max(0, conf.newPerDay - newToday));
  return { learn, review: r, fresh: n };
}

/** Cards due on each of the next `days` days (index 0 = today), and how many are overdue: Anki's Future Due. */
export function forecast(cards: Card[], ck: Clock, days = 30) {
  const out = Array(days).fill(0);
  let backlog = 0;
  for (const c of cards) {
    let d: number;
    if (c.queue === 2 || c.queue === 3) d = c.due - ck.today;
    else if (c.queue === 1) d = ck.dayOf(c.due * 1000) - ck.today;
    else continue;
    if (d < 0) backlog++;
    else if (d < days) out[d]++;
  }
  return { backlog, days: out };
}

/** The ratings of a card's last graded reviews, newest last. */
export const grades = (c: Card, n: number) => c.revs.filter((r) => r[1] >= 1 && r[1] <= 4 && r[6] !== 4 && r[6] !== 5).slice(-n).map((r) => r[1]);
/** Missed three times in a row (Again, Again, Again). */
export const missed3 = (c: Card) => {
  const g = grades(c, 3);
  return g.length === 3 && g.every((x) => x === 1);
};
/** Right three times in a row (Hard or better, the last at least Good). */
export const right3 = (c: Card) => {
  const g = grades(c, 3);
  return g.length === 3 && g.every((x) => x >= 2) && g[2] >= 3;
};

/** The reviews FSRS learns from on a card, as Anki picks them (scripts/anki-read.ts fsrsHistory): rated reviews only,
 *  from the last time it was reset, starting at its first learning step; null when that start is missing. */
export function historyOf(c: Card, dayOf: (ms: number) => number): { day: number; g: number }[] | null {
  const revs = c.revs;
  const kept = revs.filter((r) => r[1] >= 1 && r[1] <= 4 && r[6] !== 4 && r[6] !== 5 && !(r[6] === 3 && r[2] === 0 && r[4] === 0));
  let reset = -1;
  revs.forEach((r, i) => r[6] === 4 && r[1] === 0 && r[2] === 0 && (reset = i));
  const after = reset >= 0 ? kept.filter((r) => r[0] > revs[reset][0]) : kept;
  let start = -1;
  for (let i = 0; i < after.length; i++) if (after[i][6] === 0 && (i === 0 || after[i - 1][6] !== 0)) start = i;
  return start < 0 ? null : after.slice(start).map((r) => ({ day: dayOf(r[0]), g: r[1] }));
}
