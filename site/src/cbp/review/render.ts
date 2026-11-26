// His templates, rendered the way Anki renders them (rslib/src/template.rs): {{Field}}, {{#Field}}…{{/Field}},
// {{^Field}}…{{/Field}}, {{hint:Field}}, {{text:Field}}, {{FrontSide}}, {{Tags}}, {{Deck}}, {{Card}}, [sound:…].
// And Browse's search, a subset of Anki's: words, field:text, tag:, flag:, is:, card:, prop:, rated:, added:, -not.
import type { Card } from '../sched.ts';
import { grades, missed3 } from '../sched.ts';
import type { Note, NoteType } from './store.ts';

export const strip = (html: string) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\[sound:[^\]]*\]/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
/** Anki's test for an empty field: nothing left once the HTML is gone (a [sound:…] counts as something). */
const nonEmpty = (html: string) => !!strip(html) || /<img\b|\[sound:/i.test(html ?? '');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type Ctx = { note: Note; type: NoteType; card: { ord: number }; deck?: string };

/** One side of a card, as HTML. Sounds become play buttons (data-sound). */
export function render(tmpl: string, x: Ctx, front?: string, mark?: string): string {
  const fields = new Map(x.type.fields.map((f) => [f.name, x.note.flds[f.ord] ?? '']));
  const t = x.type.templates.find((t) => t.ord === x.card.ord);
  const special: Record<string, string> = { FrontSide: front ?? '', Tags: esc(x.note.tags.join(' ')), Deck: esc(x.deck ?? ''), Subdeck: esc((x.deck ?? '').split('::').pop() ?? ''), Card: esc(t?.name ?? ''), Type: esc(x.type.name) };
  const value = (name: string) => (name in special ? special[name] : fields.get(name) ?? '');
  // sections, innermost first
  let s = tmpl;
  for (let guard = 0; guard < 50; guard++) {
    const before = s;
    s = s.replace(/\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g, (_, k, name, inner) => ((k === '#') === nonEmpty(value(name)) ? inner : ''));
    if (s === before) break;
  }
  let hints = 0;
  s = s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, spec: string) => {
    const parts = spec.split(':');
    const name = parts.pop()!.trim();
    const filters = parts.map((p) => p.trim());
    let v = value(name);
    // marking (frontShows): a field of the note that has something in it puts the mark where it lands
    if (mark !== undefined && !(name in special) && !filters.includes('hint')) return nonEmpty(v) ? mark : '';
    for (const f of filters.reverse()) {
      if (f === 'text') v = esc(strip(v));
      else if (f === 'hint') {
        if (!nonEmpty(v)) return '';
        v = `<a class="hint" href="#" data-hint="${hints++}">Show ${esc(name)}</a><div class="hint-body" hidden>${v}</div>`;
      } else if (f === 'type' || f === 'cloze' || f === 'tts' || f === 'furigana' || f === 'kana' || f === 'kanji') v = f === 'type' ? '' : v;
    }
    return v;
  });
  return sounds(s);
}

/** [sound:…] → a button that plays it. */
export const sounds = (html: string) => html.replace(/\[sound:([^\]]+)\]/g, (_, src) => `<button type="button" class="snd-btn" data-sound="${esc(src)}" aria-label="Play"></button>`);

/** Does this card type's front show anything for this note? Anki's rule for which cards exist: the front names at least
 *  one field that has something in it (static text, {{FrontSide}}, {{Tags}} and hint links don't count). A card whose
 *  front would be empty (Pic → word on a note with no picture) is left out of reviews. */
export function frontShows(type: NoteType, note: Note, ord: number) {
  const t = type.templates.find((t) => t.ord === ord);
  if (!t) return false;
  return render(t.qfmt, { note, type, card: { ord } }, undefined, '\u0001').includes('\u0001');
}
const SHOWS = new Map<number, [number, number, boolean]>();
/** The cards worth showing: those whose front shows something (frontShows), remembered per card until its note or
 *  note type changes, so the day's queue can ask on every answer. */
export function showable<C extends { id: number; nid: number; ord: number }>(cards: C[], noteOf: (nid: number) => Note | undefined, typeOf: (n: Note) => NoteType | undefined): C[] {
  return cards.filter((c) => {
    const n = noteOf(c.nid), t = n && typeOf(n);
    if (!n || !t) return false;
    const k = SHOWS.get(c.id);
    if (k && k[0] === n.mod && k[1] === t.mod) return k[2];
    const v = frontShows(t, n, c.ord);
    SHOWS.set(c.id, [n.mod, t.mod, v]);
    return v;
  });
}

