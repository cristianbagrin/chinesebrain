import { test } from 'node:test';
import assert from 'node:assert/strict';
import { of, needsPinyin } from '../site/src/cbp/kit/known.ts';

// the card kit as the nightly writes it (engine.ts kit): K words space-separated, single known characters run together
const KIT = { known: '我 你 他 喜歡 朋友 上班 書', chars: '我你他書' };

test('a known word gets no pinyin; a new one does', () => {
  const s = of(KIT);
  assert.equal(needsPinyin('喜歡', s), false);
  assert.equal(needsPinyin('朋友', s), false);
  assert.equal(needsPinyin('浪費', s), true);
});

test('a single known character counts as known, even alone in a correction', () => {
  const s = of(KIT);
  assert.equal(needsPinyin('他', s), false);
  assert.equal(needsPinyin('書', s), false);
  assert.equal(needsPinyin('她', s), true);
});

test('a word made of known characters is still new until the word itself is known', () => {
  assert.equal(needsPinyin('我們', of(KIT)), true);
});

test('nothing Chinese, nothing to read; spaces around a word do not matter', () => {
  const s = of(KIT);
  assert.equal(needsPinyin('project', s), false);
  assert.equal(needsPinyin('', s), false);
  assert.equal(needsPinyin(' 喜歡 ', s), false);
});

test('before the kit has loaded every word gets its pinyin', () => {
  const s = of(null);
  assert.equal(needsPinyin('喜歡', s), true);
  assert.equal(needsPinyin('他', s), true);
});

test('the set is built once per kit', () => {
  assert.equal(of(KIT), of(KIT));
});
