// Chinese Brain Plus: Chris's Chinese engine, ported line for line from life/chinese/words.py.
// It works on the same texts the Python reads (known-words.txt, learn-next.md, test-log.tsv, the sprint
// files, the Chinese Brain exports, data/*.tsv), kept in the CBP database's `files` table, so both give the
// same answer from the same data (tests/cbp-engine.test.ts and scripts/cbp-parity.ts check that).
// Pure: no I/O. A Files object goes in; what changed comes back in it.

export type Files = Map<string, string>;

export const TOCFL_DATE = '2026-12-12';
export const LOGGED_FROM = '2026-10-28';
/** A test every day (his call, 2026-11-25): about ten minutes, never two at once; 3+ missed days → a short comeback. */
export const TEST_ITEMS = 10;
export const COMEBACK_AFTER = 3;
/** A word is known (K) once he has used it correctly in this many different situations (a test day, an essay, a tutor chat). */
export const SITUATIONS = 3;
export const LANES: Record<string, string> = { Life: 'life', Taiwan: 'tw', Test: 'test' };
const LANE_NAMES = Object.keys(LANES);
const NEXT_PATTERN = ['Life', 'Taiwan', 'Life', 'Test', 'Life', 'Taiwan', 'Life', 'Test', 'Life', 'Taiwan', 'Life', 'Test'];
const ADJ = /^[+-]\d+(\.\d+)?$/;
export const TEST_KINDS = ['new', 'old', 'leak', 'burst'];
export const WRITING_KINDS = ['free', 'essay'];
/** Daily-test items beyond the retest kinds: a listening drill (an exchange, answered in Chinese) and a TOCFL Band B
 *  question (single choice, four options). Neither moves the retest schedule. */
export const EXTRA_KINDS = ['listen', 'tocfl'];
export const ITEM_KINDS = [...TEST_KINDS, ...EXTRA_KINDS];
export const RESULTS = ['pass', 'partial', 'fail', 'none'];
const SOURCE_WEIGHT: Record<string, number> = {
  Chris: 4, test: 3, essay: 3, free: 3, '動齡': 3,
  Todoist: 2, notes: 2, saved: 2, video: 2,
  Brain: 1, reader: 1, sweep: 1, Lexirise: 1, TOCFL: 0,
};

export const KW = 'known-words.txt';
export const LN = 'learn-next.md';
export const LOG = 'test-log.tsv';
export const FREQ = 'data/zh-freq.tsv';
export const TOC = 'data/tocfl.tsv';
export const ANKI = 'anki/latest.txt';
export const BOARD_DATA = 'board/data.json';

// ---------- Python's ways, where JavaScript differs ----------
export const key = (w: string) => w.trim().replaceAll('臺', '台');
export function plus(d: string, n: number) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
/** Python's str < str: by code point (JavaScript's < compares UTF-16 units). */
export function cmp(a: string, b: string) {
  const x = [...a], y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}
/** Python's round(x, n): the exact binary value, ties to even. */
export function pyRound(x: number, n: number) {
  const [int, frac = ''] = exactDecimal(Math.abs(x)).split('.');
  const kept = BigInt(int + frac.slice(0, n).padEnd(n, '0'));
  const tail = frac.slice(n).replace(/0+$/, '');
  // the exact value against the halfway point: above rounds up, below down, exactly on it to even
  const up = tail === '' ? false : tail[0] > '5' || (tail[0] === '5' && (tail.length > 1 || kept % 2n === 1n));
  const v = Number(up ? kept + 1n : kept) / 10 ** n;
  return x < 0 ? -v : v;
}
function exactDecimal(x: number) {
  // x = mantissa * 2^e exactly; write it in base 10 with BigInt
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const hi = buf.getUint32(0), lo = buf.getUint32(4);
  const expBits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e: number;
  if (expBits === 0) e = -1074;
  else { mant |= 1n << 52n; e = expBits - 1075; }
  if (e >= 0) return (mant << BigInt(e)).toString();
  const scaled = mant * 5n ** BigInt(-e); // mant * 2^e = mant * 5^-e / 10^-e
  const digits = scaled.toString().padStart(-e + 1, '0');
  return digits.slice(0, digits.length + e) + '.' + digits.slice(digits.length + e);
}
/** Python's str(float): 3.0, 4.5, 7.1. */
export const pyFloat = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));
const lines = (t: string) => t.split('\n');

// ---------- known-words.txt ----------
export function loadKw(files: Files) {
  const l = lines(files.get(KW) ?? '');
  if (l.length && l[l.length - 1] === '') l.pop();
  return l;
}
export function kwIndex(l: string[]) {
  const idx = new Map<string, number>();
  l.forEach((x, i) => {
    if (!x.trim() || x.startsWith('#')) return;
    idx.set(key(x.split('\t')[0]), i);
  });
  return idx;
}
export function kwGet(l: string[], i: number): [string, string, string] {
  const p = [...l[i].split('\t'), '', ''];
  return [p[0], p[1], p[2]];
}
export const kwTotal = (l: string[]) => l.filter((x) => x.trim() && !x.startsWith('#')).length;
export const kwSave = (files: Files, l: string[]) => files.set(KW, l.join('\n') + '\n');
export function kwStatus(l: string[]) {
  const out = new Map<string, [string, string]>();
  for (const i of kwIndex(l).values()) {
    const [w, s, d] = kwGet(l, i);
    out.set(key(w), [s, d]);
  }
  return out;
}

// ---------- data: frequency and the TOCFL list ----------
const freqMemo = new WeakMap<object, { f: Map<string, number>; t2s: Map<string, string> }>();
const tocMemo = new WeakMap<object, Map<string, string>>();
function freqData(files: Files) {
  let m = freqMemo.get(files);
  if (!m) {
    const f = new Map<string, number>(), t2s = new Map<string, string>();
    for (const l of lines(files.get(FREQ) ?? '')) {
      if (l.startsWith('#') || !l) continue;
      const [a, b] = l.split('\t');
      if (a.startsWith('~')) t2s.set(a.slice(1), b);
      else f.set(a, parseFloat(b));
    }
    m = { f, t2s };
    freqMemo.set(files, m);
  }
  return m;
}
const simp = (files: Files, w: string) => {
  const { t2s } = freqData(files);
  return [...key(w)].map((c) => t2s.get(c) ?? c).join('');
};
export function zipf(files: Files, word: string): number | null {
  const { f } = freqData(files);
  if (!f.size) return null;
  const s = [...simp(files, word)];
  const whole = s.join('');
  if (f.has(whole)) return f.get(whole)!;
  let inv = 0, i = 0, n = 0;
  while (i < s.length) {
    let found = false;
    for (let j = Math.min(s.length, i + 6); j > i; j--) {
      const piece = s.slice(i, j).join('');
      if (f.has(piece)) {
        inv += 1 / 10 ** (f.get(piece)! - 9);
        n += 1;
        i = j;
        found = true;
        break;
      }
    }
    if (!found) return null;
  }
  return pyRound(Math.log10(1 / inv / 10 ** (n - 1)) + 9, 2);
}
export const listed = (files: Files, word: string) => freqData(files).f.has(simp(files, word));
export function tocfl(files: Files) {
  let m = tocMemo.get(files);
  if (!m) {
    m = new Map();
    for (const l of lines(files.get(TOC) ?? '')) {
      if (!l.startsWith('#') && l.trim()) {
        const p = l.split('\t');
        m.set(p[0], p[1]);
      }
    }
    tocMemo.set(files, m);
  }
  return m;
}

