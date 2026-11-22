#!/usr/bin/env node
/*
Chris's Anki collection into Chinese Brain Plus (Stage 4), and the check against Anki. Node 24+, nothing to install.
Reads the .colpkg only; never touches Anki or its folder.

  node scripts/cbp-anki.ts import <file.colpkg> [--staging] [--site URL]
      Media first (each file once, kept under an unguessable name; pictures linked from the web are fetched and kept
      too), then the whole collection, replacing what the site held: note types with their templates and styling, deck
      options with the FSRS weights, notes, cards with their FSRS memory and every review. What Anki showed at that
      moment (card count, Future Due) is kept with it for the check.
  node scripts/cbp-anki.ts check [--staging]
      Anki at the import next to the site now: cards, notes, reviews, cards per queue, the next 30 days due.
  node scripts/cbp-anki.ts fsrs <file.colpkg>
      Replays every card's review history through site/src/cbp/fsrs.ts and compares it with the memory Anki stored.
  node scripts/cbp-anki.ts live [--staging]
      Switch day: notes made on /plus join this collection from now on (meta live). Before it they go to Anki
      (scripts/cbp-push.py --anki) and come over with the import.

The key is CBP_PUSH_KEY in ~/.cbp-push.env, as for cbp-push.py.
*/
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { readPackage, mediaBytes, fsrsHistory, dayIndex, type Collection } from './anki-read.ts';
import { Fsrs } from '../site/src/cbp/fsrs.ts';
import { clock, forecast, type Card, type Rev } from '../site/src/cbp/sched.ts';

const args = process.argv.slice(2);
const flag = (f: string) => args.includes(f);
const opt = (f: string) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined);
const SITE = opt('--site') ?? (flag('--staging') ? 'https://chinese-staging.cristianbagrin.com' : 'https://chinese.cristianbagrin.com');

