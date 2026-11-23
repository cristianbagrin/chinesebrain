// Chinese Brain Plus, Stage 4: his Anki collection on the server (table `anki`, migrations/0006_anki.sql).
// The review page keeps the whole collection on the device and reviews offline; this is where devices meet:
//   pull     rows stored after a point (usn), a page at a time
//   push     changed rows from a device: the newest change wins; a card's reviews from every device are kept
//   import   scripts/cbp-anki.ts loads his .colpkg (rows, and media into R2 under unguessable names)
//   deeper   Claude's five minutes on a card he missed three times running (Sonnet 5.5, his pick for cards)
//   fromBoard a note made on /plus's Cards page lands here as a new note with its cards, once Anki has moved (meta live)
import * as ai from './ai.ts';
import { modelOf, keepMedia, Bad } from './cards.ts';
import { clock, forecast, type Card } from './sched.ts';

type Stmt = { bind(...v: unknown[]): Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
type Env = { CBP: { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown[]> }; FILES: unknown; ANTHROPIC_API_KEY?: string };

const KINDS = new Set(['meta', 'notetype', 'deck', 'conf', 'note', 'card']);
const PAGE = 400;

/** Rows stored after `since`, oldest first; the data goes out as stored (no parsing here: the free plan's CPU is short). */
export async function pull(env: Env, since: number) {
  const { results } = await env.CBP.prepare('SELECT kind, id, data, mod, usn FROM anki WHERE usn > ? ORDER BY usn LIMIT ?').bind(since, PAGE + 1).all<{ kind: string; id: string; data: string | null; mod: number; usn: number }>();
  const more = results.length > PAGE;
  const rows = results.slice(0, PAGE);
  const body = `{"more":${more},"usn":${rows.length ? rows[rows.length - 1].usn : since},"now":${Date.now()},"rows":[${rows.map((r) => `[${JSON.stringify(r.kind)},${JSON.stringify(r.id)},${r.data ?? 'null'},${r.mod}]`).join(',')}]}`;
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

type Op = { kind: string; id: string; data: Record<string, unknown> | null; mod: number; drop?: number[] };
let lastUsn = 0;
const nextUsn = () => (lastUsn = Math.max(Date.now(), lastUsn + 1));

/** A device's changes. Each row: the newer `mod` wins. A card keeps every review any device logged (`drop` takes out
 *  the ones he undid). Returns what was stored, and the rows the server kept instead (the device takes those). */
export async function push(env: Env, body: { ops?: unknown }) {
  const ops = (Array.isArray(body.ops) ? body.ops : []).slice(0, 300) as Op[];
  const stmts: Stmt[] = [];
  const kept: unknown[] = [];
  for (const op of ops) {
    if (!KINDS.has(op.kind) || typeof op.id !== 'string' || !op.id || op.id.length > 80 || typeof op.mod !== 'number') throw new Bad('Bad change.');
    if (op.data !== null && (typeof op.data !== 'object' || Array.isArray(op.data))) throw new Bad('Bad change.');
    const row = await env.CBP.prepare('SELECT data, mod FROM anki WHERE kind = ? AND id = ?').bind(op.kind, op.id).first<{ data: string | null; mod: number }>();
    let data = op.data;
    const old = row?.data ? (JSON.parse(row.data) as Record<string, unknown>) : null;
    const newer = !row || op.mod >= row.mod;
    if (op.kind === 'card' && old && data) {
      // reviews from both sides, by id
      const drop = new Set(op.drop ?? []);
      const byId = new Map<number, unknown[]>();
      for (const r of [...((old.revs as unknown[][]) ?? []), ...((data.revs as unknown[][]) ?? [])]) if (!drop.has(r[0] as number)) byId.set(r[0] as number, r);
      const revs = [...byId.values()].sort((a, b) => (a[0] as number) - (b[0] as number));
      data = { ...(newer ? data : old), revs };
    } else if (!newer) {
      kept.push([op.kind, op.id, old, row!.mod]);
      continue;
    }
    const text = data === null ? null : JSON.stringify(data);
    if (text && text.length > 400_000) throw new Bad('Too big.');
    const mod = Math.max(op.mod, row?.mod ?? 0);
    stmts.push(env.CBP.prepare('INSERT INTO anki (kind, id, data, mod, usn) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, mod = excluded.mod, usn = excluded.usn').bind(op.kind, op.id, text, mod, nextUsn()));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.CBP.batch(stmts.slice(i, i + 50));
  return { stored: stmts.length, kept };
}

// ---------- the import (scripts/cbp-anki.ts, with the push key) ----------
/** POST /api/plus/push/anki {reset?, rows: [[kind, id, data], ...]}: reset empties the collection first (media stay). */
export async function load(env: Env, body: { reset?: boolean; rows?: [string, string, Record<string, unknown>][] }) {
  const stmts: Stmt[] = [];
  if (body.reset) stmts.push(env.CBP.prepare('DELETE FROM anki'));
  for (const [kind, id, data] of body.rows ?? []) {
    if (!KINDS.has(kind)) throw new Bad(`Unknown kind ${kind}.`);
    stmts.push(env.CBP.prepare('INSERT INTO anki (kind, id, data, mod, usn) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, mod = excluded.mod, usn = excluded.usn').bind(kind, String(id), JSON.stringify(data), Number(data?.mod) || Date.now(), nextUsn()));
  }
  for (let i = 0; i < stmts.length; i += 100) await env.CBP.batch(stmts.slice(i, i + 100));
  return { rows: (body.rows ?? []).length };
}

/** POST /api/plus/push/anki-media?name=…: one of Anki's media files, kept once (the same name again returns its address). */
export async function media(env: Env, name: string, bytes: ArrayBuffer, type: string) {
  if (!name || name.length > 300) throw new Bad('No name.');
  const had = await env.CBP.prepare('SELECT url FROM anki_media WHERE name = ?').bind(name).first<{ url: string }>();
  if (had) return { url: had.url, had: true };
  const url = await keepMedia(env as never, bytes, type);
  await env.CBP.prepare('INSERT INTO anki_media (name, url) VALUES (?, ?) ON CONFLICT (name) DO NOTHING').bind(name, url).run();
  return { url, had: false };
}
export async function mediaMap(env: Env) {
  const { results } = await env.CBP.prepare('SELECT name, url FROM anki_media').all<{ name: string; url: string }>();
  return Object.fromEntries(results.map((r) => [r.name, r.url]));
}

async function meta<T>(env: Env, id: string) {
  const r = await env.CBP.prepare("SELECT data FROM anki WHERE kind = 'meta' AND id = ?").bind(id).first<{ data: string | null }>();
  return r?.data ? (JSON.parse(r.data) as T) : null;
}
export type ColMeta = { day0: string; rollover: number; offset: number; deck: number; conf: number; notetype: number; imported: string; anki?: Check };
export type Check = { day: number; cards: number; notes: number; revlog: number; byQueue: Record<string, number>; forecast: { backlog: number; days: number[] } };

/** What the collection holds now, next to what Anki held at the import (scripts/cbp-anki.ts check prints both). */
export async function check(env: Env) {
  const col = await meta<ColMeta>(env, 'col');
  if (!col) return { imported: false };
  const { results } = await env.CBP.prepare("SELECT data FROM anki WHERE kind = 'card' AND data IS NOT NULL").all<{ data: string }>();
  const cards = results.map((r) => JSON.parse(r.data) as Card);
  const notes = (await env.CBP.prepare("SELECT COUNT(*) AS n FROM anki WHERE kind = 'note' AND data IS NOT NULL").first<{ n: number }>())?.n ?? 0;
  const ck = clock(col.day0, col.rollover, Date.now(), col.offset);
  const byQueue: Record<string, number> = {};
  for (const c of cards) byQueue[c.queue] = (byQueue[c.queue] ?? 0) + 1;
  return { imported: col.imported, live: !!(await meta(env, 'live')), anki: col.anki, now: { day: ck.today, cards: cards.length, notes, revlog: cards.reduce((n, c) => n + (c.revs?.length ?? 0), 0), byQueue, forecast: forecast(cards, ck) } };
}

// ---------- missed three times running ----------
/** POST plus/anki/deeper {word, sentence, notes, meaning, near}: an analogy that makes it stick, and the contrast with
 *  the word he most likely mixes it up with (`near`: his own words that share a character or a meaning). */
export async function deeper(env: Env, b: Record<string, unknown>) {
  const s = (k: string, n: number) => String(b[k] ?? '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
  const word = s('word', 40);
  if (!word) throw new Bad('No word.');
  const near = (Array.isArray(b.near) ? b.near : []).map(String).slice(0, 40).join('、');
  const prompt = `Chris learns Taiwanese Chinese (Traditional characters, Taiwan readings and usage; high A2). He just missed his flashcard for ${word} three times in a row.
His card: ${s('sentence', 300)}${s('meaning', 200) ? `\nMeaning: ${s('meaning', 200)}` : ''}${s('notes', 600) ? `\nHis notes on it: ${s('notes', 600)}` : ''}
${near ? `Words from his own deck that look or mean something close: ${near}\n` : ''}
Give him five minutes of going deeper, in under 150 words, written to him ("you"), plain text, no headings or labels:
1. One vivid analogy or tiny story that makes ${word} stick: wild and funny beats safe, built on what its characters picture.
2. The word he most likely confuses it with (from his deck if one fits, else the usual trap) and the difference in one line, then one short example sentence for each in Traditional, each with Taiwan pinyin and English on its own line.
Chinese punctuation in Chinese, English punctuation in English.`;
  const r = await ai.text(env as never, modelOf(b.model), prompt, { effort: 'low' });
  return { text: r.text.trim() };
}

// ---------- a note made on the Cards page ----------
type NoteType = { id: number; name: string; fields: { name: string; ord: number }[]; templates: { ord: number; qfmt: string }[] };
const BOARD_FIELDS: Record<string, string> = { Chinese: 'chinese', Word: 'word', Mnemonic: 'mnemonic', Picture: 'picture', Notes: 'notes', Pinyin: 'pinyin' };
const put = (env: Env, kind: string, rid: string | number, data: unknown, now: number) =>
  env.CBP.prepare('INSERT INTO anki (kind, id, data, mod, usn) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, id) DO UPDATE SET data = excluded.data, mod = excluded.mod, usn = excluded.usn').bind(kind, String(rid), data === null ? null : JSON.stringify(data), now, nextUsn());

/** Once Anki has moved here (meta `live`), a note saved on /plus (db notes/<id>) becomes a note of the type he picked
 *  there (Chinese, Chinese phrases or Chinese radicals; by name) with its cards, new, at the end of the new queue.
 *  Saving it again updates the fields and leaves the cards be; switching its type before any review makes it anew. */
export async function fromBoard(env: Env, id: string, n: Record<string, unknown> | null) {
  if (!n || !(await meta(env, 'live'))) return null;
  const col = await meta<ColMeta>(env, 'col');
  if (!col) return null;
  const { results } = await env.CBP.prepare("SELECT data FROM anki WHERE kind = 'notetype' AND data IS NOT NULL").all<{ data: string }>();
  const types = results.map((r) => JSON.parse(r.data) as NoteType);
  const type = types.find((t) => t.name === n.type) ?? types.find((t) => t.id === col.notetype);
  if (!type) return null;
  const link = await meta<{ nid: number }>(env, 'board:' + id);
  const now = Date.now();
  const flds = type.fields.slice().sort((a, b) => a.ord - b.ord).map((f) => (f.name === 'Audio' ? (n.audio ? `[sound:${n.audio}]` : '') : String(n[BOARD_FIELDS[f.name]] ?? '')));
  const stmts: Stmt[] = [];
  if (link) {
    const old = (await env.CBP.prepare("SELECT data FROM anki WHERE kind = 'note' AND id = ?").bind(String(link.nid)).first<{ data: string | null }>())?.data;
    if (!old) return null; // he deleted it while reviewing: leave it gone
    const note = JSON.parse(old);
    if (note.mid === type.id) {
      await put(env, 'note', link.nid, { ...note, flds, mod: now }, now).run();
      return { nid: link.nid, updated: true };
    }
    // another type: anew, unless he has already reviewed one of its cards (then only the fields that share a name move)
    const { results: cs } = await env.CBP.prepare("SELECT id, data FROM anki WHERE kind = 'card' AND data LIKE ?").bind(`%"nid":${link.nid},%`).all<{ id: string; data: string }>();
    if (cs.some((c) => (JSON.parse(c.data).revs ?? []).length)) {
      const was = types.find((t) => t.id === note.mid);
      const by = new Map(type.fields.map((f) => [f.name, flds[f.ord]]));
      await put(env, 'note', link.nid, { ...note, flds: note.flds.map((v: string, i: number) => by.get(was?.fields.find((f) => f.ord === i)?.name ?? '') ?? v), mod: now }, now).run();
      return { nid: link.nid, updated: true };
    }
    stmts.push(put(env, 'note', link.nid, null, now), ...cs.map((c) => put(env, 'card', c.id, null, now)));
  }
  const nid = now;
  stmts.push(put(env, 'note', nid, { id: nid, guid: 'cbp:' + id, mid: type.id, mod: now, tags: [], flds }, now), put(env, 'meta', 'board:' + id, { nid }, now));
  const byName = new Map(type.fields.map((f) => [f.name, flds[f.ord] ?? '']));
  // new cards go to the end of the new queue in the order they were made (Anki positions are just numbers)
  const pos = Math.floor(now / 1000);
  type.templates.forEach((t, i) => {
    // a card only when its front shows something (Anki's rule), judged by the fields the front names
    const used = [...t.qfmt.matchAll(/\{\{(?:[#^/]|[a-z]+:)?([^}]+)\}\}/g)].map((m) => m[1].trim());
    if (!used.some((f) => (byName.get(f) ?? '').replace(/<(?!img)[^>]+>|&nbsp;/g, '').trim())) return;
    const c: Card = { id: nid + 1 + i, nid, did: col.deck, ord: t.ord, type: 0, queue: 0, due: pos, ivl: 0, reps: 0, lapses: 0, left: 0, flags: 0, mod: now, revs: [] };
    stmts.push(put(env, 'card', c.id, c, now));
  });
  await env.CBP.batch(stmts);
  return { nid, created: true };
}
