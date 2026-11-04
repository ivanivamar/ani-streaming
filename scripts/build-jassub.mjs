// Bundles the JASSUB subtitle worker (it imports npm packages, so the browser can't load it as is)
// and copies its WASM + default font to public/jassub/, served at /jassub/. Run by `npm start` and
// `npm run build`; the output is gitignored. The Angular builder can't do this itself: it doesn't
// follow `new Worker(new URL(…))` inside node_modules.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('jassub/dist/jassub.js'));
const out = path.resolve('public/jassub');
const { version } = JSON.parse(await readFile(path.join(dist, '..', 'package.json'), 'utf8'));

await mkdir(out, { recursive: true });
await build({
  entryPoints: [path.join(dist, 'worker', 'worker.js')],
  outfile: path.join(out, 'jassub-worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  logLevel: 'warning',
});
for (const f of ['wasm/jassub-worker.wasm', 'wasm/jassub-worker-modern.wasm', 'default.woff2']) {
  await copyFile(path.join(dist, f), path.join(out, path.basename(f)));
}
console.log(`build-jassub: jassub ${version} → public/jassub/`);
