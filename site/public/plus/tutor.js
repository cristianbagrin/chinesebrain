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
  <form class="tu-in">
    <textarea rows="2" lang="zh-Hant" aria-label="Your answer" placeholder="\u4F60\u7684\u56DE\u7B54\u2026"></textarea>
    <button type="submit" class="tu-send" aria-label="Send"></button>
  </form>
  <div class="tu-bar"><button type="button" class="tu-new">New scene</button></div>
  <button type="button" class="tu-card" hidden>Card it</button>
</div>`;
  var LOG = $(".tu-log", VIEW_EL), FORM = $(".tu-in", VIEW_EL), BOX = $("textarea", VIEW_EL), CARD = $(".tu-card", VIEW_EL), talk = null, busy = !1, loaded = !1, zhSpan = (t) => t.replace(/([\u3400-\u9fff，。？！、「」『』：；…（）]+)/g, '<span class="zh">$1</span>');
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
    LOG.innerHTML = msgs.map((m) => `<div class="tu-m ${m.role === "user" ? "me" : "them"}">${m.role === "user" ? `<p class="zh pen">${esc(m.content).replace(/\n/g, "<br>")}</p>` : rich(m.content)}</div>`).join("") + (busy ? '<div class="tu-m them tu-wait"><p>\u2026</p></div>' : ""), LOG.lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" }), BOX.disabled = busy || !talk, FORM.classList.toggle("off", busy || !talk);
  }
  async function save() {
    talk && await api("db", { col: "tutor", id: talk.id, op: "set", data: talk }).catch(() => null);
  }
  async function turn() {
    if (talk) {
      busy = !0, paint();
      try {
        let r = await api("tutor", { messages: talk.msgs });
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
    talk = { id: now.toISOString().replace(/[^0-9]/g, "").slice(0, 14), started: now.toISOString(), msgs: [] }, await turn();
  }
  async function load() {
    loaded = !0;
    try {
      let last = (await api("db?col=tutor")).sort((a, b) => a.id < b.id ? -1 : 1).pop()?.data;
      if (last && Date.now() - Date.parse(last.started) < 18 * 36e5 && last.msgs?.length)
        return talk = last, paint();
    } catch {
    }
    fresh();
  }
  FORM.addEventListener("submit", (e) => {
    e.preventDefault();
    let t = BOX.value.trim();
    !t || busy || !talk || (BOX.value = "", talk.msgs.push({ role: "user", content: t }), turn());
  });
  BOX.addEventListener("keydown", (e) => {
    e.key === "Enter" && !e.shiftKey && !e.isComposing && (e.preventDefault(), FORM.requestSubmit());
  });
  $(".tu-new", VIEW_EL).addEventListener("click", () => !busy && fresh());
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
    CARD.style.left = `${r.left - box.left + r.width / 2}px`, CARD.style.top = `${r.top - box.top - 44}px`, CARD.dataset.w = t, CARD.hidden = !1;
  });
  CARD.addEventListener("pointerdown", (e) => e.preventDefault());
  CARD.addEventListener("click", () => card(CARD.dataset.w ?? ""));
  TAB.addEventListener("click", () => setView("tutor"));
  new MutationObserver(() => {
    !VIEW_EL.hidden && !loaded && load(), VIEW_EL.hidden || setTimeout(() => BOX.focus(), 50);
  }).observe(VIEW_EL, { attributes: !0, attributeFilter: ["hidden"] });
})();
