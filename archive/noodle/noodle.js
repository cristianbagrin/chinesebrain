/* ---------- Noodle, the long-necked kid (wave 3, 2026-11-26). Owner: Noodle.
   Chris's pick from the character picker (life/chinese/online-plan/character-picker-2.html, round 1's "noodle"): the
   same pixels, palette and moves, drawn on a 64×56 canvas at a whole-number scale so the pixels stay crisp.
   Where he lives:
     Today    beside this month's tree: in #today-buddy when the page has that slot, else standing in the forest
              (#companion). Breathes and blinks; a few seconds after arriving, then every 10–25 s, one readable thing
              (the neck stretch and look round, a yawn, a peek to one side). A tap on him: a happy hop.
     Reviews  a small one in the bottom-left corner, outside the card's column (only where there's room: none on a
              phone). BUS 'reviews:card': Again winces, Good and Easy nod, three Easy in a row cheer.
              BUS 'reviews:done': he dances (on a phone he comes onto the end screen to do it).
     day:done BUS 'day:done' ({date, streak}, habit.js): his biggest dance, on Today (now, or when Today next opens).
   Settings › Noodle (LAB 'noodle'): On, With sound, Off. Sounds are tiny square-wave jingles through SOUND, only with
   "With sound", only when the board's sound is on, and never over card audio (skipped when SOUND is playing).
   Reduced motion: still frames (expressions change, nothing moves). Never takes a click except on himself.
   Loaded by its own <script> in plus.html (a "Noodle" block); starts once the board's boot.js has run. ---------- */
