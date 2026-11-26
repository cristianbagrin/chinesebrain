Noodle, the little companion on Today and Reviews, archived 2026-11-26 (not served: nothing under `site/public` loads it).
To bring it back: move `noodle.js` to `site/public/plus/board/js/` and `noodle.css` to `site/public/plus/board/css/`, then add
`<link rel="stylesheet" href="/plus/board/css/noodle.css">` and `<script src="/plus/board/js/noodle.js" defer></script>` (after plus.js) to `site/public/plus.html`, plus an empty `<div id="today-buddy"></div>` after `#companion` for its Today spot.
