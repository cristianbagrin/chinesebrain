// Chinese Brain Plus, Stage 3: what the card window on /plus asks the server for.
//   sample    Claude writes the study card (and answers questions about it, and grades tests): Sonnet 5.5, his pick
//   photos    for the review card's pictures: Wikimedia Commons, straight from its servers
//   drawings  two drawings in his flashcard style (prompts by Claude, kept with them in docs `pics`)
//   grab      a picture from the web, kept in R2;  pinyin  the sentence's reading, done for him
//   voice     the sentence read by an Azure Taiwan voice (YunJhe or HsiaoChen, picked at random)
//   media     pictures and audio kept in R2 under an unguessable name, so <img> and <audio> can load them
//   clean     once a day (worker.js scheduled), like Anki's Check Media: what nothing points to any more goes
import * as ai from './ai.ts';
import { hex } from './plus.ts';
import * as PY from './pinyin.ts';

type R2Object = { body: ReadableStream; httpMetadata?: { contentType?: string } };
type Stmt = { bind(...v: unknown[]): Stmt; first<T>(): Promise<T | null>; run(): Promise<unknown>; all<T>(): Promise<{ results: T[] }> };
type Env = {
  CBP: {
    prepare(sql: string): Stmt;
    batch?(s: Stmt[]): Promise<unknown[]>;
  };
  FILES: {
    put(k: string, v: ArrayBuffer | ReadableStream, o?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
    get(k: string): Promise<R2Object | null>;
    list(o: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string; uploaded: Date; size: number }[]; truncated: boolean; cursor?: string }>;
    delete(k: string | string[]): Promise<unknown>;
  };
  CBP_PUSH_KEY?: string;
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  ANTHROPIC_API_KEY?: string;
  POLLINATIONS_KEY?: string;
  ASSETS?: { fetch(r: Request | string): Promise<Response> };
  IMAGES?: Images;
};
type ImgOut = { response(): Response; contentType(): string };
type Images = {
  info(s: ReadableStream): Promise<{ width?: number; height?: number; format?: string }>;
  input(s: ReadableStream): { transform(o: Record<string, unknown>): { output(o: Record<string, unknown>): Promise<ImgOut> } };
};

export const CARD_MODEL = 'anthropic:claude-sonnet-5-5';
/** The two that draw a picture (his picks in the taste test): FLUX.2 Flex writes Chinese correctly. */
export const DRAWERS = ['pollinations:microsoft/mai-image-2.7', 'pollinations:black-forest-labs/flux.2-flex'];
/** Who's asking, as Wikimedia asks programs to say. */
const BOT = 'ChineseBrainPlus/1.0 (https://chinese.cristianbagrin.com; flashcard pictures)';

export class Bad extends Error {}

// ---------- Claude ----------
/** The board's `sample`: one prompt, or the turns of a conversation. */
/** The models his Settings may pick for each job (cards, pinyin, picture ideas, five minutes on a word); anything
 *  else gets the default, Sonnet. */
