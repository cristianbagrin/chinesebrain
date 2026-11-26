import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, type Card, type Rev } from '../site/src/cbp/sched.ts';
import { index, apply, sortBy, byWord, blank, active, toneless, stateOf, type Filters, type Item } from '../site/src/cbp/review/filter.ts';
import { verdict } from '../site/src/cbp/review/triage.ts';
import type { Note, NoteType } from '../site/src/cbp/review/store.ts';

// 2026-11-22 18:00 in Taipei: day 945 of a collection that starts 2024-04-21 and turns over at 4 am
const NOW = Date.UTC(2026, 10, 22, 10, 0);
const ck = clock('2024-04-21', 4, NOW, 480);
const T = ck.today;
const DAY = 864e5;
const W = [0.5213, 3.0462, 7.8006, 28.3224, 6.4869, 0.633, 3.0256, 0.0263, 1.8053, 0.2824, 0.7502, 1.5588, 0.0452, 0.4014, 1.6774, 0.3768, 2.1176, 0.6212, 0.1627, 0.0876, 0.1929];

const TYPE: NoteType = {
  id: 1, name: 'Chinese', css: '', sortf: 1, kind: 0, mod: 0,
  fields: ['Chinese', 'Word', 'Picture', 'Notes', 'Pinyin', 'Audio'].map((name, ord) => ({ name, ord })),
  templates: [
    { name: 'Word → pic', ord: 0, qfmt: '{{Word}}', afmt: '' },
    { name: 'Pic → word', ord: 1, qfmt: '{{Picture}}', afmt: '' },
  ],
};
let nid = 1000;
const notes = new Map<number, Note>();
function note(word: string, o: { sentence?: string; pinyin?: string; notes?: string; pic?: boolean; audio?: boolean; tags?: string[]; addedDaysAgo?: number } = {}) {
  const id = NOW - (o.addedDaysAgo ?? 100) * DAY + (nid += 10);
  notes.set(id, { id, guid: String(id), mid: 1, mod: 0, tags: o.tags ?? [], flds: [o.sentence ?? `<div>${word}很好</div>`, word, o.pic ? '<img src="/a.jpg">&nbsp;<img src="/b.jpg">' : '', o.notes ?? '', o.pinyin ?? '', o.audio ? '[sound:/x.mp3]' : ''] });
  return id;
}
const rev = (daysAgo: number, g: number, type = 1): Rev => [NOW - daysAgo * DAY, g, 1, 1, 0, 3000, type];
function card(n: number, ord: number, c: Partial<Card>): Card {
  return { id: n + ord, nid: n, did: 1, ord, type: 2, queue: 2, due: T, ivl: 10, reps: 5, lapses: 0, left: 0, flags: 0, mod: 0, revs: [rev(10, 3)], s: 10, d: 5, lrt: (NOW - 10 * DAY) / 1000, ...c };
}

// the collection: each card is an edge case
const n1 = note('浪費', { sentence: '太<u>浪費</u>時間了！', pinyin: 'Tài làngfèi shíjiān le!', notes: 'waste; 氵 WAVE', pic: true, audio: true, addedDaysAgo: 0 });
const n2 = note('表達', { pinyin: 'Wǒ bù zhīdào zěnme biǎodá.', tags: ['leech'], addedDaysAgo: 3 });
const n3 = note('收下', { pinyin: 'qǐng shōuxià', pic: true, addedDaysAgo: 40 });
const n4 = note('心意', { pinyin: 'xīnyì zuì zhòngyào', audio: true });
const n5 = note('綠色', { pinyin: 'lǜsè' });
const C = {
  fresh: card(n1, 0, { type: 0, queue: 0, due: 5, ivl: 0, reps: 0, revs: [], s: undefined, d: undefined, lrt: undefined }),
  learning: card(n1, 1, { type: 1, queue: 1, due: (NOW + 600e3) / 1000, ivl: 0, revs: [rev(0, 3, 0)], s: 2.3, d: 6, lrt: NOW / 1000 }),
  relearning: card(n2, 0, { type: 3, queue: 1, due: (NOW + 600e3) / 1000, ivl: 4, lapses: 9, revs: [rev(30, 3), rev(0, 1)], s: 1.2, d: 9.1, lrt: NOW / 1000 }),
  relearnTomorrow: card(n2, 1, { type: 3, queue: 3, due: T + 1, ivl: 4, lapses: 2, revs: [rev(1, 1)] }),
  overdue: card(n3, 0, { due: T - 3, ivl: 30, s: 31, d: 3.5, flags: 1, revs: [rev(33, 3)], lrt: (NOW - 33 * DAY) / 1000 }),
  today: card(n3, 1, { due: T, ivl: 12, flags: 3 }),
  week: card(n4, 0, { due: T + 6, ivl: 20, s: 20, d: 2 }),
  later: card(n4, 1, { due: T + 7, ivl: 21, s: 22, d: 2 }),
  suspendedDue: card(n5, 0, { queue: -1, due: T - 5, ivl: 40, s: 40, d: 7 }),
  buried: card(n5, 1, { queue: -2, due: T, ivl: 8, s: 8, d: 5 }),
};
const ITEMS = index(Object.values(C), (id) => notes.get(id), () => TYPE, ck, W, { 浪費: 2, 表達: 1, 收下: 0 });
const by = (id: number) => ITEMS.find((x) => x.card.id === id)!;
const name = (id: number) => Object.entries(C).find(([, c]) => c.id === id)![0];
const run = (f: Partial<Filters>) => apply(ITEMS, { ...blank(), ...f }, ck).map((x) => name(x.card.id)).sort();
const names = (...ks: (keyof typeof C)[]) => [...ks].sort();

