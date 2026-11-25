/* Settings: one panel for the whole of Plus, under the gear (⌘, or Ctrl+, too; F12 opens it on Shortcuts).
   Every choice on one line, its label left and its options right; group headings, no lines between.
     Everyday   Sound, Text size, Pinyin shown, Card audio plays by itself          (this device)
     Reviews    rows the Reviews tab adds with LAB.row (new cards a day, how much to remember, memory model, card
                designs, Download for Anki); absent without the reviews switch
     AI         a model per job                                                    (his account: settings.ts on the server)
     Shortcuts  the list, each key his to change (keys.ts)
   Choices live in LAB (core.js): LAB.define(id, label, options, default, group, { scope: 'account' }) adds one, LAB.get
   reads it, BUS 'lab' (id, value) says it changed. Account choices go to GET/POST /api/plus/settings and are cached on
   the device ('lab-acct') so the page opens with them offline.
   Settings for other files to read:
     LAB.get('text-size')  'normal' | 'larger'          LAB.get('pinyin')    'on' | 'off'   (RUBY.shown())
     LAB.get('autoplay')   'on' | 'off' (SOUND.autoplay(); default off on a touch screen, on with a mouse)
     LAB.get('card-model' | 'pinyin-model' | 'idea-model' | 'deeper-model' | 'test-model' | 'grade-model' | 'essay-model'
             | 'tutor-model')  'haiku' | 'sonnet' | 'opus';   LAB.get('draw-model') 'both' | 'mai' | 'flux';
     LAB.get('card-ahead') 'on' | 'off'
   SETTINGS.open('keys' | undefined), SETTINGS.close(), SETTINGS.redraw(). */
import { KEYS, type Def } from './keys.ts';

type LabDef = { id: string; label: string; options: [string, string][]; def: string; group: string; v: string; scope?: string };
type Row = { id: string; group: string; html: () => string; bind: (el: HTMLElement) => void };
declare const LAB: {
  defs: Record<string, LabDef>;
  order: string[];
  rows: Record<string, Row>;
  acct: { values?: Record<string, string>; keys?: Record<string, string> };
  define(id: string, label: string, options: [string, string][], def: string, group: string, o?: { scope?: string }): string;
  get(id: string): string | null;
  set(id: string, v: string, from?: string): void;
  saveAcct(): void;
  push?: () => void;
};
declare const SND: { on: boolean };
declare function sfx(n: string): void;
declare function esc(s: unknown): string;
declare function lsGet(k: string): string | null;
declare function lsSet(k: string, v: string): void;
declare const BUS: { on(e: string, f: (...a: any[]) => void): void; emit(e: string, ...a: unknown[]): void };

