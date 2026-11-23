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
