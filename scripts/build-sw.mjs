// Fills BUILD / PRECACHE / ASSETS in dist/ani-stream/browser/sw.js after `ng build`
// (the music app did this in a Vite plugin). Run by `npm run build`.
//   PRECACHE: index.html + every JS/CSS file (the app shell, cached on install)
//   ASSETS:   every file of this build (runtime cache entries not in it are dropped on activate)
//   BUILD:    hash of all file names + index.html, so each deploy gets a new shell cache
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist/ani-stream/browser');
const swFile = path.join(dist, 'sw.js');

async function walk(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else out.push(rel);
  }
  return out;
}

const files = (await walk(dist)).filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
const precache = files.filter((f) => f === 'index.html' || /\.(js|css)$/.test(f));
const hash = createHash('sha256').update(files.join('\n')).update(await readFile(path.join(dist, 'index.html')));
const build = hash.digest('hex').slice(0, 12);

let sw = await readFile(swFile, 'utf8');
const fill = (marker, value) => {
  const re = new RegExp(`/\\*${marker}\\*/\\s*(null|\\[\\])`);
  if (!re.test(sw)) throw new Error(`build-sw: marker /*${marker}*/ not found in ${swFile}`);
  sw = sw.replace(re, JSON.stringify(value));
};
fill('BUILD', build);
fill('PRECACHE', precache);
fill('ASSETS', files);
await writeFile(swFile, sw);
console.log(`build-sw: build ${build}, ${precache.length} precached of ${files.length} files`);
