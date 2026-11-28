// Chinese Brain Plus, Stage 6: the 10 pm job on Cloudflare (a Cron Trigger), which the Mac's chinese-nightly task did
// with words.py. Every night at 10 pm in Taipei:
//   1. what he marked in the Chinese Brain extension since last night, from his account, merged (brain.ts)
//   2. a finished test filed into test-log.tsv; answers the page couldn't grade are graded here (Sonnet)
//   3. the cards he carded filed, the card kit and the board's numbers rebuilt
//   4. a new test written (Opus) and sent when one is due and none is open, its lines voiced (Azure)
//   5. a snapshot of everything in R2 (`snap/<day>.json`)
// The essays, the weekly and monthly passes and the monthly test are jobs.ts.
// Each run's report is kept in meta (`nightly`), and the connector's `nightly` tool shows it.
import * as E from './engine.ts';
import * as ai from './ai.ts';
import { modelFor } from './settings.ts';
import { exportText, backPlan, taiForms, newForm, type Item } from './brain.ts';
import { plan as marksPlan, essayToday, norm } from './essays.ts';
import { loadFiles, listDocs, getDoc, hex, today as taipeiToday } from './plus.ts';
import { keepMedia, lexicon } from './cards.ts';

/** The jobs and their models: tests are graded by Sonnet (his pick), written and essays corrected by Opus. */
// the defaults; Settings › AI can change the grader, the test writer and the essay marker (settings.ts, saved to his account)
export const GRADER = 'anthropic:claude-sonnet-5-5';
export const TEST_WRITER = 'anthropic:claude-sonnet-5-5'; // a test every day: Opus cost ~$0.25 a write (measured Nov 25), Sonnet half
export const ESSAY_MODEL = 'anthropic:claude-opus-5-5';
/** The last Thursday export the Mac merged (2026-11-19 15:33 in Taipei): the account takes over from there. */
const FIRST_SINCE = Date.parse('2026-11-19T07:33:00Z');

type Stmt = { bind(...v: unknown[]): Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> };
export type Env = {
  CBP: { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown[]> };
  FILES: { put(k: string, v: ArrayBuffer | string, o?: { httpMetadata?: { contentType?: string } }): Promise<unknown>; get(k: string): Promise<{ body: ReadableStream } | null>; list(o: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string }>; delete(k: string | string[]): Promise<unknown> };
  AI?: { run(model: string, input: Record<string, unknown>): Promise<{ image?: string }> };
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  ANTHROPIC_API_KEY?: string;
  TODOIST_TOKEN?: string;
};
/** His Chinese Brain items changed after a sync sequence number (worker.js asks his account). */
export type Brain = ((since: number) => Promise<{ seq: number; more: boolean; items: Item[] }>) & {
  get?: (words: string[]) => Promise<Record<string, BrainWord | null>>;
  put?: (records: BrainWord[]) => Promise<unknown>;
};
type BrainWord = { w: string; s: 'fresh' | 'learning' | 'known'; p?: string; g?: string; added: number; updated: number; hist: { t: number; s: string }[]; looks: number; ctx: unknown[] };

/** His capture inbox, Todoist's "Chinese" project: each task a word → the queue (source Todoist); a question → a
 *  one-line answer on his board (board/data `answers`); then the task is closed. Unclear ones stay open. Sonnet reads
 *  them, and only when there are any. */
