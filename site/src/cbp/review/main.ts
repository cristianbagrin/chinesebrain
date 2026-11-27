// Chinese Brain Plus, Stage 4: his reviews (Anki rebuilt), as the Reviews tab of the board at /plus. plus.js loads this
// before the board's boot.js, so the tab is there when the board opens on #reviews. The whole collection lives on the
// device (store.ts), so reviewing works with no signal; the scheduler is sched.ts (FSRS, as Anki runs it); his own
// templates and styling draw the cards (render.ts). Inside the tab: Review and Browse; its settings are rows in the one
// Settings panel (LAB.row, kit/settings.ts), and Card designs opens here from there.
// Adding cards happens on the Cards page only (plus/review.js, its note goes into the collection: src/cbp/anki.ts).
import { S, load, put, putMany, sync, api, onChange, type Note, type NoteType, type ColMeta } from './store.ts';
import { render, strip, wordOf, sortText, fieldIndex, showable, type Row } from './render.ts';
import { index, apply as filterBy, sortBy, byWord, blank, active, STATES, nextRow, wordRows, rowText, type Item, type Filters, type Range, type Sort, type State, type Due } from './filter.ts';
import { answer, clock, queue, label, missed3, right3, historyOf, type Card, type Conf, type Rev } from '../sched.ts';
import { Fsrs, optimize, loss } from '../fsrs.ts';
import { exportAnki } from './export.ts';
import { triage, verdict, type Ease, type Flagged } from './triage.ts';
import { rank, missing, pairPrompt, harder, strength, settles, restOf, learnOf, type Cand, type Kept, type Ranked, type Pair } from './partners.ts';

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
import type { EDITOR as EDITOR_ } from '../kit/editor.ts';
declare const EDITOR: typeof EDITOR_;
declare const SETTINGS: { open(to?: string): void; close(): void; redraw(): void; page(title: string, render: (host: HTMLElement) => void, leave?: () => void): void };
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
// it takes the keys when the tab opens (takeKeys), so Space works without a click on the page first
app.tabIndex = -1;

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
/** The × of every dialog and panel (the Settings window's). */
const XICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const OVER = `:host{display:block}.card{background:transparent!important;min-height:100%;box-sizing:border-box}hr{border:0;border-top:1px solid #E4E6EC;margin:22px 0}
a.hint,.snd-btn,.hint-body{display:none!important}.audio:not(:has(:not(.snd-btn))){display:none}
img{max-width:100%!important;max-height:min(38vh,400px)!important;width:auto!important;height:auto!important;object-fit:contain!important}
.cbp-pics{display:flex!important;justify-content:center;align-items:center;gap:10px;margin-inline:auto;max-width:100%}
.cbp-pics>img{flex:0 1 auto;min-width:0;margin:0!important;max-width:calc((100% - (var(--n) - 1) * 10px) / var(--n))!important;max-height:min(30vh,320px)!important}`;
/** Pictures side by side: two or three in a row (only spaces between them) share one line, each shown whole, instead of
 *  stacking and pushing the card past the screen. The note stays as it is; only what's drawn changes. */