// ---------- test-log.tsv ----------
export type Row = { i: number; date: string; target: string; kind: string; result: string; note: string };
export function readLog(files: Files): Row[] {
  const rows: Row[] = [];
  lines(files.get(LOG) ?? '').forEach((l, i) => {
    if (i === 0 || !l.trim()) return;
    const p = [...l.split('\t'), '', '', '', '', ''];
    rows.push({ i, date: p[0].trim(), target: p[1].trim(), kind: p[2].trim(), result: p[3].trim(), note: p[4].trim() });
  });
  return rows;
}
export function appendLog(files: Files, rows: Partial<Row>[]) {
  let text = files.get(LOG) ?? '';
  if (text && !text.endsWith('\n')) text += '\n';
  text += rows.map((r) => [r.date, r.target, r.kind, r.result || '-', (r.note ?? '').replaceAll('\t', ' ').replaceAll('\n', ' ')].join('\t') + '\n').join('');
  files.set(LOG, text);
}

export class Item {
  active = false; due: string | null = null; streak = 0; fails = 0;
  tries: string[] = []; lastTest: string | null = null; burst = false; retired: string | null = null; form = '';
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  activate(d: string, res: string, tested: boolean) {
    this.active = true; this.retired = null; this.due = plus(d, 3); this.streak = 0;
    this.fails = res === 'fail' && tested ? 1 : 0;
    this.tries = tested ? [res[0]] : [];
    this.burst = false;
  }
}
const sortRows = (a: Row, b: Row) => cmp(a.date, b.date) || a.i - b.i;
export function schedule(rows: Row[]) {
  const items = new Map<string, Item>();
  const it = (name: string) => {
    if (!items.has(name)) items.set(name, new Item(name));
    return items.get(name)!;
  };
  const seeds = rows.filter((r) => r.kind === 'seed').map((r) => r.i);
  const live = rows.filter((r) => !seeds.length || r.i >= seeds[0]);
  for (const r of rows) if (r.kind === 'form') it(r.target).form = r.note;
  const events: Row[] = live.filter((r) => r.kind === 'seed');
  const bursts = new Map<string, Row>();
  for (const r of live.filter((r) => r.kind !== 'seed').sort(sortRows)) {
    if (r.kind === 'burst') {
      const k = r.target + '\u0000' + r.date;
      if (!bursts.has(k)) {
        bursts.set(k, { ...r });
        events.push(bursts.get(k)!);
      } else if (r.result !== 'pass') {
        const b = bursts.get(k)!;
        b.result = [b.result, r.result].includes('fail') ? 'fail' : 'partial';
      }
    } else events.push(r);
  }
  for (const e of events) {
    const k = e.kind, d = e.date, res = e.result, x = it(e.target);
    if (k === 'seed') {
      const v: Record<string, string> = {};
      for (const m of e.note.matchAll(/(\w+)=(\S*)/g)) v[m[1]] = m[2];
      x.active = true; x.due = v.due ?? null; x.streak = parseInt(v.streak ?? '0'); x.fails = parseInt(v.fails ?? '0');
      x.tries = [...(v.tries ?? '')]; x.lastTest = v.last || null;
      x.burst = x.fails >= 3;
    } else if (k === 'retire') {
      x.active = false; x.retired = d; x.burst = false;
    } else if (TEST_KINDS.includes(k) && ['pass', 'partial', 'fail'].includes(res)) {
      x.lastTest = maxStr(x.lastTest ?? d, d);
      if (!x.active) {
        if (res !== 'pass') x.activate(d, res, true);
        continue;
      }
      if (res === 'pass') {
        if (k !== 'burst' && cmp(d, x.due!) < 0) {
          x.fails = 0;
          continue;
        }
        x.tries.push('s');
        x.fails = 0; x.burst = false;
        if (x.streak >= 1) { x.active = false; x.retired = d; }
        else { x.streak = 1; x.due = plus(d, 7); }
      } else {
        x.tries.push(res[0]);
        x.due = plus(d, 3); x.streak = 0;
        x.fails = res === 'fail' ? x.fails + 1 : 0;
        x.burst = x.fails >= 3;
      }
    } else if (WRITING_KINDS.includes(k) && ['partial', 'fail'].includes(res)) {
      if (x.lastTest && cmp(d, x.lastTest) < 0) continue;
      if (x.active) { x.due = minStr(x.due!, plus(d, 3)); x.streak = 0; }
      else x.activate(d, res, false);
    }
  }
  return items;
}
const maxStr = (a: string, b: string) => (cmp(a, b) >= 0 ? a : b);
const minStr = (a: string, b: string) => (cmp(a, b) <= 0 ? a : b);
export function table(rows: Row[]) {
  return [...schedule(rows).values()].filter((x) => x.active)
    .sort((a, b) => cmp(a.due!, b.due!) || b.fails - a.fails || cmp(a.name, b.name));
}
const lastSent = (rows: Row[]) => {
  const s = rows.filter((r) => r.kind === 'sent').map((r) => r.i);
  return s.length ? s[s.length - 1] : -1;
};
export function waitingTest(rows: Row[]) {
  const sent = rows.filter((r) => r.kind === 'sent').map((r) => r.target);
  const last = sent[sent.length - 1];
  return last !== undefined && !rows.some((r) => r.kind === 'graded' && r.target === last) ? last : null;
}
export function cardsSinceTest(rows: Row[]) {
  const after = lastSent(rows);
  return [...new Set(rows.filter((r) => r.kind === 'card' && r.i > after).map((r) => r.target))];
}

