// Chinese Brain Plus, Stage 4: his reviews (Anki rebuilt), as the Reviews tab of the board at /plus. plus.js loads this
// before the board's boot.js, so the tab is there when the board opens on #reviews. The whole collection lives on the
// device (store.ts), so reviewing works with no signal; the scheduler is sched.ts (FSRS, as Anki runs it); his own
// templates and styling draw the cards (render.ts). Inside the tab: Review and Browse; its settings are rows in the one
// Settings panel (LAB.row, kit/settings.ts), and Card designs opens here from there.
// Adding cards happens on the Cards page only (plus/review.js, its note goes into the collection: src/cbp/anki.ts).
import { S, load, put, putMany, sync, api, onChange, type Note, type NoteType, type ColMeta } from './store.ts';
import { render, strip, wordOf, sortText, search, fieldIndex, showable, type Row } from './render.ts';
import { answer, clock, queue, label, missed3, right3, historyOf, type Card, type Conf, type Rev } from '../sched.ts';
import { Fsrs, optimize, loss } from '../fsrs.ts';
import { exportAnki } from './export.ts';

// the board's own globals (site/public/plus/board/js/core.js, cards.js)
declare const VIEWS: string[];
declare const BUS: { on(e: string, f: (...a: any[]) => void): void; emit(e: string, ...a: unknown[]): void };
declare function setView(v: string, first?: boolean): void;
declare let VIEW: string | null;
declare function sfx(name: string): void;
declare function hideToast(now?: boolean): void;
declare function openCard(word: string, src: string): void;
declare const LAB: { get(id: string): string; row(id: string, group: string, o: { html: () => string; bind: (el: HTMLElement) => void }): void };
// the shared parts (plus/kit.js, site/src/cbp/kit)
declare const SOUND: { play(src: string | string[], o?: { rate?: number; onEnd?: () => void }): Promise<boolean>; stop(): void; autoplay(): boolean };
declare const KEYS: { is(e: KeyboardEvent, id: string): boolean; label(id: string): string };
declare const RUBY: { set(el: Element | ShadowRoot | null | undefined, on: boolean): Promise<void>; shown(): boolean; CSS: string };
declare const SETTINGS: { open(to?: string): void; close(): void; redraw(): void };
declare const FUN: { celebrate(kind: string, o?: { x?: number; y?: number }): void } | undefined;
// the Cards page's (board/js/cards.js), for a combined card
declare const CD: { docs: Record<string, { dropped?: unknown; carded?: unknown } | undefined> } | undefined;
declare function cardId(w: string): string;
declare let cardPrompt: ((kit: unknown, word: string) => string) | undefined;

const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const TOUCH = matchMedia('(hover: none)').matches;
type Kind = 'meta' | 'notetype' | 'deck' | 'conf' | 'note' | 'card';

// ---------- the tab, put into the board before it boots ----------
const TAB = document.createElement('button');
TAB.type = 'button';
TAB.setAttribute('role', 'tab');
TAB.id = 'tab-reviews';
TAB.setAttribute('aria-controls', 'view-reviews');
TAB.setAttribute('aria-selected', 'false');
TAB.tabIndex = -1;
TAB.innerHTML = 'Reviews<i class="dot gold" id="dot-reviews" hidden></i>';
document.getElementById('tab-today')!.after(TAB);
const VIEW_EL = document.createElement('section');
VIEW_EL.className = 'view';
VIEW_EL.id = 'view-reviews';
VIEW_EL.setAttribute('role', 'tabpanel');
VIEW_EL.setAttribute('aria-labelledby', 'tab-reviews');
VIEW_EL.hidden = true;
document.getElementById('view-today')!.after(VIEW_EL);
VIEWS.splice(VIEWS.indexOf('today') + 1, 0, 'reviews');
VIEW_EL.innerHTML = `<div class="rx">
  <header class="rx-top rx-opt">
    <nav class="rx-seg" aria-label="Reviews"><button type="button" data-v="review">Review</button><button type="button" data-v="browse">Browse</button></nav>
  </header>
  <div class="rx-body"></div>
</div>`;
const app = $('.rx-body', VIEW_EL);

// ---------- the collection, read ----------
const col = () => S.meta.get('col') as ColMeta;
const ck = () => clock(col().day0, col().rollover);
const conf = (): Conf => S.confs.get(col().conf) ?? [...S.confs.values()][0];
const typeOf = (n: Note) => S.types.get(n.mid);
const rowOf = (c: Card): Row | null => {
  const note = S.notes.get(c.nid);
  return note ? { card: c, note, type: typeOf(note) } : null;
};
const cardsOf = (nid: number) => [...S.cards.values()].filter((c) => c.nid === nid).sort((a, b) => a.ord - b.ord);
const live = () => [...S.cards.values()].filter((c) => S.notes.has(c.nid));
/** The cards reviews can show: a card whose front would be empty (no picture for Pic → word) is skipped, as Anki would
 *  never have made it; it comes back by itself once the note has what its front needs. */
