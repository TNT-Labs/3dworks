/* Avvio del server. */
import { createApp, assertAssets, fontsVendored } from './app.js';
import { config, smtpConfigured } from './lib/config.js';
import { startJanitor } from './lib/auth.js';
import { db } from './lib/db.js';

assertAssets();
startJanitor();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  const { port, host } = config;
  console.log(`VORTICE · in ascolto su http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  console.log(`  registrazioni: ${config.allowRegistration ? 'aperte' : 'chiuse'}` +
    ` · verifica email: ${config.requireVerification ? 'obbligatoria' : 'facoltativa'}` +
    ` · SMTP: ${smtpConfigured() ? 'configurato' : 'assente (link di conferma nel log)'}`);
  if (!config.cookieSecure)
    console.log('  nota: COOKIE_SECURE non attivo — impostalo a 1 dietro HTTPS in produzione');
  if (!fontsVendored())
    console.log('  nota: caratteri non vendorizzati (`node scripts/vendor-fonts.js`) —' +
      ' le pagine useranno i font di sistema, senza contattare nessuno');
  /* Un sito pubblico senza titolare indicato non è a norma: l'informativa
     lo dichiara da sé, ma chi avvia il server deve saperlo subito. */
  if (!config.privacy.controller || !config.privacy.email)
    console.log('  nota: titolare del trattamento non configurato — imposta PRIVACY_CONTROLLER' +
      ' e PRIVACY_CONTACT_EMAIL, altrimenti /privacy.html si dichiara incompleta');
});

server.on('error', err => {
  /* il caso di gran lunga più frequente merita una frase, non uno stack */
  if (err.code === 'EADDRINUSE')
    console.error(`\nLa porta ${config.port} è già occupata.\n` +
      `Chiudi l'altro processo oppure avvia con un'altra porta:  PORT=3001 npm start\n`);
  else console.error('\nAvvio non riuscito:', err.message, '\n');
  process.exit(1);
});

/* Docker manda SIGTERM e aspetta: chiudiamo le connessioni e poi il database,
   così il journal WAL viene consolidato invece di restare a metà. */
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => {
    if (closing) return;
    closing = true;
    console.log(`\nRicevuto ${sig}: chiusura in corso…`);
    server.close(() => {
      try{ db.close(); }catch(err){ console.error('chiusura database:', err.message); }
      process.exit(0);
    });
    /* se una richiesta non termina, non restiamo appesi all'infinito */
    setTimeout(() => { try{ db.close(); }catch{} process.exit(0); }, 8000).unref();
  });
