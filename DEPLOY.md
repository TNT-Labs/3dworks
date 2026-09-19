# Deploy su Raspberry Pi 5 con Docker e Cloudflare Tunnel

Guida per mettere **shopbeautylab.it** su un Raspberry Pi 5 di casa, senza aprire
porte sul router e senza IP fisso.

Il tunnel esce *dal* Pi verso Cloudflare: il router non viene toccato. La porta
dell'applicazione non viene pubblicata da nessuna parte — solo `cloudflared`, sulla
rete interna di Docker, può raggiungerla.

```
browser ──HTTPS──> Cloudflare ──tunnel cifrato──> cloudflared ──HTTP──> vortice:3000
                                              (rete interna di Docker, nessuna porta aperta)
```

---

## 1 · Preparare il Raspberry

Serve **Raspberry Pi OS a 64 bit** (l'immagine è `arm64`, su un sistema a 32 bit non parte).

```bash
uname -m          # deve rispondere aarch64
```

Installa Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# esci e rientra perché il gruppo abbia effetto
```

### Metti il database su un SSD, non sulla microSD

SQLite scrive spesso e le schede SD si consumano; un Pi 5 con SSD su USB 3 è anche
molto più veloce. Se hai un disco montato, per esempio, su `/mnt/ssd`:

```bash
sudo mkdir -p /mnt/ssd/vortice
sudo chown 1000:1000 /mnt/ssd/vortice    # l'utente `node` dentro il container
```

e nel `docker-compose.yml` sostituisci il volume con un percorso:

```yaml
    volumes:
      - /mnt/ssd/vortice:/data
```

Con la sola microSD funziona lo stesso — fai solo i backup (§6).

---

## 2 · Prendere il codice e configurare

```bash
git clone https://github.com/TNT-Labs/3dworks.git
cd 3dworks
cp .env.docker.example .env
```

Il `docker-compose.yml` è già impostato per `shopbeautylab.it`. Resta da mettere il
token del tunnel nel `.env`, che ottieni al passo seguente.

### Il titolare del trattamento va dichiarato

Nello stesso `.env` vanno i recapiti che compaiono nell'informativa privacy del sito:

```dotenv
PRIVACY_CONTROLLER=Nome o ragione sociale di chi gestisce il sito
PRIVACY_CONTACT_EMAIL=privacy@shopbeautylab.it
PRIVACY_CONTROLLER_ADDRESS=Via …, Città
PRIVACY_CONTROLLER_VAT=IT01234567890
PRIVACY_HOSTING=Raspberry Pi presso la sede del titolare
```

Finché restano vuoti, `/privacy.html` mostra un avviso che dichiara l'informativa
incompleta — ed è voluto: un sito pubblico senza titolare indicato non è a norma.
La lista completa di ciò che deve fare chi installa è in
[PRIVACY.md](PRIVACY.md).

---

## 3 · Creare il tunnel Cloudflare

Nel pannello **Cloudflare → Zero Trust → Networks → Tunnels**:

1. **Create a tunnel** → tipo **Cloudflared** → dagli un nome (es. `vortice-pi`).
2. Alla schermata *Install and run a connector*, scegli **Docker**. Cloudflare mostra
   un comando che contiene `--token eyJhIjoi…`.
   **Non eseguire quel comando**: copia solo la stringa dopo `--token` e incollala nel `.env`:

   ```
   TUNNEL_TOKEN=eyJhIjoi…
   ```

   Va incollato **solo il valore**: niente `--token` davanti, niente virgolette,
   nessuna andata a capo in mezzo (è una sola riga lunga qualche centinaio di
   caratteri). All'avvio il token viene controllato prima che il tunnel parta: se
   è copiato male, `docker compose up` si ferma dicendo esattamente cosa manca
   invece di riprovare all'infinito.

   Se il tunnel esisteva già, il token si recupera aprendolo e scegliendo
   **Configure**; `Refresh token` ne genera uno nuovo e **invalida il precedente**,
   quindi dopo averlo premuto va aggiornato anche il `.env`.

3. Scheda **Public Hostnames** → **Add a public hostname**:

   | campo | valore |
   |---|---|
   | Subdomain | *(vuoto)* |
   | Domain | `shopbeautylab.it` |
   | Path | *(vuoto)* |
   | Type | `HTTP` |
   | URL | `vortice:3000` |

   `vortice` è il nome del servizio nel compose: `cloudflared` lo risolve sulla rete
   interna di Docker. `HTTP` è corretto e non è un buco: il tratto verso Cloudflare
   è già cifrato dal tunnel, e quel salto resta dentro il Pi.

4. Ripeti per `www.shopbeautylab.it` con lo stesso URL, se vuoi che funzioni anche con `www`.

Il record DNS viene creato da Cloudflare: non devi aggiungerlo a mano.

---

## 4 · Avviare

```bash
docker compose up -d --build
```

La prima costruzione su un Pi richiede qualche minuto (`better-sqlite3` potrebbe
doversi compilare). Le volte successive sono quasi istantanee finché non cambi le
dipendenze.

```bash
docker compose ps          # vortice deve risultare "healthy"
docker compose logs -f     # log dei container
```

Se l'avvio si ferma con `service "tunnel-check" didn't complete successfully`,
è il controllo del token: `docker compose up -d` non ne mostra il motivo, che
si legge con

```bash
docker compose logs tunnel-check
```

Corretto il `.env`, `docker compose run --rm tunnel-check` lo riprova subito.

Poi apri **https://shopbeautylab.it**.

### Provare prima del tunnel

Per vedere il sito dalla rete di casa prima di configurare Cloudflare:

```bash
docker compose -f docker-compose.yml -f docker-compose.lan.yml up -d vortice
# http://<indirizzo-del-pi>:3000
```

Quel file è **solo per le prove**: con la porta esposta chiunque sia sulla rete locale
può dichiarare un `CF-Connecting-IP` falso ed eludere il limite sui tentativi di accesso.

---

## 5 · Impostazioni Cloudflare da controllare

Quasi tutto va bene com'è. Tre voci meritano attenzione.

| Dove | Voce | Come | Perché |
|---|---|---|---|
| Speed → Optimization | **Rocket Loader** | **OFF** | Riscrive e rinvia gli script. L'applicazione carica `vcore.js` come script classico e subito dopo un modulo ES che se lo aspetta già presente: con Rocket Loader attivo lo studio si apre con «Nucleo geometrico non caricato». |
| SSL/TLS → Overview | **Full (strict)** | consigliato | Evita che il dominio accetti connessioni non cifrate verso altre origini. Il tunnel è cifrato a prescindere. |
| SSL/TLS → Edge Certificates | **Always Use HTTPS** | **ON** | I cookie di sessione sono `Secure`: su HTTP non verrebbero inviati e l'accesso girerebbe a vuoto. |

Facoltativi: **Brotli** acceso va benissimo. **Bot Fight Mode** può inserire una sfida
JavaScript nelle pagine — se noti comportamenti strani nello studio, prova a spegnerlo.
**Auto Minify** (se la tua zona lo mostra ancora) va spento: il codice è già compatto e
la minificazione automatica ha una lunga storia di script rotti.

Cloudflare vede l'indirizzo IP di ogni visitatore, quindi con `CLOUDFLARE=1`
diventa un **responsabile del trattamento** (art. 28): va nominato con un accordo —
Cloudflare ne pubblica uno standard — e l'informativa del sito lo elenca da sola
fra i destinatari.

La cache non va configurata: le risposte portano già le intestazioni giuste.
Gli asset e la scheda pubblica sono cacheabili al bordo — è ciò che tiene basso il
carico sul Pi — mentre tutto ciò che riguarda la sessione è `no-store`.

---

## 6 · Primo avvio e gestione

### Crea il tuo account, poi chiudi le registrazioni

Vai su `https://shopbeautylab.it/accedi.html?modo=registrazione` e registrati. Poi, se il
sito deve restare tuo:

```yaml
      ALLOW_REGISTRATION: "0"
```

```bash
docker compose up -d
```

La parte pubblica continua a funzionare per chiunque: chiudere le registrazioni
riguarda solo chi può *creare*.

### Backup

```bash
docker compose exec vortice node scripts/backup.js /data/backup
```

Usa il backup online di SQLite, quindi è coerente anche mentre qualcuno sta salvando —
cosa che una semplice copia del file non garantisce. Conserva le ultime 14 copie
(`BACKUP_KEEP` per cambiarne il numero).

Ogni notte alle 3, con `crontab -e` sul Pi:

```cron
0 3 * * * cd /home/pi/3dworks && docker compose exec -T vortice node scripts/backup.js /data/backup >> /var/log/vortice-backup.log 2>&1
```

Portale anche fuori dal Pi: un disco che muore si porta via anche i backup che ci stanno sopra.

Il backup **contiene tutti i dati personali** — indirizzi email, hash delle password,
creazioni — quindi va custodito come il database originale: cifrato se lascia la
macchina, con gli stessi tempi di conservazione, e cancellato davvero quando scade.
Se lo copi su un servizio di terzi, quel servizio diventa un responsabile del
trattamento da nominare e da indicare nell'informativa (`PRIVACY_HOSTING` o una voce
aggiunta a mano in `/privacy.html`).