const studyable = () => showable(live(), (id) => S.notes.get(id), typeOf);
/** What a note is about: its Word field, else its sort field, else its first field. */
const wordOfNote = (n: Note) => wordOf(typeOf(n), n) || sortText(typeOf(n), n) || strip(n.flds.find((f) => strip(f)) ?? '');
const wordOfCard = (c: Card) => {
  const n = S.notes.get(c.nid);
  return n ? wordOfNote(n) : '';
};
const dueText = (c: Card, k = ck()) => {
  if (c.queue === -1) return 'Suspended';
  if (c.type === 0) return 'New';
  if (c.queue === 1) return new Date(c.due * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const d = c.due - k.today;
  return d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 0 ? `${-d} days late` : new Date(Date.now() + d * 864e5).toLocaleDateString([], { month: 'short', day: 'numeric', ...(d > 300 ? { year: 'numeric' } : {}) });
};
const unsuspended = (c: Card) => (c.type === 0 ? 0 : c.type === 2 ? 2 : c.type === 3 ? 1 : 1);

/** What today already holds: cards started, reviews done, notes seen (one card per note a day). */
function today() {
  const k = ck();
  let fresh = 0, revs = 0, done = 0;
  const seen = new Set<number>();
  for (const c of S.cards.values()) {
    const t = c.revs.filter((r) => k.dayOf(r[0]) === k.today && r[6] <= 3 && r[1] > 0);
    if (!t.length) continue;
    done += t.length;
    seen.add(c.nid);
    if (c.revs[0] && k.dayOf(c.revs[0][0]) === k.today && c.revs[0][6] === 0) fresh++;
    if (t.some((r) => r[6] === 1)) revs++;
  }
  return { fresh, revs, seen, done };
}
/** Studying past today's limits (the buttons under 今天複習完了): more new cards today, or reviews from the days ahead. */
const MORE = { day: -1, fresh: 0, ahead: false };
const more = () => {
  const d = ck().today;
  if (MORE.day !== d) Object.assign(MORE, { day: d, fresh: 0, ahead: false });
  return MORE;
};
function todayQueue() {
  const k = ck(), t = today();
  return { k, t, q: queue(studyable(), conf(), k, new Set(t.seen), Math.max(0, t.fresh - more().fresh), t.revs) };
}
/** The next review due after today (earliest first), one card per note today; for reviewing ahead. */
function ahead(): Card | null {
  const k = ck(), seen = today().seen;
  return studyable().filter((c) => (c.queue === 2 || c.queue === 3) && c.due > k.today && !seen.has(c.nid)).sort((a, b) => a.due - b.due || a.id - b.id)[0] ?? null;
}

// ---------- toasts (the board's look: .toast) ----------
let toastEl: HTMLElement | null = null, toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, undoable = false) {
  hideToast(true);
  toastEl?.remove();
  const el = (toastEl = document.createElement('div'));
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${msg}</span>${undoable ? '<button type="button">Undo</button>' : ''}`;
  if (undoable) el.querySelector('button')!.onclick = () => (dropToast(), undo());
  document.body.append(el);
  clearTimeout(toastT);
  toastT = setTimeout(dropToast, 5000);
}
function dropToast() {
  const el = toastEl;
  toastEl = null;
  if (!el) return;
  el.classList.add('out');
  setTimeout(() => el.remove(), 220);
}

// ---------- undo and redo: every change he makes here, both ways (Cmd+Z, Shift+Cmd+Z) ----------
type Change = [Kind, number | string, any, any];
type Step = { name: string; rows: Change[]; card?: number };
const H = { undo: [] as Step[], redo: [] as Step[] };
const clone = <T>(x: T): T => (x == null ? x : JSON.parse(JSON.stringify(x)));
const revIds = (c: Card | null | undefined) => new Set((c?.revs ?? []).map((r) => r[0]));
/** Makes a change he can take back: each row from what it is now to `after`. */
async function change(name: string, rows: [Kind, number | string, any][], card?: number) {
  const cur = (k: Kind, id: number | string) => (k === 'card' ? S.cards.get(+id) : k === 'note' ? S.notes.get(+id) : k === 'conf' ? S.confs.get(+id) : k === 'notetype' ? S.types.get(+id) : S.meta.get(String(id)));
  const step: Step = { name, card, rows: rows.map(([k, id, after]) => [k, id, clone(cur(k, id) ?? null), clone(after)]) };
  H.undo.push(step);
  if (H.undo.length > 200) H.undo.shift();
  H.redo = [];
  await apply(step, 'after');
}
async function apply(step: Step, side: 'before' | 'after') {
  const other = side === 'after' ? 'before' : 'after';
  await putMany(
    step.rows.map(([k, id, before, after]) => {
      const data = clone(side === 'after' ? after : before), was = side === 'after' ? before : after;
      // reviews the other side has and this one doesn't leave the server too
      const gone = k === 'card' ? [...revIds(was)].filter((x) => !revIds(data).has(x)) : [];
      return [k, id, data, gone.length ? gone : undefined] as [Kind, number | string, any, number[]?];
    }),
  );
  void other;
}
async function undo() {
  const s = H.undo.pop();
  if (!s) return;
  await apply(s, 'before');
  H.redo.push(s);
  sfx('unstamp');
  afterHistory(s, true);
}
async function redo() {
  const s = H.redo.pop();
  if (!s) return;
  await apply(s, 'after');
  H.undo.push(s);
  sfx('tap');
  afterHistory(s, false);
}
function afterHistory(s: Step, undone: boolean) {
  toast(`${undone ? 'Undone' : 'Redone'}: ${esc(s.name)}`);
  if (view === 'review') {
    // undoing an answer brings that card back, question side up
    if (undone && s.card && S.cards.has(s.card)) {
      RV.cur = S.cards.get(s.card)!;
      RV.shown = false;
      RV.py = RUBY.shown();
      RV.t0 = Date.now();
      RV.panel = '';
    } else RV.cur = null;
    showReview();
  } else paint();
}

// ---------- a card on screen ----------
/** The card's sounds, one after another, through the one player (a new sound stops the one playing). */
function playAll(root: ShadowRoot | null | undefined) {
  if (!root) return;
  const list = [...root.querySelectorAll<HTMLElement>('[data-sound]')].map((b) => b.dataset.sound!);
  if (list.length) void SOUND.play(list);
}
/** What played by itself last, so drawing the same side again (an edit, a sync) doesn't play it again. */
let autoplayed = '';
const cardCss = (t: NoteType) => t.css.replace(/@import[^;]+;/g, '');
// his styling, then the board's ground under it: no white box, no "Show Pinyin" link or play buttons (P and V do those)
const OVER = `:host{display:block}.card{background:transparent!important;min-height:100%;box-sizing:border-box}hr{border:0;border-top:1px solid #E4E6EC;margin:22px 0}
a.hint,.snd-btn,.hint-body{display:none!important}.audio:not(:has(:not(.snd-btn))){display:none}
img{max-width:100%!important;max-height:min(46vh,460px)!important;width:auto!important;height:auto!important;object-fit:contain!important}`;
/** Draws one side of a card into `host` with his CSS, kept apart from the page's (a shadow root). */
function draw(host: HTMLElement, r: Row, side: 'q' | 'a') {
  const t = r.type!, tmpl = t.templates.find((x) => x.ord === r.card.ord) ?? t.templates[0];
  const ctx = { note: r.note, type: t, card: r.card, deck: S.decks.get(r.card.did)?.name };
  const q = render(tmpl.qfmt, ctx);
  const html = side === 'q' ? q : render(tmpl.afmt, ctx, q);
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${cardCss(t)}${OVER}${RUBY.CSS}</style><div class="card card${r.card.ord + 1}">${html}</div>`;
  return root;
}

// ---------- views inside the tab ----------
type View = 'review' | 'browse' | 'designs';
let view: View = 'review';
function go(v: View) {
  if (view === 'browse' && v !== 'browse') closeSide();
  view = v;
  VIEW_EL.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.v === v)));
  app.className = 'rx-body v-' + v;
  ($('.rx', VIEW_EL) as HTMLElement).dataset.rx = v;
  paint();
  try {
    sessionStorage.setItem('cbp-rx', v);
  } catch {}
}
function paint() {
  if (!ready) return;
  if (view === 'review') showReview();
  else if (view === 'browse') showBrowse();
  else showDesigns();
}
VIEW_EL.querySelectorAll<HTMLElement>('[data-v]').forEach(
  (b) =>
    (b.onclick = () => {
      const v = b.dataset.v as View;
      sfx('tap');
      if (v === 'browse') resetBrowse();
      go(v);
    }),
);

// ================= Review =================
/** A sitting: from the first card on screen until he leaves the tab (BUS 'reviews:start'). */
let sitting = false;
const RV = { cur: null as Card | null, shown: false, py: false, t0: 0, sinceNew: 0, panel: '' as '' | 'deeper', merge: null as null | [number, number], deeperFor: 0, flags: false };

function pick(): Card | null {
  const { k, q } = todayQueue();
  const now = q.learn.filter((c) => c.due * 1000 <= k.now);
  if (now.length) return now[0];
  const { review, fresh } = q;
  // new cards spread through the reviews (Anki's "mix with reviews")
  if (fresh.length && (!review.length || RV.sinceNew >= Math.max(1, Math.floor(review.length / fresh.length)))) return fresh[0];
  if (review.length) return review[0];
  return q.learn[0] ?? (more().ahead ? ahead() : null);
}
const left = () => {
  const { q } = todayQueue();
  return q.fresh.length + q.learn.length + q.review.length;
};

function showReview(): void {
  if (RV.panel === 'deeper') return showDeeper();
  if (!RV.cur || !S.cards.has(RV.cur.id) || RV.cur !== S.cards.get(RV.cur.id) || RV.cur.queue < 0) {
    RV.cur = pick();
    RV.shown = false;
    RV.py = RUBY.shown();
    RV.t0 = Date.now();
  }
  const c = RV.cur, t = today(), n = c ? Math.max(1, left()) : 0;
  // how far through today: a hairline, no numbers; full once nothing is left
  const prog = `<div class="rx-prog" aria-hidden="true"><i style="width:${n ? Math.round((t.done / (t.done + n)) * 100) : 100}%"></i></div>`;
  paintDot();
  if (!c) {
    const nextLearn = live().filter((x) => x.queue === 1).sort((a, b) => a.due - b.due)[0];
    const anyNew = live().some((x) => x.queue === 0);
    app.innerHTML = `${prog}<section class="rw rw-end"><p class="rw-done zh">今天複習完了</p>
      ${nextLearn ? `<p class="rw-later">One more at ${new Date(nextLearn.due * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>` : ''}
      <div class="rw-again">${anyNew ? '<button type="button" class="btn-q" data-more="new">Ten more new</button>' : ''}${ahead() ? '<button type="button" class="btn-q" data-more="ahead">Review ahead</button>' : ''}</div></section>`;
    app.querySelectorAll<HTMLElement>('[data-more]').forEach(
      (b) =>
        (b.onclick = () => {
          const m = more();
          if (b.dataset.more === 'new') m.fresh += 10;
          else m.ahead = true;
          sfx('tap');
          showReview();
        }),
    );
    doneToday();
    return;
  }
  const r = rowOf(c)!;
  const flag = c.flags & 7;
  app.innerHTML = `${prog}<section class="rw${flag ? ' fl' + flag : ''}">
    ${RV.merge ? mergeBanner() : ''}
    <div class="rw-card"><div class="host${RV.py ? ' py' : ''}"></div></div>
    <div class="rw-bar">${RV.shown ? `<div class="rw-g">${['Again', 'Hard', 'Good', 'Easy'].map((x, i) => `<button type="button" class="rw-a rw-a${i + 1}" data-g="${i + 1}">${x}</button>`).join('')}</div>` : `<button type="button" class="rw-show" data-a="show">Show answer</button>`}</div>
    <div class="rw-more rx-opt">
      ${TOUCH ? `<button type="button" class="btn-q" data-a="py">Pinyin</button>` : ''}<button type="button" class="btn-q rw-snd" data-a="play" aria-label="Play" hidden>${SPEAKER}</button>
      <button type="button" class="btn-q" data-a="edit">Edit</button><button type="button" class="btn-q rw-flagb" data-a="flag" aria-haspopup="dialog" aria-expanded="${RV.flags}">Flag</button><button type="button" class="btn-q" data-a="suspend">Suspend</button>
    </div>
    ${RV.flags ? flagPicker(c) : ''}
  </section>`;
  const host = $('.host', app);
  const root = draw(host, r, RV.shown ? 'a' : 'q');
  // a side with sound: a tap on the card plays it (a phone doesn't play by itself), and the speaker does the same
  const loud = !!root.querySelector('[data-sound]');
  $('.rw-snd', app).hidden = !loud;
  host.classList.toggle('loud', loud);
  if (loud) host.onclick = (e) => !e.composedPath().some((x) => x instanceof HTMLElement && x.matches('a,button,input,[contenteditable]')) && !String(getSelection() ?? '') && playAll(root);
  // each side plays by itself once (Settings › Card audio plays by itself), not again when it's drawn again
  const side = `${c.id}:${RV.shown ? 'a' : 'q'}`;
  if (side !== autoplayed) {
    autoplayed = side;
    if (SOUND.autoplay()) playAll(root);
  }
  if (RV.py) void RUBY.set(root.querySelector('.card'), true);
  if (!sitting) {
    sitting = true;
    BUS.emit('reviews:start');
  }
  bindReview();
}
function bindReview() {
  app.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => (b.onclick = () => act(b.dataset.a!)));
  app.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => (b.onclick = () => grade(Number(b.dataset.g))));
  app.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => flagIt(Number(b.dataset.f))));
  app.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => (b.onclick = () => mergeAct(b.dataset.m!)));
}

