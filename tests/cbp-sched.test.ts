import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fsrs, constrain, fuzzBounds } from '../site/src/cbp/fsrs.ts';
import { answer, clock, forecast, queue, missed3, right3, type Card, type Conf } from '../site/src/cbp/sched.ts';
import { render, search, frontShows } from '../site/src/cbp/review/render.ts';

// his deck options, as imported (FSRS-6 weights from his Anki)
const W = [0.5213, 3.0462, 7.8006, 28.3224, 6.4869, 0.633, 3.0256, 0.0263, 1.8053, 0.2824, 0.7502, 1.5588, 0.0452, 0.4014, 1.6774, 0.3768, 2.1176, 0.6212, 0.1627, 0.0876, 0.1929];
const conf: Conf = { id: 1, name: 'Default', newPerDay: 20, revPerDay: 9999, learnSteps: [1, 10], relearnSteps: [10], maxIvl: 36500, leechThreshold: 8, leechAction: 1, retention: 0.9, w: W, buryNew: true, buryRev: true };
// 2026-11-22 18:00 in Taipei: Anki's day 945 for a collection whose day 0 is 2024-04-21, turning over at 4 am
const NOW = Date.UTC(2026, 10, 22, 10, 0);
const ck = clock('2024-04-21', 4, NOW, 480);
const fresh = (id = 1): Card => ({ id, nid: id, did: 1, ord: 0, type: 0, queue: 0, due: 1, ivl: 0, reps: 0, lapses: 0, left: 0, flags: 0, mod: 0, revs: [] });

test('Anki day numbers, rollover at 4 am where he is', () => {
  assert.equal(ck.today, 945);
  assert.equal(clock('2024-04-21', 4, Date.UTC(2026, 10, 22, 19, 59), 480).today, 945); // 3:59 am next day
  assert.equal(clock('2024-04-21', 4, Date.UTC(2026, 10, 22, 20, 0), 480).today, 946); // 4:00 am
  assert.equal(ck.dayEnd, Date.UTC(2026, 10, 22, 20, 0));
});

test('FSRS-6: the interval at 90% retention is the stability', () => {
  const f = new Fsrs(W);
  assert.ok(Math.abs(f.interval(10, 0.9) - 10) < 1e-9);
  assert.ok(Math.abs(f.r(10, 10) - 0.9) < 1e-9);
  assert.deepEqual(fuzzBounds(10, 1, 36500), [8, 12]);
  assert.equal(constrain(2.4, 1, 36500, 0.99), 2); // under 2.5 days: no fuzz
});

test('a new card walks the learning steps, then graduates', () => {
  const a = answer(fresh(), 3, conf, ck);
  assert.equal(a.card.type, 1);
  assert.equal(a.card.queue, 1);
  assert.equal(a.card.due, NOW / 1000 + 600); // second step, 10m
  assert.equal(a.label, '10m');
  const b = answer(a.card, 3, conf, clock('2024-04-21', 4, NOW + 600e3, 480));
  assert.equal(b.card.type, 2);
  assert.equal(b.card.queue, 2);
  // a first Good starts at w[2] = 7.8 days of stability; the same-day second Good barely moves it
  assert.ok(b.card.ivl >= 6 && b.card.ivl <= 10, String(b.card.ivl));
  assert.equal(b.card.due, 945 + b.card.ivl);
  assert.equal(b.card.revs.length, 2);
  const again = answer(fresh(), 1, conf, ck);
  assert.equal(again.label, '1m');
  const hard = answer(fresh(), 2, conf, ck);
  assert.equal(hard.label, '6m'); // halfway between the first two steps, as Anki does
  const easy = answer(fresh(), 4, conf, ck);
  assert.equal(easy.card.type, 2);
});

