// Fixture pages: one page per restore idiom and per meaningful (reason × mechanism)
// cell of the ineffective-write outcome table, plus controls that take effect.
// restore-heap-carried expects a proven restore; its page and runtime expectation are unchanged.
// The outcome table of spec §3 (ADR 0011). Named-setter and named-properties-object
// writes are controls (reasons `named-setter` and `named-properties-object` are retired), `var` takes the assign row, and every
// ineffective record states `throws`. The harness snapshots WindowProperties, so the assign/define pages no longer need a probe.
// Writes static-sites/<name>/index.html and expectations.json. Run: node fixtures/pages.mjs
// Each entry of `scripts` becomes its own classic <script> (a declaration that throws only stops its own script).
// Restore sites are marked /*R{*/ … /*}R*/ so a checker can find their offsets.
// Expectations are hand-derived from the rulings and ECMAScript/WebIDL semantics, before running Chromium:
//   runtime.install        `${target}|${effect}` of the diff after load
//   runtime.afterTeardown  `${target}|${change}` of the diff after window.__corpusTeardown()
//   runtime.probe          the page's own check of state the diff does not show (an unchanged prototype, a named element)
//   resolver.findings      `${target}|${effect}`; resolver.ineffective `${target}|${reason}|${throws}`; resolver.restores [target]
//                          (throws: always | strict-only | never, spec §3)
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WP = 'var WP = Object.getPrototypeOf(Window.prototype);';

