/* Percorso completo nel browser vero: registrazione → studio → salvataggio →
   pubblicazione → scheda pubblica. Verifica anche che l'area pubblica non
   offra alcun comando di modifica. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

/* Il rendering 3D gira via software (nessuna GPU in CI): ogni pagina che
   apre una scena impiega decine di secondi. Le attese sono tarate su questo,
   non su una macchina con GPU. */
const SLOW = 90_000;

const dir = mkdtempSync(join(tmpdir(), 'vortice-e2e-'));
process.env.VORTICE_DB = join(dir, 'e2e.db');
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server/app.js');

let server, base, browser, page;
const problems = [];
const email = `e2e.${Date.now()}@esempio.it`;
const password = 'password-di-prova-1';

before(async () => {
  server = createApp().listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const local = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  browser = await chromium.launch(existsSync(local) ? { executablePath: local } : {});
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => {
    const t = m.text();
    /* il 404 lo racconta meglio il gestore delle risposte, con il percorso */
    if (m.type() === 'error' && !/ERR_CERT|Failed to load resource/.test(t))
      problems.push('console: ' + t);
  });
  /* Una risorsa mancante è un errore anche quando la pagina sopravvive: un
     foglio di stile o un carattere che non arriva non rompe niente, si vede
     soltanto. Le API sono un'altra cosa: un codice inesistente *deve*
     rispondere 404, ed è il test che glielo chiede. */
  page.on('response', r => {
    const { pathname } = new URL(r.url());
    if (r.status() === 404 && !pathname.startsWith('/api/')) problems.push('404: ' + pathname);
  });
  /* Nessuna richiesta deve uscire da questo dominio: è la verifica che i
     caratteri siano davvero serviti da qui e che non sia rientrata dalla
     finestra qualche risorsa di terze parti. */
  page.on('request', r => {
    const u = new URL(r.url());
    if (u.origin !== base && u.protocol !== 'data:' && u.protocol !== 'blob:')
      problems.push('richiesta esterna: ' + r.url());
  });
  page.on('dialog', d => d.accept());
});