const TODOIST = 'https://api.todoist.com/api/v1';
export async function drainTodoist(env: Env, files: E.Files, day: string, said: string[], dry = false) {
  if (!env.TODOIST_TOKEN) return dry ? (said.push('No TODOIST_TOKEN.'), []) : [];
  const get = async (path: string) => {
    const r = await fetch(TODOIST + path, { headers: { Authorization: `Bearer ${env.TODOIST_TOKEN}` } });
    if (!r.ok) throw new Error(`Todoist ${r.status}`);
    return (await r.json()) as { results: Record<string, unknown>[]; next_cursor: string | null };
  };
  const projects = (await get('/projects?limit=200')).results;
  const p = projects.find((x) => /^chinese$|中文/i.test(String(x.name).trim()));
  if (!p) return said.push('! Todoist: no project named Chinese'), [];
  const tasks = (await get(`/tasks?project_id=${p.id}&limit=100`)).results;
  // a look only: what it would read, nothing called, nothing closed
  if (dry) return said.push(`Todoist: project "${String(p.name)}", ${tasks.length} open task(s)`, ...tasks.slice(0, 20).map((t) => `  ${String(t.content).slice(0, 80)}`)), [];
  if (!tasks.length) return [];
  const st = E.kwStatus(E.loadKw(files));
  const prompt = `Chris (learning Taiwanese Chinese, high A2) jots things into a Todoist list during his day. Read each and reply with only {"items": [{"id": string, "kind": "word" | "question" | "unclear", "word": string, "pinyin": string, "gloss": string, "lane": "Life" | "Taiwan", "answer": string}]}.
- word: a word or phrase he wants (in Chinese, or English he needed the Chinese for: give the Taiwan word). word in Traditional characters, pinyin with tone marks as said in Taiwan, gloss a few English words; lane Taiwan for slang, particles, idioms, else Life. Several words in one task: one item each, same id.
- question: something he asks (what does X mean, X vs Y, how do I say…): answer in one short line he can read on his board (Chinese words in Traditional characters, with pinyin), and give its word if it teaches one (else "").
- unclear: you can't tell what he meant; it stays in Todoist for him.

${tasks.map((t) => `${t.id}: ${String(t.content)}${t.description ? ` — ${String(t.description)}` : ''}`).join('\n')}`;
  const out = JSON.parse((await ai.text(env, GRADER, prompt, { effort: 'low', job: 'todoist' })).text.match(/\{[\s\S]*\}/)![0]) as { items: Record<string, string>[] };
  const words: [string, string][] = [], answers: { q: string; a: string; day: string }[] = [], done = new Set<string>();
  for (const it of out.items ?? []) {
    const t = tasks.find((x) => String(x.id) === String(it.id));
    if (!t || it.kind === 'unclear') continue;
    done.add(String(t.id));
    if (it.kind === 'question' && it.answer) answers.push({ q: String(t.content).slice(0, 200), a: it.answer.slice(0, 400), day });
    const w = E.key(String(it.word ?? ''));
    if (/^[\u3400-\u9fff]{1,8}$/.test(w) && st.get(w)?.[0] !== 'K') words.push([it.lane === 'Taiwan' ? 'Taiwan' : 'Life', `${w} · ${it.pinyin ?? ''} · ${String(it.gloss ?? '').replace(/·/g, ',')} · Todoist`]);
  }
  if (words.length) said.push('Todoist: ' + E.addWords(files, words, day).split('\n').join(' · '));
  for (const id of done) {
    const r = await fetch(`${TODOIST}/tasks/${id}/close`, { method: 'POST', headers: { Authorization: `Bearer ${env.TODOIST_TOKEN}` } });
    if (!r.ok) said.push(`! Todoist: couldn't close ${id} (${r.status})`);
  }
  said.push(`Todoist: ${done.size} of ${tasks.length} task(s) taken in${answers.length ? `, ${answers.length} answered on the board` : ''}`);
  return answers;
}

/** Chinese Brain two ways: what CBP changed (K or L from a test, an essay, a card, set_known) goes back to his account,
 *  so the extension and the Dashboard show the same. Per word the newer change wins: a change he made in the extension
 *  the same day or later stays (the merge already brought it here). Only words whose status changed since the last
 *  write-back are looked at. */
