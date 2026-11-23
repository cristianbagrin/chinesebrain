// Chinese Brain Plus: what he marked in the Chinese Brain extension, straight from his account (the extension syncs
// every word to it), turned into the export words.py merged on Thursdays. The nightly asks his account only for
// what changed since last time (by sync sequence), so it reads a handful of rows, not the whole list.
import { shownSentence } from '../../../src/shared/context.ts';
import { shortSource } from '../../../src/shared/export.ts';

type Status = 'fresh' | 'learning' | 'known';
type Word = { w: string; s: Status; p?: string; g?: string; updated: number; hist?: { t: number; s: Status }[]; ctx?: { text: string; q?: string; url: string; t?: number }[] };
type Saved = { zh: string; en: string; at: number; from?: string };
export type Item = { k: string; v: unknown };
const CODE: Record<Status, string> = { fresh: 'F', learning: 'L', known: 'K' };
const code = (s: Status | null | undefined) => (s ? CODE[s] : '-');

/** A time as a day and a clock in Taipei, where he lives (the extension stamped it on his laptop there). */
const taipei = (t: number) => new Date(t + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
export const taipeiDay = (t: number) => taipei(t).slice(0, 10);
const clean = (s: unknown) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();

/**
 * The export's text for the words whose status he changed after `since` (ms) and the sentences he saved after it.
 * `known` is each word's status in known-words.txt, for a word he took off his list altogether (its record is gone).
 */
export function exportText(items: Item[], since: number, now: number, known: (w: string) => string | null) {
  const words = new Map<string, Word | null>(), saved = new Map<string, Saved[]>();
  for (const { k, v } of items) {
    if (k.startsWith('w:')) words.set(k.slice(2), (v as Word) ?? null);
    else if (k.startsWith('sav:')) saved.set(k.slice(4), ((v as Saved[]) ?? []).filter((x) => x && x.at > since));
  }
  type R = { w: string; now: string; was: string; date: string; rec: Word | null };
  const rows: R[] = [];
  for (const [w, rec] of words) {
    if (!rec) {
      const was = known(w);
      if (was) rows.push({ w, now: '-', was, date: taipeiDay(now), rec: null });
      continue;
    }
    const hist = rec.hist ?? [];
    if (!hist.some((h) => h.t > since)) continue; // no status change in the period (a lookup, a context)
    const before = hist.filter((h) => h.t <= since).pop()?.s ?? null;
    if (before === rec.s) continue; // changed and changed back
    rows.push({ w, now: code(rec.s), was: code(before), date: taipeiDay(rec.updated || now), rec });
  }
  const listed = new Set(rows.map((r) => r.w));
  for (const [w, list] of saved) {
    if (!list.length || listed.has(w)) continue;
    const rec = words.get(w) ?? null;
    rows.push({ w, now: code(rec?.s), was: code(rec?.s), date: taipeiDay(rec?.updated ?? Math.max(...list.map((x) => x.at))), rec });
  }
  const order: Record<string, number> = { K: 0, L: 1, F: 2, '-': 3 };
  rows.sort((a, b) => order[a.now] - order[b.now] || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const head = [
    `# Chinese Brain export · ${taipei(now)} · since ${taipei(since)} (from his account, by the nightly)`,
    '# Codes as in known-words.txt: K known, L learning, F fresh (met, not studied yet), - not in the list.',
    '# date = the day I set this status · sentence = where I met the word · saved = sentences I saved for a card, several joined with " ‖ "',
    '# was = status before this period (- = new). Only status changes I made are listed.',
    `# ${rows.length} words`,
    ['word', 'now', 'was', 'date', 'pinyin', 'meaning', 'sentence', 'source', 'saved'].join('\t'),
  ];
  const body = rows.map((r) => {
    const met = r.rec ? shownSentence(r.rec.ctx ?? [], r.w, saved.get(r.w)) : undefined;
    return [r.w, r.now, r.was, r.date, r.rec?.p?.toLowerCase(), r.rec?.g, met?.text, met ? shortSource(met.c.url, met.c.t) : '', (saved.get(r.w) ?? []).map((x) => (x.en ? `${x.zh} — ${x.en}` : x.zh)).join(' ‖ ')]
      .map(clean).join('\t');
  });
  return { text: [...head, ...body].join('\n') + '\n', count: rows.length };
}
