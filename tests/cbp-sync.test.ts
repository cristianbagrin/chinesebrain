// The daily test's plan (code picks and trims the items) and the two-way sync with the Chinese Brain extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../site/src/cbp/engine.ts';
import { exportText, backPlan, taiForms, pickRecord, newForm } from '../site/src/cbp/brain.ts';
import { saveFiles, cursorMayAdvance } from '../site/src/cbp/nightly.ts';
import { hex } from '../site/src/cbp/plus.ts';

const T = (s: string) => Date.parse(s);
const HEAD = 'date\ttarget\tkind\tresult\tnote\n';
const SPRINT = '# s-sprint.md — x [from 2026-11-01] [until 2026-12-11]\n\n- **Tests**: R words go in a `read` item.\n- Retest cap: 3\n\n## The list\n1. 對於 · duìyú · regarding · R\n2. 情況 · qíngkuàng · situation · S\n';

/** Twelve retests failed on Nov 1 (due Nov 4), three L words carded, three cards since the last test. */
function many(extra = '') {
  let log = HEAD;
  for (let i = 0; i < 12; i++) log += `2026-11-01\t字${String.fromCharCode(0x4e00 + i)}\tnew\tfail\tx\n`;
  log += '2026-11-20\t對於\tcard\t-\t\n2026-11-20\t情況\tcard\t-\t\n2026-11-20\t糖\tcard\t-\t\n2026-11-25\tt1\tsent\t-\t\n2026-11-26\tt1\tgraded\t-\t\n2026-11-26\t離職\tcard\t-\t\n' + extra;
  return new Map([[E.LOG, log], [E.KW, '對於\tL\t2026-11-20\n情況\tL\t2026-11-20\n糖\tL\t2026-11-20\n離職\tL\t2026-11-26\n'], ['s-sprint.md', SPRINT]]);
}

test('L1: the plan leads with the oldest retests, keeps to the retest cap and to the item budget', () => {
  const files = many();
  const slots = E.planItems(files, '2026-11-28');
  assert.ok(slots.length <= E.TEST_ITEMS);
  assert.deepEqual(slots.slice(0, 3).map((s) => s.what), ['retest', 'retest', 'retest']);
  assert.equal(slots.filter((s) => s.what === 'retest').length, E.retestCap(files, '2026-11-28'));
  assert.equal(E.retestCap(files, '2026-11-28'), 3); // the sprint's "Retest cap: 3", as on the board
  assert.equal((E.testPlanText(files, '2026-11-28').match(/ · due 2026-11-04/g) ?? []).length, 3);
  assert.deepEqual(slots.slice(3, 6).map((s) => s.what), ['learning', 'learning', 'learning']);
  assert.deepEqual(slots.slice(6).map((s) => s.what), ['tocfl', 'tocfl', 'tocfl', 'listen']); // the card since the test waits
  // with fewer retests due the card fits after the TOCFL and listening items
  const fewer = many().set(E.LOG, many().get(E.LOG)!.split('\n').filter((l) => !l.includes('\t字') || l.includes('\t字一\t')).join('\n'));
  assert.deepEqual(E.planItems(fewer, '2026-11-28').map((s) => s.what).slice(0, 9), ['retest', 'learning', 'learning', 'learning', 'tocfl', 'tocfl', 'tocfl', 'listen', 'card']);
  const text = E.planText(files, '2026-11-28', slots);
  assert.match(text, /^Exactly 10 item\(s\)/);
  assert.match(text, /9 more retest\(s\) due wait/);
  // a written test that drops a retest is caught
  const items = slots.filter((s) => s.target).map((s) => ({ target: s.target, kind: s.kind, read: s.mode === 'read' ? 'x' : undefined }));
  assert.deepEqual(E.planProblems(slots, { items }), []);
  assert.match(E.planProblems(slots, { items: items.slice(1) }).join(), /字一 \(retest\) is missing/);
  // with no sprint the cap is 3 too
  files.delete('s-sprint.md');
  assert.equal(E.planItems(files, '2026-11-28').filter((s) => s.what === 'retest').length, 3);
});

test('L1: a comeback is the most overdue retests only', () => {
  const slots = E.planItems(many(), '2026-11-28', { short: true });
  assert.deepEqual(slots.map((s) => s.what), ['retest', 'retest', 'retest']);
});

