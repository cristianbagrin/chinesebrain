// Chinese Brain Plus: partners for the words that are too easy (Reviews' Combine). POST plus/anki/partners
// {targets: [word], pool: [word]}: for each target, the words of his own (pool) that genuinely belong with it in one
// sentence or a short exchange, best first, each with why in a few words. One call for every word that needs it; the
// Reviews tab keeps the answer in the collection (meta `partners`) and asks again only for new words or after a month.
// The model is his pick in Settings › AI (`combine-model`, Haiku by default: a ranking, no writing); tokens go to `spend`.
import * as ai from './ai.ts';
import { modelFor } from './settings.ts';
import { Bad } from './cards.ts';

const HAN = /\p{Script=Han}/u;
const word = (x: unknown) => String(x ?? '').replace(/\s+/g, '').slice(0, 12);
const ok = (w: string) => !!w && HAN.test(w);

export function prompt(targets: string[], pool: string[]) {
  return `Chris learns Taiwanese Chinese (Traditional characters, Taiwan usage, high A2). The TARGET words are too easy for him now. Each will be learned again on one new card together with a partner word from his own collection: two example sentences (or short exchanges) that each use BOTH words naturally.

For each target, pick up to 5 partners from HIS WORDS, best first: words that genuinely belong with it in one everyday sentence or a two-line exchange: a collocation (a verb and its usual object, a measure word and its noun), the same situation (ordering food, a doctor's visit, an argument at work), a natural pair or contrast (opposites, before and after), cause and effect. Sharing a character is not a reason. Leave out any word that would make a forced or odd sentence; fewer is better than weak. Never the target itself or another form of it.

Reply with JSON only, no other text: {"target": [["partner", "why, at most 5 English words"], ...], ...}

TARGETS: ${targets.join(' ')}

HIS WORDS: ${pool.join(' ')}`;
}

/** Claude's answer, kept to what can be used: targets asked about, partners from his words, no duplicates. */
export function parse(text: string, targets: string[], pool: string[]) {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('combine: no JSON in the answer');
  const raw = JSON.parse(m[0]) as Record<string, unknown>;
  const have = new Set(pool), out: Record<string, { w: string; why: string }[]> = {};
  for (const t of targets) {
    const l = Array.isArray(raw[t]) ? (raw[t] as unknown[]) : [];
    const list: { w: string; why: string }[] = [];
    for (const x of l) {
      const [w0, why0] = Array.isArray(x) ? x : [(x as { w?: unknown })?.w, (x as { why?: unknown })?.why];
      const w = word(w0), why = String(why0 ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (have.has(w) && w !== t && !list.some((y) => y.w === w)) list.push({ w, why });
    }
    out[t] = list.slice(0, 5);
  }
  return out;
}

export async function partners(env: unknown, b: { targets?: unknown; pool?: unknown }) {
  const targets = [...new Set((Array.isArray(b.targets) ? b.targets : []).map(word).filter(ok))].slice(0, 40);
  const pool = [...new Set((Array.isArray(b.pool) ? b.pool : []).map(word).filter(ok))].slice(0, 3000);
  if (!targets.length) throw new Bad('No words.');
  if (pool.length < 2) return { partners: Object.fromEntries(targets.map((t) => [t, []])) };
  const model = await modelFor(env as never, 'combine-model');
  const r = await ai.text(env as never, model, prompt(targets, pool), { effort: 'low', maxTokens: 8000, job: 'combine' });
  return { partners: parse(r.text, targets, pool), model: model.split(':')[1] };
}
