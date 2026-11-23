// Chinese Brain Plus, Stage 5: the tutor. A conversation in Taiwanese Chinese that needs this week's words: it sets
// the scene and waits; he answers first; then it challenges what he said (his leaks and Watch list in mind) and
// keeps the scene going. Words it gives him come marked ⟦…⟧, and the page turns any of them into a card with a tap.
import * as E from './engine.ts';
import * as ai from './ai.ts';
import { loadFiles, today } from './plus.ts';
import { modelOf, Bad } from './cards.ts';

type Env = Parameters<typeof loadFiles>[0] & Parameters<typeof ai.text>[0];

/** What the tutor knows about him: this week's words, his L words, his leaks, Watch list and Taiwan usage notes. */
export function context(files: E.Files, today: string) {
  const md = files.get(E.MEMORY) ?? '';
  const cut = (a: string, b: string) => {
    const i = md.indexOf(a), j = md.indexOf(b, i + 1);
    return i < 0 ? '' : md.slice(i, j < 0 ? undefined : j).trim();
  };
  const rows = E.readLog(files);
  const week = [...new Set(rows.filter((r) => r.kind === 'card' && E.cmp(r.date, E.plus(today, -7)) >= 0).map((r) => r.target))];
  const st = E.kwStatus(E.loadKw(files));
  const learning = [...st].filter(([, [s]]) => s === 'L').map(([w]) => w);
  const due = E.table(rows).filter((x) => E.cmp(x.due!, E.plus(today, 3)) <= 0).map((x) => `${x.name} (${x.form || '?'})`);
  return `This week's words (carded in the last 7 days): ${week.join(' ') || '(none yet: use his newest L words)'}
His other L words (learning): ${learning.slice(-80).join(' ')}
Tracked items due for a retest soon: ${due.join(' · ') || '(none)'}

${cut('### Leaks', '### What he knows')}`;
}

const RULES = `You are Chris's conversation partner and tutor for Taiwanese Chinese (Traditional characters, Taiwan usage: 好啊 not 好的, 計畫, 捷運, 機車). He is high A2, lives in Taipei, answers by voice through speech-to-text (ignore the characters the transcriber picked: 在/再, 的/得).

How a session goes:
1. You open with a scene from his real life in Taiwan (a friend's LINE message, a 阿姨 at a 小吃店, a classmate, his 柔術 coaches), set up so that answering naturally needs this week's words. In Chinese, two or three short lines, then one question to him. Never name the word you want, never hand him the sentence. A short English line under it only if the scene uses something above his level.
2. He answers first. Then, in this order and briefly:
   - If he used a target word: say so in one short line (or say what slipped).
   - Challenge what he said: the one or two fixes that matter most, his leaks first, each as his words → the natural version. A frame (兩碗 + noun) beats a grammar rule; no labels or titles before the point.
   - Push him a level up: ask a follow-up that makes him use the word again in a new way, or a near-synonym contrast (終於 vs 總算) a local would expect him to know.
3. Keep the scene alive turn after turn, steering it toward the words he hasn't used yet.

Mark a word or short set phrase you teach him (one to four characters, Traditional only, no pinyin) as ⟦word⟧, so he can card it with one tap: only words new to him or worth a card, never a whole sentence or a correction of one; at most three per turn.
Plain text only: no markdown, no bold, no headings, no bullets with asterisks. A correction is a line of its own: his words → the natural version.
Chinese punctuation in Chinese text, English punctuation in English text. Be direct, never a yes-man; few words. If he writes in English, he's asking you something: answer briefly, then back to the scene.`;

/** POST plus/tutor {messages: [{role, content}]} → the tutor's next turn. An empty conversation starts a scene. */
export async function reply(env: Env, body: { messages?: unknown; model?: unknown; focus?: unknown }) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  if (msgs.length > 80) throw new Bad('That conversation is long: start a new one.');
  const turns = msgs.map((m) => {
    const role = (m as { role?: unknown })?.role, content = String((m as { content?: unknown })?.content ?? '').slice(0, 4000);
    if (role !== 'user' && role !== 'assistant') throw new Bad('Bad message.');
    return { role: role as 'user' | 'assistant', content };
  });
  const files = await loadFiles(env);
  const focus = typeof body.focus === 'string' && body.focus.trim() ? `\nHe asked to practice: ${body.focus.trim().slice(0, 200)}` : '';
  const head = `${RULES}\n\n${context(files, today())}${focus}\n\nStart the scene now.`;
  const input = [{ role: 'user' as const, content: head }, ...turns];
  if (input[1] && input[1].role === 'user') input.splice(1, 0, { role: 'assistant', content: '(scene)' });
  const model = modelOf(body.model);
  const r = await ai.text(env, model, input, { effort: 'low' });
  return { text: r.text, model: model.split(':')[1] };
}
