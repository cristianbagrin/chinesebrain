// Pinyin as code, for Plus (the page's pinyin over characters, kit/ruby.ts) and the server (a new card's Pinyin field,
// cards.ts). The lexicon is Chinese Brain's own dictionary (CC-CEDICT with MOE Taiwan readings, wordfreq), cut down at
// build time to one reading per word (scripts/build.mjs → site/public/plus/pinyin.txt: word, numbered reading, zipf).
// Words come from the same unigram split the extension uses (src/shared/dict.ts segment); then Taiwan's rules:
// 不 and 一 written with their changed tones (bú shì, yí gè, yì tiān), no third-tone sandhi written, neutral tones only
// where the Taiwan dictionary has them. A few characters read two ways alone (還 hái/huán, 得 de/děi…): plain rules settle
// the common cases and `unsure` says when a sentence still holds one, so only those go to Claude.
import { syllableToMarked } from '../../../src/shared/pinyin.ts';

export type Lex = Map<string, [string, number]>;
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const RUN = /[㐀-䶿一-鿿豈-﫿]+|[^㐀-䶿一-鿿豈-﫿]+/g;
const MAX = 8;

export function parseLex(text: string): Lex {
  const m: Lex = new Map();
  let s = 0;
  while (s < text.length) {
    let e = text.indexOf('\n', s);
    if (e < 0) e = text.length;
    const t1 = text.indexOf('\t', s), t2 = t1 < 0 ? -1 : text.indexOf('\t', t1 + 1);
    if (t1 > s && t2 > t1 && t2 < e) m.set(text.slice(s, t1), [text.slice(t1 + 1, t2), Number(text.slice(t2 + 1, e)) || 0]);
    s = e + 1;
  }
  return m;
}

const score = (lex: Lex, w: string) => {
  const x = lex.get(w);
  if (!x) return w.length === 1 ? -14 : -Infinity;
  return x[1] > 0 ? x[1] / 10 - 9 : w.length === 1 ? -9 : -8.6;
};
/** A run of characters split into dictionary words (most likely split by word frequency). */
export function segment(lex: Lex, run: string): string[] {
  const c = [...run], n = c.length;
  const best = new Array<number>(n + 1).fill(-Infinity), back = new Array<number>(n + 1).fill(0);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === -Infinity) continue;
    for (let len = 1; len <= MAX && i + len <= n; len++) {
      const w = c.slice(i, i + len).join('');
      if (len > 1 && !lex.has(w)) continue;
      const v = best[i] + score(lex, w);
      if (v > best[i + len]) (best[i + len] = v), (back[i + len] = i);
    }
  }
  const out: string[] = [];
  for (let j = n; j > 0; j = back[j]) out.push(c.slice(back[j], j).join(''));
  return out.reverse();
}

/** A piece of text: Chinese words carry their syllables (numbered: "bu2", "shi4"), anything else none. */
export type Tok = { text: string; py?: string[] };
const NUM = /[〇零一二三四五六七八九十百千萬兩幾第]/;
const tone = (s?: string) => Number(s?.slice(-1)) || 5;
const set = (s: string, t: number) => s.replace(/[1-5]$/, String(t));

/** Characters that read two ways standing alone; the rules below settle the usual case. */
const TWO: Record<string, (prev: string, next: string, prevWord: string) => string | null> = {
  // 我得走了 děi; 跑得快, 覺得 (a word) de
  得: (p) => (/^(我|你|他|她|我們|你們|他們|她們|就|還|也|都|總|必須|一定)$/.test(p) ? 'dei3' : 'de5'),
  // 還你錢, 還書 huán; otherwise hái
  還: (_, n) => (/^(給|錢|書|債)|^.(錢|書|債)/.test(n) ? 'huan2' : 'hai2'),
  // 長得高, 長大 zhǎng; 很長 cháng
  長: (_, n) => (/^(得|了|出|高|大|胖|滿|成)/.test(n) ? 'zhang3' : 'chang2'),
  // 慢慢地走 de (after a word of two or more); 在地上 dì
  地: (p, n, pw) => ([...pw].length >= 2 && HAN.test(n) && !/^(在|到|上|下|的)$/.test(p) ? 'de5' : 'di4'),
  // 種樹 zhòng; 這種 zhǒng
  種: (_, n) => (/^(樹|花|菜|田|地|草|豆|稻)/.test(n) ? 'zhong4' : 'zhong3'),
  著: () => 'zhe5',
  了: () => 'le5',
  // particles: the neutral tone, as Taiwan's dictionary writes them after a sentence
  嗎: () => 'ma5',
  呢: () => 'ne5',
  吧: () => 'ba5',
  啊: () => 'a5',
  呀: () => 'ya5',
  啦: () => 'la5',
  嘛: () => 'ma5',
};
/** Left for Claude when one stands alone: no plain rule reads them reliably. */
const HARD = new Set([...'數倒發降似傳參擔藏強曲惡供興冠創縫模削將轉作調處難量']);

