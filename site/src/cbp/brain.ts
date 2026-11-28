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

/** When he set the record's status (its last status change; `updated` also moves on a lookup or a context). */
export const statusAt = (rec: { updated?: number; hist?: { t: number }[] }) => rec.hist?.length ? rec.hist[rec.hist.length - 1].t : rec.updated ?? 0;

/** Every way of writing a word with 台 or 臺 (Plus keys every word with 台; the extension keeps the dictionary's
 *  headword, 臺北 or 舞臺, whatever was looked up). The word as given comes first. */
export function taiForms(w: string) {
  const at = [...w].map((c, i) => (c === '台' || c === '臺' ? i : -1)).filter((i) => i >= 0).slice(0, 3);
  const out = new Set([w]);
  for (let m = 0; m < 1 << at.length; m++) {
    const c = [...w];
    at.forEach((i, b) => (c[i] = m & (1 << b) ? '臺' : '台'));
    out.add(c.join(''));
  }
  return [...out];
}

/** The one record his account has for a word in any of its 台/臺 forms: the oldest (a copy made later, by an old
 *  write-back, is the duplicate), or null. */
export function pickRecord<T extends { added?: number }>(w: string, recs: Record<string, T | null | undefined>) {
  const have = taiForms(w).map((f) => recs[f]).filter((r): r is T => !!r);
  return have.sort((a, b) => (a.added ?? 0) - (b.added ?? 0))[0] ?? null;
}

/** The form a new record gets: the dictionary's 臺 form when the dictionary has it and not the word as Plus writes
 *  it (舞台 → 舞臺; 台北, a headword of its own, stays). `inDict` says whether a form is a dictionary headword. */
export function newForm(w: string, inDict: (f: string) => boolean) {
  if (inDict(w)) return w;
  return taiForms(w).find((f) => f !== w && inDict(f)) ?? w;
}

type Rec = { w: string; s: string; added?: number; updated: number; hist?: { t: number; s: string }[] };
/** Which of Plus's K/L words go back to his account, and onto which record (null: none in any 台/臺 form, a new
 *  one). The newer change wins per word: Plus's change at its time (`times`, ms) when it has one, else from the start
 *  of the day it set it in Taipei; his own status change later than that stays. */
export function backPlan<T extends Rec>(want: [string, [string, string]][], recs: Record<string, T | null | undefined>, times: Record<string, number>) {
  const out: { w: string; status: 'known' | 'learning'; rec: T | null }[] = [];
  for (const [w, [s, d]] of want) {
    const status = s === 'K' ? 'known' : 'learning';
    const rec = pickRecord(w, recs);
    const at = times[w] ?? Date.parse(d + 'T00:00:00+08:00');
    if (rec && (rec.s === status || statusAt(rec) >= at)) continue;
    out.push({ w, status, rec });
  }
  return out;
}

/**
 * The export's text for the words whose status in the extension isn't the one Plus has (`known`: each word's status
 * in known-words.txt, null when it isn't there), and the sentences he saved after `since` (ms). His account sends only
 * the words whose sync sequence moved since last time, so a mark that synced late (an offline laptop, a mark made
 * while the nightly ran) still comes in, and Plus's own write-backs coming back are no-ops: the statuses match.
 * A fresh word Plus doesn't list (known-words.txt has only K and L) is new to him only when he set it after `since`.
 */
export function exportText(items: Item[], since: number, now: number, known: (w: string) => string | null) {
  const words = new Map<string, Word | null>(), saved = new Map<string, Saved[]>();
  for (const { k, v } of items) {
    if (k.startsWith('w:')) words.set(k.slice(2), (v as Word) ?? null);
    else if (k.startsWith('sav:')) saved.set(k.slice(4), ((v as Saved[]) ?? []).filter((x) => x && x.at > since));
  }
  type R = { w: string; now: string; was: string; date: string; at: number; rec: Word | null };
  const rows: R[] = [];
  for (const [w, rec] of words) {
    const mine = known(w);
    if (!rec) {
      if (mine) rows.push({ w, now: '-', was: mine, date: taipeiDay(now), at: now, rec: null });
      continue;
    }
    const at = statusAt(rec);
    if (mine || rec.s !== 'fresh') {
      if (code(rec.s) === mine) continue; // the same status in both (Plus's own write-back, a lookup)
      rows.push({ w, now: code(rec.s), was: mine ?? '-', date: taipeiDay(at || rec.updated || now), at, rec });
      continue;
    }
    const hist = rec.hist ?? [];
    if (!hist.some((h) => h.t > since)) continue; // a fresh word met before: a lookup, a context
    const before = hist.filter((h) => h.t <= since).pop()?.s ?? null;
    if (before === rec.s) continue; // changed and changed back
    rows.push({ w, now: code(rec.s), was: code(before), date: taipeiDay(rec.updated || now), at, rec });
  }
  const listed = new Set(rows.map((r) => r.w));
  for (const [w, list] of saved) {
    if (!list.length || listed.has(w)) continue;
    const rec = words.get(w) ?? null;
    rows.push({ w, now: code(rec?.s), was: code(rec?.s), date: taipeiDay(rec?.updated ?? Math.max(...list.map((x) => x.at))), at: rec ? statusAt(rec) : 0, rec });
  }
  const order: Record<string, number> = { K: 0, L: 1, F: 2, '-': 3 };
  rows.sort((a, b) => order[a.now] - order[b.now] || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const head = [
    `# Chinese Brain export · ${taipei(now)} · since ${taipei(since)} (from his account, by the nightly)`,
    '# Codes as in known-words.txt: K known, L learning, F fresh (met, not studied yet), - not in the list.',
    '# date = the day I set this status · sentence = where I met the word · saved = sentences I saved for a card, several joined with " ‖ "',
    '# was = the status Chinese Brain Plus had (- = not in its list). Only status changes I made are listed.',
    '# at = when I set this status (ms), for the newer-change-wins rule',
    `# ${rows.length} words`,
    ['word', 'now', 'was', 'date', 'pinyin', 'meaning', 'sentence', 'source', 'saved', 'at'].join('\t'),
  ];
  const body = rows.map((r) => {
    const met = r.rec ? shownSentence(r.rec.ctx ?? [], r.w, saved.get(r.w)) : undefined;
    return [r.w, r.now, r.was, r.date, r.rec?.p?.toLowerCase(), r.rec?.g, met?.text, met ? shortSource(met.c.url, met.c.t) : '', (saved.get(r.w) ?? []).map((x) => (x.en ? `${x.zh} — ${x.en}` : x.zh)).join(' ‖ '), r.at ? String(r.at) : '']
      .map(clean).join('\t');
  });
  return { text: [...head, ...body].join('\n') + '\n', count: rows.length };
}
