import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceLines } from '../site/src/cbp/cards.ts';

test('a note’s sentence, as the lines its audio reads', () => {
  assert.equal(voiceLines('這是我最喜歡的早餐店<u>之一</u>'), '這是我最喜歡的早餐店之一');
  assert.equal(voiceLines('- 你哥現在在做什麼？<br>- 他去國外<u>發展</u>了。'), '你哥現在在做什麼？\n他去國外發展了。');
  assert.equal(voiceLines('<div><b>好</b>&nbsp;吃</div><div><br></div>'), '好 吃');
  assert.equal(voiceLines('<img src="/api/plus/media/x.png">'), '');
});
