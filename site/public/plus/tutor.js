"use strict";
(() => {
  // site/src/cbp/tutor/main.ts
  var $ = (s, el = document) => el.querySelector(s), esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]), token = () => {
    try {
      return localStorage.getItem("cb-token") ?? "";
    } catch {
      return "";
    }
  };
  async function api(path, body) {
    let r = await fetch("/api/plus/" + path, body === void 0 ? { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" } : { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "It didn\u2019t come through.");
    return j;
  }
  var PANE = document.createElement("aside");
  PANE.className = "tu-pane";
  PANE.id = "tutor";
  PANE.setAttribute("aria-label", "Tutor");
  PANE.inert = !0;
  var PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6M10 4v6l-3 4h10l-3-4V4M12 14v6"/></svg>', X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  PANE.innerHTML = `<div class="tu-top">
    <div class="tu-mode" role="radiogroup" aria-label="Mode">
      <button type="button" role="radio" data-mode="scene">Scene</button>
      <button type="button" role="radio" data-mode="ask">Ask</button>
    </div>
    <button type="button" class="tu-new">New</button>
    <button type="button" class="tu-ic tu-pin" aria-label="Pin" aria-pressed="false">${PIN}</button>
    <button type="button" class="tu-ic tu-x" aria-label="Close">${X}</button>
  </div>
  <div class="tu-scroll"><div class="tu">
    <div class="tu-log" aria-live="polite"></div>
    <button type="button" class="tu-card" hidden>Card it</button>
  </div></div>
  <div class="tu-dock">
    <form class="tu-in">
      <textarea rows="1" lang="zh-Hant" aria-label="Your answer"></textarea>
      <button type="submit" class="tu-send" aria-label="Send"></button>
    </form>
  </div>`;
  var FAB = document.createElement("button");
  FAB.type = "button";
  FAB.className = "tu-fab";
  FAB.setAttribute("aria-label", "Tutor");
  FAB.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z"/></svg>';
  document.body.append(PANE, FAB);
  var LOG = $(".tu-log", PANE), FORM = $(".tu-in", PANE), BOX = $("textarea", PANE), CARD = $(".tu-card", PANE), SCROLL = $(".tu-scroll", PANE), PINB = $(".tu-pin", PANE);
  function fit() {
    BOX.style.height = "auto", BOX.style.height = `${Math.min(BOX.scrollHeight, innerHeight * 0.4)}px`, FORM.classList.toggle("empty", !BOX.value.trim());
  }
  FORM.classList.add("empty");
  BOX.addEventListener("input", fit);
  var FINE = matchMedia("(hover: hover) and (pointer: fine)"), WIDE = matchMedia("(min-width: 900px)"), isOpen = () => PANE.classList.contains("open"), PIN_V = 1, pinned = (() => {
    try {
      let p = JSON.parse(localStorage.getItem("tutor-pane") ?? "null");
      return p?.v === PIN_V && p.pin === !0;
    } catch {
      return !1;
    }
  })();
  function setPin(on) {
    pinned = on, PINB.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem("tutor-pane", JSON.stringify({ v: PIN_V, pin: on }));
    } catch {
    }
  }
  function openPane(focus = !0) {
    PANE.style.transform = "", PANE.classList.remove("drag"), PANE.inert = !1, PANE.classList.add("open"), FAB.classList.remove("show"), document.documentElement.classList.add("tu-on"), loaded || load(), focus && FINE.matches && setTimeout(() => BOX.focus({ preventScroll: !0 }), 60);
  }
  function closePane() {
    PANE.style.transform = "", PANE.classList.remove("drag", "open"), CARD.hidden = !0, PANE.contains(document.activeElement) && document.activeElement.blur(), PANE.inert = !0, document.documentElement.classList.remove("tu-on"), pinned && setPin(!1);
  }
  var toggle = () => isOpen() ? closePane() : openPane();
  PINB.addEventListener("click", () => {
    try {
      sfx("tap");
    } catch {
    }
    setPin(!pinned);
  });
  $(".tu-x", PANE).addEventListener("click", () => {
    try {
      sfx("tap");
    } catch {
    }
    closePane();
  });
  FAB.addEventListener("click", () => {
    try {
      sfx("tap");
    } catch {
    }
    openPane();
  });
  var fabT = 0;
  addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType !== "mouse" || isOpen()) return;
      let near = e.clientX > innerWidth - 96 && e.clientY > innerHeight - 96, around = e.clientX > innerWidth - 200 && e.clientY > innerHeight - 200;
      near ? (clearTimeout(fabT), FAB.classList.add("show")) : !around && FAB.classList.contains("show") && (clearTimeout(fabT), fabT = window.setTimeout(() => FAB.classList.remove("show"), 250));
    },
    { passive: !0 }
  );
  document.documentElement.addEventListener("pointerleave", () => FAB.classList.remove("show"));
  document.addEventListener(
    "pointerdown",
    (e) => {
      let t = e.target;
      !isOpen() || pinned || PANE.contains(t) || FAB.contains(t) || t.closest?.("dialog") || swiping || closePane();
    },
    !0
  );
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen() || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    let a = document.activeElement;
    (PANE.contains(a) || !a || a === document.body) && (e.preventDefault(), closePane());
  });
  addEventListener("keydown", (e) => {
    !KEYS.is(e, "page.tutor") || !KEYS.free(e) || (e.preventDefault(), SETTINGS.close(!0), toggle());
  });
  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)"), swiping = !1, paneW = () => PANE.offsetWidth + 24;
  function at(x) {
    PANE.classList.add("drag"), PANE.style.transform = `translateX(${x}px)`;
  }
  function settle(x, v) {
    PANE.classList.remove("drag"), v > 0.4 || v > -0.4 && x > paneW() * 0.4 ? closePane() : openPane(!1);
  }
  var tr = null, begin = (x, y, t, from) => ({ x0: x, y0: y, x, t, v: 0, from, axis: "" });
  function step(x, y, t) {
    if (!tr) return !1;
    if (!tr.axis) {
      let dx = x - tr.x0, dy = y - tr.y0;
      if (Math.hypot(dx, dy) < 8 || (tr.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y", tr.axis === "y")) return !1;
      swiping = !0, PANE.inert = !1;
    }
    if (tr.axis !== "x") return !1;
    let dt = t - tr.t;
    dt > 0 && (tr.v = tr.v * 0.3 + (x - tr.x) / dt * 0.7), tr.x = x, tr.t = t;
    let p = tr.from + (x - tr.x0);
    return p < 0 && (p = -Math.sqrt(-p) * 2), at(Math.min(p, paneW())), !0;
  }
  function end(e) {
    tr?.axis === "x" ? settle(tr.from + (tr.x - tr.x0), e && e.timeStamp - tr.t > 100 ? 0 : tr.v) : tr && !isOpen() && (PANE.inert = !0), tr = null, setTimeout(() => swiping = !1);
  }
  addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1 || document.querySelector("dialog[open]")) return;
      let p = e.touches[0];
      isOpen() ? PANE.contains(e.target) && !e.target.closest("textarea") && (tr = begin(p.clientX, p.clientY, e.timeStamp, 0)) : p.clientX > innerWidth - 20 && (tr = begin(p.clientX, p.clientY, e.timeStamp, paneW()));
    },
    { passive: !0 }
  );
  addEventListener(
    "touchmove",
    (e) => {
      if (!tr) return;
      let p = e.touches[0];
      step(p.clientX, p.clientY, e.timeStamp) && e.cancelable ? e.preventDefault() : tr.axis === "y" && (tr = null);
    },
    { passive: !1 }
  );
  addEventListener("touchend", end);
  addEventListener("touchcancel", end);
  $(".tu-top", PANE).addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || e.target.closest("button")) return;
    tr = begin(e.clientX, e.clientY, e.timeStamp, 0);
    let move = (m) => step(m.clientX, m.clientY, m.timeStamp), up = (u) => {
      removeEventListener("pointermove", move), removeEventListener("pointerup", up), removeEventListener("pointercancel", up), end(u);
    };
    addEventListener("pointermove", move), addEventListener("pointerup", up), addEventListener("pointercancel", up);
  });
  var wx = 0, wT = 0, wv = 0;
  PANE.addEventListener(
    "wheel",
    (e) => {
      !isOpen() || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || (e.preventDefault(), wx = Math.max(-12, wx - e.deltaX), wv = -e.deltaX / 16, at(wx), clearTimeout(wT), wT = window.setTimeout(() => {
        settle(wx, wv), wx = 0;
      }, 120));
    },
    { passive: !1 }
  );
  var talk = null, busy = !1, loaded = !1, mode = (() => {
    try {
      return localStorage.getItem("tutor-mode") === "ask" ? "ask" : "scene";
    } catch {
      return "scene";
    }
  })(), talks = {};
  function showMode() {
    for (let b of PANE.querySelectorAll(".tu-mode button")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
    BOX.setAttribute("aria-label", mode === "ask" ? "Your question" : "Your answer");
  }
  var zhSpan = (t) => t.replace(/([\u3400-\u9fff，。？！、「」『』：；…（）]+)/g, '<span class="zh">$1</span>');
  function rich(t) {
    return t.split(`
`).map(
      (l) => l.split(/(⟦[^⟧]{1,30}⟧)/).map((part) => {
        let w = part.match(/^⟦([^⟧]+)⟧$/)?.[1];
        return w ? `<button type="button" class="tu-w" data-w="${esc(w)}">${esc(w)}</button>` : zhSpan(esc(part.replace(/\*\*/g, ""))).replace(/\u0001([^\u0001]*)\u0001/g, "<b>$1</b>").replace(/\u0001/g, "");
      }).join("")
    ).map((l) => `<p>${l}</p>`).join("");
  }
  var MODE = $(".tu-mode", PANE), TOP = $(".tu-top", PANE), DOCK = $(".tu-dock", PANE);
  function blank(on) {
    if (PANE.classList.contains("blank") === on) return;
    let y0 = FORM.getBoundingClientRect().top;
    PANE.classList.toggle("blank", on), on ? DOCK.prepend(MODE) : TOP.prepend(MODE);
    let dy = y0 - FORM.getBoundingClientRect().top;
    !dy || REDUCED.matches || !isOpen() || FORM.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 450, easing: "cubic-bezier(.32,.72,0,1)" });
  }
  function paint() {
    let msgs = talk?.msgs ?? [];
    blank(!msgs.length), LOG.innerHTML = msgs.map((m) => `<div class="tu-m ${m.role === "user" ? "me" : "them"}">${m.role === "user" ? `<p class="zh pen">${esc(m.content).replace(/\n/g, "<br>")}</p>` : rich(m.content)}</div>`).join("") + (busy ? '<div class="tu-m them tu-wait"><p>\u2026</p></div>' : ""), RUBY.shown() && LOG.querySelectorAll(".tu-m.them").forEach((m) => void RUBY.on(m)), SCROLL.scrollTo({ top: SCROLL.scrollHeight, behavior: REDUCED.matches ? "auto" : "smooth" }), BOX.disabled = busy || !talk, FORM.classList.toggle("off", busy || !talk);
  }
  async function save() {
    talk && await api("db", { col: "tutor", id: talk.id, op: "set", data: talk }).catch(() => null);
  }
  async function turn() {
    if (talk) {
      busy = !0, paint();
      try {
        let r = await api("tutor", { messages: talk.msgs, mode: talk.mode ?? "scene", id: talk.id });
        talk.msgs.push({ role: "assistant", content: r.text }), save();
      } catch (e) {
        talk.msgs.push({ role: "assistant", content: `(${e.message})` });
      } finally {
        busy = !1, paint(), isOpen() && FINE.matches && BOX.focus({ preventScroll: !0 });
      }
    }
  }
  async function fresh() {
    let now = /* @__PURE__ */ new Date();
    talk = talks[mode] = { id: now.toISOString().replace(/[^0-9]/g, "").slice(0, 14), started: now.toISOString(), msgs: [], mode }, mode === "scene" ? await turn() : paint();
  }
  async function load() {
    loaded = !0;
    try {
      let list = await api("db?col=tutor");
      for (let { data } of list.sort((a, b) => a.id < b.id ? -1 : 1))
        data && Date.now() - Date.parse(data.started) < 18 * 36e5 && data.msgs?.length && (talks[data.mode ?? "scene"] = data);
    } catch {
    }
    if (showMode(), talks[mode])
      return talk = talks[mode], paint();
    fresh();
  }
  FORM.addEventListener("submit", (e) => {
    e.preventDefault();
    let t = BOX.value.trim();
    !t || busy || !talk || (BOX.value = "", fit(), talk.msgs.push({ role: "user", content: t }), turn());
  });
  BOX.addEventListener("keydown", (e) => {
    e.key === "Enter" && !e.shiftKey && !e.isComposing && (e.preventDefault(), FORM.requestSubmit());
  });
  $(".tu-new", PANE).addEventListener("click", () => !busy && fresh());
  $(".tu-mode", PANE).addEventListener("click", (e) => {
    let m = e.target.closest("[data-mode]")?.dataset.mode;
    if (!(!m || m === mode || busy)) {
      mode = m;
      try {
        localStorage.setItem("tutor-mode", m);
      } catch {
      }
      showMode(), talks[m] ? (talk = talks[m], paint()) : fresh(), FINE.matches && BOX.focus({ preventScroll: !0 });
    }
  });
  function card(w) {
    if (w = w.replace(/[^㐀-鿿]/g, ""), !!w) {
      try {
        sfx("tap");
      } catch {
      }
      CARD.hidden = !0, (!pinned || !WIDE.matches) && closePane(), setView("cards"), openCard(w, "tutor");
    }
  }
  LOG.addEventListener("click", (e) => {
    let b = e.target.closest(".tu-w");
    b && card(b.dataset.w);
  });
  document.addEventListener("selectionchange", () => {
    let s = getSelection(), t = s && !s.isCollapsed && LOG.contains(s.anchorNode) ? s.toString().replace(/[^㐀-鿿]/g, "") : "";
    if (!t || t.length > 12) return void (CARD.hidden = !0);
    let r = s.getRangeAt(0).getBoundingClientRect(), box = $(".tu", PANE).getBoundingClientRect();
    CARD.dataset.w = t, CARD.hidden = !1;
    let half = CARD.offsetWidth / 2, x = r.left - box.left + r.width / 2;
    CARD.style.left = `${Math.max(half, Math.min(box.width - half, x))}px`, CARD.style.top = `${r.top - box.top - 44}px`;
  });
  CARD.addEventListener("pointerdown", (e) => e.preventDefault());
  CARD.addEventListener("click", () => card(CARD.dataset.w ?? ""));
  BUS.on("lab", (id) => id === "pinyin" && loaded && paint());
  (pinned && WIDE.matches || location.hash === "#tutor") && openPane(!1);
  pinned && PINB.setAttribute("aria-pressed", "true");
})();
