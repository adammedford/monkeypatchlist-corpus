import { registerApplication, start } from 'single-spa';
registerApplication({
  name: 'noop',
  app: async () => ({ bootstrap: async () => {}, mount: async () => {}, unmount: async () => {} }),
  activeWhen: () => true,
});
start();
window.__corpusReady = true;
