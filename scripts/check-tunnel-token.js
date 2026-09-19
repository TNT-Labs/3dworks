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

// Da qui in poi la stringa ha l'aspetto giusto ma potrebbe essere tutt'altra
// cosa. Sono pochi i valori che si finisce per incollare al posto del token,
// e si riconoscono: dirlo per nome risparmia mezz'ora di tentativi.

// La lunghezza non è un segreto e distingue subito un troncamento da uno
// scambio di valore.
const lungo = `È lungo ${token.length} caratteri, quelli veri circa 180-250.`;

if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
  errore(
    'è l\'identificativo del tunnel, non il suo token.',
    'L\'UUID che il pannello mostra sotto il nome del tunnel serve ad altro.',
    'Il token è la stringa lunga che compare dopo --token in «Configure».'
  );
}

// Un token API di Cloudflare (Profile → API Tokens) passa i controlli di
// forma ma non ha nulla a che vedere con il tunnel: è l'equivoco più comune.
if (token.length >= 30 && token.length <= 60 && !token.startsWith('eyJ')) {
  errore(
    'sembra un token API di Cloudflare, non quello del tunnel.',
    'Sono due cose diverse: quello del tunnel comincia sempre per «eyJ» e sta',
    'in Zero Trust → Networks → Tunnels, non nel profilo dell\'account.',
    lungo
  );
}

if (!token.startsWith('eyJ')) {
  errore(
    'non comincia per «eyJ».',
    'Ogni token di tunnel comincia così: quello nel .env è un\'altra stringa.',
    lungo
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
    'comincia bene ma è rovinato.',
    'Quasi certamente è stato copiato a metà: il pannello lo mostra su più',
    'righe e la selezione col mouse ne lascia spesso fuori un pezzo. Usa il',
    'bottone che copia il comando negli appunti.',
    lungo
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
