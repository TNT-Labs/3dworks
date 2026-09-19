/* Il controllo del TUNNEL_TOKEN è l'unica cosa che sta fra un copia-incolla
   sbagliato e un cloudflared che si riavvia all'infinito dicendo soltanto
   «Provided Tunnel token is not valid». Se smettesse di riconoscere un token
   buono, il sito non salirebbe più; se accettasse tutto, non servirebbe a nulla. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/check-tunnel-token.js', import.meta.url));

/** Esegue il controllo con un dato valore e restituisce esito e messaggi. */
function controlla(valore) {
  const env = { ...process.env };
  if (valore === undefined) delete env.TUNNEL_TOKEN;
  else env.TUNNEL_TOKEN = valore;
  try {
    const out = execFileSync(process.execPath, [script], { env, encoding: 'utf8' });
    return { ok: true, testo: out };
  } catch (e) {
    return { ok: false, testo: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

/** Un token della stessa forma di quelli emessi da Cloudflare (valori finti). */
const tokenFinto = (dati = {}) => Buffer.from(JSON.stringify({
  a: 'f'.repeat(32),
  t: '7b1e4f2a-1111-4222-8333-444455556666',
  s: Buffer.alloc(32, 7).toString('base64'),
  ...dati,
})).toString('base64');

test('accetta un token ben formato', () => {
  const esito = controlla(tokenFinto());
  assert.equal(esito.ok, true, esito.testo);
  assert.match(esito.testo, /formato corretto/);
});

test('non stampa mai il token', () => {
  const token = tokenFinto();
  assert.equal(controlla(token).testo.includes(token), false);
  assert.equal(controlla(`--token ${token}`).testo.includes(token), false);
});

test('tollera spazi e virgolette intorno al valore', () => {
  assert.equal(controlla(`  ${tokenFinto()}  `).ok, true);
  assert.equal(controlla(`"${tokenFinto()}"`).ok, true);
  assert.equal(controlla(`'${tokenFinto()}'`).ok, true);
});

test('accetta la variante base64url', () => {
  // Un token con - e _ al posto di + e / resta valido: cloudflared li accetta.
  const urlSafe = tokenFinto().replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(controlla(urlSafe).ok, true);
});

test('rifiuta il token assente o vuoto', () => {
  for (const v of [undefined, '', '   ']) {
    const esito = controlla(v);
    assert.equal(esito.ok, false);
    assert.match(esito.testo, /manca del tutto/);
  }
});

test('riconosce il comando incollato per intero', () => {
  const esito = controlla(`docker run cloudflare/cloudflared:latest tunnel run --token ${tokenFinto()}`);
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /comando intero/);
});

test('riconosce il valore preceduto da --token', () => {
  const esito = controlla(`--token ${tokenFinto()}`);
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /--token/);
});

test('riconosce un token spezzato su più righe', () => {
  const t = tokenFinto();
  const esito = controlla(`${t.slice(0, 20)}\n${t.slice(20)}`);
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /spazi o andate a capo/);
});

test('riconosce il segnaposto della documentazione', () => {
  const esito = controlla('eyJhIjoi…');
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /caratteri che un token non può avere/);
});

test('riconosce un token troncato', () => {
  const esito = controlla(tokenFinto().slice(0, 30));
  assert.equal(esito.ok, false);
});

test('riconosce un token a cui mancano dei campi', () => {
  const esito = controlla(Buffer.from(JSON.stringify({ a: 'x' })).toString('base64'));
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /incompleto/);
});

test('riconosce un identificativo di tunnel non valido', () => {
  const esito = controlla(tokenFinto({ t: 'non-un-uuid' }));
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /identificativo di tunnel/);
});

test('riconosce un segreto troppo corto', () => {
  const esito = controlla(tokenFinto({ s: Buffer.alloc(8, 1).toString('base64') }));
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /segreto più corto/);
});

test('ogni messaggio dice dove mettere le mani', () => {
  const esito = controlla('pippo');
  assert.equal(esito.ok, false);
  assert.match(esito.testo, /\.env/);
  assert.match(esito.testo, /DEPLOY\.md/);
});
