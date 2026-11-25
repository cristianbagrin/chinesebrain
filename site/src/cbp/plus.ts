// Chinese Brain Plus on the Worker: the data in the CBP database, the engine on top of it, the Mac's old push
// (Stage 1; retired with the Mac on 2026-11-23) and the connector Claude sessions use.
//   files   the Chinese system's texts (engine.ts reads them by name)
//   docs    the board's documents: essays, reviews, improve, cards, board/*
//   checks  each night's comparison of the engine with words.py
import * as E from './engine.ts';
import * as N from './nightly.ts';
import { plan as marksPlan } from './essays.ts';
import * as A from './anki.ts';

type Env = { CBP: D1Database; CBP_PUSH_KEY?: string; [k: string]: unknown };
type D1Database = {
  prepare(sql: string): D1Stmt;
  batch(s: D1Stmt[]): Promise<unknown[]>;
};
type D1Stmt = {
  bind(...v: unknown[]): D1Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

const enc = new TextEncoder();
export async function hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Today in Taipei, where Chris lives (words.py uses the Mac's local date). */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const day = (d: unknown) => (typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d) ? d : today());

// ---------- files ----------
let cache: { stamp: string; files: E.Files } | null = null;
/** All files, from a copy kept between requests while nothing changed (the engine changes what it gets). */
export async function loadFiles(env: Env): Promise<E.Files> {
  const s = await env.CBP.prepare('SELECT MAX(updated) AS m, COUNT(*) AS n FROM files').first<{ m: number; n: number }>();
  const stamp = `${s?.m}|${s?.n}`;
  if (cache?.stamp !== stamp) {
    const { results } = await env.CBP.prepare('SELECT name, text FROM files').all<{ name: string; text: string }>();
    cache = { stamp, files: new Map(results.map((r) => [r.name, r.text])) };
  }
  return new Map(cache.files);
}

export async function listDocs(env: Env, col: string) {
  const { results } = await env.CBP.prepare('SELECT id, data, updated FROM docs WHERE col = ? ORDER BY id').bind(col).all<{ id: string; data: string; updated: number }>();
  return results.map((r) => ({ id: r.id, data: JSON.parse(r.data), updated: r.updated }));
}
export async function getDoc(env: Env, col: string, id: string) {
  const r = await env.CBP.prepare('SELECT data FROM docs WHERE col = ? AND id = ?').bind(col, id).first<{ data: string }>();
  return r ? JSON.parse(r.data) : null;
}

// ---------- the Mac's push ----------
/** What the database holds, by fingerprint, so the Mac sends only what changed. */
export async function manifest(env: Env) {
  const f = await env.CBP.prepare('SELECT name, sha FROM files').all<{ name: string; sha: string }>();
  const d = await env.CBP.prepare('SELECT col, id, sha FROM docs').all<{ col: string; id: string; sha: string }>();
  return {
    files: Object.fromEntries(f.results.map((r) => [r.name, r.sha])),
    docs: Object.fromEntries(d.results.map((r) => [`${r.col}/${r.id}`, r.sha])),
    source: await source(env),
  };
}

type Push = {
  files?: Record<string, string | null>;
  docs?: { col: string; id: string; data: unknown; op?: 'set' | 'update' }[];
  check?: { day: string; outputs: Record<string, string> };
  /** Once the website is the source: the fingerprint each change was made from (null: it didn't exist). A change
   *  whose base no longer matches is not made; it comes back in `conflicts` and nothing is lost. */
  bases?: { files?: Record<string, string | null>; docs?: Record<string, string | null> };
};

/** The day the website became the source, or null while the Mac still is. */
export async function source(env: Env) {
  const r = await env.CBP.prepare("SELECT v FROM meta WHERE k = 'source'").first<{ v: string }>();
  return r?.v ?? null;
}

const fileSha = async (env: Env, name: string) => (await env.CBP.prepare('SELECT sha FROM files WHERE name = ?').bind(name).first<{ sha: string }>())?.sha ?? null;
const docRow = (env: Env, col: string, id: string) => env.CBP.prepare('SELECT data, sha, updated FROM docs WHERE col = ? AND id = ?').bind(col, id).first<{ data: string; sha: string; updated: number }>();

export async function push(env: Env, body: Push) {
  const at = Date.now();
  const src = await source(env);
  const stmts: D1Stmt[] = [];
  const conflicts: string[] = [];
  // while the Mac is the source it overwrites; afterwards every change must say what it was made from
  const fresh = async (key: string, base: string | null | undefined, now: string | null) => {
    if (!src) return true;
    if (base === undefined || base !== now) {
      conflicts.push(key);
      return false;
    }
    return true;
  };
  for (const [name, text] of Object.entries(body.files ?? {})) {
    if (!(await fresh(name, body.bases?.files?.[name], await fileSha(env, name)))) continue;
    if (text === null) stmts.push(env.CBP.prepare('DELETE FROM files WHERE name = ?').bind(name));
    else stmts.push(env.CBP.prepare('INSERT INTO files (name, text, sha, updated) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET text = excluded.text, sha = excluded.sha, updated = excluded.updated').bind(name, text, await hex(text), at));
  }
  for (const d of body.docs ?? []) {
    const k = `${d.col}/${d.id}`, row = await docRow(env, d.col, d.id);
    if (!(await fresh(k, body.bases?.docs?.[k], row?.sha ?? null))) continue;
    let data = d.data;
    if (d.op === 'update' && data !== null) data = { ...(row ? JSON.parse(row.data) : {}), ...(data as object) };
    if (src && row) stmts.push(...keep(env, d.col, d.id, row));
    if (data === null) stmts.push(env.CBP.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(d.col, d.id));
    else stmts.push(putDoc(env, d.col, d.id, JSON.stringify(data), await hex(JSON.stringify(data)), at));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.CBP.batch(stmts.slice(i, i + 50));
  const checks = body.check ? await check(env, body.check.day, body.check.outputs) : null;
  return { files: Object.keys(body.files ?? {}).length, docs: (body.docs ?? []).length, checks, conflicts, source: src };
}

const putDoc = (env: Env, col: string, id: string, data: string, sha: string, at: number) =>
  env.CBP.prepare('INSERT INTO docs (col, id, data, sha, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data, sha = excluded.sha, updated = excluded.updated').bind(col, id, data, sha, at);
/** The version about to be replaced goes into history, unless one was kept in the last ten minutes. */
const keep = (env: Env, col: string, id: string, row: { data: string; updated: number }) => [
  env.CBP.prepare('INSERT INTO history (col, id, data, at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM history WHERE col = ? AND id = ? AND at > ?)').bind(col, id, row.data, row.updated, col, id, Date.now() - 600_000),
];

/** The Mac asks for the texts it doesn't have yet (by name, and documents by "col/id"). */
export async function pull(env: Env, want: { files?: string[]; docs?: string[] }) {
  const files: Record<string, { text: string; sha: string }> = {};
  for (const n of (want.files ?? []).slice(0, 500)) {
    const r = await env.CBP.prepare('SELECT text, sha FROM files WHERE name = ?').bind(n).first<{ text: string; sha: string }>();
    if (r) files[n] = r;
  }
  const docs: Record<string, { data: unknown; sha: string }> = {};
  for (const k of (want.docs ?? []).slice(0, 2000)) {
    const i = k.indexOf('/');
    const r = await docRow(env, k.slice(0, i), k.slice(i + 1));
    if (r) docs[k] = { data: JSON.parse(r.data), sha: r.sha };
  }
  return { files, docs, source: await source(env) };
}

/** Three nights running in which every check matched, ending today or yesterday (Taipei): the website becomes the
 *  source. Once it is, it stays. */
export async function switchOver(env: Env) {
  const now = await source(env);
  if (now) return { source: now, switched: false };
  const { results } = await env.CBP.prepare('SELECT day, SUM(ok) AS ok, COUNT(*) AS n FROM checks GROUP BY day ORDER BY day DESC LIMIT 3').all<{ day: string; ok: number; n: number }>();
  const good = results.length === 3 && results.every((r) => r.n >= 4 && r.ok === r.n) && results.every((r, i) => i === 0 || E.plus(r.day, 1) === results[i - 1].day) && E.cmp(results[0].day, E.plus(today(), -1)) >= 0;
  if (!good) return { source: null, switched: false, nights: results };
  await env.CBP.prepare("INSERT INTO meta (k, v) VALUES ('source', ?) ON CONFLICT (k) DO NOTHING").bind(today()).run();
  return { source: await source(env), switched: true };
}

// ---------- the board's writes (website as the source) ----------
/** What /plus may change: the board's own documents. board/data and board/cardkit stay the nightly's. */
const WRITABLE = new Set(['essays', 'reviews', 'improve', 'cards', 'notes', 'tutor']);
export class WriteError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export async function write(env: Env, w: { col?: unknown; id?: unknown; op?: unknown; data?: unknown }) {
  const col = String(w.col ?? ''), id = String(w.id ?? ''), op = String(w.op ?? '');
  if (!(WRITABLE.has(col) || (col === 'board' && id === 'test')) || !/^[\w.-]{1,120}$/.test(id)) throw new WriteError('permission_denied', 'Not writable.');
  if (!(await source(env))) throw new WriteError('read_only', 'Read-only until the website is the source.');
  const row = await docRow(env, col, id);
  let data: unknown;
  if (op === 'delete') data = null;
  else if (op === 'set') data = w.data;
  else if (op === 'update') {
    if (!row) throw new WriteError('invalid_argument', 'No such document.');
    data = { ...JSON.parse(row.data), ...(w.data as object) };
  } else throw new WriteError('invalid_argument', 'Unknown write.');
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) throw new WriteError('invalid_argument', 'A document is an object.');
  const stmts = row ? keep(env, col, id, row) : [];
  const text = data === null ? '' : JSON.stringify(data);
  if (text.length > 900_000) throw new WriteError('invalid_argument', 'Too big.');
  const sha = data === null ? null : await hex(text);
  stmts.push(data === null ? env.CBP.prepare('DELETE FROM docs WHERE col = ? AND id = ?').bind(col, id) : putDoc(env, col, id, text, sha!, Date.now()));
  await env.CBP.batch(stmts);
  return { ok: true, sha };
}

/** The engine's answers, by the names the Mac uses for words.py's (same command, same day). */
export function engineOutputs(files: E.Files, d: string): Record<string, string> {
  return {
    status: E.statusText(files, d),
    test: E.testPlanText(files, d),
    'test --all': E.testPlanText(files, d, true),
    board: E.pyJson(E.boardPayload(files, d)),
  };
}

/** Compare words.py's outputs with the engine's on the files just pushed; keep the result. */
async function check(env: Env, d: string, outputs: Record<string, string>) {
  const mine = engineOutputs(await loadFiles(env), d);
  const at = Date.now();
  const out: Record<string, boolean> = {};
  const stmts = Object.entries(outputs).map(([name, theirs]) => {
    const ok = mine[name] === theirs;
    out[name] = ok;
    let detail = '';
    if (!ok) {
      const a = theirs.split('\n'), b = (mine[name] ?? '').split('\n');
      const i = a.findIndex((x, k) => x !== b[k]);
      const k = i < 0 ? a.length : i;
      detail = `line ${k + 1}\nwords.py: ${a[k] ?? ''}\nengine:   ${b[k] ?? ''}`;
    }
    return env.CBP.prepare('INSERT INTO checks (day, name, ok, detail, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, name) DO UPDATE SET ok = excluded.ok, detail = excluded.detail, at = excluded.at').bind(d, name, ok ? 1 : 0, detail, at);
  });
  if (stmts.length) await env.CBP.batch(stmts);
  return out;
}

export async function checks(env: Env) {
  const { results } = await env.CBP.prepare('SELECT day, name, ok, detail FROM checks ORDER BY day DESC, name LIMIT 60').all();
  return results;
}

// ---------- reading, for the board and Claude ----------
export async function read(env: Env, what: string, q: URLSearchParams) {
  const d = day(q.get('day'));
  switch (what) {
    case 'status':
      return { day: d, text: E.statusText(await loadFiles(env), d) };
    case 'test':
      return { day: d, text: E.testPlanText(await loadFiles(env), d, q.get('all') === '1') };
    case 'board':
      return E.boardPayload(await loadFiles(env), d);
    case 'db': {
      const col = q.get('col') ?? '', id = q.get('id');
      return id ? getDoc(env, col, id) : listDocs(env, col);
    }
    case 'checks':
      return checks(env);
    case 'source':
      return { source: await source(env) };
    default:
      return undefined;
  }
}

// ---------- the connector (MCP over HTTP, for Claude sessions) ----------
// Its address carries the secret: /mcp/<CBP_MCP_KEY>. The weekly essay review, the monthly review and the monthly
// test run through it with nothing from the Mac: they read and change the system here.
const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required });
const TOOLS = [
  { name: 'status', description: "Chris's retest table (words.py status): every tracked item, its due date, last tries and right form.", inputSchema: S({ day: { type: 'string', description: 'YYYY-MM-DD, default today in Taipei' } }) },
  { name: 'test_plan', description: 'What the next test must cover, in order (words.py test).', inputSchema: S({ day: { type: 'string' }, all: { type: 'boolean', description: 'every item, not only those due' } }) },
  { name: 'month', description: "A month's numbers for the monthly review (words.py month): cards, test results by kind, writing, median answer time, words known, open retests.", inputSchema: S({ month: { type: 'string', description: 'YYYY-MM' } }, ['month']) },
  { name: 'list_files', description: "The Chinese system's files: chinese.md (the system: how to tutor him, the rules, where he is, the log), known-words.txt, learn-next.md, test-log.tsv, the sprints, history.md, monthly-test.md, Chinese Brain exports (imported/), Anki snapshots, cards-filed.tsv.", inputSchema: S({}) },
  { name: 'read_file', description: 'One file, whole. Big ones (known-words.txt, test-log.tsv) are better searched with grep_file.', inputSchema: S({ name: { type: 'string' } }, ['name']) },
  { name: 'grep_file', description: 'The lines of a file that contain any of the given strings (臺 and 台 match each other).', inputSchema: S({ name: { type: 'string' }, any: { type: 'array', items: { type: 'string' } } }, ['name', 'any']) },
  { name: 'edit_file', description: 'A targeted edit: replace `old` (which must appear exactly once) with `new`. The replaced version is kept in history. For chinese.md, history.md, monthly-test.md, the sprints. Never hand-edit known-words.txt, learn-next.md or test-log.tsv: use log and add_words.', inputSchema: S({ name: { type: 'string' }, old: { type: 'string' }, new: { type: 'string' } }, ['name', 'old', 'new']) },
  { name: 'write_file', description: 'Write a whole file (a new sprint file, say). An existing file is replaced only with replace: true; its old text is kept in history.', inputSchema: S({ name: { type: 'string' }, text: { type: 'string' }, replace: { type: 'boolean' } }, ['name', 'text']) },
  { name: 'log', description: 'Log graded evidence (words.py log): rows of [date, target, kind, result, note]. Kinds: new old leak burst (tests), free essay (his writing), form (a tracked item\'s right form, in the note), retire. Results: pass partial fail none. Applies the known-word flips and says what moved.', inputSchema: S({ rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, ['rows']) },
  { name: 'add_words', description: 'Queue words (words.py add): lines of [Lane, "word · pinyin · gloss · source"], Lane = Life, Taiwan or Test. A queued word gets the source added (it ranks higher); a K word is skipped.', inputSchema: S({ lines: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, ['lines']) },
  { name: 'set_known', description: 'Set words in known-words.txt: [[word, "K" | "L", date]] (a word he used correctly → K, dated by when he did).', inputSchema: S({ words: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, ['words']) },
  { name: 'list_docs', description: "The board's documents in one collection: essays, reviews, improve, cards, notes, tutor or board. Returns ids with their last change.", inputSchema: S({ col: { type: 'string' } }, ['col']) },
  { name: 'get_docs', description: 'Board documents by id (essays d001..., reviews, improve, cards, board/data|test|cardkit). Several ids at once.', inputSchema: S({ col: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } }, ['col', 'ids']) },
  { name: 'essay_marks', description: "Mark his essays and keep his To improve list, in essays.py's marks format: a `DAY n` line, then one mark per line in essay order: `fix | his words | right way | note`, `better | his words | right way`, `good | his words`, `word | english | 中文`, `fix!`/`better!` also puts it on his list, `done | <item id> | his words that get it right` crosses an item off. Checked the way the board reads them; nothing is written unless every mark lands. Marks join the ones a DAY already has. Each essay is corrected by Opus the morning after; the weekly review adds to those.", inputSchema: S({ marks: { type: 'string' } }, ['marks']) },
  { name: 'update_board', description: "Change board/data fields the nightly doesn't own: essayTarget (this week's essay target), months (frozen monthly numbers).", inputSchema: S({ data: { type: 'object' } }, ['data']) },
  { name: 'send_test', description: "Send a test to his page (words.py send + media.py): {items: [...]} with each item's label, kind, target, ask (or hear), model, check, and optional hear + voice (m 阿伯, g 阿嬤 or young woman, f 阿姨), read, and for the monthly test scene ({gen: 'what the photo shows'} drawn by FLUX, or {commons: 'File title.jpg'}), alt, overlay, secs, and a title on the test. Refused while a test is open (force: true only if it never reached him) or when a target sits in an ask or label. Voices and photos are made on the server.", inputSchema: S({ test: { type: 'object' }, force: { type: 'boolean' } }, ['test']) },
  { name: 'make_media', description: "Make a test's voices and photos without sending it (for the monthly test): {items: [...]} as for send_test. Returns the test with each item's audio and img filled in, and every photo as an image to look at. Send that test with send_test (items that have audio or img keep them); to redo a photo, drop its img and call again.", inputSchema: S({ test: { type: 'object' } }, ['test']) },
  { name: 'make_card', description: "Make a card for a word and put it in his reviews, the way the Cards page does (it is filed as carded tonight: the word turns L, the queue drops it). sentence: a natural Taiwan sentence with the word, Traditional characters; meaning: the word's meaning in his words; notes: anything worth keeping; type: Chinese (word), Chinese phrases (whole phrase, no word field) or Chinese radicals. Follow Card structure in chinese.md.", inputSchema: S({ word: { type: 'string' }, sentence: { type: 'string' }, pinyin: { type: 'string', description: 'of the sentence, Taiwan tones' }, english: { type: 'string', description: 'the sentence in English' }, meaning: { type: 'string' }, notes: { type: 'string' }, mnemonic: { type: 'string' }, type: { type: 'string', enum: ['Chinese', 'Chinese phrases', 'Chinese radicals'] } }, ['word', 'sentence', 'pinyin']) },
  { name: 'add_improve', description: "Put an item on his To improve list (the board's Essays page): his words → the natural way, sentence structure or natural phrasing that will keep coming back (never a missing word).", inputSchema: S({ mine: { type: 'string' }, nat: { type: 'string' }, note: { type: 'string' } }, ['mine', 'nat']) },
  { name: 'review_stats', description: 'His reviews (Anki, rebuilt in CBP): cards by state, due today and the backlog, the next days\' forecast, reviews in all.', inputSchema: S({}) },
  { name: 'test', description: "The test on his board now: its items, his answers, grades and times. start: true writes and sends today's test now if none is open (or replaces one he hasn't touched).", inputSchema: S({ start: { type: 'boolean' } }) },
  { name: 'nightly', description: "The 10 pm job's last report (merged Chinese Brain marks, filed test and cards, the test it sent), the other jobs' last runs (essay marks, weekly, monthly, monthly test) and the monthly checks that failed. run: true runs it now (no_test: true skips writing a test).", inputSchema: S({ run: { type: 'boolean' }, no_test: { type: 'boolean' } }) },
];

/** Change files through the engine and keep them: the replaced versions go into history. */
export async function change(env: Env, f: (files: E.Files) => string | Promise<string>) {
  const before = await loadFiles(env);
  const files: E.Files = new Map(before);
  const out = await f(files);
  const at = Date.now(), stmts: D1Stmt[] = [];
  for (const [name, text] of files) {
    const was = before.get(name);
    if (was === text) continue;
    if (was !== undefined) stmts.push(env.CBP.prepare('INSERT INTO history (col, id, data, at) VALUES (?, ?, ?, ?)').bind('file', name, was, at));
    stmts.push(env.CBP.prepare('INSERT INTO files (name, text, sha, updated) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET text = excluded.text, sha = excluded.sha, updated = excluded.updated').bind(name, text, await hex(text), at));
  }
  for (let i = 0; i < stmts.length; i += 40) await env.CBP.batch(stmts.slice(i, i + 40));
  return out;
}
const NO_HAND = new Set([E.KW, E.LN, E.LOG, E.LEDGER]);

/** words.py month. */
function month(files: E.Files, m: string) {
  const rows = E.readLog(files);
  const t = rows.filter((r) => E.TEST_KINDS.includes(r.kind) && r.date.slice(0, 7) === m && ['pass', 'partial', 'fail'].includes(r.result));
  const by: Record<string, [number, number]> = {};
  for (const r of t) {
    const [p, g] = by[r.kind] ?? [0, 0];
    by[r.kind] = [p + (r.result === 'pass' ? 1 : 0), g + 1];
  }
  const w = rows.filter((r) => E.WRITING_KINDS.includes(r.kind) && r.date.slice(0, 7) === m);
  const secs = t.flatMap((r) => [...r.note.matchAll(/\((\d+(?:\.\d+)?) s\)/g)].map((x) => Number(x[1]))).sort((a, b) => a - b);
  const med = secs.length ? (secs.length % 2 ? secs[(secs.length - 1) / 2] : (secs[secs.length / 2 - 1] + secs[secs.length / 2]) / 2) : null;
  return JSON.stringify({ month: m, cards: rows.filter((r) => r.kind === 'card' && r.date.slice(0, 7) === m).length, cards_logged_from: E.LOGGED_FROM, tests: [Object.values(by).reduce((a, v) => a + v[0], 0), Object.values(by).reduce((a, v) => a + v[1], 0)], tests_by_kind: by, writing: [w.filter((r) => r.result === 'pass').length, w.length], median_answer_secs: med, words_total_now: E.kwTotal(E.loadKw(files)), retests_open: E.table(rows).length });
}

type Extra = { brain?: () => Promise<N.Brain | null> };
async function tool(env: Env, name: string, a: Record<string, unknown>, extra: Extra = {}) {
  const files = () => loadFiles(env);
  const list = <T>(x: unknown) => (Array.isArray(x) ? (x as T[]) : []);
  switch (name) {
    case 'status':
      return E.statusText(await files(), day(a.day));
    case 'test_plan':
      return E.testPlanText(await files(), day(a.day), !!a.all);
    case 'month':
      return month(await files(), String(a.month));
    case 'list_files':
      return [...(await files()).keys()].sort().join('\n');
    case 'read_file': {
      const t = (await files()).get(String(a.name));
      if (t === undefined) throw new Error(`No file called ${a.name}. list_files shows them.`);
      return t;
    }
    case 'grep_file': {
      const t = (await files()).get(String(a.name));
      if (t === undefined) throw new Error(`No file called ${a.name}.`);
      const any = list<string>(a.any).map((x) => E.key(String(x))).filter(Boolean);
      const hits = t.split('\n').map((l, i) => [i + 1, l] as const).filter(([, l]) => any.some((x) => E.key(l).includes(x)));
      return hits.slice(0, 400).map(([i, l]) => `${i}: ${l}`).join('\n') || 'No line has them.';
    }
    case 'edit_file': {
      const n = String(a.name), old = String(a.old ?? ''), neu = String(a.new ?? '');
      if (NO_HAND.has(n)) throw new Error(`${n} changes only through log, add_words and set_known.`);
      return change(env, (f) => {
        const t = f.get(n);
        if (t === undefined) throw new Error(`No file called ${n}.`);
        const k = old ? t.split(old).length - 1 : 0;
        if (k !== 1) throw new Error(k ? `That text is in ${n} ${k} times: give more of it.` : `That text isn't in ${n}: copy it exactly.`);
        f.set(n, t.replace(old, () => neu));
        return `Edited ${n}.`;
      });
    }
    case 'write_file': {
      const n = String(a.name);
      if (NO_HAND.has(n)) throw new Error(`${n} changes only through log, add_words and set_known.`);
      if (!/^[\w.\-/]{1,120}$/.test(n) || !/\.(md|txt|tsv)$/.test(n)) throw new Error('A file name like march-sprint.md.');
      return change(env, (f) => {
        if (f.has(n) && !a.replace) throw new Error(`${n} exists: pass replace: true, or use edit_file.`);
        f.set(n, String(a.text ?? ''));
        return `Wrote ${n}.`;
      });
    }
    case 'log': {
      const rows: Partial<E.Row>[] = [], bad: string[] = [];
      for (const r of list<unknown[]>(a.rows)) {
        const [date = '', target = '', kind = '', result = '', note = ''] = r.map((x) => String(x ?? '').trim());
        const ok = /^\d{4}-\d\d-\d\d$/.test(date) && target && ((([...E.TEST_KINDS, ...E.WRITING_KINDS].includes(kind)) && E.RESULTS.includes(result)) || ['form', 'retire'].includes(kind));
        if (ok) rows.push({ date, target, kind, result: result || '-', note });
        else bad.push(r.join(' | '));
      }
      if (!rows.length) throw new Error('Nothing logged. Check the columns: ' + bad.join('; '));
      const out = await change(env, (f) => {
        const before = new Map([...E.schedule(E.readLog(f)).values()].map((x) => [x.name, `${x.due}|${x.active}`]));
        const said = E.logRows(f, rows);
        const moved = [...E.schedule(E.readLog(f)).values()].filter((x) => before.get(x.name) !== `${x.due}|${x.active}`)
          .map((x) => (x.active ? `  ${x.name}: due ${x.due}${x.burst ? ' · BURST next' : ''}${x.form ? '' : ' · needs a form row'}` : x.retired ? `  ${x.name}: retired` : ''));
        return [said, ...moved.filter(Boolean)].join('\n');
      });
      await N.putDoc(env as never, 'board', 'data', E.boardPayload(await loadFiles(env), today()) as never, 'update');
      return out + (bad.length ? `\nNOT LOGGED: ${bad.join('; ')}` : '');
    }
    case 'add_words': {
      const out = await change(env, (f) => E.addWords(f, list<unknown[]>(a.lines).map((l) => [String(l[0] ?? ''), String(l[1] ?? '')] as [string, string]), today()));
      await N.putDoc(env as never, 'board', 'data', E.boardPayload(await loadFiles(env), today()) as never, 'update');
      return out;
    }
    case 'set_known':
      return change(env, (f) => {
        const l = E.loadKw(f), out: string[] = [];
        for (const [w0, s0, d0] of list<unknown[]>(a.words).map((x) => x.map((y) => String(y ?? '').trim()))) {
          const w = E.key(w0), s = s0.toUpperCase(), d = /^\d{4}-\d\d-\d\d$/.test(d0) ? d0 : today();
          if (!w || !['K', 'L'].includes(s)) { out.push(`skip ${w0}`); continue; }
          const idx = E.kwIndex(l);
          if (idx.has(w)) l[idx.get(w)!] = `${E.kwGet(l, idx.get(w)!)[0]}\t${s}\t${d}`;
          else l.push(`${w}\t${s}\t${d}`);
          out.push(`${w} ${s} ${d}`);
        }
        E.kwSave(f, l);
        const q = E.loadQueue(f);
        for (const [w, [st]] of E.kwStatus(l)) if (st === 'K' && q.find(w)[1]) q.remove(w);
        q.save(f, today());
        return out.join('\n');
      });
    case 'list_docs': {
      const { results } = await env.CBP.prepare('SELECT id, updated FROM docs WHERE col = ? ORDER BY id').bind(String(a.col)).all<{ id: string; updated: number }>();
      return results.map((r) => `${r.id}\t${new Date(r.updated).toISOString().slice(0, 10)}`).join('\n') || `No documents in ${a.col}.`;
    }
    case 'get_docs': {
      const ids = list<unknown>(a.ids).slice(0, 50).map(String);
      const out: Record<string, unknown> = {};
      for (const id of ids) out[id] = await getDoc(env, String(a.col), id);
      return JSON.stringify(out, null, 1);
    }
    case 'essay_marks': {
      const all = async (col: string) => Object.fromEntries((await listDocs(env, col)).map((d) => [d.id, d.data]));
      const p = marksPlan(String(a.marks ?? ''), await all('essays'), await all('reviews'), await all('improve'), today());
      if (p.errs.length) throw new Error(`${p.errs.length} to fix; nothing written:\n` + p.errs.join('\n'));
      for (const w of p.writes) await N.putDoc(env as never, w.col, w.id, w.data, w.op);
      return p.writes.map((w) => `${w.op} ${w.col}/${w.id}` + (w.col === 'reviews' ? ` (${(w.data.marks as unknown[]).length} marks)` : '')).join('\n');
    }
    case 'update_board': {
      const d = (a.data ?? {}) as Record<string, unknown>;
      const ok = Object.fromEntries(Object.entries(d).filter(([k]) => ['essayTarget', 'months'].includes(k)));
      if (!Object.keys(ok).length) throw new Error('Only essayTarget and months.');
      await N.putDoc(env as never, 'board', 'data', ok, 'update');
      return `Updated ${Object.keys(ok).join(', ')}.`;
    }
    case 'send_test': {
      const said: string[] = [];
      const doc = await change(env, async (f) => {
        const t = (a.test ?? {}) as Record<string, unknown>;
        const problems = E.testProblems(f, t as never, !!a.force);
        if (problems.length) throw new Error('Not sent: ' + problems.join('; '));
        const sent = E.sendTest(f, t as never, today());
        await N.media(env as never, sent, said);
        return JSON.stringify(sent);
      });
      const sent = JSON.parse(doc);
      await N.putDoc(env as never, 'board', 'test', sent);
      await N.putDoc(env as never, 'board', 'data', E.boardPayload(await loadFiles(env), today()) as never, 'update');
      return [`Test ${sent.id} is on his page (${sent.items.length} items).`, ...said].join('\n');
    }
    case 'make_media': {
      const said: string[] = [];
      const t = JSON.parse(JSON.stringify(a.test ?? {})) as { items?: Record<string, unknown>[] };
      await N.media(env as never, t, said);
      const images: { type: 'image'; data: string; mimeType: string }[] = [];
      for (const it of t.items ?? []) {
        const m = String(it.img ?? '').match(/\/api\/plus\/media\/([0-9a-f]{32}\.[a-z0-9]+)$/);
        const o = m ? await (env.FILES as { get(k: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null> }).get('m/' + m[1]) : null;
        if (!o) continue;
        const b = new Uint8Array(await o.arrayBuffer());
        let bin = '';
        for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
        images.push({ type: 'image', data: btoa(bin), mimeType: o.httpMetadata?.contentType ?? 'image/jpeg' });
      }
      return { content: [{ type: 'text', text: JSON.stringify(t, null, 1) + (said.length ? '\n' + said.join('\n') : '') }, ...images] };
    }
    case 'make_card': {
      const word = E.key(String(a.word ?? '')), sentence = String(a.sentence ?? '').trim();
      if (!/^[\u3400-\u9fff]{1,8}$/.test(word) || !sentence) throw new Error('A word (Chinese characters) and a sentence, please.');
      const id = 'w' + [...word].map((c) => c.codePointAt(0)!.toString(16)).join('-');
      const now = new Date().toISOString(), type = String(a.type ?? 'Chinese');
      const text = [`word: ${word}`, a.meaning ? `meaning: ${a.meaning}` : '', `ex: ${sentence} | ${a.pinyin ?? ''} | ${a.english ?? ''}`, a.notes ? `how: ${a.notes}` : ''].filter(Boolean).join('\n');
      await N.putDoc(env as never, 'cards', id, { word, text, carded: now, src: 'chat', knows: {} });
      const note = { word: type === 'Chinese phrases' ? '' : word, chinese: sentence, pinyin: String(a.pinyin ?? ''), picture: '', notes: String(a.notes ?? a.meaning ?? ''), type, mnemonic: String(a.mnemonic ?? ''), audio: '', made: now, edited: now, exported: null };
      await N.putDoc(env as never, 'notes', id, note);
      const r = await A.fromBoard(env as never, id, note);
      return `Card made for ${word}${r ? ' and added to his reviews (new, at the end of the new queue)' : ' (his reviews are not live yet: it waits on the Cards page)'}. Tonight's job files it as carded.`;
    }
    case 'add_improve': {
      if (!a.mine || !a.nat) throw new Error('mine and nat, please.');
      const id = 'c' + Date.now().toString(36);
      await N.putDoc(env as never, 'improve', id, { mine: String(a.mine), nat: String(a.nat), ...(a.note ? { note: String(a.note) } : {}), added: new Date().toISOString(), by: 'chat', done: false });
      return `On his To improve list: ${a.mine} → ${a.nat} (${id}).`;
    }
    case 'review_stats': {
      const c = (await A.check(env as never)) as { imported?: unknown; live?: boolean; now?: { day: number; cards: number; notes: number; revlog: number; byQueue: Record<string, number>; forecast: { backlog: number; days: number[] } } };
      if (!c.now) return 'His reviews have not been imported into CBP.';
      const q = c.now.byQueue, f = c.now.forecast;
      return `Reviews ${c.live ? 'live in CBP' : 'imported, not live yet'}: ${c.now.cards} cards, ${c.now.notes} notes, ${c.now.revlog} reviews in all.\nBy state: new ${q['0'] ?? 0}, learning ${(q['1'] ?? 0) + (q['3'] ?? 0)}, review ${q['2'] ?? 0}, suspended ${q['-1'] ?? 0}, buried ${(q['-2'] ?? 0) + (q['-3'] ?? 0)}.\nDue today: ${(f.days[0] ?? 0) + f.backlog} (${f.backlog} overdue). Next days: ${f.days.slice(1, 8).join(', ')}.`;
    }
    case 'test': {
      if (a.start) {
        const files = await loadFiles(env);
        const rows = E.readLog(files), waiting = E.waitingTest(rows);
        const t = (await getDoc(env, 'board', 'test')) as Record<string, unknown> | null;
        if (waiting && (t?.id !== waiting || ((t?.items as Record<string, unknown>[]) ?? []).some((x) => x.answer))) return `Test ${waiting} is on his board and he has started it: it stays.`;
        const said: string[] = [];
        const sent = await N.writeTest(env as never, files, today(), said, waiting ? { refresh: { id: waiting, missed: Number(t?.missed ?? 0) } } : {});
        if (!sent) return said.join('\n');
        await change(env, (f) => (f.set(E.LOG, files.get(E.LOG)!), ''));
        await N.putDoc(env as never, 'board', 'test', sent as never);
        return said.join('\n');
      }
      const t = await getDoc(env, 'board', 'test');
      return t ? JSON.stringify(t, null, 1) : 'No test on his board.';
    }
    case 'nightly': {
      if (a.run) {
        const brain = (await extra.brain?.()) ?? null;
        return (await N.nightly(env as never, brain, { noTest: !!a.no_test })).join('\n');
      }
      const r = await env.CBP.prepare("SELECT v FROM meta WHERE k = 'nightly'").first<{ v: string }>();
      if (!r) return 'The nightly has not run on the website yet.';
      const n = JSON.parse(r.v);
      // and the other jobs' last runs (jobs.ts): essay, weekly, monthly, mtest, mtest.learned
      const jobs = (await env.CBP.prepare("SELECT k, v FROM meta WHERE k IN ('job.essay', 'job.weekly', 'job.monthly', 'job.mtest', 'job.mtest.learned')").all<{ k: string; v: string }>()).results
        .map((j) => ({ k: j.k.slice(4), ...JSON.parse(j.v) })).map((j) => `\n${j.k}, ${j.day}: ${(j.said as string[]).join(' · ') || 'nothing to do'}`);
      const al = ((await getDoc(env, 'board', 'data')) as { alerts?: { day: string; list: string[] } } | null)?.alerts;
      return `${n.day} (${new Date(n.at).toISOString()}):\n${n.said.join('\n')}${jobs.length ? '\n\nThe other jobs:' + jobs.join('') : ''}${al?.list?.length ? `\n\nChecks that failed (${al.day}):\n${al.list.join('\n')}` : ''}`;
    }
  }
  throw new Error(`Unknown tool ${name}.`);
}

const INSTRUCTIONS = "This connector is Chris's whole Chinese system (Chinese Brain Plus): his rules, word lists, tests, essays, reviews. Before anything else in a conversation, read chinese.md with read_file: Part 1 is how to tutor him, Part 2 how the system works (which tool for what), Part 3 where he is. Then do what he asks with the tools: make a card (make_card), check a sentence and log the evidence (log), queue a word (add_words), put an item on his To improve list (add_improve), his review stats (review_stats), read or start a test (test), mark words known (set_known). Never edit Parts 1–2 of chinese.md unless he asks. He writes Taiwanese Mandarin in Traditional characters; answer in English with Chinese in Traditional characters.";

export async function mcp(env: Env, msg: { id?: unknown; method?: string; params?: Record<string, unknown> }, extra: Extra = {}) {
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Chinese Brain', version: '2' }, instructions: INSTRUCTIONS });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const p = msg.params ?? {};
      try {
        const out = await tool(env, String(p.name), (p.arguments as Record<string, unknown>) ?? {}, extra);
        return ok(typeof out === 'string' ? { content: [{ type: 'text', text: out }] } : out);
      } catch (e) {
        return ok({ content: [{ type: 'text', text: String((e as Error).message) }], isError: true });
      }
    }
  }
  if (msg.id === undefined) return null; // a notification
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
}
