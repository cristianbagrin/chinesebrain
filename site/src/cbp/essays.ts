// Chinese Brain Plus: the marks on his daily essays (collection `reviews`) and his To improve list (`improve`),
// ported from life/chinese/essays.py. A marks text is checked the way the board reads it (each mark found by his
// words from where the last one ended) before anything is written. The format, as essays.py had it:
//
//   DAY 54
//   fix | 我們回家我就睡午覺了 | 我們一回家我就睡午覺了 | 一…就 = as soon as.
//   fix! | 裡面的一個女生跟我開始說話 | 裡面一個女生開始跟我說話
//   better | 要上腳踏車回家的時候 | 要騎車回家的時候
//   good | 覺得蠻爽的
//   word | project | 專題
//   done | e50-b | 她開始跟我說話
//
// fix a mistake · better right but not how a Taiwanese person says it · good done well, as he wrote it · word
// English he dropped in, then the Chinese. `!` also puts a fix or better on his list. done crosses an item off with
// the words of this essay that get it right.

const KINDS = ['fix', 'better', 'good', 'word'];
const LISTABLE = ['fix', 'better'];
const SPACE = ' 　';
export type Mark = { t: string; mine: string; nat?: string; note?: string };
type M = Mark & { line: number; listed: boolean; i?: number | null; j?: number };
type Doc = Record<string, unknown>;

export const norm = (t: unknown) => String(t ?? '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');

/** The board's reading: each mark found by its words from where the last one ended; one it can't find drops. */
export function anchor(text: string, marks: Mark[] = []) {
  const out: (Mark & { i: number; j: number })[] = [];
  let pos = 0;
  for (const m of marks) {
    const mine = String(m.mine ?? '');
    if (!mine.trim() || mine.includes('\n') || !KINDS.includes(m.t)) continue;
    const i = text.indexOf(mine, pos);
    if (i < 0) continue;
    out.push({ ...m, i, j: i + mine.length });
    pos = i + mine.length;
  }
  return out;
}

function parse(src: string) {
  const blocks: { day: number; marks: M[]; done: { id: string; s: string; line: number }[] }[] = [];
  const errs: string[] = [];
  let cur: (typeof blocks)[number] | null = null;
  src.split('\n').forEach((raw, k) => {
    const n = k + 1, line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const d = line.match(/^day\s*(\d+)$/i);
    if (d) {
      const day = Number(d[1]);
      if (blocks.some((b) => b.day === day)) errs.push(`line ${n}: DAY ${day} comes twice`);
      cur = { day, marks: [], done: [] };
      blocks.push(cur);
      return;
    }
    if (!cur) return void errs.push(`line ${n}: put a DAY line before the marks`);
    const f = line.split('|').map((x) => x.trim());
    let kind = f[0].toLowerCase().replace(/ /g, '');
    let listed = kind.endsWith('!');
    kind = kind.replace(/!+$/, '');
    const where = `DAY ${cur.day}, line ${n}`;
    if (kind === 'done') {
      if (f.length !== 3 || !f[1] || !f[2]) errs.push(`${where}: done | <item id> | <his words that get it right>`);
      else cur.done.push({ id: f[1], s: f[2], line: n });
      return;
    }
    if (!KINDS.includes(kind)) return void errs.push(`${where}: "${f[0]}" is not a mark (fix, better, good, word, done)`);
    if (listed && !LISTABLE.includes(kind)) {
      errs.push(`${where}: only fix and better go on his list`);
      listed = false;
    }
    const need = ({ good: 2, word: 3 } as Record<string, number>)[kind];
    if ((need && f.length !== need) || (!need && f.length < 3) || !f.slice(1, kind === 'good' ? 2 : 3).every(Boolean)) {
      return void errs.push(`${where}: ${kind} takes ${({ good: 'good | his words', word: 'word | english | 中文' } as Record<string, string>)[kind] ?? `${kind} | his words | the right way | note`}`);
    }
    const mk: M = { t: kind, mine: f[1], line: n, listed };
    if (kind !== 'good') {
      mk.nat = f[2];
      if (f[2] === f[1]) errs.push(`${where}: the right way is the same as his words`);
    }
    if (LISTABLE.includes(kind) && f.length > 3 && f.slice(3).join('|').trim()) mk.note = f.slice(3).join('|').trim();
    if (kind === 'word' && !/[A-Za-z]/.test(f[1])) errs.push(`${where}: a word mark is for English he dropped in; use fix for Chinese`);
    cur.marks.push(mk);
  });
  return { blocks, errs };
}