after(async () => {
  await browser?.close();
  server?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('la landing rifiuta un codice mal formato senza navigare', async () => {
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.fill('#codeIn', 'XX');
  await page.click('#codeGo');
  await page.waitForSelector('#codeErr:not([hidden])');
  assert.match(await page.textContent('#codeErr'), /5 caratteri/);
  assert.equal(new URL(page.url()).pathname, '/', 'resta sulla landing');
});

test('il campo codice accetta ogni modo di scriverlo', async () => {
  const canonical = async value => {
    await page.fill('#codeIn', value);
    await page.locator('#codeIn').blur();
    return page.inputValue('#codeIn');
  };
  /* il valore digitato non viene toccato finché si scrive: nessun carattere
     può andare perso, nemmeno incollando o con una tastiera software */
  await page.fill('#codeIn', '');
  await page.type('#codeIn', 'vrt7k3qx');
  assert.equal(await page.inputValue('#codeIn'), 'vrt7k3qx');

  /* uscendo dal campo compare la forma canonica, comunque sia stato scritto */
  assert.equal(await canonical('vrt7k3qx'), 'VRT-7K3QX');
  assert.equal(await canonical('7k3qx'), 'VRT-7K3QX', 'solo le cinque cifre lette sul fondo');
  assert.equal(await canonical(' vrt - 7k3 qx '), 'VRT-7K3QX', 'spazi e trattini sparsi');
  assert.equal(await canonical('vrt-7o3il'), 'VRT-70311', 'O e I lette al posto di 0 e 1');
  assert.equal(await canonical('xx'), 'xx', 'ciò che non è un codice resta com\'è');
});

test("un codice inesistente dice che non c'è, senza aprire pagine vuote", async () => {
  await page.fill('#codeIn', 'VRT-00000');
  await page.click('#codeGo');
  await page.waitForSelector('#codeErr:not([hidden])');
  assert.match(await page.textContent('#codeErr'), /Nessun prodotto pubblico/);
});

test('registrazione e ingresso nello studio', async () => {
  await page.goto(base + '/accedi.html?modo=registrazione', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', password);

  /* senza la presa visione dell'informativa il modulo non parte nemmeno */
  await page.click('#submitBtn');
  await page.waitForSelector('#privacyErr:not([hidden])');
  assert.match(await page.textContent('#privacyErr'), /informativa privacy/);
  assert.equal(new URL(page.url()).pathname, '/accedi.html', 'resta sulla pagina di accesso');

  await page.check('#acceptPrivacy');
  await Promise.all([
    page.waitForURL('**/studio.html*', { timeout: SLOW }),
    page.click('#submitBtn'),
  ]);
  await page.waitForSelector('#shell:not([hidden])', { timeout: SLOW });
  assert.equal(await page.textContent('#who'), email);
});

test('lo studio disegna il pezzo e compila la scheda', async () => {
  await page.waitForFunction(() => document.getElementById('mCap').textContent !== '—', null, { timeout: SLOW });
  assert.match(await page.textContent('#mCap'), /≈ \d+ ml/);
  assert.match(await page.textContent('#mSize'), /Ø \d+ × \d+ mm/);
  assert.match(await page.textContent('#vSN'), /^VRT-[0-9A-HJKMNP-TV-Z]{5}$/, 'impronta incisa');
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('#stage canvas');
    return c && { w: c.width, h: c.height };
  });
  assert.ok(canvas && canvas.w > 100, 'il canvas 3D esiste ed è dimensionato');
});

test('muovere uno slider cambia le misure e segna il design come modificato', async () => {
  const before = await page.textContent('#mCap');
  await page.fill('#docName', 'Dispenser di prova');
  await page.locator('#sR').fill('80');
  await page.waitForTimeout(1200);
  assert.notEqual(await page.textContent('#mCap'), before, 'la capacità segue il raggio');
  assert.equal(await page.inputValue('#sR'), '80');
  assert.match(await page.textContent('#vR'), /80 mm/);
});

test('il salvataggio mette la creazione in libreria', async () => {
  await page.click('#saveBtn');
  await page.waitForFunction(() => document.getElementById('docState').textContent === 'salvato',
    null, { timeout: SLOW });
  await page.click('#libBtn');
  await page.waitForSelector('#library:not([hidden])');
  const names = await page.$$eval('.lib-item .name', els => els.map(e => e.textContent));
  assert.deepEqual(names, ['Dispenser di prova']);
  await page.click('#libClose');
});

test("cambiare pezzo nasconde il collo filettato, che il portaspazzolino non ha", async () => {
  await page.click('#segPiece button[data-p="tooth"]');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#secNeck').isVisible(), false);
  await page.click('#segPiece button[data-p="disp"]');
  await page.waitForTimeout(900);
  assert.equal(await page.locator('#secNeck').isVisible(), true);
});

let code;
test('la pubblicazione assegna un codice e lo incide al posto dell\'impronta', async () => {
  const fingerprint = await page.textContent('#vSN');
  await page.click('#pubBtn');
  await page.waitForFunction(() => !document.getElementById('pubLive').hidden, null, { timeout: SLOW });
  code = (await page.textContent('#pubCode')).trim();
  assert.match(code, /^VRT-[0-9A-HJKMNP-TV-Z]{5}$/);
  assert.notEqual(code, fingerprint, 'il codice di produzione non è l\'impronta');

  await page.waitForFunction(c => document.getElementById('vSN').textContent === c, code, { timeout: SLOW });
  assert.equal(await page.locator('#unpubBtn').isVisible(), true, 'appare il comando per ritirare');
});

test('la scheda pubblica mostra lo stesso pezzo, senza comandi di modifica', async () => {
  const pub = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pubProblems = [];
  pub.on('pageerror', e => pubProblems.push(e.message));
  await pub.goto(`${base}/p/${code}`, { waitUntil: 'networkidle' });
  await pub.waitForSelector('#app:not([hidden])', { timeout: SLOW });

  assert.equal((await pub.textContent('#pCode')).trim(), code);
  assert.equal((await pub.textContent('#pName')).trim(), 'Dispenser di prova');
  assert.match(await pub.textContent('#mCap'), /≈ \d+ ml/);
  assert.ok((await pub.textContent('#eText')).includes(code), 'il codice compare fra ciò che è inciso');

  /* nessun comando che cambi il design: niente slider, niente salvataggio,
     niente export, niente campi di testo */
  assert.equal(await pub.locator('input[type=range]').count(), 0, 'nessuno slider');
  assert.equal(await pub.locator('input:not([type=hidden])').count(), 0, 'nessun campo di testo');
  for (const id of ['#saveBtn', '#pubBtn', '#dl', '#panel', '#libBtn', '#findBtn'])
    assert.equal(await pub.locator(id).count(), 0, `${id} non deve esistere nella pagina pubblica`);

  assert.ok((await pub.textContent('.readonly-badge')).includes('non è modificabile'));
  assert.deepEqual(pubProblems, []);
  await pub.close();
});

test('la scheda pubblica è raggiungibile digitando il codice dalla landing', async () => {
  const anon = await browser.newPage();
  await anon.goto(base + '/', { waitUntil: 'networkidle' });
  await anon.fill('#codeIn', code.toLowerCase());
  await Promise.all([anon.waitForURL(`**/p/${code}`, { timeout: SLOW }), anon.click('#codeGo')]);
  await anon.waitForSelector('#app:not([hidden])', { timeout: SLOW });
  assert.equal((await anon.textContent('#pCode')).trim(), code);
  await anon.close();
});

test('senza accesso lo studio rimanda alla pagina di ingresso', async () => {
  const anon = await browser.newPage();
  await anon.goto(base + '/studio.html');
  await anon.waitForURL('**/accedi.html*', { timeout: SLOW });
  assert.match(anon.url(), /next=/, 'ricorda dove si voleva andare');
  await anon.close();
});

test('l\'informativa si riempie con i dati del titolare', async () => {
  const anon = await browser.newPage();
  await anon.goto(base + '/privacy.html', { waitUntil: 'networkidle' });
  /* i segnaposto vengono sostituiti dai valori di /api/legal */
  await anon.waitForFunction(() =>
    document.querySelector('[data-legal="informativa.versione"]').textContent.trim() !== '—');
  assert.ok((await anon.textContent('#retention tbody')).includes('giorni'), 'i tempi di conservazione ci sono');

  await anon.goto(base + '/cookie.html', { waitUntil: 'networkidle' });
  await anon.waitForFunction(() => document.querySelectorAll('#cookies tbody tr').length > 0);
  const cookies = await anon.textContent('#cookies tbody');
  assert.ok(cookies.includes('vt_session') && cookies.includes('vt_csrf'));
  await anon.close();
});

test('dalla pagina account si scaricano i propri dati e si elimina tutto', async () => {
  await page.goto(base + '/account.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('#shell:not([hidden])');
  assert.equal((await page.textContent('#vEmail')).trim(), email);
  await page.waitForFunction(() => document.getElementById('vDesigns').textContent.includes('creazion'));

  /* art. 15 e 20: il file esce davvero, e contiene le creazioni */
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: SLOW }),
    page.click('#exportBtn'),
  ]);
  const dump = JSON.parse(await (await import('node:fs/promises')).readFile(await download.path(), 'utf8'));
  assert.equal(dump.account.email, email);
  assert.ok(dump.creazioni.length >= 1);
  assert.ok(dump.creazioni.some(d => d.codiceDiProduzione === code), 'il pezzo pubblicato è nell\'export');

  /* art. 17: la conferma è doppia — password e parola scritta a mano */
  await page.fill('#delPw', password);
  await page.fill('#delWord', 'forse');
  await page.click('#delBtn');
  await page.waitForSelector('#err:not([hidden])');
  assert.match(await page.textContent('#err'), /ELIMINA/);

  await page.fill('#delWord', 'ELIMINA');
  await Promise.all([page.waitForURL('**/?eliminato=1**', { timeout: SLOW }), page.click('#delBtn')]);
  assert.match(await page.textContent('.notice--ok'), /Account eliminato/);

  /* e il codice inciso non porta più a nulla */
  const anon = await browser.newPage();
  const r = await anon.goto(`${base}/api/public/design/${code}`);
  assert.equal(r.status(), 404, 'il prodotto pubblicato è sparito con l\'account');
  await anon.close();
});

test('nessun errore JavaScript lungo tutto il percorso', () => {
  assert.deepEqual(problems, []);
});
