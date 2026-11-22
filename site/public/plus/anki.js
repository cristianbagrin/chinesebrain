"use strict";
(() => {
  // site/src/cbp/review/store.ts
  var S = {
    cards: /* @__PURE__ */ new Map(),
    notes: /* @__PURE__ */ new Map(),
    types: /* @__PURE__ */ new Map(),
    decks: /* @__PURE__ */ new Map(),
    confs: /* @__PURE__ */ new Map(),
    meta: /* @__PURE__ */ new Map(),
    usn: 0,
    outbox: /* @__PURE__ */ new Map(),
    online: navigator.onLine,
    syncing: !1,
    lastSync: 0,
    error: ""
  }, listeners = /* @__PURE__ */ new Set(), onChange = (f) => listeners.add(f), emit = (what) => listeners.forEach((f) => f(what)), dbp = null, db = () => dbp ??= new Promise((ok, no) => {
    let r = indexedDB.open("cbp-anki", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("rows"), r.result.createObjectStore("kv");
    }, r.onsuccess = () => ok(r.result), r.onerror = () => no(r.error);
  });
  async function tx(store, mode, f) {
    let d = await db();
    return new Promise((ok, no) => {
      let t = d.transaction(store, mode);
      f(t.objectStore(store)), t.oncomplete = () => ok(), t.onerror = () => no(t.error);
    });
  }
  async function all(store) {
    let d = await db();
    return new Promise((ok, no) => {
      let out = [], r = d.transaction(store).objectStore(store).openCursor();
      r.onsuccess = () => {
        let c = r.result;
        if (!c) return ok(out);
        out.push([c.key, c.value]), c.continue();
      }, r.onerror = () => no(r.error);
    });
  }
  function place(kind, id, data) {
    let n = Number(id), m = kind === "card" ? S.cards : kind === "note" ? S.notes : kind === "notetype" ? S.types : kind === "deck" ? S.decks : kind === "conf" ? S.confs : S.meta, k = kind === "meta" ? id : n;
    data == null ? m.delete(k) : m.set(k, data);
  }
  var current = (kind, id) => {
    let n = Number(id);
    return kind === "card" ? S.cards.get(n) : kind === "note" ? S.notes.get(n) : kind === "notetype" ? S.types.get(n) : kind === "deck" ? S.decks.get(n) : kind === "conf" ? S.confs.get(n) : S.meta.get(id);
  };
  async function load() {
    for (let [k, v] of await all("rows")) {
      let [kind, id] = String(k).split(":");
      place(kind, id, v);
    }
    for (let [k, v] of await all("kv"))
      k === "usn" && (S.usn = v), k === "outbox" && (S.outbox = new Map(v.map((o) => [`${o.kind}:${o.id}`, o])));
    return S.meta.has("col");
  }
  async function put(kind, id, data, drop) {
    let key = `${kind}:${id}`, mod = Date.now();
    data && (data.mod = mod), place(kind, String(id), data);
    let prev = S.outbox.get(key);
    S.outbox.set(key, { kind, id: String(id), data, mod, drop: [...prev?.drop ?? [], ...drop ?? []] }), await tx("rows", "readwrite", (s) => data == null ? s.delete(key) : s.put(data, key)), await saveOutbox(), emit(kind), soon();
  }
  async function putMany(items) {
    let mod = Date.now();
    for (let [kind, id, data] of items)
      data && (data.mod = mod), place(kind, String(id), data), S.outbox.set(`${kind}:${id}`, { kind, id: String(id), data, mod });
    await tx("rows", "readwrite", (s) => items.forEach(([kind, id, data]) => data == null ? s.delete(`${kind}:${id}`) : s.put(data, `${kind}:${id}`))), await saveOutbox(), emit("many"), soon();
  }
  var saveOutbox = () => tx("kv", "readwrite", (s) => s.put([...S.outbox.values()], "outbox")), token = () => {
    try {
      return localStorage.getItem("cb-token") ?? "";
    } catch {
      return "";
    }
  };
  async function api(path, body) {
    let r = await fetch("/api/plus/" + path, body === void 0 ? { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" } : { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "It didn\u2019t come through."), { status: r.status, code: j.code });
    return j;
  }
  var timer, soon = () => {
    clearTimeout(timer), timer = setTimeout(sync, 1500);
  };
  async function sync() {
    if (!(S.syncing || !navigator.onLine)) {
      S.syncing = !0, emit("sync");
      try {
        for (; S.outbox.size; ) {
          let batch = [...S.outbox.values()].slice(0, 200), r = await api("anki/push", { ops: batch });
          for (let o of batch) S.outbox.get(`${o.kind}:${o.id}`) === o && S.outbox.delete(`${o.kind}:${o.id}`);
          await saveOutbox(), r.kept?.length && await take(r.kept);
        }
        let since = Math.max(0, S.usn - 6e4), got = 0, had = S.meta.get("col")?.imported;
        for (; ; ) {
          let r = await api(`anki/pull?since=${since}`), fresh = r.rows.find((x) => x[0] === "meta" && x[1] === "col" && x[2]?.imported);
          if (had && fresh && fresh[2].imported !== had)
            return await wipe(), S.syncing = !1, await sync(), void emit("pulled");
          if (got += await take(r.rows), since = r.usn, !r.more) break;
        }
        S.usn = since, await tx("kv", "readwrite", (s) => s.put(S.usn, "usn")), S.lastSync = Date.now(), S.error = "", got && emit("pulled");
      } catch (e) {
        S.error = e.message;
      } finally {
        S.syncing = !1, emit("sync"), S.outbox.size && navigator.onLine && !S.error && soon();
      }
    }
  }
  async function wipe() {
    for (let m of [S.cards, S.notes, S.types, S.decks, S.confs, S.meta]) m.clear();
    S.outbox.clear(), S.usn = 0, await tx("rows", "readwrite", (s) => s.clear()), await tx("kv", "readwrite", (s) => s.clear());
  }
  async function take(rows) {
    let write = [];
    for (let [kind, id, data, mod] of rows) {
      let key = `${kind}:${id}`, mine = current(kind, id), pending = S.outbox.get(key);
      if (pending) {
        if (kind === "card" && data && pending.data) {
          let revs = /* @__PURE__ */ new Map();
          for (let r of [...data.revs ?? [], ...pending.data.revs ?? []]) pending.drop?.includes(r[0]) || revs.set(r[0], r);
          pending.data.revs = [...revs.values()].sort((a, b) => a[0] - b[0]);
        }
        continue;
      }
      mine && mine.mod > mod && JSON.stringify(mine) !== JSON.stringify(data) || (data && (data.mod = mod), place(kind, id, data), write.push([key, data]));
    }
    return write.length && await tx("rows", "readwrite", (s) => write.forEach(([k, v]) => v == null ? s.delete(k) : s.put(v, k))), write.length;
  }
  addEventListener("online", () => (S.online = !0, emit("sync"), sync()));
  addEventListener("offline", () => (S.online = !1, emit("sync")));
  document.addEventListener("visibilitychange", () => !document.hidden && sync());
  setInterval(() => !document.hidden && sync(), 6e4);

  // site/src/cbp/fsrs.ts
  var clampD = (d) => Math.min(10, Math.max(1, d)), clampS = (s) => Math.min(36500, Math.max(1e-3, s)), DEFAULT_W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 1e-3, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542], Fsrs = class {
    w;
    decay;
    factor;
    constructor(w) {
      this.w = w.length >= 21 ? w.slice(0, 21) : [...w.length >= 19 ? w.slice(0, 19) : DEFAULT_W.slice(0, 19), 0, 0.5], this.decay = this.w[20], this.factor = Math.pow(0.9, -1 / this.decay) - 1;
    }
    /** Recall probability after `t` days. */
    r(t, s) {
      return Math.pow(1 + this.factor * Math.max(0, t) / s, -this.decay);
    }
    /** The interval (days, unrounded) at which recall falls to `retention`. */
    interval(s, retention) {
      return s / this.factor * (Math.pow(retention, -1 / this.decay) - 1);
    }
    initS(g) {
      return clampS(this.w[g - 1]);
    }
    initD(g) {
      return this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1;
    }
    nextD(d, g) {
      let delta = -this.w[6] * (g - 3), dd = d + delta * (10 - d) / 9;
      return clampD(this.w[7] * (this.initD(4) - dd) + dd);
    }
    success(s, d, r, g) {
      let hard = g === 2 ? this.w[15] : 1, easy = g === 4 ? this.w[16] : 1;
      return s * (Math.exp(this.w[8]) * (11 - d) * Math.pow(s, -this.w[9]) * (Math.exp((1 - r) * this.w[10]) - 1) * hard * easy + 1);
    }
    failure(s, d, r) {
      let ns = this.w[11] * Math.pow(d, -this.w[12]) * (Math.pow(s + 1, this.w[13]) - 1) * Math.exp((1 - r) * this.w[14]);
      return Math.min(ns, s / Math.exp(this.w[17] * this.w[18]));
    }
    shortTerm(s, g) {
      let inc = Math.exp(this.w[17] * (g - 3 + this.w[18])) * Math.pow(s, -this.w[19]);
      return g >= 3 && (inc = Math.max(inc, 1)), s * inc;
    }
    /** The memory after a review rated `g` (1 Again … 4 Easy) `t` days after the last one; null = the first review. */
    step(m, t, g) {
      if (!m) return { s: this.initS(g), d: clampD(this.initD(g)) };
      let s = t === 0 ? this.shortTerm(m.s, g) : g === 1 ? this.failure(m.s, m.d, this.r(t, m.s)) : this.success(m.s, m.d, this.r(t, m.s), g);
      return { s: clampS(s), d: this.nextD(m.d, g) };
    }
    /** The memory a review history leads to: each review's day number (Anki's day index) and its rating. */
    replay(reviews) {
      let m = null, last = 0;
      for (let r of reviews)
        m = this.step(m, m ? r.day - last : 0, r.g), last = r.day;
      return m;
    }
  }, FUZZ = [
    { start: 2.5, end: 7, factor: 0.15 },
    { start: 7, end: 20, factor: 0.1 },
    { start: 20, end: 1 / 0, factor: 0.05 }
  ];
  function fuzzBounds(ivl, min, max) {
    let delta = 1;
    for (let f of FUZZ) delta += f.factor * Math.max(0, Math.min(ivl, f.end) - f.start);
    let lo = Math.round(ivl - delta), hi = Math.round(ivl + delta);
    return lo = Math.min(max, Math.max(2, Math.max(min, lo))), hi = Math.min(max, Math.max(lo, hi)), ivl > max && (lo = hi = max), [lo, hi];
  }
  function constrain(ivl, min, max, rand) {
    let r = Math.min(max, Math.max(min, Math.max(1, Math.round(ivl))));
    if (rand == null || ivl < 2.5) return r;
    let [lo, hi] = fuzzBounds(ivl, min, max);
    return Math.min(max, Math.max(min, Math.floor(rand * (hi - lo + 1) + lo)));
  }
  function seedRand(cid, reps) {
    let h = cid + reps >>> 0 ^ Math.floor((cid + reps) / 4294967296);
    return h = Math.imul(h ^ h >>> 16, 73244475), h = Math.imul(h ^ h >>> 16, 73244475), h ^= h >>> 16, (h >>> 0) / 2 ** 32;
  }

  // site/src/cbp/sched.ts
  function clock(day0, rollover, now = Date.now(), offsetMin) {
    let base = Date.UTC(+day0.slice(0, 4), +day0.slice(5, 7) - 1, +day0.slice(8, 10)) / 864e5, off = (ms) => (offsetMin ?? -new Date(ms).getTimezoneOffset()) * 6e4, dayOf = (ms) => Math.floor((ms + off(ms) - rollover * 36e5) / 864e5) - base, today2 = dayOf(now), end = (today2 + base + 1) * 864e5 + rollover * 36e5 - off(now);
    return { now, today: today2, dayOf, dayEnd: end };
  }
  var LEARN_AHEAD = 20 * 6e4;
  function memoryOf(c) {
    return c.s != null && c.d != null ? { s: c.s, d: c.d } : c.type === 2 || c.type === 3 ? { s: Math.max(0.1, c.ivl || 1), d: 5 } : null;
  }
  function answer(c0, g, conf, ck2, ms = 0) {
    let f = new Fsrs(conf.w), c = { ...c0, revs: c0.revs }, mem = memoryOf(c0), t = c0.lrt ? Math.max(0, ck2.today - ck2.dayOf(c0.lrt * 1e3)) : 0, next = f.step(mem, mem ? t : 0, g), rand = seedRand(c0.id, c0.reps), ivlOf = (s, min = 1) => constrain(f.interval(s, conf.retention), min, conf.maxIvl, rand), steps2 = c0.type === 0 || c0.type === 1 ? conf.learnSteps : conf.relearnSteps, lastIvl = c0.queue === 1 ? -Math.round(stepAt(steps2, c0) * 60) : c0.ivl, revType = c0.type === 2 ? 1 : c0.type === 3 ? 2 : 0, leech = !1, toStep = (mins, left) => (c.left = left, mins >= 1440 ? (c.queue = 3, c.due = ck2.today + Math.round(mins / 1440), Math.round(mins / 1440)) : (c.queue = 1, c.due = Math.round(ck2.now / 1e3 + mins * 60), -Math.round(mins * 60))), graduate = (s, min = 1) => (c.type = 2, c.queue = 2, c.left = 0, c.ivl = ivlOf(s, min), c.due = ck2.today + c.ivl, c.ivl), ivl;
    if (c0.type === 2)
      if (g === 1) {
        c.lapses = c0.lapses + 1, c.ivl = ivlOf(next.s), conf.relearnSteps.length ? (c.type = 3, ivl = toStep(conf.relearnSteps[0], conf.relearnSteps.length)) : ivl = graduate(next.s);
        let th = conf.leechThreshold;
        th > 0 && c.lapses >= th && (c.lapses - th) % Math.max(1, Math.ceil(th / 2)) === 0 && (leech = !0, conf.leechAction === 0 && (c.queue = -1));
      } else {
        let hard = ivlOf(f.step(mem, t, 2).s, 1), good = ivlOf(f.step(mem, t, 3).s, hard + 1), easy = ivlOf(f.step(mem, t, 4).s, good + 1);
        c.ivl = g === 2 ? hard : g === 3 ? good : easy, c.due = ck2.today + c.ivl, ivl = c.ivl;
      }
    else {
      let remaining = c0.type === 0 ? steps2.length : c0.left % 1e3 || steps2.length, idx = Math.max(0, steps2.length - remaining);
      if (c0.type === 0 && (c.type = 1), !steps2.length || g === 4) ivl = graduate(next.s);
      else if (g === 1) ivl = toStep(steps2[0], steps2.length);
      else if (g === 2) {
        let d = idx === 0 ? steps2.length > 1 ? (steps2[0] + steps2[1]) / 2 : Math.min(steps2[0] * 1.5, steps2[0] + 1440) : steps2[idx];
        ivl = toStep(d, remaining);
      } else idx + 1 < steps2.length ? ivl = toStep(steps2[idx + 1], steps2.length - idx - 1) : ivl = graduate(next.s);
    }
    c.reps = c0.reps + 1, c.s = next.s, c.d = next.d, c.lrt = Math.floor(ck2.now / 1e3), c.mod = ck2.now;
    let rev = [ck2.now, g, ivl, lastIvl, Math.round(next.d * 1e3), Math.min(ms, 6e4), revType];
    return c.revs = [...c0.revs ?? [], rev], { card: c, rev, leech, label: label(ivl) };
  }
  function stepAt(steps2, c) {
    if (!steps2.length) return 0;
    let remaining = c.left % 1e3 || steps2.length;
    return steps2[Math.min(steps2.length - 1, Math.max(0, steps2.length - remaining))];
  }
  function label(ivl) {
    if (ivl < 0) {
      let m = -ivl / 60;
      return m < 60 ? `${Math.max(1, Math.round(m))}m` : `${Math.round(m / 60)}h`;
    }
    return ivl < 30 ? `${ivl}d` : ivl < 365 ? `${(ivl / 30).toFixed(1).replace(/\.0$/, "")}mo` : `${(ivl / 365).toFixed(1).replace(/\.0$/, "")}y`;
  }
  function queue(cards, conf, ck2, seen, newToday, revToday) {
    let learn = [], review = [], fresh = [];
    for (let c of cards)
      c.queue === 1 && c.due * 1e3 <= ck2.now + LEARN_AHEAD ? learn.push(c) : (c.queue === 2 || c.queue === 3) && c.due <= ck2.today ? review.push(c) : c.queue === 0 && fresh.push(c);
    learn.sort((a, b) => a.due - b.due), review.sort((a, b) => a.due - b.due || seedRand(a.id, ck2.today) - seedRand(b.id, ck2.today)), fresh.sort((a, b) => a.due - b.due || a.ord - b.ord);
    let sib = (list, bury) => bury ? list.filter((c) => seen.has(c.nid) ? !1 : (seen.add(c.nid), !0)) : list, blocked = new Set(seen);
    learn.forEach((c) => blocked.add(c.nid));
    let r = sib(review.filter((c) => !blocked.has(c.nid) || !conf.buryRev), conf.buryRev).slice(0, Math.max(0, conf.revPerDay - revToday));
    r.forEach((c) => blocked.add(c.nid));
    let n = sib(fresh.filter((c) => !blocked.has(c.nid) || !conf.buryNew), conf.buryNew).slice(0, Math.max(0, conf.newPerDay - newToday));
    return { learn, review: r, fresh: n };
  }
  function forecast(cards, ck2, days = 30) {
    let out = Array(days).fill(0), backlog = 0;
    for (let c of cards) {
      let d;
      if (c.queue === 2 || c.queue === 3) d = c.due - ck2.today;
      else if (c.queue === 1) d = ck2.dayOf(c.due * 1e3) - ck2.today;
      else continue;
      d < 0 ? backlog++ : d < days && out[d]++;
    }
    return { backlog, days: out };
  }
  var grades = (c, n) => c.revs.filter((r) => r[1] >= 1 && r[1] <= 4 && r[6] !== 4 && r[6] !== 5).slice(-n).map((r) => r[1]), missed3 = (c) => {
    let g = grades(c, 3);
    return g.length === 3 && g.every((x) => x === 1);
  }, right3 = (c) => {
    let g = grades(c, 3);
    return g.length === 3 && g.every((x) => x >= 2) && g[2] >= 3;
  };

  // site/src/cbp/review/render.ts
  var strip = (html) => String(html ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\[sound:[^\]]*\]/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(), nonEmpty = (html) => !!strip(html) || /<img\b|\[sound:/i.test(html ?? ""), esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function render(tmpl, x, front) {
    let fields = new Map(x.type.fields.map((f) => [f.name, x.note.flds[f.ord] ?? ""])), t = x.type.templates.find((t2) => t2.ord === x.card.ord), special = { FrontSide: front ?? "", Tags: esc(x.note.tags.join(" ")), Deck: esc(x.deck ?? ""), Subdeck: esc((x.deck ?? "").split("::").pop() ?? ""), Card: esc(t?.name ?? ""), Type: esc(x.type.name) }, value = (name) => name in special ? special[name] : fields.get(name) ?? "", s = tmpl;
    for (let guard = 0; guard < 50; guard++) {
      let before = s;
      if (s = s.replace(/\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g, (_, k, name, inner) => k === "#" === nonEmpty(value(name)) ? inner : ""), s === before) break;
    }
    let hints = 0;
    return s = s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, spec) => {
      let parts = spec.split(":"), name = parts.pop().trim(), filters = parts.map((p) => p.trim()), v = value(name);
      for (let f of filters.reverse())
        if (f === "text") v = esc(strip(v));
        else if (f === "hint") {
          if (!nonEmpty(v)) return "";
          v = `<a class="hint" href="#" data-hint="${hints++}">Show ${esc(name)}</a><div class="hint-body" hidden>${v}</div>`;
        } else (f === "type" || f === "cloze" || f === "tts" || f === "furigana" || f === "kana" || f === "kanji") && (v = f === "type" ? "" : v);
      return v;
    }), sounds(s);
  }
  var sounds = (html) => html.replace(/\[sound:([^\]]+)\]/g, (_, src) => `<button type="button" class="snd-btn" data-sound="${esc(src)}" aria-label="Play"></button>`);
  function frontShows(type, note, ord) {
    let t = type.templates.find((t2) => t2.ord === ord);
    if (!t) return !1;
    let html = render(t.qfmt, { note, type, card: { ord } });
    return nonEmpty(html.replace(/<a class="hint"[\s\S]*?<\/a>/g, ""));
  }
  var fieldIndex = (type, name) => type.fields.find((f) => f.name.toLowerCase() === name.toLowerCase())?.ord ?? -1;
  function wordOf(type, note) {
    if (!type) return strip(note.flds[0]);
    let i = fieldIndex(type, "Word");
    return strip(note.flds[i >= 0 ? i : type.sortf] ?? "");
  }
  var sortText = (type, note) => strip(note.flds[type?.sortf ?? 0] ?? "");
  function tokens(q) {
    let out = [], re = /(-?)(\w+:)?("([^"]*)"|\S+)/g;
    for (let m of q.matchAll(re)) out.push(m[0]);
    return out;
  }
  var glob = (s) => new RegExp(s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/_/g, "."), "i");
  function search(q, today2, dayOf) {
    let tests = [];
    for (let raw of tokens(q.trim())) {
      if (/^or$/i.test(raw) || /^and$/i.test(raw)) continue;
      let neg = raw.startsWith("-"), t = neg ? raw.slice(1) : raw, m = /^(\w+):(.*)$/.exec(t), val = (m ? m[2] : t).replace(/^"|"$/g, ""), f;
      if (m) {
        let k = m[1].toLowerCase();
        if (k === "tag") {
          let re = new RegExp("^" + glob(val).source + "(::.*)?$", "i");
          f = val === "none" ? (r) => !r.note.tags.length : (r) => r.note.tags.some((x) => re.test(x));
        } else if (k === "flag") f = (r) => (r.card.flags & 7) === Number(val);
        else if (k === "is") {
          let c = (r) => r.card;
          f = {
            new: (r) => c(r).type === 0,
            learn: (r) => c(r).type === 1 || c(r).type === 3,
            review: (r) => c(r).type === 2 || c(r).type === 3,
            due: (r) => (c(r).queue === 2 || c(r).queue === 3) && c(r).due <= today2 || c(r).queue === 1 && c(r).due * 1e3 <= Date.now(),
            suspended: (r) => c(r).queue === -1,
            buried: (r) => c(r).queue === -2 || c(r).queue === -3,
            leech: (r) => r.note.tags.some((x) => /^leech$/i.test(x)),
            missed: (r) => missed3(c(r))
          }[val.toLowerCase()] ?? (() => !1);
        } else if (k === "card") f = /^\d+$/.test(val) ? (r) => r.card.ord === Number(val) - 1 : (r) => glob(val).test(r.type?.templates.find((t2) => t2.ord === r.card.ord)?.name ?? "");
        else if (k === "deck") f = () => !0;
        else if (k === "note") f = (r) => glob(val).test(r.type?.name ?? "");
        else if (k === "added") f = (r) => dayOf(r.card.id) > today2 - Number(val);
        else if (k === "rated") {
          let [days, ease] = val.split(":").map(Number);
          f = (r) => r.card.revs.some((x) => dayOf(x[0]) > today2 - days && (!ease || x[1] === ease));
        } else if (k === "prop") {
          let p = /^(ivl|due|reps|lapses|d|s)(<=|>=|!=|=|<|>)(-?[\d.]+)$/.exec(val);
          f = p ? (r) => {
            let v = p[1] === "due" ? r.card.due - today2 : p[1] === "d" ? r.card.d ?? 0 : p[1] === "s" ? r.card.s ?? 0 : r.card[p[1]], n = Number(p[3]);
            return { "<": v < n, ">": v > n, "<=": v <= n, ">=": v >= n, "=": v === n, "!=": v !== n }[p[2]];
          } : () => !1;
        } else {
          let re = new RegExp("^" + glob(val).source + "$", "i");
          f = (r) => {
            let i = r.type ? fieldIndex(r.type, m[1]) : -1;
            return i >= 0 && re.test(strip(r.note.flds[i] ?? ""));
          };
        }
      } else {
        let re = glob(val);
        f = (r) => r.note.flds.some((x) => re.test(strip(x)));
      }
      tests.push(neg ? (r) => !f(r) : f);
    }
    return (r) => tests.every((t) => t(r));
  }

  // site/src/cbp/review/main.ts
  var $ = (s, el = document) => el.querySelector(s), esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]), MAC = /Mac|iPhone|iPad/.test(navigator.platform), app = $("#app"), col = () => S.meta.get("col"), ck = () => clock(col().day0, col().rollover), confOf = (c) => S.confs.get(S.decks.get(c.did)?.conf ?? col().conf) ?? S.confs.get(col().conf) ?? [...S.confs.values()][0], typeOf = (n) => S.types.get(n.mid), rowOf = (c) => {
    let note = S.notes.get(c.nid);
    return note ? { card: c, note, type: typeOf(note) } : null;
  }, cardsOf = (nid) => [...S.cards.values()].filter((c) => c.nid === nid).sort((a, b) => a.ord - b.ord), dueText = (c, k = ck()) => {
    if (c.queue === -1) return "suspended";
    if (c.type === 0) return "new";
    if (c.queue === 1) return new Date(c.due * 1e3).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    let d = c.due - k.today;
    return d === 0 ? "today" : d === 1 ? "tomorrow" : d < 0 ? `${-d}d late` : new Date(Date.now() + d * 864e5).toLocaleDateString([], { month: "short", day: "numeric", ...d > 300 ? { year: "numeric" } : {} });
  };
  function today() {
    let k = ck(), fresh = 0, revs = 0, seen = /* @__PURE__ */ new Set();
    for (let c of S.cards.values()) {
      let t = c.revs.filter((r) => k.dayOf(r[0]) === k.today && r[6] <= 3);
      t.length && (seen.add(c.nid), c.revs[0] && k.dayOf(c.revs[0][0]) === k.today && c.revs[0][6] === 0 && fresh++, revs += t.filter((r) => r[6] === 1).length ? 1 : 0);
    }
    return { fresh, revs, seen };
  }
  var toastT;
  function toast(msg, act2) {
    document.querySelector(".toast")?.remove();
    let el = document.createElement("div");
    el.className = "toast", el.setAttribute("role", "status"), el.innerHTML = `<span>${esc2(msg)}</span>${act2 ? `<button type="button">${esc2(act2[0])}</button>` : ""}`, act2 && (el.querySelector("button").onclick = () => (el.remove(), act2[1]())), document.body.append(el), clearTimeout(toastT), toastT = setTimeout(() => el.remove(), 6e3);
  }
  var player = null;
  function play(src) {
    player?.pause(), player = new Audio(src), player.play().catch(() => {
    });
  }
  function playAll(root) {
    let list = [...root.querySelectorAll("[data-sound]")].map((b) => b.dataset.sound);
    player?.pause();
    let next = () => {
      let s = list.shift();
      s && (player = new Audio(s), player.onended = next, player.play().catch(() => {
      }));
    };
    next();
  }
  var cardCss = (t) => t.css.replace(/@import[^;]+;/g, "");
  function draw(host, r, side) {
    let t = r.type, tmpl = t.templates.find((x) => x.ord === r.card.ord) ?? t.templates[0], ctx = { note: r.note, type: t, card: r.card, deck: S.decks.get(r.card.did)?.name }, q = render(tmpl.qfmt, ctx), html = side === "q" ? q : render(tmpl.afmt, ctx, q), root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    return root.innerHTML = `<style>${BASE_CARD_CSS}${cardCss(t)}</style><div class="card card${r.card.ord + 1}">${html}</div>`, root.querySelectorAll("a.hint").forEach((a) => a.onclick = (e) => (e.preventDefault(), a.remove(), a.nextElementSibling.hidden = !1)), root.querySelectorAll("[data-sound]").forEach((b) => b.onclick = () => play(b.dataset.sound)), root;
  }
  var BASE_CARD_CSS = ':host{display:block}.card{min-height:100%;box-sizing:border-box}hr#answer,hr{border:0;border-top:1px solid #e6e2d8;margin:22px 0}.snd-btn{all:unset;cursor:pointer;display:inline-grid;place-items:center;width:44px;height:44px;border-radius:50%;background:#eef4ee;vertical-align:middle;margin:4px}.snd-btn::before{content:"";border-left:13px solid #2e7d32;border-top:8px solid transparent;border-bottom:8px solid transparent;margin-left:4px}.hint{color:#8a8578;font-size:15px}', view = "review", views = { review: showReview, browse: showBrowse, add: () => showAdd(), types: () => showTypes(), options: showOptions, check: showCheck };
  function go(v) {
    view = v, document.querySelectorAll("#nav [data-v]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.v === v || v !== "review" && v !== "browse" && v !== "add" && b.dataset.v === "more"))), app.className = "v-" + v, views[v]();
    try {
      sessionStorage.setItem("cbp-view", v);
    } catch {
    }
  }
  var RV = { cur: null, shown: !1, t0: 0, undo: [], sinceNew: 0, panel: "", merge: null, deeperFor: 0 };
  function pick() {
    let k = ck(), t = today(), conf = S.confs.get(col().conf), cards = [...S.cards.values()].filter((c) => S.notes.has(c.nid)), q = queue(cards, conf, k, new Set(t.seen), t.fresh, t.revs), now = q.learn.filter((c) => c.due * 1e3 <= k.now);
    if (now.length) return now[0];
    let { review, fresh } = q;
    return fresh.length && (!review.length || RV.sinceNew >= Math.max(1, Math.floor(review.length / fresh.length))) ? fresh[0] : review.length ? review[0] : q.learn[0] ?? null;
  }
  function counts() {
    let k = ck(), t = today(), conf = S.confs.get(col().conf), q = queue([...S.cards.values()].filter((c) => S.notes.has(c.nid)), conf, k, new Set(t.seen), t.fresh, t.revs);
    return { n: q.fresh.length, l: q.learn.length, r: q.review.length };
  }
  function showReview() {
    if (RV.panel === "deeper") return showDeeper();
    (!RV.cur || !S.cards.has(RV.cur.id) || RV.cur !== S.cards.get(RV.cur.id)) && (RV.cur = pick(), RV.shown = !1, RV.t0 = Date.now());
    let c = RV.cur, n = counts(), cnt = `<div class="counts" aria-label="New, learning, review"><b class="cn${c?.type === 0 ? " on" : ""}">${n.n}</b><b class="cl${c && (c.queue === 1 || c.queue === 3) ? " on" : ""}">${n.l}</b><b class="cr${c?.queue === 2 ? " on" : ""}">${n.r}</b></div>`;
    if (!c) {
      let k = ck(), f = forecast([...S.cards.values()], k, 2), nextLearn = [...S.cards.values()].filter((x) => x.queue === 1).sort((a, b) => a.due - b.due)[0];
      app.innerHTML = `<section class="rv done">${cnt}<div class="done-in"><p class="big">Done for today.</p>
      <p>${nextLearn ? `Next card at ${new Date(nextLearn.due * 1e3).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. ` : ""}Tomorrow: ${f.days[1]}.</p>
      ${RV.undo.length ? '<button type="button" class="ghost" data-a="undo">Undo last</button>' : ""}</div></section>`, bindReview();
      return;
    }
    let r = rowOf(c), flag = c.flags & 7, banner = RV.panel === "merge" && RV.merge ? mergeBanner() : "";
    app.innerHTML = `<section class="rv">${cnt}${banner}<div class="rv-card${flag ? " flag" + flag : ""}"><div class="host"></div></div>
    <div class="rv-bar">${RV.shown ? buttons(c) : '<button type="button" class="show" data-a="show">Show answer</button>'}</div>
    <div class="rv-more"><button type="button" data-a="edit">Edit</button><button type="button" data-a="flagmenu">Flag</button><button type="button" data-a="suspend">Suspend</button><button type="button" data-a="bury">Bury</button><button type="button" data-a="info">Info</button>${RV.undo.length ? '<button type="button" data-a="undo">Undo</button>' : ""}</div></section>`;
    let root = draw($(".host"), r, RV.shown ? "a" : "q");
    playAll(root), bindReview();
  }
  function buttons(c) {
    let k = ck(), conf = confOf(c);
    return ["Again", "Hard", "Good", "Easy"].map((name, i) => {
      let a = answer(c, i + 1, conf, k);
      return `<button type="button" class="g g${i + 1}" data-g="${i + 1}"><small>${a.label}</small>${name}</button>`;
    }).join("");
  }
  function bindReview() {
    app.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => act(b.dataset.a)), app.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => grade(Number(b.dataset.g)));
  }
  async function grade(g) {
    let c = RV.cur;
    if (!c || !RV.shown) return;
    let conf = confOf(c), r = rowOf(c), a = answer(c, g, conf, ck(), Date.now() - RV.t0), undo2 = { card: c, rev: a.rev[0] };
    if (a.leech && !r.note.tags.includes("leech") && (undo2.note = r.note, await put("note", r.note.id, { ...r.note, tags: [...r.note.tags, "leech"] }), toast(conf.leechAction === 0 ? "Leech: suspended." : "Leech: tagged.")), RV.undo = [...RV.undo.slice(-30), undo2], RV.sinceNew = c.type === 0 ? 0 : RV.sinceNew + 1, await put("card", c.id, a.card), RV.cur = null, RV.panel = "", g === 1 && missed3(a.card))
      RV.panel = "deeper", RV.deeperFor = a.card.id;
    else if (g >= 3 && right3(a.card)) {
      let other = related(a.card);
      other && (RV.panel = "merge", RV.merge = [a.card.nid, other]);
    }
    showReview();
  }
  async function act(a) {
    let c = RV.cur;
    if (a === "show")
      return RV.shown = !0, showReview();
    if (a === "undo") return undo();
    if (!c) return;
    let r = rowOf(c);
    if (a === "edit") return editorDialog(r.note);
    if (a === "info") return infoDialog(c);
    if (a === "flagmenu") return flagDialog([c]);
    if (a === "suspend" || a === "bury") {
      let prev = { ...c };
      await put("card", c.id, { ...c, queue: a === "suspend" ? -1 : -2 }), RV.cur = null, showReview(), toast(a === "suspend" ? "Suspended." : "Buried until tomorrow.", ["Undo", async () => (await put("card", c.id, prev), RV.cur = null, showReview())]);
    }
  }
  async function undo() {
    let u = RV.undo.pop();
    if (!u) return;
    let now = S.cards.get(u.card.id);
    await put("card", u.card.id, { ...u.card, revs: (now?.revs ?? u.card.revs).filter((r) => r[0] !== u.rev) }, [u.rev]), u.note && await put("note", u.note.id, u.note), RV.cur = S.cards.get(u.card.id), RV.shown = !1, RV.t0 = Date.now(), RV.panel = "", showReview();
  }
  var deeperTimer;
  function showDeeper() {
    let c = S.cards.get(RV.deeperFor), r = c && rowOf(c);
    if (!r) return RV.panel = "", showReview();
    let word = wordOf(r.type, r.note);
    app.innerHTML = `<section class="deeper"><p class="dw">${esc2(word)}</p><p class="dsub">Missed three times in a row.</p>
    <div class="dact"><button type="button" class="primary" data-d="go">Go deeper <span>5 min</span></button><button type="button" data-d="del">Delete it</button><button type="button" class="ghost" data-d="skip">Not now</button></div>
    <div class="dbody" hidden><div class="dtimer" aria-live="off"></div><div class="dtext"></div>
    <label class="dmine"><span>Your note, added to Notes</span><div contenteditable="true" class="dnote" role="textbox" aria-multiline="true"></div></label>
    <button type="button" class="primary" data-d="done">Back to reviews</button></div></section>`;
    let body = $(".dbody");
    app.querySelectorAll("[data-d]").forEach(
      (b) => b.onclick = async () => {
        let d = b.dataset.d;
        if (d === "skip") return endDeeper();
        if (d === "del") {
          let note = r.note, cs = cardsOf(note.id);
          await deleteNote(note.id), endDeeper(), toast(`${word} deleted.`, ["Undo", () => restoreNote(note, cs)]);
          return;
        }
        if (d === "done") {
          let mine = $(".dnote").innerHTML.trim();
          if (strip(mine)) {
            let i = fieldIndex(r.type, "Notes");
            if (i >= 0) {
              let flds = [...r.note.flds];
              flds[i] = flds[i] ? `${flds[i]}<br>${mine}` : mine, await put("note", r.note.id, { ...r.note, flds });
            }
          }
          return endDeeper();
        }
        $(".dact").hidden = !0, body.hidden = !1;
        let end = Date.now() + 5 * 6e4, tick = () => {
          let left = Math.max(0, end - Date.now());
          $(".dtimer").textContent = `${Math.floor(left / 6e4)}:${String(Math.floor(left % 6e4 / 1e3)).padStart(2, "0")}`, left || clearInterval(deeperTimer);
        };
        tick(), deeperTimer = setInterval(tick, 1e3);
        let text = $(".dtext");
        if (text.textContent = navigator.onLine ? "\u2026" : "Needs signal. Use the five minutes with your own notes.", !!navigator.onLine)
          try {
            let i = (n) => fieldIndex(r.type, n), near = nearWords(r.note).slice(0, 30), out = await api("anki/deeper", { word, sentence: strip(r.note.flds[i("Chinese")] ?? ""), notes: strip(r.note.flds[i("Notes")] ?? ""), near });
            text.innerHTML = esc2(out.text).replace(/\n/g, "<br>");
          } catch (e) {
            text.textContent = e.message;
          }
      }
    );
  }
  function endDeeper() {
    clearInterval(deeperTimer), RV.panel = "", showReview();
  }
  var HAN = /\p{Script=Han}/u;
  function nearWords(note) {
    let w = wordOf(typeOf(note), note), chars = new Set([...w].filter((x) => HAN.test(x))), out = /* @__PURE__ */ new Set();
    for (let n of S.notes.values()) {
      if (n.id === note.id) continue;
      let o = wordOf(typeOf(n), n);
      o && o !== w && [...o].some((x) => chars.has(x)) && out.add(o);
    }
    return [...out];
  }
  var mergeNo = () => new Set(S.meta.get("mergeNo")?.pairs ?? []), pairKey = (a, b) => [a, b].sort().join("-");
  function related(c) {
    let note = S.notes.get(c.nid);
    if (!note) return null;
    let w = wordOf(typeOf(note), note), chars = new Set([...w].filter((x) => HAN.test(x)));
    if (!chars.size) return null;
    let no = mergeNo(), k = ck();
    for (let o of S.cards.values()) {
      if (o.nid === c.nid || o.queue < 0 || no.has(pairKey(c.nid, o.nid))) continue;
      let last = o.revs[o.revs.length - 1];
      if (!last || k.today - k.dayOf(last[0]) > 1 || !right3(o)) continue;
      let on = S.notes.get(o.nid), ow = on && wordOf(typeOf(on), on);
      if (ow && ow !== w && [...ow].some((x) => chars.has(x))) return o.nid;
    }
    return null;
  }
  function mergeBanner() {
    let [a, b] = RV.merge.map((id) => S.notes.get(id));
    return !a || !b ? "" : `<div class="merge"><span><b>${esc2(wordOf(typeOf(a), a))}</b> \xB7 <b>${esc2(wordOf(typeOf(b), b))}</b>: right three times in a row each. One harder card about the difference?</span>
    <span class="mact"><button type="button" class="primary" data-m="write">Write it</button><button type="button" class="ghost" data-m="no">Not these</button></span></div>`;
  }
  document.addEventListener("click", async (e) => {
    let b = e.target.closest("[data-m]");
    if (!b || !RV.merge) return;
    let [x, y] = RV.merge;
    if (RV.panel = "", RV.merge = null, b.dataset.m === "no")
      return await put("meta", "mergeNo", { pairs: [...mergeNo(), pairKey(x, y)] }), showReview();
    let [a, c] = [S.notes.get(x), S.notes.get(y)];
    showAdd({ word: `${wordOf(typeOf(a), a)} / ${wordOf(typeOf(c), c)}`, mergeOf: [x, y] }), go2("add");
  });
  var go2 = (v) => {
    view = v, document.querySelectorAll("#nav [data-v]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.v === v))), app.className = "v-" + v;
  };
  function dialog(html, cls = "") {
    document.querySelector("dialog.dlg")?.remove();
    let d = document.createElement("dialog");
    return d.className = "dlg " + cls, d.innerHTML = `<button type="button" class="x" aria-label="Close">\xD7</button>${html}`, document.body.append(d), d.querySelector(".x").onclick = () => d.close(), d.addEventListener("close", () => {
      d.remove(), view === "review" && showReview(), view === "browse" && paintBrowse();
    }), d.addEventListener("click", (e) => e.target === d && d.close()), d.showModal(), d;
  }
  function editorDialog(note) {
    let d = dialog('<div class="ed-host"></div>', "wide");
    noteEditor(d.querySelector(".ed-host"), note);
  }
  var FLAGS = ["", "Red", "Orange", "Green", "Blue", "Pink", "Turquoise", "Purple"];
  function flagDialog(cs) {
    let d = dialog(`<div class="flags">${FLAGS.map((f, i) => `<button type="button" class="fl fl${i}" data-f="${i}">${i ? f : "No flag"}</button>`).join("")}</div>`, "small");
    d.querySelectorAll("[data-f]").forEach(
      (b) => b.onclick = async () => {
        await setFlag(cs, Number(b.dataset.f)), d.close();
      }
    );
  }
  var setFlag = (cs, f) => putMany(cs.map((c) => ["card", c.id, { ...c, flags: c.flags & -8 | f }]));
  function infoDialog(c) {
    let k = ck(), r = rowOf(c), E = ["", "Again", "Hard", "Good", "Easy"], T = ["Learn", "Review", "Relearn", "Filtered", "Manual", "Rescheduled"], revs = [...c.revs].reverse().map((x) => `<tr><td>${new Date(x[0]).toLocaleDateString([], { year: "2-digit", month: "short", day: "numeric" })}</td><td>${T[x[6]] ?? ""}</td><td class="e${x[1]}">${E[x[1]] ?? "\u2014"}</td><td>${x[2] < 0 ? label(x[2]) : x[2] ? label(x[2]) : ""}</td></tr>`).join("");
    dialog(`<h2>${esc2(wordOf(r.type, r.note))}</h2><dl class="info"><dt>Due</dt><dd>${dueText(c, k)}</dd><dt>Interval</dt><dd>${c.ivl ? label(c.ivl) : "\u2014"}</dd>
    <dt>Stability</dt><dd>${c.s ? c.s < 1 ? `${Math.round(c.s * 24)}h` : label(Math.round(c.s)) : "\u2014"}</dd><dt>Difficulty</dt><dd>${c.d ? Math.round((c.d - 1) / 9 * 100) + "%" : "\u2014"}</dd>
    <dt>Reviews</dt><dd>${c.reps}</dd><dt>Lapses</dt><dd>${c.lapses}</dd><dt>Added</dt><dd>${new Date(c.id).toLocaleDateString()}</dd></dl>
    <table class="revs"><tbody>${revs}</tbody></table>`);
  }
  var pasteTarget = /* @__PURE__ */ new WeakMap();
  function noteEditor(host, note0, opts = {}) {
    let note = note0, t = typeOf(note), cs = opts.onAdd ? [] : cardsOf(note.id);
    host.innerHTML = `<div class="ed">${t.fields.slice().sort((a, b) => a.ord - b.ord).map((f) => `<label class="ef"><span>${esc2(f.name)}</span><div class="fv${/chinese|word|sentence/i.test(f.name) ? " zh" : ""}" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" data-o="${f.ord}">${note.flds[f.ord] ?? ""}</div></label>`).join("")}
    <label class="ef"><span>Tags</span><input class="tags" value="${esc2(note.tags.join(" "))}" spellcheck="false"></label>
    ${opts.onAdd ? '<div class="ed-act"><button type="button" class="primary" data-e="add">Add</button></div>' : ""}
    ${cs.length ? `<div class="ed-cards">${cs.map((c) => `<div class="ec" data-c="${c.id}"><span class="ecn">${esc2(t.templates.find((x) => x.ord === c.ord)?.name ?? "")}</span><span>${dueText(c)}</span><span class="flagdot fd${c.flags & 7}"></span>
      <button type="button" data-e="susp">${c.queue === -1 ? "Unsuspend" : "Suspend"}</button><button type="button" data-e="flag">Flag</button><button type="button" data-e="due">Set due</button><button type="button" data-e="forget">Forget</button><button type="button" data-e="prev">Preview</button></div>`).join("")}</div>
      <div class="ed-act"><button type="button" class="danger" data-e="del">Delete note</button></div>` : ""}</div>`;
    let saveT, read = () => {
      let flds = [...note.flds];
      host.querySelectorAll(".fv").forEach((f) => flds[Number(f.dataset.o)] = clean(f.innerHTML));
      let tags = [...new Set($(".tags", host).value.split(/\s+/).filter(Boolean))];
      return { ...note, flds, tags };
    }, save = () => {
      opts.onAdd || (clearTimeout(saveT), saveT = setTimeout(async () => {
        note = read(), await put("note", note.id, note);
      }, 500));
    };
    host.querySelectorAll(".fv").forEach((f) => {
      pasteTarget.set(f, note), f.addEventListener("input", save), f.addEventListener("paste", (e) => pasteInto(e, f, save)), f.addEventListener("drop", (e) => dropInto(e, f, save));
    }), $(".tags", host).addEventListener("input", save), host.querySelectorAll("[data-e]").forEach(
      (b) => b.onclick = async () => {
        let e = b.dataset.e, c = S.cards.get(Number(b.closest("[data-c]")?.dataset.c));
        if (e === "add") {
          let n = read();
          if (!n.flds.some((x) => strip(x) || /<img/.test(x))) return toast("Nothing to add yet.");
          opts.onAdd(n);
          return;
        }
        if (e === "del") {
          let cards = cardsOf(note.id);
          await deleteNote(note.id), host.closest("dialog")?.close(), view === "browse" && paintBrowse(), toast("Note deleted.", ["Undo", () => restoreNote(note, cards)]);
          return;
        }
        if (c) {
          if (e === "susp" && await put("card", c.id, { ...c, queue: c.queue === -1 ? c.type === 0 ? 0 : c.type === 2 ? 2 : 1 : -1 }), e === "flag") return flagDialog([c]);
          if (e === "forget" && await putMany([["card", c.id, forget(c)]]), e === "due") {
            let v = prompt("Due in how many days? (0 = today)", "0");
            if (v == null || !/^\d+$/.test(v.trim())) return;
            await put("card", c.id, setDue(c, Number(v)));
          }
          if (e === "prev") return preview(c);
          noteEditor(host, S.notes.get(note.id), opts);
        }
      }
    );
  }
  var clean = (h) => h.replace(/^(<br>)+$/, "").replace(/\s+data-[\w-]+="[^"]*"/g, ""), forget = (c) => ({ ...c, type: 0, queue: 0, ivl: 0, left: 0, s: void 0, d: void 0, due: Math.floor(Date.now() / 1e3), revs: [...c.revs, [Date.now(), 0, 0, c.ivl, 0, 0, 4]] }), setDue = (c, days) => {
    let k = ck();
    return { ...c, type: c.type === 0 ? 2 : c.type, queue: 2, due: k.today + days, ivl: Math.max(1, c.ivl), revs: [...c.revs, [Date.now(), 0, days, c.ivl, 0, 0, 4]] };
  };
  function preview(c) {
    let r = rowOf(c), d = dialog('<div class="pv"><div class="pvq"></div><div class="pva"></div></div>', "wide");
    draw(d.querySelector(".pvq"), r, "q"), draw(d.querySelector(".pva"), r, "a");
  }
  async function pasteInto(e, f, save) {
    let file = [...e.clipboardData?.files ?? []].find((x) => /^image\//.test(x.type));
    file && (e.preventDefault(), await upload(file, f, save));
  }
  async function dropInto(e, f, save) {
    let file = [...e.dataTransfer?.files ?? []].find((x) => /^image\//.test(x.type));
    file && (e.preventDefault(), await upload(file, f, save));
  }
  async function upload(file, f, save) {
    if (!navigator.onLine) return toast("Pictures need signal.");
    try {
      let r = await fetch("/api/plus/upload", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem("cb-token") ?? ""}`, "Content-Type": file.type }, body: file }), j = await r.json();
      if (!r.ok) throw new Error(j.error);
      f.focus(), document.execCommand("insertHTML", !1, `<img src="${j.url}">`), save();
    } catch (err) {
      toast(err.message || "The picture didn\u2019t come through.");
    }
  }
  async function deleteNote(nid) {
    await putMany([["note", nid, null], ...cardsOf(nid).map((c) => ["card", c.id, null])]);
  }
  async function restoreNote(note, cards) {
    await putMany([["note", note.id, note], ...cards.map((c) => ["card", c.id, c])]), view === "review" && showReview(), view === "browse" && paintBrowse();
  }
  function showAdd(pre = {}) {
    let type = S.types.get(col().notetype) ?? [...S.types.values()][0], id = Date.now(), flds = type.fields.map(() => "");
    pre.word && (flds[Math.max(0, fieldIndex(type, "Word"))] = esc2(pre.word));
    let note = { id, guid: "cbp:" + id.toString(36), mid: type.id, mod: id, tags: pre.mergeOf ? ["difference"] : [], flds };
    app.innerHTML = `<section class="add"><div class="add-top"><select class="nt" aria-label="Note type">${[...S.types.values()].map((t) => `<option value="${t.id}"${t.id === type.id ? " selected" : ""}>${esc2(t.name)}</option>`).join("")}</select></div><div class="ed-host"></div></section>`, $(".nt").onchange = (e) => {
      col().notetype = Number(e.target.value), showAdd(pre);
    }, noteEditor($(".ed-host"), note, {
      onAdd: async (n) => {
        let made = await addNote(n);
        if (!made) return toast("No card shows anything yet: fill the fields its front uses.");
        if (pre.mergeOf) {
          let old = pre.mergeOf.flatMap((x) => cardsOf(x));
          await putMany(old.map((c) => ["card", c.id, { ...c, queue: -1 }])), toast("Added. The two old cards are suspended.", ["Undo", () => putMany(old.map((c) => ["card", c.id, c]))]), pre = {};
        } else toast(`Added: ${made} card${made > 1 ? "s" : ""}.`);
        showAdd(pre);
      }
    });
  }
  async function addNote(n) {
    let t = typeOf(n), now = Date.now(), cards = t.templates.filter((x) => frontShows(t, n, x.ord)).map((x, i) => ({ id: now + 1 + i, nid: n.id, did: col().deck, ord: x.ord, type: 0, queue: 0, due: Math.floor(now / 1e3), ivl: 0, reps: 0, lapses: 0, left: 0, flags: 0, mod: now, revs: [] }));
    return cards.length ? (await putMany([["note", n.id, n], ...cards.map((c) => ["card", c.id, c])]), cards.length) : 0;
  }
  var BR = { q: "", sort: "sort", desc: !1, sel: /* @__PURE__ */ new Set(), last: 0, focus: 0, limit: 300 }, COLS = [
    ["sort", "Sort field", (r) => sortText(r.type, r.note)],
    ["card", "Card", (r) => r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? ""],
    ["due", "Due", (r, k) => r.card.queue === -1 ? 1e9 : r.card.type === 0 ? 1e8 + r.card.due : r.card.queue === 1 ? k.dayOf(r.card.due * 1e3) : r.card.due],
    ["ivl", "Interval", (r) => r.card.ivl],
    ["d", "Difficulty", (r) => r.card.d ?? 0],
    ["reps", "Reviews", (r) => r.card.reps],
    ["lapses", "Lapses", (r) => r.card.lapses]
  ];
  function showBrowse() {
    app.innerHTML = `<section class="br"><aside class="br-side"><input class="q" type="search" placeholder="Search" value="${esc2(BR.q)}" spellcheck="false" enterkeyhint="search">
    <div class="saved"></div></aside><div class="br-main"><div class="bulk" hidden></div><div class="tbl" role="grid"></div></div><div class="br-ed"></div></section>`;
    let q = $(".q"), t;
    q.oninput = () => {
      clearTimeout(t), t = setTimeout(() => (BR.q = q.value, BR.limit = 300, paintBrowse()), 200);
    }, paintBrowse();
  }
  function results() {
    let k = ck(), test = search(BR.q, k.today, k.dayOf), rows = [...S.cards.values()].map(rowOf).filter((r) => !!r && test(r)), col_ = COLS.find((c) => c[0] === BR.sort);
    return rows.sort((a, b) => {
      let x = col_[2](a, k), y = col_[2](b, k), o = typeof x == "number" ? x - y : String(x).localeCompare(String(y), "zh-Hant");
      return BR.desc ? -o : o;
    }), rows;
  }
  function paintBrowse() {
    if (view !== "browse" || !$(".br")) return;
    let k = ck(), rows = results(), tags = /* @__PURE__ */ new Map();
    S.notes.forEach((n) => n.tags.forEach((x) => tags.set(x, (tags.get(x) ?? 0) + 1)));
    let saved = [["Due today", "is:due"], ["New", "is:new"], ["Missed 3\xD7", "is:missed"], ["Suspended", "is:suspended"], ["Leeches", "is:leech"], ["Added today", "added:1"], ["Reviewed today", "rated:1"], ...FLAGS.slice(1).map((f, i) => [f, `flag:${i + 1}`])];
    $(".saved").innerHTML = `${saved.map(([l, s]) => `<button type="button" class="sv${BR.q === s ? " on" : ""}" data-s="${esc2(s)}">${l.match(/^(Red|Orange|Green|Blue|Pink|Turquoise|Purple)$/) ? `<span class="flagdot fd${FLAGS.indexOf(l)}"></span>` : ""}${esc2(l)}</button>`).join("")}
    ${tags.size ? `<p class="tagh">Tags</p>${[...tags].sort().map(([x, n]) => `<button type="button" class="sv${BR.q === "tag:" + x ? " on" : ""}" data-s="tag:${esc2(x)}">${esc2(x)} <i>${n}</i></button>`).join("")}` : ""}`, $(".saved").querySelectorAll("[data-s]").forEach(
      (b) => b.onclick = () => {
        BR.q = BR.q === b.dataset.s ? "" : b.dataset.s, $(".q").value = BR.q, paintBrowse();
      }
    );
    let shown = rows.slice(0, BR.limit);
    $(".tbl").innerHTML = `<div class="tr th">${COLS.map(([key, name]) => `<button type="button" class="td c-${key}${BR.sort === key ? BR.desc ? " desc" : " asc" : ""}" data-sort="${key}">${name}</button>`).join("")}</div>
    ${shown.map((r) => `<div class="tr${BR.sel.has(r.card.id) ? " sel" : ""}${r.card.queue === -1 ? " susp" : ""}${r.card.flags & 7 ? " fl" + (r.card.flags & 7) : ""}" data-c="${r.card.id}" role="row"><span class="td c-sort zh">${esc2(sortText(r.type, r.note))}</span><span class="td c-card">${esc2(r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? "")}</span><span class="td c-due">${dueText(r.card, k)}</span><span class="td c-ivl">${r.card.ivl ? label(r.card.ivl) : ""}</span><span class="td c-d">${r.card.d ? Math.round((r.card.d - 1) / 9 * 100) + "%" : ""}</span><span class="td c-reps">${r.card.reps}</span><span class="td c-lapses">${r.card.lapses}</span></div>`).join("")}
    <p class="tcount">${rows.length} card${rows.length === 1 ? "" : "s"}${rows.length > shown.length ? ' \xB7 <button type="button" class="more">Show all</button>' : ""}</p>`, $(".tbl").querySelectorAll("[data-sort]").forEach(
      (b) => b.onclick = () => {
        BR.desc = BR.sort === b.dataset.sort ? !BR.desc : !1, BR.sort = b.dataset.sort, paintBrowse();
      }
    ), $(".tbl .more")?.addEventListener("click", () => (BR.limit = 1e9, paintBrowse())), $(".tbl").querySelectorAll(".tr[data-c]").forEach(
      (tr) => tr.onclick = (e) => {
        let id = Number(tr.dataset.c);
        if (e.shiftKey && BR.last) {
          let ids = shown.map((r) => r.card.id), a = ids.indexOf(BR.last), b = ids.indexOf(id);
          ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => BR.sel.add(x));
        } else e.metaKey || e.ctrlKey ? BR.sel.has(id) ? BR.sel.delete(id) : BR.sel.add(id) : (BR.sel = /* @__PURE__ */ new Set([id]), BR.focus = id);
        BR.last = id, paintBrowse();
      }
    );
    let sel = [...BR.sel].map((id) => S.cards.get(id)).filter((c) => !!c), bulk = $(".bulk");
    bulk.hidden = sel.length < 2, sel.length >= 2 && (bulk.innerHTML = `<span>${sel.length} selected</span><button type="button" data-b="susp">Suspend</button><button type="button" data-b="unsusp">Unsuspend</button><button type="button" data-b="flag">Flag</button><button type="button" data-b="tag">Add tag</button><button type="button" data-b="untag">Remove tag</button><button type="button" data-b="forget">Forget</button><button type="button" class="danger" data-b="del">Delete</button><button type="button" class="ghost" data-b="none">Clear</button>`, bulk.querySelectorAll("[data-b]").forEach((b) => b.onclick = () => bulkAct(b.dataset.b, sel)));
    let ed = $(".br-ed"), focus = sel.length === 1 ? sel[0] : null;
    if (ed.classList.toggle("open", !!focus), focus && ed.dataset.n !== String(focus.nid) + ":" + (S.notes.get(focus.nid)?.mod ?? 0)) {
      let n = S.notes.get(focus.nid);
      n && !ed.contains(document.activeElement) && (ed.dataset.n = String(n.id) + ":" + n.mod, ed.innerHTML = '<button type="button" class="back">Back</button><div class="ed-host"></div>', noteEditor($(".ed-host", ed), n), $(".back", ed).onclick = () => (BR.sel = /* @__PURE__ */ new Set(), paintBrowse()));
    } else focus || (ed.innerHTML = "", delete ed.dataset.n);
  }
  async function bulkAct(a, sel) {
    let nids = [...new Set(sel.map((c) => c.nid))];
    if (a === "none" && (BR.sel = /* @__PURE__ */ new Set()), (a === "susp" || a === "unsusp") && await putMany(sel.map((c) => ["card", c.id, { ...c, queue: a === "susp" ? -1 : c.queue === -1 ? c.type === 0 ? 0 : c.type === 2 ? 2 : 1 : c.queue }])), a === "flag") return flagDialog(sel);
    if (a === "forget" && await putMany(sel.map((c) => ["card", c.id, forget(c)])), a === "tag" || a === "untag") {
      let tag = prompt(a === "tag" ? "Tag to add" : "Tag to remove")?.trim();
      if (!tag) return;
      await putMany(nids.map((id) => S.notes.get(id)).map((n) => ["note", n.id, { ...n, tags: a === "tag" ? [.../* @__PURE__ */ new Set([...n.tags, ...tag.split(/\s+/)])] : n.tags.filter((x) => !tag.split(/\s+/).includes(x)) }]));
    }
    if (a === "del") {
      if (!confirm(`Delete ${nids.length} note${nids.length > 1 ? "s" : ""} and all their cards?`)) return;
      let keep = nids.map((id) => [S.notes.get(id), cardsOf(id)]);
      for (let id of nids) await deleteNote(id);
      BR.sel = /* @__PURE__ */ new Set(), toast(`${nids.length} deleted.`, ["Undo", async () => {
        for (let [n, cs] of keep) await restoreNote(n, cs);
      }]);
    }
    paintBrowse();
  }
  var TY = { id: 0, tab: "fields", tmpl: 0, side: "qfmt" };
  function showTypes() {
    let types = [...S.types.values()];
    S.types.has(TY.id) || (TY.id = col().notetype);
    let t = S.types.get(TY.id), n = [...S.notes.values()].filter((x) => x.mid === t.id).length;
    app.innerHTML = `<section class="ty">${settingsNav("types")}<div class="ty-top"><select class="tysel" aria-label="Note type">${types.map((x) => `<option value="${x.id}"${x.id === t.id ? " selected" : ""}>${esc2(x.name)}</option>`).join("")}</select><span class="muted">${n} notes</span>
    <nav class="seg">${["fields", "cards", "css"].map((k) => `<button type="button" data-tab="${k}" aria-current="${TY.tab === k}">${k === "fields" ? "Fields" : k === "cards" ? "Card types" : "Styling"}</button>`).join("")}</nav></div><div class="ty-body"></div></section>`, bindSettingsNav(), $(".tysel").onchange = (e) => (TY.id = Number(e.target.value), TY.tmpl = 0, showTypes()), app.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => (TY.tab = b.dataset.tab, showTypes()));
    let body = $(".ty-body");
    if (TY.tab === "fields") {
      let fs = t.fields.slice().sort((a, b) => a.ord - b.ord);
      body.innerHTML = `<ol class="flist">${fs.map((f, i) => `<li><input value="${esc2(f.name)}" data-ren="${f.ord}" aria-label="Field name"><button type="button" data-up="${i}" ${i ? "" : "disabled"} aria-label="Move up">\u2191</button><button type="button" data-dn="${i}" ${i < fs.length - 1 ? "" : "disabled"} aria-label="Move down">\u2193</button><button type="button" class="danger" data-rm="${f.ord}" aria-label="Delete field">\xD7</button></li>`).join("")}</ol>
      <button type="button" data-add="1">Add field</button>`, body.querySelectorAll("[data-ren]").forEach((inp) => inp.onchange = () => renameField(t, Number(inp.dataset.ren), inp.value.trim())), body.querySelectorAll("[data-up],[data-dn]").forEach((b) => b.onclick = () => moveField(t, Number(b.dataset.up ?? b.dataset.dn), b.dataset.up ? -1 : 1)), body.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => removeField(t, Number(b.dataset.rm))), $("[data-add]", body).onclick = () => addField(t);
    } else if (TY.tab === "cards") {
      let tm = t.templates.find((x) => x.ord === TY.tmpl) ?? t.templates[0], sample = [...S.notes.values()].find((x) => x.mid === t.id);
      body.innerHTML = `<div class="tm-top"><nav class="seg">${t.templates.map((x) => `<button type="button" data-tm="${x.ord}" aria-current="${x.ord === tm.ord}">${esc2(x.name)}</button>`).join("")}</nav>
      <button type="button" data-tma="add">Add card type</button><button type="button" data-tma="ren">Rename</button>${t.templates.length > 1 ? '<button type="button" class="danger" data-tma="del">Delete</button>' : ""}</div>
      <div class="tm"><div class="tm-ed"><nav class="seg"><button type="button" data-side="qfmt" aria-current="${TY.side === "qfmt"}">Front</button><button type="button" data-side="afmt" aria-current="${TY.side === "afmt"}">Back</button></nav>
      <textarea class="code" spellcheck="false">${esc2(tm[TY.side])}</textarea></div><div class="tm-pv"><div class="pvh"></div></div></div>`, body.querySelectorAll("[data-tm]").forEach((b) => b.onclick = () => (TY.tmpl = Number(b.dataset.tm), showTypes())), body.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => (TY.side = b.dataset.side, showTypes())), body.querySelectorAll("[data-tma]").forEach((b) => b.onclick = () => templateAct(t, tm.ord, b.dataset.tma));
      let pv = () => sample && draw($(".pvh", body), { note: sample, type: S.types.get(t.id), card: { ord: tm.ord } }, TY.side === "qfmt" ? "q" : "a");
      pv();
      let st;
      $(".code", body).oninput = (e) => {
        let v = e.target.value;
        clearTimeout(st), st = setTimeout(async () => {
          let cur = S.types.get(t.id);
          await put("notetype", t.id, { ...cur, templates: cur.templates.map((x) => x.ord === tm.ord ? { ...x, [TY.side]: v } : x) }), pv();
        }, 400);
      };
    } else {
      let sample = [...S.notes.values()].find((x) => x.mid === t.id);
      body.innerHTML = `<div class="tm"><div class="tm-ed"><textarea class="code tall" spellcheck="false">${esc2(t.css)}</textarea></div><div class="tm-pv"><div class="pvh"></div></div></div>`;
      let pv = () => sample && draw($(".pvh", body), { note: sample, type: S.types.get(t.id), card: { ord: t.templates[0].ord } }, "a");
      pv();
      let st;
      $(".code", body).oninput = (e) => {
        let v = e.target.value;
        clearTimeout(st), st = setTimeout(async () => (await put("notetype", t.id, { ...S.types.get(t.id), css: v }), pv()), 400);
      };
    }
  }
  var refName = (s, from, to) => s.replace(/\{\{([#^/]?)((?:[a-z]+:)*)\s*([^}]+?)\s*\}\}/g, (all2, k, filt, name) => name === from ? `{{${k}${filt}${to}}}` : all2);
  async function renameField(t, ord, name) {
    let old = t.fields.find((f) => f.ord === ord).name;
    if (!(!name || name === old)) {
      if (t.fields.some((f) => f.name === name)) return toast("Another field has that name."), showTypes();
      await put("notetype", t.id, { ...t, fields: t.fields.map((f) => f.ord === ord ? { ...f, name } : f), templates: t.templates.map((x) => ({ ...x, qfmt: refName(x.qfmt, old, name), afmt: refName(x.afmt, old, name) })) }), showTypes();
    }
  }
  async function reorder(t, order) {
    let fields = order.map((o, i) => ({ ...t.fields.find((f) => f.ord === o), ord: i })), notes = [...S.notes.values()].filter((n) => n.mid === t.id);
    await putMany([["notetype", t.id, { ...t, fields, sortf: Math.max(0, order.indexOf(t.sortf)) }], ...notes.map((n) => ["note", n.id, { ...n, flds: order.map((o) => n.flds[o] ?? "") }])]), showTypes();
  }
  function moveField(t, i, dir) {
    let order = t.fields.slice().sort((a, b) => a.ord - b.ord).map((f) => f.ord);
    [order[i], order[i + dir]] = [order[i + dir], order[i]], reorder(t, order);
  }
  function removeField(t, ord) {
    let f = t.fields.find((x) => x.ord === ord);
    t.fields.length < 2 || !confirm(`Delete the field ${f.name} from every note?`) || reorder(t, t.fields.slice().sort((a, b) => a.ord - b.ord).map((x) => x.ord).filter((o) => o !== ord));
  }
  async function addField(t) {
    let name = "Field";
    for (let i = 2; t.fields.some((f) => f.name === name); i++) name = `Field ${i}`;
    let notes = [...S.notes.values()].filter((n) => n.mid === t.id);
    await putMany([["notetype", t.id, { ...t, fields: [...t.fields, { name, ord: t.fields.length }] }], ...notes.map((n) => ["note", n.id, { ...n, flds: [...n.flds, ""] }])]), showTypes();
  }
  async function templateAct(t, ord, a) {
    let tm = t.templates.find((x) => x.ord === ord);
    if (a === "ren") {
      let name = prompt("Card type name", tm.name)?.trim();
      name && await put("notetype", t.id, { ...t, templates: t.templates.map((x) => x.ord === ord ? { ...x, name } : x) });
    }
    if (a === "add") {
      let nord = Math.max(...t.templates.map((x) => x.ord)) + 1, nt = { ...t, templates: [...t.templates, { ...tm, name: `${tm.name} copy`, ord: nord }] }, now = Date.now(), cards = [...S.notes.values()].filter((n) => n.mid === t.id && frontShows(nt, n, nord)).map((n, i) => ({ id: now + i, nid: n.id, did: col().deck, ord: nord, type: 0, queue: 0, due: Math.floor(now / 1e3), ivl: 0, reps: 0, lapses: 0, left: 0, flags: 0, mod: now, revs: [] }));
      if (!confirm(`Add a card type? It makes ${cards.length} new cards.`)) return;
      await putMany([["notetype", t.id, nt], ...cards.map((c) => ["card", c.id, c])]), TY.tmpl = nord;
    }
    if (a === "del") {
      let cards = [...S.cards.values()].filter((c) => c.ord === ord && S.notes.get(c.nid)?.mid === t.id);
      if (!confirm(`Delete the card type ${tm.name} and its ${cards.length} cards?`)) return;
      await putMany([["notetype", t.id, { ...t, templates: t.templates.filter((x) => x.ord !== ord) }], ...cards.map((c) => ["card", c.id, null])]), TY.tmpl = t.templates.find((x) => x.ord !== ord).ord;
    }
    showTypes();
  }
  var settingsNav = (on) => `<nav class="seg sub">${[["options", "Deck options"], ["types", "Note types"], ["check", "Check with Anki"]].map(([v, l]) => `<button type="button" data-go="${v}" aria-current="${v === on}">${l}</button>`).join("")}</nav>`, bindSettingsNav = () => app.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => go(b.dataset.go)), steps = (s) => s.map((m) => m >= 1440 && m % 1440 === 0 ? `${m / 1440}d` : m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m`).join(" "), parseSteps = (s) => s.split(/[\s,]+/).filter(Boolean).map((x) => {
    let m = /^([\d.]+)([smhd]?)$/.exec(x);
    if (!m) throw new Error(`\u201C${x}\u201D isn\u2019t a step (1m, 10m, 1d).`);
    return Number(m[1]) * { s: 1 / 60, m: 1, h: 60, d: 1440, "": 1 }[m[2]];
  });
  function showOptions() {
    let c = S.confs.get(col().conf), f = (k, l, v, extra = "") => `<label class="opt"><span>${l}</span><input name="${k}" value="${esc2(v)}" ${extra}></label>`;
    app.innerHTML = `<section class="opts">${settingsNav("options")}<form class="optf">
    <h3>Daily limits</h3>${f("newPerDay", "New cards a day", c.newPerDay, 'inputmode="numeric"')}${f("revPerDay", "Reviews a day", c.revPerDay, 'inputmode="numeric"')}
    <h3>Steps</h3>${f("learnSteps", "Learning steps", steps(c.learnSteps))}${f("relearnSteps", "Relearning steps", steps(c.relearnSteps))}
    <h3>FSRS</h3>${f("retention", "Desired retention", c.retention, 'inputmode="decimal"')}${f("maxIvl", "Maximum interval (days)", c.maxIvl, 'inputmode="numeric"')}
    <label class="opt wide"><span>Weights</span><textarea name="w" rows="3" spellcheck="false">${c.w.join(", ")}</textarea></label>
    <h3>Leeches and siblings</h3>${f("leechThreshold", "Leech after lapses", c.leechThreshold, 'inputmode="numeric"')}
    <label class="opt"><span>Leech</span><select name="leechAction"><option value="1"${c.leechAction === 1 ? " selected" : ""}>Tag it</option><option value="0"${c.leechAction === 0 ? " selected" : ""}>Suspend it</option></select></label>
    <label class="opt chk"><input type="checkbox" name="buryNew"${c.buryNew ? " checked" : ""}><span>One new card per note a day</span></label>
    <label class="opt chk"><input type="checkbox" name="buryRev"${c.buryRev ? " checked" : ""}><span>One review card per note a day</span></label>
    <p class="formmsg" role="status"></p></form></section>`, bindSettingsNav();
    let form = $(".optf");
    form.onchange = async () => {
      let d = new FormData(form), g = (k) => String(d.get(k) ?? "").trim();
      try {
        let w = g("w").split(/[\s,]+/).filter(Boolean).map(Number);
        if (w.length < 19 || w.some((x) => !Number.isFinite(x))) throw new Error("Weights: 19 or 21 numbers.");
        let ret = Number(g("retention"));
        if (!(ret >= 0.7 && ret <= 0.99)) throw new Error("Retention between 0.70 and 0.99.");
        let next = { ...S.confs.get(c.id), newPerDay: Math.max(0, parseInt(g("newPerDay")) || 0), revPerDay: Math.max(0, parseInt(g("revPerDay")) || 0), learnSteps: parseSteps(g("learnSteps")), relearnSteps: parseSteps(g("relearnSteps")), retention: ret, maxIvl: Math.max(1, parseInt(g("maxIvl")) || 36500), w, leechThreshold: Math.max(0, parseInt(g("leechThreshold")) || 0), leechAction: Number(g("leechAction")), buryNew: d.has("buryNew"), buryRev: d.has("buryRev") };
        await put("conf", c.id, next), $(".formmsg").textContent = "Saved.";
      } catch (e) {
        $(".formmsg").textContent = e.message;
      }
    };
  }
  function showCheck() {
    let a = col().anki, k = ck(), cards = [...S.cards.values()], now = { cards: cards.length, notes: S.notes.size, revlog: cards.reduce((n, c) => n + c.revs.length, 0), forecast: forecast(cards, k) }, shift = k.today - (a?.day ?? k.today), days = Array.from({ length: 30 - shift }, (_, d) => [a?.forecast.days[d + shift] ?? 0, now.forecast.days[d]]), max = Math.max(1, ...days.flat()), sum = (i) => days.reduce((n, x) => n + x[i], 0), row = (l, x, y) => `<tr${x === y ? "" : ' class="off"'}><th>${l}</th><td>${x}</td><td>${y}</td></tr>`;
    app.innerHTML = `<section class="chk">${settingsNav("check")}
    <table class="cmp"><thead><tr><th></th><th>Anki</th><th>Here</th></tr></thead><tbody>
    ${a ? row("Cards", a.cards, now.cards) + row("Notes", a.notes, now.notes) + row("Reviews logged", a.revlog, now.revlog) + row("Overdue", a.forecast.backlog, now.forecast.backlog) + row(`Due in ${30 - shift} days`, sum(0), sum(1)) : ""}</tbody></table>
    <p class="muted">Anki as imported ${new Date(col().imported).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.</p>
    <div class="fc" role="img" aria-label="Due each day, Anki and here">${days.map(([x, y], d) => `<div class="fcd"><span class="fa" style="height:${x / max * 100}%"></span><span class="fh" style="height:${y / max * 100}%"></span><i>${d % 5 === 0 ? d ? "+" + d : "Today" : ""}</i></div>`).join("")}</div>
    <p class="legend"><span class="fa"></span>Anki <span class="fh"></span>Here</p></section>`, bindSettingsNav();
  }
  document.addEventListener("keydown", (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector("dialog[open]")) return;
    if ((MAC ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "z" && view === "review") return e.preventDefault(), undo();
    if (view === "review") {
      if ((e.key === " " || e.key === "Enter") && !RV.shown && RV.cur) return e.preventDefault(), act("show");
      if ((e.key === " " || e.key === "Enter") && RV.shown) return e.preventDefault(), grade(3);
      if (/^[1-4]$/.test(e.key) && RV.shown && !e.ctrlKey && !e.metaKey) return grade(Number(e.key));
      if (e.ctrlKey && /^[0-7]$/.test(e.key) && RV.cur) return e.preventDefault(), setFlag([RV.cur], Number(e.key)).then(showReview);
      if (e.key.toLowerCase() === "e") return act("edit");
      if (e.key.toLowerCase() === "r") {
        let root = $(".host")?.shadowRoot;
        root && playAll(root);
      }
      if (e.key === "@") return act("suspend");
      if (e.key === "-") return act("bury");
      if (e.key.toLowerCase() === "i") return act("info");
    }
  });
  function paintSync() {
    let el = $("#sync"), pending = S.outbox.size;
    el.dataset.s = navigator.onLine ? S.syncing ? "busy" : S.error ? "err" : pending ? "wait" : "ok" : "off", el.setAttribute("aria-label", navigator.onLine ? S.error ? S.error : S.syncing ? "Syncing" : "Synced" : `Offline, ${pending} change(s) waiting`), el.textContent = navigator.onLine ? "" : pending ? String(pending) : "";
  }
  onChange((what) => {
    paintSync(), what === "pulled" && (view === "review" && !RV.shown && !document.querySelector("dialog[open]") && showReview(), view === "browse" && paintBrowse());
  });
  (async () => {
    document.querySelectorAll("#nav [data-v]").forEach((b) => b.onclick = () => go(b.dataset.v === "more" ? "options" : b.dataset.v)), $("#sync").onclick = () => sync();
    let have = !1;
    try {
      have = await load();
    } catch {
    }
    if (have)
      sync();
    else if (app.innerHTML = '<p class="loading">Bringing your cards over\u2026</p>', await sync(), !S.meta.has("col")) {
      app.innerHTML = `<p class="loading">${S.error ? esc2(S.error) : navigator.onLine ? "Nothing here yet: the Anki import hasn\u2019t run." : "Needs signal the first time."}</p>`;
      return;
    }
    paintSync();
    let v = "review";
    try {
      v = sessionStorage.getItem("cbp-view") || "review";
    } catch {
    }
    go(views[v] ? v : "review"), "serviceWorker" in navigator && navigator.serviceWorker.register("/plus/sw.js", { scope: "/plus/" }).catch(() => {
    }), setTimeout(prefetch, 4e3);
  })();
  async function prefetch() {
    if (!navigator.onLine) return;
    let k = ck(), urls = /* @__PURE__ */ new Set();
    for (let c of S.cards.values())
      if (c.queue === 2 || c.queue === 3 ? c.due <= k.today + 3 : c.queue === 0 || c.queue === 1)
        for (let f of S.notes.get(c.nid)?.flds ?? []) for (let m of f.matchAll(/\/api\/plus\/media\/[0-9a-f]{32}\.\w+/g)) urls.add(m[0]);
    let q = [...urls];
    await Promise.all(Array.from({ length: 4 }, async () => {
      for (let u; u = q.shift(); ) await fetch(u).catch(() => {
      });
    }));
  }
})();
