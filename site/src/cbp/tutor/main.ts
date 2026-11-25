// Chinese Brain Plus, Stage 5: the Tutor tab of the board at /plus. plus.js loads this before the board's boot.js (like
// the Reviews tab). A scene that needs this week's words, he answers first, the tutor challenges after
// (src/cbp/tutor.ts on the server). Any ⟦word⟧ the tutor gives, or any Chinese he selects in the chat, becomes a
// card with one tap: the Cards page's card maker opens on it. Conversations are kept in the database (`tutor`).
declare const VIEWS: string[];
declare function setView(v: string, first?: boolean): void;
declare function openCard(word: string, src: string, opt?: Record<string, unknown>): void;
declare function sfx(k: string): void;

type Msg = { role: 'user' | 'assistant'; content: string };
type Mode = 'scene' | 'ask';
type Talk = { id: string; started: string; msgs: Msg[]; mode?: Mode };

const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const token = () => {
  try {
    return localStorage.getItem('cb-token') ?? '';
  } catch {
    return '';
  }
};
async function api(path: string, body?: unknown) {
  const r = await fetch('/api/plus/' + path, body === undefined ? { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' } : { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'It didn’t come through.');
  return j;
}

// ---------- the tab ----------
const TAB = document.createElement('button');
TAB.type = 'button';
TAB.setAttribute('role', 'tab');
TAB.id = 'tab-tutor';
TAB.setAttribute('aria-controls', 'view-tutor');
TAB.setAttribute('aria-selected', 'false');
TAB.tabIndex = -1;
TAB.textContent = 'Tutor';
document.getElementById('tab-essays')!.after(TAB);
const VIEW_EL = document.createElement('section');
VIEW_EL.className = 'view';
VIEW_EL.id = 'view-tutor';
VIEW_EL.setAttribute('role', 'tabpanel');
VIEW_EL.setAttribute('aria-labelledby', 'tab-tutor');
VIEW_EL.hidden = true;
document.getElementById('view-essays')!.after(VIEW_EL);
VIEWS.splice(VIEWS.indexOf('essays') + 1, 0, 'tutor');
VIEW_EL.innerHTML = `<div class="tu">
  <div class="tu-log" aria-live="polite"></div>
  <form class="tu-in">
    <textarea rows="2" lang="zh-Hant" aria-label="Your answer" placeholder="你的回答…"></textarea>
    <button type="submit" class="tu-send" aria-label="Send"></button>
  </form>
  <div class="tu-bar">
    <div class="tu-mode" role="radiogroup" aria-label="Mode">
      <button type="button" role="radio" data-mode="scene" title="A scene from your week: you answer, it pushes back">Scene</button>
      <button type="button" role="radio" data-mode="ask" title="Ask anything: a contrast, how to say it, a sentence to check">Ask</button>
    </div>
    <button type="button" class="tu-new" title="Start over">New</button>
  </div>
  <button type="button" class="tu-card" hidden>Card it</button>
</div>`;
const LOG = $('.tu-log', VIEW_EL), FORM = $<HTMLFormElement>('.tu-in', VIEW_EL), BOX = $<HTMLTextAreaElement>('textarea', VIEW_EL);
const CARD = $<HTMLButtonElement>('.tu-card', VIEW_EL);

let talk: Talk | null = null, busy = false, loaded = false;
let mode: Mode = (() => {
  try {
    return localStorage.getItem('tutor-mode') === 'ask' ? 'ask' : 'scene';
  } catch {
    return 'scene';
  }
})();
// per mode: the conversation that was open, so switching back finds it
const talks: Partial<Record<Mode, Talk>> = {};
function showMode() {
  for (const b of VIEW_EL.querySelectorAll<HTMLElement>('.tu-mode button')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  BOX.placeholder = mode === 'ask' ? '問我… / Ask anything…' : '你的回答…';
  BOX.setAttribute('aria-label', mode === 'ask' ? 'Your question' : 'Your answer');
}

/** The tutor's text with ⟦words⟧ as buttons; Chinese in the Chinese font; **bold** kept as bold. */
const zhSpan = (t: string) => t.replace(/([\u3400-\u9fff，。？！、「」『』：；…（）]+)/g, '<span class="zh">$1</span>');
function rich(t: string) {
  return t
    .split('\n')
    .map((l) =>
      l.split(/(⟦[^⟧]{1,30}⟧)/).map((part) => {
        const w = part.match(/^⟦([^⟧]+)⟧$/)?.[1];
        if (w) return `<button type="button" class="tu-w" data-w="${esc(w)}">${esc(w)}</button>`;
        return zhSpan(esc(part.replace(/\*\*/g, '\u0001'))).replace(/\u0001([^\u0001]*)\u0001/g, '<b>$1</b>').replace(/\u0001/g, '');
      }).join(''),
    )
    .map((l) => `<p>${l}</p>`)
    .join('');
}
function paint() {
  const msgs = talk?.msgs ?? [];
  LOG.innerHTML = msgs.map((m) => `<div class="tu-m ${m.role === 'user' ? 'me' : 'them'}">${m.role === 'user' ? `<p class="zh pen">${esc(m.content).replace(/\n/g, '<br>')}</p>` : rich(m.content)}</div>`).join('') + (busy ? '<div class="tu-m them tu-wait"><p>…</p></div>' : '');
  LOG.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  BOX.disabled = busy || !talk;
  FORM.classList.toggle('off', busy || !talk);
}
async function save() {
  if (!talk) return;
  await api('db', { col: 'tutor', id: talk.id, op: 'set', data: talk }).catch(() => null);
}
async function turn() {
  if (!talk) return;
  busy = true;
  paint();
  try {
    const r = await api('tutor', { messages: talk.msgs, mode: talk.mode ?? 'scene', id: talk.id });
    talk.msgs.push({ role: 'assistant', content: r.text });
    save();
  } catch (e) {
    talk.msgs.push({ role: 'assistant', content: `(${(e as Error).message})` });
  } finally {
    busy = false;
    paint();
    BOX.focus();
  }
}
async function fresh() {
  const now = new Date();
  talk = talks[mode] = { id: now.toISOString().replace(/[^0-9]/g, '').slice(0, 14), started: now.toISOString(), msgs: [], mode };
  // a scene opens with the tutor's lines; Ask waits for his question
  if (mode === 'scene') await turn();
  else paint();
}
async function load() {
  loaded = true;
  try {
    const list = (await api('db?col=tutor')) as { id: string; data: Talk }[];
    // a conversation from today carries on (the last of each mode); an older one stays in the database
    for (const { data } of list.sort((a, b) => (a.id < b.id ? -1 : 1)))
      if (data && Date.now() - Date.parse(data.started) < 18 * 3600_000 && data.msgs?.length) talks[data.mode ?? 'scene'] = data;
  } catch {}
  showMode();
  if (talks[mode]) {
    talk = talks[mode]!;
    return paint();
  }
  fresh();
}

FORM.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = BOX.value.trim();
  if (!t || busy || !talk) return;
  BOX.value = '';
  talk.msgs.push({ role: 'user', content: t });
  turn();
});
BOX.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    FORM.requestSubmit();
  }
});
$('.tu-new', VIEW_EL).addEventListener('click', () => !busy && fresh());
$('.tu-mode', VIEW_EL).addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode as Mode | undefined;
  if (!m || m === mode || busy) return;
  mode = m;
  try {
    localStorage.setItem('tutor-mode', m);
  } catch {}
  showMode();
  if (talks[m]) {
    talk = talks[m]!;
    paint();
  } else fresh();
  BOX.focus();
});

