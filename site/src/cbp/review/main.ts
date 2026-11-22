// Chinese Brain Plus, Stage 4: his reviews, Anki rebuilt (/plus/review). The whole collection lives on the device
// (store.ts) so it works with no signal; the scheduler is sched.ts (FSRS, as Anki runs it); his own templates and
// styling draw the cards (render.ts). Views: Review, Browse, Add, Note types, Options, and the check against Anki.
import { S, load, put, putMany, sync, api, onChange, type Note, type NoteType, type ColMeta } from './store.ts';
import { render, frontShows, strip, wordOf, sortText, search, fieldIndex, sounds, type Row } from './render.ts';
import { answer, clock, queue, forecast, label, missed3, right3, grades, type Card, type Conf, type Rev } from '../sched.ts';

const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const app = $('#app');

// ---------- the collection, read ----------
const col = () => S.meta.get('col') as ColMeta;
const ck = () => clock(col().day0, col().rollover);
const confOf = (c: Card): Conf => S.confs.get(S.decks.get(c.did)?.conf ?? col().conf) ?? S.confs.get(col().conf) ?? [...S.confs.values()][0];
const typeOf = (n: Note) => S.types.get(n.mid);
const rowOf = (c: Card): Row | null => {
  const note = S.notes.get(c.nid);
  return note ? { card: c, note, type: typeOf(note) } : null;
};
const cardsOf = (nid: number) => [...S.cards.values()].filter((c) => c.nid === nid).sort((a, b) => a.ord - b.ord);
const dueText = (c: Card, k = ck()) => {
  if (c.queue === -1) return 'suspended';
  if (c.type === 0) return 'new';
  if (c.queue === 1) return new Date(c.due * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const d = c.due - k.today;
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : d < 0 ? `${-d}d late` : new Date(Date.now() + d * 864e5).toLocaleDateString([], { month: 'short', day: 'numeric', ...(d > 300 ? { year: 'numeric' } : {}) });
};

/** What today already holds: cards started, reviews done, notes seen (one card per note a day). */
function today() {
  const k = ck();
  let fresh = 0, revs = 0;
  const seen = new Set<number>();
  for (const c of S.cards.values()) {
    const t = c.revs.filter((r) => k.dayOf(r[0]) === k.today && r[6] <= 3);
    if (!t.length) continue;
    seen.add(c.nid);
    if (c.revs[0] && k.dayOf(c.revs[0][0]) === k.today && c.revs[0][6] === 0) fresh++;
    revs += t.filter((r) => r[6] === 1).length ? 1 : 0;
  }
  return { fresh, revs, seen };
}

// ---------- toasts ----------
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, act?: [string, () => void]) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span>${esc(msg)}</span>${act ? `<button type="button">${esc(act[0])}</button>` : ''}`;
  if (act) el.querySelector('button')!.onclick = () => (el.remove(), act[1]());
  document.body.append(el);
  clearTimeout(toastT);
  toastT = setTimeout(() => el.remove(), 6000);
}

// ---------- a card on screen ----------
let player: HTMLAudioElement | null = null;
function play(src: string) {
  player?.pause();
  player = new Audio(src);
  player.play().catch(() => {});
}
function playAll(root: ShadowRoot | HTMLElement) {
  const list = [...root.querySelectorAll<HTMLElement>('[data-sound]')].map((b) => b.dataset.sound!);
  player?.pause();
  const next = () => {
    const s = list.shift();
    if (!s) return;
    player = new Audio(s);
    player.onended = next;
    player.play().catch(() => {});
  };
  next();
}
const cardCss = (t: NoteType) => t.css.replace(/@import[^;]+;/g, '');
/** Draws one side of a card into `host` with his CSS, kept apart from the page's (a shadow root). */
function draw(host: HTMLElement, r: Row, side: 'q' | 'a') {
  const t = r.type!, tmpl = t.templates.find((x) => x.ord === r.card.ord) ?? t.templates[0];
  const ctx = { note: r.note, type: t, card: r.card, deck: S.decks.get(r.card.did)?.name };
  const q = render(tmpl.qfmt, ctx);
  const html = side === 'q' ? q : render(tmpl.afmt, ctx, q);
  const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${BASE_CARD_CSS}${cardCss(t)}</style><div class="card card${r.card.ord + 1}">${html}</div>`;
  root.querySelectorAll<HTMLElement>('a.hint').forEach((a) => (a.onclick = (e) => (e.preventDefault(), a.remove(), ((a.nextElementSibling as HTMLElement).hidden = false))));
  root.querySelectorAll<HTMLElement>('[data-sound]').forEach((b) => (b.onclick = () => play(b.dataset.sound!)));
  return root;
}
const BASE_CARD_CSS = `:host{display:block}.card{min-height:100%;box-sizing:border-box}hr#answer,hr{border:0;border-top:1px solid #e6e2d8;margin:22px 0}.snd-btn{all:unset;cursor:pointer;display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;background:#eef4ee;vertical-align:middle;margin:4px}.snd-btn::before{content:"";border-left:13px solid #2e7d32;border-top:8px solid transparent;border-bottom:8px solid transparent;margin-left:4px}.hint{color:#8a8578;font-size:15px}`;

