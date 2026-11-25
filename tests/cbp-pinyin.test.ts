// Plus's pinyin as code (site/src/cbp/pinyin.ts) on the lexicon the build writes (site/public/plus/pinyin.txt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLex, sentence, unsure } from '../site/src/cbp/pinyin.ts';

const lex = parseLex(readFileSync(new URL('../site/public/plus/pinyin.txt', import.meta.url), 'utf8'));

test('Taiwan readings, 不 and 一 with their changed tones', () => {
  assert.equal(sentence(lex, '我們明天搭火車。'), 'Wǒmen míngtiān dā huǒchē.');
  assert.equal(sentence(lex, '不是，他一個人去了。'), 'Búshì, tā yíge rén qù le.');
  assert.equal(sentence(lex, '- 誰把垃圾丟在地上？'), '- Shéi bǎ lèsè diū zài dìshang?');
  assert.equal(sentence(lex, '你知道這是什麼東西嗎？'), 'Nǐ zhīdào zhè shì shénme dōngxī ma?');
});
test('一 keeps yī in numbers and at the end of a word', () => {
  assert.match(sentence(lex, '第一次'), /^Dìyīcì$/);
  assert.match(sentence(lex, '統一了。'), /tǒngyī/i);
});
test('characters that read two ways', () => {
  assert.match(sentence(lex, '我得走了。'), /děi/);
  assert.match(sentence(lex, '你還我錢。'), /huán/);
  assert.match(sentence(lex, '他長得很高。'), /zhǎng/);
  assert.equal(unsure(lex, '我們明天搭火車。'), false);
  assert.equal(unsure(lex, '我們數一數。'), true);
});
