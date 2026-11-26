/* Settings: one window for the whole of Plus, under the gear (⌘, or Ctrl+, too; F12 opens it on Shortcuts).
   A window in the middle of the screen (a sheet on a phone): sections on the left, each a group of one-line rows.
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
   SETTINGS.open('keys' | 'Reviews' | … | undefined: the section last shown), SETTINGS.close(), SETTINGS.redraw(). */
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
// Habit: the evening nudge on his phone (src/cbp/push.ts), at a time he picks, Taipei time; habit.js adds the phone's switch
const hm = (v: string) => `${+v.slice(0, 2) - 12}:${v.slice(3)} pm`;
LAB.define('nudge', 'Evening nudge', [['off', 'Off'], ...Array.from({ length: 14 }, (_, i) => `${17 + (i >> 1)}:${i % 2 ? '30' : '00'}`).map((v): [string, string] => [v, hm(v)])], '21:00', 'Habit', A);
// (end Habit)
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
    if ((document.getElementById('settings') as HTMLDialogElement | null)?.open) draw();
  } catch {}
})();

// ---------- the window ----------
/* A window in the middle of the screen (a sheet from the bottom on a phone): the sections on the left (a strip across
   the top on a phone), all of them on one page on the right that scrolls, each a rounded group of one-line rows. A native modal
   <dialog>: the page behind is inert, Tab stays inside, Escape or a click outside closes it. The pattern for every
   dialog in Plus: `dialog.st` and its tokens in kit.css. */
