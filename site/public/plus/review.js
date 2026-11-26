/* Chinese Brain Plus: the card he adds, beside the study card on the Cards page (Stage 3). /plus only: it hooks into the
   board's Cards page (plus/board/js/cards.js, copied from life/chinese/board) and fills its side column (.cd-side).
   His Anki note type "Chinese", as an editor that behaves like Anki's: every field takes anything (Cmd+B, Cmd+I, Cmd+U,
   Cmd+Shift+H marks the word as a highlight, <mark>, which his note types turn green and blank out on the sentence
   card; on a phone a small bar comes up over a
   selection; pictures pasted, dropped or dragged in from anywhere, as many as he likes). Fields: Sentence, Word (shown
   while Option's extras are on, or once he has changed it), Picture, Notes; Pinyin is done for him from the sentence
   (src/cbp/cards.ts pinyin) and never shown; Audio is made on the server whenever a note is saved (cards.ts voiced),
   and V plays it (made then if it isn't yet).
   A word can have several cards (notes/<card id>, then notes/<card id>.2, .3…): their numbers show above the fields
   once the first is added, + starts another. Add: a press adds and moves on to the next word, a hold (or
   Cmd+Enter) adds and stays, with the next card for the same word ready.
   Pictures to choose from sit in one strip under the fields: drawings in his flashcard style, then photos from
   Wikimedia Commons (straight from Commons, so they show fast); a click puts one in Picture (again takes it out), a drag
   puts it anywhere. "More images" finds more photos, "More drawings" draws two more. A picture in a field is picked with a
   click (Backspace takes it out) and dragged to move it.
   Add (the button, Shift+Cmd+Enter, or the board's Enter) keeps every picture on the site, saves db
   `notes/<card id>` and cards the word. Unsaved fields survive a reload (localStorage, per word). Until reviews move
   here (Stage 4), the Mac's nightly hands new notes to Anki (scripts/cbp-push.py --anki). */
