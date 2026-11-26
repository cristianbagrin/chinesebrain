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
  var TAB = document.createElement("button");
  TAB.type = "button";
  TAB.setAttribute("role", "tab");
  TAB.id = "tab-tutor";
  TAB.setAttribute("aria-controls", "view-tutor");
  TAB.setAttribute("aria-selected", "false");
  TAB.tabIndex = -1;
  TAB.textContent = "Tutor";
  document.getElementById("tab-essays").after(TAB);
  var VIEW_EL = document.createElement("section");
  VIEW_EL.className = "view";
  VIEW_EL.id = "view-tutor";
  VIEW_EL.setAttribute("role", "tabpanel");
  VIEW_EL.setAttribute("aria-labelledby", "tab-tutor");
  VIEW_EL.hidden = !0;
  document.getElementById("view-essays").after(VIEW_EL);
  VIEWS.splice(VIEWS.indexOf("essays") + 1, 0, "tutor");
  VIEW_EL.innerHTML = `<div class="tu">
  <div class="tu-log" aria-live="polite"></div>
  <div class="tu-dock">
    <form class="tu-in">
      <textarea rows="1" lang="zh-Hant" aria-label="Your answer"></textarea>
      <button type="submit" class="tu-send" aria-label="Send"></button>
    </form>
    <div class="tu-bar">
      <div class="tu-mode" role="radiogroup" aria-label="Mode">
        <button type="button" role="radio" data-mode="scene">Scene</button>
        <button type="button" role="radio" data-mode="ask">Ask</button>
      </div>
      <button type="button" class="tu-new">New</button>
    </div>
  </div>
  <button type="button" class="tu-card" hidden>Card it</button>
</div>`;
  var LOG = $(".tu-log", VIEW_EL), FORM = $(".tu-in", VIEW_EL), BOX = $("textarea", VIEW_EL), CARD = $(".tu-card", VIEW_EL), DOCK = $(".tu-dock", VIEW_EL);
  new ResizeObserver(() => VIEW_EL.style.setProperty("--tu-dock", `${DOCK.offsetHeight}px`)).observe(DOCK);
  function fit() {
    BOX.style.height = "auto", BOX.style.height = `${Math.min(BOX.scrollHeight, innerHeight * 0.4)}px`, FORM.classList.toggle("empty", !BOX.value.trim());
  }
  FORM.classList.add("empty");
  BOX.addEventListener("input", fit);
  var talk = null, busy = !1, loaded = !1, mode = (() => {
    try {
      return localStorage.getItem("tutor-mode") === "ask" ? "ask" : "scene";
    } catch {
      return "scene";
    }
  })(), talks = {};
  function showMode() {
    for (let b of VIEW_EL.querySelectorAll(".tu-mode button")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
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
  function paint() {
    let msgs = talk?.msgs ?? [];
    LOG.innerHTML = msgs.map((m) => `<div class="tu-m ${m.role === "user" ? "me" : "them"}">${m.role === "user" ? `<p class="zh pen">${esc(m.content).replace(/\n/g, "<br>")}</p>` : rich(m.content)}</div>`).join("") + (busy ? '<div class="tu-m them tu-wait"><p>\u2026</p></div>' : ""), RUBY.shown() && LOG.querySelectorAll(".tu-m.them").forEach((m) => void RUBY.on(m)), LOG.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" }), BOX.disabled = busy || !talk, FORM.classList.toggle("off", busy || !talk);
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
        busy = !1, paint(), BOX.focus();
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
  $(".tu-new", VIEW_EL).addEventListener("click", () => !busy && fresh());
  $(".tu-mode", VIEW_EL).addEventListener("click", (e) => {
    let m = e.target.closest("[data-mode]")?.dataset.mode;
    if (!(!m || m === mode || busy)) {
      mode = m;
      try {
        localStorage.setItem("tutor-mode", m);
      } catch {
      }
      showMode(), talks[m] ? (talk = talks[m], paint()) : fresh(), BOX.focus();
    }
  });
  function card(w) {
    if (w = w.replace(/[^㐀-鿿]/g, ""), !!w) {
      try {
        sfx("tap");
      } catch {
      }
      CARD.hidden = !0, setView("cards"), openCard(w, "tutor");
    }
  }
  LOG.addEventListener("click", (e) => {
    let b = e.target.closest(".tu-w");
    b && card(b.dataset.w);
  });
  document.addEventListener("selectionchange", () => {
    let s = getSelection(), t = s && !s.isCollapsed && LOG.contains(s.anchorNode) ? s.toString().replace(/[^㐀-鿿]/g, "") : "";
    if (!t || t.length > 12) return void (CARD.hidden = !0);
    let r = s.getRangeAt(0).getBoundingClientRect(), box = VIEW_EL.firstElementChild.getBoundingClientRect();
    CARD.dataset.w = t, CARD.hidden = !1;
    let half = CARD.offsetWidth / 2, x = r.left - box.left + r.width / 2;
    CARD.style.left = `${Math.max(half, Math.min(box.width - half, x))}px`, CARD.style.top = `${r.top - box.top - 44}px`;
  });
  CARD.addEventListener("pointerdown", (e) => e.preventDefault());
  CARD.addEventListener("click", () => card(CARD.dataset.w ?? ""));
  TAB.addEventListener("click", () => setView("tutor"));
  BUS.on("lab", (id) => id === "pinyin" && loaded && paint());
  new MutationObserver(() => {
    !VIEW_EL.hidden && !loaded && load(), VIEW_EL.hidden || setTimeout(() => BOX.focus(), 50);
  }).observe(VIEW_EL, { attributes: !0, attributeFilter: ["hidden"] });
})();