(() => {
  /* ---------- the pixel kit (from the picker, unchanged but for a see-through ground) ---------- */
  const W = 64, H = 56, B = 49;            // canvas size in art pixels; B = feet row
  const hex = (h, a = 255) => {
    const n = parseInt(h.slice(1), 16);
    return ((a << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0;
  };
  const compile = pal => Object.fromEntries(Object.entries(pal).map(([k, v]) => [k, hex(v)]));
  function painter() {
    let a = null, ox = 0, oy = 0;
    const set = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) a[y * W + x] = c; };
    const g = {
      use(buf) { a = buf; ox = oy = 0; return g; },
      off(x, y) { ox = Math.round(x); oy = Math.round(y); },
      px(x, y, c) { set(Math.round(x + ox), Math.round(y + oy), c); },
      rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g.px(x + i, y + j, c); },
      ell(cx, cy, rx, ry, c) {
        if (rx <= 0 || ry <= 0) return; cx += ox; cy += oy;
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const dx = (x + .5 - cx) / rx, dy = (y + .5 - cy) / ry;
            if (dx * dx + dy * dy <= 1) set(x, y, c);
          }
      },
      cap(x0, y0, x1, y1, r, c) {           // thick line with round ends
        x0 += ox; x1 += ox; y0 += oy; y1 += oy;
        const vx = x1 - x0, vy = y1 - y0, L2 = vx * vx + vy * vy || 1e-6;
        for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++)
          for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
            const px = x + .5, py = y + .5;
            let u = ((px - x0) * vx + (py - y0) * vy) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
            const dx = px - (x0 + u * vx), dy = py - (y0 + u * vy);
            if (dx * dx + dy * dy <= r * r) set(x, y, c);
          }
      },
      spr(rows, map, x, y) {
        rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) { const c = map[r[i]]; if (c) g.px(x + i, y + j, c); } });
      },
    };
    return g;
  }
  const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
  const seg = (p, a, b) => clamp((p - a) / (b - a));
  const sm = x => x * x * (3 - 2 * x);
  const bell = (p, a, b) => Math.sin(Math.PI * seg(p, a, b));
  const arc = u => 4 * u * (1 - u);
  const lerp = (a, b, u) => a + (b - a) * u;
  const NOTE = ['..##', '..#.', '..#.', '###.', '##..'];
  const FX = {
    notes(f, s, x, y, c) {
      for (let i = 0; i < 2; i++) {
        const ph = s.k ? (s.t * 0.7 + i * 0.5) % 1 : 0.35 + i * 0.3;
        if (ph > 0.9) continue;
        f.spr(NOTE, { '#': c }, x + i * 9 + Math.round(Math.sin(ph * 6.28) * s.k), y - Math.round(ph * 9));
      }
    },
    sparkle(f, x, y, u, c) {
      if (u <= 0 || u >= 1) return;
      const r = u < 0.3 ? 0 : u < 0.7 ? 1 : 2;
      if (r < 2) f.px(x, y, c);
      if (r) { f.px(x - r, y, c); f.px(x + r, y, c); f.px(x, y - r, c); f.px(x, y + r, c); }
    },
    sweat(f, x, y, c, hi) { f.spr(['.a.', 'aab', 'aaa', '.a.'], { a: c, b: hi }, x, y); },
  };

  /* ---------- Noodle himself. Picker moves: act (the neck goes up, he looks left and right), right, wrong, dance.
     Added here in his style: yawn, peek (the neck bends to one side to look), nod, party (the biggest dance). ---------- */
  const NOODLE = {
    palette: {
      ink: '#2b2233', skin: '#f4c9a3', skinD: '#dda27e', hair: '#33283f', shirt: '#f2b33d', shirtD: '#cf8d1f',
      shorts: '#3d5d92', shoe: '#2b2233', cheek: '#ef9a8c', eye: '#241a2c', mouth: '#a5504a',
      spark: '#e0a43a', sweat: '#6fb3e8', hi: '#ffffff',
    },
    durations: { act: 2.8, right: 1.1, wrong: 1.5, dance: 3.6, yawn: 2.6, peek: 2.6, nod: 0.9, party: 6.4 },
    draw(g, f, s) {
      const { C, p, mode: m, k: K, t } = s;
      let L = 12 + 0.9 * s.breath, sway = Math.sin(t * 0.6) * K, ctrl = 0, look = 0, eyes = s.blink ? 'blink' : 'open';
      let mouth = 'smile', arms = [0, 0], lift = 0, fs = 0, steps = [0, 0], curl = 0;
      if (m === 'act') {
        const e = sm(seg(p, 0.04, 0.2)) * (1 - sm(seg(p, 0.8, 0.95)));
        L += 11 * e * (K || 0.5);
        look = p > 0.3 && p < 0.48 ? -1 : p > 0.52 && p < 0.7 ? 1 : 0;
        fs = look; sway += K * look * 2; ctrl = -K * look;
        if (e > 0.9) mouth = 'o';
      } else if (m === 'right') {
        L += 6 * sm(seg(p, 0, 0.2)) * (1 - sm(seg(p, 0.75, 1)));
        arms = [1, 1]; eyes = 'happy'; mouth = 'open'; lift = K * 2 * arc(seg(p, 0.05, 0.35));
      } else if (m === 'wrong') {
        const d = sm(seg(p, 0, 0.2)) * (1 - sm(seg(p, 0.82, 1)));
        sway += 6 * d * K; L -= 4 * d; ctrl = 3 * d * K; fs = Math.round(d); eyes = s.blink ? 'blink' : 'sad'; mouth = 'sad';
      } else if (m === 'dance' || m === 'party') {
        const big = m === 'party', n = p * (big ? 14 : 8), i = Math.floor(n);
        sway = K * (big ? 7 : 6) * Math.sin(p * Math.PI * (big ? 14 : 8)); ctrl = -sway * 0.9; arms = [i % 2, (i + 1) % 2];
        steps = [i % 2, (i + 1) % 2].map(v => v * K); eyes = 'happy'; mouth = 'open';
        curl = 1;
        if (big) {
          // hops on every other beat, both arms up for the last bars, the neck reaching on the high notes
          if (p > 0.7) arms = [1, 1];
          lift = K * 3 * arc(n % 2 / 2) * (i % 2 ? 0 : 1);
          L += 5 * bell(p, 0.1, 0.4) * (K || 0.5) + 7 * bell(p, 0.66, 1) * (K || 0.5);
        }
      } else if (m === 'yawn') {
        const e = sm(seg(p, 0.1, 0.32)) * (1 - sm(seg(p, 0.68, 0.9)));
        L += 3 * e * (K || 0.5); sway += K * -2 * e; ctrl = K * e;
        if (e > 0.25) { arms = [1, 1]; eyes = 'blink'; mouth = 'yawn'; }
      } else if (m === 'peek') {
        const e = sm(seg(p, 0.08, 0.3)) * (1 - sm(seg(p, 0.72, 0.94))), d = s.side;
        sway += K * 8 * d * e; ctrl = -K * 3 * d * e; L += 2 * e;
        if (e > 0.5) { look = d; fs = d; if (p > 0.4 && p < 0.6) mouth = 'o'; }
      } else if (m === 'nod') {
        L -= 2.5 * (bell(p, 0, 0.5) + bell(p, 0.5, 1)) * (K || 0.4); eyes = 'happy';
      }
      lift = Math.round(lift);
      g.off(0, -lift); f.off(0, -lift);
      const cx = 32;
      // legs and shoes
      g.rect(cx - 3, B - 4 - steps[0], 2, 4, C.skin); g.rect(cx + 1, B - 4 - steps[1], 2, 4, C.skin);
      g.rect(cx - 4, B - 1 - steps[0], 3, 2, C.shoe); g.rect(cx + 1, B - 1 - steps[1], 3, 2, C.shoe);
      g.rect(cx - 4, B - 7, 8, 3, C.shorts);
      // body
      g.rect(cx - 4, B - 14, 8, 7, C.shirt); g.rect(cx - 3, B - 15, 6, 1, C.shirt);
      g.rect(cx - 4, B - 8, 8, 1, C.shirtD);
      // arms
      const arm = (sx, dir, upv) => {
        const hxp = sx + dir * (upv ? 3 : 2), hyp = upv ? B - 19 : B - 9;
        g.cap(sx, B - 13, lerp(sx, hxp, 0.35), lerp(B - 13, hyp, 0.35), 1.1, C.shirt);
        g.cap(lerp(sx, hxp, 0.35), lerp(B - 13, hyp, 0.35), hxp, hyp, 0.85, C.skin);
      };
      arm(cx - 5, -1, arms[0]); arm(cx + 4, 1, arms[1]);
      // the neck
      const P0 = [cx, B - 15], P2 = [cx + sway, B - 15 - L], P1 = [cx + ctrl * 2 + sway * 0.2, B - 15 - L / 2];
      let prev = P0;
      for (let i = 1; i <= 12; i++) {
        const u = i / 12, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
        const pt = [a * P0[0] + b * P1[0] + c * P2[0], a * P0[1] + b * P1[1] + c * P2[1]];
        g.cap(prev[0], prev[1], pt[0], pt[1], 1.05, C.skin);
        prev = pt;
      }
      g.rect(cx - 2, B - 15, 4, 1, C.shirtD);
      // head
      const hX = Math.round(P2[0]), hY = Math.round(P2[1]) - 4;
      g.ell(hX, hY - 1, 5.5, 4.8, C.hair);
      g.ell(hX + fs, hY + 1, 4.3, 3.6, C.skin);
      g.px(hX, hY - 6, C.hair); g.px(hX + 1, hY - 7 - curl * (Math.floor(t * 4) % 2) * K, C.hair);
      const ey = hY + 1, e = (x) => {
        if (eyes === 'blink') g.px(x, ey + 1, C.eye);
        else if (eyes === 'happy') { g.px(x - 1, ey + 1, C.eye); g.px(x, ey, C.eye); g.px(x + 1, ey + 1, C.eye); }
        else if (eyes === 'sad') { g.px(x, ey + 1, C.eye); g.px(x + (x < hX + fs ? -1 : 1), ey - 1, C.eye); }
        else g.rect(x + look, ey, 1, 2, C.eye);
      };
      e(hX - 2 + fs); e(hX + 1 + fs);
      g.px(hX - 3 + fs, ey + 2, C.cheek); g.px(hX + 2 + fs, ey + 2, C.cheek);
      const mx = hX - 1 + fs, my = ey + 3;
      if (mouth === 'o') g.px(mx + (look > 0 ? 1 : 0), my, C.mouth);
      else if (mouth === 'yawn') g.rect(mx, my - 1, 2, 2, C.mouth);
      else g.rect(mx, my, 2, 1, C.mouth);
      if (m === 'right') FX.sparkle(f, hX + 8, hY - 6, seg(p, 0.15, 0.75), C.spark);
      if (m === 'wrong' && p > 0.2 && p < 0.85) FX.sweat(f, hX - 9, hY - 3, C.sweat, C.hi);
      if (m === 'dance' || m === 'party') FX.notes(f, s, cx + 8, B - 22, C.shorts);
      if (m === 'party') {
        FX.sparkle(f, hX - 9, hY - 4, seg(p, 0.05, 0.35), C.spark);
        FX.sparkle(f, hX + 9, hY - 7, seg(p, 0.3, 0.6), C.spark);
        FX.sparkle(f, hX - 8, hY - 9, seg(p, 0.55, 0.85), C.spark);
        FX.sparkle(f, hX + 8, hY - 2, seg(p, 0.7, 1), C.spark);
      }
      return { lift, sw: 7, sx: cx };
    },
  };

  /* ---------- the engine: one per canvas. Breathing, blinking, an idle action now and then (when idle is on), and
     the moments on demand. The ground is see-through: only a soft shadow under his feet. ---------- */
  const reduced = () => { try { return REDUCED(); } catch (e) { return false; } };
  const IDLE = ['act', 'act', 'yawn', 'peek'];
  function companion(canvas, o = {}) {
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const out = new Uint32Array(img.data.buffer);
    const body = new Uint32Array(W * H), fxb = new Uint32Array(W * H);
    const C = compile(NOODLE.palette), SHADOW = hex('#15171c', 30);
    const g = painter(), f = painter();
    const dur = NOODLE.durations;
    const rnd = (a, b) => a + Math.random() * (b - a);
    let mode = null, start = 0, nextAct = 0, nextBlink = 0, blinkEnd = 0, t0 = null, side = 1;
    const now = () => performance.now() / 1000;
    function play(m) {
      mode = m; start = now(); side = Math.random() < 0.5 ? -1 : 1;
      nextAct = start + dur[m] + rnd(10, 25);
    }
    function render(ms) {
      const t = ms / 1000;
      if (t0 === null) { t0 = t; nextAct = t + rnd(3, 6); nextBlink = t + rnd(1, 3); }
      if (!mode && o.idle && t > nextAct) play(IDLE[Math.floor(Math.random() * IDLE.length)]);
      let p = 0;
      if (mode) { p = (t - start) / dur[mode]; if (p >= 1) { mode = null; p = 0; } }
      if (t > nextBlink) { blinkEnd = t + 0.13; nextBlink = t + (Math.random() < 0.2 ? 0.3 : rnd(2.5, 6)); }
      const k = reduced() ? 0 : 1;
      const s = { t, p, mode, k, C, B, side, blink: t < blinkEnd, breath: k ? (Math.sin(t * 2 * Math.PI / 3.4) + 1) / 2 : 0.5 };
      body.fill(0); fxb.fill(0);
      g.use(body); f.use(fxb);
      const r = NOODLE.draw(g, f, s) || {};
      out.fill(0);
      const lift = r.lift || 0, sw = (r.sw || 10) * (1 - Math.min(lift, 12) / 22);
      g.use(out); g.ell(r.sx ?? 32, B + 1.5, sw, 0.9, SHADOW);
      const ink = C.ink;
      for (let i = 0, y = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
        if (body[i]) out[i] = body[i];
        else if ((x > 0 && body[i - 1]) || (x < W - 1 && body[i + 1]) || (y > 0 && body[i - W]) || (y < H - 1 && body[i + W])) out[i] = ink;
      }
      for (let i = 0; i < fxb.length; i++) if (fxb[i]) out[i] = fxb[i];
      ctx.putImageData(img, 0, 0);
    }
    return { play, render, canvas, busy: () => !!mode && now() - start < dur[mode] };
  }

  /* ---------- tiny pixel sounds: square-wave notes as a WAV, made once ---------- */
  const TUNES = {
    dance: [[1047, .09], [1319, .09], [1568, .09], [2093, .16]],
    party: [[784, .08], [1047, .08], [1319, .08], [1568, .12], [1319, .08], [1568, .08], [2093, .22]],
    cheer: [[1319, .07], [1568, .11]],
  };
  const WAV = {};
  function wav(notes) {
    const rate = 22050, n = notes.reduce((a, [, d]) => a + Math.round(d * rate), 0), b = new Uint8Array(44 + n), v = new DataView(b.buffer);
    const str = (o, s) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true);
    v.setUint16(34, 8, true); str(36, 'data'); v.setUint32(40, n, true);
    let i = 44;
    for (const [hz, d] of notes) {
      const len = Math.round(d * rate);
      for (let j = 0; j < len; j++) {
        const env = Math.min(1, j / 80, (len - j) / 300);
        b[i++] = 128 + Math.round((Math.floor(j * hz * 2 / rate) % 2 ? 1 : -1) * 34 * env);
      }
    }
    let bin = '';
    for (let j = 0; j < b.length; j++) bin += String.fromCharCode(b[j]);
    return 'data:audio/wav;base64,' + btoa(bin);
  }
  function chirp(name) {
    try {
      if (LAB.get('noodle') !== 'sound' || (typeof SND !== 'undefined' && !SND.on) || SOUND.playing) return;
      SOUND.play(WAV[name] || (WAV[name] = wav(TUNES[name])));
    } catch (e) {}
  }

  /* ---------- where he is ---------- */
  const on = () => { try { return LAB.get('noodle') !== 'off'; } catch (e) { return true; } };
  const view = () => { try { return VIEW; } catch (e) { return null; } };
  const N = { today: null, corner: null, end: null };
  // a whole number of device pixels per art pixel, about two CSS pixels each
  const fit = (cv, css = 2) => {
    const d = devicePixelRatio || 1, s = Math.max(1, Math.round(css * d)) / d;
    cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
    return s;
  };
  function make(cls, idle) {
    const cv = document.createElement('canvas');
    cv.className = 'nd ' + cls;
    cv.setAttribute('aria-hidden', 'true');
    return companion(cv, { idle });
  }

  // Today: standing in the forest, left of the tree's trunk (#today-buddy, under the heatmap, only when there's no forest)
  function mountToday() {
    const forest = document.getElementById('companion'), slot = forest ? null : document.getElementById('today-buddy');
    const host = forest || slot;
    if (!host) return;
    if (N.today && N.today.canvas.parentNode === host) return;
    if (N.today) N.today.canvas.remove();
    const c = N.today = make(forest ? 'nd-forest' : 'nd-slot', true);
    host.appendChild(c.canvas);
    placeToday();
    c.canvas.addEventListener('pointerdown', () => { if (!c.busy()) c.play('right'); kick(); });
  }
  function placeToday() {
    const c = N.today; if (!c) return;
    const s = fit(c.canvas);
    // the forest's ground is 8px above its box's bottom (fun.js); his feet are 6 art pixels above the canvas's bottom
    if (c.canvas.classList.contains('nd-forest')) c.canvas.style.bottom = Math.round(8 - 6 * s) + 'px';
  }

  // Reviews: a corner of the tab, while a card or the end screen is up (not Browse)
  function mountCorner() {
    const v = document.getElementById('view-reviews');
    if (!v || N.corner) return;
    const c = N.corner = make('nd-corner', false);
    v.appendChild(c.canvas);
    fit(c.canvas);
    const body = v.querySelector('.rx-body');
    const sync = () => { c.canvas.classList.toggle('on', !!(body && body.querySelector('.rw'))); kick(); };
    if (body) new MutationObserver(sync).observe(body, { childList: true });
    sync();
  }
  // (fixed, so no offsetParent: hidden by the view, the width or the switch means no boxes at all)
  const cornerShown = () => !!(N.corner && N.corner.canvas.getClientRects().length);

  /* ---------- one loop for all of him, running only while one is on screen ---------- */
  let raf = 0, last = 0;
  const live = () => {
    if (!on() || document.hidden) return [];
    const v = view(), l = [];
    if (v === 'today' && N.today && N.today.canvas.isConnected) l.push(N.today);
    if (v === 'reviews') {
      if (cornerShown()) l.push(N.corner);
      if (N.end && N.end.canvas.isConnected) l.push(N.end);
    }
    return l;
  };
  function frame(ms) {
    raf = 0;
    const l = live();
    if (!l.length) return;
    // reduced motion: still frames, a few a second is plenty for a blink or a new face
    if (!reduced() || ms - last > 160) { last = ms; l.forEach(c => c.render(ms)); }
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---------- what he reacts to ---------- */
  let easy = 0, party = false;
  function onCard(d) {
    if (!on() || !d) return;
    const c = cornerShown() ? N.corner : null;
    const g = +d.grade;
    easy = g === 4 ? easy + 1 : 0;
    if (!c) return;
    if (g === 1) c.play('wrong');
    else if (g === 4 && easy >= 3) { easy = 0; c.play('right'); chirp('cheer'); }
    else if (g >= 3) c.play('nod');
    kick();
  }
  function onReviewsDone() {
    if (!on()) return;
    // after the confetti has had its moment
    setTimeout(() => {
      if (view() !== 'reviews') return;
      let c = cornerShown() ? N.corner : null;
      if (!c) {
        // a phone: no corner, so he comes onto the end screen to dance
        const end = document.querySelector('#view-reviews .rw-end');
        if (!end) return;
        if (!N.end || !end.contains(N.end.canvas)) {
          N.end = make('nd-end', false);
          end.appendChild(N.end.canvas);
          fit(N.end.canvas);
        }
        c = N.end;
      }
      c.play('dance'); chirp('dance'); kick();
    }, 900);
  }
  function partyNow() {
    if (!party || !on() || view() !== 'today' || document.hidden) return;
    mountToday();
    if (!N.today) return;
    party = false;
    setTimeout(() => { N.today.play('party'); chirp('party'); kick(); }, 500);
  }

  function start() {
    try {
      LAB.define('noodle', 'Noodle', [['on', 'On'], ['sound', 'With sound'], ['off', 'Off']], 'on', 'Everyday', { scope: 'account' });
    } catch (e) {}
    mountToday(); mountCorner();
    BUS.on('view', v => { if (v === 'today') { mountToday(); partyNow(); } if (v === 'reviews') mountCorner(); kick(); });
    // Today is redrawn as data arrives (the Habit's slot may come and go): stay mounted
    ['data', 'essays', 'reviews'].forEach(ev => BUS.on(ev, () => { mountToday(); kick(); }));
    BUS.on('lab', id => { if (id === 'noodle') kick(); });
    BUS.on('reviews:card', onCard);
    BUS.on('reviews:start', () => { easy = 0; });
    BUS.on('reviews:done', onReviewsDone);
    BUS.on('day:done', () => { party = true; partyNow(); });
    document.addEventListener('visibilitychange', () => { kick(); partyNow(); });
    addEventListener('resize', () => { placeToday(); if (N.corner) fit(N.corner.canvas); if (N.end) fit(N.end.canvas); kick(); });
    kick();
  }

  // the board's scripts arrive after this one (plus.js loads them once the account is checked): start when boot.js has run
  const booted = () => typeof BUS !== 'undefined' && view();
  if (booted()) start();
  else {
    const wait = e => {
      const s = e.target;
      if (!s || s.tagName !== 'SCRIPT' || !/\/board\/js\/boot\.js/.test(s.src)) return;
      document.removeEventListener('load', wait, true);
      if (typeof BUS !== 'undefined') start();
    };
    document.addEventListener('load', wait, true);
  }
})();
