// features-on: the base sentry-11 app plus Replay's off-by-default attachRawBodyFromRequest (ticket 36).
//   @sentry/replay@11.0.0 build/npm/esm/index.js L8205 (default false), L8297-8298 (gate), _INTERNAL_instrumentRequestInterface writes GLOBAL_OBJ.Request
import * as Sentry from '@sentry/browser';
Sentry.init({
  dsn: 'https://public@o0.ingest.example.invalid/1',
  integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ attachRawBodyFromRequest: true })],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
});
window.__corpusReady = true;