function place(text: string, marks: M[], day: number, errs: string[]) {
  let pos = 0;
  for (const m of marks) {
    const mine = m.mine;
    let i = text.indexOf(mine, pos);
    if (i < 0) {
      errs.push(`DAY ${day}, line ${m.line}: 「${mine}」 ${text.includes(mine) ? 'comes before the mark above it; keep the essay’s order' : 'is not in the essay; copy his words exactly'}`);
      m.i = null;
      continue;
    }
    let j = i + mine.length;
    if (m.t !== 'good') {
      if (i - 1 >= pos && SPACE.includes(text[i - 1])) i -= 1;
      if (j < text.length && SPACE.includes(text[j]) && /[A-Za-z0-9)]/.test(text[j - 1])) j += 1;
    }
    m.mine = text.slice(i, j);
    m.i = i;
    m.j = j;
    pos = j;
  }
}

const pad = (d: number) => `d${String(d).padStart(3, '0')}`;
const stamp = () => new Date().toISOString();

/**
 * Check a marks text against the essays, reviews and list (each by id) and say what to write: the reviews to set,
 * the list items to add and to cross off. Nothing is written here. `errs` non-empty means nothing should be.
 */
export function plan(src: string, essays: Record<string, Doc>, reviews: Record<string, Doc>, improve: Record<string, Doc>, today: string) {
  const { blocks, errs } = parse(src);
  const byDay = new Map(Object.values(essays).filter((e) => e?.day && norm(e.text).trim()).map((e) => [Number(e.day), e]));
  const writes: { col: string; id: string; op: 'set' | 'update'; data: Doc }[] = [];
  const ids = new Set(Object.keys(improve));
  for (const b of blocks) {
    const e = byDay.get(b.day);
    if (!e) {
      errs.push(`DAY ${b.day}: no essay with that DAY`);
      continue;
    }
    const text = norm(e.text);
    place(text, b.marks, b.day, errs);
    const fresh = b.marks.filter((m) => m.i != null);
    const old = reviews[pad(b.day)];
    const kept = old ? anchor(text, (old.marks as Mark[]) ?? []) : [];
    let overlap = false;
    for (const m of fresh) for (const o of kept) if (m.i! < o.j && o.i < m.j!) {
      overlap = true;
      errs.push(`DAY ${b.day}, line ${m.line}: 「${m.mine.trim()}」 overlaps a mark already there: 「${o.mine.trim()}」`);
    }
    const all = [...kept, ...fresh.map((m) => ({ ...m, i: m.i!, j: m.j! }))].sort((a, c) => a.i - c.i);
    const marks: Mark[] = all.map((m) => Object.fromEntries((['t', 'mine', 'nat', 'note'] as const).filter((k) => m[k]).map((k) => [k, m[k]])) as Mark);
    const got = anchor(text, marks);
    if (!overlap && got.map((g) => g.i).join() !== all.map((m) => m.i).join()) {
      const bad = all.find((m, k) => got[k]?.i !== m.i);
      errs.push(`DAY ${b.day}: 「${bad?.mine.trim()}」 would land in the wrong place; give more of his words`);
    }
    writes.push({ col: 'reviews', id: pad(b.day), op: 'set', data: { day: b.day, review: today, marks } });
    for (const m of fresh) {
      if (!m.listed) continue;
      if (Object.values(improve).some((x) => Number(x.day) === b.day && String(x.mine ?? '').trim() === m.mine.trim())) continue;
      let n = 1;
      while (ids.has(`c${String(b.day).padStart(3, '0')}-${n}`)) n++;
      const id = `c${String(b.day).padStart(3, '0')}-${n}`;
      ids.add(id);
      writes.push({ col: 'improve', id, op: 'set', data: { mine: m.mine, nat: m.nat, day: b.day, added: stamp(), by: 'claude', done: false } });
    }
    for (const d of b.done) {
      const x = improve[d.id], where = `DAY ${b.day}, line ${d.line}`;
      if (!x) errs.push(`${where}: no item ${d.id}`);
      else if (x.removed) errs.push(`${where}: ${d.id} was removed; leave it`);
      else if (x.done) errs.push(`${where}: ${d.id} is already crossed off`);
      else if (x.day && Number(x.day) >= b.day) errs.push(`${where}: ${d.id} comes from DAY ${x.day}; the proof has to come from a later essay`);
      else if (!text.includes(d.s)) errs.push(`${where}: 「${d.s}」 is not in DAY ${b.day}`);
      else writes.push({ col: 'improve', id: d.id, op: 'update', data: { done: true, doneAt: stamp(), proof: { day: b.day, s: d.s } } });
    }
  }
  if (!blocks.length) errs.push('No DAY line.');
  return { errs, writes };
}