function sideBySide(root: ParentNode) {
  const blank = (n: Node) => n.nodeType === 3 && !(n.textContent ?? '').trim();
  const done = new Set<Element>();
  for (const img of root.querySelectorAll('img')) {
    if (done.has(img) || img.parentElement?.classList.contains('cbp-pics')) continue;
    const run: Element[] = [img];
    for (let n = img.nextSibling; n; n = n.nextSibling) {
      if (blank(n)) continue;
      if (n instanceof Element && n.tagName === 'IMG') run.push(n);
      else break;
    }
    run.forEach((x) => done.add(x));
    if (run.length < 2) continue;
    const box = document.createElement('span');
    box.className = 'cbp-pics';
    box.style.setProperty('--n', String(run.length));
    img.before(box);
    for (const x of run) {
      // the spaces between them go (an &nbsp; would take room in the row)
      while (x.previousSibling && x.previousSibling !== box && blank(x.previousSibling)) x.previousSibling.remove();
      box.append(x);
    }
  }
}
/** Draws one side of a card into `host` with his CSS, kept apart from the page's (a shadow root). */
function draw(host: HTMLElement, r: Row, side: 'q' | 'a') {
  const t = r.type!, tmpl = t.templates.find((x) => x.ord === r.card.ord) ?? t.templates[0];
  const ctx = { note: r.note, type: t, card: r.card, deck: S.decks.get(r.card.did)?.name };
  const q = render(tmpl.qfmt, ctx);
  const html = side === 'q' ? q : render(tmpl.afmt, ctx, q);
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${cardCss(t)}${OVER}${RUBY.CSS}</style><div class="card card${r.card.ord + 1}">${html}</div>`;
  sideBySide(root);
  if (host.closest('.rw-card')) fitCard(host, root);
  return root;
}
/** The review card always fits between its top and the button strip: when it would need scrolling, it is drawn smaller
 *  (zoom, never below 60%) instead. Runs again once its pictures load and when the window changes size. */
function fitCard(host: HTMLElement, root: ShadowRoot) {
  const fit = () => {
    if (!host.isConnected) return;
    host.style.zoom = '';
    const foot = parseFloat(getComputedStyle(VIEW_EL).getPropertyValue('--rw-foot')) || 150;
    const room = innerHeight - host.getBoundingClientRect().top - foot - 8;
    const h = (root.querySelector('.card') as HTMLElement | null)?.scrollHeight ?? 0;
    if (h > room && room > 0) host.style.zoom = String(Math.max(0.6, room / h));
  };
  requestAnimationFrame(fit);
  root.querySelectorAll('img').forEach((i) => i.complete || i.addEventListener('load', fit, { once: true }));
  (host as HTMLElement & { _fit?: () => void })._fit = fit;
}
const refit = (h: Element | null | undefined) => (h as (HTMLElement & { _fit?: () => void }) | null | undefined)?._fit?.();
addEventListener('resize', () => document.querySelectorAll<HTMLElement>('.rw-card .host').forEach(refit));

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
  if (v === 'review' && VIEW === 'reviews') takeKeys();
  try {
    sessionStorage.setItem('cbp-rx', v);
  } catch {}
  // where he is: an entry in the browser's history (kit/go.ts)
  BUS.emit('place');
}
// the browser's Back and Forward come back to Review, Browse or Card designs through this (kit/go.ts)
Object.assign(window, { RX_go: (v: View) => v !== view && go(v) });
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
      if (v === 'browse' && view === 'browse') return resetBrowse();
      go(v);
    }),
);

// ================= Review =================
/** A sitting: from the first card on screen until he leaves the tab (BUS 'reviews:start'). */
let sitting = false;
const RV = { cur: null as Card | null, shown: false, py: false, t0: 0, sinceNew: 0, panel: '' as '' | 'deeper', deeperFor: 0, flags: false };

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
  // a sync brings back the rows this device just sent (a flag, an edit) as new objects: the same card, unanswered since,
  // stays on screen as it was (side and all). Taking it for a new card flipped it to its front and played that (the F bug).
  const back = RV.cur && S.cards.get(RV.cur.id);
  if (RV.cur && back && back !== RV.cur && back.queue >= 0 && back.reps === RV.cur.reps && back.due === RV.cur.due) RV.cur = back;
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
      <div class="rw-again">${anyNew ? '<button type="button" class="btn-q" data-more="new">Ten more new</button>' : ''}${ahead() ? '<button type="button" class="btn-q" data-more="ahead">Review ahead</button>' : ''}</div>${triageHtml()}</section>`;
    bindTriage(app, () => showReview());
    void askPartners();
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
    <div class="rw-card"><div class="host${RV.py ? ' py' : ''}"></div></div>
    <div class="rw-foot"><div class="rw-bar">${RV.shown ? `<div class="rw-g">${['Again', 'Hard', 'Good', 'Easy'].map((x, i) => `<button type="button" class="rw-a rw-a${i + 1}" data-g="${i + 1}">${x}</button>`).join('')}</div>` : `<button type="button" class="rw-show" data-a="show">Show answer</button>`}</div>
    <div class="rw-more rx-opt">
      ${TOUCH ? `<button type="button" class="btn-q" data-a="py">Pinyin</button>` : ''}<button type="button" class="btn-q rw-snd" data-a="play" aria-label="Play" hidden>${SPEAKER}</button>
      <button type="button" class="btn-q" data-a="edit">Edit</button><button type="button" class="btn-q rw-flagb" data-a="flag" aria-haspopup="dialog" aria-expanded="${RV.flags}">Flag</button><button type="button" class="btn-q" data-a="suspend">Suspend</button>
    </div>
    ${RV.flags ? flagPicker(c) : ''}</div>
  </section>`;
  watchFoot();
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
  // the pinyin makes the card taller once it's drawn (the lexicon loads first): it's fitted again then
  if (RV.py) void RUBY.set(root.querySelector('.card'), true).then(() => refit(host));
  if (!sitting) {
    sitting = true;
    BUS.emit('reviews:start');
  }
  bindReview();
}
/** The strip at the bottom (answer buttons, options) is fixed to the screen; the card keeps exactly its height clear
 *  under it (--rw-foot), so the page scrolls only when the card itself is taller than the room above the strip. */
const footRO = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => es.forEach((e) => e.target.isConnected && VIEW_EL.style.setProperty('--rw-foot', `${Math.ceil((e.target as HTMLElement).offsetHeight)}px`))) : null;
function watchFoot() {
  footRO?.disconnect();
  const f = $('.rw-foot', app) as HTMLElement | null;
  if (!f) return;
  // measured now, so the first frame already has the right room under the card (the observer keeps it right after)
  VIEW_EL.style.setProperty('--rw-foot', `${Math.ceil(f.offsetHeight)}px`);
  footRO?.observe(f);
}
/** Space works the moment the tab opens: a button the mouse just pressed (the Reviews tab, Review · Browse) lets go of
 *  the focus, so Space shows the answer instead of pressing that button again. A button reached with Tab keeps it. */
function takeKeys() {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && a.matches('button, a, [role="tab"], [role="button"]') && !a.matches(':focus-visible')) a.blur();
  if (!document.activeElement || document.activeElement === document.body) app.focus({ preventScroll: true });
}
function bindReview() {
  app.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => (b.onclick = () => act(b.dataset.a!)));
  app.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => (b.onclick = () => grade(Number(b.dataset.g))));
  app.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => flagIt(Number(b.dataset.f))));
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
    const host = $('.host', app);
    return void RUBY.set(host?.shadowRoot?.querySelector('.card'), RV.py).then(() => refit(host));
  }
  if (a === 'play') return playAll($('.host', app)?.shadowRoot);
  if (a === 'edit') return editDialog(S.notes.get(c.nid)!);
  if (a === 'flag') {
    RV.flags = !RV.flags;
    return paintFlags();
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

// ---------- flags: red (too hard) and green (too easy), his way of putting a card on the end screen's list by hand ----------
const FLAG_NAME: Record<number, string> = { 1: 'Red', 3: 'Green' };
function flagPicker(c: Card) {
  const f = c.flags & 7;
  return `<div class="rw-flags" role="dialog" aria-label="Flag">
    <button type="button" class="fl-b fl-r${f === 1 ? ' on' : ''}" data-f="1"><i></i>Red<kbd>R</kbd></button>
    <button type="button" class="fl-b fl-g${f === 3 ? ' on' : ''}" data-f="3"><i></i>Green<kbd>G</kbd></button>
    ${f ? `<button type="button" class="fl-b fl-0" data-f="0"><i></i>None<kbd>N</kbd></button>` : ''}
  </div>`;
}
/** The flag picker opens and closes on its own; the card under it is left alone (not drawn again). */
function paintFlags() {
  const foot = $('.rw-foot', app), c = RV.cur;
  if (!foot || !c) return showReview();
  foot.querySelector('.rw-flags')?.remove();
  $('.rw-flagb', app)?.setAttribute('aria-expanded', String(RV.flags));
  if (!RV.flags) return;
  foot.insertAdjacentHTML('beforeend', flagPicker(c));
  foot.querySelectorAll<HTMLElement>('[data-f]').forEach((b) => (b.onclick = () => flagIt(Number(b.dataset.f))));
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
  if (to && !cards) toast(`${to === 1 ? 'Too hard' : 'Too easy'}: <span class="zh">${esc(wordOfCard(list[0]))}</span>`, true);
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
          // five minutes on it: off the Too hard list until it slips again
          await keep(r.note.id, true);
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

// ---------- a partner for a word that's too easy: one card about the difference ----------
const mergeNo = () => new Set<string>((S.meta.get('mergeNo')?.pairs as string[]) ?? []);
const pairKey = (a: number, b: number) => [a, b].sort().join('-');
/** A combined card (partners.ts Pair, key "A、B", A too easy): Claude writes it on the Cards page for the harder of the
 *  two for him (`learn`), two sentences using both, and he makes the note there, as with any card. Once that note is
 *  added, the too-easy word's old cards rest (suspended; Undo brings them back); the partner's are never touched. If he
 *  drops the card instead, or never makes it, nothing was suspended. One word written again ('hard': simpler; 'easy':
 *  harder; key "word ↻") works the same way. */
const pairs = (): Pair[] => (S.meta.get('combine')?.list as Pair[]) ?? [];
/** How a note's word stands in his reviews (its weakest card), for harder(). */
const strengthOf = (nid: number) => strength(items().filter((i) => i.note.id === nid));
async function combine(x: number, y: number, why = '') {
  const [a, b] = [S.notes.get(x), S.notes.get(y)];
  if (!a || !b) return;
  const words = `${wordOfNote(a)}、${wordOfNote(b)}`;
  const learn = harder(strengthOf(x), strengthOf(y)) === 'easy' ? wordOfNote(a) : wordOfNote(b);
  await put('meta', 'combine', { list: [...pairs().filter((p) => p.words !== words), { words, nids: [x, y], at: Date.now(), learn, ...(why ? { why } : {}) }] });
  // openCard moves to the Cards page itself (setView first made that page open on the card it had before)
  try {
    openCard(words, 'any');
  } catch {}
}
/** The pairs waiting on a combined card: its note arrived (the old cards rest), it was dropped, or it's two weeks old. */
let settling = false, loudTill = 0;
async function settlePairs() {
  // just added on the Cards page (added()): the toast shows there too
  const loud = Date.now() < loudTill;
  const list = pairs();
  if (!ready || settling || !list.length) return;
  settling = true;
  try {
    const wait: Pair[] = [];
    for (const p of list) {
      const made = [...S.notes.values()].find((n) => n.id > p.at - 60e3 && !p.nids.includes(n.id) && settles(p, wordOfNote(n)));
      const doc = typeof CD !== 'undefined' && typeof cardId === 'function' ? CD.docs[cardId(p.words)] : undefined;
      if (made) {
        const rest = restOf(p), easy = rest.map((id) => S.notes.get(id)).filter(Boolean).map((n) => wordOfNote(n!)).join('、');
        const old = rest.flatMap(cardsOf).filter((c) => c.queue >= 0 || c.flags & 7);
        if (old.length) {
          await change(p.kind ? 'Rewrite' : 'Combine', old.map((c) => ['card', c.id, { ...c, queue: -1, flags: c.flags & ~7 }]));
          if (loud || VIEW === 'reviews') later(() => toast(`<span class="zh">${esc(easy || p.word || '')}</span>: old cards suspended`, true));
        }
        await keep(rest, false);
      } else if (!doc?.dropped && Date.now() - p.at < 14 * 864e5) wait.push(p);
    }
    if (wait.length !== list.length) await put('meta', 'combine', { list: wait });
  } finally {
    settling = false;
  }
}
/** After the board's own toast (the word carded, with its Undo), so one doesn't wipe out the other. */
declare let TOAST: unknown;
function later(f: () => void, tries = 12) {
  if (tries > 0 && typeof TOAST !== 'undefined' && TOAST) return void setTimeout(() => later(f, tries - 1), 500);
  f();
}
/** The Cards page added a note (review.js): if it is a combined card or a word written again, the new note comes into the
 *  collection now and the old cards rest at once, with Undo, wherever he is. */
async function added(key: string) {
  if (!key.includes('、') && !key.endsWith(' ↻')) return;
  if (!ready) await start();
  if (!pairs().some((p) => p.words === key)) return;
  loudTill = Date.now() + 20_000;
  await sync();
  await settlePairs();
}
/** For the Cards page (review.js): the word a combined card teaches, and the hook for its Add. */
Object.assign(window, { CBP_learn: (key: string) => { const p = pairs().find((x) => x.words === key); return p ? learnOf(p) : ''; }, CBP_added: (key: string) => void added(key).catch((e) => console.error(e)) });
// the card Claude writes for a pair: two sentences, each using both words (the Cards page's prompt, with partners.ts
// pairPrompt added for a pair)
if (typeof cardPrompt === 'function') {
  const base = cardPrompt;
  cardPrompt = (kit, word) => {
    const p = pairs().find((x) => x.words === word);
    if (!p) return base(kit, word);
    if (p.kind) return `${base(kit, word)}\n\n${remakePrompt(p)}`;
    const [a, b] = p.words.split('、');
    return `${base(kit, word)}\n\n${pairPrompt(a, b, p.why, learnOf(p))}`;
  };
}

// ================= too easy, too hard (triage.ts): on the end screen and in Browse, one tap to act on each word =================
const TH = () => conf().leechThreshold ?? 8;
/** Words he waved off (Keep, five minutes on it, a rewrite that landed): nid → when. They come back only for something new. */
const seenMap = (): Record<string, number> => (S.meta.get('triage')?.seen as Record<string, number>) ?? {};
const onTheWay = () => new Set(pairs().flatMap((p) => p.nids));
const tagsOf = (nid: number) => S.notes.get(nid)?.tags;
function flaggedList(): Flagged[] {
  return triage(live(), tagsOf, TH(), seenMap(), onTheWay());
}
/** Off the list: the flags he set go (an undo step) when `unflag`, and the word is seen as of now. */
async function keep(nids: number | number[], unflag: boolean) {
  const ids = Array.isArray(nids) ? nids : [nids];
  const flagged = ids.flatMap(cardsOf).filter((c) => c.flags & 7);
  if (flagged.length && unflag) await change('Leave it', flagged.map((c) => ['card', c.id, { ...c, flags: c.flags & ~7 }]));
  const seen = { ...seenMap() };
  for (const id of ids) seen[id] = Date.now();
  await put('meta', 'triage', { seen });
}
// ---------- Combine: partners for a word that's too easy, ranked by Claude (partners.ts, combine.ts) ----------
/** Claude's lists, word → partners (meta `partners`, synced, so every device has them). */
const kept = (): Kept => (S.meta.get('partners')?.by as Kept) ?? {};
/** Every word of his that could be a partner: one entry per note with cards still coming up, and how easy it is now. */
function cands(list: Flagged[]): Cand[] {
  const easy = new Set(list.filter((x) => x.ease === 'easy').map((x) => x.nid));
  const out: Cand[] = [];
  for (const n of S.notes.values()) {
    const cs = cardsOf(n.id).filter((c) => c.queue >= 0);
    if (!cs.length) continue;
    out.push({ nid: n.id, word: wordOfNote(n), easy: easy.has(n.id) ? 3 : cs.some(right3) ? 2 : cs.every((c) => c.type === 2 && c.ivl >= 21) ? 1 : 0 });
  }
  return out;
}
/** A too-easy word's partners, best first: never a pair he turned down, a note already on its way to a combined card, or
 *  another note of the same word. Code's guess only while Claude hasn't answered. */
function partners(f: Flagged, list: Flagged[], n = 5): Ranked[] {
  const note = S.notes.get(f.nid);
  if (!note) return [];
  const w = wordOfNote(note), no = mergeNo(), skip = new Set(onTheWay());
  const cs = cands(list);
  for (const c of cs) if (no.has(pairKey(note.id, c.nid)) || c.word === w) skip.add(c.nid);
  return rank(w, kept()[w]?.list, cs, skip, n);
}
/** Asks Claude once for every too-easy word that has no list yet (in the background: on load, on the end screen, in
 *  Browse); the answer is kept and whatever shows the list is drawn again. A failure waits 10 minutes before trying again. */
let asking = false, askedAt = 0;
async function askPartners() {
  if (!ready || asking || !navigator.onLine || Date.now() - askedAt < 10 * 60e3) return;
  const list = flaggedList();
  const want = missing(list.filter((f) => f.ease === 'easy').map((f) => wordOfNote(S.notes.get(f.nid)!)).filter(Boolean), kept());
  if (!want.length) return;
  asking = true;
  askedAt = Date.now();
  try {
    const pool = [...new Set(cands(list).map((c) => c.word).filter(Boolean))];
    const r = (await api('anki/partners', { targets: want, pool })) as { partners: Record<string, { w: string; why: string }[]> };
    const by = { ...kept() }, at = Date.now();
    for (const [w, l] of Object.entries(r.partners ?? {})) by[w] = { at, list: l };
    await put('meta', 'partners', { by });
    askedAt = 0;
    if (VIEW === 'reviews' && !document.querySelector('.cb-pick')) {
      if (view === 'review' && !RV.cur) showReview();
      else if (view === 'browse') reopen();
    }
  } catch (e) {
    console.error(e);
  } finally {
    asking = false;
  }
}
const CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/** A word's quick actions, each saying what it does. Too hard: Simpler card (written again on the Cards page) or Go deeper
 *  (five minutes on it). Too easy: Combine with its best partner (the chevron: other partners, or any word of his),
 *  Harder card, Retire (its easy cards rest). Leave it takes the word off the list. */
function quickActs(f: Flagged, list: Flagged[]) {
  const b = (q: string, text: string, main = false) => `<button type="button" class="btn-q${main ? ' tg-go' : ''}" data-q="${q}">${text}</button>`;
  let h: string;
  if (f.ease === 'hard') h = b('rewrite', 'Simpler card', true) + b('deeper', 'Go deeper');
  else {
    const p = partners(f, list, 1)[0];
    const more = `<button type="button" class="btn-q tg-more-p" data-q="pick" aria-label="Other partners" aria-haspopup="dialog">${CHEV}</button>`;
    h = p
      ? `<span class="tg-split">${b(`pair:${p.nid}`, `Combine with <span class="zh">${esc(p.word)}</span>`, true)}${more}</span>${b('harder', 'Harder card')}${b('retire', 'Retire')}`
      : `${b('pick', 'Combine with…', true)}${b('harder', 'Harder card')}${b('retire', 'Retire')}`;
  }
  return `<span class="tg-a" data-t="${f.nid}">${h}${b('keep', 'Leave it')}</span>`;
}
const LIST_N = 4;
/** The end screen's list: Too hard, then Too easy, the newest first; the rest one tap away in Browse. */
function triageHtml() {
  const list = flaggedList();
  const part = (e: Ease, name: string) => {
    const l = list.filter((f) => f.ease === e);
    if (!l.length) return '';
    return `<div class="tg"><p class="side-h tg-h">${name}<span class="tg-n">${l.length}</span></p>${l
      .slice(0, LIST_N)
      .map((f) => `<div class="tg-r"><button type="button" class="tg-w zh" data-open="${f.nid}">${esc(wordOfNote(S.notes.get(f.nid)!))}</button>${quickActs(f, list)}</div>`)
      .join('')}${l.length > LIST_N ? `<button type="button" class="btn-q tg-more" data-all="${e}">All ${l.length}</button>` : ''}</div>`;
  };
  const h = part('hard', 'Too hard') + part('easy', 'Too easy');
  return h ? `<div class="tgs">${h}</div>` : '';
}
/** The quick actions under `root` (the end screen, Browse's panel); `after` draws that place again. */
function bindTriage(root: ParentNode, after: () => void) {
  root.querySelectorAll<HTMLElement>('[data-q]').forEach(
    (b) =>
      (b.onclick = async () => {
        const nid = Number(b.closest<HTMLElement>('[data-t]')!.dataset.t);
        const f = flaggedList().find((x) => x.nid === nid);
        if (!f) return after();
        if (b.dataset.q === 'pick') return pickPartner(b, f, after);
        if ((await quickAct(f, b.dataset.q!)) !== false) after();
      }),
  );
  root.querySelectorAll<HTMLElement>('[data-all]').forEach(
    (b) =>
      (b.onclick = () => {
        sfx('tap');
        BR.f = blank();
        BR.f.ease = [b.dataset.all as Ease];
        BR.sel = new Set();
        saveBR();
        go('browse');
      }),
  );
  root.querySelectorAll<HTMLElement>('[data-open]').forEach(
    (b) =>
      (b.onclick = () => {
        // the word itself: its row in Browse, opened
        const nid = Number(b.dataset.open), c = cardsOf(nid)[0];
        if (!c) return;
        sfx('tap');
        BR.f = blank();
        BR.f.q = wordOfNote(S.notes.get(nid)!);
        BR.sel = new Set([results().find((x) => x.note.id === nid)?.card.id ?? c.id]);
        BR.pick = (flaggedList().find((x) => x.nid === nid)?.cards[0] ?? c).id;
        go('browse');
      }),
  );
}
/** One tap. Returns false when it moved him elsewhere (the Cards page, five minutes on the word), so nothing is redrawn. */
async function quickAct(f: Flagged, q: string): Promise<boolean | void> {
  const w = wordOfNote(S.notes.get(f.nid)!);
  if (q === 'keep') {
    await keep(f.nid, true);
    sfx('unstamp');
    return;
  }
  if (q === 'retire') {
    const cs = f.cards.map((c) => S.cards.get(c.id)!).filter(Boolean);
    await change(`Retire ${w}`, cs.map((c) => ['card', c.id, { ...c, queue: -1, flags: c.flags & ~7 }]));
    sfx('drop');
    acted = true;
    toast(`Retired <span class="zh">${esc(w)}</span>`, true);
    return;
  }
  if (q === 'deeper') {
    RV.panel = 'deeper';
    RV.deeperFor = f.cards[0].id;
    sfx('tap');
    if (view !== 'review') go('review');
    else showReview();
    return false;
  }
  if (q === 'rewrite' || q === 'harder') {
    await remake(f.nid, q === 'rewrite' ? 'hard' : 'easy');
    return false;
  }
  if (q.startsWith('pair:')) {
    const id = Number(q.slice(5));
    await combine(f.nid, id, partners(f, flaggedList(), 50).find((p) => p.nid === id)?.why);
    return false;
  }
}
/** Another partner than the first: Claude's next best, or any word of his, found by typing (Chinese or pinyin, as Browse's
 *  search does). One popover under the chevron; a pick goes to the Cards page as Combine does. */
function pickPartner(btn: HTMLElement, f: Flagged, after: () => void) {
  if (PICK?.btn === btn) return void closePick();
  closePick();
  const me = S.notes.get(f.nid);
  if (!me) return;
  const w = wordOfNote(me), best = partners(f, flaggedList(), 6), way = onTheWay();
  const pop = document.createElement('div');
  pop.className = 'cb-pick';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', `Combine ${w} with`);
  pop.innerHTML = `<label class="br-s cb-s">${SEARCH}<input type="search" placeholder="Any word" aria-label="Any word" spellcheck="false" autocomplete="off" enterkeyhint="go" lang="zh-Hant"></label><div class="cb-l"></div>`;
  const l = $('.cb-l', pop), inp = $<HTMLInputElement>('input', pop);
  const row = (nid: number, word: string, why: string) => `<button type="button" class="cb-r" data-n="${nid}" data-why="${esc(why)}"><span class="zh">${esc(word)}</span>${why ? `<span class="cb-why">${esc(why)}</span>` : ''}</button>`;
  const paintL = () => {
    const q = inp.value.trim();
    if (!q) return void (l.innerHTML = best.map((p) => row(p.nid, p.word, p.why)).join(''));
    const seen = new Set<string>([w]), out: string[] = [];
    // the words that hold what he typed first, then the ones whose sentence or notes do
    const own = (x: Item) => (x.word.includes(q) ? 0 : 1);
    for (const x of filterBy(items(), { ...blank(), q }, ck()).sort((a, b) => own(a) - own(b))) {
      if (!x.word || seen.has(x.word) || way.has(x.note.id)) continue;
      seen.add(x.word);
      out.push(row(x.note.id, x.word, best.find((p) => p.word === x.word)?.why ?? ''));
      if (out.length >= 8) break;
    }
    l.innerHTML = out.join('') || '<p class="cb-none">Nothing matches.</p>';
  };
  paintL();
  inp.oninput = paintL;
  inp.onkeydown = (e) => e.key === 'Enter' && (e.preventDefault(), $<HTMLElement>('.cb-r', l)?.click());
  l.onclick = async (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.cb-r');
    if (!r) return;
    closePick();
    sfx('tap');
    await combine(f.nid, Number(r.dataset.n), r.dataset.why ?? '');
  };
  document.body.append(pop);
  // under the chevron (above it when there's no room below), inside the window
  const at = btn.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
  pop.style.left = `${Math.max(16, Math.min(innerWidth - pw - 16, at.right - pw))}px`;
  pop.style.top = `${at.bottom + 6 + ph > innerHeight - 8 && at.top - 6 - ph > 8 ? at.top - 6 - ph : at.bottom + 6}px`;
  if (!TOUCH) inp.focus();
  const away = (e: Event) => !pop.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node) && closePick();
  setTimeout(() => addEventListener('pointerdown', away, true));
  PICK = { el: pop, away, after, btn };
}
let PICK: { el: HTMLElement; away: (e: Event) => void; after: () => void; btn: HTMLElement } | null = null;
function closePick() {
  if (!PICK) return false;
  removeEventListener('pointerdown', PICK.away, true);
  PICK.el.remove();
  PICK = null;
  return true;
}
/** The word written again on the Cards page; once he cards it, its old cards rest (settlePairs). */
async function remake(nid: number, kind: Ease) {
  const n = S.notes.get(nid);
  if (!n) return;
  const word = wordOfNote(n), key = `${word} ↻`;
  await put('meta', 'combine', { list: [...pairs().filter((p) => p.words !== key), { words: key, nids: [nid], at: Date.now(), kind, word }] });
  try {
    openCard(key, 'any');
  } catch {}
}
function remakePrompt(p: Pair) {
  const n = S.notes.get(p.nids[0]), t = n && typeOf(n);
  const fld = (name: string) => (n && t ? strip(n.flds[fieldIndex(t, name)] ?? '') : '');
  const lapses = Math.max(0, ...p.nids.flatMap(cardsOf).map((c) => c.lapses));
  const old = `His card now: sentence: ${fld('Chinese') || 'none'}. mnemonic: ${fld('Mnemonic') || 'none'}. notes: ${fld('Notes') || 'none'}.`;
  if (p.kind === 'hard')
    return `=== WRITTEN AGAIN: TOO HARD ===
His card for ${p.word} keeps slipping (${lapses} lapses). Write it again so it sticks. word: ${p.word} (exactly this). A shorter, plainer sentence made of words he knows; a fresh how: story for each character new to him, unlike the old one; if the card tests two things at once, write it for the harder one and put the other on a second: line. ${old}`;
  return `=== WRITTEN AGAIN: TOO EASY ===
${p.word} is too easy for him now. Write a harder card for it. word: ${p.word} (exactly this). ex: sentences where it does real work the way a Taiwanese adult uses it (at work, arguing a point, telling a story), with a pattern or partner word he hasn't used yet; know: its finer points (register, collocations, the near-synonym people mix it up with). No how: lines for characters he knows. ${old}`;
}