test('state: one per card, suspended and buried win', () => {
  assert.equal(stateOf(C.fresh), 'new');
  assert.equal(stateOf(C.learning), 'learning');
  assert.equal(stateOf(C.relearning), 'learning');
  assert.equal(stateOf(C.relearnTomorrow), 'learning');
  assert.equal(stateOf(C.week), 'young'); // 20 days
  assert.equal(stateOf(C.later), 'mature'); // 21 days
  assert.equal(stateOf(C.suspendedDue), 'suspended');
  assert.equal(stateOf(C.buried), 'buried');
  assert.deepEqual(run({ state: ['new'] }), names('fresh'));
  assert.deepEqual(run({ state: ['learning'] }), names('learning', 'relearning', 'relearnTomorrow'));
  assert.deepEqual(run({ state: ['young'] }), names('today', 'week'));
  assert.deepEqual(run({ state: ['mature'] }), names('overdue', 'later'));
  assert.deepEqual(run({ state: ['suspended', 'buried'] }), names('suspendedDue', 'buried'));
  assert.equal(run({}).length, 10);
});

test('due: only cards that can come up; suspended and buried never count as due', () => {
  assert.deepEqual(run({ due: 'overdue' }), names('overdue'));
  // learning due in ten minutes is today; a buried card dated today is not
  assert.deepEqual(run({ due: 'today' }), names('learning', 'relearning', 'today'));
  assert.deepEqual(run({ due: 'week' }), names('learning', 'relearning', 'relearnTomorrow', 'today', 'week'));
  assert.deepEqual(run({ due: 'range', dueR: [7, null] }), names('later'));
  assert.deepEqual(run({ due: 'range', dueR: [null, 0] }), names('learning', 'relearning', 'today', 'overdue'));
  assert.equal(by(C.fresh.id).due, null);
  assert.equal(by(C.suspendedDue.id).due, null);
});

test('learning due after the rollover counts as tomorrow', () => {
  // 3:50 am Taipei the next calendar day is still day T; a step due at 4:10 am is day T+1
  const late = clock('2024-04-21', 4, Date.UTC(2026, 10, 22, 19, 50), 480);
  const c = card(n1, 1, { type: 1, queue: 1, due: Date.UTC(2026, 10, 22, 20, 10) / 1000 });
  const [x] = index([c], (id) => notes.get(id), () => TYPE, late, W);
  assert.equal(x.due, 1);
});

