// Chinese Brain Plus: the jobs that replaced the Claude skill sessions (the weekly essay review, the monthly review
// and the monthly test), on the Claude API, run by worker.js `scheduled` (twice a day, Taipei time). Opus does the
// judging; code does everything mechanical, and nothing calls Claude unless there is something to judge.
//   5 am, daily     yesterday's essay: its marks and its bookkeeping in one Opus pass (`essays`)
//   5 am, Monday    the week, right after its last essay is marked: typing slips, To improve kept to 3–5 new items,
//                   essayTarget, a Log line (`weekly`)
//   5 am, the 1st   the month, right after its last essay: code freezes the numbers, refills the Test lane, checks the
//                   pieces agree; Opus writes This month and keeps the Watch list tight (`monthly`); then the monthly
//                   test, which takes the place of that day's test (`monthlyTest`)
//   10 pm           after the nightly files a monthly test: its lessons (`afterTest`)
// Each keeps what it did in meta (`job.<name>`), which the connector's `nightly` tool shows; every Claude call's
// tokens go into the D1 table `spend` (ai.ts).
import * as E from './engine.ts';
import * as ai from './ai.ts';
import * as MD from './md.ts';
import { essayToday, norm, validate, planJson, patterns, fixCards, focusOn, cardId } from './essays.ts';
import { glossary, reading } from './look.ts';
import { lexicon } from './cards.ts';
import * as PY from './pinyin.ts';
import { loadFiles, listDocs, getDoc, change, today as taipeiToday } from './plus.ts';
import { putDoc, media, type Env } from './nightly.ts';
import { modelFor } from './settings.ts';

export const OPUS = 'anthropic:claude-opus-5-5';

const json = (t: string) => {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in the answer');
  return JSON.parse(m[0]);
};
const meta = async (env: Env, k: string) => (await env.CBP.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first<{ v: string }>())?.v ?? null;
const setMeta = (env: Env, k: string, v: string) => env.CBP.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(k, v).run();
async function report(env: Env, name: string, said: string[]) {
  await setMeta(env, `job.${name}`, JSON.stringify({ at: Date.now(), day: taipeiToday(), said }));
  return said;
}
const docs = async (env: Env, col: string) => Object.fromEntries((await listDocs(env as never, col)).map((d) => [d.id, d.data as Record<string, unknown>]));
const part = (md: string, a: string, b: string) => {
  const i = md.indexOf(a), j = b ? md.indexOf(b, i + 1) : -1;
  return i < 0 ? '' : md.slice(i, j < 0 ? undefined : j).trim();
};
const pad = (d: number) => `d${String(d).padStart(3, '0')}`;

// ---------- every hour: one essay, its marks and its bookkeeping ----------
// The marks come back as JSON that code checks and repairs (essays.ts validate) before anything is saved; pinyin and
// meanings for the words he lacked come from the dictionary (look.ts), not from the answer.
function essayPrompt(md: string, e: Record<string, unknown>, open: string, tracked: string, problems: string[], o: { patterns: string[]; focus: string }) {
  return `You correct Chris's daily Chinese essay (Traditional characters, Taiwanese Chinese, high A2) and do its bookkeeping. He reads your marks inside his own text the next day. Keep it light: a few marks that matter, never homework.

Reply with only this JSON:
{"marks": [{"t": "fix" | "better" | "good" | "word", "mine": string, "nat": string, "why": string, "pattern": string, "list": boolean}], "uses": [{"id": string, "s": string, "ok": boolean}], "log": [{"target": string, "result": "pass" | "partial" | "fail", "sentence": string}], "known": [string], "missing": [{"word": string, "gloss": string, "lane": "Life" | "Taiwan"}], "watch": [{"line": string, "add": string}]}

marks, in essay order:
- t: fix = a mistake; better = right, but not how a Taiwanese person says it; good = something he did well (one or two; nat, why, pattern empty); word = English he dropped in (mine = the English, nat = the Chinese).
- mine: his exact words, copied character for character, enough of them to land in one place only; marks never overlap.
- nat: the right way. Taiwan usage, Traditional characters, Chinese punctuation, no longer than it needs to be, his tone kept.
- why: ALWAYS, for fix, better and word: one short line of plain English that says why (a frame like 兩碗 + noun beats a grammar rule). Never empty, never a restatement of nat.
- pattern: for fix and better, the pattern's short name in plain words (like "一…就: as soon as"). When it is the same mistake as one of his earlier patterns below, use that name exactly.
- list: true puts a fix or better on his To improve list: at most two a day, sentence structure or natural phrasing that will keep coming back, his Leaks first; never a missing word, never one already on his list.
A typing slip inside a corrected phrase gets fixed with it; a sound-alike slip on its own isn't marked. English in an essay means he found no way to say it: a word mark, never a fix.

uses: for each open To improve item (below) this essay uses or should have used: id = the item's id, s = his words in this essay, ok = true only if he got it right.${o.focus ? ` Today his writing page showed him this one to practice: ${o.focus}. Always give it a row if he tried it.` : ''}

log: one row per tracked item this essay uses or misses where he could have gone wrong (a use where he couldn't have gone wrong, or a synonym in its place, is no row). target = the item's name exactly as in the tracked list below. Several uses of one item make one row: pass if every use is clean, partial if only some are. A slip that fits two items counts once, under the more specific one. sentence = his sentence.
known: words he used correctly in this essay (the exact characters), everyday words only; the code keeps only those his word list doesn't already have.
missing: words he reached for and didn't have (the Chinese for each English word he dropped in, an invented compound, a long detour), each with a short gloss for this sense; lane Taiwan for slang, particles, idioms.
watch: a new miss of a smaller pattern (not one of his numbered Leaks): line = the first words of the Watch list line it belongs to, exactly as written below, or "" for a new pattern; add = his words → the fix (${String(e.date).slice(5)}); for a new pattern, start add with the pattern in plain words and a colon, like the lines below.

His Leaks, Watch list, Taiwan usage notes and what he knows:
${part(md, '### Leaks', '### Context')}

Tracked items (name · right form):
${tracked}

His earlier patterns:
${o.patterns.join('\n') || '(none yet)'}

His open To improve list (id · day · his words → the right way):
${open || '(empty)'}

DAY ${e.day} (${e.date}):
${norm(e.text)}${problems.length ? `\n\nYour last answer was refused: ${problems.join('; ')}. Send it again, fixed.` : ''}`;
}