test('L2: a failed listening or TOCFL item opens a retest, read; their passes log but are no situation', () => {
  const files: E.Files = new Map([[E.LOG, HEAD + '2026-11-27\t孝順\tlisten\tfail\tx\n2026-11-27\tTOCFL reading\ttocfl\tfail\tx\n2026-11-27\t浪費\ttocfl\tpass\tx\n'], [E.KW, '浪費\tL\t2026-11-20\n']]);
  const t = E.table(E.readLog(files));
  assert.deepEqual(t.map((x) => [x.name, x.due, x.read]), [['孝順', '2026-11-30', true]]); // not "TOCFL reading"
  assert.equal(E.situations(E.readLog(files), '浪費', '2026-11-20').length, 0);
  const slot = E.planItems(files, '2026-11-30').find((s) => s.target === '孝順')!;
  assert.equal(slot.mode, 'read');
  // retested as a reading item it schedules like any test: a pass moves it to a week out
  E.appendLog(files, [{ date: '2026-11-30', target: '孝順', kind: 'old', result: 'pass', note: 'x' }]);
  assert.equal(E.table(E.readLog(files))[0].due, '2026-12-07');
});

test('L3: during a sprint its R words are planned as reading items, and a spoken one is refused', () => {
  const files = many();
  const slots = E.planItems(files, '2026-11-28');
  const r = slots.find((s) => s.target === '對於')!, s = slots.find((x) => x.target === '情況')!;
  assert.equal(r.mode, 'read');
  assert.equal(s.mode, 'say');
  assert.match(E.planText(files, '2026-11-28', slots), /target 對於 · READ: a `read` item/);
  const items = slots.filter((x) => x.target).map((x) => ({ target: x.target, kind: x.kind, read: x.mode === 'read' ? 'x' : undefined }));
  const spoken = items.map((it) => (it.target === '對於' ? { ...it, read: undefined } : it));
  assert.match(E.planProblems(slots, { items: spoken }).join(), /對於 must be a READ item/);
  // after the sprint the same word is a spoken one
  assert.equal(E.planItems(files, '2026-12-12').find((x) => x.target === '對於')?.mode, 'say');
});

test('E1: a mark that syncs a day late still comes in; Plus\'s own write-back coming back is a no-op', () => {
  const night1 = T('2026-11-24T14:00:00Z'), night2 = T('2026-11-25T14:00:00Z'), mark = T('2026-11-24T07:00:00Z');
  const rec = { w: '營業', s: 'known', updated: mark, added: mark - 1e9, hist: [{ t: mark - 1e9, s: 'learning' }, { t: mark, s: 'known' }], looks: 3, ctx: [] };
  const ex = exportText([{ k: 'w:營業', v: rec }], night1, night2, () => 'L');
  assert.equal(ex.count, 1);
  const files: E.Files = new Map([[E.KW, '營業\tL\t2026-11-01\n']]);
  E.merge(files, [ex.text], '2026-11-25');
  assert.match(files.get(E.KW)!, /營業\tK\t2026-11-24/);
  // Plus wrote K back last night: the record comes back with a newer seq, the same status
  const echo = { ...rec, updated: night2, hist: [...rec.hist, { t: night2, s: 'known' }] };
  assert.equal(exportText([{ k: 'w:營業', v: echo }], night2, night2 + 86_400_000, () => 'K').count, 0);
  // a fresh word met long ago, looked up again: not news
  const looked = { w: '格式', s: 'fresh', updated: night2, added: 1, hist: [{ t: 1, s: 'fresh' }], looks: 2, ctx: [] };
  assert.equal(exportText([{ k: 'w:格式', v: looked }], night1, night2, () => null).count, 0);
});

