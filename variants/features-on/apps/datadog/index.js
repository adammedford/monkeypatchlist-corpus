// features-on: the base datadog app plus every off-by-default RUM option that installs a mutation (ticket 36).
//   betaTrackWebSockets (+ track_websockets flag)    @datadog/browser-rum-core@7.14.0 esm/domain/configuration/configuration.mjs L118-122 (default false); gate esm/boot/startRum.mjs L118
//   sessionReplayCanvasRecording.enable (+ session_replay_record_canvas flag)
//                                                     configuration.mjs L136-150 (no default), L67 (needs the flag); gate @datadog/browser-rum@7.14.0 esm/domain/record/trackers/trackCanvasContent.mjs L17
//   profilingSampleRate: 100                          configuration.mjs L89-92 (default 0); lazy profiler chunk @datadog/browser-rum@7.14.0 esm/boot/lazyLoadProfiler.mjs L16
//   enableExperimentalFeatures                        @datadog/browser-core@7.14.0 esm/tools/experimentalFeatures.mjs L12-16 (all four flags; none enabled by default)
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
  betaTrackWebSockets: true,
  sessionReplayCanvasRecording: { enable: true },
  profilingSampleRate: 100,
  enableExperimentalFeatures: ['track_websockets', 'session_replay_record_canvas', 'track_intake_requests', 'soft_navigation'],
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