/** Every essay whose day is over and has no review yet (usually just yesterday's), oldest first, at most three. */
export async function essays(env: Env) {
  const said: string[] = [];
  for (let n = 0; n < 3; n++) {
    const r = await essay(env);
    if (!r) break;
    said.push(...r);
  }
  return said.length ? said : null;
}

/** Opus's marks and bookkeeping for the oldest essay whose day is over and that has no review yet. */
export async function essay(env: Env) {
  const essays = await listDocs(env as never, 'essays');
  const reviewed = new Set((await env.CBP.prepare("SELECT id FROM docs WHERE col = 'reviews'").all<{ id: string }>()).results.map((r) => r.id));
  const last = Math.max(0, ...[...reviewed].map((id) => Number(id.slice(1)) || 0));
  const now = essayToday(essays.map((e) => e.data));
  const todo = essays.map((e) => e.data as Record<string, unknown>).filter((e) => Number(e.day) > last && norm(e.text).trim() && String(e.date) < now).sort((a, b) => Number(a.day) - Number(b.day));
  if (!todo.length) return null;
  const e = todo[0], day = Number(e.day), date = String(e.date);
  const files = await loadFiles(env as never);
  const md = files.get(E.MEMORY) ?? '';
  const improve = await docs(env, 'improve');
  const open = Object.entries(improve).filter(([, x]) => !x.done && !x.removed).map(([id, x]) => `${id} · DAY ${x.day ?? '-'} · ${x.mine ?? ''} → ${x.nat ?? ''}`).join('\n');
  const items = [...E.schedule(E.readLog(files)).values()];
  const tracked = items.filter((x) => x.active || x.form).map((x) => `${x.name} · ${x.form || '?'}`).join('\n');
  const reviews = await docs(env, 'reviews');
  const text = norm(e.text);
  const fx = focusOn(improve, date);
  const ctx = { patterns: patterns(reviews, day), focus: fx ? `${fx.id} · ${fx.mine ?? ''} → ${fx.nat ?? ''}` : '' };
  let errs: string[] = [];
  for (let tries = 0; tries < 3; tries++) {
    let out;
    try {
      out = json((await ai.text(env, await modelFor(env, 'essay-model'), essayPrompt(md, e, open, tracked, errs, ctx), { effort: 'medium', job: 'essay' })).text);
    } catch (x) {
      if (x instanceof ai.Quota) throw x;
      errs = [String((x as Error).message)];
      continue;
    }
    // code checks every mark; what it can't repair drops. Only an answer whose marks all failed is asked again.
    const v = validate(text, out.marks);
    const asked = Array.isArray(out.marks) ? out.marks.length : 0;
    if (asked && !v.marks.length && tries < 2) {
      errs = [`none of the marks could be used (${v.dropped.slice(0, 3).join('; ')}); copy his words exactly and give every fix a why`];
      continue;
    }
    const today = taipeiToday();
    for (const w of planJson(e, v.marks, out.uses, reviews, improve, today)) await putDoc(env, w.col, w.id, w.data, w.op);
    const said = [`DAY ${day}: ${v.marks.length} marks${v.dropped.length ? ` (${v.dropped.length} dropped: ${v.dropped.join('; ').slice(0, 300)})` : ''}`];
    const [lex, gl] = await Promise.all([lexicon(env as never), glossary(env as never)]).catch(() => [null, null] as const);
    // a mistake marked again: a card from his own sentence, corrected, at the top of Next up (essays.ts fixCards)
    if (lex && gl) {
      const made: [string, string, string, string][] = [];
      for (const c of fixCards(text, day, v.marks, reviews)) {
        const id = cardId(c.word);
        if (await getDoc(env as never, 'cards', id)) continue;
        const card = [`word: ${c.word}`, `pinyin: ${reading(lex, gl, c.word).py}`, `meaning: ${c.why}`, `mine: ${c.sentence} | ${PY.sentence(lex, c.sentence)} | `].join('\n');
        await putDoc(env, 'cards', id, { word: c.word, text: card, src: 'fix', parent: null, chat: [], carded: null, filed: null, knows: {}, made: new Date().toISOString(), model: 'code', making: null, err: null, fix: { day, p: c.p, mine: c.mine, nat: c.nat } });
        made.push([c.word, reading(lex, gl, c.word).py, c.why, 'life']);
      }
      if (made.length) {
        const board = ((await getDoc(env as never, 'board', 'data')) ?? {}) as Record<string, unknown>;
        const had = (Array.isArray(board.fixes) ? board.fixes : []) as [string, string, string, string][];
        await putDoc(env, 'board', 'data', { fixes: [...made, ...had.filter((r) => !made.some((m) => m[0] === r[0]))].slice(0, 5) }, 'update');
        said.push(`fix cards: ${made.map((m) => m[0]).join(', ')}`);
      }
    }
    const names = new Set(items.map((x) => x.name));
    said.push(await change(env as never, (f) => {
      const out2: string[] = [];
      const rows = (Array.isArray(out.log) ? out.log : []).filter((r: Record<string, unknown>) => names.has(String(r.target)) && ['pass', 'partial', 'fail'].includes(String(r.result)))
        .map((r: Record<string, unknown>) => ({ date, target: String(r.target), kind: 'essay', result: String(r.result), note: `DAY ${day}: ${String(r.sentence ?? '').slice(0, 200)}` }));
      // words he used correctly: new ones become K (dated by the essay); an L word gets a pass row (its delayed check)
      const l = E.loadKw(f);
      for (const w0 of (Array.isArray(out.known) ? out.known : []).map(String)) {
        const w = E.key(w0);
        if (!/^[㐀-鿿]{1,6}$/.test(w)) continue;
        const idx = E.kwIndex(l);
        if (!idx.has(w)) {
          l.push(`${w}\tK\t${date}`);
          out2.push(`${w} K`);
        } else {
          const [, st, d] = E.kwGet(l, idx.get(w)!);
          if (st === 'L' && E.cmp(d, date) <= 0 && !rows.some((r: { target: string }) => E.key(r.target) === w)) rows.push({ date, target: w, kind: 'essay', result: 'pass', note: `DAY ${day}` });
        }
      }
      E.kwSave(f, l);
      if (rows.length) out2.push(E.logRows(f, rows));
      // the pinyin (and a meaning the answer left out) by code, from the dictionary
      const miss = (Array.isArray(out.missing) ? out.missing : []).filter((m: Record<string, unknown>) => /^[㐀-鿿]{1,8}$/.test(String(m.word ?? '').trim()))
        .map((m: Record<string, unknown>) => {
          const w = String(m.word).trim(), r = lex && gl ? reading(lex, gl, w) : { py: '', g: '' };
          return [m.lane === 'Taiwan' ? 'Taiwan' : 'Life', `${w} · ${r.py} · ${(String(m.gloss ?? '').trim() || r.g).replace(/·/g, ',')} · essay`] as [string, string];
        });
      if (miss.length) out2.push(E.addWords(f, miss, taipeiToday()).split('\n').join(' · '));
      let m2 = f.get(E.MEMORY) ?? '';
      for (const w of Array.isArray(out.watch) ? out.watch : []) m2 = MD.watch(m2, String(w.line ?? ''), String(w.add ?? ''));
      if (m2 !== f.get(E.MEMORY)) {
        f.set(E.MEMORY, m2);
        out2.push(`Watch list +${(out.watch as unknown[]).length}`);
      }
      // the queue and the known words changed: Next up follows
      return out2.join(' · ');
    }));
    await putDoc(env, 'board', 'data', E.boardPayload(await loadFiles(env as never), today) as never, 'update');
    return report(env, 'essay', said.filter(Boolean));
  }
  // three refusals: an empty review, so the next essay isn't held up
  await putDoc(env, 'reviews', pad(day), { day, review: taipeiToday(), marks: [] });
  return report(env, 'essay', [`DAY ${day}: marks refused three times (${errs.join('; ')}); left unmarked`]);
}

