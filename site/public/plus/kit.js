"use strict";
(() => {
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
  };

  // site/src/cbp/kit/hold.ts
  var R = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  function HOLD(btn2, o) {
    let ms = o.ms ?? 500;
    btn2.classList.add("hold"), btn2.style.setProperty("--hold-ms", `${ms}ms`);
    let t = 0, x = 0, y = 0, fired = !1, by = "", reset = () => {
      clearTimeout(t), t = 0, by = "", btn2.classList.remove("holding");
    }, start = (e, how) => {
      t || (fired = !1, by = how, btn2.classList.toggle("hold-still", R()), requestAnimationFrame(() => by && btn2.classList.add("holding")), t = window.setTimeout(() => {
        t = 0, fired = !0, btn2.classList.remove("holding"), btn2.classList.add("held"), setTimeout(() => btn2.classList.remove("held"), 260);
        try {
          navigator.vibrate?.(10);
        } catch {
        }
        o.hold(e);
      }, ms));
    }, down = (e) => {
      e.button !== 0 || btn2.disabled || (x = e.clientX, y = e.clientY, start(e, "ptr"));
    }, move = (e) => {
      by === "ptr" && Math.hypot(e.clientX - x, e.clientY - y) > 10 && reset();
    }, up = () => by === "ptr" && reset(), click = (e) => {
      if (fired) {
        fired = !1, e.preventDefault(), e.stopImmediatePropagation();
        return;
      }
      o.tap?.(e);
    }, kdown = (e) => {
      e.key !== " " && e.key !== "Enter" || (e.preventDefault(), e.repeat || start(e, "key"));
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
    let marked = MARKS[base[idx]][tone2];
    return base.slice(0, idx) + marked + base.slice(idx + 1);
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
    let c = [...run], n = c.length, best = new Array(n + 1).fill(-1 / 0), back = new Array(n + 1).fill(0);
    best[0] = 0;
    for (let i = 0; i < n; i++)
      if (best[i] !== -1 / 0)
        for (let len = 1; len <= MAX && i + len <= n; len++) {
          let w = c.slice(i, i + len).join("");
          if (len > 1 && !lex2.has(w)) continue;
          let v = best[i] + score(lex2, w);
          v > best[i + len] && (best[i + len] = v, back[i + len] = i);
        }
    let out = [];
    for (let j = n; j > 0; j = back[j]) out.push(c.slice(back[j], j).join(""));
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
  var mark = (s) => s ? syllableToMarked(s) : "";

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
    set: (el2, show) => show ? on(el2) : (off(el2), Promise.resolve()),
    html: async (text) => frag(await load(), text),
    shown: () => LAB.get("pinyin") === "on",
    ready: load,
    CSS: ".rb-on.rb-on{line-height:2.3}.rbw{white-space:nowrap}ruby{ruby-position:over;ruby-align:center;margin:0 .08em}rt{font-family:Inter,system-ui,sans-serif;font-size:max(.55em,14px);font-weight:450;letter-spacing:0;color:#757B87;-webkit-text-stroke:0;line-height:1.1}"
  };

  // site/src/cbp/kit/keys.ts
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform), D = (group, ctx, rows) => rows.map(([id, label, keys]) => ({ id, label, group, keys: keys.split(" "), ctx })), DEFS = [
    ...D("Everywhere", void 0, [
      ["extras", "Extras", "f1"],
      ["settings", "Settings", "mod+,"],
      ["shortcuts", "Shortcuts", "f12"],
      ["undo", "Undo", "mod+z"],
      ["redo", "Redo", "mod+shift+z mod+y"]
    ]),
    ...D("Reviews", void 0, [
      ["rv.show", "Show answer", "space enter"],
      ["rv.again", "Again", "1"],
      ["rv.hard", "Hard", "2"],
      ["rv.good", "Good", "3"],
      ["rv.easy", "Easy", "4"],
      ["rv.play", "Play", "v r"],
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
    ...D("Cards", void 0, [
      ["cd.prev", "Previous word", "arrowleft"],
      ["cd.next", "Next word", "arrowright"],
      ["cd.write", "Write it, then card it", "enter"],
      ["cd.voice", "Play the sentence", "v"],
      ["cd.images", "Pictures on the web", "i"]
    ]),
    ...D("Cards", "field", [
      ["cd.add", "Add", "mod+enter"],
      ["cd.mark", "Mark the word", "mod+u"]
    ]),
    ...D("Cards", "sentence", [
      ["cd.copy", "Copy the sentence", "space"],
      ["cd.pinyin", "Pinyin over the sentence", "shift+enter"]
    ]),
    ...D("Today", void 0, [
      ["test.a", "Choice A", "a"],
      ["test.b", "Choice B", "b"],
      ["test.c", "Choice C", "c"],
      ["test.d", "Choice D", "d"]
    ]),
    ...D("Essays", "field", [
      ["im.up", "Move up", "mod+shift+arrowup"],
      ["im.down", "Move down", "mod+shift+arrowdown"]
    ])
  ], BY = new Map(DEFS.map((d) => [d.id, d])), mine = {}, saveHook = null;
  function combo(e) {
    let k = e.key;
    e.altKey && /^Key[A-Z]$/.test(e.code) ? k = e.code.slice(3) : e.altKey && /^Digit\d$/.test(e.code) && (k = e.code.slice(5)), k = k === " " ? "space" : k.toLowerCase(), k === "esc" && (k = "escape");
    let m = [];
    return (MAC ? e.metaKey : e.ctrlKey) && m.push("mod"), MAC && e.ctrlKey && m.push("ctrl"), !MAC && e.metaKey && m.push("meta"), e.altKey && m.push("alt"), e.shiftKey && (k.length > 1 || /[a-z0-9]/.test(k)) && m.push("shift"), [...m, k].join("+");
  }
  var keysOf = (id) => mine[id] != null ? mine[id].split(" ").filter(Boolean) : BY.get(id)?.keys ?? [], MODS = ["control", "shift", "alt", "meta", "os", "capslock", "fn"], KEYS = {
    defs: DEFS,
    is: (e, id) => !e.isComposing && keysOf(id).includes(combo(e)),
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
      mine = { ...saved }, saveHook = onSave;
    }
  }, clash = (a, b) => (a.group === b.group || a.group === "Everywhere" || b.group === "Everywhere") && (a.ctx ?? "") === (b.ctx ?? ""), NAMES = MAC ? { mod: "\u2318", shift: "\u21E7", alt: "\u2325", ctrl: "\u2303", enter: "\u21B5", space: "Space", escape: "Esc", arrowleft: "\u2190", arrowright: "\u2192", arrowup: "\u2191", arrowdown: "\u2193", backspace: "\u232B", tab: "\u21E5" } : { mod: "Ctrl+", shift: "Shift+", alt: "Alt+", meta: "Win+", enter: "Enter", space: "Space", escape: "Esc", arrowleft: "\u2190", arrowright: "\u2192", arrowup: "\u2191", arrowdown: "\u2193", backspace: "Backspace", tab: "Tab" };
  function pretty(k) {
    return k.split("+").map((p, i, a) => i === a.length - 1 ? NAMES[p] ?? (p.length === 1, p.toUpperCase()) : NAMES[p] ?? p).join("");
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
  var ORDER = ["text-size", "pinyin", "autoplay", "card-model", "card-ahead", "pinyin-model", "idea-model", "draw-model", "deeper-model", "test-model", "grade-model", "essay-model", "tutor-model"], GROUPS = ["Everyday", "Reviews", "AI"], token = () => lsGet("cb-token") ?? "", acctIds = () => Object.values(LAB.defs).filter((d) => d.scope === "account").map((d) => d.id), pushT = 0;
  LAB.push = () => {
    clearTimeout(pushT), pushT = window.setTimeout(() => {
      let values = Object.fromEntries(acctIds().map((id) => [id, LAB.get(id)]));
      fetch("/api/plus/settings", { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ values, keys: LAB.acct.keys ?? {} }) }).catch(() => {
      });
    }, 600);
  };
  KEYS.load(LAB.acct.keys ?? {}, (keys) => {
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
      LAB.acct.keys = s.keys ?? {}, KEYS.load(LAB.acct.keys, (keys) => {
        LAB.acct.keys = keys, LAB.saveAcct(), LAB.push();
      }), LAB.saveAcct(), mine2 && LAB.push(), document.getElementById("settings").hidden || draw();
    } catch {
    }
  })();
  var btn = document.getElementById("settingsbtn"), box = document.getElementById("settings");
  btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
  var page = "main", listening = "", isSwitch = (d) => d.options.length === 2 && d.options[0][0] === "on" && d.options[1][0] === "off", sw = (attr, on2, label) => `<div class="st-row"><span class="st-l">${esc(label)}</span><button type="button" role="switch" class="st-tg" aria-checked="${on2}" aria-label="${esc(label)}" ${attr}><i></i></button></div>`;
  function row(d) {
    if (isSwitch(d)) return sw(`data-x="${d.id}" data-v="${d.v === "on" ? "off" : "on"}"`, d.v === "on", d.label);
    let big = d.id === "text-size";
    return `<div class="st-row"><span class="st-l">${esc(d.label)}</span><span class="st-o${big ? " st-sz" : ""}" role="radiogroup" aria-label="${esc(d.label)}">${d.options.map(([v, l]) => `<button type="button" role="radio" aria-checked="${d.v === v}" data-x="${d.id}" data-v="${esc(v)}"${big ? ` aria-label="${esc(l)}"` : ""}>${big ? `<span class="sz-${esc(v)}">Aa <span class="zh">\u4E2D\u6587</span></span>` : esc(l)}</button>`).join("")}</span></div>`;
  }
  function mainHTML() {
    let ids = [...ORDER.filter((id) => LAB.defs[id]), ...LAB.order.filter((id) => !ORDER.includes(id))], by = {};
    for (let id of ids) (by[LAB.defs[id].group] ??= []).push(row(LAB.defs[id]));
    for (let r of Object.values(LAB.rows)) (by[r.group] ??= []).push(`<div class="st-cust" data-row="${r.id}">${r.html()}</div>`);
    return by.Everyday?.unshift(sw("data-sound", SND.on, "Sound")), `<div class="st-top"><b>Settings</b><button class="btn-q" type="button" id="st-reset">Reset</button><button class="st-x" type="button" id="st-close" aria-label="Close">\xD7</button></div>
    ${[...GROUPS, ...Object.keys(by).filter((g) => !GROUPS.includes(g))].filter((g) => by[g]).map((g) => `<section class="st-g"><h3>${esc(g)}</h3>${by[g].join("")}</section>`).join("")}
    <section class="st-g"><h3>Shortcuts</h3><button type="button" class="st-row st-go" data-page="keys"><span class="st-l">All shortcuts</span><span class="st-k">${esc(KEYS.label("shortcuts"))}</span></button></section>`;
  }
  function keysHTML() {
    let groups = {};
    for (let d of KEYS.defs) (groups[d.group] ??= []).push(d);
    return `<div class="st-top"><button type="button" class="btn-q st-back" data-page="main">\u2039 Settings</button><b></b><button class="btn-q" type="button" id="st-kreset">Reset</button><button class="st-x" type="button" id="st-close" aria-label="Close">\xD7</button></div>
    ${Object.entries(groups).map(
      ([g, ds]) => `<section class="st-g"><h3>${esc(g)}</h3>${ds.map((d) => `<div class="st-row"><span class="st-l">${esc(d.label)}</span><button type="button" class="st-key${listening === d.id ? " on" : ""}${KEYS.changed(d.id) ? " mine" : ""}" data-key="${d.id}">${listening === d.id ? "Press a key" : KEYS.keys(d.id).map((k) => `<kbd>${esc(KEYS.pretty(k))}</kbd>`).join("") || "\u2014"}</button></div>`).join("")}</section>`
    ).join("")}`;
  }
  function draw() {
    let a = document.activeElement, keep = a && box.contains(a) ? a.dataset.x ?? a.dataset.key ?? (a.dataset.sound != null ? "sound" : a.dataset.page ?? "") : "", top = box.scrollTop;
    if (box.innerHTML = `<div class="st-in" role="dialog" aria-label="Settings">${page === "main" ? mainHTML() : keysHTML()}</div>`, page === "main") for (let r of Object.values(LAB.rows)) r.bind(box.querySelector(`[data-row="${r.id}"]`));
    box.scrollTop = top, keep && (box.querySelector(`[data-x="${keep}"][aria-checked="true"],[data-x="${keep}"],[data-key="${keep}"],[data-page="${keep}"]`) ?? (keep === "sound" ? box.querySelector("[data-sound]") : null))?.focus({ preventScroll: !0 });
  }
  function open(on2, to) {
    listening = "", on2 && (page = to ?? (box.hidden ? "main" : page)), box.hidden = !on2, btn.setAttribute("aria-expanded", String(on2)), on2 && (draw(), box.scrollTop = 0, (box.querySelector('[aria-checked="true"],.st-key') ?? box.querySelector("button"))?.focus({ preventScroll: !0 }));
  }
  btn.onclick = (e) => {
    e.stopPropagation(), sfx("tap"), open(box.hidden);
  };
  box.addEventListener("click", (e) => {
    e.stopPropagation();
    let t = e.target, b = t.closest("[data-x]");
    if (b)
      return LAB.set(b.dataset.x, b.dataset.v), sfx(b.getAttribute("role") === "switch" ? b.dataset.v === "on" ? "stamp-known" : "unstamp" : "tap"), draw();
    if (t.closest("[data-sound]"))
      return document.getElementById("snd").click(), SND.on && setTimeout(() => sfx("stamp-known"), 60), draw();
    let pg = t.closest("[data-page]");
    if (pg)
      return sfx("tap"), page = pg.dataset.page, listening = "", box.scrollTop = 0, draw();
    let k = t.closest("[data-key]");
    if (k)
      return listening = listening === k.dataset.key ? "" : k.dataset.key, sfx("tap"), draw();
    if (t.id === "st-close") return sfx("tap"), open(!1), btn.focus();
    if (t.id === "st-reset") {
      for (let id of LAB.order) LAB.set(id, LAB.defs[id].def);
      return sfx("swish"), draw();
    }
    if (t.id === "st-kreset")
      return KEYS.reset(), sfx("swish"), draw();
  });
  addEventListener(
    "keydown",
    (e) => {
      if (!listening || box.hidden || KEYS.isModifier(e)) return;
      e.preventDefault(), e.stopImmediatePropagation();
      let id = listening;
      listening = "", e.key !== "Escape" && (KEYS.bind(id, KEYS.combo(e)), sfx("stamp")), draw();
    },
    !0
  );
  document.addEventListener("keydown", (e) => {
    if (KEYS.is(e, "shortcuts"))
      return e.preventDefault(), sfx("tap"), open(box.hidden || page !== "keys", "keys");
    if (KEYS.is(e, "settings"))
      return e.preventDefault(), sfx("tap"), open(box.hidden, "main"), box.hidden && btn.focus();
    e.key === "Escape" && !box.hidden && (open(!1), btn.focus());
  });
  document.addEventListener("pointerdown", (e) => !box.hidden && !box.contains(e.target) && !btn.contains(e.target) && open(!1), !0);
  BUS.on("lab", () => !box.hidden && page === "main" && draw());
  var SETTINGS = { open: (to) => open(!0, to), close: () => open(!1), redraw: () => !box.hidden && draw() };

  // site/src/cbp/kit/main.ts
  Object.assign(window, { SOUND, HOLD, RUBY, KEYS, SETTINGS });
  BUS.on("leave", () => SOUND.stop());
})();
