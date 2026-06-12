// Copies ../frontend into ./www, mirroring the BACKEND's URL map so the bundled
// app resolves exactly the same paths as the live server (backend/app.py):
//   /              -> www/index.html      (frontend/index.html)
//   /manifest.json -> www/manifest.json   (frontend/manifest.json)
//   /sw.js         -> www/sw.js           (frontend/sw.js)
//   /static/<x>    -> www/static/<x>      (frontend/<x>, incl. *.js, icons/, etc.)
//
// Run before every native build:  npm run sync:web
import { cp, rm, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join(here, '..', '..', 'frontend');
const WWW = join(here, '..', 'www');
const ROOT_FILES = new Set(['index.html', 'manifest.json', 'sw.js']);

if (!existsSync(FRONTEND)) {
  console.error('[sync-web] frontend/ not found at', FRONTEND);
  process.exit(1);
}

await rm(WWW, { recursive: true, force: true });
await mkdir(join(WWW, 'static'), { recursive: true });

let rootCount = 0, staticCount = 0;
for (const name of await readdir(FRONTEND)) {
  const src = join(FRONTEND, name);
  if (ROOT_FILES.has(name)) { await cp(src, join(WWW, name), { recursive: true }); rootCount++; }
  else { await cp(src, join(WWW, 'static', name), { recursive: true }); staticCount++; }
}

console.log(`[sync-web] frontend/ -> www/  (root: ${rootCount} [${[...ROOT_FILES].join(', ')}], /static/: ${staticCount} entries)`);