/** Today's reviews just ran out, after he answered (or suspended, or deleted) one here: BUS 'reviews:done', once a day,
 *  with confetti on the end screen. The habit and the character listen for it. */
let acted = false, doneDay = '';
function doneToday() {
  if (!acted) return;
  acted = false;
  const d = String(ck().today);
  try {
    if (localStorage.getItem('rv-done') === d) doneDay = d;
    else localStorage.setItem('rv-done', d);
  } catch {}
  if (doneDay === d) return;
  doneDay = d;
  BUS.emit('reviews:done');
}
BUS.on('reviews:done', () => {
  const el = VIEW === 'reviews' ? app.querySelector('.rw-done') : null;
  if (!el) return;
  const b = el.getBoundingClientRect();
  try {
    FUN?.celebrate('test', { x: b.left + b.width / 2, y: b.top + b.height / 2 });
  } catch {}
});
const SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" fill="currentColor"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.2 6.2a8.2 8.2 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

async function grade(g: number) {
  const c = RV.cur;
  if (!c || !RV.shown) return;
  const r = rowOf(c)!;
  const a = answer(c, g, conf(), ck(), Date.now() - RV.t0);
  const rows: [Kind, number, any][] = [['card', c.id, a.card]];
  if (a.leech && !r.note.tags.includes('leech')) rows.push(['note', r.note.id, { ...r.note, tags: [...r.note.tags, 'leech'] }]);
  await change(['Again', 'Hard', 'Good', 'Easy'][g - 1], rows, c.id);
  acted = true;
  BUS.emit('reviews:card', { grade: g, card: c.id, word: wordOfNote(r.note), left: left() });
  RV.sinceNew = c.type === 0 ? 0 : RV.sinceNew + 1;
  RV.cur = null;
  RV.flags = false;
  if (g === 1 && missed3(a.card)) {
    RV.panel = 'deeper';
    RV.deeperFor = a.card.id;
  } else if (g >= 3 && right3(a.card)) {
    const other = related(a.card);
    if (other) RV.merge = [a.card.nid, other];
  }
  showReview();
}

async function act(a: string) {
  const c = RV.cur;
  if (a === 'show') {
    if (!c || RV.shown) return;
    RV.shown = true;
    return showReview();
  }
  if (!c) return;
  if (a === 'py') {
    RV.py = !RV.py;
    sfx('tap');
    return void RUBY.set($('.host', app)?.shadowRoot?.querySelector('.card'), RV.py);
  }
  if (a === 'play') return playAll($('.host', app)?.shadowRoot);
  if (a === 'edit') return editDialog(S.notes.get(c.nid)!);
  if (a === 'flag') {
    RV.flags = !RV.flags;
    return showReview();
  }
  if (a === 'suspend') {
    await change('Suspend', [['card', c.id, { ...c, queue: -1 }]], c.id);
    sfx('drop');
    acted = true;
    RV.cur = null;
    showReview();
    toast(`Suspended <span class="zh">${esc(wordOfCard(c))}</span>`, true);
  }
}

// ---------- flags: red (too hard, needs changing) and green (combine it with another card) ----------
const FLAG_NAME: Record<number, string> = { 1: 'Red', 3: 'Green' };
function flagPicker(c: Card) {
  const f = c.flags & 7;
  return `<div class="rw-flags" role="dialog" aria-label="Flag">
    <button type="button" class="fl-b fl-r${f === 1 ? ' on' : ''}" data-f="1"><i></i>Red<kbd>R</kbd></button>
    <button type="button" class="fl-b fl-g${f === 3 ? ' on' : ''}" data-f="3"><i></i>Green<kbd>G</kbd></button>
    ${f ? `<button type="button" class="fl-b fl-0" data-f="0"><i></i>None<kbd>N</kbd></button>` : ''}
  </div>`;
}
async function flagIt(f: number, cards?: Card[]) {
  const list = cards ?? (RV.cur ? [RV.cur] : []);
  if (!list.length) return;
  const to = list.every((c) => (c.flags & 7) === f) ? 0 : f;
  await change(to ? `${FLAG_NAME[to]} flag` : 'Flag off', list.map((c) => ['card', c.id, { ...c, flags: (c.flags & ~7) | to }]));
  sfx(to ? 'stamp' : 'unstamp');
  RV.flags = false;
  if (!cards && RV.cur) RV.cur = S.cards.get(RV.cur.id)!;
  if (view === 'review') showReview();
  else paintBrowse();
  if (to === 3 && !cards) toast(`Green: <span class="zh">${esc(wordOfCard(list[0]))}</span> waits in Browse for a partner`, true);
}

// ---------- missed three times in a row: five minutes of going deeper, or delete it ----------
let deeperTimer: ReturnType<typeof setInterval> | undefined;
function showDeeper(): void {
  const c = S.cards.get(RV.deeperFor), r = c && rowOf(c);
  if (!r) return ((RV.panel = ''), showReview());
  const word = wordOfNote(r.note);
  app.innerHTML = `<section class="deeper"><p class="dw zh">${esc(word)}</p><p class="dsub">Missed three times in a row.</p>
    <div class="dact"><button type="button" class="btn" data-d="go">Five minutes on it</button><button type="button" class="btn-q" data-d="del">Delete it</button><button type="button" class="btn-q" data-d="skip">Not now</button></div>
    <div class="dbody" hidden><div class="dtimer" aria-live="off"></div><div class="dtext"></div>
    <div contenteditable="true" class="dnote" role="textbox" aria-multiline="true" aria-label="Your note, added to Notes" data-ph="Your note, added to Notes"></div>
    <button type="button" class="btn" data-d="done">Back to reviews</button></div></section>`;
  const body = $('.dbody', app);
  app.querySelectorAll<HTMLElement>('[data-d]').forEach(
    (b) =>
      (b.onclick = async () => {
        const d = b.dataset.d;
        if (d === 'skip') return endDeeper();
        if (d === 'del') {
          acted = true;
          await deleteNote(r.note.id);
          endDeeper();
          return;
        }
        if (d === 'done') {
          const mine = $('.dnote', app).innerHTML.trim();
          const i = fieldIndex(r.type!, 'Notes');
          if (strip(mine) && i >= 0) {
            const flds = [...r.note.flds];
            flds[i] = flds[i] ? `${flds[i]}<br>${mine}` : mine;
            await change('Note added', [['note', r.note.id, { ...r.note, flds }]]);
          }
          return endDeeper();
        }
        // Claude's take, and five minutes on the clock
        $('.dact', app).hidden = true;
        body.hidden = false;
        const end = Date.now() + 5 * 60e3;
        const tick = () => {
          const l = Math.max(0, end - Date.now());
          const el = $('.dtimer', app);
          if (el) el.textContent = `${Math.floor(l / 60e3)}:${String(Math.floor((l % 60e3) / 1000)).padStart(2, '0')}`;
          if (!l || !el) clearInterval(deeperTimer);
        };
        tick();
        deeperTimer = setInterval(tick, 1000);
        const text = $('.dtext', app);
        text.textContent = navigator.onLine ? '…' : 'Needs signal. Use the five minutes with your own notes.';
        if (!navigator.onLine) return;
        try {
          const i = (n: string) => fieldIndex(r.type!, n);
          const out = await api('anki/deeper', { word, sentence: strip(r.note.flds[i('Chinese')] ?? ''), notes: strip(r.note.flds[i('Notes')] ?? ''), near: nearWords(r.note).slice(0, 30), model: `claude-${LAB.get('deeper-model')}-5-5` });
          text.innerHTML = esc(out.text).replace(/\n/g, '<br>');
        } catch (e) {
          text.textContent = (e as Error).message;
        }
      }),
  );
}
function endDeeper() {
  clearInterval(deeperTimer);
  RV.panel = '';
  showReview();
}
const HAN = /\p{Script=Han}/u;
/** His other notes that share a character with this one's word. */
function nearNotes(note: Note) {
  const w = wordOfNote(note);
  const chars = new Set([...w].filter((x) => HAN.test(x)));
  const out = new Map<string, Note>();
  for (const n of S.notes.values()) {
    if (n.id === note.id) continue;
    const o = wordOfNote(n);
    if (o && o !== w && !out.has(o) && [...o].some((x) => chars.has(x))) out.set(o, n);
  }
  return [...out.values()];
}
const nearWords = (note: Note) => nearNotes(note).map((n) => wordOfNote(n));

