/* Scarica in public/vendor/fonts i due caratteri del sito e ne scrive il CSS
   con percorsi locali.

   Non è un'ottimizzazione: è il motivo per cui l'applicazione può dire di non
   comunicare nulla a terzi. Un <link> a fonts.googleapis.com fa arrivare a
   Google, a ogni visita e prima di qualsiasi consenso, l'indirizzo IP del
   visitatore, la pagina da cui arriva e il suo user agent — un trattamento
   senza base giuridica (Landgericht München I, 3 O 17493/20) e un
   trasferimento fuori dall'Unione. Serviti dal nostro dominio, i font sono
   soltanto file.

   Space Grotesk e IBM Plex Mono sono SIL Open Font License 1.1: ridistribuirli
   con l'applicazione è espressamente permesso.

   Se la rete non c'è, lo script non fallisce: senza i file il browser usa i
   caratteri di sistema (sono il secondo valore di --sans e --mono). */
import { mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dst = join(root, 'public', 'vendor', 'fonts');

/* Le stesse famiglie e gli stessi pesi che il CSS del sito dichiara in
   --sans e --mono: nulla di più, per non scaricare file che nessuno userà. */
const FAMILIES = [
  { name: 'Space Grotesk', slug: 'space-grotesk', weights: [400, 500, 600, 700] },
  { name: 'IBM Plex Mono', slug: 'ibm-plex-mono', weights: [400, 500, 600] },
];
/* latin copre l'italiano, latin-ext le lingue vicine: gli altri sottoinsiemi
   (cirillico, vietnamita…) sarebbero megabyte inutili. */
const SUBSETS = ['latin', 'latin-ext'];

/* Con questo user agent l'API risponde in woff2, il formato che serve.
   Chiedendola senza, risponderebbe in TTF: quattro volte più pesante. */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const timeout = ms => AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;

async function fetchCss(family, weights){
  const url = 'https://fonts.googleapis.com/css2?family='
    + encodeURIComponent(family).replace(/%20/g, '+')
    + `:wght@${weights.join(';')}&display=swap`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: timeout(20_000) });
  if (!res.ok) throw new Error(`${family}: HTTP ${res.status}`);
  return res.text();
}

/* Ogni blocco @font-face è preceduto dal commento col nome del sottoinsieme:
   è l'unico modo di sapere quale sottoinsieme sia, e non cambia da anni. */
function* faces(css){
  const re = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, subset, body] of css.matchAll(re)){
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1];
    const src = body.match(/src:\s*url\((https:[^)]+\.woff2)\)/)?.[1];
    const range = body.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (subset && weight && src) yield { subset, weight, src, range };
  }
}

async function main(){
  const out = [];
  const files = [];

  for (const { name, slug, weights } of FAMILIES){
    const css = await fetchCss(name, weights);
    for (const face of faces(css)){
      if (!SUBSETS.includes(face.subset)) continue;
      const file = `${slug}-${face.weight}-${face.subset}.woff2`;
      const res = await fetch(face.src, { headers: { 'User-Agent': UA }, signal: timeout(20_000) });
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      files.push([file, Buffer.from(await res.arrayBuffer())]);
      out.push(`@font-face{font-family:'${name}';font-style:normal;font-weight:${face.weight};`
        + `font-display:swap;src:url('./${file}') format('woff2');`
        + (face.range ? `unicode-range:${face.range};` : '') + '}');
    }
  }

  if (!files.length) throw new Error('nessun file scaricato: formato della risposta inatteso');

  /* Si scrive solo a scaricamento completo: mai una cartella a metà, che
     lascerebbe la pagina con tre pesi su sette. */
  await mkdir(dst, { recursive: true });
  for (const f of await readdir(dst).catch(() => []))
    if (f.endsWith('.woff2')) await rm(join(dst, f));
  for (const [file, buf] of files) await writeFile(join(dst, file), buf);

  await writeFile(join(dst, 'fonts.css'),
    '/* Generato da scripts/vendor-fonts.js · non modificare a mano.\n'
    + '   Space Grotesk e IBM Plex Mono · SIL Open Font License 1.1 · vedi LICENSE.txt\n'
    + '   Serviti da questo dominio: nessuna richiesta a terzi, nessun dato che esce. */\n'
    + out.join('\n') + '\n');

  await writeFile(join(dst, 'LICENSE.txt'),
    'Space Grotesk — Copyright (c) 2018 Florian Karsten, SIL Open Font License 1.1\n'
    + '  https://github.com/floriankarsten/space-grotesk\n'
    + 'IBM Plex Mono — Copyright (c) 2017 IBM Corp., SIL Open Font License 1.1\n'
    + '  https://github.com/IBM/plex\n\n'
    + 'Testo della licenza: https://openfontlicense.org\n');

  console.log(`[vendor-fonts] ${files.length} file in public/vendor/fonts (nessuna richiesta a Google dal browser)`);
}

try{
  await main();
}catch(err){
  console.warn(`[vendor-fonts] caratteri non scaricati (${err.message}): il sito userà quelli di sistema.`);
}