// ================= the editor: his fields, and a quiet delete =================
// The same editor as the Cards page's Add (kit/editor.ts, review.js): the same fields in the same order, the same look
// (review.css .rv-field), the same keys (Cmd+B/I/U, Cmd+Shift+H, its own Cmd+Z), paste cleaning and the same V button.
/** Add's field order (review.js FIELDS); any other field of the type after them, in its own order. */
const ED_ORDER = ['chinese', 'word', 'mnemonic', 'picture', 'notes'];
const edKey = (name: string) => name.toLowerCase();
function edLabel(t: NoteType, name: string) {
  if (edKey(name) !== 'chinese') return name;
  return /radical/i.test(t.name) ? 'Character' : /phrase/i.test(t.name) ? 'Phrase' : 'Sentence';
}
function editor(host: HTMLElement, note0: Note, onClose?: () => void) {
  const t = typeOf(note0)!;
  const start = clone(note0);
  let note = note0;
  const rank = (name: string) => {
    const i = ED_ORDER.indexOf(edKey(name));
    return i < 0 ? ED_ORDER.length : i;
  };
  const fields = t.fields.slice().sort((a, b) => rank(a.name) - rank(b.name) || a.ord - b.ord);
  const ai = t.fields.find((f) => /^audio$/i.test(f.name))?.ord ?? -1;
  const si = t.fields.find((f) => /^chinese$/i.test(f.name))?.ord ?? fields[0]?.ord ?? 0;
  host.innerHTML = `<div class="ed rv-fields">${fields
    .map((f) => {
      const k = edKey(f.name), id = `ed-l-${note.id}-${f.ord}`;
      // the audio is a sound, not text: the V button on the sentence plays it (or makes it), as on Add
      if (f.ord === ai) return `<div class="rv-f" hidden data-o="${f.ord}">${note.flds[f.ord] ?? ''}</div>`;
      // Add never shows the pinyin (it's done for him): here it stays out of sight until Option shows it
      const opt = k === 'pinyin' ? ' opt' : '';
      const zh = /chinese|word|mnemonic|pinyin/.test(k) ? ' zh' : '';
      return `<div class="rv-field rv-${esc(k)}${opt}"><span class="rv-l" id="${id}">${esc(edLabel(t, f.name))}</span><div class="rv-f${zh}" data-o="${f.ord}" contenteditable="true" spellcheck="false" lang="${k === 'notes' ? 'en' : 'zh-Hant'}" role="textbox" aria-multiline="true" aria-labelledby="${id}">${note.flds[f.ord] ?? ''}</div>${f.ord === si && ai >= 0 ? `<button type="button" class="rv-say" data-e="say" aria-label="Read it aloud">${SPEAKER}</button>` : ''}</div>`;
    })
    .join('')}
    <div class="ed-end"><button type="button" class="ed-del" data-e="del">Delete note</button></div></div>`;
  let saveT: ReturnType<typeof setTimeout> | undefined;
  const read = (): Note => {
    const flds = [...note.flds];
    host.querySelectorAll<HTMLElement>('.rv-f[data-o]').forEach((f) => (flds[Number(f.dataset.o)] = clean(f.innerHTML)));
    return { ...note, flds };
  };
  const save = () => {
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      note = read();
      if (JSON.stringify(note.flds) !== JSON.stringify(S.notes.get(note.id)?.flds)) await put('note', note.id, note);
    }, 400);
  };
  const fa = () => host.querySelector<HTMLElement>(`.rv-f[data-o="${ai}"]`);
  const fs = () => host.querySelector<HTMLElement>(`.rv-f[data-o="${si}"]`);
  const said = (f: HTMLElement | null) => strip((f?.innerHTML ?? '').replace(/<br\s*\/?>|<\/div>/gi, '\n')).replace(/[ \t]+/g, ' ').trim();
  // the sentence the audio was made for: change the sentence and V makes it anew, as Add does
  let audioFor = said(fs());
  const paintSnd = () => host.querySelector('.rv-say')?.classList.toggle('on', /\[sound:[^\]]+\]/.test(fa()?.textContent ?? '') && said(fs()) === audioFor);
  EDITOR.attach(host, {
    field: '.rv-f',
    changed: () => (save(), paintSnd()),
    // only picture files are taken; any other file pastes as the browser would (its name as text)
    files: (files, f) => files.some((x) => /^image\//.test(x.type)) && (void upload(files, f, save), true),
    pasted: (f) => void keepPics(f, save),
  });
  // one listener per host, even when the same host gets an editor again (Browse's Note closed and opened)
  const h = host as HTMLElement & { _edAc?: AbortController };
  h._edAc?.abort();
  h._edAc = new AbortController();
  host.addEventListener('input', () => (save(), paintSnd()), { signal: h._edAc.signal });
  host.querySelector<HTMLElement>('[data-e="del"]')!.onclick = async () => {
    clearTimeout(saveT);
    await deleteNote(note.id);
    onClose?.();
  };
  let voicing = false;
  const me = {
    host,
    /** V (not typing) or the button: the sentence read aloud, made now if it has none or the sentence changed (Shift+V makes it again) */
    voice: async (again: boolean) => {
      const a = fa(), s = fs(), b = host.querySelector<HTMLElement>('.rv-say');
      if (voicing || !a || !s) return;
      const text = said(s);
      const have = /\[sound:([^\]]+)\]/.exec(a.textContent ?? '');
      if (have && !again && text === audioFor) return void SOUND.play(have[1]);
      if (!text) return toast('The sentence is empty.');
      if (!navigator.onLine) return toast('The voice needs signal.');
      voicing = true;
      b?.classList.add('busy');
      try {
        const { url } = await api('voice', { text });
        a.textContent = `[sound:${url}]`;
        audioFor = text;
        save();
        sfx('save');
        void SOUND.play(url);
      } catch (e) {
        toast(esc((e as Error).message || 'The voice didn’t come through.'));
      } finally {
        voicing = false;
        b?.classList.remove('busy');
        paintSnd();
      }
    },
  };
  host.querySelector<HTMLElement>('[data-e="say"]')?.addEventListener('click', () => void me.voice(false));
  paintSnd();
  ED = me;
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
const clean = (h: string) => h.replace(/^(<br>)+$/, '').replace(/\s+data-[\w-]+="[^"]*"/g, '').replace(/ class="rv-sel"/g, '');

