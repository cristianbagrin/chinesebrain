import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rank, missing, pairPrompt, STALE, type Cand } from '../site/src/cbp/review/partners.ts';
import { prompt, parse } from '../site/src/cbp/combine.ts';
import { nextRow, wordRows, rowText } from '../site/src/cbp/review/filter.ts';

const C = (nid: number, word: string, easy = 0): Cand => ({ nid, word, easy });
const POOL = [C(1, '點菜', 0), C(2, '菜單', 1), C(3, '服務生', 0), C(4, '青菜', 3), C(5, '應該', 2), C(6, '菜單', 3), C(7, '點心', 2)];

test("Claude's partners: his words only, in Claude's order, one note per word, none skipped", () => {
  const ai = [
    { w: '服務生', why: 'ordering at a restaurant' },
    { w: '菜單', why: 'reading the menu' },
    { w: '火車', why: 'not his word' },
    { w: '服務生', why: 'twice' },
    { w: '點菜', why: 'itself' },
  ];
  const r = rank('點菜', ai, POOL, new Set());
  assert.deepEqual(r.map((x) => x.word), ['服務生', '菜單']); // not his word, a repeat and the word itself are left out
  assert.equal(r[1].nid, 6); // of two notes of 菜單, the easier one
  assert.equal(r[0].why, 'ordering at a restaurant');
  assert.ok(r.every((x) => x.by === 'ai'));
  // a pair turned down, or already on its way, is skipped
  assert.deepEqual(rank('點菜', ai, POOL, new Set([3])).map((x) => x.word), ['菜單']);
  // Claude found none that fits: none, never code's guess in its place
  assert.deepEqual(rank('點菜', [], POOL, new Set()), []);
});

test('without Claude: code ranks his words sharing a character, easiest first', () => {
  const r = rank('點菜', null, POOL, new Set());
  assert.deepEqual(r.map((x) => [x.word, x.by]), [['青菜', 'code'], ['菜單', 'code'], ['點心', 'code']]); // 應該 shares nothing; 服務生 neither
  assert.ok(!rank('點菜', null, POOL, new Set()).some((x) => x.word === '點菜'));
  assert.deepEqual(rank('點菜', null, [C(9, '菜刀', 0)], new Set()), []); // not easy at all: no partner
  assert.equal(rank('點菜', null, POOL, new Set(), 1).length, 1);
});

test('only words with no list, or a stale one, are asked about', () => {
  const now = Date.now();
  const kept = { 點菜: { at: now - 864e5, list: [] }, 應該: { at: now - STALE - 1, list: [] } };
  assert.deepEqual(missing(['點菜', '應該', '青菜', '青菜'], kept, now), ['應該', '青菜']);
});

test("the pair card's prompt: two sentences, each with both words, both marked", () => {
  const p = pairPrompt('點菜', '服務生', 'ordering at a restaurant');
  assert.match(p, /word: 點菜、服務生 \(exactly this\)/);
  assert.match(p, /ex: exactly two, and EACH one uses BOTH 點菜 and 服務生/);
  assert.match(p, /\*\*bold\*\* 點菜 and 服務生/);
  assert.match(p, /ordering at a restaurant/);
  assert.doesNotMatch(p, /only .* fits/); // not the old "one sentence per word"
  assert.match(p, /no second: line/);
});

test("the partner prompt and Claude's answer, kept to what can be used", () => {
  const p = prompt(['點菜'], ['點菜', '服務生', '菜單']);
  assert.match(p, /TARGETS: 點菜/);
  assert.match(p, /HIS WORDS: 點菜 服務生 菜單/);
  assert.match(p, /Sharing a character is not a reason/);
  const out = parse('Here: {"點菜": [["服務生", "at a restaurant"], ["火車", "x"], ["點菜", "self"], {"w": "菜單", "why": "the menu"}], "別的": [["菜單", "y"]]}', ['點菜', '應該'], ['點菜', '服務生', '菜單']);
  assert.deepEqual(out, { 點菜: [{ w: '服務生', why: 'at a restaurant' }, { w: '菜單', why: 'the menu' }], 應該: [] });
  assert.throws(() => parse('no json', ['點菜'], ['點菜']));
});

test('Browse by keyboard: ↑ ↓ through the rows shown, held at the ends', () => {
  const ids = [10, 20, 30];
  assert.equal(nextRow(ids, 0, 1), 10); // nothing open: ↓ opens the top row
  assert.equal(nextRow(ids, 0, -1), 30); // ↑ the last
  assert.equal(nextRow(ids, 10, 1), 20);
  assert.equal(nextRow(ids, 20, -1), 10);
  assert.equal(nextRow(ids, 30, 1), 30); // the end holds
  assert.equal(nextRow(ids, 10, -1), 10);
  assert.equal(nextRow(ids, 99, 1), 10); // the open row filtered away: from the top
  assert.equal(nextRow([], 10, 1), null);
});

test("a word's panel: one row per card, its notes oldest first, each row its sentence on one line", () => {
  const cards = [
    { id: 1, nid: 200, ord: 1 },
    { id: 2, nid: 100, ord: 2 },
    { id: 3, nid: 100, ord: 0 },
    { id: 4, nid: 200, ord: 0 },
    { id: 5, nid: 300, ord: 0 },
  ];
  assert.deepEqual(wordRows([200, 100], cards).map((c) => c.id), [3, 2, 4, 1]);
  assert.equal(rowText('- 我們<mark>進行</mark>吧<br>- 好啊', '進行'), '- 我們進行吧 - 好啊');
  assert.equal(rowText('', '進行'), '進行');
  assert.equal(rowText('<img src="/x.png">', '進行'), '進行');
});
