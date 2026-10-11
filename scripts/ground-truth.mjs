// Loads every build in Chromium, diffs native descriptors before/after load, and writes ground-truth/*.json.
//   node scripts/ground-truth.mjs [--only substring,...] [--settle ms] [--root dir] [--out dir] [--absent natives.json]
// --out writes ground truth under another directory (default <root>/ground-truth). --absent runs each build of an app listed
// in the natives file once per listed run, with scripts/absent.js deleting that run's natives after the clean snapshot
// (see "Exercise variants" in corpus/README.md); output goes to <out>/<site>.<run>.json and summary.json is merged.
// A page that defines window.__corpusTeardown gets a second diff after it is called (`afterTeardown`),
// and one that defines window.__corpusProbe has its return value recorded (`probe`). Fixture pages use both.
// All network is served from disk: builds at https://app.corpus.test/, vendor CDN URLs from vendor/ (sha256-checked).
// Every other request is aborted, so SDKs never phone home.
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HARNESS = resolve(fileURLToPath(import.meta.url), '../..');
const ORIGIN = 'https://app.corpus.test';
const args = process.argv.slice(2);
// --root points at another corpus root (the holdout) with its own dist/, ground-truth/ and optional vendor/ and static-sites/.
const ROOT = args.includes('--root') ? resolve(args[args.indexOf('--root') + 1]) : HARNESS;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const SETTLE = args.includes('--settle') ? Number(args[args.indexOf('--settle') + 1]) : 3000;
const OUT = args.includes('--out') ? resolve(args[args.indexOf('--out') + 1]) : join(ROOT, 'ground-truth');
const ABSENT = args.includes('--absent') ? JSON.parse(await readFile(resolve(args[args.indexOf('--absent') + 1]), 'utf8')) : null;
const ABSENT_JS = ABSENT ? await readFile(join(HARNESS, 'scripts/absent.js'), 'utf8') : null;
const CONCURRENCY = 4;
const KEY = `globalThis[Symbol.for('patchline.corpus')]`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.map': 'application/json', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };

const vendor = JSON.parse(await readFile(join(ROOT, 'vendor/sources.json'), 'utf8').catch(() => '{}'));
const canned = JSON.parse(await readFile(join(ROOT, 'routes.json'), 'utf8').catch(() => '{}'));
const vendorBody = {};
for (const [url, v] of Object.entries(vendor)) {
  const body = await readFile(join(ROOT, 'vendor', v.file));
  if (createHash('sha256').update(body).digest('hex') !== v.sha256) throw new Error(`vendor hash mismatch: ${v.file}`);
  vendorBody[url] = body;
}

async function sites() {
  const list = [];
  for (const s of (await readdir(join(ROOT, 'static-sites')).catch(() => [])).sort()) if (!s.startsWith('.')) list.push({ id: `static/${s}`, dir: join(ROOT, 'static-sites', s) });
  // Dot-directories (stray tool state such as .claude/) are not builds.
  for (const b of (await readdir(join(ROOT, 'dist')).catch(() => [])).sort().filter((n) => !n.startsWith('.')))
    for (const a of (await readdir(join(ROOT, 'dist', b))).sort().filter((n) => !n.startsWith('.')))
      for (const v of ['maps', 'nomaps']) list.push({ id: `${b}/${a}/${v}`, dir: join(ROOT, 'dist', b, a, v) });
  const picked = list.filter((s) => !only || only.some((o) => s.id.includes(o)));
  if (!ABSENT) return picked;
  // One job per (build, run) for apps the natives file lists against this root (default: the main corpus root).
  const jobs = [];
  for (const s of picked) {
    const app = s.id.split('/')[1];
    const entry = ABSENT.apps?.[app];
    if (!entry || resolve(HARNESS, entry.root ?? '.') !== ROOT) continue;
    for (const [run, natives] of Object.entries(entry.runs)) jobs.push({ ...s, run, natives: natives.map((n) => n.target) });
  }
  return jobs;
}