export async function writeBack(env: Env, brain: Brain, files: E.Files, day: string, now: number, said: string[], dry = false) {
  if (!brain.get || !brain.put) return;
  const from = (await meta(env, 'brain_back_day')) ?? E.plus(day, -2);
  const st = E.kwStatus(E.loadKw(files));
  // also every L inside its 14-day hold: if the extension marked it K, Plus's L goes back too (backPlan's `hold`)
  const holdFrom = E.plus(day, -14), hold = new Set([...st].filter(([, [s, d]]) => s === 'L' && E.cmp(d, holdFrom) >= 0).map(([w]) => w));
  const want = [...st].filter(([w, [s, d]]) => (s === 'K' || s === 'L') && (E.cmp(d, from) >= 0 || hold.has(w))).slice(0, 400);
  if (!want.length) return void (await setMeta(env, 'brain_back_day', day).run());
  // every 台/臺 form of each word: the extension keeps the dictionary's headword (臺北), Plus writes 台
  const forms = [...new Set(want.flatMap(([w]) => taiForms(w)))];
  const recs: Record<string, BrainWord | null> = {};
  for (let i = 0; i < forms.length; i += 400) Object.assign(recs, await brain.get(forms.slice(i, i + 400)));
  const lex = forms.length > want.length ? await lexicon(env as never).catch(() => null) : null;
  const plan = backPlan(want, recs, E.kwTimes(files), hold);
  const q = E.loadQueue(files);
  const out: BrainWord[] = plan.map(({ w, status, rec }) => {
    if (rec) return { ...rec, s: status, updated: now, hist: [...(rec.hist ?? []), { t: now, s: status }] };
    const e = q.find(w)[1] as { pinyin?: string; gloss?: string } | undefined;
    return { w: newForm(w, (f) => !!lex?.has(f)), s: status, ...(e?.pinyin ? { p: e.pinyin } : {}), ...(e?.gloss ? { g: e.gloss } : {}), added: now, updated: now, hist: [{ t: now, s: status }], looks: 0, ctx: [] };
  });
  if (dry) return void said.push(...out.map((x) => `${x.w} → ${x.s}${recs[x.w] ? ` (was ${recs[x.w]!.s}, set ${new Date(recs[x.w]!.updated).toISOString().slice(0, 10)})` : ' (new)'}`));
  if (out.length) {
    const r = (await brain.put(out)) as { fail?: { message: string } };
    if (r?.fail) throw new Error(r.fail.message);
    said.push(`Chinese Brain ← CBP: ${out.length} word(s) (${out.slice(0, 12).map((x) => `${x.w} ${x.s === 'known' ? 'K' : 'L'}`).join(', ')}${out.length > 12 ? ' …' : ''})`);
  }
  await setMeta(env, 'brain_back_day', day).run();
}

/** The files the merge of his Chinese Brain marks writes: the brain cursor moves only when none was refused. */
export const MERGE_FILES = [E.KW, E.KW_TIMES, E.LN];
export const cursorMayAdvance = (refused: string[]) => !refused.some((n) => MERGE_FILES.includes(n) || n.startsWith('imported/'));

const meta = async (env: Env, k: string) => (await env.CBP.prepare('SELECT v FROM meta WHERE k = ?').bind(k).first<{ v: string }>())?.v ?? null;
const setMeta = (env: Env, k: string, v: string) => env.CBP.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind(k, v);

// ---------- writing back ----------
/** The files that changed, written only where nobody else changed them since they were read (else reported). */
export async function saveFiles(env: Env, before: E.Files, after: E.Files, said: string[], refused: string[] = []) {
  const at = Date.now(), stmts: Stmt[] = [];
  const shas = new Map((await env.CBP.prepare('SELECT name, sha FROM files').all<{ name: string; sha: string }>()).results.map((r) => [r.name, r.sha]));
  for (const [name, text] of after) {
    const was = before.get(name);
    if (was === text) continue;
    if ((shas.get(name) ?? null) !== (was === undefined ? null : await hex(was))) {
      said.push(`! ${name} changed while the nightly ran: not written (runs again tomorrow)`);
      refused.push(name);
      continue;
    }
    if (was !== undefined) stmts.push(env.CBP.prepare('INSERT INTO history (col, id, data, at) VALUES (?, ?, ?, ?)').bind('file', name, was, at));
    stmts.push(env.CBP.prepare('INSERT INTO files (name, text, sha, updated) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET text = excluded.text, sha = excluded.sha, updated = excluded.updated').bind(name, text, await hex(text), at));
  }
  for (let i = 0; i < stmts.length; i += 40) await env.CBP.batch(stmts.slice(i, i + 40));
  return stmts.length;
}