// ---------- Sunday night: the week ----------
export async function weekly(env: Env, o: { force?: boolean } = {}) {
  const today = taipeiToday();
  if (!o.force && (await meta(env, 'job.weekly.day')) === today) return null;
  // the essays marked since the last pass (the marker line in chinese.md says up to which DAY); an essay whose day
  // isn't over yet (Sunday's) waits for next week
  const files = await loadFiles(env as never);
  const md = files.get(E.MEMORY) ?? '';
  const upTo = Number(/Essay review: DAY 1–(\d+)/.exec(md)?.[1] ?? 0);
  const from = (await meta(env, 'job.weekly.day')) ?? E.plus(today, -7);
  const reviews = await docs(env, 'reviews');
  const essays = (await listDocs(env as never, 'essays')).map((x) => x.data as Record<string, unknown>).filter((x) => Number(x.day) > upTo && reviews[pad(Number(x.day))] && norm(x.text).trim()).sort((a, b) => Number(a.day) - Number(b.day));
  const improve = await docs(env, 'improve');
  const board = ((await getDoc(env as never, 'board', 'data')) ?? {}) as Record<string, unknown>;
  const fresh = Object.entries(improve).filter(([, x]) => x.by === 'claude' && !x.done && !x.removed && E.cmp(String(x.added ?? '').slice(0, 10), from) > 0);
  const said: string[] = [];
  if (!essays.length) {
    await change(env as never, (f) => (f.set(E.MEMORY, MD.marker(f.get(E.MEMORY) ?? '', upTo, today)), ''));
    said.push('no essays this week');
  } else {
    const week = essays.map((x) => `DAY ${x.day} (${x.date}):\n${norm(x.text)}\nMarks: ${JSON.stringify(reviews[pad(Number(x.day))]?.marks ?? [])}`).join('\n\n');
    const p = `You look back over Chris's week of daily Chinese essays (Taiwanese Chinese, high A2). Each essay already has its marks (fix, better, good, word). Reply with only this JSON:
{"slips": [string], "keep": [string], "essayTarget": string, "log": string}

- slips: sound-alike typing slips that recur this week (he types fast), each as "wrong/right" or "wrong for right" like the Typing slips line below; only ones not already there.
- keep: of the To improve items added this week (listed below), the ids to keep: 3 to 5 at most in all, the ones that will keep coming back, his Leaks first. The rest are dropped.
- essayTarget: this week's target: keep the current one unless he used it cleanly this week; otherwise the newest essay miss from his Leaks. Plain words, no grammar terms, then ": " and one or two right sentences joined by " · ", no wrong forms. Current: ${board.essayTarget ?? '(none)'}
- log: one line for his Chinese log, starting "essay week, DAY ${essays[0].day}–${essays[essays.length - 1].day}: ", saying what moved (Leaks used or missed, the list, the target) in a few words.

His Leaks, Watch list and Typing slips:
${part(md, '### Leaks', '### What he knows')}

To improve items added this week (id · his words → the right way):
${fresh.map(([id, x]) => `${id} · ${x.mine} → ${x.nat}`).join('\n') || '(none)'}

The week:
${week}`;
    const out = json((await ai.text(env, OPUS, p, { effort: 'medium', job: 'weekly' })).text);
    const keep = new Set((Array.isArray(out.keep) ? out.keep : []).map(String).slice(0, 5));
    const drop = fresh.filter(([id]) => !keep.has(id));
    if (fresh.length > 5 || keep.size) for (const [id] of drop) await putDoc(env, 'improve', id, { removed: new Date().toISOString(), removedBy: 'weekly' }, 'update');
    if (drop.length && (fresh.length > 5 || keep.size)) said.push(`To improve: kept ${fresh.length - drop.length} of ${fresh.length} new`);
    if (typeof out.essayTarget === 'string' && out.essayTarget.trim()) {
      await putDoc(env, 'board', 'data', { essayTarget: out.essayTarget.trim() }, 'update');
      said.push(`target: ${out.essayTarget.trim()}`);
    }
    const lastDay = Number(essays[essays.length - 1].day);
    await change(env as never, (f) => {
      let m = f.get(E.MEMORY) ?? '';
      const slips = (Array.isArray(out.slips) ? out.slips : []).map(String);
      m = MD.typingSlips(m, slips);
      if (typeof out.log === 'string' && out.log.trim()) m = MD.logLine(m, `- ${today} · ${out.log.trim().replace(/^- /, '')}`);
      m = MD.marker(m, Math.max(lastDay, upTo), today);
      f.set(E.MEMORY, m);
      if (slips.length) said.push(`typing slips: ${slips.join(', ')}`);
      return '';
    });
  }
  await setMeta(env, 'job.weekly.day', today);
  return report(env, 'weekly', said);
}

