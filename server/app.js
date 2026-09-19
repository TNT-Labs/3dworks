/* Applicazione Express: intestazioni di sicurezza, API, file statici, rotte
   leggibili (/p/VRT-7K3QX). Esportata separata dall'avvio così i test la
   possono montare senza aprire una porta. */
import express from 'express';
import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { config, ROOT } from './lib/config.js';
import { attachSession, requireCsrf } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { designsRouter } from './routes/designs.js';
import { publicRouter } from './routes/public.js';
import { legalRouter } from './routes/legal.js';
import { normCode } from '../public/js/design-spec.js';

const PUBLIC_DIR = join(ROOT, 'public');
const THREE_CORE = join(PUBLIC_DIR, 'vendor', 'three', 'build', 'three.module.js');
const FONTS_CSS = join(PUBLIC_DIR, 'vendor', 'fonts', 'fonts.css');

/** I caratteri sono vendorizzati come Three.js, ma la loro assenza non è
    fatale: senza, la pagina usa quelli di sistema — e soprattutto continua a
    non chiedere nulla a nessuno, che è il motivo per cui stanno lì. */
export const fontsVendored = () => existsSync(FONTS_CSS);

/* Three.js è vendorizzato da `npm install` (scripts/vendor-three.js). Se manca,
   fermarsi qui con un messaggio chiaro è meglio di una pagina bianca. */
export function assertAssets(){
  if (!existsSync(THREE_CORE))
    throw new Error('Three.js non vendorizzato: esegui `npm install` (o `node scripts/vendor-three.js`).');
}

export function createApp(){
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  /* ---------------------------- sicurezza ---------------------------- */
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=(self)',
      /* Nessuno script inline: gli import di Three.js sono risolti in locale,
         quindi non serve né importmap né 'unsafe-inline'.
         Nessuna origine esterna, nemmeno per i font: caricarli da Google
         comunicherebbe l'indirizzo IP di ogni visitatore a un terzo fuori
         dall'Unione senza alcuna base giuridica. Sono vendorizzati in locale
         (scripts/vendor-fonts.js), e la CSP lo rende una regola, non un
         proposito: 'self' e basta. */
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self'",
        "worker-src 'self' blob:",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    });
    if (config.cookieSecure)
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.use(express.json({ limit: '256kb' }));
  app.use(attachSession);

  /* ---------------------------- API ---------------------------- */
  /* Nessuna risposta API va in cache, né nel browser né in una CDN davanti al
     sito: contengono lo stato della sessione. L'unica eccezione è la scheda
     pubblica, che si dichiara cacheabile da sé perché è uguale per tutti. */
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', requireCsrf);
  app.use('/api/auth', authRouter);
  app.use('/api/designs',
    /* l'anteprima è un PNG grezzo: il parser JSON non la tocca */
    express.raw({ type: 'image/png', limit: config.maxPreviewBytes }),
    designsRouter);
  app.use('/api/public', publicRouter);
  /* informativa e cookie come dati: nessun dato personale, uguale per tutti */
  app.use('/api/legal', legalRouter);

  app.get('/api/health', (req, res) => res.json({
    ok: true,
    registrationOpen: config.allowRegistration,
    requiresVerification: config.requireVerification,
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint inesistente' }));

  /* ---------------------------- pagine ---------------------------- */
  /* /p/VRT-7K3QX è il link da stampare accanto al codice: leggibile e condivisibile */
  app.get('/p/:code', (req, res) => {
    if (!normCode(req.params.code)) return res.redirect('/?codice=nonvalido');
    /* la pagina è un guscio identico per ogni codice, ma rivalidarla a ogni
       visita evita che una CDN serva una versione vecchia dopo un aggiornamento */
    res.set('Cache-Control', 'no-cache');
    res.sendFile(join(PUBLIC_DIR, 'prodotto.html'));
  });

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, filePath){
      /* le pagine si rivalidano sempre: un aggiornamento deve arrivare subito */
      if (filePath.endsWith('.html')) return res.set('Cache-Control', 'no-cache');
      /* Three.js vendorizzato è immutabile: cambia solo cambiando versione */
      if (filePath.includes(`${sep}vendor${sep}`))
        return res.set('Cache-Control', 'public, max-age=31536000, immutable');
      /* il resto (js, css, icona) può stare in cache un'ora e poi rivalidarsi:
         basta a scaricare il lavoro dal Raspberry senza congelare una versione */
      res.set('Cache-Control', 'public, max-age=3600, must-revalidate');
    },
  }));

  app.use((req, res) => {
    if (req.accepts('html')) return res.status(404).sendFile(join(PUBLIC_DIR, '404.html'));
    res.status(404).type('txt').send('Non trovato');
  });

  /* ---------------------------- errori ---------------------------- */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large')
      return res.status(413).json({ error: 'Richiesta troppo grande' });
    if (err?.type === 'entity.parse.failed')
      return res.status(400).json({ error: 'Richiesta non leggibile' });
    /* originalUrl porterebbe nel log il token di conferma o di reimpostazione
       (è una credenziale) e l'eventuale codice cercato: si registra il solo
       percorso, che basta a capire dove si è rotto qualcosa. */
    console.error('[errore]', req.method, req.path, err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Errore interno del server' });
  });

  return app;
}
