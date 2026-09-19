# Privacy e GDPR

Questo documento è per **chi gestisce un'istanza di VORTICE**: dice cosa
l'applicazione fa già da sola, cosa resta da fare a chi la installa, e dove
mettere le mani quando serve.

L'informativa per le persone è un'altra cosa e sta nel sito:
[`/privacy.html`](public/privacy.html) e [`/cookie.html`](public/cookie.html).

---

## Cosa fa l'applicazione

Il principio è la **minimizzazione** (art. 5 §1 lett. c): il modo più semplice
di proteggere un dato è non averlo.

| Scelta | Perché |
|---|---|
| Nessun analytics, nessun pixel, nessuna CDN | Non esiste il codice che li implementerebbe |
| Font scaricati e serviti dal proprio dominio | Un `<link>` a Google comunicherebbe l'IP di ogni visitatore a un terzo extra UE |
| CSP `default-src 'self'` senza origini esterne | Nemmeno una modifica distratta può reintrodurre una terza parte: il test la fa fallire |
| Due soli cookie, entrambi tecnici | Nessun banner da mostrare, perché non c'è consenso da raccogliere |
| Indirizzi IP solo in memoria, massimo un'ora | Servono a contare i tentativi di accesso; nel database non entrano mai |
| Nessun dato dell'autore nell'API pubblica | Chi digita un codice vede il pezzo, non chi l'ha fatto |
| Log senza query string | I token di conferma e reimpostazione viaggiano lì dentro |
| Nel database solo hash di password, sessioni e token | Una copia del database non dà accesso a nessun account |

### I diritti sono endpoint, non email

| Diritto | Dove | API |
|---|---|---|
| Accesso e portabilità (art. 15, 20) | `/account.html` → «Scarica i tuoi dati» | `GET /api/auth/export` |
| Rettifica (art. 16) | `/account.html` → «Cambia indirizzo email» | `POST /api/auth/change-email` |
| Cancellazione (art. 17) | `/account.html` → «Elimina l'account» | `POST /api/auth/delete-account` |
| Presa visione aggiornata (art. 7 §1) | `/account.html`, quando l'informativa cambia | `POST /api/auth/accept-privacy` |
| Limitazione e opposizione (art. 18, 21) | Recapiti del titolare nell'informativa | — |

La cancellazione è **reale e immediata**: `ON DELETE CASCADE` porta via
sessioni, creazioni, pubblicazioni e anteprime, e i codici di produzione già
pubblicati smettono di rispondere. Non esiste una disattivazione morbida, non
esiste un cestino: se serve conservare qualcosa, va scaricato prima.

---

## Cosa deve fare chi installa

1. **Compilare i recapiti del titolare.** `PRIVACY_CONTROLLER` e
   `PRIVACY_CONTACT_EMAIL` sono il minimo; senza, l'informativa dichiara da
   sola di essere incompleta. Vedi [`.env.example`](.env.example).
2. **Rileggere l'informativa** e adattarla se l'istanza fa qualcosa in più
   (un backup su un servizio esterno, per esempio, è un responsabile in più da
   dichiarare).
3. **Decidere la conservazione.** `UNVERIFIED_ACCOUNT_DAYS` e
   `INACTIVE_ACCOUNT_DAYS` sono le due leve; quest'ultima è spenta per
   impostazione predefinita perché cancella anche il lavoro delle persone.
4. **Nominare un responsabile per ogni fornitore** che tratta dati per conto
   tuo (art. 28): servizio SMTP, Cloudflare, chi ospita la macchina.
   L'informativa li elenca automaticamente quando sono configurati.
5. **Proteggere i backup.** `scripts/backup.js` produce una copia del database:
   contiene tutti i dati personali e va custodita come l'originale, cifrata se
   esce dalla macchina, e cancellata secondo la stessa politica.
6. **`LOG_MAIL_LINKS=0` in produzione** (è già il default con
   `NODE_ENV=production`): senza SMTP i link di reimpostazione finirebbero nel
   log in chiaro.
7. **Aggiornare `PRIVACY_POLICY_VERSION`** a ogni modifica sostanziale
   dell'informativa: chi ha accettato la versione precedente se lo vede
   chiedere di nuovo dalla pagina account.

---

