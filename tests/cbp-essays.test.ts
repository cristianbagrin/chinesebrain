import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, planJson, fixCards, patterns, anchor, occurrences, oneLine, sentenceAt, changed, focusOn, cardId } from '../site/src/cbp/essays.ts';
import { parseLex } from '../site/src/cbp/pinyin.ts';
import { words, reading, parseGloss } from '../site/src/cbp/look.ts';

const TEXT = '今天我們回家我就睡午覺了。裡面的一個女生跟我開始說話，我覺得蠻爽的。我們做了一個 project。';

test('a good answer passes as it is, in essay order, landing where the board looks', () => {
  const { marks, dropped } = validate(TEXT, [
    { t: 'fix', mine: '裡面的一個女生跟我開始說話', nat: '裡面一個女生開始跟我說話', why: '跟我 goes right before the verb.', pattern: '跟 + person before the verb', list: true },
    { t: 'fix', mine: '我們回家我就睡午覺了', nat: '我們一回家我就睡午覺了', why: '一…就 = as soon as.', pattern: '一…就: as soon as' },
    { t: 'good', mine: '覺得蠻爽的' },
    { t: 'word', mine: 'project', nat: '專題', why: 'A school project.' },
  ]);
  assert.deepEqual(dropped, []);
  assert.deepEqual(marks.map((m) => m.t), ['fix', 'fix', 'good', 'word']);
  assert.deepEqual(anchor(TEXT, marks).map((m) => m.i), marks.map((m) => m.i));
  assert.equal(marks[1].list, true);
  assert.equal(marks[0].note, '一…就 = as soon as.');
});

test('no empty marks, no missing why, no white box: what cannot be repaired drops', () => {
  const { marks, dropped } = validate(TEXT, [
    { t: 'fix', mine: '', nat: '一回家' , why: 'x' },
    { t: 'fix', mine: '我們回家', nat: '', why: 'x' },
    { t: 'fix', mine: '我們回家', nat: '我們回家', why: 'same' },
    { t: 'fix', mine: '睡午覺', nat: '睡個午覺' },
    { t: 'better', mine: '不在這篇文章裡', nat: '別的', why: 'nowhere' },
    { t: 'note', mine: '我們回家', nat: '我們一回家', why: 'not a kind' },
    'junk',
    null,
  ]);
  assert.equal(marks.length, 0);
  assert.equal(dropped.length, 6);
});

test('a missing why is filled from the pattern (fix) or the English (word)', () => {
  const { marks } = validate(TEXT, [
    { t: 'fix', mine: '我們回家', nat: '我們一回家', pattern: '一…就: as soon as' },
    { t: 'word', mine: 'project', nat: '專題' },
  ]);
  assert.equal(marks[0].note, '一…就: as soon as');
  assert.equal(marks[1].note, 'The Chinese for “project”.');
});

test('his words are found with the punctuation width, quotes or spaces off', () => {
  const t = '他說：好，我們走吧。我跟 Nina 見了面。';
  const { marks } = validate(t, [
    { t: 'fix', mine: '「好,我們走吧」', nat: '好，我們走啊', why: 'x y' },
    { t: 'better', mine: '跟Nina見了面', nat: '和 Nina 見面', why: 'shorter' },
  ]);
  assert.equal(marks.length, 2);
  assert.equal(marks[0].mine, '好，我們走吧');
  assert.equal(marks[1].mine, '跟 Nina 見了面');
  assert.deepEqual(occurrences(t, '好,我們'), [[3, 7]]);
});

test('overlaps drop; out-of-order marks are sorted; markup and line breaks are cleaned', () => {
  const { marks, dropped } = validate(TEXT, [
    { t: 'fix', mine: '女生跟我開始說話', nat: '女生開始跟我說話', why: '**跟我** before the verb\nalways' },
    { t: 'fix', mine: '跟我開始', nat: '開始跟我', why: 'dup' },
    { t: 'fix', mine: '我們回家', nat: '我們一回家', why: 'one' },
  ]);
  assert.deepEqual(marks.map((m) => m.mine), ['我們回家', '女生跟我開始說話']);
  assert.equal(marks[1].note, '跟我 before the verb always');
  assert.equal(dropped.length, 1);
});

test('a short mark that the board would find earlier takes more of his words (both sides alike)', () => {
  const t = '我很累。我想睡。他也很累。';
  // the marker means the second 很累; the board would find the first one
  const { marks } = validate(t, [{ t: 'fix', mine: '我想睡', nat: '我想睡覺', why: 'a' }, { t: 'better', mine: '很累', nat: '好累', why: 'b' }]);
  // sorted, 很累 (the first place free) lands first and nothing has to move
  assert.deepEqual(anchor(t, marks).map((m) => m.i), marks.map((m) => m.i));
  const t2 = '好的。好的，我去。';
  const v = validate(t2, [{ t: 'good', mine: '好的' }, { t: 'fix', mine: '好的', nat: '好啊', why: 'softer' }]);
  assert.deepEqual(anchor(t2, v.marks).map((m) => m.i), v.marks.map((m) => m.i));
});

