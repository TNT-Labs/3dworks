import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* database usa e getta: il test non tocca mai i dati reali */
const dir = mkdtempSync(join(tmpdir(), 'vortice-test-'));
process.env.VORTICE_DB = join(dir, 'test.db');
process.env.MIN_PASSWORD_LENGTH = '10';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/app.js');
const { resetRateLimits } = await import('../server/lib/http.js');
const { defaultState, encodeState, decodeState } = await import('../public/js/design-spec.js');

let server, base;

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => resetRateLimits());

/* Client minimale che si comporta come un browser: conserva i cookie e
   rimanda il token CSRF come fa il JS di pagina. */
function client(){
  const jar = new Map();
  let csrf = null;
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function call(method, path, body, opts = {}){
    /* come un browser: la prima cosa che fa la pagina è una GET, che porta
       a casa il cookie CSRF da rimandare nelle richieste successive */
    if (!csrf && method !== 'GET' && !opts.raw) await call('GET', '/api/health', undefined, { raw: true });
    const headers = { cookie: cookieHeader() };
    if (csrf) headers['x-csrf-token'] = csrf;
    let payload;
    if (Buffer.isBuffer(body)){ headers['content-type'] = 'image/png'; payload = body; }
    else if (body !== undefined){ headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    Object.assign(headers, opts.headers || {});
    const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []){
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = decodeURIComponent(pair.slice(i + 1).trim());
      if (!v || /Max-Age=0/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (data && typeof data === 'object' && data.csrf) csrf = data.csrf;
    if (jar.has('vt_csrf')) csrf = jar.get('vt_csrf');
    return { status: res.status, data, res };
  }
  return {
    get:  (p, o)    => call('GET', p, undefined, o),
    post: (p, b, o) => call('POST', p, b, o),
    put:  (p, b, o) => call('PUT', p, b, o),
    del:  (p, o)    => call('DELETE', p, undefined, o),
    dropCsrf: () => { csrf = 'sbagliato'; },
  };
}

let seq = 0;
const freshEmail = () => `u${++seq}.${Date.now()}@esempio.it`;

async function registered(){
  const c = client();
  const email = freshEmail();
  const r = await c.post('/api/auth/register', { email, password: 'password-lunga-1' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { c, email };
}

/* ============================ autenticazione ============================ */

test('registrazione, sessione persistente e uscita', async () => {
  const { c, email } = await registered();
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.user.email, email);
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user, null);
});

test("l'email viene normalizzata e i duplicati rifiutati", async () => {
  const c = client();
  const email = freshEmail();
  assert.equal((await c.post('/api/auth/register', { email: '  ' + email.toUpperCase() + ' ', password: 'password-lunga-1' })).status, 201);
  assert.equal((await c.get('/api/auth/me')).data.user.email, email);
  const dup = await client().post('/api/auth/register', { email, password: 'altra-password-1' });
  assert.equal(dup.status, 409);
});

test('password troppo corta ed email non valida vengono respinte', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/register', { email: freshEmail(), password: 'corta' })).status, 400);
  assert.equal((await c.post('/api/auth/register', { email: 'non-una-email', password: 'password-lunga-1' })).status, 400);
});

test('accesso con password sbagliata: stesso messaggio di un utente inesistente', async () => {
  const { email } = await registered();
  const a = await client().post('/api/auth/login', { email, password: 'sbagliata-xx' });
  const b = await client().post('/api/auth/login', { email: freshEmail(), password: 'sbagliata-xx' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.data.error, b.data.error);
});

test('accesso corretto dopo registrazione', async () => {
  const { email } = await registered();
  const c = client();
  const r = await c.post('/api/auth/login', { email, password: 'password-lunga-1' });
  assert.equal(r.status, 200);
  assert.equal((await c.get('/api/auth/me')).data.user.email, email);
});

test('il cambio password chiude le altre sessioni', async () => {
  const { email } = await registered();
  const a = client(), b = client();
  await a.post('/api/auth/login', { email, password: 'password-lunga-1' });
  await b.post('/api/auth/login', { email, password: 'password-lunga-1' });
  assert.equal((await a.post('/api/auth/change-password',
    { current: 'password-lunga-1', password: 'password-nuova-1' })).status, 200);
  assert.equal((await b.get('/api/auth/me')).data.user, null, 'la vecchia sessione è caduta');
  assert.equal((await a.get('/api/auth/me')).data.user.email, email, 'chi ha cambiato resta dentro');
});

test('una richiesta senza token CSRF valido viene bloccata', async () => {
  const { c } = await registered();
  c.dropCsrf();
  const r = await c.post('/api/designs', { state: encodeState(defaultState()) });
  assert.equal(r.status, 403);
});

test('le API riservate rifiutano chi non è autenticato', async () => {
  const anon = client();
  assert.equal((await anon.get('/api/designs')).status, 401);
  assert.equal((await anon.post('/api/designs', { state: encodeState(defaultState()) })).status, 401);
  assert.equal((await anon.put('/api/designs/1', { name: 'x' })).status, 401);
});

/* ============================ creazioni ============================ */

test('ciclo completo: crea, rinomina, rilegge, elimina', async () => {
  const { c } = await registered();
  const state = encodeState(defaultState());

  const created = await c.post('/api/designs', { name: 'Il mio vaso', state });
  assert.equal(created.status, 201);
  const id = created.data.design.id;
  assert.equal(created.data.design.name, 'Il mio vaso');
  assert.equal(created.data.design.published, false);
  assert.equal(created.data.design.code, null);

  const up = await c.put(`/api/designs/${id}`, { name: 'Rinominato' });
  assert.equal(up.data.design.name, 'Rinominato');
  assert.equal(up.data.design.state, state, 'lo stato non cambia se non lo mando');

  const list = await c.get('/api/designs');
  assert.equal(list.data.total, 1);
  assert.equal(list.data.designs[0].id, id);

  assert.equal((await c.del(`/api/designs/${id}`)).status, 200);
  assert.equal((await c.get('/api/designs')).data.total, 0);
});

test("lo stato viene normalizzato: i valori fuori scala non entrano nel database", async () => {
  const { c } = await registered();
  const r = await c.post('/api/designs', { state: { P: { h: 99999, r: -40 }, profile: 'inesistente' } });
  assert.equal(r.status, 201);
  const s = decodeState(r.data.design.state);
  assert.equal(s.P.h, 235);
  assert.equal(s.P.r, 30);
  assert.equal(s.profile, 'clessidra');
});

test('uno stato illeggibile viene rifiutato', async () => {
  const { c } = await registered();
  assert.equal((await c.post('/api/designs', { state: 'v=42&h=1' })).status, 400);
  assert.equal((await c.post('/api/designs', { state: 12345 })).status, 400);
});

test('non si possono leggere né modificare le creazioni di un altro', async () => {
  const { c: a } = await registered();
  const id = (await a.post('/api/designs', { state: encodeState(defaultState()) })).data.design.id;
  const { c: b } = await registered();
  assert.equal((await b.get(`/api/designs/${id}`)).status, 404);
  assert.equal((await b.put(`/api/designs/${id}`, { name: 'rubato' })).status, 404);
  assert.equal((await b.del(`/api/designs/${id}`)).status, 404);
  assert.equal((await a.get(`/api/designs/${id}`)).data.design.name, 'Senza titolo', 'intatto');
});

/* ============================ pubblicazione ============================ */

test('pubblicazione: assegna un codice e lo rende leggibile a chiunque', async () => {
  const { c } = await registered();
  const state = encodeState(defaultState());
  const id = (await c.post('/api/designs', { name: 'Dispenser bagno', state })).data.design.id;

  const pub = await c.post(`/api/designs/${id}/publish`, { meta: { capML: 820, grams: 210, minutes: 430 } });
  assert.equal(pub.status, 200);
  const code = pub.data.design.code;
  assert.match(code, /^VRT-[0-9A-HJKMNP-TV-Z]{5}$/);

  const anon = client();
  const view = await anon.get(`/api/public/design/${code}`);
  assert.equal(view.status, 200);
  assert.equal(view.data.product.name, 'Dispenser bagno');
  assert.equal(view.data.product.state, state);
  assert.equal(view.data.product.meta.capML, 820);
  assert.equal(view.data.product.code, code);
  const body = JSON.stringify(view.data);
  assert.ok(!body.includes('@'), "l'autore non viene esposto");
  assert.ok(!body.includes('userId') && !body.includes('user_id'));
});

test('il codice si legge anche scritto male o in minuscolo', async () => {
  const { c } = await registered();
  const id = (await c.post('/api/designs', { state: encodeState(defaultState()) })).data.design.id;
  const code = (await c.post(`/api/designs/${id}/publish`, {})).data.design.code;
  const anon = client();
  assert.equal((await anon.get(`/api/public/design/${code.toLowerCase()}`)).status, 200);
  assert.equal((await anon.get(`/api/public/design/${code.replace('VRT-', '')}`)).status, 200);
});

test('il pubblico non può modificare nulla', async () => {
  const { c } = await registered();
  const id = (await c.post('/api/designs', { state: encodeState(defaultState()) })).data.design.id;
  const code = (await c.post(`/api/designs/${id}/publish`, {})).data.design.code;

  /* anonimo con CSRF valido: viene fermato dall'autenticazione, non per sbaglio */
  const anon = client();
  await anon.get(`/api/public/design/${code}`);
  assert.equal((await anon.put(`/api/designs/${id}`, { name: 'modificato' })).status, 401);
  assert.equal((await anon.post(`/api/designs/${id}/publish`, {})).status, 401);
  assert.equal((await anon.del(`/api/designs/${id}`)).status, 401);
  assert.equal((await anon.post(`/api/designs/${id}/unpublish`)).status, 401);

  /* utente autenticato ma diverso: non deve nemmeno sapere che esiste */
  const { c: altro } = await registered();
  assert.equal((await altro.put(`/api/designs/${id}`, { name: 'modificato' })).status, 404);
  assert.equal((await altro.post(`/api/designs/${id}/publish`, { replace: true })).status, 404);
  assert.equal((await c.get(`/api/designs/${id}`)).data.design.name, 'Senza titolo', 'intatto');
});

test('codice inesistente e formato sbagliato danno errori distinti', async () => {
  const anon = client();
  assert.equal((await anon.get('/api/public/design/VRT-00000')).status, 404);
  assert.equal((await anon.get('/api/public/design/non-un-codice')).status, 400);
});

test('un design non pubblicato non è raggiungibile col codice', async () => {
  const { c } = await registered();
  const id = (await c.post('/api/designs', { state: encodeState(defaultState()) })).data.design.id;
  const code = (await c.post(`/api/designs/${id}/publish`, {})).data.design.code;
  assert.equal((await client().get(`/api/public/design/${code}`)).status, 200);

  await c.post(`/api/designs/${id}/unpublish`);
  assert.equal((await client().get(`/api/public/design/${code}`)).status, 404);

  /* ripubblicando torna lo STESSO codice: è quello inciso sui pezzi */
  const again = await c.post(`/api/designs/${id}/publish`, {});
  assert.equal(again.data.design.code, code);
});

test('la vista pubblica resta ferma quando il progetto viene modificato', async () => {
  const { c } = await registered();
  const s0 = defaultState();
  const id = (await c.post('/api/designs', { state: encodeState(s0) })).data.design.id;
  const code = (await c.post(`/api/designs/${id}/publish`, {})).data.design.code;

  const s1 = structuredClone(s0); s1.P.h = 200;
  await c.put(`/api/designs/${id}`, { state: encodeState(s1) });

  const view = await client().get(`/api/public/design/${code}`);
  assert.equal(decodeState(view.data.product.state).P.h, 185, 'il pubblico vede la versione pubblicata');
  assert.equal((await c.get(`/api/designs/${id}`)).data.design.stale, true, 'lo studio segnala lo scostamento');
});

test('ripubblicare con parametri diversi richiede conferma esplicita', async () => {
  const { c } = await registered();
  const s0 = defaultState();
  const id = (await c.post('/api/designs', { state: encodeState(s0) })).data.design.id;
  const code = (await c.post(`/api/designs/${id}/publish`, {})).data.design.code;

  const s1 = structuredClone(s0); s1.P.h = 200;
  const blocked = await c.post(`/api/designs/${id}/publish`, { state: encodeState(s1) });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'already_published');

  const forced = await c.post(`/api/designs/${id}/publish`, { state: encodeState(s1), replace: true });
  assert.equal(forced.status, 200);
  assert.equal(forced.data.design.code, code, 'il codice non cambia mai');
  assert.equal(decodeState((await client().get(`/api/public/design/${code}`)).data.product.state).P.h, 200);
});

/* ============================ anteprima ============================ */

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

test("l'anteprima accetta solo PNG e torna sia in privato sia in pubblico", async () => {
  const { c } = await registered();
  const id = (await c.post('/api/designs', { state: encodeState(defaultState()) })).data.design.id;
  const code = (await c.post(`/api/designs/${id}/publish`, {})).data.design.code;

  assert.equal((await c.put(`/api/designs/${id}/preview`, Buffer.from('non sono un png'))).status, 400);
  assert.equal((await c.put(`/api/designs/${id}/preview`, PNG_1PX)).status, 200);

  const mine = await c.get(`/api/designs/${id}/preview.png`);
  assert.equal(mine.status, 200);
  const pub = await client().get(`/api/public/design/${code}/preview.png`);
  assert.equal(pub.status, 200);
  assert.equal(pub.res.headers.get('content-type'), 'image/png');
});

/* ============================ intestazioni ============================ */

test('le intestazioni di sicurezza sono presenti e la CSP non ammette inline', async () => {
  const r = await client().get('/api/health');
  const csp = r.res.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'/);
  assert.ok(!csp.includes('unsafe-inline'), 'nessuna deroga per script inline');
  assert.equal(r.res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.res.headers.get('x-frame-options'), 'DENY');
});

test('il rate limit scatta sui tentativi di accesso ripetuti', async () => {
  const { email } = await registered();
  const c = client();
  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++)
    blocked = (await c.post('/api/auth/login', { email, password: 'sbagliata-xx' })).status === 429;
  assert.ok(blocked, 'dopo qualche tentativo il limite deve intervenire');
});