## Registro delle attività di trattamento (art. 30)

Da compilare con i propri dati nelle parti fra parentesi; il resto descrive
l'applicazione così com'è.

### 1 · Gestione degli account dello studio

- **Titolare:** (nome, indirizzo, email, P. IVA)
- **Finalità:** consentire l'accesso allo studio, conservare le creazioni,
  gestire credenziali e recupero password.
- **Base giuridica:** art. 6 §1 lett. b — esecuzione del contratto di servizio.
- **Categorie di interessati:** persone registrate.
- **Categorie di dati:** indirizzo email; hash della password; date di
  registrazione, conferma e ultimo accesso; presa visione dell'informativa con
  versione e data; contenuti creati (parametri geometrici, nomi, incisioni
  personali, anteprime, prodotti pubblicati).
- **Destinatari:** fornitore SMTP (se configurato), fornitore del tunnel/CDN
  (se configurato), hosting.
- **Trasferimenti extra UE:** nessuno di iniziativa dell'applicazione; da
  verificare per i fornitori scelti.
- **Conservazione:** fino alla cancellazione richiesta dall'interessato;
  account mai confermati cancellati dopo `UNVERIFIED_ACCOUNT_DAYS`; account
  dormienti dopo `INACTIVE_ACCOUNT_DAYS` se attivo.
- **Misure di sicurezza:** vedi la sezione seguente.

### 2 · Sicurezza del servizio (limite ai tentativi di accesso)

- **Finalità:** impedire attacchi a forza bruta su accessi, registrazioni e
  ricerche di codice.
- **Base giuridica:** art. 6 §1 lett. f — legittimo interesse (considerando 49).
- **Categorie di dati:** indirizzo IP, indirizzo email usato nel tentativo.
- **Conservazione:** in sola memoria, finestra massima di un'ora; nessuna
  scrittura su disco.

### 3 · Area pubblica (consultazione da codice)

- **Finalità:** mostrare il prodotto corrispondente a un codice inciso.
- **Dati personali trattati:** nessuno. Il contatore di visualizzazioni è un
  numero per prodotto, senza chi, quando o da dove.

---

## Violazione dei dati personali (art. 33 e 34)

Se succede — accesso non autorizzato al server, copia del database, chiave
compromessa:

1. **Contenere.** Togliere il servizio dalla rete (`docker compose stop`) o
   revocare il token del tunnel.
2. **Invalidare.** Con il database accessibile:
   ```sql
   DELETE FROM sessions;                                             -- tutti fuori
   UPDATE users SET reset_token = NULL, reset_expires = NULL;        -- reset in corso annullati
   ```
   Se è ragionevole che gli hash delle password siano usciti, imporre a tutti
   la reimpostazione e dirlo esplicitamente nella comunicazione.
3. **Documentare** sempre: cosa è successo, quando, quali categorie di dati e
   quante persone, conseguenze probabili, misure prese. Il registro delle
   violazioni va tenuto anche quando la notifica non è dovuta.
4. **Notificare** all'autorità di controllo **entro 72 ore** dal momento in cui
   se ne è venuti a conoscenza, salvo che sia improbabile un rischio per i
   diritti delle persone (art. 33).
5. **Informare le persone** senza ingiustificato ritardo se il rischio è
   elevato (art. 34). Gli indirizzi email sono nella tabella `users`.

---

## Verifiche automatiche

`npm test` esegue anche [`test/gdpr.test.js`](test/gdpr.test.js), che non
verifica intenzioni ma comportamenti:

- senza presa visione dell'informativa l'account non nasce, e la presa visione
  viene conservata con data e versione;
- l'export contiene account, sessioni e creazioni, ed è riutilizzabile;
- la cancellazione svuota davvero il database e spegne il codice pubblicato;
- i token inviati per email stanno in database solo come SHA-256;
- gli indirizzi email nei log sono mascherati;
- l'API pubblica non lascia uscire nulla dell'autore;
- **nessuna pagina carica risorse da domini esterni** e la CSP non nomina
  alcuna origine esterna.

I test nel browser (`npm run test:e2e`) verificano in più che **nessuna
richiesta di rete esca da questo dominio** durante l'intero percorso d'uso:
è la rete di sicurezza contro una terza parte reintrodotta per distrazione.