test('at most two marks a day go on the list; good and word marks never do', () => {
  const { marks } = validate(TEXT, [
    { t: 'fix!', mine: '我們回家', nat: '我們一回家', why: 'a' },
    { t: 'better', mine: '裡面的', nat: '裡面', why: 'b', list: true },
    { t: 'fix', mine: '跟我開始說話', nat: '開始跟我說話', why: 'c', list: true },
    { t: 'word', mine: 'project', nat: '專題', why: 'd', list: true },
  ]);
  assert.deepEqual(marks.map((m) => !!m.list), [true, true, false, false]);
});

test('oneLine keeps the first sentence of a long why', () => {
  assert.equal(oneLine('Use 一…就 here. ' + 'x'.repeat(200)), 'Use 一…就 here.');
  assert.ok(oneLine('y '.repeat(200)).length <= 160);
});

test('planJson: the review, list items, and uses that retire an item on its third essay', () => {
  const e = { day: 12, date: '2026-11-20', text: TEXT };
  const { marks } = validate(TEXT, [{ t: 'fix', mine: '我們回家', nat: '我們一回家', why: 'a', pattern: '一…就', list: true }]);
  const improve = {
    'c005-1': { mine: '跟我開始', nat: '開始跟我', day: 5, done: false, uses: [{ day: 8, s: 'x' }, { day: 10, s: 'y' }] },
    'c006-1': { mine: 'a', nat: 'b', day: 6, done: false },
    'c013-1': { mine: 'a', nat: 'b', day: 13, done: false },
  };
  const w = planJson(e, marks, [{ id: 'c005-1', s: '我開始說話', ok: true }, { id: 'c006-1', s: '覺得', ok: false }, { id: 'c013-1', s: '覺得', ok: true }, { id: 'nope', s: '覺得', ok: true }], {}, improve, '2026-11-21');
  const rv = w.find((x) => x.col === 'reviews')!;
  assert.deepEqual(rv.data.marks, [{ t: 'fix', mine: '我們回家', nat: '我們一回家', note: 'a', p: '一…就' }]);
  const added = w.find((x) => x.col === 'improve' && x.op === 'set')!;
  assert.equal(added.id, 'c012-1');
  const ret = w.find((x) => x.id === 'c005-1')!;
  assert.equal(ret.data.done, true);
  assert.equal(ret.data.retired, true);
  assert.equal((ret.data.uses as unknown[]).length, 3);
  assert.deepEqual(w.find((x) => x.id === 'c006-1')!.data, { tried: [12] });
  assert.equal(w.some((x) => x.id === 'c013-1' || x.id === 'nope'), false);
});

test('a pattern marked again makes a fix card: his sentence, corrected, the new words as the blank', () => {
  const reviews = { d003: { day: 3, marks: [{ t: 'fix', mine: '回家我就', nat: '一回家我就', p: '一…就: as soon as' }] } };
  assert.deepEqual(patterns(reviews, 12), ['一…就: as soon as']);
  const { marks } = validate(TEXT, [{ t: 'fix', mine: '我們回家我就睡午覺了', nat: '我們一回家我就睡午覺了', why: '一…就 = as soon as.', pattern: '一…就 : as soon as' }]);
  const cards = fixCards(TEXT, 12, marks, reviews);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sentence, '今天我們一回家我就睡午覺了。');
  assert.equal(cards[0].word, '一');
  assert.equal(fixCards(TEXT, 12, marks, {}).length, 0);
  assert.deepEqual(changed('我們回家', '我們一回家'), ['一']);
  assert.deepEqual(sentenceAt(TEXT, 14, 16), [13, 34]);
  assert.equal(cardId('一'), 'w4e00');
});

test('the focus item is the one his sheet showed that day', () => {
  const imp = { a: { seen: ['2026-11-19'] }, b: { seen: ['2026-11-20'], mine: 'x', nat: 'y' }, c: { seen: ['2026-11-20'], done: true } };
  assert.equal(focusOn(imp, '2026-11-20')?.id, 'b');
  assert.equal(focusOn(imp, '2026-11-21'), null);
});

test('a tapped word: its Taiwan pinyin and dictionary meaning, by code', () => {
  const lex = parseLex(readFileSync('site/public/plus/pinyin.txt', 'utf8'));
  const gl = parseGloss(readFileSync('site/public/plus/gloss.txt', 'utf8'));
  const ws = words(lex, gl, '我們一回家就睡午覺');
  const nap = ws.find((x) => x.w === '睡午覺')!;
  assert.equal(nap.py, 'shuìwǔjiào');
  assert.match(nap.g, /nap/);
  assert.equal(reading(lex, gl, '專題').py, 'zhuāntí');
});
