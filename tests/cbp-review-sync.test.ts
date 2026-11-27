import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answer, clock, type Card, type Conf } from '../site/src/cbp/sched.ts';
import { DEFAULT_W } from '../site/src/cbp/fsrs.ts';
import { drops, sameReviews } from '../site/src/cbp/review/sync.ts';
import { mergeCard, push } from '../site/src/cbp/anki.ts';

const conf: Conf = { id: 1, name: 'd', newPerDay: 10, revPerDay: 200, learnSteps: [1, 10], relearnSteps: [10], maxIvl: 36500, leechThreshold: 8, leechAction: 1, retention: 0.9, w: DEFAULT_W, buryNew: true, buryRev: true };
const t0 = Date.UTC(2026, 10, 27, 1, 0);
const ck = (ms: number) => clock('2026-01-01', 4, ms, 480);
const base: Card = { id: 1, nid: 1, did: 1, ord: 0, type: 2, queue: 2, due: ck(t0).today, ivl: 10, reps: 5, lapses: 0, left: 0, flags: 0, s: 10, d: 5, lrt: Math.floor((t0 - 10 * 864e5) / 1000), mod: 0, revs: [[t0 - 10 * 864e5, 3, 10, 4, 5000, 3000, 1]] };
const ids = (c: { revs?: unknown }) => (c.revs as number[][]).map((r) => r[0]);

test('the stale-card case: a second device answering never drops the first device’s review', () => {
  const phone = answer(base, 3, conf, ck(t0 + 5 * 60e3)).card;
  const mac = answer(base, 3, conf, ck(t0 + 30 * 60e3)).card;
  // the Mac's step: before = what it held (the phone's version, pulled), after = its own answer
  assert.equal(drops('after', phone, mac), undefined);
  assert.equal(drops('after', base, mac), undefined);
  // and grade() sees the card moved under it, so it draws it again instead of answering
  assert.equal(sameReviews(base, phone), false);
  assert.equal(sameReviews(base, { ...base, flags: 1 }), true);
  const merged = mergeCard(phone as never, mac as never, undefined, true);
  assert.deepEqual(ids(merged), [base.revs[0][0], phone.revs.at(-1)![0], mac.revs.at(-1)![0]].sort((a, b) => a - b));
});

test('undo drops only the reviews its own step added', () => {
  const after = answer(base, 1, conf, ck(t0)).card;
  assert.deepEqual(drops('before', base, after), [after.revs.at(-1)![0]]);
  assert.equal(drops('after', base, after), undefined); // redo
  assert.equal(drops('before', base, { ...base, flags: 1 }), undefined); // a flag added no review
});

test('merge: the schedule comes from the side with the latest review, not the newer mod', () => {
  const phone = { ...answer(base, 3, conf, ck(t0)).card, mod: t0 };
  // the monthly refit rewrote the server's copy later (mod = now), from the old history
  const refit = { ...base, s: 11.5, d: 4.9, mod: t0 + 864e5 };
  const m = mergeCard(refit as never, phone as never, undefined, false);
  for (const k of ['due', 'ivl', 's', 'd', 'reps', 'lrt', 'queue', 'type']) assert.equal(m[k], (phone as never)[k], k);
  assert.equal(ids(m).length, 2);
  // the other way round (server has the review, refit comes in newer): still the review's schedule
  const m2 = mergeCard(phone as never, refit as never, undefined, true);
  assert.equal(m2.due, phone.due);
  assert.equal(m2.s, phone.s);
});

test('merge: same last review, the newer change wins whole (flags, suspend, a refit)', () => {
  const flagged = { ...base, flags: 1, mod: 5 };
  assert.equal(mergeCard(base as never, flagged as never, undefined, true).flags, 1);
  assert.equal(mergeCard(flagged as never, base as never, undefined, false).flags, 1);
  const refit = { ...base, s: 12 };
  assert.equal(mergeCard(base as never, refit as never, undefined, true).s, 12);
  const susp = { ...base, queue: -1 };
  assert.equal(mergeCard(base as never, susp as never, undefined, true).queue, -1);
});

test('merge: a suspension on the newer side holds against a newer review from the other', () => {
  const phone = answer(base, 3, conf, ck(t0)).card;
  const susp = { ...base, queue: -1 };
  const m = mergeCard(phone as never, susp as never, undefined, true);
  assert.equal(m.queue, -1);
  assert.equal(m.due, phone.due);
});

test('merge: an undone review leaves, and the schedule goes back with it', () => {
  const after = answer(base, 1, conf, ck(t0)).card;
  const m = mergeCard(after as never, { ...base } as never, drops('before', base, after), true);
  assert.deepEqual(ids(m), ids(base));
  assert.equal(m.due, base.due);
  assert.equal(m.lapses, base.lapses);
});

// a D1 stand-in: one table, conditional writes report their changes
function fakeD1() {
  const rows = new Map<string, { data: string | null; mod: number; usn: number }>();
  let racer: (() => void) | null = null;
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const st = {
      bind: (...v: unknown[]) => ((args = v), st),
      first: async () => {
        const r = rows.get(`${args[0]}:${args[1]}`) ?? null;
        const out = r && { ...r };
        if (racer) {
          const f = racer;
          racer = null;
          f();
        }
        return out;
      },
      all: async () => ({ results: [] }),
      run: async () => exec(),
    };
    const exec = () => {
      if (sql.startsWith('UPDATE')) {
        const [data, mod, usn, kind, id, m0, u0] = args as [string, number, number, string, string, number, number];
        const r = rows.get(`${kind}:${id}`);
        if (!r || r.mod !== m0 || r.usn !== u0) return { meta: { changes: 0 } };
        rows.set(`${kind}:${id}`, { data, mod, usn });
        return { meta: { changes: 1 } };
      }
      const [kind, id, data, mod, usn] = args as [string, string, string, number, number];
      if (rows.has(`${kind}:${id}`)) return { meta: { changes: 0 } };
      rows.set(`${kind}:${id}`, { data, mod, usn });
      return { meta: { changes: 1 } };
    };
    return Object.assign(st, { exec });
  };
  return { rows, race: (f: () => void) => (racer = f), env: { FILES: null, CBP: { prepare, batch: async (s: { exec(): unknown }[]) => s.map((x) => x.exec()) } } };
}

test('push: a write lands only if the row is as it was read; a race is merged again, not erased', async () => {
  const db = fakeD1();
  db.rows.set('card:1', { data: JSON.stringify(base), mod: 1, usn: 1 });
  const phone = answer(base, 3, conf, ck(t0)).card;
  const mac = answer(base, 2, conf, ck(t0 + 60e3)).card;
  // while the Mac's push has read the row, the phone's push lands
  db.race(() => db.rows.set('card:1', { data: JSON.stringify({ ...phone, mod: 2 }), mod: 2, usn: 2 }));
  const r = await push(db.env as never, { ops: [{ kind: 'card', id: '1', data: { ...mac, mod: 3 }, mod: 3 }] });
  assert.equal(r.stored, 1);
  const got = JSON.parse(db.rows.get('card:1')!.data!);
  assert.deepEqual(ids(got), [base.revs[0][0], phone.revs.at(-1)![0], mac.revs.at(-1)![0]]);
  assert.equal(got.due, mac.due);
});
