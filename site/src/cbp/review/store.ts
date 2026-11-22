// The collection on this device: every row in IndexedDB (so reviewing works with no signal), the changes not yet on
// the server in an outbox, and a sync that sends them and brings back what other devices did (src/cbp/anki.ts).
import type { Card, Conf } from '../sched.ts';

export type Note = { id: number; guid: string; mid: number; mod: number; tags: string[]; flds: string[] };
export type NoteType = { id: number; name: string; css: string; sortf: number; kind: number; mod: number; fields: { name: string; ord: number }[]; templates: { name: string; ord: number; qfmt: string; afmt: string }[] };
export type Deck = { id: number; name: string; conf: number; mod: number };
export type ColMeta = { day0: string; rollover: number; offset: number; deck: number; conf: number; notetype: number; imported: string; anki?: Record<string, any>; mod: number };
type Kind = 'meta' | 'notetype' | 'deck' | 'conf' | 'note' | 'card';
type Op = { kind: Kind; id: string; data: unknown; mod: number; drop?: number[] };

export const S = {
  cards: new Map<number, Card>(),
  notes: new Map<number, Note>(),
  types: new Map<number, NoteType>(),
  decks: new Map<number, Deck>(),
  confs: new Map<number, Conf & { mod: number }>(),
  meta: new Map<string, any>(),
  usn: 0,
  outbox: new Map<string, Op>(),
  online: navigator.onLine,
  syncing: false,
  lastSync: 0,
  error: '',
};
const listeners = new Set<(what: string) => void>();
export const onChange = (f: (what: string) => void) => listeners.add(f);
const emit = (what: string) => listeners.forEach((f) => f(what));

// ---------- IndexedDB ----------
let dbp: Promise<IDBDatabase> | null = null;
const db = () =>
  (dbp ??= new Promise((ok, no) => {
    const r = indexedDB.open('cbp-anki', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('rows');
      r.result.createObjectStore('kv');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  }));
async function tx(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => void) {
  const d = await db();
  return new Promise<void>((ok, no) => {
    const t = d.transaction(store, mode);
    f(t.objectStore(store));
    t.oncomplete = () => ok();
    t.onerror = () => no(t.error);
  });
}
async function all(store: string) {
  const d = await db();
  return new Promise<[IDBValidKey, any][]>((ok, no) => {
    const out: [IDBValidKey, any][] = [];
    const r = d.transaction(store).objectStore(store).openCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return ok(out);
      out.push([c.key, c.value]);
      c.continue();
    };
    r.onerror = () => no(r.error);
  });
}

function place(kind: Kind, id: string, data: any) {
  const n = Number(id);
  const m: Map<any, any> = kind === 'card' ? S.cards : kind === 'note' ? S.notes : kind === 'notetype' ? S.types : kind === 'deck' ? S.decks : kind === 'conf' ? S.confs : S.meta;
  const k = kind === 'meta' ? id : n;
  if (data == null) m.delete(k);
  else m.set(k, data);
}
const current = (kind: Kind, id: string): any => {
  const n = Number(id);
  return kind === 'card' ? S.cards.get(n) : kind === 'note' ? S.notes.get(n) : kind === 'notetype' ? S.types.get(n) : kind === 'deck' ? S.decks.get(n) : kind === 'conf' ? S.confs.get(n) : S.meta.get(id);
};

/** Everything this device kept, into memory. */
export async function load() {
  for (const [k, v] of await all('rows')) {
    const [kind, id] = String(k).split(':');
    place(kind as Kind, id, v);
  }
  for (const [k, v] of await all('kv')) {
    if (k === 'usn') S.usn = v;
    if (k === 'outbox') S.outbox = new Map((v as Op[]).map((o) => [`${o.kind}:${o.id}`, o]));
  }
  return S.meta.has('col');
}

/** Change a row here, and queue it for the server. */
export async function put(kind: Kind, id: number | string, data: any, drop?: number[]) {
  const key = `${kind}:${id}`;
  const mod = Date.now();
  if (data) data.mod = mod;
  place(kind, String(id), data);
  const prev = S.outbox.get(key);
  S.outbox.set(key, { kind, id: String(id), data, mod, drop: dropped(prev?.drop, drop, data) });
  await tx('rows', 'readwrite', (s) => (data == null ? s.delete(key) : s.put(data, key)));
  await saveOutbox();
  emit(kind);
  soon();
}
/** The reviews a queued change takes out: what was queued, plus these, minus any the card holds again (a redo). */
const dropped = (a: number[] = [], b: number[] = [], data: any) => {
  const back = new Set<number>((data?.revs ?? []).map((r: number[]) => r[0]));
  const out = [...new Set([...a, ...b])].filter((x) => !back.has(x));
  return out.length ? out : undefined;
};
export async function putMany(items: [Kind, number | string, any, number[]?][]) {
  const mod = Date.now();
  for (const [kind, id, data, drop] of items) {
    if (data) data.mod = mod;
    place(kind, String(id), data);
    const prev = S.outbox.get(`${kind}:${id}`);
    S.outbox.set(`${kind}:${id}`, { kind, id: String(id), data, mod, drop: dropped(prev?.drop, drop, data) });
  }
  await tx('rows', 'readwrite', (s) => items.forEach(([kind, id, data]) => (data == null ? s.delete(`${kind}:${id}`) : s.put(data, `${kind}:${id}`))));
  await saveOutbox();
  emit('many');
  soon();
}
const saveOutbox = () => tx('kv', 'readwrite', (s) => s.put([...S.outbox.values()], 'outbox'));