function key() {
  if (process.env.CBP_PUSH_KEY) return process.env.CBP_PUSH_KEY;
  const line = readFileSync(`${homedir()}/.cbp-push.env`, 'utf8').split('\n').find((l) => l.startsWith('CBP_PUSH_KEY='));
  if (!line) throw new Error('No CBP_PUSH_KEY in ~/.cbp-push.env.');
  return line.slice(13).trim().replace(/^"|"$/g, '');
}
async function call(path: string, body?: unknown, type = 'application/json') {
  for (let tries = 0; ; tries++) {
    const r = await fetch(SITE + path, { method: 'POST', headers: { Authorization: `Bearer ${key()}`, 'Content-Type': type }, body: body === undefined ? '{}' : type === 'application/json' ? JSON.stringify(body) : (body as BodyInit) });
    if (r.ok) return r.json();
    if (tries < 3 && r.status >= 500) {
      await new Promise((ok) => setTimeout(ok, 2000 * (tries + 1)));
      continue;
    }
    throw new Error(`${path}: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }
}

/** What a file is, by its first bytes (Anki names don't say: "paste", "image", ".php"...). */
function sniff(b: Buffer) {
  const s = b.subarray(0, 16).toString('latin1');
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (s.startsWith('\x89PNG')) return 'image/png';
  if (s.startsWith('GIF8')) return 'image/gif';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WEBP') return 'image/webp';
  if (s.startsWith('RIFF') && s.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (s.startsWith('OggS')) return 'audio/ogg';
  if (s.startsWith('ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (s.slice(4, 8) === 'ftyp') return 'audio/mp4';
  if (/^\s*(<\?xml|<svg)/i.test(b.subarray(0, 200).toString('utf8'))) return 'image/svg+xml';
  return '';
}

function shrink(b: Buffer): [Buffer, string] {
  const dir = mkdtempSync(join(tmpdir(), 'cbp-shrink-'));
  try {
    writeFileSync(join(dir, 'in'), b);
    execFileSync('sips', ['-Z', '1600', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', join(dir, 'in'), '--out', join(dir, 'out.jpg')], { stdio: 'ignore' });
    return [readFileSync(join(dir, 'out.jpg')), 'image/jpeg'];
  } catch {
    return [b, sniff(b)];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const unent = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const SRC = /(<img\b[^>]*?\bsrc=)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const srcOf = (m: string[]) => m[2] ?? m[3] ?? m[4] ?? '';
const dec = (v: string) => {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
};
const SOUND = /\[sound:([^\]]+)\]/g;
/** Every media name and web picture the notes use. */
function used(col: Collection) {
  const names = new Set<string>(), web = new Set<string>();
  for (const n of col.notes)
    for (const f of n.flds) {
      for (const m of f.matchAll(SRC)) {
        const v = unent(srcOf(m));
        if (/^https?:\/\//i.test(v)) web.add(v);
        else if (v && !/^(data:|\/)/.test(v)) names.add(dec(v));
      }
      for (const m of f.matchAll(SOUND)) names.add(unent(m[1]));
    }
  return { names, web };
}

async function importPkg(file: string) {
  const { col, zip } = readPackage(file);
  const { names, web } = used(col);
  const inZip = new Map(col.media.map((m) => [m.name, m.zip]));
  let map = (await call('/api/plus/push/anki-map')) as Record<string, string>;
  const todo = [...names].filter((n) => !map[n] && inZip.has(n));
  const missing = [...names].filter((n) => !inZip.has(n));
  console.log(`Media: ${names.size} used, ${names.size - todo.length - missing.length} already there, ${todo.length} to send, ${missing.length} missing from the package.`);
  let i = 0, mb = 0;
  const send = async (name: string, bytes: Buffer) => {
    let type = sniff(bytes);
    if (!type) return console.log(`  skipped (not a picture or sound): ${name}`);
    // a big photo: 1600 px is plenty for a card (macOS's sips; the package itself is never touched)
    if (bytes.length > 3e6 && /^image\/(jpeg|png|webp)/.test(type)) [bytes, type] = shrink(bytes);
    try {
      const r = (await call(`/api/plus/push/anki-media?name=${encodeURIComponent(name)}`, bytes, type)) as { url: string };
      map[name] = r.url;
      mb += bytes.length / 1e6;
    } catch (e) {
      failed.push(name);
      console.log(`  not sent: ${name} (${(e as Error).message.slice(0, 120)})`);
    }
  };
  const failed: string[] = [];
  const pool = async (items: string[], f: (x: string) => Promise<void>) => {
    const q = [...items];
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let x; (x = q.shift()) !== undefined; ) {
        await f(x);
        if (++i % 50 === 0) console.log(`  ${i} files, ${mb.toFixed(0)} MB`);
      }
    }));
  };
  await pool(todo, (n) => send(n, mediaBytes(zip, inZip.get(n)!)));
  // pictures linked from the web: kept here, since the page shows only its own
  const webTodo = [...web].filter((u) => !map[u]);
  await pool(webTodo, async (u) => {
    try {
      let r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) ChineseBrainPlus/1.0', Referer: new URL(u).origin + '/' } });
      if (r.status === 429) {
        await new Promise((ok) => setTimeout(ok, 5000));
        r = await fetch(u, { headers: { 'User-Agent': 'ChineseBrainPlus/1.0 (https://chinese.cristianbagrin.com)' } });
      }
      if (r.ok) await send(u, Buffer.from(await r.arrayBuffer()));
      else console.log(`  web picture gone (${r.status}): ${u}`);
    } catch (e) {
      console.log(`  web picture unreachable: ${u}`);
    }
  });
  map = (await call('/api/plus/push/anki-map')) as Record<string, string>;
  if (failed.length) console.log(`${failed.length} file(s) not sent; their fields keep Anki's names. Run the import again to retry.`);

  // fields: Anki's file names → the site's addresses
  const fix = (f: string) =>
    f
      .replace(SRC, (all, pre, a, b, c) => {
        const v = unent(a ?? b ?? c ?? '');
        const name = /^https?:\/\//i.test(v) ? v : dec(v);
        return map[name] ? `${pre}"${map[name]}"` : all;
      })
      .replace(SOUND, (all, n) => (map[unent(n)] ? `[sound:${map[unent(n)]}]` : all));

  // Anki's day: the collection's creation date, turning over at the rollover hour where he is now
  const rollover = Number(col.config.rollover ?? 4);
  const offset = -Number(col.config.localOffset ?? -480); // minutes east of UTC
  const nowSec = Math.floor(Date.now() / 1000);
  const today = dayIndex(col.crt, -Number(col.config.creationOffset ?? 0), nowSec, offset, rollover);
  const localToday = Math.floor((nowSec + offset * 60 - rollover * 3600) / 86400);
  const day0 = new Date((localToday - today) * 864e5).toISOString().slice(0, 10);
  const ck = clock(day0, rollover, Date.now(), offset);
  if (ck.today !== today) throw new Error(`Day mismatch: ${ck.today} vs Anki ${today}.`);

  const revsBy = new Map<number, Rev[]>();
  for (const r of col.revlog) revsBy.set(r.cid, [...(revsBy.get(r.cid) ?? []), [r.id, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]]);
  const cards: Card[] = col.cards.map((c) => {
    const revs = revsBy.get(c.id) ?? [];
    const lrt = c.data.lrt ?? (revs.length ? Math.floor(revs[revs.length - 1][0] / 1000) : undefined);
    return { id: c.id, nid: c.nid, did: c.did, ord: c.ord, type: c.type, queue: c.queue, due: c.due, ivl: c.ivl, reps: c.reps, lapses: c.lapses, left: c.left, flags: c.flags, odue: c.odue, ...(c.data.s != null ? { s: c.data.s, d: c.data.d } : {}), ...(lrt ? { lrt } : {}), mod: c.mod * 1000, revs };
  });
  const deckCount = new Map<number, number>();
  cards.forEach((c) => deckCount.set(c.did, (deckCount.get(c.did) ?? 0) + 1));
  const deckId = [...deckCount].sort((a, b) => b[1] - a[1])[0][0];
  const deck = col.decks.find((d) => d.id === deckId)!;
  const ntCount = new Map<number, number>();
  col.notes.forEach((n) => ntCount.set(n.mid, (ntCount.get(n.mid) ?? 0) + 1));
  const byQueue: Record<string, number> = {};
  cards.forEach((c) => (byQueue[c.queue] = (byQueue[c.queue] ?? 0) + 1));
  // reviews of cards he has since deleted stay in Anki's log; only the living cards' come over
  const kept = cards.reduce((n, c) => n + c.revs.length, 0);
  const anki = { day: today, cards: cards.length, notes: col.notes.length, revlog: kept, revlogDeleted: col.revlog.length - kept, byQueue, forecast: forecast(cards, ck) };
  const meta = { day0, rollover, offset, deck: deckId, conf: deck.conf, notetype: [...ntCount].sort((a, b) => b[1] - a[1])[0][0], imported: new Date().toISOString(), anki };

  const now = Date.now();
  const rows: [string, string, unknown][] = [
    ['meta', 'col', { ...meta, mod: now }],
    ...col.notetypes.map((t) => ['notetype', String(t.id), { ...t, mod: now }] as [string, string, unknown]),
    ...col.decks.map((d) => ['deck', String(d.id), { ...d, mod: now }] as [string, string, unknown]),
    ...col.confs.map((c) => ['conf', String(c.id), { ...c, mod: now }] as [string, string, unknown]),
    ...col.notes.map((n) => ['note', String(n.id), { id: n.id, guid: n.guid, mid: n.mid, mod: n.mod * 1000, tags: n.tags ? n.tags.split(/\s+/) : [], flds: n.flds.map(fix) }] as [string, string, unknown]),
    ...cards.map((c) => ['card', String(c.id), c] as [string, string, unknown]),
  ];
  for (let k = 0; k < rows.length; k += 150) await call('/api/plus/push/anki', { reset: k === 0, rows: rows.slice(k, k + 150) });
  console.log(`Imported ${col.notes.length} notes, ${cards.length} cards, ${kept} reviews (${col.revlog.length - kept} more belong to cards deleted in Anki) into ${SITE} (Anki day ${today}, day 0 = ${day0}).`);
  await check();
}

async function check() {
  const r = (await call('/api/plus/push/anki-check')) as { imported: string | false; live?: boolean; anki?: Record<string, any>; now?: Record<string, any> };
  if (!r.imported) return console.log('Nothing imported yet.');
  const a = r.anki!, n = r.now!;
  const row = (label: string, x: unknown, y: unknown) => console.log(`${label.padEnd(22)}${String(x).padStart(8)}${String(y).padStart(8)}${x === y ? '' : '   ≠'}`);
  console.log(`Imported ${r.imported}${r.live ? ' · live' : ''}. Anki then (day ${a.day}) | the site now (day ${n.day}):`);
  row('cards', a.cards, n.cards);
  row('notes', a.notes, n.notes);
  row('reviews logged', a.revlog, n.revlog);
  const Q: Record<string, string> = { '-3': 'buried', '-2': 'buried (sibling)', '-1': 'suspended', '0': 'new', '1': 'learning', '2': 'review', '3': 'learning (days)' };
  for (const q of new Set([...Object.keys(a.byQueue), ...Object.keys(n.byQueue)])) row(`  ${Q[q] ?? q}`, a.byQueue[q] ?? 0, n.byQueue[q] ?? 0);
  const shift = n.day - a.day;
  console.log(`Due, by day${shift ? ` (Anki's numbers moved ${shift} day(s) to line up)` : ''}:`);
  row('  overdue', a.forecast.backlog, n.forecast.backlog);
  let ta = 0, tn = 0;
  for (let d = 0; d < 30 - shift; d++) {
    ta += a.forecast.days[d + shift];
    tn += n.forecast.days[d];
    row(`  day +${d}`, a.forecast.days[d + shift], n.forecast.days[d]);
  }
  row('next 30 days', ta, tn);
}

function fsrs(file: string) {
  const { col } = readPackage(file);
  const conf = col.confs.find((c) => c.w.length) ?? col.confs[0];
  const f = new Fsrs(conf.w);
  const offset = -Number(col.config.localOffset ?? -480), roll = Number(col.config.rollover ?? 4);
  const day = (ms: number) => Math.floor((ms / 1000 + offset * 60 - roll * 3600) / 86400);
  const by = new Map<number, typeof col.revlog>();
  col.revlog.forEach((r) => by.set(r.cid, [...(by.get(r.cid) ?? []), r]));
  let n = 0, s1 = 0, s5 = 0, d1 = 0, worst = 0;
  for (const c of col.cards) {
    if (c.data.s == null) continue;
    const h = fsrsHistory(by.get(c.id) ?? []);
    if (!h) continue;
    const m = f.replay(h.map((r) => ({ day: day(r.id), g: r.ease })))!;
    const es = Math.abs(m.s - c.data.s) / c.data.s;
    n++;
    if (es < 0.01) s1++;
    if (es < 0.05) s5++;
    if (Math.abs(m.d - c.data.d) < 0.01) d1++;
    worst = Math.max(worst, es);
  }
  console.log(`${n} cards with FSRS memory replayed from their reviews (weights of "${conf.name}"):`);
  console.log(`  difficulty within 0.01 of Anki's: ${d1}`);
  console.log(`  stability within 1%: ${s1}, within 5%: ${s5}; furthest off ${(worst * 100).toFixed(1)}%`);
}

const cmd = args[0];
if (cmd === 'import' && args[1]) await importPkg(args[1]);
else if (cmd === 'check') await check();
else if (cmd === 'fsrs' && args[1]) fsrs(args[1]);
else if (cmd === 'live') console.log(await call('/api/plus/push/anki', { rows: [['meta', 'live', { at: new Date().toISOString(), mod: Date.now() }]] }));
else console.log(readFileSync(new URL(import.meta.url)).toString().split('*/')[0]);
