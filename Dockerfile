# =====================================================================
# VORTICE · immagine per Raspberry Pi 5 (arm64) e qualunque altra macchina.
#
# Due stadi: il primo compila e prepara, il secondo contiene solo ciò che
# serve a servire il sito. Risultato: niente compilatori nell'immagine
# finale e niente sorgenti di Three.js (33 MB) che dopo la vendorizzazione
# non servono più.
# =====================================================================

# ------------------------------ costruzione ------------------------------
FROM node:22-bookworm-slim AS build

# better-sqlite3 pubblica binari già compilati per linux/arm64, ma se per la
# combinazione di versioni non ce ne fosse uno deve poter compilare da sorgente
# invece di fallire l'installazione.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Prima le sole dipendenze: finché package-lock.json non cambia, Docker riusa
# questo strato e non ricompila nulla (su un Pi è la differenza fra minuti e secondi).
COPY package.json package-lock.json ./
COPY scripts/vendor-three.js scripts/vendor-fonts.js ./scripts/

# `npm ci` esegue anche il postinstall, che copia Three.js in public/vendor
# risolvendone gli import in locale e scarica i caratteri del sito, che da
# quel momento vengono serviti dal nostro dominio e non da Google.
RUN npm ci --omit=dev --no-audit --no-fund

# ------------------------------ esecuzione ------------------------------
FROM node:22-bookworm-slim AS runtime

# ca-certificates serve a nodemailer per parlare TLS con un server SMTP.
# Per il controllo di salute non installiamo nulla: Node 22 ha già fetch.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    VORTICE_DB=/data/vortice.db

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules

# Three.js serviva solo a produrre public/vendor: a runtime è peso morto (33 MB).
RUN rm -rf node_modules/three

COPY package.json ./
COPY server ./server
COPY public ./public
COPY scripts/backup.js scripts/check-tunnel-token.js ./scripts/

# I file vendorizzati arrivano dopo i sorgenti, così nessun ordine di COPY può
# sovrascriverli per sbaglio.
COPY --from=build /app/public/vendor ./public/vendor

# Il database sta su un volume, non nell'immagine: solo quella cartella deve
# essere scrivibile dall'utente `node` (non root, già presente nelle immagini
# ufficiali). Niente `chown -R` su /app: su un layer da un centinaio di MB
# duplicherebbe ogni file solo per cambiarne il proprietario, e l'applicazione
# in /app deve poter essere solo letta.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]

EXPOSE 3000

# Il container è «sano» quando il server risponde davvero, non solo quando il
# processo esiste: così Docker riavvia anche un'applicazione bloccata.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node riceve SIGTERM direttamente (PID 1) e lo gestisce: chiude le connessioni
# e poi il database, consolidando il journal WAL.
CMD ["node", "server/index.js"]
