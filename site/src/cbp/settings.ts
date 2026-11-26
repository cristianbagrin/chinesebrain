// Chinese Brain Plus: the settings saved to his account (CBP D1 `meta`, key `settings`), so the phone, the laptop and
// the night jobs agree. The board's Settings panel (site/src/cbp/kit/settings.ts) reads and writes them through
// GET/POST /api/plus/settings; choices that belong to one device (text size, sound, autoplay) stay in its localStorage.
//   values  { id: option }  the AI models per job, "next five written ahead", …   (ids below, defaults unchanged)
//   keys    { action: combo } shortcuts he rebound (site/src/cbp/kit/keys.ts); absent = the default key
type Stmt = { bind(...v: unknown[]): Stmt; first<T = Record<string, unknown>>(): Promise<T | null>; run(): Promise<unknown> };
type Env = { CBP: { prepare(sql: string): Stmt } };

const MODEL = ['haiku', 'sonnet', 'opus'];
/** Every account setting: its options and its default (the default is what the jobs did before it could be changed). */
export const SETTINGS: Record<string, { options: string[]; def: string }> = {
  'card-model': { options: MODEL, def: 'sonnet' },
  'card-ahead': { options: ['on', 'off'], def: 'on' },
  'pinyin-model': { options: MODEL, def: 'sonnet' },
  'idea-model': { options: MODEL, def: 'sonnet' },
  'draw-model': { options: ['both', 'mai', 'flux'], def: 'both' },
  'deeper-model': { options: MODEL, def: 'sonnet' },
  'test-model': { options: MODEL, def: 'sonnet' },
  'grade-model': { options: MODEL, def: 'sonnet' },
  'essay-model': { options: MODEL, def: 'opus' },
  'tutor-model': { options: MODEL, def: 'sonnet' },
  // Habit: the evening nudge's time (Taipei), every half hour 5 pm to 11:30 pm, or off (src/cbp/push.ts)
  nudge: { options: ['off', ...Array.from({ length: 14 }, (_, i) => `${17 + (i >> 1)}:${i % 2 ? '30' : '00'}`)], def: '21:00' },
  // (end Habit)
};
export type Saved = { values: Record<string, string>; keys: Record<string, string> };

export async function settings(env: Env): Promise<Saved> {
  let raw: Partial<Saved> = {};
  try {
    const r = await env.CBP.prepare('SELECT v FROM meta WHERE k = ?').bind('settings').first<{ v: string }>();
    raw = r ? JSON.parse(r.v) : {};
  } catch {}
  const values: Record<string, string> = {};
  for (const [id, s] of Object.entries(SETTINGS)) {
    const v = raw.values?.[id];
    values[id] = typeof v === 'string' && s.options.includes(v) ? v : s.def;
  }
  const keys: Record<string, string> = {};
  for (const [id, k] of Object.entries(raw.keys ?? {})) if (okKey(id, k)) keys[id] = k;
  return { values, keys };
}
const okKey = (id: unknown, k: unknown) => typeof id === 'string' && /^[\w.-]{1,40}$/.test(id) && typeof k === 'string' && k.length <= 40;

/** POST plus/settings {values?, keys?}: what changed, merged into what's saved. Unknown ids and options are ignored. */
export async function save(env: Env, body: { values?: unknown; keys?: unknown }) {
  const cur = await settings(env);
  const v = (body.values && typeof body.values === 'object' ? body.values : {}) as Record<string, unknown>;
  for (const [id, x] of Object.entries(v)) if (SETTINGS[id] && typeof x === 'string' && SETTINGS[id].options.includes(x)) cur.values[id] = x;
  if (body.keys && typeof body.keys === 'object') {
    // keys arrive whole: a binding taken back to its default is left out
    cur.keys = {};
    for (const [id, k] of Object.entries(body.keys as Record<string, unknown>)) if (okKey(id, k)) cur.keys[id] = k as string;
  }
  await env.CBP.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v').bind('settings', JSON.stringify(cur)).run();
  return cur;
}

/** The model a job runs on, as ai.text wants it ('anthropic:claude-opus-5-5'); the default if nothing is saved. */
export async function modelFor(env: Env, id: 'test-model' | 'grade-model' | 'essay-model' | 'tutor-model' | 'pinyin-model') {
  const v = (await settings(env)).values[id];
  return `anthropic:claude-${v}-5-5`;
}
