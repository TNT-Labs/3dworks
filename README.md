# VORTICE · studio generativo web

Applicazione web per disegnare, salvare e pubblicare dispenser e portaspazzolino
generativi, stampabili in 3D senza supporti su un piano 220 × 220 × 250 mm.

Nasce dalla reingegnerizzazione di `Vortice_DispenserV3.0.html`, un unico file da
3.280 righe che funzionava solo aprendolo dal disco e teneva l'archivio in
`localStorage` — quindi legato a un browser. Ora è un'applicazione servita in rete,
con account, creazioni conservate sul server e una parte pubblica.

L'originale resta in [`legacy/`](legacy/) come riferimento.

---

## Le due metà dell'applicazione

**Studio** — `/studio.html`, dietro accesso.
Tutti i comandi della V3: preset, profilo in quota, costole, torsione, affilatura,
collo filettato GPI, incisione sul fondo, segnale personale da traccia GPX o dalla
voce, progettazione inversa ed export STL/3MF. In più: le creazioni si salvano sul
server e si ritrovano da qualsiasi dispositivo.

**Area pubblica** — `/` e `/p/CODICE`, senza account.
Si digita il codice di produzione inciso sul fondo del pezzo e si vede il modello
in 3D con la sua scheda tecnica. Si può orbitare, ingrandire e sezionare: **non
c'è un solo comando che modifichi il design**, nessuno slider, nessun campo di
testo, nessun export. È una vetrina, non un editor.

### Il codice di produzione

Alla pubblicazione il server assegna un codice univoco nella forma `VRT-7K3QX`.

- **È definitivo.** Una volta assegnato non cambia più, perché finisce inciso sul
  fondo del pezzo. Ritirare e ripubblicare restituisce lo stesso codice.
- **Viene inciso.** Finché il design non è pubblicato il fondo porta l'*impronta*
  dei parametri; dopo la pubblicazione porta il codice di produzione, e l'STL che
  si scarica da quel momento lo contiene.
- **Congela la forma.** Pubblicare salva un'istantanea: chi digita il codice vede
  sempre il pezzo che è stato stampato, anche se nel frattempo il progetto è stato
  modificato. Lo studio segnala lo scostamento e chiede conferma prima di
  sostituire una versione già pubblicata.
- **Si legge senza ambiguità.** L'alfabeto è base32 Crockford: niente `I`, `L`, `O`,
  `U`. Chi legge `O` o `I` sul fondo e li digita così ottiene comunque il pezzo giusto.

---

## Avvio

Serve **Node.js 20 o superiore**.

```bash
npm install     # installa e copia Three.js in public/vendor
npm start       # http://localhost:3000
```

Non serve altro: il database SQLite si crea da solo in `data/`, l'invio email è
facoltativo e le registrazioni sono aperte. Per configurare copia
[`.env.example`](.env.example) in `.env`.

```bash
npm run dev       # riavvio automatico a ogni modifica
npm test          # 45 test rapidi (spec, geometria, API)
npm run test:e2e  # 13 test nel browser vero, lenti
npm run test:all  # tutti
```

Per popolare un'istanza di prova con un account e tre prodotti pubblicati:

```bash
node scripts/seed-demo.js http://localhost:3000
```

### In produzione

```bash
NODE_ENV=production \
VORTICE_BASE_URL=https://vortice.esempio.it \
TRUST_PROXY=1 COOKIE_SECURE=1 \
VORTICE_DB=/var/lib/vortice/vortice.db \
npm start
```

Dietro un reverse proxy `TRUST_PROXY=1` è necessario, altrimenti il rate limit
vede l'indirizzo del proxy per tutti. Il backup è la copia del file SQLite (con i
suoi `-wal` e `-shm`, oppure a server fermo).

---

## Com'è fatto

```
server/
  app.js              intestazioni di sicurezza, rotte, file statici
  index.js            avvio
  lib/config.js       configurazione da variabili d'ambiente
  lib/db.js           schema SQLite e query preparate
  lib/auth.js         scrypt, sessioni, codici di produzione
  lib/http.js         cookie, CSRF, rate limit, guardie di accesso
  lib/mailer.js       invio email facoltativo
  routes/             auth · designs · public

public/
  js/design-spec.js   ← limiti, serializzazione, impronta   (browser + server)
  js/vcore.js         ← motore geometrico                   (pagina + Worker)
  js/design-model.js  stato del design e geometria di anteprima, senza DOM
  js/stage.js         scena Three.js                        (studio + viewer)
  js/studio.js        interfaccia di creazione
  js/viewer.js        scheda pubblica in sola lettura
  index.html · prodotto.html · studio.html · accedi.html
```

Tre decisioni reggono tutto il resto.

**Una sola definizione dei parametri.** `public/js/design-spec.js` è un modulo ES
importato sia dal browser sia da Node. I limiti degli slider, la serializzazione
nel link e la validazione server-side sono lo stesso codice: non possono divergere.
Il formato del link è rimasto quello della V3, quindi i link già condivisi
continuano a funzionare.

**Una sola definizione della geometria.** `vcore.js` è estratto invariato
dall'originale e caricato sia dalla pagina sia dal Web Worker che genera l'STL.
Ciò che si vede sullo schermo e ciò che si scarica vengono dalle stesse funzioni.
Nella V3 il Worker nasceva da un `Blob` col testo dello script; ora è un file vero,
quindi la CSP non ha bisogno di deroghe.

**La geometria non conosce il DOM.** `design-model.js` produce buffer di vertici e
una scheda di misure; `stage.js` la disegna; l'interfaccia la scrive. È questa
separazione che rende possibile una pagina pubblica senza un solo comando di
modifica — e che permette di testare la geometria in Node, senza browser.

### Sicurezza

- Password con **scrypt** (`node:crypto`, parametri OWASP): nessun modulo nativo
  da compilare sul pezzo più delicato.
- Sessioni in cookie `HttpOnly` `SameSite=Lax`; nel database è salvato solo l'hash
  del token, quindi una copia del database non dà sessioni utilizzabili.
- **CSRF** double-submit su ogni richiesta che scrive, con il token emesso anche
  ai visitatori anonimi perché il primo accesso possa firmarsi.
- **Rate limit** su accesso e registrazione, per indirizzo IP *e* per email: chi
  cambia IP non guadagna tentativi su un singolo account.
- Accesso con password sbagliata e utente inesistente danno la stessa risposta,
  nello stesso tempo: gli indirizzi registrati non sono deducibili.
- Cambiare password chiude tutte le altre sessioni.
- **CSP senza `unsafe-inline`**: nessuno script inline, Three.js risolto in locale.
- Lo stato dei design non viene mai creduto sulla parola: passa da
  `normalizeState` prima di toccare il database.
- L'API pubblica non espone nulla dell'autore: né email, né identificativo.

### Three.js in locale

`npm install` copia in `public/vendor/three` i tre file necessari e ne riscrive
gli import in percorsi relativi. Lo studio funziona quindi anche senza CDN — rete
aziendale, intranet, macchina isolata — e non serve alcun `<script type="importmap">`.
L'unica risorsa esterna rimasta sono i font Google, del tutto facoltativi: senza,
la pagina usa i font di sistema.

---

## Licenza

MIT — vedi [LICENSE](LICENSE).
