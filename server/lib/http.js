/* Utilità HTTP condivise: indirizzo del client, cookie, CSRF, rate limit,
   guardie di accesso. */
import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { extname } from 'node:path';
import { config } from './config.js';
import { SESSION_COOKIE, CSRF_COOKIE, CSRF_HEADER, readSession, newToken } from './auth.js';

/* --------------------------- indirizzo del client --------------------------- */
/*
 * Dietro un tunnel Cloudflare ogni richiesta arriva dall'indirizzo del
 * container cloudflared: `req.ip` sarebbe identico per tutti e il limite sui
 * tentativi di accesso diventerebbe collettivo — il primo che sbaglia la
 * password bloccherebbe l'intero sito.
 *
 * `CF-Connecting-IP` è scritto da Cloudflare e sovrascritto a ogni passaggio,
 * quindi un client non può falsificarlo *attraverso* Cloudflare. Può però
 * falsificarlo raggiungendo il container direttamente: lo leggiamo solo quando
 * il proxy è dichiarato fidato, e la guida di deploy non pubblica la porta
 * dell'applicazione fuori dalla rete interna di Docker.
 */
export function clientIp(req){
  if (config.trustProxy !== false && config.cloudflare){
    const cf = String(req.get('cf-connecting-ip') ?? '').trim();
    /* Deve essere un indirizzo, non una stringa qualsiasi: un valore libero
       sarebbe una chiave nuova del limitatore a ogni richiesta — cioè nessun
       limite — e riempirebbe la mappa dei tentativi con dati arbitrari. */
    if (isIP(cf)) return cf;
  }
  return req.ip;
}

/* --------------------------- origine del sito --------------------------- */
/*
 * L'intestazione Host la scrive il client. Se finisse dentro il link di
 * reimpostazione password, basterebbe una richiesta con `Host: esempio.invalid`
 * per far recapitare alla vittima un link che porta il suo token altrove:
 * account preso senza sapere nulla della password.
 *
 * Quindi: l'indirizzo pubblico è quello configurato. Senza configurazione si
 * accettano solo i nomi dichiarati in VORTICE_ALLOWED_HOSTS e quelli locali o
 * privati, dove non c'è un terzo a cui il link possa arrivare.
 */
const PRIVATE_HOST = /^(?:localhost|[^.]+\.local|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\]|::1)$/i;

/** Nome dichiarato dalla richiesta, in minuscole e senza porta. Null se assurdo. */
function requestHost(req){
  const host = String(req.get('host') ?? '').trim().toLowerCase();
  if (!host || host.length > 253 || !/^[a-z0-9._:\[\]-]+$/.test(host)) return null;
  return host;
}

const hostAllowed = host => !!host && (
  config.allowedHosts.includes(host) ||
  config.allowedHosts.includes(host.replace(/:\d+$/, '')) ||
  PRIVATE_HOST.test(host.replace(/:\d+$/, ''))
);

/**
 * Origine su cui è lecito costruire un link che finirà in un'email.
 * @returns {string|null} null quando non c'è nulla di fidato da usare.
 */
export function trustedOrigin(req){
  if (config.baseUrl) return config.baseUrl;
  const host = requestHost(req);
  return hostAllowed(host) ? `${req.protocol}://${host}` : null;
}

