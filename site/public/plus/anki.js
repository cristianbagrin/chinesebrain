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
    S.outbox.set(key, { kind, id: String(id), data, mod, drop: dropped(prev?.drop, drop, data) }), await tx("rows", "readwrite", (s) => data == null ? s.delete(key) : s.put(data, key)), await saveOutbox(), emit(kind), soon();
  }
  var dropped = (a = [], b = [], data) => {
    let back = new Set((data?.revs ?? []).map((r) => r[0])), out = [.../* @__PURE__ */ new Set([...a, ...b])].filter((x) => !back.has(x));
    return out.length ? out : void 0;
  };
  async function putMany(items) {
    let mod = Date.now();
    for (let [kind, id, data, drop] of items) {
      data && (data.mod = mod), place(kind, String(id), data);
      let prev = S.outbox.get(`${kind}:${id}`);
      S.outbox.set(`${kind}:${id}`, { kind, id: String(id), data, mod, drop: dropped(prev?.drop, drop, data) });
    }
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
  var BOUNDS = [
    [1e-3, 100],
    [1e-3, 100],
    [1e-3, 100],
    [1e-3, 100],
    [1, 10],
    [1e-3, 4],
    [1e-3, 4],
    [1e-3, 0.75],
    [0, 4.5],
    [0, 0.8],
    [1e-3, 3.5],
    [1e-3, 5],
    [1e-3, 0.25],
    [1e-3, 0.9],
    [0, 4],
    [0, 1],
    [1, 6],
    [0, 2],
    [0, 2],
    [0, 0.8],
    [0.1, 0.8]
  ];
  function loss(w, hs) {
    let f = new Fsrs(w), sum = 0, n = 0;
    for (let h of hs) {
      let m = null, last = 0;
      for (let r of h) {
        let t = m ? r.day - last : 0;
        if (m && t > 0) {
          let p = Math.min(0.999999, Math.max(1e-6, f.r(t, m.s)));
          sum -= r.g > 1 ? Math.log(p) : Math.log(1 - p), n++;
        }
        m = f.step(m, t, r.g), last = r.day;
      }
    }
    return n ? sum / n : 1 / 0;
  }
  async function optimize(w0, hs, steps = 160, tick) {
    let w = new Fsrs(w0).w.slice(), clip = (x) => x.map((v2, i) => Math.min(BOUNDS[i][1], Math.max(BOUNDS[i][0], v2))), before = loss(w, hs), cur = clip(w), m = Array(21).fill(0), v = Array(21).fill(0), lr = 0.02, b1 = 0.9, b2 = 0.999;
    for (let s = 1; s <= steps; s++) {
      let g = cur.map((x, i) => {
        let h = Math.max(1e-4, Math.abs(x) * 1e-3), up = cur.slice(), dn = cur.slice();
        return up[i] = x + h, dn[i] = x - h, (loss(up, hs) - loss(dn, hs)) / (2 * h);
      });
      m = m.map((mi, i) => b1 * mi + (1 - b1) * g[i]), v = v.map((vi, i) => b2 * vi + (1 - b2) * g[i] * g[i]), cur = clip(cur.map((x, i) => x - lr * Math.max(0.05, Math.abs(x)) * (m[i] / (1 - b1 ** s)) / (Math.sqrt(v[i] / (1 - b2 ** s)) + 1e-8))), tick && s % 4 === 0 && await tick();
    }
    let after = loss(cur, hs);
    return { w: cur.map((x) => Math.round(x * 1e4) / 1e4), before, after };
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
  function answer(c0, g, conf2, ck2, ms = 0) {
    let f = new Fsrs(conf2.w), c = { ...c0, revs: c0.revs }, mem = memoryOf(c0), t = c0.lrt ? Math.max(0, ck2.today - ck2.dayOf(c0.lrt * 1e3)) : 0, next = f.step(mem, mem ? t : 0, g), rand = seedRand(c0.id, c0.reps), ivlOf = (s, min = 1) => constrain(f.interval(s, conf2.retention), min, conf2.maxIvl, rand), steps = c0.type === 0 || c0.type === 1 ? conf2.learnSteps : conf2.relearnSteps, lastIvl = c0.queue === 1 ? -Math.round(stepAt(steps, c0) * 60) : c0.ivl, revType = c0.type === 2 ? 1 : c0.type === 3 ? 2 : 0, leech = !1, toStep = (mins, left2) => (c.left = left2, mins >= 1440 ? (c.queue = 3, c.due = ck2.today + Math.round(mins / 1440), Math.round(mins / 1440)) : (c.queue = 1, c.due = Math.round(ck2.now / 1e3 + mins * 60), -Math.round(mins * 60))), graduate = (s, min = 1) => (c.type = 2, c.queue = 2, c.left = 0, c.ivl = ivlOf(s, min), c.due = ck2.today + c.ivl, c.ivl), ivl;
    if (c0.type === 2)
      if (g === 1) {
        c.lapses = c0.lapses + 1, c.ivl = ivlOf(next.s), conf2.relearnSteps.length ? (c.type = 3, ivl = toStep(conf2.relearnSteps[0], conf2.relearnSteps.length)) : ivl = graduate(next.s);
        let th = conf2.leechThreshold;
        th > 0 && c.lapses >= th && (c.lapses - th) % Math.max(1, Math.ceil(th / 2)) === 0 && (leech = !0, conf2.leechAction === 0 && (c.queue = -1));
      } else {
        let hard = ivlOf(f.step(mem, t, 2).s, 1), good = ivlOf(f.step(mem, t, 3).s, hard + 1), easy = ivlOf(f.step(mem, t, 4).s, good + 1);
        c.ivl = g === 2 ? hard : g === 3 ? good : easy, c.due = ck2.today + c.ivl, ivl = c.ivl;
      }
    else {
      let remaining = c0.type === 0 ? steps.length : c0.left % 1e3 || steps.length, idx = Math.max(0, steps.length - remaining);
      if (c0.type === 0 && (c.type = 1), !steps.length || g === 4) ivl = graduate(next.s);
      else if (g === 1) ivl = toStep(steps[0], steps.length);
      else if (g === 2) {
        let d = idx === 0 ? steps.length > 1 ? (steps[0] + steps[1]) / 2 : Math.min(steps[0] * 1.5, steps[0] + 1440) : steps[idx];
        ivl = toStep(d, remaining);
      } else idx + 1 < steps.length ? ivl = toStep(steps[idx + 1], steps.length - idx - 1) : ivl = graduate(next.s);
    }
    c.reps = c0.reps + 1, c.s = next.s, c.d = next.d, c.lrt = Math.floor(ck2.now / 1e3), c.mod = ck2.now;
    let rev = [ck2.now, g, ivl, lastIvl, Math.round(next.d * 1e3), Math.min(ms, 6e4), revType];
    return c.revs = [...c0.revs ?? [], rev], { card: c, rev, leech, label: label(ivl) };
  }
  function stepAt(steps, c) {
    if (!steps.length) return 0;
    let remaining = c.left % 1e3 || steps.length;
    return steps[Math.min(steps.length - 1, Math.max(0, steps.length - remaining))];
  }
  function label(ivl) {
    if (ivl < 0) {
      let m = -ivl / 60;
      return m < 60 ? `${Math.max(1, Math.round(m))}m` : `${Math.round(m / 60)}h`;
    }
    return ivl < 30 ? `${ivl}d` : ivl < 365 ? `${(ivl / 30).toFixed(1).replace(/\.0$/, "")}mo` : `${(ivl / 365).toFixed(1).replace(/\.0$/, "")}y`;
  }
  function queue(cards, conf2, ck2, seen, newToday, revToday) {
    let learn = [], review = [], fresh = [];
    for (let c of cards)
      c.queue === 1 && c.due * 1e3 <= ck2.now + LEARN_AHEAD ? learn.push(c) : (c.queue === 2 || c.queue === 3) && c.due <= ck2.today ? review.push(c) : c.queue === 0 && fresh.push(c);
    learn.sort((a, b) => a.due - b.due), review.sort((a, b) => a.due - b.due || seedRand(a.id, ck2.today) - seedRand(b.id, ck2.today)), fresh.sort((a, b) => a.due - b.due || a.ord - b.ord);
    let sib = (list, bury) => bury ? list.filter((c) => seen.has(c.nid) ? !1 : (seen.add(c.nid), !0)) : list, blocked = new Set(seen);
    learn.forEach((c) => blocked.add(c.nid));
    let r = sib(review.filter((c) => !blocked.has(c.nid) || !conf2.buryRev), conf2.buryRev).slice(0, Math.max(0, conf2.revPerDay - revToday));
    r.forEach((c) => blocked.add(c.nid));
    let n = sib(fresh.filter((c) => !blocked.has(c.nid) || !conf2.buryNew), conf2.buryNew).slice(0, Math.max(0, conf2.newPerDay - newToday));
    return { learn, review: r, fresh: n };
  }
  var grades = (c, n) => c.revs.filter((r) => r[1] >= 1 && r[1] <= 4 && r[6] !== 4 && r[6] !== 5).slice(-n).map((r) => r[1]), missed3 = (c) => {
    let g = grades(c, 3);
    return g.length === 3 && g.every((x) => x === 1);
  }, right3 = (c) => {
    let g = grades(c, 3);
    return g.length === 3 && g.every((x) => x >= 2) && g[2] >= 3;
  };
  function historyOf(c, dayOf) {
    let revs = c.revs, kept = revs.filter((r) => r[1] >= 1 && r[1] <= 4 && r[6] !== 4 && r[6] !== 5 && !(r[6] === 3 && r[2] === 0 && r[4] === 0)), reset = -1;
    revs.forEach((r, i) => r[6] === 4 && r[1] === 0 && r[2] === 0 && (reset = i));
    let after = reset >= 0 ? kept.filter((r) => r[0] > revs[reset][0]) : kept, start2 = -1;
    for (let i = 0; i < after.length; i++) after[i][6] === 0 && (i === 0 || after[i - 1][6] !== 0) && (start2 = i);
    return start2 < 0 ? null : after.slice(start2).map((r) => ({ day: dayOf(r[0]), g: r[1] }));
  }

  // site/src/cbp/review/render.ts
  var strip = (html) => String(html ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/\[sound:[^\]]*\]/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(), nonEmpty = (html) => !!strip(html) || /<img\b|\[sound:/i.test(html ?? ""), esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function render(tmpl, x, front, mark) {
    let fields = new Map(x.type.fields.map((f) => [f.name, x.note.flds[f.ord] ?? ""])), t = x.type.templates.find((t2) => t2.ord === x.card.ord), special = { FrontSide: front ?? "", Tags: esc(x.note.tags.join(" ")), Deck: esc(x.deck ?? ""), Subdeck: esc((x.deck ?? "").split("::").pop() ?? ""), Card: esc(t?.name ?? ""), Type: esc(x.type.name) }, value = (name) => name in special ? special[name] : fields.get(name) ?? "", s = tmpl;
    for (let guard = 0; guard < 50; guard++) {
      let before = s;
      if (s = s.replace(/\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\s*\2\s*\}\}/g, (_, k, name, inner) => k === "#" === nonEmpty(value(name)) ? inner : ""), s === before) break;
    }
    let hints = 0;
    return s = s.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, spec) => {
      let parts = spec.split(":"), name = parts.pop().trim(), filters = parts.map((p) => p.trim()), v = value(name);
      if (mark !== void 0 && !(name in special) && !filters.includes("hint")) return nonEmpty(v) ? mark : "";
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
    return t ? render(t.qfmt, { note, type, card: { ord } }, void 0, "").includes("") : !1;
  }
  var SHOWS = /* @__PURE__ */ new Map();
  function showable(cards, noteOf, typeOf2) {
    return cards.filter((c) => {
      let n = noteOf(c.nid), t = n && typeOf2(n);
      if (!n || !t) return !1;
      let k = SHOWS.get(c.id);
      if (k && k[0] === n.mod && k[1] === t.mod) return k[2];
      let v = frontShows(t, n, c.ord);
      return SHOWS.set(c.id, [n.mod, t.mod, v]), v;
    });
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

  // site/src/cbp/review/export.ts
  var US = "", secs = (ms) => Math.floor(ms / 1e3);
  function loadSql() {
    return new Promise((ok, no) => {
      if (typeof initSqlJs == "function") return initSqlJs({ locateFile: (f) => `/plus/vendor/${f}` }).then(ok, no);
      let s = document.createElement("script");
      s.src = "/plus/vendor/sql-wasm.js", s.onload = () => initSqlJs({ locateFile: (f) => `/plus/vendor/${f}` }).then(ok, no), s.onerror = () => no(new Error("Needs signal once to get the packer.")), document.head.append(s);
    });
  }
  var CRC = (() => {
    let t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })(), crc32 = (b) => {
    let c = 4294967295;
    for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ c >>> 8;
    return (c ^ 4294967295) >>> 0;
  }, Zip = class {
    parts = [];
    dir = [];
    at = 0;
    n = 0;
    add(name, data) {
      let nm = new TextEncoder().encode(name), crc = crc32(data), head = new Uint8Array(30 + nm.length), h = new DataView(head.buffer);
      h.setUint32(0, 67324752, !0), h.setUint16(4, 20, !0), h.setUint16(6, 2048, !0), h.setUint32(14, crc, !0), h.setUint32(18, data.length, !0), h.setUint32(22, data.length, !0), h.setUint16(26, nm.length, !0), head.set(nm, 30);
      let cd = new Uint8Array(46 + nm.length), c = new DataView(cd.buffer);
      c.setUint32(0, 33639248, !0), c.setUint16(4, 20, !0), c.setUint16(6, 20, !0), c.setUint16(8, 2048, !0), c.setUint32(16, crc, !0), c.setUint32(20, data.length, !0), c.setUint32(24, data.length, !0), c.setUint16(28, nm.length, !0), c.setUint32(42, this.at, !0), cd.set(nm, 46), this.parts.push(head, data), this.dir.push(cd), this.at += head.length + data.length, this.n++;
    }
    blob() {
      let size = this.dir.reduce((s, d) => s + d.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
      return e.setUint32(0, 101010256, !0), e.setUint16(8, this.n, !0), e.setUint16(10, this.n, !0), e.setUint32(12, size, !0), e.setUint32(16, this.at, !0), new Blob([...this.parts, ...this.dir, end], { type: "application/zip" });
    }
  };
  async function sha1Int(s) {
    let h = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s)));
    return (h[0] << 24 | h[1] << 16 | h[2] << 8 | h[3]) >>> 0;
  }
  var plain = (f) => strip(f.replace(/<img[^>]*src=["']?([^"' >]+)["']?[^>]*>/gi, " $1 "));
  async function exportAnki(progress) {
    let col2 = S.meta.get("col");
    if (!col2) throw new Error("Nothing to export yet.");
    progress("Packing\u2026");
    let SQL = await loadSql(), names = {};
    try {
      names = Object.fromEntries(Object.entries(await api("anki/media-map")).map(([n, u]) => [u, n]));
    } catch {
      if (!navigator.onLine) throw new Error("Needs signal: the pictures and sounds come from the site.");
    }
    let MEDIA = /\/api\/plus\/media\/[0-9a-f]{32}\.\w+/g, used = /* @__PURE__ */ new Map(), nameOf = (u) => {
      let n = used.get(u);
      return n || (n = names[u] ?? u.split("/").pop(), used.set(u, n)), n;
    }, toAnki = (f) => f.replace(MEDIA, (u) => nameOf(u)), db2 = new SQL.Database();
    db2.run(SCHEMA);
    let now = Date.now(), conf2 = [...S.confs.values()], types = [...S.types.values()], decks = [...S.decks.values()], offset = -(/* @__PURE__ */ new Date()).getTimezoneOffset(), crt = Date.UTC(+col2.day0.slice(0, 4), +col2.day0.slice(5, 7) - 1, +col2.day0.slice(8, 10)) / 1e3 + col2.rollover * 3600 - offset * 60, cfg = {
      activeDecks: [col2.deck],
      curDeck: col2.deck,
      curModel: col2.notetype,
      newSpread: 0,
      collapseTime: 1200,
      timeLim: 0,
      estTimes: !0,
      dueCounts: !0,
      sortType: "noteCrt",
      sortBackwards: !1,
      addToCur: !0,
      nextPos: S.cards.size + 1,
      schedVer: 2,
      sched2021: !0,
      fsrs: !0,
      rollover: col2.rollover,
      creationOffset: -offset,
      localOffset: -offset,
      dayLearnFirst: !1,
      // what's buried today stays buried until tomorrow, as in Anki
      lastUnburied: clock(col2.day0, col2.rollover).today
    }, models = {}, tmplAt = /* @__PURE__ */ new Map();
    for (let t of types)
      models[t.id] = {
        id: t.id,
        name: t.name,
        type: t.kind ?? 0,
        mod: secs(t.mod || now),
        usn: -1,
        sortf: t.sortf ?? 0,
        did: null,
        tmpls: t.templates.slice().sort((a2, b) => a2.ord - b.ord).map((x, i2) => ({ name: x.name, ord: i2, qfmt: x.qfmt, afmt: x.afmt, bqfmt: "", bafmt: "", did: null, bfont: "", bsize: 0, id: null })),
        flds: t.fields.slice().sort((a2, b) => a2.ord - b.ord).map((f, i2) => ({ name: f.name, ord: i2, sticky: !1, rtl: !1, font: "Arial", size: 20, description: "", plainText: !1, collapsed: !1, excludeFromSearch: !1, id: null, tag: null, preventDeletion: !1 })),
        css: t.css,
        latexPre: LATEX_PRE,
        latexPost: "\\end{document}",
        latexsvg: !1,
        req: t.templates.map((x, i2) => [i2, "any", [0]]),
        originalStockKind: 1
      }, t.templates.slice().sort((a2, b) => a2.ord - b.ord).forEach((x, i2) => tmplAt.set(`${t.id}:${x.ord}`, i2));
    let deckJson = {
      1: { id: 1, mod: 0, name: "Default", usn: 0, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: !0, browserCollapsed: !0, desc: "", dyn: 0, conf: 1, extendNew: 0, extendRev: 0 }
    };
    for (let d2 of decks) deckJson[d2.id] = { id: d2.id, mod: secs(d2.mod || now), name: d2.name, usn: -1, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: !1, browserCollapsed: !1, desc: "", dyn: 0, conf: d2.conf, extendNew: 0, extendRev: 0 };
    let dconf = {};
    for (let c of conf2)
      dconf[c.id] = {
        id: c.id,
        mod: secs(c.mod || now),
        name: c.name || "Default",
        usn: -1,
        maxTaken: 60,
        autoplay: !0,
        timer: 0,
        replayq: !0,
        dyn: !1,
        new: { bury: c.buryNew, delays: c.learnSteps, initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: c.newPerDay },
        rev: { bury: c.buryRev, ease4: 1.3, ivlFct: 1, maxIvl: c.maxIvl, perDay: c.revPerDay, hardFactor: 1.2 },
        lapse: { delays: c.relearnSteps, leechAction: c.leechAction, leechFails: c.leechThreshold, minInt: 1, mult: 0 },
        newMix: 0,
        newPerDayMinimum: 0,
        interdayLearningMix: 0,
        reviewOrder: 0,
        newSortOrder: 0,
        newGatherPriority: 0,
        buryInterdayLearning: c.buryRev,
        fsrsWeights: [],
        fsrsParams5: [],
        fsrsParams6: c.w.length >= 21 ? c.w : [],
        desiredRetention: c.retention,
        ignoreRevlogsBeforeDate: "1970-01-01",
        easyDaysPercentages: [1, 1, 1, 1, 1, 1, 1],
        stopTimerOnAnswer: !1,
        secondsToShowQuestion: 0,
        secondsToShowAnswer: 0,
        questionAction: 0,
        answerAction: 0,
        waitForAudio: !0,
        sm2Retention: 0.9,
        weightSearch: ""
      };
    let tags = /* @__PURE__ */ new Set();
    S.notes.forEach((n) => n.tags.forEach((t) => tags.add(t))), db2.run("INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)", [crt, now, now, JSON.stringify(cfg), JSON.stringify(models), JSON.stringify(deckJson), JSON.stringify(dconf), JSON.stringify(Object.fromEntries([...tags].map((t) => [t, 0])))]), progress("Notes\u2026"), db2.run("BEGIN");
    let ins = db2.prepare("INSERT INTO notes VALUES (?,?,?,?,-1,?,?,?,?,0,?)"), alive = /* @__PURE__ */ new Set();
    for (let n of S.notes.values()) {
      let t = S.types.get(n.mid);
      if (!t) continue;
      let flds = n.flds.slice(0, t.fields.length).map(toAnki);
      for (; flds.length < t.fields.length; ) flds.push("");
      let sort = plain(flds[t.sortf ?? 0] ?? "");
      ins.run([n.id, n.guid, n.mid, secs(n.mod || now), n.tags.length ? ` ${n.tags.join(" ")} ` : "", flds.join(US), sort, await sha1Int(plain(flds[0] ?? "")), ""]), alive.add(n.id);
    }
    ins.free();
    let insC = db2.prepare("INSERT INTO cards VALUES (?,?,?,?,?,-1,?,?,?,?,?,?,?,?,?,0,?,?)"), insR = db2.prepare("INSERT INTO revlog VALUES (?,?,-1,?,?,?,?,?,?)"), reviews = 0;
    for (let c of S.cards.values()) {
      let ord = tmplAt.get(`${S.notes.get(c.nid)?.mid}:${c.ord}`);
      if (!alive.has(c.nid) || ord == null) continue;
      let data = c.s != null ? { s: round(c.s), d: round(c.d), dr: conf2.find((x) => x.id === (S.decks.get(c.did)?.conf ?? col2.conf))?.retention ?? 0.9, decay: round(confW(c)), ...c.lrt ? { lrt: c.lrt } : {} } : {};
      insC.run([c.id, c.nid, S.decks.has(c.did) ? c.did : col2.deck, ord, secs(c.mod || now), c.type, c.queue, c.due, c.ivl, c.type === 0 ? 0 : 2500, c.reps, c.lapses, c.left, c.odue ?? 0, c.flags & 7, JSON.stringify(data)]);
      for (let r of c.revs)
        insR.run([r[0], c.id, r[1], r[2], r[3], r[4], r[5], r[6]]), reviews++;
    }
    insC.free(), insR.free(), db2.run("COMMIT");
    let sqlite = db2.export();
    db2.close();
    let zip = new Zip();
    zip.add("collection.anki21", sqlite);
    let list = [...used], media = {}, got = [], i = 0, done = 0;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (; ; ) {
          let k = i++;
          if (k >= list.length) return;
          try {
            let r = await fetch(list[k][0]);
            r.ok && got.push([k, new Uint8Array(await r.arrayBuffer())]);
          } catch {
          }
          done++, done % 20 === 0 && progress(`Pictures ${Math.round(done / list.length * 100)}%`);
        }
      })
    ), got.sort((a2, b) => a2[0] - b[0]), got.forEach(([k, bytes], n) => {
      media[n] = list[k][1], zip.add(String(n), bytes);
    }), zip.add("media", new TextEncoder().encode(JSON.stringify(media))), zip.add("meta", new Uint8Array([8, 2]));
    let d = /* @__PURE__ */ new Date(), file = `Chinese ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.colpkg`, a = document.createElement("a");
    return a.href = URL.createObjectURL(zip.blob()), a.download = file, document.body.append(a), a.click(), a.remove(), setTimeout(() => URL.revokeObjectURL(a.href), 6e4), { notes: alive.size, reviews, media: got.length, missing: list.length - got.length };
  }
  var round = (x) => Math.round(x * 1e4) / 1e4, confW = (c) => (S.confs.get(S.decks.get(c.did)?.conf ?? S.meta.get("col").conf) ?? [...S.confs.values()][0]).w[20] ?? 0.5, LATEX_PRE = `\\documentclass[12pt]{article}
\\special{papersize=3in,5in}
\\usepackage[utf8]{inputenc}
\\usepackage{amssymb,amsmath}
\\pagestyle{empty}
\\setlength{\\parindent}{0in}
\\begin{document}
`, SCHEMA = `CREATE TABLE col (id integer PRIMARY KEY, crt integer NOT NULL, mod integer NOT NULL, scm integer NOT NULL, ver integer NOT NULL, dty integer NOT NULL, usn integer NOT NULL, ls integer NOT NULL, conf text NOT NULL, models text NOT NULL, decks text NOT NULL, dconf text NOT NULL, tags text NOT NULL);
CREATE TABLE notes (id integer PRIMARY KEY, guid text NOT NULL, mid integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, tags text NOT NULL, flds text NOT NULL, sfld integer NOT NULL, csum integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE cards (id integer PRIMARY KEY, nid integer NOT NULL, did integer NOT NULL, ord integer NOT NULL, mod integer NOT NULL, usn integer NOT NULL, type integer NOT NULL, queue integer NOT NULL, due integer NOT NULL, ivl integer NOT NULL, factor integer NOT NULL, reps integer NOT NULL, lapses integer NOT NULL, left integer NOT NULL, odue integer NOT NULL, odid integer NOT NULL, flags integer NOT NULL, data text NOT NULL);
CREATE TABLE revlog (id integer PRIMARY KEY, cid integer NOT NULL, usn integer NOT NULL, ease integer NOT NULL, ivl integer NOT NULL, lastIvl integer NOT NULL, factor integer NOT NULL, time integer NOT NULL, type integer NOT NULL);
CREATE TABLE graves (usn integer NOT NULL, oid integer NOT NULL, type integer NOT NULL);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_notes_csum ON notes (csum);`;

  // site/src/cbp/review/main.ts
  var $ = (s, el = document) => el.querySelector(s), esc2 = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]), TOUCH = matchMedia("(hover: none)").matches, TAB = document.createElement("button");
  TAB.type = "button";
  TAB.setAttribute("role", "tab");
  TAB.id = "tab-reviews";
  TAB.setAttribute("aria-controls", "view-reviews");
  TAB.setAttribute("aria-selected", "false");
  TAB.tabIndex = -1;
  TAB.innerHTML = 'Reviews<i class="dot gold" id="dot-reviews" hidden></i>';
  document.getElementById("tab-today").after(TAB);
  var VIEW_EL = document.createElement("section");
  VIEW_EL.className = "view";
  VIEW_EL.id = "view-reviews";
  VIEW_EL.setAttribute("role", "tabpanel");
  VIEW_EL.setAttribute("aria-labelledby", "tab-reviews");
  VIEW_EL.hidden = !0;
  document.getElementById("view-today").after(VIEW_EL);
  VIEWS.splice(VIEWS.indexOf("today") + 1, 0, "reviews");
  VIEW_EL.innerHTML = `<div class="rx">
  <header class="rx-top rx-opt">
    <nav class="rx-seg" aria-label="Reviews"><button type="button" data-v="review">Review</button><button type="button" data-v="browse">Browse</button></nav>
  </header>
  <div class="rx-body"></div>
</div>`;
  var app = $(".rx-body", VIEW_EL), col = () => S.meta.get("col"), ck = () => clock(col().day0, col().rollover), conf = () => S.confs.get(col().conf) ?? [...S.confs.values()][0], typeOf = (n) => S.types.get(n.mid), rowOf = (c) => {
    let note = S.notes.get(c.nid);
    return note ? { card: c, note, type: typeOf(note) } : null;
  }, cardsOf = (nid) => [...S.cards.values()].filter((c) => c.nid === nid).sort((a, b) => a.ord - b.ord), live = () => [...S.cards.values()].filter((c) => S.notes.has(c.nid)), studyable = () => showable(live(), (id) => S.notes.get(id), typeOf), wordOfNote = (n) => wordOf(typeOf(n), n) || sortText(typeOf(n), n) || strip(n.flds.find((f) => strip(f)) ?? ""), wordOfCard = (c) => {
    let n = S.notes.get(c.nid);
    return n ? wordOfNote(n) : "";
  }, dueText = (c, k = ck()) => {
    if (c.queue === -1) return "Suspended";
    if (c.type === 0) return "New";
    if (c.queue === 1) return new Date(c.due * 1e3).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    let d = c.due - k.today;
    return d === 0 ? "Today" : d === 1 ? "Tomorrow" : d < 0 ? `${-d} days late` : new Date(Date.now() + d * 864e5).toLocaleDateString([], { month: "short", day: "numeric", ...d > 300 ? { year: "numeric" } : {} });
  }, unsuspended = (c) => c.type === 0 ? 0 : c.type === 2 ? 2 : (c.type === 3, 1);
  function today() {
    let k = ck(), fresh = 0, revs = 0, done = 0, seen = /* @__PURE__ */ new Set();
    for (let c of S.cards.values()) {
      let t = c.revs.filter((r) => k.dayOf(r[0]) === k.today && r[6] <= 3 && r[1] > 0);
      t.length && (done += t.length, seen.add(c.nid), c.revs[0] && k.dayOf(c.revs[0][0]) === k.today && c.revs[0][6] === 0 && fresh++, t.some((r) => r[6] === 1) && revs++);
    }
    return { fresh, revs, seen, done };
  }
  var MORE = { day: -1, fresh: 0, ahead: !1 }, more = () => {
    let d = ck().today;
    return MORE.day !== d && Object.assign(MORE, { day: d, fresh: 0, ahead: !1 }), MORE;
  };
  function todayQueue() {
    let k = ck(), t = today();
    return { k, t, q: queue(studyable(), conf(), k, new Set(t.seen), Math.max(0, t.fresh - more().fresh), t.revs) };
  }
  function ahead() {
    let k = ck(), seen = today().seen;
    return studyable().filter((c) => (c.queue === 2 || c.queue === 3) && c.due > k.today && !seen.has(c.nid)).sort((a, b) => a.due - b.due || a.id - b.id)[0] ?? null;
  }
  var toastEl = null, toastT;
  function toast(msg, undoable = !1) {
    hideToast(!0), toastEl?.remove();
    let el = toastEl = document.createElement("div");
    el.className = "toast", el.setAttribute("role", "status"), el.innerHTML = `<span>${msg}</span>${undoable ? '<button type="button">Undo</button>' : ""}`, undoable && (el.querySelector("button").onclick = () => (dropToast(), undo())), document.body.append(el), clearTimeout(toastT), toastT = setTimeout(dropToast, 5e3);
  }
  function dropToast() {
    let el = toastEl;
    toastEl = null, el && (el.classList.add("out"), setTimeout(() => el.remove(), 220));
  }
  var H = { undo: [], redo: [] }, clone = (x) => x == null ? x : JSON.parse(JSON.stringify(x)), revIds = (c) => new Set((c?.revs ?? []).map((r) => r[0]));
  async function change(name, rows, card) {
    let cur = (k, id) => k === "card" ? S.cards.get(+id) : k === "note" ? S.notes.get(+id) : k === "conf" ? S.confs.get(+id) : k === "notetype" ? S.types.get(+id) : S.meta.get(String(id)), step = { name, card, rows: rows.map(([k, id, after]) => [k, id, clone(cur(k, id) ?? null), clone(after)]) };
    H.undo.push(step), H.undo.length > 200 && H.undo.shift(), H.redo = [], await apply(step, "after");
  }
  async function apply(step, side) {
    let other = side === "after" ? "before" : "after";
    await putMany(
      step.rows.map(([k, id, before, after]) => {
        let data = clone(side === "after" ? after : before), gone = k === "card" ? [...revIds(side === "after" ? before : after)].filter((x) => !revIds(data).has(x)) : [];
        return [k, id, data, gone.length ? gone : void 0];
      })
    );
  }
  async function undo() {
    let s = H.undo.pop();
    s && (await apply(s, "before"), H.redo.push(s), sfx("unstamp"), afterHistory(s, !0));
  }
  async function redo() {
    let s = H.redo.pop();
    s && (await apply(s, "after"), H.undo.push(s), sfx("tap"), afterHistory(s, !1));
  }
  function afterHistory(s, undone) {
    toast(`${undone ? "Undone" : "Redone"}: ${esc2(s.name)}`), view === "review" ? (undone && s.card && S.cards.has(s.card) ? (RV.cur = S.cards.get(s.card), RV.shown = !1, RV.py = RUBY.shown(), RV.t0 = Date.now(), RV.panel = "") : RV.cur = null, showReview()) : paint();
  }
  function playAll(root) {
    if (!root) return;
    let list = [...root.querySelectorAll("[data-sound]")].map((b) => b.dataset.sound);
    list.length && SOUND.play(list);
  }
  var autoplayed = "", cardCss = (t) => t.css.replace(/@import[^;]+;/g, ""), OVER = `:host{display:block}.card{background:transparent!important;min-height:100%;box-sizing:border-box}hr{border:0;border-top:1px solid #E4E6EC;margin:22px 0}
a.hint,.snd-btn,.hint-body{display:none!important}.audio:not(:has(:not(.snd-btn))){display:none}
img{max-width:100%!important;max-height:min(46vh,460px)!important;width:auto!important;height:auto!important;object-fit:contain!important}`;
  function draw(host, r, side) {
    let t = r.type, tmpl = t.templates.find((x) => x.ord === r.card.ord) ?? t.templates[0], ctx = { note: r.note, type: t, card: r.card, deck: S.decks.get(r.card.did)?.name }, q = render(tmpl.qfmt, ctx), html = side === "q" ? q : render(tmpl.afmt, ctx, q), root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    return root.innerHTML = `<style>${cardCss(t)}${OVER}${RUBY.CSS}</style><div class="card card${r.card.ord + 1}">${html}</div>`, root;
  }
  var view = "review";
  function go(v) {
    view === "browse" && v !== "browse" && closeSide(), view = v, VIEW_EL.querySelectorAll("[data-v]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.v === v))), app.className = "rx-body v-" + v, $(".rx", VIEW_EL).dataset.rx = v, paint();
    try {
      sessionStorage.setItem("cbp-rx", v);
    } catch {
    }
  }
  function paint() {
    ready && (view === "review" ? showReview() : view === "browse" ? showBrowse() : showDesigns());
  }
  VIEW_EL.querySelectorAll("[data-v]").forEach(
    (b) => b.onclick = () => {
      let v = b.dataset.v;
      sfx("tap"), v === "browse" && resetBrowse(), go(v);
    }
  );
  var sitting = !1, RV = { cur: null, shown: !1, py: !1, t0: 0, sinceNew: 0, panel: "", merge: null, deeperFor: 0, flags: !1 };
  function pick() {
    let { k, q } = todayQueue(), now = q.learn.filter((c) => c.due * 1e3 <= k.now);
    if (now.length) return now[0];
    let { review, fresh } = q;
    return fresh.length && (!review.length || RV.sinceNew >= Math.max(1, Math.floor(review.length / fresh.length))) ? fresh[0] : review.length ? review[0] : q.learn[0] ?? (more().ahead ? ahead() : null);
  }
  var left = () => {
    let { q } = todayQueue();
    return q.fresh.length + q.learn.length + q.review.length;
  };
  function showReview() {
    if (RV.panel === "deeper") return showDeeper();
    (!RV.cur || !S.cards.has(RV.cur.id) || RV.cur !== S.cards.get(RV.cur.id) || RV.cur.queue < 0) && (RV.cur = pick(), RV.shown = !1, RV.py = RUBY.shown(), RV.t0 = Date.now());
    let c = RV.cur, t = today(), n = c ? Math.max(1, left()) : 0, prog = `<div class="rx-prog" aria-hidden="true"><i style="width:${n ? Math.round(t.done / (t.done + n) * 100) : 100}%"></i></div>`;
    if (paintDot(), !c) {
      let nextLearn = live().filter((x) => x.queue === 1).sort((a, b) => a.due - b.due)[0], anyNew = live().some((x) => x.queue === 0);
      app.innerHTML = `${prog}<section class="rw rw-end"><p class="rw-done zh">\u4ECA\u5929\u8907\u7FD2\u5B8C\u4E86</p>
      ${nextLearn ? `<p class="rw-later">One more at ${new Date(nextLearn.due * 1e3).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>` : ""}
      <div class="rw-again">${anyNew ? '<button type="button" class="btn-q" data-more="new">Ten more new</button>' : ""}${ahead() ? '<button type="button" class="btn-q" data-more="ahead">Review ahead</button>' : ""}</div></section>`, app.querySelectorAll("[data-more]").forEach(
        (b) => b.onclick = () => {
          let m = more();
          b.dataset.more === "new" ? m.fresh += 10 : m.ahead = !0, sfx("tap"), showReview();
        }
      ), doneToday();
      return;
    }
    let r = rowOf(c), flag = c.flags & 7;
    app.innerHTML = `${prog}<section class="rw${flag ? " fl" + flag : ""}">
    ${RV.merge ? mergeBanner() : ""}
    <div class="rw-card"><div class="host${RV.py ? " py" : ""}"></div></div>
    <div class="rw-bar">${RV.shown ? `<div class="rw-g">${["Again", "Hard", "Good", "Easy"].map((x, i) => `<button type="button" class="rw-a rw-a${i + 1}" data-g="${i + 1}">${x}</button>`).join("")}</div>` : '<button type="button" class="rw-show" data-a="show">Show answer</button>'}</div>
    <div class="rw-more rx-opt">
      ${TOUCH ? '<button type="button" class="btn-q" data-a="py">Pinyin</button>' : ""}<button type="button" class="btn-q rw-snd" data-a="play" aria-label="Play" hidden>${SPEAKER}</button>
      <button type="button" class="btn-q" data-a="edit">Edit</button><button type="button" class="btn-q rw-flagb" data-a="flag" aria-haspopup="dialog" aria-expanded="${RV.flags}">Flag</button><button type="button" class="btn-q" data-a="suspend">Suspend</button>
    </div>
    ${RV.flags ? flagPicker(c) : ""}
  </section>`;
    let host = $(".host", app), root = draw(host, r, RV.shown ? "a" : "q"), loud = !!root.querySelector("[data-sound]");
    $(".rw-snd", app).hidden = !loud, host.classList.toggle("loud", loud), loud && (host.onclick = (e) => !e.composedPath().some((x) => x instanceof HTMLElement && x.matches("a,button,input,[contenteditable]")) && !String(getSelection() ?? "") && playAll(root));
    let side = `${c.id}:${RV.shown ? "a" : "q"}`;
    side !== autoplayed && (autoplayed = side, SOUND.autoplay() && playAll(root)), RV.py && RUBY.set(root.querySelector(".card"), !0), sitting || (sitting = !0, BUS.emit("reviews:start")), bindReview();
  }
  function bindReview() {
    app.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => act(b.dataset.a)), app.querySelectorAll("[data-g]").forEach((b) => b.onclick = () => grade(Number(b.dataset.g))), app.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => flagIt(Number(b.dataset.f))), app.querySelectorAll("[data-m]").forEach((b) => b.onclick = () => mergeAct(b.dataset.m));
  }
  var acted = !1, doneDay = "";
  function doneToday() {
    if (!acted) return;
    acted = !1;
    let d = String(ck().today);
    try {
      localStorage.getItem("rv-done") === d ? doneDay = d : localStorage.setItem("rv-done", d);
    } catch {
    }
    doneDay !== d && (doneDay = d, BUS.emit("reviews:done"));
  }
  BUS.on("reviews:done", () => {
    let el = VIEW === "reviews" ? app.querySelector(".rw-done") : null;
    if (!el) return;
    let b = el.getBoundingClientRect();
    try {
      FUN?.celebrate("test", { x: b.left + b.width / 2, y: b.top + b.height / 2 });
    } catch {
    }
  });
  var SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" fill="currentColor"/><path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18.2 6.2a8.2 8.2 0 0 1 0 11.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  async function grade(g) {
    let c = RV.cur;
    if (!c || !RV.shown) return;
    let r = rowOf(c), a = answer(c, g, conf(), ck(), Date.now() - RV.t0), rows = [["card", c.id, a.card]];
    if (a.leech && !r.note.tags.includes("leech") && rows.push(["note", r.note.id, { ...r.note, tags: [...r.note.tags, "leech"] }]), await change(["Again", "Hard", "Good", "Easy"][g - 1], rows, c.id), acted = !0, BUS.emit("reviews:card", { grade: g, card: c.id, word: wordOfNote(r.note), left: left() }), RV.sinceNew = c.type === 0 ? 0 : RV.sinceNew + 1, RV.cur = null, RV.flags = !1, g === 1 && missed3(a.card))
      RV.panel = "deeper", RV.deeperFor = a.card.id;
    else if (g >= 3 && right3(a.card)) {
      let other = related(a.card);
      other && (RV.merge = [a.card.nid, other]);
    }
    showReview();
  }
  async function act(a) {
    let c = RV.cur;
    if (a === "show")
      return !c || RV.shown ? void 0 : (RV.shown = !0, showReview());
    if (c) {
      if (a === "py")
        return RV.py = !RV.py, sfx("tap"), void RUBY.set($(".host", app)?.shadowRoot?.querySelector(".card"), RV.py);
      if (a === "play") return playAll($(".host", app)?.shadowRoot);
      if (a === "edit") return editDialog(S.notes.get(c.nid));
      if (a === "flag")
        return RV.flags = !RV.flags, showReview();
      a === "suspend" && (await change("Suspend", [["card", c.id, { ...c, queue: -1 }]], c.id), sfx("drop"), acted = !0, RV.cur = null, showReview(), toast(`Suspended <span class="zh">${esc2(wordOfCard(c))}</span>`, !0));
    }
  }
  var FLAG_NAME = { 1: "Red", 3: "Green" };
  function flagPicker(c) {
    let f = c.flags & 7;
    return `<div class="rw-flags" role="dialog" aria-label="Flag">
    <button type="button" class="fl-b fl-r${f === 1 ? " on" : ""}" data-f="1"><i></i>Red<kbd>R</kbd></button>
    <button type="button" class="fl-b fl-g${f === 3 ? " on" : ""}" data-f="3"><i></i>Green<kbd>G</kbd></button>
    ${f ? '<button type="button" class="fl-b fl-0" data-f="0"><i></i>None<kbd>N</kbd></button>' : ""}
  </div>`;
  }
  async function flagIt(f, cards) {
    let list = cards ?? (RV.cur ? [RV.cur] : []);
    if (!list.length) return;
    let to = list.every((c) => (c.flags & 7) === f) ? 0 : f;
    await change(to ? `${FLAG_NAME[to]} flag` : "Flag off", list.map((c) => ["card", c.id, { ...c, flags: c.flags & -8 | to }])), sfx(to ? "stamp" : "unstamp"), RV.flags = !1, !cards && RV.cur && (RV.cur = S.cards.get(RV.cur.id)), view === "review" ? showReview() : paintBrowse(), to === 3 && !cards && toast(`Green: <span class="zh">${esc2(wordOfCard(list[0]))}</span> waits in Browse for a partner`, !0);
  }
  var deeperTimer;
  function showDeeper() {
    let c = S.cards.get(RV.deeperFor), r = c && rowOf(c);
    if (!r) return RV.panel = "", showReview();
    let word = wordOfNote(r.note);
    app.innerHTML = `<section class="deeper"><p class="dw zh">${esc2(word)}</p><p class="dsub">Missed three times in a row.</p>
    <div class="dact"><button type="button" class="btn" data-d="go">Five minutes on it</button><button type="button" class="btn-q" data-d="del">Delete it</button><button type="button" class="btn-q" data-d="skip">Not now</button></div>
    <div class="dbody" hidden><div class="dtimer" aria-live="off"></div><div class="dtext"></div>
    <div contenteditable="true" class="dnote" role="textbox" aria-multiline="true" aria-label="Your note, added to Notes" data-ph="Your note, added to Notes"></div>
    <button type="button" class="btn" data-d="done">Back to reviews</button></div></section>`;
    let body = $(".dbody", app);
    app.querySelectorAll("[data-d]").forEach(
      (b) => b.onclick = async () => {
        let d = b.dataset.d;
        if (d === "skip") return endDeeper();
        if (d === "del") {
          acted = !0, await deleteNote(r.note.id), endDeeper();
          return;
        }
        if (d === "done") {
          let mine = $(".dnote", app).innerHTML.trim(), i = fieldIndex(r.type, "Notes");
          if (strip(mine) && i >= 0) {
            let flds = [...r.note.flds];
            flds[i] = flds[i] ? `${flds[i]}<br>${mine}` : mine, await change("Note added", [["note", r.note.id, { ...r.note, flds }]]);
          }
          return endDeeper();
        }
        $(".dact", app).hidden = !0, body.hidden = !1;
        let end = Date.now() + 5 * 6e4, tick = () => {
          let l = Math.max(0, end - Date.now()), el = $(".dtimer", app);
          el && (el.textContent = `${Math.floor(l / 6e4)}:${String(Math.floor(l % 6e4 / 1e3)).padStart(2, "0")}`), (!l || !el) && clearInterval(deeperTimer);
        };
        tick(), deeperTimer = setInterval(tick, 1e3);
        let text = $(".dtext", app);
        if (text.textContent = navigator.onLine ? "\u2026" : "Needs signal. Use the five minutes with your own notes.", !!navigator.onLine)
          try {
            let i = (n) => fieldIndex(r.type, n), out = await api("anki/deeper", { word, sentence: strip(r.note.flds[i("Chinese")] ?? ""), notes: strip(r.note.flds[i("Notes")] ?? ""), near: nearWords(r.note).slice(0, 30), model: `claude-${LAB.get("deeper-model")}-5-5` });
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
  function nearNotes(note) {
    let w = wordOfNote(note), chars = new Set([...w].filter((x) => HAN.test(x))), out = /* @__PURE__ */ new Map();
    for (let n of S.notes.values()) {
      if (n.id === note.id) continue;
      let o = wordOfNote(n);
      o && o !== w && !out.has(o) && [...o].some((x) => chars.has(x)) && out.set(o, n);
    }
    return [...out.values()];
  }
  var nearWords = (note) => nearNotes(note).map((n) => wordOfNote(n)), mergeNo = () => new Set(S.meta.get("mergeNo")?.pairs ?? []), pairKey = (a, b) => [a, b].sort().join("-");
  function related(c) {
    let note = S.notes.get(c.nid);
    if (!note) return null;
    let w = wordOfNote(note), chars = new Set([...w].filter((x) => HAN.test(x)));
    if (!chars.size) return null;
    let no = mergeNo(), k = ck(), best = null;
    for (let o of live()) {
      if (o.nid === c.nid || o.queue < 0 || no.has(pairKey(c.nid, o.nid))) continue;
      let last = o.revs[o.revs.length - 1];
      if (!last || k.today - k.dayOf(last[0]) > 1 || !right3(o)) continue;
      let ow = wordOfCard(o);
      if (!ow || ow === w || ![...ow].some((x) => chars.has(x))) continue;
      let score = (o.flags & 7) === 3 ? 2 : 1;
      (!best || score > best[1]) && (best = [o.nid, score]);
    }
    return best?.[0] ?? null;
  }
  function mergeBanner() {
    let [a, b] = RV.merge.map((id) => S.notes.get(id));
    return !a || !b ? "" : `<div class="rw-merge"><span><b class="zh">${esc2(wordOfNote(a))}</b> and <b class="zh">${esc2(wordOfNote(b))}</b> are both easy now. One harder card about the difference?</span>
    <span class="mact"><button type="button" class="btn" data-m="write">Write it</button><button type="button" class="btn-q" data-m="no">Not these</button></span></div>`;
  }
  async function mergeAct(m) {
    if (!RV.merge) return;
    let [x, y] = RV.merge;
    if (RV.merge = null, m === "no")
      return await put("meta", "mergeNo", { pairs: [...mergeNo(), pairKey(x, y)] }), showReview();
    combine(x, y);
  }
  var pairs = () => S.meta.get("combine")?.list ?? [];
  async function combine(x, y) {
    let [a, b] = [S.notes.get(x), S.notes.get(y)];
    if (!a || !b) return;
    let words = `${wordOfNote(a)}\u3001${wordOfNote(b)}`;
    await put("meta", "combine", { list: [...pairs().filter((p) => p.words !== words), { words, nids: [x, y], at: Date.now() }] });
    try {
      openCard(words, "any");
    } catch {
    }
  }
  var settling = !1;
  async function settlePairs() {
    let list = pairs();
    if (!(!ready || settling || !list.length)) {
      settling = !0;
      try {
        let keep = [];
        for (let p of list) {
          let parts = p.words.split("\u3001"), made = [...S.notes.values()].find((n) => n.id > p.at - 6e4 && !p.nids.includes(n.id) && parts.every((w) => wordOfNote(n).includes(w))), doc = typeof CD < "u" && typeof cardId == "function" ? CD.docs[cardId(p.words)] : void 0;
          if (made) {
            let old = [...cardsOf(p.nids[0]), ...cardsOf(p.nids[1])].filter((c) => c.queue >= 0);
            old.length && (await change("Combine", old.map((c) => ["card", c.id, { ...c, queue: -1, flags: (c.flags & 7) === 3 ? c.flags & -8 : c.flags }])), VIEW === "reviews" && toast(`<span class="zh">${esc2(p.words)}</span>: the old cards rest`, !0));
          } else !doc?.dropped && Date.now() - p.at < 14 * 864e5 && keep.push(p);
        }
        keep.length !== list.length && await put("meta", "combine", { list: keep });
      } finally {
        settling = !1;
      }
    }
  }
  if (typeof cardPrompt == "function") {
    let base = cardPrompt;
    cardPrompt = (kit, word) => {
      let p = pairs().find((x) => x.words === word);
      if (!p) return base(kit, word);
      let [a, b] = p.words.split("\u3001");
      return `${base(kit, word)}

=== A PAIR ===
${a} and ${b} are both easy for him now. This card replaces their two cards: it is about the difference between them, the one thing he could still mix up. word: ${word}. pinyin: both readings. meaning: the difference, in a few words. ex: exactly two sentences, one where only ${a} fits and one where only ${b} fits. know: 2 or 3 points on when a Taiwanese person reaches for which. One char: line per distinct character, no how: lines, no second: line.`;
    };
  }
  var pasteNote = /* @__PURE__ */ new WeakMap();
  function editor(host, note0, onClose) {
    let t = typeOf(note0), start2 = clone(note0), note = note0;
    host.innerHTML = `<div class="ed">${t.fields.slice().sort((a, b) => a.ord - b.ord).map((f) => `<label class="ef"><span>${esc2(f.name)}</span><div class="fv${/chinese|word|sentence|mnemonic/i.test(f.name) ? " zh" : ""}" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" data-o="${f.ord}">${note.flds[f.ord] ?? ""}</div></label>`).join("")}
    <div class="ed-end"><button type="button" class="ed-del" data-e="del">Delete note</button></div></div>`;
    let saveT, read = () => {
      let flds = [...note.flds];
      return host.querySelectorAll(".fv").forEach((f) => flds[Number(f.dataset.o)] = clean(f.innerHTML)), { ...note, flds };
    }, save = () => {
      clearTimeout(saveT), saveT = setTimeout(async () => {
        note = read(), JSON.stringify(note.flds) !== JSON.stringify(S.notes.get(note.id)?.flds) && await put("note", note.id, note);
      }, 400);
    };
    host.querySelectorAll(".fv").forEach((f) => {
      pasteNote.set(f, note), f.addEventListener("input", save), f.addEventListener("paste", (e) => pasteInto(e, f, save)), f.addEventListener("drop", (e) => dropInto(e, f, save));
    }), $('[data-e="del"]', host).onclick = async () => {
      clearTimeout(saveT), await deleteNote(note.id), onClose?.();
    };
    let ai = t.fields.find((f) => /^audio$/i.test(f.name))?.ord ?? -1, si = t.fields.find((f) => /^chinese$/i.test(f.name))?.ord ?? 0, voicing = !1;
    return ED = {
      host,
      voice: async (again) => {
        if (voicing) return;
        let fa = host.querySelector(`.fv[data-o="${ai}"]`), fs = host.querySelector(`.fv[data-o="${si}"]`);
        if (!fa || !fs) return;
        let have = /\[sound:([^\]]+)\]/.exec(fa.textContent ?? "");
        if (have && !again) return void SOUND.play(have[1]);
        let text = strip(fs.innerHTML.replace(/<br\s*\/?>|<\/div>/gi, `
`)).replace(/[ \t]+/g, " ").trim();
        if (!text) return toast("The sentence is empty.");
        if (!navigator.onLine) return toast("The voice needs signal.");
        fa.classList.add("busy"), voicing = !0;
        try {
          let { url } = await api("voice", { text });
          fa.textContent = `[sound:${url}]`, save(), sfx("save"), SOUND.play(url);
        } catch (e) {
          toast(esc2(e.message || "The voice didn\u2019t come through."));
        } finally {
          voicing = !1, fa.classList.remove("busy");
        }
      }
    }, async () => {
      if (ED?.host === host && (ED = null), clearTimeout(saveT), !S.notes.has(note.id)) return;
      let now = read();
      JSON.stringify(now.flds) !== JSON.stringify(start2.flds) && (await put("note", now.id, now), H.undo.push({ name: "Edit", rows: [["note", now.id, start2, clone(S.notes.get(now.id))]] }), H.redo = []);
    };
  }
  var ED = null, clean = (h) => h.replace(/^(<br>)+$/, "").replace(/\s+data-[\w-]+="[^"]*"/g, "");
  function editDialog(note) {
    let d = document.createElement("dialog");
    d.className = "rx-dlg", d.innerHTML = `<div class="dlg-top"><span class="dlg-w zh">${esc2(wordOfNote(note))}</span><button type="button" class="dlg-x" aria-label="Close">\xD7</button></div><div class="dlg-ed"></div>`, document.body.append(d);
    let done = editor($(".dlg-ed", d), note, () => d.close());
    $(".dlg-x", d).onclick = () => d.close(), d.addEventListener("click", (e) => e.target === d && d.close()), d.addEventListener("close", async () => {
      await done(), d.remove(), RV.cur && (RV.cur = S.cards.get(RV.cur.id) ?? null), view === "review" && showReview();
    }), d.showModal(), $(".fv", d)?.focus();
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
      toast(esc2(err.message || "The picture didn\u2019t come through."));
    }
  }
  async function deleteNote(nid, quiet = !1) {
    let n = S.notes.get(nid);
    if (!n) return;
    let w = wordOfNote(n);
    await change(`Delete ${w}`, [["note", nid, null], ...cardsOf(nid).map((c) => ["card", c.id, null])]), sfx("drop"), quiet || toast(`Deleted <span class="zh">${esc2(w)}</span>`, !0);
  }
  var BR = { q: "", flag: 0, sort: "added", desc: !0, sel: /* @__PURE__ */ new Set(), last: 0, focus: 0, limit: 300, close: null };
  function resetBrowse() {
    Object.assign(BR, { q: "", flag: 0, sort: "added", desc: !0, sel: /* @__PURE__ */ new Set(), last: 0, limit: 300 });
  }
  var ADDED = (r) => r.note.id * 10 + r.card.ord, COLS = [
    ["sort", "Word", (r) => wordOfNote(r.note)],
    ["card", "Card", (r) => r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? ""],
    ["due", "Due", (r, k) => r.card.queue === -1 ? 1e9 : r.card.type === 0 ? 1e8 + r.card.due : r.card.queue === 1 ? k.dayOf(r.card.due * 1e3) : r.card.due],
    ["ivl", "Interval", (r) => r.card.type === 0 ? -1 : r.card.ivl]
  ];
  function showBrowse() {
    app.innerHTML = `<section class="br">
    <div class="br-top"><input class="br-q" type="search" placeholder="Search" aria-label="Search" value="${esc2(BR.q)}" spellcheck="false" enterkeyhint="search" lang="zh-Hant">
      <div class="br-f" role="radiogroup" aria-label="Flag">${[[0, "All"], [1, "Red"], [3, "Green"]].map(([f, l]) => `<button type="button" role="radio" data-fl="${f}" aria-checked="${BR.flag === f}">${f ? `<i class="fd fd${f}"></i>` : ""}${l}</button>`).join("")}</div></div>
    <div class="br-bulk" hidden></div>
    <div class="br-main"><div class="br-tbl" role="grid" aria-label="Cards"></div><aside class="br-side" hidden></aside></div></section>`;
    let q = $(".br-q", app), t;
    q.oninput = () => {
      clearTimeout(t), t = setTimeout(() => (BR.q = q.value, BR.limit = 300, paintBrowse()), 180);
    }, app.querySelectorAll("[data-fl]").forEach(
      (b) => b.onclick = () => {
        BR.flag = Number(b.dataset.fl), app.querySelectorAll("[data-fl]").forEach((x) => x.setAttribute("aria-checked", String(x === b))), BR.limit = 300, sfx("tap"), paintBrowse();
      }
    ), paintBrowse();
  }
  function results() {
    let k = ck(), test = search(BR.q, k.today, k.dayOf), rows = live().map(rowOf).filter((r) => !!r && (!BR.flag || (r.card.flags & 7) === BR.flag) && test(r)), by = BR.sort === "added" ? ADDED : COLS.find((c) => c[0] === BR.sort)[2];
    return rows.sort((a, b) => {
      let x = by(a, k), y = by(b, k), o = typeof x == "number" ? x - y : String(x).localeCompare(String(y), "zh-Hant");
      return BR.desc ? -o : o;
    }), rows;
  }
  function paintBrowse() {
    if (view !== "browse" || !$(".br", app)) return;
    let k = ck(), rows = results(), shown = rows.slice(0, BR.limit), tbl = $(".br-tbl", app);
    tbl.innerHTML = `<div class="tr th" role="row">${COLS.map(([key, name]) => `<button type="button" role="columnheader" class="td c-${key}${BR.sort === key ? BR.desc ? " desc" : " asc" : ""}" data-sort="${key}" aria-sort="${BR.sort === key ? BR.desc ? "descending" : "ascending" : "none"}">${name}</button>`).join("")}</div>
    ${shown.map(
      (r) => `<div class="tr${BR.sel.has(r.card.id) ? " sel" : ""}${r.card.queue === -1 ? " susp" : ""}" data-c="${r.card.id}" role="row" aria-selected="${BR.sel.has(r.card.id)}"><span class="td c-sort zh">${r.card.flags & 7 ? `<i class="fd fd${r.card.flags & 7}"></i>` : ""}${esc2(wordOfNote(r.note))}</span><span class="td c-card">${esc2(r.type?.templates.find((t) => t.ord === r.card.ord)?.name ?? "")}</span><span class="td c-due">${dueText(r.card, k)}</span><span class="td c-ivl">${r.card.ivl && r.card.type ? label(r.card.ivl) : ""}</span></div>`
    ).join("")}
    ${rows.length > shown.length ? '<button type="button" class="btn-q br-more">Show all</button>' : ""}${rows.length ? "" : '<p class="br-none">Nothing matches.</p>'}`, tbl.querySelectorAll("[data-sort]").forEach(
      (b) => b.onclick = () => {
        BR.desc = BR.sort === b.dataset.sort ? !BR.desc : !1, BR.sort = b.dataset.sort, paintBrowse();
      }
    ), $(".br-more", tbl)?.addEventListener("click", () => (BR.limit = 1e9, paintBrowse())), tbl.querySelectorAll(".tr[data-c]").forEach(
      (tr) => tr.onclick = (e) => {
        let id = Number(tr.dataset.c);
        if (e.shiftKey && BR.last) {
          let ids = shown.map((r) => r.card.id), a = ids.indexOf(BR.last), b = ids.indexOf(id);
          ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => BR.sel.add(x));
        } else e.metaKey || e.ctrlKey ? BR.sel.has(id) ? BR.sel.delete(id) : BR.sel.add(id) : BR.sel.size === 1 && BR.sel.has(id) ? BR.sel = /* @__PURE__ */ new Set() : BR.sel = /* @__PURE__ */ new Set([id]);
        BR.last = id, paintSel();
      }
    ), paintSel();
  }
  async function paintSel() {
    let sel = [...BR.sel].map((id) => S.cards.get(id)).filter((c) => !!c && S.notes.has(c.nid));
    app.querySelectorAll(".tr[data-c]").forEach((tr) => {
      let on = BR.sel.has(Number(tr.dataset.c));
      tr.classList.toggle("sel", on), tr.setAttribute("aria-selected", String(on));
    });
    let bulk = $(".br-bulk", app);
    if (bulk.hidden = sel.length < 2, sel.length >= 2) {
      let anySusp = sel.some((c) => c.queue === -1);
      bulk.innerHTML = `<span class="bk-n">${sel.length} cards</span><button type="button" class="btn-q" data-b="${anySusp ? "unsusp" : "susp"}">${anySusp ? "Unsuspend" : "Suspend"}</button><button type="button" class="btn-q" data-b="red"><i class="fd fd1"></i>Red</button><button type="button" class="btn-q" data-b="green"><i class="fd fd3"></i>Green</button><button type="button" class="btn-q bk-del" data-b="del">Delete</button><button type="button" class="dlg-x" data-b="none" aria-label="Clear selection">\xD7</button>`, bulk.querySelectorAll("[data-b]").forEach((b) => b.onclick = () => bulkAct(b.dataset.b, sel));
    }
    let side = $(".br-side", app), focus = sel.length === 1 ? sel[0] : null;
    if (!focus) {
      side.hidden || await closeSide();
      return;
    }
    if (side.dataset.c === String(focus.id) && !side.hidden) return;
    await BR.close?.(), BR.close = null, side.dataset.c = String(focus.id), side.hidden = !1, app.querySelector(".br-main").classList.add("open");
    let note = S.notes.get(focus.nid), word = wordOfNote(note), f = focus.flags & 7, tm = typeOf(note)?.templates.find((t) => t.ord === focus.ord)?.name ?? "";
    side.innerHTML = `<div class="sd-top"><span class="sd-w zh">${esc2(word)}</span><button type="button" class="dlg-x" aria-label="Close">\xD7</button></div>
    <div class="sd-card"><span class="sd-tm">${esc2(tm)}</span><span class="sd-due">${dueText(focus)}</span>
      <span class="sd-act"><button type="button" class="btn-q" data-s="susp">${focus.queue === -1 ? "Unsuspend" : "Suspend"}</button><button type="button" class="btn-q${f === 1 ? " on" : ""}" data-s="red"><i class="fd fd1"></i>Red</button><button type="button" class="btn-q${f === 3 ? " on" : ""}" data-s="green"><i class="fd fd3"></i>Green</button></span></div>
    ${f === 3 ? greenHelp(note) : ""}${f === 1 ? '<div class="sd-help"><button type="button" class="btn-q" data-s="deeper">Five minutes on it</button></div>' : ""}
    <div class="sd-ed"></div>`, BR.close = editor($(".sd-ed", side), note, () => closeSide()), $(".dlg-x", side).onclick = () => closeSide(), side.querySelectorAll("[data-s]").forEach(
      (b) => b.onclick = async () => {
        let s = b.dataset.s, c = S.cards.get(focus.id);
        if (s === "susp" && await change(c.queue === -1 ? "Unsuspend" : "Suspend", [["card", c.id, { ...c, queue: c.queue === -1 ? unsuspended(c) : -1 }]]), s === "red" || s === "green") return flagIt(s === "red" ? 1 : 3, [c]).then(reopen);
        if (s === "deeper")
          return RV.panel = "deeper", RV.deeperFor = c.id, go("review");
        if (s.startsWith("pair:")) return combine(note.id, Number(s.slice(5)));
        reopen();
      }
    );
  }
  var reopen = () => {
    let side = $(".br-side", app);
    side && delete side.dataset.c, paintBrowse();
  };
  function greenHelp(note) {
    let near = nearNotes(note).slice(0, 8);
    return near.length ? `<div class="sd-help"><span class="sd-hl">Combine with</span>${near.map((n) => `<button type="button" class="chipb zh" data-s="pair:${n.id}">${esc2(wordOfNote(n))}</button>`).join("")}</div>` : "";
  }
  async function closeSide() {
    let side = app.querySelector(".br-side"), close = BR.close;
    BR.close = null, await close?.(), side && (side.hidden = !0, side.innerHTML = "", delete side.dataset.c, app.querySelector(".br-main")?.classList.remove("open"), BR.sel.size === 1 && (BR.sel = /* @__PURE__ */ new Set(), app.querySelectorAll(".tr.sel").forEach((tr) => (tr.classList.remove("sel"), tr.setAttribute("aria-selected", "false")))));
  }
  async function bulkAct(a, sel) {
    let nids = [...new Set(sel.map((c) => c.nid))];
    if (a === "none" && (BR.sel = /* @__PURE__ */ new Set()), (a === "susp" || a === "unsusp") && (await change(a === "susp" ? `Suspend ${sel.length}` : `Unsuspend ${sel.length}`, sel.map((c) => ["card", c.id, { ...c, queue: a === "susp" ? -1 : c.queue === -1 ? unsuspended(c) : c.queue }])), toast(`${a === "susp" ? "Suspended" : "Unsuspended"} ${sel.length} cards`, !0)), a === "red" || a === "green") return flagIt(a === "red" ? 1 : 3, sel);
    a === "del" && (await change(
      `Delete ${nids.length} notes`,
      nids.flatMap((id) => [["note", id, null], ...cardsOf(id).map((c) => ["card", c.id, null])])
    ), BR.sel = /* @__PURE__ */ new Set(), sfx("drop"), toast(`Deleted ${nids.length} notes`, !0)), paintBrowse();
  }
  function perDay(ret) {
    let c = conf(), f = new Fsrs(c.w), n = 0;
    for (let x of live()) x.queue >= 0 && x.type !== 0 && x.s && (n += 1 / Math.max(1, Math.min(c.maxIvl, f.interval(x.s, ret))));
    return Math.round(n);
  }
  var saveConf = async (name, patch) => {
    let cur = conf();
    await change(name, [["conf", cur.id, { ...cur, ...patch }]]);
  }, fmtDay = (ms) => new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
  LAB.row("rv-new", "Reviews", {
    html: () => ready ? `<div class="st-row"><label class="st-l" for="rs-new">New cards a day</label><span class="st-step"><button type="button" data-n="-1" aria-label="Fewer">\u2212</button><input id="rs-new" inputmode="numeric" value="${conf().newPerDay}"><button type="button" data-n="1" aria-label="More">+</button></span></div>` : "",
    bind(el) {
      let nw = el.querySelector("#rs-new");
      if (!nw) return;
      let setNew = (v) => {
        nw.value = String(Math.max(0, Math.min(200, v))), saveConf("New cards a day", { newPerDay: Number(nw.value) });
      };
      nw.onchange = () => setNew(parseInt(nw.value) || 0), el.querySelectorAll("[data-n]").forEach((b) => b.onclick = () => (sfx("tap"), setNew((parseInt(nw.value) || 0) + Number(b.dataset.n))));
    }
  });
  LAB.row("rv-ret", "Reviews", {
    // the chance a card is still known when it comes back, and what that costs a day
    html: () => ready ? `<div class="st-row"><label class="st-l" for="rs-ret">How much to remember</label><span class="st-range"><input type="range" id="rs-ret" min="80" max="97" step="1" value="${Math.round(conf().retention * 100)}"><span class="st-v" data-js-text></span></span></div><p class="st-row st-sub"><span class="st-v rs-load" data-js-text></span></p>` : "",
    bind(el) {
      let ret = el.querySelector("#rs-ret");
      if (!ret) return;
      let show = () => {
        el.querySelector(".st-range .st-v").textContent = `${ret.value}%`, el.querySelector(".rs-load").textContent = `about ${perDay(Number(ret.value) / 100)} reviews a day`;
      };
      show(), ret.oninput = show, ret.onchange = () => saveConf("Retention", { retention: Number(ret.value) / 100 });
    }
  });
  LAB.row("rv-fit", "Reviews", {
    // fitted to his own reviews once a month, like Anki's Optimize; kept only when it predicts his memory better
    html: () => {
      if (!ready) return "";
      let tuned = conf().tuned;
      return `<div class="st-row"><span class="st-l">Memory model</span><button type="button" class="st-btn rs-tune">${tuning ? "Fitting\u2026" : tuned ? `Fitted ${fmtDay(tuned.at)}` : "Fit now"}</button></div>`;
    },
    bind(el) {
      let b = el.querySelector(".rs-tune");
      b && (b.disabled = tuning, b.onclick = async () => {
        b.disabled = !0, b.textContent = "Fitting\u2026", await tune(!0), SETTINGS.redraw();
      });
    }
  });
  LAB.row("rv-designs", "Reviews", {
    html: () => ready ? '<button type="button" class="st-row st-go rs-designs"><span class="st-l">Card designs</span><span class="st-k"></span></button>' : "",
    bind(el) {
      let b = el.querySelector(".rs-designs");
      b && (b.onclick = () => {
        sfx("tap"), SETTINGS.close(), setView("reviews"), go("designs");
      });
    }
  });
  LAB.row("rv-dl", "Reviews", {
    // everything, reviews and pictures included, as one file Anki opens (it replaces Anki's collection)
    html: () => ready ? '<div class="st-row"><span class="st-l">Back to Anki</span><button type="button" class="st-btn rs-dl">Download</button></div><p class="st-msg" role="status" data-js-text></p>' : "",
    bind(el) {
      let b = el.querySelector(".rs-dl");
      b && (b.onclick = async () => {
        let msg = el.querySelector(".st-msg");
        b.disabled = !0, b.textContent = "Packing\u2026";
        try {
          await exportAnki((p) => b.textContent = p), msg.textContent = "";
        } catch (err) {
          msg.textContent = err.message || "The file didn\u2019t come together.";
        }
        b.textContent = "Download", b.disabled = !1;
      });
    }
  });
  var tuning = !1;
  async function tune(now = !1) {
    let c = conf();
    if (!(tuning || !now && c.tuned && Date.now() - c.tuned.at < 30 * 864e5)) {
      tuning = !0;
      try {
        let k = ck(), cards = live().filter((x) => x.revs.length), hs = cards.map((x) => historyOf(x, k.dayOf)).filter((h) => !!h && h.length > 1), reviews = hs.reduce((n, h) => n + h.length, 0);
        if (reviews < 400) return;
        let breathe = () => new Promise((ok) => "requestIdleCallback" in window ? requestIdleCallback(() => ok(), { timeout: 200 }) : setTimeout(ok, 16)), r = await optimize(c.w, hs, 160, breathe), better = r.after < r.before * 0.998, w = better ? r.w : c.w, tuned = { at: Date.now(), before: r.before, after: better ? r.after : r.before, better: better ? Math.round((1 - r.after / r.before) * 1e3) / 10 : 0, reviews }, rows = [["conf", c.id, { ...conf(), w, tuned }]];
        if (better) {
          let f = new Fsrs(w);
          for (let x of cards) {
            let h = historyOf(x, k.dayOf), m = h && f.replay(h);
            m && S.cards.get(x.id) === x && rows.push(["card", x.id, { ...x, s: Math.round(m.s * 1e4) / 1e4, d: Math.round(m.d * 1e4) / 1e4 }]);
          }
        }
        await putMany(rows);
      } finally {
        tuning = !1;
      }
    }
  }
  var TY = { id: 0, tab: "fields", tmpl: 0, side: "qfmt" }, USED = ["Chinese", "Chinese phrases", "Chinese radicals"];
  function showDesigns() {
    let types = [...S.types.values()].filter((t2) => USED.includes(t2.name) || [...S.notes.values()].some((n) => n.mid === t2.id));
    S.types.has(TY.id) || (TY.id = col().notetype);
    let t = S.types.get(TY.id);
    app.innerHTML = `<section class="ty"><div class="ty-top"><button type="button" class="btn-q ty-back" aria-label="Back to settings">\u2039 Settings</button>
    <div class="br-f" role="radiogroup" aria-label="Note type">${types.map((x) => `<button type="button" role="radio" data-ty="${x.id}" aria-checked="${x.id === t.id}">${esc2(x.name.replace(/^Chinese /, "").replace(/^Chinese$/, "Words"))}</button>`).join("")}</div>
    <div class="br-f" role="radiogroup" aria-label="Part">${["fields", "cards", "css"].map((k) => `<button type="button" role="radio" data-tab="${k}" aria-checked="${TY.tab === k}">${k === "fields" ? "Fields" : k === "cards" ? "Front and back" : "Styling"}</button>`).join("")}</div></div><div class="ty-body"></div></section>`, $(".ty-back", app).onclick = () => (go("review"), SETTINGS.open()), app.querySelectorAll("[data-ty]").forEach((b) => b.onclick = () => (TY.id = Number(b.dataset.ty), TY.tmpl = 0, showDesigns())), app.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => (TY.tab = b.dataset.tab, showDesigns()));
    let body = $(".ty-body", app), sample = [...S.notes.values()].find((x) => x.mid === t.id) ?? { id: 0, guid: "", mid: t.id, mod: 0, tags: [], flds: t.fields.map((f) => f.name) };
    if (TY.tab === "fields") {
      let fs = t.fields.slice().sort((a, b) => a.ord - b.ord);
      body.innerHTML = `<ol class="flist">${fs.map((f, i) => `<li><input value="${esc2(f.name)}" data-ren="${f.ord}" aria-label="Field name"><button type="button" class="btn-q" data-up="${i}" ${i ? "" : "disabled"} aria-label="Move up">\u2191</button><button type="button" class="btn-q" data-dn="${i}" ${i < fs.length - 1 ? "" : "disabled"} aria-label="Move down">\u2193</button><button type="button" class="btn-q bk-del" data-rm="${f.ord}" aria-label="Delete field">\xD7</button></li>`).join("")}</ol>
      <button type="button" class="btn-q" data-add="1">Add field</button>`, body.querySelectorAll("[data-ren]").forEach((inp) => inp.onchange = () => renameField(t, Number(inp.dataset.ren), inp.value.trim())), body.querySelectorAll("[data-up],[data-dn]").forEach((b) => b.onclick = () => moveField(t, Number(b.dataset.up ?? b.dataset.dn), b.dataset.up ? -1 : 1)), body.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => removeField(t, Number(b.dataset.rm))), $("[data-add]", body).onclick = () => addField(t);
      return;
    }
    let tm = t.templates.find((x) => x.ord === TY.tmpl) ?? t.templates[0], css = TY.tab === "css";
    body.innerHTML = `${css ? "" : `<div class="ty-sub"><div class="br-f" role="radiogroup" aria-label="Card">${t.templates.map((x) => `<button type="button" role="radio" data-tm="${x.ord}" aria-checked="${x.ord === tm.ord}">${esc2(x.name)}</button>`).join("")}</div>
      <div class="br-f" role="radiogroup" aria-label="Side"><button type="button" role="radio" data-side="qfmt" aria-checked="${TY.side === "qfmt"}">Front</button><button type="button" role="radio" data-side="afmt" aria-checked="${TY.side === "afmt"}">Back</button></div></div>`}
    <div class="tm"><textarea class="code" spellcheck="false" aria-label="${css ? "Styling" : "Template"}">${esc2(css ? t.css : tm[TY.side])}</textarea><div class="tm-pv"><div class="pvh"></div></div></div>`, body.querySelectorAll("[data-tm]").forEach((b) => b.onclick = () => (TY.tmpl = Number(b.dataset.tm), showDesigns())), body.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => (TY.side = b.dataset.side, showDesigns()));
    let pv = () => draw($(".pvh", body), { note: sample, type: S.types.get(t.id), card: { ord: tm.ord } }, css || TY.side === "afmt" ? "a" : "q");
    pv();
    let start2 = clone(t), st, area = $(".code", body);
    area.oninput = () => {
      clearTimeout(st), st = setTimeout(async () => {
        let cur = S.types.get(t.id);
        await put("notetype", t.id, css ? { ...cur, css: area.value } : { ...cur, templates: cur.templates.map((x) => x.ord === tm.ord ? { ...x, [TY.side]: area.value } : x) }), pv();
      }, 350);
    }, area.onblur = () => {
      let now = S.types.get(t.id);
      JSON.stringify(now) !== JSON.stringify({ ...start2, mod: now.mod }) && (H.undo.push({ name: css ? "Styling" : "Template", rows: [["notetype", t.id, start2, clone(now)]] }), H.redo = []);
    };
  }
  var refName = (s, from, to) => s.replace(/\{\{([#^/]?)((?:[a-z]+:)*)\s*([^}]+?)\s*\}\}/g, (all2, k, filt, name) => name === from ? `{{${k}${filt}${to}}}` : all2);
  async function renameField(t, ord, name) {
    let old = t.fields.find((f) => f.ord === ord).name;
    if (!(!name || name === old)) {
      if (t.fields.some((f) => f.name === name)) return toast("Another field has that name."), showDesigns();
      await change("Rename field", [["notetype", t.id, { ...t, fields: t.fields.map((f) => f.ord === ord ? { ...f, name } : f), templates: t.templates.map((x) => ({ ...x, qfmt: refName(x.qfmt, old, name), afmt: refName(x.afmt, old, name) })) }]]), showDesigns();
    }
  }
  async function reorder(t, order, name) {
    let fields = order.map((o, i) => ({ ...t.fields.find((f) => f.ord === o), ord: i })), notes = [...S.notes.values()].filter((n) => n.mid === t.id);
    await change(name, [["notetype", t.id, { ...t, fields, sortf: Math.max(0, order.indexOf(t.sortf)) }], ...notes.map((n) => ["note", n.id, { ...n, flds: order.map((o) => n.flds[o] ?? "") }])]), showDesigns();
  }
  function moveField(t, i, dir) {
    let order = t.fields.slice().sort((a, b) => a.ord - b.ord).map((f) => f.ord);
    [order[i], order[i + dir]] = [order[i + dir], order[i]], reorder(t, order, "Move field");
  }
  function removeField(t, ord) {
    t.fields.length < 2 || (reorder(t, t.fields.slice().sort((a, b) => a.ord - b.ord).map((x) => x.ord).filter((o) => o !== ord), "Delete field"), toast("Field deleted", !0));
  }
  async function addField(t) {
    let name = "Field";
    for (let i = 2; t.fields.some((f) => f.name === name); i++) name = `Field ${i}`;
    let notes = [...S.notes.values()].filter((n) => n.mid === t.id);
    await change("Add field", [["notetype", t.id, { ...t, fields: [...t.fields, { name, ord: t.fields.length }] }], ...notes.map((n) => ["note", n.id, { ...n, flds: [...n.flds, ""] }])]), showDesigns();
  }
  addEventListener(
    "keydown",
    (e) => {
      if (VIEW !== "reviews" || e.isComposing) return;
      let t = e.target, typing = !!t.closest?.('input, textarea, select, [contenteditable="true"]'), eat = () => (e.preventDefault(), e.stopImmediatePropagation());
      if (!typing && (KEYS.is(e, "undo") || KEYS.is(e, "redo")))
        return eat(), document.querySelector("dialog[open]") ? void 0 : KEYS.is(e, "redo") ? redo() : undo();
      if (e.key === "Escape")
        return RV.flags ? (e.stopImmediatePropagation(), RV.flags = !1, showReview()) : view === "browse" && BR.sel.size && !document.querySelector("dialog[open]") ? (e.stopImmediatePropagation(), BR.sel = /* @__PURE__ */ new Set(), closeSide(), paintSel()) : void 0;
      if (!typing && ED?.host.isConnected && (KEYS.is(e, "rv.voice") || KEYS.is(e, "rv.revoice"))) return eat(), e.repeat ? void 0 : ED.voice(KEYS.is(e, "rv.revoice"));
      if (typing || document.querySelector("dialog[open]") || view !== "review") return;
      if (RV.flags) {
        let f = KEYS.is(e, "rv.red") ? 1 : KEYS.is(e, "rv.green") ? 3 : KEYS.is(e, "rv.noflag") ? 0 : -1;
        if (f >= 0) return eat(), flagIt(f);
        if (KEYS.is(e, "rv.flag")) return e.preventDefault(), act("flag");
      }
      let on = t.closest?.("button");
      if ((e.key === " " || e.key === "Enter") && on && !on.matches(".rw-show,.rw-a")) return;
      if (KEYS.is(e, "rv.show"))
        return e.preventDefault(), RV.shown ? grade(3) : act("show");
      let g = ["rv.again", "rv.hard", "rv.good", "rv.easy"].findIndex((id) => KEYS.is(e, id));
      if (g >= 0 && RV.shown) return e.preventDefault(), grade(g + 1);
      let a = [["rv.suspend", "suspend"], ["rv.flag", "flag"], ["rv.pinyin", "py"], ["rv.play", "play"], ["rv.edit", "edit"]].find(([id]) => KEYS.is(e, id));
      a && (eat(), (!e.repeat || a[1] !== "play") && act(a[1]));
    },
    !0
  );
  function paintDot() {
    if (!ready) return;
    let dot = document.getElementById("dot-reviews");
    dot && (dot.hidden = VIEW === "reviews" || !left());
  }
  onChange((what) => {
    if (what === "pulled" && settlePairs(), what !== "pulled" || VIEW !== "reviews") return paintDot();
    view === "review" && !RV.shown && !document.querySelector("dialog[open]") && !VIEW_EL.contains(document.activeElement) && showReview(), view === "browse" && !$(".br-side", app)?.contains(document.activeElement) && paintBrowse();
  });
  var ready = !1, started = null;
  function start() {
    return started ??= (async () => {
      let have = !1;
      try {
        have = await load();
      } catch {
      }
      if (have)
        sync();
      else if (app.innerHTML = '<p class="rx-wait">Bringing your cards over\u2026</p>', await sync(), !S.meta.has("col")) {
        app.innerHTML = `<p class="rx-wait">${S.error ? esc2(S.error) : navigator.onLine ? "Nothing here yet." : "Needs signal the first time."}</p>`, started = null;
        return;
      }
      ready = !0;
      let v = "review";
      try {
        v = sessionStorage.getItem("cbp-rx") || "review";
      } catch {
      }
      VIEW === "reviews" && go(["review", "browse", "designs"].includes(v) ? v : "review"), SETTINGS.redraw(), paintDot(), settlePairs(), setTimeout(prefetch, 4e3), setTimeout(() => tune().catch(() => {
      }), 2e4);
    })();
  }
  BUS.on("view", (v, prev) => {
    document.getElementById("tab-" + v)?.scrollIntoView({ block: "nearest", inline: "nearest" }), v === "reviews" ? (ready ? (go(view), sync()) : start().then(() => VIEW === "reviews" && ready && go(view)), settlePairs()) : prev === "reviews" && (SOUND.stop(), sitting = !1, dropToast(), closeSide(), document.querySelector("dialog.rx-dlg[open]")?.close()), paintDot();
  });
  BUS.on("lab", (id) => {
    id !== "pinyin" || view !== "review" || !RV.cur || (RV.py = RUBY.shown(), RUBY.set($(".host", app)?.shadowRoot?.querySelector(".card"), RV.py));
  });
  start();
  setInterval(paintDot, 5 * 6e4);
  "serviceWorker" in navigator && (navigator.serviceWorker.register("/plus/sw.js", { scope: "/plus" }).catch(() => {
  }), navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => new URL(r.scope).pathname === "/plus/" && r.unregister())).catch(() => {
  }));
  async function prefetch() {
    if (!navigator.onLine) return;
    let k = ck(), urls = /* @__PURE__ */ new Set();
    for (let c of live())
      if (c.queue === 2 || c.queue === 3 ? c.due <= k.today + 3 : c.queue === 0 || c.queue === 1)
        for (let f of S.notes.get(c.nid)?.flds ?? []) for (let m of f.matchAll(/\/api\/plus\/media\/[0-9a-f]{32}\.\w+/g)) urls.add(m[0]);
    let q = [...urls];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let u; u = q.shift(); ) await fetch(u).catch(() => {
        });
      })
    );
  }
  window.RVH = {
    ready: () => ready,
    left: () => ready ? left() : null,
    cards: () => S.cards.values(),
    dayOf: (ms) => ck().dayOf(ms),
    today: () => ck().today,
    date: (n) => {
      let d0 = col().day0;
      return new Date(Date.UTC(+d0.slice(0, 4), +d0.slice(5, 7) - 1, +d0.slice(8, 10)) + n * 864e5).toISOString().slice(0, 10);
    }
  };
  start()?.then(() => BUS.emit("reviews:changed"));
  onChange(() => ready && BUS.emit("reviews:changed"));
})();
