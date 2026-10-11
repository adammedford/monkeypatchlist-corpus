// Same SDK version as sentry-11, without Replay: the "before" side of a release that enables Replay.
import * as Sentry from '@sentry/browser';
Sentry.init({
  dsn: 'https://public@o0.ingest.example.invalid/1',
  integrations: [Sentry.browserTracingIntegration()],
  tracesSampleRate: 1.0,
});
window.__corpusReady = true;
