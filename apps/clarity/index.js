import { clarity } from 'clarity-js';
clarity.start({ projectId: 'corpus', upload: 'https://clarity.example.invalid/collect', track: true, content: true });
window.__corpusReady = true;
