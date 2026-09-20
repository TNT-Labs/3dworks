/* Database SQLite: schema, migrazioni e query preparate.
   Un solo file su disco, nessun servizio esterno da gestire. */
import Database from 'better-sqlite3';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

/* Nel file ci sono gli indirizzi email e gli hash delle password: non è roba
   che debba poter leggere ogni utente della macchina. I permessi si stringono
   alla creazione, e per le installazioni già esistenti si riprova a ogni
   avvio — senza far fallire il server se il file è di un altro utente. */
mkdirSync(dirname(config.dbFile), { recursive: true, mode: 0o700 });

export const db = new Database(config.dbFile);
const restrict = path => { try{ chmodSync(path, 0o600); }catch{ /* non siamo il proprietario */ } };
/* prima il file principale, poi i pragma: SQLite crea -wal e -shm copiando i
   permessi del database, quindi nascono già stretti */
restrict(config.dbFile);
db.pragma('journal_mode = WAL');   // letture concorrenti mentre si scrive
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
for (const suffix of ['-wal', '-shm']) restrict(config.dbFile + suffix);

/* Migrazioni progressive: ogni voce è applicata una volta sola, in ordine.
   user_version tiene il conto, così l'aggiornamento di un'installazione
   esistente non richiede interventi manuali. */
const MIGRATIONS = [
  () => db.exec(`
    CREATE TABLE users (
      id             INTEGER PRIMARY KEY,
      email          TEXT    NOT NULL UNIQUE,
      pass_hash      TEXT    NOT NULL,
      created_at     INTEGER NOT NULL,
      verified_at    INTEGER,
      verify_token   TEXT,
      verify_sent_at INTEGER,
      reset_token    TEXT,
      reset_expires  INTEGER
    );

    CREATE TABLE sessions (
      token      TEXT    PRIMARY KEY,          -- SHA-256 del token, mai il token in chiaro
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen  INTEGER NOT NULL
    );
    CREATE INDEX sessions_user ON sessions(user_id);

    CREATE TABLE designs (
      id               INTEGER PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name             TEXT    NOT NULL,
      state            TEXT    NOT NULL,       -- stato canonico (query string v1)
      fingerprint      TEXT    NOT NULL,       -- impronta dei parametri, per accorgersi delle modifiche
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL,
      code             TEXT    UNIQUE,         -- codice di produzione, assegnato alla pubblicazione
      published_at     INTEGER,
      published_state  TEXT,                   -- istantanea congelata: è ciò che vede il pubblico
      published_meta   TEXT,                   -- scheda tecnica al momento della pubblicazione (JSON)
      preview          BLOB,                   -- PNG dell'anteprima pubblicata
      views            INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX designs_user ON designs(user_id, updated_at DESC);
  `),

  /* GDPR: prova dell'informativa accettata (art. 7 §1) e ultima attività, che
     serve a far scadere gli account dormienti (art. 5 §1 lett. e).
     Nella stessa migrazione i token di conferma e reimpostazione smettono di
     stare in chiaro: da qui in poi il database ne conserva solo lo SHA-256,
     quindi una copia rubata non permette né di confermare né di reimpostare.
     I token già emessi vengono invalidati: valgono al massimo un'ora. */
  () => db.exec(`
    ALTER TABLE users ADD COLUMN privacy_accepted_at INTEGER;
    ALTER TABLE users ADD COLUMN privacy_version     TEXT;
    ALTER TABLE users ADD COLUMN last_seen_at        INTEGER;
    UPDATE users SET last_seen_at = created_at,
                     verify_token = NULL, reset_token = NULL, reset_expires = NULL;
  `),
];

const version = db.pragma('user_version', { simple: true });
if (version < MIGRATIONS.length){
  const run = db.transaction(() => {
    for (let i = version; i < MIGRATIONS.length; i++) MIGRATIONS[i]();
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  });
  run();
}

export const now = () => Date.now();