/** One document set (or merged in), its replaced version kept in history. */
export async function putDoc(env: Env, col: string, id: string, data: Record<string, unknown>, op: 'set' | 'update' = 'set') {
  const row = await env.CBP.prepare('SELECT data, updated FROM docs WHERE col = ? AND id = ?').bind(col, id).first<{ data: string; updated: number }>();
  const next = op === 'update' && row ? { ...JSON.parse(row.data), ...data } : data;
  const text = JSON.stringify(next), at = Date.now();
  const stmts: Stmt[] = [];
  if (row) stmts.push(env.CBP.prepare('INSERT INTO history (col, id, data, at) SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM history WHERE col = ? AND id = ? AND at > ?)').bind(col, id, row.data, row.updated, col, id, at - 600_000));
  stmts.push(env.CBP.prepare('INSERT INTO docs (col, id, data, sha, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data, sha = excluded.sha, updated = excluded.updated').bind(col, id, text, await hex(text), at));
  await env.CBP.batch(stmts);
  return next;
}

// ---------- Claude's jobs ----------
const json = (t: string) => {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in the answer');
  return JSON.parse(m[0]);
};

/** An answer the test page couldn't grade (it was offline, the call failed): graded the same way here. */
async function gradeOne(env: Env, it: Record<string, unknown>, a: Record<string, unknown>) {
  const english = /english/i.test(String(a.ask ?? it.ask ?? ''));
  const p = `You grade one answer in Chris's Taiwan Mandarin speaking test. He is high A2 and answers by voice through speech-to-text.
Reply with only this JSON: {"result": "pass" | "partial" | "fail" | "none", "natural": string, "why": string}

Grade the target only: ${it.target}
What the answer must show: ${it.check}
A model answer: ${it.model}

- Ignore the characters the transcriber picked (在/再, 的/得, 他/她) and punctuation; grade words, word order and completeness.
- A slip that turns what he clearly meant into other characters: grade what he meant, and start why with "Likely meant …".
- pass: the target is used correctly and every part of the ask is answered. partial: the target is right but part of the ask is missing, or it is only half right. fail: the target is wrong, or missing where the situation required it. none: a synonym or paraphrase in place of the target, or a use where he couldn't have gone wrong.${it.hear ? `
- A listening item: repeating the word back from the line he heard without showing what it means is none.` : ''}
- natural: ${english ? 'the situation asks for English: a plain-English version of what the line says.' : 'how a Taiwanese friend would say what he meant, one short line, Traditional characters, Chinese punctuation.'}
- why: one or two short plain-English lines about the target; empty for a clean pass.

The situation: ${a.ask ?? it.ask ?? ''}${it.hear ? `\nThe line he heard: ${it.hear}` : ''}${it.read ? `\nThe line he read: ${it.read}` : ''}
His answer: ${a.answer}`;
  const out = json((await ai.text(env, await modelFor(env, 'grade-model'), p, { effort: 'medium', job: 'grading' })).text);
  const r = String(out.result ?? '').toLowerCase();
  if (!E.RESULTS.includes(r)) throw new Error('no result');
  return { result: r, natural: String(out.natural ?? ''), why: String(out.why ?? '') };
}