// ---------- right three times in a row next to a related card: one card about the difference ----------
const mergeNo = () => new Set<string>((S.meta.get('mergeNo')?.pairs as string[]) ?? []);
const pairKey = (a: number, b: number) => [a, b].sort().join('-');
/** A note sharing a character with this card's word, also right three times running and seen in the last day. A note he
 *  flagged green (wants to combine) comes first. */
function related(c: Card): number | null {
  const note = S.notes.get(c.nid);
  if (!note) return null;
  const w = wordOfNote(note), chars = new Set([...w].filter((x) => HAN.test(x)));
  if (!chars.size) return null;
  const no = mergeNo(), k = ck();
  let best: [number, number] | null = null;
  for (const o of live()) {
    if (o.nid === c.nid || o.queue < 0 || no.has(pairKey(c.nid, o.nid))) continue;
    const last = o.revs[o.revs.length - 1];
    if (!last || k.today - k.dayOf(last[0]) > 1 || !right3(o)) continue;
    const ow = wordOfCard(o);
    if (!ow || ow === w || ![...ow].some((x) => chars.has(x))) continue;
    const score = (o.flags & 7) === 3 ? 2 : 1;
    if (!best || score > best[1]) best = [o.nid, score];
  }
  return best?.[0] ?? null;
}
function mergeBanner() {
  const [a, b] = RV.merge!.map((id) => S.notes.get(id));
  if (!a || !b) return '';
  return `<div class="rw-merge"><span><b class="zh">${esc(wordOfNote(a))}</b> and <b class="zh">${esc(wordOfNote(b))}</b> are both easy now. One harder card about the difference?</span>
    <span class="mact"><button type="button" class="btn" data-m="write">Write it</button><button type="button" class="btn-q" data-m="no">Not these</button></span></div>`;
}
async function mergeAct(m: string) {
  if (!RV.merge) return;
  const [x, y] = RV.merge;
  RV.merge = null;
  if (m === 'no') {
    await put('meta', 'mergeNo', { pairs: [...mergeNo(), pairKey(x, y)] });
    return showReview();
  }
  combine(x, y);
}
/** One card about the difference: Claude writes it on the Cards page and he makes the note there, as with any card. Once
 *  that note reaches the collection, the two old cards rest (suspended; Undo brings them back). If he drops the card
 *  instead, or never makes it, nothing was suspended. */
type Pair = { words: string; nids: [number, number]; at: number };
const pairs = (): Pair[] => (S.meta.get('combine')?.list as Pair[]) ?? [];
async function combine(x: number, y: number) {
  const [a, b] = [S.notes.get(x), S.notes.get(y)];
  if (!a || !b) return;
  const words = `${wordOfNote(a)}、${wordOfNote(b)}`;
  await put('meta', 'combine', { list: [...pairs().filter((p) => p.words !== words), { words, nids: [x, y], at: Date.now() }] });
  // openCard moves to the Cards page itself (setView first made that page open on the card it had before)
  try {
    openCard(words, 'any');
  } catch {}
}
/** The pairs waiting on a combined card: its note arrived (the old cards rest), it was dropped, or it's two weeks old. */
let settling = false;
async function settlePairs() {
  const list = pairs();
  if (!ready || settling || !list.length) return;
  settling = true;
  try {
    const keep: Pair[] = [];
    for (const p of list) {
      const parts = p.words.split('、');
      const made = [...S.notes.values()].find((n) => n.id > p.at - 60e3 && !p.nids.includes(n.id) && parts.every((w) => wordOfNote(n).includes(w)));
      const doc = typeof CD !== 'undefined' && typeof cardId === 'function' ? CD.docs[cardId(p.words)] : undefined;
      if (made) {
        const old = [...cardsOf(p.nids[0]), ...cardsOf(p.nids[1])].filter((c) => c.queue >= 0);
        if (old.length) {
          await change('Combine', old.map((c) => ['card', c.id, { ...c, queue: -1, flags: (c.flags & 7) === 3 ? c.flags & ~7 : c.flags }]));
          if (VIEW === 'reviews') toast(`<span class="zh">${esc(p.words)}</span>: the old cards rest`, true);
        }
      } else if (!doc?.dropped && Date.now() - p.at < 14 * 864e5) keep.push(p);
    }
    if (keep.length !== list.length) await put('meta', 'combine', { list: keep });
  } finally {
    settling = false;
  }
}
// the card Claude writes for a pair is about the difference (the Cards page's prompt, with this added for a pair)
if (typeof cardPrompt === 'function') {
  const base = cardPrompt;
  cardPrompt = (kit, word) => {
    const p = pairs().find((x) => x.words === word);
    if (!p) return base(kit, word);
    const [a, b] = p.words.split('、');
    return `${base(kit, word)}

=== A PAIR ===
${a} and ${b} are both easy for him now. This card replaces their two cards: it is about the difference between them, the one thing he could still mix up. word: ${word}. pinyin: both readings. meaning: the difference, in a few words. ex: exactly two sentences, one where only ${a} fits and one where only ${b} fits. know: 2 or 3 points on when a Taiwanese person reaches for which. One char: line per distinct character, no how: lines, no second: line.`;
  };
}

// ================= the editor: his fields, and a quiet delete =================
const pasteNote = new WeakMap<HTMLElement, Note>();
function editor(host: HTMLElement, note0: Note, onClose?: () => void) {
  const t = typeOf(note0)!;
  const start = clone(note0);
  let note = note0;
  host.innerHTML = `<div class="ed">${t.fields
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((f) => `<label class="ef"><span>${esc(f.name)}</span><div class="fv${/chinese|word|sentence|mnemonic/i.test(f.name) ? ' zh' : ''}" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" data-o="${f.ord}">${note.flds[f.ord] ?? ''}</div></label>`)
    .join('')}
    <div class="ed-end"><button type="button" class="ed-del" data-e="del">Delete note</button></div></div>`;
  let saveT: ReturnType<typeof setTimeout> | undefined;
  const read = (): Note => {
    const flds = [...note.flds];
    host.querySelectorAll<HTMLElement>('.fv').forEach((f) => (flds[Number(f.dataset.o)] = clean(f.innerHTML)));
    return { ...note, flds };
  };
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      note = read();
      if (JSON.stringify(note.flds) !== JSON.stringify(S.notes.get(note.id)?.flds)) await put('note', note.id, note);
    }, 400);
  };
  host.querySelectorAll<HTMLElement>('.fv').forEach((f) => {
    pasteNote.set(f, note);
    f.addEventListener('input', save);
    f.addEventListener('paste', (e) => pasteInto(e, f, save));
    f.addEventListener('drop', (e) => dropInto(e, f, save));
  });
  $('[data-e="del"]', host).onclick = async () => {
    clearTimeout(saveT);
    await deleteNote(note.id);
    onClose?.();
  };
  // V (not typing): the sentence read aloud into the Audio field, made now if it has none (Shift+V makes it again)
  const ai = t.fields.find((f) => /^audio$/i.test(f.name))?.ord ?? -1;
  const si = t.fields.find((f) => /^chinese$/i.test(f.name))?.ord ?? 0;
  let voicing = false;
  ED = {
    host,
    voice: async (again: boolean) => {
      if (voicing) return;
      const fa = host.querySelector<HTMLElement>(`.fv[data-o="${ai}"]`), fs = host.querySelector<HTMLElement>(`.fv[data-o="${si}"]`);
      if (!fa || !fs) return;
      const have = /\[sound:([^\]]+)\]/.exec(fa.textContent ?? '');
      if (have && !again) return void SOUND.play(have[1]);
      const text = strip(fs.innerHTML.replace(/<br\s*\/?>|<\/div>/gi, '\n')).replace(/[ \t]+/g, ' ').trim();
      if (!text) return toast('The sentence is empty.');
      if (!navigator.onLine) return toast('The voice needs signal.');
      fa.classList.add('busy');
      voicing = true;
      try {
        const { url } = await api('voice', { text });
        fa.textContent = `[sound:${url}]`;
        save();
        sfx('save');
        void SOUND.play(url);
      } catch (e) {
        toast(esc((e as Error).message || 'The voice didn’t come through.'));
      } finally {
        voicing = false;
        fa.classList.remove('busy');
      }
    },
  };
  /** Called when the editor goes away: the edit joins the undo history as one step. */
  return async () => {
    if (ED?.host === host) ED = null;
    clearTimeout(saveT);
    if (!S.notes.has(note.id)) return;
    const now = read();
    if (JSON.stringify(now.flds) === JSON.stringify(start.flds)) return;
    await put('note', now.id, now);
    H.undo.push({ name: 'Edit', rows: [['note', now.id, start, clone(S.notes.get(now.id))]] });
    H.redo = [];
  };
}
let ED: { host: HTMLElement; voice: (again: boolean) => Promise<void> } | null = null;
const clean = (h: string) => h.replace(/^(<br>)+$/, '').replace(/\s+data-[\w-]+="[^"]*"/g, '');

function editDialog(note: Note) {
  const d = document.createElement('dialog');
  d.className = 'rx-dlg';
  d.innerHTML = `<div class="dlg-top"><span class="dlg-w zh">${esc(wordOfNote(note))}</span><button type="button" class="dlg-x" aria-label="Close">×</button></div><div class="dlg-ed"></div>`;
  document.body.append(d);
  const done = editor($('.dlg-ed', d), note, () => d.close());
  $('.dlg-x', d).onclick = () => d.close();
  d.addEventListener('click', (e) => e.target === d && d.close());
  d.addEventListener('close', async () => {
    await done();
    d.remove();
    if (RV.cur) RV.cur = S.cards.get(RV.cur.id) ?? null;
    if (view === 'review') showReview();
  });
  d.showModal();
  ($('.fv', d) as HTMLElement | null)?.focus();
}

/** A picture pasted or dropped into a field: kept on the site, then put in. */
async function pasteInto(e: ClipboardEvent, f: HTMLElement, save: () => void) {
  const file = [...(e.clipboardData?.files ?? [])].find((x) => /^image\//.test(x.type));
  if (!file) return;
  e.preventDefault();
  await upload(file, f, save);
}
async function dropInto(e: DragEvent, f: HTMLElement, save: () => void) {
  const file = [...(e.dataTransfer?.files ?? [])].find((x) => /^image\//.test(x.type));
  if (!file) return;
  e.preventDefault();
  await upload(file, f, save);
}
async function upload(file: File, f: HTMLElement, save: () => void) {
  if (!navigator.onLine) return toast('Pictures need signal.');
  try {
    const r = await fetch('/api/plus/upload', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('cb-token') ?? ''}`, 'Content-Type': file.type }, body: file });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    f.focus();
    document.execCommand('insertHTML', false, `<img src="${j.url}">`);
    save();
  } catch (err) {
    toast(esc((err as Error).message || 'The picture didn’t come through.'));
  }
}

