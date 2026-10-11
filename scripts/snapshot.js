// Injected with addInitScript, so it runs in the main world before any page script.
// It records the clean own-property descriptors and [[Prototype]] of every native holder reachable
// from the global object, and leaves a collector that diffs them after load.
// It must not modify any native, because libraries feature-detect (toString, descriptors) before patching.
(() => {
  const KEY = Symbol.for('patchline.corpus');
  const R = Reflect;
  const ownKeys = R.ownKeys, gopd = R.getOwnPropertyDescriptor, getProto = R.getPrototypeOf, apply = R.apply;
  const fnToString = Function.prototype.toString;
  const isNative = (f) => { try { return /\{\s*\[native code\]\s*\}\s*$/.test(apply(fnToString, f, [])); } catch { return false; } };
  const keyName = (k) => (typeof k === 'symbol' ? `[${k.description}]` : k);
  const g = globalThis;
  const SKIP = new Set(['window', 'self', 'globalThis', 'frames', 'top', 'parent', 'opener', 'frameElement']);
  // Nested singletons that are not own properties of the global object.
  const NESTED = [
    ['navigator', 'serviceWorker'], ['navigator', 'geolocation'], ['navigator', 'clipboard'], ['navigator', 'storage'],
    ['navigator', 'mediaDevices'], ['navigator', 'permissions'], ['navigator', 'locks'], ['navigator', 'userActivation'],
    ['document', 'fonts'], ['document', 'documentElement'], ['document', 'head'], ['document', 'body'],
  ];
  // Instances whose added own keys are data writes, not mutations (Storage named setter; issue 03 amendment).
  const DATA_INSTANCES = new Set(['localStorage', 'sessionStorage']);

  const holders = []; // { path, kind, iface, obj, proto, desc: Map(key -> descriptor) }
  const byObj = new Map();
  const protoOwner = new Map(); // prototype object -> interface name
  const snap = (path, kind, obj, iface) => {
    if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function') || byObj.has(obj)) return;
    const desc = new Map();
    for (const k of ownKeys(obj)) desc.set(k, gopd(obj, k));
    const h = { path, kind, iface, obj, proto: getProto(obj), desc };
    holders.push(h);
    byObj.set(obj, h);
  };

  snap('Window', 'global', g, 'Window');
  const globalDesc = byObj.get(g).desc;
  // Constructors and their prototypes first, so singletons can be typed by their prototype.
  // Interface objects first; legacy factories (Option, Image, Audio) share their interface's prototype and come second.
  const ctors = [];
  for (const [k, d] of globalDesc) {
    if (typeof k !== 'string' || SKIP.has(k) || !('value' in d) || typeof d.value !== 'function') continue;
    const p = gopd(d.value, 'prototype');
    const own = p && p.value && (typeof p.value === 'object' || typeof p.value === 'function') && (gopd(p.value, 'constructor') || {}).value === d.value;
    ctors.push([own ? 0 : 1, k, d]);
  }
  ctors.sort((a, b) => a[0] - b[0]);
  for (const [, k, d] of ctors) {
    const v = d.value;
    if (isNative(v)) {
      const p = gopd(v, 'prototype');
      // Plain functions (fetch, setTimeout) are members, not holders. Function.prototype is itself a function.
      if (!p || !p.value || (typeof p.value !== 'object' && !(k === 'Function' && typeof p.value === 'function'))) continue;
      snap(k, 'constructor', v, k);
      snap(`${k}.prototype`, 'prototype', p.value, k);
      if (!protoOwner.has(p.value)) protoOwner.set(p.value, k);
    }
  }
  // The global's own prototype chain (Window.prototype, WindowProperties, EventTarget.prototype...) is covered above.
  const typeOf = (o) => { for (let p = getProto(o); p; p = getProto(p)) if (protoOwner.has(p)) return protoOwner.get(p); return null; };
  const singletonOrNamespace = (path, v) => {
    const iface = typeOf(v);
    const kind = iface && iface !== 'Object' ? 'singleton' : 'namespace';
    snap(path, kind, v, kind === 'singleton' ? iface : path);
  };
  for (const [k, d] of globalDesc) {
    if (typeof k !== 'string' || SKIP.has(k)) continue;
    let v;
    if ('value' in d) v = d.value;
    else if (d.get) { try { v = apply(d.get, g, []); } catch { continue; } }
    if (v && typeof v === 'object') singletonOrNamespace(k, v);
  }
  for (const [a, b] of NESTED) { try { const v = g[a] && g[a][b]; if (v && typeof v === 'object') singletonOrNamespace(`${a}.${b}`, v); } catch {} }
  // The window's named properties object (Window.prototype's [[Prototype]]) has no interface object, so the constructor
  // pass misses it. Snapshotted last, so writes onto it are diffed and shadows resolve through it (ADR 0011).
  const windowProperties = getProto(getProto(g));
  snap('WindowProperties', 'prototype', windowProperties, 'WindowProperties');

  // Chromium lists the window's named properties as own keys of WindowProperties: element ids, the names of
  // embed/form/img/object elements, and child navigable names. They come and go with the DOM and are not writes, so a
  // new key with one of those names and a non-function value is skipped. DOM functions are captured before any page script.
  const doc = apply(gopd(g, 'document').get, g, []);
  const qsa = Document.prototype.querySelectorAll, getAttribute = Element.prototype.getAttribute, tagName = gopd(Element.prototype, 'tagName').get;
  const nodeListLength = gopd(NodeList.prototype, 'length').get, nodeListItem = NodeList.prototype.item;
  const NAMED_TAGS = new Set(['EMBED', 'FORM', 'IMG', 'OBJECT', 'IFRAME']);
  const namedProperties = () => {
    const names = new Set();
    // Indexed, not for-of: the page may have replaced the iterators by now.
    const list = apply(qsa, doc, ['[id], [name]']);
    for (let i = 0, n = apply(nodeListLength, list, []); i < n; i++) {
      const el = apply(nodeListItem, list, [i]);
      const id = apply(getAttribute, el, ['id']);
      if (id) names.add(id);
      if (NAMED_TAGS.has(apply(tagName, el, []))) { const n = apply(getAttribute, el, ['name']); if (n) names.add(n); }
    }
    return names;
  };

  // Native-absent runs (scripts/absent.js, only with ground-truth.mjs --absent): members the harness deleted after the
  // snapshot above. The snapshot keeps their clean descriptors, but the diff treats them as absent at snapshot time:
  // still missing after load is the harness's own deletion (no record), and one a library re-creates is recorded against
  // the clean native with absentAtLoad: true. Empty in every other run, so nothing below changes for them.
  const absent = new Map(); // holder object -> Set(keys)
  const absentLog = [];
  const isAbsent = (obj, k) => absent.size > 0 && absent.has(obj) && absent.get(obj).has(k);
  const markAbsent = (obj, k, target, deleted) => {
    const h = byObj.get(obj);
    absentLog.push({ target, deleted, snapshotted: !!(h && h.desc.has(k)) });
    if (!deleted || !h || !h.desc.has(k)) return;
    if (!absent.has(obj)) absent.set(obj, new Set());
    absent.get(obj).add(k);
  };

  const pairs = []; // CDP reads old/new values from here by index
  const same = (a, b) => a === b || (a !== a && b !== b);
  const shape = (d) => d && ('value' in d
    ? { kind: 'data', type: typeof d.value, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable }
    : { kind: 'accessor', get: !!d.get, set: !!d.set, enumerable: d.enumerable, configurable: d.configurable });
  // Inherited as of the clean snapshot: a key another script added to an ancestor since then is not inherited.
  const inherited = (h, k) => {
    for (let p = h.proto; p; p = byObj.has(p) ? byObj.get(p).proto : getProto(p)) {
      const d = byObj.has(p) ? byObj.get(p).desc.get(k) : gopd(p, k);
      if (d && !isAbsent(p, k)) return { owner: byObj.get(p), d };
    }
    return null;
  };

  const collect = () => {
    const out = [], newGlobals = [];
    pairs.length = 0;
    for (const h of holders) {
      const now = new Set(ownKeys(h.obj));
      const named = h.obj === windowProperties ? namedProperties() : null;
      for (const [k, before] of h.desc) {
        const target = `${h.path}.${keyName(k)}`;
        const gone = isAbsent(h.obj, k);
        if (!now.has(k)) { if (gone) continue; out.push({ target, holder: h.path, holderKind: h.kind, interface: h.iface, key: keyName(k), change: 'delete', before: shape(before), after: null }); continue; }
        const after = gopd(h.obj, k);
        const dataBoth = 'value' in before && 'value' in after;
        const attrs = ['writable', 'enumerable', 'configurable'].some((a) => before[a] !== after[a]);
        const accessorChanged = !dataBoth && (('value' in before) !== ('value' in after) || before.get !== after.get || before.set !== after.set);
        const valueChanged = dataBoth && !same(before.value, after.value);
        // A member the harness deleted is a library write whenever it is back, even with the native's own descriptor
        // (rrweb puts %Array.prototype.forEach% back on NodeList.prototype, which is the native value).
        if (!attrs && !accessorChanged && !valueChanged && !gone) continue;
        const change = (valueChanged || (gone && !attrs && !accessorChanged)) && !attrs ? 'value' : 'descriptor';
        // ADR 0011: a new data value that isn't the native's is replace/wrap whatever attributes changed with it
        // (accessor -> data for [Replaceable], a re-created native). ground-truth.mjs reads this and drops it.
        const newValue = 'value' in after && (valueChanged || !('value' in before));
        // The new side is the value whenever it is data (accessor -> data too), so wrap evidence and definedAt follow it.
        const i = pairs.push({ old: dataBoth ? before.value : before, new: 'value' in after ? after.value : after }) - 1;
        out.push({ target, holder: h.path, holderKind: h.kind, interface: h.iface, key: keyName(k), change, before: shape(before), after: shape(after), pair: i, ...(newValue ? { newValue } : {}), ...(gone ? { absentAtLoad: true, ...(!attrs && !accessorChanged && !valueChanged ? { sameAsNative: true } : {}) } : {}) });
      }
      for (const k of now) {
        if (h.desc.has(k) || k === KEY) continue;
        const after = gopd(h.obj, k);
        if (named && named.has(k) && !('value' in after && typeof after.value === 'function')) continue;
        const inh = inherited(h, k);
        if (h.kind === 'global' && !inh) { newGlobals.push(keyName(k)); continue; }
        if (DATA_INSTANCES.has(h.path) && !inh) continue;
        const entry = { target: `${h.path}.${keyName(k)}`, holder: h.path, holderKind: h.kind, interface: h.iface, key: keyName(k), change: inh ? 'shadow' : 'add', before: null, after: shape(after) };
        if (inh) {
          entry.shadows = inh.owner ? `${inh.owner.path}.${keyName(k)}` : `(unsnapshotted).${keyName(k)}`;
          entry.before = shape(inh.d);
          entry.pair = pairs.push({ old: 'value' in inh.d ? inh.d.value : inh.d, new: 'value' in after ? after.value : after }) - 1;
        } else if ('value' in after) entry.pair = pairs.push({ old: undefined, new: after.value }) - 1;
        out.push(entry);
      }
      const p = getProto(h.obj);
      if (p !== h.proto) {
        const i = pairs.push({ old: h.proto, new: p }) - 1;
        out.push({ target: `${h.path}.[[Prototype]]`, holder: h.path, holderKind: h.kind, interface: h.iface, key: '[[Prototype]]', change: 'prototype', before: null, after: null, pair: i });
      }
    }
    return { mutations: out, newGlobals, holders: holders.length, descriptors: holders.reduce((n, h) => n + h.desc.size, 0), ...(absentLog.length ? { absent: absentLog } : {}) };
  };

  // Is `orig` still reachable from an own property of any snapshotted holder (e.g. zone.js __zone_symbol__X)?
  const heldBy = (orig) => {
    if (typeof orig !== 'function') return null;
    for (const h of holders) for (const k of ownKeys(h.obj)) {
      if (h.desc.has(k)) continue;
      const d = gopd(h.obj, k);
      if (!d || !('value' in d)) continue;
      if (d.value === orig) return `${h.path}.${keyName(k)}`;
      // One level into a new object, e.g. Clarity's window.__clr[key] = original.
      if (d.value && typeof d.value === 'object') {
        try { for (const k2 of ownKeys(d.value)) { const d2 = gopd(d.value, k2); if (d2 && d2.value === orig) return `${h.path}.${keyName(k)}.${keyName(k2)}`; } } catch {}
      }
    }
    return null;
  };

  R.defineProperty(g, KEY, { value: { collect, pairs, heldBy, markAbsent }, enumerable: false, configurable: false, writable: false });
})();
