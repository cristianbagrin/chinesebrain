// Browse's index and filters: one item per card (byWord makes them one row per word, as Browse shows them), everything a filter or a column asks worked out once per change of the
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
import type { Ease, Verdict } from './triage.ts';

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
  /** too easy or too hard (triage.ts), null when neither */
  ease: Ease | null;
  /** how many cards this row stands for (1 for a card; a word's row: those of its cards that match) */
  n: number;
  /** a word's row: its cards that match, in card order */
  cards?: Item[];
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
export function index(cards: Iterable<Card>, noteOf: (nid: number) => Note | undefined, typeOf: (n: Note) => NoteType | undefined, ck: Clock, w: number[], uses: Record<string, number> = {}, judge?: (c: Card, n: Note) => Verdict): Item[] {
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
      ease: judge?.(card, note)?.ease ?? null,
      n: 1,
      uses: Object.prototype.hasOwnProperty.call(uses, word) ? uses[word] : null,
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
  /** too easy, too hard: any of these */
  ease: Ease[];
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
export const EMPTY: Filters = { q: '', state: [], due: '', dueR: [null, null], card: [], flag: [], leech: false, ease: [], pic: '', audio: '', uses: [], ivl: [null, null], s: [null, null], d: [null, null], r: [null, null], lapses: [null, null], added: null, rev: null };
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
  if (f.ease.length) n++;
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
  const ease = f.ease?.length ? new Set(f.ease) : null;
  const due: Range | null = f.due === 'overdue' ? [null, -1] : f.due === 'today' ? [0, 0] : f.due === 'week' ? [0, 6] : f.due === 'range' ? f.dueR : null;
  return items.filter(
    (x) =>
      (!st || st.has(x.state)) &&
      (!due || inRange(x.due, due)) &&
      (!cards || cards.has(x.tmpl)) &&
      (!flags || flags.has(x.flag)) &&
      (!f.leech || x.leech) &&
      (!ease || (x.ease != null && ease.has(x.ease))) &&
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

// ---------- one row per word ----------
/** Browse shows a word once (his notes make three cards each). A word's row is its matching cards together: the card
 *  shown first is the one due soonest (else the first that isn't suspended); the numbers are the weakest card's
 *  (soonest due, shortest interval, lowest recall, most lapses), so a sort or a glance finds the word that needs him.
 *  Hard wins over easy; red over green. */
export function byWord(items: Item[]): Item[] {
  // one row per word, even when a word has more than one note (a second card for it, Cards page "2"); a note with no
  // word keeps a row of its own
  const by = new Map<string, Item[]>();
  for (const x of items) {
    const k = x.word ? 'w:' + x.word : 'n:' + x.note.id;
    const l = by.get(k);
    if (l) l.push(x);
    else by.set(k, [x]);
  }
  const min = (xs: (number | null)[]) => xs.reduce<number | null>((a, b) => (b == null ? a : a == null ? b : Math.min(a, b)), null);
  const out: Item[] = [];
  for (const l of by.values()) {
    l.sort((a, b) => a.note.id - b.note.id || a.card.ord - b.card.ord);
    if (l.length === 1) {
      out.push({ ...l[0], cards: l });
      continue;
    }
    const soon = l.filter((x) => x.due != null).sort((a, b) => a.due! - b.due!)[0];
    const lead = soon ?? l.find((x) => x.state !== 'suspended') ?? l[0];
    const flags = l.map((x) => x.flag);
    out.push({
      ...lead,
      tmpl: `${l.length} cards`,
      n: l.length,
      cards: l,
      due: min(l.map((x) => x.due)),
      ivl: min(l.map((x) => x.ivl)),
      s: min(l.map((x) => x.s)),
      r: min(l.map((x) => x.r)),
      d: l.reduce<number | null>((a, x) => (x.d == null ? a : a == null ? x.d : Math.max(a, x.d)), null),
      lapses: Math.max(...l.map((x) => x.lapses)),
      reps: l.reduce((a, x) => a + x.reps, 0),
      added: Math.min(...l.map((x) => x.added)),
      last: min(l.map((x) => x.last)),
      pic: l.some((x) => x.pic),
      audio: l.some((x) => x.audio),
      flag: flags.includes(1) ? 1 : flags.find((f) => f) ?? 0,
      leech: l.some((x) => x.leech),
      ease: l.some((x) => x.ease === 'hard') ? 'hard' : l.some((x) => x.ease === 'easy') ? 'easy' : null,
    });
  }
  return out;
}

// Combine: Browse by keyboard and a word's panel
/** ↑ ↓: the row after (d = 1) or before (d = -1) `cur` among the rows shown, held at the ends; with none open, the first
 *  (↓) or the last (↑). */
export function nextRow(ids: number[], cur: number, d: number): number | null {
  if (!ids.length) return null;
  const i = ids.indexOf(cur);
  return ids[i < 0 ? (d > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + d))];
}
/** A word's cards as its panel lists them, one row each: the word's notes oldest first, each note's cards in order. */
export const wordRows = <C extends { nid: number; ord: number }>(nids: number[], cards: C[]) =>
  [...new Set(nids)].sort((a, b) => a - b).flatMap((nid) => cards.filter((c) => c.nid === nid).sort((a, b) => a.ord - b.ord));
/** What a row says: the note's sentence on one line (its lines joined), else the word. */
export const rowText = (sentence: string, word: string) => strip(String(sentence ?? '').replace(/<br\s*\/?>|<\/div>|<\/p>/gi, ' ')).replace(/\s+/g, ' ').trim() || word;
// (end Combine)
