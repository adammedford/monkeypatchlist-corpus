// Native-absent runs (an exercise variant). ground-truth.mjs --absent injects this with addInitScript *after* snapshot.js, as
// `(<this function>)(<the targets of one run in variants/native-absent/natives.json>)`, so it runs in the main world after the
// clean snapshot and before any page script. It deletes each listed member and registers it with the snapshot's collector,
// which then treats it as absent at snapshot time (see snapshot.js). Targets use the ground-truth naming:
// `Window.fetch`, `NodeList.prototype.forEach`, `Array.prototype.[Symbol.iterator]`.
(list) => {
  const R = Reflect;
  const api = globalThis[Symbol.for('patchline.corpus')];
  const keyOf = (s) => { const m = /^\[Symbol\.(\w+)\]$/.exec(s); return m ? Symbol[m[1]] : s; };
  const holderOf = (path) => {
    if (path === 'Window') return globalThis;
    let o = globalThis;
    for (const seg of path.split('.')) { if (o === null || o === undefined) return undefined; o = o[seg]; }
    return o;
  };
  // Resolve every holder before deleting anything: a run may delete a constructor (EventTarget) and a member under it.
  const plan = list.map((target) => {
    const m = /^(.*?)\.(\[Symbol\.\w+\])$/.exec(target) ?? /^(.*)\.([^.]+)$/.exec(target);
    return { target, holder: m ? holderOf(m[1]) : undefined, key: m ? keyOf(m[2]) : undefined };
  });
  for (const { target, holder, key } of plan) {
    const ok = (typeof holder === 'object' || typeof holder === 'function') && holder !== null
      && R.getOwnPropertyDescriptor(holder, key) !== undefined && R.deleteProperty(holder, key) && R.getOwnPropertyDescriptor(holder, key) === undefined;
    api.markAbsent(holder, key, target, !!ok);
  }
}
