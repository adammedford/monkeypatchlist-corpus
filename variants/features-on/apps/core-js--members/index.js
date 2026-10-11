// features-on (ticket 36): the base core-js app with core-js/configurator forcing its polyfills. force.js must run first.
import './force.js';
import 'core-js/modules/es.array.flat.js';
import 'core-js/modules/es.array.at.js';
import 'core-js/modules/es.promise.js';
import 'core-js/modules/es.promise.finally.js';
import 'core-js/modules/es.set.union.v2.js';
import 'core-js/modules/es.iterator.map.js';
import 'core-js/modules/web.queue-microtask.js';
import 'core-js/modules/web.structured-clone.js';
import 'core-js/modules/web.url.js';
window.__corpusReady = true;
