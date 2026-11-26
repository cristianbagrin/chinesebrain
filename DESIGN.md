# Chinese Brain Plus: design rules

The values live in `site/public/plus/board/css/base.css` (`:root`). These rules say which one to use and why.
Reasons marked *inferred* weren't said by Chris; check them with him before leaning on them hard.

## The one rule

- **A change to a shared look (a size, a radius, a label, a button) goes to every place that has that look, in the
  same change.** Before finishing, grep the other pages for the old value. Never fix one page and leave the rest.
  Why: "you keep making changes in one place, and then the other places are still on the old version… if a change
  (like text size or whatever) is in one place, then of course do it everywhere else."
  <!-- 2026-11-26, wave 5 brief -->

## Typography

- **Every font size is a token (`--fs-xs` … `--fs-3xl`) or `calc(Npx * var(--k))`; never a bare px size.**
  Why: bare px ignores Settings › Text size (Cards' page had ~25 of them and didn't grow with Larger).
- **Nothing he reads is under `--fs-s`. `--fs-xs` only for a deliberate caption: heatmap months, counts in a chip,
  key caps, pinyin over characters.**
  Why: "no small text, Chinese above all"; the heatmap months were his own call for smaller.
  <!-- 2026-11-26: "make Months text smaller" -->
- **Running Chinese is at least `--fs-zh` with `--lh-zh`; his own writing is `calc(var(--essay) * var(--pen-k))`
  in `--pen` everywhere it appears (Today's essay, the test's answer box).**
  Why: small Chinese is hard to read at screen distance; his writing should look the same wherever it shows.
- **A block's label (Examples, Characters, To improve, a field's name, a Settings group) is one look: `--fs-s`,
  weight 500, `--ink-3` (`.label` / `.side-h`).** Never bold, never a box, never a second label style.
  Why: Cards' labels at a different size and weight read "weaker/older than the rest".
- **Text rhythm: a paragraph gap is always bigger than a line gap (`--para`, `--para-zh`), including inside an
  editor.** Today's essay box keeps one block per paragraph for this; its saved text stays plain lines.
  Why: "it's all the same spacing, no matter if it's a new paragraph or sentence."

## Surfaces

- **Radii: `--r-s` 8px small inner things, `--r` 12px fields/rows/popovers, `--r-l` 16px dialogs and panels,
  `--r-sheet` 18px phone sheets, 999px for buttons, chips and segmented controls. No other values.**
- **Shadows: `--sh-1` raised control or panel, `--sh-pop` anything floating over the page, `--sh-dlg` a dialog or
  pane, `--sh-sheet` a phone's bottom sheet, `--sh-btn` a floating ink button. No hand-written shadows.**
  Why (*inferred*): ~30 different shadows made the same role look different on every page.
  Left on purpose: the test's paper props (`.qnotice`, `.qmenu`, `.qpaper`, drawn objects), the paper sheets
  (paper.css), the phone Tutor pane's side shadow, Show answer's hover lift and the Cards drag ghost: a token would change
  how they look.
- **Every dialog is the Settings window's shell (`dialog.st` in kit.css): `--bg` inside, `--r-l`, `--sh-dlg`,
  `--dim` behind, an svg × top right, Escape and a click outside close it, a bottom sheet on a phone.**
- **A page reached from Settings opens inside the window (`SETTINGS.page`: Card designs), with "‹ Settings" to go back;
  it never takes over the app's page.**
- **Every popover (tips, Next up, the essay focus, the flag picker, trays) is one shell: `--surface`, `--r`,
  `--sh-pop`, padding `--s3 --s4`, a .16s fade.**
- **Separate groups with space, not lines or boxes.** A hairline only where two different things touch.

## Controls

- **Buttons are pills: ink for the one action (`.btn`, `--fs-s` 550), quiet text buttons for the rest (`.btn-q`),
  36px round icon buttons (`.ib`).** Answer buttons in Reviews too.
- **One segmented control: a `--wash` pill, 3px inside, options `--fs-s` 500 `--ink-3` padded 5px 14px, the chosen
  one `--surface` + `--sh-1` in ink.** One switch: Settings' `.st-tg` (Essays' My version is the same, a size down).
- **No hover tooltips (`title=`), no explanatory labels or counters.** Few words; a control over a sentence.

## Pages

- **Reviews: the card is his note type's CSS; never edit it to fix sizing. It is drawn at its own size; when it would
  need scrolling, `fitCard` (review/main.ts) draws the whole card smaller with `zoom` on `.rw-card .host` (never below
  60%), again once its pictures load, its pinyin is drawn, or the window changes size.**
  Why (*inferred*, from the Nov 27 change back): a width zoom made big cards scroll under the answer buttons.
- **Empty states use `.empty` (a line in ink-2, a second in ink-3, centered).**

## Motion

- Arrivals use `--ease`; `--spring` only for a small pop; sheets and panes `--sheet` (.45s). Popover .16s,
  dialog .22s. Reduced motion: opacity only.