const M: [string, string][] = [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus']];
const A = { scope: 'account' };
const TOUCH = matchMedia('(hover: none)').matches;
const firstRun = lsGet('lab-acct') == null;

// ---------- the choices ----------
LAB.define('text-size', 'Text size', [['normal', 'Normal'], ['larger', 'Larger']], 'normal', 'Everyday');
LAB.define('pinyin', 'Pinyin shown', [['on', 'On'], ['off', 'Off']], 'off', 'Everyday');
LAB.define('autoplay', 'Card audio plays by itself', [['on', 'On'], ['off', 'Off']], TOUCH ? 'off' : 'on', 'Everyday');
LAB.define('card-model', 'Cards written by', M, 'sonnet', 'AI', A);
LAB.define('card-ahead', 'Next five written ahead', [['on', 'On'], ['off', 'Off']], 'on', 'AI', A);
LAB.define('pinyin-model', 'Pinyin', M, 'sonnet', 'AI', A);
LAB.define('idea-model', 'Picture ideas', M, 'sonnet', 'AI', A);
LAB.define('draw-model', 'Drawings', [['both', 'Both'], ['mai', 'MAI'], ['flux', 'Flux']], 'both', 'AI', A);
LAB.define('deeper-model', 'Five minutes on a word', M, 'sonnet', 'AI', A);
LAB.define('test-model', 'Writing tests', M, 'sonnet', 'AI', A);
LAB.define('grade-model', 'Grading tests', M, 'sonnet', 'AI', A);
LAB.define('essay-model', 'Essay marks', M, 'opus', 'AI', A);
LAB.define('tutor-model', 'Tutor', M, 'sonnet', 'AI', A);
const ORDER = ['text-size', 'pinyin', 'autoplay', 'card-model', 'card-ahead', 'pinyin-model', 'idea-model', 'draw-model', 'deeper-model', 'test-model', 'grade-model', 'essay-model', 'tutor-model'];
const GROUPS = ['Everyday', 'Reviews', 'AI'];

// ---------- his account ----------
const token = () => lsGet('cb-token') ?? '';
const acctIds = () => Object.values(LAB.defs).filter((d) => d.scope === 'account').map((d) => d.id);
let pushT = 0;
LAB.push = () => {
  clearTimeout(pushT);
  pushT = window.setTimeout(() => {
    const values = Object.fromEntries(acctIds().map((id) => [id, LAB.get(id)!]));
    fetch('/api/plus/settings', { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ values, keys: LAB.acct.keys ?? {} }) }).catch(() => {});
  }, 600);
};
KEYS.load(LAB.acct.keys ?? {}, (keys) => {
  LAB.acct.keys = keys;
  LAB.saveAcct();
  LAB.push!();
});
(async () => {
  try {
    const r = await fetch('/api/plus/settings', { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' });
    if (!r.ok) return;
    const s = (await r.json()) as { values: Record<string, string>; keys: Record<string, string> };
    let mine = false;
    for (const id of acctIds()) {
      // the first time on this version: a choice this device made before (kept as lab:<id>) goes up to the account
      const old = firstRun ? lsGet('lab:' + id) : null;
      const d = LAB.defs[id];
      if (old && old !== s.values[id] && d.options.some(([o]) => o === old) && old !== d.def) {
        mine = true;
        continue;
      }
      if (s.values[id] && s.values[id] !== LAB.get(id)) LAB.set(id, s.values[id], 'server');
    }
    LAB.acct.keys = s.keys ?? {};
    KEYS.load(LAB.acct.keys, (keys) => {
      LAB.acct.keys = keys;
      LAB.saveAcct();
      LAB.push!();
    });
    LAB.saveAcct();
    if (mine) LAB.push!();
    if (!document.getElementById('settings')!.hidden) draw();
  } catch {}
})();

// ---------- the panel ----------
const btn = document.getElementById('settingsbtn')!, box = document.getElementById('settings')!;
btn.innerHTML =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
let page: 'main' | 'keys' = 'main', listening = '';
const isSwitch = (d: LabDef) => d.options.length === 2 && d.options[0][0] === 'on' && d.options[1][0] === 'off';
const sw = (attr: string, on: boolean, label: string) => `<div class="st-row"><span class="st-l">${esc(label)}</span><button type="button" role="switch" class="st-tg" aria-checked="${on}" aria-label="${esc(label)}" ${attr}><i></i></button></div>`;
function row(d: LabDef) {
  if (isSwitch(d)) return sw(`data-x="${d.id}" data-v="${d.v === 'on' ? 'off' : 'on'}"`, d.v === 'on', d.label);
  const big = d.id === 'text-size';
  return `<div class="st-row"><span class="st-l">${esc(d.label)}</span><span class="st-o${big ? ' st-sz' : ''}" role="radiogroup" aria-label="${esc(d.label)}">${d.options
    .map(([v, l]) => `<button type="button" role="radio" aria-checked="${d.v === v}" data-x="${d.id}" data-v="${esc(v)}"${big ? ` aria-label="${esc(l)}"` : ''}>${big ? `<span class="sz-${esc(v)}">Aa <span class="zh">中文</span></span>` : esc(l)}</button>`)
    .join('')}</span></div>`;
}
function mainHTML() {
  const ids = [...ORDER.filter((id) => LAB.defs[id]), ...LAB.order.filter((id) => !ORDER.includes(id))];
  const by: Record<string, string[]> = {};
  for (const id of ids) (by[LAB.defs[id].group] ??= []).push(row(LAB.defs[id]));
  for (const r of Object.values(LAB.rows)) (by[r.group] ??= []).push(`<div class="st-cust" data-row="${r.id}">${r.html()}</div>`);
  by.Everyday?.unshift(sw('data-sound', SND.on, 'Sound'));
  const groups = [...GROUPS, ...Object.keys(by).filter((g) => !GROUPS.includes(g))];
  return `<div class="st-top"><b>Settings</b><button class="btn-q" type="button" id="st-reset">Reset</button><button class="st-x" type="button" id="st-close" aria-label="Close">×</button></div>
    ${groups.filter((g) => by[g]).map((g) => `<section class="st-g"><h3>${esc(g)}</h3>${by[g].join('')}</section>`).join('')}
    <section class="st-g"><h3>Shortcuts</h3><button type="button" class="st-row st-go" data-page="keys"><span class="st-l">All shortcuts</span><span class="st-k">${esc(KEYS.label('shortcuts'))}</span></button></section>`;
}
function keysHTML() {
  const groups: Record<string, Def[]> = {};
  for (const d of KEYS.defs) (groups[d.group] ??= []).push(d);
  return `<div class="st-top"><button type="button" class="btn-q st-back" data-page="main">‹ Settings</button><b></b><button class="btn-q" type="button" id="st-kreset">Reset</button><button class="st-x" type="button" id="st-close" aria-label="Close">×</button></div>
    ${Object.entries(groups)
      .map(
        ([g, ds]) =>
          `<section class="st-g"><h3>${esc(g)}</h3>${ds
            .map((d) => `<div class="st-row"><span class="st-l">${esc(d.label)}</span><button type="button" class="st-key${listening === d.id ? ' on' : ''}${KEYS.changed(d.id) ? ' mine' : ''}" data-key="${d.id}">${listening === d.id ? 'Press a key' : KEYS.keys(d.id).map((k) => `<kbd>${esc(KEYS.pretty(k))}</kbd>`).join('') || '—'}</button></div>`)
            .join('')}</section>`,
      )
      .join('')}`;
}
function draw() {
  const a = document.activeElement as HTMLElement | null;
  const keep = a && box.contains(a) ? a.dataset.x ?? a.dataset.key ?? (a.dataset.sound != null ? 'sound' : a.dataset.page ?? '') : '';
  const top = box.scrollTop;
  box.innerHTML = `<div class="st-in" role="dialog" aria-label="Settings">${page === 'main' ? mainHTML() : keysHTML()}</div>`;
  if (page === 'main') for (const r of Object.values(LAB.rows)) r.bind(box.querySelector<HTMLElement>(`[data-row="${r.id}"]`)!);
  box.scrollTop = top;
  if (keep) (box.querySelector<HTMLElement>(`[data-x="${keep}"][aria-checked="true"],[data-x="${keep}"],[data-key="${keep}"],[data-page="${keep}"]`) ?? (keep === 'sound' ? box.querySelector<HTMLElement>('[data-sound]') : null))?.focus({ preventScroll: true });
}
function open(on: boolean, to?: 'main' | 'keys') {
  listening = '';
  if (on) page = to ?? (box.hidden ? 'main' : page);
  box.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (on) {
    draw();
    box.scrollTop = 0;
    (box.querySelector<HTMLElement>('[aria-checked="true"],.st-key') ?? box.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
  }
}
btn.onclick = (e) => {
  e.stopPropagation();
  sfx('tap');
  open(box.hidden);
};
box.addEventListener('click', (e) => {
  e.stopPropagation();
  const t = e.target as HTMLElement;
  const b = t.closest<HTMLElement>('[data-x]');
  if (b) {
    LAB.set(b.dataset.x!, b.dataset.v!);
    sfx(b.getAttribute('role') === 'switch' ? (b.dataset.v === 'on' ? 'stamp-known' : 'unstamp') : 'tap');
    return draw();
  }
  if (t.closest('[data-sound]')) {
    document.getElementById('snd')!.click();
    // the switch plays what it turns on
    if (SND.on) setTimeout(() => sfx('stamp-known'), 60);
    return draw();
  }
  const pg = t.closest<HTMLElement>('[data-page]');
  if (pg) {
    sfx('tap');
    page = pg.dataset.page as 'main' | 'keys';
    listening = '';
    box.scrollTop = 0;
    return draw();
  }
  const k = t.closest<HTMLElement>('[data-key]');
  if (k) {
    listening = listening === k.dataset.key ? '' : k.dataset.key!;
    sfx('tap');
    return draw();
  }
  if (t.id === 'st-close') return sfx('tap'), open(false), btn.focus();
  if (t.id === 'st-reset') {
    for (const id of LAB.order) LAB.set(id, LAB.defs[id].def);
    sfx('swish');
    return draw();
  }
  if (t.id === 'st-kreset') {
    KEYS.reset();
    sfx('swish');
    return draw();
  }
});
// a new key for an action: the next key he presses (Esc leaves it as it was)
addEventListener(
  'keydown',
  (e) => {
    if (!listening || box.hidden) return;
    if (KEYS.isModifier(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const id = listening;
    listening = '';
    if (e.key !== 'Escape') {
      KEYS.bind(id, KEYS.combo(e));
      sfx('stamp');
    }
    draw();
  },
  true,
);
document.addEventListener('keydown', (e) => {
  if (KEYS.is(e, 'shortcuts')) {
    e.preventDefault();
    sfx('tap');
    return open(box.hidden || page !== 'keys', 'keys');
  }
  if (KEYS.is(e, 'settings')) {
    e.preventDefault();
    sfx('tap');
    return open(box.hidden, 'main'), box.hidden && btn.focus();
  }
  if (e.key === 'Escape' && !box.hidden) open(false), btn.focus();
});
// a click anywhere outside the panel (and not on the gear) closes it
document.addEventListener('pointerdown', (e) => !box.hidden && !box.contains(e.target as Node) && !btn.contains(e.target as Node) && open(false), true);
BUS.on('lab', () => !box.hidden && page === 'main' && draw());

export const SETTINGS = { open: (to?: 'main' | 'keys') => open(true, to), close: () => open(false), redraw: () => !box.hidden && draw() };