// ---------- the 1st: the month ----------
/** What should agree and doesn't: shown on Progress (board/data `alerts`) and in `nightly`. */
async function checks(env: Env, files: E.Files, today: string) {
  const out: string[] = [];
  const items = E.table(E.readLog(files));
  const noForm = items.filter((x) => !x.form).map((x) => x.name);
  if (noForm.length) out.push(`No right form yet for ${noForm.join(', ')}: their retests have nothing to check against.`);
  const md = files.get(E.MEMORY) ?? '';
  const mk = /last run ([\d-]+)\.\*\*/.exec(md)?.[1];
  if (!mk || E.cmp(mk, E.plus(today, -8)) < 0) out.push(`The weekly essay pass last ran ${mk ?? 'never'}.`);
  const n = JSON.parse((await meta(env, 'nightly')) ?? '{}');
  if (!n.day || E.cmp(n.day, E.plus(today, -1)) < 0) out.push(`The 10 pm job last ran ${n.day ?? 'never'}.`);
  const last = E.plus(today.slice(0, 7) + '-01', -1).slice(0, 7);
  if (!(files.get('monthly-test.md') ?? '').includes(`\n- ${last}`)) out.push(`No monthly test in ${last} (monthly-test.md, Runs).`);
  for (const lane of ['Life', 'Taiwan']) if (E.loadQueue(files).lane(lane).length < 12) out.push(`The ${lane} lane is down to ${E.loadQueue(files).lane(lane).length} words.`);
  return out;
}