/** What a test is written from: his rules (chinese.md Part 1, Tests and Voice), where he is (Part 3), the plan. */
function testPrompt(files: E.Files, today: string, plan: string, problems?: string[]) {
  const md = files.get(E.MEMORY) ?? '';
  const part = (a: string, b: string) => {
    const i = md.indexOf(a), j = b ? md.indexOf(b, i + 1) : -1;
    return i < 0 ? '' : md.slice(i, j < 0 ? undefined : j).trim();
  };
  const st = E.kwStatus(E.loadKw(files));
  const known = [...st].filter(([, [s]]) => s === 'K').map(([w]) => w).join(' ');
  const learning = [...st].filter(([, [s]]) => s === 'L').map(([w]) => w).join(' ');
  const rows = E.readLog(files).filter((r) => E.TEST_KINDS.includes(r.kind)).slice(-40).map((r) => `${r.date}\t${r.target}\t${r.result}\t${r.note}`).join('\n');
  const sp = E.sprintFile(files, today);
  const short = /A comeback after missed days/.test(plan);
  return `You write Chris's Chinese test for today. One comes every day and should take him about ten minutes; it goes straight onto his page and nobody checks it first, so follow every rule.

${part('### Tests', '### Voice')}

${part('### Voice', '### Hard rules')}

Today's test, item by item (code chose and counted these from the test log; write every numbered line, nothing more):
${plan}
${sp ? `\nThe sprint on now (${sp}):\n${files.get(sp)}\n` : ''}
Where he is now:
${part('## 3 · Where he is', '### What he knows')}

Words he knows (K) — build every prompt and model answer from these, plus the targets: ${known}
Words he is learning (L): ${learning}

His last test results (date, target, result, his answer → natural), so no scenario repeats one he already passed:
${rows}

${short ? 'This is a comeback test after days he missed: one item per retest in the plan, nothing else (no listening drill, no TOCFL item). Keep each ask simple.\n\n' : `One item per numbered plan line, no more, no fewer. A READ line is a reading item, never a situation he answers by speaking. How to write the LISTEN and TOCFL lines:
- A listening drill (kind "listen"). hear: a 2–3 line exchange between two people, each line on its own line starting with the speaker's voice letter and a colon ("f: …", "m: …", "g: …"; two different voices), everyday Taiwan speech at his level, built around one of the plan's words where it fits (target: that word, else "listening"). ask: an English question about what was said, which he answers in Chinese. Each drill has one echo trap and one paraphrase: the ask states or offers something that repeats a word he heard but is wrong, and the right answer is said in the exchange in other words than the ask uses (他說不行 in the exchange, "did he agree?" in the ask). check: what shows he understood; an answer that just repeats the echoed word is a fail. Never hint at the trap in the ask (no "careful", no second question pointing at it).
- A TOCFL Band B item (kind "tocfl"; his TOCFL is ${E.TOCFL_DATE}), in the exam's format: single choice, four options in Traditional characters, a question in Chinese as the exam asks it. Mix the types: a cloze (read: a short paragraph, 60–120 characters, with one blank written （　）; ask: 請選出最適合的詞), reading comprehension (read: a notice, message, ad or short article of 60–150 characters; ask: a question about it), listening (hear: a dialogue in the voice-letter format above, or one speaker's short passage; ask: the question; the choices are shown on screen). Write your own; never copy a real exam's question. The three wrong choices always include a near-word (a word like the right one in characters or meaning that is wrong here: 經過/經驗, 本來/原來) and an echo (repeats a word from the passage but says something it doesn't). Fields: choices (the four), key (the right one's index 0–3, varied), target (one of the plan's words when the item tests it, else "TOCFL reading" or "TOCFL listening"), model (the right choice), check (why it's right and what each trap is), explain (one short English line he sees after answering), label, kind.
`}Mix the targets so he has to choose: where two targets (or a target and a word he knows) compete for the same slot (又 / 再, 經過 / 路過, 過 / 了), put them in different situations next to each other, each one's situation making only one of them right. Vary the situations: a message someone sends him, a question a local asks, something he's standing in front of. One item per target, as far as they fit; keep at least one word-order item.

Each item is a JSON object:
- label: a short situation name he sees (never the target)
- kind: new, old, leak or burst, as the plan says (a learning word is old; the word that holds is old), or listen / tocfl as above
- target: the word, or the tracked item's name exactly as the plan writes it
- ask: the situation, in English, never naming the target, a synonym of it, or the sentence he has to say
- hear (optional): a line a local says, in Traditional characters, which the page speaks before he answers; it may hold the target. With it, voice: "m" for an 阿伯, "g" for an 阿嬤 or a young woman, "f" for an 阿姨
- read (optional): a written line he reads (a sign, a notice, a message), in characters; it may hold the target; the ask then says "Tell me in English what it says"
- model: a model answer in Traditional characters (in English when the ask asks for English)
- check: what a clean answer shows, and which near-misses are partial or none

Reply with only {"items": [...]}.${problems?.length ? `\n\nYour last try was refused: ${problems.join('; ')}. Fix exactly that.` : ''}`;
}