test('interval, memory, recall and lapses ranges, ends included', () => {
  assert.deepEqual(run({ ivl: [21, null] }), names('overdue', 'later', 'suspendedDue'));
  assert.deepEqual(run({ ivl: [null, 4] }), names('relearning', 'relearnTomorrow')); // new and learning have no interval
  assert.deepEqual(run({ s: [30, 40] }), names('overdue', 'suspendedDue'));
  assert.deepEqual(run({ d: [9, 10] }), names('relearning'));
  assert.deepEqual(run({ lapses: [3, null] }), names('relearning'));
  // recall: 33 days on a 31-day memory is under 90%; a card just reviewed is near 100%
  const r = by(C.overdue.id).r!;
  assert.ok(r > 0.85 && r < 0.9, String(r));
  assert.ok(run({ r: [null, 90] }).includes('overdue'));
  assert.ok(!run({ r: [null, 90] }).includes('learning'));
  assert.equal(by(C.fresh.id).r, null);
  assert.ok(!run({ r: [0, 100] }).includes('fresh'));
});

test('flags, leeches, pictures, audio, card type, uses', () => {
  assert.deepEqual(run({ flag: [1] }), names('overdue'));
  assert.deepEqual(run({ flag: [1, 3] }), names('overdue', 'today'));
  assert.equal(run({ flag: [0] }).length, 8);
  assert.deepEqual(run({ leech: true }), names('relearning', 'relearnTomorrow'));
  assert.deepEqual(run({ pic: 'yes' }), names('fresh', 'learning', 'overdue', 'today'));
  assert.deepEqual(run({ pic: 'no', audio: 'yes' }), names('week', 'later'));
  assert.deepEqual(run({ card: ['Pic → word'] }), names('learning', 'relearnTomorrow', 'today', 'later', 'buried'));
  assert.deepEqual(run({ uses: [2] }), names('fresh', 'learning'));
  assert.deepEqual(run({ uses: [0, 1] }), names('relearning', 'relearnTomorrow', 'overdue', 'today'));
  // a word he isn't learning (known, or not tracked) has no uses and matches none
  assert.equal(by(C.week.id).uses, null);
});

test('added and reviewed dates', () => {
  assert.deepEqual(run({ added: 1 }), names('fresh', 'learning'));
  assert.deepEqual(run({ added: 7 }), names('fresh', 'learning', 'relearning', 'relearnTomorrow'));
  assert.deepEqual(run({ rev: 1 }), names('learning', 'relearning'));
  assert.deepEqual(run({ rev: 'never' }), names('fresh'));
  assert.ok(!run({ rev: 30 }).includes('overdue')); // last seen 33 days ago
});

test('text: Chinese anywhere, pinyin without tones or spaces, Latin notes, Anki syntax', () => {
  assert.deepEqual(run({ q: '浪費' }), names('fresh', 'learning'));
  assert.deepEqual(run({ q: '時間' }), names('fresh', 'learning')); // in the sentence
  assert.deepEqual(run({ q: 'langfei' }), names('fresh', 'learning'));
  assert.deepEqual(run({ q: 'lang fei' }), names('fresh', 'learning'));
  assert.deepEqual(run({ q: 'làngfèi' }), names('fresh', 'learning'));
  assert.deepEqual(run({ q: 'lang4fei4' }), names('fresh', 'learning'));
  assert.deepEqual(run({ q: 'lv' }), names('suspendedDue', 'buried')); // ü typed as v
  assert.deepEqual(run({ q: 'waste' }), names('fresh', 'learning'));
  assert.deepEqual(run({ q: '浪費 waste' }), names('fresh', 'learning'));
  assert.deepEqual(run({ q: '浪費 xyz' }), []);
  assert.deepEqual(run({ q: 'is:suspended' }), names('suspendedDue'));
  assert.deepEqual(run({ q: '-flag:0' }), names('overdue', 'today'));
  assert.equal(toneless('Nǚ<br>rén'), 'nuren');
});

test('filters combine', () => {
  assert.deepEqual(run({ state: ['young', 'mature'], due: 'week', pic: 'yes' }), names('today'));
  assert.deepEqual(run({ state: ['learning'], leech: true, due: 'today' }), names('relearning'));
  assert.equal(active({ ...blank(), state: ['new'], ivl: [1, null], q: 'x' }), 2);
  assert.equal(active(blank()), 0);
});

test('sorting: empty values last, ties newest first', () => {
  const ids = (xs: Item[]) => xs.map((x) => name(x.card.id));
  const due = ids(sortBy(ITEMS, 'due', false));
  assert.equal(due[0], 'overdue');
  assert.deepEqual(due.slice(-3).sort(), names('fresh', 'suspendedDue', 'buried'));
  const dueDesc = ids(sortBy(ITEMS, 'due', true));
  assert.equal(dueDesc[0], 'later');
  assert.deepEqual(dueDesc.slice(-3).sort(), names('fresh', 'suspendedDue', 'buried'));
  assert.equal(ids(sortBy(ITEMS, 'lapses', true))[0], 'relearning');
  assert.equal(ids(sortBy(ITEMS, 'added', true))[0], 'learning'); // newest note, its second card
});