// one tap: a marked word, or the Chinese he selected, goes to the card maker
function card(w: string) {
  w = w.replace(/[^㐀-鿿]/g, '');
  if (!w) return;
  try {
    sfx('tap');
  } catch {}
  CARD.hidden = true;
  setView('cards');
  openCard(w, 'tutor');
}
LOG.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.tu-w');
  if (b) card(b.dataset.w!);
});
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  const t = s && !s.isCollapsed && LOG.contains(s.anchorNode) ? s.toString().replace(/[^㐀-鿿]/g, '') : '';
  if (!t || t.length > 12) return void (CARD.hidden = true);
  const r = s!.getRangeAt(0).getBoundingClientRect(), box = VIEW_EL.firstElementChild!.getBoundingClientRect();
  CARD.style.left = `${r.left - box.left + r.width / 2}px`;
  CARD.style.top = `${r.top - box.top - 44}px`;
  CARD.dataset.w = t;
  CARD.hidden = false;
});
CARD.addEventListener('pointerdown', (e) => e.preventDefault());
CARD.addEventListener('click', () => card(CARD.dataset.w ?? ''));

TAB.addEventListener('click', () => setView('tutor'));
new MutationObserver(() => {
  if (!VIEW_EL.hidden && !loaded) load();
  if (!VIEW_EL.hidden) setTimeout(() => BOX.focus(), 50);
}).observe(VIEW_EL, { attributes: true, attributeFilter: ['hidden'] });