test('E2: the same day, the later change wins, to the minute, both ways', () => {
  const day = '2026-11-27', since = T('2026-11-26T14:00:00Z'), now = T('2026-11-27T14:00:00Z');
  const am9 = T('2026-11-27T01:00:00Z'), pm2 = T('2026-11-27T06:00:00Z');
  const files: E.Files = new Map([[E.KW, '表示\tL\t2026-11-20\n']]);
  const l = E.loadKw(files);
  l[0] = '表示\tK\t2026-11-27';
  E.kwSave(files, l, pm2); // Plus: K at 2 pm
  assert.equal(E.kwTimes(files)['表示'], pm2);
  const rec = { w: '表示', s: 'learning', updated: am9, added: 1, hist: [{ t: am9, s: 'learning' }], looks: 0, ctx: [] };
  E.merge(files, [exportText([{ k: 'w:表示', v: rec }], since, now, () => 'K').text], day);
  assert.match(files.get(E.KW)!, /表示\tK\t2026-11-27/); // his 9 am L doesn't undo Plus's 2 pm K
  assert.deepEqual(backPlan([['表示', ['K', day]]], { 表示: rec }, E.kwTimes(files)).map((x) => x.status), ['known']); // and K goes back
  // his L at 5 pm is newer: it wins here, and nothing is written back over it
  const pm5 = T('2026-11-27T09:00:00Z'), late = { ...rec, updated: pm5, hist: [{ t: pm5, s: 'learning' }] };
  assert.deepEqual(backPlan([['表示', ['K', day]]], { 表示: late }, E.kwTimes(files)), []);
  E.merge(files, [exportText([{ k: 'w:表示', v: late }], since, now, () => 'K').text], day);
  assert.match(files.get(E.KW)!, /表示\tL\t2026-11-27/);
  // the times are kept 60 days, and a merge doesn't stamp his own marks as Plus's
  assert.equal(E.kwTimes(files)['表示'], pm2);
  E.kwSave(files, [...E.loadKw(files), '新\tL\t2027-02-01'], T('2027-02-01T00:00:00Z'));
  assert.deepEqual(Object.keys(E.kwTimes(files)), ['新']);
});

test('E3: 臺/台: an existing record in either form is found and written to; a new one takes the dictionary\'s form', () => {
  assert.deepEqual(taiForms('台北').sort(), ['台北', '臺北'].sort());
  assert.equal(taiForms('台灣台北').length, 4);
  const ext = { w: '臺北', s: 'learning', added: 5, updated: 5, hist: [{ t: 5, s: 'learning' }] };
  assert.equal(pickRecord('台北', { 台北: null, 臺北: ext }), ext);
  const dup = { ...ext, w: '台北', added: 9 };
  assert.equal(pickRecord('台北', { 台北: dup, 臺北: ext }), ext); // the older one, not a copy
  const p = backPlan([['台北', ['K', '2026-11-27']]], { 台北: null, 臺北: ext }, {});
  assert.equal(p[0].rec?.w, '臺北');
  const dict = new Set(['舞臺', '台北', '臺北']);
  assert.equal(newForm('舞台', (f) => dict.has(f)), '舞臺');
  assert.equal(newForm('台北', (f) => dict.has(f)), '台北'); // a headword of its own (the extension's first lookup)
  assert.equal(newForm('台味', (f) => dict.has(f)), '台味');
  // the extension's 臺 form is compared with Plus's 台 key
  const ex = exportText([{ k: 'w:臺北', v: { ...ext, s: 'known', hist: [{ t: T('2026-11-27T01:00:00Z'), s: 'known' }] } }], 0, T('2026-11-27T14:00:00Z'), (w) => (E.key(w) === '台北' ? 'K' : null));
  assert.equal(ex.count, 0);
});

test('E4: the brain cursor moves only when the merge was written', async () => {
  const stored = new Map([[E.KW, 'a\tK\t2026-11-01\n'], [E.LN, '# q\n']]);
  const shas = new Map<string, string>();
  for (const [n, t] of stored) shas.set(n, await hex(t));
  shas.set(E.KW, await hex('changed by set_known meanwhile'));
  const stmt = { bind: () => stmt, first: async () => null, all: async () => ({ results: [...shas].map(([name, sha]) => ({ name, sha })) }), run: async () => null };
  const env = { CBP: { prepare: () => stmt, batch: async () => [] } } as never;
  const after = new Map(stored);
  after.set(E.KW, 'a\tK\t2026-11-01\nb\tL\t2026-11-28\n');
  after.set(E.LN, '# q2\n');
  const refused: string[] = [], said: string[] = [];
  await saveFiles(env, stored, after, said, refused);
  assert.deepEqual(refused, [E.KW]);
  assert.equal(cursorMayAdvance(refused), false);
  assert.equal(cursorMayAdvance(['board/cardkit']), true);
  assert.equal(cursorMayAdvance(['imported/chinese-brain-2026-11-28.tsv']), false);
});