/** The notes of a word, oldest first: a word can have more than one flashcard. */
const notesOfWord = (n: Note) => {
  const w = wordOfNote(n);
  return w ? [...S.notes.values()].filter((x) => wordOfNote(x) === w).sort((a, b) => a.id - b.id) : [n];
};
const ARROW = (d: number) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="${d < 0 ? 'm14.5 6-6 6 6 6' : 'm9.5 6 6 6-6 6'}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function editDialog(note: Note) {
  const d = document.createElement('dialog');
  d.className = 'rx-dlg';
  d.tabIndex = -1;
  // no title: the word is right there in its field. A word with more than one flashcard: ‹ › (← →) go through them
  const sibs = notesOfWord(note);
  let at = Math.max(0, sibs.findIndex((x) => x.id === note.id));
  d.innerHTML = `<div class="dlg-top">${sibs.length > 1 ? `<span class="dlg-nav"><button type="button" class="ib" data-d="-1" aria-label="Previous card">${ARROW(-1)}</button><button type="button" class="ib" data-d="1" aria-label="Next card">${ARROW(1)}</button></span>` : ''}<button type="button" class="dlg-x" aria-label="Close">${XICON}</button></div><div class="dlg-ed"></div>`;
  document.body.append(d);
  let done = editor($('.dlg-ed', d), note, () => d.close());
  const nav = () => d.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => (b.disabled = at + Number(b.dataset.d) < 0 || at + Number(b.dataset.d) >= sibs.length));
  // the edit so far is kept (one undo step), then the word's other card opens in its place
  const step = async (k: number) => {
    const to = at + k, n = sibs[to] && S.notes.get(sibs[to].id);
    if (!n) return;
    await done();
    at = to;
    done = editor($('.dlg-ed', d), n, () => d.close());
    nav();
    d.scrollTop = 0;
    sfx('tap');
  };
  nav();
  d.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => (b.onclick = () => void step(Number(b.dataset.d))));
  d.addEventListener('keydown', (e) => {
    if (sibs.length < 2 || e.isComposing || (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const k = KEYS.is(e, 'ed.prev') ? -1 : KEYS.is(e, 'ed.next') ? 1 : 0;
    if (k) e.preventDefault(), void step(k);
  });
  $('.dlg-x', d).onclick = () => d.close();
  d.addEventListener('click', (e) => e.target === d && d.close());
  d.addEventListener('close', async () => {
    await done();
    d.remove();
    if (RV.cur) RV.cur = S.cards.get(RV.cur.id) ?? null;
    if (view === 'review') showReview();
    else if (view === 'browse' && $('.br', app)) {
      // the panel follows to the card he was on last
      const last = sibs[at] && cardsOf(sibs[at].id)[0];
      if (last && sibs.length > 1) BR.pick = last.id;
      reopen();
    }
  });
  d.showModal();
  // the window opens with nothing focused for typing, so his shortcuts work at once; a click puts the caret in a field
  d.focus();
}

/** Pictures pasted or dropped into a field as files: kept on the site, then put in where the caret is. */
async function upload(files: File[], f: HTMLElement, save: () => void) {
  const imgs = files.filter((x) => /^image\//.test(x.type));
  if (!imgs.length) return;
  if (!navigator.onLine) return toast('Pictures need signal.');
  for (const file of imgs) {
    try {
      const r = await fetch('/api/plus/upload', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('cb-token') ?? ''}`, 'Content-Type': file.type }, body: file });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      f.focus();
      document.execCommand('insertHTML', false, `<img src="${esc(j.url)}">`);
      save();
    } catch (err) {
      toast(esc((err as Error).message || 'The picture didn’t come through.'));
    }
  }
}
/** Pictures that came in with pasted HTML (another page's): kept on the site, as Add does (cards.ts grab). */
async function keepPics(f: HTMLElement, save: () => void) {
  for (const im of f.querySelectorAll<HTMLImageElement>('img')) {
    const src = im.getAttribute('src') ?? '';
    if (/^\/api\/plus\/media\//.test(src)) continue;
    try {
      let url: string;
      if (/^(data:|blob:)/.test(src)) {
        const b = await (await fetch(src)).blob();
        const r = await fetch('/api/plus/upload', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('cb-token') ?? ''}`, 'Content-Type': b.type }, body: b });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        url = j.url;
      } else url = (await api('grab', { url: src })).url;
      im.setAttribute('src', url);
    } catch {
      im.remove();
      toast('A picture couldn’t be kept: it was taken out.');
    }
    save();
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