(() => {
  const RV = { notes: {}, st: {}, pics: {}, busy: {}, saving: false, shown: '', kept: {}, pending: new Set(), slot: {} };
  // a word's cards: the first is notes/<card id> (as before), the next ones notes/<card id>.2, .3…
  const noteId = (w, n) => (n > 1 ? `${cardId(w)}.${n}` : cardId(w));
  const notesOf = (w) => {
    const id = cardId(w), out = [];
    for (const k of Object.keys(RV.notes)) {
      if (k === id) out.push(1);
      else if (k.startsWith(id + '.') && /^\d+$/.test(k.slice(id.length + 1))) out.push(+k.slice(id.length + 1));
    }
    return out.sort((a, b) => a - b);
  };
  const slotOf = (w) => RV.slot[w] || 1;
  const FIELDS = [['chinese', 'Sentence'], ['word', 'Word'], ['mnemonic', 'Mnemonic'], ['picture', 'Picture'], ['notes', 'Notes']];
  // his three note types (Anki's names): Phrase makes only the picture → phrase card; Radical has a Mnemonic, no Word
  // His three note types (the switch comes up with Option, like the Word field): a Word (almost always) is a sentence
  // with the word marked, three cards; a Phrase is something said whole and is for no one word (no Word field), one
  // card, picture → the phrase, so it needs a picture; a Radical is a character part with its story.
  // which model does which job (Settings › AI: 'pinyin-model', 'idea-model', 'draw-model', kit/settings.ts)
  const modelId = (id) => `claude-${LAB.get(id)}-5-5`;
  const TYPES = [['Chinese', 'Word'], ['Chinese phrases', 'Phrase'], ['Chinese radicals', 'Radical']];
  const token = () => {
    try {
      return localStorage.getItem('cb-token') ?? '';
    } catch {
      return '';
    }
  };
  const call = async (path, body) => {
    const r = await fetch('/api/plus/' + path, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'It didn’t come through.'), { code: j.code });
    return j;
  };
  const say = (msg, act) => {
    hideToast(true);
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${esc(msg)}</span>${act ? `<button type="button">${esc(act[0])}</button>` : ''}`;
    if (act) el.querySelector('button').onclick = () => (hideToast(), act[1]());
    document.body.appendChild(el);
    TOAST = { el, t: setTimeout(hideToast, 5000) };
  };
  const plain = (html) => {
    const t = document.createElement('div');
    t.innerHTML = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n');
    t.querySelectorAll('img').forEach((i) => i.remove());
    return t.textContent.replace(/\n{2,}/g, '\n').trim();
  };
  // a draft per card: the first card's key is the word's (as before), the next ones add #2, #3…
  const draftKey = (w, n = slotOf(w)) => 'cbp-draft:' + w + (n > 1 ? '#' + n : '');
  const draft = {
    get(w, n) {
      try {
        const d = JSON.parse(localStorage.getItem(draftKey(w, n)) || 'null');
        return d && d.v === 1 ? d : null;
      } catch {
        return null;
      }
    },
    set(w, st) {
      try {
        localStorage.setItem(draftKey(w, st.n), JSON.stringify({ v: 1, at: Date.now(), ...Object.fromEntries(FIELDS.map(([k]) => [k, st[k]])), audio: st.audio, audioFor: st.audioFor, type: st.type }));
      } catch {}
    },
    drop(w, n) {
      try {
        localStorage.removeItem(draftKey(w, n));
      } catch {}
    },
  };

  // drafts nobody came back to in 30 days go (like the server's media sweep, cards.clean)
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith('cbp-draft:')) continue;
      const d = JSON.parse(localStorage.getItem(k) || 'null');
      if (!d || d.v !== 1 || (d.at && Date.now() - d.at > 30 * 864e5)) localStorage.removeItem(k);
    }
  } catch {}

  // ---------- what goes in the fields ----------
  const strip = (s) => String(s || '').replace(/^[AB]\s*[：:]\s*/, '').replace(/\*\*/g, '').trim();
  /** A sentence of the study card: one line per speaker ("- " in front), the word marked. */
  function fromSentence(s, w) {
    const zs = turnsOf(s.zh), ps = turnsOf(s.py);
    const pre = zs.length > 1 ? '- ' : '';
    return { chinese: CD_sentCopy(zs, w).html, py: ps.map((p) => pre + strip(p)).join('\n') };
  }
  /** The card on screen for a word (its slot n): saved, a draft, or new from the study card. */
  function state(w, k = slotOf(w)) {
    const id = noteId(w, k);
    if (RV.st[id]) return RV.st[id];
    const n = RV.notes[id];
    if (n) {
      // the first notes (2026-11-21) kept the picture as one address and the notes as plain text
      const picture = /^\/api\/plus\/media\/[^<\s]+$/.test(n.picture || '') ? `<img src="${esc(n.picture)}">` : n.picture || '';
      const notes = /</.test(n.notes || '') ? n.notes : esc(n.notes || '').replace(/\n/g, '<br>');
      return (RV.st[id] = { n: k, chinese: n.chinese || '', word: n.word || w, mnemonic: n.mnemonic || '', type: n.type || 'Chinese', picture, notes, audio: n.audio || '', audioFor: n.audioFor || (n.audio ? plain(n.chinese || '') : ''), py: n.pinyin || '', pyFor: n.pinyin ? plain(n.chinese || '') : '', saved: true });
    }
    const d = cardOf(w);
    if (!cardOK(d)) return null;
    // the first card takes the study card's first sentence; another card the first one no card of the word has yet
    const c = parseCard(d.text), used = new Set(notesOf(w).map((x) => plain(RV.notes[noteId(w, x)].chinese || '')));
    let s = [...c.mine, ...c.ex].map((x) => fromSentence(x, c.word || w)).find((x) => !used.has(plain(x.chinese))) || { chinese: '', py: '' };
    // Reviews: a pair card (Combine on the Reviews tab, "A、B"): both sentences, each with its own word marked
    const pair = String(c.word || w).split('、');
    if (pair.length > 1 && c.ex.length > 1 && !used.size) {
      const ss = c.ex.map((x) => fromSentence(x, pair.find((p) => String(x.zh).includes(p)) || ''));
      s = { chinese: ss.map((x) => x.chinese).join('<br>'), py: ss.map((x) => x.py).join('\n') };
    }
    const st = { n: k, chinese: s.chinese, word: esc(c.word || w), mnemonic: '', type: 'Chinese', picture: '', notes: '', audio: '', audioFor: '', py: s.py, pyFor: s.py ? plain(s.chinese) : '', saved: false };
    const dr = draft.get(w, k);
    if (dr) Object.assign(st, Object.fromEntries(FIELDS.map(([f]) => [f, dr[f] ?? st[f]])), { audio: dr.audio || '', audioFor: dr.audioFor || '', type: dr.type || st.type, dirty: true });
    return (RV.st[id] = st);
  }

  // ---------- pasted things, made safe (formatting and pictures stay, everything else becomes text) ----------
  const KEEP = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'MARK', 'BR', 'DIV', 'P', 'SPAN', 'IMG', 'UL', 'OL', 'LI', 'SUB', 'SUP', 'FONT']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT', 'SVG', 'NOSCRIPT', 'TEMPLATE']);
  function clean(html) {
    const t = document.createElement('template');
    t.innerHTML = html;
    (function walk(node) {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 8) n.remove();
        if (n.nodeType !== 1) continue;
        if (DROP.has(n.tagName)) {
          n.remove();
          continue;
        }
        walk(n);
        if (!KEEP.has(n.tagName)) {
          n.replaceWith(...n.childNodes);
          continue;
        }
        const src = n.tagName === 'IMG' ? (n.getAttribute('src') || '').replace(location.origin + '/api/plus/media/', '/api/plus/media/') : '';
        const color = n.style?.color, bg = n.style?.backgroundColor, fw = n.style?.fontWeight, ul = /underline/.test(n.style?.textDecorationLine || n.style?.textDecoration || '');
        for (const a of [...n.attributes]) n.removeAttribute(a.name);
        if (n.tagName === 'IMG') {
          if (/^(https:|data:image\/|blob:|\/api\/plus\/media\/)/.test(src)) n.setAttribute('src', src);
          else n.remove();
        }
        if (color) n.style.color = color;
        if (bg) n.style.backgroundColor = bg;
        if (fw && +fw >= 600) n.style.fontWeight = 'bold';
        if (ul && n.tagName === 'SPAN') n.style.textDecoration = 'underline'; // the editor reads it as <u>
      }
    })(t.content);
    return t.innerHTML;
  }
  const kept = (html) => String(html).replace(/src="([^"]+)"/g, (m, s) => (RV.kept[s.replace(/&amp;/g, '&')] ? `src="${esc(RV.kept[s.replace(/&amp;/g, '&')])}"` : m));
  /** Every picture in a field that isn't on the site yet goes there now (in the background); its address swaps in. */
  function keepPictures(root) {
    root.querySelectorAll('img').forEach((im) => {
      const src = im.getAttribute('src') || '';
      if (/^\/api\/plus\/media\//.test(src) || RV.kept[src]) {
        if (RV.kept[src]) im.setAttribute('src', RV.kept[src]);
        return;
      }
      if (RV.pending.has(src) || /^blob:/.test(src)) return;
      const job = (async () => {
        let url;
        if (/^data:/.test(src)) {
          const b = await (await fetch(src)).blob();
          url = await upload(b);
        } else url = (await call('grab', { url: src })).url;
        RV.kept[src] = url;
      })()
        .catch((e) => {
          console.error(e);
          say('A picture couldn’t be kept: it was taken out.');
          RV.kept[src] = '';
        })
        .finally(() => {
          RV.pending.delete(src);
          RV.jobs.delete(job);
          settle();
        });
      RV.pending.add(src);
      RV.jobs.add(job);
    });
  }
  RV.jobs = new Set();
  /** Swap kept addresses into the fields on screen and in every word's state; drop pictures that failed. */
  function settle() {
    EL.querySelectorAll('.rv-f img').forEach((im) => {
      const k = RV.kept[im.getAttribute('src')];
      if (k === '') im.remove();
      else if (k) im.setAttribute('src', k);
    });
    for (const st of Object.values(RV.st)) for (const [k] of FIELDS) st[k] = kept(st[k]).replace(/<img src=""[^>]*>/g, '');
    if (CD.cur && RV.shown === CD.cur) readFields();
  }
  async function upload(blob) {
    const r = await fetch('/api/plus/upload', { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': blob.type }, body: blob });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j.url;
  }
  /** Files dropped or pasted: shown at once, kept in the background. */
  function insertFiles(files) {
    const imgs = [...files].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return false;
    const html = imgs
      .map((f) => {
        const b = URL.createObjectURL(f);
        const job = upload(f)
          .then((u) => (RV.kept[b] = u))
          .catch((e) => {
            console.error(e);
            say('A picture didn’t upload.');
            RV.kept[b] = '';
          })
          .finally(() => {
            RV.jobs.delete(job);
            settle();
          });
        RV.jobs.add(job);
        return `<img src="${b}">`;
      })
      .join('');
    document.execCommand('insertHTML', false, html);
    return true;
  }

  // ---------- the editor ----------
  const EL = document.createElement('section');
  EL.className = 'rv';
  EL.hidden = true;
  EL.innerHTML = `<div class="rv-slots" role="tablist" aria-label="Cards for this word" hidden></div><div class="rv-typebox opt"><div class="rv-type" role="radiogroup" aria-label="Note type">${TYPES.map(([t, l]) => `<button type="button" role="radio" data-rv="type" data-t="${t}" aria-checked="false">${l}</button>`).join('')}</div></div><div class="rv-fields">${FIELDS.map(([k, label]) => `<div class="rv-field rv-${k}${k === 'word' ? ' opt' : ''}"><span class="rv-l" id="rv-l-${k}">${label}</span><div class="rv-f${k === 'chinese' || k === 'word' ? ' zh' : ''}" data-f="${k}" contenteditable="true" spellcheck="false" lang="${k === 'notes' ? 'en' : 'zh-Hant'}" role="textbox" aria-multiline="true" aria-labelledby="rv-l-${k}"></div>${k === 'chinese' ? '<button type="button" class="rv-say" data-rv="say" aria-label="Read it aloud (V)">V</button>' : ''}</div>`).join('')}</div>
  <div class="rv-strip" aria-label="Pictures to choose from"></div>
  <div class="rv-bar"><button type="button" class="rv-add" data-rv="add" data-cardit></button></div>`;
  CD_EL.querySelector('.cd-side').appendChild(EL);
  // a narrow screen (a phone) shows one side at a time: the card, or the card he adds; a switch at the foot flips them
  const NARROW = matchMedia('(max-width:1100px)');
  const SEG = document.createElement('div');
  SEG.className = 'rv-seg';
  SEG.setAttribute('role', 'tablist');
  SEG.innerHTML = '<i aria-hidden="true"></i><button type="button" role="tab" data-pane="card" aria-selected="true">Card</button><button type="button" role="tab" data-pane="add" aria-selected="false">Add</button>';
  // on the page itself, not in the view: a view that slid in keeps a transform, and that would pin it to the view instead
  document.body.appendChild(SEG);
  SEG.hidden = typeof VIEW === 'undefined' || VIEW !== 'cards';
  BUS.on('view', (v) => (SEG.hidden = v !== 'cards'));
  function pane(p) {
    if (CD_EL.dataset.pane === p) return;
    CD_EL.dataset.pane = SEG.dataset.pane = p;
    SEG.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', b.dataset.pane === p));
    if (NARROW.matches) scrollTo({ top: 0 });
  }
  CD_EL.dataset.pane = SEG.dataset.pane = 'card';
  SEG.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pane]');
    if (b) (pane(b.dataset.pane), sfx('tap'));
  });
  // on /plus the strip finds the pictures: DuckDuckGo's Images is there only while Option's extras are on
  CD_EL.querySelector('.cd-img')?.classList.add('opt');
  const $ = (s) => EL.querySelector(s);
  const field = (k) => EL.querySelector(`.rv-f[data-f="${k}"]`);

  // ---------- rich text in the fields, the way Ten Dollar Words does it (app/js/editor.js toggleStyle): the field is read
  // into styled characters, a style goes on (or, if every character already has it, off) over the selection, and the
  // field is written back as clean HTML: <b>, <i>, <u>, and <mark> for the word's mark (a highlight here; his note
  // types turn it green, and into the blank on the sentence card; cards.ts markWord moved the old <u> marks over).
  // No execCommand('bold'): browsers nest and restyle what it makes. The fields keep their own undo, so Cmd+Z steps back through typing and
  // formatting alike. ----------
  const RT = (() => {
    const BIT = { b: 1, i: 2, ul: 4, hl: 8 };
    const BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE)$/;
    /** The field as pieces, one per UTF-16 unit of text ({c, f, s}), a line break ({br}) or a picture ({img}); `at` and
     *  `end` say where each node starts and ends among them. A block (what Enter makes) starts a new line. */
    function read(f) {
      const out = [], at = new Map(), end = new Map();
      const walk = (node, fl, sty) => {
        for (const n of node.childNodes) {
          if (n.nodeType === 3) {
            at.set(n, out.length);
            for (let k = 0; k < n.nodeValue.length; k++) out.push({ c: n.nodeValue[k], f: fl, s: sty });
          } else if (n.nodeType === 1) {
            const t = n.tagName;
            if (BLOCK.test(t) && out.length && !out[out.length - 1].br) out.push({ br: 1 });
            at.set(n, out.length);
            if (t === 'BR') out.push({ br: 1 });
            else if (t === 'IMG') out.push({ img: n });
            else {
              let f2 = fl, s2 = sty;
              const st = n.style;
              if (t === 'B' || t === 'STRONG' || +st?.fontWeight >= 600 || st?.fontWeight === 'bold') f2 |= BIT.b;
              if (t === 'I' || t === 'EM' || st?.fontStyle === 'italic') f2 |= BIT.i;
              if (/underline/.test(st?.textDecorationLine || st?.textDecoration || '')) f2 |= BIT.ul;
              if (t === 'U') f2 |= BIT.ul;
              if (t === 'MARK') f2 |= BIT.hl;
              if (st?.color || st?.backgroundColor) s2 = [st.color && `color:${st.color}`, st.backgroundColor && `background-color:${st.backgroundColor}`].filter(Boolean).join(';');
              walk(n, f2, s2);
            }
          }
          end.set(n, out.length);
        }
      };
      walk(f, 0, '');
      return { out, at, end };
    }
    const escT = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
    /** Pieces back to HTML: runs of one style each, the tags always in the same order. */
    function write(out) {
      let h = '', i = 0;
      while (i < out.length) {
        const p = out[i];
        if (p.br) (h += '<br>'), i++;
        else if (p.img) {
          const im = document.createElement('img');
          im.setAttribute('src', p.img.getAttribute('src') || '');
          if (p.img.dataset.from) im.dataset.from = p.img.dataset.from;
          (h += im.outerHTML), i++;
        } else {
          let t = '';
          for (; i < out.length && out[i].c != null && out[i].f === p.f && out[i].s === p.s; i++) t += out[i].c;
          t = escT(t);
          if (p.f & BIT.hl) t = `<mark>${t}</mark>`;
          if (p.f & BIT.ul) t = `<u>${t}</u>`;
          if (p.f & BIT.i) t = `<i>${t}</i>`;
          if (p.f & BIT.b) t = `<b>${t}</b>`;
          if (p.s) t = `<span style="${p.s}">${t}</span>`;
          h += t;
        }
      }
      return h;
    }
    /** A point in the DOM (a selection's end) → its place among the pieces. */
    function index(f, m, node, off) {
      if (node.nodeType === 3) return (m.at.get(node) ?? 0) + off;
      const kids = node.childNodes;
      if (off < kids.length) return m.at.get(kids[off]) ?? 0;
      return node === f ? m.out.length : m.end.get(node) ?? m.out.length;
    }
    function selOf(f) {
      const s = getSelection();
      if (!s.rangeCount) return null;
      const r = s.getRangeAt(0);
      if (!f.contains(r.startContainer) || !f.contains(r.endContainer)) return null;
      const m = read(f);
      return [index(f, m, r.startContainer, r.startOffset), index(f, m, r.endContainer, r.endOffset)];
    }
    /** A place among the pieces → a point in the DOM. */
    function point(f, i) {
      const m = read(f);
      for (const [n, a] of m.at) if (n.nodeType === 3 && i >= a && i <= a + n.nodeValue.length) return [n, i - a];
      for (const [n, a] of m.at) if (n.nodeType === 1 && a === i && (n.tagName === 'BR' || n.tagName === 'IMG')) return [n.parentNode, [...n.parentNode.childNodes].indexOf(n)];
      return [f, f.childNodes.length];
    }
    function select(f, a, b) {
      const r = document.createRange();
      try {
        r.setStart(...point(f, a));
        r.setEnd(...point(f, b ?? a));
      } catch {
        return;
      }
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    // ---- undo ----
    const H = new WeakMap();
    const hist = (f) => H.get(f) || (H.set(f, { u: [], r: [], t: 0, k: '' }), H.get(f));
    /** The field as it is, kept before a change. Typing within a second of the last keystroke is one step. */
    function snap(f, kind) {
      if (!f) return;
      const h = hist(f), now = Date.now();
      if (kind === 'type' && h.k === 'type' && now - h.t < 1000) return void (h.t = now);
      h.u.push({ html: f.innerHTML, sel: selOf(f) });
      if (h.u.length > 200) h.u.shift();
      h.r = [];
      h.k = kind;
      h.t = now;
    }
    function step(f, from, to) {
      const h = hist(f), x = h[from].pop();
      if (!x) return;
      h[to].push({ html: f.innerHTML, sel: selOf(f) });
      h.k = '';
      f.innerHTML = x.html;
      if (x.sel) select(f, ...x.sel);
      changed();
    }
    // ---- styles ----
    const api = {
      pend: null,
      snap,
      undo: (f) => step(f, 'u', 'r'),
      redo: (f) => step(f, 'r', 'u'),
      forget: (f) => H.delete(f),
      /** kind: b, i, ul or hl. With nothing selected, it applies to what he types next. */
      toggle(f, kind) {
        const bit = BIT[kind], sel = selOf(f);
        if (!sel) return;
        let [a, b] = sel;
        if (a > b) [a, b] = [b, a];
        const { out } = read(f);
        if (a === b) {
          const before = out[a - 1], had = before && before.c != null ? before.f & bit : 0;
          const p = api.pend && api.pend.f === f && api.pend.at === a ? api.pend : { f, at: a, on: 0, off: 0 };
          if (p.on & bit) p.on &= ~bit;
          else if (p.off & bit) p.off &= ~bit;
          else if (had) p.off |= bit;
          else p.on |= bit;
          api.pend = p.on || p.off ? p : null;
          return;
        }
        snap(f, 'format');
        const all = out.slice(a, b).every((p) => p.c == null || !/\S/.test(p.c) || p.f & bit);
        for (let k = a; k < b; k++) if (out[k].c != null) out[k].f = all ? out[k].f & ~bit : out[k].f | bit;
        f.innerHTML = write(out);
        select(f, a, b);
        changed();
      },
      /** What he typed since a style was asked for with nothing selected gets it. */
      typed(f) {
        const p = api.pend;
        if (!p || p.f !== f) return;
        const sel = selOf(f);
        if (!sel || sel[0] !== sel[1] || sel[0] <= p.at) return;
        const { out } = read(f), c = sel[0];
        for (let k = p.at; k < c; k++) if (out[k].c != null) out[k].f = (out[k].f | p.on) & ~p.off;
        f.innerHTML = write(out);
        select(f, c);
        api.pend = null;
      },
    };
    return api;
  })();
  EL.addEventListener('beforeinput', (e) => {
    const f = e.target.closest?.('.rv-f');
    if (!f) return;
    const t = e.inputType || '';
    if (t === 'historyUndo' || t === 'historyRedo') {
      e.preventDefault();
      return t === 'historyUndo' ? RT.undo(f) : RT.redo(f);
    }
    // the phone's own B / I / U (in its selection menu) do what the shortcuts do; no other styling from the browser
    const fm = { formatBold: 'b', formatItalic: 'i', formatUnderline: 'ul' }[t];
    if (fm || t.startsWith('format')) {
      e.preventDefault();
      if (fm) RT.toggle(f, fm);
      return;
    }
    if (t === 'insertCompositionText') return;
    RT.snap(f, /^(insertText|deleteContent(Backward|Forward))$/.test(t) ? 'type' : 'edit');
  });
  EL.addEventListener('compositionstart', (e) => RT.snap(e.target.closest?.('.rv-f'), 'type'));
  EL.addEventListener('compositionend', (e) => {
    const f = e.target.closest?.('.rv-f');
    if (f) setTimeout(() => (RT.typed(f), changed()));
  });
  EL.addEventListener('input', (e) => {
    const f = e.target.closest?.('.rv-f');
    if (f && !e.isComposing && RT.pend) RT.typed(f);
  });
  EL.addEventListener('pointerdown', () => (RT.pend = null));
  EL.addEventListener('focusout', () => (RT.pend = null));

  // ---------- on a phone, a selection in a field brings up a small bar under it (no toolbar the rest of the time) ----------
  const FMT = document.createElement('div');
  FMT.className = 'rv-fmt';
  FMT.hidden = true;
  FMT.innerHTML = '<button type="button" data-k="b" aria-label="Bold"><b>B</b></button><button type="button" data-k="i" aria-label="Italic"><i>I</i></button><button type="button" data-k="ul" aria-label="Underline"><u>U</u></button><button type="button" data-k="hl" aria-label="Highlight"><span>H</span></button>';
  document.body.appendChild(FMT);
  const TOUCH = matchMedia('(pointer:coarse)');
  // a press on the bar keeps the selection (no focus moves to the button)
  FMT.addEventListener('pointerdown', (e) => e.preventDefault());
  FMT.addEventListener('mousedown', (e) => e.preventDefault());
  FMT.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'), f = FMT._f;
    if (!b || !f) return;
    RT.toggle(f, b.dataset.k);
    sfx('tap');
    placeFmt();
  });
  function placeFmt() {
    const s = getSelection(), r = s.rangeCount ? s.getRangeAt(0) : null;
    const f = r && !s.isCollapsed && r.commonAncestorContainer && (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest?.('.rv .rv-f');
    if (!TOUCH.matches || !f || EL.hidden) return void ((FMT.hidden = true), (FMT._f = null));
    FMT._f = f;
    FMT.hidden = false;
    const rect = r.getBoundingClientRect(), vv = visualViewport, top = vv ? vv.offsetTop : 0, h = vv ? vv.height : innerHeight;
    const w = FMT.offsetWidth, bh = FMT.offsetHeight;
    // under the selection (the phone's own menu sits above it); above it when there's no room left over the keyboard
    let y = rect.bottom + 14;
    if (y + bh > top + h - 8) y = rect.top - bh - 14;
    FMT.style.left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + 'px';
    FMT.style.top = Math.max(top + 8, y) + 'px';
  }
  document.addEventListener('selectionchange', () => requestAnimationFrame(placeFmt));
  visualViewport?.addEventListener('resize', () => FMT.hidden || placeFmt());
  visualViewport?.addEventListener('scroll', () => FMT.hidden || placeFmt());
  BUS.on('view', (v) => v !== 'cards' && (FMT.hidden = true));

  // Add: a press adds and moves on; a hold adds and stays (the button fills while held, kit/hold.ts)
  HOLD($('.rv-add'), { tap: () => add(false), hold: () => add(true) });

  function readFields() {
    const st = CD.cur && state(CD.cur);
    if (!st) return;
    for (const [k] of FIELDS) st[k] = field(k).innerHTML.replace(/ class="rv-sel"/g, '');
  }
  function paintBar() {
    const w = CD.cur, st = w && state(w);
    if (!st) return;
    const added = cardCarded(w) && st.saved;
    const b = $('.rv-add');
    b.textContent = RV.saving ? 'Adding' : added && !st.dirty ? 'Added' : added ? 'Save' : 'Add';
    b.disabled = RV.saving || !plain(st.chinese);
    b.classList.toggle('done', added && !st.dirty);
    $('.rv-say').classList.toggle('on', !!st.audio);
    $('.rv-say').classList.toggle('busy', !!RV.voiceBusy);
  }
  function paintStrip() {
    const w = CD.cur, st = w && state(w);
    if (!st) return;
    const p = RV.pics[w] || {}, busy = RV.busy[w] || {};
    const inPic = new Set([...field('picture').querySelectorAll('img')].map((i) => i.getAttribute('data-from') || i.getAttribute('src')));
    const tiles = [
      ...(busy.draw ? ['<div class="rv-tile wait" aria-hidden="true"></div>', '<div class="rv-tile wait" aria-hidden="true"></div>'] : []),
      ...(p.drawn || []).map((u) => ({ thumb: u, full: u, drawn: true })),
      ...(p.photos || []),
    ].map((x) =>
      typeof x === 'string'
        ? x
        : `<div class="rv-tile${x.drawn ? ' drawn' : ''}" role="button" tabindex="0" data-rv="pick" data-full="${esc(x.full)}" aria-pressed="false"><img src="${esc(x.thumb)}" alt="" draggable="true" data-full="${esc(x.full)}" loading="lazy"></div>`,
    );
    if (busy.photos && !(p.photos || []).length) tiles.push(...Array(4).fill('<div class="rv-tile wait" aria-hidden="true"></div>'));
    // More images and More drawings close the strip, as tiles of their own
    const more = (k, label, on) => `<button type="button" class="rv-tile rv-mt" data-rv="${k}"${on ? ' disabled' : ''}><span>${label}</span></button>`;
    tiles.push(more('more-img', 'More images', busy.photos), more('more-draw', 'More drawings', busy.draw));
    // Gemini, with the word filled in (G on a keyboard; cards.js CD_gemini)
    tiles.push(`<a class="rv-tile rv-mt" data-rv="gemini" href="${esc(CD_gemURL(w))}" target="_blank" rel="noopener"><span>Gemini</span></a>`);
    // rebuilt only when the tiles themselves change: typing elsewhere must not reload the pictures
    const html = tiles.join(''), strip = $('.rv-strip');
    if (RV.stripHTML !== html || strip.dataset.w !== w) {
      RV.stripHTML = html;
      strip.dataset.w = w;
      strip.innerHTML = html;
      strip.querySelectorAll('img').forEach((im) => (im.onerror = () => im.closest('.rv-tile')?.remove()));
    }
    for (const t of strip.querySelectorAll('[data-rv="pick"]')) t.setAttribute('aria-pressed', inPic.has(t.dataset.full));
  }
  // the Word field stays out of sight until Option shows it, or it holds something other than the word itself
  function wordShown(w, st) {
    const p = $('.rv-word'), plainWord = plain(st.word);
    p.classList.toggle('kept', !!plainWord && plainWord !== w && plainWord !== (parseCard(cardOf(w)?.text).word || w));
  }
  function paintType(st) {
    EL.dataset.type = st.type || 'Chinese';
    EL.querySelectorAll('[data-rv="type"]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.t === EL.dataset.type)));
    $('#rv-l-chinese').textContent = EL.dataset.type === 'Chinese radicals' ? 'Character' : EL.dataset.type === 'Chinese phrases' ? 'Phrase' : 'Sentence';
    // a type other than Word stays in sight, so it's never picked by mistake and forgotten
    $('.rv-typebox').classList.toggle('kept', EL.dataset.type !== 'Chinese');
  }
  // a word's cards, once one is added: their numbers, and + for another
  function paintSlots(w) {
    const box = $('.rv-slots'), have = notesOf(w), cur = slotOf(w);
    box.hidden = !have.length && cur === 1;
    if (box.hidden) return (box.innerHTML = '');
    const all = [...new Set([...have, cur])].sort((a, b) => a - b);
    const html = all.map((n) => `<button type="button" role="tab" data-rv="slot" data-n="${n}" aria-selected="${n === cur}">${n}</button>`).join('') + (have.includes(cur) ? '<button type="button" class="rv-slot-new" data-rv="slot-new" aria-label="Another card">+</button>' : '');
    if (box.innerHTML !== html) box.innerHTML = html;
  }
  function paint() {
    const w = CD.cur, st = w && state(w);
    EL.hidden = !st;
    if (!st) return;
    paintType(st);
    paintSlots(w);
    const key = noteId(w, slotOf(w));
    if (RV.shown !== key) {
      // the fields only when the word (or its card) changes, so typing is never interrupted
      RV.shown = key;
      for (const [k] of FIELDS) (field(k).innerHTML = kept(st[k])), RT.forget(field(k));
      wordShown(w, st);
      pictures(w);
    }
    paintBar();
    paintStrip();
  }
  /** Another card for the word: the next number, its sentence the study card's next one. */
  function newSlot(w) {
    if (CD.cur === w) readFields();
    const have = notesOf(w);
    RV.slot[w] = Math.max(1, slotOf(w), ...have) + 1;
    paint();
  }

  // ---------- pictures to choose from ----------
  const searchWords = (meaning) =>
    String(meaning || '')
      .replace(/\([^)]*\)|（[^）]*）|\*\*/g, ' ')
      .replace(/[㐀-鿿]+/g, ' ')
      .split(/[;,，；]/)[0]
      .replace(/^\s*(to|a|an|the)\s+/i, '')
      .trim();
  async function morePhotos(w, q, first) {
    const p = (RV.pics[w] ||= {});
    if (!q) return;
    (RV.busy[w] ||= {}).photos = true;
    if (CD.cur === w) paintStrip();
    try {
      const off = p.q === q ? p.next || 0 : 0;
      const r = await call('photos', { q, offset: off });
      const have = new Set((p.photos || []).map((x) => x.full));
      const fresh = r.photos.filter((x) => !have.has(x.full));
      p.photos = first ? [...fresh, ...(p.photos || [])] : [...(p.photos || []), ...fresh];
      p.q = q;
      p.next = r.next;
      keepPics(w);
    } catch (e) {
      console.error(e);
    } finally {
      RV.busy[w].photos = false;
      if (CD.cur === w) paintStrip();
    }
  }
  async function moreDrawings(w, again) {
    const d = cardOf(w);
    if (!cardOK(d)) return;
    const c = parseCard(d.text), p = (RV.pics[w] ||= {}), st = state(w);
    (RV.busy[w] ||= {}).draw = true;
    if (CD.cur === w) paintStrip();
    try {
      const r = await call('drawings', { word: c.word || w, meaning: c.meaning, sentence: st ? plain(st.chinese) : '', again: !!again, model: modelId('idea-model'), drawer: LAB.get('draw-model') });
      p.drawn = r.drawn;
      keepPics(w);
      if (r.errs?.length) console.error(r.errs);
      // Claude's search words find better photos than the gloss: those go first
      if (r.query && r.query !== p.q && !p.better) {
        p.better = true;
        morePhotos(w, r.query, true);
      }
    } catch (e) {
      console.error(e);
      if (CD.cur === w) say(e.code === 'rate_limited' ? 'Drawings: not now, try again later.' : 'The drawings didn’t come through.');
    } finally {
      RV.busy[w].draw = false;
      if (CD.cur === w) paintStrip();
    }
  }
  // The strip is found once per word and kept on this device (his call, Nov 23: no new search or drawing on every
  // open); More images and More drawings add to it.
  const PICS_KEY = 'cbp-pics';
  const picsSaved = () => {
    try {
      return JSON.parse(localStorage.getItem(PICS_KEY) || '{}');
    } catch {
      return {};
    }
  };
  function keepPics(w) {
    const p = RV.pics[w];
    if (!p) return;
    const all = picsSaved();
    all[w] = { photos: p.photos || [], q: p.q || '', next: p.next || 0, drawn: p.drawn || [], better: !!p.better, at: Date.now() };
    // the 60 words seen last
    const keep = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 60);
    try {
      localStorage.setItem(PICS_KEY, JSON.stringify(Object.fromEntries(keep)));
    } catch {}
  }
  function pictures(w) {
    const d = cardOf(w);
    if (!cardOK(d) || RV.pics[w]) return;
    const saved = picsSaved()[w];
    if (saved && (saved.photos.length || saved.drawn.length)) {
      RV.pics[w] = { ...saved };
      return;
    }
    RV.pics[w] = {};
    morePhotos(w, searchWords(parseCard(d.text).meaning) || w);
    moreDrawings(w);
  }
  /** A picture from the strip into Picture (at the end), or out of it again. */
  function pick(full) {
    const f = field('picture');
    const there = [...f.querySelectorAll('img')].find((i) => (i.getAttribute('data-from') || i.getAttribute('src')) === full);
    RT.snap(f, 'edit');
    if (there) there.remove();
    else if (document.activeElement !== f) {
      // not typing in it (a tap on a phone): no focus, so no keyboard springs up
      const im = document.createElement('img');
      im.src = full;
      im.dataset.from = full;
      f.appendChild(im);
      keepPictures(f);
    } else {
      const r = document.createRange();
      r.selectNodeContents(f);
      r.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('insertHTML', false, `<img src="${esc(full)}" data-from="${esc(full)}">`);
    }
    changed();
    sfx('tap');
  }

  // ---------- the voice ----------
  async function speak() {
    const w = CD.cur, st = w && state(w);
    if (!st || RV.voiceBusy || !plain(st.chinese)) return;
    if (!st.audio) {
      // iOS plays a sound after a wait only if the tap itself started the player
      SOUND.unlock?.();
      RV.voiceBusy = true;
      paintBar();
      try {
        const text = plain(st.chinese);
        st.audio = (await call('voice', { text })).url;
        st.audioFor = text;
        st.dirty = true;
        draft.set(w, st);
      } catch (e) {
        console.error(e);
        say('The voice didn’t come through.');
      } finally {
        RV.voiceBusy = false;
        paintBar();
      }
    }
    if (!st.audio) return;
    SOUND.play(st.audio);
  }

  // ---------- pinyin, done for him ----------
  async function pinyinOf(st) {
    const text = plain(st.chinese);
    if (text === st.pyFor) return st.py;
    const r = await call('pinyin', { text, model: modelId('pinyin-model') });
    st.py = r.pinyin;
    st.pyFor = text;
    return st.py;
  }

  // ---------- Add ----------
  async function save(w) {
    const k = slotOf(w), id = noteId(w, k), st = state(w, k);
    if (!st || !plain(st.chinese)) return false;
    if (CD.cur === w) readFields();
    if (st.type === 'Chinese phrases' && !/<img/i.test(st.picture || '')) {
      say('A phrase card shows only its picture: add one first.');
      return false;
    }
    RV.saving = true;
    paintBar();
    try {
      if (CD.cur === w) {
        readFields();
        keepPictures(EL);
      }
      await Promise.all([...RV.jobs]);
      settle();
      const py = await pinyinOf(st);
      const d = cardOf(w) || {}, c = parseCard(d.text), prev = RV.notes[id];
      const note = {
        // a phrase is for no one word
        word: st.type === 'Chinese phrases' ? '' : st.word.replace(/<[^>]+>/g, '').trim() ? st.word : esc(c.word || w),
        chinese: st.chinese,
        pinyin: esc(py).replace(/\n/g, '<br>'),
        picture: st.picture,
        notes: st.notes,
        type: st.type || 'Chinese',
        mnemonic: st.mnemonic || '',
        // the server makes the audio, or keeps this one if it was made for this sentence (cards.ts voiced)
        audio: st.audio,
        audioFor: st.audio ? st.audioFor || '' : '',
        made: prev?.made || new Date().toISOString(),
        edited: new Date().toISOString(),
        exported: prev?.exported || null,
      };
      if (/src="(blob:|data:|https:)/.test(note.chinese + note.word + note.picture + note.notes)) throw new Error('A picture is still on its way: try again in a moment.');
      const r = await DBH.doc('notes/' + id).set(note);
      if (r && typeof r.audio === 'string') (note.audio = st.audio = r.audio), (note.audioFor = st.audioFor = r.audio ? plain(st.chinese) : '');
      RV.notes[id] = note;
      st.saved = true;
      st.dirty = false;
      draft.drop(w, k);
      return true;
    } catch (e) {
      console.error(e);
      say(e.code === 'read_only' ? 'Saving on the website isn’t on yet.' : String(e.message || 'It didn’t save.'));
      return false;
    } finally {
      RV.saving = false;
      paintBar();
    }
  }
  // the board's Card it (its button is hidden here; Enter still calls it): carding saves the card first
  const cardIt = CD_cardIt;
  CD_cardIt = async () => {
    const w = CD.cur, d = cardOf(w);
    if (d && d.text && !d.carded && state(w) && !(await save(w))) return;
    cardIt();
  };
  /** Add (a press, Shift+Cmd+Enter): the card is saved, the word carded, and the next word comes up. Add and stay (a hold,
   *  Cmd+Enter): the same, then the next card for this word, ready to fill. */
  async function add(stay) {
    const w = CD.cur;
    if (!w || RV.saving || !state(w)) return;
    const d = cardOf(w), first = !cardCarded(w) && !!(d && d.text);
    if (!(await save(w))) return;
    if (first) cardIt(); // stamped, confetti, Undo; it brings the next word up by itself
    else sfx('save');
    if (stay) {
      clearTimeout(CD.advT);
      if (CD.cur === w) newSlot(w);
      return;
    }
    if (first) return;
    clearTimeout(CD.advT);
    CD.advT = setTimeout(() => {
      if (CD.cur !== w) return;
      const L = CD_words(), i = L.indexOf(w), nx = L[i + 1] || L[i - 1];
      if (nx && nx !== w) CD_go(nx);
    }, 450);
  }

  // ---------- events ----------
  function changed() {
    const w = CD.cur, st = w && state(w);
    if (!st) return;
    const before = plain(st.chinese);
    readFields();
    if (plain(st.chinese) !== before) (st.audio = ''), (st.audioFor = '');
    st.dirty = true;
    draft.set(w, st);
    paintBar();
    paintStrip();
  }
  EL.addEventListener('input', (e) => {
    if (!e.target.closest('.rv-f')) return;
    keepPictures(e.target.closest('.rv-f'));
    changed();
  });
  // the sentence's reading is worked out once he leaves the field, so Add doesn't wait for it
  EL.addEventListener('focusout', (e) => {
    const f = e.target.closest('.rv-f[data-f="chinese"]'), st = CD.cur && state(CD.cur);
    if (f && st) pinyinOf(st).catch(() => {});
  });
  EL.addEventListener('paste', (e) => {
    const f = e.target.closest('.rv-f');
    if (!f) return;
    e.preventDefault();
    RT.snap(f, 'edit');
    const files = e.clipboardData?.files;
    if (files && files.length && insertFiles(files)) return changed();
    const html = e.clipboardData?.getData('text/html');
    if (html) document.execCommand('insertHTML', false, clean(html));
    else document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') || '');
    keepPictures(f);
    changed();
  });
  EL.addEventListener('dragstart', (e) => {
    const im = e.target.closest?.('.rv-tile img');
    if (!im) return;
    e.dataTransfer.setData('text/html', `<img src="${esc(im.dataset.full)}" data-from="${esc(im.dataset.full)}">`);
    e.dataTransfer.setData('text/uri-list', im.dataset.full);
  });
  EL.addEventListener('drop', (e) => {
    const f = e.target.closest('.rv-f');
    if (!f) return;
    const files = e.dataTransfer?.files;
    RT.snap(f, 'edit');
    if (!files || !files.length) {
      // HTML from the strip or another page: the browser drops it where the pointer is; cleaned and kept on input
      setTimeout(() => {
        f.innerHTML = clean(f.innerHTML);
        keepPictures(f);
        changed();
      });
      return;
    }
    e.preventDefault();
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    f.focus();
    if (pos) {
      getSelection().removeAllRanges();
      getSelection().addRange(pos);
    }
    if (insertFiles(files)) changed();
  });
  EL.addEventListener('keydown', (e) => {
    const tile = e.target.closest?.('.rv-tile[data-rv="pick"]');
    if (tile && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      e.stopPropagation();
      pick(tile.dataset.full);
      return;
    }
    const f = e.target.closest('.rv-f');
    if (!f) return;
    // Cmd+B, Cmd+I, Cmd+U, Cmd+Shift+H (the word's mark): on the selection, or on what he types next
    const fmt = [['cd.bold', 'b'], ['cd.italic', 'i'], ['cd.underline', 'ul'], ['cd.mark', 'hl']].find(([id]) => KEYS.is(e, id));
    if (fmt) {
      e.preventDefault();
      e.stopPropagation();
      RT.toggle(f, fmt[1]);
      return;
    }
    // the fields keep their own undo (typing and formatting alike), so the board's Cmd+Z stays out of them
    if (KEYS.is(e, 'undo') || KEYS.is(e, 'redo')) {
      e.preventDefault();
      e.stopPropagation();
      KEYS.is(e, 'redo') ? RT.redo(f) : RT.undo(f);
      return;
    }
    if (/^(Arrow|Home|End|Page)/.test(e.key)) RT.pend = null;
    if (RV.selImg && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      RT.snap(f, 'edit');
      RV.selImg.remove();
      unselectImg();
      changed();
      return;
    }
    if (KEYS.is(e, 'cd.addstay') || KEYS.is(e, 'cd.add')) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) add(KEYS.is(e, 'cd.addstay'));
    }
  });
  // a picture in a field: a click picks it (a ring shows it), Backspace takes it out, a drag moves it
  function unselectImg() {
    RV.selImg?.classList.remove('rv-sel');
    RV.selImg = null;
  }
  EL.addEventListener('click', (e) => {
    const im = e.target.closest('.rv-f img');
    if (im === RV.selImg) return;
    unselectImg();
    if (!im) return;
    RV.selImg = im;
    im.classList.add('rv-sel');
    im.closest('.rv-f').focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNode(im);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  // ---------- pictures in a field move like icons on a Home Screen: grab one (press and hold, on a phone) and it lifts and
  // follows the pointer, the others make room as it passes; let go anywhere on the card and it settles there; let go
  // outside the card and it's taken out (Undo brings it back). The browser's own drag is off for them: it copied them
  // into the field as new pictures from the full address, which then failed to keep. ----------
  const DRAG = { on: false, eat: 0 };
  const SPRING = 'cubic-bezier(.2,.9,.3,1)';
  /** The other pictures glide from where they were to where the move put them (from what's on screen, so mid-glide is fine). */
  function flip(mutate) {
    const ims = [...EL.querySelectorAll('.rv-f img')].filter((i) => i !== DRAG.im);
    const was = new Map(ims.map((i) => [i, i.getBoundingClientRect()]));
    mutate();
    for (const i of ims) {
      const a = was.get(i), b = i.getBoundingClientRect(), dx = a.left - b.left, dy = a.top - b.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) continue;
      i.style.transition = 'none';
      i.style.translate = `${dx}px ${dy}px`;
      i.getBoundingClientRect();
      i.style.transition = `translate .32s ${SPRING}`;
      i.style.translate = '';
    }
  }
  // where a picture sits without any glide on it: its own place in the layout
  const home = (i) => {
    const o = i.offsetParent.getBoundingClientRect();
    return { x: o.left + i.offsetLeft + i.offsetWidth / 2, y: o.top + i.offsetTop + i.offsetHeight / 2, w: i.offsetWidth, h: i.offsetHeight };
  };
  function lift(x, y) {
    const im = DRAG.p.im, r = im.getBoundingClientRect();
    RT.snap(im.closest('.rv-f'), 'edit');
    clearTimeout(DRAG.p.t);
    Object.assign(DRAG, { on: true, im, r, dx: x - r.left, dy: y - r.top, x, y, moved: false });
    unselectImg();
    getSelection().removeAllRanges();
    const g = document.createElement('img');
    g.src = im.src;
    g.className = 'rv-ghost';
    Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(g);
    DRAG.g = g;
    requestAnimationFrame(() => g.classList.add('up'));
    im.classList.add('rv-hole');
    document.documentElement.classList.add('rv-dragging');
    navigator.vibrate?.(8);
  }
  function move(x, y) {
    Object.assign(DRAG, { x, y });
    DRAG.g.style.translate = `${x - DRAG.dx - DRAG.r.left}px ${y - DRAG.dy - DRAG.r.top}px`;
    const b = EL.getBoundingClientRect(), out = x < b.left || x > b.right || y < b.top || y > b.bottom;
    DRAG.g.classList.toggle('out', out);
    DRAG.im.classList.toggle('rv-away', out);
    if (out) return;
    const field = document.elementFromPoint(x, y)?.closest?.('.rv-f') || DRAG.im.closest('.rv-f');
    let best = null, bd = Infinity;
    for (const i of field.querySelectorAll('img')) {
      if (i === DRAG.im) continue;
      const h = home(i), d = Math.hypot((x - h.x) / h.w, (y - h.y) / h.h);
      if (d < bd) (bd = d), (best = [i, h]);
    }
    let parent, next;
    if (best) {
      const [i, h] = best;
      parent = i.parentNode;
      next = x < h.x ? i : i.nextSibling;
    } else if (DRAG.im.closest('.rv-f') !== field) (parent = field), (next = null);
    else return;
    if (next === DRAG.im || (DRAG.im.parentNode === parent && DRAG.im.nextSibling === next)) return;
    DRAG.moved = true;
    flip(() => parent.insertBefore(DRAG.im, next));
  }
  function drop(cancel) {
    const p = DRAG.p;
    DRAG.p = null;
    if (p) clearTimeout(p.t);
    if (!DRAG.on) return;
    DRAG.on = false;
    DRAG.eat = performance.now();
    document.documentElement.classList.remove('rv-dragging');
    const { g, im } = DRAG;
    DRAG.im = null;
    if (g.classList.contains('out') && !cancel) {
      const parent = im.parentNode, next = im.nextSibling;
      flip(() => im.remove());
      im.classList.remove('rv-hole', 'rv-away');
      g.classList.add('poof');
      setTimeout(() => g.remove(), 260);
      changed();
      say('Picture taken out.', ['Undo', () => { if (parent.isConnected) { flip(() => parent.insertBefore(im, next?.parentNode === parent ? next : null)); changed(); } }]);
      return;
    }
    im.classList.remove('rv-away');
    const h = home(im);
    g.classList.remove('up', 'out');
    g.classList.add('home');
    g.style.translate = `${h.x - h.w / 2 - DRAG.r.left}px ${h.y - h.h / 2 - DRAG.r.top}px`;
    let done = false;
    const land = () => { if (done) return; done = true; g.remove(); im.classList.remove('rv-hole'); };
    g.addEventListener('transitionend', (e) => e.propertyName === 'translate' && land());
    setTimeout(land, 420);
    if (DRAG.moved) changed();
  }
  EL.addEventListener('pointerdown', (e) => {
    const im = e.target.closest?.('.rv-f img');
    if (!im || e.button || DRAG.on) return;
    if (e.pointerType === 'mouse') e.preventDefault(); // no browser drag, no caret; the click still picks it
    DRAG.p = { im, id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' };
    if (DRAG.p.touch) DRAG.p.t = setTimeout(() => DRAG.p && lift(DRAG.p.x, DRAG.p.y), 300);
  });
  addEventListener('pointermove', (e) => {
    const p = DRAG.p;
    if (!p || e.pointerId !== p.id) return;
    if (!DRAG.on) {
      const d = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (p.touch) {
        if (d > 8) (clearTimeout(p.t), (DRAG.p = null)); // a finger that moves before the hold is scrolling
        return;
      }
      if (d < 4) return;
      lift(p.x, p.y);
    }
    move(e.clientX, e.clientY);
  });
  addEventListener('pointerup', (e) => DRAG.p && e.pointerId === DRAG.p.id && drop(false));
  addEventListener('pointercancel', (e) => DRAG.p && e.pointerId === DRAG.p.id && drop(true));
  // while a picture is up, the page doesn't scroll under the finger
  addEventListener('touchmove', (e) => DRAG.on && e.cancelable && e.preventDefault(), { passive: false });
  EL.addEventListener('contextmenu', (e) => e.target.closest?.('.rv-f img') && e.preventDefault());
  EL.addEventListener('dragstart', (e) => e.target.closest?.('.rv-f img') && e.preventDefault());
  EL.addEventListener('click', (e) => performance.now() - DRAG.eat < 350 && e.target.closest?.('.rv-f') && (e.stopImmediatePropagation(), e.preventDefault()), true);
  document.addEventListener('selectionchange', () => {
    if (!RV.selImg) return;
    const s = getSelection();
    if (!s.rangeCount || !s.getRangeAt(0).intersectsNode(RV.selImg) || s.isCollapsed) unselectImg();
  });
  EL.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rv]'), w = CD.cur;
    if (!b || !w) return;
    e.stopPropagation();
    const k = b.dataset.rv;
    if (k === 'add') return; // HOLD: a press adds and moves on, a hold adds and stays
    if (k === 'gemini') return CD_gemini(w, false); // the link opens Gemini; the word goes on the clipboard too
    if (k === 'slot' || k === 'slot-new') {
      readFields();
      if (k === 'slot') (RV.slot[w] = +b.dataset.n), paint();
      else newSlot(w);
      sfx('tap');
      return;
    }
    if (k === 'type') {
      const st = state(w);
      readFields();
      const was = st.type || 'Chinese';
      RT.snap(field('chinese'), 'edit');
      st.type = b.dataset.t;
      // a Radical's first field is the character itself; the sentence comes back when he switches away
      if (st.type === 'Chinese radicals' && was !== st.type) {
        st.sentence = st.chinese;
        st.chinese = esc(w);
        field('chinese').innerHTML = st.chinese;
      } else if (was === 'Chinese radicals' && st.type !== was && st.sentence != null) {
        st.chinese = st.sentence;
        field('chinese').innerHTML = kept(st.chinese);
      }
      st.dirty = true;
      draft.set(w, st);
      paintType(st);
      paintBar();
      sfx('tap');
    }
    else if (k === 'say') speak();
    else if (k === 'pick') pick(b.dataset.full);
    else if (k === 'more-img') {
      const p = RV.pics[w] || {};
      morePhotos(w, p.q || searchWords(parseCard(cardOf(w).text).meaning) || w);
    } else if (k === 'more-draw') moreDrawings(w, true);
  });
  // a sentence of the study card, clicked: it becomes the card's Sentence (and is still copied, as on the board)
  const copy = CD_copy;
  CD_copy = (sn) => {
    const w = CD.cur, d = cardOf(w), st = w && state(w), m = /^(mine)?(\d+):/.exec(sn.dataset.k || '');
    if (st && d && m) {
      const c = parseCard(d.text), s = (m[1] ? c.mine : c.ex)[+m[2]];
      if (s) {
        const f = fromSentence(s, c.word || w);
        RT.snap(field('chinese'), 'edit');
        Object.assign(st, { chinese: f.chinese, py: f.py, pyFor: f.py ? plain(f.chinese) : '', audio: '', audioFor: '', dirty: true });
        field('chinese').innerHTML = st.chinese;
        draft.set(w, st);
        paintBar();
        const out = copy(sn);
        if (NARROW.matches) say('It’s the Sentence now.', ['Add', () => pane('add')]);
        return out;
      }
    }
    return copy(sn);
  };
  document.addEventListener('keydown', (e) => {
    if (VIEW !== 'cards' || !CD.cur || e.isComposing) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (KEYS.is(e, 'cd.voice')) {
      e.preventDefault();
      speak();
    }
    // Tutor: the add keys work off the fields too, while Add is on screen (in a field, the fields' own keydown has them)
    else if (CD.open !== null && $('.rv-add')?.offsetParent && (KEYS.is(e, 'cd.addstay') || KEYS.is(e, 'cd.add'))) {
      e.preventDefault();
      if (!e.repeat) add(KEYS.is(e, 'cd.addstay'));
    }
  });

  // ---------- with the board ----------
  const paintAll = CD_paintAll;
  CD_paintAll = () => {
    paintAll();
    if (CD.open !== null) paint();
    else RV.shown = '';
  };
  // a card written ahead gets its pictures ahead too (a computer only, as the board writes ahead)
  const make = makeCard;
  makeCard = async (word, ...rest) => {
    await make(word, ...rest);
    if (CD_DESK() && cardOK(cardOf(word))) pictures(word);
  };
  (function wait(n) {
    if (DBH) {
      DBH.collection('notes').onSnapshot(
        (s) => {
          const m = {};
          s.docs.forEach((d) => (m[d.id] = JSON.parse(JSON.stringify(d.data() || {}))));
          RV.notes = m;
          if (CD.open !== null) paint();
        },
        (e) => console.error(e),
      );
      return;
    }
    if (n < 200) setTimeout(() => wait(n + 1), 100);
  })(0);
})();