// ---------- learn-next.md: the queue ----------
export type Entry = { word: string; pinyin: string; gloss: string; sources: string[]; raw?: number; score?: number };
type Section = [string, string, Entry[] | string[]];
export class Queue {
  head = '';
  sections: Section[] = [];
  nextUp: [string, string, string, string][] = [];
  changed = false;
  constructor(text: string) {
    const t = lines(text);
    const heads = t.map((l, i) => (l.startsWith('## ') ? i : -1)).filter((i) => i >= 0);
    this.head = heads.length ? t.slice(0, heads[0]).join('\n').replace(/\s+$/, '') : '';
    heads.forEach((h, n) => {
      const end = n + 1 < heads.length ? heads[n + 1] : t.length;
      const title = t[h].slice(3);
      const name = title.split(' (')[0].split(' —')[0].trim();
      const rest = title.includes(' — ') ? title.slice(title.indexOf(' — ') + 3) : '';
      const body = t.slice(h + 1, end);
      if (LANE_NAMES.includes(name)) {
        const entries: Entry[] = [];
        for (const l of body) {
          if (!l.startsWith('- ')) continue;
          const f = l.slice(2).split(' · ');
          entries.push({
            word: f[0].trim(),
            pinyin: f.length > 1 ? f[1] : '',
            gloss: f.length > 4 ? f.slice(2, -2).join(' · ') : f.length > 2 ? f[2] : '',
            sources: f.length > 3 ? f[f.length - 1].split(',').map((s) => s.trim()).filter(Boolean) : [],
          });
        }
        this.sections.push([name, rest, entries]);
      } else if (name !== 'Next up') {
        this.sections.push([name, rest, body.filter((l) => l.trim())]);
      }
    });
  }
  lane(name: string): Entry[] {
    const s = this.sections.find((s) => s[0] === name);
    return (s?.[2] ?? []) as Entry[];
  }
  *entries(): Generator<[string, Entry]> {
    for (const name of LANE_NAMES) for (const e of this.lane(name)) yield [name, e];
  }
  find(word: string): [string | null, Entry | null] {
    const k = key(word);
    for (const [name, e] of this.entries()) if (key(e.word) === k) return [name, e];
    return [null, null];
  }
  parked(word: string) {
    const k = key(word);
    return (this.lane('Parked') as unknown as string[]).some((l) => l.split(' · ').map(key).includes(k));
  }
  remove(word: string) {
    const k = key(word);
    let where: string | null = null;
    for (const s of this.sections) {
      if (LANE_NAMES.includes(s[0])) {
        const n = s[2].length;
        s[2] = (s[2] as Entry[]).filter((e) => key(e.word) !== k);
        if (s[2].length < n) where = s[0];
      } else if (s[0] === 'Parked') {
        s[2] = (s[2] as string[]).map((l) => l.split(' · ').filter((x) => key(x) !== k).join(' · '));
      }
    }
    this.changed = this.changed || !!where;
    return where;
  }
  add(lane: string, word: string, pinyin: string, gloss: string, sources: string[]) {
    const [name, e] = this.find(word);
    if (e) {
      e.sources.push(...sources);
      this.changed = true;
      return `${word}: already in ${name}, +${sources.join(', ')}`;
    }
    this.lane(lane).push({ word: key(word), pinyin, gloss, sources: [...sources] });
    this.changed = true;
    return `${word} → ${lane}`;
  }
  text() {
    const out = [this.head, '', '## Next up', ''];
    this.nextUp.forEach(([w, p, g, lane], n) => out.push(`${n + 1}. ${w} · ${p} · ${g} (${lane})`));
    for (const [name, rest, body] of this.sections) {
      if (LANE_NAMES.includes(name)) {
        out.push('', `## ${name} (${body.length})` + (rest ? ` — ${rest}` : ''), '');
        for (const e of body as Entry[]) out.push(`- ${e.word} · ${e.pinyin} · ${e.gloss} · ${pyFloat(e.score!)} · ${e.sources.join(', ')}`);
      } else {
        const n = name === 'Parked' ? (body as string[]).reduce((a, l) => a + l.split(' · ').filter((x) => x.trim()).length, 0) : null;
        out.push('', `## ${name}` + (n !== null ? ` (${n})` : '') + (rest ? ` — ${rest}` : ''), '');
        out.push(...(body as string[]));
      }
    }
    return out.join('\n').replace(/\n+$/, '') + '\n';
  }
  save(files: Files, today: string) {
    rank(files, this, today);
    files.set(LN, this.text());
  }
}
export const loadQueue = (files: Files) => new Queue(files.get(LN) ?? '');

// ---------- sprints ----------
export const sprintNames = (files: Files) => [...files.keys()].filter((n) => /^[^/]*-sprint\.md$/.test(n)).sort(cmp);
export function sprintFile(files: Files, today: string) {
  const live: [string, string][] = [];
  for (const p of sprintNames(files)) {
    const first = lines(files.get(p)!)[0] + '\n';
    const m = first.match(/\[until (\d{4}-\d{2}-\d{2})\]/);
    const f = first.match(/\[from (\d{4}-\d{2}-\d{2})\]/);
    if (m && cmp(today, m[1]) <= 0 && (!f || cmp(f[1], today) <= 0)) live.push([m[1], p]);
  }
  live.sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]));
  return live.length ? live[0][1] : null;
}
export function sprintRule(files: Files, path: string, name: string) {
  const l = lines(files.get(path)!).find((x) => x.startsWith(`- **${name}**`));
  return l ? l.replace(/^[- ]+/, '').trim() : '';
}
export function sprintCap(files: Files, path: string) {
  const m = files.get(path)!.match(/Retest cap: (\d+)/);
  return m ? parseInt(m[1]) : 1;
}
export function sprintWords(files: Files, path: string): [number, string, string, string, boolean][] {
  const out: [number, string, string, string, boolean][] = [];
  lines(files.get(path)!).forEach((l, i) => {
    const m = l.match(/^\d+\.\s+(.+?) · (.+?) · (.+?) · [A-Z]\b(.*)$/u);
    if (m) out.push([i, m[1].trim(), m[2].trim(), m[3].trim(), m[4].includes('✓')]);
  });
  return out;
}