test('a thousand cards: indexing and filtering stay instant', () => {
  const many: Card[] = [];
  for (let i = 0; i < 3000; i++) many.push({ ...C.week, id: 5e12 + i, nid: [n1, n2, n3, n4, n5][i % 5], due: T + (i % 40) - 10, ivl: i % 90 });
  let t = performance.now();
  const xs = index(many, (id) => notes.get(id), () => TYPE, ck, W);
  const built = performance.now() - t;
  t = performance.now();
  for (const q of ['l', 'la', 'lan', 'lang', 'langf', '浪', '浪費']) apply(xs, { ...blank(), q, state: ['young', 'mature'], due: 'week' }, ck);
  const typed = (performance.now() - t) / 7;
  assert.ok(built < 300, `index ${built}ms`);
  assert.ok(typed < 16, `a keystroke ${typed}ms`);
});

test('one row per word: its matching cards together, the weakest card\'s numbers', () => {
  const rows = byWord(apply(ITEMS, blank(), ck));
  assert.equal(rows.length, 5); // five notes, ten cards
  const r3 = rows.find((x) => x.note.id === n3)!;
  assert.equal(r3.n, 2);
  assert.equal(r3.tmpl, '2 cards');
  assert.equal(r3.due, -3); // the overdue card leads
  assert.equal(r3.card.id, C.overdue.id);
  assert.equal(r3.ivl, 12);
  assert.equal(r3.flag, 1); // red over green
  // the Card filter: only the matching card stands for the word
  const one = byWord(apply(ITEMS, { ...blank(), card: ['Pic → word'] }, ck)).find((x) => x.note.id === n3)!;
  assert.equal(one.n, 1);
  assert.equal(one.tmpl, 'Pic → word');
  // a word whose cards are all suspended or buried: led by the one not suspended
  const r5 = rows.find((x) => x.note.id === n5)!;
  assert.equal(r5.state, 'buried');
  assert.equal(r5.due, null);
});

test('Browse opens newest added first, one row per word', () => {
  const rows = sortBy(byWord(apply(ITEMS, blank(), ck)), 'added', true);
  assert.deepEqual(rows.map((x) => x.word), ['綠色', '心意', '收下', '表達', '浪費'].sort((a, b) => [...notes.values()].find((n) => n.flds[1] === b)!.id - [...notes.values()].find((n) => n.flds[1] === a)!.id));
  assert.equal(rows[0].note.id, Math.max(...notes.keys()));
  assert.deepEqual(blank().ease, []);
});

test('ease: too easy and too hard filter cards; hard wins in a word\'s row', () => {
  const judged = index(Object.values(C), (id) => notes.get(id), () => TYPE, ck, W, {}, (c, n) => verdict(c, n.tags, 8));
  const pick = (e: 'easy' | 'hard') => apply(judged, { ...blank(), ease: [e] }, ck).map((x) => name(x.card.id)).sort();
  assert.deepEqual(pick('hard'), names('overdue', 'relearning', 'relearnTomorrow')); // red flag; 9 lapses; a leech's card that lapsed twice
  assert.deepEqual(pick('easy'), names('today')); // green flag
  assert.equal(byWord(judged).find((x) => x.note.id === n3)!.ease, 'hard');
  assert.equal(active({ ...blank(), ease: ['easy'] }), 1);
});

test('a word with two notes (a second card for it) is still one row', () => {
  const all = apply(ITEMS, blank(), ck);
  const [a, b] = [all.find((x) => x.note.id === n3)!, all.find((x) => x.note.id !== n3)!];
  const twin = all.filter((x) => x.note.id === b.note.id).map((x) => ({ ...x, word: a.word }));
  const rows = byWord([...all.filter((x) => x.note.id !== b.note.id), ...twin]);
  const r = rows.filter((x) => x.word === a.word);
  assert.equal(r.length, 1);
  assert.equal(r[0].n, all.filter((x) => x.note.id === n3).length + twin.length);
});
