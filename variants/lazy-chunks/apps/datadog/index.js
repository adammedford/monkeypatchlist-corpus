// lazy-chunks (ticket 36): the base datadog app with the least config that makes the SDK load its remaining lazy chunk.
// The recorder chunk already loads in the base app (sessionReplaySampleRate: 100). profilingSampleRate > 0 makes the SDK
// import its profiler chunk itself (@datadog/browser-rum@7.14.0 esm/boot/lazyLoadProfiler.mjs L16, esm/boot/profilerApi.mjs L42);
// the option defaults to 0 (@datadog/browser-rum-core@7.14.0 esm/domain/configuration/configuration.mjs L89-92).
import { datadogRum } from '@datadog/browser-rum';
import { datadogLogs } from '@datadog/browser-logs';
datadogRum.init({
  applicationId: '00000000-0000-0000-0000-000000000000',
  clientToken: 'pub00000000000000000000000000000000',
  site: 'datadoghq.com',
  service: 'corpus',
  sessionSampleRate: 100,
  sessionReplaySampleRate: 100,
  trackUserInteractions: true,
  trackResources: true,
  trackLongTasks: true,
  defaultPrivacyLevel: 'allow',
  profilingSampleRate: 100,
});
datadogLogs.init({
  clientToken: 'pub00000000000000000000000000000000',
  site: 'datadoghq.com',
  forwardErrorsToLogs: true,
  forwardConsoleLogs: 'all',
  forwardReports: 'all',
  sessionSampleRate: 100,
});
window.__corpusReady = true;
