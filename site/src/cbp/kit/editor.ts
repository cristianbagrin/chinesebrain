/* The one rich-text editor for a card's fields: the Cards page's Add (plus/review.js) and the Reviews tab's Edit, in a
   dialog or in Browse (review/main.ts), both use this, so the two can't drift apart again.
   The way Ten Dollar Words does it (app/js/editor.js toggleStyle): a field is read into styled characters, a style goes on
   (or, if every character already has it, off) over the selection, and the field is written back as clean HTML: <b>,
   <i>, <u>, and <mark> for the word's mark (a highlight; his note types turn it green, and into the blank on the sentence
   card). No execCommand('bold'): browsers nest and restyle what it makes.

     const ed = EDITOR.attach(root, { field: '.rv-f', changed(f) {…}, files(list, f) {…}, pasted(f) {…} })
       every element matching `field` inside root becomes a field: Cmd+B, Cmd+I, Cmd+U, Cmd+Shift+H (KEYS cd.bold,
       cd.italic, cd.underline, cd.mark) on the selection or on what he types next; its own undo (Cmd+Z, Shift+Cmd+Z, the
       phone's shake and its B / I / U), typing within a second one step; paste and drop cleaned (formatting and
       pictures stay, everything else becomes text); pictures as files go to `files`; on a phone a small B I U H bar
       comes up under a selection.
       ed.snap(f, kind) · ed.undo(f) · ed.redo(f) · ed.forget(f) · ed.toggle(f, 'b'|'i'|'ul'|'hl') · ed.reset()
     EDITOR.clean(html)    pasted HTML made safe
     EDITOR.write(pieces)  / EDITOR.toggleRange(pieces, a, b, kind)   the pure halves (tests/cbp-editor.test.ts) */

declare const KEYS: { is(e: KeyboardEvent, id: string): boolean };
declare function sfx(name: string): void;
declare const BUS: { on(e: string, f: (...a: any[]) => void): void } | undefined;

export const BIT = { b: 1, i: 2, ul: 4, hl: 8 } as const;
export type Kind = keyof typeof BIT;
export type Piece = { c: string; f: number; s: string } | { br: 1 } | { img: { src: string; from?: string } };
const isChar = (p: Piece | undefined): p is { c: string; f: number; s: string } => !!p && 'c' in p;

const escT = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isSp = (p: Piece | undefined) => isChar(p) && (p.c === ' ' || p.c === '\u00a0');
const edge = (p: Piece | undefined) => !p || 'br' in p;
/** A space as HTML keeps it: a plain space between words (so lines can wrap), &nbsp; only where HTML would swallow it
 *  (at a line's start or end, or after another space). */
const hardSpace = (out: Piece[], k: number) => edge(out[k - 1]) || edge(out[k + 1]) || isSp(out[k - 1]);
const escA = (t: string) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Pieces back to HTML: runs of one style each, the tags always in the same order (b > i > u > mark). */
export function write(out: Piece[]): string {
  let h = '', i = 0;
  while (i < out.length) {
    const p = out[i];
    if ('br' in p) (h += '<br>'), i++;
    else if ('img' in p) (h += `<img src="${escA(p.img.src)}"${p.img.from ? ` data-from="${escA(p.img.from)}"` : ''}>`), i++;
    else {
      let t = '';
      for (let q = out[i]; i < out.length && isChar(q) && q.f === p.f && q.s === p.s; q = out[++i]) t += isSp(q) ? (hardSpace(out, i) ? '\u0001' : ' ') : q.c;
      t = escT(t).replace(/\u0001/g, '&nbsp;');
      if (p.f & BIT.hl) t = `<mark>${t}</mark>`;
      if (p.f & BIT.ul) t = `<u>${t}</u>`;
      if (p.f & BIT.i) t = `<i>${t}</i>`;
      if (p.f & BIT.b) t = `<b>${t}</b>`;
      if (p.s) t = `<span style="${escA(p.s)}">${t}</span>`;
      h += t;
    }
  }
  return h;
}

