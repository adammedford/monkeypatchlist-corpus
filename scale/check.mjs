// Checks that each scale-fixture build directory is one link group, and prints its size.
//   node scale/check.mjs
// One link group: index.html has exactly one script (the entry), every other .js file is a webpack chunk that pushes
// onto this build's chunk registry, and the entry's chunk loader names it (its content hash appears in the entry).
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = resolve(fileURLToPath(import.meta.url), '../dist/webpack');
const CHUNK = /^(?:\/\*![^\n]*\*\/\n)?(?:"use strict";)?\(self\.webpackChunkpatchline_scale_fixture=self\.webpackChunkpatchline_scale_fixture\|\|\[\]\)\.push\(/;
let failed = false;
for (const variant of (await readdir(DIST)).sort())
  for (const maps of ['maps', 'nomaps']) {
    const dir = join(DIST, variant, maps);
    const html = await readFile(join(dir, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*\bsrc="?([^" >]+)/g)].map((m) => m[1].replace(/^\.?\//, ''));
    const js = (await readdir(dir)).filter((f) => f.endsWith('.js')).sort();
    const problems = [];
    if (scripts.length !== 1) problems.push(`${scripts.length} script tags`);
    const entry = scripts.length ? await readFile(join(dir, scripts[0]), 'utf8') : '';
    let bytes = 0;
    for (const f of js) {
      const src = await readFile(join(dir, f), 'utf8');
      bytes += Buffer.byteLength(src);
      if (f === scripts[0]) continue;
      if (!CHUNK.test(src)) problems.push(`${f}: not a chunk of this build`);
      const hash = f.match(/\.([0-9a-f]{8})\.js$/)?.[1];
      if (!hash || !entry.includes(`"${hash}"`)) problems.push(`${f}: not named by the entry's chunk loader`);
    }
    failed ||= problems.length > 0;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${variant}/${maps}: ${js.length} files, ${(bytes / 1e6).toFixed(2)} MB, one link group${problems.length ? `\n  ${problems.join('\n  ')}` : ''}`);
  }
process.exit(failed ? 1 : 0);