const CARD_MODELS = new Set(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']);
export const modelOf = (m: unknown) => (typeof m === 'string' && CARD_MODELS.has(m) ? `anthropic:${m}` : CARD_MODEL);
export async function sample(env: Env, body: { input?: unknown; effort?: unknown; model?: unknown }) {
  const input = body.input;
  let msgs: ai.Input;
  if (typeof input === 'string') msgs = input;
  else if (Array.isArray(input) && input.length && input.length <= 60) {
    msgs = input.map((m) => {
      const role = (m as { role?: unknown })?.role, content = (m as { content?: unknown })?.content;
      if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') throw new Bad('Bad message.');
      return { role, content };
    });
  } else throw new Bad('Nothing to send.');
  if (JSON.stringify(msgs).length > 400_000) throw new Bad('Too long.');
  const effort = body.effort === 'low' || body.effort === 'high' ? body.effort : 'medium';
  const model = modelOf(body.model);
  const r = await ai.text(env, model, msgs, { effort, job: 'board (cards, grading)' });
  return { text: r.text, model: model.split(':')[1] };
}

// ---------- media ----------
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav' };
export const mediaUrl = (name: string) => `/api/plus/media/${name}`;
/** Keep bytes; returns the address they're served at. */
export async function keepMedia(env: Env, bytes: ArrayBuffer, type: string) {
  const t = type.split(';')[0].trim().toLowerCase();
  if (!EXT[t]) throw new Bad('Not a picture or a sound.');
  if (bytes.byteLength > 12_000_000) throw new Bad('Too big.');
  const small = await shrink(env, bytes, t);
  if (small) bytes = small;
  const k = small ? 'image/webp' : t;
  const name = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('') + '.' + EXT[k];
  await env.FILES.put(`m/${name}`, bytes, { httpMetadata: { contentType: k } });
  return mediaUrl(name);
}

// ---------- pictures kept small ----------
// A card shows a picture a few hundred pixels wide, yet drawings come back as 1024px PNGs (~1 MB) and imported
// Anki pictures run to 2–3 MB: every one is downloaded and kept on the phone. Anything over SMALL is redrawn as a
// WebP no wider or taller than EDGE (Cloudflare Images, free up to 5,000 a month); if that fails, or doesn't save
// much, the original is kept as it was.
const SMALL = 200_000, EDGE = 1024;
const SHRINKABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);
export async function shrink(env: Env, bytes: ArrayBuffer, type: string): Promise<ArrayBuffer | null> {
  if (!env.IMAGES || !SHRINKABLE.has(type) || bytes.byteLength <= SMALL) return null;
  try {
    const out = await env.IMAGES.input(new Blob([bytes]).stream())
      .transform({ width: EDGE, height: EDGE, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 80 });
    const b = await out.response().arrayBuffer();
    return b.byteLength > 0 && b.byteLength < bytes.byteLength * 0.8 ? b : null;
  } catch (e) {
    console.error('shrink', e);
    return null;
  }
}
/** POST push/shrink (?dry=1, ?limit=N): the big pictures already kept, made small in place. The name (and so every
 *  card pointing at it) stays; the bytes become a WebP and its type says so. The original goes to `orig/` first, which
 *  the daily sweep never touches, so any of them can be put back. */
export async function shrinkKept(env: Env, o: { dry?: boolean; limit?: number } = {}) {
  const limit = o.limit ?? 60;
  const big: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const l = await env.FILES.list({ prefix: 'm/', cursor, limit: 1000 });
    for (const x of l.objects) if (x.size > SMALL && /\.(jpe?g|png|webp)$/i.test(x.key)) big.push({ key: x.key, size: x.size });
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  if (o.dry) return { big: big.length, mb: Math.round(big.reduce((s, x) => s + x.size, 0) / 1e5) / 10 };
  let done = 0, before = 0, after = 0, kept = 0;
  for (const x of big.slice(0, limit)) {
    const obj = await env.FILES.get(x.key);
    if (!obj) continue;
    const type = obj.httpMetadata?.contentType ?? '';
    const bytes = await new Response(obj.body).arrayBuffer();
    const small = await shrink(env, bytes, type);
    if (!small) { kept++; continue; }
    await env.FILES.put(`orig/${x.key.slice(2)}`, bytes, { httpMetadata: { contentType: type } });
    await env.FILES.put(x.key, small, { httpMetadata: { contentType: 'image/webp' } });
    done++; before += bytes.byteLength; after += small.byteLength;
  }
  return { big: big.length, done, kept, left: Math.max(0, big.length - limit), mbBefore: Math.round(before / 1e5) / 10, mbAfter: Math.round(after / 1e5) / 10 };
}
export async function media(env: Env, name: string) {
  if (!/^[0-9a-f]{32}\.(jpg|png|webp|gif|svg|mp3|m4a|ogg|wav)$/.test(name)) return new Response('Not found', { status: 404 });
  const o = await env.FILES.get(`m/${name}`);
  if (!o) return new Response('Not found', { status: 404 });
  return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'X-Content-Type-Options': 'nosniff' } });
}

