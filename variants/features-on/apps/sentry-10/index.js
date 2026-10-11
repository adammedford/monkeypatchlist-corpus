// features-on: the base sentry-10 app plus Replay's off-by-default attachRawBodyFromRequest (ticket 36).
//   sentry-browser-10 -> @sentry/replay@10.75.3 build/npm/esm/index.js L8187 (default false), L8279-8280 (gate), L8133-8150 (writes GLOBAL_OBJ.Request)
import * as Sentry from 'sentry-browser-10';
Sentry.init({
  dsn: 'https://public@o0.ingest.example.invalid/1',
  integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ attachRawBodyFromRequest: true })],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
});
window.__corpusReady = true;
