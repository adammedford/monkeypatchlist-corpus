# Validation corpus and runtime ground truth

Throwaway evidence for Validation corpus and runtime ground truth. It exists so R0 precision and recall can be measured. It is not production code.

## Layout

| Path | What it holds |
| --- | --- |
| `apps/<app>/index.js` | One small app per library group. Each one initializes the SDK with every relevant feature switched on. |
| `static-sites/<site>/index.html` | Vendor CDN pages that reference the real CDN URLs, plus `control`, an empty page. |
| `vendor/` | Third-party copies of the CDN scripts, not committed: `npm run vendor` fills it from `sources.json`, which maps each URL to a file and its sha256, and says whether the bytes come from the CDN or from an npm package. |
| `dist/<bundler>/<app>/{maps,nomaps}/` | **Build directories.** Git-ignored; rebuild them with `npm run build`. `nomaps` is `maps` with the `.map` files and `sourceMappingURL` comments removed, so the code is byte-identical. |
| `manifest.json` | sha256 of every file under `dist/`, plus the Node and bundler versions. |
| `ground-truth/<bundler>/<app>/<variant>.json`, `ground-truth/static/<site>.json` | Observed runtime mutations, one file per build directory. `summary.json` holds the counts. |
| `labels/unobserved.json` | Hand labels for mutations that are in the code but did not execute in Chromium. Entries with a `correction` field had their reachability corrected from the exercise variants. |
| `variants/` | Exercise variants: features-on, lazy-chunks and native-absent runs, each with its own ground truth. See [Exercise variants](#exercise-variants-variants). |
| `labels/derived-reachability.json` | Reachability labels derived from where each target was observed in the base run and the variants. Kept apart from the hand labels. |
| `scale/` | The scale fixture for the cost target (§18): one webpack app shell per size, 1, 2.5 and 5 MB, each one link group. See [Scale fixture](#scale-fixture-scale). |

Apps: `sentry-7`, `sentry-10`, `sentry-11`, `sentry-11-no-replay`, `datadog`, `newrelic`, `otel`, `otel-document-load`, `zonejs`, `core-js`, `whatwg-fetch`, `promise-polyfill`, `es6-promise`, `single-spa`, `clarity`, `segment`, `appinsights`.
Bundlers: webpack 5.111.1, esbuild 0.28.2 (IIFE), Rollup 4.63.5 (ESM), and Vite 8.3.1 (Rolldown, ESM).
CDN sites: `sentry-cdn`, `datadog-cdn` (with its two lazy chunks), `newrelic-cdn` (with its four lazy chunks), `appinsights-cdn`.

## Commands

```sh
npm ci                   # the lockfile pins every version exactly
npm run build            # builds dist/ and writes manifest.json
npm run verify           # rebuilds into .verify/ and compares against manifest.json byte for byte
npm run truth            # Chromium ground truth for every build directory and static site (about 4 min)
node scripts/ground-truth.mjs --only webpack/sentry-11   # a subset
```

Both scripts take `--root <dir>` to run against another corpus root with its own `apps/`, `dist/`, `ground-truth/` and optional `vendor/`, `static-sites/` and `routes.json` (canned JSON responses keyed by URL, served before any other routing). The holdout uses this.

`npm run truth` launches Chromium, so it has to run outside the Claude Code sandbox, which blocks Chromium's mach-port registration.

## How ground truth is taken (`scripts/`)

1. **Serving.** Everything is served from disk through Playwright routes. Builds appear at `https://app.corpus.test/`, and CDN URLs are answered from `vendor/` after a sha256 check. Every other request is aborted, and the blocked origins are recorded.
2. **Clean snapshot.** `snapshot.js` runs through `addInitScript` in the main world before any page script. It records own-property descriptors and `[[Prototype]]` for four kinds of holder:
   - the global object
   - every native constructor that has a prototype, and that prototype (interface objects come before legacy factories, so `Option` resolves to `HTMLOptionElement.prototype`)
   - every namespace and platform singleton reachable from the global object
   - a fixed list of nested singletons (`navigator.serviceWorker`, `document.fonts`, …)
   - the window's named properties object, as holder `WindowProperties` (kind `prototype`). It has no interface object, so the constructor pass misses it. At snapshot time its only own key is `[Symbol.toStringTag]`.

   That comes to 1,962 holders and 15,442 descriptors. It changes no native, because the libraries feature-detect through `toString` and descriptors.
3. **Load and settle.** The page loads, the harness waits for `__corpusReady`, clicks a button, and waits a further 3 seconds.
4. **Diff.** Each holder's current state is compared with its snapshot:
   - a key that disappeared → `delete`
   - a data value that changed → `replace`/`wrap`
   - an accessor or attribute that changed → `descriptor-change`
   - a new own key that shadows a member inherited *at snapshot time* → `replace`/`wrap` (or `descriptor-change` when the new key is an accessor), with `shadows` naming the inherited member
   - a new key on a prototype, constructor or namespace → `add`
   - a changed `[[Prototype]]` → `prototype-change`

   **The effect follows the new value** (ADR 0011). An own property whose new descriptor is data, and whose value isn't the native's, is `replace`/`wrap` whatever attributes changed with it. That covers accessor → data (`[Replaceable]` `window.length = 5`), `function fetch(){}` (which also makes it non-configurable) and a polyfill re-creating a deleted native. `descriptor-change` is for a new accessor pair, data → accessor, or attributes alone.

   **Named properties are not writes.** Chromium lists the window's named properties (element ids, the `name` of `embed`/`form`/`img`/`object`/`iframe` elements) as own keys of `WindowProperties`. They come and go with the DOM, so a new `WindowProperties` key with one of those names and a non-function value is skipped. A real write there (`WindowProperties.addEventListener = f`) is a shadow of `EventTarget.prototype.addEventListener`.

   Some changes are listed apart from `mutations` because issue 03 says they are not findings: new non-native globals go to `newGlobals`, and non-shadowing keys added to singletons go to `expandos`. Keys added to `localStorage`/`sessionStorage` are storage writes and are dropped.
5. **Wrap vs replace, through CDP.** A replaced value counts as a `wrap` if the native original can be reached from the new value. The search covers:
   - a proxy `[[Target]]` or a bound `[[TargetFunction]]`
   - the new value's own properties
   - closure variables in every enclosing scope
   - the members of objects held in the innermost closure
   - one level into the closures of functions held in the innermost closure
   - a new key on any holder, or one level inside one (zone.js `__zone_symbol__X`, Clarity `__clr[key]`)

   Proxy targets, bound targets and own function properties are followed transitively, because wrappers stack (Sentry 11 XHR `send` is `Proxy → fill wrapper → native`). `wrapEvidence` records the path it found.
6. **Definition site.** `definedAt` is the `[[FunctionLocation]]` of the new function, the Proxy `apply`/`construct` trap, the bound target, or the new setter. It is given as the script URL, a 1-based line and a 0-based column in the generated file.

Per-load random names are normalized (New Relic `nr@original:<uuid>`, App Insights `_aiDataEvents_…_<rand>`). Two consecutive full runs produce byte-identical `ground-truth/`, with one known exception: Datadog's `blockedOrigins`. Datadog sends its intake request when its batch fills, and whether that happens inside the settle window depends on machine load, so under a full run `https://browser-intake-datadoghq.com` comes and goes on a few Datadog pages. `mutations` and every other field are unaffected.

## Mutation record

```jsonc
{
  "target": "XMLHttpRequest.prototype.send",   // <holder path>.<key>; symbols are written [Symbol.x]
  "holder": "XMLHttpRequest.prototype",
  "holderKind": "prototype",                   // global | constructor | prototype | namespace | singleton
  "interface": "XMLHttpRequest",
  "key": "send",
  "change": "value",                           // raw diff: value | descriptor | shadow | add | delete | prototype
  "effect": "wrap",                            // replace | wrap | add | delete | descriptor-change | prototype-change
  "before": { "kind": "data", "type": "function", "writable": true, "enumerable": true, "configurable": true },
  "after":  { … },
  "shadows": "History.prototype.pushState",   // only when change = shadow
  "wrapEvidence": "proxy-target->own:__sentry_original__",
  "definedAt": { "url": "https://app.corpus.test/main.c746d2e4.js", "line": 1, "column": 72904 },
  "boundaryNote": "…"                          // only on V8 extensions such as Error.stackTraceLimit
}
```

## Caveats

- **Only one runtime.** Chromium 153 (Playwright 1.63, headless shell). A guard that skips in Chromium is unobserved, and `labels/unobserved.json` covers those cases.
- **Only the window realm is covered.** Init scripts do not run in workers. Sentry and Datadog each start a `blob:` worker (listed in `workers`) whose realm is not snapshotted.
- **Deferred or interaction-only installs** appear only if they happen within the settle window and the single click. Nothing else is exercised: no navigation, no errors, no WebSocket use.
- **Wrap detection is a heuristic.** An original held more than about two hops away, or in a heap structure outside the closure, is classed as `replace`. One known miss: core-js's `Function.prototype.toString` is recorded as `replace`, but it delegates to the native through `inspectSource` → `uncurryThis(Function.prototype.toString)`, which is deeper than the search goes. Otherwise, the only `replace` records are `Error.stackTraceLimit` (a number).
- **`definedAt` is where the replacement function was defined,** not the statement that assigned it. The two agree inside one bundle but can differ when a helper in one script installs a function from another. Deletes, attribute-only changes and non-function values have no `definedAt`.
- **The Datadog CDN recorder chunk loads only when the script tag is CORS-mode** (`crossorigin`). Without it, dynamic `import('./chunks/…')` fails in a no-cors classic script, and session replay never installs its 9 targets.
- **Some Sentry records need boundary rulings.** `Error.stackTraceLimit` is a V8 extension and is flagged with `boundaryNote`. `document.__sentry_instrumentation_handlers__` is kept apart in `expandos`.

## Fixture pages (`fixtures/`)

A second corpus root for Chromium fixture pages for restores and ineffective writes: 34 static pages. There is one per restore idiom, one per (reason × mechanism) cell of the ineffective-write outcome table in spec §3, and controls for writes that do take effect or are API use. `fixtures/pages.mjs` generates `static-sites/` and `expectations.json` from one table. The table follows spec §3:

- The named-setter and WindowProperties pages are controls. The reasons `named-setter` and `named-properties-object` are retired.
- `var` takes the assign reasons.
- Every expected ineffective record states `throws`.
- `ineffective-storage-readonly-assign` and `control-declare-var-setter` are new.

Chromium 153 matches every page's runtime expectation, and two runs are byte-identical.

Expectations read `target|effect` for findings and diffs, and `target|reason|throws` for ineffective writes (`throws`: `always`, `strict-only` or `never`). `fixtures/resolver-check.json` and the prototype checker predate this table: the checker reads ineffective writes as `target|reason`. The production check is `npm run fixtures:check` in the scanner repo.

| Page | Idiom or cell | Chromium diff | Resolver |
| --- | --- | --- | --- |
| `restore-local-capture` | local capture | `XMLHttpRequest.prototype.open\|wrap`; after teardown: nothing | findings `XMLHttpRequest.prototype.open\|wrap`; restore `XMLHttpRequest.prototype.open` |
| `restore-closure-capture` | closure capture (rrweb patch) | `Window.fetch\|wrap`; after teardown: nothing | findings `Window.fetch\|wrap`; restore `Window.fetch` |
| `restore-two-level-helper` | parameter through a two-level helper (Datadog instrumentMethod) | `History.prototype.pushState\|wrap`; after teardown: nothing | findings `History.prototype.pushState\|wrap`; restore `History.prototype.pushState` |
| `restore-descriptor-dead-fallback` | descriptor restore with a dead catalog fallback (rrweb hookSetter) | `HTMLInputElement.prototype.value\|descriptor-change`; after teardown: nothing | findings `HTMLInputElement.prototype.value\|descriptor-change`; restore `HTMLInputElement.prototype.value` |
| `restore-identity-guarded` | identity-guarded restore (Datadog, OpenTelemetry) | `Window.open\|wrap`; after teardown: nothing | findings `Window.open\|wrap`; restore `Window.open` |
| `restore-shadow-residue` | shadowing residue (rrweb/PostHog patch(history, …)) | `history.pushState\|wrap`; after teardown: `history.pushState\|shadow` | findings `history.pushState\|wrap`; restore `history.pushState` |
| `restore-heap-carried` | heap-carried original (a proven restore) | `console.log\|wrap`; after teardown: nothing | findings `console.log\|wrap`; restore `console.log` |
| `ineffective-readonly-assign` | readonly × assign | nothing | ineffective `navigator.userAgent\|readonly\|strict-only`, `Window.top\|readonly\|strict-only` |
| `ineffective-readonly-declare` | readonly × declare (var with initializer) | nothing | ineffective `Window.closed\|readonly\|strict-only` |
| `ineffective-readonly-declare-unforgeable` | readonly × declare, [LegacyUnforgeable] (var top = 1) | nothing | ineffective `Window.top\|readonly\|strict-only` |
| `ineffective-lenient-setter-assign` | lenient-setter × assign | nothing | ineffective `document.fullscreen\|lenient-setter\|never`, `document.fullscreenEnabled\|lenient-setter\|never` |
| `ineffective-non-writable-assign` | non-writable × assign | nothing | ineffective `Math.PI\|non-writable\|strict-only`, `Node.ELEMENT_NODE\|non-writable\|strict-only`, `Array.prototype\|non-writable\|strict-only` |
| `ineffective-non-writable-declare` | non-writable × declare (var with initializer) | nothing | ineffective `Window.NaN\|non-writable\|strict-only`, `Window.undefined\|non-writable\|strict-only`, `Window.Infinity\|non-writable\|strict-only` |
| `ineffective-non-configurable-define` | non-configurable × define | nothing | ineffective `Math.PI\|non-configurable\|always`, `Node.ELEMENT_NODE\|non-configurable\|always`, `Window.document\|non-configurable\|always`, `Window.top\|non-configurable\|always` |
| `ineffective-non-configurable-delete` | non-configurable × delete | nothing | ineffective `Math.PI\|non-configurable\|strict-only`, `Node.ELEMENT_NODE\|non-configurable\|strict-only`, `Array.prototype\|non-configurable\|strict-only`, `Window.document\|non-configurable\|strict-only` |
| `ineffective-non-configurable-declare` | non-configurable × declare (function/let/const/class) | nothing; 5 page errors | ineffective `Window.top\|non-configurable\|always`, `Window.document\|non-configurable\|always`, `Window.location\|non-configurable\|always`, `Window.window\|non-configurable\|always`, `Window.NaN\|non-configurable\|always` |
| `ineffective-immutable-prototype-setprototypeof` | immutable-prototype × setPrototypeOf | nothing | ineffective `Object.prototype.[[Prototype]]\|immutable-prototype\|always`, `Window.[[Prototype]]\|immutable-prototype\|always`, `Window.prototype.[[Prototype]]\|immutable-prototype\|always`, `EventTarget.prototype.[[Prototype]]\|immutable-prototype\|always` |
| `ineffective-immutable-prototype-proto-assign` | immutable-prototype × assign to __proto__ (setPrototypeOf through the Object.prototype.__proto__ setter) | nothing | ineffective `Window.[[Prototype]]\|immutable-prototype\|always`, `Object.prototype.[[Prototype]]\|immutable-prototype\|always` |
| `ineffective-immutable-prototype-location` | immutable-prototype × setPrototypeOf on Location (HTML [[SetPrototypeOf]]) | nothing | ineffective `location.[[Prototype]]\|immutable-prototype\|always` |
| `ineffective-immutable-prototype-windowproperties` | immutable-prototype × setPrototypeOf on WindowProperties | nothing; probe `{"protoUnchanged":true}` | ineffective `WindowProperties.[[Prototype]]\|immutable-prototype\|always` |
| `ineffective-storage-readonly-assign` | readonly × assign on a Storage singleton (named-setter object) | nothing | ineffective `localStorage.length\|readonly\|strict-only` |
| `control-define-configurable-accessor` | readonly attribute × define (configurable, so effective) | `navigator.userAgent\|descriptor-change` | findings `navigator.userAgent\|descriptor-change` |
| `control-idl-setter` | IDL setter × assign (API use) | nothing | nothing |
| `control-replaceable-assign` | [Replaceable] × assign (mutation) | `Window.length\|replace` | findings `Window.length\|replace` |
| `control-declare-configurable-global` | declare over a configurable global (replace) | `Window.fetch\|replace` | findings `Window.fetch\|replace` |
| `control-named-setter-setprototypeof` | named-setter object × setPrototypeOf (prototype-change) | `localStorage.[[Prototype]]\|prototype-change` | findings `localStorage.[[Prototype]]\|prototype-change` |
| `control-named-setter-assign` | named-setter object × assign of a name on its chain (shadowing write) | `localStorage.setItem\|replace`, `sessionStorage.getItem\|replace` | findings `localStorage.setItem\|replace`, `sessionStorage.getItem\|replace` |
| `control-named-setter-define` | named-setter object × define of a name on its chain (shadowing write) | `localStorage.setItem\|replace` | findings `localStorage.setItem\|replace` |
| `control-named-setter-delete` | named-setter object × delete of an inherited name (changes no native) | nothing | nothing |
| `control-named-properties-object-assign` | WindowProperties × assign of a name on its chain (shadowing write) | `WindowProperties.addEventListener\|replace` | findings `WindowProperties.addEventListener\|replace` |
| `control-named-properties-object-define` | WindowProperties × define of a name on its chain (shadowing write) | `WindowProperties.addEventListener\|replace` | findings `WindowProperties.addEventListener\|replace` |
| `control-named-properties-object-delete` | WindowProperties × delete of a named element (not a target) | nothing; probe `{"namedStillVisible":true}` | nothing |
| `control-declare-var-setter` | declare × a setter (var name = 'x' calls the setter: API use) | nothing | nothing |
| `control-new-global` | new non-native globals (not findings) | nothing | nothing |

```sh
node fixtures/pages.mjs                                                # regenerate pages + expectations
node scripts/ground-truth.mjs --root fixtures --settle 300             # outside the sandbox, about 20 s
(cd ../prototypes/resolver && node fixture-pages.mjs)                  # Chromium vs expectations vs resolver
```

Two optional page hooks, used only by fixture pages, so other ground-truth files are unchanged. A page that defines `window.__corpusTeardown` is diffed a second time after the harness calls it (`afterTeardown: {mutations, expandos}`). A page that defines `window.__corpusProbe` has its return value recorded as `probe`; the WindowProperties pages used it before the harness snapshotted that object.

## Exercise variants (`variants/`)

For Exercise variants and label corrections for the corpus. The base corpus is untouched: its `apps/`, `dist/` and `ground-truth/` are byte-identical, and every variant writes to its own directory.

| Variant | Root | What changes | Ground truth |
| --- | --- | --- | --- |
| features-on | `variants/features-on/` (own `apps/`, `dist/`, `manifest.json`) | The base app with every off-by-default option that installs a mutation enabled. Each `index.js` cites the option's default and gate. `core-js` forces its polyfills through `core-js/configurator`; `core-js--members` does the same with the native Promise constructor kept, because forcing the constructor moves the Promise statics onto core-js's own constructor. | `variants/features-on/ground-truth/<bundler>/<app>/<maps\|nomaps>.json` |
| lazy-chunks | `variants/lazy-chunks/` (same layout) | The least config that makes the SDK load its own lazy chunks: New Relic `session_replay.enabled` + `preload` (recorder and replay-aggregate chunks), Datadog `profilingSampleRate` (profiler chunk; the recorder already loads in the base run). | `variants/lazy-chunks/ground-truth/…` |
| native-absent | `variants/native-absent/natives.json` (no builds of its own) | The **base** build directories, unchanged, with the natives each library feature-tests deleted before load. New Relic's list runs on the lazy-chunks builds, because its guards are in the recorder chunk. | `variants/native-absent/ground-truth/<bundler>/<app>/<maps\|nomaps>.<run>.json` |

```sh
node scripts/build.mjs --root variants/features-on          # and --verify; same for variants/lazy-chunks
node scripts/ground-truth.mjs --root variants/features-on   # outside the sandbox; same for variants/lazy-chunks
node scripts/ground-truth.mjs --absent variants/native-absent/natives.json --out variants/native-absent/ground-truth
node scripts/ground-truth.mjs --root variants/lazy-chunks --absent variants/native-absent/natives.json --out variants/native-absent/ground-truth
node scripts/variants.mjs --triage ../prototypes/resolver/out/full-triage.json   # derived labels + variants/report.json
```

**The native-absent list** (`variants/native-absent/natives.json`) is hand-curated from each library's guard code, never from resolver output. Each entry names the target to delete, quotes the guard, and cites it as `package@version path Lline`. A library has several runs where its guards interlock, and the file says why for each split.

**Deletion and the clean snapshot.** `ground-truth.mjs --absent` registers `scripts/absent.js` as a second init script, so it runs after `snapshot.js` and before any page script. The order is deliberate. The snapshot is taken first, on the unmutated natives, so every holder is found (deleting `EventTarget` or `CSSGroupingRule` first would drop their prototypes from the holder list) and every deleted member keeps its clean descriptor. `absent.js` then deletes the members and registers each one with the collector, which treats it as **absent at snapshot time**:

- still missing after load: the harness's own deletion, so no `delete` record
- back after load: a library write, recorded against the clean native's descriptor (so its effect reads as it would in Chromium, as in `unobserved.json`), with `absentAtLoad: true`. If the value written back is the native itself (rrweb's `NodeList.prototype.forEach = Array.prototype.forEach`), the record also has `sameAsNative: true`.
- inherited lookups skip deleted members, so a new own key is only a `shadow` of a member that was really there

Each native-absent file has an `absent` block listing what was deleted. Its `pageErrors` are deduplicated, because a deleted native can make page code throw a timing-dependent number of times.

**Other harness options** (none of them changes base output): `--out <dir>` writes ground truth elsewhere; `routes.json` keys ending in `*` match by prefix and may add `headers`; dot-directories under `dist/` are skipped.

**`scripts/variants.mjs`** writes `labels/derived-reachability.json` from runtime ground truth only: observed in the base run → `not-guarded-native-absence`; only in native-absent → `guarded-native-absence`; only with features on or lazy chunks → `conditional`; both ways → `conditional`. It also writes `variants/report.json`: bundler invariance per (variant, app, run), conflicts between derived and hand labels, and, with `--triage`, which dormant resolver findings each variant reaches.

Caveats:

- CDN sites have no variants. The npm builds carry the same library versions.
- `esbuild/core-js` fails the `array-symbol-iterator` run: the esbuild bundle destructures an array before core-js loads, so it can't start without `Array.prototype[Symbol.iterator]`.
- The Datadog profiler chunk loads, but the profiler can't start without a `Document-Policy: js-profiling` header. A static read of the chunk finds no instrumentation.

## Scale fixture (`scale/`)

The synthetic fixture the cost target (spec §18) is measured on. It is its own corpus root, so the base corpus is untouched. Each variant is one app shell, bundled by webpack alone with code splitting. The shell loads every module through a dynamic `import()`, one after another in a fixed order, then sets `__corpusReady`. So each build directory is **one link group**: one entry script whose chunk loader names every other chunk.

| Variant | SDKs (base configs) | Filler | Uncompressed JS | Files |
| --- | --- | --- | --- | --- |
| `1mb` | `core-js`, `zonejs`, `clarity`, `newrelic`, `segment`, `sentry-11` | none | 1.04 MB | 40 |
| `2.5mb` | all 17 | `react`, `react-dom/client`, `lodash` | 2.44 MB | 63 |
| `5mb` | all 17 | the above plus `rxjs`, `moment`, `d3`, `chart.js/auto`, `three`, `echarts` | 5.19 MB | 70 |

Sizes are the `nomaps` directory's `.js` bytes, in 10⁶ bytes. All 17 SDKs come to only about 2.3 MB, so the larger variants are filled with widely used libraries that are not corpus SDKs. They are pinned exactly in `scale/package.json` and `scale/package-lock.json`, and installed into `scale/node_modules`. The SDKs themselves resolve from the corpus root's `node_modules`.

- `scale/generate.mjs` writes `scale/apps/<variant>/index.js` and `scale/sdk/<app>.js` from one table. Each SDK module is the corpus app's `index.js` with its `__corpusReady` line removed, so only the shell says when the page is ready. Polyfills load first, then zone.js, then the rest by name.
- `scale/manifest.json` pins every file under `scale/dist/`, like the variant manifests.
- `scale/check.mjs` checks that each build directory is one link group: one `<script>` in `index.html`, every other `.js` file pushes onto this build's chunk registry, and the entry names its content hash.

```sh
(cd scale && npm ci)
node scale/generate.mjs
node scripts/build.mjs --root scale --bundlers webpack             # and --verify
node scale/check.mjs
node scripts/ground-truth.mjs --root scale                         # outside the sandbox, about 30 s
```

**Ground truth** (`scale/ground-truth/webpack/<variant>/<maps|nomaps>.json`). It was first taken with an older harness and retaken with the revised one. Each variant's target set is exactly the union of its SDKs' base webpack ground truth, and there are no page errors. The filler adds no mutation, and installing the SDKs side by side loses none. Two runs are byte-identical.

## Holdout

The holdout is a second, encrypted corpus that the resolver is scored against only once, after it is frozen. It is kept in a private repository and is not part of this one. It is built and run with the same harness (`--root holdout`).

## Setup

```
npm ci
npm run vendor    # downloads the CDN copies and extracts the npm ones into vendor/, each checked against its sha256
npm run build
```

`vendor/` holds third-party code, so none of it is committed. The New Relic and Sentry CDN bundles are downloaded from their versioned URLs. The Datadog and Application Insights copies are byte-identical to files in their npm packages, because their CDN URLs are not version-pinned, so they are copied out of `node_modules/`.

## License

The apps, fixture pages, scripts, ground truth and labels are Apache-2.0 ([LICENSE](LICENSE)). The vendored SDKs keep their own licenses.
