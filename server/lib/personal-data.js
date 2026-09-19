/* Diritto di accesso e portabilità (art. 15 e 20 GDPR).
   Un solo posto costruisce «tutto ciò che il server sa di una persona»: se un
   domani nascesse una tabella nuova, è qui che va aggiunta — e il test che
   confronta le colonne del database con i campi esportati lo fa notare. */
import { config } from './config.js';
import { q } from './db.js';

/* Le anteprime sono PNG: incluse in base64 finché l'export resta una cosa che
   si scarica e si apre. Oltre il tetto restano fuori, con un elenco degli
   indirizzi da cui prenderle una per una: meglio un export completo di misura
   ragionevole che uno da cento megabyte che il browser non regge. */
const PREVIEW_BUDGET = 24 * 1024 * 1024;

export function exportPersonalData(user){
  let budget = PREVIEW_BUDGET;
  let previewsOmitted = 0;

  const designs = q.exportDesigns.all(user.id).map(d => {
    const png = d.preview ? Buffer.from(d.preview) : null;
    let preview = null;
    if (png){
      if (png.length <= budget){ budget -= png.length; preview = png.toString('base64'); }
      else previewsOmitted++;
    }
    return {
      id: d.id,
      nome: d.name,
      /* lo stato è la query string canonica: si rincolla dopo un «/studio.html#»
         e il disegno torna com'era, anche su un'altra installazione */
      stato: d.state,
      impronta: d.fingerprint,
      creatoIl: new Date(d.created_at).toISOString(),
      modificatoIl: new Date(d.updated_at).toISOString(),
      codiceDiProduzione: d.code,
      pubblicatoIl: d.published_at ? new Date(d.published_at).toISOString() : null,
      statoPubblicato: d.published_state,
      schedaPubblicata: d.published_meta ? JSON.parse(d.published_meta) : null,
      visualizzazioni: d.views,
      anteprimaPng: preview,
      anteprimaUrl: png ? `/api/designs/${d.id}/preview.png` : null,
    };
  });

  return {
    formato: 'vortice-export/1',
    generatoIl: new Date().toISOString(),
    informativa: { versione: config.privacy.version, titolare: config.privacy.controller || null },
    account: {
      id: user.id,
      email: user.email,
      emailConfermata: !!user.verified_at,
      emailConfermataIl: user.verified_at ? new Date(user.verified_at).toISOString() : null,
      registratoIl: new Date(user.created_at).toISOString(),
      ultimaAttivita: user.last_seen_at ? new Date(user.last_seen_at).toISOString() : null,
      informativaAccettataIl: user.privacy_accepted_at ? new Date(user.privacy_accepted_at).toISOString() : null,
      informativaVersioneAccettata: user.privacy_version ?? null,
      /* la password non è esportabile: nel database c'è solo un hash scrypt,
         e non è un dato che serva a nessun altro servizio */
      password: 'non esportabile: nel database è conservato solo un hash scrypt',
    },
    /* solo i metadati: il token di sessione non esiste in chiaro nemmeno qui */
    sessioni: q.exportSessions.all(user.id).map(s => ({
      apertaIl: new Date(s.created_at).toISOString(),
      scadeIl: new Date(s.expires_at).toISOString(),
      ultimoUtilizzo: new Date(s.last_seen).toISOString(),
    })),
    creazioni: designs,
    anteprimeOmesse: previewsOmitted,
    note: previewsOmitted
      ? `${previewsOmitted} anteprime superano lo spazio previsto per un singolo file: scaricale dagli indirizzi in "anteprimaUrl".`
      : null,
  };
}
