# Working on this repository

- **Ship to `main`.** When work is done and checks pass (`npm run typecheck`, `npm test`,
  `npm run build`, `npm run lint:ext`), merge it into `main` and push, in addition to any
  session branch. Pushing `main` deploys the website (`site/`, Cloudflare Workers Builds) and,
  when the version in `package.json` changed, releases the extension to the stores
  (`.github/workflows/release.yml`). No pull request needed unless asked.
- `dist/`, `dist-chrome/`, `site/public/brain/dashboard.js` and `site/public/site.js` (from
  `site/src/`) are committed: rebuild them (`npm run build`) before committing source changes.
- The word list is the Dashboard, on the website only (`/brain/dashboard`). With the extension it talks to the
  extension through `src/content/bridge.ts` (own site only, whitelisted messages).
- The site sends a strict CSP (`site/public/_headers`): no inline scripts; shared page code goes
  in `site/src/site.ts` (the demo card for visitors without the extension, the steps on How it
  works, the little YouTube player).
- A new version needs its notes in `store/PUBLISHING.md` (section 4), or the release stops.
  The website's What's new page (`site/public/brain/whats-new.html`) is hand-written: add an entry
  only for what a reader would notice, titled by what it gets them.
- The extension's website pages live under `/brain` (`site/public/brain*`); `/account` and
  `/api` are shared by everything on the site. Keep old addresses working (`MOVED` in
  `site/worker.js`): store listings and installed extensions link to them.
- Key names in the UI follow the computer: `Alt` on Windows and Linux, `⌥ Option` on a Mac.
- All user-facing English is American English (UI, docs, data; see `scripts/american.py`).
- Before building or changing Plus's UI (`/plus`), read `DESIGN.md`: its tokens and shells are the only ones to use.
- Few words, clear controls: a button or an icon over a sentence. No hover tooltips anywhere (no `title=`, no hover tips).
- **Code before AI.** Anything a rule can do runs as plain code (fast, free, the same every time); Claude gets only the jobs that need judgment. Check the `spend` table before adding AI work.
- Chris changes the pages' words himself at `/edit` (any page: `/edit/brain/guide`…; password = the
  `EDIT_KEY` secret). His edits live in the Worker's `Copy` database and are put into each page as it's
  served, tied to the words they replaced (`site/src/copy.ts`). Run `node site/sync.mjs` before changing
  page text by hand (`--apply` writes his edits into `site/public`); words that scripts write go in an
  element marked `data-js-text`, so the editor leaves them alone.
- **Nothing new reaches people unswitched.** New parts check a release switch (`SWITCHES` in `site/worker.js`,
  stored in the `cbp` D1 `flags` table): on for Chris's account while he tries it, on for Everyone to release.
  He flips them on `/admin`. Try changes first on staging, https://chinese-staging.cristianbagrin.com
  (`npx wrangler deploy --env staging` in `site/`; same accounts and switches, its own CBP data), open only to
  accounts with the `staging` switch. Chinese Brain Plus is `/plus`, behind the `plus` switch.
- One recovery key for the whole account: `@account/keyring` (sync `app: 'account'`, any app) holds the account's
  master key, and each app that encrypts wraps its data key under it. The scheme and the rules every app keeps are in
  `site/public/acct/keyring.js`. Keyrings are written with `if` (compare-and-set, see `_sync`); an item once written
  that way can't be replaced by a write without it, which keeps older app versions from writing over a newer keyring.