// ---------- ranking ----------
export function rank(files: Files, q: Queue, today: string) {
  const status = kwStatus(loadKw(files));
  const readable = new Set<string>();
  for (const [w, [s]] of status) if (s === 'K') for (const c of w) readable.add(c);
  const toc = tocfl(files);
  const wanted = [...q.entries()].map(([, e]) => key(e.word));
  for (const [w, lv] of toc) if (['N1', 'N2', '1', '2', '3', '4'].includes(lv) && !status.has(w)) wanted.push(w);
  const charCount = new Map<string, number>();
  for (const w of new Set(wanted)) for (const c of new Set(w)) if (!readable.has(c)) charCount.set(c, (charCount.get(c) ?? 0) + 1);
  const beforeTest = cmp(today, TOCFL_DATE) <= 0;
  for (const [, e] of q.entries()) {
    const w = key(e.word);
    const adj = e.sources.filter((s) => ADJ.test(s)).reduce((a, s) => a + parseFloat(s), 0);
    let weights = e.sources.filter((s) => !ADJ.test(s)).map((s) => SOURCE_WEIGHT[s.split(/\s+/)[0]] ?? 1);
    if (!weights.length) weights = [1];
    const personal = 1.5 * Math.min(5, Math.max(...weights) + 0.5 * (weights.length - 1));
    const L = status.get(w)?.[0] === 'L' ? 4 : 0;
    const z = zipf(files, w);
    let freq = z !== null ? Math.min(3.5, Math.max(0, z - 2.5)) : 0;
    if ([...w].length > 1 && !listed(files, w)) freq = Math.max(freq, 1);
    const lv = toc.get(w);
    const tb = (({ N1: 1.5, N2: 1.5, '1': 1.5, '2': 1.5, '3': 1.5, '4': 1 } as Record<string, number>)[lv ?? ''] ?? 0) * (beforeTest ? 1 : 0.5);
    const fresh = new Set([...w].filter((c) => !readable.has(c)));
    let reading = 0;
    for (const c of fresh) reading += Math.min(1, ((charCount.get(c) ?? 1) - 1) / 6);
    reading = Math.min(2, reading);
    e.raw = pyRound(1 + personal + L + freq + tb + reading + adj, 1);
    e.score = e.raw;
  }
  for (const s of q.sections) if (LANE_NAMES.includes(s[0])) (s[2] as Entry[]).sort((a, b) => b.raw! - a.raw! || cmp(a.word, b.word));
  const sp = sprintFile(files, today);
  if (sp) {
    q.nextUp = sprintWords(files, sp).filter(([, w, , , done]) => !done && status.get(key(w))?.[0] !== 'K').slice(0, 12).map(([, w, p, g]) => [w, p, g, 'Life']);
  } else {
    const tops = Object.fromEntries(LANE_NAMES.map((n) => [n, q.lane(n)[Symbol.iterator]()]));
    q.nextUp = [];
    for (const lane of NEXT_PATTERN) {
      const e = tops[lane].next();
      if (!e.done) q.nextUp.push([e.value.word, e.value.pinyin, e.value.gloss, lane]);
    }
  }
}

// ---------- Chinese Brain exports and the Anki snapshot ----------
export type BrainRow = { word: string; now: string; was: string; date: string; pinyin: string; meaning: string; sentence: string; source: string; saved: string };
export function readExport(text: string): [BrainRow[], string, boolean] {
  const rows: BrainRow[] = [];
  let edate: string | null = null, full = false;
  for (let l of lines(text)) {
    l = l.replace(/\r$/, '');
    if (l.startsWith('#')) {
      const m = l.match(/(\d{4}-\d{2}-\d{2})/);
      if (m && edate === null) edate = m[1];
      if (l.includes('everything so far')) full = true;
      continue;
    }
    if (!l.trim() || l.startsWith('word\t')) continue;
    const p = [...l.split('\t'), ...Array(9).fill('')];
    rows.push({ word: p[0].trim(), now: p[1].trim() || '-', was: p[2].trim() || '-', date: p[3].trim(), pinyin: p[4], meaning: p[5], sentence: p[6], source: p[7], saved: p[8] });
  }
  return [rows, edate ?? '0000-00-00', full];
}
export const exportNames = (files: Files) => [...files.keys()].filter((n) => /^imported\/chinese-brain-.*\.tsv$/.test(n)).sort(cmp);
export function ankiTargets(files: Files) {
  const t = new Set<string>();
  for (const l of lines(files.get(ANKI) ?? '')) {
    if (l.startsWith('#')) continue;
    const p = l.split('\t');
    if (p.length > 1 && p[1].trim()) t.add(key(p[1]));
  }
  return t;
}
export function savedSentences(files: Files, word: string) {
  const k = key(word), out: string[] = [];
  for (const f of exportNames(files)) {
    for (const r of readExport(files.get(f)!)[0]) {
      if (key(r.word) === k && r.saved.trim()) out.push(...r.saved.split('‖').map((x) => x.trim()).filter(Boolean));
    }
  }
  return [...new Set(out)];
}

// ---------- what the commands print ----------
export function statusText(files: Files, today: string) {
  const t = table(readLog(files));
  const out = [`Retest table, ${t.length} items (due · item · tries · right form)`];
  for (const x of t) {
    const flag = cmp(x.due!, today) < 0 ? ' · OVERDUE' : x.due === today ? ' · due' : '';
    out.push(`  ${x.due} · ${x.name} · ${x.tries.slice(-4).join('') || '-'}${x.burst ? ' · BURST' : ''}${flag} · ${x.form || '?'}`);
  }
  return out.join('\n') + '\n';
}

export function testPlanText(files: Files, today: string, allItems = false) {
  const out: string[] = [];
  const rows = readLog(files);
  const w = waitingTest(rows);
  if (w && !allItems) {
    return `Test ${w} is still on the board, not filed. Pull board/test and run \`words.py ingest\` first; one test at a time.\n`;
  }
  const t = table(rows);
  const sp = sprintFile(files, today);
  const cap = allItems ? null : sp ? sprintCap(files, sp) : 3;
  const due = t.filter((x) => cmp(x.due!, today) <= 0);
  const burst = due.filter((x) => x.burst);
  if (burst.length && !allItems) {
    const x = burst[0];
    return `BURST: ${x.name} failed three tests in a row. The whole test is a burst drill on it: 8–10 fast situations, every one needing the right form (${x.form}).\n`;
  }
  out.push(due.length ? 'Retests due (oldest first):' : 'No retests due.');
  for (const x of cap === null ? due : due.slice(0, cap)) out.push(`  ${x.name} · due ${x.due} · tries ${x.tries.slice(-4).join('') || '-'} · right form: ${x.form || '?'}`);
  if (cap !== null && due.length > cap) out.push(`  (${due.length - cap} more due; they wait for the next test)`);
  const taught = new Set([...ankiTargets(files), ...rows.filter((r) => r.kind === 'card').map((r) => key(r.target))]);
  const names = new Set(t.map((x) => x.name));
  const st = kwStatus(loadKw(files));
  const waiting = [...st].filter(([w, [s, d]]) => s === 'L' && taught.has(w) && cmp(d, plus(today, -14)) <= 0 && !names.has(w))
    .map(([w, [, d]]) => [d, w] as [string, string]).sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]));
  const n = allItems ? 2 : 1;
  if (waiting.length) {
    out.push(`Delayed check (${waiting.length} L words taught 2+ weeks ago; oldest first):`);
    for (const [d, w] of waiting.slice(0, n)) out.push(`  ${w} · taught or last changed ${d}`);
  }
  const since = cardsSinceTest(rows).filter((w) => st.get(key(w))?.[0] !== 'K');
  out.push('Cards since the last test: ' + (since.length ? since.join(' · ') : 'none'));
  if (sp) out.push(`Sprint on (${sp}): ${sprintRule(files, sp, 'Tests') || 'see its file'}`);
  return out.join('\n') + '\n';
}

