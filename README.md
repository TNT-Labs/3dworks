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
npm test          # 121 test rapidi (spec, geometria, tenuta, ricetta, API, proxy, GDPR, sicurezza)
npm run test:e2e  # 15 test nel browser vero, lenti
npm run test:all  # tutti
```

Per popolare un'istanza di prova con un account e tre prodotti pubblicati:

```bash
node scripts/seed-demo.js http://localhost:3000
```

### In produzione

Con Docker — è il modo previsto, e l'unico provato su Raspberry Pi:

```bash
cp .env.docker.example .env      # ci va il token del tunnel Cloudflare
docker compose up -d --build
```

**[DEPLOY.md](DEPLOY.md)** ha la procedura completa per un Raspberry Pi 5 dietro un
tunnel Cloudflare: creazione del tunnel, impostazioni Cloudflare da controllare
(Rocket Loader va spento, o lo studio non parte), backup, aggiornamenti e i sintomi
più comuni con la loro causa.

Senza Docker:

```bash
NODE_ENV=production \
VORTICE_BASE_URL=https://shopbeautylab.it \
TRUST_PROXY=1 CLOUDFLARE=1 COOKIE_SECURE=1 \
VORTICE_DB=/var/lib/vortice/vortice.db \
npm start
```

Dietro un proxy `TRUST_PROXY` è necessario, altrimenti il limite sui tentativi di
accesso vede l'indirizzo del proxy per tutti e blocca i visitatori insieme;
`CLOUDFLARE=1` fa leggere il vero indirizzo da `CF-Connecting-IP`.

Backup a server acceso, coerente anche durante una scrittura:

```bash
node scripts/backup.js /percorso/dei/backup
```

Verifica di tenuta di un design, misurata sulla mesh che verrebbe esportata:

```bash
node scripts/tenuta.js                       # i quattro preset
node scripts/tenuta.js "v=1&h=185&r=62&…"    # un design: la parte dopo il # del link
```

---

## Com'è fatto

```
server/
  app.js              intestazioni di sicurezza, rotte, file statici
  index.js            avvio
  lib/config.js       configurazione da variabili d'ambiente
  lib/db.js           schema SQLite e query preparate
  lib/auth.js         scrypt, sessioni, codici di produzione, scadenze
  lib/http.js         cookie, CSRF, rate limit, guardie di accesso
  lib/mailer.js       invio email facoltativo
  lib/personal-data.js  export dei dati di una persona (art. 15 e 20)
  routes/             auth · designs · public · legal

public/
  js/design-spec.js   ← limiti, serializzazione, impronta   (browser + server)
  js/vcore.js         ← motore geometrico                   (pagina + Worker)
  js/design-model.js  stato del design e geometria di anteprima, senza DOM
  js/stage.js         scena Three.js                        (studio + viewer)
  js/studio.js        interfaccia di creazione
  js/viewer.js        scheda pubblica in sola lettura
  index.html · prodotto.html · studio.html · accedi.html
  account.html        dati dell'account e diritti: export, rettifica, cancellazione
  privacy.html · cookie.html   informativa e cookie, riempite da /api/legal

