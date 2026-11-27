// Chinese Brain Plus: the shared parts every page of the board uses (plus/kit.js, loaded right after the board's
// core.js, before every other script). Each is a global, documented in its own file:
//   SOUND     one voice at a time (sound.ts)            HOLD   press and hold, with a fill (hold.ts)
//   RUBY      pinyin above the characters (ruby.ts)      KEYS   every shortcut, his to change (keys.ts)
//   SETTINGS  the one Settings panel (settings.ts); the choices themselves are LAB's (core.js)
//   go.ts     Shift+1…5 and Shift+B open the pages; each place is a browser history entry (back, forward, swipe)
// The type tokens and the styles for these are in board/css/base.css and board/css/kit.css.
import { SOUND } from './sound.ts';
import { HOLD } from './hold.ts';
import { RUBY } from './ruby.ts';
import { KEYS } from './keys.ts';
import { SETTINGS } from './settings.ts';
// Shift and a page's first letter: to that page from anywhere (go.ts)
import './go.ts';
// Habit: the habit's rules (day done, rest day, never miss twice, reviews a day), shared with the server
import * as HABIT from '../habit.ts';
// (end Habit)
// EssRev: the one rich-text editor for a card's fields (Cards' Add and Reviews' Edit), editor.ts
import { EDITOR } from './editor.ts';
// and which words he knows (known.ts), so pinyin shows only over new ones
import { KNOWN } from './known.ts';
Object.assign(window, { EDITOR, KNOWN });
// (end EssRev)

Object.assign(window, { SOUND, HOLD, RUBY, KEYS, SETTINGS });
// Habit
Object.assign(window, { HABIT });
// (end Habit)

// a toast (core.js, cards.js, the reviews' own) shows above an open dialog: the window is modal, so one on the page behind
// would sit under it, inert, until it closed. Added while a modal dialog is open, it goes into that dialog (still fixed to
// the bottom of the screen); its own code removes it as before.
new MutationObserver((recs) => {
  for (const r of recs)
    for (const n of r.addedNodes) {
      if (!(n instanceof HTMLElement) || !n.classList.contains('toast')) continue;
      const top = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].filter((d) => d.matches(':modal')).pop();
      if (top) top.append(n);
    }
}).observe(document.body, { childList: true });

// leaving a page silences it: a voice never carries over into the next one
declare const BUS: { on(e: string, f: (...a: any[]) => void): void };
BUS.on('leave', () => SOUND.stop());