### Aggiornare

```bash
git pull
docker compose up -d --build
```

Lo schema del database si aggiorna da solo all'avvio; i dati restano.

### Fermare

```bash
docker compose down          # ferma tutto, il volume dei dati resta
docker compose down -v       # ATTENZIONE: cancella anche il database
```

---

## 7 · Se qualcosa non va

| Sintomo | Causa quasi certa |
|---|---|
| **Error 502** da Cloudflare | Il container non è ancora `healthy`, oppure nel Public Hostname hai messo `localhost:3000` invece di `vortice:3000`: dentro `cloudflared`, `localhost` è `cloudflared` stesso. |
| **Error 1033** | Il tunnel non è connesso: `docker compose logs cloudflared`. Di solito è il `TUNNEL_TOKEN` copiato male. |
| **`Provided Tunnel token is not valid`** e `vortice-tunnel` che riparte in continuazione | Il token è stato rifiutato da Cloudflare. Il controllo all'avvio (`vortice-tunnel-check`) intercetta i casi di copia-incolla: se invece l'ha lasciato passare, il formato è giusto ma il token non vale più — il tunnel è stato cancellato o qualcuno ha premuto *Refresh token*. Rigenera il token dal pannello (§3), aggiorna il `.env` e `docker compose up -d`. |
| **`service "tunnel-check" didn't complete successfully: exit 1`** | Non è un guasto: è il controllo del token che ha fermato l'avvio del tunnel. Con `up -d` il motivo non compare a schermo — leggilo con **`docker compose logs tunnel-check`**. Corretto il `.env`, `docker compose run --rm tunnel-check` lo riprova in un istante senza avviare nulla. Il sito intanto gira: manca solo l'accesso da fuori. |
| L'accesso riesce ma **torna subito alla pagina di login** | I cookie sono `Secure` e il sito è stato raggiunto in HTTP. Accendi *Always Use HTTPS*. |
| **«Nucleo geometrico non caricato»** nello studio | Rocket Loader acceso (§5). |
| **«Impossibile caricare la libreria 3D»** | La cartella `public/vendor` non è finita nell'immagine: ricostruisci con `docker compose build --no-cache`. |
| **«Troppi tentativi»** a persone diverse contemporaneamente | `CLOUDFLARE` o `TRUST_PROXY` non impostati: senza, il limite conta il tunnel come un solo visitatore. |
| Il container riparte in continuazione | `docker compose logs vortice`. Se è `SQLITE_CANTOPEN`, i permessi della cartella dati: `sudo chown 1000:1000 <cartella>`. |
| Le email di conferma non arrivano | Normale senza SMTP: i link compaiono in `docker compose logs vortice`. Da una linea domestica la posta in uscita è quasi sempre bloccata, quindi serve un servizio transazionale. |

---

## 8 · Quanto carico regge un Pi 5

Molto più di quanto sembri, perché **il lavoro pesante non è sul server**.

La geometria, l'anteprima 3D e la generazione dell'STL avvengono nel browser di chi
guarda — il Worker gira sul suo computer, non sul Pi. Il Raspberry serve file statici
e qualche query SQLite da poche righe: consuma dell'ordine di 100 MB di RAM e resta
quasi sempre inattivo.

Il file più grosso è Three.js (1,3 MB), scaricato una volta e poi servito da Cloudflare
al bordo, non dal Pi. Anche gli STL — che possono pesare 16 MB — non passano mai dal
server: nascono nel browser e finiscono direttamente nella cartella dei download.

In pratica il limite pratico non è il Pi, ma la banda in upload della tua linea per il
primo caricamento di ogni visitatore — e quella la assorbe la cache di Cloudflare.