// ---- CDP helpers: wrap evidence and definition sites ----
function cdp(session) {
  const send = (m, p) => session.send(m, p);
  const evalId = async (expr) => (await send('Runtime.evaluate', { expression: expr, objectGroup: 'gt' })).result;
  const props = (objectId) => send('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: false });
  const isRef = (ro) => ro && ro.objectId && (ro.type === 'function' || ro.type === 'object');

  // Candidate places a wrapper keeps its original: proxy target, bound target, own properties,
  // closure variables (all enclosing scopes), members of objects in the innermost closure, and
  // the closures of functions in the innermost closure (one more level, for trampolines).
  async function candidates(objectId, label, depth, out, seen) {
    if (seen.has(objectId) || out.length > 20000) return null;
    seen.add(objectId);
    const { result = [], internalProperties = [] } = await props(objectId);
    const internal = Object.fromEntries(internalProperties.map((p) => [p.name, p.value]));
    let location = internal['[[FunctionLocation]]']?.value ?? null;
    // Wrappers stack (Sentry: Proxy -> fill wrapper -> native), so proxy/bound targets and own function
    // properties are followed transitively.
    for (const [n, tag] of [['[[Target]]', 'proxy-target'], ['[[TargetFunction]]', 'bound-target']])
      if (isRef(internal[n])) {
        out.push([internal[n].objectId, `${label}${tag}`]);
        if (depth < 4) await candidates(internal[n].objectId, `${label}${tag}->`, depth + 1, out, seen);
      }
    if (isRef(internal['[[Handler]]'])) {
      for (const p of (await props(internal['[[Handler]]'].objectId)).result ?? []) {
        if (!isRef(p.value)) continue;
        if (!location && (p.name === 'apply' || p.name === 'construct')) {
          const hp = await props(p.value.objectId);
          location = hp.internalProperties?.find((x) => x.name === '[[FunctionLocation]]')?.value?.value ?? null;
        }
        await candidates(p.value.objectId, `${label}proxy-handler.${p.name}:`, depth + 1, out, seen);
      }
    }
    if (isRef(internal['[[TargetFunction]]']) && !location) {
      const tp = await props(internal['[[TargetFunction]]'].objectId);
      location = tp.internalProperties?.find((x) => x.name === '[[FunctionLocation]]')?.value?.value ?? null;
    }
    for (const p of result) {
      if (!isRef(p.value) || p.name === 'prototype') continue;
      out.push([p.value.objectId, `${label}own:${p.name}`]);
      if (p.value.type === 'function' && depth < 4) await candidates(p.value.objectId, `${label}own:${p.name}->`, depth + 1, out, seen);
    }
    if (isRef(internal['[[Scopes]]']) && depth < 3) {
      const scopes = (await props(internal['[[Scopes]]'].objectId)).result.filter((s) => /^\d+$/.test(s.name));
      for (const [si, s] of scopes.entries()) {
        const desc = s.value.description ?? '';
        if (desc.startsWith('Global')) continue;
        const vars = (await props(s.value.objectId)).result ?? [];
        for (const v of vars) {
          if (!isRef(v.value)) continue;
          out.push([v.value.objectId, `${label}closure:${v.name}`]);
          if (si === 0 && depth < 2) {
            if (v.value.type === 'object') {
              for (const m of ((await props(v.value.objectId)).result ?? []).slice(0, 200))
                if (isRef(m.value)) out.push([m.value.objectId, `${label}closure:${v.name}.${m.name}`]);
            } else await candidates(v.value.objectId, `${label}closure:${v.name}->`, depth + 1, out, seen);
          }
        }
      }
    }
    return location;
  }

  async function reaches(newExpr, origExpr) {
    const n = await evalId(newExpr), o = await evalId(origExpr);
    if (!isRef(n) || !isRef(o)) return { location: null, basis: null };
    const out = [];
    const location = await candidates(n.objectId, '', 0, out, new Set());
    let basis = null;
    for (let i = 0; i < out.length && !basis; i += 2000) {
      const chunk = out.slice(i, i + 2000);
      const r = await send('Runtime.callFunctionOn', {
        objectId: o.objectId, returnByValue: true,
        functionDeclaration: 'function(...c){return c.findIndex(x=>x===this)}',
        arguments: chunk.map(([id]) => ({ objectId: id })),
      });
      if (r.result.value >= 0) basis = chunk[r.result.value][1];
    }
    return { location, basis };
  }
  async function locationOf(expr) {
    const n = await evalId(expr);
    if (!isRef(n)) return null;
    return candidates(n.objectId, '', 9, [], new Set());
  }
  return { reaches, locationOf, release: () => send('Runtime.releaseObjectGroup', { objectGroup: 'gt' }) };
}

// SDKs mint per-load property names (New Relic `nr@original:<uuid>`, App Insights `_aiDataEvents_<ver>_<rand6>`).
// Normalize them so reruns diff clean; targets themselves are never randomized.
const stable = (x) => x && x.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/(_aiDataEvents_[\d_]+?_)[A-Za-z0-9_]{6}$/, '$1<rand>');
const V8_EXTENSIONS = new Set(['Error.stackTraceLimit', 'Error.captureStackTrace', 'Error.prepareStackTrace']);
const EFFECT = { delete: 'delete', add: 'add', prototype: 'prototype-change', descriptor: 'descriptor-change' };

