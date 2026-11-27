"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: !0 });
  };

  // site/src/cbp/kit/sound.ts
  var el = typeof Audio == "function" ? new Audio() : null;
  el && (el.preload = "auto");
  var turn = 0, speaking = !1;
  function hush() {
    turn++, el && (el.onended = null, el.onerror = null, el.pause());
    try {
      speaking && speechSynthesis.cancel();
    } catch {
    }
    speaking = !1;
  }
  async function play(src, o = {}) {
    hush();
    let list = (Array.isArray(src) ? src : [src]).filter(Boolean);
    if (!el || !list.length) return !1;
    let mine2 = turn, next = async () => {
      let s = list.shift();
      if (s === void 0 || mine2 !== turn)
        return mine2 === turn && o.onEnd?.(), !1;
      el.src = s, el.playbackRate = o.rate ?? 1, el.onended = () => mine2 === turn && void next(), el.onerror = () => mine2 === turn && void next();
      try {
        return await el.play(), !0;
      } catch {
        return !1;
      }
    };
    return next();
  }
  function speak(text, o = {}) {
    hush();
    try {
      if (!("speechSynthesis" in window) || !text) return !1;
      let u = new SpeechSynthesisUtterance(text), vs = speechSynthesis.getVoices(), v = vs.find((x) => /zh[-_]TW/i.test(x.lang)) || vs.find((x) => /^zh/i.test(x.lang) && !/HK|yue/i.test(x.lang));
      v ? (u.voice = v, u.lang = v.lang) : u.lang = "zh-TW", u.rate = o.rate ?? 1;
      let mine2 = turn;
      return u.onend = () => {
        mine2 === turn && (speaking = !1, o.onEnd?.());
      }, speaking = !0, speechSynthesis.speak(u), !0;
    } catch {
      return !1;
    }
  }
  try {
    speechSynthesis.getVoices(), speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices());
  } catch {
  }
  var SOUND = {
    play,
    speak,
    stop: hush,
    get playing() {
      return speaking || !!el && !el.paused && !el.ended;
    },
    autoplay: () => LAB.get("autoplay") !== "off"
  }, SILENT = "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";
  Object.assign(SOUND, {
    unlock() {
      !el || SOUND.playing || (el.src = SILENT, el.play().catch(() => {
      }));
    }
  });

  // site/src/cbp/kit/hold.ts
  var R = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function HOLD(btn2, o) {
    let ms = o.ms ?? 500;
    btn2.classList.add("hold"), btn2.style.setProperty("--hold-ms", `${ms}ms`);
    let t = 0, x = 0, y = 0, fired = !1, by = "", reset = () => {
      clearTimeout(t), t = 0, by = "", btn2.classList.remove("holding");
    }, start2 = (e, how) => {
      t || (fired = !1, by = how, btn2.classList.toggle("hold-still", R()), requestAnimationFrame(() => by && btn2.classList.add("holding")), t = window.setTimeout(() => {
        t = 0, fired = !0, btn2.classList.remove("holding"), btn2.classList.add("held"), setTimeout(() => btn2.classList.remove("held"), 260);
        try {
          navigator.vibrate?.(10);
        } catch {
        }
        o.hold(e);
      }, ms));
    }, down = (e) => {
      e.button !== 0 || btn2.disabled || (x = e.clientX, y = e.clientY, start2(e, "ptr"));
    }, move = (e) => {
      by === "ptr" && Math.hypot(e.clientX - x, e.clientY - y) > 10 && reset();
    }, up = () => by === "ptr" && reset(), click = (e) => {
      if (fired) {
        fired = !1, e.preventDefault(), e.stopImmediatePropagation();
        return;
      }
      o.tap?.(e);
    }, kdown = (e) => {
      e.key !== " " && e.key !== "Enter" || (e.preventDefault(), e.repeat || start2(e, "key"));
    }, kup = (e) => {
      if (e.key !== " " && e.key !== "Enter" || by !== "key") return;
      e.preventDefault();
      let was = t;
      reset(), was && !fired && btn2.click(), fired = !1;
    }, menu = (e) => e.preventDefault();
    return btn2.addEventListener("pointerdown", down), addEventListener("pointermove", move, { passive: !0 }), addEventListener("pointerup", up), addEventListener("pointercancel", up), btn2.addEventListener("click", click, !0), btn2.addEventListener("keydown", kdown), btn2.addEventListener("keyup", kup), btn2.addEventListener("contextmenu", menu), () => {
      reset(), btn2.classList.remove("hold"), btn2.removeEventListener("pointerdown", down), removeEventListener("pointermove", move), removeEventListener("pointerup", up), removeEventListener("pointercancel", up), btn2.removeEventListener("click", click, !0), btn2.removeEventListener("keydown", kdown), btn2.removeEventListener("keyup", kup), btn2.removeEventListener("contextmenu", menu);
    };
  }

  // src/shared/pinyin.ts
  var MARKS = {
    a: ["\u0101", "\xE1", "\u01CE", "\xE0", "a"],
    e: ["\u0113", "\xE9", "\u011B", "\xE8", "e"],
    i: ["\u012B", "\xED", "\u01D0", "\xEC", "i"],
    o: ["\u014D", "\xF3", "\u01D2", "\xF2", "o"],
    u: ["\u016B", "\xFA", "\u01D4", "\xF9", "u"],
    \u00FC: ["\u01D6", "\u01D8", "\u01DA", "\u01DC", "\xFC"]
  };
  function syllableToMarked(syl) {
    let m = /^([a-zA-Z:üÜ]+)([1-5])$/.exec(syl);
    if (!m) return syl.toLowerCase();
    let [, raw, toneStr] = m, tone2 = Number(toneStr) - 1, base = raw.toLowerCase().replace(/u:/g, "\xFC").replace(/v/g, "\xFC"), idx = base.search(/[ae]/);
    if (idx < 0 && (idx = base.indexOf("ou")), idx < 0) {
      for (let i = base.length - 1; i >= 0; i--)
        if ("aeiou\xFC".includes(base[i])) {
          idx = i;
          break;
        }
    }
    if (idx < 0) return base;
    let marked2 = MARKS[base[idx]][tone2];
    return base.slice(0, idx) + marked2 + base.slice(idx + 1);
  }

  // site/src/cbp/pinyin.ts
  var HAN = /[㐀-䶿一-鿿豈-﫿]/, RUN = /[㐀-䶿一-鿿豈-﫿]+|[^㐀-䶿一-鿿豈-﫿]+/g, MAX = 8;
  function parseLex(text) {
    let m = /* @__PURE__ */ new Map(), s = 0;
    for (; s < text.length; ) {
      let e = text.indexOf(`
`, s);
      e < 0 && (e = text.length);
      let t1 = text.indexOf("	", s), t2 = t1 < 0 ? -1 : text.indexOf("	", t1 + 1);
      t1 > s && t2 > t1 && t2 < e && m.set(text.slice(s, t1), [text.slice(t1 + 1, t2), Number(text.slice(t2 + 1, e)) || 0]), s = e + 1;
    }
    return m;
  }
  var score = (lex2, w) => {
    let x = lex2.get(w);
    return x ? x[1] > 0 ? x[1] / 10 - 9 : w.length === 1 ? -9 : -8.6 : w.length === 1 ? -14 : -1 / 0;
  };
  function segment(lex2, run) {
    let c = [...run], n = c.length, best = new Array(n + 1).fill(-1 / 0), back2 = new Array(n + 1).fill(0);
    best[0] = 0;
    for (let i = 0; i < n; i++)
      if (best[i] !== -1 / 0)
        for (let len = 1; len <= MAX && i + len <= n; len++) {
          let w = c.slice(i, i + len).join("");
          if (len > 1 && !lex2.has(w)) continue;
          let v = best[i] + score(lex2, w);
          v > best[i + len] && (best[i + len] = v, back2[i + len] = i);
        }
    let out = [];
    for (let j = n; j > 0; j = back2[j]) out.push(c.slice(back2[j], j).join(""));
    return out.reverse();
  }
  var NUM = /[〇零一二三四五六七八九十百千萬兩幾第]/, tone = (s) => Number(s?.slice(-1)) || 5;
  var TWO = {
    // 我得走了 děi; 跑得快, 覺得 (a word) de
    \u5F97: (p) => /^(我|你|他|她|我們|你們|他們|她們|就|還|也|都|總|必須|一定)$/.test(p) ? "dei3" : "de5",
    // 還你錢, 還書 huán; otherwise hái
    \u9084: (_, n) => /^(給|錢|書|債)|^.(錢|書|債)/.test(n) ? "huan2" : "hai2",
    // 長得高, 長大 zhǎng; 很長 cháng
    \u9577: (_, n) => /^(得|了|出|高|大|胖|滿|成)/.test(n) ? "zhang3" : "chang2",
    // 慢慢地走 de (after a word of two or more); 在地上 dì
    \u5730: (p, n, pw) => [...pw].length >= 2 && HAN.test(n) && !/^(在|到|上|下|的)$/.test(p) ? "de5" : "di4",
    // 種樹 zhòng; 這種 zhǒng
    \u7A2E: (_, n) => /^(樹|花|菜|田|地|草|豆|稻)/.test(n) ? "zhong4" : "zhong3",
    \u8457: () => "zhe5",
    \u4E86: () => "le5",
    // particles: the neutral tone, as Taiwan's dictionary writes them after a sentence
    \u55CE: () => "ma5",
    \u5462: () => "ne5",
    \u5427: () => "ba5",
    \u554A: () => "a5",
    \u5440: () => "ya5",
    \u5566: () => "la5",
    \u561B: () => "ma5"
  }, HARD = /* @__PURE__ */ new Set([..."\u6578\u5012\u767C\u964D\u4F3C\u50B3\u53C3\u64D4\u85CF\u5F37\u66F2\u60E1\u4F9B\u8208\u51A0\u5275\u7E2B\u6A21\u524A\u5C07\u8F49\u4F5C\u8ABF\u8655\u96E3\u91CF"]);
  function tokens(lex2, text) {
    let out = [];
    for (let m of text.matchAll(RUN)) {
      if (!HAN.test(m[0])) {
        out.push({ text: m[0] });
        continue;
      }
      for (let w of segment(lex2, m[0])) {
        let x = lex2.get(w) ?? lex2.get(w.replace(/台/g, "\u81FA")), py = x ? x[0].split(" ") : [];
        py.length !== [...w].length && (py = [...w].map((c) => lex2.get(c)?.[0].split(" ")[0] ?? "")), out.push({ text: w, py });
      }
    }
    let syl = [];
    for (let t of out) t.py && [...t.text].forEach((ch, i) => syl.push({ ch, t, i, alone: t.text.length === 1, word: t.text }));
    return syl.forEach((s, k) => {
      let prev = syl[k - 1], next = syl[k + 1], adjacent = (a, b) => !!a && !!b && (a.t === b.t || out.indexOf(b.t) === out.indexOf(a.t) + 1), nx = adjacent(s, next) ? next : void 0, pv = adjacent(prev, s) ? prev : void 0;
      if (s.alone && TWO[s.ch]) {
        let nextText = nx ? syl.slice(k + 1, k + 4).map((x) => x.ch).join("") : "", r = TWO[s.ch](pv?.word ?? "", nextText, pv?.word ?? "");
        r && (s.t.py[s.i] = r);
      }
      let cur = s.t.py[s.i];
      if (s.ch === "\u4E0D" && cur === "bu4" && nx && (s.t.py[s.i] = tone(nx.t.py[nx.i]) === 4 ? "bu2" : "bu4"), s.ch === "\u4E00" && cur === "yi1" && (s.alone || s.i < [...s.word].length - 1)) {
        let numeric = pv && NUM.test(pv.ch) || nx && (NUM.test(nx.ch) || /^[月號日樓點]$/.test(nx.ch));
        !nx || numeric ? s.t.py[s.i] = "yi1" : s.t.py[s.i] = [4, 5].includes(tone(nx.t.py[nx.i])) ? "yi2" : "yi4";
      }
    }), out;
  }
  var mark = (s) => s ? syllableToMarked(s) : "", word = (py) => {
    let w = py.map(mark).reduce((a, s, i) => i && /^[aeoāáǎàēéěèōóǒò]/.test(s) ? `${a}'${s}` : a + s, "");
    return /^[A-Z]/.test(py[0] ?? "") ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  }, PUNCT = { "\uFF0C": ",", "\u3002": ".", "\uFF01": "!", "\uFF1F": "?", "\uFF1A": ":", "\uFF1B": ";", "\u3001": ",", "\u300C": '"', "\u300D": '"', "\u300E": '"', "\u300F": '"', "\uFF08": "(", "\uFF09": ")", "\u2026": "...", "\u2014": "-", "\uFF5E": "~" };
  function sentence(lex2, text) {
    return text.split(`
`).map((line) => {
      let out = "", cap = !0;
      for (let t of tokens(lex2, line)) {
        if (!t.py) {
          let s = [...t.text].map((c) => PUNCT[c] ?? c).join("");
          out += s.replace(/([,.!?:;])(?=\S)/g, "$1 "), /[.!?]\s*$/.test(s) && (cap = !0);
          continue;
        }
        let w = word(t.py);
        cap && (w = w.charAt(0).toUpperCase() + w.slice(1), cap = !1), out += (out && !/[\s"(\-]$/.test(out) ? " " : "") + w;
      }
      return out.replace(/\s+([,.!?:;)])/g, "$1").replace(/ {2,}/g, " ").trim();
    }).join(`
`);
  }

  // site/src/cbp/kit/ruby.ts
  var HAN2 = /[㐀-䶿一-鿿豈-﫿]/, lex = null, LEX_URL = "/plus/pinyin.txt?v=1";
  function load() {
    return lex ??= fetch(LEX_URL).then((r) => r.ok ? r.text() : Promise.reject(new Error("pinyin"))).then(parseLex).catch((e) => (lex = null, Promise.reject(e)));
  }
  var esc2 = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function frag(L, text) {
    return tokens(L, text).map((t) => t.py && t.py.every(Boolean) ? `<span class="rbw">${[...t.text].map((c, i) => `<ruby>${esc2(c)}<rt>${esc2(mark(t.py[i]).toLowerCase())}</rt></ruby>`).join("")}</span>` : esc2(t.text)).join("");
  }
  function hidden(el2) {
    if (!el2) return !1;
    let cs = getComputedStyle(el2);
    return cs.visibility === "hidden" || cs.color === "transparent" || /rgba\([^)]*,\s*0\)$/.test(cs.color) || Number(cs.opacity) === 0;
  }
  var SKIP = 'rt,rp,script,style,textarea,input,[contenteditable="true"],[contenteditable="plaintext-only"],[data-noruby],.rb';
  async function on(el2) {
    if (!el2) return;
    let L = await load(), w = document.createTreeWalker(el2, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => HAN2.test(n.nodeValue ?? "") && !n.parentElement?.closest(SKIP) && !hidden(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    el2 instanceof Element && el2.classList.add("rb-on");
    let list = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n);
    for (let n of list) {
      let s = document.createElement("span");
      s.className = "rb", s.dataset.t = n.nodeValue ?? "", s.innerHTML = frag(L, n.nodeValue ?? ""), n.replaceWith(s);
    }
  }
  function off(el2) {
    el2?.querySelectorAll("span.rb").forEach((s) => s.replaceWith(document.createTextNode(s.dataset.t ?? ""))), el2 instanceof Element && el2.classList.remove("rb-on");
  }
  var RUBY = {
    on,
    off,
    set: (el2, show2) => show2 ? on(el2) : (off(el2), Promise.resolve()),
    html: async (text) => frag(await load(), text),
    shown: () => LAB.get("pinyin") === "on",
    ready: load,
    CSS: ".rb-on.rb-on{line-height:2.1}.rbw{white-space:nowrap}ruby{ruby-position:over;ruby-align:center;margin:0 .08em}rt{font-family:Inter,system-ui,sans-serif;font-size:max(.45em,var(--fs-xs,13.8px));font-weight:450;letter-spacing:0;color:#757B87;opacity:.8;-webkit-text-stroke:0;line-height:1.1}"
  };
  Object.assign(RUBY, { text: async (t) => sentence(await load(), t) });

  // site/src/cbp/kit/keys.ts
  var MAC = typeof navigator < "u" && /Mac|iPhone|iPad/.test(navigator.platform), D = (group, ctx, rows) => rows.map(([id, label, keys]) => ({ id, label, group, keys: keys.split(" "), ctx })), DEFS = [
    ...D("Everywhere", void 0, [
      ["extras", "Extras", "f1"],
      ["settings", "Settings", "mod+,"],
      ["shortcuts", "Shortcuts", "f12"],
      ["undo", "Undo", "mod+z"],
      ["redo", "Redo", "mod+shift+z mod+y"]
    ]),
    // to a page from anywhere: Shift and its place in the tabs, Shift+1 Today … Shift+5 Progress, Shift+6 the Tutor pane (again:
    // away); Browse, inside Reviews, is Shift+B (go.ts). Not while he types in a field, nor over a dialog other than Settings
    // (KEYS.free)
    ...D("Pages", void 0, [
      ["page.today", "Today", "shift+1"],
      ["page.reviews", "Reviews", "shift+2"],
      ["page.browse", "Browse", "shift+b"],
      ["page.cards", "Cards", "shift+3"],
      ["page.essays", "Essays", "shift+4"],
      ["page.progress", "Progress", "shift+5"],
      ["page.tutor", "Tutor", "shift+6"]
    ]),
    ...D("Reviews", void 0, [
      ["rv.show", "Show answer", "space enter"],
      ["rv.again", "Again", "1"],
      ["rv.hard", "Hard", "2"],
      ["rv.good", "Good", "3"],
      ["rv.easy", "Easy", "4"],
      ["rv.play", "Play", "v"],
      ["rv.pinyin", "Pinyin", "p"],
      ["rv.edit", "Edit", "e"],
      ["rv.flag", "Flag", "f"],
      ["rv.suspend", "Suspend", "s"]
    ]),
    ...D("Reviews", "flags", [
      ["rv.red", "Red flag", "r"],
      ["rv.green", "Green flag", "g"],
      ["rv.noflag", "No flag", "n 0"]
    ]),
    ...D("Reviews", "editing", [
      ["rv.voice", "Play the sentence", "v"],
      ["rv.revoice", "Make its audio again", "shift+v"]
    ]),
    // Combine: Browse's rows by keyboard, E edits the open one; in Edit, ← and → go through the word's cards (no caret in a field)
    ...D("Browse", void 0, [
      ["br.down", "Next row", "arrowdown"],
      ["br.up", "Previous row", "arrowup"],
      ["br.edit", "Edit", "e"]
    ]),
    ...D("Reviews", "editing", [
      ["ed.prev", "Previous card of the word", "arrowleft"],
      ["ed.next", "Next card of the word", "arrowright"]
    ]),
    // (end Combine)
    ...D("Cards", void 0, [
      ["cd.prev", "Back", "arrowleft"],
      ["cd.next", "Next word", "arrowright"],
      ["cd.write", "Write it, then card it", "enter"],
      ["cd.voice", "Play the sentence", "v"],
      ["cd.images", "Pictures on the web", "i"]
    ]),
    ...D("Cards", "field", [["cd.add", "Add and move on", "mod+shift+enter"]]),
    ...D("Card fields", "field", [["cd.mark", "Highlight", "mod+shift+h"]]),
    // Cards: add and stay, Gemini, rich text in the card's fields
    ...D("Cards", void 0, [["cd.gemini", "Gemini", "g"]]),
    ...D("Cards", "field", [["cd.addstay", "Add and stay", "mod+enter"]]),
    // a card's fields, wherever they're edited (Cards' Add, Reviews' Edit): kit/editor.ts
    ...D("Card fields", "field", [
      ["cd.bold", "Bold", "mod+b"],
      ["cd.italic", "Italic", "mod+i"],
      ["cd.underline", "Underline", "mod+u"]
    ]),
    // (end Cards)
    ...D("Cards", "sentence", [
      ["cd.copy", "Copy the sentence", "space"],
      ["cd.pinyin", "Pinyin over the sentence", "shift+enter"]
    ]),
    // a test's choices take their letters while it's on screen
    ...D("Today", "test", [
      ["test.a", "Choice A", "a"],
      ["test.b", "Choice B", "b"],
      ["test.c", "Choice C", "c"],
      ["test.d", "Choice D", "d"]
    ]),
    ...D("Essays", "field", [
      ["im.up", "Move up", "mod+shift+arrowup"],
      ["im.down", "Move down", "mod+shift+arrowdown"]
    ])
  ], BY = new Map(DEFS.map((d) => [d.id, d])), RETIRED = ["go.today", "go.cards", "go.reviews", "go.browse", "tutor", "back", "forward"], OLD = { "page.today": "shift+t", "page.reviews": "shift+r", "page.cards": "shift+c", "page.essays": "shift+e", "page.progress": "shift+p", "page.tutor": "shift+a" }, TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])', typing = (t) => !!(t && t.closest?.(TYPING)), openDialogs = () => typeof document > "u" ? [] : [...document.querySelectorAll("dialog[open]")].map((d) => d.id);
  function free(e, dialogs = openDialogs()) {
    return e.defaultPrevented || e.isComposing || e.repeat || typing(e.target) ? !1 : dialogs.every((id) => id === "settings");
  }
  var mine = {}, saveHook = null;
  function combo(e) {
    let k = e.key;
    e.altKey && /^Key[A-Z]$/.test(e.code) ? k = e.code.slice(3) : (e.altKey || e.shiftKey) && /^Digit\d$/.test(e.code) && (k = e.code.slice(5)), k = k === " " ? "space" : k.toLowerCase(), k === "esc" && (k = "escape");
    let m = [];
    return (MAC ? e.metaKey : e.ctrlKey) && m.push("mod"), MAC && e.ctrlKey && m.push("ctrl"), !MAC && e.metaKey && m.push("meta"), e.altKey && m.push("alt"), e.shiftKey && (k.length > 1 || /[a-z0-9]/.test(k)) && m.push("shift"), [...m, k].join("+");
  }
  var keysOf = (id) => mine[id] != null ? mine[id].split(" ").filter(Boolean) : BY.get(id)?.keys ?? [], MODS = ["control", "shift", "alt", "meta", "os", "capslock", "fn"], KEYS2 = {
    defs: DEFS,
    is: (e, id) => !e.isComposing && keysOf(id).includes(combo(e)),
    free,
    typing,
    keys: keysOf,
    label(id) {
      let k = keysOf(id)[0];
      return k ? pretty(k) : "";
    },
    pretty,
    combo,
    isModifier: (e) => MODS.includes(e.key.toLowerCase()),
    /** Binds an action to one combo (null: back to its default). An action it clashes with gets this one's old key. */
    bind(id, k) {
      let d = BY.get(id);
      if (!d) return;
      let was = keysOf(id);
      if (k) {
        for (let o of DEFS) {
          if (o.id === id || !clash(d, o) || !keysOf(o.id).includes(k)) continue;
          let rest = keysOf(o.id).filter((x) => x !== k);
          mine[o.id] = (rest.length ? rest : was.slice(0, 1)).join(" "), mine[o.id] === o.keys.join(" ") && delete mine[o.id];
        }
        mine[id] = k, k === d.keys.join(" ") && delete mine[id];
      } else delete mine[id];
      saveHook?.({ ...mine });
    },
    reset() {
      mine = {}, saveHook?.({});
    },
    changed: (id) => mine[id] != null,
    /** settings.ts: what's saved on his account, and where changes go. */
    load(saved, onSave) {
      mine = Object.fromEntries(Object.entries(saved).filter(([id, k]) => !RETIRED.includes(id) && OLD[id] !== k)), saveHook = onSave;
    }
  }, ALL = (d) => d.group === "Everywhere" || d.group === "Pages", clash = (a, b) => (a.group === b.group || ALL(a) || ALL(b)) && (a.ctx ?? "") === (b.ctx ?? ""), NAMES = MAC ? { mod: "\u2318", shift: "\u21E7", alt: "\u2325", ctrl: "\u2303", enter: "\u21B5", space: "Space", escape: "Esc", arrowleft: "\u2190", arrowright: "\u2192", arrowup: "\u2191", arrowdown: "\u2193", backspace: "\u232B", tab: "\u21E5" } : { mod: "Ctrl+", shift: "Shift+", alt: "Alt+", meta: "Win+", enter: "Enter", space: "Space", escape: "Esc", arrowleft: "\u2190", arrowright: "\u2192", arrowup: "\u2191", arrowdown: "\u2193", backspace: "Backspace", tab: "Tab" };
  function pretty(k) {
    return k.split("+").map((p, i, a) => i === a.length - 1 ? NAMES[p] ?? (p.length === 1, p.toUpperCase()) : NAMES[p] ?? p).join("");
  }

  // site/src/cbp/kit/find.ts
  var esc3 = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]), words = (q2) => [...new Set(q2.toLowerCase().split(/\s+/).filter(Boolean))];
  function hit(ws, ...texts) {
    let hay = texts.join(`
`).toLowerCase();
    return ws.every((w) => hay.includes(w));
  }
  function marked(text, ws) {
    let low = text.toLowerCase(), on2 = new Uint8Array(text.length);
    for (let w of ws)
      for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) on2.fill(1, i, i + w.length);
    let out = "";
    for (let i = 0; i < text.length; ) {
      let j = i;
      for (; j < text.length && on2[j] === on2[i]; ) j++;
      let part = esc3(text.slice(i, j));
      out += on2[i] ? `<mark>${part}</mark>` : part, i = j;
    }
    return out;
  }

  // site/src/cbp/kit/settings.ts
  var M = [["haiku", "Haiku"], ["sonnet", "Sonnet"], ["opus", "Opus"]], A = { scope: "account" }, TOUCH = matchMedia("(hover: none)").matches, firstRun = lsGet("lab-acct") == null;
  LAB.define("text-size", "Text size", [["normal", "Normal"], ["larger", "Larger"]], "normal", "Everyday");
  LAB.define("pinyin", "Pinyin shown", [["on", "On"], ["off", "Off"]], "off", "Everyday");
  LAB.define("autoplay", "Card audio plays by itself", [["on", "On"], ["off", "Off"]], TOUCH ? "off" : "on", "Everyday");
  LAB.define("card-model", "Cards written by", M, "sonnet", "AI", A);
  LAB.define("card-ahead", "Next five written ahead", [["on", "On"], ["off", "Off"]], "on", "AI", A);
  LAB.define("pinyin-model", "Pinyin", M, "sonnet", "AI", A);
  LAB.define("idea-model", "Picture ideas", M, "sonnet", "AI", A);
  LAB.define("draw-model", "Drawings", [["both", "Both"], ["mai", "MAI"], ["flux", "Flux"]], "both", "AI", A);
  LAB.define("deeper-model", "Five minutes on a word", M, "sonnet", "AI", A);
  LAB.define("test-model", "Writing tests", M, "sonnet", "AI", A);
  LAB.define("grade-model", "Grading tests", M, "sonnet", "AI", A);
  LAB.define("essay-model", "Essay marks", M, "opus", "AI", A);
  LAB.define("tutor-model", "Tutor", M, "sonnet", "AI", A);
  var hm = (v) => `${+v.slice(0, 2) - 12}:${v.slice(3)} pm`;
  LAB.define("nudge", "Evening nudge", [["off", "Off"], ...Array.from({ length: 14 }, (_, i) => `${17 + (i >> 1)}:${i % 2 ? "30" : "00"}`).map((v) => [v, hm(v)])], "21:00", "Habit", A);
  var ORDER = ["text-size", "pinyin", "autoplay", "card-model", "card-ahead", "pinyin-model", "idea-model", "draw-model", "deeper-model", "test-model", "grade-model", "essay-model", "tutor-model"];
  LAB.define("combine-model", "Combine partners", M, "sonnet", "AI", A);
  ORDER.splice(ORDER.indexOf("deeper-model") + 1, 0, "combine-model");
  var token = () => lsGet("cb-token") ?? "", acctIds = () => Object.values(LAB.defs).filter((d) => d.scope === "account").map((d) => d.id), pushT = 0;
  LAB.push = () => {
    clearTimeout(pushT), pushT = window.setTimeout(() => {
      let values = Object.fromEntries(acctIds().map((id) => [id, LAB.get(id)]));
      fetch("/api/plus/settings", { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ values, keys: LAB.acct.keys ?? {} }) }).catch(() => {
      });
    }, 600);
  };
  KEYS2.load(LAB.acct.keys ?? {}, (keys) => {
    LAB.acct.keys = keys, LAB.saveAcct(), LAB.push();
  });
  (async () => {
    try {
      let r = await fetch("/api/plus/settings", { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" });
      if (!r.ok) return;
      let s = await r.json(), mine2 = !1;
      for (let id of acctIds()) {
        let old = firstRun ? lsGet("lab:" + id) : null, d = LAB.defs[id];
        if (old && old !== s.values[id] && d.options.some(([o]) => o === old) && old !== d.def) {
          mine2 = !0;
          continue;
        }
        s.values[id] && s.values[id] !== LAB.get(id) && LAB.set(id, s.values[id], "server");
      }
      LAB.acct.keys = s.keys ?? {}, KEYS2.load(LAB.acct.keys, (keys) => {
        LAB.acct.keys = keys, LAB.saveAcct(), LAB.push();
      }), LAB.saveAcct(), mine2 && LAB.push(), document.getElementById("settings")?.open && draw();
    } catch {
    }
  })();
  var SECS = [
    { id: "Everyday", label: "Everyday", icon: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>' },
    { id: "Reviews", label: "Reviews", icon: '<rect x="4" y="5" width="13" height="15" rx="2"/><path d="M8 2.8h10a2 2 0 0 1 2 2V17"/>' },
    { id: "Habit", label: "Habit", icon: '<path d="M4 12.5 9 17.5 20 6.5"/>' },
    { id: "AI", label: "AI", icon: '<path d="M12 3.5c.6 4.4 4.1 7.9 8.5 8.5-4.4.6-7.9 4.1-8.5 8.5-.6-4.4-4.1-7.9-8.5-8.5 4.4-.6 7.9-4.1 8.5-8.5z"/>' },
    { id: "Shortcuts", label: "Shortcuts", icon: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/>' }
  ], glyph = (d) => `<svg class="st-gl" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`, X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>', LENS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>', BACK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>', btn = document.getElementById("settingsbtn"), dlg = document.createElement("dialog");
  dlg.id = "settings";
  dlg.className = "st";
  dlg.setAttribute("aria-labelledby", "st-title");
  (document.getElementById("settings") ?? document.body.lastElementChild).replaceWith(dlg);
  dlg.isConnected || document.body.append(dlg);
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
  var sec = "Everyday", listening = "", q = "", sub = null, REDUCED = matchMedia("(prefers-reduced-motion: reduce)"), isSwitch = (d) => d.options.length === 2 && d.options[0][0] === "on" && d.options[1][0] === "off", sw = (attr, on2, label) => `<div class="st-row"><span class="st-l">${esc(label)}</span><button type="button" role="switch" class="st-tg" aria-checked="${on2}" aria-label="${esc(label)}" ${attr}><i></i></button></div>`;
  function row(d) {
    if (isSwitch(d)) return sw(`data-x="${d.id}" data-v="${d.v === "on" ? "off" : "on"}"`, d.v === "on", d.label);
    if (d.options.length > 3) return `<div class="st-row"><label class="st-l" for="st-${d.id}">${esc(d.label)}</label><span class="st-selw"><select class="st-sel" id="st-${d.id}" data-xs="${d.id}">${d.options.map(([v, l]) => `<option value="${esc(v)}"${d.v === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></span></div>`;
    let big = d.id === "text-size";
    return `<div class="st-row"><span class="st-l">${esc(d.label)}</span><span class="st-o${big ? " st-sz" : ""}" role="radiogroup" aria-label="${esc(d.label)}">${d.options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${d.v === v}" data-x="${d.id}" data-v="${esc(v)}"${big ? ` aria-label="${esc(l)}"` : ""}>${big ? `<span class="sz-${esc(v)}">Aa <span class="zh">\u4E2D\u6587</span></span>` : esc(l)}</button>`).join("")}</span></div>`;
  }
  function rowsBy() {
    let ids = [...ORDER.filter((id) => LAB.defs[id]), ...LAB.order.filter((id) => !ORDER.includes(id))], by = {};
    for (let id of ids) (by[LAB.defs[id].group] ??= []).push(row(LAB.defs[id]));
    for (let r of Object.values(LAB.rows)) {
      let h = r.html();
      h && (by[r.group] ??= []).push(`<div class="st-cust" data-row="${r.id}">${h}</div>`);
    }
    return (by.Everyday ??= []).unshift(sw("data-sound", SND.on, "Sound")), by;
  }
  function sections(by) {
    let extra = Object.keys(by).filter((g) => !SECS.some((s) => s.id === g)).map((g) => ({ id: g, label: g, icon: SECS[0].icon }));
    return [...SECS.filter((s) => s.id === "Shortcuts" || by[s.id]), ...extra].sort((a, b) => a.id === "Shortcuts" ? 1 : b.id === "Shortcuts" ? -1 : 0);
  }
  var changed = (s) => s === "Shortcuts" ? KEYS2.defs.some((d) => KEYS2.changed(d.id)) : LAB.order.some((id) => LAB.defs[id].group === s && LAB.get(id) !== LAB.defs[id].def);
  function keysHTML() {
    let groups = {};
    for (let d of KEYS2.defs) (groups[d.group] ??= []).push(d);
    return Object.entries(groups).map(
      ([g, ds]) => `<h4 class="st-cap">${esc(g)}</h4><div class="st-grp">${ds.map((d) => `<div class="st-row"><span class="st-l">${esc(d.label)}</span><button type="button" class="st-key${listening === d.id ? " on" : ""}${KEYS2.changed(d.id) ? " mine" : ""}" data-key="${d.id}" aria-label="${esc(d.label)}">${listening === d.id ? "Press a key" : KEYS2.keys(d.id).map((k) => `<kbd>${esc(KEYS2.pretty(k))}</kbd>`).join("") || "\u2014"}</button></div>`).join("")}</div>`
    ).join("");
  }
  function draw() {
    if (sub) return drawSub();
    dlg.classList.remove("st-wide");
    let a = document.activeElement, keep = a && dlg.contains(a) ? a.dataset.x ?? a.dataset.key ?? a.dataset.sec ?? a.dataset.xs ?? a.dataset.reset ?? (a.dataset.sound != null ? "sound" : a.id) : "", top = dlg.querySelector(".st-body")?.scrollTop ?? 0, by = rowsBy(), list = sections(by);
    list.some((s) => s.id === sec) || (sec = list[0].id), dlg.innerHTML = `<div class="st-grab" aria-hidden="true"></div>
    <nav class="st-side" aria-label="Sections"><h2 id="st-title">Settings</h2><div class="st-find${q ? " on" : ""}" role="search">${LENS}<input id="st-q" type="text" enterkeyhint="search" placeholder="Search" aria-label="Search settings" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(q)}"><button type="button" class="st-qx" aria-label="Clear">${X}</button></div><div class="st-toc">${list.map((s) => `<button type="button" class="st-ti" data-sec="${esc(s.id)}" aria-current="${s.id === sec}">${glyph(s.icon)}<span>${esc(s.label)}</span></button>`).join("")}</div></nav>
    <div class="st-main">
      <div class="st-head"><h2 class="st-now" aria-hidden="true">Settings</h2><button type="button" class="st-x" id="st-close" aria-label="Close">${X}</button></div>
      <div class="st-body">${list.map(
      (s) => `<section class="st-sec" data-s="${esc(s.id)}" aria-labelledby="st-s-${esc(s.id)}"><div class="st-sh"><h3 id="st-s-${esc(s.id)}">${esc(s.label)}</h3>${changed(s.id) ? `<button type="button" class="st-reset" data-reset="${esc(s.id)}">Reset</button>` : ""}</div>${s.id === "Shortcuts" ? keysHTML() : `<div class="st-grp">${by[s.id].join("")}</div>`}</section>`
    ).join("")}<div class="empty st-none" hidden>No matches</div></div>
    </div>`;
    for (let r of Object.values(LAB.rows)) {
      let el2 = dlg.querySelector(`[data-row="${r.id}"]`);
      el2 && r.bind(el2);
    }
    let nb = dlg.querySelector(".st-body");
    if (nb.scrollTop = top, nb.addEventListener("scroll", spy, { passive: !0 }), q && filter(!1), keep) {
      let sel = `[data-x="${keep}"][aria-checked="true"],[data-x="${keep}"],[data-key="${keep}"],[data-sec="${keep}"],[data-xs="${keep}"],[data-reset="${keep}"]`;
      if ((dlg.querySelector(sel) ?? (keep === "sound" ? dlg.querySelector("[data-sound]") : keep ? dlg.querySelector("#" + CSS.escape(keep)) : null) ?? dlg.querySelector(".st-x"))?.focus({ preventScroll: !0 }), keep === "st-q") {
        let i = dlg.querySelector("#st-q");
        i.setSelectionRange(i.value.length, i.value.length);
      }
    }
    mark2();
  }
  var MARKS2 = ".st-l, .st-sh h3, .st-cap, .st-ti span, .st-o button:not([aria-label])", txt = (el2) => el2 ? el2.dataset?.t ?? el2.textContent ?? "" : "", rowText = (r) => [r.textContent ?? "", ...[...r.querySelectorAll("[aria-label]")].map((b) => b.getAttribute("aria-label"))].join(" ");
  function marks(root, ws) {
    root.querySelectorAll(MARKS2).forEach((el2) => {
      if (el2.dataset.t == null) {
        if (el2.children.length) return;
        el2.dataset.t = el2.textContent ?? "";
      }
      let h = ws.length ? marked(el2.dataset.t, ws) : esc(el2.dataset.t);
      el2.innerHTML !== h && (el2.innerHTML = h);
    });
  }
  function filter(top = !0) {
    let ws = words(q), body = dlg.querySelector(".st-body");
    if (!body) return;
    dlg.classList.toggle("st-q-on", ws.length > 0), dlg.querySelector(".st-find")?.classList.toggle("on", !!q);
    let shown = 0;
    for (let se of body.querySelectorAll(".st-sec")) {
      let name = txt(se.querySelector(".st-sh h3")), n = 0;
      for (let g of se.querySelectorAll(".st-grp")) {
        let cap = g.previousElementSibling?.matches(".st-cap") ? g.previousElementSibling : null, first = null, last = null;
        for (let r of [...g.children]) {
          let on2 = hit(ws, name, txt(cap), rowText(r));
          r.hidden = !on2, r.classList.remove("f0", "f1"), on2 && (first ??= r, last = r);
        }
        first?.classList.add("f0"), last?.classList.add("f1"), g.hidden = !first, cap && (cap.hidden = !first), first && n++;
      }
      se.hidden = !n;
      let ti = dlg.querySelector(`.st-ti[data-sec="${CSS.escape(se.dataset.s)}"]`);
      ti && (ti.hidden = !n), n && shown++;
    }
    if (marks(dlg, ws), body.querySelector(".st-none").hidden = shown > 0, !top) return;
    body.scrollTop = 0;
    let f = body.querySelector(".st-sec:not([hidden])");
    f && f.dataset.s !== sec && (sec = f.dataset.s, mark2());
  }
  function setQ(v) {
    q = v;
    let i = dlg.querySelector("#st-q");
    i && i.value !== v && (i.value = v), filter();
  }
  dlg.addEventListener("input", (e) => {
    e.target.id === "st-q" && setQ(e.target.value);
  });
  function drawSub() {
    sub && (dlg.classList.add("st-wide"), dlg.innerHTML = `<div class="st-grab" aria-hidden="true"></div><div class="st-page"><div class="st-ph"><button type="button" class="st-back" id="st-back">${BACK}<span>Settings</span></button><h2 id="st-title">${esc(sub.title)}</h2><button type="button" class="st-x" id="st-close" aria-label="Close">${X}</button></div><div class="st-pbody"></div></div>`, sub.render(dlg.querySelector(".st-pbody")));
  }
  function page(title, render, leave) {
    dlg.open || show(), endSub(), sub = { title, render, leave }, drawSub(), dlg.querySelector("#st-back").focus({ preventScroll: !0 });
  }
  function back() {
    sub && (endSub(), draw(), jump(sec, !1), (dlg.querySelector('.st-ti[aria-current="true"]') ?? dlg.querySelector("button"))?.focus({ preventScroll: !0 }));
  }
  function endSub() {
    if (!sub) return;
    let from = sub;
    sub = null, from.leave?.();
  }
  var jumping = 0;
  function mark2() {
    dlg.querySelectorAll(".st-ti").forEach((b) => b.setAttribute("aria-current", String(b.dataset.sec === sec)));
    let on2 = dlg.querySelector('.st-ti[aria-current="true"]'), toc = on2?.parentElement;
    on2 && toc && toc.scrollWidth > toc.clientWidth && toc.scrollTo({ left: on2.offsetLeft - (toc.clientWidth - on2.offsetWidth) / 2, behavior: REDUCED.matches ? "auto" : "smooth" });
  }
  function spy() {
    if (jumping) return;
    let b = dlg.querySelector(".st-body");
    if (!b) return;
    let all = [...b.querySelectorAll(".st-sec:not([hidden])")];
    if (!all.length) return;
    let line = b.getBoundingClientRect().top + b.clientHeight / 4, cur = all[0];
    for (let s of all) s.getBoundingClientRect().top <= line && (cur = s);
    b.scrollTop > 0 && b.scrollTop + b.clientHeight >= b.scrollHeight - 2 && (cur = all[all.length - 1]), cur && cur.dataset.s !== sec && (sec = cur.dataset.s, mark2());
  }
  function jump(to, smooth) {
    let b = dlg.querySelector(".st-body"), s = b?.querySelector(`.st-sec[data-s="${CSS.escape(to)}"]`);
    if (!b || !s) return;
    sec = to, mark2(), clearTimeout(jumping);
    let y = s === b.firstElementChild ? 0 : Math.round(b.scrollTop + s.getBoundingClientRect().top - b.getBoundingClientRect().top - parseFloat(getComputedStyle(b).paddingTop));
    if (!smooth || REDUCED.matches) {
      jumping = 0, b.scrollTop = y;
      return;
    }
    jumping = window.setTimeout(() => jumping = 0, 700), b.addEventListener("scrollend", () => (clearTimeout(jumping), jumping = 0), { once: !0 }), b.scrollTo({ top: y, behavior: "smooth" });
  }
  var closing = 0;
  function show(to) {
    listening = "", to && endSub(), to === "keys" ? sec = "Shortcuts" : to && to !== "main" && (sec = to), clearTimeout(closing), dlg.classList.remove("out"), dlg.style.transform = "";
    let was = dlg.open;
    draw(), was || (dlg.showModal(), requestAnimationFrame(() => dlg.classList.add("on"))), (to || !was) && jump(sec, !1), btn.setAttribute("aria-expanded", "true"), (dlg.querySelector('.st-ti[aria-current="true"]') ?? dlg.querySelector("button"))?.focus({ preventScroll: !0 });
  }
  function hide(now = !1) {
    if (now && dlg.open) {
      clearTimeout(closing), listening = "", dlg.classList.remove("on", "out"), dlg.style.transform = "", btn.setAttribute("aria-expanded", "false"), dlg.close(), endSub();
      return;
    }
    !dlg.open || dlg.classList.contains("out") || (listening = "", dlg.classList.remove("on"), dlg.classList.add("out"), btn.setAttribute("aria-expanded", "false"), closing = window.setTimeout(() => {
      dlg.classList.remove("out"), dlg.style.transform = "", dlg.close(), endSub(), btn.focus({ preventScroll: !0 });
    }, REDUCED.matches ? 120 : 200));
  }
  btn.onclick = (e) => {
    e.stopPropagation(), sfx("tap"), dlg.open && !dlg.classList.contains("out") ? hide() : show();
  };
  dlg.addEventListener("cancel", (e) => {
    if (e.preventDefault(), sub) return back();
    if (q) return setQ("");
    hide();
  });
  dlg.addEventListener("click", (e) => {
    let t = e.target;
    if (t === dlg) {
      let r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return hide();
    }
    let b = t.closest("[data-x]");
    if (b)
      return LAB.set(b.dataset.x, b.dataset.v), sfx(b.getAttribute("role") === "switch" ? b.dataset.v === "on" ? "stamp-known" : "unstamp" : "tap"), draw();
    if (t.closest("[data-sound]"))
      return document.getElementById("snd").click(), SND.on && setTimeout(() => sfx("stamp-known"), 60), draw();
    let s = t.closest("[data-sec]");
    if (s)
      return sfx("tap"), jump(s.dataset.sec, !0);
    let k = t.closest("[data-key]");
    if (k)
      return listening = listening === k.dataset.key ? "" : k.dataset.key, sfx("tap"), draw();
    if (t.closest("#st-close")) return sfx("tap"), hide();
    if (t.closest("#st-back")) return sfx("tap"), back();
    if (t.closest(".st-qx"))
      return sfx("tap"), setQ(""), dlg.querySelector("#st-q")?.focus();
    let rs = t.closest("[data-reset]");
    if (rs) {
      let g = rs.dataset.reset;
      if (g === "Shortcuts") KEYS2.reset();
      else for (let id of LAB.order) LAB.defs[id].group === g && LAB.set(id, LAB.defs[id].def);
      return sfx("swish"), draw();
    }
  });
  dlg.addEventListener("change", (e) => {
    let s = e.target.closest("select[data-xs]");
    s && (LAB.set(s.dataset.xs, s.value), sfx("tap"), draw());
  });
  addEventListener(
    "keydown",
    (e) => {
      if (!listening || !dlg.open || KEYS2.isModifier(e)) return;
      e.preventDefault(), e.stopImmediatePropagation();
      let id = listening;
      listening = "", e.key !== "Escape" && (KEYS2.bind(id, KEYS2.combo(e)), sfx("stamp")), draw();
    },
    !0
  );
  document.addEventListener("keydown", (e) => {
    let up = dlg.open && !dlg.classList.contains("out");
    if (KEYS2.is(e, "shortcuts"))
      return e.preventDefault(), sfx("tap"), up && sec === "Shortcuts" ? hide() : show("keys");
    if (KEYS2.is(e, "settings"))
      return e.preventDefault(), sfx("tap"), up ? hide() : show();
    if (up && !sub && !listening && !e.isComposing) {
      if (e.key === "Escape" && q)
        return e.preventDefault(), setQ("");
      if (combo(e) === "mod+f" || e.key === "/" && !KEYS2.typing(e.target)) {
        e.preventDefault();
        let i = dlg.querySelector("#st-q");
        return i.focus(), i.select();
      }
      if (e.target.id === "st-q" && e.key === "Enter") {
        e.preventDefault();
        let r = dlg.querySelector(".st-body .st-grp:not([hidden]) > :not([hidden])");
        return (r?.matches("button") ? r : r?.querySelector("button, select, input"))?.focus();
      }
    }
    let ti = e.target.closest?.(".st-ti");
    if (up && ti && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
      e.preventDefault();
      let all = [...dlg.querySelectorAll(".st-ti")], i = all.indexOf(ti) + (/Up|Left/.test(e.key) ? -1 : 1), n = all[(i + all.length) % all.length];
      sfx("tap"), jump(n.dataset.sec, !0), n.focus();
    }
  });
  BUS.on("lab", () => dlg.open && !sub && draw());
  var PHONE = matchMedia("(max-width: 640px)");
  dlg.addEventListener("pointerdown", (e) => {
    if (!PHONE.matches || e.button !== 0 || !e.target.closest(".st-grab,.st-head,.st-ph") || e.target.closest("button")) return;
    let y0 = e.clientY, h = dlg.offsetHeight, dy = 0, last = { y: y0, t: e.timeStamp }, v = 0;
    try {
      dlg.setPointerCapture(e.pointerId);
    } catch {
    }
    dlg.classList.add("drag");
    let move = (m) => {
      let d = m.clientY - y0;
      dy = d > 0 ? d : -Math.sqrt(-d) * 2, dlg.style.transform = `translateY(${dy}px)`;
      let dt = m.timeStamp - last.t;
      dt > 0 && (v = (m.clientY - last.y) / dt), last = { y: m.clientY, t: m.timeStamp };
    }, up = () => {
      dlg.removeEventListener("pointermove", move), dlg.removeEventListener("pointerup", up), dlg.removeEventListener("pointercancel", up), dlg.classList.remove("drag"), dy > h / 3 || v > 0.5 ? (dlg.style.transform = "", hide()) : dlg.style.transform = "";
    };
    dlg.addEventListener("pointermove", move), dlg.addEventListener("pointerup", up), dlg.addEventListener("pointercancel", up);
  });
  var SETTINGS = { open: (to) => show(to), close: (now) => hide(now), redraw: () => dlg.open && !sub && draw(), page };

  // site/src/cbp/kit/place.ts
  function placeHash(p) {
    return p.v === "reviews" ? p.sub && p.sub !== "review" ? `#reviews/${p.sub}` : "#reviews" : p.v === "cards" ? p.sub ? `#cards/${encodeURIComponent(p.sub)}` : "#cards" : "#" + p.v;
  }
  function parsePlace(hash) {
    let h = String(hash || "").replace(/^#/, ""), i = h.indexOf("/"), v = i < 0 ? h : h.slice(0, i), sub2 = i < 0 ? "" : h.slice(i + 1);
    try {
      sub2 = decodeURIComponent(sub2);
    } catch {
    }
    return v === "reviews" ? { v, sub: ["browse", "designs"].includes(sub2) ? sub2 : "review" } : v === "cards" ? { v, sub: sub2.trim() } : { v, sub: "" };
  }
  var samePlace = (a, b) => !!a && !!b && a.v === b.v && a.sub === b.sub;
  function entryFor(was, now, restoring2) {
    return samePlace(was, now) ? "none" : !was || restoring2 || was.v === "cards" && now.v === "cards" && !was.sub ? "replace" : "push";
  }

  // site/src/cbp/kit/go.ts
  var TO = [
    ["page.today", "today"],
    ["page.reviews", "reviews", "review"],
    ["page.browse", "reviews", "browse"],
    ["page.cards", "cards"],
    ["page.essays", "essays"],
    ["page.progress", "progress"]
  ];
  addEventListener("keydown", (e) => {
    let hit2 = TO.find(([id]) => KEYS2.is(e, id));
    if (!hit2 || !VIEWS.includes(hit2[1]) || !KEYS2.free(e)) return;
    e.preventDefault(), SETTINGS.close(!0);
    let [, view, sub2] = hit2;
    if (view !== VIEW) {
      try {
        sfx("tap");
      } catch {
      }
      setView(view);
    }
    let b = sub2 && document.querySelector(`#view-reviews [data-v="${sub2}"]`);
    b && b.getAttribute("aria-current") !== "true" && b.click();
  });
  var restoring = !1, noteT = 0;
  function here() {
    if (!VIEW) return null;
    if (VIEW === "reviews") {
      let rx = document.querySelector("#view-reviews .rx")?.dataset.rx;
      return rx ? { v: VIEW, sub: rx } : null;
    }
    return VIEW === "cards" ? { v: VIEW, sub: typeof CD < "u" && CD?.cur || "" } : { v: VIEW, sub: "" };
  }
  var entry = () => history.state?.cbp ?? null;
  function write(p, how) {
    let url = location.pathname + location.search + placeHash(p);
    how === "push" ? history.pushState({ cbp: p }, "", url) : history.replaceState({ ...history.state || {}, cbp: p }, "", url);
  }
  function note() {
    clearTimeout(noteT), noteT = window.setTimeout(() => {
      let p = here();
      if (!p) return;
      let how = entryFor(entry(), p, restoring);
      how !== "none" && write(p, how);
    }, 0);
  }
  BUS.on("view", note);
  BUS.on("place", note);
  function land(p) {
    restoring = !0;
    try {
      SETTINGS.close(!0), document.querySelectorAll("dialog[open]").forEach((d) => d.close()), p.v === "cards" && p.sub && typeof openCard == "function" && !(typeof cardOf == "function" && cardOf(p.sub)?.dropped) ? openCard(p.sub, void 0, { write: !1 }) : p.v !== VIEW && setView(p.v);
      let rx = window.RX_go;
      p.v === "reviews" && rx && rx(p.sub || "review");
    } finally {
      window.setTimeout(() => restoring = !1, 0);
    }
  }
  addEventListener("popstate", (e) => {
    let p = e.state?.cbp ?? parsePlace(location.hash);
    if (!VIEWS.includes(p.v)) {
      let h = here();
      h && write(h, "replace");
      return;
    }
    if (!samePlace(here(), p)) {
      try {
        sfx("tap");
      } catch {
      }
      land(p);
    }
  });
  function start() {
    let q2 = new URLSearchParams(location.search).get("view"), p = parsePlace(location.hash || (q2 ? "#" + q2 : ""));
    if (p.v === "reviews")
      try {
        sessionStorage.setItem("cbp-rx", p.sub || "review");
      } catch {
      }
    p.v === "cards" && p.sub && typeof CD < "u" && CD && (CD.cur = CD.open = p.sub, CD.pend = { opt: { write: !1 } }), setView(p.v, !0);
  }
  Object.assign(window, { GO_start: start });

  // site/src/cbp/habit.ts
  var habit_exports = {};
  __export(habit_exports, {
    LOW_SENTENCES: () => LOW_SENTENCES,
    MILESTONES: () => MILESTONES,
    addDays: () => addDays,
    blank: () => blank,
    columns: () => columns,
    dayOf: () => dayOf,
    goal: () => goal,
    han: () => han,
    hold: () => hold,
    left: () => left,
    merge: () => merge,
    met: () => met,
    monday: () => monday,
    reviewDays: () => reviewDays,
    sentences: () => sentences,
    walk: () => walk
  });
  var LOW_SENTENCES = 3, HAN3 = /[㐀-鿿豈-﫿]/g, han = (t) => (String(t ?? "").match(HAN3) ?? []).length, sentences = (t) => String(t ?? "").split(/[。！？!?；;\n]+/).filter((s) => han(s) > 0).length, blank = () => ({ rv: 0, cleared: !0, chars: 0, sent: 0, cards: 0, test: !1 }), active = (d) => d.rv > 0 || d.chars > 0 || d.cards > 0 || d.test, met = (d, low) => d.cleared && (low ? d.sent >= 3 : d.chars > 0), hold = (d, writing, counted) => writing && !counted ? { ...d, chars: 0, sent: 0 } : d, MILESTONES = [7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365];
  function goal(streak, todayDone) {
    let need = Math.max(1, streak + (todayDone ? 0 : 1));
    return MILESTONES.find((m) => m >= need) ?? Math.ceil(need / 100) * 100;
  }
  var P = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)), K = (ms) => new Date(ms).toISOString().slice(0, 10), addDays = (s, n) => K(P(s) + n * 864e5), monday = (s) => addDays(s, -((new Date(P(s)).getUTCDay() + 6) % 7));
  function columns(year, end) {
    let out = [], col = null;
    for (let d = `${year}-01-01`; d <= end && d.startsWith(String(year)); d = addDays(d, 1)) {
      let row2 = (new Date(P(d)).getUTCDay() + 6) % 7, month = +d.slice(5, 7) - 1;
      (!col || row2 === 0 || d.endsWith("-01")) && (col && row2 === 0 && d.endsWith("-01") && out.push({ month, first: !1, days: Array(7).fill(null) }), col = Array(7).fill(null), out.push({ month, first: d.endsWith("-01"), days: col })), col[row2] = d;
    }
    return out;
  }
  var dayOf = (ms, tzMin = 480, rollover = 4) => K(ms + tzMin * 6e4 - rollover * 36e5);
  function walk(days, today) {
    let out = {}, start2 = Object.keys(days).filter((k) => k <= today && days[k] && days[k].chars > 0).sort()[0];
    if (!start2) return { days: out, streak: 0, start: null, low: !1 };
    let prev = "pre", restWeek = "";
    for (let k = start2; k <= today; k = addDays(k, 1)) {
      let d = days[k] ?? blank(), low = prev === "miss", st;
      met(d, low) ? st = "done" : k === today ? st = "open" : restWeek !== monday(k) && (prev === "done" || prev === "rest") ? (st = "rest", restWeek = monday(k)) : st = active(d) ? "partial" : "miss", out[k] = { st, low, deep: st === "done" && d.test }, prev = st === "partial" ? "miss" : st;
    }
    let streak = 0;
    for (let k = today; out[k]; k = addDays(k, -1)) {
      let s = out[k].st;
      if (s === "done") streak++;
      else {
        if (s === "rest" || s === "open") continue;
        break;
      }
    }
    return { days: out, streak, start: start2, low: out[today]?.low ?? !1 };
  }
  function reviewDays(cards, day, today) {
    let count = /* @__PURE__ */ new Map(), diff = /* @__PURE__ */ new Map(), mark3 = (a, b) => {
      b <= a || (diff.set(a, (diff.get(a) ?? 0) + 1), diff.set(b, (diff.get(b) ?? 0) - 1));
    }, list = [...cards], byNote = /* @__PURE__ */ new Map();
    for (let c of list) if (c.nid != null) for (let r of c.revs ?? []) r[1] >= 1 && r[1] <= 4 && (byNote.get(c.nid) ?? byNote.set(c.nid, /* @__PURE__ */ new Set()).get(c.nid)).add(day(r[0]));
    for (let c of list) {
      let sib = c.nid != null ? byNote.get(c.nid) : void 0, revs = [...c.revs ?? []].sort((a, b) => a[0] - b[0]);
      for (let i = 0; i < revs.length; i++) {
        let r = revs[i], d = day(r[0]);
        if (r[1] >= 1 && r[1] <= 4 && r[6] <= 3 && count.set(d, (count.get(d) ?? 0) + 1), !(r[2] > 0)) continue;
        let due = d + r[2], next = revs[i + 1], until = next ? day(next[0]) : c.queue >= 0 ? today : due;
        for (; sib && due < until && sib.has(due); ) due++;
        mark3(due, Math.min(until, today));
      }
    }
    let open = /* @__PURE__ */ new Set(), ks = [...diff.keys()].sort((a, b) => a - b), run = 0;
    for (let i = 0; i < ks.length - 1; i++)
      if (run += diff.get(ks[i]), run > 0) for (let x = ks[i]; x < ks[i + 1]; x++) open.add(x);
    return { count, open };
  }
  function merge(a, b) {
    let x = { ...blank(), cleared: !1, ...a ?? {} }, y = { ...blank(), cleared: !1, ...b ?? {} };
    return {
      rv: Math.max(+x.rv || 0, +y.rv || 0),
      cleared: !!(x.cleared || y.cleared),
      chars: Math.max(+x.chars || 0, +y.chars || 0),
      sent: Math.max(+x.sent || 0, +y.sent || 0),
      cards: Math.max(+x.cards || 0, +y.cards || 0),
      test: !!(x.test || y.test)
    };
  }
  function left(d, low) {
    let rv = !d?.cleared, es = !(d && (low ? d.sent >= 3 : d.chars > 0)), essay = low ? "three sentences" : "your essay";
    return rv && es ? `Reviews and ${essay}.` : rv ? "Reviews left." : low ? "Three sentences left." : "Your essay is left.";
  }

  // site/src/cbp/kit/editor.ts
  var BIT = { b: 1, i: 2, ul: 4, hl: 8 }, isChar = (p) => !!p && "c" in p, escT = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), isSp = (p) => isChar(p) && (p.c === " " || p.c === "\xA0"), edge = (p) => !p || "br" in p, hardSpace = (out, k) => edge(out[k - 1]) || edge(out[k + 1]) || isSp(out[k - 1]), escA = (t) => t.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  function write2(out) {
    let h = "", i = 0;
    for (; i < out.length; ) {
      let p = out[i];
      if ("br" in p) h += "<br>", i++;
      else if ("img" in p) h += `<img src="${escA(p.img.src)}"${p.img.from ? ` data-from="${escA(p.img.from)}"` : ""}>`, i++;
      else {
        let t = "";
        for (let q2 = out[i]; i < out.length && isChar(q2) && q2.f === p.f && q2.s === p.s; q2 = out[++i]) t += isSp(q2) ? hardSpace(out, i) ? "" : " " : q2.c;
        t = escT(t).replace(/\u0001/g, "&nbsp;"), p.f & BIT.hl && (t = `<mark>${t}</mark>`), p.f & BIT.ul && (t = `<u>${t}</u>`), p.f & BIT.i && (t = `<i>${t}</i>`), p.f & BIT.b && (t = `<b>${t}</b>`), p.s && (t = `<span style="${escA(p.s)}">${t}</span>`), h += t;
      }
    }
    return h;
  }
  function toggleRange(out, a, b, kind) {
    let bit = BIT[kind];
    a > b && ([a, b] = [b, a]);
    let all = out.slice(a, b).every((p) => !isChar(p) || !/\S/.test(p.c) || p.f & bit);
    return out.map((p, k) => k >= a && k < b && isChar(p) ? { ...p, f: all ? p.f & ~bit : p.f | bit } : p);
  }
  var BLOCK = /^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE)$/;
  function read(f) {
    let out = [], at = /* @__PURE__ */ new Map(), end = /* @__PURE__ */ new Map(), walk2 = (node, fl, sty) => {
      for (let n of node.childNodes) {
        if (n.nodeType === 3) {
          at.set(n, out.length);
          let v = n.nodeValue ?? "";
          for (let k = 0; k < v.length; k++) out.push({ c: v[k], f: fl, s: sty });
        } else if (n.nodeType === 1) {
          let el2 = n, t = el2.tagName, last = out[out.length - 1];
          if (BLOCK.test(t) && out.length && !(last && "br" in last) && out.push({ br: 1 }), at.set(n, out.length), t === "BR") out.push({ br: 1 });
          else if (t === "IMG") out.push({ img: { src: el2.getAttribute("src") ?? "", from: el2.dataset.from } });
          else {
            let f2 = fl, s2 = sty, st = el2.style;
            (t === "B" || t === "STRONG" || +st?.fontWeight >= 600 || st?.fontWeight === "bold") && (f2 |= BIT.b), (t === "I" || t === "EM" || st?.fontStyle === "italic") && (f2 |= BIT.i), (t === "U" || /underline/.test(st?.textDecorationLine || st?.textDecoration || "")) && (f2 |= BIT.ul), t === "MARK" && (f2 |= BIT.hl), (st?.color || st?.backgroundColor) && (s2 = [st.color && `color:${st.color}`, st.backgroundColor && `background-color:${st.backgroundColor}`].filter(Boolean).join(";")), walk2(el2, f2, s2);
          }
        }
        end.set(n, out.length);
      }
    };
    return walk2(f, 0, ""), { out, at, end };
  }
  function index(f, m, node, off2) {
    if (node.nodeType === 3) return (m.at.get(node) ?? 0) + off2;
    let kids = node.childNodes;
    return off2 < kids.length ? m.at.get(kids[off2]) ?? 0 : node === f ? m.out.length : m.end.get(node) ?? m.out.length;
  }
  function selOf(f) {
    let s = getSelection();
    if (!s || !s.rangeCount) return null;
    let r = s.getRangeAt(0);
    if (!f.contains(r.startContainer) || !f.contains(r.endContainer)) return null;
    let m = read(f);
    return [index(f, m, r.startContainer, r.startOffset), index(f, m, r.endContainer, r.endOffset)];
  }
  function point(f, i) {
    let m = read(f);
    for (let [n, a] of m.at) if (n.nodeType === 3 && i >= a && i <= a + (n.nodeValue ?? "").length) return [n, i - a];
    for (let [n, a] of m.at) if (n.nodeType === 1 && a === i && /^(BR|IMG)$/.test(n.tagName)) return [n.parentNode, [...n.parentNode.childNodes].indexOf(n)];
    return [f, f.childNodes.length];
  }
  function select(f, a, b = a) {
    let r = document.createRange();
    try {
      r.setStart(...point(f, a)), r.setEnd(...point(f, b));
    } catch {
      return;
    }
    let s = getSelection();
    s?.removeAllRanges(), s?.addRange(r);
  }
  var KEEP = /* @__PURE__ */ new Set(["B", "STRONG", "I", "EM", "U", "MARK", "BR", "DIV", "P", "SPAN", "IMG", "UL", "OL", "LI", "SUB", "SUP", "FONT"]), DROP = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "IFRAME", "OBJECT", "SVG", "NOSCRIPT", "TEMPLATE"]);
  function clean(html) {
    let t = document.createElement("template");
    return t.innerHTML = html, function walk2(node) {
      for (let n of [...node.childNodes]) {
        if (n.nodeType === 8 && n.remove(), n.nodeType !== 1) continue;
        let el2 = n;
        if (DROP.has(el2.tagName)) {
          el2.remove();
          continue;
        }
        if (walk2(el2), !KEEP.has(el2.tagName)) {
          el2.replaceWith(...el2.childNodes);
          continue;
        }
        let src = el2.tagName === "IMG" ? (el2.getAttribute("src") || "").replace(location.origin + "/api/plus/media/", "/api/plus/media/") : "", color = el2.style?.color, bg = el2.style?.backgroundColor, fw = el2.style?.fontWeight, ul = /underline/.test(el2.style?.textDecorationLine || el2.style?.textDecoration || "");
        for (let a of [...el2.attributes]) el2.removeAttribute(a.name);
        el2.tagName === "IMG" && (/^(https:|data:image\/|blob:|\/api\/plus\/media\/)/.test(src) ? el2.setAttribute("src", src) : el2.remove()), color && (el2.style.color = color), bg && (el2.style.backgroundColor = bg), fw && +fw >= 600 && (el2.style.fontWeight = "bold"), ul && el2.tagName === "SPAN" && (el2.style.textDecoration = "underline");
      }
    }(t.content), t.innerHTML;
  }
  var ROOTS = [], FMT = null, TOUCH2 = () => matchMedia("(pointer:coarse)").matches;
  function fieldOf(n) {
    let el2 = n && (n.nodeType === 1 ? n : n.parentElement);
    for (let R2 of ROOTS) {
      let f = el2?.closest(R2.sel);
      if (f && R2.root.contains(f) && R2.root.isConnected) return { f, ed: R2.ed };
    }
    return null;
  }
  function placeFmt() {
    if (!FMT) return;
    let s = getSelection(), r = s && s.rangeCount ? s.getRangeAt(0) : null, hit2 = r && !s.isCollapsed ? fieldOf(r.commonAncestorContainer) : null;
    if (!TOUCH2() || !hit2 || !hit2.f.offsetParent) return FMT.hidden = !0, void (FMT._f = null);
    FMT._f = hit2;
    let home = hit2.f.closest("dialog") ?? document.body;
    FMT.parentElement !== home && home.appendChild(FMT), FMT.hidden = !1;
    let rect = r.getBoundingClientRect(), vv = visualViewport, top = vv ? vv.offsetTop : 0, h = vv ? vv.height : innerHeight, w = FMT.offsetWidth, bh = FMT.offsetHeight, y = rect.bottom + 14;
    y + bh > top + h - 8 && (y = rect.top - bh - 14), FMT.style.left = Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2)) + "px", FMT.style.top = Math.max(top + 8, y) + "px";
  }
  function fmtBar() {
    FMT || (FMT = document.createElement("div"), FMT.className = "rv-fmt", FMT.hidden = !0, FMT.innerHTML = '<button type="button" data-k="b" aria-label="Bold"><b>B</b></button><button type="button" data-k="i" aria-label="Italic"><i>I</i></button><button type="button" data-k="ul" aria-label="Underline"><u>U</u></button><button type="button" data-k="hl" aria-label="Highlight"><span>H</span></button>', document.body.appendChild(FMT), FMT.addEventListener("pointerdown", (e) => e.preventDefault()), FMT.addEventListener("mousedown", (e) => e.preventDefault()), FMT.addEventListener("click", (e) => {
      let b = e.target.closest("[data-k]"), hit2 = FMT._f;
      !b || !hit2 || (hit2.ed.toggle(hit2.f, b.dataset.k), sfx("tap"), placeFmt());
    }), document.addEventListener("selectionchange", () => requestAnimationFrame(placeFmt)), visualViewport?.addEventListener("resize", () => FMT.hidden || placeFmt()), visualViewport?.addEventListener("scroll", () => FMT.hidden || placeFmt()), typeof BUS < "u" && BUS.on("view", () => FMT && (FMT.hidden = !0)));
  }
  var ATTACHED = /* @__PURE__ */ new WeakMap();
  function attach(root, o) {
    ATTACHED.get(root)?.abort();
    let ac = new AbortController();
    ATTACHED.set(root, ac);
    let on2 = (type, f) => root.addEventListener(type, f, { signal: ac.signal }), fieldIn = (t) => {
      let f = t?.closest?.(o.field);
      return f && root.contains(f) ? f : null;
    }, changed2 = (f) => o.changed?.(f), H = /* @__PURE__ */ new WeakMap(), hist = (f) => H.get(f) ?? (H.set(f, { u: [], r: [], t: 0, k: "" }), H.get(f));
    function snap(f, kind) {
      if (!f) return;
      let h = hist(f), now = Date.now();
      if (kind === "type" && h.k === "type" && now - h.t < 1e3) return void (h.t = now);
      h.u.push({ html: f.innerHTML, sel: selOf(f) }), h.u.length > 200 && h.u.shift(), h.r = [], h.k = kind, h.t = now;
    }
    function step(f, from, to) {
      let h = hist(f), x = h[from].pop();
      x && (h[to].push({ html: f.innerHTML, sel: selOf(f) }), h.k = "", f.innerHTML = x.html, x.sel && select(f, ...x.sel), changed2(f));
    }
    let pend = null, ed = {
      snap,
      undo: (f) => step(f, "u", "r"),
      redo: (f) => step(f, "r", "u"),
      forget: (f) => H.delete(f),
      reset: () => pend = null,
      toggle(f, kind) {
        let bit = BIT[kind], sel = selOf(f);
        if (!sel) return;
        let [a, b] = sel;
        a > b && ([a, b] = [b, a]);
        let { out } = read(f);
        if (a === b) {
          let before = out[a - 1], had = isChar(before) ? before.f & bit : 0, p = pend && pend.f === f && pend.at === a ? pend : { f, at: a, on: 0, off: 0 };
          p.on & bit ? p.on &= ~bit : p.off & bit ? p.off &= ~bit : had ? p.off |= bit : p.on |= bit, pend = p.on || p.off ? p : null;
          return;
        }
        snap(f, "format"), f.innerHTML = write2(toggleRange(out, a, b, kind)), select(f, a, b), changed2(f);
      }
    };
    function typed(f) {
      let p = pend;
      if (!p || p.f !== f) return;
      let sel = selOf(f);
      if (!sel || sel[0] !== sel[1] || sel[0] <= p.at) return;
      let { out } = read(f), c = sel[0];
      for (let k = p.at; k < c; k++) {
        let q2 = out[k];
        isChar(q2) && (q2.f = (q2.f | p.on) & ~p.off);
      }
      f.innerHTML = write2(out), select(f, c), pend = null;
    }
    on2("beforeinput", (e) => {
      let f = fieldIn(e.target);
      if (!f) return;
      let t = e.inputType || "";
      if (t === "historyUndo" || t === "historyRedo")
        return e.preventDefault(), t === "historyUndo" ? ed.undo(f) : ed.redo(f);
      let fm = { formatBold: "b", formatItalic: "i", formatUnderline: "ul" }[t];
      if (fm || t.startsWith("format")) {
        e.preventDefault(), fm && ed.toggle(f, fm);
        return;
      }
      t !== "insertCompositionText" && snap(f, /^(insertText|deleteContent(Backward|Forward))$/.test(t) ? "type" : "edit");
    }), on2("compositionstart", (e) => snap(fieldIn(e.target), "type")), on2("compositionend", (e) => {
      let f = fieldIn(e.target);
      f && setTimeout(() => (typed(f), changed2(f)));
    }), on2("input", (e) => {
      let f = fieldIn(e.target);
      f && !e.isComposing && pend && typed(f);
    }), on2("pointerdown", () => pend = null), on2("focusout", () => pend = null), on2("keydown", (e) => {
      let f = fieldIn(e.target);
      if (!f) return;
      let fmt = [["cd.bold", "b"], ["cd.italic", "i"], ["cd.underline", "ul"], ["cd.mark", "hl"]].find(([id]) => KEYS.is(e, id));
      if (fmt) {
        e.preventDefault(), e.stopPropagation(), ed.toggle(f, fmt[1]);
        return;
      }
      if (KEYS.is(e, "undo") || KEYS.is(e, "redo")) {
        e.preventDefault(), e.stopPropagation(), KEYS.is(e, "redo") ? ed.redo(f) : ed.undo(f);
        return;
      }
      /^(Arrow|Home|End|Page)/.test(e.key) && (pend = null);
    }), on2("paste", (e) => {
      let f = fieldIn(e.target);
      if (!f) return;
      e.preventDefault(), snap(f, "edit");
      let files = [...e.clipboardData?.files ?? []];
      if (files.length && o.files?.(files, f)) return changed2(f);
      let html = e.clipboardData?.getData("text/html");
      html ? document.execCommand("insertHTML", !1, clean(html)) : document.execCommand("insertText", !1, e.clipboardData?.getData("text/plain") || ""), o.pasted?.(f), changed2(f);
    }), on2("drop", (e) => {
      let f = fieldIn(e.target);
      if (!f) return;
      let files = [...e.dataTransfer?.files ?? []];
      if (snap(f, "edit"), !files.length) {
        setTimeout(() => {
          f.innerHTML = clean(f.innerHTML), o.pasted?.(f), changed2(f);
        });
        return;
      }
      e.preventDefault();
      let pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
      f.focus(), pos && (getSelection()?.removeAllRanges(), getSelection()?.addRange(pos)), o.files?.(files, f) && changed2(f);
    }), fmtBar();
    for (let i = ROOTS.length - 1; i >= 0; i--) ROOTS[i].root === root && ROOTS.splice(i, 1);
    ROOTS.push({ root, sel: o.field, ed });
    for (let i = ROOTS.length - 1; i >= 0; i--) !ROOTS[i].root.isConnected && ROOTS[i].root !== root && ROOTS.splice(i, 1);
    return ed;
  }
  var EDITOR = { attach, clean, write: write2, toggleRange, BIT };

  // site/src/cbp/kit/known.ts
  var HAN4 = /[㐀-䶿一-鿿豈-﫿]/, cache = /* @__PURE__ */ new WeakMap();
  function of(kit) {
    if (!kit) return { words: /* @__PURE__ */ new Set(), chars: /* @__PURE__ */ new Set() };
    let s = cache.get(kit);
    return s || (s = { words: new Set(String(kit.known ?? "").split(/\s+/).filter(Boolean)), chars: new Set([...String(kit.chars ?? "")].filter((c) => HAN4.test(c))) }, cache.set(kit, s)), s;
  }
  function needsPinyin(word2, s) {
    let w = String(word2 ?? "").trim();
    if (!HAN4.test(w) || s.words.has(w)) return !1;
    let han2 = [...w].filter((c) => HAN4.test(c));
    return !(han2.length === 1 && (s.chars.has(han2[0]) || s.words.has(han2[0])));
  }
  var KNOWN = { of, needsPinyin };

  // site/src/cbp/tries.ts
  var tries_exports = {};
  __export(tries_exports, {
    bare: () => bare,
    credit: () => credit,
    itemFor: () => itemFor,
    markKey: () => markKey,
    record: () => record,
    same: () => same,
    stateOf: () => stateOf
  });
  function markKey(m) {
    let h = 2166136261;
    for (let c of String(m.mine ?? "") + "" + String(m.nat ?? "")) h = Math.imul(h ^ c.codePointAt(0), 16777619);
    return "m" + (h >>> 0).toString(36);
  }
  var bare = (s) => String(s ?? "").normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase(), same = (attempt, fix) => !!bare(attempt) && bare(attempt) === bare(fix), stateOf = (tries, m) => {
    let v = tries?.[markKey(m)];
    return v === "right" || v === "wrong" || v === "shown" ? v : void 0;
  };
  function record(tries, m, t) {
    let cur = { ...tries ?? {} }, k = markKey(m);
    return (!cur[k] || cur[k] === "shown" && t !== "shown") && (cur[k] = t), cur;
  }
  var pkey = (p) => String(p ?? "").toLowerCase().replace(/[\s.,;:!?，。、；：！？()（）"“”'‘’「」…-]+/g, "");
  function itemFor(items, m) {
    let open = items.filter((x) => x && !x.done && !x.removed), mine2 = String(m.mine ?? "").trim();
    return open.find((x) => Number(x.day) === Number(m.day) && String(x.mine ?? "").trim() === mine2) ?? (m.p ? open.find((x) => x.p && pkey(x.p) === pkey(m.p)) : void 0);
  }
  function credit(x, day, s, ok, now = (/* @__PURE__ */ new Date()).toISOString()) {
    let tried = [.../* @__PURE__ */ new Set([...x.tried ?? [], day])].slice(-20);
    if (!ok) return { tried };
    let uses = [...(x.uses ?? []).filter((y) => y.day !== day), { day, s }].slice(-6), data = { uses, tried };
    return new Set(uses.map((y) => y.day)).size >= 3 && Object.assign(data, { done: !0, doneAt: now, proof: { day, s }, retired: !0 }), data;
  }

  // site/src/cbp/kit/main.ts
  Object.assign(window, { EDITOR, KNOWN });
  Object.assign(window, { SOUND, HOLD, RUBY, KEYS: KEYS2, SETTINGS });
  Object.assign(window, { HABIT: habit_exports });
  Object.assign(window, { TRIES: tries_exports });
  new MutationObserver((recs) => {
    for (let r of recs)
      for (let n of r.addedNodes) {
        if (!(n instanceof HTMLElement) || !n.classList.contains("toast")) continue;
        let top = [...document.querySelectorAll("dialog[open]")].filter((d) => d.matches(":modal")).pop();
        top && top.append(n);
      }
  }).observe(document.body, { childList: !0 });
  BUS.on("leave", () => SOUND.stop());
})();