export const fieldIndex = (type: NoteType, name: string) => type.fields.find((f) => f.name.toLowerCase() === name.toLowerCase())?.ord ?? -1;
/** The note's word: its Word field, else its sort field. */
export function wordOf(type: NoteType | undefined, note: Note) {
  if (!type) return strip(note.flds[0]);
  const i = fieldIndex(type, 'Word');
  return strip(note.flds[i >= 0 ? i : type.sortf] ?? '');
}
export const sortText = (type: NoteType | undefined, note: Note) => strip(note.flds[type?.sortf ?? 0] ?? '');

// ---------- search ----------
export type Row = { card: Card; note: Note; type: NoteType | undefined };
type Test = (r: Row) => boolean;

function tokens(q: string) {
  const out: string[] = [];
  const re = /(-?)(\w+:)?("([^"]*)"|\S+)/g;
  for (const m of q.matchAll(re)) out.push(m[0]);
  return out;
}
const glob = (s: string) => new RegExp(s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/_/g, '.'), 'i');

/** Anki's search, the parts he uses. `today` = Anki's day number; dayOf turns ms into one. */
export function search(q: string, today: number, dayOf: (ms: number) => number): Test {
  const tests: Test[] = [];
  for (const raw of tokens(q.trim())) {
    if (/^or$/i.test(raw) || /^and$/i.test(raw)) continue;
    const neg = raw.startsWith('-');
    const t = neg ? raw.slice(1) : raw;
    const m = /^(\w+):(.*)$/.exec(t);
    const val = (m ? m[2] : t).replace(/^"|"$/g, '');
    let f: Test;
    if (!m) {
      const re = glob(val);
      f = (r) => r.note.flds.some((x) => re.test(strip(x)));
    } else {
      const k = m[1].toLowerCase();
      if (k === 'tag') {
        const re = new RegExp('^' + glob(val).source + '(::.*)?$', 'i');
        f = val === 'none' ? (r) => !r.note.tags.length : (r) => r.note.tags.some((x) => re.test(x));
      } else if (k === 'flag') f = (r) => (r.card.flags & 7) === Number(val);
      else if (k === 'is') {
        const c = (r: Row) => r.card;
        f = ({
          new: (r: Row) => c(r).type === 0,
          learn: (r: Row) => c(r).type === 1 || c(r).type === 3,
          review: (r: Row) => c(r).type === 2 || c(r).type === 3,
          due: (r: Row) => ((c(r).queue === 2 || c(r).queue === 3) && c(r).due <= today) || (c(r).queue === 1 && c(r).due * 1000 <= Date.now()),
          suspended: (r: Row) => c(r).queue === -1,
          buried: (r: Row) => c(r).queue === -2 || c(r).queue === -3,
          leech: (r: Row) => r.note.tags.some((x) => /^leech$/i.test(x)),
          missed: (r: Row) => missed3(c(r)),
        } as Record<string, Test>)[val.toLowerCase()] ?? (() => false);
      } else if (k === 'card') f = /^\d+$/.test(val) ? (r) => r.card.ord === Number(val) - 1 : (r) => glob(val).test(r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? '');
      else if (k === 'deck') f = () => true;
      else if (k === 'note') f = (r) => glob(val).test(r.type?.name ?? '');
      else if (k === 'added') f = (r) => dayOf(r.card.id) > today - Number(val);
      else if (k === 'rated') {
        const [days, ease] = val.split(':').map(Number);
        f = (r) => r.card.revs.some((x) => dayOf(x[0]) > today - days && (!ease || x[1] === ease));
      } else if (k === 'prop') {
        const p = /^(ivl|due|reps|lapses|d|s)(<=|>=|!=|=|<|>)(-?[\d.]+)$/.exec(val);
        f = p
          ? (r) => {
              const v = p[1] === 'due' ? r.card.due - today : p[1] === 'd' ? (r.card.d ?? 0) : p[1] === 's' ? (r.card.s ?? 0) : (r.card as any)[p[1]];
              const n = Number(p[3]);
              return { '<': v < n, '>': v > n, '<=': v <= n, '>=': v >= n, '=': v === n, '!=': v !== n }[p[2]]!;
            }
          : () => false;
      } else {
        // field:text
        const re = new RegExp('^' + glob(val).source + '$', 'i');
        f = (r) => {
          const i = r.type ? fieldIndex(r.type, m[1]) : -1;
          return i >= 0 && re.test(strip(r.note.flds[i] ?? ''));
        };
      }
    }
    tests.push(neg ? (r) => !f(r) : f);
  }
  return (r) => tests.every((t) => t(r));
}

/** "Again Again Good" → for a card's info line. */
export const recent = (c: Card) => grades(c, 6);
