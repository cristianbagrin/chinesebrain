import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLines } from '../site/src/cbp/cards.ts';

test('a note’s sentence, as the lines its audio reads', () => {
  assert.equal(voiceLines('這是我最喜歡的早餐店<u>之一</u>'), '這是我最喜歡的早餐店之一');
  assert.equal(voiceLines('- 你哥現在在做什麼？<br>- 他去國外<u>發展</u>了。'), '你哥現在在做什麼？\n他去國外發展了。');
  assert.equal(voiceLines('<div><b>好</b>&nbsp;吃</div><div><br></div>'), '好 吃');
  assert.equal(voiceLines('<img src="/api/plus/media/x.png">'), '');
});

import { markCss, toMark } from '../site/src/cbp/cards.ts';
test('the word’s mark moves from <u> to <mark>, once', () => {
  assert.equal(toMark('對啊，結果<u>卻</u>遲到'), '對啊，結果<mark>卻</mark>遲到');
  const css = markCss('u {\n  color: #2e7d32;\n}\n.sentence-front u {\n  color: transparent !important;\n}\nul li{x:1}');
  assert.match(css, /^mark \{/);
  assert.match(css, /\.sentence-front mark \{/);
  assert.match(css, /ul li\{x:1\}/);
  assert.match(css, /mark \{ background: none; \}/);
  assert.equal(markCss(css), css);
});
