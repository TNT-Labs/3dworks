/* Trasparenza (art. 13 e 14 GDPR) servita come dati, non come testo murato
   nell'HTML: il titolare cambia da un'installazione all'altra, l'informativa no.
   /privacy.html e /cookie.html leggono da qui e si riempiono da sole.

   Qui non passa nessun dato personale: la risposta è identica per tutti e può
   stare in cache anche al bordo. */
import { Router } from 'express';
import { config, smtpConfigured } from '../lib/config.js';
import { SESSION_COOKIE, CSRF_COOKIE } from '../lib/auth.js';

export const legalRouter = Router();

/* I due soli cookie dell'applicazione. Entrambi tecnici e necessari a fare
   funzionare l'accesso: rientrano nell'esenzione dell'art. 5 §3 della direttiva
   ePrivacy (e delle Linee guida cookie del Garante, 2021), quindi non serve —
   e non sarebbe corretto chiedere — un banner di consenso. Il giorno in cui
   ne comparisse uno non necessario, questa lista è il posto in cui si nota. */
const COOKIES = [
  {
    nome: SESSION_COOKIE,
    tipo: 'tecnico · necessario',
    finalita: 'Tiene aperta la sessione di chi ha effettuato l\'accesso allo studio.',
    contenuto: 'Un valore casuale. Nel database ne è conservato solo lo SHA-256.',
    durata: `${config.sessionDays} giorni`,
    attributi: 'HttpOnly · SameSite=Lax' + (config.cookieSecure ? ' · Secure' : ''),
    terzaParte: false,
  },
  {
    nome: CSRF_COOKIE,
    tipo: 'tecnico · necessario',
    finalita: 'Protegge i moduli dalle richieste falsificate da altri siti (double submit).',
    contenuto: 'Un valore casuale, senza alcun riferimento alla persona.',
    durata: `${config.sessionDays} giorni`,
    attributi: 'SameSite=Lax' + (config.cookieSecure ? ' · Secure' : ''),
    terzaParte: false,
  },
];

/* Chi tratta i dati oltre al titolare. L'elenco è corto per costruzione:
   niente analytics, niente CDN, niente font remoti, nessun pulsante social. */
function processors(){
  const out = [];
  if (smtpConfigured())
    out.push({
      ruolo: 'Responsabile del trattamento (art. 28)',
      chi: `Fornitore del servizio di posta (${config.smtp.host})`,
      cosa: 'Recapita le email di conferma indirizzo, reimpostazione password e avvisi sull\'account.',
      dati: 'Indirizzo email e contenuto del messaggio.',
    });
  if (config.cloudflare)
    out.push({
      ruolo: 'Responsabile del trattamento (art. 28)',
      chi: 'Cloudflare, Inc.',
      cosa: 'Espone il sito in rete tramite un tunnel e ne filtra il traffico.',
      dati: 'Indirizzo IP e metadati della richiesta HTTP.',
    });
  if (config.privacy.hosting)
    out.push({
      ruolo: 'Infrastruttura',
      chi: config.privacy.hosting,
      cosa: 'Ospita il server applicativo e il database.',
      dati: 'Tutti i dati dell\'applicazione, conservati sul disco del server.',
    });
  return out;
}

legalRouter.get('/', (req, res) => {
  res.set('Cache-Control', 'public, max-age=600');
  res.json({
    informativa: {
      versione: config.privacy.version,
      /* indicazioni di comodo per chi installa: se mancano, le pagine lo dicono
         apertamente invece di far finta che il titolare sia stato indicato */
      completa: !!(config.privacy.controller && config.privacy.email),
    },
    titolare: {
      nome: config.privacy.controller || null,
      indirizzo: config.privacy.address || null,
      partitaIva: config.privacy.vat || null,
      email: config.privacy.email || null,
    },
    dpo: config.privacy.dpoEmail ? { email: config.privacy.dpoEmail } : null,
    autorita: { nome: config.privacy.authority, url: config.privacy.authorityUrl },
    cookie: COOKIES,
    destinatari: processors(),
    /* Nessun trasferimento verso paesi terzi di iniziativa dell'applicazione:
       i font sono serviti dal sito stesso e non esistono script di terze parti. */
    trasferimentiExtraUe: false,
    profilazione: false,
    decisioniAutomatizzate: false,
    conservazione: {
      account: 'Fino alla cancellazione richiesta dall\'interessato.',
      accountNonConfermati: config.requireVerification && config.retention.unverifiedDays > 0
        ? `Cancellati automaticamente dopo ${config.retention.unverifiedDays} giorni.`
        : 'Non applicabile su questa installazione.',
      accountDormienti: config.retention.inactiveDays > 0
        ? `Cancellati automaticamente dopo ${config.retention.inactiveDays} giorni senza accessi.`
        : 'Nessuna cancellazione automatica per inattività.',
      sessioni: `${config.sessionDays} giorni dall\'accesso; le sessioni scadute vengono eliminate ogni ora.`,
      tokenReimpostazione: 'Un\'ora, poi eliminati dalla pulizia periodica.',
      tokenConferma: config.retention.verifyTokenDays > 0
        ? `${config.retention.verifyTokenDays} giorni, poi eliminati dalla pulizia periodica.`
        : 'Validi finché l\'indirizzo non viene confermato.',
      indirizziIp: 'Tenuti in memoria per il solo conteggio dei tentativi di accesso, al massimo un\'ora. Mai scritti nel database.',
      creazioni: 'Finché esiste l\'account; le singole creazioni sono eliminabili in qualsiasi momento.',
    },
    diritti: {
      accesso:        { articolo: 15, come: 'Scarica i tuoi dati da /account.html, oppure GET /api/auth/export.' },
      rettifica:      { articolo: 16, come: 'Cambia il tuo indirizzo email da /account.html.' },
      cancellazione:  { articolo: 17, come: 'Elimina l\'account da /account.html: la cancellazione è immediata e definitiva.' },
      limitazione:    { articolo: 18, come: 'Scrivi al titolare ai recapiti indicati sopra.' },
      portabilita:    { articolo: 20, come: 'L\'export è un JSON strutturato e leggibile da altri programmi.' },
      opposizione:    { articolo: 21, come: 'Scrivi al titolare ai recapiti indicati sopra.' },
      reclamo:        { articolo: 77, come: `Reclamo all'autorità di controllo: ${config.privacy.authority}.` },
    },
  });
});
