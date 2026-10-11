// Fills vendor/ from vendor/sources.json. vendor/ holds the copies of third-party CDN scripts that the static sites load
// and the ground-truth run serves from disk; only sources.json is committed, so each copy is fetched here and checked
// against its pinned sha256. An entry is keyed by the URL the page loads, and takes its bytes from either:
//   - the CDN, when it has no "npm" field: the URL is downloaded (a versioned URL, so the bytes don't drift), or
//   - an npm package, when it has "npm": "<package>/<path>": the file is copied from node_modules/<package>/<path>
//     (from `npm ci`), because the CDN URL is floating and the bytes in the npm tarball are the pinned ones.
// A file that already matches its sha256 is left alone. A mismatch fails the run and writes nothing.
//
// Usage: node scripts/vendor.mjs [--root <corpus dir>]

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const args = process.argv.slice(2);
if (args.some((arg, i) => arg !== '--root' && args[i - 1] !== '--root')) {
  console.error('usage: node scripts/vendor.mjs [--root <corpus dir>]');
  process.exit(2);
}
const rootFlag = args.indexOf('--root');
const ROOT = resolve(rootFlag >= 0 ? args[rootFlag + 1] : join(dirname(fileURLToPath(import.meta.url)), '..'));

const sources = JSON.parse(await readFile(join(ROOT, 'vendor/sources.json'), 'utf8'));
const modules = join(ROOT, 'node_modules');

async function readIfPresent(path) {
  return readFile(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
}

async function obtain(url, source) {
  if (source.npm === undefined) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  const path = resolve(modules, source.npm);
  if (relative(modules, path).startsWith('..') || relative(modules, path).split(sep)[0] === '') {
    throw new Error(`${source.file}: npm path ${source.npm} leaves node_modules`);
  }
  const bytes = await readIfPresent(path);
  if (bytes === null) throw new Error(`${source.file}: ${source.npm} is not in node_modules (run npm ci)`);
  return bytes;
}

let failed = 0;
for (const [url, source] of Object.entries(sources)) {
  const target = join(ROOT, 'vendor', source.file);
  try {
    const present = await readIfPresent(target);
    if (present !== null && sha256(present) === source.sha256) continue;
    const bytes = await obtain(url, source);
    const actual = sha256(bytes);
    if (actual !== source.sha256) throw new Error(`${source.file}: sha256 ${actual} differs from the pinned ${source.sha256}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    console.log(`vendored ${source.file}`);
  } catch (error) {
    failed++;
    console.error(`vendor: ${error.message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
