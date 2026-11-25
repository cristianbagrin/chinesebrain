// Chinese Brain Plus: small, exact edits to chinese.md and the other system texts, for the jobs that keep them
// (jobs.ts). Each finds its place by a heading or a line's start and changes nothing else.

/** The body of a `### Title` section (up to the next ###, ## or ---), with where it sits. */
export function section(md: string, title: string) {
  const re = new RegExp('^### ' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]*\\n', 'm');
  const m = re.exec(md);
  if (!m) return null;
  const start = m.index, bodyStart = m.index + m[0].length;
  const rest = md.slice(bodyStart);
  const end = rest.search(/^(### |## |---)/m);
  const stop = end < 0 ? md.length : bodyStart + end;
  return { start, bodyStart, stop, head: m[0], body: md.slice(bodyStart, stop) };
}

/** A Watch list miss: added to the line that starts with `line` (before its last period), else as a new line. */
export function watch(md: string, line: string, add: string) {
  const s = section(md, 'Watch list');
  if (!s || !add.trim()) return md;
  const lines = s.body.split('\n');
  const key = line.trim().replace(/^- /, '').slice(0, 40);
  const i = key ? lines.findIndex((l) => l.startsWith('- ') && l.slice(2).startsWith(key)) : -1;
  if (i >= 0) lines[i] = lines[i].replace(/\.?\s*$/, '') + `; ${add.trim().replace(/\.$/, '')}.`;
  else {
    // new lines go after the last list line, before the Taiwan usage paragraph
    const last = lines.reduce((k, l, n) => (l.startsWith('- ') ? n : k), -1);
    lines.splice(last + 1, 0, `- ${add.trim().replace(/\.?$/, '.')}`);
  }
  return md.slice(0, s.bodyStart) + lines.join('\n') + md.slice(s.stop);
}

/** Sound-alike slips added to the Typing slips line (those already there are skipped). */
export function typingSlips(md: string, slips: string[]) {
  const m = md.match(/^(\*\*Typing slips\*\*[^\n]*?)(\. A mnemonic fix[^\n]*)$/m);
  if (!m) return md;
  const fresh = slips.map((x) => x.trim()).filter((x) => x && !m[1].includes(x));
  if (!fresh.length) return md;
  return md.replace(m[0], m[1] + ', ' + fresh.join(', ') + m[2]);
}

/** A line at the end of Part 4 (the Log). */
export function logLine(md: string, line: string) {
  return md.replace(/\s*$/, '') + '\n' + line.trim() + '\n';
}

/** The essay-review marker: `**Essay review: DAY 1–b, last run <date>.**` */
export function marker(md: string, day: number, date: string) {
  return md.replace(/\*\*Essay review: DAY 1–\d+, last run [\d-]+\.\*\*/, `**Essay review: DAY 1–${day}, last run ${date}.**`);
}

/** Replace a ### section (its heading included) with new text. */
export function replaceSection(md: string, title: string, text: string) {
  const s = section(md, title);
  if (!s) return md;
  return md.slice(0, s.start) + text.trim() + '\n\n' + md.slice(s.stop);
}

/** Append lines under a `## Heading` of history.md (at that section's end). */
export function appendUnder(md: string, heading: string, text: string) {
  const i = md.indexOf('\n## ' + heading);
  if (i < 0) return md.replace(/\s*$/, '') + `\n\n## ${heading}\n${text.trim()}\n`;
  const next = md.indexOf('\n## ', i + 4);
  const at = next < 0 ? md.length : next;
  return md.slice(0, at).replace(/\s*$/, '') + '\n' + text.trim() + '\n' + md.slice(at);
}
