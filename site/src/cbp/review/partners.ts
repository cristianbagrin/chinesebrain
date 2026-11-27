// Combine: the partner words for a word that's too easy. Pure (tests/cbp-combine.test.ts); main.ts reads the collection.
// The ranking is Claude's (combine.ts on the server, once per word, kept in the collection's meta `partners`): words of
// his own that genuinely go together in one sentence or a short exchange. Code only stands in while there's no answer
// (no signal, the AI down): his notes sharing a character, the easiest first, as before.

/** One of his words that could partner the target: its note, and how easy it is now (3 too easy, 2 right three times
 *  running, 1 every card grown up, 0 none of these). */
export type Cand = { nid: number; word: string; easy: number };
/** Claude's partners for one word, best first: the word and why, in a few words. */
export type AiList = { w: string; why: string }[];
export type Ranked = { nid: number; word: string; why: string; by: 'ai' | 'code' };

const HAN = /\p{Script=Han}/u;
const chars = (w: string) => new Set([...w].filter((c) => HAN.test(c)));

/** The partners for `target`, best first, at most `n`. `skip`: notes that can't be one (turned down before, already on
 *  their way to a combined card, the target's own). With Claude's list, only its words, in its order (an empty list
 *  means none fits: better none than a forced one); without it, code's guess. */
export function rank(target: string, ai: AiList | null | undefined, cands: Cand[], skip: Set<number>, n = 5): Ranked[] {
  const ok = cands.filter((c) => !skip.has(c.nid) && c.word && c.word !== target);
  if (ai) {
    // one note per word: the easiest of them (a word with two notes)
    const by = new Map<string, Cand>();
    for (const c of ok) if (!by.has(c.word) || c.easy > by.get(c.word)!.easy) by.set(c.word, c);
    const out: Ranked[] = [];
    for (const a of ai) {
      const c = by.get(a.w);
      if (c && !out.some((x) => x.word === c.word)) out.push({ nid: c.nid, word: c.word, why: a.why, by: 'ai' });
    }
    return out.slice(0, n);
  }
  const mine = chars(target);
  const scored = ok
    .map((c) => ({ c, shared: [...chars(c.word)].filter((x) => mine.has(x)).length }))
    .filter((x) => x.shared && x.c.easy > 0)
    .sort((a, b) => b.c.easy - a.c.easy || b.shared - a.shared || a.c.word.length - b.c.word.length);
  const out: Ranked[] = [];
  for (const { c } of scored) if (!out.some((x) => x.word === c.word)) out.push({ nid: c.nid, word: c.word, why: '', by: 'code' });
  return out.slice(0, n);
}

/** Claude's lists kept in meta `partners`: word → when and what. A list goes stale after STALE (his words change). */
export type Kept = Record<string, { at: number; list: AiList }>;
export const STALE = 30 * 864e5;
/** The too-easy words with no fresh list yet: the ones to ask about (in one call). */
export const missing = (targets: string[], kept: Kept, now = Date.now()) => [...new Set(targets)].filter((w) => !kept[w] || now - kept[w].at > STALE);

/** How a word stands in his reviews, its weakest card: FSRS difficulty (highest), stability and recall (lowest), lapses
 *  (most). null: never studied. */
export type Strength = { d: number | null; s: number | null; r: number | null; lapses: number };
export function strength(cards: { d: number | null; s: number | null; r: number | null; lapses: number }[]): Strength {
  const lo = (k: 's' | 'r') => (cards.some((c) => c[k] == null) ? null : cards.length ? Math.min(...cards.map((c) => c[k]!)) : null);
  const ds = cards.map((c) => c.d).filter((x): x is number => x != null);
  return { d: ds.length ? Math.max(...ds) : null, s: lo('s'), r: lo('r'), lapses: Math.max(0, ...cards.map((c) => c.lapses)) };
}
/** Of a combined pair, the word the card teaches: the harder one for him, by his own reviews. Each measure votes (higher
 *  difficulty, lower stability, lower recall, more lapses; a word never studied is the harder); the partner wins a tie,
 *  since the too-easy word is the one he has already. */
export function harder(easy: Strength, partner: Strength): 'easy' | 'partner' {
  let v = 0;
  const vote = (a: number | null, b: number | null, more: boolean, near: number) => {
    if (a == null && b == null) return;
    if (a == null) return void (v += more ? -1 : 1);
    if (b == null) return void (v += more ? 1 : -1);
    if (Math.abs(a - b) <= near) return;
    v += (a > b) === more ? 1 : -1;
  };
  // positive: the too-easy word is harder
  vote(easy.d, partner.d, true, 0.3);
  vote(easy.s, partner.s, false, 0.05 * Math.max(easy.s ?? 0, partner.s ?? 0));
  vote(easy.r, partner.r, false, 0.02);
  if (easy.lapses !== partner.lapses) v += easy.lapses > partner.lapses ? 1 : -1;
  return v > 0 ? 'easy' : 'partner';
}

/** A combined card waiting to be made (meta `combine`): its Cards page key "A、B" (A the too-easy word), the notes [A's,
 *  B's], and `learn`, the one word it teaches. Or one word written again (kind, key "字 ↻"). */
export type Pair = { words: string; nids: number[]; at: number; kind?: 'hard' | 'easy'; word?: string; why?: string; learn?: string };
/** The word a pair's new note teaches: `learn`; for one written again, its word; pairs from before `learn` (wave 8): the
 *  last of the two, the partner. */
export const learnOf = (p: Pair) => p.kind ? (p.word ?? '') : p.learn || p.words.split('、').at(-1) || '';
/** Does a new note with this word settle the pair? Its word is the one the card teaches (before `learn`: either word, or
 *  both together). */
export function settles(p: Pair, word: string): boolean {
  if (!word) return false;
  if (p.kind || p.learn) return word === learnOf(p);
  const parts = p.words.split('、');
  return parts.includes(word) || parts.every((w) => word.includes(w));
}
/** The notes whose cards rest once it's settled: the too-easy word's only (never the partner's). */
export const restOf = (p: Pair) => p.nids.slice(0, 1);

/** The Cards page's prompt for two words on one card: it teaches `learn`, the harder of the two for him, with two example
 *  sentences (or two short exchanges) that each use BOTH words, as they meet in real life. Added after the page's own
 *  prompt (cards.js). */
export function pairPrompt(a: string, b: string, why = '', learn = b) {
  const other = learn === a ? b : a;
  return `=== TWO WORDS, ONE CARD ===
${other} is easy for him now; ${learn} is the harder of the two for him. This card teaches ${learn}, with ${other} beside it, the way they meet in real life${why ? ` (${why})` : ''}. word: ${learn} (exactly this, only this word). meaning: ${learn} … (short). ex: exactly two, and EACH one uses BOTH ${learn} and ${other}, naturally, as a Taiwanese person would say it: one sentence, or a short exchange on one line (A：… B：…). Nothing forced: if a sentence needs a stretch to hold both, write a different one. Taiwan usage, Traditional characters, words he knows apart from these two; **bold** ${learn} each time (not ${other}). know: 1 or 2 points on how the two go together (the collocation, the situation, the contrast). One char: line per distinct character of ${learn}, no how: lines, no second: line.`;
}
