// Chinese Brain Plus: the habit on the server (migrations/0007_habit.sql) and the evening nudge.
//   habit      one row a day: what the board reported (reviews, cleared, essay, test), merged from every device
//   push_subs  the phones (Home Screen app) that asked for the nudge: Web Push subscriptions
//   nudge      at the time he picked (Settings › Habit, meta `settings` value `nudge`; default 9 pm), in the time zone of
//              the device that last reported his day (meta `tz`, Taipei until one has), if the day
//              isn't done, one notification saying what's left. Runs on the half-hour cron (worker.js); no AI.
// Web Push by hand on Web Crypto (no dependencies): VAPID (RFC 8292, ES256) and aes128gcm payloads (RFC 8291).
// Keys: VAPID_PUBLIC (base64url, 65 bytes uncompressed P-256) and VAPID_PRIVATE (base64url, the 32-byte `d`), both
// secrets; `node scripts/vapid.mjs` makes a pair.
import { merge, met, left, dayOf, addDays, walk, type Day } from './habit.ts';

type Stmt = { bind(...v: unknown[]): Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
export type Env = { CBP: { prepare(sql: string): Stmt }; VAPID_PUBLIC?: string; VAPID_PRIVATE?: string; SUPPORT?: string };
export class Bad extends Error {}

// ---------- base64url ----------
export const b64u = (b: ArrayBuffer | Uint8Array) => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64u = (s: string) => {
  const t = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
};
const cat = (...a: Uint8Array[]) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let i = 0;
  for (const x of a) out.set(x, (i += x.length) - x.length);
  return out;
};
const utf8 = (s: string) => new TextEncoder().encode(s);

// ---------- the log ----------
export const today = (now = Date.now()) => dayOf(now);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET plus/habit: the days the board reported, the last ~400. */
export async function log(env: Env) {
  const { results } = await env.CBP.prepare('SELECT day, data FROM habit WHERE day >= ? ORDER BY day').bind(addDays(today(), -400)).all<{ day: string; data: string }>();
  return { days: Object.fromEntries(results.map((r) => [r.day, JSON.parse(r.data)])) };
}

