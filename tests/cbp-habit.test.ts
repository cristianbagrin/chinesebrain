import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walk, reviewDays, merge, left, sentences, han, met, monday, dayOf, blank, hold, goal, columns, type Day } from '../site/src/cbp/habit.ts';
import { encrypt, vapid, b64u, unb64u, nudge, TIMES } from '../site/src/cbp/push.ts';
import { SETTINGS } from '../site/src/cbp/settings.ts';

const day = (o: Partial<Day>): Day => ({ ...blank(), ...o });
const done = day({ rv: 20, chars: 300, sent: 12 });
const none = day({});
// 2026-11-16 is a Monday
const st = (days: Record<string, Day>, today: string) => walk(days, today);

test('a day is done with reviews cleared and the essay written', () => {
  assert.equal(met(done, false), true);
  assert.equal(met(day({ rv: 20, cleared: false, chars: 300 }), false), false, 'reviews left');
  assert.equal(met(day({ rv: 20 }), false), false, 'no essay');
  const w = st({ '2026-11-16': done, '2026-11-17': day({ ...done, test: true }) }, '2026-11-18');
  assert.equal(w.days['2026-11-16'].st, 'done');
  assert.equal(w.days['2026-11-17'].deep, true, 'a test deepens it');
  assert.equal(w.days['2026-11-18'].st, 'open', 'today is never a miss yet');
  assert.equal(w.streak, 2, 'today still open keeps the streak');
});

test('the first miss of a week is a rest; the second breaks the streak', () => {
  const days = { '2026-11-16': done, '2026-11-17': none, '2026-11-18': done, '2026-11-19': none, '2026-11-20': done, '2026-11-21': done };
  const w = st(days, '2026-11-21');
  assert.equal(w.days['2026-11-17'].st, 'rest');
  assert.equal(w.days['2026-11-19'].st, 'miss');
  assert.equal(w.streak, 2);
  // a new week, a new rest
  const w2 = st({ '2026-11-21': done, '2026-11-22': none, '2026-11-23': none, '2026-11-24': done }, '2026-11-24');
  assert.equal(w2.days['2026-11-22'].st, 'rest', 'Sunday');
  assert.equal(w2.days['2026-11-23'].st, 'rest', 'Monday starts a new week');
  assert.equal(w2.streak, 2, 'rest days hold the streak without adding to it');
  assert.equal(monday('2026-11-22'), '2026-11-16');
  const w3 = st({ '2026-11-16': done, '2026-11-17': none, '2026-11-18': none, '2026-11-23': none }, '2026-11-24');
  assert.equal(w3.days['2026-11-23'].st, 'miss', 'no streak left to hold: no rest');
});

test('never miss twice: after a miss, reviews and three sentences are enough', () => {
  const short = day({ rv: 5, chars: 30, sent: 3 });
  const days = { '2026-11-16': done, '2026-11-17': none, '2026-11-18': none, '2026-11-19': short, '2026-11-20': short };
  const w = st(days, '2026-11-21');
  assert.equal(w.days['2026-11-18'].st, 'miss');
  assert.equal(w.days['2026-11-19'].low, true);
  assert.equal(w.days['2026-11-19'].st, 'done', 'three sentences count the day after a miss');
  assert.equal(w.days['2026-11-20'].low, false, 'the bar is back up the day after');
  assert.equal(w.days['2026-11-20'].st, 'done', 'a short essay is still an essay');
  assert.equal(w.days['2026-11-21'].low, false);
  const two = day({ rv: 5, chars: 20, sent: 2 });
  const w2 = st({ '2026-11-16': done, '2026-11-17': none, '2026-11-18': none, '2026-11-19': two }, '2026-11-19');
  assert.equal(w2.days['2026-11-19'].st, 'open', 'two sentences are not three');
  assert.equal(w2.low, true);
  // a partial day is a miss for tomorrow's bar
  const w3 = st({ '2026-11-16': done, '2026-11-17': none, '2026-11-18': day({ rv: 9 }) }, '2026-11-19');
  assert.equal(w3.days['2026-11-18'].st, 'partial');
  assert.equal(w3.low, true);
});

