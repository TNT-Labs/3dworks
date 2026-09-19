/* Copia in public/vendor/three i soli file di Three.js che servono all'app e
   riscrive gli import bare («from 'three'») in percorsi relativi.
   Due effetti voluti:
     · lo studio gira senza CDN (rete aziendale, intranet, offline);
     · niente <script type="importmap"> inline, quindi la Content-Security-Policy
       può restare `script-src 'self'` senza deroghe. */
import { mkdir, copyFile, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'three');
const dst = join(root, 'public', 'vendor', 'three');

const CORE = 'build/three.module.js';
const ADDONS = [
  'examples/jsm/controls/OrbitControls.js',
  'examples/jsm/environments/RoomEnvironment.js',
];

try { await access(join(src, CORE)); }
catch {
  console.warn('[vendor-three] pacchetto "three" non installato: salto la copia');
  process.exit(0);
}

await mkdir(dirname(join(dst, CORE)), { recursive: true });
await copyFile(join(src, CORE), join(dst, CORE));

for (const f of ADDONS){
  const to = join(dst, f);
  await mkdir(dirname(to), { recursive: true });
  const rel = posix.normalize(relative(dirname(f), CORE).split(/[\\/]/).join('/'));
  const code = (await readFile(join(src, f), 'utf8'))
    .replace(/(\bfrom\s*)(['"])three\2/g, `$1$2${rel.startsWith('.') ? rel : './' + rel}$2`);
  if (code.includes("from 'three'") || code.includes('from "three"'))
    throw new Error(`[vendor-three] import bare non riscritto in ${f}`);
  await writeFile(to, code);
}
console.log(`[vendor-three] ${ADDONS.length + 1} file in public/vendor/three (import risolti in locale)`);