- **Chinese Brain Plus** (`/plus`, plan: life/chinese/online-plan): Chris's whole Chinese system, and the only place it lives (the
  Mac's `life/chinese` files were archived on 2026-11-23). The engine is `site/src/cbp/engine.ts` (words.py ported; `scripts/cbp-parity.ts`
  compared them), its data the CBP D1 (`files` incl. `chinese.md`, the system's rules; `docs`, `meta`, `history`; `site/src/cbp/plus.ts`).
  Jobs run on two Cron Triggers (10 pm and 5 am Taipei; `scheduled` in worker.js); nothing polls, and only work that needs
  judging calls Claude. 10 pm: the nightly (`site/src/cbp/nightly.ts`): his Chinese Brain marks in from his account
  (`Account.brainSince`) and CBP's K/L changes back out (`writeBack`, `Account.brainGet/brainPut`, newer change wins per word),
  Todoist's "Chinese" project drained (TODOIST_TOKEN), the finished test and cards filed, the day's test (one a day, ~10 items:
  `E.dailyPlan`; Sonnet writes it; listening drills `listen` with multi-voice `hear`, TOCFL items `tocfl` with four `choices`
  graded on the board; an untouched test is refreshed in place, 3+ missed days → a short comeback), a snapshot in R2. 5 am
  (`site/src/cbp/jobs.ts`): yesterday's essay marked with its bookkeeping (Opus), Mondays the weekly pass, the 1st the monthly
  (checks → board/data `alerts`, not shown in the app since Nov 26) then the monthly test. A word turns K after three situations of correct use
  (`E.situations`; Progress shows `uses`). Every Claude call's tokens go into the D1 `spend` table (ai.ts): check it before
  adding AI work; his budget is $6–10 a month. Each job's last run is in meta `job.*`. `POST /api/plus/push/nightly`, `/essay`,
  `/weekly`, `/monthly`, `/monthly-test` (`?force=1`), `/try-test`, `/brain-back` (`?dry=1`) (Bearer CBP_PUSH_KEY; staging's is
  CBP_STAGING_PUSH_KEY in `~/.cbp-push.env`; staging has no crons and shares production's accounts, so `brain-back` only
  dry-runs there) run them by hand.
  The board's code lives in `site/public/plus/board` and is edited there now (`scripts/cbp-board.py` copied it from the old folder);
  `plus/runtime.js` stands in for claude.ai's database and `sample`; `plus/review.js` adds his review card beside the study card on
  the Cards page (`site/src/cbp/cards.ts`: pictures from Wikimedia Commons or drawn on Pollinations, Azure voices, media in R2; a daily
  sweep, `cards.clean`, drops media nothing points to). The Tutor tab (`plus/tutor.js` from `site/src/cbp/tutor/`, server
  `tutor.ts`; Scene and Ask modes) is behind `plus.tutor`. Staging has no AI keys: it borrows production's through the `Brains` entrypoint, and its Account
  objects are production's. A Claude session he opens himself reads and writes it through the connector
  at `/mcp/<CBP_MCP_KEY>` (tools in `plus.ts`). `scripts/cbp-push.py` is retired.
- **Plus's shared parts** (`plus/kit.js` from `site/src/cbp/kit/`, loaded right after the board's `core.js`): `SETTINGS` (the one
  Settings panel; choices are `LAB.define(…, {scope:'account'})` in core.js, account ones saved by `site/src/cbp/settings.ts` in
  meta `settings`, which the night jobs read through `modelFor`), `KEYS` (every shortcut, rebindable: `KEYS.is(e, id)`, never
  `e.key ===`), `SOUND` (one voice at a time), `HOLD` (press and hold), `RUBY` (pinyin above characters, from code:
  `site/src/cbp/pinyin.ts` on the lexicon `plus/pinyin.txt` that the build writes). The type scale is in `board/css/base.css`.
- **CBP reviews (Stage 4, Anki rebuilt)**: the Reviews tab of `/plus` (`/plus/review` redirects there), behind the `plus.anki`
  switch; `plus.js` loads `plus/anki.js` (from `site/src/cbp/review/`) before the board's `boot.js`, and it adds the tab itself.
  Class names in `plus/anki.css` must not collide with the board's or `review.css` (`.rv` is the Cards page's). Offline: `plus/sw.js`
  (scope `/plus`) and the whole collection in IndexedDB, synced with the D1 table `anki` (`site/src/cbp/anki.ts`). The scheduler is
  `sched.ts` + `fsrs.ts`, FSRS-6 written to match Anki's own (`node scripts/cbp-anki.ts fsrs <colpkg>`); the tab refits the weights
  monthly (`optimize`). Every change goes through `change()` so Cmd+Z / Shift+Cmd+Z undo it. Settings › Download for Anki writes a
  legacy `.colpkg` in the browser (`review/export.ts`, sql.js in `plus/vendor`, hence `'wasm-unsafe-eval'` in PLUS_CSP). Since Nov 23
  it is `live`: notes saved on the Cards page join the collection (`anki.fromBoard`, the note type he picks there) and
  `cbp-push.py --anki` stops. A new import (`cbp-anki.ts import <file>`) replaces the collection. Never touch his Anki.
- **Durable Objects free tier: 5 million rows read a day across all Account objects**, and past it every page that
  touches accounts fails until 00:00 UTC. Anything called per request (auth checks, polling, each image) reads one row
  (`_who`), never a count or a scan; `_me` is for pages that show the counts.
