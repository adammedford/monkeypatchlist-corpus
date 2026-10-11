import { AnalyticsBrowser } from '@segment/analytics-next';
export const analytics = AnalyticsBrowser.load({ writeKey: 'corpus' });
analytics.page();
window.__corpusReady = true;