// ---------- the server ----------
const token = () => {
  try {
    return localStorage.getItem('cb-token') ?? '';
  } catch {
    return '';
  }
};
export async function api(path: string, body?: unknown) {
  const r = await fetch('/api/plus/' + path, body === undefined ? { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' } : { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'It didn’t come through.'), { status: r.status, code: j.code });
  return j;
}

let timer: ReturnType<typeof setTimeout> | undefined;
const soon = () => {
  clearTimeout(timer);
  timer = setTimeout(sync, 1500);
};

/** Send what changed here, then bring back what changed elsewhere. Quietly does nothing with no signal. */
export async function sync() {
  if (S.syncing || !navigator.onLine) return;
  S.syncing = true;
  emit('sync');
  try {
    // up, in batches; a change made while a batch was on its way stays queued
    while (S.outbox.size) {
      const batch = [...S.outbox.values()].slice(0, 200);
      const r = await api('anki/push', { ops: batch });
      for (const o of batch) if (S.outbox.get(`${o.kind}:${o.id}`) === o) S.outbox.delete(`${o.kind}:${o.id}`);
      await saveOutbox();
      // the server kept a newer copy: take it
      if (r.kept?.length) await take(r.kept);
    }
    // down: a minute's overlap, so a change stored while the last pull ran isn't missed
    let since = Math.max(0, S.usn - 60_000), got = 0;
    const had = S.meta.get('col')?.imported;
    for (;;) {
      const r = await api(`anki/pull?since=${since}`);
      // Anki was imported again: what this device holds is the old collection, so start over from the new one
      const fresh = r.rows.find((x: any[]) => x[0] === 'meta' && x[1] === 'col' && x[2]?.imported);
      if (had && fresh && fresh[2].imported !== had) {
        await wipe();
        return void (S.syncing = false, await sync(), emit('pulled'));
      }
      got += await take(r.rows);
      since = r.usn;
      if (!r.more) break;
    }
    S.usn = since;
    await tx('kv', 'readwrite', (s) => s.put(S.usn, 'usn'));
    S.lastSync = Date.now();
    S.error = '';
    if (got) emit('pulled');
  } catch (e) {
    S.error = (e as Error).message;
  } finally {
    S.syncing = false;
    emit('sync');
    // something changed while this round ran: another round
    if (S.outbox.size && navigator.onLine && !S.error) soon();
  }
}

/** Forget this device's copy (after a new import). Changes not sent yet are lost with it: they belonged to the old one. */
async function wipe() {
  for (const m of [S.cards, S.notes, S.types, S.decks, S.confs, S.meta]) m.clear();
  S.outbox.clear();
  S.usn = 0;
  await tx('rows', 'readwrite', (s) => s.clear());
  await tx('kv', 'readwrite', (s) => s.clear());
}

/** Rows from the server: newer than ours (and not waiting in our outbox) replace ours; a card keeps both sides' reviews. */
async function take(rows: [Kind, string, any, number][]) {
  const write: [string, any][] = [];
  for (const [kind, id, data, mod] of rows) {
    const key = `${kind}:${id}`;
    const mine = current(kind, id);
    const pending = S.outbox.get(key);
    if (pending) {
      if (kind === 'card' && data && pending.data) {
        // keep what's queued, but with the other device's reviews too
        const revs = new Map<number, any>();
        for (const r of [...(data.revs ?? []), ...((pending.data as Card).revs ?? [])]) if (!pending.drop?.includes(r[0])) revs.set(r[0], r);
        (pending.data as Card).revs = [...revs.values()].sort((a, b) => a[0] - b[0]);
      }
      continue;
    }
    if (mine && mine.mod > mod && JSON.stringify(mine) !== JSON.stringify(data)) continue;
    if (data) data.mod = mod;
    place(kind, id, data);
    write.push([key, data]);
  }
  if (write.length) await tx('rows', 'readwrite', (s) => write.forEach(([k, v]) => (v == null ? s.delete(k) : s.put(v, k))));
  return write.length;
}

addEventListener('online', () => ((S.online = true), emit('sync'), sync()));
addEventListener('offline', () => ((S.online = false), emit('sync')));
document.addEventListener('visibilitychange', () => !document.hidden && sync());
setInterval(() => !document.hidden && sync(), 60_000);
