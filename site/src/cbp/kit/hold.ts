/* Press and hold, built once. A tap does the button's usual thing; holding it (500 ms) does the other thing. While it's
   held the button fills from the left, and that fill is the only explanation there is (no hint, no tooltip). Reduced
   motion: the fill fades in where it stands instead of sweeping across.

     const off = HOLD(button, { tap: () => add(), hold: () => addAndStay(), ms: 500 });
     off();   // takes it off the button again

   Works with a finger, a mouse (left button) and the keyboard (Space or Enter held). A tap fires on release, as a
   click; the click that follows a hold is swallowed. Moving the finger more than 10px (a scroll) cancels. The button
   gets the class `hold` (the fill, kit.css) and `holding` while held, `held` for a moment once the hold lands. */
const R = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function HOLD(btn: HTMLElement, o: { tap?: (e: Event) => void; hold: (e: Event) => void; ms?: number }) {
  const ms = o.ms ?? 500;
  btn.classList.add('hold');
  btn.style.setProperty('--hold-ms', `${ms}ms`);
  let t = 0, x = 0, y = 0, fired = false, by: 'ptr' | 'key' | '' = '';
  const reset = () => {
    clearTimeout(t);
    t = 0;
    by = '';
    btn.classList.remove('holding');
  };
  const start = (e: Event, how: 'ptr' | 'key') => {
    if (t) return;
    fired = false;
    by = how;
    btn.classList.toggle('hold-still', R());
    // a frame later, so the fill's transition starts from empty
    requestAnimationFrame(() => by && btn.classList.add('holding'));
    t = window.setTimeout(() => {
      t = 0;
      fired = true;
      btn.classList.remove('holding');
      btn.classList.add('held');
      setTimeout(() => btn.classList.remove('held'), 260);
      try {
        navigator.vibrate?.(10);
      } catch {}
      o.hold(e);
    }, ms);
  };
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || (btn as HTMLButtonElement).disabled) return;
    x = e.clientX;
    y = e.clientY;
    start(e, 'ptr');
  };
  const move = (e: PointerEvent) => {
    if (by === 'ptr' && Math.hypot(e.clientX - x, e.clientY - y) > 10) reset();
  };
  const up = () => by === 'ptr' && reset();
  const click = (e: MouseEvent) => {
    if (fired) {
      fired = false;
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    o.tap?.(e);
  };
  const kdown = (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) start(e, 'key');
  };
  const kup = (e: KeyboardEvent) => {
    if ((e.key !== ' ' && e.key !== 'Enter') || by !== 'key') return;
    e.preventDefault();
    const was = t;
    reset();
    if (was && !fired) btn.click();
    fired = false;
  };
  const menu = (e: Event) => e.preventDefault();
  btn.addEventListener('pointerdown', down);
  addEventListener('pointermove', move, { passive: true });
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
  btn.addEventListener('click', click, true);
  btn.addEventListener('keydown', kdown);
  btn.addEventListener('keyup', kup);
  btn.addEventListener('contextmenu', menu);
  return () => {
    reset();
    btn.classList.remove('hold');
    btn.removeEventListener('pointerdown', down);
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    btn.removeEventListener('click', click, true);
    btn.removeEventListener('keydown', kdown);
    btn.removeEventListener('keyup', kup);
    btn.removeEventListener('contextmenu', menu);
  };
}