/** A line read by an Azure Taiwan voice: m an 阿伯 (YunJhe), g HsiaoYu, else an 阿姨 (HsiaoChen). */
const TEST_VOICES: Record<string, string> = { m: 'zh-TW-YunJheNeural', g: 'zh-TW-HsiaoYuNeural', f: 'zh-TW-HsiaoChenNeural' };
/** An exchange written "f: …\nm: …" is voiced line by line, each in its speaker's voice, as one recording (MP3 frames
 *  join end to end). */
export async function sayLines(env: Env, text: string, who?: unknown) {
  const parts = text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => /^([mfg])\s*[:：]\s*(.+)$/.exec(l));
  if (parts.length < 2 || parts.some((m) => !m)) return say(env, text, who);
  const bufs = [];
  for (const m of parts) bufs.push(new Uint8Array(await voice(env, m![2], m![1])));
  const all = new Uint8Array(bufs.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of bufs) (all.set(b, at), (at += b.length));
  return keepMedia(env as never, all.buffer, 'audio/mpeg');
}
export async function say(env: Env, text: string, who?: unknown) {
  return keepMedia(env as never, await voice(env, text, who), 'audio/mpeg');
}
async function voice(env: Env, text: string, who?: unknown) {
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) throw new Error('No voice key.');
  const x = text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
  const r = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3', 'User-Agent': 'chinese-brain-plus' },
    body: `<speak version="1.0" xml:lang="zh-TW"><voice name="${TEST_VOICES[String(who)] ?? TEST_VOICES.f}"><break time="300ms"/>${x}<break time="400ms"/></voice></speak>`,
  });
  if (!r.ok) throw new Error(`voice: ${r.status}`);
  return r.arrayBuffer();
}

/** A scene photo for a test item: {gen: "what it shows"} drawn by FLUX on Workers AI (free), or {commons: "File
 *  title.jpg"} a real photo from Wikimedia Commons. Image models garble Chinese, so a scene carries no text. */
export async function scene(env: Env, s: { gen?: string; commons?: string }) {
  if (s.commons) {
    const t = s.commons.replace(/^File:/, '').replace(/ /g, '_');
    const r = await fetch(`https://commons.wikimedia.org/w/index.php?title=Special:Redirect/file/${encodeURIComponent(t)}&width=1400`, { headers: { 'User-Agent': 'ChineseBrainPlus/1.0 (https://chinese.cristianbagrin.com; test photos)' } });
    if (!r.ok || !(r.headers.get('Content-Type') ?? '').startsWith('image/')) throw new Error(`commons: ${r.status}`);
    return keepMedia(env as never, await r.arrayBuffer(), r.headers.get('Content-Type')!);
  }
  if (!s.gen || !env.AI) throw new Error('scene: nothing to draw with');
  const out = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: s.gen + ' Candid smartphone photo, natural light, realistic, Taiwan. No legible text anywhere: signs, cups and papers are blank or blurred.', steps: 8 });
  if (!out.image) throw new Error('scene: no picture');
  const bin = atob(out.image), b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return keepMedia(env as never, b.buffer, 'image/jpeg');
}

/** Voices and photos for every item that needs them and doesn't have them yet. */
export async function media(env: Env, doc: { items?: Record<string, unknown>[] }, said: string[]) {
  for (const it of doc.items ?? []) {
    try {
      if (it.hear && !it.audio) it.audio = await sayLines(env, String(it.hear), it.voice);
      if (it.scene && !it.img) it.img = await scene(env, it.scene as { gen?: string; commons?: string });
    } catch (e) {
      said.push(`! ${it.label}: ${(e as Error).message}`);
    }
  }
}