/** The essay day where he is: it turns over at 4 am (each essay keeps his time zone, minutes east of UTC). */
export function essayToday(essays: Doc[], now = Date.now()) {
  const tz = essays.filter((e) => typeof e.tz === 'number').sort((a, b) => String(a.edited ?? '').localeCompare(String(b.edited ?? ''))).pop();
  const mins = tz ? Number(tz.tz) : 480;
  return new Date(now + (mins - 240) * 60_000).toISOString().slice(0, 10);
}

// ---------- the marker's JSON, checked and repaired by code before anything is saved ----------
// The essay job asks for marks as JSON ({t, mine, nat, why, pattern, list}); `validate` makes each one safe to show:
// his words found in the essay (exact, or after fixing punctuation width, spaces, quotes), a right way that differs,
// a one-line why for every correction, no overlaps, essay order, and each mark landing where the board will look for
// it. What can't be repaired is dropped, with the reason in `dropped`.

export type RawMark = Record<string, unknown>;
export type VMark = Mark & { p?: string; list?: boolean; i: number; j: number };
const HANC = /[㐀-䶿一-鿿豈-﫿]/;
const FW: Record<string, string> = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；', '(': '（', ')': '）' };
const HW: Record<string, string> = Object.fromEntries(Object.entries(FW).map(([a, b]) => [b, a]));
const EDGE = /^[\s，。、！？：；,.!?:;「」『』"“”'‘’（）()]+|[\s，。、！？：；,.!?:;「」『』"“”'‘’（）()]+$/g;

/** One plain line: no markup, no breaks; a long one keeps its first sentence. */
export function oneLine(s: unknown, max = 160) {
  let t = String(s ?? '').replace(/<[^>]*>|\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
  if (t.length > max) {
    const m = t.match(/^.{5,}?[.!?。！？](?=\s|$)/);
    t = m && m[0].length <= max ? m[0] : t.slice(0, max - 1).replace(/[\s,;:]+\S*$/, '') + '…';
  }
  return t;
}
const plain = (s: unknown) => String(s ?? '').replace(/<[^>]*>|\*\*|`/g, '').replace(/[\r\n]+/g, ' ').trim().replace(/^[「『"“]+(.*?)[」』"”]+$/, '$1').trim();

/** Every place `q` is in `text`, as [i, j]: exact first, then with the punctuation's width or the spaces fixed. */
export function occurrences(text: string, q: string): [number, number][] {
  const exact = (s: string) => {
    const out: [number, number][] = [];
    if (s) for (let i = text.indexOf(s); i >= 0 && out.length < 40; i = text.indexOf(s, i + 1)) out.push([i, i + s.length]);
    return out;
  };
  for (const v of [q, [...q].map((c) => FW[c] ?? c).join(''), [...q].map((c) => HW[c] ?? c).join(''), q.replace(EDGE, '')]) {
    const hit = exact(v);
    if (hit.length && v.trim()) return hit;
  }
  // spaces ignored on both sides ("跟 Nina 見了面" finds "跟Nina見了面")
  const s = q.replace(/\s+/g, '');
  if (!s) return [];
  const at: number[] = [];
  let st = '';
  for (let k = 0; k < text.length; k++) if (!/\s/.test(text[k])) (at.push(k), (st += text[k]));
  const out: [number, number][] = [];
  for (let p = st.indexOf(s); p >= 0 && out.length < 40; p = st.indexOf(s, p + 1)) out.push([at[p], at[p + s.length - 1] + 1]);
  return out;
}

/** The marker's marks for one essay, repaired or dropped (see above). At most two go on his list. */
export function validate(text: string, raw: unknown, o: { maxList?: number } = {}) {
  const dropped: string[] = [];
  const took: VMark[] = [];
  const drop = (m: RawMark, why: string) => dropped.push(`${why}: ${JSON.stringify(m).slice(0, 120)}`);
  for (const m of Array.isArray(raw) ? (raw as RawMark[]) : []) {
    if (!m || typeof m !== 'object') continue;
    let t = String(m.t ?? m.kind ?? '').toLowerCase().trim();
    let list = m.list === true || t.endsWith('!');
    t = t.replace(/!+$/, '');
    if (!KINDS.includes(t)) { drop(m, 'kind'); continue; }
    const mine = plain(m.mine);
    if (!mine || mine.length > 80) { drop(m, 'his words'); continue; }
    const mk: VMark = { t, mine, i: 0, j: 0 };
    if (t !== 'good') {
      const nat = plain(m.nat);
      if (!HANC.test(nat) || nat.replace(EDGE, '') === mine.replace(EDGE, '') || nat.length > mine.length * 3 + 12) { drop(m, 'the right way'); continue; }
      mk.nat = nat;
      const p = oneLine(m.pattern, 60);
      if (p && t !== 'word') mk.p = p;
      let why = oneLine(m.why ?? m.note);
      if (!why && t === 'word') why = `The Chinese for “${mine}”.`;
      if (!why && p && p !== nat) why = p;
      if (!why) { drop(m, 'no why'); continue; }
      mk.note = why;
      if (t === 'word' && !/[A-Za-z]/.test(mine)) { mk.t = 'fix'; list = false; }
    }
    if (!['fix', 'better'].includes(mk.t)) list = false;
    if (list) mk.list = true;
    // his words in the essay: the first place no mark already holds
    const hit = occurrences(text, mine).find(([i, j]) => !took.some((x) => i < x.j && x.i < j));
    if (!hit) { drop(m, text.includes(mine) ? 'overlap' : 'not in the essay'); continue; }
    [mk.i, mk.j] = hit;
    mk.mine = text.slice(mk.i, mk.j);
    if (mk.nat && mk.nat === mk.mine) { drop(m, 'the right way'); continue; }
    took.push(mk);
  }
  took.sort((a, b) => a.i - b.i);
  // the board finds each mark by its words from where the last one ended: one that would land earlier gets more of
  // his words around it (the same ones added to the right way), or drops
  const out: VMark[] = [];
  let pos = 0;
  for (const m of took) {
    const next = took[took.indexOf(m) + 1];
    const lands = (mm: string, i: number) => text.indexOf(mm, pos) === i;
    let ok = lands(m.mine, m.i);
    for (let n = 1; !ok && n <= 6 && m.t !== 'word'; n++) {
      if (m.i - n >= pos && !text.slice(m.i - n, m.i).includes('\n') && lands(text.slice(m.i - n, m.j), m.i - n)) {
        const pre = text.slice(m.i - n, m.i);
        m.mine = pre + m.mine; if (m.nat) m.nat = pre + m.nat; m.i -= n; ok = true; break;
      }
      const end = m.j + n;
      if (end <= text.length && (!next || end <= next.i) && !text.slice(m.j, end).includes('\n') && lands(text.slice(m.i, end), m.i)) {
        const suf = text.slice(m.j, end);
        m.mine += suf; if (m.nat) m.nat += suf; m.j = end; ok = true; break;
      }
    }
    if (!ok) { dropped.push(`lands elsewhere: ${m.mine}`); continue; }
    out.push(m);
    pos = m.j;
  }
  let n = 0;
  for (const m of out) if (m.list && ++n > (o.maxList ?? 2)) delete m.list;
  return { marks: out, dropped };
}

const pkey = (p: unknown) => String(p ?? '').toLowerCase().replace(/[\s.,;:!?，。、；：！？()（）"“”'‘’「」…-]+/g, '');
/** The patterns already marked in his earlier essays, newest first, for the marker to reuse word for word. */
export function patterns(reviews: Record<string, Doc>, day: number, max = 40) {
  const seen = new Map<string, string>();
  for (const r of Object.values(reviews).filter((r) => Number(r.day) < day).sort((a, b) => Number(b.day) - Number(a.day)))
    for (const m of (r.marks as (Mark & { p?: string })[]) ?? []) if (m.p && !seen.has(pkey(m.p))) seen.set(pkey(m.p), m.p);
  return [...seen.values()].slice(0, max);
}

/** The sentence of `text` that holds [i, j]: from after the last 。！？ or line break before it to the next one. */
export function sentenceAt(text: string, i: number, j: number) {
  let a = i, b = j;
  while (a > 0 && !/[。！？!?\n]/.test(text[a - 1])) a--;
  while (b < text.length && !/[。！？!?\n]/.test(text[b])) b++;
  if (b < text.length && text[b] !== '\n') b++;
  while (a < i && /\s/.test(text[a])) a++;
  return [a, b] as const;
}
/** The characters of `b` that aren't in `a` (the board's diffSegs), as runs. */
export function changed(a: string, b: string) {
  const A = [...a], B = [...b], n = A.length, m = B.length;
  if (!n || n * m > 40000) return [b];
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const keep = new Array(m).fill(false);
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) (keep[j] = true), i++, j++;
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  const runs: string[] = [];
  let cur = '';
  B.forEach((c, k) => {
    if (!keep[k] && !/[\s，。、！？,.!?]/.test(c)) cur += c;
    else if (cur) (runs.push(cur), (cur = ''));
  });
  if (cur) runs.push(cur);
  return runs;
}
/** The board's id for a card's word (cards.js cardId). */
export const cardId = (w: string) => 'w' + [...w].map((c) => c.codePointAt(0)!.toString(16)).join('-');

export type FixCard = { word: string; sentence: string; why: string; p: string; day: number; mine: string; nat: string };
/** A mistake marked again: his own sentence, corrected, with the corrected words as the card's blank. Only for a
 *  pattern an earlier essay already has. */
export function fixCards(text: string, day: number, marks: VMark[], reviews: Record<string, Doc>) {
  const before = new Set<string>();
  for (const r of Object.values(reviews)) if (Number(r.day) < day) for (const m of (r.marks as (Mark & { p?: string })[]) ?? []) if (m.p && ['fix', 'better'].includes(m.t)) before.add(pkey(m.p));
  const out: FixCard[] = [];
  for (const m of marks) {
    if (!m.p || !m.nat || !['fix', 'better'].includes(m.t) || !before.has(pkey(m.p)) || out.some((c) => pkey(c.p) === pkey(m.p))) continue;
    const [a, b] = sentenceAt(text, m.i, m.j);
    const sentence = (text.slice(a, m.i) + m.nat + text.slice(m.j, b)).trim();
    const runs = changed(m.mine, m.nat).filter((r) => HANC.test(r));
    const word = [...m.nat.replace(EDGE, '')].length <= 6 ? m.nat.replace(EDGE, '') : runs.sort((x, y) => y.length - x.length)[0];
    if (!word || !sentence.includes(word) || !HANC.test(word)) continue;
    out.push({ word, sentence, why: m.note ?? m.p, p: m.p, day, mine: m.mine, nat: m.nat });
  }
  return out;
}

export type Use = { id: string; s: string; ok: boolean };
/**
 * The writes for one essay's checked marks: the review (with any marks it already had), the new list items, and the
 * open items he used. A correct use goes into the item's `uses` (one per essay); the third essay retires it
 * (done, `retired`), which the board celebrates.
 */
export function planJson(e: Doc, marks: VMark[], uses: unknown, reviews: Record<string, Doc>, improve: Record<string, Doc>, today: string) {
  const day = Number(e.day), text = norm(e.text);
  const writes: { col: string; id: string; op: 'set' | 'update'; data: Doc }[] = [];
  const old = reviews[pad(day)];
  const kept = old ? anchor(text, (old.marks as Mark[]) ?? []).filter((o) => !marks.some((m) => m.i < o.j && o.i < m.j)) : [];
  const all = [...kept, ...marks].sort((a, c) => a.i - c.i);
  const stored = all.map((m) => Object.fromEntries((['t', 'mine', 'nat', 'note', 'p'] as const).filter((k) => (m as Doc)[k]).map((k) => [k, (m as Doc)[k]])) as Mark);
  writes.push({ col: 'reviews', id: pad(day), op: 'set', data: { day, review: today, marks: stored } });
  const ids = new Set(Object.keys(improve));
  for (const m of marks) {
    if (!m.list) continue;
    if (Object.values(improve).some((x) => !x.removed && String(x.nat ?? '').trim() === String(m.nat ?? '').trim())) continue;
    let n = 1;
    while (ids.has(`c${String(day).padStart(3, '0')}-${n}`)) n++;
    const id = `c${String(day).padStart(3, '0')}-${n}`;
    ids.add(id);
    writes.push({ col: 'improve', id, op: 'set', data: { mine: m.mine, nat: m.nat, note: m.note, ...(m.p ? { p: m.p } : {}), day, added: stamp(), by: 'claude', done: false } });
  }
  for (const u of Array.isArray(uses) ? (uses as Doc[]) : []) {
    const id = String(u?.id ?? ''), x = improve[id], s = plain(u?.s);
    if (!x || x.done || x.removed || !s || (x.day && Number(x.day) >= day)) continue;
    const hit = occurrences(text, s)[0];
    if (!hit) continue;
    const words = text.slice(hit[0], hit[1]);
    const tried = [...new Set([...((x.tried as number[]) ?? []), day])].slice(-20);
    if (u.ok !== true) {
      writes.push({ col: 'improve', id, op: 'update', data: { tried } });
      continue;
    }
    const got = [...((x.uses as { day: number; s: string }[]) ?? []).filter((y) => y.day !== day), { day, s: words }].slice(-6);
    const data: Doc = { uses: got, tried };
    if (new Set(got.map((y) => y.day)).size >= 3) Object.assign(data, { done: true, doneAt: stamp(), proof: { day, s: words }, retired: true });
    writes.push({ col: 'improve', id, op: 'update', data });
  }
  return writes;
}

/** The open item his sheet showed on `date` (the board writes the dates into `seen`), if any. */
export function focusOn(improve: Record<string, Doc>, date: string) {
  const hit = Object.entries(improve).find(([, x]) => !x.done && !x.removed && ((x.seen as string[]) ?? []).includes(date));
  return hit ? ({ ...hit[1], id: hit[0] } as Doc & { id: string }) : null;
}
