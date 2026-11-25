import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as MD from '../site/src/cbp/md.ts';
import { weekdayProblems } from '../site/src/cbp/jobs.ts';

const md = `## 3 · Where he is
### Watch list
- Until a time is V + 到: 聊了到十點 → 聊到十點 (10-18).
- 以後 = from now on: 所以我以後 → 所以後來 (10-27).

**Taiwan usage.** 好的 → 好啊.

**Typing slips** (essays only): 臉/練, 在/再. A mnemonic fix, not grammar.

### What he knows
x
## 4 · Log
- **Essay review: DAY 1–68, last run 2026-11-20.**
- 2026-11-01 · a line
`;

test('Watch list: a miss joins its line, a new pattern goes before the paragraphs', () => {
  let m = MD.watch(md, 'Until a time is V + 到', '睡了到中午 → 睡到中午 (11-24)');
  assert.match(m, /聊到十點 \(10-18\); 睡了到中午 → 睡到中午 \(11-24\)\./);
  m = MD.watch(m, '', 'Since: 從…以來 (11-24)');
  assert.match(m, /所以後來 \(10-27\)\.\n- Since: 從…以來 \(11-24\)\.\n\n\*\*Taiwan/);
});

test('typing slips, marker, log line, sections', () => {
  let m = MD.typingSlips(md, ['在/再', '晚/玩']);
  assert.match(m, /臉\/練, 在\/再, 晚\/玩\. A mnemonic/);
  m = MD.marker(m, 71, '2026-11-29');
  assert.match(m, /DAY 1–71, last run 2026-11-29\.\*\*/);
  m = MD.logLine(m, '- 2026-11-29 · week');
  assert.ok(m.endsWith('- 2026-11-29 · week\n'));
  assert.equal(MD.section(m, 'What he knows')!.body, 'x\n');
  const h = MD.appendUnder('# h\n\n## Runs\n- a\n\n## Other\n- b\n', 'Runs', '- c');
  assert.equal(h, '# h\n\n## Runs\n- a\n- c\n\n## Other\n- b\n');
});

test('weekdays next to dates are checked against the calendar', () => {
  assert.deepEqual(weekdayProblems('12月5日（六）見', '2026-12-02'), []);
  assert.equal(weekdayProblems('12/6 星期六', '2026-12-02').length, 1);
  assert.deepEqual(weekdayProblems('1月2日（六）', '2026-12-02'), []);
});