/** Write the next test, check it the way words.py send did (twice at most), voice it. */
export async function writeTest(env: Env, files: E.Files, today: string, said: string[], o: { refresh?: { id: string; missed: number }; force?: boolean } = {}) {
  const short = (o.refresh?.missed ?? 0) >= E.COMEBACK_AFTER;
  const slots = E.planItems(files, today, { short });
  const plan = E.planText(files, today, slots, { short });
  let problems: string[] = [];
  for (let tries = 0; tries < 2; tries++) {
    const out = json((await ai.text(env, await modelFor(env, 'test-model'), testPrompt(files, today, plan, problems), { effort: 'medium', maxTokens: 24000, job: 'daily test' })).text);
    const doc: { items: Record<string, unknown>[]; id?: string; missed?: number } = { items: Array.isArray(out.items) ? out.items : [] };
    problems = E.testProblems(files, doc, !!o.refresh || !!o.force);
    // the plan left out or bent: refused once; on the last try a test still goes out, with what it missed reported
    const missed = E.planProblems(slots, doc);
    if (problems.length || (missed.length && tries === 0)) {
      problems = [...problems, ...missed];
      said.push(`(first try refused: ${problems.join('; ')})`);
      continue;
    }
    if (missed.length) said.push(`! the test leaves out of its plan: ${missed.join('; ')}`);
    // a test he didn't open is replaced in place: the same id, today's items, how many days it has waited
    if (o.refresh) Object.assign(doc, { id: o.refresh.id, missed: o.refresh.missed });
    const sent = E.sendTest(files, doc, today);
    await media(env, sent, said);
    said.push(`${o.refresh ? `refreshed test ${sent.id} (${o.refresh.missed} day(s) not opened${short ? ', a short comeback' : ''})` : `sent test ${sent.id}`}: ${sent.items.map((it) => it.label).join(' · ')}`);
    return sent;
  }
  said.push(`! test not sent: ${problems.join('; ')}`);
  return null;
}

