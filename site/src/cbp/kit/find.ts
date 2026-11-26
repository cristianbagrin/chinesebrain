/* Settings' search (settings.ts): what he typed, split into words; a row matches when every word is somewhere in it (its
   label, its options, its section's name), in any order, upper or lower case. The words found are marked in the label. */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The words of a search, lowercased, without repeats. */
export const words = (q: string) => [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))];

/** Does every word appear in one of these texts (taken together)? No words: everything matches. */
export function hit(ws: string[], ...texts: string[]) {
  const hay = texts.join('\n').toLowerCase();
  return ws.every((w) => hay.includes(w));
}

/** The text as HTML, each place a word is found wrapped in <mark>; overlapping finds become one mark. */
export function marked(text: string, ws: string[]) {
  const low = text.toLowerCase();
  const on = new Uint8Array(text.length);
  for (const w of ws)
    for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) on.fill(1, i, i + w.length);
  let out = '';
  for (let i = 0; i < text.length; ) {
    let j = i;
    while (j < text.length && on[j] === on[i]) j++;
    const part = esc(text.slice(i, j));
    out += on[i] ? `<mark>${part}</mark>` : part;
    i = j;
  }
  return out;
}