// ================= Browse: one row per word (every card once the Card filter is on); filters as chips (filter.ts) =================
const BR_V = 2;
// sel: the rows picked (a word's row is its first card's id); pick: the card the panel shows of that word
const BR = { f: blank(), sort: 'added' as Sort, desc: true, tray: '', sel: new Set<number>(), last: 0, limit: 300, close: null as null | (() => Promise<void>), face: 'a' as 'q' | 'a', note: false, pick: 0 };
/** Every card, not one row per word: when he asks for card types. */
const perCard = () => BR.f.card.length > 0;
// his filters and sort stay between visits (not the search text); a newer shape of them starts clean (BR_V).
// A second click on Browse (or its key) while in it is back to all this: newest first, nothing picked (resetBrowse).
try {
  const j = JSON.parse(localStorage.getItem('cbp-browse') || 'null');
  if (j?.v === BR_V) Object.assign(BR, { f: { ...blank(), ...j.f, q: '' }, sort: j.sort ?? 'added', desc: j.desc ?? true });
} catch {}
function saveBR() {
  try {
    localStorage.setItem('cbp-browse', JSON.stringify({ v: BR_V, f: { ...BR.f, q: '' }, sort: BR.sort, desc: BR.desc }));
  } catch {}
}
// the index: worked out once per change of the collection (or of the day, or of his words' uses), then every keystroke
// and chip only filters it
declare const STATE: { uses?: Record<string, number> } | null | undefined;
let IX: Item[] | null = null, IXday = -1;
const usesMap = () => {
  try {
    return (typeof STATE !== 'undefined' && STATE?.uses) || {};
  } catch {
    return {};
  }
};
function items() {
  const k = ck();
  if (!IX || IXday !== k.today) {
    const seen = seenMap(), way = onTheWay(), th = TH();
    IX = index(S.cards.values(), (id) => S.notes.get(id), typeOf, k, conf().w, usesMap(), (c, n) => (way.has(n.id) ? null : verdict(c, n.tags, th, seen[n.id] ?? 0)));
    IXday = k.today;
  }
  return IX;
}
onChange((what) => what !== 'sync' && (IX = null));
BUS.on('data', () => {
  IX = null;
  if (VIEW === 'reviews' && view === 'browse') paintBrowse();
});

const STATE_NAME: Record<State, string> = { new: 'New', learning: 'Learning', young: 'Young', mature: 'Mature', suspended: 'Suspended', buried: 'Buried' };
const EASE_NAME: Record<Ease, string> = { hard: 'Too hard', easy: 'Too easy' };
const DUE_NAME: Record<string, string> = { overdue: 'Overdue', today: 'Today', week: '7 days' };
const DOTS = (n: number) => `<span class="dots" aria-label="${n} of 3">${'●'.repeat(n)}${'○'.repeat(3 - n)}</span>`;
const fmtN = (n: number) => n.toLocaleString('en-US');
const fmtRange = (r: Range, unit = '') => (r[0] != null && r[1] != null ? (r[0] === r[1] ? `${r[0]}${unit}` : `${r[0]}–${r[1]}${unit}`) : r[0] != null ? `${r[0]}${unit}+` : `≤ ${r[1]}${unit}`);
const isOpen = (r: Range) => r[0] == null && r[1] == null;
const MEM: [keyof Filters & ('ivl' | 's' | 'd' | 'r' | 'lapses'), string, string][] = [
  ['ivl', 'Interval', 'd'],
  ['s', 'Stability', 'd'],
  ['d', 'Difficulty', ''],
  ['r', 'Recall', '%'],
  ['lapses', 'Lapses', ''],
];
const DAYS: [number, string][] = [
  [1, 'Today'],
  [7, '7 days'],
  [30, '30 days'],
];
const tmplNames = () => [...new Set(items().map((x) => x.tmpl).filter(Boolean))];

/** The chips: each one's name when off, what it's set to when on. */
const FACETS: { id: string; name: string; on: () => boolean; text: () => string; clear: () => void; show?: () => boolean }[] = [
  { id: 'state', name: 'State', on: () => !!BR.f.state.length, text: () => BR.f.state.map((s) => STATE_NAME[s]).join(', '), clear: () => (BR.f.state = []) },
  { id: 'due', name: 'Due', on: () => !!BR.f.due && (BR.f.due !== 'range' || !isOpen(BR.f.dueR)), text: () => (BR.f.due === 'range' ? `Due in ${fmtRange(BR.f.dueR, 'd')}` : DUE_NAME[BR.f.due]), clear: () => ((BR.f.due = ''), (BR.f.dueR = [null, null])) },
  { id: 'card', name: 'Card', on: () => !!BR.f.card.length, text: () => BR.f.card.join(', '), clear: () => (BR.f.card = []) },
  { id: 'ease', name: 'Ease', on: () => !!BR.f.ease.length, text: () => BR.f.ease.map((e) => EASE_NAME[e]).join(', '), clear: () => (BR.f.ease = []) },
  { id: 'media', name: 'Media', on: () => !!(BR.f.pic || BR.f.audio), text: () => [BR.f.pic && (BR.f.pic === 'yes' ? 'Picture' : 'No picture'), BR.f.audio && (BR.f.audio === 'yes' ? 'Audio' : 'No audio')].filter(Boolean).join(', '), clear: () => ((BR.f.pic = ''), (BR.f.audio = '')) },
  { id: 'uses', name: 'Uses', on: () => !!BR.f.uses.length, text: () => BR.f.uses.map((n) => `${n}/3`).join(', '), clear: () => (BR.f.uses = []), show: () => !!Object.keys(usesMap()).length },
  {
    id: 'mem',
    name: 'Memory',
    on: () => MEM.some(([k]) => !isOpen(BR.f[k] as Range)),
    text: () => {
      const on = MEM.filter(([k]) => !isOpen(BR.f[k] as Range));
      return on.map(([k, n, u]) => `${n} ${fmtRange(BR.f[k] as Range, u)}`).join(', ');
    },
    clear: () => MEM.forEach(([k]) => ((BR.f[k] as Range) = [null, null])),
  },
  {
    id: 'dates',
    name: 'Dates',
    on: () => BR.f.added != null || BR.f.rev != null,
    text: () => [BR.f.added != null && (BR.f.added === 1 ? 'Added today' : `Added ${BR.f.added} days`), BR.f.rev != null && (BR.f.rev === 'never' ? 'Never reviewed' : BR.f.rev === 1 ? 'Reviewed today' : `Reviewed ${BR.f.rev} days`)].filter(Boolean).join(', '),
    clear: () => ((BR.f.added = null), (BR.f.rev = null)),
  },
];