/** The daily test's plan: due retests (oldest overdue first), L words still short of three situations (each with the
 *  situations it has, so the next one is different: lateral), one word that just reached three (harder: vertical), the
 *  cards since the last test. short: after 3+ missed days, the most overdue retests only. */
export function dailyPlan(files: Files, today: string, o: { short?: boolean } = {}) {
  const rows = readLog(files), out: string[] = [];
  const t = table(rows), due = t.filter((x) => cmp(x.due!, today) <= 0);
  const burst = due.find((x) => x.burst);
  if (burst && !o.short) out.push(`BURST: ${burst.name} failed three tests in a row: give it 3 of the items, fast situations that each need its right form (${burst.form}).`);
  const cap = o.short ? 4 : 5;
  out.push(due.length ? `Retests due (oldest first${due.length > cap ? `; the first ${cap}, the rest wait` : ''}):` : 'No retests due.');
  for (const x of due.slice(0, cap)) out.push(`  ${x.name} · due ${x.due} · tries ${x.tries.slice(-4).join('') || '-'} · right form: ${x.form || '?'}`);
  if (o.short) {
    out.push('A comeback after missed days: only these, nothing new, no listening or TOCFL items. Easy to finish.');
    return out.join('\n') + '\n';
  }
  const st = kwStatus(loadKw(files));
  const taught = new Set([...ankiTargets(files), ...rows.filter((r) => r.kind === 'card').map((r) => key(r.target))]);
  const names = new Set(t.map((x) => x.name));
  const since = new Set(cardsSinceTest(rows).map(key));
  const lw = [...st].filter(([w, [s, d]]) => s === 'L' && taught.has(w) && !names.has(w) && !since.has(w) && cmp(d, plus(today, -2)) <= 0)
    .map(([w, [, d]]) => ({ w, d, sit: situations(rows, w, d) })).sort((a, b) => a.sit.length - b.sit.length || cmp(a.d, b.d));
  if (lw.length) {
    out.push(`Words he is learning, toward ${SITUATIONS} different situations each (a new situation at the same level, unlike the ones he already had):`);
    for (const x of lw.slice(0, 3)) out.push(`  ${x.w} · ${x.sit.length}/${SITUATIONS}${x.sit.length ? ` · already: ${x.sit.join(', ')}` : ''}`);
  }
  const held = [...st].filter(([, [s, d]]) => s === 'K' && cmp(d, plus(today, -30)) >= 0).map(([w]) => w)
    .filter((w) => situations(rows, w, plus(today, -60)).length >= SITUATIONS);
  if (held.length) out.push(`A word that holds (one item, a level up: a harder situation, a competing word, a longer answer): ${held[held.length - 1]}`);
  out.push('Cards since the last test: ' + ([...since].filter((w) => st.get(w)?.[0] !== 'K').join(' · ') || 'none'));
  const sp = sprintFile(files, today);
  if (sp) out.push(`Sprint on (${sp}): ${sprintRule(files, sp, 'Tests') || 'see its file'}`);
  return out.join('\n') + '\n';
}

/** Every field the board reads from board/data that the engine owns. */
export function boardPayload(files: Files, today: string) {
  const l = loadKw(files), rows = readLog(files);
  const q = loadQueue(files);
  rank(files, q, today);
  const old = JSON.parse(files.get(BOARD_DATA) ?? '{}');
  const words: Record<string, number> = {}, tests: Record<string, [number, number]> = {};
  for (const [d, n] of Object.entries(old.words ?? {})) if (cmp(d, LOGGED_FROM) < 0) words[d] = n as number;
  for (const [d, v] of Object.entries(old.tests ?? {})) if (cmp(d, LOGGED_FROM) < 0) tests[d] = v as [number, number];
  for (const r of rows) {
    if (cmp(r.date, LOGGED_FROM) < 0) continue;
    if (r.kind === 'card') words[r.date] = (words[r.date] ?? 0) + 1;
    else if (TEST_KINDS.includes(r.kind) && ['pass', 'partial', 'fail'].includes(r.result)) {
      const [p, g] = tests[r.date] ?? [0, 0];
      tests[r.date] = [p + (r.result === 'pass' ? 1 : 0), g + 1];
    }
  }
  return { total: kwTotal(l), nextUp: q.nextUp.map(([w, p, g, lane]) => [w, p, g, LANES[lane]]), words, tests, uses: situationCounts(files), updated: today };
}

/** Python's json.dumps(x, ensure_ascii=False, indent=1), for comparing with push.json. */
export function pyJson(x: unknown, indent = 1, level = 0): string {
  const pad = ' '.repeat(indent * (level + 1)), end = ' '.repeat(indent * level);
  if (Array.isArray(x)) return x.length ? '[\n' + x.map((v) => pad + pyJson(v, indent, level + 1)).join(',\n') + '\n' + end + ']' : '[]';
  if (x && typeof x === 'object') {
    const e = Object.entries(x);
    return e.length ? '{\n' + e.map(([k, v]) => pad + JSON.stringify(k) + ': ' + pyJson(v, indent, level + 1)).join(',\n') + '\n' + end + '}' : '{}';
  }
  return JSON.stringify(x);
}

