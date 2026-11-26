// Chinese Brain Plus, Essays: a word's pinyin and meaning by code, no AI. The pinyin is Plus's own (pinyin.ts over
// plus/pinyin.txt); the meaning is the first senses of Chinese Brain's dictionary entry (plus/gloss.txt, which the
// build writes from the same words). GET /api/plus/look?t=<text>&at=<offset> answers a tap in an essay: the word
// under the offset, read in its sentence. The essay job uses `reading` and `gloss` for words it files.
import * as PY from './pinyin.ts';
import { lexicon } from './cards.ts';

type Env = { ASSETS?: { fetch(u: string): Promise<Response> } };
export type Gloss = Map<string, string>;

export function parseGloss(text: string): Gloss {
  const m: Gloss = new Map();
  let s = 0;
  while (s < text.length) {
    let e = text.indexOf('\n', s);
    if (e < 0) e = text.length;
    const t = text.indexOf('\t', s);
    if (t > s && t < e) m.set(text.slice(s, t), text.slice(t + 1, e));
    s = e + 1;
  }
  return m;
}

let GL: Promise<Gloss> | null = null;
export function glossary(env: Env) {
  if (!env.ASSETS) return Promise.reject(new Error('no glossary'));
  return (GL ??= env.ASSETS.fetch('https://plus.local/plus/gloss.txt')
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`glossary ${r.status}`))))
    .then(parseGloss)
    .catch((e) => ((GL = null), Promise.reject(e))));
}

export type Word = { w: string; i: number; py: string; g: string };
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

/** The Chinese words of a text with their place, Taiwan reading (marked) and meaning; a word the dictionary lacks
 *  is glossed character by character. */
export function words(lex: PY.Lex, gl: Gloss, text: string): Word[] {
  const out: Word[] = [];
  let i = 0;
  for (const t of PY.tokens(lex, text)) {
    if (t.py && HAN.test(t.text)) {
      let g = gl.get(t.text) ?? gl.get(t.text.replace(/台/g, '臺')) ?? '';
      if (!g && [...t.text].length > 1) g = [...t.text].map((c) => `${c} ${(gl.get(c) ?? '').split(';')[0]}`.trim()).join(' · ');
      out.push({ w: t.text, i, py: PY.word(t.py), g });
    }
    i += t.text.length;
  }
  return out;
}

/** A word or phrase alone: its reading (marked, spaced by word) and, for one dictionary word, its meaning. */
export function reading(lex: PY.Lex, gl: Gloss, text: string) {
  const ws = words(lex, gl, text);
  return { py: ws.map((x) => x.py).join(' '), g: ws.length === 1 ? ws[0].g : ws.map((x) => x.g.split(';')[0]).filter(Boolean).join(' · ') };
}

/** GET plus/look?t=&at=: the word at `at` in t (t at most 60 characters), or every word when at is missing. */
export async function look(env: Env, t: string, at: number | null) {
  const text = String(t ?? '').slice(0, 60);
  if (!HAN.test(text)) return { words: [] };
  const [lex, gl] = await Promise.all([lexicon(env as never), glossary(env)]);
  const ws = words(lex, gl, text);
  if (at == null || !Number.isFinite(at)) return { words: ws };
  const hit = ws.find((x) => at >= x.i && at < x.i + x.w.length);
  return { words: hit ? [hit] : [] };
}