const SEARCH = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
function showBrowse() {
  app.innerHTML = `<section class="br">
    <div class="br-top"><label class="br-s">${SEARCH}<input class="br-q" type="search" placeholder="Word, sentence or pinyin" aria-label="Search" value="${esc(BR.f.q)}" spellcheck="false" autocomplete="off" enterkeyhint="search" lang="zh-Hant"></label><p class="br-n" aria-live="polite" data-js-text></p></div>
    <div class="br-chips" role="toolbar" aria-label="Filters"></div>
    <div class="br-tray" hidden></div>
    <div class="br-bulk" hidden></div>
    <div class="br-main"><div class="br-tbl" role="grid" aria-label="Cards"></div><aside class="br-side" hidden></aside></div></section>`;
  const q = $<HTMLInputElement>('.br-q', app);
  // every keystroke filters the index at once (no wait); painting waits for the next frame, so fast typing paints once
  let raf = 0;
  q.oninput = () => {
    BR.f.q = q.value;
    BR.limit = 300;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => paintBrowse());
  };
  paintBrowse();
}
function results() {
  const rows = filterBy(items(), BR.f, ck());
  return sortBy(perCard() ? rows : byWord(rows), BR.sort, BR.desc);
}
const words = (l: Item[]) => new Set(l.map((x) => (x.word ? 'w:' + x.word : 'n:' + x.note.id))).size; // as byWord groups them
/** Back to how Browse opens the first time: no search, no filters, newest added first, nothing open. */
async function resetBrowse() {
  Object.assign(BR, { f: blank(), sort: 'added', desc: true, tray: '', sel: new Set(), last: 0, limit: 300, pick: 0, face: 'a' });
  saveBR();
  await closeSide();
  if (view !== 'browse') return;
  showBrowse();
  scrollTo({ top: 0 });
  takeKeys();
}
// its key (⇧B, page.browse) while in Browse: the same as a second click. Before kit/go.ts sees it (it leaves an open page alone).
addEventListener(
  'keydown',
  (e) => {
    if (e.repeat || e.isComposing || !ready || VIEW !== 'reviews' || view !== 'browse' || !KEYS.is(e, 'page.browse')) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])') || document.querySelector('dialog[open]')) return;
    sfx('tap');
    void resetBrowse();
  },
  true,
);
const COLS: [Sort, string][] = [
  ['word', 'Word'],
  ['card', 'Card'],
  ['state', 'State'],
  ['due', 'Due'],
  ['ivl', 'Interval'],
  ['r', 'Recall'],
  ['lapses', 'Lapses'],
];
const pct = (r: number | null) => (r == null ? '' : `${Math.round(r * 100)}%`);
function paintBrowse() {
  if (view !== 'browse' || !$('.br', app)) return;
  const k = ck(), all = items(), rows = results(), shown = rows.slice(0, BR.limit);
  const total = perCard() ? all.length : words(all), unit = perCard() ? 'cards' : 'words';
  $('.br-n', app).innerHTML = rows.length === total ? `${fmtN(total)} ${unit}` : `<b>${fmtN(rows.length)}</b> of ${fmtN(total)}`;
  paintChips();
  paintTrayCounts();
  const tbl = $('.br-tbl', app);
  tbl.innerHTML = `<div class="tr th" role="row">${COLS.map(([key, name]) => `<button type="button" role="columnheader" class="td c-${key}${BR.sort === key ? (BR.desc ? ' desc' : ' asc') : ''}" data-sort="${key}" aria-sort="${BR.sort === key ? (BR.desc ? 'descending' : 'ascending') : 'none'}">${name}</button>`).join('')}</div>
    ${shown
      .map(
        (x) =>
          `<div class="tr${BR.sel.has(x.card.id) ? ' sel' : ''} st-${x.state}" data-c="${x.card.id}" role="row" aria-selected="${BR.sel.has(x.card.id)}"><span class="td c-word zh">${x.flag ? `<i class="fd fd${x.flag}"></i>` : ''}${esc(x.word)}<span class="c-kind">${esc(x.tmpl)}</span></span><span class="td c-card">${esc(x.tmpl)}</span><span class="td c-state"><i class="sdot"></i>${STATE_NAME[x.state]}</span><span class="td c-due">${x.due == null ? '' : dueText(x.card, k)}</span><span class="td c-ivl">${x.ivl ? label(x.ivl) : ''}</span><span class="td c-r">${pct(x.r)}</span><span class="td c-lapses">${x.lapses || ''}</span></div>`,
      )
      .join('')}
    ${rows.length > shown.length ? `<button type="button" class="btn-q br-more">Show all ${fmtN(rows.length)}</button>` : ''}${rows.length ? '' : `<div class="br-none"><p>Nothing matches.</p>${active(BR.f) || BR.f.q ? '<button type="button" class="btn-q" data-clear="1">Clear filters</button>' : ''}</div>`}`;
  tbl.querySelectorAll<HTMLElement>('[data-sort]').forEach(
    (b) =>
      (b.onclick = () => {
        const s = b.dataset.sort as Sort;
        // a new column starts the way that reads best: words A→Z, numbers biggest first, due soonest first
        BR.desc = BR.sort === s ? !BR.desc : !['word', 'card', 'due', 'state'].includes(s);
        BR.sort = s;
        saveBR();
        paintBrowse();
      }),
  );
  $('[data-clear]', tbl)?.addEventListener('click', clearFilters);
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
        BR.pick = 0;
        paintSel();
      }),
  );
  paintSel();
}
function clearFilters() {
  const q = BR.f.q;
  BR.f = blank();
  BR.f.q = q && !active(BR.f) ? q : '';
  BR.tray = '';
  BR.limit = 300;
  const inp = $<HTMLInputElement>('.br-q', app);
  if (inp) inp.value = BR.f.q;
  saveBR();
  sfx('unstamp');
  paintTray();
  paintBrowse();
}
function paintChips() {
  const el = $('.br-chips', app);
  if (!el) return;
  const on = active(BR.f);
  el.innerHTML =
    FACETS.filter((f) => !f.show || f.show() || f.on())
      .map((f) => {
        const a = f.on();
        return `<span class="fc${a ? ' on' : ''}${BR.tray === f.id ? ' open' : ''}"><button type="button" class="fc-b" data-fc="${f.id}" aria-expanded="${BR.tray === f.id}">${a ? esc(f.text()) : f.name}</button>${a ? `<button type="button" class="fc-x" data-fx="${f.id}" aria-label="Clear ${f.name}">×</button>` : ''}</span>`;
      })
      .join('') + (on ? `<button type="button" class="fc-clear" data-clear="1">Clear</button>` : '');
  el.querySelectorAll<HTMLElement>('[data-fc]').forEach(
    (b) =>
      (b.onclick = () => {
        BR.tray = BR.tray === b.dataset.fc ? '' : b.dataset.fc!;
        sfx('tap');
        paintChips();
        paintTray();
      }),
  );
  el.querySelectorAll<HTMLElement>('[data-fx]').forEach(
    (b) =>
      (b.onclick = () => {
        FACETS.find((f) => f.id === b.dataset.fx)!.clear();
        if (BR.tray === b.dataset.fx) BR.tray = '';
        changed(true);
      }),
  );
  $('[data-clear]', el)?.addEventListener('click', clearFilters);
}
/** A filter changed: remembered, the list follows; the tray is drawn again only when asked (a field being typed in keeps its place). */
function changed(tray = false) {
  BR.limit = 300;
  saveBR();
  sfx('tap');
  if (tray) paintTray();
  paintBrowse();
}
// ---------- the tray: the open chip's choices, each with how many cards it would leave ----------
const opt = (k: string, v: string | number, text: string, on: boolean) => `<button type="button" class="tc${on ? ' on' : ''}" data-k="${k}" data-v="${v}" aria-pressed="${on}">${text}<span class="tn" data-js-text></span></button>`;
const rangeRow = (k: string, name: string, r: Range, unit: string) =>
  `<div class="trr"><span class="trl">${name}</span><input class="tri" data-r="${k}" data-i="0" inputmode="decimal" placeholder="from" aria-label="${name} from" value="${r[0] ?? ''}"><span class="trd">–</span><input class="tri" data-r="${k}" data-i="1" inputmode="decimal" placeholder="to" aria-label="${name} to" value="${r[1] ?? ''}"><span class="tru">${unit === 'd' ? 'days' : unit}</span></div>`;
