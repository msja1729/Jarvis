// Bundles main, preload, renderer, and the Gateway shim with esbuild.
import { build } from 'esbuild';
import fs from 'node:fs';

const common = { bundle: true, sourcemap: true, logLevel: 'warning', target: 'node22' };

await Promise.all([
  build({ ...common, entryPoints: ['app/main.ts'], outfile: 'dist/app/main.cjs', platform: 'node', format: 'cjs', external: ['electron', '@napi-rs/keyring'] }),
  build({ ...common, entryPoints: ['app/preload.ts'], outfile: 'dist/app/preload.cjs', platform: 'node', format: 'cjs', external: ['electron'] }),
  build({ ...common, entryPoints: ['app/renderer/renderer.ts'], outfile: 'dist/renderer/renderer.js', platform: 'browser', format: 'iife', target: 'chrome130' }),
  build({ ...common, entryPoints: ['gateway/shim.ts'], outfile: 'dist/gateway/shim.mjs', platform: 'node', format: 'esm' }),
  build({ ...common, entryPoints: ['app/renderer/indicator.ts'], outfile: 'dist/renderer/indicator.js', platform: 'browser', format: 'iife', target: 'chrome130' }),
]);
for (const f of ['index.html', 'styles.css', 'indicator.html', 'pcm-worklet.js']) fs.copyFileSync(`app/renderer/${f}`, `dist/renderer/${f}`);
console.log('build ok');
