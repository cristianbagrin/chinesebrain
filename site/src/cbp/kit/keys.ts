/* Every shortcut in Plus, in one place, each one his to change (Settings › Shortcuts, or F12). Handlers ask
     KEYS.is(e, 'rv.play')      does this keydown press the key bound to that action?
   instead of testing e.key themselves; KEYS.label('rv.play') is how the key is written ("V", "⌘↵").
   Bindings he changes are saved with his settings (account: settings.ts `keys`), so the phone's keyboard and the laptop
   agree. A combo is written "mod+shift+z": mod is ⌘ on a Mac and Ctrl elsewhere; keys are e.key lowercased, with
   "space", "enter", "escape", "arrowleft", "f1"… Several combos for one action are kept apart by spaces.
   `ctx` says when an action listens (the flag picker open, an editor open, the cursor in a field): two actions only
   clash when they share a page and a ctx. Typing in a text box is never a shortcut, apart from the `field` ones.
   New key in a module: add it to DEFS here (the list shows what's here), then KEYS.is(e, id) in the handler. */
export type Def = { id: string; label: string; group: string; keys: string[]; ctx?: string; fixed?: boolean };
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const D = (group: string, ctx: string | undefined, rows: [string, string, string][]): Def[] => rows.map(([id, label, keys]) => ({ id, label, group, keys: keys.split(' '), ctx }));
export const DEFS: Def[] = [
  ...D('Everywhere', undefined, [
    ['extras', 'Extras', 'f1'],
    ['settings', 'Settings', 'mod+,'],
    ['shortcuts', 'Shortcuts', 'f12'],
    ['undo', 'Undo', 'mod+z'],
    ['redo', 'Redo', 'mod+shift+z mod+y'],
    // the pages he was on, like a browser's back and forward (go.ts)
    ['back', 'Back', 'mod+['],
    ['forward', 'Forward', 'mod+]'],
  ]),
  // to a page from anywhere: Shift and the page's first letter (go.ts); the Tutor pane is Shift+A (Ask), as T is Today's.
  // Not while he types in a field, nor over a dialog other than Settings (KEYS.free)
  ...D('Pages', undefined, [
    ['page.today', 'Today', 'shift+t'],
    ['page.reviews', 'Reviews', 'shift+r'],
    ['page.browse', 'Browse', 'shift+b'],
    ['page.cards', 'Cards', 'shift+c'],
    ['page.essays', 'Essays', 'shift+e'],
    ['page.progress', 'Progress', 'shift+p'],
    ['page.tutor', 'Tutor', 'shift+a'],
  ]),
  ...D('Reviews', undefined, [
    ['rv.show', 'Show answer', 'space enter'],
    ['rv.again', 'Again', '1'],
    ['rv.hard', 'Hard', '2'],
    ['rv.good', 'Good', '3'],
    ['rv.easy', 'Easy', '4'],
    ['rv.play', 'Play', 'v'],
    ['rv.pinyin', 'Pinyin', 'p'],
    ['rv.edit', 'Edit', 'e'],
    ['rv.flag', 'Flag', 'f'],
    ['rv.suspend', 'Suspend', 's'],
  ]),
  ...D('Reviews', 'flags', [
    ['rv.red', 'Red flag', 'r'],
    ['rv.green', 'Green flag', 'g'],
    ['rv.noflag', 'No flag', 'n 0'],
  ]),
  ...D('Reviews', 'editing', [
    ['rv.voice', 'Play the sentence', 'v'],
    ['rv.revoice', 'Make its audio again', 'shift+v'],
  ]),
  ...D('Cards', undefined, [
    ['cd.prev', 'Back', 'arrowleft'],
    ['cd.next', 'Next word', 'arrowright'],
    ['cd.write', 'Write it, then card it', 'enter'],
    ['cd.voice', 'Play the sentence', 'v'],
    ['cd.images', 'Pictures on the web', 'i'],
  ]),
  ...D('Cards', 'field', [['cd.add', 'Add and move on', 'mod+shift+enter']]),
  ...D('Card fields', 'field', [['cd.mark', 'Highlight', 'mod+shift+h']]),
  // Cards: add and stay, Gemini, rich text in the card's fields
  ...D('Cards', undefined, [['cd.gemini', 'Gemini', 'g']]),
  ...D('Cards', 'field', [['cd.addstay', 'Add and stay', 'mod+enter']]),
  // a card's fields, wherever they're edited (Cards' Add, Reviews' Edit): kit/editor.ts
  ...D('Card fields', 'field', [
    ['cd.bold', 'Bold', 'mod+b'],
    ['cd.italic', 'Italic', 'mod+i'],
    ['cd.underline', 'Underline', 'mod+u'],
  ]),
  // (end Cards)
  ...D('Cards', 'sentence', [
    ['cd.copy', 'Copy the sentence', 'space'],
    ['cd.pinyin', 'Pinyin over the sentence', 'shift+enter'],
  ]),
  // a test's choices take their letters while it's on screen
  ...D('Today', 'test', [
    ['test.a', 'Choice A', 'a'],
    ['test.b', 'Choice B', 'b'],
    ['test.c', 'Choice C', 'c'],
    ['test.d', 'Choice D', 'd'],
  ]),
  ...D('Essays', 'field', [
    ['im.up', 'Move up', 'mod+shift+arrowup'],
    ['im.down', 'Move down', 'mod+shift+arrowdown'],
  ]),
];
const BY = new Map(DEFS.map((d) => [d.id, d]));
/** Ids from before the Shift+letter page keys (Nov 27): bare T, C, R, B and A. A binding saved for one of them is dropped
    on load, so the page keys start from their new defaults and the next save leaves the old ids out. */
