// core-js reads isForced.data before its feature detection, and apps set it through core-js/configurator:
//   core-js@3.50.0 configurator.js L16-20, internals/is-forced.js L7-12, internals/export.js L43 (isForced(key, options.forced)), L53 (defineBuiltIn)
// Forces every feature the base app's modules export, including the Promise constructor.
import configurator from 'core-js/configurator';
configurator({
  usePolyfill: [
    'Promise', 'Promise.all', 'Promise.race', 'Promise.reject', 'Promise.resolve', 'Promise.prototype.catch', 'Promise.prototype.finally',
    'Array.prototype.at', 'Array.prototype.flat', 'Array.prototype.values', 'Array.prototype.keys', 'Array.prototype.entries',
    'Iterator.prototype.map', 'Set.prototype.union', 'String.fromCodePoint', 'queueMicrotask', 'structuredClone', 'URL', 'URLSearchParams',
  ],
  useNative: [],
});
