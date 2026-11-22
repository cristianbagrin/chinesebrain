// Back to Anki: the whole collection on this device as a .colpkg Anki opens (File › Import, or double-click), its
// reviews, FSRS memory, settings, note types and media included. Written in the format Anki itself writes when it
// exports "for older Anki versions" (rslib export_collection_package, legacy): a zip of `collection.anki21` (SQLite,
// schema 11, the collection's settings as JSON in the `col` row), `media` (JSON: zip entry → file name), the media
// files under numbers, and `meta`. Every Anki since 2.1.50 imports it as is. SQLite comes from sql.js
// (plus/vendor, MIT), loaded only for this.
import { S, api } from './store.ts';
import { strip } from './render.ts';
import { clock, type Card } from '../sched.ts';

declare function initSqlJs(o: { locateFile: (f: string) => string }): Promise<any>;
const US = '\x1f';
const secs = (ms: number) => Math.floor(ms / 1000);

function loadSql() {
  return new Promise<any>((ok, no) => {
    if (typeof initSqlJs === 'function') return initSqlJs({ locateFile: (f) => `/plus/vendor/${f}` }).then(ok, no);
    const s = document.createElement('script');
    s.src = '/plus/vendor/sql-wasm.js';
    s.onload = () => initSqlJs({ locateFile: (f) => `/plus/vendor/${f}` }).then(ok, no);
    s.onerror = () => no(new Error('Needs signal once to get the packer.'));
    document.head.append(s);
  });
}

// ---------- a zip, stored (Anki's importer reads plain stored entries) ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
class Zip {
  parts: BlobPart[] = [];
  dir: Uint8Array[] = [];
  at = 0;
  n = 0;
  add(name: string, data: Uint8Array) {
    const nm = new TextEncoder().encode(name), crc = crc32(data);
    const head = new Uint8Array(30 + nm.length), h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // names in UTF-8
    h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nm.length, true);
    head.set(nm, 30);
    const cd = new Uint8Array(46 + nm.length), c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, nm.length, true);
    c.setUint32(42, this.at, true);
    cd.set(nm, 46);
    this.parts.push(head, data as BlobPart);
    this.dir.push(cd);
    this.at += head.length + data.length;
    this.n++;
  }
  blob() {
    const size = this.dir.reduce((s, d) => s + d.length, 0);
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, this.n, true);
    e.setUint16(10, this.n, true);
    e.setUint32(12, size, true);
    e.setUint32(16, this.at, true);
    return new Blob([...this.parts, ...(this.dir as BlobPart[]), end], { type: 'application/zip' });
  }
}

async function sha1Int(s: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s)));
  return ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
}
/** A field's text for Anki's checksum: tags out, pictures' file names kept (strip_html_preserving_media_filenames). */
const plain = (f: string) => strip(f.replace(/<img[^>]*src=["']?([^"' >]+)["']?[^>]*>/gi, ' $1 '));

