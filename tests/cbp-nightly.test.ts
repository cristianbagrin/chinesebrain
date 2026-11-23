// The Cloudflare nightly's own parts (site/src/cbp): the export built from his account, the 4 am day, the essay marks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportText } from '../site/src/cbp/brain.ts';
import { boardDay, testProblems, readExport } from '../site/src/cbp/engine.ts';
import { plan, anchor, essayToday } from '../site/src/cbp/essays.ts';

const T = (s: string) => Date.parse(s);

test('export: status changes after `since`, with what each word was before', () => {
  const since = T('2026-11-19T07:33:00Z');
  const items = [
    { k: 'w:麻煩', v: { w: '麻煩', s: 'learning', p: 'Má fan', g: 'trouble', updated: T('2026-11-21T03:00:00Z'), hist: [{ t: T('2026-10-01T00:00:00Z'), s: 'fresh' }, { t: T('2026-11-21T03:00:00Z'), s: 'learning' }], ctx: [] } },
    { k: 'w:看', v: { w: '看', s: 'known', updated: T('2026-11-21T03:00:00Z'), hist: [{ t: T('2026-01-01T00:00:00Z'), s: 'known' }], ctx: [] } },
    { k: 'w:來回', v: { w: '來回', s: 'known', updated: T('2026-11-22T16:30:00Z'), hist: [{ t: T('2026-11-20T00:00:00Z'), s: 'fresh' }, { t: T('2026-11-22T16:30:00Z'), s: 'known' }], ctx: [] } },
    { k: 'w:不見', v: null },
    { k: 'sav:看', v: [{ zh: '我看一下', en: 'let me see', at: T('2026-11-20T00:00:00Z') }] },
  ];
  const { text, count } = exportText(items, since, T('2026-11-23T14:00:00Z'), (w) => (w === '不見' ? 'K' : null));
  const [rows] = readExport(text);
  assert.equal(count, 4);
  const by = Object.fromEntries(rows.map((r) => [r.word, r]));
  assert.deepEqual([by['麻煩'].now, by['麻煩'].was, by['麻煩'].pinyin], ['L', 'F', 'má fan']);
  assert.deepEqual([by['來回'].now, by['來回'].was, by['來回'].date], ['K', '-', '2026-11-23']); // 00:30 in Taipei
  assert.deepEqual([by['不見'].now, by['不見'].was], ['-', 'K']);
  assert.deepEqual([by['看'].now, by['看'].was, by['看'].saved], ['K', 'K', '我看一下 — let me see']);
});

test('a card carded after midnight belongs to the evening before (4 am, his time)', () => {
  assert.equal(boardDay('2026-11-06T01:30:00+08:00'), '2026-11-05');
  assert.equal(boardDay('2026-11-06T05:00:00+08:00'), '2026-11-06');
  assert.equal(boardDay('2026-11-05T18:00:00Z'), '2026-11-05'); // 2 am in Taipei
});

test('a test with its target in the ask is refused', () => {
  const files = new Map([['test-log.tsv', 'date\ttarget\tkind\tresult\tnote\n']]);
  const it = { label: 'At the shop', kind: 'new', target: '麻煩', ask: 'Ask the clerk, 麻煩 her', model: 'x', check: 'y' };
  assert.match(testProblems(files, { items: [it] }).join(), /target 麻煩 is in the prompt/);
  assert.deepEqual(testProblems(files, { items: [{ ...it, ask: 'Ask the clerk politely for a bag.' }] }), []);
});

test('essay marks land where the board finds them, and go on his list', () => {
  const essays = { d070: { day: 70, date: '2026-11-21', text: '我們回家我就睡午覺了。我去了在公園。' } };
  const p = plan('DAY 70\nfix! | 我們回家我就 | 我們一回家我就 | 一…就\ngood | 睡午覺\nfix | 去了在公園 | 去了公園', essays, {}, {}, '2026-11-22');
  assert.deepEqual(p.errs, []);
  const review = p.writes.find((w) => w.col === 'reviews')!.data as { marks: { mine: string }[] };
  assert.equal(anchor(essays.d070.text, review.marks as never).length, 3);
  assert.equal(p.writes.filter((w) => w.col === 'improve').length, 1);
  assert.match(plan('DAY 70\nfix | 不在這裡 | x', essays, {}, {}, '2026-11-22').errs.join(), /not in the essay/);
});

test('the essay day turns over at 4 am where he is', () => {
  assert.equal(essayToday([{ tz: 480, edited: 'x' }], T('2026-11-22T19:00:00Z')), '2026-11-22'); // 3 am on the 23rd
  assert.equal(essayToday([{ tz: 480, edited: 'x' }], T('2026-11-22T21:00:00Z')), '2026-11-23');
});