async function run(browser, site) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const blocked = new Set();
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    // A key ending in `*` matches by prefix (used only by variant roots, whose beacons carry per-load query strings).
    const can = canned[url] ?? Object.entries(canned).find(([k]) => k.endsWith('*') && url.startsWith(k.slice(0, -1)))?.[1];
    if (can?.json) return route.fulfill({ status: can.status ?? 200, body: JSON.stringify(can.json), headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...(can.headers ?? {}) } });
    if (url.startsWith(ORIGIN + '/')) {
      const path = decodeURIComponent(new URL(url).pathname);
      try {
        const body = await readFile(join(site.dir, path === '/' ? 'index.html' : path));
        return route.fulfill({ status: 200, body, headers: { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' } });
      } catch { return route.fulfill({ status: 404, body: '' }); }
    }
    if (vendorBody[url]) return route.fulfill({ status: 200, body: vendorBody[url], headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } });
    if (!url.startsWith('blob:') && !url.startsWith('data:')) blocked.add(new URL(url).origin);
    return route.abort('blockedbyclient');
  });
  await context.addInitScript({ path: join(HARNESS, 'scripts/snapshot.js') });
  // Registered second, so it runs after the clean snapshot and before any page script.
  if (site.run) await context.addInitScript({ content: `(${ABSENT_JS.trim().replace(/^(\/\/[^\n]*\n)+/, '')})(${JSON.stringify(site.natives)});` });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  const scripts = new Map();
  session.on('Debugger.scriptParsed', (e) => scripts.set(e.scriptId, { url: e.url, hash: e.hash }));
  await session.send('Debugger.enable');
  const pageErrors = [], workers = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('worker', (w) => workers.push(w.url().replace(/^blob:.*$/, 'blob:')));

  await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.__corpusReady === true', null, { timeout: 5000 }).catch(() => {});
  await page.click('#corpus-button').catch(() => {});
  await page.waitForTimeout(SETTLE);

  const c = cdp(session);
  const at = (loc) => {
    if (!loc) return null;
    const s = scripts.get(loc.scriptId);
    return { url: s?.url ?? null, line: loc.lineNumber + 1, column: loc.columnNumber };
  };
  // Diff the current state against the clean snapshot. collect() reuses the pairs table, so one diff at a time.
  const diff = async (raw) => {
  const mutations = [], expandos = [];
  for (const m of raw.mutations) {
    const r = { ...m };
    delete r.pair;
    delete r.newValue;
    r.effect = EFFECT[m.change] ?? null;
    if (m.pair !== undefined) {
      const P = `${KEY}.pairs[${m.pair}]`;
      const accessor = m.after?.kind === 'accessor';
      const news = accessor ? [`${P}.new.set`, `${P}.new.get`] : [`${P}.new`];
      const olds = m.before?.kind === 'accessor' ? [`${P}.old.set`, `${P}.old.get`] : [`${P}.old`];
      let location = null, basis = null;
      if (m.change !== 'add' && m.change !== 'prototype') {
        for (const n of news) for (const o of olds) {
          if (basis) break;
          const x = await c.reaches(n, o);
          location ??= x.location;
          basis ??= x.basis;
        }
        if (!basis && !accessor) {
          const held = await page.evaluate(`${KEY}.heldBy(${P}.old)`);
          if (held) basis = `holder:${held}`;
        }
      }
      location ??= await c.locationOf(news[0]);
      // ADR 0011: the effect follows the new value. A new data value (own, or shadowing) is replace/wrap whatever
      // attributes changed with it; descriptor-change is for a new accessor pair or attributes alone.
      if (m.change === 'value' || m.newValue || (m.change === 'shadow' && !accessor)) r.effect = basis ? 'wrap' : 'replace';
      else if (m.change === 'shadow') r.effect = 'descriptor-change';
      r.wrapEvidence = stable(basis);
      r.definedAt = at(location);
    }
    if (m.change === 'add' && m.holderKind === 'singleton') { expandos.push(r); continue; }
    if (V8_EXTENSIONS.has(m.target)) r.boundaryNote = 'V8 extension, not Web IDL or ECMA-262; a writable data property, so arguably API use';
    mutations.push(r);
  }
  mutations.sort((a, b) => a.target.localeCompare(b.target));
  return { mutations, expandos: expandos.map((e) => stable(e.target)).sort() };
  };
  const raw = await page.evaluate(`${KEY}.collect()`);
  const { mutations, expandos } = await diff(raw);
  let afterTeardown, probe;
  if (await page.evaluate(`typeof window.__corpusTeardown === 'function'`)) {
    await page.evaluate(`Promise.resolve(window.__corpusTeardown())`).catch((e) => pageErrors.push(`teardown: ${String(e.message).slice(0, 300)}`));
    afterTeardown = await diff(await page.evaluate(`${KEY}.collect()`));
  }
  if (await page.evaluate(`typeof window.__corpusProbe === 'function'`)) probe = await page.evaluate(`window.__corpusProbe()`).catch((e) => ({ error: String(e.message).slice(0, 300) }));
  await c.release();
  await context.close();
  return {
    site: site.id,
    url: `${ORIGIN}/index.html`,
    browser: `chromium ${browser.version()}`,
    settleMs: SETTLE,
    snapshot: { holders: raw.holders, descriptors: raw.descriptors },
    mutations,
    // Non-shadowing members added to singleton instances: not findings under issue 03 (add is for prototypes, constructors, namespaces).
    expandos,
    newGlobals: raw.newGlobals.map(stable).sort(),
    workers: [...new Set(workers)].sort(),
    blockedOrigins: [...blocked].sort(),
    // A native-absent run can make page code throw the same error a timing-dependent number of times (New Relic's own
    // MutationObserver callback calls NodeList#forEach before rrweb puts it back), so those runs keep each message once.
    pageErrors: site.run ? [...new Set(pageErrors)] : pageErrors,
    // Only fixture pages carry these, so every other ground-truth file is unchanged.
    ...(afterTeardown ? { afterTeardown } : {}),
    ...(probe !== undefined ? { probe } : {}),
    // Only native-absent runs carry this.
    ...(site.run ? { absent: { run: site.run, members: raw.absent ?? [] } } : {}),
  };
}

