import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFS, KEYS, RETIRED, clash, free } from '../site/src/cbp/kit/keys.ts';
import { hit, marked, words } from '../site/src/cbp/kit/find.ts';
import { swipe } from '../site/src/cbp/kit/swipe.ts';

// a keydown, as the handlers see it
const key = (k: string, o: Record<string, unknown> = {}) =>
  ({ key: k, code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, target: null, ...o }) as unknown as KeyboardEvent;
const field = { closest: (s: string) => (s.includes('textarea') ? {} : null) };
const page = { closest: () => null };

test("bare letters are no page keys (Reviews' P, a test's A–D keep theirs)", () => {
  const want: Record<string, string> = { 'page.today': 'T', 'page.reviews': 'R', 'page.browse': 'B', 'page.cards': 'C', 'page.essays': 'E', 'page.progress': 'P', 'page.tutor': 'A' };
  for (const [id, k] of Object.entries(want)) {
    assert.ok(!KEYS.is(key(k.toLowerCase()), id), id + ' bare');
  }
  assert.ok(KEYS.is(key('p'), 'rv.pinyin'));
  assert.ok(KEYS.is(key('a'), 'test.a'));
  assert.ok(!KEYS.is(key('A', { shiftKey: true }), 'test.a'));
});

test('no two keys that listen together share a combo', () => {
  for (const a of DEFS)
    for (const b of DEFS) {
      if (a.id >= b.id || !clash(a, b)) continue;
      const shared = a.keys.filter((k) => b.keys.includes(k));
      assert.deepEqual(shared, [], `${a.id} and ${b.id}`);
    }
});

test('the page keys step aside while he types, and over a dialog other than Settings', () => {
  const T = (o = {}) => key('T', { shiftKey: true, target: page, ...o });
  assert.equal(free(T(), []), true);
  assert.equal(free(T({ target: field }), []), false);
  assert.equal(free(T(), ['settings']), true);
  assert.equal(free(T(), ['']), false);
  assert.equal(free(T({ defaultPrevented: true }), []), false);
  assert.equal(free(T({ isComposing: true }), []), false);
  assert.equal(free(T({ repeat: true }), []), false);
});

test('keys saved for the retired bare-letter ids are dropped; others kept', () => {
  let saved: Record<string, string> | null = null;
  KEYS.load({ 'go.today': 'q', tutor: 'u', 'rv.play': 'w' }, (k) => (saved = k));
  for (const id of RETIRED) assert.ok(!KEYS.changed(id), id);
  assert.deepEqual(KEYS.keys('rv.play'), ['w']);
  assert.deepEqual(KEYS.keys('page.today'), ['shift+1']);
  KEYS.bind('page.cards', 'shift+k');
  assert.deepEqual(saved, { 'rv.play': 'w', 'page.cards': 'shift+k' });
  KEYS.reset();
});

test('settings search: every word, any order, any case', () => {
  assert.deepEqual(words('  Card  card AUDIO '), ['card', 'audio']);
  assert.ok(hit(words(''), 'anything'));
  assert.ok(hit(words('audio card'), 'Card audio plays by itself'));
  assert.ok(hit(words('reviews play'), 'Reviews', 'Play'));
  assert.ok(!hit(words('card video'), 'Card audio plays by itself'));
});

test('settings search: the words found are marked, the rest escaped', () => {
  assert.equal(marked('Card audio', words('au')), 'Card <mark>au</mark>dio');
  assert.equal(marked('Pinyin', words('pin yin')), '<mark>Pinyin</mark>');
  assert.equal(marked('a <b> a', words('a')), '<mark>a</mark> &lt;b&gt; <mark>a</mark>');
  assert.equal(marked('Sound', []), 'Sound');
});

test('page keys: Shift and the tab number, by where the key sits (Shift+1 types "!")', () => {
  const want: Record<string, number> = { 'page.today': 1, 'page.reviews': 2, 'page.cards': 3, 'page.essays': 4, 'page.progress': 5, 'page.tutor': 6 };
  const US = '!@#$%^';
  for (const [id, n] of Object.entries(want)) {
    assert.ok(KEYS.is(key(US[n - 1], { code: 'Digit' + n, shiftKey: true }), id), id + ' US');
    // a French keyboard: Shift gives the digit itself
    assert.ok(KEYS.is(key(String(n), { code: 'Digit' + n, shiftKey: true }), id), id + ' FR');
    assert.ok(!KEYS.is(key(String(n), { code: 'Digit' + n }), id), id + ' bare');
    assert.equal(KEYS.label(id).replace('Shift+', '⇧'), '⇧' + n);
  }
  assert.ok(KEYS.is(key('B', { code: 'KeyB', shiftKey: true }), 'page.browse'));
  // Reviews' bare digits keep theirs; Shift+1 isn't Again
  assert.ok(KEYS.is(key('1', { code: 'Digit1' }), 'rv.again'));
  assert.ok(!KEYS.is(key('!', { code: 'Digit1', shiftKey: true }), 'rv.again'));
  assert.ok(!KEYS.is(key('T', { code: 'KeyT', shiftKey: true }), 'page.today'));
});

test('saved page keys equal to the old Shift+letter defaults are dropped; his own kept', () => {
  KEYS.load({ 'page.today': 'shift+t', 'page.tutor': 'shift+a', 'page.cards': 'shift+k' }, () => {});
  assert.deepEqual(KEYS.keys('page.today'), ['shift+1']);
  assert.deepEqual(KEYS.keys('page.tutor'), ['shift+6']);
  assert.deepEqual(KEYS.keys('page.cards'), ['shift+k']);
  KEYS.reset();
});

test('trackpad swipe: one step a gesture, past the threshold, sideways only', () => {
  const s = swipe({ need: 90, quiet: 220 });
  // fingers right: back, once, however long the momentum runs
  let t = 0, got: number[] = [];
  for (let i = 0; i < 40; i++) got.push(s.feed(-12, 1, (t += 16)).d);
  assert.deepEqual(got.filter(Boolean), [-1]);
  // a pause ends the gesture; fingers left: forward
  t += 300;
  got = [];
  for (let i = 0; i < 20; i++) got.push(s.feed(10, 0, (t += 16)).d);
  assert.deepEqual(got.filter(Boolean), [1]);
  // a short nudge doesn't step, and lets the page scroll
  t += 300;
  assert.deepEqual([1, 2, 3].map(() => s.feed(-20, 0, (t += 16)).d), [0, 0, 0]);
  // a scroll that drifts sideways later is still a scroll
  t += 300;
  const up = [s.feed(0, 30, (t += 16)), ...Array.from({ length: 20 }, () => s.feed(-30, 2, (t += 16)))];
  assert.ok(up.every((f) => f.d === 0 && !f.mine));
  // diagonal (no clear sideways lead) never counts
  t += 300;
  assert.ok(Array.from({ length: 20 }, () => s.feed(-20, 18, (t += 16))).every((f) => f.d === 0));
  // a gesture that starts over something that scrolls sideways is its own
  t += 300;
  assert.ok(Array.from({ length: 20 }, () => s.feed(-30, 0, (t += 16), true)).every((f) => f.d === 0 && !f.mine));
});