export async function monthly(env: Env, o: { force?: boolean } = {}) {
  const today = taipeiToday();
  const m = E.plus(today.slice(0, 7) + '-01', -1).slice(0, 7); // the month that just ended
  if (!o.force && (await meta(env, 'job.monthly.month')) === m) return null;
  const said: string[] = [];
  let files = await loadFiles(env as never);
  const rows = E.readLog(files);
  // numbers, frozen (words.py month)
  const t = rows.filter((r) => E.TEST_KINDS.includes(r.kind) && r.date.slice(0, 7) === m && ['pass', 'partial', 'fail'].includes(r.result));
  const by: Record<string, [number, number]> = {};
  for (const r of t) {
    const [p, g] = by[r.kind] ?? [0, 0];
    by[r.kind] = [p + (r.result === 'pass' ? 1 : 0), g + 1];
  }
  const tests: [number, number] = [t.filter((r) => r.result === 'pass').length, t.length];
  const cards = rows.filter((r) => r.kind === 'card' && r.date.slice(0, 7) === m).length;
  const total = E.kwTotal(E.loadKw(files));
  const w = rows.filter((r) => E.WRITING_KINDS.includes(r.kind) && r.date.slice(0, 7) === m);
  const secs = t.flatMap((r) => [...r.note.matchAll(/\((\d+(?:\.\d+)?) s\)/g)].map((x) => Number(x[1]))).sort((a, b) => a - b);
  const med = secs.length ? secs[Math.floor((secs.length - 1) / 2)] : null;
  const board = ((await getDoc(env as never, 'board', 'data')) ?? {}) as Record<string, unknown>;
  const months = { ...((board.months as Record<string, unknown>) ?? {}), [m]: { new: cards, total, tests } };
  await putDoc(env, 'board', 'data', { months }, 'update');
  const kinds = Object.entries(by).map(([k, [p, g]]) => `${k} ${p}/${g}`).join(', ');
  const measure = `- **${m}, calendar month** · cards **${cards}** · tests **${tests[0]}/${tests[1]}** clean: ${kinds || 'none'}${med !== null ? ` · median answer **${med} s**` : ''} · essay rows ${w.filter((r) => r.result === 'pass').length} clean, ${w.filter((r) => r.result !== 'pass').length} misses · known-words.txt **${total}** at month end · retest table ${E.table(rows).length} items`;
  said.push(`months[${m}] frozen: ${cards} cards, ${tests[0]}/${tests[1]} tests, ${total} words`);
  await change(env as never, (f) => {
    // Measurements, and the Log's past lines moved into history.md (Part 4 keeps the marker and Waiting lines)
    let h = MD.appendUnder(f.get('history.md') ?? '', 'Measurements (append-only)', measure);
    let md = f.get(E.MEMORY) ?? '';
    const i = md.indexOf('## 4 · Log');
    if (i >= 0) {
      const body = md.slice(i).split('\n');
      const until = (l: string) => /\[until ([\d-]+)\]/.exec(l)?.[1];
      const moved = body.filter((l) => /^- \d{4}-\d\d-\d\d/.test(l) && l.slice(2, 9) < today.slice(0, 7) && !/Waiting:/.test(l) && !(until(l) && E.cmp(until(l)!, today) >= 0));
      if (moved.length) {
        h = MD.appendUnder(h, 'System changes, and why', moved.join('\n'));
        md = md.slice(0, i) + body.filter((l) => !moved.includes(l)).join('\n');
        said.push(`${moved.length} Log lines filed in history.md`);
      }
    }
    f.set('history.md', h);
    f.set(E.MEMORY, md);
    // the Test lane refills from the TOCFL list: Novice to Level 4, not known, not queued
    const q = E.loadQueue(f);
    if (q.lane('Test').length < 25) {
      const st = E.kwStatus(E.loadKw(f));
      const add: [string, string][] = [];
      for (const [word, lv] of E.tocfl(f)) {
        if (add.length >= 25 - q.lane('Test').length) break;
        if (['N1', 'N2', '1', '2', '3', '4'].includes(lv) && !st.has(word) && !q.find(word)[1] && !q.parked(word)) add.push(['Test', `${word} ·  ·  · TOCFL`]);
      }
      if (add.length) {
        E.addWords(f, add, today);
        said.push(`Test lane +${add.length} from the TOCFL list`);
      }
    }
    return '';
  });
  files = await loadFiles(env as never);
  const alerts = await checks(env, files, today);

  // Opus: next month's focus, a tight Watch list, the evidence into history.md
  const md = files.get(E.MEMORY) ?? '';
  const p = `You keep Chris's Chinese system file current for the month ahead. It is read in full by every tutoring session, so it stays short and never says the same thing twice; detail and evidence belong in history.md. Reply with only this JSON:
{"thisMonth": string, "watchList": string, "history": string, "lessons": string, "proposal": string}

- thisMonth: the whole "### This month" section for ${E.plus(today, 0).slice(0, 7)}, heading line included (like the current one: "### This month · Month N, <dates>: "<a short name>""), then a two-line read of the month that ended and 3–6 concrete numbered items for the new one, from the numbers and the log below. Keep the items that still run; drop finished ones.
- watchList: the whole body of the "### Watch list" section (no heading): each line its pattern, the fix and its models, with only its latest dates; drop a line with no new miss for a month (it is in the log rows below if it had one); keep the Taiwan usage and Typing slips paragraphs exactly as they are. Never longer than now.
- history: lines to append to history.md's evidence section: the dated evidence you took out of the Watch list, one line per pattern ("- pattern: dates and sentences"). "" if none.
- lessons: the whole body of monthly-test.md's "## Lessons" (no heading), dated lines: repeated lessons merged into one, ones that no longer apply dropped. "" to leave it as it is.
- proposal: if the log shows a rule in Parts 1 or 2 failing, one short paragraph proposing the change (he decides); else "".

The month that ended (${m}): ${JSON.stringify({ cards, tests, by, writing: [w.filter((r) => r.result === 'pass').length, w.length], median_answer_secs: med, words: total, retests_open: E.table(rows).length })}
Checks that failed: ${alerts.join(' ') || 'none'}

Part 3 now:
${part(md, '## 3 · Where he is', '## 4 · Log')}

Part 4, the log:
${part(md, '## 4 · Log', '')}

monthly-test.md's Lessons now:
${part(files.get('monthly-test.md') ?? '', '## Lessons', '## Runs')}

This month's essay and test rows:
${rows.filter((r) => r.date.slice(0, 7) === m && (E.TEST_KINDS.includes(r.kind) || E.WRITING_KINDS.includes(r.kind))).map((r) => `${r.date}\t${r.target}\t${r.kind}\t${r.result}\t${r.note}`).join('\n')}`;
  const out = json((await ai.text(env, OPUS, p, { effort: 'medium', maxTokens: 20000, job: 'monthly' })).text);
  await change(env as never, (f) => {
    let md2 = f.get(E.MEMORY) ?? '';
    const tm = String(out.thisMonth ?? '').trim();
    if (tm.startsWith('### This month')) {
      md2 = MD.replaceSection(md2, 'This month', tm);
      said.push('This month rewritten');
    }
    const wl = String(out.watchList ?? '').trim();
    const old = MD.section(md2, 'Watch list');
    if (old && wl && wl.length <= old.body.length + 200 && wl.split('\n').filter((l) => l.trim()).every((l) => /^(- |\*\*)/.test(l)) && wl.includes('**Typing slips**')) {
      md2 = md2.slice(0, old.bodyStart) + wl + '\n\n' + md2.slice(old.stop);
      said.push(`Watch list ${old.body.length} → ${wl.length} characters`);
    }
    f.set(E.MEMORY, md2);
    const ls = String(out.lessons ?? '').trim(), mt = f.get('monthly-test.md') ?? '';
    const li = mt.indexOf('\n## Lessons\n'), lj = mt.indexOf('\n## Runs', li + 1);
    if (ls && li >= 0 && lj > li && ls.split('\n').filter((l) => l.trim()).every((l) => /^- \d{4}-\d\d-\d\d · /.test(l)) && ls.length <= lj - li) {
      f.set('monthly-test.md', mt.slice(0, li) + '\n## Lessons\n' + ls + '\n' + mt.slice(lj));
      said.push('monthly-test.md Lessons merged');
    }
    if (String(out.history ?? '').trim()) f.set('history.md', MD.appendUnder(f.get('history.md') ?? '', 'Evidence behind the leaks', String(out.history)));
    return '';
  });
  if (String(out.proposal ?? '').trim()) alerts.push('Proposal: ' + String(out.proposal).trim());
  await putDoc(env, 'board', 'data', { alerts: alerts.length ? { day: today, list: alerts } : null }, 'update');
  said.push(...alerts.map((a) => '! ' + a));
  await setMeta(env, 'job.monthly.month', m);
  return report(env, 'monthly', said);
}

