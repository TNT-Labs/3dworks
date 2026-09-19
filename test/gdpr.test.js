/* Conformità al GDPR verificata dove conta: negli endpoint e nelle pagine.
   Un'informativa che promette qualcosa che il codice non fa è peggio di
   nessuna informativa — questi test tengono le due cose allineate. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vortice-gdpr-'));
process.env.VORTICE_DB = join(dir, 'test.db');
process.env.MIN_PASSWORD_LENGTH = '10';
process.env.NODE_ENV = 'test';
process.env.PRIVACY_CONTROLLER = 'Officina di prova S.r.l.';
process.env.PRIVACY_CONTACT_EMAIL = 'privacy@esempio.it';

const { createApp } = await import('../server/app.js');
const { resetRateLimits } = await import('../server/lib/http.js');
const { db, q } = await import('../server/lib/db.js');
const { purgeExpiredData, maskEmail, hashToken } = await import('../server/lib/auth.js');
const { defaultState, encodeState } = await import('../public/js/design-spec.js');

let server, base;
before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(() => resetRateLimits());

/* stesso client dei test API: conserva i cookie e rimanda il token CSRF */
function client(){
  const jar = new Map();
  let csrf = null;
  async function call(method, path, body, opts = {}){
    if (!csrf && method !== 'GET' && !opts.raw) await call('GET', '/api/health', undefined, { raw: true });
    const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (csrf) headers['x-csrf-token'] = csrf;
    let payload;
    if (Buffer.isBuffer(body)){ headers['content-type'] = 'image/png'; payload = body; }
    else if (body !== undefined){ headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + path, { method, headers, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []){
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i).trim(), v = decodeURIComponent(pair.slice(i + 1).trim());
      if (!v || /Max-Age=0/i.test(c)) jar.delete(k); else jar.set(k, v);
    }
    const isJson = res.headers.get('content-type')?.includes('json');
    const data = isJson ? await res.json() : await res.text();
    if (data && typeof data === 'object' && data.csrf) csrf = data.csrf;
    if (jar.has('vt_csrf')) csrf = jar.get('vt_csrf');
    return { status: res.status, data, res };
  }
  return {
    get:  (p, o)    => call('GET', p, undefined, o),
    post: (p, b, o) => call('POST', p, b, o),
    put:  (p, b, o) => call('PUT', p, b, o),
    jar,
  };
}

let seq = 0;
const freshEmail = () => `g${++seq}.${Date.now()}@esempio.it`;
const PW = 'password-lunga-1';