// ---------- cleaning up, like Anki's Check Media ----------
const DAY = 864e5;
/** Picture plans of words not touched for 30 days go (their drawings with them, unless a note uses one); then every
 *  file in R2 that no document, file or kept old version names, and that is over 14 days old (a picture in a draft not
 *  added yet keeps that long), is deleted. */
export async function clean(env: Env, now = Date.now()) {
  const plans = await env.CBP.prepare("DELETE FROM docs WHERE col = 'pics' AND updated < ?").bind(now - 30 * DAY).run();
  const used = new Set<string>();
  const scan = (t: string) => {
    for (const m of String(t).matchAll(/\/api\/plus\/media\/([0-9a-f]{32}\.[a-z0-9]+)/g)) used.add(m[1]);
  };
  for (const [sql] of [["SELECT data AS t FROM docs WHERE data LIKE '%/api/plus/media/%'"], ["SELECT data AS t FROM history WHERE data LIKE '%/api/plus/media/%'"], ["SELECT text AS t FROM files WHERE text LIKE '%/api/plus/media/%'"], ["SELECT data AS t FROM anki WHERE data LIKE '%/api/plus/media/%'"], ['SELECT url AS t FROM anki_media']]) {
    const { results } = await env.CBP.prepare(sql).all<{ t: string }>();
    results.forEach((r) => scan(r.t));
  }
  const gone: string[] = [];
  let cursor: string | undefined, seen = 0;
  do {
    const l = await env.FILES.list({ prefix: 'm/', cursor, limit: 1000 });
    for (const o of l.objects) {
      seen++;
      if (!used.has(o.key.slice(2)) && now - new Date(o.uploaded).getTime() > 14 * DAY) gone.push(o.key);
    }
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  for (let i = 0; i < gone.length; i += 1000) await env.FILES.delete(gone.slice(i, i + 1000));
  return { files: seen, used: used.size, deleted: gone.length, plans: (plans as { meta?: { changes?: number } })?.meta?.changes ?? 0 };
}

// ---------- pictures from the web ----------
/** A picture from anywhere on the web (one he pasted, a photo he picked), kept for good: the web's copy can vanish,
 *  and the page shows only its own site's pictures (and Commons'). */
export async function grab(env: Env, b: { url?: unknown }) {
  const u = String(b.url ?? '');
  if (!/^https:\/\/[^/]+\//.test(u) || /^https:\/\/(localhost|127\.|10\.|192\.168\.|\[)/.test(u)) throw new Bad('Not a picture address.');
  const r = await fetch(u, { headers: { 'User-Agent': BOT, Accept: 'image/*' }, redirect: 'follow' });
  const type = (r.headers.get('Content-Type') ?? '').split(';')[0];
  if (!r.ok || !type.startsWith('image/')) throw new Bad('No picture there.');
  const bytes = await r.arrayBuffer();
  return { url: await keepMedia(env, bytes, type) };
}

/** Wikimedia Commons photos (its API is open to programs; Bing and DuckDuckGo turn a server away). Commons serves
 *  thumbnails only at its standard widths: 330 for the choices, 960 for the card. The page loads them from Commons. */
export async function photos(env: Env, b: { q?: unknown; offset?: unknown }) {
  const q = String(b.q ?? '').trim().slice(0, 120);
  if (!q) throw new Bad('Nothing to look for.');
  const off = Math.max(0, Math.min(200, Number(b.offset) || 0));
  const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent('filetype:bitmap ' + q)}&gsrnamespace=6&gsrlimit=16&gsroffset=${off}&prop=imageinfo&iiprop=url|mime&iiurlwidth=960`;
  const r = await fetch(u, { headers: { 'User-Agent': BOT } });
  if (!r.ok) throw new Error(`photos: ${r.status}`);
  const d = (await r.json()) as { query?: { pages?: Record<string, { index: number; imageinfo?: { thumburl?: string; mime?: string }[] }> } };
  const list = Object.values(d.query?.pages ?? {})
    .sort((x, y) => x.index - y.index)
    .map((p) => p.imageinfo?.[0])
    .filter((i): i is { thumburl: string; mime: string } => !!i?.thumburl && /^image\/(jpeg|png|webp)/.test(i.mime ?? '') && /\/960px-/.test(i.thumburl))
    .map((i) => i.thumburl.split('?')[0])
    .map((u) => ({ full: u, thumb: u.replace('/960px-', '/330px-') }));
  return { photos: list.slice(0, 12), next: off + 16 };
}

// ---------- drawings ----------
// His flashcard skill (life/chinese/reference/SKILL-taiwanese-mandarin-flashcards.md), the parts a prompt needs,
// with his notes from the taste test: the meaning must land at a glance, funny and over the top beats polite.
const PICTURE_RULES = `How his flashcard pictures work (his rules):
- Anchor the meaning in natural Taiwan usage and visually rule out the closest synonym or confusion trap. Abstract evaluations and trade-offs: show both sides (a heavy pale boulder of struggle outweighed on a scale by one tiny glowing reward). Relational, identity or spatial nouns: the reference person or place in quiet pale washes, ONLY the target in the richest, warmest color. Mutual vs one-way actions: partners combining strengths on one shared action. Transitive verbs and restrictions: clear physical contact, barriers or force vectors, never gesturing into empty space.
- One soft, harmonious palette of 3 to 5 related hues across the whole image; secondary people and context in its quieter, paler tones; the thing that carries the meaning in its deepest, most saturated tone. Never a mostly black-and-white image with one bright accent.
- Default style: tactile Taiwanese picture book (台灣繪本), chunky wax-crayon and oil-pastel edges, thick gouache brushwork, visible warm paper grain, flat hand-drawn look, never 3D or glossy. For chaos, noise, waste or absurd overreactions: deadpan vs hyper-detailed gag-anime ink with brush-pen energy lines and watercolor washes. For quiet or poetic moods and places: fine crosshatched ink under luminous watercolor.
- Pure solid white (#FFFFFF) background, at least 65% empty white space, no clutter, one unified scene, no split panels. Simple hands (at most two items per person), big readable faces that match the word's mood.
- Funny and over the top beats polite; the meaning must land at a glance.
- Words only when they genuinely help an abstract word: a short Traditional-Chinese speech bubble or sign. Never the target word itself, no captions or labels. Otherwise say "no text".`;

type Plan = { word: string; query: string; prompts: string[]; drawn?: string[]; tried?: number };

function planPrompt(word: string, meaning: string, sentence: string) {
  return `Chris is making a flashcard for the Taiwan Mandarin word ${word}${meaning ? ` (${meaning})` : ''}${sentence ? `, in the sentence ${sentence}` : ''}. Its picture: two drawings, and photos from Wikimedia Commons.

query: English search words for Wikimedia Commons photos that show it at a glance, with a word that rules out the wrong sense ("apple fruit", not "apple"); add Taiwan when Taiwan's version looks different (a Taiwan night market, a Taiwan scooter). For an abstract word, the photo scene that shows it best.
prompts: two picture prompts, two different takes on the word, each written for an image model, following his rules:

${PICTURE_RULES}

Reply with only this JSON: {"query": string, "prompts": [string, string]}`;
}

const picsId = (word: string) => 'w' + [...word].map((c) => c.codePointAt(0)!.toString(16)).join('-');
async function loadPlan(env: Env, word: string) {
  const r = await env.CBP.prepare("SELECT data FROM docs WHERE col = 'pics' AND id = ?").bind(picsId(word)).first<{ data: string }>();
  const p = r ? (JSON.parse(r.data) as Plan) : null;
  return p?.prompts?.length ? p : null;
}
async function savePlan(env: Env, p: Plan) {
  const data = JSON.stringify(p);
  await env.CBP.prepare("INSERT INTO docs (col, id, data, sha, updated) VALUES ('pics', ?, ?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET data = excluded.data, sha = excluded.sha, updated = excluded.updated")
    .bind(picsId(p.word), data, await hex(data), Date.now()).run();
}

/** POST plus/drawings {word, meaning, sentence, again}: two drawings in his flashcard style (kept, so a card opened
 *  again shows the same ones; `again` draws two more), and Claude's search words for better photos. */
export async function drawings(env: Env, b: { word?: unknown; meaning?: unknown; sentence?: unknown; again?: unknown; model?: unknown; drawer?: unknown }) {
  const word = String(b.word ?? '').trim().slice(0, 30);
  if (!word) throw new Bad('No word.');
  let p = await loadPlan(env, word);
  if (!p) {
    const r = await ai.text(env, modelOf(b.model), planPrompt(word, String(b.meaning ?? '').slice(0, 200), String(b.sentence ?? '').slice(0, 300)), { effort: 'low', job: 'pictures' });
    const j = JSON.parse(/\{[\s\S]*\}/.exec(r.text)?.[0] ?? '{}');
    const prompts = (Array.isArray(j.prompts) ? j.prompts : []).map(String).filter(Boolean).slice(0, 2);
    p = { word, query: String(j.query || ''), prompts: prompts.length ? prompts : [word] };
    await savePlan(env, p);
  }
  const errs: string[] = [];
  // a plain open draws only the first time; after a failed try it waits a day (More drawings, `again`, always draws)
  if (b.again || (!p.drawn?.length && !(p.tried && Date.now() - p.tried < 864e5))) {
    p.tried = Date.now();
    const made = await Promise.all(
      // who draws: both models (one picture each), or two from the one he picked
      (b.drawer === 'mai' ? [DRAWERS[0], DRAWERS[0]] : b.drawer === 'flux' ? [DRAWERS[1], DRAWERS[1]] : DRAWERS).map(async (m, i) => {
        try {
          const im = await ai.image(env, m, p!.prompts[i % p!.prompts.length]);
          return await keepMedia(env, im.bytes, im.type);
        } catch (e) {
          errs.push(String((e as Error).message).slice(0, 200));
          return null;
        }
      }),
    );
    p.drawn = [...made.filter((x): x is string => !!x), ...(p.drawn ?? [])].slice(0, 12);
    await savePlan(env, p);
  }
  return { drawn: p.drawn ?? [], query: p.query, errs };
}

// ---------- pinyin ----------
/** The lexicon (site/public/plus/pinyin.txt, from the site's own files), kept between requests. */
let LEX: Promise<PY.Lex> | null = null;
export function lexicon(env: Env) {
  if (!env.ASSETS) return Promise.reject(new Error('no lexicon'));
  return (LEX ??= env.ASSETS.fetch('https://plus.local/plus/pinyin.txt')
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`lexicon ${r.status}`))))
    .then(PY.parseLex)
    .catch((e) => ((LEX = null), Promise.reject(e))));
}
/** POST plus/pinyin {text}: the sentence's Taiwan reading, for the Pinyin field he never has to see. Code reads it
 *  (pinyin.ts: the dictionary's Taiwan readings, 不 and 一's tones); Claude only checks a sentence holding a character
 *  no rule can read for sure (數, 倒, 傳…), starting from the code's reading. */
export async function pinyin(env: Env, b: { text?: unknown; model?: unknown }) {
  const text = String(b.text ?? '').trim().slice(0, 600);
  if (!text) return { pinyin: '' };
  let draft = '';
  try {
    const lex = await lexicon(env);
    draft = PY.sentence(lex, text);
    if (!PY.unsure(lex, text)) return { pinyin: draft, by: 'code' };
  } catch (e) {
    console.error(e);
  }
  const r = await ai.text(env, modelOf(b.model), `Write the pinyin of this Traditional Chinese text with tone marks, as a Taiwanese speaker says it: Taiwan readings (垃圾 lèsè, 星期 xīngqí, 期 qí, 研究 yánjiù, 誰 shéi), 不 and 一 with their changed tones (bú shì, yí gè, yì tiān), no third-tone sandhi written, neutral tone only where Taiwan dictionaries have it (的 de, 了 le, 嗎 ma, 們 men) and full tones where Taiwan keeps them (東西 dōngxī, 朋友 péngyǒu, 時候 shíhòu, 知道 zhīdào), one pinyin syllable per character. Join the syllables of a dictionary word and keep particles and measure words apart (Wǒmen míngtiān dā huǒchē), capitalize the first word of each sentence, keep the punctuation as English punctuation, and keep the line breaks and any "- " at the start of a line. Reply with the pinyin only.${draft ? `\n\nA dictionary's reading to start from (fix only what's wrong, usually a character that reads two ways): ${draft}` : ''}

${text}`, { effort: 'low', job: 'pinyin' });
  return { pinyin: r.text.trim(), by: 'claude' };
}

// ---------- the voice ----------
const VOICES = ['zh-TW-YunJheNeural', 'zh-TW-HsiaoChenNeural'];
const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
/** POST plus/voice {text}: the sentence read aloud; an exchange (one line per speaker) gets both voices. */
export async function voice(env: Env, b: { text?: unknown }) {
  if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) throw new Bad('No voice key yet.');
  const lines = String(b.text ?? '').split('\n').map((l) => l.replace(/^[-–]\s*/, '').trim()).filter(Boolean).slice(0, 8);
  if (!lines.length || lines.join('').length > 600) throw new Bad('Nothing to read.');
  const first = Math.floor(Math.random() * 2);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">${lines
    .map((l, i) => `<voice name="${VOICES[(first + i) % 2]}">${xml(l)}${i < lines.length - 1 ? '<break time="500ms"/>' : ''}</voice>`)
    .join('')}</speak>`;
  const r = await fetch(`https://${env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'chinese-brain-plus' },
    body: ssml,
  });
  if (!r.ok) throw new Error(`voice: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return { url: await keepMedia(env, await r.arrayBuffer(), 'audio/mpeg'), voice: VOICES[first].replace(/^zh-TW-|Neural$/g, '') };
}

// ---------- the card's audio, made on the server when a note is saved ----------
/** The sentence of a note as lines to read aloud: no markup, no "- " at the start of a line. */
export const voiceLines = (html: string) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.replace(/^\s*[-–]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
/** What decides whether a recording still fits the sentence: its characters, nothing else. */
const sameSay = (a: string, b: string) => voiceLines(a).replace(/[\s，。！？、,.!?:;：；「」"]/g, '') === voiceLines(b).replace(/[\s，。！？、,.!?:;：；「」"]/g, '');
/** A note about to be saved (db notes/<id>) gets its audio here, whatever device saved it: kept when the sentence
 *  is the one the audio was made for (the note's own, or the version saved before), made anew when it changed.
 *  A voice that fails leaves the note as it came: the save never fails over its audio. */
export async function voiced(env: Env, id: string, note: Record<string, unknown> | null) {
  if (!note || typeof note !== 'object') return note;
  const text = voiceLines(String(note.chinese ?? ''));
  if (!text) return { ...note, audio: '', audioFor: '' };
  if (note.audio && typeof note.audioFor === 'string' && sameSay(note.audioFor, text)) return note;
  const row = await env.CBP.prepare("SELECT data FROM docs WHERE col = 'notes' AND id = ?").bind(id).first<{ data: string }>();
  const prev = row ? (JSON.parse(row.data) as Record<string, unknown>) : null;
  if (prev?.audio && sameSay(typeof prev.audioFor === 'string' ? prev.audioFor : String(prev.chinese ?? ''), text)) return { ...note, audio: prev.audio, audioFor: text };
  try {
    const v = await voice(env, { text });
    return { ...note, audio: v.url, audioFor: text };
  } catch (e) {
    console.error(e);
    return note;
  }
}

// ---------- the word's mark: <mark>, not <u> (2026-11-26) ----------
/** His cards marked the word with <u> (Anki's underline, which his note types restyled: green, and the blank on the
 *  sentence card). From now on the mark is <mark> and <u> is a plain underline. This moves everything over once:
 *  every note in his collection (bumped, so every device syncs it), the note types' styling, and the Cards page's
 *  notes. Safe to run again: what's moved already is left alone. ?dry=1 counts without writing. */
export const toMark = (h: string) => String(h ?? '').replace(/<u>/g, '<mark>').replace(/<\/u>/g, '</mark>');
/** A note type's styling: every rule for u becomes the same rule for mark; mark gets no highlighter of its own. */
export function markCss(css: string) {
  if (/\bmark\b/.test(css)) return css;
  const moved = css.replace(/(^|[\s,>+~}])u(?=\s*[{,:.[\s])/g, '$1mark');
  return moved === css ? css : moved + '\n\nmark { background: none; }\n';
}
export async function markWord(env: Env, dry = false) {
  const now = Date.now();
  let usn = now;
  const stmts: Stmt[] = [];
  const out = { notes: 0, types: 0, cardsPage: 0 };
  const { results: notes } = await env.CBP.prepare("SELECT id, data FROM anki WHERE kind = 'note' AND data LIKE '%<u>%'").all<{ id: string; data: string }>();
  for (const r of notes) {
    const n = JSON.parse(r.data);
    n.flds = (n.flds ?? []).map((f: string) => toMark(f));
    n.mod = Math.floor(now / 1000);
    out.notes++;
    stmts.push(env.CBP.prepare('UPDATE anki SET data = ?, mod = ?, usn = ? WHERE kind = ? AND id = ?').bind(JSON.stringify(n), now, usn++, 'note', r.id));
  }
  const { results: types } = await env.CBP.prepare("SELECT id, data FROM anki WHERE kind = 'notetype' AND data IS NOT NULL").all<{ id: string; data: string }>();
  for (const r of types) {
    const t = JSON.parse(r.data), css = markCss(String(t.css ?? ''));
    if (css === t.css) continue;
    t.css = css;
    t.mod = Math.floor(now / 1000);
    out.types++;
    stmts.push(env.CBP.prepare('UPDATE anki SET data = ?, mod = ?, usn = ? WHERE kind = ? AND id = ?').bind(JSON.stringify(t), now, usn++, 'notetype', r.id));
  }
  const { results: docs } = await env.CBP.prepare("SELECT id, data FROM docs WHERE col = 'notes' AND data LIKE '%<u>%'").all<{ id: string; data: string }>();
  for (const r of docs) {
    const d = JSON.parse(r.data);
    for (const k of ['chinese', 'word', 'notes', 'mnemonic', 'picture']) if (typeof d[k] === 'string') d[k] = toMark(d[k]);
    const data = JSON.stringify(d);
    out.cardsPage++;
    stmts.push(env.CBP.prepare("UPDATE docs SET data = ?, sha = ?, updated = ? WHERE col = 'notes' AND id = ?").bind(data, await hex(data), now, r.id));
  }
  if (!dry && env.CBP.batch) for (let i = 0; i < stmts.length; i += 100) await env.CBP.batch(stmts.slice(i, i + 100));
  return { dry, ...out };
}