function paintTray() {
  const el = $('.br-tray', app);
  if (!el) return;
  el.hidden = !BR.tray;
  if (!BR.tray) return void (el.innerHTML = '');
  const f = BR.f;
  let h = '';
  if (BR.tray === 'state') h = `<div class="trw">${STATES.map((s) => opt('state', s, `<i class="sdot sd-${s}"></i>${STATE_NAME[s]}`, f.state.includes(s))).join('')}</div>`;
  else if (BR.tray === 'due')
    h = `<div class="trw">${(['overdue', 'today', 'week'] as const).map((d) => opt('due', d, DUE_NAME[d], f.due === d)).join('')}</div>${rangeRow('dueR', 'In', f.due === 'range' ? f.dueR : [null, null], 'd')}`;
  else if (BR.tray === 'card') h = `<div class="trw">${tmplNames().map((t) => opt('card', esc(t), esc(t), f.card.includes(t))).join('')}</div>`;
  else if (BR.tray === 'ease') h = `<div class="trw">${(['hard', 'easy'] as Ease[]).map((e) => opt('ease', e, EASE_NAME[e], f.ease.includes(e))).join('')}</div>`;
  else if (BR.tray === 'media')
    h = `<div class="trw"><span class="trl">Picture</span>${opt('pic', 'yes', 'With', f.pic === 'yes')}${opt('pic', 'no', 'Without', f.pic === 'no')}</div><div class="trw"><span class="trl">Audio</span>${opt('audio', 'yes', 'With', f.audio === 'yes')}${opt('audio', 'no', 'Without', f.audio === 'no')}</div>`;
  else if (BR.tray === 'uses') h = `<div class="trw">${[0, 1, 2].map((n) => opt('uses', n, DOTS(n), f.uses.includes(n))).join('')}</div>`;
  else if (BR.tray === 'mem') h = MEM.map(([k, n, u]) => rangeRow(k, n, f[k] as Range, u)).join('');
  else if (BR.tray === 'dates')
    h = `<div class="trw"><span class="trl">Added</span>${DAYS.map(([d, t]) => opt('added', d, t, f.added === d)).join('')}</div><div class="trw"><span class="trl">Reviewed</span>${DAYS.map(([d, t]) => opt('rev', d, t, f.rev === d)).join('')}${opt('rev', 'never', 'Never', f.rev === 'never')}</div>`;
  el.innerHTML = h;
  el.querySelectorAll<HTMLElement>('[data-k]').forEach(
    (b) =>
      (b.onclick = () => {
        pick1(b.dataset.k!, b.dataset.v!);
        changed(true);
      }),
  );
  el.querySelectorAll<HTMLInputElement>('[data-r]').forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.r as 'dueR' | 'ivl' | 's' | 'd' | 'r' | 'lapses', i = Number(inp.dataset.i);
      const v = inp.value.trim() === '' || isNaN(Number(inp.value)) ? null : Number(inp.value);
      const r = [...(BR.f[k] as Range)] as Range;
      r[i] = v;
      (BR.f[k] as Range) = r;
      if (k === 'dueR') BR.f.due = isOpen(r) ? '' : 'range';
      BR.limit = 300;
      saveBR();
      paintBrowse();
      // the due presets light up or go out with the range
      if (k === 'dueR') el.querySelectorAll<HTMLElement>('[data-k="due"]').forEach((b) => (b.classList.toggle('on', false), b.setAttribute('aria-pressed', 'false')));
    };
  });
  paintTrayCounts();
}
/** One choice in the tray: several of a kind combine (any of them); a one-of kind (due, picture, dates) swaps. */
function pick1(k: string, v: string) {
  const f = BR.f;
  const flip = <T>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  if (k === 'state') f.state = flip(f.state, v as State);
  else if (k === 'card') f.card = flip(f.card, tmplNames().find((t) => esc(t) === v) ?? v);
  else if (k === 'ease') f.ease = flip(f.ease, v as Ease);
  else if (k === 'uses') f.uses = flip(f.uses, Number(v));
  else if (k === 'due') ((f.due = f.due === v ? '' : (v as Due)), (f.dueR = [null, null]));
  else if (k === 'pic' || k === 'audio') f[k] = f[k] === v ? '' : (v as 'yes' | 'no');
  else if (k === 'added') f.added = f.added === Number(v) ? null : Number(v);
  else if (k === 'rev') {
    const x = v === 'never' ? 'never' : Number(v);
    f.rev = f.rev === x ? null : x;
  }
}
/** How many cards each choice leaves, with everything else as it is (that kind's own choice set to just this one). */
function paintTrayCounts() {
  const el = $('.br-tray', app);
  if (!el || el.hidden) return;
  const k = ck(), all = items();
  el.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
    const kind = b.dataset.k!, v = b.dataset.v!;
    const f: Filters = { ...BR.f };
    if (kind === 'state') f.state = [v as State];
    else if (kind === 'card') f.card = [tmplNames().find((t) => esc(t) === v) ?? v];
    else if (kind === 'ease') f.ease = [v as Ease];
    else if (kind === 'uses') f.uses = [Number(v)];
    else if (kind === 'due') ((f.due = v as Due), (f.dueR = [null, null]));
    else if (kind === 'pic' || kind === 'audio') f[kind] = v as 'yes' | 'no';
    else if (kind === 'added') f.added = Number(v);
    else if (kind === 'rev') f.rev = v === 'never' ? 'never' : Number(v);
    const hit = filterBy(all, f, k), n = perCard() ? hit.length : words(hit);
    b.querySelector('.tn')!.textContent = fmtN(n);
    b.classList.toggle('none', !n);
  });
}

// ---------- the selection: one card opens beside the list (its note one click further), several get bulk actions ----------
async function paintSel() {
  const rows = [...BR.sel].map((id) => S.cards.get(id)).filter((c): c is Card => !!c && S.notes.has(c.nid));
  // a word's row stands for all its cards: what's done to the row is done to them
  const sel = perCard() ? rows : rows.flatMap((c) => cardsOf(c.nid));
  app.querySelectorAll<HTMLElement>('.tr[data-c]').forEach((tr) => {
    const on = BR.sel.has(Number(tr.dataset.c));
    tr.classList.toggle('sel', on);
    tr.setAttribute('aria-selected', String(on));
  });
  const bulk = $('.br-bulk', app);
  bulk.hidden = rows.length < 2;
  if (rows.length >= 2) {
    const anySusp = sel.some((c) => c.queue === -1);
    bulk.innerHTML = `<span class="bk-n">${rows.length} ${perCard() ? 'cards' : 'words'}</span><button type="button" class="btn-q" data-b="${anySusp ? 'unsusp' : 'susp'}">${anySusp ? 'Unsuspend' : 'Suspend'}</button><button type="button" class="btn-q" data-b="red"><i class="fd fd1"></i>Red</button><button type="button" class="btn-q" data-b="green"><i class="fd fd3"></i>Green</button><button type="button" class="btn-q bk-del" data-b="del">Delete</button><button type="button" class="dlg-x" data-b="none" aria-label="Clear selection">${XICON}</button>`;
    bulk.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => (b.onclick = () => bulkAct(b.dataset.b!, sel)));
  }
  const side = $('.br-side', app);
  const row = rows.length === 1 ? rows[0] : null;
  // a word's panel shows one of its cards at a time (the one he picks; first, the row's own)
  // every card of the word, across its notes (a word with a second card has two notes)
  const rowWord = row ? wordOfCard(row) : '';
  const sibNids = !row || perCard() ? [] : rowWord ? [...S.notes.values()].filter((n) => wordOfNote(n) === rowWord).map((n) => n.id).sort((a, b) => a - b) : [row.nid];
  const sib = wordRows(sibNids, live()).filter((c) => typeOf(S.notes.get(c.nid)!));
  const focus = row && BR.pick && sib.some((c) => c.id === BR.pick) ? S.cards.get(BR.pick)! : row;
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
  const x = items().find((i) => i.card.id === focus.id) ?? index([focus], (id) => S.notes.get(id), typeOf, ck(), conf().w, usesMap())[0];
  const note = x.note, f = x.flag;
  const day = (n: number | null) => (n == null ? '' : n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fmtDay(Date.now() - n * 864e5));
  const facts: [string, string][] = (
    [
      ['Due', x.due == null ? '' : dueText(x.card)],
      ['Interval', x.ivl ? label(x.ivl) : ''],
      ['Recall', pct(x.r)],
      ['Stability', x.s == null ? '' : label(Math.max(1, Math.round(x.s)))],
      ['Difficulty', x.d == null ? '' : `${Math.round(x.d * 10) / 10} / 10`],
      ['Lapses', x.reps ? String(x.lapses) : ''],
      ['Reviews', x.reps ? String(x.reps) : ''],
      ['Last', day(x.last)],
      ['Added', day(x.added)],
      ['Uses', x.uses == null ? '' : DOTS(x.uses)],
    ] as [string, string][]
  ).filter(([, v]) => v);
  side.innerHTML = `<div class="sd-top"><span class="sd-w zh">${esc(x.word)}</span><button type="button" class="dlg-x" aria-label="Close">${XICON}</button></div>
    <p class="sd-sub"><span class="sd-st st-${x.state}"><i class="sdot"></i>${STATE_NAME[x.state]}</span>${sib.length > 1 ? '' : `<span>${esc(x.tmpl)}</span>`}</p>
    ${sib.length > 1 ? `<div class="sd-cards" role="radiogroup" aria-label="Cards">${sib.map((c) => cardRow(c, c.id === focus.id, sibNids.length > 1)).join('')}</div>` : ''}
    <div class="sd-face"><div class="sd-seg" role="radiogroup" aria-label="Side"><button type="button" role="radio" data-face="q" aria-checked="${BR.face === 'q'}">Front</button><button type="button" role="radio" data-face="a" aria-checked="${BR.face === 'a'}">Back</button></div><div class="host sd-host"></div></div>
    <dl class="sd-facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <div class="sd-act"><button type="button" class="btn-q" data-s="susp">${focus.queue === -1 ? 'Unsuspend' : 'Suspend'}</button><button type="button" class="btn-q${f === 1 ? ' on' : ''}" data-s="red"><i class="fd fd1"></i>Red</button><button type="button" class="btn-q${f === 3 ? ' on' : ''}" data-s="green"><i class="fd fd3"></i>Green</button></div>
    ${quickHelp(note.id)}
    <button type="button" class="sd-note" aria-expanded="${BR.note}"><span>Note</span><i aria-hidden="true"></i></button>
    <div class="sd-ed"${BR.note ? '' : ' hidden'}></div>`;
  const face = () => {
    const host = $('.sd-host', side);
    const root = draw(host, { card: x.card, note: S.notes.get(note.id) ?? note, type: typeOf(note) }, BR.face);
    const loud = !!root.querySelector('[data-sound]');
    host.classList.toggle('loud', loud);
    host.onclick = loud ? () => playAll(root) : null;
  };
  face();
  side.querySelectorAll<HTMLElement>('[data-pc]').forEach(
    (b) =>
      (b.onclick = () => {
        BR.pick = Number(b.dataset.pc);
        sfx('tap');
        delete side.dataset.c;
        void paintSel();
      }),
  );
  bindTriage(side, reopen);
  side.querySelectorAll<HTMLElement>('[data-face]').forEach(
    (b) =>
      (b.onclick = () => {
        BR.face = b.dataset.face as 'q' | 'a';
        side.querySelectorAll('[data-face]').forEach((y) => y.setAttribute('aria-checked', String(y === b)));
        face();
      }),
  );
  const ed = $('.sd-ed', side);
  const openNote = () => {
    if (!BR.close) BR.close = editor(ed, S.notes.get(note.id) ?? note, () => closeSide());
  };
  if (BR.note) openNote();
  $('.sd-note', side).onclick = async (e) => {
    BR.note = !BR.note;
    (e.currentTarget as HTMLElement).setAttribute('aria-expanded', String(BR.note));
    ed.hidden = !BR.note;
    sfx('tap');
    if (BR.note) openNote();
    else {
      // closing the note keeps the edit (one undo step) and redraws the card with it
      const close = BR.close;
      BR.close = null;
      await close?.();
      ed.innerHTML = '';
      face();
    }
  };
  $('.dlg-x', side).onclick = () => closeSide();
  side.querySelectorAll<HTMLElement>('[data-s]').forEach(
    (b) =>
      (b.onclick = async () => {
        const s = b.dataset.s!, c = S.cards.get(focus.id)!;
        if (s === 'susp') await change(c.queue === -1 ? 'Unsuspend' : 'Suspend', [['card', c.id, { ...c, queue: c.queue === -1 ? unsuspended(c) : -1 }]]);
        if (s === 'red' || s === 'green') return flagIt(s === 'red' ? 1 : 3, [c]).then(reopen);
        reopen();
      }),
  );
}
/** ↑ ↓ in Browse: the next row (or the previous) opens, as a click would; the first ↓ opens the top row. */
function moveRow(d: number) {
  // the rows as the search and filters stand now (a keystroke's repaint may still be waiting for its frame)
  const ids = results().slice(0, BR.limit).map((x) => x.card.id);
  if (!ids.length) return;
  const cur = BR.sel.size === 1 ? [...BR.sel][0] : BR.last;
  const next = nextRow(ids, cur, d);
  if (next == null || (next === cur && BR.sel.size === 1)) return;
  BR.sel = new Set([next]);
  BR.last = next;
  BR.pick = 0;
  if (!app.querySelector(`.tr[data-c="${next}"]`)) paintBrowse();
  else void paintSel();
  app.querySelector(`.tr[data-c="${next}"]`)?.scrollIntoView({ block: 'nearest' });
}
/** E in Browse: the Edit window for the card the panel shows (the panel's own Note closes first, its edit kept). */
async function editOpen() {
  const side = $('.br-side', app), c = side && !side.hidden ? S.cards.get(Number(side.dataset.c)) : null;
  const n = c && S.notes.get(c.nid);
  if (!n) return;
  const close = BR.close;
  BR.close = null;
  await close?.();
  const ed = $('.sd-ed', side);
  if (ed) ed.innerHTML = '';
  sfx('tap');
  editDialog(S.notes.get(n.id) ?? n);
}
/** One of the word's cards as a row in its panel: its sentence (the note's, when the word has more than one note), then
 *  its card type. */