export async function exportAnki(progress: (s: string) => void) {
  const col = S.meta.get('col');
  if (!col) throw new Error('Nothing to export yet.');
  progress('Packing…');
  const SQL = await loadSql();

  // the site's media addresses → Anki's file names (the import kept both; anything added here keeps its own name)
  let names: Record<string, string> = {};
  try {
    names = Object.fromEntries(Object.entries((await api('anki/media-map')) as Record<string, string>).map(([n, u]) => [u, n]));
  } catch {
    if (!navigator.onLine) throw new Error('Needs signal: the pictures and sounds come from the site.');
  }
  const MEDIA = /\/api\/plus\/media\/[0-9a-f]{32}\.\w+/g;
  const used = new Map<string, string>(); // site address → Anki name
  const nameOf = (u: string) => {
    let n = used.get(u);
    if (!n) {
      n = names[u] ?? u.split('/').pop()!;
      used.set(u, n);
    }
    return n;
  };
  const toAnki = (f: string) => f.replace(MEDIA, (u) => nameOf(u));

  // ---------- the collection ----------
  const db = new SQL.Database();
  db.run(SCHEMA);
  const now = Date.now();
  const conf = [...S.confs.values()];
  const types = [...S.types.values()];
  const decks = [...S.decks.values()];
  // day 0 at the rollover hour where he is now, so Anki counts the same days (its crt and creationOffset)
  const offset = -new Date().getTimezoneOffset();
  const crt = Date.UTC(+col.day0.slice(0, 4), +col.day0.slice(5, 7) - 1, +col.day0.slice(8, 10)) / 1000 + col.rollover * 3600 - offset * 60;
  const cfg = {
    activeDecks: [col.deck], curDeck: col.deck, curModel: col.notetype, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true,
    sortType: 'noteCrt', sortBackwards: false, addToCur: true, nextPos: S.cards.size + 1, schedVer: 2, sched2021: true, fsrs: true,
    rollover: col.rollover, creationOffset: -offset, localOffset: -offset, dayLearnFirst: false,
    // what's buried today stays buried until tomorrow, as in Anki
    lastUnburied: clock(col.day0, col.rollover).today,
  };
  const models: Record<string, unknown> = {};
  const tmplAt = new Map<string, number>(); // a card's template, by its place in Anki's list
  for (const t of types) {
    models[t.id] = {
      id: t.id, name: t.name, type: t.kind ?? 0, mod: secs(t.mod || now), usn: -1, sortf: t.sortf ?? 0, did: null,
      tmpls: t.templates.slice().sort((a, b) => a.ord - b.ord).map((x, i) => ({ name: x.name, ord: i, qfmt: x.qfmt, afmt: x.afmt, bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0, id: null })),
      flds: t.fields.slice().sort((a, b) => a.ord - b.ord).map((f, i) => ({ name: f.name, ord: i, sticky: false, rtl: false, font: 'Arial', size: 20, description: '', plainText: false, collapsed: false, excludeFromSearch: false, id: null, tag: null, preventDeletion: false })),
      css: t.css, latexPre: LATEX_PRE, latexPost: '\\end{document}', latexsvg: false, req: t.templates.map((x, i) => [i, 'any', [0]]), originalStockKind: 1,
    };
    t.templates.slice().sort((a, b) => a.ord - b.ord).forEach((x, i) => tmplAt.set(`${t.id}:${x.ord}`, i));
  }
  const deckJson: Record<string, unknown> = {
    1: { id: 1, mod: 0, name: 'Default', usn: 0, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: true, browserCollapsed: true, desc: '', dyn: 0, conf: 1, extendNew: 0, extendRev: 0 },
  };
  for (const d of decks) deckJson[d.id] = { id: d.id, mod: secs(d.mod || now), name: d.name, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: '', dyn: 0, conf: d.conf, extendNew: 0, extendRev: 0 };
  const dconf: Record<string, unknown> = {};
  for (const c of conf)
    dconf[c.id] = {
      id: c.id, mod: secs(c.mod || now), name: c.name || 'Default', usn: -1, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
      new: { bury: c.buryNew, delays: c.learnSteps, initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: c.newPerDay },
      rev: { bury: c.buryRev, ease4: 1.3, ivlFct: 1, maxIvl: c.maxIvl, perDay: c.revPerDay, hardFactor: 1.2 },
      lapse: { delays: c.relearnSteps, leechAction: c.leechAction, leechFails: c.leechThreshold, minInt: 1, mult: 0 },
      newMix: 0, newPerDayMinimum: 0, interdayLearningMix: 0, reviewOrder: 0, newSortOrder: 0, newGatherPriority: 0, buryInterdayLearning: c.buryRev,
      fsrsWeights: [], fsrsParams5: [], fsrsParams6: c.w.length >= 21 ? c.w : [], desiredRetention: c.retention, ignoreRevlogsBeforeDate: '1970-01-01',
      easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1], stopTimerOnAnswer: false, secondsToShowQuestion: 0, secondsToShowAnswer: 0, questionAction: 0, answerAction: 0, waitForAudio: true, sm2Retention: 0.9, weightSearch: '',
    };
  const tags = new Set<string>();
  S.notes.forEach((n) => n.tags.forEach((t) => tags.add(t)));
  db.run('INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)', [crt, now, now, JSON.stringify(cfg), JSON.stringify(models), JSON.stringify(deckJson), JSON.stringify(dconf), JSON.stringify(Object.fromEntries([...tags].map((t) => [t, 0])))]);

  progress('Notes…');
  db.run('BEGIN');
  const ins = db.prepare('INSERT INTO notes VALUES (?,?,?,?,-1,?,?,?,?,0,?)');
  const alive = new Set<number>();
  for (const n of S.notes.values()) {
    const t = S.types.get(n.mid);
    if (!t) continue;
    const flds = n.flds.slice(0, t.fields.length).map(toAnki);
    while (flds.length < t.fields.length) flds.push('');
    const sort = plain(flds[t.sortf ?? 0] ?? '');
    ins.run([n.id, n.guid, n.mid, secs(n.mod || now), n.tags.length ? ` ${n.tags.join(' ')} ` : '', flds.join(US), sort, await sha1Int(plain(flds[0] ?? '')), '']);
    alive.add(n.id);
  }
  ins.free();
  const insC = db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,-1,?,?,?,?,?,?,?,?,?,0,?,?)');
  const insR = db.prepare('INSERT INTO revlog VALUES (?,?,-1,?,?,?,?,?,?)');
  let reviews = 0;
  for (const c of S.cards.values() as Iterable<Card>) {
    const ord = tmplAt.get(`${S.notes.get(c.nid)?.mid}:${c.ord}`);
    if (!alive.has(c.nid) || ord == null) continue;
    const data = c.s != null ? { s: round(c.s), d: round(c.d!), dr: conf.find((x) => x.id === (S.decks.get(c.did)?.conf ?? col.conf))?.retention ?? 0.9, decay: round(confW(c)), ...(c.lrt ? { lrt: c.lrt } : {}) } : {};
    insC.run([c.id, c.nid, S.decks.has(c.did) ? c.did : col.deck, ord, secs(c.mod || now), c.type, c.queue, c.due, c.ivl, c.type === 0 ? 0 : 2500, c.reps, c.lapses, c.left, c.odue ?? 0, c.flags & 7, JSON.stringify(data)]);
    for (const r of c.revs) {
      insR.run([r[0], c.id, r[1], r[2], r[3], r[4], r[5], r[6]]);
      reviews++;
    }
  }
  insC.free();
  insR.free();
  db.run('COMMIT');
  const sqlite = db.export() as Uint8Array;
  db.close();

  // ---------- the zip: the collection, then each picture and sound ----------
  const zip = new Zip();
  zip.add('collection.anki21', sqlite);
  const list = [...used];
  const media: Record<string, string> = {};
  const got: [number, Uint8Array][] = [];
  let i = 0, done = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (;;) {
        const k = i++;
        if (k >= list.length) return;
        try {
          const r = await fetch(list[k][0]);
          if (r.ok) got.push([k, new Uint8Array(await r.arrayBuffer())]);
        } catch {}
        done++;
        if (done % 20 === 0) progress(`Pictures ${Math.round((done / list.length) * 100)}%`);
      }
    }),
  );
  got.sort((a, b) => a[0] - b[0]);
  got.forEach(([k, bytes], n) => {
    media[n] = list[k][1];
    zip.add(String(n), bytes);
  });
  zip.add('media', new TextEncoder().encode(JSON.stringify(media)));
  zip.add('meta', new Uint8Array([0x08, 0x02]));

  const d = new Date(), file = `Chinese ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.colpkg`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(zip.blob());
  a.download = file;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  return { notes: alive.size, reviews, media: got.length, missing: list.length - got.length };
}
const round = (x: number) => Math.round(x * 1e4) / 1e4;
const confW = (c: Card) => {
  const cf = S.confs.get(S.decks.get(c.did)?.conf ?? S.meta.get('col').conf) ?? [...S.confs.values()][0];
  return cf.w[20] ?? 0.5;
};

const LATEX_PRE = '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n';
// Anki's schema 11, as its own legacy export writes it
const SCHEMA = `CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);`;
