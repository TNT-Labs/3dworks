/* Copia di sicurezza del database, a server acceso.
   Usa il backup online di SQLite: coerente anche mentre qualcuno sta
   salvando, cosa che una semplice `cp` del file non garantisce.

   Uso:  node scripts/backup.js [cartella]          (default: accanto al db)
   In container:  docker compose exec vortice node scripts/backup.js /data/backup
*/
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, statSync, unlinkSync, chmodSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { config } from '../server/lib/config.js';

const KEEP = Number(process.env.BACKUP_KEEP || 14);   // quante copie conservare

const outDir = process.argv[2] || join(dirname(config.dbFile), 'backup');
/* una copia del database contiene gli stessi indirizzi e gli stessi hash
   dell'originale: merita gli stessi permessi, non quelli di default */
mkdirSync(outDir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const name = `${basename(config.dbFile, '.db')}-${stamp}.db`;
const target = join(outDir, name);

const db = new Database(config.dbFile, { readonly: true });
try{
  await db.backup(target);
}finally{
  db.close();
}
try{ chmodSync(target, 0o600); }catch{ /* filesystem senza permessi POSIX */ }
console.log(`copia creata: ${target} · ${(statSync(target).size / 1048576).toFixed(1)} MB`);

/* rotazione: le copie più vecchie oltre KEEP vengono rimosse */
const old = readdirSync(outDir)
  .filter(f => f.endsWith('.db'))
  .sort()
  .slice(0, -KEEP);
for (const f of old){
  unlinkSync(join(outDir, f));
  console.log(`  rimossa copia vecchia: ${f}`);
}
