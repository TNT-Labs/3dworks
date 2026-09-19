/* Configurazione da variabili d'ambiente, con default sensati per lo sviluppo.
   Nessun segreto nel codice: in produzione si impostano nell'ambiente. */
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const str  = (k, d = '') => (process.env[k] ?? d).trim();
const num  = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) ? v : d; };
const bool = (k, d) => { const v = str(k); return v ? /^(1|true|yes|on)$/i.test(v) : d; };

/* TRUST_PROXY accetta le stesse forme di Express:
     0/false  nessun proxy (default)
     1, 2, …  numero di hop fidati davanti all'applicazione
     true     fidati di tutta la catena (solo in rete chiusa)
     un elenco di indirizzi o CIDR separati da virgola */
function trustProxyValue(){
  const raw = str('TRUST_PROXY');
  if (!raw) return false;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  if (/^(true|yes|on)$/i.test(raw)) return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split(',').map(x => x.trim()).filter(Boolean);
}

const dbPath = str('VORTICE_DB', join(ROOT, 'data', 'vortice.db'));
const isProd = str('NODE_ENV') === 'production';

export const config = {
  isProd,
  port: num('PORT', 3000),
  host: str('HOST', '0.0.0.0'),
  dbFile: isAbsolute(dbPath) ? dbPath : join(ROOT, dbPath),

  /* indirizzo pubblico del sito: serve nei link delle email e nei link condivisi */
  baseUrl: str('VORTICE_BASE_URL', '').replace(/\/+$/, ''),

  /* Il cookie di sessione viaggia solo su HTTPS quando il sito è servito in HTTPS.
     Dietro un reverse proxy o un tunnel Cloudflare TRUST_PROXY va impostato,
     altrimenti req.secure resta falso e ogni richiesta sembra arrivare dal proxy. */
  trustProxy: trustProxyValue(),

  /* Con un tunnel Cloudflare TUTTE le richieste arrivano dallo stesso indirizzo
     (il container cloudflared): senza leggere CF-Connecting-IP il limite sui
     tentativi di accesso sarebbe condiviso da tutti i visitatori, e il primo che
     sbaglia la password chiuderebbe fuori gli altri. */
  cloudflare: bool('CLOUDFLARE', false),
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

  /* ---------------------------- privacy (GDPR) ----------------------------
     Il titolare del trattamento e i suoi recapiti non stanno nel codice: sono
     dati dell'installazione. L'informativa (art. 13) li legge da /api/legal,
     così la stessa pagina serve a chiunque metta in piedi un'istanza. */
  privacy: {
    controller:  str('PRIVACY_CONTROLLER'),
    address:     str('PRIVACY_CONTROLLER_ADDRESS'),
    vat:         str('PRIVACY_CONTROLLER_VAT'),
    email:       str('PRIVACY_CONTACT_EMAIL'),
    dpoEmail:    str('PRIVACY_DPO_EMAIL'),
    hosting:     str('PRIVACY_HOSTING'),
    /* Versione dell'informativa accettata alla registrazione: cambiandola si
       distingue chi ha accettato quale testo (art. 7 §1, responsabilizzazione). */
    version:     str('PRIVACY_POLICY_VERSION', '2026-09-19'),
    /* autorità di controllo a cui rivolgere il reclamo (art. 77) */
    authority:   str('PRIVACY_AUTHORITY', 'Garante per la protezione dei dati personali'),
    authorityUrl:str('PRIVACY_AUTHORITY_URL', 'https://www.garanteprivacy.it'),
  },

  /* ------------------------- conservazione dei dati -------------------------
     Limitazione della conservazione (art. 5 §1 lett. e): tutto ciò che si
     accumula da solo ha una scadenza, e la scadenza è configurabile. */
  retention: {
    /* account mai confermati: senza conferma non sono nemmeno utilizzabili */
    unverifiedDays: num('UNVERIFIED_ACCOUNT_DAYS', 30),
    /* account dormienti: 0 disattiva la cancellazione automatica (default) */
    inactiveDays:   num('INACTIVE_ACCOUNT_DAYS', 0),
  },

  /* I link di conferma e reimpostazione nel log del server sono comodi in
     sviluppo e sono dati personali (più un segreto) in produzione. */
  logMailLinks: bool('LOG_MAIL_LINKS', !isProd),

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
