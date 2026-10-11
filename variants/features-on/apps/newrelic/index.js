// features-on: the base newrelic app plus every off-by-default init option that installs a mutation (ticket 36).
//   session_replay.enabled / preload / collect_fonts / inline_images
//       @newrelic/browser-agent@1.322.0 src/common/config/init.js L110-118 (all false); preload loads the recorder chunk
//       src/features/session_replay/instrument/index.js L43-47, L86; collect_fonts reaches rrweb's FontFace hook
//       @newrelic/rrweb@1.1.2 dist/rrweb.js L13090
//   web_sockets.enabled   src/common/config/init.js L153 (false); gate src/features/generic_events/instrument/index.js L30, L57-58
import { BrowserAgent } from '@newrelic/browser-agent/loaders/browser-agent';
new BrowserAgent({
  init: {
    distributed_tracing: { enabled: true }, privacy: { cookies_enabled: true }, ajax: { deny_list: [] },
    session_replay: { enabled: true, preload: true, collect_fonts: true, inline_images: true, sampling_rate: 100, error_sampling_rate: 100 },
    web_sockets: { enabled: true },
  },
  info: { beacon: 'bam.example.invalid', errorBeacon: 'bam.example.invalid', licenseKey: 'NRJS-00000000000000000000', applicationID: '1', sa: 1 },
  loader_config: { accountID: '1', trustKey: '1', agentID: '1', licenseKey: 'NRJS-00000000000000000000', applicationID: '1' },
});
window.__corpusReady = true;
