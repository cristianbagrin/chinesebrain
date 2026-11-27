import { test } from 'node:test';
import assert from 'node:assert/strict';
import { same, bare, markKey, stateOf, record, itemFor, credit } from '../site/src/cbp/tries.ts';
import { planJson } from '../site/src/cbp/essays.ts';

test('a try is right when it is the fix, spaces and full- or half-width punctuation aside', () => {
  assert.ok(same('我昨天去了台北。', '我昨天去了台北'));
  assert.ok(same('我 昨天 去了台北', '我昨天去了台北。'));
  assert.ok(same('好，我們走吧！', '好,我們走吧!'));
  assert.ok(same('ＡＢＣ３', 'abc3'));
  assert.ok(!same('我昨天去台北', '我昨天去了台北'));
  assert.ok(!same('', '。'));
  assert.ok(!same('  ', ''));
  assert.equal(bare('「跟 Nina」見面…'), '跟nina見面');
});

test('each mark keeps its own outcome; a reveal never undoes a try', () => {
  const a = { mine: '去台北', nat: '去了台北' }, b = { mine: '很好吃', nat: '好吃' };
  assert.notEqual(markKey(a), markKey(b));
  assert.equal(markKey(a), markKey({ ...a, note: 'x' }));
  let t = record(undefined, a, 'wrong');
  assert.equal(stateOf(t, a), 'wrong');
  assert.equal(stateOf(t, b), undefined);
  t = record(t, a, 'shown');
  assert.equal(stateOf(t, a), 'wrong');
  t = record(t, b, 'shown');
  t = record(t, b, 'right');
  assert.equal(stateOf(t, b), 'right');
  assert.equal(stateOf({ [markKey(a)]: 'junk' }, a), undefined);
});

test('a try feeds its To improve item: right is a use, wrong a miss, three days retire it', () => {
  const items = [
    { id: 'c1', day: 70, mine: '去台北', nat: '去了台北', p: 'Completed action: 了' },
    { id: 'c2', day: 60, mine: '吃', nat: '吃了', p: 'completed action 了' },
    { id: 'c3', day: 70, mine: '很好吃', nat: '好吃', done: true },
  ];
  assert.equal(itemFor(items, { day: 70, mine: '去台北' })?.id, 'c1');
  assert.equal(itemFor(items, { day: 72, mine: '買書', p: 'completed action: 了' })?.id, 'c1');
  assert.equal(itemFor(items, { day: 70, mine: '很好吃' }), undefined);
  assert.deepEqual(credit(items[0], 70, '去了台北', false), { tried: [70] });
  assert.deepEqual(credit({ id: 'x', uses: [{ day: 70, s: 'a' }], tried: [70] }, 70, 'b', true), { uses: [{ day: 70, s: 'b' }], tried: [70] });
  const done = credit({ id: 'x', uses: [{ day: 61, s: 'a' }, { day: 65, s: 'b' }], tried: [61, 65] }, 70, '去了台北', true, 'T');
  assert.equal(done.done, true);
  assert.equal(done.retired, true);
  assert.equal(done.doneAt, 'T');
});

test('the review jobs keep his tries when they rewrite a day', () => {
  const tries = { m1: 'right' };
  const w = planJson({ day: 5, text: '我去台北。' }, [], [], { d005: { day: 5, marks: [], tries } }, {}, '2026-11-27');
  assert.deepEqual(w.find((x) => x.col === 'reviews')?.data.tries, tries);
});