// ---------- changes (used once the website is the source) ----------
/** words.py card: the word is being taught today. */
export function card(files: Files, word: string, today: string) {
  const out = [];
  const sents = savedSentences(files, word);
  out.push(sents.length ? 'His saved sentences (put them first in the card):' : 'No saved sentences.');
  for (const s of sents) out.push('  ' + s);
  const l = loadKw(files), idx = kwIndex(l), k = key(word);
  if (idx.has(k)) l[idx.get(k)!] = `${kwGet(l, idx.get(k)!)[0]}\tL\t${today}`;
  else l.push(`${k}\tL\t${today}`);
  kwSave(files, l);
  appendLog(files, [{ date: today, target: k, kind: 'card', result: '-', note: '' }]);
  const q = loadQueue(files);
  const where = q.remove(word);
  const sp = sprintFile(files, today);
  if (sp) {
    const text = lines(files.get(sp)!);
    for (const [i, w, , , done] of sprintWords(files, sp)) {
      if (key(w) === k && !done) {
        text[i] += ' ✓';
        files.set(sp, text.join('\n'));
      }
    }
  }
  q.save(files, today);
  out.push(`${word} → L ${today}` + (where ? `; out of ${where}` : ''));
  out.push('Suggested next: ' + q.nextUp.slice(0, 3).map(([w, p, g]) => `${w} (${p} — ${g})`).join(' · '));
  const waiting = waitingTest(readLog(files));
  if (waiting) out.push(`Test ${waiting} is on the board.`);
  else out.push('The next daily test comes at 10 pm.');
  return out.join('\n');
}

/** words.py add: queue words, one [lane, 'word · pinyin · gloss · source'] each. */
export function addWords(files: Files, items: [string, string][], today: string) {
  const q = loadQueue(files), st = kwStatus(loadKw(files)), out = [];
  for (const [lane, line] of items) {
    const f = line.replace(/^[- ]+/, '').split(' · ').map((x) => x.trim());
    if (f.length >= 2 && /^\d+$/.test(f[f.length - 2])) f.splice(f.length - 2, 1);
    const word = f[0], sources = f[f.length - 1].split(',').map((s) => s.trim());
    if (st.get(key(word))?.[0] === 'K') { out.push(`skip ${word}: already K`); continue; }
    out.push(q.add(lane.trim(), word, f.length > 2 ? f[1] : '', f.slice(2, -1).join(' · '), sources));
  }
  q.save(files, today);
  return out.join('\n');
}

/** words.py log (file_rows): graded rows in, known-word flips applied. */
/** The different situations he used a word correctly in since `from` (when it became L): one per test day, per
 *  essay day, per tutor or chat day. */
export function situations(rows: Row[], word: string, from: string) {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.result !== 'pass' || key(r.target) !== word || cmp(r.date, from) < 0) continue;
    const src = ITEM_KINDS.includes(r.kind) ? 'test' : WRITING_KINDS.includes(r.kind) ? (r.kind === 'free' && /^tutor/.test(r.note) ? 'tutor' : r.kind) : null;
    if (src) out.add(`${src} ${r.date}`);
  }
  return [...out].sort();
}
/** For each L word: how many of the three situations it has (Progress shows it). */
export function situationCounts(files: Files) {
  const rows = readLog(files), out: Record<string, number> = {};
  for (const [w, [s, d]] of kwStatus(loadKw(files))) if (s === 'L') out[w] = Math.min(SITUATIONS, situations(rows, w, d).length);
  return out;
}

export function logRows(files: Files, rows: Partial<Row>[]) {
  appendLog(files, rows);
  const l = loadKw(files), idx = kwIndex(l), flips = [];
  for (const r of rows) {
    const k = key(r.target!);
    if (!idx.has(k) || !['pass', 'fail'].includes(r.result!)) continue;
    const [w, s, d] = kwGet(l, idx.get(k)!);
    if (r.result === 'pass' && s === 'L' && situations(readLog(files), k, d).length >= SITUATIONS) { l[idx.get(k)!] = `${w}\tK\t${r.date}`; flips.push(`${w} L→K (${SITUATIONS} situations)`); }
    else if (r.result === 'fail' && s === 'K' && TEST_KINDS.includes(r.kind!)) { l[idx.get(k)!] = `${w}\tL\t${r.date}`; flips.push(`${w} K→L`); }
  }
  if (flips.length) kwSave(files, l);
  return `Logged ${rows.length} row(s).` + (flips.length ? ` Known words: ${flips.join(', ')}.` : '');
}

// ---------- the nightly, ported from words.py (merge, kit, file_cards, ingest, send) ----------
/** Where the card and test rules, his leaks and the Known components live: the system's own text. */
export const MEMORY = 'chinese.md';
export const LEDGER = 'cards-filed.tsv';

function shortGloss(meaning: string) {
  let m = meaning.replace(/\s+/g, ' ').trim();
  if (m.length > 60) m = m.split(';')[0].trim();
  return m.slice(0, 70).replace(/[ ,;]+$/, '');
}

function brainEntry(r: BrainRow, q: Queue, status: Map<string, [string, string]>): [string | null, string | null] {
  const w = key(r.word), meaning = r.meaning.trim();
  if (r.now === 'F') {
    if (/^\p{Lu}/u.test(meaning) && !meaning.slice(0, 6).includes('(Tw)')) return [null, 'proper noun'];
    if ([...w].length === 1 && [...status.keys(), ...[...q.entries()].map(([, e]) => key(e.word))].some((x) => x.includes(w) && x !== w)) return [null, 'covered by a longer word'];
  }
  const lane = meaning.includes('(Tw)') ? 'Taiwan' : 'Life';
  const sources = ['Brain', ...(r.saved.trim() ? ['saved'] : [])];
  return [q.add(lane, w, r.pinyin.trim(), shortGloss(meaning), sources), null];
}

