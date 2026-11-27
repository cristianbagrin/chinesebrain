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

/** The Cards page's prompt for two words on one card: two example sentences (or two short exchanges), each using BOTH
 *  words, so he learns them together, as they meet in real life. Added after the page's own prompt (cards.js). */
export function pairPrompt(a: string, b: string, why = '') {
  return `=== TWO WORDS, ONE CARD ===
${a} and ${b} are both easy for him now. This card replaces their old cards and teaches them together, the way they meet in real life${why ? ` (${why})` : ''}. word: ${a}、${b} (exactly this). meaning: ${a} …; ${b} … (short). ex: exactly two, and EACH one uses BOTH ${a} and ${b}, naturally, as a Taiwanese person would say it: one sentence, or a short exchange on one line (A：… B：…). Nothing forced: if a sentence needs a stretch to hold both, write a different one. Taiwan usage, Traditional characters, words he knows apart from these two; **bold** ${a} and ${b} each time. know: 1 or 2 points on how the two go together (the collocation, the situation, the contrast). One char: line per distinct character, no how: lines, no second: line.`;
}
