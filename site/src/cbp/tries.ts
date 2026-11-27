/* Essay marks as prompts first (the Essays page, board/js/essays.js): a mark shows only what's wrong until he tries the
   fix himself or asks to see it (research: prompts that let the learner self-correct beat showing the fix at once).
   Pure, shared with the board through plus/kit.js (TRIES). Each mark's outcome is kept on its review doc
   (reviews/dNNN `tries`: key → 'right' | 'wrong' | 'shown'), which the review jobs carry over when they rewrite it. */
export type Try = 'right' | 'wrong' | 'shown';
type MarkLike = { mine?: unknown; nat?: unknown; p?: unknown; [k: string]: unknown };

/** A mark's key in `tries`: from its words, so it survives the marks being re-ordered or added to. */
export function markKey(m: MarkLike): string {
  let h = 2166136261;
  for (const c of String(m.mine ?? '') + '\u0001' + String(m.nat ?? '')) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return 'm' + (h >>> 0).toString(36);
}

/** What he typed, the way it's compared: no spaces, no punctuation (full- or half-width alike), full-width letters and
 *  digits as plain ones. */
export const bare = (s: unknown) => String(s ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
/** His try is the fix. */
export const same = (attempt: unknown, fix: unknown) => !!bare(attempt) && bare(attempt) === bare(fix);

/** The outcome of one mark, if he has dealt with it. */
export const stateOf = (tries: unknown, m: MarkLike): Try | undefined => {
  const v = (tries as Record<string, unknown> | null | undefined)?.[markKey(m)];
  return v === 'right' || v === 'wrong' || v === 'shown' ? v : undefined;
};
/** `tries` with this mark's outcome. Once dealt with it stays so: a later reveal never undoes a right or wrong try. */
export function record(tries: unknown, m: MarkLike, t: Try): Record<string, Try> {
  const cur = { ...((tries as Record<string, Try>) ?? {}) }, k = markKey(m);
  if (!cur[k] || (cur[k] === 'shown' && t !== 'shown')) cur[k] = t;
  return cur;
}

const pkey = (p: unknown) => String(p ?? '').toLowerCase().replace(/[\s.,;:!?，。、；：！？()（）"“”'‘’「」…-]+/g, '');
type Item = { id: string; day?: number; mine?: string; nat?: string; p?: string; done?: boolean; removed?: boolean; uses?: { day: number; s: string }[]; tried?: number[] };
/** The To improve item a mark belongs to: the one made from it (same day, same words), else an open one for the same
 *  pattern. */
export function itemFor(items: Item[], m: MarkLike & { day?: unknown }): Item | undefined {
  const open = items.filter((x) => x && !x.done && !x.removed);
  const mine = String(m.mine ?? '').trim();
  return open.find((x) => Number(x.day) === Number(m.day) && String(x.mine ?? '').trim() === mine) ?? (m.p ? open.find((x) => x.p && pkey(x.p) === pkey(m.p)) : undefined);
}
/** His try on a mark, into its item's progress, as the 5 am marker counts essays (essays.ts planJson): every try goes in
 *  `tried` (the day); a right one is also a use (one per day), and uses on three days retire the item. */
export function credit(x: Item, day: number, s: string, ok: boolean, now = new Date().toISOString()): Record<string, unknown> {
  const tried = [...new Set([...(x.tried ?? []), day])].slice(-20);
  if (!ok) return { tried };
  const uses = [...(x.uses ?? []).filter((y) => y.day !== day), { day, s }].slice(-6);
  const data: Record<string, unknown> = { uses, tried };
  if (new Set(uses.map((y) => y.day)).size >= 3) Object.assign(data, { done: true, doneAt: now, proof: { day, s }, retired: true });
  return data;
}