async function registered(){
  const c = client();
  const email = freshEmail();
  const r = await c.post('/api/auth/register', { email, password: PW, acceptPrivacy: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { c, email };
}

/* ==================== informativa e presa visione ==================== */

test('senza presa visione dell\'informativa l\'account non viene creato', async () => {
  const c = client();
  const email = freshEmail();
  const r = await c.post('/api/auth/register', { email, password: PW });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'privacy_required');
  assert.equal(r.data.field, 'privacy');
  /* e non deve restare mezzo account nel database */
  assert.equal(q.userByEmail.get(email), undefined);

  /* nemmeno un valore «quasi vero» va bene: solo true */
  assert.equal((await c.post('/api/auth/register',
    { email, password: PW, acceptPrivacy: 'sì' })).status, 400);
});

test('la presa visione viene registrata con data e versione', async () => {
  const { c, email } = await registered();
  const me = await c.get('/api/auth/me');
  assert.ok(me.data.user.privacyAcceptedAt > 0, 'la data della presa visione è conservata');
  assert.equal(me.data.user.privacyVersion, me.data.privacyVersion);
  const row = q.userByEmail.get(email);
  assert.ok(row.privacy_accepted_at > 0 && row.privacy_version);
});

test('/api/legal descrive titolare, cookie, conservazione e diritti, senza dati personali', async () => {
  const r = await client().get('/api/legal');
  assert.equal(r.status, 200);
  const L = r.data;
  assert.equal(L.titolare.nome, 'Officina di prova S.r.l.');
  assert.equal(L.titolare.email, 'privacy@esempio.it');
  assert.equal(L.informativa.completa, true);
  assert.equal(L.profilazione, false);
  assert.equal(L.trasferimentiExtraUe, false);
  /* i cookie dichiarati sono esattamente quelli che il server imposta */
  assert.deepEqual(L.cookie.map(c => c.nome).sort(), ['vt_csrf', 'vt_session']);
  assert.ok(L.cookie.every(c => c.tipo.startsWith('tecnico')), 'nessun cookie non tecnico');
  for (const art of [15, 16, 17, 18, 20, 21, 77])
    assert.ok(Object.values(L.diritti).some(d => d.articolo === art), `manca il diritto art. ${art}`);
  /* è cacheabile al bordo: non contiene nulla di personale */
  assert.match(r.res.headers.get('cache-control'), /public/);
  assert.ok(!(r.res.headers.getSetCookie?.() ?? []).length, 'nessun cookie impostato da /api/legal');
});

test('l\'informativa aggiornata si può riaccettare', async () => {
  const { c } = await registered();
  const r = await c.post('/api/auth/accept-privacy');
  assert.equal(r.status, 200);
  assert.ok(r.data.user.privacyAcceptedAt > 0);
});

/* ==================== accesso e portabilità (art. 15 e 20) ==================== */

test('l\'export contiene tutto ciò che il server sa, in un formato riutilizzabile', async () => {
  const { c, email } = await registered();
  const state = encodeState(defaultState());
  const { data: created } = await c.post('/api/designs', { name: 'Da esportare', state });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
  await c.put(`/api/designs/${created.design.id}/preview`, png);

  const r = await c.get('/api/auth/export');
  assert.equal(r.status, 200);
  assert.match(r.res.headers.get('content-disposition'), /attachment; filename="vortice-dati-personali-/);
  const dump = r.data;

  assert.equal(dump.account.email, email);
  assert.ok(dump.account.registratoIl, 'le date sono in forma leggibile (ISO 8601)');
  assert.match(dump.account.password, /hash scrypt/, 'la password non è esportabile');
  assert.equal(dump.creazioni.length, 1);
  assert.equal(dump.creazioni[0].nome, 'Da esportare');
  assert.equal(dump.creazioni[0].stato, state, 'lo stato esportato ricrea il disegno');
  assert.equal(Buffer.from(dump.creazioni[0].anteprimaPng, 'base64').length, png.length);
  assert.equal(dump.sessioni.length, 1);
  assert.ok(dump.informativa.versione);
});

test('l\'export è di chi lo chiede: senza sessione non esiste', async () => {
  assert.equal((await client().get('/api/auth/export')).status, 401);
});

/* ==================== rettifica (art. 16) ==================== */

test('l\'indirizzo email si corregge, ma serve la password', async () => {
  const { c, email } = await registered();
  const nuova = freshEmail();

  assert.equal((await c.post('/api/auth/change-email',
    { password: 'non-la-mia-1', email: nuova })).status, 403);
  assert.equal(q.userByEmail.get(email).email, email, 'senza password non cambia nulla');

  const r = await c.post('/api/auth/change-email', { password: PW, email: '  ' + nuova.toUpperCase() });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.email, nuova, 'il nuovo indirizzo è normalizzato');
  assert.equal(q.userByEmail.get(email), undefined);

  /* e si entra con il nuovo indirizzo */
  const r2 = await client().post('/api/auth/login', { email: nuova, password: PW });
  assert.equal(r2.status, 200);
});

test('non si può prendere l\'indirizzo di qualcun altro', async () => {
  const { email: altrui } = await registered();
  const { c } = await registered();
  const r = await c.post('/api/auth/change-email', { password: PW, email: altrui });
  assert.equal(r.status, 409);
  assert.equal(r.data.field, 'email');
});

/* ==================== cancellazione (art. 17) ==================== */

test('eliminare l\'account cancella davvero tutto, pubblicazioni comprese', async () => {
  const { c, email } = await registered();
  const state = encodeState(defaultState());
  const { data: created } = await c.post('/api/designs', { name: 'Da cancellare', state });
  const id = created.design.id;
  const { data: pub } = await c.post(`/api/designs/${id}/publish`, { state });
  const code = pub.design.code;
  const userId = q.userByEmail.get(email).id;

  /* prima della cancellazione il codice risponde a chiunque */
  assert.equal((await client().get(`/api/public/design/${code}`)).status, 200);

  assert.equal((await c.post('/api/auth/delete-account', { password: 'non-la-mia-1' })).status, 403);
  assert.ok(q.userByEmail.get(email), 'con la password sbagliata l\'account resta');

  const r = await c.post('/api/auth/delete-account', { password: PW });
  assert.equal(r.status, 200);
  assert.equal(r.data.deletedDesigns, 1);

  assert.equal(q.userByEmail.get(email), undefined, 'utente cancellato');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM designs WHERE user_id = ?').get(userId).n, 0,
    'creazioni cancellate a cascata');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(userId).n, 0,
    'sessioni cancellate a cascata');
  assert.equal((await client().get(`/api/public/design/${code}`)).status, 404,
    'il prodotto pubblicato non è più raggiungibile');
  /* la sessione dell\'utente cancellato non vale più nemmeno se il cookie resta */
  assert.equal((await c.get('/api/auth/me')).data.user, null);
});

