/* Configurazione da variabili d'ambiente, con default sensati per lo sviluppo.
   Nessun segreto nel codice: in produzione si impostano nell'ambiente. */
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const str  = (k, d = '') => (process.env[k] ?? d).trim();
const num  = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) ? v : d; };
const bool = (k, d) => { const v = str(k); return v ? /^(1|true|yes|on)$/i.test(v) : d; };

const dbPath = str('VORTICE_DB', join(ROOT, 'data', 'vortice.db'));
const isProd = str('NODE_ENV') === 'production';

export const config = {
  isProd,
  port: num('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  dbFile: isAbsolute(dbPath) ? dbPath : join(ROOT, dbPath),

  /* indirizzo pubblico del sito: serve nei link delle email e nei link condivisi */
  baseUrl: str('VORTICE_BASE_URL', '').replace(/\/+$/, ''),

  /* il cookie di sessione viaggia solo su HTTPS quando il sito è servito in HTTPS.
     Dietro un reverse proxy va impostato TRUST_PROXY=1 perché req.secure funzioni. */
  trustProxy: bool('TRUST_PROXY', false),
  cookieSecure: bool('COOKIE_SECURE', isProd),
  sessionDays: num('SESSION_DAYS', 30),

  /* Registrazione. La verifica dell'email è opzionale: senza SMTP configurato
     l'account è attivo subito, così l'app funziona anche in una intranet. */
  requireVerification: bool('REQUIRE_EMAIL_VERIFICATION', false),
  allowRegistration: bool('ALLOW_REGISTRATION', true),
  minPasswordLength: num('MIN_PASSWORD_LENGTH', 10),

  /* quote per utente: proteggono il disco senza infastidire l'uso normale */
  maxDesignsPerUser: num('MAX_DESIGNS_PER_USER', 200),
  maxPreviewBytes: num('MAX_PREVIEW_BYTES', 600 * 1024),

  smtp: {
    host: str('SMTP_HOST'),
    port: num('SMTP_PORT', 587),
    secure: bool('SMTP_SECURE', false),
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    from: str('SMTP_FROM', 'VORTICE <no-reply@localhost>'),
  },
};

export const smtpConfigured = () => !!config.smtp.host;

/* La verifica obbligatoria senza SMTP chiuderebbe fuori tutti: meglio fermarsi
   subito con un messaggio chiaro che scoprirlo alla prima registrazione. */
if (config.requireVerification && !smtpConfigured())
  throw new Error(
    'REQUIRE_EMAIL_VERIFICATION=1 richiede SMTP_HOST configurato, ' +
    'altrimenti nessun utente potrebbe attivare il proprio account.');
