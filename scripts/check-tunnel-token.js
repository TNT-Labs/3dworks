#!/usr/bin/env node
// =====================================================================
// Controllo del TUNNEL_TOKEN prima di avviare cloudflared.
//
// Senza questo controllo un token copiato male produce soltanto
// «Provided Tunnel token is not valid», ripetuto all'infinito perché il
// container riparte da solo: nessuna indicazione su *cosa* sia sbagliato.
// Qui il token viene esaminato in locale — non viene contattato nessuno —
// e l'avvio si ferma subito con un messaggio che dice dove intervenire.
//
// Il token è credenziale: non viene mai stampato, nemmeno in parte.
// =====================================================================

// I colori solo su terminale: nel log di Docker le sequenze ANSI sarebbero
// rumore illeggibile.
const tinta = (attivo, codice, testo) =>
  (attivo ? `\u001b[${codice}m${testo}\u001b[0m` : testo);

function errore(titolo, ...righe) {
  const intestazione = tinta(process.stderr.isTTY, 31, `TUNNEL_TOKEN non valido: ${titolo}`);
  process.stderr.write(`\n${intestazione}\n`);
  for (const riga of righe) process.stderr.write(`  ${riga}\n`);
  process.stderr.write(
    '\n  Il token sta nel file .env accanto al docker-compose.yml, ' +
    'nella forma\n    TUNNEL_TOKEN=eyJhIjoi…\n' +
    '  Lo trovi in Cloudflare → Zero Trust → Networks → Tunnels: apri il\n' +
    '  tunnel, «Configure», e copia la stringa che segue --token nel comando\n' +
    '  mostrato per Docker. Vedi DEPLOY.md §3.\n\n'
  );
  process.exit(1);
}

const grezzo = process.env.TUNNEL_TOKEN;

if (grezzo === undefined || grezzo.trim() === '') {
  errore('manca del tutto.', 'La variabile è assente o vuota.');
}

// Gli spazi ai bordi sopravvivono a un copia-incolla e cloudflared li rifiuta:
// toglierli qui non nasconde nulla, perché un token non ne contiene.
let token = grezzo.trim();

// docker compose toglie già le virgolette che racchiudono un valore nel .env,
// ma un token virgolettato *dentro* il compose o esportato a mano no.
if (/^(["']).*\1$/s.test(token)) {
  token = token.slice(1, -1).trim();
}

if (/^cloudflared\b|^docker\b|^sudo\b/.test(token)) {
  errore(
    'è stato incollato il comando intero.',
    'Cloudflare mostra un comando come `docker run … --token eyJhIjoi…`.',
    'Serve solo la stringa dopo --token, non il comando.'
  );
}

if (/(^|\s)--?token(\s|=)/.test(token)) {
  errore(
    'contiene l\'opzione --token.',
    'Va incollato il solo valore, senza `--token` davanti.'
  );
}

if (/\s/.test(token)) {
  errore(
    'contiene spazi o andate a capo.',
    'Un token del tunnel è una sola stringa senza interruzioni: probabilmente',
    'il copia-incolla l\'ha spezzato su più righe.'
  );
}

if (!/^[A-Za-z0-9+/_=-]+$/.test(token)) {
  errore(
    'contiene caratteri che un token non può avere.',
    'Se nel .env compaiono i puntini «…» dell\'esempio, il token vero non è',
    'ancora stato incollato.'
  );
}

// Il token è JSON codificato in base64: {"a":account,"t":tunnel,"s":segreto}.
let dati;
try {
  // base64url e base64 senza riempimento sono entrambi accettati da cloudflared.
  const normalizzato = token.replace(/-/g, '+').replace(/_/g, '/');
  const testo = Buffer.from(normalizzato, 'base64').toString('utf8');
  dati = JSON.parse(testo);
} catch {
  errore(
    'non è la stringa che Cloudflare ha generato.',
    'Un token valido comincia per «eyJ» ed è lungo un paio di centinaia di',
    'caratteri. Controlla di non averne copiato solo una parte.'
  );
}

if (!dati || typeof dati !== 'object' || Array.isArray(dati)) {
  errore('non ha il contenuto atteso.', 'Ricopia il token dal pannello Cloudflare.');
}

const mancanti = ['a', 't', 's'].filter((k) => typeof dati[k] !== 'string' || !dati[k]);
if (mancanti.length) {
  errore(
    'è incompleto.',
    'Mancano dei campi interni: il token è stato troncato nel copia-incolla.'
  );
}

if (!/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(dati.t)) {
  errore(
    'non contiene un identificativo di tunnel valido.',
    'Potrebbe essere il token di un\'altra cosa (una service token API, per',
    'esempio) e non quello del tunnel.'
  );
}

// Il segreto del connettore è a sua volta base64: 32 byte.
const segreto = Buffer.from(dati.s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
if (segreto.length < 32) {
  errore(
    'contiene un segreto più corto del previsto.',
    'Il token è probabilmente incompleto: ricopialo per intero.'
  );
}

process.stdout.write(
  `${tinta(process.stdout.isTTY, 32, 'TUNNEL_TOKEN: formato corretto')} — avvio del tunnel.\n` +
  '  Se Cloudflare lo rifiuta lo stesso, il tunnel è stato cancellato o il\n' +
  '  token è stato ruotato nel pannello: generane uno nuovo (DEPLOY.md §3).\n'
);