// ---------- where he is ----------
export const DEFAULT_TZ = 'Asia/Taipei';
/** A time zone name the runtime knows ('Europe/Warsaw'), else null. */
export function validTz(tz: unknown) {
  if (typeof tz !== 'string' || !/^[A-Za-z][\w+/-]{1,63}$/.test(tz)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}
/** The clock on the wall in `tz` at `ms`, as if it were UTC (so its UTC fields read the local date and time). */
export function wall(ms: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
}

/** POST plus/habit {day, data: Day, low, tz}: the board's report of a day, merged with what's kept (each part its best).
 *  `tz` is the device's time zone: the evening nudge follows it (he moves between Taipei and Warsaw). */
export async function report(env: Env, b: { day?: unknown; data?: unknown; low?: unknown; tz?: unknown }) {
  const day = String(b.day ?? '');
  if (!DAY.test(day) || day > addDays(today(), 1) || day < addDays(today(), -3)) throw new Bad('Bad day.');
  const row = await env.CBP.prepare('SELECT data FROM habit WHERE day = ?').bind(day).first<{ data: string }>();
  const old = row ? (JSON.parse(row.data) as Day & { low?: boolean; done?: boolean }) : null;
  const d = merge(old, b.data as Partial<Day>);
  const low = typeof b.low === 'boolean' ? b.low : !!old?.low;
  const out = { ...d, low, done: met(d, low) };
  const tz = validTz(b.tz);
  if (tz) await env.CBP.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind('tz', JSON.stringify(tz)).run();
  await env.CBP.prepare('INSERT INTO habit (day, data, updated) VALUES (?, ?, ?) ON CONFLICT (day) DO UPDATE SET data = excluded.data, updated = excluded.updated').bind(day, JSON.stringify(out), Date.now()).run();
  return out;
}

// ---------- subscriptions ----------
/** GET plus/nudge/key: the public key the phone subscribes with. */
export const key = (env: Env) => ({ key: env.VAPID_PUBLIC ?? '' });

/** POST plus/nudge/sub {endpoint, keys: {p256dh, auth}}: this phone wants the nudge; a first push says it worked. */
export async function subscribe(env: Env, b: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, ua = '') {
  const endpoint = String(b.endpoint ?? ''), p256dh = String(b.keys?.p256dh ?? ''), auth = String(b.keys?.auth ?? '');
  if (!/^https:\/\/[^\s]{8,1000}$/.test(endpoint) || !/^[\w-]{80,100}$/.test(p256dh) || !/^[\w-]{16,30}$/.test(auth)) throw new Bad('Bad subscription.');
  await env.CBP.prepare('INSERT INTO push_subs (endpoint, p256dh, auth, ua, created, fails) VALUES (?, ?, ?, ?, ?, 0) ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, fails = 0').bind(endpoint, p256dh, auth, ua.slice(0, 200), Date.now()).run();
  const sent = await send(env, { endpoint, p256dh, auth }, { title: 'Chinese', body: 'Evening nudges are on.', tag: 'nudge-on' });
  return { ok: true, sent };
}
/** POST plus/nudge/unsub {endpoint} */
export async function unsubscribe(env: Env, b: { endpoint?: unknown }) {
  await env.CBP.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(String(b.endpoint ?? '')).run();
  return { ok: true };
}

// ---------- Web Push ----------
type Sub = { endpoint: string; p256dh: string; auth: string };
type Msg = { title: string; body: string; tag?: string; url?: string };

/** RFC 8291: the message, encrypted for one subscription (aes128gcm, one record). */
export async function encrypt(sub: { p256dh: string; auth: string }, text: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const ua = unb64u(sub.p256dh), auth = unb64u(sub.auth);
  const mine = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPub = new Uint8Array((await crypto.subtle.exportKey('raw', mine.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as never, mine.privateKey, 256));
  const hkdf = async (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const ikm = await hkdf(auth, shared, cat(utf8('WebPush: info\0'), ua, asPub), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(utf8(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = asPub.length;
  return cat(head, asPub, body);
}

/** RFC 8292: the VAPID header for a push service (its origin is the audience). */
export async function vapid(env: Env, endpoint: string, now = Date.now()) {
  const pub = unb64u(env.VAPID_PUBLIC ?? '');
  if (pub.length !== 65 || !env.VAPID_PRIVATE) throw new Bad('No VAPID keys.');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), d: env.VAPID_PRIVATE, ext: true };
  const k = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o: unknown) => b64u(utf8(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: `mailto:${env.SUPPORT ?? 'chris@cristianbagrin.com'}` })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, utf8(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

/** One push. A subscription the push service says is gone (404/410) is dropped. Returns the service's status. */
export async function send(env: Env, sub: Sub, msg: Msg, ttl = 4 * 3600) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapid(env, sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal' },
    body: await encrypt(sub, JSON.stringify(msg)),
  });
  if (res.status === 404 || res.status === 410) await env.CBP.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(sub.endpoint).run();
  else if (!res.ok) await env.CBP.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?').bind(sub.endpoint).run();
  return res.status;
}

// ---------- the nudge ----------
export const DEFAULT_TIME = '21:00';
/** The times he can pick (Settings › Habit), every half hour from 5 pm to 11:30 pm, his local time. */
export const TIMES = Array.from({ length: 14 }, (_, i) => `${String(17 + (i >> 1)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

async function meta<T>(env: Env, k: string) {
  const r = await env.CBP.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first<{ v: string }>();
  try {
    return r ? (JSON.parse(r.v) as T) : null;
  } catch {
    return null;
  }
}

/** The half-hour check: at his time, if today isn't done, every subscribed phone hears what's left. `force` sends now
 *  whatever the time and the day (the push key's /api/plus/push/nudge?force=1, to try it). */
export async function nudge(env: Env, o: { now?: number; force?: boolean } = {}) {
  const now = o.now ?? Date.now();
  // his time, where he is: the zone of the device that last reported his day
  const tz = validTz(await meta<string>(env, 'tz')) ?? DEFAULT_TZ;
  const w = wall(now, tz), t = new Date(w), hm = `${String(t.getUTCHours()).padStart(2, '0')}:${t.getUTCMinutes() < 30 ? '00' : '30'}`;
  const at = (await meta<{ values?: Record<string, string> }>(env, 'settings'))?.values?.nudge ?? DEFAULT_TIME;
  if (!o.force && (at === 'off' || at !== hm)) return null;
  // the essay day there (it turns over at 4 am), the same day the board keys its report by
  const day = dayOf(w, 0);
  const row = await env.CBP.prepare('SELECT data FROM habit WHERE day = ?').bind(day).first<{ data: string }>();
  const d = row ? (JSON.parse(row.data) as Day & { low?: boolean; done?: boolean }) : null;
  // the bar after a miss: the board sends `low` with today's report; a day it hasn't reported yet gets it from the log
  // (the habit's own walk over the days before: a missed day lowers the bar, a rest day doesn't)
  let low = d?.low;
  if (low == null) {
    const { results } = await env.CBP.prepare('SELECT day, data FROM habit WHERE day >= ? AND day < ?').bind(addDays(day, -60), day).all<{ day: string; data: string }>();
    low = walk(Object.fromEntries(results.map((r) => [r.day, JSON.parse(r.data) as Day])), day).low;
  }
  const last = await meta<{ day: string }>(env, 'job.nudge');
  if (!o.force && (d?.done || last?.day === day)) return { day, skipped: d?.done ? 'done' : 'sent' };
  const { results: subs } = await env.CBP.prepare('SELECT endpoint, p256dh, auth FROM push_subs').all<Sub>();
  const body = left(d, low);
  const sent: number[] = [];
  for (const s of subs) sent.push(await send(env, s, { title: 'Chinese', body, tag: 'nudge', url: '/plus' }).catch(() => 0));
  // a forced try isn't the day's nudge: the evening's own still goes
  if (!o.force) await env.CBP.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind('job.nudge', JSON.stringify({ day, at: new Date(now).toISOString(), body, sent })).run();
  return { day, body, sent };
}
