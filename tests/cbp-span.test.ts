import test from 'node:test';
import assert from 'node:assert/strict';
import { months, heat } from '../site/src/cbp/kit/span.ts';

test('Progress: the calendar year from March, the twelve months ending now in January and February', () => {
  assert.deepEqual(months('2026-11-27').map((x) => `${x.y}-${x.m}`), Array.from({ length: 12 }, (_, m) => `2026-${m}`));
  assert.equal(months('2026-03-01')[0].m, 0);
  const jan = months('2027-01-03');
  assert.deepEqual(jan[0], { y: 2026, m: 1 });
  assert.deepEqual(jan.at(-1), { y: 2027, m: 0 });
  const feb = months('2027-02-28');
  assert.deepEqual(feb[0], { y: 2026, m: 2 });
  assert.deepEqual(feb.at(-1), { y: 2027, m: 1 });
});

test('heatmap across the turn of the year', () => {
  // Progress in early January: last year's February to December, then January so far
  const p = heat('2027-01-03', true);
  assert.ok(p.n0 > 30 && p.cols.length > p.n0);
  assert.equal(p.cols[0].days.find(Boolean)!.slice(0, 7), '2026-02');
  assert.ok(p.cols.slice(0, p.n0).every((c) => c.days.every((d) => !d || d.startsWith('2026'))));
  assert.equal(p.cols.at(-1)!.days.filter(Boolean).at(-1), '2027-01-03');
  assert.equal(p.ranges.length, 12);
  assert.ok(p.ranges.every((r) => r && r[0] <= r[1]));
  assert.equal(p.ranges[11]![1], p.cols.length - 1);
  // in March it is the calendar year again, whole
  const m = heat('2027-03-02', true);
  assert.equal(m.n0, 0);
  assert.equal(m.cols.at(-1)!.days.filter(Boolean).at(-1), '2027-12-31');
  // Today in early January wants 20 weeks: last year fills the rest; in November it needs nothing from last year
  const t = heat('2027-01-03', false, 20);
  assert.ok(t.n0 > 0 && t.cols.length >= 20);
  assert.equal(heat('2026-11-27', false, 20).n0, 0);
  assert.equal(heat('2027-01-03', false).n0, 0);
});
