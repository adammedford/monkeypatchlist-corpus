import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
const provider = new WebTracerProvider();
provider.register();
registerInstrumentations({ instrumentations: [new DocumentLoadInstrumentation()] });
window.__corpusReady = true;
