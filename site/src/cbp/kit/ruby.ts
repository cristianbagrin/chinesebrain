/* Pinyin above the characters, as <ruby>, the way Chinese Brain shows it over YouTube subtitles (src/youtube/index.ts):
   each character in a <ruby> with its syllable in <rt>, words kept together, toned the Taiwan way (pinyin.ts).
   The lexicon (/plus/pinyin.txt, ~0.9 MB) loads the first time it's needed and is kept offline by plus/sw.js.

     await RUBY.on(el)          every bit of Chinese inside el gets its pinyin on top (text in inputs, <rt> and
                                [data-noruby] is left alone); safe to call again after el changes
     RUBY.off(el)               the plain text back, exactly as it was
     await RUBY.set(el, on)     either of the two
     await RUBY.html(text)      the same for a string: escaped HTML with the ruby in it
     RUBY.shown()               the global choice (Settings › Pinyin shown): pages start with pinyin on when true
     RUBY.CSS                   the styles, for a shadow root (the review card); the page has them in kit.css

   Per page, a toggle (Reviews' P, the Cards sentence hold) calls RUBY.set on its own element. */
import { parseLex, tokens, mark, type Lex } from '../pinyin.ts';

declare const LAB: { get(id: string): string | null };
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
let lex: Promise<Lex> | null = null;
export const LEX_URL = '/plus/pinyin.txt?v=1';
function load() {
  return (lex ??= fetch(LEX_URL)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error('pinyin'))))
    .then(parseLex)
    .catch((e) => ((lex = null), Promise.reject(e))));
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function frag(L: Lex, text: string): string {
  return tokens(L, text)
    // one syllable over each character, so the line keeps an even rhythm; a word stays together (one span, no break)
    .map((t) => (t.py && t.py.every(Boolean) ? `<span class="rbw">${[...t.text].map((c, i) => `<ruby>${esc(c)}<rt>${esc(mark(t.py![i]).toLowerCase())}</rt></ruby>`).join('')}</span>` : esc(t.text)))
    .join('');
}

/** Text drawn invisible (a card's blank before the answer shows) gets no pinyin: it would give the answer away. */
function hidden(el: Element | null) {
  if (!el) return false;
  const cs = getComputedStyle(el);
  return cs.visibility === 'hidden' || cs.color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(cs.color) || Number(cs.opacity) === 0;
}
const SKIP = 'rt,rp,script,style,textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[data-noruby],.rb';
async function on(el: Element | ShadowRoot | null | undefined) {
  if (!el) return;
  const L = await load();
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (HAN.test(n.nodeValue ?? '') && !n.parentElement?.closest(SKIP) && !hidden(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  if (el instanceof Element) el.classList.add('rb-on');
  const list: Text[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n as Text);
  for (const n of list) {
    const s = document.createElement('span');
    s.className = 'rb';
    s.dataset.t = n.nodeValue ?? '';
    s.innerHTML = frag(L, n.nodeValue ?? '');
    n.replaceWith(s);
  }
}
function off(el: Element | ShadowRoot | null | undefined) {
  el?.querySelectorAll<HTMLElement>('span.rb').forEach((s) => s.replaceWith(document.createTextNode(s.dataset.t ?? '')));
  if (el instanceof Element) el.classList.remove('rb-on');
}

export const RUBY = {
  on,
  off,
  set: (el: Element | ShadowRoot | null | undefined, show: boolean) => (show ? on(el) : (off(el), Promise.resolve())),
  html: async (text: string) => frag(await load(), text),
  shown: () => LAB.get('pinyin') === 'on',
  ready: load,
  CSS: '.rb-on.rb-on{line-height:2.1}.rbw{white-space:nowrap}ruby{ruby-position:over;ruby-align:center;margin:0 .08em}rt{font-family:Inter,system-ui,sans-serif;font-size:max(.45em,var(--fs-xs,13.8px));font-weight:450;letter-spacing:0;color:#757B87;opacity:.8;-webkit-text-stroke:0;line-height:1.1}',
};

// Cards: a word's or a sentence's reading as plain text ("fànshòu"), from the same code, for the study card's head
import { sentence as pyLine } from '../pinyin.ts';
Object.assign(RUBY, { text: async (t: string) => pyLine(await load(), t) });
// (end Cards)