test('sentences and characters', () => {
  assert.equal(sentences('今天很好。我去了學校！你呢？'), 3);
  assert.equal(sentences('今天很好\nOK.\n我很累'), 2, 'English alone is not a sentence');
  assert.equal(han('我 love 你'), 2);
});

test('reviews a day, and the days that ended with reviews left due', () => {
  const D = 864e5, t0 = Date.UTC(2026, 10, 1, 12);
  const d = (ms: number) => Math.floor((ms - Date.UTC(2026, 10, 1)) / D);
  const r = (n: number, ivl: number, type = 1) => [t0 + n * D, 3, ivl, 1, 0, 1000, type];
  const cards = [
    // reviewed day 0, due day 2, reviewed on day 4: days 2 and 3 ended with it due
    { queue: 2, revs: [r(0, 2), r(4, 10)] },
    // learning step (seconds): no due day
    { queue: 1, revs: [r(1, -600, 0)] },
    // suspended after its last review: not due after
    { queue: -1, revs: [r(0, 1)] },
    // still in the deck, last due day 8, today is 10: days 8 and 9 open
    { queue: 2, revs: [r(5, 3)] },
  ];
  const { count, open } = reviewDays(cards, d, 10);
  assert.equal(count.get(0), 2);
  assert.equal(count.get(4), 1);
  assert.deepEqual([...open].sort((a, b) => a - b), [2, 3, 8, 9], 'the suspended card never counts as left');
  assert.equal(open.has(10), false, 'today is not judged');
});

test('a card buried behind its reviewed sibling was not left', () => {
  const D = 864e5, t0 = Date.UTC(2026, 10, 1, 12);
  const d = (ms: number) => Math.floor((ms - Date.UTC(2026, 10, 1)) / D);
  const r = (n: number, ivl: number) => [t0 + n * D, 3, ivl, 1, 0, 1000, 1];
  // both cards of note 7 due day 3; one reviewed on day 3, the other buried and reviewed on day 4
  const { open } = reviewDays([{ queue: 2, nid: 7, revs: [r(0, 3), r(3, 5)] }, { queue: 2, nid: 7, revs: [r(1, 2), r(4, 5)] }], d, 6);
  assert.equal(open.has(3), false);
});

test('the server keeps the best of each report', () => {
  const m = merge({ rv: 30, cleared: true, chars: 0 }, { rv: 12, cleared: false, chars: 250, sent: 8 });
  assert.deepEqual(m, { rv: 30, cleared: true, chars: 250, sent: 8, cards: 0, test: false });
});

test('the nudge says only what is left', () => {
  assert.equal(left(null, false), 'Reviews and your essay.');
  assert.equal(left(day({ rv: 3, cleared: true }), false), 'Your essay is left.');
  assert.equal(left(day({ cleared: false, chars: 100, sent: 5 }), false), 'Reviews left.');
  assert.equal(left(day({ cleared: true, sent: 1, chars: 10 }), true), 'Three sentences left.');
});

test('the habit day turns over at 4 am Taipei', () => {
  assert.equal(dayOf(Date.UTC(2026, 10, 26, 19, 59)), '2026-11-26', '3:59 am on the 27th is still the 26th');
  assert.equal(dayOf(Date.UTC(2026, 10, 26, 20, 0)), '2026-11-27');
});

test('the nudge times match the server setting', () => {
  assert.deepEqual(SETTINGS.nudge.options.slice(1), TIMES);
  assert.equal(SETTINGS.nudge.def, '21:00');
});

// ---------- Web Push ----------
const subtle = crypto.subtle;
async function decrypt(body: Uint8Array, uaPriv: CryptoKey, uaPub: Uint8Array, auth: Uint8Array) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPriv, 256));
  const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const e = new TextEncoder();
  const info = new Uint8Array([...e.encode('WebPush: info\0'), ...uaPub, ...asPub]);
  const ikm = await hkdf(auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, e.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, e.encode('Content-Encoding: nonce\0'), 12);
  const pt = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
  assert.equal(pt[pt.length - 1], 2, 'the last record ends with 0x02');
  return new TextDecoder().decode(pt.slice(0, -1));
}