export const q = {
  /* utenti */
  userByEmail:    db.prepare('SELECT * FROM users WHERE email = ?'),
  userById:       db.prepare('SELECT * FROM users WHERE id = ?'),
  userByVerify:   db.prepare('SELECT * FROM users WHERE verify_token = ?'),
  userByReset:    db.prepare('SELECT * FROM users WHERE reset_token = ?'),
  insertUser:     db.prepare(`INSERT INTO users (email, pass_hash, created_at, verified_at, verify_token, verify_sent_at,
                                                 privacy_accepted_at, privacy_version, last_seen_at)
                              VALUES (@email, @pass_hash, @created_at, @verified_at, @verify_token, @verify_sent_at,
                                      @privacy_accepted_at, @privacy_version, @created_at)`),
  setEmail:       db.prepare('UPDATE users SET email = ?, verified_at = ?, verify_token = ?, verify_sent_at = ? WHERE id = ?'),
  touchUser:      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
  acceptPrivacy:  db.prepare('UPDATE users SET privacy_accepted_at = ?, privacy_version = ? WHERE id = ?'),
  markVerified:   db.prepare('UPDATE users SET verified_at = ?, verify_token = NULL WHERE id = ?'),
  setVerifyToken: db.prepare('UPDATE users SET verify_token = ?, verify_sent_at = ? WHERE id = ?'),
  setResetToken:  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?'),
  setPassword:    db.prepare('UPDATE users SET pass_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?'),
  deleteUser:     db.prepare('DELETE FROM users WHERE id = ?'),

  /* sessioni */
  insertSession:  db.prepare(`INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen)
                              VALUES (?, ?, ?, ?, ?)`),
  sessionByToken: db.prepare('SELECT * FROM sessions WHERE token = ?'),
  touchSession:   db.prepare('UPDATE sessions SET last_seen = ? WHERE token = ?'),
  deleteSession:  db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  purgeSessions:  db.prepare('DELETE FROM sessions WHERE expires_at < ?'),

  /* creazioni */
  listDesigns: db.prepare(`
    SELECT id, name, state, fingerprint, created_at, updated_at, code, published_at,
           published_meta, views, preview IS NOT NULL AS has_preview,
           published_state IS NOT NULL AND published_state <> state AS stale
    FROM designs WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`),
  countDesigns: db.prepare('SELECT COUNT(*) AS n FROM designs WHERE user_id = ?'),
  designById: db.prepare(`
    SELECT id, user_id, name, state, fingerprint, created_at, updated_at, code, published_at,
           published_state, published_meta, views, preview IS NOT NULL AS has_preview,
           published_state IS NOT NULL AND published_state <> state AS stale
    FROM designs WHERE id = ?`),
  insertDesign: db.prepare(`INSERT INTO designs (user_id, name, state, fingerprint, created_at, updated_at)
                            VALUES (@user_id, @name, @state, @fingerprint, @created_at, @updated_at)`),
  updateDesign: db.prepare(`UPDATE designs SET name = @name, state = @state, fingerprint = @fingerprint,
                            updated_at = @updated_at WHERE id = @id AND user_id = @user_id`),
  deleteDesign: db.prepare('DELETE FROM designs WHERE id = ? AND user_id = ?'),

  /* pubblicazione */
  codeTaken:  db.prepare('SELECT 1 FROM designs WHERE code = ?'),
  publish:    db.prepare(`UPDATE designs SET code = COALESCE(code, @code), published_at = @published_at,
                          published_state = @published_state, published_meta = @published_meta
                          WHERE id = @id AND user_id = @user_id`),
  unpublish:  db.prepare(`UPDATE designs SET published_at = NULL, published_state = NULL,
                          published_meta = NULL, preview = NULL WHERE id = ? AND user_id = ?`),
  setPreview: db.prepare('UPDATE designs SET preview = ? WHERE id = ? AND user_id = ?'),

  /* portabilita e accesso (art. 15 e 20): tutto cio che appartiene a una persona */
  exportDesigns: db.prepare(`
    SELECT id, name, state, fingerprint, created_at, updated_at, code, published_at,
           published_state, published_meta, views, preview
    FROM designs WHERE user_id = ? ORDER BY created_at`),
  exportSessions: db.prepare(`
    SELECT created_at, expires_at, last_seen FROM sessions WHERE user_id = ? ORDER BY created_at`),

  /* conservazione limitata: account mai confermati e account dormienti */
  purgeUnverified: db.prepare(`
    DELETE FROM users WHERE verified_at IS NULL AND created_at < ?`),
  purgeInactive: db.prepare(`
    DELETE FROM users WHERE COALESCE(last_seen_at, created_at) < ?`),

  /* vista pubblica */
  byCode: db.prepare(`
    SELECT d.id, d.name, d.code, d.published_at, d.published_state, d.published_meta, d.views,
           d.preview IS NOT NULL AS has_preview
    FROM designs d WHERE d.code = ? AND d.published_at IS NOT NULL`),
  previewOf:   db.prepare('SELECT preview FROM designs WHERE id = ?'),
  bumpViews:   db.prepare('UPDATE designs SET views = views + 1 WHERE id = ?'),
};

/* pulizia periodica delle sessioni scadute: economica e senza cron esterni */
export function purgeExpired(){ q.purgeSessions.run(now()); }