/** A style on (or, if every character in a..b already has it, off) over those characters. Spaces don't count. */
export function toggleRange(out: Piece[], a: number, b: number, kind: Kind): Piece[] {
  const bit = BIT[kind];
  if (a > b) [a, b] = [b, a];
  const run = out.slice(a, b);
  const all = run.every((p) => !isChar(p) || !/\S/.test(p.c) || p.f & bit);
  return out.map((p, k) => (k >= a && k < b && isChar(p) ? { ...p, f: all ? p.f & ~bit : p.f | bit } : p));
}

// ---------- the DOM side ----------
const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE)$/;
type Map_ = { out: Piece[]; at: Map<Node, number>; end: Map<Node, number> };
/** The field as pieces, one per UTF-16 unit of text, a line break or a picture; `at` and `end` say where each node
 *  starts and ends among them. A block (what Enter makes) starts a new line. */
function read(f: HTMLElement): Map_ {
  const out: Piece[] = [], at = new Map<Node, number>(), end = new Map<Node, number>();
  const walk = (node: Node, fl: number, sty: string) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        at.set(n, out.length);
        const v = n.nodeValue ?? '';
        for (let k = 0; k < v.length; k++) out.push({ c: v[k], f: fl, s: sty });
      } else if (n.nodeType === 1) {
        const el = n as HTMLElement, t = el.tagName;
        const last = out[out.length - 1];
        if (BLOCK.test(t) && out.length && !(last && 'br' in last)) out.push({ br: 1 });
        at.set(n, out.length);
        if (t === 'BR') out.push({ br: 1 });
        else if (t === 'IMG') out.push({ img: { src: el.getAttribute('src') ?? '', from: el.dataset.from } });
        else {
          let f2 = fl, s2 = sty;
          const st = el.style;
          if (t === 'B' || t === 'STRONG' || +st?.fontWeight >= 600 || st?.fontWeight === 'bold') f2 |= BIT.b;
          if (t === 'I' || t === 'EM' || st?.fontStyle === 'italic') f2 |= BIT.i;
          if (t === 'U' || /underline/.test(st?.textDecorationLine || st?.textDecoration || '')) f2 |= BIT.ul;
          if (t === 'MARK') f2 |= BIT.hl;
          if (st?.color || st?.backgroundColor) s2 = [st.color && `color:${st.color}`, st.backgroundColor && `background-color:${st.backgroundColor}`].filter(Boolean).join(';');
          walk(el, f2, s2);
        }
      }
      end.set(n, out.length);
    }
  };
  walk(f, 0, '');
  return { out, at, end };
}
function index(f: HTMLElement, m: Map_, node: Node, off: number) {
  if (node.nodeType === 3) return (m.at.get(node) ?? 0) + off;
  const kids = node.childNodes;
  if (off < kids.length) return m.at.get(kids[off]) ?? 0;
  return node === f ? m.out.length : m.end.get(node) ?? m.out.length;
}
function selOf(f: HTMLElement): [number, number] | null {
  const s = getSelection();
  if (!s || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!f.contains(r.startContainer) || !f.contains(r.endContainer)) return null;
  const m = read(f);
  return [index(f, m, r.startContainer, r.startOffset), index(f, m, r.endContainer, r.endOffset)];
}
function point(f: HTMLElement, i: number): [Node, number] {
  const m = read(f);
  for (const [n, a] of m.at) if (n.nodeType === 3 && i >= a && i <= a + (n.nodeValue ?? '').length) return [n, i - a];
  for (const [n, a] of m.at) if (n.nodeType === 1 && a === i && /^(BR|IMG)$/.test((n as Element).tagName)) return [n.parentNode!, [...n.parentNode!.childNodes].indexOf(n as ChildNode)];
  return [f, f.childNodes.length];
}
function select(f: HTMLElement, a: number, b = a) {
  const r = document.createRange();
  try {
    r.setStart(...point(f, a));
    r.setEnd(...point(f, b));
  } catch {
    return;
  }
  const s = getSelection();
  s?.removeAllRanges();
  s?.addRange(r);
}

