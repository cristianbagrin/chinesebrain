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

import * as E from '../site/src/cbp/engine.ts';
test('a word counts its situations: one per test day, essay day, tutor chat day; three make it known', () => {
  const log = 'date\ttarget\tkind\tresult\tnote\n';
  const files: E.Files = new Map([[E.LOG, log], [E.KW, '順路\tL\t2026-11-20\n']]);
  E.logRows(files, [{ date: '2026-11-21', target: '順路', kind: 'old', result: 'pass', note: 'a' }, { date: '2026-11-21', target: '順路', kind: 'listen', result: 'pass', note: 'b' }]);
  assert.equal(E.situations(E.readLog(files), '順路', '2026-11-20').length, 1);
  E.logRows(files, [{ date: '2026-11-22', target: '順路', kind: 'essay', result: 'pass', note: 'DAY 70' }]);
  assert.match(files.get(E.KW)!, /順路\tL/);
  const r = E.logRows(files, [{ date: '2026-11-23', target: '順路', kind: 'free', result: 'pass', note: 'tutor 2026: …' }]);
  assert.match(r, /L→K/);
  assert.match(files.get(E.KW)!, /順路\tK\t2026-11-23/);
});

test('a TOCFL item needs four different choices and a key', () => {
  const files: E.Files = new Map([[E.LOG, 'date\ttarget\tkind\tresult\tnote\n']]);
  const it = { label: 'x', kind: 'tocfl', target: 'TOCFL reading', ask: '請選出最適合的詞', read: '他很有（　）', model: '經驗', check: 'c' };
  assert.equal(E.testProblems(files, { items: [{ ...it, choices: ['經過', '經常', '經驗', '工作'], key: 2 }] }).length, 0);
  assert.equal(E.testProblems(files, { items: [{ ...it, choices: ['經過', '經過', '經驗', '工作'], key: 4 }] }).length, 2);
});

// ---------- the server jobs' fixes (Nov 27 audit) ----------
import { mondayOf, weeklyDrops, addMeasure, thisMonthOk, watchListBody } from '../site/src/cbp/jobs.ts';

test('a weekday is read only after （ ( 星期 週 禮拜; the year turns back from January', () => {
  assert.deepEqual(weekdayProblems('這個活動在12月12日舉行', '2026-12-01'), []);
  assert.deepEqual(weekdayProblems('12月1日天氣很好', '2026-12-01'), []);
  assert.deepEqual(weekdayProblems('公告：12月5日（六）上午九點', '2026-12-01'), []);
  assert.deepEqual(weekdayProblems('12/5（六）', '2026-12-01'), []);
  assert.deepEqual(weekdayProblems('12月6日 禮拜天', '2026-12-01'), []);
  assert.deepEqual(weekdayProblems('12月6日週日', '2026-12-01'), []);
  assert.equal(weekdayProblems('12月5日(日)', '2026-12-01').length, 1);
  assert.equal(weekdayProblems('12月5日 星期五', '2026-12-01').length, 1);
  // Jan 2027 looking back at Dec 26 2026 (a Saturday), and Dec 2026 looking ahead to Jan 2 2027 (a Saturday)
  assert.deepEqual(weekdayProblems('12月26日（六）', '2027-01-01'), []);
  assert.deepEqual(weekdayProblems('1月2日（六）', '2026-12-01'), []);
});

const wbody = `Smaller or newer patterns. A repeat adds its date to the line.
- A: x → y (10-01).
- B: p → q (11-02).
- C: r → s (09-01).

**Taiwan usage.** 好的 → 好啊.

**Typing slips** (essays only): 臉/練. A mnemonic fix.

`;

test('Watch list: the rules paragraph and the paragraphs after the list stay; only list lines are taken', () => {
  assert.equal(watchListBody(wbody, '- A: x → y (10-01).\n- B: p → q (11-02).'), wbody.replace('- C: r → s (09-01).\n', ''));
  // Opus echoing the paragraphs anyway: they're kept once, from the file
  assert.equal(watchListBody(wbody, 'Smaller or newer patterns. A repeat adds its date to the line.\n- A: x → y (10-01).\n\n**Taiwan usage.** 好的 → 好啊.'), wbody.replace(/- B.*\n- C.*\n/, ''));
  assert.equal(watchListBody(wbody, 'A new rules paragraph\n- A: x'), null);
  assert.equal(watchListBody(wbody, ''), null);
  assert.equal(watchListBody(wbody, '- ' + 'x'.repeat(400)), null);
  assert.equal(watchListBody('no list here\n', '- A'), null);
});

test('the weekly drops new To improve items only when keep names one of them', () => {
  assert.deepEqual(weeklyDrops(['a', 'b', 'c'], ['b']), ['a', 'c']);
  assert.deepEqual(weeklyDrops(['a', 'b', 'c'], []), []);
  assert.deepEqual(weeklyDrops(['a', 'b', 'c'], ['x', 'y']), []);
  assert.deepEqual(weeklyDrops(['a', 'b'], 'a'), []);
  assert.deepEqual(weeklyDrops(['a', 'b', 'c', 'd', 'e', 'f', 'g'], ['x', 'a', 'b', 'c', 'd', 'e', 'f']), ['f', 'g']);
});

test('the weekly runs once a week: the Monday of the week', () => {
  assert.equal(mondayOf('2026-11-30'), '2026-11-30');
  assert.equal(mondayOf('2026-12-02'), '2026-11-30');
  assert.equal(mondayOf('2026-11-29'), '2026-11-23');
});

test('Measurements: one line per month', () => {
  const h = '# History\n\n## Measurements (append-only)\n- 2026-08-14 · listening\n\n## System changes, and why\n- a\n';
  const once = addMeasure(h, '2026-11', '- **2026-11, calendar month** · cards **5**');
  assert.match(once, /listening\n- \*\*2026-11, calendar month\*\* · cards \*\*5\*\*\n\n## System/);
  assert.equal(addMeasure(once, '2026-11', '- **2026-11, calendar month** · cards **6**'), once);
});

test('This month: its heading, and no other heading inside', () => {
  assert.ok(thisMonthOk('### This month · Month 6, Dec 1 – Dec 31: "x"\nread\n1. a'));
  assert.ok(!thisMonthOk('### This month · Month 6\n1. a\n### Level\nA2'));
  assert.ok(!thisMonthOk('### This month · Month 6\n1. a\n## 4 · Log'));
  assert.ok(!thisMonthOk('This month'));
});
