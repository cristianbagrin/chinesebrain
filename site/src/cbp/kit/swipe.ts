/* Two fingers sideways on a trackpad: Back and Forward (go.ts), like ⌘[ and ⌘]. A trackpad sends a stream of wheel
   events; a gesture is one stream, over once nothing has come for `quiet` ms (the momentum after the fingers lift is
   still the same gesture). Sideways movement adds up, and once it passes `need` px the gesture steps once, then
   nothing more until it ends. A gesture that went up or down first, or started where sideways belongs to something
   else (a row that scrolls, the Tutor pane), never steps. Fingers to the right (deltaX < 0) is back, as in a browser. */
export type Feed = { d: -1 | 0 | 1; acc: number; mine: boolean };
export function swipe({ need = 90, quiet = 220, ratio = 1.5 } = {}) {
  let acc = 0, last = -Infinity, spent = false, other = false;
  return {
    need,
    quiet,
    /** One wheel event, in px; `blocked`: this one is over something that takes sideways itself. */
    feed(dx: number, dy: number, t: number, blocked = false): Feed {
      if (t - last > quiet) {
        acc = 0;
        spent = false;
        other = false;
      }
      last = t;
      const side = Math.abs(dx) > Math.abs(dy) * ratio;
      // the gesture's first clear move decides whose it is
      if (!other && !spent && acc === 0 && (blocked || (!side && Math.abs(dy) > 1))) other = true;
      if (other) return { d: 0, acc: 0, mine: false };
      if (spent) return { d: 0, acc: 0, mine: true };
      if (!side) return { d: 0, acc, mine: false };
      acc += dx;
      if (Math.abs(acc) < need) return { d: 0, acc, mine: true };
      spent = true;
      return { d: acc < 0 ? -1 : 1, acc, mine: true };
    },
  };
}
