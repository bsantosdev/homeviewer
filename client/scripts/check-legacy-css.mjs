// Fails the build when the emitted CSS uses features Safari 12 (iOS 12, the wall iPad) lacks.
// Safari drops a whole rule when its selector has an unknown pseudo-class, so `:where()`
// rules are listed for review; the ones from Tailwind's preflight are repeated in styles.scss.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const outDir = fileURLToPath(new URL('../../server/HomeViewer.Api/wwwroot/', import.meta.url));

const UNSUPPORTED = [
  [/[{;]gap:/, 'flexbox/grid `gap` (Safari 14.1+): use margins'],
  [/[{;]inset:/, '`inset` shorthand (Safari 14.1+): use top/right/bottom/left'],
  [/[{;]aspect-ratio:/, '`aspect-ratio` (Safari 15+)'],
  [/:is\(/, '`:is()` selector (Safari 14+)'],
  [/@layer\b/, 'cascade layers (Safari 15.4+)'],
  [/@property\b/, '`@property` (Safari 16.4+)'],
  [/oklch\(|color-mix\(/, 'modern color functions (Safari 15.4+/16.2+)'],
];

const KNOWN_WHERE = [
  'abbr:where([title])',
  'button,input:where([type=button]),input:where([type=reset]),input:where([type=submit])',
  '[hidden]:where(:not([hidden=until-found]))',
];

let failed = false;
for (const file of (await readdir(outDir)).filter((f) => f.endsWith('.css'))) {
  const css = await readFile(join(outDir, file), 'utf8');
  for (const [pattern, message] of UNSUPPORTED) {
    if (pattern.test(css)) {
      console.error(`${file}: uses ${message}`);
      failed = true;
    }
  }
  for (const [selector] of css.matchAll(/[^{}]*:where\([^{]*(?=\{)/g)) {
    if (!KNOWN_WHERE.includes(selector.trim())) {
      console.error(`${file}: Safari 12 drops this rule (\`:where()\`): ${selector.trim()}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('CSS is Safari 12 compatible');