export const RETIRED = ['go.today', 'go.cards', 'go.reviews', 'go.browse', 'tutor'];
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** Is this in a place that takes typing (a field, an editor)? */
export const typing = (t: EventTarget | null | undefined) => !!(t && (t as Element).closest?.(TYPING));
const openDialogs = () => (typeof document === 'undefined' ? [] : [...document.querySelectorAll('dialog[open]')].map((d) => d.id));
/** May an app-wide shortcut (a page, the Tutor) take this key? Not while he types in a field, not for a key a page used
    first, and not over a dialog, Settings apart (it closes for them). */
export function free(e: KeyboardEvent, dialogs: string[] = openDialogs()) {
  if (e.defaultPrevented || e.isComposing || e.repeat || typing(e.target)) return false;
  return dialogs.every((id) => id === 'settings');
}
let mine: Record<string, string> = {};
let saveHook: ((keys: Record<string, string>) => void) | null = null;

/** The combo a keydown makes, written the way bindings are. */
export function combo(e: KeyboardEvent): string {
  let k = e.key;
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (e.altKey && /^Digit\d$/.test(e.code)) k = e.code.slice(5);
  k = k === ' ' ? 'space' : k.toLowerCase();
  if (k === 'esc') k = 'escape';
  const m: string[] = [];
  if (MAC ? e.metaKey : e.ctrlKey) m.push('mod');
  if (MAC && e.ctrlKey) m.push('ctrl');
  if (!MAC && e.metaKey) m.push('meta');
  if (e.altKey) m.push('alt');
  // Shift is part of what's typed for symbols (?, !); it counts for letters, digits and the named keys
  if (e.shiftKey && (k.length > 1 || /[a-z0-9]/.test(k))) m.push('shift');
  return [...m, k].join('+');
}
const keysOf = (id: string) => (mine[id] != null ? mine[id].split(' ').filter(Boolean) : BY.get(id)?.keys ?? []);
const MODS = ['control', 'shift', 'alt', 'meta', 'os', 'capslock', 'fn'];

export const KEYS = {
  defs: DEFS,
  is: (e: KeyboardEvent, id: string) => !e.isComposing && keysOf(id).includes(combo(e)),
  free,
  typing,
  keys: keysOf,
  label(id: string) {
    const k = keysOf(id)[0];
    return k ? pretty(k) : '';
  },
  pretty,
  combo,
  isModifier: (e: KeyboardEvent) => MODS.includes(e.key.toLowerCase()),
  /** Binds an action to one combo (null: back to its default). An action it clashes with gets this one's old key. */
  bind(id: string, k: string | null) {
    const d = BY.get(id);
    if (!d) return;
    const was = keysOf(id);
    if (k) {
      for (const o of DEFS) {
        if (o.id === id || !clash(d, o) || !keysOf(o.id).includes(k)) continue;
        const rest = keysOf(o.id).filter((x) => x !== k);
        mine[o.id] = (rest.length ? rest : was.slice(0, 1)).join(' ');
        if (mine[o.id] === o.keys.join(' ')) delete mine[o.id];
      }
      mine[id] = k;
      if (k === d.keys.join(' ')) delete mine[id];
    } else delete mine[id];
    saveHook?.({ ...mine });
  },
  reset() {
    mine = {};
    saveHook?.({});
  },
  changed: (id: string) => mine[id] != null,
  /** settings.ts: what's saved on his account, and where changes go. */
  load(saved: Record<string, string>, onSave: (keys: Record<string, string>) => void) {
    mine = Object.fromEntries(Object.entries(saved).filter(([id]) => !RETIRED.includes(id)));
    saveHook = onSave;
  },
};
// the Everywhere and Pages keys listen on every page, so they clash with every key that has no ctx
const ALL = (d: Def) => d.group === 'Everywhere' || d.group === 'Pages';
export const clash = (a: Def, b: Def) => (a.group === b.group || ALL(a) || ALL(b)) && (a.ctx ?? '') === (b.ctx ?? '');

const NAMES: Record<string, string> = MAC
  ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '↵', space: 'Space', escape: 'Esc', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', backspace: '⌫', tab: '⇥' }
  : { mod: 'Ctrl+', shift: 'Shift+', alt: 'Alt+', meta: 'Win+', enter: 'Enter', space: 'Space', escape: 'Esc', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', backspace: 'Backspace', tab: 'Tab' };
function pretty(k: string) {
  return k
    .split('+')
    .map((p, i, a) => (i === a.length - 1 ? NAMES[p] ?? (p.length === 1 ? p.toUpperCase() : p.toUpperCase()) : NAMES[p] ?? p))
    .join('');
}
