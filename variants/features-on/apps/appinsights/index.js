// features-on: the base appinsights app plus the off-by-default enableUnhandledPromiseRejectionTracking (ticket 36).
//   @microsoft/applicationinsights-analytics-js@3.4.4 dist-es5/JavaScriptSDK/AnalyticsPlugin.js L44 (cfgDfBoolean(), default false),
//   L659-663 (gate; InstrumentEvent(window, "onunhandledrejection"))
import { ApplicationInsights } from '@microsoft/applicationinsights-web';
const ai = new ApplicationInsights({
  config: {
    connectionString: 'InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://ai.example.invalid/',
    enableAutoRouteTracking: true,
    enableCorsCorrelation: true,
    enableRequestHeaderTracking: true,
    enableResponseHeaderTracking: true,
    enableUnhandledPromiseRejectionTracking: true,
  },
});
ai.loadAppInsights();
ai.trackPageView();
window.__corpusReady = true;
