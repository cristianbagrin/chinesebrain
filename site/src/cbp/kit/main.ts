// Chinese Brain Plus: the shared parts every page of the board uses (plus/kit.js, loaded right after the board's
// core.js, before every other script). Each is a global, documented in its own file:
//   SOUND     one voice at a time (sound.ts)            HOLD   press and hold, with a fill (hold.ts)
//   RUBY      pinyin above the characters (ruby.ts)      KEYS   every shortcut, his to change (keys.ts)
//   SETTINGS  the one Settings panel (settings.ts); the choices themselves are LAB's (core.js)
//   go.ts     T, C, R, B open Today, Cards, Reviews, Browse from any page
// The type tokens and the styles for these are in board/css/base.css and board/css/kit.css.
import { SOUND } from './sound.ts';
import { HOLD } from './hold.ts';
import { RUBY } from './ruby.ts';
import { KEYS } from './keys.ts';
import { SETTINGS } from './settings.ts';
// T, C, R, B: to the pages from anywhere (go.ts)
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

// leaving a page silences it: a voice never carries over into the next one
declare const BUS: { on(e: string, f: (...a: any[]) => void): void };
BUS.on('leave', () => SOUND.stop());