const list = await sites();
const browser = await chromium.launch({ headless: true });
const summary = {};
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < list.length) {
    const site = list[next++];
    try {
      const gt = await run(browser, site);
      const id = site.run ? `${site.id}.${site.run}` : site.id;
      const file = join(OUT, `${id}.json`);
      await mkdir(resolve(file, '..'), { recursive: true });
      await writeFile(file, JSON.stringify(gt, null, 1) + '\n');
      const byEffect = {};
      for (const m of gt.mutations) byEffect[m.effect] = (byEffect[m.effect] ?? 0) + 1;
      summary[id] = { mutations: gt.mutations.length, byEffect, workers: gt.workers.length, pageErrors: gt.pageErrors.length, ...(gt.afterTeardown ? { afterTeardown: gt.afterTeardown.mutations.length } : {}) };
      console.log(`ok   ${id}: ${gt.mutations.length} mutations ${JSON.stringify(byEffect)}${gt.pageErrors.length ? ` (${gt.pageErrors.length} page errors)` : ''}`);
    } catch (e) {
      summary[site.run ? `${site.id}.${site.run}` : site.id] = { error: String(e.message).split('\n')[0] };
      console.log(`FAIL ${site.run ? `${site.id}.${site.run}` : site.id}: ${String(e.message).split('\n')[0]}`);
    }
  }
}));
await browser.close();
if (!only) {
  // Native-absent output is written by one invocation per root, so its summary is merged.
  const prior = ABSENT ? JSON.parse(await readFile(join(OUT, 'summary.json'), 'utf8').catch(() => '{}')) : {};
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, 'summary.json'), JSON.stringify(Object.fromEntries(Object.entries({ ...prior, ...summary }).sort()), null, 1) + '\n');
}