type Sec = { id: string; label: string; icon: string };
const SECS: Sec[] = [
  { id: 'Everyday', label: 'Everyday', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>' },
  { id: 'Reviews', label: 'Reviews', icon: '<rect x="4" y="5" width="13" height="15" rx="2"/><path d="M8 2.8h10a2 2 0 0 1 2 2V17"/>' },
  { id: 'Habit', label: 'Habit', icon: '<path d="M4 12.5 9 17.5 20 6.5"/>' },
  { id: 'AI', label: 'AI', icon: '<path d="M12 3.5c.6 4.4 4.1 7.9 8.5 8.5-4.4.6-7.9 4.1-8.5 8.5-.6-4.4-4.1-7.9-8.5-8.5 4.4-.6 7.9-4.1 8.5-8.5z"/>' },
  { id: 'Shortcuts', label: 'Shortcuts', icon: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>' },
];
const glyph = (d: string) => `<svg class="st-gl" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
const X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

const btn = document.getElementById('settingsbtn')!;
// the page's old panel holder becomes the window
const dlg = document.createElement('dialog');
dlg.id = 'settings';
dlg.className = 'st';
dlg.setAttribute('aria-labelledby', 'st-title');
(document.getElementById('settings') ?? document.body.lastElementChild!).replaceWith(dlg);
if (!dlg.isConnected) document.body.append(dlg);
btn.innerHTML =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

let sec = 'Everyday', listening = '';
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
const isSwitch = (d: LabDef) => d.options.length === 2 && d.options[0][0] === 'on' && d.options[1][0] === 'off';
const sw = (attr: string, on: boolean, label: string) => `<div class="st-row"><span class="st-l">${esc(label)}</span><button type="button" role="switch" class="st-tg" aria-checked="${on}" aria-label="${esc(label)}" ${attr}><i></i></button></div>`;
function row(d: LabDef) {
  if (isSwitch(d)) return sw(`data-x="${d.id}" data-v="${d.v === 'on' ? 'off' : 'on'}"`, d.v === 'on', d.label);
  // many options (the nudge's time, a model): a compact menu
  if (d.options.length > 3) return `<div class="st-row"><label class="st-l" for="st-${d.id}">${esc(d.label)}</label><span class="st-selw"><select class="st-sel" id="st-${d.id}" data-xs="${d.id}">${d.options.map(([v, l]) => `<option value="${esc(v)}"${d.v === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></span></div>`;
  const big = d.id === 'text-size';
  return `<div class="st-row"><span class="st-l">${esc(d.label)}</span><span class="st-o${big ? ' st-sz' : ''}" role="radiogroup" aria-label="${esc(d.label)}">${d.options
    .map(([v, l]) => `<button type="button" role="radio" aria-checked="${d.v === v}" data-x="${d.id}" data-v="${esc(v)}"${big ? ` aria-label="${esc(l)}"` : ''}>${big ? `<span class="sz-${esc(v)}">Aa <span class="zh">中文</span></span>` : esc(l)}</button>`)
    .join('')}</span></div>`;
}
/** Every section's rows, as HTML, from LAB (choices and the rows other files draw). Empty sections are left out. */
function rowsBy() {
  const ids = [...ORDER.filter((id) => LAB.defs[id]), ...LAB.order.filter((id) => !ORDER.includes(id))];
  const by: Record<string, string[]> = {};
  for (const id of ids) (by[LAB.defs[id].group] ??= []).push(row(LAB.defs[id]));
  for (const r of Object.values(LAB.rows)) {
    const h = r.html();
    if (h) (by[r.group] ??= []).push(`<div class="st-cust" data-row="${r.id}">${h}</div>`);
  }
  (by.Everyday ??= []).unshift(sw('data-sound', SND.on, 'Sound'));
  return by;
}
function sections(by: Record<string, string[]>): Sec[] {
  const extra = Object.keys(by).filter((g) => !SECS.some((s) => s.id === g)).map((g) => ({ id: g, label: g, icon: SECS[0].icon }));
  return [...SECS.filter((s) => s.id === 'Shortcuts' || by[s.id]), ...extra].sort((a, b) => (a.id === 'Shortcuts' ? 1 : b.id === 'Shortcuts' ? -1 : 0));
}
/** Choices of a section that differ from their defaults (Reset shows only then). */
const changed = (s: string) => (s === 'Shortcuts' ? KEYS.defs.some((d) => KEYS.changed(d.id)) : LAB.order.some((id) => LAB.defs[id].group === s && LAB.get(id) !== LAB.defs[id].def));
function keysHTML() {
  const groups: Record<string, Def[]> = {};
  for (const d of KEYS.defs) (groups[d.group] ??= []).push(d);
  return Object.entries(groups)
    .map(
      ([g, ds]) =>
        `<h4 class="st-cap">${esc(g)}</h4><div class="st-grp">${ds
          .map((d) => `<div class="st-row"><span class="st-l">${esc(d.label)}</span><button type="button" class="st-key${listening === d.id ? ' on' : ''}${KEYS.changed(d.id) ? ' mine' : ''}" data-key="${d.id}" aria-label="${esc(d.label)}">${listening === d.id ? 'Press a key' : KEYS.keys(d.id).map((k) => `<kbd>${esc(KEYS.pretty(k))}</kbd>`).join('') || '—'}</button></div>`)
          .join('')}</div>`,
    )
    .join('');
}
function draw() {
  const a = document.activeElement as HTMLElement | null;
  const keep = a && dlg.contains(a) ? a.dataset.x ?? a.dataset.key ?? a.dataset.sec ?? a.dataset.xs ?? a.dataset.reset ?? (a.dataset.sound != null ? 'sound' : a.id) : '';
  const body = dlg.querySelector('.st-body');
  const top = body?.scrollTop ?? 0;
  const by = rowsBy();
  const list = sections(by);
  if (!list.some((s) => s.id === sec)) sec = list[0].id;
  dlg.innerHTML = `<div class="st-grab" aria-hidden="true"></div>
    <nav class="st-side" aria-label="Sections"><h2 id="st-title">Settings</h2><div class="st-toc">${list
      .map((s) => `<button type="button" class="st-ti" data-sec="${esc(s.id)}" aria-current="${s.id === sec}">${glyph(s.icon)}<span>${esc(s.label)}</span></button>`)
      .join('')}</div></nav>
    <div class="st-main">
      <div class="st-head"><h2 class="st-now" aria-hidden="true">Settings</h2><button type="button" class="st-x" id="st-close" aria-label="Close">${X}</button></div>
      <div class="st-body">${list
        .map(
          (s) =>
            `<section class="st-sec" data-s="${esc(s.id)}" aria-labelledby="st-s-${esc(s.id)}"><div class="st-sh"><h3 id="st-s-${esc(s.id)}">${esc(s.label)}</h3>${
              changed(s.id) ? `<button type="button" class="st-reset" data-reset="${esc(s.id)}">Reset</button>` : ''
            }</div>${s.id === 'Shortcuts' ? keysHTML() : `<div class="st-grp">${by[s.id].join('')}</div>`}</section>`,
        )
        .join('')}</div>
    </div>`;
  for (const r of Object.values(LAB.rows)) {
    const el = dlg.querySelector<HTMLElement>(`[data-row="${r.id}"]`);
    if (el) r.bind(el);
  }
  const nb = dlg.querySelector<HTMLElement>('.st-body')!;
  nb.scrollTop = top;
  nb.addEventListener('scroll', spy, { passive: true });
  if (keep) {
    const q = `[data-x="${keep}"][aria-checked="true"],[data-x="${keep}"],[data-key="${keep}"],[data-sec="${keep}"],[data-xs="${keep}"],[data-reset="${keep}"]`;
    (dlg.querySelector<HTMLElement>(q) ?? (keep === 'sound' ? dlg.querySelector<HTMLElement>('[data-sound]') : keep ? dlg.querySelector<HTMLElement>('#' + CSS.escape(keep)) : null) ?? dlg.querySelector<HTMLElement>('.st-x'))?.focus({ preventScroll: true });
  }
  mark();
}
/* One page, every section on it: the list on the left jumps to a section, and the section in view is the one lit
   (the line 1/4 down the page decides). A jump holds the light on its section until the scroll stops. */
let jumping = 0;
function mark() {
  dlg.querySelectorAll<HTMLElement>('.st-ti').forEach((b) => b.setAttribute('aria-current', String(b.dataset.sec === sec)));
  // the phone's strip of sections keeps the current one in view
  const on = dlg.querySelector<HTMLElement>('.st-ti[aria-current="true"]');
  const toc = on?.parentElement;
  if (on && toc && toc.scrollWidth > toc.clientWidth) toc.scrollTo({ left: on.offsetLeft - (toc.clientWidth - on.offsetWidth) / 2, behavior: REDUCED.matches ? 'auto' : 'smooth' });
}
function spy() {
  if (jumping) return;
  const b = dlg.querySelector<HTMLElement>('.st-body');
  if (!b) return;
  const all = [...b.querySelectorAll<HTMLElement>('.st-sec')];
  const line = b.getBoundingClientRect().top + b.clientHeight / 4;
  let cur = all[0];
  for (const s of all) if (s.getBoundingClientRect().top <= line) cur = s;
  // at the very end, the last one (a short last section never reaches the line)
  if (b.scrollTop > 0 && b.scrollTop + b.clientHeight >= b.scrollHeight - 2) cur = all[all.length - 1];
  if (cur && cur.dataset.s !== sec) {
    sec = cur.dataset.s!;
    mark();
  }
}
function jump(to: string, smooth: boolean) {
  const b = dlg.querySelector<HTMLElement>('.st-body');
  const s = b?.querySelector<HTMLElement>(`.st-sec[data-s="${CSS.escape(to)}"]`);
  if (!b || !s) return;
  sec = to;
  mark();
  clearTimeout(jumping);
  const y = s === b.firstElementChild ? 0 : Math.round(b.scrollTop + s.getBoundingClientRect().top - b.getBoundingClientRect().top - parseFloat(getComputedStyle(b).paddingTop));
  if (!smooth || REDUCED.matches) {
    jumping = 0;
    b.scrollTop = y;
    return;
  }
  jumping = window.setTimeout(() => (jumping = 0), 700);
  b.addEventListener('scrollend', () => (clearTimeout(jumping), (jumping = 0)), { once: true });
  b.scrollTo({ top: y, behavior: 'smooth' });
}

// opening and closing: a short fade and lift in the middle; on a phone the sheet slides up (and follows his finger down)
let closing = 0;
function show(to?: string) {
  listening = '';
  if (to === 'keys') sec = 'Shortcuts';
  else if (to && to !== 'main') sec = to;
  clearTimeout(closing);
  dlg.classList.remove('out');
  dlg.style.transform = '';
  const was = dlg.open;
  draw();
  if (!was) {
    dlg.showModal();
    requestAnimationFrame(() => dlg.classList.add('on'));
  }
  // to the section asked for (or the one he was on last time)
  if (to || !was) jump(sec, false);
  btn.setAttribute('aria-expanded', 'true');
  (dlg.querySelector<HTMLElement>('.st-ti[aria-current="true"]') ?? dlg.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
}
function hide() {
  if (!dlg.open || dlg.classList.contains('out')) return;
  listening = '';
  dlg.classList.remove('on');
  dlg.classList.add('out');
  btn.setAttribute('aria-expanded', 'false');
  closing = window.setTimeout(() => {
    dlg.classList.remove('out');
    dlg.style.transform = '';
    dlg.close();
    btn.focus({ preventScroll: true });
  }, REDUCED.matches ? 120 : 200);
}
btn.onclick = (e) => {
  e.stopPropagation();
  sfx('tap');
  dlg.open && !dlg.classList.contains('out') ? hide() : show();
};
// Escape (the dialog's cancel) closes it the same way as the ×
dlg.addEventListener('cancel', (e) => {
  e.preventDefault();
  hide();
});
dlg.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  // a click on the dim page around the window
  if (t === dlg) {
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return hide();
  }
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
  const s = t.closest<HTMLElement>('[data-sec]');
  if (s) {
    sfx('tap');
    return jump(s.dataset.sec!, true);
  }
  const k = t.closest<HTMLElement>('[data-key]');
  if (k) {
    listening = listening === k.dataset.key ? '' : k.dataset.key!;
    sfx('tap');
    return draw();
  }
  if (t.closest('#st-close')) return sfx('tap'), hide();
  const rs = t.closest<HTMLElement>('[data-reset]');
  if (rs) {
    const g = rs.dataset.reset!;
    if (g === 'Shortcuts') KEYS.reset();
    else for (const id of LAB.order) if (LAB.defs[id].group === g) LAB.set(id, LAB.defs[id].def);
    sfx('swish');
    return draw();
  }
});
// a menu's choice
dlg.addEventListener('change', (e) => {
  const s = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-xs]');
  if (!s) return;
  LAB.set(s.dataset.xs!, s.value);
  sfx('tap');
  draw();
});
// a new key for an action: the next key he presses (Esc leaves it as it was)
addEventListener(
  'keydown',
  (e) => {
    if (!listening || !dlg.open) return;
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
  const up = dlg.open && !dlg.classList.contains('out');
  if (KEYS.is(e, 'shortcuts')) {
    e.preventDefault();
    sfx('tap');
    return up && sec === 'Shortcuts' ? hide() : show('keys');
  }
  if (KEYS.is(e, 'settings')) {
    e.preventDefault();
    sfx('tap');
    return up ? hide() : show();
  }
  // the sections, with the arrow keys, while one of them has the focus
  const ti = (e.target as HTMLElement).closest?.('.st-ti');
  if (up && ti && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
    e.preventDefault();
    const all = [...dlg.querySelectorAll<HTMLElement>('.st-ti')];
    const i = all.indexOf(ti as HTMLElement) + (/Up|Left/.test(e.key) ? -1 : 1);
    const n = all[(i + all.length) % all.length];
    sfx('tap');
    jump(n.dataset.sec!, true);
    n.focus();
  }
});
BUS.on('lab', () => dlg.open && draw());

// ---------- the phone's sheet: drag it down by its top to send it away ----------
const PHONE = matchMedia('(max-width: 640px)');
dlg.addEventListener('pointerdown', (e) => {
  if (!PHONE.matches || e.button !== 0 || !(e.target as HTMLElement).closest('.st-grab,.st-head') || (e.target as HTMLElement).closest('button')) return;
  const y0 = e.clientY, h = dlg.offsetHeight;
  let dy = 0, last = { y: y0, t: e.timeStamp }, v = 0;
  try {
    dlg.setPointerCapture(e.pointerId);
  } catch {}
  dlg.classList.add('drag');
  const move = (m: PointerEvent) => {
    const d = m.clientY - y0;
    // 1:1 down; up past the top only a little (rubber band)
    dy = d > 0 ? d : -Math.sqrt(-d) * 2;
    dlg.style.transform = `translateY(${dy}px)`;
    const dt = m.timeStamp - last.t;
    if (dt > 0) v = (m.clientY - last.y) / dt;
    last = { y: m.clientY, t: m.timeStamp };
  };
  const up = () => {
    dlg.removeEventListener('pointermove', move);
    dlg.classList.remove('drag');
    // away on distance (a third of the sheet) or on a flick down
    if (dy > h / 3 || v > 0.5) {
      dlg.style.transform = '';
      hide();
    } else dlg.style.transform = '';
  };
  dlg.addEventListener('pointermove', move);
  dlg.addEventListener('pointerup', up, { once: true });
  dlg.addEventListener('pointercancel', up, { once: true });
});

export const SETTINGS = { open: (to?: string) => show(to), close: () => hide(), redraw: () => dlg.open && draw() };