/** words.py merge: Chinese Brain exports (their texts, oldest first) into known-words.txt and the queue. */
export function merge(files: Files, exports: string[], today: string) {
  const l = loadKw(files);
  const q = loadQueue(files);
  const cards = new Set([...ankiTargets(files), ...readLog(files).filter((r) => r.kind === 'card').map((r) => key(r.target))]);
  const log: Record<string, string[]> = { added: [], flipped: [], removed: [], kept_L: [], file_newer: [], dequeued: [], repeat: [], saved: [], queued: [], skipped: [] };
  const cutoff = plus(today, -14);
  const before = kwTotal(l);
  const repeated = new Set<string>();
  for (const text of exports) {
    const [rows, edate, full] = readExport(text);
    for (const r of rows) {
      const { word: w, now, was } = r;
      if (!w) continue;
      const date = r.date || edate;
      if (r.saved.trim()) log.saved.push(`${w} (${now})`);
      const idx = kwIndex(l), k = key(w);
      const have = idx.has(k) ? kwGet(l, idx.get(k)!) : null;
      if (have && cmp(have[2], date) > 0) {
        if (have[1] !== now) log.file_newer.push(`${have[0]}: file ${have[1]} (${have[2]}), Chinese Brain ${now} (${date})`);
        continue;
      }
      const [name, queued] = q.find(w);
      if (queued && r.saved.trim() && !queued.sources.includes('saved')) {
        queued.sources.push('saved');
        q.changed = true;
      }
      if (now === 'K') {
        if (!have) { l.push(`${k}\tK\t${date}`); log.added.push(`${k} K`); }
        else if (have[1] === 'L' && cmp(have[2], cutoff) >= 0) { log.kept_L.push(`${have[0]} (L since ${have[2]})`); continue; }
        else if (have[1] !== 'K') { l[idx.get(k)!] = `${have[0]}\tK\t${date}`; log.flipped.push(`${have[0]} ${have[1]}→K`); }
        if (queued && q.remove(w)) log.dequeued.push(`${w} (${name})`);
      } else if (now === 'L') {
        const wasLearning = have !== null && have[1] === 'L' && cmp(have[2], date) < 0;
        if (!have) { l.push(`${k}\tL\t${date}`); log.added.push(`${k} L`); }
        else if (have[1] !== 'L') { l[idx.get(k)!] = `${have[0]}\tL\t${date}`; log.flipped.push(`${have[0]} ${have[1]}→L`); }
        if (cards.has(k) || wasLearning) {
          if (queued && q.remove(w)) log.dequeued.push(`${w} (${name}; has a card)`);
        } else if (queued) {
          if (was !== 'L' && !full && !repeated.has(k)) { repeated.add(k); queued.sources.push('Brain'); q.changed = true; log.repeat.push(w); }
        } else {
          const [done, why] = brainEntry(r, q, kwStatus(l));
          (done ? log.queued : log.skipped).push(done ?? `${w} (${why})`);
        }
      } else if (now === 'F') {
        if (have) { l.splice(idx.get(k)!, 1); log.removed.push(`${have[0]} (was ${have[1]}, now F)`); }
        if (queued) {
          if (was !== 'F' && !full && !repeated.has(k)) { repeated.add(k); queued.sources.push('Brain'); q.changed = true; log.repeat.push(w); }
        } else if (!q.parked(w)) {
          const [done, why] = brainEntry(r, q, kwStatus(l));
          (done ? log.queued : log.skipped).push(done ?? `${w} (${why})`);
        }
      } else if (now === '-' && ['K', 'L', 'F'].includes(was)) {
        if (have) { l.splice(idx.get(k)!, 1); log.removed.push(`${have[0]} (off his list)`); }
        if (queued && q.remove(w)) log.dequeued.push(`${w} (${name})`);
      }
    }
  }
  kwSave(files, l);
  q.save(files, today);
  const out = [`known-words.txt: ${before} → ${kwTotal(l)} entries`];
  for (const [k, v] of Object.entries(log)) if (v.length) out.push(`${k}: ${[...new Set(v)].join(' · ')}`);
  return out;
}

