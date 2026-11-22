// FSRS-6, the scheduler Anki uses, written to match Anki's own (fsrs-rs, rslib/src/scheduler/fsrs): the same memory
// model, the same interval rounding and fuzz, days counted the way Anki counts them (calendar days that turn over at
// the collection's rollover hour). Used by the review page, the server and scripts/cbp-anki.ts, which checks it against
// the memory state Anki stored on every card.

export type Memory = { s: number; d: number };
export const S_MIN = 0.001;
export const S_MAX = 36500;
const clampD = (d: number) => Math.min(10, Math.max(1, d));
const clampS = (s: number) => Math.min(S_MAX, Math.max(S_MIN, s));

/** The 21 FSRS-6 weights Anki shipped before an optimizer ran (fsrs-rs DEFAULT_PARAMETERS). */
export const DEFAULT_W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];

export class Fsrs {
  w: number[];
  decay: number;
  factor: number;
  constructor(w: number[]) {
    // FSRS-5 weights (19) get FSRS-6's two extra terms the way Anki does: no short-term exponent, the old decay
    this.w = w.length >= 21 ? w.slice(0, 21) : [...(w.length >= 19 ? w.slice(0, 19) : DEFAULT_W.slice(0, 19)), 0, 0.5];
    this.decay = this.w[20];
    this.factor = Math.pow(0.9, -1 / this.decay) - 1;
  }
  /** Recall probability after `t` days. */
  r(t: number, s: number) {
    return Math.pow(1 + (this.factor * Math.max(0, t)) / s, -this.decay);
  }
  /** The interval (days, unrounded) at which recall falls to `retention`. */
  interval(s: number, retention: number) {
    return (s / this.factor) * (Math.pow(retention, -1 / this.decay) - 1);
  }
  initS(g: number) {
    return clampS(this.w[g - 1]);
  }
  initD(g: number) {
    return this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1;
  }
  nextD(d: number, g: number) {
    const delta = -this.w[6] * (g - 3);
    const dd = d + (delta * (10 - d)) / 9;
    return clampD(this.w[7] * (this.initD(4) - dd) + dd);
  }
  success(s: number, d: number, r: number, g: number) {
    const hard = g === 2 ? this.w[15] : 1, easy = g === 4 ? this.w[16] : 1;
    return s * (Math.exp(this.w[8]) * (11 - d) * Math.pow(s, -this.w[9]) * (Math.exp((1 - r) * this.w[10]) - 1) * hard * easy + 1);
  }
  failure(s: number, d: number, r: number) {
    const ns = this.w[11] * Math.pow(d, -this.w[12]) * (Math.pow(s + 1, this.w[13]) - 1) * Math.exp((1 - r) * this.w[14]);
    return Math.min(ns, s / Math.exp(this.w[17] * this.w[18]));
  }
  shortTerm(s: number, g: number) {
    let inc = Math.exp(this.w[17] * (g - 3 + this.w[18])) * Math.pow(s, -this.w[19]);
    if (g >= 3) inc = Math.max(inc, 1);
    return s * inc;
  }
  /** The memory after a review rated `g` (1 Again … 4 Easy) `t` days after the last one; null = the first review. */
  step(m: Memory | null, t: number, g: number): Memory {
    if (!m) return { s: this.initS(g), d: clampD(this.initD(g)) };
    const s = t === 0 ? this.shortTerm(m.s, g) : g === 1 ? this.failure(m.s, m.d, this.r(t, m.s)) : this.success(m.s, m.d, this.r(t, m.s), g);
    return { s: clampS(s), d: this.nextD(m.d, g) };
  }
  /** The memory a review history leads to: each review's day number (Anki's day index) and its rating. */
  replay(reviews: { day: number; g: number }[]): Memory | null {
    let m: Memory | null = null, last = 0;
    for (const r of reviews) {
      m = this.step(m, m ? r.day - last : 0, r.g);
      last = r.day;
    }
    return m;
  }
}

// ---------- intervals, as Anki rounds and fuzzes them ----------
/** Anki's fuzz ranges (rslib/src/scheduler/states/fuzz.rs). */
const FUZZ = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Infinity, factor: 0.05 },
];
export function fuzzBounds(ivl: number, min: number, max: number): [number, number] {
  let delta = 1;
  for (const f of FUZZ) delta += f.factor * Math.max(0, Math.min(ivl, f.end) - f.start);
  let lo = Math.round(ivl - delta), hi = Math.round(ivl + delta);
  lo = Math.min(max, Math.max(2, Math.max(min, lo)));
  hi = Math.min(max, Math.max(lo, hi));
  if (ivl > max) lo = hi = max;
  return [lo, hi];
}
/** Days until the next review: the model's interval, rounded, kept within [min, max], fuzzed when it's 2.5 days or
 *  more (Anki seeds its fuzz per card and review count; `rand` in [0, 1) plays that part). */
export function constrain(ivl: number, min: number, max: number, rand: number | null) {
  const r = Math.min(max, Math.max(min, Math.max(1, Math.round(ivl))));
  if (rand == null || ivl < 2.5) return r;
  const [lo, hi] = fuzzBounds(ivl, min, max);
  return Math.min(max, Math.max(min, Math.floor(rand * (hi - lo + 1) + lo)));
}

/** A deterministic number in [0, 1) from a card id and its review count, as Anki seeds its fuzz. */
export function seedRand(cid: number, reps: number) {
  let h = (cid + reps) >>> 0 ^ Math.floor((cid + reps) / 2 ** 32);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}