async function deleteNote(nid: number, quiet = false) {
  const n = S.notes.get(nid);
  if (!n) return;
  const w = wordOfNote(n);
  await change(`Delete ${w}`, [['note', nid, null], ...cardsOf(nid).map((c) => ['card', c.id, null] as [Kind, number, null])]);
  sfx('drop');
  if (!quiet) toast(`Deleted <span class="zh">${esc(w)}</span>`, true);
}

// ================= Browse =================
const BR = { q: '', flag: 0, sort: 'added', desc: true, sel: new Set<number>(), last: 0, focus: 0, limit: 300, close: null as null | (() => Promise<void>) };
/** Browse as it opens: every card, newest first. */
function resetBrowse() {
  Object.assign(BR, { q: '', flag: 0, sort: 'added', desc: true, sel: new Set<number>(), last: 0, limit: 300 });
}
const ADDED = (r: Row) => r.note.id * 10 + r.card.ord;
const COLS: [string, string, (r: Row, k: ReturnType<typeof ck>) => string | number][] = [
  ['sort', 'Word', (r) => wordOfNote(r.note)],
  ['card', 'Card', (r) => r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? ''],
  ['due', 'Due', (r, k) => (r.card.queue === -1 ? 1e9 : r.card.type === 0 ? 1e8 + r.card.due : r.card.queue === 1 ? k.dayOf(r.card.due * 1000) : r.card.due)],
  ['ivl', 'Interval', (r) => (r.card.type === 0 ? -1 : r.card.ivl)],
];
function showBrowse() {
  app.innerHTML = `<section class="br">
    <div class="br-top"><input class="br-q" type="search" placeholder="Search" aria-label="Search" value="${esc(BR.q)}" spellcheck="false" enterkeyhint="search" lang="zh-Hant">
      <div class="br-f" role="radiogroup" aria-label="Flag">${[[0, 'All'], [1, 'Red'], [3, 'Green']].map(([f, l]) => `<button type="button" role="radio" data-fl="${f}" aria-checked="${BR.flag === f}">${f ? `<i class="fd fd${f}"></i>` : ''}${l}</button>`).join('')}</div></div>
    <div class="br-bulk" hidden></div>
    <div class="br-main"><div class="br-tbl" role="grid" aria-label="Cards"></div><aside class="br-side" hidden></aside></div></section>`;
  const q = $<HTMLInputElement>('.br-q', app);
  let t: ReturnType<typeof setTimeout> | undefined;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => ((BR.q = q.value), (BR.limit = 300), paintBrowse()), 180);
  };
  app.querySelectorAll<HTMLElement>('[data-fl]').forEach(
    (b) =>
      (b.onclick = () => {
        BR.flag = Number(b.dataset.fl);
        app.querySelectorAll('[data-fl]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        BR.limit = 300;
        sfx('tap');
        paintBrowse();
      }),
  );
  paintBrowse();
}
function results() {
  const k = ck();
  const test = search(BR.q, k.today, k.dayOf);
  const rows = live()
    .map(rowOf)
    .filter((r): r is Row => !!r && (!BR.flag || (r.card.flags & 7) === BR.flag) && test(r));
  const by = BR.sort === 'added' ? ADDED : COLS.find((c) => c[0] === BR.sort)![2];
  rows.sort((a, b) => {
    const x = by(a, k), y = by(b, k);
    const o = typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'zh-Hant');
    return BR.desc ? -o : o;
  });
  return rows;
}
function paintBrowse() {
  if (view !== 'browse' || !$('.br', app)) return;
  const k = ck(), rows = results(), shown = rows.slice(0, BR.limit);
  const tbl = $('.br-tbl', app);
  tbl.innerHTML = `<div class="tr th" role="row">${COLS.map(([key, name]) => `<button type="button" role="columnheader" class="td c-${key}${BR.sort === key ? (BR.desc ? ' desc' : ' asc') : ''}" data-sort="${key}" aria-sort="${BR.sort === key ? (BR.desc ? 'descending' : 'ascending') : 'none'}">${name}</button>`).join('')}</div>
    ${shown
      .map(
        (r) =>
          `<div class="tr${BR.sel.has(r.card.id) ? ' sel' : ''}${r.card.queue === -1 ? ' susp' : ''}" data-c="${r.card.id}" role="row" aria-selected="${BR.sel.has(r.card.id)}"><span class="td c-sort zh">${r.card.flags & 7 ? `<i class="fd fd${r.card.flags & 7}"></i>` : ''}${esc(wordOfNote(r.note))}</span><span class="td c-card">${esc(r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? '')}</span><span class="td c-due">${dueText(r.card, k)}</span><span class="td c-ivl">${r.card.ivl && r.card.type ? label(r.card.ivl) : ''}</span></div>`,
      )
      .join('')}
    ${rows.length > shown.length ? `<button type="button" class="btn-q br-more">Show all</button>` : ''}${rows.length ? '' : '<p class="br-none">Nothing matches.</p>'}`;
  tbl.querySelectorAll<HTMLElement>('[data-sort]').forEach(
    (b) =>
      (b.onclick = () => {
        BR.desc = BR.sort === b.dataset.sort ? !BR.desc : false;
        BR.sort = b.dataset.sort!;
        paintBrowse();
      }),
  );
  $('.br-more', tbl)?.addEventListener('click', () => ((BR.limit = 1e9), paintBrowse()));
  tbl.querySelectorAll<HTMLElement>('.tr[data-c]').forEach(
    (tr) =>
      (tr.onclick = (e) => {
        const id = Number(tr.dataset.c);
        if (e.shiftKey && BR.last) {
          const ids = shown.map((r) => r.card.id), a = ids.indexOf(BR.last), b = ids.indexOf(id);
          ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => BR.sel.add(x));
        } else if (e.metaKey || e.ctrlKey) BR.sel.has(id) ? BR.sel.delete(id) : BR.sel.add(id);
        else if (BR.sel.size === 1 && BR.sel.has(id)) BR.sel = new Set(); // the open one again: the panel closes
        else BR.sel = new Set([id]);
        BR.last = id;
        paintSel();
      }),
  );
  paintSel();
}
/** The selection: one card opens its note beside the list, several get the actions for all of them. */
async function paintSel() {
  const sel = [...BR.sel].map((id) => S.cards.get(id)).filter((c): c is Card => !!c && S.notes.has(c.nid));
  app.querySelectorAll<HTMLElement>('.tr[data-c]').forEach((tr) => {
    const on = BR.sel.has(Number(tr.dataset.c));
    tr.classList.toggle('sel', on);
    tr.setAttribute('aria-selected', String(on));
  });
  const bulk = $('.br-bulk', app);
  bulk.hidden = sel.length < 2;
  if (sel.length >= 2) {
    const anySusp = sel.some((c) => c.queue === -1);
    bulk.innerHTML = `<span class="bk-n">${sel.length} cards</span><button type="button" class="btn-q" data-b="${anySusp ? 'unsusp' : 'susp'}">${anySusp ? 'Unsuspend' : 'Suspend'}</button><button type="button" class="btn-q" data-b="red"><i class="fd fd1"></i>Red</button><button type="button" class="btn-q" data-b="green"><i class="fd fd3"></i>Green</button><button type="button" class="btn-q bk-del" data-b="del">Delete</button><button type="button" class="dlg-x" data-b="none" aria-label="Clear selection">×</button>`;
    bulk.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => (b.onclick = () => bulkAct(b.dataset.b!, sel)));
  }
  const side = $('.br-side', app);
  const focus = sel.length === 1 ? sel[0] : null;
  if (!focus) {
    if (!side.hidden) await closeSide();
    return;
  }
  if (side.dataset.c === String(focus.id) && !side.hidden) return;
  await BR.close?.();
  BR.close = null;
  side.dataset.c = String(focus.id);
  side.hidden = false;
  app.querySelector('.br-main')!.classList.add('open');
  const note = S.notes.get(focus.nid)!, word = wordOfNote(note), f = focus.flags & 7;
  const tm = typeOf(note)?.templates.find((t) => t.ord === focus.ord)?.name ?? '';
  side.innerHTML = `<div class="sd-top"><span class="sd-w zh">${esc(word)}</span><button type="button" class="dlg-x" aria-label="Close">×</button></div>
    <div class="sd-card"><span class="sd-tm">${esc(tm)}</span><span class="sd-due">${dueText(focus)}</span>
      <span class="sd-act"><button type="button" class="btn-q" data-s="susp">${focus.queue === -1 ? 'Unsuspend' : 'Suspend'}</button><button type="button" class="btn-q${f === 1 ? ' on' : ''}" data-s="red"><i class="fd fd1"></i>Red</button><button type="button" class="btn-q${f === 3 ? ' on' : ''}" data-s="green"><i class="fd fd3"></i>Green</button></span></div>
    ${f === 3 ? greenHelp(note) : ''}${f === 1 ? `<div class="sd-help"><button type="button" class="btn-q" data-s="deeper">Five minutes on it</button></div>` : ''}
    <div class="sd-ed"></div>`;
  BR.close = editor($('.sd-ed', side), note, () => closeSide());
  $('.dlg-x', side).onclick = () => closeSide();
  side.querySelectorAll<HTMLElement>('[data-s]').forEach(
    (b) =>
      (b.onclick = async () => {
        const s = b.dataset.s!, c = S.cards.get(focus.id)!;
        if (s === 'susp') await change(c.queue === -1 ? 'Unsuspend' : 'Suspend', [['card', c.id, { ...c, queue: c.queue === -1 ? unsuspended(c) : -1 }]]);
        if (s === 'red' || s === 'green') return flagIt(s === 'red' ? 1 : 3, [c]).then(reopen);
        if (s === 'deeper') {
          RV.panel = 'deeper';
          RV.deeperFor = c.id;
          return go('review');
        }
        if (s.startsWith('pair:')) return combine(note.id, Number(s.slice(5)));
        reopen();
      }),
  );
}
const reopen = () => {
  const side = $('.br-side', app);
  if (side) delete side.dataset.c;
  paintBrowse();
};
/** A green card: his notes that share a character with it, each one click from a card about the two. */
function greenHelp(note: Note) {
  const near = nearNotes(note).slice(0, 8);
  if (!near.length) return '';
  return `<div class="sd-help"><span class="sd-hl">Combine with</span>${near.map((n) => `<button type="button" class="chipb zh" data-s="pair:${n.id}">${esc(wordOfNote(n))}</button>`).join('')}</div>`;
}
async function closeSide() {
  const side = app.querySelector<HTMLElement>('.br-side');
  const close = BR.close;
  BR.close = null;
  await close?.();
  if (!side) return;
  side.hidden = true;
  side.innerHTML = '';
  delete side.dataset.c;
  app.querySelector('.br-main')?.classList.remove('open');
  if (BR.sel.size === 1) {
    BR.sel = new Set();
    app.querySelectorAll('.tr.sel').forEach((tr) => (tr.classList.remove('sel'), tr.setAttribute('aria-selected', 'false')));
  }
}
async function bulkAct(a: string, sel: Card[]) {
  const nids = [...new Set(sel.map((c) => c.nid))];
  if (a === 'none') BR.sel = new Set();
  if (a === 'susp' || a === 'unsusp') {
    await change(a === 'susp' ? `Suspend ${sel.length}` : `Unsuspend ${sel.length}`, sel.map((c) => ['card', c.id, { ...c, queue: a === 'susp' ? -1 : c.queue === -1 ? unsuspended(c) : c.queue }]));
    toast(`${a === 'susp' ? 'Suspended' : 'Unsuspended'} ${sel.length} cards`, true);
  }
  if (a === 'red' || a === 'green') return flagIt(a === 'red' ? 1 : 3, sel);
  if (a === 'del') {
    await change(
      `Delete ${nids.length} notes`,
      nids.flatMap((id) => [['note', id, null] as [Kind, number, null], ...cardsOf(id).map((c) => ['card', c.id, null] as [Kind, number, null])]),
    );
    BR.sel = new Set();
    sfx('drop');
    toast(`Deleted ${nids.length} notes`, true);
  }
  paintBrowse();
}

