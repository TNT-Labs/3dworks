/* Utilità HTTP condivise: indirizzo del client, cookie, CSRF, rate limit,
   guardie di accesso. */
import { timingSafeEqual } from 'node:crypto';
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
    const cf = req.get('cf-connecting-ip');
    if (cf && cf.length <= 45) return cf.trim();
  }
  return req.ip;
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

/* Double-submit: l'header deve combaciare col cookie CSRF. Un sito terzo può
   far partire la richiesta ma non può leggere il cookie per replicarlo. */
export function requireCsrf(req, res, next){
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
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