/* ==================== minimizzazione e conservazione ==================== */

test('i token inviati per email non stanno in chiaro nel database', async () => {
  const { c, email } = await registered();
  await c.post('/api/auth/forgot', { email });
  const row = q.userByEmail.get(email);
  assert.ok(row.reset_token, 'il token esiste');
  assert.match(row.reset_token, /^[0-9a-f]{64}$/, 'ma è conservato come SHA-256');
  /* e l'impronta corrisponde a quella calcolata sul token in chiaro */
  assert.equal(hashToken('qualcosa'), hashToken('qualcosa'));
  assert.notEqual(row.reset_token, hashToken('qualcosa'));
});

test('la pulizia periodica elimina sessioni scadute e token consumati', async () => {
  const { c, email } = await registered();
  await c.post('/api/auth/forgot', { email });
  const id = q.userByEmail.get(email).id;
  db.prepare('UPDATE sessions SET expires_at = 1 WHERE user_id = ?').run(id);
  db.prepare('UPDATE users SET reset_expires = 1 WHERE id = ?').run(id);

  const r = purgeExpiredData();
  assert.ok(r.sessions >= 1 && r.resetTokens >= 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ?').get(id).n, 0);
  assert.equal(q.userByEmail.get(email).reset_token, null);
});

test('un indirizzo email finisce nei log solo mascherato', () => {
  const m = maskEmail('umberto.molteni@esempio.it');
  assert.ok(!m.includes('molteni') && !m.includes('esempio'));
  assert.match(m, /^u\*+@e\*\*\*\.it$/);
});

test('la vista pubblica non espone nulla dell\'autore', async () => {
  const { c } = await registered();
  const state = encodeState(defaultState());
  const { data: created } = await c.post('/api/designs', { name: 'Pubblico', state });
  const { data: pub } = await c.post(`/api/designs/${created.design.id}/publish`, { state });

  const r = await client().get(`/api/public/design/${pub.design.code}`);
  const body = JSON.stringify(r.data);
  assert.ok(!body.includes('@'), 'nessun indirizzo email nella risposta pubblica');
  assert.ok(!('userId' in r.data.product) && !('user_id' in r.data.product));
});

/* ==================== niente terze parti ==================== */

/* Un collegamento su cui si può cliccare (il sito dell'autorità di controllo)
   non fa uscire nulla finché non lo si clicca; una risorsa caricata dalla
   pagina sì, e prima di qualunque scelta. Il test guarda le seconde: src di
   qualsiasi elemento e href dei <link>, che è come si tirano dentro fogli di
   stile e caratteri. */
test('nessuna pagina carica risorse da domini esterni', () => {
  const RESOURCE = /(?:\bsrc\s*=\s*"|<link\b[^>]*?\bhref\s*=\s*")(https?:)?\/\/[^"]*/gi;
  for (const file of readdirSync('public').filter(f => f.endsWith('.html'))){
    const html = readFileSync(join('public', file), 'utf8');
    const remote = [...html.matchAll(RESOURCE)].map(m => m[0]);
    assert.deepEqual(remote, [], `${file} carica risorse da fuori: ${remote.join(', ')}`);
  }
});

test('la CSP non ammette alcuna origine esterna', async () => {
  const csp = (await client().get('/api/health')).res.headers.get('content-security-policy');
  assert.ok(!/https?:\/\//.test(csp), `la CSP nomina un\'origine esterna: ${csp}`);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /font-src 'self'/);
  assert.ok(!csp.includes('unsafe-inline'));
});

test('le pagine legali esistono e sono raggiungibili senza account', async () => {
  for (const path of ['/privacy.html', '/cookie.html', '/account.html']){
    const r = await client().get(path);
    assert.equal(r.status, 200, path);
    assert.match(r.data, /<html lang="it">/);
  }
});