// ================= Settings: rows in the one Settings panel (kit/settings.ts), group Reviews =================
/** About how many reviews a day the cards he has would ask for at this retention, as their memories stand now. */
function perDay(ret: number) {
  const c = conf(), f = new Fsrs(c.w);
  let n = 0;
  for (const x of live()) if (x.queue >= 0 && x.type !== 0 && x.s) n += 1 / Math.max(1, Math.min(c.maxIvl, f.interval(x.s, ret)));
  return Math.round(n);
}
const saveConf = async (name: string, patch: Partial<Conf>) => {
  const cur = conf();
  await change(name, [['conf', cur.id, { ...cur, ...patch }]]);
};
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
LAB.row('rv-new', 'Reviews', {
  html: () => (ready ? `<div class="st-row"><label class="st-l" for="rs-new">New cards a day</label><span class="st-step"><button type="button" data-n="-1" aria-label="Fewer">−</button><input id="rs-new" inputmode="numeric" value="${conf().newPerDay}"><button type="button" data-n="1" aria-label="More">+</button></span></div>` : ''),
  bind(el) {
    const nw = el.querySelector<HTMLInputElement>('#rs-new');
    if (!nw) return;
    const setNew = (v: number) => {
      nw.value = String(Math.max(0, Math.min(200, v)));
      saveConf('New cards a day', { newPerDay: Number(nw.value) });
    };
    nw.onchange = () => setNew(parseInt(nw.value) || 0);
    el.querySelectorAll<HTMLElement>('[data-n]').forEach((b) => (b.onclick = () => (sfx('tap'), setNew((parseInt(nw.value) || 0) + Number(b.dataset.n)))));
  },
});
LAB.row('rv-ret', 'Reviews', {
  // the chance a card is still known when it comes back, and what that costs a day
  html: () => (ready ? `<div class="st-row"><label class="st-l" for="rs-ret">How much to remember</label><span class="st-range"><input type="range" id="rs-ret" min="80" max="97" step="1" value="${Math.round(conf().retention * 100)}"><span class="st-v" data-js-text></span></span></div><p class="st-row st-sub"><span class="st-v rs-load" data-js-text></span></p>` : ''),
  bind(el) {
    const ret = el.querySelector<HTMLInputElement>('#rs-ret');
    if (!ret) return;
    const show = () => {
      el.querySelector('.st-range .st-v')!.textContent = `${ret.value}%`;
      el.querySelector('.rs-load')!.textContent = `about ${perDay(Number(ret.value) / 100)} reviews a day`;
    };
    show();
    ret.oninput = show;
    ret.onchange = () => saveConf('Retention', { retention: Number(ret.value) / 100 });
  },
});
LAB.row('rv-fit', 'Reviews', {
  // fitted to his own reviews once a month, like Anki's Optimize; kept only when it predicts his memory better
  html: () => {
    if (!ready) return '';
    const tuned = (conf() as Conf & { tuned?: Tuned }).tuned;
    return `<div class="st-row"><span class="st-l">Memory model</span><button type="button" class="st-btn rs-tune">${tuning ? 'Fitting…' : tuned ? `Fitted ${fmtDay(tuned.at)}` : 'Fit now'}</button></div>`;
  },
  bind(el) {
    const b = el.querySelector<HTMLButtonElement>('.rs-tune');
    if (!b) return;
    b.disabled = tuning;
    b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Fitting…';
      await tune(true);
      SETTINGS.redraw();
    };
  },
});
LAB.row('rv-designs', 'Reviews', {
  html: () => (ready ? '<button type="button" class="st-row st-go rs-designs"><span class="st-l">Card designs</span><span class="st-k"></span></button>' : ''),
  bind(el) {
    const b = el.querySelector<HTMLElement>('.rs-designs');
    if (b)
      b.onclick = () => {
        sfx('tap');
        SETTINGS.close();
        setView('reviews');
        go('designs');
      };
  },
});
LAB.row('rv-dl', 'Reviews', {
  // everything, reviews and pictures included, as one file Anki opens (it replaces Anki's collection)
  html: () => (ready ? '<div class="st-row"><span class="st-l">Back to Anki</span><button type="button" class="st-btn rs-dl">Download</button></div><p class="st-msg" role="status" data-js-text></p>' : ''),
  bind(el) {
    const b = el.querySelector<HTMLButtonElement>('.rs-dl');
    if (!b) return;
    b.onclick = async () => {
      const msg = el.querySelector('.st-msg')!;
      b.disabled = true;
      b.textContent = 'Packing…';
      try {
        await exportAnki((p) => (b.textContent = p));
        msg.textContent = '';
      } catch (err) {
        msg.textContent = (err as Error).message || 'The file didn’t come together.';
      }
      b.textContent = 'Download';
      b.disabled = false;
    };
  },
});