function cardRow(c: Card, on: boolean, notes: boolean) {
  const n = S.notes.get(c.nid)!, t = typeOf(n)!;
  const say = rowText(n.flds[fieldIndex(t, 'Chinese')] ?? '', wordOfNote(n));
  const st = items().find((i) => i.card.id === c.id)?.state;
  const kind = esc(t.templates.find((x) => x.ord === c.ord)?.name ?? '');
  return `<button type="button" role="radio" class="sd-row${st ? ' st-' + st : ''}" data-pc="${c.id}" aria-checked="${on}">${notes ? `<span class="sd-rs zh">${esc(say)}</span><span class="sd-rt">${kind}</span>` : `<span class="sd-rs">${kind}</span>`}</button>`;
}
const reopen = () => {
  const side = $('.br-side', app);
  if (side) delete side.dataset.c;
  paintBrowse();
};
/** The word's quick actions in its panel, when it's too easy or too hard. */
function quickHelp(nid: number) {
  const list = flaggedList(), f = list.find((x) => x.nid === nid);
  if (f?.ease === 'easy') void askPartners();
  return f ? `<div class="sd-help"><span class="sd-hl">${EASE_NAME[f.ease]}</span>${quickActs(f, list)}</div>` : '';
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
  try {
    await change(name, [['conf', cur.id, { ...cur, ...patch }]]);
  } catch (e) {
    toast(esc((e as Error).message || 'That didn’t save.'));
  }
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
        // Polish: Card designs open inside the Settings window, as a page of its own with a way back (kit/settings.ts)
        SETTINGS.page(
          'Card designs',
          (host) => ((TY_HOST = host), showDesigns()),
          () => (TY_HOST = null),
        );
        // (end Polish)
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
// Polish: where Card designs draw: inside Settings (SETTINGS.page) when it's open there, else the tab's own page
let TY_HOST: HTMLElement | null = null;
const RX_APP = app;
// (end Polish)
function showDesigns() {
  // Polish
  const app = TY_HOST?.isConnected ? TY_HOST : RX_APP;
  // (end Polish)
  const types = [...S.types.values()].filter((t) => USED.includes(t.name) || [...S.notes.values()].some((n) => n.mid === t.id));
  if (!S.types.has(TY.id)) TY.id = col().notetype;
  const t = S.types.get(TY.id)!;
  app.innerHTML = `<section class="ty"><div class="ty-top">${app === RX_APP ? '<button type="button" class="btn-q ty-back" aria-label="Back to settings">‹ Settings</button>' : ''}
    <div class="br-f" role="radiogroup" aria-label="Note type">${types.map((x) => `<button type="button" role="radio" data-ty="${x.id}" aria-checked="${x.id === t.id}">${esc(x.name.replace(/^Chinese /, '').replace(/^Chinese$/, 'Words'))}</button>`).join('')}</div>
    <div class="br-f" role="radiogroup" aria-label="Part">${(['fields', 'cards', 'css'] as const).map((k) => `<button type="button" role="radio" data-tab="${k}" aria-checked="${TY.tab === k}">${k === 'fields' ? 'Fields' : k === 'cards' ? 'Front and back' : 'Styling'}</button>`).join('')}</div></div><div class="ty-body"></div></section>`;
  const tb = app.querySelector<HTMLElement>('.ty-back');
  if (tb) tb.onclick = () => (go('review'), SETTINGS.open());
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
    // Polish: Card designs inside Settings (any page): Cmd+Z / Shift+Cmd+Z are theirs there
    if (TY_HOST?.isConnected && !e.isComposing && (KEYS.is(e, 'undo') || KEYS.is(e, 'redo')) && !(e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return void (KEYS.is(e, 'redo') ? redo() : undo()).then(() => TY_HOST?.isConnected && showDesigns());
    }
    // (end Polish)
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
      if (closePick()) return e.stopImmediatePropagation();
      if (RV.flags) return e.stopImmediatePropagation(), (RV.flags = false), paintFlags();
      if (view === 'browse' && BR.tray && !document.querySelector('dialog[open]')) return e.stopImmediatePropagation(), (BR.tray = ''), paintChips(), paintTray();
      if (view === 'browse' && BR.sel.size && !document.querySelector('dialog[open]')) return e.stopImmediatePropagation(), (BR.sel = new Set()), closeSide(), paintSel();
      return;
    }
    // an editor open (the dialog or Browse's side): the sentence's audio, made if there is none (or made again)
    // (a held key repeats: only the first press counts, or one V made two recordings and played both)
    if (!typing && ED?.host.isConnected && (KEYS.is(e, 'rv.voice') || KEYS.is(e, 'rv.revoice'))) return eat(), e.repeat ? undefined : ED.voice(KEYS.is(e, 'rv.revoice'));
    // Combine: Browse by keyboard: ↑ ↓ through the rows (from the search box too), E edits the open row's card
    if (view === 'browse' && !document.querySelector('dialog[open]')) {
      const inQ = !!t.closest?.('.br-q');
      if ((!typing || inQ) && (KEYS.is(e, 'br.down') || KEYS.is(e, 'br.up'))) {
        eat();
        if (inQ) t.blur();
        return moveRow(KEYS.is(e, 'br.down') ? 1 : -1);
      }
      if (!typing && !e.repeat && KEYS.is(e, 'br.edit')) return eat(), void editOpen();
    }
    // (end Combine)
    if (typing || document.querySelector('dialog[open]') || view !== 'review') return;
    // the flag picker, while open, takes its own keys
    if (RV.flags) {
      const f = KEYS.is(e, 'rv.red') ? 1 : KEYS.is(e, 'rv.green') ? 3 : KEYS.is(e, 'rv.noflag') ? 0 : -1;
      if (f >= 0) return eat(), flagIt(f);
      if (KEYS.is(e, 'rv.flag')) return e.preventDefault(), act('flag');
    }
    // Space and Enter press a button only when he got to it with Tab (a clicked one, like the Reviews tab, doesn't count)
    const on = t.closest?.('button');
    if ((e.key === ' ' || e.key === 'Enter') && on && on.matches(':focus-visible') && !on.matches('.rw-show,.rw-a')) return;
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
    // Combine: partners for the words already too easy, asked once in the background
    setTimeout(() => void askPartners(), 8000);
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
  const host = $('.host', app);
  void RUBY.set(host?.shadowRoot?.querySelector('.card'), RV.py).then(() => refit(host));
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

// Habit: what the habit (board/js/habit.js) reads, never changes. RVH.ready(): the collection is on this device;
// RVH.left(): cards still to do today (null until ready); RVH.cards(): every card with its reviews; RVH.dayOf(ms): the
// collection's day of a moment and RVH.date(n): that day as 'YYYY-MM-DD'; RVH.today(): today's day number.
// BUS 'reviews:changed' after the collection loads and whenever it changes here or on another device.
(window as unknown as { RVH: unknown }).RVH = {
  ready: () => ready,
  left: () => (ready ? left() : null),
  cards: () => S.cards.values(),
  dayOf: (ms: number) => ck().dayOf(ms),
  today: () => ck().today,
  date: (n: number) => {
    const d0 = col().day0;
    return new Date(Date.UTC(+d0.slice(0, 4), +d0.slice(5, 7) - 1, +d0.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10);
  },
};
void start()?.then(() => BUS.emit('reviews:changed'));
onChange(() => ready && BUS.emit('reviews:changed'));
// (end Habit)
