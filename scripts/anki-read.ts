// Reads an Anki collection package (.colpkg) without Anki: the newer zstd format (collection.anki21b, a protobuf media
// list) and the older one (collection.anki21 / .anki2, a JSON media list). Never writes to it. Node 24+ (zstd, sqlite).
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync, inflateRawSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

// ---------- zip ----------
type Entry = { name: string; method: number; csize: number; offset: number };
export class Zip {
  buf: Buffer;
  entries = new Map<string, Entry>();
  constructor(path: string) {
    this.buf = readFileSync(path);
    const b = this.buf;
    let e = b.length - 22;
    while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Not a zip file.');
    let n = b.readUInt16LE(e + 10), p = b.readUInt32LE(e + 16);
    // zip64 (a big package)
    if (n === 0xffff || p === 0xffffffff) {
      const loc = b.readUInt32LE(e - 20) === 0x07064b50 ? Number(b.readBigUInt64LE(e - 20 + 8)) : -1;
      if (loc < 0) throw new Error('Unsupported zip.');
      n = Number(b.readBigUInt64LE(loc + 32));
      p = Number(b.readBigUInt64LE(loc + 48));
    }
    for (let i = 0; i < n; i++) {
      const method = b.readUInt16LE(p + 10), nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32);
      let csize = b.readUInt32LE(p + 20), offset = b.readUInt32LE(p + 42);
      const name = b.toString('utf8', p + 46, p + 46 + nl);
      // zip64 extra field
      let x = p + 46 + nl;
      const xe = x + xl;
      while (x < xe) {
        const id = b.readUInt16LE(x), sz = b.readUInt16LE(x + 2);
        if (id === 1) {
          let q = x + 4;
          if (b.readUInt32LE(p + 24) === 0xffffffff) q += 8;
          if (csize === 0xffffffff) (csize = Number(b.readBigUInt64LE(q))), (q += 8);
          if (offset === 0xffffffff) offset = Number(b.readBigUInt64LE(q));
        }
        x += 4 + sz;
      }
      this.entries.set(name, { name, method, csize, offset });
      p += 46 + nl + xl + cl;
    }
  }
  has(name: string) {
    return this.entries.has(name);
  }
  get(name: string): Buffer {
    const e = this.entries.get(name);
    if (!e) throw new Error(`No ${name} in the package.`);
    const b = this.buf, h = e.offset;
    const start = h + 30 + b.readUInt16LE(h + 26) + b.readUInt16LE(h + 28);
    const data = b.subarray(start, start + e.csize);
    return e.method === 0 ? Buffer.from(data) : inflateRawSync(data);
  }
}

// ---------- protobuf (just enough to read) ----------
export type Pb = Map<number, (number | Buffer)[]>;
export function pb(b: Uint8Array): Pb {
  const out: Pb = new Map();
  let i = 0;
  const varint = () => {
    let r = 0n, s = 0n;
    for (;;) {
      const c = b[i++];
      r |= BigInt(c & 0x7f) << s;
      s += 7n;
      if (c < 0x80) return r;
    }
  };
  const put = (f: number, v: number | Buffer) => out.set(f, [...(out.get(f) ?? []), v]);
  while (i < b.length) {
    const k = Number(varint()), f = k >>> 3, t = k & 7;
    if (t === 0) put(f, Number(varint()));
    else if (t === 1) (put(f, Buffer.from(b.subarray(i, i + 8)).readDoubleLE(0)), (i += 8));
    else if (t === 5) (put(f, Buffer.from(b.subarray(i, i + 4)).readFloatLE(0)), (i += 4));
    else if (t === 2) {
      const n = Number(varint());
      put(f, Buffer.from(b.subarray(i, i + n)));
      i += n;
    } else throw new Error('Bad protobuf.');
  }
  return out;
}
const str = (m: Pb, f: number) => (m.get(f)?.[0] as Buffer | undefined)?.toString('utf8') ?? '';
const num = (m: Pb, f: number, d = 0) => (m.get(f)?.[0] as number | undefined) ?? d;
const floats = (m: Pb, f: number) => (m.get(f) ?? []).flatMap((v) => (Buffer.isBuffer(v) ? Array.from({ length: v.length / 4 }, (_, k) => v.readFloatLE(k * 4)) : [v]));
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