test('a push payload decrypts on the phone (RFC 8291)', async () => {
  const ua = (await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const uaPub = new Uint8Array((await subtle.exportKey('raw', ua.publicKey)) as ArrayBuffer);
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encrypt({ p256dh: b64u(uaPub), auth: b64u(auth) }, '{"title":"Chinese","body":"Your essay is left."}');
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(await decrypt(body, ua.privateKey, uaPub, auth), '{"title":"Chinese","body":"Your essay is left."}');
});

test('the VAPID header is a valid ES256 token for the push service', async () => {
  const k = (await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = b64u((await subtle.exportKey('raw', k.publicKey)) as ArrayBuffer);
  const { d } = await subtle.exportKey('jwk', k.privateKey);
  const h = await vapid({ CBP: null as never, VAPID_PUBLIC: pub, VAPID_PRIVATE: d, SUPPORT: 'x@example.com' }, 'https://web.push.apple.com/abc', Date.UTC(2026, 10, 26));
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h)!;
  assert.ok(m);
  assert.equal(m[4], pub);
  const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:x@example.com');
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, k.publicKey, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.ok(ok);
});

// ---------- the evening check ----------
function fakeDb(rows: { settings?: unknown; habit?: unknown; last?: unknown; log?: Record<string, unknown>; tz?: string }) {
  const writes: unknown[][] = [];
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const s = {
      bind: (...a: unknown[]) => ((args = a), s),
      first: async () => {
        if (sql.includes('FROM meta')) {
          const v = args[0] === 'settings' ? rows.settings : args[0] === 'tz' ? rows.tz : rows.last;
          return v ? { v: JSON.stringify(v) } : null;
        }
        if (sql.includes('FROM habit')) return rows.habit ? { data: JSON.stringify(rows.habit) } : null;
        return null;
      },
      all: async () => ({ results: sql.includes('FROM habit') ? Object.entries(rows.log ?? {}).map(([day, d]) => ({ day, data: JSON.stringify(d) })) : [] }),
      run: async () => (writes.push([sql, ...args]), {}),
    };
    return s;
  };
  return { env: { CBP: { prepare } }, writes };
}
// 21:00 Taipei on Nov 26 = 13:00 UTC
const nine = Date.UTC(2026, 10, 26, 13, 0);

test('the nudge waits for his time, skips a done day, and goes once', async () => {
  assert.equal(await nudge(fakeDb({}).env as never, { now: nine - 30 * 60e3 }), null, '8:30 pm: not yet');
  const a = fakeDb({});
  const r = await nudge(a.env as never, { now: nine + 5 * 60e3 });
  assert.equal(r?.body, 'Reviews and your essay.', '9 pm, nothing reported: both are left');
  assert.equal(a.writes.length, 1, 'remembered as sent');
  assert.deepEqual(await nudge(fakeDb({ habit: { done: true } }).env as never, { now: nine }), { day: '2026-11-26', skipped: 'done' });
  assert.deepEqual(await nudge(fakeDb({ last: { day: '2026-11-26' } }).env as never, { now: nine }), { day: '2026-11-26', skipped: 'sent' });
  assert.equal(await nudge(fakeDb({ settings: { values: { nudge: 'off' } } }).env as never, { now: nine }), null, 'off');
  assert.equal((await nudge(fakeDb({ settings: { values: { nudge: '22:30' } } }).env as never, { now: nine + 90 * 60e3 }))?.day, '2026-11-26', 'his own time');
});

test('a day not reported yet still gets the lower bar after a miss; a forced try leaves the evening nudge alone', async () => {
  const done = { rv: 10, cleared: true, chars: 200, sent: 6, cards: 0, test: false };
  // done on the 23rd and 24th, nothing on the 25th: yesterday was a rest (the first miss of the week), so the bar holds
  const rest = await nudge(fakeDb({ log: { '2026-11-23': done, '2026-11-24': done } }).env as never, { now: nine });
  assert.equal(rest?.body, 'Reviews and your essay.');
  // the 24th missed, the 25th missed too (the week's rest went on the 24th): today's bar is three sentences
  const low = await nudge(fakeDb({ log: { '2026-11-23': done } }).env as never, { now: nine });
  assert.equal(low?.body, 'Reviews and three sentences.');
  const f = fakeDb({});
  await nudge(f.env as never, { now: nine - 8 * 3600e3, force: true });
  assert.equal(f.writes.length, 0, 'a forced try is not remembered as the day\'s nudge');
});

