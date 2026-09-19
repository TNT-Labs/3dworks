/* Comportamenti che, se si rompono, non si vedono: il sito continua a
   funzionare benissimo mentre spedisce a qualcun altro il link che apre un
   account. Sono i controlli che nessuna prova manuale fa mai. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'vortice-sec-'));
process.env.VORTICE_DB = join(dir, 'sec.db');
process.env.NODE_ENV = 'test';
process.env.MIN_PASSWORD_LENGTH = '10';
/* nessun indirizzo pubblico configurato: è il caso in cui l'applicazione
   dovrebbe essere tentata di credere all'intestazione Host */
process.env.VORTICE_BASE_URL = '';
process.env.VERIFY_TOKEN_DAYS = '7';

const { createApp } = await import('../server/app.js');
const { resetRateLimits, trustedOrigin } = await import('../server/lib/http.js');
const { verifyTokenExpired, verifyPassword, DUMMY_HASH } = await import('../server/lib/auth.js');
const { q, db } = await import('../server/lib/db.js');

let server, port;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  port = server.address().port;
});
after(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => resetRateLimits());

/* fetch non lascia scrivere l'intestazione Host: qui serve proprio quella,
   quindi la richiesta si fa con il modulo http */
function raw(method, path, { headers = {}, body } = {}){
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path,
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers,
      } }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers,
        data: /json/.test(res.headers['content-type'] || '') ? JSON.parse(text || 'null') : text }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* coppia cookie + intestazione: il double-submit passa, così i test misurano
   il controllo che viene dopo e non questo */
const csrf = token => ({ cookie: `vt_csrf=${token}`, 'x-csrf-token': token });

let seq = 0;
const newEmail = () => `sec${++seq}@esempio.it`;

async function registra(email, password = 'password-lunga'){
  const r = await raw('POST', '/api/auth/register',
    { headers: csrf('t1'), body: { email, password, acceptPrivacy: true } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r;
}

/* ============================ intestazione Host ============================ */

test('il link di reimpostazione non viene costruito su un Host dichiarato dal client', async () => {
  const email = newEmail();
  await registra(email);

  const r = await raw('POST', '/api/auth/forgot',
    { headers: { ...csrf('t2'), host: 'esempio.invalid' }, body: { email } });

  /* la risposta resta identica a quella di un indirizzo sconosciuto: il
     rifiuto non deve dire nulla su chi è registrato */
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  /* ma nessun token è stato emesso: senza token non c'è nulla da rubare */
  assert.equal(q.userByEmail.get(email).reset_token, null);
});

test('con un Host legittimo il token di reimpostazione viene emesso', async () => {
  const email = newEmail();
  await registra(email);

  const r = await raw('POST', '/api/auth/forgot',
    { headers: csrf('t3'), body: { email } });

  assert.equal(r.status, 200);
  assert.notEqual(q.userByEmail.get(email).reset_token, null);
});

test('trustedOrigin accetta i nomi locali e rifiuta quelli inventati', () => {
  const req = (host, proto = 'http') => ({ get: h => (h.toLowerCase() === 'host' ? host : null), protocol: proto });
  assert.equal(trustedOrigin(req('127.0.0.1:3000')), 'http://127.0.0.1:3000');
  assert.equal(trustedOrigin(req('localhost:3000')), 'http://localhost:3000');
  assert.equal(trustedOrigin(req('192.168.1.10:3000')), 'http://192.168.1.10:3000');
  assert.equal(trustedOrigin(req('esempio.invalid')), null);
  assert.equal(trustedOrigin(req('attaccante.example.com')), null);
  assert.equal(trustedOrigin(req('')), null);
});

/* ============================ origine della richiesta ============================ */

test('una richiesta che si dichiara proveniente da un altro sito viene respinta', async () => {
  const r = await raw('POST', '/api/auth/login', {
    headers: { ...csrf('t4'), origin: 'https://attaccante.example.com' },
    body: { email: 'chiunque@esempio.it', password: 'password-lunga' },
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'bad_origin');
});

test('una richiesta con origine opaca viene respinta', async () => {
  const r = await raw('POST', '/api/auth/login',
    { headers: { ...csrf('t5'), origin: 'null' }, body: { email: 'a@b.it', password: 'x' } });
  assert.equal(r.status, 403);
  assert.equal(r.data.code, 'bad_origin');
});

test('la stessa origine passa, e chi non la dichiara affatto pure', async () => {
  const email = newEmail();
  await registra(email);

  const conOrigine = await raw('POST', '/api/auth/login', {
    headers: { ...csrf('t6'), origin: `http://127.0.0.1:${port}` },
    body: { email, password: 'password-lunga' },
  });
  assert.equal(conOrigine.status, 200);

  const senzaOrigine = await raw('POST', '/api/auth/login',
    { headers: csrf('t7'), body: { email, password: 'password-lunga' } });
  assert.equal(senzaOrigine.status, 200);
});

/* ============================ conferma dell'indirizzo ============================ */

test('il token di conferma scade', () => {
  const giorno = 86400_000;
  assert.equal(verifyTokenExpired({ verify_sent_at: Date.now() - 2 * giorno }), false);
  assert.equal(verifyTokenExpired({ verify_sent_at: Date.now() - 8 * giorno }), true);
  /* senza token spedito non c'è nulla da far scadere */
  assert.equal(verifyTokenExpired({ verify_sent_at: null }), false);
});

/* ============================ enumerazione degli account ============================ */

test('l\'accesso con un indirizzo sconosciuto costa quanto quello con uno vero', async () => {
  /* L'hash finto deve avere la forma di uno vero, altrimenti verifyPassword
     esce subito e la differenza di tempo racconta quali indirizzi esistono. */
  assert.equal(DUMMY_HASH.split('$')[0], 'scrypt');
  const t0 = performance.now();
  assert.equal(await verifyPassword('password-lunga', DUMMY_HASH), false);
  const speso = performance.now() - t0;
  assert.ok(speso > 20, `il confronto è costato ${speso.toFixed(1)} ms: troppo poco per assomigliare a uno vero`);
});

/* ============================ intestazioni e file ============================ */

test('le risposte dichiarano di non essere incorporabili altrove', async () => {
  const pagina = await raw('GET', '/api/health');
  assert.equal(pagina.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(pagina.headers['x-frame-options'], 'DENY');
  assert.match(pagina.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('il database non è leggibile dagli altri utenti della macchina', () => {
  const modo = statSync(db.name).mode & 0o777;
  assert.equal(modo & 0o077, 0, `permessi ${modo.toString(8)}: il file è leggibile fuori dal proprietario`);
});