// ---------- pasted things, made safe (formatting and pictures stay, everything else becomes text) ----------
const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'BR', 'DIV', 'P', 'SPAN', 'IMG', 'UL', 'OL', 'LI', 'SUB', 'SUP', 'FONT']);
const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT', 'SVG', 'NOSCRIPT', 'TEMPLATE']);
export function clean(html: string): string {
  const t = document.createElement('template');
  t.innerHTML = html;
  (function walk(node: Node) {
    for (const n of [...node.childNodes]) {
      if (n.nodeType === 8) n.remove();
      if (n.nodeType !== 1) continue;
      const el = n as HTMLElement;
      if (DROP.has(el.tagName)) {
        el.remove();
        continue;
      }
      walk(el);
      if (!KEEP.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      const src = el.tagName === 'IMG' ? (el.getAttribute('src') || '').replace(location.origin + '/api/plus/media/', '/api/plus/media/') : '';
      const color = el.style?.color, bg = el.style?.backgroundColor, fw = el.style?.fontWeight, ul = /underline/.test(el.style?.textDecorationLine || el.style?.textDecoration || '');
      for (const a of [...el.attributes]) el.removeAttribute(a.name);
      if (el.tagName === 'IMG') {
        if (/^(https:|data:image\/|blob:|\/api\/plus\/media\/)/.test(src)) el.setAttribute('src', src);
        else el.remove();
      }
      if (color) el.style.color = color;
      if (bg) el.style.backgroundColor = bg;
      if (fw && +fw >= 600) el.style.fontWeight = 'bold';
      if (ul && el.tagName === 'SPAN') el.style.textDecoration = 'underline'; // read as <u>
    }
  })(t.content);
  return t.innerHTML;
}

// ---------- the phone's bar: a selection in any field brings up B I U H under it (no toolbar the rest of the time) ----------
type Ed = ReturnType<typeof attach>;
const ROOTS: { root: HTMLElement; sel: string; ed: Ed }[] = [];
let FMT: HTMLElement | null = null;
const TOUCH = () => matchMedia('(pointer:coarse)').matches;
function fieldOf(n: Node | null | undefined) {
  const el = n && (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement);
  for (const R of ROOTS) {
    const f = el?.closest<HTMLElement>(R.sel);
    if (f && R.root.contains(f) && R.root.isConnected) return { f, ed: R.ed };
  }
  return null;
}
function placeFmt() {
  if (!FMT) return;
  const s = getSelection(), r = s && s.rangeCount ? s.getRangeAt(0) : null;
  const hit = r && !s!.isCollapsed ? fieldOf(r.commonAncestorContainer) : null;
  if (!TOUCH() || !hit || !hit.f.offsetParent) return void ((FMT.hidden = true), (FMT as any)._f = null);
  (FMT as any)._f = hit;
  // a modal dialog (the Reviews editor) is the top layer: the bar has to sit inside it to be seen and pressed
  const home = hit.f.closest('dialog') ?? document.body;
  if (FMT.parentElement !== home) home.appendChild(FMT);
  FMT.hidden = false;
  const rect = r!.getBoundingClientRect(), vv = visualViewport, top = vv ? vv.offsetTop : 0, h = vv ? vv.height : innerHeight;
  const w = FMT.offsetWidth, bh = FMT.offsetHeight;
  // under the selection (the phone's own menu sits above it); above it when there's no room left over the keyboard
  let y = rect.bottom + 14;
  if (y + bh > top + h - 8) y = rect.top - bh - 14;
  FMT.style.left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + 'px';
  FMT.style.top = Math.max(top + 8, y) + 'px';
}
function fmtBar() {
  if (FMT) return;
  FMT = document.createElement('div');
  FMT.className = 'rv-fmt';
  FMT.hidden = true;
  FMT.innerHTML = '<button type="button" data-k="b" aria-label="Bold"><b>B</b></button><button type="button" data-k="i" aria-label="Italic"><i>I</i></button><button type="button" data-k="ul" aria-label="Underline"><u>U</u></button><button type="button" data-k="hl" aria-label="Highlight"><span>H</span></button>';
  document.body.appendChild(FMT);
  // a press on the bar keeps the selection (no focus moves to the button)
  FMT.addEventListener('pointerdown', (e) => e.preventDefault());
  FMT.addEventListener('mousedown', (e) => e.preventDefault());
  FMT.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]'), hit = (FMT as any)._f as { f: HTMLElement; ed: Ed } | null;
    if (!b || !hit) return;
    hit.ed.toggle(hit.f, b.dataset.k as Kind);
    sfx('tap');
    placeFmt();
  });
  document.addEventListener('selectionchange', () => requestAnimationFrame(placeFmt));
  visualViewport?.addEventListener('resize', () => FMT!.hidden || placeFmt());
  visualViewport?.addEventListener('scroll', () => FMT!.hidden || placeFmt());
  if (typeof BUS !== 'undefined') BUS.on('view', () => FMT && (FMT.hidden = true));
}