// ---------- the 2nd: the monthly test ----------
const WD: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
/** Dates in a test's Chinese with a weekday beside them (11月28日（六）, 11/28 星期六) that don't match the calendar. */
export function weekdayProblems(text: string, today: string) {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d{1,2})[月/](\d{1,2})[日號]?\s*[（(]?\s*(?:星期|週|禮拜)?([一二三四五六日天])[)）]?/g)) {
    const [mo, d] = [Number(m[1]), Number(m[2])];
    let y = Number(today.slice(0, 4));
    if (mo < Number(today.slice(5, 7)) - 6) y++;
    const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    if (WD[m[3]] !== wd) out.push(`${m[0]} is a ${'日一二三四五六'[wd]}, not ${m[3]}`);
  }
  return out;
}

async function look(env: Env, url: string) {
  const name = /\/api\/plus\/media\/([0-9a-f]{32}\.[a-z0-9]+)$/.exec(url)?.[1];
  const o = name ? await (env.FILES as unknown as { get(k: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null> }).get('m/' + name) : null;
  if (!o) return null;
  const b = new Uint8Array(await o.arrayBuffer());
  let bin = '';
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return { type: 'image' as const, source: { type: 'base64' as const, media_type: o.httpMetadata?.contentType ?? 'image/jpeg', data: btoa(bin) } };
}

export async function monthlyTest(env: Env, o: { force?: boolean } = {}) {
  const today = taipeiToday(), month = today.slice(0, 7);
  if (!o.force && (await meta(env, 'job.mtest.month')) === month) return null;
  // a build that fails (Opus's test refused three times) is tried again at most twice in the month
  const tries = Number((await meta(env, `job.mtest.tries.${month}`)) ?? 0);
  if (tries >= 3 && !o.force) return null;
  const failed = async (said: string[]) => (await setMeta(env, `job.mtest.tries.${month}`, String(tries + 1)), report(env, 'mtest', said));
  let files = await loadFiles(env as never);
  const said: string[] = [];
  // today's daily test, if he hasn't started it, makes way for the monthly one
  let waiting = E.waitingTest(E.readLog(files));
  const open = (await getDoc(env as never, 'board', 'test')) as Record<string, unknown> | null;
  if (waiting && open?.id === waiting && !open.title && !((open.items as Record<string, unknown>[]) ?? []).some((it) => it.answer)) waiting = null;
  // he's halfway through a test: try again tomorrow, through the 7th, then skip the month
  if (waiting && Number(today.slice(8)) < 7 && !o.force) return report(env, 'mtest', [`waiting: test ${waiting} is still open`]);
  if (waiting) {
    await change(env as never, (f) => (f.set('monthly-test.md', MD.appendUnder(f.get('monthly-test.md') ?? '', 'Runs', `- ${today} · Monthly test skipped: test ${waiting} was still open on the board.`)), ''));
    await setMeta(env, 'job.mtest.month', month);
    return report(env, 'mtest', [`skipped: test ${waiting} is still open`]);
  }
  const md = files.get(E.MEMORY) ?? '';
  const guide = files.get('monthly-test.md') ?? '';
  const plan = E.testPlanText(files, today, true);
  const known = [...E.kwStatus(E.loadKw(files))].filter(([, [s]]) => s === 'K').map(([w]) => w).join(' ');
  const write = (problems: string[]) => `You build Chris's monthly Chinese test: one outing in Taiwan he goes through on his board, stop by stop, answering each by dictation. Follow the guide and its Lessons exactly; Lessons override anything else. Today is ${today}.

${guide}

His test rules:
${part(md, '### Tests', '### Hard rules')}

Where he is (this month's focus first):
${part(md, '## 3 · Where he is', '### What he knows')}

What it must cover (due retests, delayed checks, the cards since the last test; one target per stop, about 7 stops, 8 at most, plus one multi-part stop for completeness):
${plan}

Words he knows (asks and model answers use these and the targets; gloss anything else above B1 in the ask): ${known}

Reply with only {"title": string, "items": [...]}, each item with label, kind, target, ask, model, check, and as the guide says scene ({"gen": "..."} with no text in it, or {"commons": "File title.jpg"}), alt, hear + voice ("m", "g" or "f"; no sound effects), read or overlay, secs.${problems.length ? `\n\nYour last try was refused: ${problems.join('; ')}. Fix exactly that.` : ''}`;
  let doc: { title?: string; items?: Record<string, unknown>[] } | null = null;
  let problems: string[] = [];
  for (let tries = 0; tries < 3 && (!doc || problems.length); tries++) {
    doc = json((await ai.text(env, OPUS, write(problems), { effort: 'medium', maxTokens: 20000, job: 'monthly-test' })).text);
    problems = [...E.testProblems(files, doc as never, true), ...weekdayProblems(JSON.stringify(doc), today)];
  }
  if (!doc || problems.length) return failed([`! not sent: ${problems.join('; ')}`]);
  doc.items = (doc.items ?? []).slice(0, 8);
  // voices and photos; Opus looks at every photo, at most two redos, then the stop goes on without one
  await media(env, doc, said);
  let gen = 0, real = 0, redone = 0, dropped = 0;
  for (const it of doc.items) {
    if (!it.scene) continue;
    for (let n = 0; ; n++) {
      const img = it.img ? await look(env, String(it.img)) : null;
      if (!img) break;
      const v = json((await ai.text(env, OPUS, [{ role: 'user', content: [img, { type: 'text', text: `This photo is for one stop of Chris's monthly test. The stop: ${JSON.stringify({ label: it.label, ask: it.ask, target: it.target, model: it.model, check: it.check, scene: it.scene, overlay: it.overlay })}

Does the photo show what the stop needs, clearly enough that he can answer from it? Garbled or legible text in the photo, or anything that contradicts the ask, is a no. Reply with only this JSON:
{"ok": boolean, "alt": "one line: what is really in the photo", "check": "the stop's check rewritten to match what the photo really shows (when ok)", "scene": {"gen": "a better description to draw (when not ok)"}, "noPhoto": {"ask": "the ask rewritten so a voice or the text carries the stop without a photo", "check": "its check"}}` }] }], { effort: 'medium', job: 'monthly-test photos' })).text);
      if (v.ok) {
        it.alt = String(v.alt ?? it.alt ?? '');
        if (v.check) it.check = String(v.check);
        (it.scene as { commons?: string }).commons ? real++ : gen++;
        break;
      }
      if (n >= 2 || !v.scene?.gen) {
        Object.assign(it, v.noPhoto ?? {});
        delete it.img;
        delete it.scene;
        delete it.alt;
        dropped++;
        break;
      }
      redone++;
      it.scene = { gen: String(v.scene.gen) };
      delete it.img;
      await media(env, { items: [it] }, said);
    }
  }
  files = await loadFiles(env as never);
  problems = [...E.testProblems(files, doc as never, true), ...weekdayProblems(JSON.stringify(doc), today)];
  if (problems.length) return failed([...said, `! not sent after the photos: ${problems.join('; ')}`]);
  const sent = JSON.parse(await change(env as never, (f) => JSON.stringify(E.sendTest(f, doc as never, today))));
  await putDoc(env, 'board', 'test', sent);
  await putDoc(env, 'board', 'data', E.boardPayload(await loadFiles(env as never), today) as never, 'update');
  const run = `- ${today} · ${sent.title ?? 'Monthly test'} (test ${sent.id}), ${sent.items.length} stops. Targets: ${sent.items.map((x: Record<string, unknown>) => x.target).join(' · ')}. Photos: ${gen} drawn, ${real} real, ${redone} redone, ${dropped} dropped for a voice or text. Built by the monthly job on Cloudflare.${said.length ? ' ' + said.join('; ') : ''}`;
  await change(env as never, (f) => (f.set('monthly-test.md', MD.appendUnder(f.get('monthly-test.md') ?? '', 'Runs', run)), ''));
  await setMeta(env, 'job.mtest.month', month);
  await setMeta(env, 'job.mtest.sent', String(sent.id));
  return report(env, 'mtest', [`sent ${sent.title} (${sent.id}), ${sent.items.length} stops`, ...said]);
}

/** After he finishes a monthly test and the 10 pm job files it: what to learn from his answers, as dated Lessons lines,
 *  and the result under Runs (monthly-test.md, "After he finishes"). Runs after the nightly; once per test. */
export async function afterTest(env: Env) {
  const id = await meta(env, 'job.mtest.sent');
  if (!id || (await meta(env, 'job.mtest.learned')) === id) return null;
  const files = await loadFiles(env as never);
  const filed = E.readLog(files).find((r) => r.kind === 'graded' && r.target === id);
  if (!filed) return null;
  const doc = (await getDoc(env as never, 'board', 'test')) as Record<string, unknown> | null;
  if (!doc || doc.id !== id) {
    await setMeta(env, 'job.mtest.learned', id);
    return report(env, 'mtest.learned', [`test ${id} was filed but its answers are gone`]);
  }
  const guide = files.get('monthly-test.md') ?? '';
  const today = taipeiToday();
  const p = `Chris finished his monthly Chinese test (test ${id}, "${doc.title ?? ''}") and it was filed: ${filed.note}. Read his answers and their grades for what the next monthly test should do differently. Reply with only {"lessons": [string], "run": string}.
- lessons: 0 to 4 lines, each new (not already a Lesson below): a grade that was unfair or too lenient, a stop he couldn't follow, a picture that confused him, a stop that was too easy (pass in under 8 s), anything he wrote about it. Each one sentence or two, what happened and what to do instead.
- run: one line for Runs: "<title> filed: N of M clean (what passed, what was partial or failed, the slowest stop)."

The guide and its Lessons:
${part(guide, '## Format', '## Runs')}

The test, with his answers (answer, natural, result, secs, feedback, retry):
${JSON.stringify(doc.items)}`;
  const out = json((await ai.text(env, OPUS, p, { effort: 'medium', job: 'monthly-test lessons' })).text);
  const lessons = (Array.isArray(out.lessons) ? out.lessons : []).map((l: unknown) => String(l).trim().replace(/^- /, '')).filter(Boolean).slice(0, 4);
  await change(env as never, (f) => {
    let mt = f.get('monthly-test.md') ?? '';
    if (lessons.length) {
      const j = mt.indexOf('\n## Runs');
      if (j > 0) mt = mt.slice(0, j).replace(/\s*$/, '') + '\n' + lessons.map((l: string) => `- ${today} · ${l}`).join('\n') + '\n' + mt.slice(j);
    }
    if (typeof out.run === 'string' && out.run.trim()) mt = MD.appendUnder(mt, 'Runs', `- ${today} · ${out.run.trim().replace(/^- /, '')}`);
    f.set('monthly-test.md', mt);
    return '';
  });
  await setMeta(env, 'job.mtest.learned', id);
  return report(env, 'mtest.learned', [`${lessons.length} lessons from test ${id}`]);
}