// ---------- the memory model, fitted to his reviews (monthly, on this device, in the background) ----------
type Tuned = { at: number; before: number; after: number; better: number; reviews: number };
let tuning = false;
async function tune(now = false) {
  const c = conf() as Conf & { tuned?: Tuned };
  if (tuning || (!now && c.tuned && Date.now() - c.tuned.at < 30 * 864e5)) return;
  tuning = true;
  try {
    const k = ck();
    const cards = live().filter((x) => x.revs.length);
    const hs = cards.map((x) => historyOf(x, k.dayOf)).filter((h): h is { day: number; g: number }[] => !!h && h.length > 1);
    const reviews = hs.reduce((n, h) => n + h.length, 0);
    if (reviews < 400) return;
    const breathe = () => new Promise<void>((ok) => ('requestIdleCallback' in window ? requestIdleCallback(() => ok(), { timeout: 200 }) : setTimeout(ok, 16)));
    const r = await optimize(c.w, hs, 160, breathe);
    const better = r.after < r.before * 0.998;
    const w = better ? r.w : c.w;
    const tuned: Tuned = { at: Date.now(), before: r.before, after: better ? r.after : r.before, better: better ? Math.round((1 - r.after / r.before) * 1000) / 10 : 0, reviews };
    const rows: [Kind, number, any][] = [['conf', c.id, { ...conf(), w, tuned }]];
    if (better) {
      // each card's memory as the new model reads its history (due dates stay, as in Anki)
      const f = new Fsrs(w);
      for (const x of cards) {
        const h = historyOf(x, k.dayOf);
        const m = h && f.replay(h);
        if (m && S.cards.get(x.id) === x) rows.push(['card', x.id, { ...x, s: Math.round(m.s * 1e4) / 1e4, d: Math.round(m.d * 1e4) / 1e4 }]);
      }
    }
    await putMany(rows);
    void loss;
  } finally {
    tuning = false;
  }
}