// ---------- views ----------
type View = 'review' | 'browse' | 'add' | 'types' | 'options' | 'check';
let view: View = 'review';
const views: Record<View, () => void> = { review: showReview, browse: showBrowse, add: () => showAdd(), types: () => showTypes(), options: showOptions, check: showCheck };
function go(v: View) {
  view = v;
  document.querySelectorAll<HTMLElement>('#nav [data-v]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.v === v || (v !== 'review' && v !== 'browse' && v !== 'add' && b.dataset.v === 'more'))));
  app.className = 'v-' + v;
  views[v]();
  try {
    sessionStorage.setItem('cbp-view', v);
  } catch {}
}

// ================= Review =================
const RV = { cur: null as Card | null, shown: false, t0: 0, undo: [] as { card: Card; note?: Note; rev: number }[], sinceNew: 0, panel: '' as '' | 'deeper' | 'merge', merge: null as null | [number, number], deeperFor: 0 };

function pick(): Card | null {
  const k = ck(), t = today();
  const conf = S.confs.get(col().conf)!;
  const cards = [...S.cards.values()].filter((c) => S.notes.has(c.nid));
  const q = queue(cards, conf, k, new Set(t.seen), t.fresh, t.revs);
  const now = q.learn.filter((c) => c.due * 1000 <= k.now);
  if (now.length) return now[0];
  const { review, fresh } = q;
  // new cards spread through the reviews (Anki's "mix with reviews")
  if (fresh.length && (!review.length || RV.sinceNew >= Math.max(1, Math.floor(review.length / fresh.length)))) return fresh[0];
  if (review.length) return review[0];
  return q.learn[0] ?? null;
}
function counts() {
  const k = ck(), t = today();
  const conf = S.confs.get(col().conf)!;
  const q = queue([...S.cards.values()].filter((c) => S.notes.has(c.nid)), conf, k, new Set(t.seen), t.fresh, t.revs);
  return { n: q.fresh.length, l: q.learn.length, r: q.review.length };
}

function showReview(): void {
  if (RV.panel === 'deeper') return showDeeper();
  if (!RV.cur || !S.cards.has(RV.cur.id) || RV.cur !== S.cards.get(RV.cur.id)) {
    RV.cur = pick();
    RV.shown = false;
    RV.t0 = Date.now();
  }
  const c = RV.cur, n = counts();
  const cnt = `<div class="counts" aria-label="New, learning, review"><b class="cn${c?.type === 0 ? ' on' : ''}">${n.n}</b><b class="cl${c && (c.queue === 1 || c.queue === 3) ? ' on' : ''}">${n.l}</b><b class="cr${c?.queue === 2 ? ' on' : ''}">${n.r}</b></div>`;
  if (!c) {
    const k = ck(), f = forecast([...S.cards.values()], k, 2);
    const nextLearn = [...S.cards.values()].filter((x) => x.queue === 1).sort((a, b) => a.due - b.due)[0];
    app.innerHTML = `<section class="rv done">${cnt}<div class="done-in"><p class="big">Done for today.</p>
      <p>${nextLearn ? `Next card at ${new Date(nextLearn.due * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. ` : ''}Tomorrow: ${f.days[1]}.</p>
      ${RV.undo.length ? '<button type="button" class="ghost" data-a="undo">Undo last</button>' : ''}</div></section>`;
    bindReview();
    return;
  }
  const r = rowOf(c)!;
  const flag = c.flags & 7;
  const banner = RV.panel === 'merge' && RV.merge ? mergeBanner() : '';
  app.innerHTML = `<section class="rv">${cnt}${banner}<div class="rv-card${flag ? ' flag' + flag : ''}"><div class="host"></div></div>
    <div class="rv-bar">${RV.shown ? buttons(c) : `<button type="button" class="show" data-a="show">Show answer</button>`}</div>
    <div class="rv-more"><button type="button" data-a="edit">Edit</button><button type="button" data-a="flagmenu">Flag</button><button type="button" data-a="suspend">Suspend</button><button type="button" data-a="bury">Bury</button><button type="button" data-a="info">Info</button>${RV.undo.length ? '<button type="button" data-a="undo">Undo</button>' : ''}</div></section>`;
  const root = draw($('.host'), r, RV.shown ? 'a' : 'q');
  playAll(root);
  bindReview();
}
function buttons(c: Card) {
  const k = ck(), conf = confOf(c);
  return ['Again', 'Hard', 'Good', 'Easy']
    .map((name, i) => {
      const a = answer(c, i + 1, conf, k);
      return `<button type="button" class="g g${i + 1}" data-g="${i + 1}"><small>${a.label}</small>${name}</button>`;
    })
    .join('');
}
function bindReview() {
  app.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => (b.onclick = () => act(b.dataset.a!)));
  app.querySelectorAll<HTMLElement>('[data-g]').forEach((b) => (b.onclick = () => grade(Number(b.dataset.g))));
}

async function grade(g: number) {
  const c = RV.cur;
  if (!c || !RV.shown) return;
  const conf = confOf(c), r = rowOf(c)!;
  const a = answer(c, g, conf, ck(), Date.now() - RV.t0);
  const undo: (typeof RV.undo)[0] = { card: c, rev: a.rev[0] };
  if (a.leech && !r.note.tags.includes('leech')) {
    undo.note = r.note;
    await put('note', r.note.id, { ...r.note, tags: [...r.note.tags, 'leech'] });
    toast(conf.leechAction === 0 ? 'Leech: suspended.' : 'Leech: tagged.');
  }
  RV.undo = [...RV.undo.slice(-30), undo];
  RV.sinceNew = c.type === 0 ? 0 : RV.sinceNew + 1;
  await put('card', c.id, a.card);
  RV.cur = null;
  RV.panel = '';
  if (g === 1 && missed3(a.card)) {
    RV.panel = 'deeper';
    RV.deeperFor = a.card.id;
  } else if (g >= 3 && right3(a.card)) {
    const other = related(a.card);
    if (other) {
      RV.panel = 'merge';
      RV.merge = [a.card.nid, other];
    }
  }
  showReview();
}

async function act(a: string) {
  const c = RV.cur;
  if (a === 'show') {
    RV.shown = true;
    return showReview();
  }
  if (a === 'undo') return undo();
  if (!c) return;
  const r = rowOf(c)!;
  if (a === 'edit') return editorDialog(r.note);
  if (a === 'info') return infoDialog(c);
  if (a === 'flagmenu') return flagDialog([c]);
  if (a === 'suspend' || a === 'bury') {
    const prev = { ...c };
    await put('card', c.id, { ...c, queue: a === 'suspend' ? -1 : -2 });
    RV.cur = null;
    showReview();
    toast(a === 'suspend' ? 'Suspended.' : 'Buried until tomorrow.', ['Undo', async () => (await put('card', c.id, prev), (RV.cur = null), showReview())]);
  }
}
async function undo() {
  const u = RV.undo.pop();
  if (!u) return;
  const now = S.cards.get(u.card.id);
  await put('card', u.card.id, { ...u.card, revs: (now?.revs ?? u.card.revs).filter((r) => r[0] !== u.rev) }, [u.rev]);
  if (u.note) await put('note', u.note.id, u.note);
  RV.cur = S.cards.get(u.card.id)!;
  RV.shown = false;
  RV.t0 = Date.now();
  RV.panel = '';
  showReview();
}

// ---------- missed three times running ----------
let deeperTimer: ReturnType<typeof setInterval> | undefined;
function showDeeper(): void {
  const c = S.cards.get(RV.deeperFor), r = c && rowOf(c);
  if (!r) return ((RV.panel = ''), showReview());
  const word = wordOf(r.type, r.note);
  app.innerHTML = `<section class="deeper"><p class="dw">${esc(word)}</p><p class="dsub">Missed three times in a row.</p>
    <div class="dact"><button type="button" class="primary" data-d="go">Go deeper <span>5 min</span></button><button type="button" data-d="del">Delete it</button><button type="button" class="ghost" data-d="skip">Not now</button></div>
    <div class="dbody" hidden><div class="dtimer" aria-live="off"></div><div class="dtext"></div>
    <label class="dmine"><span>Your note, added to Notes</span><div contenteditable="true" class="dnote" role="textbox" aria-multiline="true"></div></label>
    <button type="button" class="primary" data-d="done">Back to reviews</button></div></section>`;
  const body = $('.dbody');
  app.querySelectorAll<HTMLElement>('[data-d]').forEach(
    (b) =>
      (b.onclick = async () => {
        const d = b.dataset.d;
        if (d === 'skip') return endDeeper();
        if (d === 'del') {
          const note = r.note, cs = cardsOf(note.id);
          await deleteNote(note.id);
          endDeeper();
          toast(`${word} deleted.`, ['Undo', () => restoreNote(note, cs)]);
          return;
        }
        if (d === 'done') {
          const mine = $('.dnote').innerHTML.trim();
          if (strip(mine)) {
            const i = fieldIndex(r.type!, 'Notes');
            if (i >= 0) {
              const flds = [...r.note.flds];
              flds[i] = flds[i] ? `${flds[i]}<br>${mine}` : mine;
              await put('note', r.note.id, { ...r.note, flds });
            }
          }
          return endDeeper();
        }
        // go deeper: Claude's take, and five minutes on the clock
        $('.dact').hidden = true;
        body.hidden = false;
        const end = Date.now() + 5 * 60e3;
        const tick = () => {
          const left = Math.max(0, end - Date.now());
          $('.dtimer').textContent = `${Math.floor(left / 60e3)}:${String(Math.floor((left % 60e3) / 1000)).padStart(2, '0')}`;
          if (!left) clearInterval(deeperTimer);
        };
        tick();
        deeperTimer = setInterval(tick, 1000);
        const text = $('.dtext');
        text.textContent = navigator.onLine ? '…' : 'Needs signal. Use the five minutes with your own notes.';
        if (!navigator.onLine) return;
        try {
          const i = (n: string) => fieldIndex(r.type!, n);
          const near = nearWords(r.note).slice(0, 30);
          const out = await api('anki/deeper', { word, sentence: strip(r.note.flds[i('Chinese')] ?? ''), notes: strip(r.note.flds[i('Notes')] ?? ''), near });
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
/** His other words that share a character with this one. */
function nearWords(note: Note) {
  const w = wordOf(typeOf(note), note);
  const chars = new Set([...w].filter((x) => HAN.test(x)));
  const out = new Set<string>();
  for (const n of S.notes.values()) {
    if (n.id === note.id) continue;
    const o = wordOf(typeOf(n), n);
    if (o && o !== w && [...o].some((x) => chars.has(x))) out.add(o);
  }
  return [...out];
}

// ---------- right three times running, next to a related card ----------
const mergeNo = () => new Set<string>((S.meta.get('mergeNo')?.pairs as string[]) ?? []);
const pairKey = (a: number, b: number) => [a, b].sort().join('-');
/** A note sharing a character with this card's word, answered right three times running in the last day too. */
function related(c: Card): number | null {
  const note = S.notes.get(c.nid);
  if (!note) return null;
  const w = wordOf(typeOf(note), note), chars = new Set([...w].filter((x) => HAN.test(x)));
  if (!chars.size) return null;
  const no = mergeNo(), k = ck();
  for (const o of S.cards.values()) {
    if (o.nid === c.nid || o.queue < 0 || no.has(pairKey(c.nid, o.nid))) continue;
    const last = o.revs[o.revs.length - 1];
    if (!last || k.today - k.dayOf(last[0]) > 1 || !right3(o)) continue;
    const on = S.notes.get(o.nid);
    const ow = on && wordOf(typeOf(on), on);
    if (ow && ow !== w && [...ow].some((x) => chars.has(x))) return o.nid;
  }
  return null;
}
function mergeBanner() {
  const [a, b] = RV.merge!.map((id) => S.notes.get(id));
  if (!a || !b) return '';
  return `<div class="merge"><span><b>${esc(wordOf(typeOf(a), a))}</b> · <b>${esc(wordOf(typeOf(b), b))}</b>: right three times in a row each. One harder card about the difference?</span>
    <span class="mact"><button type="button" class="primary" data-m="write">Write it</button><button type="button" class="ghost" data-m="no">Not these</button></span></div>`;
}
document.addEventListener('click', async (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
  if (!b || !RV.merge) return;
  const [x, y] = RV.merge;
  RV.panel = '';
  RV.merge = null;
  if (b.dataset.m === 'no') {
    await put('meta', 'mergeNo', { pairs: [...mergeNo(), pairKey(x, y)] });
    return showReview();
  }
  const [a, c] = [S.notes.get(x)!, S.notes.get(y)!];
  showAdd({ word: `${wordOf(typeOf(a), a)} / ${wordOf(typeOf(c), c)}`, mergeOf: [x, y] });
  go2('add');
});
const go2 = (v: View) => {
  view = v;
  document.querySelectorAll<HTMLElement>('#nav [data-v]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.v === v)));
  app.className = 'v-' + v;
};

// ---------- dialogs ----------
function dialog(html: string, cls = '') {
  document.querySelector('dialog.dlg')?.remove();
  const d = document.createElement('dialog');
  d.className = 'dlg ' + cls;
  d.innerHTML = `<button type="button" class="x" aria-label="Close">×</button>${html}`;
  document.body.append(d);
  d.querySelector<HTMLElement>('.x')!.onclick = () => d.close();
  d.addEventListener('close', () => {
    d.remove();
    if (view === 'review') showReview();
    if (view === 'browse') paintBrowse();
  });
  d.addEventListener('click', (e) => e.target === d && d.close());
  d.showModal();
  return d;
}
function editorDialog(note: Note) {
  const d = dialog('<div class="ed-host"></div>', 'wide');
  noteEditor(d.querySelector('.ed-host')!, note);
}
const FLAGS = ['', 'Red', 'Orange', 'Green', 'Blue', 'Pink', 'Turquoise', 'Purple'];
function flagDialog(cs: Card[]) {
  const d = dialog(`<div class="flags">${FLAGS.map((f, i) => `<button type="button" class="fl fl${i}" data-f="${i}">${i ? f : 'No flag'}</button>`).join('')}</div>`, 'small');
  d.querySelectorAll<HTMLElement>('[data-f]').forEach(
    (b) =>
      (b.onclick = async () => {
        await setFlag(cs, Number(b.dataset.f));
        d.close();
      }),
  );
}
const setFlag = (cs: Card[], f: number) => putMany(cs.map((c) => ['card', c.id, { ...c, flags: (c.flags & ~7) | f }]));
function infoDialog(c: Card) {
  const k = ck(), r = rowOf(c)!;
  const E = ['', 'Again', 'Hard', 'Good', 'Easy'], T = ['Learn', 'Review', 'Relearn', 'Filtered', 'Manual', 'Rescheduled'];
  const revs = [...c.revs].reverse().map((x) => `<tr><td>${new Date(x[0]).toLocaleDateString([], { year: '2-digit', month: 'short', day: 'numeric' })}</td><td>${T[x[6]] ?? ''}</td><td class="e${x[1]}">${E[x[1]] ?? '—'}</td><td>${x[2] < 0 ? label(x[2]) : x[2] ? label(x[2]) : ''}</td></tr>`).join('');
  dialog(`<h2>${esc(wordOf(r.type, r.note))}</h2><dl class="info"><dt>Due</dt><dd>${dueText(c, k)}</dd><dt>Interval</dt><dd>${c.ivl ? label(c.ivl) : '—'}</dd>
    <dt>Stability</dt><dd>${c.s ? (c.s < 1 ? `${Math.round(c.s * 24)}h` : label(Math.round(c.s))) : '—'}</dd><dt>Difficulty</dt><dd>${c.d ? Math.round(((c.d - 1) / 9) * 100) + '%' : '—'}</dd>
    <dt>Reviews</dt><dd>${c.reps}</dd><dt>Lapses</dt><dd>${c.lapses}</dd><dt>Added</dt><dd>${new Date(c.id).toLocaleDateString()}</dd></dl>
    <table class="revs"><tbody>${revs}</tbody></table>`);
}

// ================= the note editor =================
const pasteTarget = new WeakMap<HTMLElement, Note>();
function noteEditor(host: HTMLElement, note0: Note, opts: { onAdd?: (n: Note) => void } = {}) {
  let note = note0;
  const t = typeOf(note)!;
  const cs = opts.onAdd ? [] : cardsOf(note.id);
  host.innerHTML = `<div class="ed">${t.fields
    .slice()
    .sort((a, b) => a.ord - b.ord)
    .map((f) => `<label class="ef"><span>${esc(f.name)}</span><div class="fv${/chinese|word|sentence/i.test(f.name) ? ' zh' : ''}" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" data-o="${f.ord}">${note.flds[f.ord] ?? ''}</div></label>`)
    .join('')}
    <label class="ef"><span>Tags</span><input class="tags" value="${esc(note.tags.join(' '))}" spellcheck="false"></label>
    ${opts.onAdd ? `<div class="ed-act"><button type="button" class="primary" data-e="add">Add</button></div>` : ''}
    ${cs.length ? `<div class="ed-cards">${cs.map((c) => `<div class="ec" data-c="${c.id}"><span class="ecn">${esc(t.templates.find((x) => x.ord === c.ord)?.name ?? '')}</span><span>${dueText(c)}</span><span class="flagdot fd${c.flags & 7}"></span>
      <button type="button" data-e="susp">${c.queue === -1 ? 'Unsuspend' : 'Suspend'}</button><button type="button" data-e="flag">Flag</button><button type="button" data-e="due">Set due</button><button type="button" data-e="forget">Forget</button><button type="button" data-e="prev">Preview</button></div>`).join('')}</div>
      <div class="ed-act"><button type="button" class="danger" data-e="del">Delete note</button></div>` : ''}</div>`;
  let saveT: ReturnType<typeof setTimeout> | undefined;
  const read = (): Note => {
    const flds = [...note.flds];
    host.querySelectorAll<HTMLElement>('.fv').forEach((f) => (flds[Number(f.dataset.o)] = clean(f.innerHTML)));
    const tags = [...new Set(($('.tags', host) as HTMLInputElement).value.split(/\s+/).filter(Boolean))];
    return { ...note, flds, tags };
  };
  const save = () => {
    if (opts.onAdd) return;
    clearTimeout(saveT);
    saveT = setTimeout(async () => {
      note = read();
      await put('note', note.id, note);
    }, 500);
  };
  host.querySelectorAll<HTMLElement>('.fv').forEach((f) => {
    pasteTarget.set(f, note);
    f.addEventListener('input', save);
    f.addEventListener('paste', (e) => pasteInto(e, f, save));
    f.addEventListener('drop', (e) => dropInto(e, f, save));
  });
  $('.tags', host).addEventListener('input', save);
  host.querySelectorAll<HTMLElement>('[data-e]').forEach(
    (b) =>
      (b.onclick = async () => {
        const e = b.dataset.e, c = S.cards.get(Number(b.closest<HTMLElement>('[data-c]')?.dataset.c));
        if (e === 'add') {
          const n = read();
          if (!n.flds.some((x) => strip(x) || /<img/.test(x))) return toast('Nothing to add yet.');
          opts.onAdd!(n);
          return;
        }
        if (e === 'del') {
          const cards = cardsOf(note.id);
          await deleteNote(note.id);
          (host.closest('dialog') as HTMLDialogElement | null)?.close();
          if (view === 'browse') paintBrowse();
          toast('Note deleted.', ['Undo', () => restoreNote(note, cards)]);
          return;
        }
        if (!c) return;
        if (e === 'susp') await put('card', c.id, { ...c, queue: c.queue === -1 ? (c.type === 0 ? 0 : c.type === 2 ? 2 : 1) : -1 });
        if (e === 'flag') return flagDialog([c]);
        if (e === 'forget') await putMany([['card', c.id, forget(c)]]);
        if (e === 'due') {
          const v = prompt('Due in how many days? (0 = today)', '0');
          if (v == null || !/^\d+$/.test(v.trim())) return;
          await put('card', c.id, setDue(c, Number(v)));
        }
        if (e === 'prev') return preview(c);
        noteEditor(host, S.notes.get(note.id)!, opts);
      }),
  );
}
const clean = (h: string) => h.replace(/^(<br>)+$/, '').replace(/\s+data-[\w-]+="[^"]*"/g, '');
const forget = (c: Card): Card => ({ ...c, type: 0, queue: 0, ivl: 0, left: 0, s: undefined, d: undefined, due: Math.floor(Date.now() / 1000), revs: [...c.revs, [Date.now(), 0, 0, c.ivl, 0, 0, 4] as Rev] });
const setDue = (c: Card, days: number): Card => {
  const k = ck();
  return { ...c, type: c.type === 0 ? 2 : c.type, queue: 2, due: k.today + days, ivl: Math.max(1, c.ivl), revs: [...c.revs, [Date.now(), 0, days, c.ivl, 0, 0, 4] as Rev] };
};
function preview(c: Card) {
  const r = rowOf(c)!;
  const d = dialog('<div class="pv"><div class="pvq"></div><div class="pva"></div></div>', 'wide');
  draw(d.querySelector('.pvq')!, r, 'q');
  draw(d.querySelector('.pva')!, r, 'a');
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
    toast((err as Error).message || 'The picture didn’t come through.');
  }
}

async function deleteNote(nid: number) {
  await putMany([['note', nid, null], ...cardsOf(nid).map((c) => ['card', c.id, null] as ['card', number, null])]);
}
async function restoreNote(note: Note, cards: Card[]) {
  await putMany([['note', note.id, note], ...cards.map((c) => ['card', c.id, c] as ['card', number, Card])]);
  if (view === 'review') showReview();
  if (view === 'browse') paintBrowse();
}

// ================= Add =================
function showAdd(pre: { word?: string; mergeOf?: [number, number] } = {}) {
  const type = S.types.get(col().notetype) ?? [...S.types.values()][0];
  const id = Date.now();
  const flds = type.fields.map(() => '');
  if (pre.word) flds[Math.max(0, fieldIndex(type, 'Word'))] = esc(pre.word);
  const note: Note = { id, guid: 'cbp:' + id.toString(36), mid: type.id, mod: id, tags: pre.mergeOf ? ['difference'] : [], flds };
  app.innerHTML = `<section class="add"><div class="add-top"><select class="nt" aria-label="Note type">${[...S.types.values()].map((t) => `<option value="${t.id}"${t.id === type.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div><div class="ed-host"></div></section>`;
  $<HTMLSelectElement>('.nt').onchange = (e) => {
    col().notetype = Number((e.target as HTMLSelectElement).value);
    showAdd(pre);
  };
  noteEditor($('.ed-host'), note, {
    onAdd: async (n) => {
      const made = await addNote(n);
      if (!made) return toast('No card shows anything yet: fill the fields its front uses.');
      if (pre.mergeOf) {
        const old = pre.mergeOf.flatMap((x) => cardsOf(x));
        await putMany(old.map((c) => ['card', c.id, { ...c, queue: -1 }]));
        toast(`Added. The two old cards are suspended.`, ['Undo', () => putMany(old.map((c) => ['card', c.id, c]))]);
        pre = {};
      } else toast(`Added: ${made} card${made > 1 ? 's' : ''}.`);
      showAdd(pre);
    },
  });
}
/** A new note and its cards (one per card type whose front shows something), new, at the end of the queue. */
async function addNote(n: Note) {
  const t = typeOf(n)!;
  const now = Date.now();
  const cards: Card[] = t.templates
    .filter((x) => frontShows(t, n, x.ord))
    .map((x, i) => ({ id: now + 1 + i, nid: n.id, did: col().deck, ord: x.ord, type: 0, queue: 0, due: Math.floor(now / 1000), ivl: 0, reps: 0, lapses: 0, left: 0, flags: 0, mod: now, revs: [] }));
  if (!cards.length) return 0;
  await putMany([['note', n.id, n], ...cards.map((c) => ['card', c.id, c] as ['card', number, Card])]);
  return cards.length;
}

// ================= Browse =================
const BR = { q: '', sort: 'sort', desc: false, sel: new Set<number>(), last: 0 as number, focus: 0, limit: 300 };
const COLS: [string, string, (r: Row, k: ReturnType<typeof ck>) => string | number][] = [
  ['sort', 'Sort field', (r) => sortText(r.type, r.note)],
  ['card', 'Card', (r) => r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? ''],
  ['due', 'Due', (r, k) => (r.card.queue === -1 ? 1e9 : r.card.type === 0 ? 1e8 + r.card.due : r.card.queue === 1 ? k.dayOf(r.card.due * 1000) : r.card.due)],
  ['ivl', 'Interval', (r) => r.card.ivl],
  ['d', 'Difficulty', (r) => r.card.d ?? 0],
  ['reps', 'Reviews', (r) => r.card.reps],
  ['lapses', 'Lapses', (r) => r.card.lapses],
];
function showBrowse() {
  app.innerHTML = `<section class="br"><aside class="br-side"><input class="q" type="search" placeholder="Search" value="${esc(BR.q)}" spellcheck="false" enterkeyhint="search">
    <div class="saved"></div></aside><div class="br-main"><div class="bulk" hidden></div><div class="tbl" role="grid"></div></div><div class="br-ed"></div></section>`;
  const q = $<HTMLInputElement>('.q');
  let t: ReturnType<typeof setTimeout> | undefined;
  q.oninput = () => {
    clearTimeout(t);
    t = setTimeout(() => ((BR.q = q.value), (BR.limit = 300), paintBrowse()), 200);
  };
  paintBrowse();
}
function results() {
  const k = ck();
  const test = search(BR.q, k.today, k.dayOf);
  const rows = [...S.cards.values()].map(rowOf).filter((r): r is Row => !!r && test(r));
  const col_ = COLS.find((c) => c[0] === BR.sort)!;
  rows.sort((a, b) => {
    const x = col_[2](a, k), y = col_[2](b, k);
    const o = typeof x === 'number' ? x - (y as number) : String(x).localeCompare(String(y), 'zh-Hant');
    return BR.desc ? -o : o;
  });
  return rows;
}
function paintBrowse() {
  if (view !== 'browse' || !$('.br')) return;
  const k = ck(), rows = results();
  // the sidebar: searches he uses, flags, tags
  const tags = new Map<string, number>();
  S.notes.forEach((n) => n.tags.forEach((x) => tags.set(x, (tags.get(x) ?? 0) + 1)));
  const saved: [string, string][] = [['Due today', 'is:due'], ['New', 'is:new'], ['Missed 3×', 'is:missed'], ['Suspended', 'is:suspended'], ['Leeches', 'is:leech'], ['Added today', 'added:1'], ['Reviewed today', 'rated:1'], ...FLAGS.slice(1).map((f, i) => [f, `flag:${i + 1}`] as [string, string])];
  $('.saved').innerHTML = `${saved.map(([l, s]) => `<button type="button" class="sv${BR.q === s ? ' on' : ''}" data-s="${esc(s)}">${l.match(/^(Red|Orange|Green|Blue|Pink|Turquoise|Purple)$/) ? `<span class="flagdot fd${FLAGS.indexOf(l)}"></span>` : ''}${esc(l)}</button>`).join('')}
    ${tags.size ? `<p class="tagh">Tags</p>${[...tags].sort().map(([x, n]) => `<button type="button" class="sv${BR.q === 'tag:' + x ? ' on' : ''}" data-s="tag:${esc(x)}">${esc(x)} <i>${n}</i></button>`).join('')}` : ''}`;
  $('.saved').querySelectorAll<HTMLElement>('[data-s]').forEach(
    (b) =>
      (b.onclick = () => {
        BR.q = BR.q === b.dataset.s ? '' : b.dataset.s!;
        $<HTMLInputElement>('.q').value = BR.q;
        paintBrowse();
      }),
  );
  const shown = rows.slice(0, BR.limit);
  $('.tbl').innerHTML = `<div class="tr th">${COLS.map(([key, name]) => `<button type="button" class="td c-${key}${BR.sort === key ? (BR.desc ? ' desc' : ' asc') : ''}" data-sort="${key}">${name}</button>`).join('')}</div>
    ${shown.map((r) => `<div class="tr${BR.sel.has(r.card.id) ? ' sel' : ''}${r.card.queue === -1 ? ' susp' : ''}${r.card.flags & 7 ? ' fl' + (r.card.flags & 7) : ''}" data-c="${r.card.id}" role="row"><span class="td c-sort zh">${esc(sortText(r.type, r.note))}</span><span class="td c-card">${esc(r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? '')}</span><span class="td c-due">${dueText(r.card, k)}</span><span class="td c-ivl">${r.card.ivl ? label(r.card.ivl) : ''}</span><span class="td c-d">${r.card.d ? Math.round(((r.card.d - 1) / 9) * 100) + '%' : ''}</span><span class="td c-reps">${r.card.reps}</span><span class="td c-lapses">${r.card.lapses}</span></div>`).join('')}
    <p class="tcount">${rows.length} card${rows.length === 1 ? '' : 's'}${rows.length > shown.length ? ` · <button type="button" class="more">Show all</button>` : ''}</p>`;
  $('.tbl').querySelectorAll<HTMLElement>('[data-sort]').forEach(
    (b) =>
      (b.onclick = () => {
        BR.desc = BR.sort === b.dataset.sort ? !BR.desc : false;
        BR.sort = b.dataset.sort!;
        paintBrowse();
      }),
  );
  $('.tbl .more')?.addEventListener('click', () => ((BR.limit = 1e9), paintBrowse()));
  $('.tbl').querySelectorAll<HTMLElement>('.tr[data-c]').forEach(
    (tr) =>
      (tr.onclick = (e) => {
        const id = Number(tr.dataset.c);
        if (e.shiftKey && BR.last) {
          const ids = shown.map((r) => r.card.id), a = ids.indexOf(BR.last), b = ids.indexOf(id);
          ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => BR.sel.add(x));
        } else if (e.metaKey || e.ctrlKey) BR.sel.has(id) ? BR.sel.delete(id) : BR.sel.add(id);
        else {
          BR.sel = new Set([id]);
          BR.focus = id;
        }
        BR.last = id;
        paintBrowse();
      }),
  );
  // one card: its note in the editor; several: what can be done to all of them
  const sel = [...BR.sel].map((id) => S.cards.get(id)).filter((c): c is Card => !!c);
  const bulk = $('.bulk');
  bulk.hidden = sel.length < 2;
  if (sel.length >= 2) {
    bulk.innerHTML = `<span>${sel.length} selected</span><button type="button" data-b="susp">Suspend</button><button type="button" data-b="unsusp">Unsuspend</button><button type="button" data-b="flag">Flag</button><button type="button" data-b="tag">Add tag</button><button type="button" data-b="untag">Remove tag</button><button type="button" data-b="forget">Forget</button><button type="button" class="danger" data-b="del">Delete</button><button type="button" class="ghost" data-b="none">Clear</button>`;
    bulk.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => (b.onclick = () => bulkAct(b.dataset.b!, sel)));
  }
  const ed = $('.br-ed');
  const focus = sel.length === 1 ? sel[0] : null;
  ed.classList.toggle('open', !!focus);
  if (focus && ed.dataset.n !== String(focus.nid) + ':' + (S.notes.get(focus.nid)?.mod ?? 0)) {
    const n = S.notes.get(focus.nid);
    if (n && !ed.contains(document.activeElement)) {
      ed.dataset.n = String(n.id) + ':' + n.mod;
      ed.innerHTML = '<button type="button" class="back">Back</button><div class="ed-host"></div>';
      noteEditor($('.ed-host', ed), n);
      $('.back', ed).onclick = () => ((BR.sel = new Set()), paintBrowse());
    }
  } else if (!focus) {
    ed.innerHTML = '';
    delete ed.dataset.n;
  }
}
async function bulkAct(a: string, sel: Card[]) {
  const nids = [...new Set(sel.map((c) => c.nid))];
  if (a === 'none') BR.sel = new Set();
  if (a === 'susp' || a === 'unsusp') await putMany(sel.map((c) => ['card', c.id, { ...c, queue: a === 'susp' ? -1 : c.queue === -1 ? (c.type === 0 ? 0 : c.type === 2 ? 2 : 1) : c.queue }]));
  if (a === 'flag') return flagDialog(sel);
  if (a === 'forget') await putMany(sel.map((c) => ['card', c.id, forget(c)]));
  if (a === 'tag' || a === 'untag') {
    const tag = prompt(a === 'tag' ? 'Tag to add' : 'Tag to remove')?.trim();
    if (!tag) return;
    await putMany(nids.map((id) => S.notes.get(id)!).map((n) => ['note', n.id, { ...n, tags: a === 'tag' ? [...new Set([...n.tags, ...tag.split(/\s+/)])] : n.tags.filter((x) => !tag.split(/\s+/).includes(x)) }]));
  }
  if (a === 'del') {
    if (!confirm(`Delete ${nids.length} note${nids.length > 1 ? 's' : ''} and all their cards?`)) return;
    const keep = nids.map((id) => [S.notes.get(id)!, cardsOf(id)] as const);
    for (const id of nids) await deleteNote(id);
    BR.sel = new Set();
    toast(`${nids.length} deleted.`, ['Undo', async () => { for (const [n, cs] of keep) await restoreNote(n, cs); }]);
  }
  paintBrowse();
}

// ================= Note types: fields, card types, styling =================
let TY = { id: 0, tab: 'fields' as 'fields' | 'cards' | 'css', tmpl: 0, side: 'qfmt' as 'qfmt' | 'afmt' };
function showTypes() {
  const types = [...S.types.values()];
  if (!S.types.has(TY.id)) TY.id = col().notetype;
  const t = S.types.get(TY.id)!;
  const n = [...S.notes.values()].filter((x) => x.mid === t.id).length;
  app.innerHTML = `<section class="ty">${settingsNav('types')}<div class="ty-top"><select class="tysel" aria-label="Note type">${types.map((x) => `<option value="${x.id}"${x.id === t.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select><span class="muted">${n} notes</span>
    <nav class="seg">${(['fields', 'cards', 'css'] as const).map((k) => `<button type="button" data-tab="${k}" aria-current="${TY.tab === k}">${k === 'fields' ? 'Fields' : k === 'cards' ? 'Card types' : 'Styling'}</button>`).join('')}</nav></div><div class="ty-body"></div></section>`;
  bindSettingsNav();
  $<HTMLSelectElement>('.tysel').onchange = (e) => ((TY.id = Number((e.target as HTMLSelectElement).value)), (TY.tmpl = 0), showTypes());
  app.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => (b.onclick = () => ((TY.tab = b.dataset.tab as typeof TY.tab), showTypes())));
  const body = $('.ty-body');
  if (TY.tab === 'fields') {
    const fs = t.fields.slice().sort((a, b) => a.ord - b.ord);
    body.innerHTML = `<ol class="flist">${fs.map((f, i) => `<li><input value="${esc(f.name)}" data-ren="${f.ord}" aria-label="Field name"><button type="button" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" data-dn="${i}" ${i < fs.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button type="button" class="danger" data-rm="${f.ord}" aria-label="Delete field">×</button></li>`).join('')}</ol>
      <button type="button" data-add="1">Add field</button>`;
    body.querySelectorAll<HTMLInputElement>('[data-ren]').forEach((inp) => (inp.onchange = () => renameField(t, Number(inp.dataset.ren), inp.value.trim())));
    body.querySelectorAll<HTMLElement>('[data-up],[data-dn]').forEach((b) => (b.onclick = () => moveField(t, Number(b.dataset.up ?? b.dataset.dn), b.dataset.up ? -1 : 1)));
    body.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) => (b.onclick = () => removeField(t, Number(b.dataset.rm))));
    $('[data-add]', body).onclick = () => addField(t);
  } else if (TY.tab === 'cards') {
    const tm = t.templates.find((x) => x.ord === TY.tmpl) ?? t.templates[0];
    const sample = [...S.notes.values()].find((x) => x.mid === t.id);
    body.innerHTML = `<div class="tm-top"><nav class="seg">${t.templates.map((x) => `<button type="button" data-tm="${x.ord}" aria-current="${x.ord === tm.ord}">${esc(x.name)}</button>`).join('')}</nav>
      <button type="button" data-tma="add">Add card type</button><button type="button" data-tma="ren">Rename</button>${t.templates.length > 1 ? '<button type="button" class="danger" data-tma="del">Delete</button>' : ''}</div>
      <div class="tm"><div class="tm-ed"><nav class="seg"><button type="button" data-side="qfmt" aria-current="${TY.side === 'qfmt'}">Front</button><button type="button" data-side="afmt" aria-current="${TY.side === 'afmt'}">Back</button></nav>
      <textarea class="code" spellcheck="false">${esc(tm[TY.side])}</textarea></div><div class="tm-pv"><div class="pvh"></div></div></div>`;
    body.querySelectorAll<HTMLElement>('[data-tm]').forEach((b) => (b.onclick = () => ((TY.tmpl = Number(b.dataset.tm)), showTypes())));
    body.querySelectorAll<HTMLElement>('[data-side]').forEach((b) => (b.onclick = () => ((TY.side = b.dataset.side as typeof TY.side), showTypes())));
    body.querySelectorAll<HTMLElement>('[data-tma]').forEach((b) => (b.onclick = () => templateAct(t, tm.ord, b.dataset.tma!)));
    const pv = () => sample && draw($('.pvh', body), { note: sample, type: S.types.get(t.id)!, card: { ord: tm.ord } as Card }, TY.side === 'qfmt' ? 'q' : 'a');
    pv();
    let st: ReturnType<typeof setTimeout> | undefined;
    $<HTMLTextAreaElement>('.code', body).oninput = (e) => {
      const v = (e.target as HTMLTextAreaElement).value;
      clearTimeout(st);
      st = setTimeout(async () => {
        const cur = S.types.get(t.id)!;
        await put('notetype', t.id, { ...cur, templates: cur.templates.map((x) => (x.ord === tm.ord ? { ...x, [TY.side]: v } : x)) });
        pv();
      }, 400);
    };
  } else {
    const sample = [...S.notes.values()].find((x) => x.mid === t.id);
    body.innerHTML = `<div class="tm"><div class="tm-ed"><textarea class="code tall" spellcheck="false">${esc(t.css)}</textarea></div><div class="tm-pv"><div class="pvh"></div></div></div>`;
    const pv = () => sample && draw($('.pvh', body), { note: sample, type: S.types.get(t.id)!, card: { ord: t.templates[0].ord } as Card }, 'a');
    pv();
    let st: ReturnType<typeof setTimeout> | undefined;
    $<HTMLTextAreaElement>('.code', body).oninput = (e) => {
      const v = (e.target as HTMLTextAreaElement).value;
      clearTimeout(st);
      st = setTimeout(async () => (await put('notetype', t.id, { ...S.types.get(t.id)!, css: v }), pv()), 400);
    };
  }
}
const refName = (s: string, from: string, to: string) => s.replace(/\{\{([#^/]?)((?:[a-z]+:)*)\s*([^}]+?)\s*\}\}/g, (all, k, filt, name) => (name === from ? `{{${k}${filt}${to}}}` : all));
async function renameField(t: NoteType, ord: number, name: string) {
  const old = t.fields.find((f) => f.ord === ord)!.name;
  if (!name || name === old) return;
  if (t.fields.some((f) => f.name === name)) return toast('Another field has that name.'), showTypes();
  await put('notetype', t.id, { ...t, fields: t.fields.map((f) => (f.ord === ord ? { ...f, name } : f)), templates: t.templates.map((x) => ({ ...x, qfmt: refName(x.qfmt, old, name), afmt: refName(x.afmt, old, name) })) });
  showTypes();
}
/** Fields are stored by position in every note, so moving or removing one rewrites the notes too. */
async function reorder(t: NoteType, order: number[]) {
  const fields = order.map((o, i) => ({ ...t.fields.find((f) => f.ord === o)!, ord: i }));
  const notes = [...S.notes.values()].filter((n) => n.mid === t.id);
  await putMany([['notetype', t.id, { ...t, fields, sortf: Math.max(0, order.indexOf(t.sortf)) }], ...notes.map((n) => ['note', n.id, { ...n, flds: order.map((o) => n.flds[o] ?? '') }] as ['note', number, Note])]);
  showTypes();
}
function moveField(t: NoteType, i: number, dir: number) {
  const order = t.fields.slice().sort((a, b) => a.ord - b.ord).map((f) => f.ord);
  [order[i], order[i + dir]] = [order[i + dir], order[i]];
  reorder(t, order);
}
function removeField(t: NoteType, ord: number) {
  const f = t.fields.find((x) => x.ord === ord)!;
  if (t.fields.length < 2 || !confirm(`Delete the field ${f.name} from every note?`)) return;
  reorder(t, t.fields.slice().sort((a, b) => a.ord - b.ord).map((x) => x.ord).filter((o) => o !== ord));
}
async function addField(t: NoteType) {
  let name = 'Field';
  for (let i = 2; t.fields.some((f) => f.name === name); i++) name = `Field ${i}`;
  const notes = [...S.notes.values()].filter((n) => n.mid === t.id);
  await putMany([['notetype', t.id, { ...t, fields: [...t.fields, { name, ord: t.fields.length }] }], ...notes.map((n) => ['note', n.id, { ...n, flds: [...n.flds, ''] }] as ['note', number, Note])]);
  showTypes();
}
async function templateAct(t: NoteType, ord: number, a: string) {
  const tm = t.templates.find((x) => x.ord === ord)!;
  if (a === 'ren') {
    const name = prompt('Card type name', tm.name)?.trim();
    if (name) await put('notetype', t.id, { ...t, templates: t.templates.map((x) => (x.ord === ord ? { ...x, name } : x)) });
  }
  if (a === 'add') {
    const nord = Math.max(...t.templates.map((x) => x.ord)) + 1;
    const nt = { ...t, templates: [...t.templates, { ...tm, name: `${tm.name} copy`, ord: nord }] };
    // every note gets the new card, if its front shows something
    const now = Date.now();
    const cards: Card[] = [...S.notes.values()].filter((n) => n.mid === t.id && frontShows(nt, n, nord)).map((n, i) => ({ id: now + i, nid: n.id, did: col().deck, ord: nord, type: 0, queue: 0, due: Math.floor(now / 1000), ivl: 0, reps: 0, lapses: 0, left: 0, flags: 0, mod: now, revs: [] }));
    if (!confirm(`Add a card type? It makes ${cards.length} new cards.`)) return;
    await putMany([['notetype', t.id, nt], ...cards.map((c) => ['card', c.id, c] as ['card', number, Card])]);
    TY.tmpl = nord;
  }
  if (a === 'del') {
    const cards = [...S.cards.values()].filter((c) => c.ord === ord && S.notes.get(c.nid)?.mid === t.id);
    if (!confirm(`Delete the card type ${tm.name} and its ${cards.length} cards?`)) return;
    await putMany([['notetype', t.id, { ...t, templates: t.templates.filter((x) => x.ord !== ord) }], ...cards.map((c) => ['card', c.id, null] as ['card', number, null])]);
    TY.tmpl = t.templates.find((x) => x.ord !== ord)!.ord;
  }
  showTypes();
}

// ================= Options (deck options) =================
const settingsNav = (on: string) => `<nav class="seg sub">${[['options', 'Deck options'], ['types', 'Note types'], ['check', 'Check with Anki']].map(([v, l]) => `<button type="button" data-go="${v}" aria-current="${v === on}">${l}</button>`).join('')}</nav>`;
const bindSettingsNav = () => app.querySelectorAll<HTMLElement>('[data-go]').forEach((b) => (b.onclick = () => go(b.dataset.go as View)));
const steps = (s: number[]) => s.map((m) => (m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`)).join(' ');
const parseSteps = (s: string) =>
  s
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((x) => {
      const m = /^([\d.]+)([smhd]?)$/.exec(x);
      if (!m) throw new Error(`“${x}” isn’t a step (1m, 10m, 1d).`);
      return Number(m[1]) * ({ s: 1 / 60, m: 1, h: 60, d: 1440, '': 1 } as Record<string, number>)[m[2]];
    });
function showOptions() {
  const c = S.confs.get(col().conf)!;
  const f = (k: string, l: string, v: string | number, extra = '') => `<label class="opt"><span>${l}</span><input name="${k}" value="${esc(v)}" ${extra}></label>`;
  app.innerHTML = `<section class="opts">${settingsNav('options')}<form class="optf">
    <h3>Daily limits</h3>${f('newPerDay', 'New cards a day', c.newPerDay, 'inputmode="numeric"')}${f('revPerDay', 'Reviews a day', c.revPerDay, 'inputmode="numeric"')}
    <h3>Steps</h3>${f('learnSteps', 'Learning steps', steps(c.learnSteps))}${f('relearnSteps', 'Relearning steps', steps(c.relearnSteps))}
    <h3>FSRS</h3>${f('retention', 'Desired retention', c.retention, 'inputmode="decimal"')}${f('maxIvl', 'Maximum interval (days)', c.maxIvl, 'inputmode="numeric"')}
    <label class="opt wide"><span>Weights</span><textarea name="w" rows="3" spellcheck="false">${c.w.join(', ')}</textarea></label>
    <h3>Leeches and siblings</h3>${f('leechThreshold', 'Leech after lapses', c.leechThreshold, 'inputmode="numeric"')}
    <label class="opt"><span>Leech</span><select name="leechAction"><option value="1"${c.leechAction === 1 ? ' selected' : ''}>Tag it</option><option value="0"${c.leechAction === 0 ? ' selected' : ''}>Suspend it</option></select></label>
    <label class="opt chk"><input type="checkbox" name="buryNew"${c.buryNew ? ' checked' : ''}><span>One new card per note a day</span></label>
    <label class="opt chk"><input type="checkbox" name="buryRev"${c.buryRev ? ' checked' : ''}><span>One review card per note a day</span></label>
    <p class="formmsg" role="status"></p></form></section>`;
  bindSettingsNav();
  const form = $<HTMLFormElement>('.optf');
  form.onchange = async () => {
    const d = new FormData(form), g = (k: string) => String(d.get(k) ?? '').trim();
    try {
      const w = g('w').split(/[\s,]+/).filter(Boolean).map(Number);
      if (w.length < 19 || w.some((x) => !Number.isFinite(x))) throw new Error('Weights: 19 or 21 numbers.');
      const ret = Number(g('retention'));
      if (!(ret >= 0.7 && ret <= 0.99)) throw new Error('Retention between 0.70 and 0.99.');
      const next = { ...S.confs.get(c.id)!, newPerDay: Math.max(0, parseInt(g('newPerDay')) || 0), revPerDay: Math.max(0, parseInt(g('revPerDay')) || 0), learnSteps: parseSteps(g('learnSteps')), relearnSteps: parseSteps(g('relearnSteps')), retention: ret, maxIvl: Math.max(1, parseInt(g('maxIvl')) || 36500), w, leechThreshold: Math.max(0, parseInt(g('leechThreshold')) || 0), leechAction: Number(g('leechAction')), buryNew: d.has('buryNew'), buryRev: d.has('buryRev') };
      await put('conf', c.id, next);
      $('.formmsg').textContent = 'Saved.';
    } catch (e) {
      $('.formmsg').textContent = (e as Error).message;
    }
  };
}

// ================= Check with Anki =================
function showCheck() {
  const a = col().anki, k = ck();
  const cards = [...S.cards.values()];
  const now = { cards: cards.length, notes: S.notes.size, revlog: cards.reduce((n, c) => n + c.revs.length, 0), forecast: forecast(cards, k) };
  const shift = k.today - (a?.day ?? k.today);
  const days = Array.from({ length: 30 - shift }, (_, d) => [a?.forecast.days[d + shift] ?? 0, now.forecast.days[d]]);
  const max = Math.max(1, ...days.flat());
  const sum = (i: number) => days.reduce((n, x) => n + x[i], 0);
  const row = (l: string, x: number, y: number) => `<tr${x === y ? '' : ' class="off"'}><th>${l}</th><td>${x}</td><td>${y}</td></tr>`;
  app.innerHTML = `<section class="chk">${settingsNav('check')}
    <table class="cmp"><thead><tr><th></th><th>Anki</th><th>Here</th></tr></thead><tbody>
    ${a ? row('Cards', a.cards, now.cards) + row('Notes', a.notes, now.notes) + row('Reviews logged', a.revlog, now.revlog) + row('Overdue', a.forecast.backlog, now.forecast.backlog) + row(`Due in ${30 - shift} days`, sum(0), sum(1)) : ''}</tbody></table>
    <p class="muted">Anki as imported ${new Date(col().imported).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.</p>
    <div class="fc" role="img" aria-label="Due each day, Anki and here">${days.map(([x, y], d) => `<div class="fcd"><span class="fa" style="height:${(x / max) * 100}%"></span><span class="fh" style="height:${(y / max) * 100}%"></span><i>${d % 5 === 0 ? (d ? '+' + d : 'Today') : ''}</i></div>`).join('')}</div>
    <p class="legend"><span class="fa"></span>Anki <span class="fh"></span>Here</p></section>`;
  bindSettingsNav();
}

// ================= keys =================
document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
  const mod = MAC ? e.metaKey : e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && view === 'review') return e.preventDefault(), undo();
  if (view !== 'review') return;
  if ((e.key === ' ' || e.key === 'Enter') && !RV.shown && RV.cur) return e.preventDefault(), act('show');
  if ((e.key === ' ' || e.key === 'Enter') && RV.shown) return e.preventDefault(), grade(3);
  if (/^[1-4]$/.test(e.key) && RV.shown && !e.ctrlKey && !e.metaKey) return grade(Number(e.key));
  if (e.ctrlKey && /^[0-7]$/.test(e.key) && RV.cur) return e.preventDefault(), setFlag([RV.cur], Number(e.key)).then(showReview);
  if (e.key.toLowerCase() === 'e') return act('edit');
  if (e.key.toLowerCase() === 'r') {
    const root = $('.host')?.shadowRoot;
    if (root) playAll(root);
  }
  if (e.key === '@') return act('suspend');
  if (e.key === '-') return act('bury');
  if (e.key.toLowerCase() === 'i') return act('info');
});

// ================= start =================
function paintSync() {
  const el = $('#sync');
  const pending = S.outbox.size;
  el.dataset.s = !navigator.onLine ? 'off' : S.syncing ? 'busy' : S.error ? 'err' : pending ? 'wait' : 'ok';
  el.setAttribute('aria-label', !navigator.onLine ? `Offline, ${pending} change(s) waiting` : S.error ? S.error : S.syncing ? 'Syncing' : 'Synced');
  el.textContent = !navigator.onLine ? (pending ? String(pending) : '') : '';
}
onChange((what) => {
  paintSync();
  if (what === 'pulled') {
    // another device answered or changed something: the card on screen stays unless it changed
    if (view === 'review' && !RV.shown && !document.querySelector('dialog[open]')) showReview();
    if (view === 'browse') paintBrowse();
  }
});

(async () => {
  document.querySelectorAll<HTMLElement>('#nav [data-v]').forEach((b) => (b.onclick = () => go((b.dataset.v === 'more' ? 'options' : b.dataset.v) as View)));
  $('#sync').onclick = () => sync();
  let have = false;
  try {
    have = await load();
  } catch {}
  if (!have) {
    app.innerHTML = '<p class="loading">Bringing your cards over…</p>';
    await sync();
    if (!S.meta.has('col')) {
      app.innerHTML = `<p class="loading">${S.error ? esc(S.error) : navigator.onLine ? 'Nothing here yet: the Anki import hasn’t run.' : 'Needs signal the first time.'}</p>`;
      return;
    }
  } else sync();
  paintSync();
  let v: View = 'review';
  try {
    v = (sessionStorage.getItem('cbp-view') as View) || 'review';
  } catch {}
  go(views[v] ? v : 'review');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/plus/sw.js', { scope: '/plus/' }).catch(() => {});
  // pictures and sounds of the next few days' cards, kept for the road
  setTimeout(prefetch, 4000);
})();

async function prefetch() {
  if (!navigator.onLine) return;
  const k = ck(), urls = new Set<string>();
  for (const c of S.cards.values()) {
    const soon = (c.queue === 2 || c.queue === 3) ? c.due <= k.today + 3 : c.queue === 0 || c.queue === 1;
    if (!soon) continue;
    for (const f of S.notes.get(c.nid)?.flds ?? []) for (const m of f.matchAll(/\/api\/plus\/media\/[0-9a-f]{32}\.\w+/g)) urls.add(m[0]);
  }
  const q = [...urls];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let u; (u = q.shift()); ) await fetch(u).catch(() => {});
  }));
}

export { grades, sounds };