test('the nudge follows the time zone his device reported', async () => {
  // 21:00 in Warsaw on Feb 10 (winter, UTC+1) = 20:00 UTC; at that moment it's 4 am the next day in Taipei
  const w9 = Date.UTC(2027, 1, 10, 20, 0);
  const r = await nudge(fakeDb({ tz: 'Europe/Warsaw' }).env as never, { now: w9 });
  assert.equal(r?.day, '2027-02-10', 'his day in Warsaw, not Taipei\'s');
  assert.equal(await nudge(fakeDb({}).env as never, { now: w9 }), null, 'with no zone yet: Taipei time, so not now');
  assert.equal(await nudge(fakeDb({ tz: 'Europe/Warsaw' }).env as never, { now: nine }), null, '9 pm in Taipei is 2 pm in Warsaw');
  // a zone the runtime doesn't know falls back to Taipei
  assert.equal((await nudge(fakeDb({ tz: 'Mars/Base' }).env as never, { now: nine }))?.day, '2026-11-26');
});

test('the essay counts once he leaves the writing box, and stays counted', () => {
  const d = day({ rv: 20, chars: 120, sent: 5 });
  assert.equal(met(hold(d, true, false), false), false, 'still writing: held back');
  assert.equal(met(hold(d, true, false), true), false, 'held on a low day too');
  assert.equal(met(hold(d, false, false), false), true, 'left the box: done');
  assert.equal(met(hold(d, true, true), false), true, 'writing again after it counted: still done');
  assert.deepEqual(hold(d, true, false), { ...d, chars: 0, sent: 0 }, 'only the essay is held, not the reviews');
  const w = walk({ '2026-11-16': done, '2026-11-17': hold(d, true, false) }, '2026-11-17');
  assert.equal(w.days['2026-11-17'].st, 'open');
  assert.equal(walk({ '2026-11-16': done, '2026-11-17': hold(d, false, false) }, '2026-11-17').streak, 2);
});

test('the ring fills toward the next milestone', () => {
  assert.equal(goal(0, false), 7);
  assert.equal(goal(6, false), 7, "today's segment completes the week");
  assert.equal(goal(7, true), 7, 'a milestone reached today shows full');
  assert.equal(goal(7, false), 14);
  assert.equal(goal(29, true), 30);
  assert.equal(goal(365, false), 400);
  assert.equal(goal(420, true), 500);
});

test('heatmap columns: every month starts its own column, at its own weekday rows', () => {
  const C = columns(2026, '2026-11-27');
  const at = (d: string) => C.findIndex((c) => c.days.includes(d));
  // Oct 1 2026 is a Thursday: Sep 28–30 keep their column (Thu–Sun empty), October starts the next one at Thursday's row
  const sep = C[at('2026-09-30')], oct = C[at('2026-10-01')];
  assert.deepEqual(sep.days, ['2026-09-28', '2026-09-29', '2026-09-30', null, null, null, null]);
  assert.deepEqual(oct.days, [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(at('2026-10-01'), at('2026-09-30') + 1);
  assert.ok(oct.first && !sep.first);
  // Nov 1 2026 is a Sunday: alone at the bottom of its own column, after Oct 26–31
  assert.deepEqual(C[at('2026-10-31')].days, ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
  assert.deepEqual(C[at('2026-11-01')].days, [null, null, null, null, null, null, '2026-11-01']);
  assert.deepEqual(C[at('2026-11-02')].days.slice(0, 1), ['2026-11-02']);
  // a month that starts on a Monday adds no column (Jun 1 2026)
  assert.equal(at('2026-06-01'), at('2026-05-31') + 1);
  assert.deepEqual(C[at('2026-05-31')].days.slice(6), ['2026-05-31']);
  // Jan 1 (a Thursday) starts the year at its own row; the last column ends on the given day
  assert.deepEqual(C[0].days.slice(0, 4), [null, null, null, '2026-01-01']);
  assert.equal(C.at(-1)!.days.filter(Boolean).at(-1), '2026-11-27');
  // one name a month, twelve over the whole year
  assert.equal(columns(2026, '2026-12-31').filter((c) => c.first).length, 12);
  assert.ok(C.every((c) => c.days.filter(Boolean).every((d) => +d!.slice(5, 7) - 1 === c.month)));
});
