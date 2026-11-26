import { test } from 'node:test';
import assert from 'node:assert/strict';
import { write, toggleRange, BIT, type Piece } from '../site/src/cbp/kit/editor.ts';

const chars = (t: string, f = 0, s = ''): Piece[] => [...t].map((c) => ({ c, f, s }));

test('plain text stays plain; markup and spaces are escaped', () => {
  assert.equal(write(chars('a<b>&c')), 'a&lt;b&gt;&amp;c');
  assert.equal(write(chars('a b')), 'a b');
});

test('spaces stay breakable between words; only the ones HTML would swallow become &nbsp;', () => {
  assert.equal(write(chars('Used when talking')), 'Used when talking');
  assert.equal(write(chars(' a  b ')), '&nbsp;a &nbsp;b&nbsp;');
  assert.equal(write([...chars('a '), { br: 1 }, ...chars(' b')]), 'a&nbsp;<br>&nbsp;b');
  // a non-breaking space read back from the field is a space like any other
  assert.equal(write(chars('a\u00a0b')), 'a b');
});

test('styles nest the same way every time: b > i > u > mark', () => {
  assert.equal(write(chars('字', BIT.b | BIT.i | BIT.ul | BIT.hl)), '<b><i><u><mark>字</mark></u></i></b>');
  assert.equal(write(chars('字', BIT.hl)), '<mark>字</mark>');
});

test('runs of one style are joined; line breaks and pictures keep their place', () => {
  const out: Piece[] = [...chars('我', BIT.b), ...chars('們', BIT.b), { br: 1 }, { img: { src: '/api/plus/media/a.png', from: 'https://x.org/"a"' } }, ...chars('好')];
  assert.equal(write(out), '<b>我們</b><br><img src="/api/plus/media/a.png" data-from="https://x.org/&quot;a&quot;">好');
});

test('a color from a pasted page is kept on its run', () => {
  assert.equal(write(chars('紅', 0, 'color:red')), '<span style="color:red">紅</span>');
});

test('a style goes on over the selection, and off when all of it already has it', () => {
  const on = toggleRange(chars('我喜歡你'), 1, 3, 'hl');
  assert.equal(write(on), '我<mark>喜歡</mark>你');
  const off = toggleRange(on, 1, 3, 'hl');
  assert.equal(write(off), '我喜歡你');
  // partly marked: it goes on for all of it
  assert.equal(write(toggleRange(on, 0, 3, 'hl')), '<mark>我喜歡</mark>你');
});

test('spaces don’t stop a style coming off, and a selection backwards works the same', () => {
  const t = [...chars('a', BIT.b), ...chars(' '), ...chars('b', BIT.b)];
  assert.equal(write(toggleRange(t, 3, 0, 'b')), 'a b');
});

test('other styles survive a toggle', () => {
  const t = chars('字字', BIT.i);
  assert.equal(write(toggleRange(t, 0, 1, 'b')), '<b><i>字</i></b><i>字</i>');
});
