import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFS, KEYS, RETIRED, clash, free } from '../site/src/cbp/kit/keys.ts';
import { hit, marked, words } from '../site/src/cbp/kit/find.ts';

// a keydown, as the handlers see it
const key = (k: string, o: Partial<KeyboardEvent> & { target?: unknown } = {}) =>
  ({ key: k, code: '', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false, repeat: false, defaultPrevented: false, target: null, ...o }) as unknown as KeyboardEvent;
const field = { closest: (s: string) => (s.includes('textarea') ? {} : null) };
const page = { closest: () => null };

test('page keys: Shift and the first letter, the Tutor Shift+A', () => {
  const want: Record<string, string> = { 'page.today': 'T', 'page.reviews': 'R', 'page.browse': 'B', 'page.cards': 'C', 'page.essays': 'E', 'page.progress': 'P', 'page.tutor': 'A' };
  for (const [id, k] of Object.entries(want)) {
    assert.ok(KEYS.is(key(k, { shiftKey: true }), id), id);
    // the bare letter is no longer a page key (Reviews' P, a test's A–D keep theirs)
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
  assert.deepEqual(KEYS.keys('page.today'), ['shift+t']);
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
