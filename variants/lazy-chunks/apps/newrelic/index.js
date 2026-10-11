// lazy-chunks (ticket 36): the base newrelic app with the least config that makes the agent load its own lazy chunks.
// session_replay.enabled + preload: the Session Replay instrument imports its recorder chunk itself and starts recording
// before the aggregate loads (@newrelic/browser-agent@1.322.0 src/features/session_replay/instrument/index.js L43-47 (preload), L86 (recorder import);
// isPreloadAllowed in src/features/session_replay/shared/utils.js L16-18), and importAggregator then loads the
// session_replay-aggregate chunk (instrument/index.js L53). Both options default to false (src/common/config/init.js L112-113).
import { BrowserAgent } from '@newrelic/browser-agent/loaders/browser-agent';
new BrowserAgent({
  init: {
    distributed_tracing: { enabled: true }, privacy: { cookies_enabled: true }, ajax: { deny_list: [] },
    session_replay: { enabled: true, preload: true },
  },
  info: { beacon: 'bam.example.invalid', errorBeacon: 'bam.example.invalid', licenseKey: 'NRJS-00000000000000000000', applicationID: '1', sa: 1 },
  loader_config: { accountID: '1', trustKey: '1', agentID: '1', licenseKey: 'NRJS-00000000000000000000', applicationID: '1' },
});
window.__corpusReady = true;
