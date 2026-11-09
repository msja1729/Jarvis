// Bundles main, preload, renderer, and the Gateway shim with esbuild.
import { build } from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'node22' };

await Promise.all([
  build({ ...common, entryPoints: ['app/main.ts'], outfile: 'dist/app/main.cjs', platform: 'node', format: 'cjs', external: ['electron', '@napi-rs/keyring', 'pdfjs-dist'] }),
  build({ ...common, entryPoints: ['app/preload.ts'], outfile: 'dist/app/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['app/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife', target: 'chrome130' }),
  build({ ...common, entryPoints: ['gateway/shim.ts'], outfile: 'dist/gateway/shim.mjs', platform: 'node', format: 'esm' }),
  build({ ...common, entryPoints: ['speech/kokoro-worker.ts'], outfile: 'dist/speech/kokoro-worker.mjs', platform: 'node', format: 'esm', external: ['kokoro-js', '@huggingface/transformers'] }),
  build({ ...common, entryPoints: ['app/renderer/indicator.ts'], outfile: 'dist/renderer/indicator.js', platform: 'browser', format: 'iife', target: 'chrome130' }),
  // Lesson window: Mermaid + KaTeX live only in this bundle, so the main window stays small.
  build({ ...common, entryPoints: ['supervisor/jarvis-claude-hook.ts'], outfile: 'dist/supervisor/jarvis-claude-hook.mjs', platform: 'node', format: 'esm', sourcemap: false }),
  build({ ...common, entryPoints: ['app/renderer/supervisor.ts'], outfile: 'dist/renderer/supervisor.js', platform: 'browser', format: 'iife', target: 'chrome130' }),
  build({ ...common, entryPoints: ['app/renderer/lesson.ts'], outfile: 'dist/renderer/lesson.js', platform: 'browser', format: 'iife', target: 'chrome130', sourcemap: false, minify: true }),
]);
for (const f of ['index.html', 'styles.css', 'indicator.html', 'pcm-worklet.js', 'lesson.html', 'lesson.css', 'supervisor.html', 'supervisor.css']) fs.copyFileSync(`app/renderer/${f}`, `dist/renderer/${f}`);
fs.cpSync('node_modules/katex/dist/katex.min.css', 'dist/renderer/katex/katex.min.css');
fs.cpSync('node_modules/katex/dist/fonts', 'dist/renderer/katex/fonts', { recursive: true });
console.log('build ok');
