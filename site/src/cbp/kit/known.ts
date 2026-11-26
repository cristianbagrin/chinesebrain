/* Which words he knows, for the places that show pinyin only over new words (the Essays tips first).
   The source is the board's card kit (db board/cardkit, written each night by nightly.ts from known-words.txt with
   E.kit): `known` is every K word, space-separated, and `chars` the single known characters. known-words.txt is the
   system's own list (a word turns K after three situations of correct use, and Chinese Brain's marks come in every
   night), so it is the most complete and the one every other part of CBP already trusts. L (learning) words still get
   their pinyin.

     KNOWN.of(kit)            the set, built once per kit object
     KNOWN.needsPinyin(w, s)  false for a known word, for a single known character, and for anything with no Chinese */
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
export type Kit = { known?: string; chars?: string } | null | undefined;
export type KnownSet = { words: Set<string>; chars: Set<string> };

const cache = new WeakMap<object, KnownSet>();
export function of(kit: Kit): KnownSet {
  if (!kit) return { words: new Set(), chars: new Set() };
  let s = cache.get(kit);
  if (!s) {
    s = { words: new Set(String(kit.known ?? '').split(/\s+/).filter(Boolean)), chars: new Set([...String(kit.chars ?? '')].filter((c) => HAN.test(c))) };
    cache.set(kit, s);
  }
  return s;
}
export function needsPinyin(word: string, s: KnownSet): boolean {
  const w = String(word ?? '').trim();
  if (!HAN.test(w)) return false;
  if (s.words.has(w)) return false;
  const han = [...w].filter((c) => HAN.test(c));
  return !(han.length === 1 && (s.chars.has(han[0]) || s.words.has(han[0])));
}
export const KNOWN = { of, needsPinyin };
