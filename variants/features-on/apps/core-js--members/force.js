// core-js reads isForced.data before its feature detection, and apps set it through core-js/configurator:
//   core-js@3.50.0 configurator.js L16-20, internals/is-forced.js L7-12, internals/export.js L43 (isForced(key, options.forced)), L53 (defineBuiltIn)
// Same, but keeps the native Promise constructor: when 'Promise' is forced, the Promise statics land on core-js's own constructor, not on the native one (the guards interlock), so they need this second run.
import configurator from 'core-js/configurator';
configurator({
  usePolyfill: [
    'Promise.all', 'Promise.race', 'Promise.reject', 'Promise.resolve', 'Promise.prototype.catch', 'Promise.prototype.finally',
    'Array.prototype.at', 'Array.prototype.flat', 'Array.prototype.values', 'Array.prototype.keys', 'Array.prototype.entries',
    'Iterator.prototype.map', 'Set.prototype.union', 'String.fromCodePoint', 'queueMicrotask', 'structuredClone', 'URL', 'URLSearchParams',
  ],
  useNative: ['Promise'],
});
