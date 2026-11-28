// Paste into the browser console on any /plus page (or run it with the browser tools) before calling UI work done.
// It lists every visible control whose text isn't centered in its box, and every input whose placeholder is drawn in a
// different size from the input itself (that placeholder sits on the bigger font's baseline: low in the box).
// Each row: [what, element, numbers]. An empty list is a pass. Text inside a sentence (a highlighted word) can show up
// as a false alarm: judge those by eye.
(() => {
  const out = [];
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  for (const e of document.querySelectorAll('input,textarea,button,[role=tab],[role=button],a.btn,.btn,.btn-q')) {
    if (!vis(e)) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (e.matches('input,textarea')) {
      if (e.tagName === 'TEXTAREA') continue;
      const ph = getComputedStyle(e, '::placeholder');
      if (e.placeholder && !e.value && ph.fontSize !== cs.fontSize) out.push(['placeholder size ≠ input', e.className || e.placeholder, ph.fontSize, cs.fontSize]);
      if (Math.abs(parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) > 1) out.push(['uneven vertical padding', e.className || e.placeholder, cs.paddingTop, cs.paddingBottom]);
      continue;
    }
    const tw = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && n.parentElement.checkVisibility() ? 1 : 2) });
    let n, top = Infinity, bot = -Infinity;
    while ((n = tw.nextNode())) { const g = document.createRange(); g.selectNodeContents(n); for (const q of g.getClientRects()) if (q.height >= 2) { top = Math.min(top, q.top); bot = Math.max(bot, q.bottom); } }
    if (top === Infinity || r.height > 70) continue;
    const gt = top - (r.top + parseFloat(cs.borderTopWidth)), gb = r.bottom - parseFloat(cs.borderBottomWidth) - bot;
    if (Math.abs(gt - gb) > 2.5) out.push([`text off center by ${(gt - gb).toFixed(1)}px`, `${e.className || e.tagName} | ${e.textContent.trim().slice(0, 16)}`, Math.round(r.height)]);
  }
  console.table(out);
  return out;
})();