// ---------- the night ----------
export async function nightly(env: Env, brain: Brain | null, o: { day?: string; noTest?: boolean } = {}) {
  const day = o.day ?? taipeiToday();
  const said: string[] = [];
  const before = await loadFiles(env as never);
  const files: E.Files = new Map(before);
  const boardData = (await getDoc(env as never, 'board', 'data')) ?? {};
  files.set(E.BOARD_DATA, JSON.stringify(boardData));
  before.set(E.BOARD_DATA, files.get(E.BOARD_DATA)!); // not a file of its own any more: the document is the truth

  // 1. Chinese Brain
  let seq = Number(await meta(env, 'brain_seq')) || 0;
  const since = Number(await meta(env, 'brain_at')) || FIRST_SINCE;
  const now = Date.now();
  if (brain) try {
    const items: Item[] = [];
    for (let more = true, n = 0; more && n < 60; n++) {
      const page = await brain(seq);
      items.push(...page.items);
      seq = page.seq;
      more = page.more;
    }
    const kw = E.kwStatus(E.loadKw(files));
    const ex = exportText(items, since, now, (w) => kw.get(E.key(w))?.[0] ?? null);
    if (ex.count) {
      let name = `imported/chinese-brain-${day}.tsv`;
      for (let n = 2; files.has(name); n++) name = `imported/chinese-brain-${day}-${n}.tsv`;
      files.set(name, ex.text);
      said.push(`Chinese Brain: ${ex.count} words`, ...E.merge(files, [ex.text], day).map((l) => '  ' + l));
    }
  } catch (e) {
    seq = Number(await meta(env, 'brain_seq')) || 0;
    said.push(`! Chinese Brain not read: ${(e as Error).message}`);
    brain = null;
  }

  // 2. the finished test
  const test = (await getDoc(env as never, 'board', 'test')) as Record<string, unknown> | null;
  let testUpdate: Record<string, unknown> | null = null;
  if (test?.done && !test.filed) {
    const r = E.ingest(files, test, day);
    said.push(...r.said);
    for (const { item, a } of r.open) {
      try {
        const g = await gradeOne(env, item, a);
        Object.assign(a, g);
        said.push(E.logRows(files, [{ date: String(a.at || test.done || day).slice(0, 10), target: String(item.target), kind: String(item.kind), result: g.result, note: `${a.answer}` + (g.natural && g.natural !== a.answer ? ` → ${g.natural}` : '') }]));
      } catch (e) {
        said.push(`! couldn't grade ${item.target}: ${(e as Error).message}`);
      }
    }
    if (r.graded) {
      E.appendLog(files, [r.graded]);
      said.push(`filed test ${test.id} (${r.graded.note})` + (test.title ? ' · a monthly test: its lessons go into monthly-test.md' : ''));
    }
    testUpdate = { items: test.items, filed: day };
  }

  // 2b. his Todoist capture inbox
  const answers = await drainTodoist(env, files, day, said).catch((e) => (said.push(`! Todoist not read: ${(e as Error).message}`), []));

  // 3. cards, the kit, the numbers
  const docs = async (col: string) => Object.fromEntries((await listDocs(env as never, col)).map((d) => [d.id, d.data]));
  said.push(...E.fileCards(files, await docs('cards'), await docs('notes'), day));
  // the card rules live in chinese.md: without it, the kit stays as it is
  const kit = files.has(E.MEMORY) ? E.kit(files, day) : null;

  // 4. a test, when one is due
  const rows = E.readLog(files);
  // a test every day; one he hasn't touched is refreshed in place (never two at once); one he's in the middle of stays
  const waiting = E.waitingTest(rows);
  const open = waiting && test?.id === waiting ? test : null;
  const touched = !!open && ((open.items as Record<string, unknown>[]) ?? []).some((it) => it.answer);
  let sent = null;
  const fail = (e: unknown) => (said.push(`! test not written: ${(e as Error).message}`), null);
  if (o.noTest) said.push(waiting ? `test ${waiting} is waiting` : 'no test (asked)');
  else if (!waiting) sent = await writeTest(env, files, day, said).catch(fail);
  // the monthly test (it has a title) stands in for the daily ones for three nights before a daily takes its place
  else if (open && !touched && open.sent !== day && !(open.title && E.cmp(E.plus(String(open.sent), 3), day) > 0)) sent = await writeTest(env, files, day, said, { refresh: { id: waiting, missed: Number(open.missed ?? 0) + 1 } }).catch(fail);
  else said.push(`test ${waiting} is half done: it stays`);

  // write it all
  files.delete(E.BOARD_DATA);
  before.delete(E.BOARD_DATA);
  const refused: string[] = [];
  const changed = await saveFiles(env, before, files, said, refused);
  if (testUpdate) await putDoc(env, 'board', 'test', testUpdate, 'update');
  if (sent) await putDoc(env, 'board', 'test', sent as never);
  if (kit) await putDoc(env, 'board', 'cardkit', kit as never);
  files.set(E.BOARD_DATA, JSON.stringify(boardData));
  const kept = ((boardData as { answers?: { day: string }[] }).answers ?? []).filter((x) => E.cmp(x.day, E.plus(day, -7)) > 0);
  await putDoc(env, 'board', 'data', { ...E.boardPayload(files, day), ...(answers.length || kept.length ? { answers: [...answers, ...kept].slice(0, 12) } : {}) } as never, 'update');
  // the marks count as read only once the merge is written: else the same ones come again tomorrow
  const merged = cursorMayAdvance(refused);
  if (brain && merged) await env.CBP.batch([setMeta(env, 'brain_seq', String(seq)), setMeta(env, 'brain_at', String(now))]);
  else if (brain) said.push('! Chinese Brain marks not saved: they are read again tomorrow');
  if (brain && !refused.includes(E.KW)) await writeBack(env, brain, files, day, now, said).catch((e) => said.push(`! Chinese Brain not written back: ${(e as Error).message}`));
  said.push(`${changed} file(s) written`);
  await snapshot(env, day).catch((e) => said.push(`! snapshot: ${(e as Error).message}`));
  await env.CBP.batch([setMeta(env, 'nightly', JSON.stringify({ day, at: Date.now(), said }))]);
  return said;
}

/** Everything in CBP's database (files, documents, the review collection) as one JSON file in R2, kept 60 days. */
async function snapshot(env: Env, day: string) {
  const all = async (sql: string) => (await env.CBP.prepare(sql).all<Record<string, unknown>>()).results;
  const body = JSON.stringify({ day, files: await all('SELECT name, text FROM files'), docs: await all('SELECT col, id, data FROM docs'), anki: await all('SELECT * FROM anki').catch(() => []) });
  await env.FILES.put(`snap/${day}.json`, body, { httpMetadata: { contentType: 'application/json' } });
  const old = (await env.FILES.list({ prefix: 'snap/' })).objects.filter((o) => o.key < `snap/${E.plus(day, -60)}`).map((o) => o.key);
  if (old.length) await env.FILES.delete(old);
}