/** A section of chinese.md by its ### title. */
export function mdSection(md: string, title: string) {
  const m = md.match(new RegExp('^### ' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n([\\s\\S]*?)(?=^### |^## |^---)', 'm'));
  return m ? m[1].trim() : '';
}

/** words.py kit: what cards are written from (board/cardkit). */
export function kit(files: Files, today: string) {
  const md = files.get(MEMORY) ?? '';
  const comp = md.match(/\*\*Known components\*\*[^:]*:\s*(.+)/);
  const known: string[] = [], learning: string[] = [];
  for (const x of loadKw(files)) {
    const p = x.split('\t');
    if (x.startsWith('#') || p.length < 2) continue;
    if (p[1].trim() === 'K') known.push(p[0].trim());
    else if (p[1].trim() === 'L') learning.push(p[0].trim());
  }
  const sp = sprintFile(files, today);
  const saved: Record<string, string[]> = {};
  for (const f of exportNames(files)) {
    for (const r of readExport(files.get(f)!)[0]) {
      for (const s of r.saved.split('‖').map((x) => x.trim())) {
        if (!s) continue;
        const list = (saved[key(r.word)] ??= []);
        if (!list.includes(s)) list.push(s);
      }
    }
  }
  return {
    v: 1,
    spec: '### Card structure\n' + mdSection(md, 'Card structure') + '\n\n### Voice\n' + mdSection(md, 'Voice'),
    sprint: sp ? sprintRule(files, sp, 'Cards') : '',
    components: comp ? comp[1].trim().replace(/\.$/, '') : '',
    chars: known.filter((w) => [...w].length === 1).join(''),
    known: known.join(' '),
    learning: learning.join(' '),
    saved: Object.fromEntries(Object.entries(saved).filter(([, x]) => x.length)),
  };
}

/** The day he carded it where he was, turning over at 4 am like the board. A stamp with no offset (…Z) is read in
 *  Taipei, as the Mac did. */
export function boardDay(stamp: string) {
  const m = String(stamp).match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?)(Z|[+-]\d\d:\d\d)?$/);
  if (!m) return String(stamp).slice(0, 10);
  const t = Date.parse(m[1] + (m[2] ?? 'Z'));
  if (Number.isNaN(t)) return String(stamp).slice(0, 10);
  const off = !m[2] || m[2] === 'Z' ? 480 : (m[2][0] === '-' ? -1 : 1) * (Number(m[2].slice(1, 3)) * 60 + Number(m[2].slice(4, 6)));
  return new Date(t + (off - 240) * 60_000).toISOString().slice(0, 10);
}

/** words.py file_cards: every card he marked Carded and nobody filed yet, oldest first, filed on the day he carded
 *  it; the components he said he knows go into Known components. `cards` and `notes` are the docs by id. */
export function fileCards(files: Files, cards: Record<string, Record<string, unknown>>, notes: Record<string, Record<string, unknown>>, today: string) {
  const ledger = files.get(LEDGER) ?? '';
  const filed = new Set(lines(ledger).filter((x) => x.trim() && !x.startsWith('#')).map((x) => x.split('\t')[0]));
  const said: string[] = [], todo: [number, string, Record<string, unknown>][] = [];
  for (const [id, d0] of Object.entries(cards)) {
    let d = d0;
    if (!d?.word) continue;
    const n = notes[id];
    if (n) {
      const nw = String(n.word ?? '').replace(/<[^>]+>|&nbsp;/g, ' ').trim();
      if (nw && /[\u3400-\u9fff]/.test(nw) && nw !== d.word) d = { ...d, word: nw };
    }
    if (d.carded && !filed.has(id)) {
      const m = String(d.carded).match(/(Z|[+-]\d\d:\d\d)$/);
      const t = Date.parse(m ? String(d.carded) : String(d.carded) + '+08:00');
      todo.push([Number.isNaN(t) ? -Infinity : t, id, d]);
    } else if (!d.carded && filed.has(id)) said.push(`! ${d.word} was filed, then un-carded on the board: it stays logged`);
  }
  todo.sort((a, b) => a[0] - b[0] || cmp(a[1], b[1]));
  let led = ledger || '# cards filed from the board: doc id, word, carded (on the board), filed\n';
  const knows: string[] = [];
  for (const [, id, d] of todo) {
    const day = boardDay(String(d.carded));
    card(files, String(d.word), day);
    if (!led.endsWith('\n')) led += '\n';
    led += [id, d.word, d.carded, today].join('\t') + '\n';
    for (const [c, v] of Object.entries((d.knows as Record<string, unknown>) ?? {})) if (v === true) knows.push(c);
    said.push(`filed ${d.word} (${day})`);
  }
  if (todo.length) files.set(LEDGER, led);
  if (knows.length) {
    const md = files.get(MEMORY) ?? '';
    const m = md.match(/(\*\*Known components\*\*[^:]*:\s*)(.+?)\.?\n/);
    const have = m ? m[2].split(/\s+/) : [];
    const fresh = [...new Set(knows)].filter((c) => !have.includes(c));
    if (fresh.length && !m) said.push('! No **Known components** line in chinese.md: add by hand: ' + fresh.join(' '));
    else if (fresh.length && m) {
      const at = m.index! + m[1].length;
      files.set(MEMORY, md.slice(0, at) + [...have, ...fresh].join(' ') + md.slice(at + m[2].length));
      said.push('Known components + ' + fresh.join(' '));
    }
  }
  return said;
}

type TestDoc = { id?: string; done?: string | null; filed?: string | null; title?: string; items?: Record<string, unknown>[]; [k: string]: unknown };
/** words.py ingest: file a test he answered. Returns the answers nobody graded (to grade, then logRows). */
export function ingest(files: Files, doc: TestDoc, today: string) {
  const rows = readLog(files);
  if (rows.some((r) => r.kind === 'graded' && r.target === doc.id)) return { said: [`Test ${doc.id} is already filed.`], open: [] };
  if (!doc.done) return { said: [`Test ${doc.id} is not finished.`], open: [] };
  const fresh: Partial<Row>[] = [], open: { item: Record<string, unknown>; a: Record<string, unknown> }[] = [];
  for (const it of doc.items ?? []) {
    for (const a of [it, ...(it.retry ? [it.retry as Record<string, unknown>] : [])]) {
      if (a.answer && RESULTS.includes(String(a.result))) {
        const when = String(a.at || doc.done || today).slice(0, 10);
        let note = String(a.answer) + (a.natural && a.natural !== a.answer ? ` → ${a.natural}` : '');
        if (a.secs) note += ` (${a.secs} s)`;
        fresh.push({ date: when, target: String(it.target), kind: String(it.kind), result: String(a.result), note });
      } else if (a.answer) open.push({ item: it, a });
    }
  }
  const said: string[] = [];
  if (fresh.length) said.push(logRows(files, fresh));
  const secs = (doc.items ?? []).map((a) => Number(a.secs)).filter((x) => x > 0).sort((a, b) => a - b);
  const med = secs.length ? (secs.length % 2 ? secs[(secs.length - 1) / 2] : (secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2) : null;
  const clean = fresh.filter((r) => r.result === 'pass').length, counted = fresh.filter((r) => r.result !== 'none').length;
  return { said, open, graded: { date: today, target: String(doc.id), kind: 'graded', result: '-', note: `${clean} of ${counted} clean` + (med !== null ? ` · median ${Math.round(med)} s` : '') } as Partial<Row> };
}

/** words.py send: what is wrong with a test before it goes out (nothing: []). */
export function testProblems(files: Files, doc: TestDoc, force = false) {
  const problems: string[] = [];
  const waiting = waitingTest(readLog(files));
  if (waiting && !force) problems.push(`test ${waiting} is still open, not filed`);
  const items = doc.items ?? [];
  if (items.length < 1 || items.length > 14) problems.push(`${items.length} items`);
  items.forEach((it, i) => {
    const n = i + 1;
    for (const f of ['label', 'target', 'kind', 'model', 'check']) if (!it[f]) problems.push(`item ${n}: no ${f}`);
    if (!(it.ask || it.hear)) problems.push(`item ${n}: no ask or hear`);
    if (!ITEM_KINDS.includes(String(it.kind))) problems.push(`item ${n}: kind must be one of ${ITEM_KINDS.join(', ')}`);
    if (it.kind === 'tocfl') {
      const c = it.choices;
      if (!Array.isArray(c) || c.length !== 4 || c.some((x) => !String(x).trim()) || new Set(c.map(String)).size !== 4) problems.push(`item ${n}: a tocfl item needs four different choices`);
      if (!(Number.isInteger(it.key) && (it.key as number) >= 0 && (it.key as number) < 4)) problems.push(`item ${n}: a tocfl item needs key, the right choice's index (0–3)`);
      if (!(it.read || it.hear)) problems.push(`item ${n}: a tocfl item needs read (a passage) or hear (an exchange)`);
    }
    if (it.kind === 'listen' && !it.hear) problems.push(`item ${n}: a listen item needs hear`);
    if (it.kind === 'tocfl' || it.kind === 'listen') return;
    const word = key(String(it.target ?? ''));
    if (/[一-鿿]/.test(word) && key(String(it.ask ?? '') + ' ' + String(it.label ?? '')).includes(word)) problems.push(`item ${n}: the target ${word} is in the prompt`);
  });
  return problems;
}
/** words.py send, once it passes: the test as the board takes it, and the `sent` row logged. */
export function sendTest(files: Files, doc: TestDoc, today: string) {
  const rows = readLog(files);
  const id = doc.id ?? `${today}-${rows.filter((r) => r.kind === 'sent' && r.date === today).length + 1}`;
  const items = (doc.items ?? []).map((it) => {
    const x = { ...it };
    for (const f of ['answer', 'secs', 'result', 'natural', 'why', 'retry']) if (!(f in x)) x[f] = null;
    return x;
  });
  const out = { ...doc, id, sent: doc.sent ?? today, done: null, filed: null, items };
  appendLog(files, [{ date: today, target: id, kind: 'sent', result: '-', note: items.map((it) => String(it.label)).join(' · ') }]);
  return out;
}