// ---------- the collection ----------
export type NoteType = { id: number; name: string; css: string; fields: { name: string; ord: number }[]; templates: { name: string; ord: number; qfmt: string; afmt: string }[]; sortf: number; kind: number };
export type DeckConf = {
  id: number; name: string; newPerDay: number; revPerDay: number; learnSteps: number[]; relearnSteps: number[];
  maxIvl: number; leechThreshold: number; leechAction: number; retention: number; w: number[]; buryNew: boolean; buryRev: boolean;
};
export type Deck = { id: number; name: string; conf: number };
export type Card = { id: number; nid: number; did: number; ord: number; type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number; left: number; odue: number; flags: number; mod: number; data: Record<string, number> };
export type Note = { id: number; guid: string; mid: number; mod: number; tags: string; flds: string[] };
export type Rev = { id: number; cid: number; ease: number; ivl: number; lastIvl: number; factor: number; time: number; type: number };
export type Collection = {
  crt: number; config: Record<string, unknown>; notetypes: NoteType[]; decks: Deck[]; confs: DeckConf[];
  notes: Note[]; cards: Card[]; revlog: Rev[]; media: { name: string; zip: string }[];
};

export function readPackage(path: string): { col: Collection; zip: Zip } {
  const zip = new Zip(path);
  const dir = mkdtempSync(join(tmpdir(), 'colpkg-'));
  try {
    const db = join(dir, 'col.sqlite');
    const modern = zip.has('collection.anki21b');
    if (modern) writeFileSync(db, zstdDecompressSync(zip.get('collection.anki21b')));
    else writeFileSync(db, zip.get(zip.has('collection.anki21') ? 'collection.anki21' : 'collection.anki2'));
    const col = readDb(db);
    // the media list: index in the zip → file name
    const raw = zip.get('media');
    if (modern) {
      const list = pb(zstdDecompressSync(raw)).get(1) ?? [];
      col.media = list.map((e, i) => {
        const m = pb(e as Buffer);
        return { name: str(m, 1), zip: m.has(255) ? String(num(m, 255)) : String(i) };
      });
    } else {
      col.media = Object.entries(JSON.parse(raw.toString('utf8') || '{}') as Record<string, string>).map(([zipName, name]) => ({ name, zip: zipName }));
    }
    return { col, zip };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A media file's bytes (the newer format compresses each with zstd). */
export function mediaBytes(zip: Zip, entry: string): Buffer {
  const b = zip.get(entry);
  return b.length >= 4 && b.readUInt32LE(0) === 0xfd2fb528 ? zstdDecompressSync(b) : b;
}

export function readDb(file: string): Collection {
  const db = new DatabaseSync(file, { readOnly: true });
  const all = <T>(sql: string) => db.prepare(sql).all() as T[];
  const crt = Number((db.prepare('SELECT crt FROM col').get() as { crt: number }).crt);
  const config: Record<string, unknown> = {};
  for (const r of all<{ key: string; val: Uint8Array }>('SELECT KEY AS key, val FROM config')) {
    try {
      config[r.key] = JSON.parse(Buffer.from(r.val).toString('utf8'));
    } catch {}
  }
  const fieldRows = all<{ ntid: number; ord: number; name: string }>('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord');
  const tmplRows = all<{ ntid: number; ord: number; name: string; config: Uint8Array }>('SELECT ntid, ord, name, config FROM templates ORDER BY ntid, ord');
  const notetypes = all<{ id: number; name: string; config: Uint8Array }>('SELECT id, name, config FROM notetypes').map((r) => {
    const c = pb(r.config);
    return {
      id: Number(r.id), name: r.name, css: str(c, 3), sortf: num(c, 2), kind: num(c, 1),
      fields: fieldRows.filter((f) => Number(f.ntid) === Number(r.id)).map((f) => ({ name: f.name, ord: Number(f.ord) })),
      templates: tmplRows.filter((t) => Number(t.ntid) === Number(r.id)).map((t) => {
        const tc = pb(t.config);
        return { name: t.name, ord: Number(t.ord), qfmt: str(tc, 1), afmt: str(tc, 2) };
      }),
    };
  });
  // deck options (anki/proto/anki/deck_config.proto, DeckConfig.Config)
  const confs = all<{ id: number; name: string; config: Uint8Array }>('SELECT id, name, config FROM deck_config').map((r) => {
    const c = pb(r.config);
    const w6 = floats(c, 6), w5 = floats(c, 5), w4 = floats(c, 3);
    return {
      id: Number(r.id), name: r.name,
      learnSteps: floats(c, 1).map(r4), relearnSteps: floats(c, 2).map(r4),
      w: (w6.length ? w6 : w5.length ? w5 : w4).map(r4),
      newPerDay: num(c, 9), revPerDay: num(c, 10), maxIvl: num(c, 16, 36500) || 36500,
      leechAction: num(c, 21), leechThreshold: num(c, 22, 8) || 8,
      buryNew: !!num(c, 27), buryRev: !!num(c, 28),
      retention: r4(num(c, 37, 0.9) || 0.9),
    };
  });
  const decks = all<{ id: number; name: string; kind: Uint8Array }>('SELECT id, name, kind FROM decks').map((r) => {
    const normal = pb(r.kind).get(1)?.[0] as Buffer | undefined;
    return { id: Number(r.id), name: r.name.replace(/\x1f/g, '::'), conf: normal ? num(pb(normal), 1, 1) : 1 };
  });
  const notes = all<{ id: number; guid: string; mid: number; mod: number; tags: string; flds: string }>('SELECT id, guid, mid, mod, tags, flds FROM notes').map((r) => ({
    id: Number(r.id), guid: r.guid, mid: Number(r.mid), mod: Number(r.mod), tags: r.tags.trim(), flds: r.flds.split('\x1f'),
  }));
  const cards = all<Record<string, number | string>>('SELECT id, nid, did, ord, type, queue, due, ivl, factor, reps, lapses, left, odue, flags, mod, data FROM cards').map((r) => {
    let data = {};
    try {
      data = JSON.parse(String(r.data || '{}'));
    } catch {}
    const n = (k: string) => Number(r[k]);
    return { id: n('id'), nid: n('nid'), did: n('did'), ord: n('ord'), type: n('type'), queue: n('queue'), due: n('due'), ivl: n('ivl'), factor: n('factor'), reps: n('reps'), lapses: n('lapses'), left: n('left'), odue: n('odue'), flags: n('flags'), mod: n('mod'), data };
  });
  const revlog = all<Record<string, number>>('SELECT id, cid, ease, ivl, lastIvl, factor, time, type FROM revlog ORDER BY id').map((r) => ({
    id: Number(r.id), cid: Number(r.cid), ease: Number(r.ease), ivl: Number(r.ivl), lastIvl: Number(r.lastIvl), factor: Number(r.factor), time: Number(r.time), type: Number(r.type),
  }));
  db.close();
  return { crt, config, notetypes, decks, confs, notes, cards, revlog, media: [] };
}

// ---------- Anki's days ----------
/** Anki's day number for a moment: days since the collection was created, turning over at the rollover hour in the
 *  time zone `offsetMin` minutes east of UTC (rslib sched_timing_today). */
export function dayIndex(crt: number, creationOffsetMin: number, atSec: number, offsetMin: number, rollover: number) {
  const local = (sec: number, off: number) => {
    const d = new Date((sec + off * 60 - rollover * 3600) * 1000);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 864e5;
  };
  return local(atSec, offsetMin) - local(crt, creationOffsetMin);
}

/** The reviews FSRS learns from, the way Anki picks them (rslib scheduler/fsrs/params.rs): rated reviews only, no
 *  manual or rescheduling entries, and only from the last time the card started learning. Null when the card has no
 *  learning start (history from before the collection kept it). */
export function fsrsHistory(revs: Rev[]) {
  const kept = revs.filter((r) => r.ease >= 1 && r.ease <= 4 && r.type !== 4 && r.type !== 5 && !(r.type === 3 && r.ivl === 0 && r.factor === 0));
  // a manual reset (Forget) starts the history over
  const lastReset = revs.reduce((k, r, i) => (r.type === 4 && r.ease === 0 && r.ivl === 0 ? i : k), -1);
  const after = lastReset >= 0 ? kept.filter((r) => r.id > revs[lastReset].id) : kept;
  let start = -1;
  for (let i = 0; i < after.length; i++) if (after[i].type === 0 && (i === 0 || after[i - 1].type !== 0)) start = i;
  return start < 0 ? null : after.slice(start);
}