// ================= Card designs: fields, card types, styling =================
let TY = { id: 0, tab: 'fields' as 'fields' | 'cards' | 'css', tmpl: 0, side: 'qfmt' as 'qfmt' | 'afmt' };
const USED = ['Chinese', 'Chinese phrases', 'Chinese radicals'];
function showDesigns() {
  const types = [...S.types.values()].filter((t) => USED.includes(t.name) || [...S.notes.values()].some((n) => n.mid === t.id));
  if (!S.types.has(TY.id)) TY.id = col().notetype;
  const t = S.types.get(TY.id)!;
  app.innerHTML = `<section class="ty"><div class="ty-top"><button type="button" class="btn-q ty-back" aria-label="Back to settings">‹ Settings</button>
    <div class="br-f" role="radiogroup" aria-label="Note type">${types.map((x) => `<button type="button" role="radio" data-ty="${x.id}" aria-checked="${x.id === t.id}">${esc(x.name.replace(/^Chinese /, '').replace(/^Chinese$/, 'Words'))}</button>`).join('')}</div>
    <div class="br-f" role="radiogroup" aria-label="Part">${(['fields', 'cards', 'css'] as const).map((k) => `<button type="button" role="radio" data-tab="${k}" aria-checked="${TY.tab === k}">${k === 'fields' ? 'Fields' : k === 'cards' ? 'Front and back' : 'Styling'}</button>`).join('')}</div></div><div class="ty-body"></div></section>`;
  $('.ty-back', app).onclick = () => (go('review'), SETTINGS.open());
  app.querySelectorAll<HTMLElement>('[data-ty]').forEach((b) => (b.onclick = () => ((TY.id = Number(b.dataset.ty)), (TY.tmpl = 0), showDesigns())));
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => (b.onclick = () => ((TY.tab = b.dataset.tab as typeof TY.tab), showDesigns())));
  const body = $('.ty-body', app);
  const sample = [...S.notes.values()].find((x) => x.mid === t.id) ?? ({ id: 0, guid: '', mid: t.id, mod: 0, tags: [], flds: t.fields.map((f) => f.name) } as Note);
  if (TY.tab === 'fields') {
    const fs = t.fields.slice().sort((a, b) => a.ord - b.ord);
    body.innerHTML = `<ol class="flist">${fs.map((f, i) => `<li><input value="${esc(f.name)}" data-ren="${f.ord}" aria-label="Field name"><button type="button" class="btn-q" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" class="btn-q" data-dn="${i}" ${i < fs.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button type="button" class="btn-q bk-del" data-rm="${f.ord}" aria-label="Delete field">×</button></li>`).join('')}</ol>
      <button type="button" class="btn-q" data-add="1">Add field</button>`;
    body.querySelectorAll<HTMLInputElement>('[data-ren]').forEach((inp) => (inp.onchange = () => renameField(t, Number(inp.dataset.ren), inp.value.trim())));
    body.querySelectorAll<HTMLElement>('[data-up],[data-dn]').forEach((b) => (b.onclick = () => moveField(t, Number(b.dataset.up ?? b.dataset.dn), b.dataset.up ? -1 : 1)));
    body.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) => (b.onclick = () => removeField(t, Number(b.dataset.rm))));
    $('[data-add]', body).onclick = () => addField(t);
    return;
  }
  const tm = t.templates.find((x) => x.ord === TY.tmpl) ?? t.templates[0];
  const css = TY.tab === 'css';
  body.innerHTML = `${css ? '' : `<div class="ty-sub"><div class="br-f" role="radiogroup" aria-label="Card">${t.templates.map((x) => `<button type="button" role="radio" data-tm="${x.ord}" aria-checked="${x.ord === tm.ord}">${esc(x.name)}</button>`).join('')}</div>
      <div class="br-f" role="radiogroup" aria-label="Side"><button type="button" role="radio" data-side="qfmt" aria-checked="${TY.side === 'qfmt'}">Front</button><button type="button" role="radio" data-side="afmt" aria-checked="${TY.side === 'afmt'}">Back</button></div></div>`}
    <div class="tm"><textarea class="code" spellcheck="false" aria-label="${css ? 'Styling' : 'Template'}">${esc(css ? t.css : tm[TY.side])}</textarea><div class="tm-pv"><div class="pvh"></div></div></div>`;
  body.querySelectorAll<HTMLElement>('[data-tm]').forEach((b) => (b.onclick = () => ((TY.tmpl = Number(b.dataset.tm)), showDesigns())));
  body.querySelectorAll<HTMLElement>('[data-side]').forEach((b) => (b.onclick = () => ((TY.side = b.dataset.side as typeof TY.side), showDesigns())));
  const pv = () => draw($('.pvh', body), { note: sample, type: S.types.get(t.id)!, card: { ord: tm.ord } as Card }, css || TY.side === 'afmt' ? 'a' : 'q');
  pv();
  const start = clone(t);
  let st: ReturnType<typeof setTimeout> | undefined;
  const area = $<HTMLTextAreaElement>('.code', body);
  area.oninput = () => {
    clearTimeout(st);
    st = setTimeout(async () => {
      const cur = S.types.get(t.id)!;
      await put('notetype', t.id, css ? { ...cur, css: area.value } : { ...cur, templates: cur.templates.map((x) => (x.ord === tm.ord ? { ...x, [TY.side]: area.value } : x)) });
      pv();
    }, 350);
  };
  area.onblur = () => {
    const now = S.types.get(t.id)!;
    if (JSON.stringify(now) !== JSON.stringify({ ...start, mod: now.mod })) {
      H.undo.push({ name: css ? 'Styling' : 'Template', rows: [['notetype', t.id, start, clone(now)]] });
      H.redo = [];
    }
  };
}
const refName = (s: string, from: string, to: string) => s.replace(/\{\{([#^/]?)((?:[a-z]+:)*)\s*([^}]+?)\s*\}\}/g, (all, k, filt, name) => (name === from ? `{{${k}${filt}${to}}}` : all));
async function renameField(t: NoteType, ord: number, name: string) {
  const old = t.fields.find((f) => f.ord === ord)!.name;
  if (!name || name === old) return;
  if (t.fields.some((f) => f.name === name)) return toast('Another field has that name.'), showDesigns();
  await change('Rename field', [['notetype', t.id, { ...t, fields: t.fields.map((f) => (f.ord === ord ? { ...f, name } : f)), templates: t.templates.map((x) => ({ ...x, qfmt: refName(x.qfmt, old, name), afmt: refName(x.afmt, old, name) })) }]]);
  showDesigns();
}
/** Fields are stored by position in every note, so moving or removing one rewrites the notes too. */
async function reorder(t: NoteType, order: number[], name: string) {
  const fields = order.map((o, i) => ({ ...t.fields.find((f) => f.ord === o)!, ord: i }));
  const notes = [...S.notes.values()].filter((n) => n.mid === t.id);
  await change(name, [['notetype', t.id, { ...t, fields, sortf: Math.max(0, order.indexOf(t.sortf)) }], ...notes.map((n) => ['note', n.id, { ...n, flds: order.map((o) => n.flds[o] ?? '') }] as [Kind, number, Note])]);
  showDesigns();
}
function moveField(t: NoteType, i: number, dir: number) {
  const order = t.fields.slice().sort((a, b) => a.ord - b.ord).map((f) => f.ord);
  [order[i], order[i + dir]] = [order[i + dir], order[i]];
  reorder(t, order, 'Move field');
}
function removeField(t: NoteType, ord: number) {
  if (t.fields.length < 2) return;
  reorder(t, t.fields.slice().sort((a, b) => a.ord - b.ord).map((x) => x.ord).filter((o) => o !== ord), 'Delete field');
  toast('Field deleted', true);
}
async function addField(t: NoteType) {
  let name = 'Field';
  for (let i = 2; t.fields.some((f) => f.name === name); i++) name = `Field ${i}`;
  const notes = [...S.notes.values()].filter((n) => n.mid === t.id);
  await change('Add field', [['notetype', t.id, { ...t, fields: [...t.fields, { name, ord: t.fields.length }] }], ...notes.map((n) => ['note', n.id, { ...n, flds: [...n.flds, ''] }] as [Kind, number, Note])]);
  showDesigns();
}

// ================= keys (kit/keys.ts: each is his to change) =================
// capture: while this tab is open, undo and the letters are the reviews' own (the board's undo is for its other pages)
addEventListener(
  'keydown',
  (e) => {
    if (VIEW !== 'reviews' || e.isComposing) return;
    const t = e.target as HTMLElement;
    const typing = !!t.closest?.('input, textarea, select, [contenteditable="true"]');
    const eat = () => (e.preventDefault(), e.stopImmediatePropagation());
    if (!typing && (KEYS.is(e, 'undo') || KEYS.is(e, 'redo'))) {
      eat();
      if (document.querySelector('dialog[open]')) return;
      return KEYS.is(e, 'redo') ? redo() : undo();
    }
    if (e.key === 'Escape') {
      if (RV.flags) return e.stopImmediatePropagation(), (RV.flags = false), showReview();
      if (view === 'browse' && BR.sel.size && !document.querySelector('dialog[open]')) return e.stopImmediatePropagation(), (BR.sel = new Set()), closeSide(), paintSel();
      return;
    }
    // an editor open (the dialog or Browse's side): the sentence's audio, made if there is none (or made again)
    // (a held key repeats: only the first press counts, or one V made two recordings and played both)
    if (!typing && ED?.host.isConnected && (KEYS.is(e, 'rv.voice') || KEYS.is(e, 'rv.revoice'))) return eat(), e.repeat ? undefined : ED.voice(KEYS.is(e, 'rv.revoice'));
    if (typing || document.querySelector('dialog[open]') || view !== 'review') return;
    // the flag picker, while open, takes its own keys
    if (RV.flags) {
      const f = KEYS.is(e, 'rv.red') ? 1 : KEYS.is(e, 'rv.green') ? 3 : KEYS.is(e, 'rv.noflag') ? 0 : -1;
      if (f >= 0) return eat(), flagIt(f);
      if (KEYS.is(e, 'rv.flag')) return e.preventDefault(), act('flag');
    }
    const on = t.closest?.('button');
    if ((e.key === ' ' || e.key === 'Enter') && on && !on.matches('.rw-show,.rw-a')) return;
    if (KEYS.is(e, 'rv.show')) {
      e.preventDefault();
      return RV.shown ? grade(3) : act('show');
    }
    const g = ['rv.again', 'rv.hard', 'rv.good', 'rv.easy'].findIndex((id) => KEYS.is(e, id));
    if (g >= 0 && RV.shown) return e.preventDefault(), grade(g + 1);
    const a = ([['rv.suspend', 'suspend'], ['rv.flag', 'flag'], ['rv.pinyin', 'py'], ['rv.play', 'play'], ['rv.edit', 'edit']] as const).find(([id]) => KEYS.is(e, id));
    if (a) {
      eat();
      if (!e.repeat || a[1] !== 'play') act(a[1]);
    }
  },
  true,
);

// ================= start =================
// syncing is quiet: no dot (his call, Nov 23); changes wait on the device and go when there's signal
function paintSync() {}
/** The gold dot on the tab: cards are waiting today. */
function paintDot() {
  if (!ready) return;
  const dot = document.getElementById('dot-reviews');
  if (dot) dot.hidden = VIEW === 'reviews' || !left();
}
onChange((what) => {
  paintSync();
  if (what === 'pulled') void settlePairs();
  if (what !== 'pulled' || VIEW !== 'reviews') return paintDot();
  // another device answered or changed something: the card on screen stays unless it changed
  if (view === 'review' && !RV.shown && !document.querySelector('dialog[open]') && !VIEW_EL.contains(document.activeElement)) showReview();
  if (view === 'browse' && !$('.br-side', app)?.contains(document.activeElement)) paintBrowse();
});

let ready = false, started: Promise<void> | null = null;
function start() {
  return (started ??= (async () => {
    let have = false;
    try {
      have = await load();
    } catch {}
    if (!have) {
      app.innerHTML = '<p class="rx-wait">Bringing your cards over…</p>';
      await sync();
      if (!S.meta.has('col')) {
        app.innerHTML = `<p class="rx-wait">${S.error ? esc(S.error) : navigator.onLine ? 'Nothing here yet.' : 'Needs signal the first time.'}</p>`;
        started = null;
        return;
      }
    } else sync();
    ready = true;
    paintSync();
    let v: View = 'review';
    try {
      v = (sessionStorage.getItem('cbp-rx') as View) || 'review';
    } catch {}
    if (VIEW === 'reviews') go(['review', 'browse', 'designs'].includes(v) ? v : 'review');
    SETTINGS.redraw();
    paintDot();
    void settlePairs();
    setTimeout(prefetch, 4000);
    // the monthly fit, when the device is idle
    setTimeout(() => tune().catch(() => {}), 20_000);
  })());
}
BUS.on('view', (v: string, prev: string) => {
  // on a phone the tab row scrolls: the open tab comes into sight
  document.getElementById('tab-' + v)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (v === 'reviews') {
    if (!ready) start().then(() => VIEW === 'reviews' && ready && go(view));
    else {
      go(view);
      // what other devices (and the Cards page) did comes in now; a combined card's note settles its pair (settlePairs)
      void sync();
    }
    void settlePairs();
  } else if (prev === 'reviews') {
    SOUND.stop();
    sitting = false;
    dropToast();
    closeSide();
    document.querySelector<HTMLDialogElement>('dialog.rx-dlg[open]')?.close();
  }
  paintDot();
});
// Settings › Pinyin: the card on screen follows at once
BUS.on('lab', (id: string) => {
  if (id !== 'pinyin' || view !== 'review' || !RV.cur) return;
  RV.py = RUBY.shown();
  void RUBY.set($('.host', app)?.shadowRoot?.querySelector('.card'), RV.py);
});
// the collection loads with the board, so the dot shows from any page
start();
setInterval(paintDot, 5 * 60e3);
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/plus/sw.js', { scope: '/plus' }).catch(() => {});
  // the review page's own worker (Nov 22, scope /plus/) would keep answering for the board's files: it goes
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => new URL(r.scope).pathname === '/plus/' && r.unregister())).catch(() => {});
}

async function prefetch() {
  if (!navigator.onLine) return;
  const k = ck(), urls = new Set<string>();
  for (const c of live()) {
    const soon = c.queue === 2 || c.queue === 3 ? c.due <= k.today + 3 : c.queue === 0 || c.queue === 1;
    if (!soon) continue;
    for (const f of S.notes.get(c.nid)?.flds ?? []) for (const m of f.matchAll(/\/api\/plus\/media\/[0-9a-f]{32}\.\w+/g)) urls.add(m[0]);
  }
  const q = [...urls];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let u; (u = q.shift()); ) await fetch(u).catch(() => {});
    }),
  );
}
