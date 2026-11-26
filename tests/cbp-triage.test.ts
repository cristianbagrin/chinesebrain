import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, Rev } from '../site/src/cbp/sched.ts';
import { verdict, triage } from '../site/src/cbp/review/triage.ts';

const NOW = Date.UTC(2026, 10, 27, 10, 0);
const DAY = 864e5;
// [ms, grade, ivl, lastIvl, factor, time, type]: type 0 learning, 1 review, 2 relearning, 4 manual
const rev = (daysAgo: number, g: number, type = 1): Rev => [NOW - daysAgo * DAY, g, 1, 1, 0, 3000, type];
let id = 1;
const card = (c: Partial<Card> = {}): Card => ({ id: id++, nid: 100, did: 1, ord: 0, type: 2, queue: 2, due: 0, ivl: 10, reps: 5, lapses: 0, left: 0, flags: 0, mod: 0, revs: [], ...c });

test('too easy: Easy three times running on a review card, or green', () => {
  assert.deepEqual(verdict(card({ revs: [rev(30, 3), rev(20, 4), rev(10, 4), rev(1, 4)] }), []), { ease: 'easy', why: 'easy3' });
  assert.equal(verdict(card({ revs: [rev(20, 4), rev(10, 3), rev(1, 4)] }), []), null); // a Good breaks it
  assert.equal(verdict(card({ revs: [rev(10, 4), rev(1, 4)] }), []), null); // only twice
  assert.equal(verdict(card({ type: 1, queue: 1, revs: [rev(0, 4, 0), rev(0, 4, 0), rev(0, 4, 0)] }), []), null); // still learning
  // a manual entry (a reschedule) between them doesn't count as an answer
  assert.equal(verdict(card({ revs: [rev(20, 4), rev(15, 0, 4), rev(10, 4), rev(1, 4)] }), [])?.why, 'easy3');
  assert.deepEqual(verdict(card({ flags: 3 }), []), { ease: 'easy', why: 'green' });
});

test('too hard: red, a leech, Again streaks', () => {
  assert.deepEqual(verdict(card({ flags: 1, revs: [rev(3, 4), rev(2, 4), rev(1, 4)] }), []), { ease: 'hard', why: 'red' }); // red wins
  assert.equal(verdict(card({ lapses: 8, revs: [rev(5, 1)] }), [])?.why, 'leech');
  assert.equal(verdict(card({ lapses: 2, revs: [rev(5, 1)] }), ['leech'])?.why, 'leech'); // tagged in Anki
  assert.equal(verdict(card({ lapses: 1, revs: [rev(5, 1)] }), ['leech']), null);
  assert.equal(verdict(card({ type: 1, queue: 1, revs: [rev(0, 1, 0), rev(0, 1, 0), rev(0, 1, 0)] }), [])?.why, 'again'); // a new word missed three times
  assert.equal(verdict(card({ lapses: 3, revs: [rev(9, 1), rev(8, 3), rev(4, 1), rev(1, 3)] }), [])?.why, 'again'); // 2 of the last 4
  assert.equal(verdict(card({ lapses: 2, revs: [rev(9, 1), rev(8, 3), rev(4, 1), rev(1, 3)] }), []), null); // not lapsed enough
  // hard beats a green flag
  assert.equal(verdict(card({ flags: 3, lapses: 9, revs: [rev(1, 1)] }), [])?.ease, 'hard');
});

test('suspended cards are left out, except a leech the scheduler suspended', () => {
  assert.equal(verdict(card({ queue: -1, revs: [rev(3, 4), rev(2, 4), rev(1, 4)] }), []), null);
  assert.equal(verdict(card({ queue: -1, lapses: 8, revs: [rev(1, 1)] }), [])?.why, 'leech');
});

test('waved off: back only for something new', () => {
  const seen = NOW - 2 * DAY;
  const easy = card({ revs: [rev(20, 4), rev(10, 4), rev(3, 4)] });
  assert.equal(verdict(easy, [], 8, seen), null);
  easy.revs.push(rev(1.5, 4), rev(1, 4), rev(0.5, 4));
  assert.equal(verdict(easy, [], 8, seen)?.why, 'easy3'); // three more Easy since
  const leech = card({ lapses: 9, revs: [rev(5, 1), rev(3, 3)] });
  assert.equal(verdict(leech, [], 8, seen), null);
  leech.revs.push(rev(1, 1));
  assert.equal(verdict(leech, [], 8, seen)?.why, 'leech'); // a new lapse
});

test('triage: one entry per word, hard wins, newest first, skips words on their way', () => {
  const tags = (nid: number) => (nid === 9 ? undefined : []);
  const cs = [
    card({ nid: 1, revs: [rev(9, 4), rev(8, 4), rev(7, 4)] }),
    card({ nid: 1, ord: 1, flags: 1, revs: [rev(6, 3)] }),
    card({ nid: 1, ord: 2, flags: 3 }),
    card({ nid: 2, revs: [rev(3, 4), rev(2, 4), rev(1, 4)] }),
    card({ nid: 2, ord: 1, revs: [rev(3, 4), rev(2, 4), rev(0.5, 4)] }),
    card({ nid: 3, flags: 3 }),
    card({ nid: 9, flags: 1 }), // a card whose note is gone
  ];
  const l = triage(cs, tags, 8);
  assert.deepEqual(l.map((f) => [f.nid, f.ease, f.cards.length]), [[2, 'easy', 2], [1, 'hard', 1], [3, 'easy', 1]]);
  assert.deepEqual(l.find((f) => f.nid === 1)!.why, ['red']);
  assert.deepEqual(triage(cs, tags, 8, {}, new Set([2])).map((f) => f.nid), [1, 3]);
  assert.deepEqual(triage(cs, tags, 8, { 1: NOW }).map((f) => f.nid), [2, 1, 3]); // red stays until he clears it
});