test('a review: Hard < Good < Easy, Again relearns and counts a lapse', () => {
  const c: Card = { ...fresh(7), type: 2, queue: 2, due: 945, ivl: 20, reps: 6, s: 20, d: 5, lrt: NOW / 1000 - 20 * 86400 };
  const [h, g, e] = [2, 3, 4].map((x) => answer(c, x, conf, ck).card.ivl);
  assert.ok(h < g && g < e, `${h} ${g} ${e}`);
  const a = answer(c, 1, conf, ck);
  assert.equal(a.card.type, 3);
  assert.equal(a.card.queue, 1);
  assert.equal(a.card.lapses, 1);
  const back = answer(a.card, 3, conf, clock('2024-04-21', 4, NOW + 600e3, 480));
  assert.equal(back.card.type, 2);
  assert.ok(back.card.ivl >= 1);
});

test('a leech at the threshold, and every half-threshold after', () => {
  const c: Card = { ...fresh(9), type: 2, queue: 2, due: 945, ivl: 3, reps: 20, lapses: 7, s: 3, d: 9, lrt: NOW / 1000 - 3 * 86400 };
  assert.equal(answer(c, 1, conf, ck).leech, true);
  assert.equal(answer({ ...c, lapses: 8 }, 1, conf, ck).leech, false);
  assert.equal(answer({ ...c, lapses: 11 }, 1, conf, ck).leech, true);
});

test('the queue: due reviews, new up to the limit, one card per note', () => {
  const r = (id: number, nid: number, due: number): Card => ({ ...fresh(id), nid, type: 2, queue: 2, due, ivl: 5 });
  const cards = [r(1, 1, 944), r(2, 1, 945), r(3, 2, 946), fresh(4), { ...fresh(5), nid: 4 }];
  const q = queue(cards, conf, ck, new Set(), 0, 0);
  assert.deepEqual(q.review.map((c) => c.id), [1]);
  assert.deepEqual(q.fresh.map((c) => c.id), [4]);
  assert.equal(forecast(cards, ck).backlog, 1);
  assert.equal(forecast(cards, ck).days[1], 1);
});

test('three in a row', () => {
  const c = (gs: number[]): Card => ({ ...fresh(), revs: gs.map((g, i) => [i, g, 1, 1, 0, 0, 1]) });
  assert.ok(missed3(c([3, 1, 1, 1])));
  assert.ok(!missed3(c([1, 1, 3])));
  assert.ok(right3(c([1, 3, 3, 4])));
  assert.ok(!right3(c([3, 3, 1])));
});

test('his templates render the way Anki renders them', () => {
  const type = {
    id: 1, name: 'Chinese', css: '', sortf: 1, kind: 0, mod: 0,
    fields: ['Chinese', 'Word', 'Picture', 'Notes', 'Pinyin', 'Audio'].map((name, ord) => ({ name, ord })),
    templates: [
      { name: 'Word → pic', ord: 0, qfmt: '<div class="word">{{Word}}</div>', afmt: '{{FrontSide}}<div>{{Chinese}}</div><div>{{hint:Pinyin}}</div>{{#Picture}}<div class="picture">{{Picture}}</div>{{/Picture}}{{#Audio}}{{Audio}}{{/Audio}}' },
      { name: 'Pic → word', ord: 1, qfmt: '<div class="picture">{{Picture}}</div>', afmt: '{{Chinese}}' },
    ],
  };
  const note = { id: 1, guid: 'g', mid: 1, mod: 0, tags: [], flds: ['我<u>終於</u>到了', '終於', '', 'finally', 'Wǒ zhōngyú dào le', '[sound:/api/plus/media/x.mp3]'] };
  const q = render(type.templates[0].qfmt, { note, type, card: { ord: 0 } });
  assert.equal(q, '<div class="word">終於</div>');
  const a = render(type.templates[0].afmt, { note, type, card: { ord: 0 } }, q);
  assert.ok(a.startsWith(q));
  assert.ok(!a.includes('picture'));
  assert.ok(a.includes('data-hint') && a.includes('data-sound="/api/plus/media/x.mp3"'));
  assert.equal(frontShows(type, note, 1), false); // no picture: no Pic → word card
  assert.equal(frontShows(type, note, 0), true);
  const t = search('word:終* -tag:leech', 945, () => 900);
  assert.ok(t({ card: fresh(), note, type }));
  assert.ok(!search('is:suspended', 945, () => 900)({ card: fresh(), note, type }));
});
