/* One voice at a time. Every sound in Plus that speaks (card audio, the review card's sounds, the Cards page's V, the test's
   listening, the tutor) goes through here: a new one stops the one playing at once, with no fade and no gap. The board's
   tiny clicks (sfx in core.js) are Web Audio and stay apart; they never speak.

     SOUND.play(src | src[], { rate?, onEnd? })   a recording, or several one after another; resolves true once it plays
     SOUND.speak(text, { rate?, onEnd? })         the browser's Taiwan voice, for text with no recording
     SOUND.stop()                                 silence
     SOUND.playing                                true while anything is playing
     SOUND.autoplay()                             true when card audio should play by itself (Settings › Card audio
                                                  plays by itself; off on a phone by default)

   One <audio> element is reused, so a phone that allowed it once (after a tap) keeps allowing it. */
declare const LAB: { get(id: string): string | null };

const el = typeof Audio === 'function' ? new Audio() : (null as unknown as HTMLAudioElement);
if (el) el.preload = 'auto';
let turn = 0, speaking = false;

function hush() {
  turn++;
  if (el) {
    el.onended = null;
    el.onerror = null;
    el.pause();
  }
  try {
    if (speaking) speechSynthesis.cancel();
  } catch {}
  speaking = false;
}

type Opts = { rate?: number; onEnd?: () => void };

async function play(src: string | string[], o: Opts = {}): Promise<boolean> {
  hush();
  const list = (Array.isArray(src) ? src : [src]).filter(Boolean);
  if (!el || !list.length) return false;
  const mine = turn;
  const next = async (): Promise<boolean> => {
    const s = list.shift();
    if (s === undefined || mine !== turn) {
      if (mine === turn) o.onEnd?.();
      return false;
    }
    el.src = s;
    el.playbackRate = o.rate ?? 1;
    el.onended = () => mine === turn && void next();
    el.onerror = () => mine === turn && void next();
    try {
      await el.play();
      return true;
    } catch {
      return false;
    }
  };
  return next();
}

function speak(text: string, o: Opts = {}): boolean {
  hush();
  try {
    if (!('speechSynthesis' in window) || !text) return false;
    const u = new SpeechSynthesisUtterance(text), vs = speechSynthesis.getVoices();
    const v = vs.find((x) => /zh[-_]TW/i.test(x.lang)) || vs.find((x) => /^zh/i.test(x.lang) && !/HK|yue/i.test(x.lang));
    if (v) (u.voice = v), (u.lang = v.lang);
    else u.lang = 'zh-TW';
    u.rate = o.rate ?? 1;
    const mine = turn;
    u.onend = () => {
      if (mine !== turn) return;
      speaking = false;
      o.onEnd?.();
    };
    speaking = true;
    speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}
// voices load late on some browsers: asking early makes the first one the Taiwan voice
try {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
} catch {}

export const SOUND = {
  play,
  speak,
  stop: hush,
  get playing() {
    return speaking || (!!el && !el.paused && !el.ended);
  },
  autoplay: () => LAB.get('autoplay') !== 'off',
};