/* ------------------------------ cookie ------------------------------ */
export function parseCookies(header){
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')){
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;                  // il primo valore vince
    try{ out[k] = decodeURIComponent(part.slice(i + 1).trim()); }
    catch{ out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function cookieHeader(name, value, opts = {}){
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `SameSite=${opts.sameSite || 'Lax'}`];
  if (opts.httpOnly) bits.push('HttpOnly');
  if (opts.secure) bits.push('Secure');
  if (opts.maxAge != null) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  return bits.join('; ');
}

const secureFor = req => config.cookieSecure || req.secure;

export function setSessionCookies(req, res, { token, expires, csrf }){
  const maxAge = Math.max(0, Math.floor((expires - Date.now()) / 1000));
  res.append('Set-Cookie', cookieHeader(SESSION_COOKIE, token,
    { httpOnly:true, secure:secureFor(req), maxAge }));
  /* leggibile dal JS di pagina: è metà del double-submit contro il CSRF */
  res.append('Set-Cookie', cookieHeader(CSRF_COOKIE, csrf, { secure:secureFor(req), maxAge }));
}

export function clearSessionCookies(req, res){
  for (const name of [SESSION_COOKIE, CSRF_COOKIE])
    res.append('Set-Cookie', cookieHeader(name, '', { httpOnly:name === SESSION_COOKIE,
      secure:secureFor(req), maxAge:0 }));
}

/* ------------------------------ sessione ------------------------------ */
export function attachSession(req, res, next){
  req.cookies = parseCookies(req.headers.cookie);
  const s = readSession(req.cookies[SESSION_COOKIE]);
  req.user = s ? s.user : null;
  req.sessionToken = s ? req.cookies[SESSION_COOKIE] : null;

  /* Il token CSRF va dato anche a chi non è ancora entrato: senza, la prima
     registrazione o il primo accesso non avrebbero nulla con cui firmarsi.
     Viene rigenerato all'apertura della sessione, quindi un token raccolto da
     anonimo non sopravvive all'accesso.

     Solo su pagine e API, però: un Set-Cookie su un foglio di stile o su uno
     script impedirebbe a una CDN di metterli in cache — e se li mettesse
     comunque, servirebbe a tutti i visitatori il token di uno solo. */
  if (!req.cookies[CSRF_COOKIE] && needsCsrfCookie(req)){
    const csrf = newToken(16);
    req.cookies[CSRF_COOKIE] = csrf;
    res.append('Set-Cookie', cookieHeader(CSRF_COOKIE, csrf,
      { secure: secureFor(req), maxAge: 86400 * config.sessionDays }));
  }
  next();
}

/* Confronto a tempo costante di due stringhe di lunghezza qualsiasi. */
function safeEqual(a, b){
  const x = Buffer.from(String(a ?? ''), 'utf8');
  const y = Buffer.from(String(b ?? ''), 'utf8');
  if (x.length !== y.length || !x.length) return false;
  return timingSafeEqual(x, y);
}

/*
 * Seconda serratura accanto al double-submit: quando la richiesta dichiara la
 * propria origine, deve essere la nostra. Il double-submit da solo cade se
 * qualcuno riesce a scrivere un cookie sul dominio (un sottodominio perso, un
 * altro servizio sulla stessa casa), perché a quel punto cookie e
 * intestazione li sceglie l'attaccante: l'origine no, la mette il browser.
 *
 * Origin assente = client che non è un browser (curl, uno script): non porta
 * i cookie di nessun altro, e chiedergliela lo escluderebbe e basta.
 */
function originAllowed(req){
  const raw = req.get('origin');
  if (!raw) return true;
  if (raw === 'null') return false;            // sandbox o redirect cross-site
  let origin;
  try{ origin = new URL(raw); }catch{ return false; }
  const from = origin.host.toLowerCase();
  /* Il confronto è con il Host della richiesta: è il browser a scriverlo
     dall'indirizzo della pagina, quindi un sito terzo non può farli
     combaciare. Lo schema non entra nel confronto: dietro un proxy mal
     configurato req.protocol direbbe http mentre il browser parla https. */
  if (from === requestHost(req)) return true;
  if (config.baseUrl){
    try{ if (from === new URL(config.baseUrl).host.toLowerCase()) return true; }catch{ /* baseUrl malformato */ }
  }
  return config.allowedHosts.includes(from);
}

/* Double-submit: l'header deve combaciare col cookie CSRF. Un sito terzo può
   far partire la richiesta ma non può leggere il cookie per replicarlo. */
export function requireCsrf(req, res, next){
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (!originAllowed(req))
    return res.status(403).json({ error: 'Richiesta proveniente da un altro sito.', code: 'bad_origin' });
  if (!safeEqual(req.get(CSRF_HEADER), req.cookies?.[CSRF_COOKIE]))
    return res.status(403).json({ error: 'Sessione non valida o scaduta. Ricarica la pagina.' });
  next();
}

/*
 * Chi deve ricevere il cookie CSRF: le pagine («/», «/p/VRT-…», i .html) e le
 * API che scrivono. Restano fuori:
 *   · gli asset (js, css, icone) — un Set-Cookie li renderebbe non cacheabili
 *     da una CDN, e se venissero comunque messi in cache servirebbero a tutti
 *     il token di un solo visitatore;
 *   · /api/public/… — è in sola lettura e non usa il token, ed è l'endpoint che
 *     più conviene far tenere in cache al bordo per scaricare il server.
 */
function needsCsrfCookie(req){
  if (req.path.startsWith('/api/public/')) return false;
  /* l'informativa è in sola lettura e uguale per tutti: un cookie qui la
     renderebbe non cacheabile senza servire a nulla */
  if (req.path.startsWith('/api/legal')) return false;
  if (req.path.startsWith('/api/')) return true;
  const ext = extname(req.path);
  return ext === '' || ext === '.html';
}

export function requireAuth(req, res, next){
  if (!req.user) return res.status(401).json({ error: 'Accesso richiesto', code: 'auth_required' });
  if (config.requireVerification && !req.user.verified_at)
    return res.status(403).json({ error: 'Devi confermare la tua email prima di creare', code: 'unverified' });
  next();
}

/* Come requireAuth, ma senza pretendere l'indirizzo confermato.
   I diritti dell'interessato — scaricare i propri dati, correggere
   l'indirizzo, cancellare l'account — non possono dipendere da una conferma
   che magari non arriva proprio perché l'indirizzo è sbagliato: sarebbe una
   persona chiusa fuori dai propri dati. Per creare serve comunque la
   conferma, e quella guardia resta dov'era. */
export function requireUser(req, res, next){
  if (!req.user) return res.status(401).json({ error: 'Accesso richiesto', code: 'auth_required' });
  next();
}

/* ------------------------------ rate limit ------------------------------ */
/* Finestra scorrevole in memoria: sufficiente per una singola istanza e senza
   dipendenze. Dietro più istanze va sostituito con uno store condiviso. */
const buckets = new Map();

export function rateLimit({ windowMs, max, key = clientIp, message }){
  return (req, res, next) => {
    const k = key(req);
    if (k == null) return next();
    const t = Date.now();
    const hits = (buckets.get(k) || []).filter(x => x > t - windowMs);
    if (hits.length >= max){
      const retry = Math.ceil((hits[0] + windowMs - t) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({
        error: message || `Troppi tentativi. Riprova tra ${retry} secondi.`, retryAfter: retry });
    }
    hits.push(t);
    buckets.set(k, hits);
    next();
  };
}

/* evita che la mappa cresca indefinitamente su un processo di lunga durata */
const sweep = setInterval(() => {
  const cutoff = Date.now() - 3600_000;
  for (const [k, hits] of buckets){
    const live = hits.filter(x => x > cutoff);
    if (live.length) buckets.set(k, live); else buckets.delete(k);
  }
}, 600_000);
sweep.unref?.();

export const resetRateLimits = () => buckets.clear();
export const freshCsrf = () => newToken(16);
