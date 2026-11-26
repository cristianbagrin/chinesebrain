// Browse's index and filters: one row per card, everything a filter or a column asks worked out once per change of the
// collection (index), so typing and clicking chips only walk a flat list (apply). Pure: the tests feed it hand-made
// collections (tests/cbp-browse.test.ts).
//
// What each state means (one per card; suspended and buried win over the rest, as Browse shows them):
//   new        never studied (type 0)
//   learning   in its learning or relearning steps (type 1 or 3)
//   young      a review card with an interval under 21 days
//   mature     a review card with an interval of 21 days or more
//   suspended  queue -1
//   buried     queue -2 or -3 (Anki's "until tomorrow"; it is not due today whatever its date says)
// Due is in days from today (0 = today, negative = overdue), and only for cards that can come up: never for new,
// suspended or buried cards. Recall is FSRS's chance he still knows it today.
import type { Card, Clock } from '../sched.ts';
import { Fsrs } from '../fsrs.ts';
import { search, strip, wordOf, sortText, fieldIndex, type Row } from './render.ts';
import type { Note, NoteType } from './store.ts';

export type State = 'new' | 'learning' | 'young' | 'mature' | 'suspended' | 'buried';
export const STATES: State[] = ['new', 'learning', 'young', 'mature', 'suspended', 'buried'];

export type Item = Row & {
  type: NoteType | undefined;
  word: string;
  /** the card type's name (Word → pic, Pic → word…) */
  tmpl: string;
  state: State;
  /** days from today, null when it can't come up (new, suspended, buried) */
  due: number | null;
  /** days, null before it graduates */
  ivl: number | null;
  /** FSRS stability (days), difficulty (1–10), recall today (0–1); null when it has no memory yet */
  s: number | null;
  d: number | null;
  r: number | null;
  lapses: number;
  reps: number;
  /** days since it was added (0 = today) */
  added: number;
  /** days since its last graded review, null if never */
  last: number | null;
  pic: boolean;
  audio: boolean;
  /** 0 none, 1 red, 2 orange, 3 green, … */
  flag: number;
  leech: boolean;
  /** right uses in situations (test day, essay, tutor chat), for a word he is still learning; null otherwise */
  uses: number | null;
  /** search text: Chinese (word, sentence, notes), pinyin without tones or spaces, Latin text lowercased */
  zh: string;
  py: string;
  en: string;
};

const HAN = /\p{Script=Han}/u;
/** "Làngfèi shíjiān", "lang4 fei4", "lv" → "langfeishijian", "langfei", "lu": what a tone-free search compares. */
export const toneless = (s: string) =>
  strip(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/v/g, 'u')
    .replace(/[^a-z]/g, '');

const graded = (c: Card) => c.revs.filter((r) => r[1] >= 1 && r[1] <= 4 && r[6] !== 4 && r[6] !== 5);

export function stateOf(c: Card): State {
  if (c.queue === -1) return 'suspended';
  if (c.queue === -2 || c.queue === -3) return 'buried';
  if (c.type === 0) return 'new';
  if (c.type === 1 || c.type === 3) return 'learning';
  return c.ivl >= 21 ? 'mature' : 'young';
}

export function dueOf(c: Card, ck: Clock): number | null {
  if (c.queue === 1) return ck.dayOf(c.due * 1000) - ck.today;
  if (c.queue === 2 || c.queue === 3) return c.due - ck.today;
  return null;
}

/** Every card of a note that exists, with what Browse shows and filters on. `uses` is the board's word → situations
 *  (STATE.uses: words still learning only). `w` is the deck's FSRS weights. */