export type Opts = {
  /** the fields inside root (a selector) */
  field: string;
  /** after any change the editor itself made (a style, undo, redo, a paste or drop) and after typing */
  changed?: (f: HTMLElement) => void;
  /** picture files pasted or dropped: put them in at the caret; true when it took them */
  files?: (files: File[], f: HTMLElement) => boolean;
  /** after a paste or drop of HTML: pictures in it can be kept on the site now */
  pasted?: (f: HTMLElement) => void;
};
/** The listeners of each root's attach: attaching the same root again (Browse's Note closed and opened again) replaces
 *  them, so a paste never goes in twice and Cmd+B never toggles twice. */
const ATTACHED = new WeakMap<HTMLElement, AbortController>();
export function attach(root: HTMLElement, o: Opts) {
  ATTACHED.get(root)?.abort();
  const ac = new AbortController();
  ATTACHED.set(root, ac);
  const on = <K extends keyof HTMLElementEventMap>(type: K, f: (e: HTMLElementEventMap[K]) => void) => root.addEventListener(type, f, { signal: ac.signal });
  const fieldIn = (t: EventTarget | null) => {
    const f = (t as HTMLElement | null)?.closest?.<HTMLElement>(o.field);
    return f && root.contains(f) ? f : null;
  };
  const changed = (f: HTMLElement) => o.changed?.(f);
  // ---- undo, per field ----
  const H = new WeakMap<HTMLElement, { u: { html: string; sel: [number, number] | null }[]; r: { html: string; sel: [number, number] | null }[]; t: number; k: string }>();
  const hist = (f: HTMLElement) => H.get(f) ?? (H.set(f, { u: [], r: [], t: 0, k: '' }), H.get(f)!);
  /** The field as it is, kept before a change. Typing within a second of the last keystroke is one step. */
  function snap(f: HTMLElement | null | undefined, kind: string) {
    if (!f) return;
    const h = hist(f), now = Date.now();
    if (kind === 'type' && h.k === 'type' && now - h.t < 1000) return void (h.t = now);
    h.u.push({ html: f.innerHTML, sel: selOf(f) });
    if (h.u.length > 200) h.u.shift();
    h.r = [];
    h.k = kind;
    h.t = now;
  }
  function step(f: HTMLElement, from: 'u' | 'r', to: 'u' | 'r') {
    const h = hist(f), x = h[from].pop();
    if (!x) return;
    h[to].push({ html: f.innerHTML, sel: selOf(f) });
    h.k = '';
    f.innerHTML = x.html;
    if (x.sel) select(f, ...x.sel);
    changed(f);
  }
  // a style asked for with nothing selected applies to what he types next
  let pend: { f: HTMLElement; at: number; on: number; off: number } | null = null;
  const ed = {
    snap,
    undo: (f: HTMLElement) => step(f, 'u', 'r'),
    redo: (f: HTMLElement) => step(f, 'r', 'u'),
    forget: (f: HTMLElement) => H.delete(f),
    reset: () => (pend = null),
    toggle(f: HTMLElement, kind: Kind) {
      const bit = BIT[kind], sel = selOf(f);
      if (!sel) return;
      let [a, b] = sel;
      if (a > b) [a, b] = [b, a];
      const { out } = read(f);
      if (a === b) {
        const before = out[a - 1], had = isChar(before) ? before.f & bit : 0;
        const p = pend && pend.f === f && pend.at === a ? pend : { f, at: a, on: 0, off: 0 };
        if (p.on & bit) p.on &= ~bit;
        else if (p.off & bit) p.off &= ~bit;
        else if (had) p.off |= bit;
        else p.on |= bit;
        pend = p.on || p.off ? p : null;
        return;
      }
      snap(f, 'format');
      f.innerHTML = write(toggleRange(out, a, b, kind));
      select(f, a, b);
      changed(f);
    },
  };
  function typed(f: HTMLElement) {
    const p = pend;
    if (!p || p.f !== f) return;
    const sel = selOf(f);
    if (!sel || sel[0] !== sel[1] || sel[0] <= p.at) return;
    const { out } = read(f), c = sel[0];
    for (let k = p.at; k < c; k++) {
      const q = out[k];
      if (isChar(q)) q.f = (q.f | p.on) & ~p.off;
    }
    f.innerHTML = write(out);
    select(f, c);
    pend = null;
  }
  on('beforeinput', (e) => {
    const f = fieldIn(e.target);
    if (!f) return;
    const t = e.inputType || '';
    if (t === 'historyUndo' || t === 'historyRedo') {
      e.preventDefault();
      return t === 'historyUndo' ? ed.undo(f) : ed.redo(f);
    }
    // the phone's own B / I / U (in its selection menu) do what the shortcuts do; no other styling from the browser
    const fm = ({ formatBold: 'b', formatItalic: 'i', formatUnderline: 'ul' } as Record<string, Kind>)[t];
    if (fm || t.startsWith('format')) {
      e.preventDefault();
      if (fm) ed.toggle(f, fm);
      return;
    }
    if (t === 'insertCompositionText') return;
    snap(f, /^(insertText|deleteContent(Backward|Forward))$/.test(t) ? 'type' : 'edit');
  });
  on('compositionstart', (e) => snap(fieldIn(e.target), 'type'));
  on('compositionend', (e) => {
    const f = fieldIn(e.target);
    if (f) setTimeout(() => (typed(f), changed(f)));
  });
  on('input', (e) => {
    const f = fieldIn(e.target);
    if (f && !(e as InputEvent).isComposing && pend) typed(f);
  });
  on('pointerdown', () => (pend = null));
  on('focusout', () => (pend = null));
  on('keydown', (e) => {
    const f = fieldIn(e.target);
    if (!f) return;
    // Cmd+B, Cmd+I, Cmd+U, Cmd+Shift+H (the word's mark): on the selection, or on what he types next
    const fmt = ([['cd.bold', 'b'], ['cd.italic', 'i'], ['cd.underline', 'ul'], ['cd.mark', 'hl']] as const).find(([id]) => KEYS.is(e, id));
    if (fmt) {
      e.preventDefault();
      e.stopPropagation();
      ed.toggle(f, fmt[1]);
      return;
    }
    // the fields keep their own undo (typing and formatting alike), so the page's Cmd+Z stays out of them
    if (KEYS.is(e, 'undo') || KEYS.is(e, 'redo')) {
      e.preventDefault();
      e.stopPropagation();
      KEYS.is(e, 'redo') ? ed.redo(f) : ed.undo(f);
      return;
    }
    if (/^(Arrow|Home|End|Page)/.test(e.key)) pend = null;
  });
  on('paste', (e) => {
    const f = fieldIn(e.target);
    if (!f) return;
    e.preventDefault();
    snap(f, 'edit');
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length && o.files?.(files, f)) return changed(f);
    const html = e.clipboardData?.getData('text/html');
    if (html) document.execCommand('insertHTML', false, clean(html));
    else document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
    o.pasted?.(f);
    changed(f);
  });
  on('drop', (e) => {
    const f = fieldIn(e.target);
    if (!f) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    snap(f, 'edit');
    if (!files.length) {
      // HTML from another page (or the strip of pictures): the browser drops it where the pointer is; cleaned after
      setTimeout(() => {
        f.innerHTML = clean(f.innerHTML);
        o.pasted?.(f);
        changed(f);
      });
      return;
    }
    e.preventDefault();
    const pos = (document as any).caretRangeFromPoint?.(e.clientX, e.clientY) as Range | null;
    f.focus();
    if (pos) {
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(pos);
    }
    if (o.files?.(files, f)) changed(f);
  });
  fmtBar();
  for (let i = ROOTS.length - 1; i >= 0; i--) if (ROOTS[i].root === root) ROOTS.splice(i, 1);
  ROOTS.push({ root, sel: o.field, ed });
  // roots that left the page are let go
  for (let i = ROOTS.length - 1; i >= 0; i--) if (!ROOTS[i].root.isConnected && ROOTS[i].root !== root) ROOTS.splice(i, 1);
  return ed;
}

export const EDITOR = { attach, clean, write, toggleRange, BIT };
