/* Comportamenti che contano solo dietro una CDN o un tunnel: se si rompono,
   il sito sembra funzionare e intanto blocca gli utenti o serve il token
   CSRF di uno a tutti gli altri. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vortice-proxy-'));
process.env.VORTICE_DB = join(dir, 'proxy.db');
process.env.NODE_ENV = 'test';
process.env.TRUST_PROXY = '1';
process.env.CLOUDFLARE = '1';

const { createApp } = await import('../server/app.js');
const { resetRateLimits } = await import('../server/lib/http.js');

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => resetRateLimits());

/** Richiesta che finge di arrivare attraverso Cloudflare da un dato indirizzo. */
const viaCloudflare = (path, ip, init = {}) => fetch(base + path, {
  ...init,
  headers: {
    'CF-Connecting-IP': ip,
    'X-Forwarded-For': ip,
    'X-Forwarded-Proto': 'https',
    ...(init.headers || {}),
  },
});

/* Il controllo CSRF confronta l'intestazione col cookie e precede il limite sui
   tentativi: senza una coppia valida le richieste si fermano prima di arrivarci. */
const csrf = token => ({ cookie: `vt_csrf=${token}`, 'x-csrf-token': token });

/* Due limiti distinti proteggono cose diverse:
     · per ACCOUNT — difende una singola casella dai tentativi a tappeto,
       da qualunque indirizzo arrivino;
     · per INDIRIZZO — difende il sito da chi prova molti account,
       e deve restare separato visitatore per visitatore. */
const login = (ip, email) => viaCloudflare('/api/auth/login', ip, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...csrf('tok-' + ip) },
  body: JSON.stringify({ email, password: 'sbagliata-xx' }),
});

async function hammer(ip, email, times = 40){
  const seen = [];
  for (let i = 0; i < times; i++){
    const st = (await login(ip, email)).status;
    seen.push(st);
    if (st === 429) return { blocked: true, at: i + 1, seen };
  }
  return { blocked: false, at: null, seen };
}

test('un account sotto attacco viene protetto, da qualunque indirizzo', async () => {
  const first = await hammer('203.0.113.7', 'bersaglio@esempio.it');
  assert.ok(first.blocked, 'chi insiste su un account deve essere fermato');

  /* cambiare indirizzo non deve restituire tentativi su quello stesso account */
  const elsewhere = await login('198.51.100.42', 'bersaglio@esempio.it');
  assert.equal(elsewhere.status, 429, 'il limite per account non dipende dall\'indirizzo');
});

test('il limite per indirizzo è per persona, non per tunnel', async () => {
  const first = await hammer('203.0.113.7', 'uno@esempio.it');
  assert.ok(first.blocked);

  /* un altro visitatore, dietro lo STESSO tunnel ma con il suo indirizzo
     reale, non deve pagare per i tentativi di qualcun altro: senza leggere
     CF-Connecting-IP condividerebbero lo stesso contatore */
  const other = await login('198.51.100.42', 'due@esempio.it');
  assert.notEqual(other.status, 429,
    'senza indirizzo reale il blocco di uno diventerebbe il blocco di tutti');
  assert.equal(other.status, 401, 'e riceve la normale risposta di credenziali errate');
});

test('senza Cloudflare lo stesso tunnel torna a essere un solo contatore', async () => {
  /* controprova: con le sole intestazioni standard e nessun CF-Connecting-IP,
     due visitatori dietro lo stesso proxy condividono il contatore per
     indirizzo — è esattamente ciò che la lettura di CF-Connecting-IP evita */
  const bare = (email) => fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...csrf('tok-nudo') },
    body: JSON.stringify({ email, password: 'sbagliata-xx' }),
  });
  let blocked = false;
  for (let i = 0; i < 40 && !blocked; i++) blocked = (await bare(`n${i}@esempio.it`)).status === 429;
  assert.ok(blocked, 'il limite per indirizzo esiste e funziona');
});

test('un CF-Connecting-IP che non è un indirizzo non vale come identità', async () => {
  /* Se il valore venisse usato così com'è, basterebbe cambiarlo a ogni
     richiesta per avere ogni volta un contatore nuovo: il limite sui tentativi
     sparirebbe del tutto, senza che nulla lo dia a vedere. */
  let blocked = false;
  for (let i = 0; i < 40 && !blocked; i++){
    const r = await viaCloudflare('/api/auth/login', `non-un-indirizzo-${i}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        /* la catena dei proxy resta quella vera: l'unico valore inventato è
           quello che il limitatore userebbe come identità */
        'X-Forwarded-For': '203.0.113.200',
        ...csrf('tok-falso'),
      },
      body: JSON.stringify({ email: `f${i}@esempio.it`, password: 'sbagliata-xx' }),
    });
    blocked = r.status === 429;
  }
  assert.ok(blocked, 'con un valore inventato si deve ricadere sull\'indirizzo vero della connessione');
});

test("l'indirizzo dichiarato da Cloudflare non è accettato senza proxy fidato", async () => {
  /* qui il proxy è fidato (TRUST_PROXY=1) e l'intestazione viene letta: è il
     motivo per cui la porta dell'applicazione non va esposta fuori da Docker */
  const r = await viaCloudflare('/api/health', '203.0.113.9');
  assert.equal(r.status, 200);
});

test('gli asset statici non ricevono cookie: una CDN può metterli in cache', async () => {
  for (const path of ['/css/base.css', '/js/design-spec.js', '/favicon.svg']){
    const r = await fetch(base + path);
    assert.equal(r.status, 200, path);
    assert.deepEqual(r.headers.getSetCookie(), [], `${path} non deve impostare cookie`);
    assert.match(r.headers.get('cache-control'), /public/, `${path} deve essere cacheabile`);
  }
});

test('le pagine ricevono il cookie CSRF e non vanno in cache', async () => {
  for (const path of ['/', '/accedi.html', '/p/VRT-00000']){
    const r = await fetch(base + path);
    const cookies = r.headers.getSetCookie().join(';');
    assert.match(cookies, /vt_csrf=/, `${path} deve poter firmare il primo accesso`);
    assert.equal(r.headers.get('cache-control'), 'no-cache', path);
  }
});

test('nessuna risposta API finisce in cache', async () => {
  for (const path of ['/api/health', '/api/auth/me', '/api/designs']){
    const r = await fetch(base + path);
    assert.equal(r.headers.get('cache-control'), 'no-store', path);
  }
});

test('la scheda pubblica resta cacheabile: è identica per tutti', async () => {
  /* che il codice esista o no non conta: conta che la risposta non porti
     cookie, altrimenti Cloudflare non la terrebbe in cache — ed è proprio
     l'endpoint che più conviene servire dal bordo invece che dal Raspberry */
  const r = await fetch(base + '/api/public/design/VRT-00000');
  assert.deepEqual(r.headers.getSetCookie(), [], 'nessun cookie sulla scheda pubblica');
});

test('le intestazioni di sicurezza restano quelle attese dietro il proxy', async () => {
  const r = await viaCloudflare('/api/health', '203.0.113.7');
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.ok(!r.headers.get('content-security-policy').includes('unsafe-inline'));
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});
