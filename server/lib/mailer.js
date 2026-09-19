/* Invio email opzionale.
   Senza SMTP_HOST configurato l'app non tenta nulla: la verifica dell'email
   resta disattivata e i link di conferma/reset vengono stampati nel log del
   server, così anche un'installazione in intranet è utilizzabile. */
import { config, smtpConfigured } from './config.js';
import { maskEmail } from './auth.js';

let transport = null, transportErr = null;

async function getTransport(){
  if (transport || transportErr || !smtpConfigured()) return transport;
  try{
    const { createTransport } = await import('nodemailer');
    transport = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }catch(err){
    transportErr = err;
    console.error('[mailer] SMTP non disponibile:', err.message);
  }
  return transport;
}

/** Invia un'email. Non solleva mai: un problema SMTP non deve far fallire la richiesta. */
export async function sendMail({ to, subject, text, html }){
  const t = await getTransport();
  if (!t){
    /* Il corpo contiene l'indirizzo e, nelle email di servizio, un link che vale
       quanto una password: nel log ci finisce solo dove LOG_MAIL_LINKS lo
       consente — in sviluppo, dove è l'unico modo di completare il giro.
       In produzione resta la sola traccia mascherata. */
    console.info(config.logMailLinks
      ? `[mailer] SMTP non configurato · email non inviata a ${to}\n  ${subject}\n  ${text}`
      : `[mailer] SMTP non configurato · email non inviata a ${maskEmail(to)} · ${subject}`);
    return { sent: false, reason: 'smtp_not_configured' };
  }
  try{
    await t.sendMail({ from: config.smtp.from, to, subject, text, html });
    return { sent: true };
  }catch(err){
    console.error(`[mailer] invio fallito verso ${maskEmail(to)}:`, err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

const shell = (title, body) => `<!doctype html><html lang="it"><body style="margin:0;background:#0f0e0c;
  font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#ece5d8;padding:32px">
  <div style="max-width:520px;margin:0 auto;background:#161411;border:1px solid #282520;border-radius:10px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.22em;color:#ff6a2b">VORTICE</p>
    <h1 style="margin:0 0 18px;font-size:22px;font-weight:600">${esc(title)}</h1>
    ${body}
  </div></body></html>`;

const button = url => `<p style="margin:22px 0"><a href="${esc(url)}" style="display:inline-block;
  background:#ff6a2b;color:#190d04;text-decoration:none;font-weight:700;padding:12px 20px;
  border-radius:7px">Apri il link</a></p>
  <p style="margin:0;font-size:12px;color:#9a8d7a;word-break:break-all">${esc(url)}</p>`;

export const sendVerifyMail = (to, url) => sendMail({
  to,
  subject: 'VORTICE · conferma il tuo indirizzo email',
  text: `Conferma il tuo indirizzo email per attivare l'account VORTICE:\n${url}\n\nSe non ti sei registrato puoi ignorare questo messaggio.`,
  html: shell('Conferma il tuo indirizzo',
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#9a8d7a">Attiva il tuo account per salvare e pubblicare le tue creazioni.</p>${button(url)}
     <p style="margin:18px 0 0;font-size:12px;color:#6b6154">Se non ti sei registrato puoi ignorare questo messaggio.</p>`),
});

export const sendResetMail = (to, url) => sendMail({
  to,
  subject: 'VORTICE · reimposta la password',
  text: `Reimposta la password del tuo account VORTICE:\n${url}\n\nIl link vale un'ora. Se non hai richiesto nulla, ignora questo messaggio.`,
  html: shell('Reimposta la password',
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#9a8d7a">Il link vale un'ora.</p>${button(url)}
     <p style="margin:18px 0 0;font-size:12px;color:#6b6154">Se non hai richiesto nulla, ignora questo messaggio: la password resta quella di prima.</p>`),
});

/* Un cambio di indirizzo va annunciato a quello vecchio: se non è stata la
   persona a chiederlo, è l'unico avviso che le arriva ancora. */
export const sendEmailChangedMail = (to, next) => sendMail({
  to,
  subject: 'VORTICE · l\'indirizzo del tuo account è cambiato',
  text: `L'indirizzo email del tuo account VORTICE è stato cambiato in ${next}.\n\n`
      + 'Se non sei stato tu, scrivi subito al titolare del trattamento: trovi i recapiti su /privacy.html.',
  html: shell('Indirizzo email cambiato',
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#9a8d7a">L'indirizzo del tuo account è stato cambiato in
     <b style="color:#ece5d8">${esc(next)}</b>.</p>
     <p style="margin:18px 0 0;font-size:12px;color:#6b6154">Se non sei stato tu, scrivi subito al titolare del
     trattamento: i recapiti sono nell'informativa privacy del sito.</p>`),
});

/* Conferma della cancellazione: chiude il cerchio dell'art. 17 e lascia alla
   persona una prova scritta di ciò che è stato eliminato. */
export const sendAccountDeletedMail = (to, designs) => sendMail({
  to,
  subject: 'VORTICE · account eliminato',
  text: 'Il tuo account VORTICE è stato eliminato, insieme a '
      + `${designs} creazioni e a tutte le sessioni aperte. I prodotti che avevi pubblicato non sono più raggiungibili.\n\n`
      + 'Nel sistema non resta alcun dato che ti riguardi. Questo messaggio è l\'ultimo che riceverai.',
  html: shell('Account eliminato',
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#9a8d7a">Il tuo account è stato eliminato insieme a
     <b style="color:#ece5d8">${esc(designs)}</b> creazioni, alle relative pubblicazioni e a tutte le sessioni aperte.</p>
     <p style="margin:18px 0 0;font-size:12px;color:#6b6154">Nel sistema non resta alcun dato che ti riguardi.
     Questo messaggio è l'ultimo che riceverai.</p>`),
});