export const PAGES = [
  // ---- restores. Install runs at load; the harness calls the teardown after the first diff.
  { name: 'restore-local-capture', kind: 'restore', idiom: 'local capture',
    scripts: [`var o = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function () { return o.apply(this, arguments); };
function teardown() { /*R{*/XMLHttpRequest.prototype.open = o;/*}R*/ }
window.__corpusTeardown = teardown;`],
    runtime: { install: ['XMLHttpRequest.prototype.open|wrap'], afterTeardown: [] },
    resolver: { findings: ['XMLHttpRequest.prototype.open|wrap'], restores: ['XMLHttpRequest.prototype.open'] } },
  { name: 'restore-closure-capture', kind: 'restore', idiom: 'closure capture (rrweb patch)',
    scripts: [`function patch(s, n, f) { var orig = s[n]; s[n] = f(orig); return function () { /*R{*/s[n] = orig;/*}R*/ }; }
window.__corpusTeardown = patch(window, 'fetch', function (o) { return function () { return o.apply(this, arguments); }; });`],
    runtime: { install: ['Window.fetch|wrap'], afterTeardown: [] },
    resolver: { findings: ['Window.fetch|wrap'], restores: ['Window.fetch'] } },
  { name: 'restore-two-level-helper', kind: 'restore', idiom: 'parameter through a two-level helper (Datadog instrumentMethod)',
    scripts: [`function repl(t, m, orig, inst) { t[m] = inst; return { stop: function () { if (t[m] === inst) { /*R{*/t[m] = orig;/*}R*/ } } }; }
function instrument(t, m) { var orig = t[m]; return repl(t, m, orig, function () { return orig.apply(this, arguments); }); }
window.__corpusTeardown = instrument(History.prototype, 'pushState').stop;`],
    runtime: { install: ['History.prototype.pushState|wrap'], afterTeardown: [] },
    resolver: { findings: ['History.prototype.pushState|wrap'], restores: ['History.prototype.pushState'] } },
  { name: 'restore-descriptor-dead-fallback', kind: 'restore', idiom: 'descriptor restore with a dead catalog fallback (rrweb hookSetter)',
    scripts: [`function hook(t, k) {
  var d = Object.getOwnPropertyDescriptor(t, k);
  Object.defineProperty(t, k, { set: function (v) { d.set.call(this, v); } });
  return function () { /*R{*/Object.defineProperty(t, k, d || {});/*}R*/ };
}
window.__corpusTeardown = hook(HTMLInputElement.prototype, 'value');`],
    runtime: { install: ['HTMLInputElement.prototype.value|descriptor-change'], afterTeardown: [] },
    resolver: { findings: ['HTMLInputElement.prototype.value|descriptor-change'], restores: ['HTMLInputElement.prototype.value'] } },
  { name: 'restore-identity-guarded', kind: 'restore', idiom: 'identity-guarded restore (Datadog, OpenTelemetry)',
    scripts: [`var orig = window.open;
var mine = function () { return orig.apply(this, arguments); };
window.open = mine;
function teardown() { if (window.open === mine) { /*R{*/window.open = orig;/*}R*/ } }
window.__corpusTeardown = teardown;`],
    runtime: { install: ['Window.open|wrap'], afterTeardown: [] },
    resolver: { findings: ['Window.open|wrap'], restores: ['Window.open'] } },
  { name: 'restore-shadow-residue', kind: 'restore', idiom: 'shadowing residue (rrweb/PostHog patch(history, …))',
    scripts: [`var o = history.pushState;
history.pushState = function () { return o.apply(this, arguments); };
window.__corpusTeardown = function () { /*R{*/history.pushState = o;/*}R*/ };`],
    runtime: { install: ['history.pushState|wrap'], afterTeardown: ['history.pushState|shadow'] },
    resolver: { findings: ['history.pushState|wrap'], restores: ['history.pushState'] } },
  { name: 'restore-heap-carried', kind: 'restore', idiom: 'heap-carried original (a proven restore)',
    scripts: [`var saved = {};
saved.log = console.log;
console.log = function () { return saved.log.apply(console, arguments); };
window.__corpusTeardown = function () { /*R{*/console.log = saved.log;/*}R*/ };`],
    runtime: { install: ['console.log|wrap'], afterTeardown: [] },
    // The restore rule has no heap exclusion: a write whose value is, on every path, the unmutated native of the
    // same member is a restore however it travelled, heap fields included. So only the install finding, and a restore
    // entry at the site. (Was the negative case: `wrap` + a second `replace` finding, no restore entry.)
    resolver: { findings: ['console.log|wrap'], restores: ['console.log'] } },

  // ---- ineffective writes (spec §3 outcome table, its declare row included). Runtime diff must be empty.
  { name: 'ineffective-readonly-assign', kind: 'ineffective', cell: 'readonly × assign',
    scripts: [`navigator.userAgent = 'fixture';
window.top = 1;`, `'use strict';
try { navigator.userAgent = 'fixture'; } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['navigator.userAgent|readonly|strict-only', 'Window.top|readonly|strict-only'] } },
  { name: 'ineffective-readonly-declare', kind: 'ineffective', cell: 'readonly × declare (var with initializer)',
    scripts: ['var closed = 1;'],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['Window.closed|readonly|strict-only'] } },
  { name: 'ineffective-readonly-declare-unforgeable', kind: 'ineffective', cell: 'readonly × declare, [LegacyUnforgeable] (var top = 1)',
    scripts: ['var top = 1;'],
    runtime: { install: [] },
    // `var` takes the assign row (§3): the accessor has no setter, so the write fails, and throws only in strict code.
    resolver: { findings: [], ineffective: ['Window.top|readonly|strict-only'] } },
  { name: 'ineffective-lenient-setter-assign', kind: 'ineffective', cell: 'lenient-setter × assign',
    scripts: [`document.fullscreen = true;
document.fullscreenEnabled = false;`, `'use strict';
document.fullscreen = true;`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['document.fullscreen|lenient-setter|never', 'document.fullscreenEnabled|lenient-setter|never'] } },
  { name: 'ineffective-non-writable-assign', kind: 'ineffective', cell: 'non-writable × assign',
    scripts: [`Math.PI = 3;
Node.ELEMENT_NODE = 9;
Array.prototype = {};`, `'use strict';
try { Math.PI = 3; } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['Math.PI|non-writable|strict-only', 'Node.ELEMENT_NODE|non-writable|strict-only', 'Array.prototype|non-writable|strict-only'] } },
  { name: 'ineffective-non-writable-declare', kind: 'ineffective', cell: 'non-writable × declare (var with initializer)',
    scripts: ['var NaN = 1;', 'var undefined = 1;', 'var Infinity = 1;'],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['Window.NaN|non-writable|strict-only', 'Window.undefined|non-writable|strict-only', 'Window.Infinity|non-writable|strict-only'] } },
  { name: 'ineffective-non-configurable-define', kind: 'ineffective', cell: 'non-configurable × define',
    scripts: [`try { Object.defineProperty(Math, 'PI', { value: 3 }); } catch (e) {}
try { Object.defineProperty(Node, 'ELEMENT_NODE', { value: 9 }); } catch (e) {}
try { Object.defineProperty(window, 'document', { value: {} }); } catch (e) {}
try { Object.defineProperty(window, 'top', { get: function () { return null; } }); } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['Math.PI|non-configurable|always', 'Node.ELEMENT_NODE|non-configurable|always', 'Window.document|non-configurable|always', 'Window.top|non-configurable|always'] } },
  { name: 'ineffective-non-configurable-delete', kind: 'ineffective', cell: 'non-configurable × delete',
    scripts: [`delete Math.PI;
delete Node.ELEMENT_NODE;
delete Array.prototype;
delete window.document;`, `'use strict';
try { delete Math.PI; } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['Math.PI|non-configurable|strict-only', 'Node.ELEMENT_NODE|non-configurable|strict-only', 'Array.prototype|non-configurable|strict-only', 'Window.document|non-configurable|strict-only'] } },
  { name: 'ineffective-non-configurable-declare', kind: 'ineffective', cell: 'non-configurable × declare (function/let/const/class)',
    scripts: ['function top() {}', 'let document = 1;', 'const location = 1;', 'class window {}', 'function NaN() {}'],
    runtime: { install: [], pageErrors: 5 },
    // Each script fails before it runs. ECMA-262 makes `function top`/`function NaN` a TypeError and `let`/`const`/`class` a
    // SyntaxError; Chromium 153 throws a SyntaxError for all five ("Identifier 'top' has already been declared"). Either way: always.
    resolver: { findings: [], ineffective: ['Window.top|non-configurable|always', 'Window.document|non-configurable|always', 'Window.location|non-configurable|always', 'Window.window|non-configurable|always', 'Window.NaN|non-configurable|always'] } },
  { name: 'ineffective-immutable-prototype-setprototypeof', kind: 'ineffective', cell: 'immutable-prototype × setPrototypeOf',
    scripts: [`try { Object.setPrototypeOf(Object.prototype, Object.create(null)); } catch (e) {}
try { Object.setPrototypeOf(window, Object.create(null)); } catch (e) {}
try { Object.setPrototypeOf(Window.prototype, Object.create(null)); } catch (e) {}
try { Object.setPrototypeOf(EventTarget.prototype, Object.create(null)); } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['Object.prototype.[[Prototype]]|immutable-prototype|always', 'Window.[[Prototype]]|immutable-prototype|always', 'Window.prototype.[[Prototype]]|immutable-prototype|always', 'EventTarget.prototype.[[Prototype]]|immutable-prototype|always'] } },
  { name: 'ineffective-immutable-prototype-proto-assign', kind: 'ineffective', cell: 'immutable-prototype × assign to __proto__ (setPrototypeOf through the Object.prototype.__proto__ setter)',
    scripts: [`try { window.__proto__ = Object.create(null); } catch (e) {}
try { Object.prototype.__proto__ = Object.create(null); } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['Window.[[Prototype]]|immutable-prototype|always', 'Object.prototype.[[Prototype]]|immutable-prototype|always'] } },
  { name: 'ineffective-immutable-prototype-location', kind: 'ineffective', cell: 'immutable-prototype × setPrototypeOf on Location (HTML [[SetPrototypeOf]])',
    scripts: [`try { Object.setPrototypeOf(location, Object.create(null)); } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['location.[[Prototype]]|immutable-prototype|always'] } },
  { name: 'ineffective-immutable-prototype-windowproperties', kind: 'ineffective', cell: 'immutable-prototype × setPrototypeOf on WindowProperties',
    scripts: [`${WP}
try { Object.setPrototypeOf(WP, Object.create(null)); } catch (e) {}
window.__corpusProbe = function () { return { protoUnchanged: Object.getPrototypeOf(WP) === EventTarget.prototype }; };`],
    runtime: { install: [], probe: { protoUnchanged: true } },
    resolver: { findings: [], ineffective: ['WindowProperties.[[Prototype]]|immutable-prototype|always'] } },
  { name: 'ineffective-storage-readonly-assign', kind: 'ineffective', cell: 'readonly × assign on a Storage singleton (named-setter object)',
    scripts: ['localStorage.length = 5;', `'use strict';
try { localStorage.length = 5; } catch (e) {}`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: ['localStorage.length|readonly|strict-only'] } },
  // ---- controls: writes the rulings say do take effect (or are API use), from fixtures.mjs plus two boundary cells.
  { name: 'control-define-configurable-accessor', kind: 'control', cell: 'readonly attribute × define (configurable, so effective)',
    scripts: [`Object.defineProperty(navigator, 'userAgent', { get: function () { return 'fixture'; } });`],
    runtime: { install: ['navigator.userAgent|descriptor-change'] },
    resolver: { findings: ['navigator.userAgent|descriptor-change'], ineffective: [] } },
  { name: 'control-idl-setter', kind: 'control', cell: 'IDL setter × assign (API use)',
    scripts: [`window.onerror = function () {};
document.title = 'fixture';`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: [] } },
  { name: 'control-replaceable-assign', kind: 'control', cell: '[Replaceable] × assign (mutation)',
    scripts: ['window.length = 5;'],
    runtime: { install: ['Window.length|replace'] },
    resolver: { findings: ['Window.length|replace'], ineffective: [] } },
  { name: 'control-declare-configurable-global', kind: 'control', cell: 'declare over a configurable global (replace)',
    scripts: ['function fetch() {}'],
    runtime: { install: ['Window.fetch|replace'] },
    resolver: { findings: ['Window.fetch|replace'], ineffective: [] } },
  { name: 'control-named-setter-setprototypeof', kind: 'control', cell: 'named-setter object × setPrototypeOf (prototype-change)',
    scripts: ['Object.setPrototypeOf(localStorage, Object.create(Storage.prototype));'],
    runtime: { install: ['localStorage.[[Prototype]]|prototype-change'] },
    resolver: { findings: ['localStorage.[[Prototype]]|prototype-change'], ineffective: [] } },
  { name: 'control-named-setter-assign', kind: 'control', cell: 'named-setter object × assign of a name on its chain (shadowing write)',
    scripts: [`localStorage.setItem = function () {};
sessionStorage.getItem = function () {};`],
    runtime: { install: ['localStorage.setItem|replace', 'sessionStorage.getItem|replace'] },
    resolver: { findings: ['localStorage.setItem|replace', 'sessionStorage.getItem|replace'], ineffective: [] } },
  { name: 'control-named-setter-define', kind: 'control', cell: 'named-setter object × define of a name on its chain (shadowing write)',
    scripts: [`try { Object.defineProperty(localStorage, 'setItem', { value: function () {} }); } catch (e) {}`],
    runtime: { install: ['localStorage.setItem|replace'] },
    resolver: { findings: ['localStorage.setItem|replace'], ineffective: [] } },
  { name: 'control-named-setter-delete', kind: 'control', cell: 'named-setter object × delete of an inherited name (changes no native)',
    scripts: ['delete localStorage.setItem;'],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: [] } },
  { name: 'control-named-properties-object-assign', kind: 'control', cell: 'WindowProperties × assign of a name on its chain (shadowing write)',
    scripts: [`${WP}
WP.addEventListener = function () {};`],
    runtime: { install: ['WindowProperties.addEventListener|replace'] },
    resolver: { findings: ['WindowProperties.addEventListener|replace'], ineffective: [] } },
  { name: 'control-named-properties-object-define', kind: 'control', cell: 'WindowProperties × define of a name on its chain (shadowing write)',
    scripts: [`${WP}
try { Object.defineProperty(WP, 'addEventListener', { value: function () {} }); } catch (e) {}`],
    runtime: { install: ['WindowProperties.addEventListener|replace'] },
    resolver: { findings: ['WindowProperties.addEventListener|replace'], ineffective: [] } },
  { name: 'control-named-properties-object-delete', kind: 'control', cell: 'WindowProperties × delete of a named element (not a target)',
    body: '<div id="corpusNamed"></div>',
    scripts: [`${WP}
delete WP.corpusNamed;
window.__corpusProbe = function () { return { namedStillVisible: window.corpusNamed === document.getElementById('corpusNamed') }; };`],
    runtime: { install: [], probe: { namedStillVisible: true } },
    resolver: { findings: [], ineffective: [] } },
  { name: 'control-declare-var-setter', kind: 'control', cell: 'declare × a setter (var name = \'x\' calls the setter: API use)',
    scripts: [`var name = 'x';`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: [] } },
  { name: 'control-new-global', kind: 'control', cell: 'new non-native globals (not findings)',
    scripts: [`window.myLib = {};
self.webpackChunkapp = [];`],
    runtime: { install: [] },
    resolver: { findings: [], ineffective: [] } },
];

const html = (p) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>fixture: ${p.name}</title></head>
<body>
<h1>${p.name}</h1>
<button id="corpus-button" type="button">click</button>
${p.body ? p.body + '\n' : ''}${p.scripts.map((s) => `<script>\n${s}\n</script>\n`).join('')}<script>window.__corpusReady = true;</script>
</body>
</html>
`;

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const p of PAGES) {
    const dir = join(HERE, 'static-sites', p.name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), html(p));
  }
  const exp = PAGES.map(({ scripts, body, ...rest }) => rest);
  await writeFile(join(HERE, 'expectations.json'), JSON.stringify(exp, null, 1) + '\n');
  console.log(`${PAGES.length} pages`);
}
