/* Password e sessioni.
   scrypt viene da node:crypto: niente moduli nativi da compilare e nessuna
   dipendenza esterna sul pezzo più delicato dell'applicazione. */
import { randomBytes, scrypt, timingSafeEqual, createHash, randomInt } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { db, q, now } from './db.js';

const scryptAsync = promisify(scrypt);

/* Parametri OWASP per scrypt (N=2^15, r=8, p=1): ~64 MB e ~100 ms per hash. */
const N = 32768, R = 8, P = 1, KEYLEN = 64, MAXMEM = 128 * 1024 * 1024;

export async function hashPassword(password){
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, { N, r:R, p:P, maxmem:MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored){
  try{
    const [scheme, n, r, p, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length,
      { N:+n, r:+r, p:+p, maxmem: MAXMEM });
    return key.length === expected.length && timingSafeEqual(key, expected);
  }catch{ return false; }
}

/* ============================ sessioni ============================ */

export const SESSION_COOKIE = 'vt_session';
export const CSRF_COOKIE = 'vt_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const sha256 = s => createHash('sha256').update(s).digest('hex');
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/* I token che arrivano per email (conferma indirizzo, reimpostazione password)
   sono credenziali temporanee: nel database ne sta solo l'impronta, come per
   le sessioni. Una copia del database non permette di prendere un account. */
export const hashToken = t => sha256(String(t));

export function createSession(userId){
  const token = newToken();
  const t = now();
  const expires = t + config.sessionDays * 86400_000;
  q.insertSession.run(sha256(token), userId, t, expires, t);
  return { token, expires, csrf: newToken(16) };
}

export function readSession(token){
  if (!token) return null;
  const row = q.sessionByToken.get(sha256(token));
  if (!row) return null;
  if (row.expires_at < now()){ q.deleteSession.run(row.token); return null; }
  /* last_seen aggiornato al massimo una volta all'ora: evita una scrittura per
     richiesta. La stessa scrittura aggiorna l'ultima attività dell'account, che
     è ciò su cui si misura la dormienza quando la scadenza è attiva. */
  if (now() - row.last_seen > 3600_000){
    q.touchSession.run(now(), row.token);
    q.touchUser.run(now(), row.user_id);
  }
  const user = q.userById.get(row.user_id);
  return user ? { user, token: row.token } : null;
}

export const destroySession = token => token && q.deleteSession.run(sha256(token));
export const destroyAllSessions = userId => q.deleteUserSessions.run(userId);

/* ============================ email e password ============================ */

/* Normalizzazione conservativa: solo trim e minuscole. Niente rimozione dei
   punti in stile Gmail — cambierebbe l'indirizzo di altri provider. */
export const normEmail = e => String(e ?? '').trim().toLowerCase();

/* Un indirizzo email è un dato personale anche dentro un log: quando serve
   scriverlo (diagnostica SMTP) se ne scrive solo la forma mascherata. */
export function maskEmail(e){
  const [user = '', domain = ''] = String(e ?? '').split('@');
  const keep = user.slice(0, 1);
  const dot = domain.lastIndexOf('.');
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${keep || '?'}${'*'.repeat(Math.max(1, user.length - 1))}@${domain.slice(0, 1) || '?'}***${tld}`;
}

/* Validazione pragmatica: la prova vera è che l'email arrivi. */
const EMAIL_RE = /^[^\s@,;:<>"'()\[\]\\]+@[^\s@.,;:<>"'()\[\]\\]+(\.[^\s@.,;:<>"'()\[\]\\]+)+$/;
export const validEmail = e => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);

export function passwordProblem(pw){
  if (typeof pw !== 'string') return 'Password mancante';
  if (pw.length < config.minPasswordLength)
    return `La password deve avere almeno ${config.minPasswordLength} caratteri`;
  if (pw.length > 200) return 'Password troppo lunga (massimo 200 caratteri)';
  if (!/\S/.test(pw)) return 'La password non può essere fatta di soli spazi';
  return null;
}

/* ============================ codici di produzione ============================ */
/* Alfabeto base32 Crockford senza I L O U: nessuna ambiguità quando si legge
   il codice inciso sul fondo del pezzo. Stesso alfabeto dei glifi incidibili. */
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Codice univoco VRT-XXXXX. Riprova finché non ne trova uno libero. */
export function allocateCode(){
  for (let attempt = 0; attempt < 40; attempt++){
    let c = '';
    for (let i = 0; i < 5; i++) c += B32[randomInt(B32.length)];
    const code = 'VRT-' + c;
    if (!q.codeTaken.get(code)) return code;
  }
  /* 33,5 milioni di combinazioni: arrivare qui significa archivio quasi pieno */
  throw new Error('Impossibile assegnare un codice di produzione libero');
}

/* Pulizia periodica: sessioni scadute, token di reset consumati e — è la parte
   che riguarda il GDPR — i dati che non hanno più motivo di restare.
   Ogni cancellazione è configurabile e viene annunciata nel log con il solo
   numero di righe: nel log non finisce nessun indirizzo. */
export function purgeExpiredData(t = now()){
  const out = { sessions: 0, resetTokens: 0, unverified: 0, inactive: 0 };
  out.sessions = q.purgeSessions.run(t).changes;
  out.resetTokens = db
    .prepare('UPDATE users SET reset_token = NULL, reset_expires = NULL WHERE reset_expires < ?')
    .run(t).changes;

  /* Account mai confermati: senza conferma non sono nemmeno utilizzabili,
     quindi conservarli non ha alcuna finalità. */
  const unverifiedDays = config.retention.unverifiedDays;
  if (unverifiedDays > 0 && config.requireVerification)
    out.unverified = q.purgeUnverified.run(t - unverifiedDays * 86400_000).changes;

  /* Account dormienti: disattivato di default (0), perché cancellare le
     creazioni di qualcuno che non entra da un po' è una scelta del titolare. */
  const inactiveDays = config.retention.inactiveDays;
  if (inactiveDays > 0)
    out.inactive = q.purgeInactive.run(t - inactiveDays * 86400_000).changes;

  return out;
}

export function startJanitor(intervalMs = 3600_000){
  const tick = () => {
    try{
      const r = purgeExpiredData();
      if (r.unverified || r.inactive)
        console.info(`[janitor] account cancellati per scadenza: ${r.unverified} non confermati, ${r.inactive} dormienti`);
    }catch(err){ console.error('[janitor]', err.message); }
  };
  tick();
  const t = setInterval(tick, intervalMs);
  t.unref?.();
  return t;
}
