// Angular's esbuild pipeline can't target Safari 12 (iOS 12, e.g. iPad mini 2),
// so after `ng build` we down-level the emitted JS with Babel.
// Runtime APIs are covered by core-js-bundle, loaded via angular.json "scripts".
import { transformFileAsync } from '@babel/core';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outDir = new URL('../../server/HomeViewer.Api/wwwroot/', import.meta.url);

const files = (await readdir(outDir)).filter((f) => f.endsWith('.js') && !f.startsWith('scripts-'));

for (const file of files) {
  const path = join(outDir.pathname.replace(/^\/(\w:)/, '$1'), file);
  const { code } = await transformFileAsync(path, {
    babelrc: false,
    configFile: false,
    compact: true,
    comments: false,
    sourceType: 'module',
    presets: [['@babel/preset-env', { targets: 'iOS >= 12, Safari >= 12', modules: false, bugfixes: true }]],
  });
  await writeFile(path, code);
  console.log(`Transpiled ${file}`);
}
