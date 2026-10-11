// Builds every app with every bundler into dist/<bundler>/<app>/{maps,nomaps}/.
//   node scripts/build.mjs [--only bundler/app,...]   build, then write manifest.json
//   node scripts/build.mjs --verify                   rebuild into a temp dir and compare with manifest.json
//   --root <dir>                                       corpus root holding apps/ (default: this corpus; the holdout uses holdout/)
//   --bundlers webpack,...                             only these bundlers (default: all four; the scale fixture uses webpack)
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = resolve(fileURLToPath(import.meta.url), '../..');
const argv = process.argv.slice(2);
const ROOT = argv.includes('--root') ? resolve(argv[argv.indexOf('--root') + 1]) : HARNESS;
const APPS = (await readdir(join(ROOT, 'apps'), { withFileTypes: true })).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
const args = argv;
const BUNDLERS = args.includes('--bundlers') ? args[args.indexOf('--bundlers') + 1].split(',') : ['webpack', 'esbuild', 'rollup', 'vite'];
const verify = args.includes('--verify');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;

const html = (app, scripts) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>corpus: ${app}</title></head>
<body>
<h1>${app}</h1>
<button id="corpus-button" type="button">click</button>
${scripts}
</body>
</html>
`;
const define = { 'process.env.NODE_ENV': '"production"' };

const builders = {
  async webpack(app, out) {
    const { default: webpack } = await import('webpack');
    const { default: HtmlWebpackPlugin } = await import('html-webpack-plugin');
    const stats = await new Promise((ok, fail) =>
      webpack({
        mode: 'production',
        context: ROOT,
        entry: { main: `./apps/${app}/index.js` },
        devtool: 'source-map',
        output: { path: out, filename: '[name].[contenthash:8].js', chunkFilename: '[name].[contenthash:8].js', publicPath: 'auto', clean: true },
        performance: false,
        module: { rules: [{ test: /\.m?js$/, resolve: { fullySpecified: false } }] },
        plugins: [new HtmlWebpackPlugin({ templateContent: html(app, ''), inject: 'body', scriptLoading: 'blocking' })],
      }).run((err, s) => (err ? fail(err) : ok(s))),
    );
    if (stats.hasErrors()) throw new Error(stats.toString('errors-only'));
  },
  async esbuild(app, out) {
    const esbuild = await import('esbuild');
    const r = await esbuild.build({
      absWorkingDir: ROOT,
      entryPoints: { main: `apps/${app}/index.js` },
      bundle: true, minify: true, format: 'iife', sourcemap: true, metafile: true,
      entryNames: '[name]-[hash]', outdir: out, define, logLevel: 'error', legalComments: 'none',
      // No tsconfig.json: esbuild would otherwise read the monkeypatchlist repository's, above the corpus, whose `strict`
      // adds "use strict" to every bundle, so the build would no longer reproduce manifest.json.
      tsconfigRaw: {},
    });
    const js = Object.keys(r.metafile.outputs).find((f) => f.endsWith('.js'));
    await writeFile(join(out, 'index.html'), html(app, `<script src="./${relative(out, join(ROOT, js))}"></script>`));
  },
  async rollup(app, out) {
    const { rollup } = await import('rollup');
    const { default: nodeResolve } = await import('@rollup/plugin-node-resolve');
    const { default: commonjs } = await import('@rollup/plugin-commonjs');
    const { default: json } = await import('@rollup/plugin-json');
    const { default: replace } = await import('@rollup/plugin-replace');
    const { default: terser } = await import('@rollup/plugin-terser');
    const bundle = await rollup({
      input: { main: join(ROOT, 'apps', app, 'index.js') },
      plugins: [nodeResolve({ browser: true }), commonjs(), json(), replace({ values: define, preventAssignment: true }), terser()],
      onwarn: () => {},
    });
    const { output } = await bundle.write({ dir: out, format: 'es', entryFileNames: '[name]-[hash].js', chunkFileNames: '[name]-[hash].js', sourcemap: true });
    await bundle.close();
    const entry = output.find((o) => o.type === 'chunk' && o.isEntry);
    await writeFile(join(out, 'index.html'), html(app, `<script type="module" src="./${entry.fileName}"></script>`));
  },
  async vite(app, out) {
    const { build } = await import('vite');
    const root = join(ROOT, 'apps', app);
    await writeFile(join(root, 'index.html'), html(app, '<script type="module" src="./index.js"></script>'));
    await build({
      root, configFile: false, logLevel: 'error', base: './', define,
      build: { outDir: out, emptyOutDir: true, sourcemap: true },
    });
  },
};

async function files(dir) {
  const all = [];
  for (const e of await readdir(dir, { recursive: true, withFileTypes: true })) if (e.isFile()) all.push(join(e.parentPath, e.name));
  return all.sort();
}

// The no-maps variant is the maps variant with the maps and their comments removed, so the code is byte-identical.
async function stripMaps(from, to) {
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true });
  for (const f of await files(to)) {
    if (f.endsWith('.map')) await rm(f);
    else if (/\.(m?js|css)$/.test(f)) {
      const src = await readFile(f, 'utf8');
      await writeFile(f, src.replace(/\n?\/[/*][#@] sourceMappingURL=[^\n]*?(\*\/)?\s*$/, ''));
    }
  }
}

async function buildAll(distDir) {
  const failures = [];
  for (const bundler of BUNDLERS)
    for (const app of APPS) {
      if (only && !only.includes(`${bundler}/${app}`)) continue;
      const maps = join(distDir, bundler, app, 'maps');
      await rm(join(distDir, bundler, app), { recursive: true, force: true });
      await mkdir(maps, { recursive: true });
      const t = performance.now();
      try {
        await builders[bundler](app, maps);
        await stripMaps(maps, join(distDir, bundler, app, 'nomaps'));
        console.log(`ok   ${bundler}/${app} ${Math.round(performance.now() - t)}ms`);
      } catch (e) {
        failures.push(`${bundler}/${app}`);
        console.log(`FAIL ${bundler}/${app}: ${String(e.message ?? e).split('\n').slice(0, 6).join('\n  ')}`);
      }
    }
  return failures;
}

async function manifest(distDir) {
  const m = {};
  for (const f of await files(distDir)) m[relative(distDir, f)] = createHash('sha256').update(await readFile(f)).digest('hex');
  return m;
}

if (verify) {
  // Same depth as dist/, so relative paths in source maps and HTML match.
  const tmp = join(ROOT, '.verify');
  await rm(tmp, { recursive: true, force: true });
  const failures = await buildAll(tmp);
  const want = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8')).files;
  const got = await manifest(tmp);
  const diff = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter((k) => want[k] !== got[k]);
  console.log(diff.length ? `NOT reproducible: ${diff.length} files differ\n  ${diff.slice(0, 20).join('\n  ')}` : `reproducible: ${Object.keys(got).length} files match manifest.json`);
  await rm(tmp, { recursive: true, force: true });
  process.exit(diff.length || failures.length ? 1 : 0);
} else {
  const distDir = join(ROOT, 'dist');
  const failures = await buildAll(distDir);
  if (!only) {
    const versions = {};
    for (const p of BUNDLERS) versions[p] = JSON.parse(await readFile(join(HARNESS, 'node_modules', p, 'package.json'), 'utf8')).version;
    await writeFile(join(ROOT, 'manifest.json'), JSON.stringify({ node: process.version, bundlers: versions, files: await manifest(distDir) }, null, 1) + '\n');
  }
  if (failures.length) process.exit(1);
}

