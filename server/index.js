/* Avvio del server. */
import { createApp, assertAssets } from './app.js';
import { config } from './lib/config.js';
import { startJanitor } from './lib/auth.js';
import { smtpConfigured } from './lib/config.js';

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
});

server.on('error', err => {
  /* il caso di gran lunga più frequente merita una frase, non uno stack */
  if (err.code === 'EADDRINUSE')
    console.error(`\nLa porta ${config.port} è già occupata.\n` +
      `Chiudi l'altro processo oppure avvia con un'altra porta:  PORT=3001 npm start\n`);
  else console.error('\nAvvio non riuscito:', err.message, '\n');
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, () => server.close(() => process.exit(0)));