export function tokens(lex: Lex, text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(RUN)) {
    if (!HAN.test(m[0])) {
      out.push({ text: m[0] });
      continue;
    }
    for (const w of segment(lex, m[0])) {
      const x = lex.get(w) ?? lex.get(w.replace(/台/g, '臺'));
      let py = x ? x[0].split(' ') : [];
      // a word the dictionary doesn't have: its characters one by one
      if (py.length !== [...w].length) py = [...w].map((c) => lex.get(c)?.[0].split(' ')[0] ?? '');
      out.push({ text: w, py });
    }
  }
  // the rules that need neighbors
  const syl: { ch: string; t: Tok; i: number; alone: boolean; word: string }[] = [];
  for (const t of out) if (t.py) [...t.text].forEach((ch, i) => syl.push({ ch, t, i, alone: t.text.length === 1, word: t.text }));
  syl.forEach((s, k) => {
    const prev = syl[k - 1], next = syl[k + 1];
    const adjacent = (a?: { t: Tok }, b?: { t: Tok }) => !!a && !!b && (a.t === b.t || out.indexOf(b.t) === out.indexOf(a.t) + 1);
    const nx = adjacent(s, next) ? next : undefined, pv = adjacent(prev, s) ? prev : undefined;
    if (s.alone && TWO[s.ch]) {
      const nextText = nx ? syl.slice(k + 1, k + 4).map((x) => x.ch).join('') : '';
      const r = TWO[s.ch](pv?.word ?? '', nextText, pv?.word ?? '');
      if (r) s.t.py![s.i] = r;
    }
    const cur = s.t.py![s.i];
    if (s.ch === '不' && cur === 'bu4' && nx) s.t.py![s.i] = tone(nx.t.py![nx.i]) === 4 ? 'bu2' : 'bu4';
    // (一 at the end of a word, 統一, keeps its tone)
    if (s.ch === '一' && cur === 'yi1' && (s.alone || s.i < [...s.word].length - 1)) {
      // a number or an ordinal keeps yī (第一, 十一, 一月, 一二三); before another syllable it changes
      const numeric = (pv && NUM.test(pv.ch)) || (nx && (NUM.test(nx.ch) || /^[月號日樓點]$/.test(nx.ch)));
      if (!nx || numeric) s.t.py![s.i] = 'yi1';
      else s.t.py![s.i] = [4, 5].includes(tone(nx.t.py![nx.i])) ? 'yi2' : 'yi4';
    }
  });
  return out;
}

/** True when the text has a character that reads two ways and no rule could settle it. */
export function unsure(lex: Lex, text: string) {
  return tokens(lex, text).some((t) => t.py && t.text.length === 1 && HARD.has(t.text));
}

/** "bu2" → "bú", a syllable as it's written (no tone mark for the neutral tone). */
export const mark = (s: string) => (s ? syllableToMarked(s) : '');
/** A word's reading, joined: 東西 → dōngxī, 西安 → xī'ān. */
export const word = (py: string[]) => {
  const w = py.map(mark).reduce((a, s, i) => (i && /^[aeoāáǎàēéěèōóǒò]/.test(s) ? `${a}'${s}` : a + s), '');
  // a name keeps its capital (Táiběi)
  return /^[A-Z]/.test(py[0] ?? '') ? w.charAt(0).toUpperCase() + w.slice(1) : w;
};

const PUNCT: Record<string, string> = { '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '、': ',', '「': '"', '」': '"', '『': '"', '』': '"', '（': '(', '）': ')', '…': '...', '—': '-', '～': '~' };
/** A card's Pinyin field: words joined, particles apart, the first word of each sentence capitalized, the punctuation
 *  in English, line breaks and a leading "- " kept (what the old Claude prompt asked for). */
export function sentence(lex: Lex, text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let out = '', cap = true;
      for (const t of tokens(lex, line)) {
        if (!t.py) {
          const s = [...t.text].map((c) => PUNCT[c] ?? c).join('');
          out += s.replace(/([,.!?:;])(?=\S)/g, '$1 ');
          if (/[.!?]\s*$/.test(s)) cap = true;
          continue;
        }
        let w = word(t.py);
        if (cap) (w = w.charAt(0).toUpperCase() + w.slice(1)), (cap = false);
        out += (out && !/[\s"(\-]$/.test(out) ? ' ' : '') + w;
      }
      return out.replace(/\s+([,.!?:;)])/g, '$1').replace(/ {2,}/g, ' ').trim();
    })
    .join('\n');
}
