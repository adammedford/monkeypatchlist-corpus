import * as Sentry from '@sentry/browser';
Sentry.init({
  dsn: 'https://public@o0.ingest.example.invalid/1',
  integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
});
window.__corpusReady = true;
