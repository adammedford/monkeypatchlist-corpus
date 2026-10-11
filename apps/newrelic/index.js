import { BrowserAgent } from '@newrelic/browser-agent/loaders/browser-agent';
new BrowserAgent({
  init: { distributed_tracing: { enabled: true }, privacy: { cookies_enabled: true }, ajax: { deny_list: [] } },
  info: { beacon: 'bam.example.invalid', errorBeacon: 'bam.example.invalid', licenseKey: 'NRJS-00000000000000000000', applicationID: '1', sa: 1 },
  loader_config: { accountID: '1', trustKey: '1', agentID: '1', licenseKey: 'NRJS-00000000000000000000', applicationID: '1' },
});
window.__corpusReady = true;