Dockerfile · docker-compose.yml · DEPLOY.md · PRIVACY.md · STAMPA.md
```

### Tenuta al liquido

Il dispenser deve contenere sapone, quindi la tenuta è una proprietà della
geometria, non una raccomandazione di stampa. È garantita su due piani.

**La mesh è chiusa.** `validateMesh` verifica coordinate finite, indici validi,
assenza di bordi aperti o non-manifold, winding coerente e volume positivo.
L'export si rifiuta di produrre un file che non passi: non esiste un STL scaricabile
con la mesh rotta.

**Il guscio ha davvero lo spessore dichiarato.** Nella V3 la faccia esterna e la
cavità venivano limitate separatamente per rispettare i 44°, e le costole avevano
ampiezza diversa dentro e fuori: lo spessore reale poteva scendere a 0,9 mm anche
con 2,4 mm richiesti — il preset di partenza si assottigliava a 1,14 mm nella fascia
della spalla, formando una striscia sottile per ogni costola. Con 4 perimetri da
0,45 mm servono 1,8 mm perché la parete si chiuda: sotto, il pezzo perde.

Ora la cavità è **derivata** dalla faccia esterna sottraendo lo spessore voluto,
invece di essere una seconda superficie vincolata per conto suo, e le costole hanno
la stessa ampiezza sui due lati. Lo spessore è esatto per costruzione:

|  | prima | ora |
|---|---|---|
| parete minima, caso peggiore | 0,90 mm | **2,00 mm** |
| design sotto 1,8 mm | 69% | **0%** |
| faccia esterna | — | **invariata su 3888/3888 design** |
| overhang | — | **nessun peggioramento** |

La fascia più colpita era proprio quella **sotto l'attacco della pompa**, dove il
pezzo viene sollecitato avvitandolo: lì la parete scendeva a 0,90–1,26 mm, in sei
strisce verticali, e il 65% dei design aveva quel tratto sotto 1,8 mm. Il collo
filettato in sé è sempre stato 3,00 mm — non era lui il punto debole, era la spalla
che ci arriva. Lo spessore ora cresce senza avvallamenti dal corpo al collo, e due
test sorvegliano quel tratto separatamente.

Nel collo lo spessore lo detta la norma GPI (3 mm) e sopra i 3 mm segue lo slider,
rientrando l'alesaggio quel tanto che basta: il passaggio per la cannuccia perde al
massimo 0,4 mm di diametro. Lo spessore misurato è riportato nella scheda del pezzo
e in quella pubblica, e l'export lo rifiuta sotto la soglia.

**La cucitura Z non si incolonna.** Ogni giro di perimetro deve iniziare e finire
da qualche parte, e lì l'estrusione si interrompe: resta un grumo o un microvuoto.
Il default di PrusaSlicer e di Orca è `aligned`, che impila quei punti sulla stessa
verticale per farli sembrare una riga sola — ordinato a vedersi, ma in un
contenitore diventa un canale continuo dal fondo al collo. La ricetta incorporata
nel 3MF impone `seam_position = random` e le cuciture dei perimetri interni
sfalsate: i difetti restano isolati e lo strato sopra copre quello sotto.

L'STL non trasporta impostazioni, quindi chi lo esporta deve mettere la cucitura
su «casuale» a mano — lo Studio lo dice sotto il pulsante quando è selezionato.

**Il fondo è pieno per tutto il suo spessore.** Il fondo è alto 3–4 mm di geometria
piena, ma con i soli strati solidi di ricetta ne venivano stampati pieni appena
2,0 mm: in mezzo restava riempimento al 6%, e il vero sbarramento sotto il liquido
erano gli strati solidi superiori — 1 mm steso sopra il vuoto. È la costruzione
normale di qualsiasi stampa e di solito tiene, ma qui sotto c'è sapone.
`bottom_solid_min_thickness = 4` lo riempie per intero. Costa **+9–14% di materiale
e 1,5–2,2 ore**.

Effetto collaterale utile: così il pezzo non ha più alcuna zona a riempimento rado
— la parete era già tutta perimetri — e **il materiale torna a essere il volume
esatto della geometria**. Prima il fondo valeva 0,672 del suo volume, un rapporto
misurato su 8 slicing reali ma uno solo, mentre quello vero dipende dall'altezza
(0,68 a h 120, 0,54 a h 235). Quell'errore sistematico non esiste più. La stima del
tempo resta quella tarata e ora tende a sovrastimare di qualche punto, perché il
pieno si stampa più in fretta dei perimetri: si ritara con un solo slicing reale.

Resta fuori dal controllo del software ciò che dipende dalla stampante: prima
aderenza, temperatura, umidità del filamento. La geometria garantisce che i
perimetri ci stiano e la ricetta che non si allineino — che vengano estrusi bene
è un'altra cosa.

---

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

### Misurare la tenuta

Le garanzie della sezione precedente non vanno prese sulla parola:

```bash
node scripts/tenuta.js          # i quattro preset, più una scansione dell'affilatura
```

Costruisce la stessa mesh dell'export, misura i tre spessori da cui dipende la
tenuta e li legge in **passate di estrusione**, che è ciò che decide se lo
slicer chiude la parete o ci lascia una fessura.

**[STAMPA.md](STAMPA.md)** raccoglie le misure caso per caso, le impostazioni
dello slicer in ordine di importanza, il protocollo di prova con acqua in
pressione — e una nota su cosa resta una scelta aperta, la cucitura Z.

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

### Privacy e GDPR

Il modo più solido di proteggere un dato è non averlo: l'applicazione raccoglie
un indirizzo email, una password (di cui conserva solo l'hash) e ciò che si
disegna. Nient'altro.

- **Nessuna terza parte.** Niente analytics, niente CDN, nessun pulsante social.
  I caratteri tipografici sono scaricati da `npm install` e serviti dal proprio
  dominio: un `<link>` a `fonts.googleapis.com` comunicherebbe a Google
  l'indirizzo IP di ogni visitatore, prima di qualsiasi consenso. La CSP è
  `default-src 'self'` **senza alcuna origine esterna**, e un test fallisce se
  una pagina ne reintroduce una.
- **Due soli cookie, entrambi tecnici** (sessione e CSRF): rientrano
  nell'esenzione dell'art. 122 del Codice privacy, quindi non c'è banner —
  perché non c'è consenso da chiedere.
- **I diritti sono bottoni.** Da `/account.html` si scaricano i propri dati in
  JSON (art. 15 e 20), si corregge l'indirizzo email (art. 16) e si elimina
  l'account (art. 17). La cancellazione è immediata e reale: spariscono
  creazioni, pubblicazioni e sessioni, e i codici già pubblicati smettono di
  rispondere.
- **Presa visione registrata** alla registrazione, con la versione
  dell'informativa: cambiando `PRIVACY_POLICY_VERSION` viene richiesta di nuovo.
- **Informativa a misura dell'istanza.** `/privacy.html` e `/cookie.html` si
  riempiono da `/api/legal`, che legge i recapiti del titolare dall'ambiente:
  `PRIVACY_CONTROLLER` e `PRIVACY_CONTACT_EMAIL` sono da compilare prima di
  aprire il sito al pubblico, altrimenti la pagina dichiara di essere incompleta.
- **Scadenze.** Sessioni e token di reimpostazione vengono eliminati ogni ora;
  gli account mai confermati dopo `UNVERIFIED_ACCOUNT_DAYS`; quelli dormienti
  solo se si attiva `INACTIVE_ACCOUNT_DAYS`. Gli indirizzi IP servono al limite
  sui tentativi di accesso, restano in memoria al massimo un'ora e nel database
  non entrano mai.

**[PRIVACY.md](PRIVACY.md)** ha il registro dei trattamenti da compilare
(art. 30), la procedura in caso di violazione dei dati (art. 33) e la lista di
ciò che deve fare chi installa.

### Three.js in locale

`npm install` copia in `public/vendor/three` i tre file necessari e ne riscrive
gli import in percorsi relativi, e scarica in `public/vendor/fonts` i due
caratteri del sito (Space Grotesk e IBM Plex Mono, SIL OFL). Lo studio funziona
quindi anche senza CDN — rete aziendale, intranet, macchina isolata — e non serve
alcun `<script type="importmap">`. **Non resta alcuna risorsa esterna**: se il
download dei caratteri non riesce lo script non fallisce e la pagina usa quelli
di sistema, ma nemmeno in quel caso il browser contatta qualcuno.

---

## Licenza

MIT — vedi [LICENSE](LICENSE).