export function index(cards: Iterable<Card>, noteOf: (nid: number) => Note | undefined, typeOf: (n: Note) => NoteType | undefined, ck: Clock, w: number[], uses: Record<string, number> = {}): Item[] {
  const f = new Fsrs(w);
  const out: Item[] = [];
  for (const card of cards) {
    const note = noteOf(card.nid);
    if (!note) continue;
    const type = typeOf(note);
    const word = wordOf(type, note) || sortText(type, note) || strip(note.flds.find((x) => strip(x)) ?? '');
    const fld = (name: string) => {
      const i = type ? fieldIndex(type, name) : -1;
      return i >= 0 ? note.flds[i] ?? '' : '';
    };
    const g = graded(card);
    const lastMs = card.lrt ? card.lrt * 1000 : g.length ? g[g.length - 1][0] : 0;
    const state = stateOf(card);
    const studied = card.type !== 0;
    const s = studied ? (card.s ?? (card.type === 2 || card.type === 3 ? Math.max(0.1, card.ivl || 1) : null)) : null;
    const elapsed = lastMs ? Math.max(0, ck.today - ck.dayOf(lastMs)) : null;
    const all = note.flds.join(' ');
    const latin = [word, fld('Notes'), fld('Meaning'), fld('English'), fld('Back')].map(strip).join(' ');
    out.push({
      card,
      note,
      type,
      word,
      tmpl: type?.templates.find((t) => t.ord === card.ord)?.name ?? '',
      state,
      due: state === 'suspended' || state === 'buried' || state === 'new' ? null : dueOf(card, ck),
      ivl: card.type === 2 || card.type === 3 ? card.ivl : null,
      s,
      d: studied && card.d != null ? card.d : null,
      r: s != null && elapsed != null ? f.r(elapsed, s) : null,
      lapses: card.lapses,
      reps: card.reps,
      added: ck.today - ck.dayOf(card.id),
      last: g.length ? ck.today - ck.dayOf(g[g.length - 1][0]) : null,
      pic: /<img\b/i.test(all),
      audio: /\[sound:/i.test(all),
      flag: card.flags & 7,
      leech: note.tags.some((t) => /^leech$/i.test(t)),
      uses: word in uses ? uses[word] : null,
      zh: [word, fld('Chinese'), fld('Mnemonic'), fld('Notes')].map(strip).join('\n'),
      py: toneless(fld('Pinyin')),
      en: latin.toLowerCase(),
    });
  }
  return out;
}

// ---------- filters ----------
/** [min, max], both ends included; null = open. */
export type Range = [number | null, number | null];
export type Due = '' | 'overdue' | 'today' | 'week' | 'range';
export type Filters = {
  q: string;
  /** any of these (empty: all) */
  state: State[];
  due: Due;
  /** for due 'range': days from today */
  dueR: Range;
  /** card type names, any of these */
  card: string[];
  /** flags, any of these: 0 none, 1 red, 3 green */
  flag: number[];
  leech: boolean;
  pic: '' | 'yes' | 'no';
  audio: '' | 'yes' | 'no';
  /** right uses so far, any of these (0, 1, 2) */
  uses: number[];
  ivl: Range;
  s: Range;
  d: Range;
  /** recall today, percent */
  r: Range;
  lapses: Range;
  /** added within the last N days (1 = today) */
  added: number | null;
  /** reviewed within the last N days (1 = today), or never */
  rev: number | 'never' | null;
};
export const EMPTY: Filters = { q: '', state: [], due: '', dueR: [null, null], card: [], flag: [], leech: false, pic: '', audio: '', uses: [], ivl: [null, null], s: [null, null], d: [null, null], r: [null, null], lapses: [null, null], added: null, rev: null };
export const blank = (): Filters => JSON.parse(JSON.stringify(EMPTY));

const open = (r: Range) => r[0] == null && r[1] == null;
const inRange = (v: number | null, r: Range) => v != null && (r[0] == null || v >= r[0]) && (r[1] == null || v <= r[1]);

/** How many filters are on, the search not counted. */
export function active(f: Filters) {
  let n = 0;
  if (f.state.length) n++;
  if (f.due) n++;
  if (f.card.length) n++;
  if (f.flag.length || f.leech) n++;
  if (f.pic || f.audio) n++;
  if (f.uses.length) n++;
  for (const r of [f.ivl, f.s, f.d, f.r, f.lapses]) if (!open(r)) n++;
  if (f.added != null) n++;
  if (f.rev != null) n++;
  return n;
}

/** The text part of a search: plain words test the index (Chinese anywhere in the word, sentence or notes; Latin as
 *  pinyin without tones or spaces, or in the word and notes); a token with a colon or a leading minus is Anki's search
 *  (is:due, prop:ivl>30, tag:x, -flag:1…), as before. */
function textTest(q: string, ck: Clock): (x: Item) => boolean {
  const toks = q.trim().split(/\s+/).filter(Boolean);
  const anki = toks.filter((t) => /^-|^\w+:/.test(t));
  const plain = toks.filter((t) => !anki.includes(t));
  const tests: ((x: Item) => boolean)[] = [];
  if (anki.length) {
    const t = search(anki.join(' '), ck.today, ck.dayOf);
    tests.push((x) => t(x));
  }
  if (plain.length) {
    const lat = plain.filter((t) => !HAN.test(t));
    const han = plain.filter((t) => HAN.test(t));
    for (const h of han) tests.push((x) => x.zh.includes(h));
    if (lat.length) {
      // "lang fei" is one pinyin run; else each word on its own, in the pinyin or the Latin text
      const run = toneless(lat.join(''));
      const each = lat.map((t) => [toneless(t), t.toLowerCase()] as const);
      tests.push((x) => (!!run && x.py.includes(run)) || each.every(([p, l]) => (!!p && x.py.includes(p)) || x.en.includes(l)));
    }
  }
  return (x) => tests.every((t) => t(x));
}

export function apply(items: Item[], f: Filters, ck: Clock): Item[] {
  const text = f.q.trim() ? textTest(f.q, ck) : null;
  const st = f.state.length ? new Set(f.state) : null;
  const cards = f.card.length ? new Set(f.card) : null;
  const flags = f.flag.length ? new Set(f.flag) : null;
  const uses = f.uses.length ? new Set(f.uses) : null;
  const due: Range | null = f.due === 'overdue' ? [null, -1] : f.due === 'today' ? [0, 0] : f.due === 'week' ? [0, 6] : f.due === 'range' ? f.dueR : null;
  return items.filter(
    (x) =>
      (!st || st.has(x.state)) &&
      (!due || inRange(x.due, due)) &&
      (!cards || cards.has(x.tmpl)) &&
      (!flags || flags.has(x.flag)) &&
      (!f.leech || x.leech) &&
      (!f.pic || x.pic === (f.pic === 'yes')) &&
      (!f.audio || x.audio === (f.audio === 'yes')) &&
      (!uses || (x.uses != null && uses.has(x.uses))) &&
      (open(f.ivl) || inRange(x.ivl, f.ivl)) &&
      (open(f.s) || inRange(x.s, f.s)) &&
      (open(f.d) || inRange(x.d, f.d)) &&
      (open(f.r) || inRange(x.r == null ? null : x.r * 100, f.r)) &&
      (open(f.lapses) || inRange(x.lapses, f.lapses)) &&
      (f.added == null || x.added < f.added) &&
      (f.rev == null || (f.rev === 'never' ? x.last == null : x.last != null && x.last < f.rev)) &&
      (!text || text(x)),
  );
}

// ---------- sorting ----------
export type Sort = 'added' | 'word' | 'card' | 'state' | 'due' | 'ivl' | 'r' | 'lapses' | 's' | 'd';
const ORDER: Record<State, number> = { new: 0, learning: 1, young: 2, mature: 3, suspended: 4, buried: 5 };
const KEY: Record<Sort, (x: Item) => number | string | null> = {
  added: (x) => x.note.id * 10 + x.card.ord,
  word: (x) => x.word,
  card: (x) => x.tmpl,
  state: (x) => ORDER[x.state],
  due: (x) => x.due,
  ivl: (x) => x.ivl,
  r: (x) => x.r,
  lapses: (x) => x.lapses,
  s: (x) => x.s,
  d: (x) => x.d,
};
/** Sorted by a column; cards with nothing in it (a new card's due) go last either way, then newest added first. */
export function sortBy(items: Item[], by: Sort, desc: boolean): Item[] {
  const k = KEY[by] ?? KEY.added;
  const coll = new Intl.Collator('zh-Hant');
  return items
    .map((x) => [k(x), x] as const)
    .sort(([a, x], [b, y]) => {
      if (a == null || b == null) return a == null && b == null ? y.note.id - x.note.id || x.card.ord - y.card.ord : a == null ? 1 : -1;
      const o = typeof a === 'number' ? a - (b as number) : coll.compare(a, b as string);
      return (desc ? -o : o) || y.note.id - x.note.id || x.card.ord - y.card.ord;
    })
    .map(([, x]) => x);
}
