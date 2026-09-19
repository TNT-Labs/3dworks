/* Registrazione, accesso, uscita, conferma email e reset password. */
import { Router } from 'express';
import { config, smtpConfigured } from '../lib/config.js';
import { q, now } from '../lib/db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, destroyAllSessions,
  normEmail, validEmail, passwordProblem, newToken, hashToken, verifyTokenExpired, DUMMY_HASH,
} from '../lib/auth.js';
import {
  setSessionCookies, clearSessionCookies, rateLimit, requireAuth, requireUser,
  freshCsrf, clientIp, trustedOrigin,
} from '../lib/http.js';
import { sendVerifyMail, sendResetMail, sendEmailChangedMail, sendAccountDeletedMail } from '../lib/mailer.js';
import { exportPersonalData } from '../lib/personal-data.js';

export const authRouter = Router();

const publicUser = u => ({
  id: u.id,
  email: u.email,
  verified: !!u.verified_at,
  createdAt: u.created_at,
  /* traccia dell'informativa accettata: la persona deve poter vedere cosa e
     quando ha accettato, non solo il titolare (art. 7 §1 e art. 15) */
  privacyAcceptedAt: u.privacy_accepted_at ?? null,
  privacyVersion: u.privacy_version ?? null,
});

/*
 * L'indirizzo su cui si costruiscono i link delle email non può venire dalla
 * richiesta: `Host` lo scrive chi chiama. Senza VORTICE_BASE_URL (o
 * VORTICE_ALLOWED_HOSTS) restano validi solo i nomi locali; su un dominio
 * pubblico non configurato non si spedisce nulla, invece di spedire un link
 * che porta il token a casa di qualcun altro.
 */
function linkOrigin(req){
  const origin = trustedOrigin(req);
  if (!origin)
    console.error('[sicurezza] nessuna origine fidata per i link delle email:' +
      ' imposta VORTICE_BASE_URL (o VORTICE_ALLOWED_HOSTS). Nessuna email inviata.');
  return origin;
}

/* Il limite per indirizzo email va accanto a quello per IP: senza, chi cambia
   IP prova all'infinito su un singolo account. */
const byIp    = (windowMs, max, message) => rateLimit({ windowMs, max, message, key: r => 'ip:' + clientIp(r) });
const byEmail = (windowMs, max, message) => rateLimit({ windowMs, max, message,
  key: r => (r.body && typeof r.body.email === 'string') ? 'em:' + normEmail(r.body.email) : null });

/* ------------------------------ registrazione ------------------------------ */
authRouter.post('/register',
  byIp(3600_000, 10, 'Troppe registrazioni da questa rete. Riprova più tardi.'),
  async (req, res) => {
    if (!config.allowRegistration)
      return res.status(403).json({ error: 'Le registrazioni sono chiuse su questa installazione.' });

    const email = normEmail(req.body?.email);
    const password = req.body?.password;

    if (!validEmail(email)) return res.status(400).json({ error: 'Indirizzo email non valido', field: 'email' });
    const pwErr = passwordProblem(password);
    if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });

    /* L'informativa (art. 13) va presa visione prima di aprire l'account, e la
       presa visione va conservata con la sua versione: senza questa riga il
       titolare non potrebbe dimostrare nulla (art. 5 §2). Non è il consenso
       dell'art. 6 §1 lett. a — la base giuridica dell'account è il contratto —
       ma la prova che l'informativa era stata resa. */
    if (req.body?.acceptPrivacy !== true)
      return res.status(400).json({
        error: 'Per creare l\'account devi prendere visione dell\'informativa privacy.',
        field: 'privacy', code: 'privacy_required' });

    if (q.userByEmail.get(email))
      return res.status(409).json({ error: 'Esiste già un account con questa email. Accedi, oppure reimposta la password.', field: 'email' });

    const verifyNeeded = config.requireVerification || smtpConfigured();
    const origin = verifyNeeded ? linkOrigin(req) : null;
    /* Con la conferma obbligatoria e nessun indirizzo su cui costruire il link,
       l'account nascerebbe inattivo e inattivabile: meglio non aprirlo. */
    if (config.requireVerification && !origin)
      return res.status(503).json({
        error: 'Configurazione incompleta: il server non può inviare il link di conferma. Riprova più tardi.' });

    const token = verifyNeeded && origin ? newToken() : null;
    const t = now();

    let user;
    try{
      const info = q.insertUser.run({
        email, pass_hash: await hashPassword(password), created_at: t,
        /* senza verifica richiesta l'account nasce già attivo: l'email di
           conferma, se l'SMTP c'è, serve solo a confermare l'indirizzo */
        verified_at: config.requireVerification ? null : t,
        verify_token: token ? hashToken(token) : null, verify_sent_at: token ? t : null,
        privacy_accepted_at: t, privacy_version: config.privacy.version,
      });
      user = q.userById.get(info.lastInsertRowid);
    }catch(err){
      if (String(err.message).includes('UNIQUE'))
        return res.status(409).json({ error: 'Esiste già un account con questa email.', field: 'email' });
      throw err;
    }

    if (token) sendVerifyMail(email, `${origin}/api/auth/verify?token=${token}`).catch(() => {});

    if (config.requireVerification)
      return res.status(201).json({ user: publicUser(user), needsVerification: true,
        message: 'Ti abbiamo inviato un\'email: conferma l\'indirizzo per iniziare a creare.' });

    const session = createSession(user.id);
    setSessionCookies(req, res, session);
    res.status(201).json({ user: publicUser(user), csrf: session.csrf });
  });

/* ------------------------------ accesso ------------------------------ */
authRouter.post('/login',
  byIp(900_000, 30, 'Troppi tentativi da questa rete. Riprova tra qualche minuto.'),
  byEmail(900_000, 8, 'Troppi tentativi per questo account. Riprova tra qualche minuto.'),
  async (req, res) => {
    const email = normEmail(req.body?.email);
    const password = req.body?.password;
    const user = q.userByEmail.get(email);

    /* Confronto anche senza utente: il tempo di risposta non deve rivelare
       quali indirizzi sono registrati. */
    const ok = await verifyPassword(typeof password === 'string' ? password : '',
      user ? user.pass_hash : DUMMY_HASH);

    if (!user || !ok)
      return res.status(401).json({ error: 'Email o password non corretti' });

    if (config.requireVerification && !user.verified_at)
      return res.status(403).json({ error: 'Conferma prima il tuo indirizzo email: controlla la posta.', code: 'unverified' });

    q.touchUser.run(now(), user.id);
    const session = createSession(user.id);
    setSessionCookies(req, res, session);
    res.json({ user: publicUser(user), csrf: session.csrf });
  });

/* ------------------------------ sessione corrente ------------------------------ */
authRouter.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null, registrationOpen: config.allowRegistration });
  /* ricrea il token CSRF a ogni caricamento di pagina: se il cookie è stato
     perso (o la pagina è stata aperta da un bookmark) l'app resta usabile */
  const csrf = freshCsrf();
  setSessionCookies(req, res, { token: req.sessionToken, csrf,
    expires: now() + config.sessionDays * 86400_000 });
  res.json({ user: publicUser(req.user), csrf, registrationOpen: config.allowRegistration,
    /* versione corrente dell'informativa: se non combacia con quella accettata
       la pagina account lo dice e chiede di prenderne visione di nuovo */
    privacyVersion: config.privacy.version });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookies(req, res);
  res.json({ ok: true });
});

authRouter.post('/logout-all', requireUser, (req, res) => {
  destroyAllSessions(req.user.id);
  clearSessionCookies(req, res);
  res.json({ ok: true });
});

/* ------------------------------ conferma email ------------------------------ */
authRouter.get('/verify', (req, res) => {
  const user = req.query.token ? q.userByVerify.get(hashToken(String(req.query.token))) : null;
  if (!user) return res.redirect('/accedi.html?verify=nonvalido');
  if (verifyTokenExpired(user)){
    /* scaduto: si brucia subito, così non resta in giro un token inutile */
    q.setVerifyToken.run(null, user.verify_sent_at, user.id);
    return res.redirect('/accedi.html?verify=scaduto');
  }
  if (!user.verified_at) q.markVerified.run(now(), user.id);
  else q.setVerifyToken.run(null, user.verify_sent_at, user.id);
  res.redirect('/accedi.html?verify=ok');
});

authRouter.post('/resend-verification', requireUser,
  byIp(3600_000, 5, 'Hai già chiesto più volte l\'email di conferma. Riprova più tardi.'),
  async (req, res) => {
    if (req.user.verified_at) return res.json({ ok: true, alreadyVerified: true });
    if (!smtpConfigured()) return res.status(503).json({ error: 'Invio email non configurato su questa installazione.' });
    const origin = linkOrigin(req);
    if (!origin) return res.status(503).json({ error: 'Invio email non disponibile su questa installazione.' });
    const token = newToken();
    q.setVerifyToken.run(hashToken(token), now(), req.user.id);
    await sendVerifyMail(req.user.email, `${origin}/api/auth/verify?token=${token}`);
    res.json({ ok: true });
  });

/* ------------------------------ reset password ------------------------------ */
authRouter.post('/forgot',
  byIp(3600_000, 10, 'Troppe richieste. Riprova più tardi.'),
  byEmail(3600_000, 3, 'Hai già chiesto il reset per questo indirizzo. Controlla la posta.'),
  async (req, res) => {
    const email = normEmail(req.body?.email);
    const user = validEmail(email) ? q.userByEmail.get(email) : null;
    const origin = user ? linkOrigin(req) : null;
    if (user && origin){
      const token = newToken();
      q.setResetToken.run(hashToken(token), now() + 3600_000, user.id);
      /* L'invio non viene atteso: aspettarlo farebbe durare la risposta più a
         lungo quando l'indirizzo esiste, e il tempo direbbe da solo cio' che il
         messaggio qui sotto si impegna a non dire. */
      sendResetMail(email, `${origin}/reimposta.html?token=${token}`).catch(() => {});
    }
    /* risposta identica in ogni caso: non riveliamo quali email sono registrate */
    res.json({ ok: true, smtp: smtpConfigured(),
      message: 'Se l\'indirizzo è registrato, riceverai un\'email con le istruzioni.' });
  });

authRouter.post('/reset',
  byIp(3600_000, 20, 'Troppi tentativi. Riprova più tardi.'),
  async (req, res) => {
    const token = String(req.body?.token ?? '');
    const user = token ? q.userByReset.get(hashToken(token)) : null;
    if (!user || !user.reset_expires || user.reset_expires < now())
      return res.status(400).json({ error: 'Link scaduto o non valido. Richiedine uno nuovo.' });

    const pwErr = passwordProblem(req.body?.password);
    if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });

    q.setPassword.run(await hashPassword(req.body.password), user.id);
    /* cambiare password chiude ogni altra sessione: è il punto di questa funzione */
    destroyAllSessions(user.id);
    if (!user.verified_at) q.markVerified.run(now(), user.id);

    const session = createSession(user.id);
    setSessionCookies(req, res, session);
    res.json({ user: publicUser(q.userById.get(user.id)), csrf: session.csrf });
  });

/* ------------------------------ cambio password ------------------------------ */
authRouter.post('/change-password', requireUser,
  byIp(3600_000, 20, 'Troppi tentativi. Riprova più tardi.'),
  async (req, res) => {
    if (!await verifyPassword(String(req.body?.current ?? ''), req.user.pass_hash))
      return res.status(403).json({ error: 'La password attuale non è corretta', field: 'current' });
    const pwErr = passwordProblem(req.body?.password);
    if (pwErr) return res.status(400).json({ error: pwErr, field: 'password' });

    q.setPassword.run(await hashPassword(req.body.password), req.user.id);
    destroyAllSessions(req.user.id);
    const session = createSession(req.user.id);
    setSessionCookies(req, res, session);
    res.json({ ok: true, csrf: session.csrf });
  });

/* ============================================================================
   Diritti dell'interessato (GDPR capo III).
   Accesso, portabilità, rettifica e cancellazione non passano da una email al
   titolare: sono tre endpoint, e la pagina /account.html li mette in mano
   direttamente alla persona.
   ========================================================================== */

/* ------------------- accesso e portabilità (art. 15 e 20) ------------------- */
/* Un solo file JSON con tutto ciò che il server sa: account, sessioni aperte,
   creazioni con il loro stato riutilizzabile e le anteprime. */
authRouter.get('/export', requireUser,
  byIp(3600_000, 20, 'Hai già scaricato i tuoi dati più volte. Riprova più tardi.'),
  (req, res) => {
    const data = exportPersonalData(req.user);
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="vortice-dati-personali-${stamp}.json"`);
    res.type('application/json').send(JSON.stringify(data, null, 2));
  });

/* --------------------------- rettifica (art. 16) --------------------------- */
/* L'unico dato anagrafico è l'indirizzo email, ed è anche la credenziale di
   accesso: cambiarlo chiede la password, avvisa il vecchio indirizzo e — dove
   la posta è configurata — rimette l'indirizzo in attesa di conferma. */
authRouter.post('/change-email', requireUser,
  byIp(3600_000, 10, 'Troppi cambi di indirizzo. Riprova più tardi.'),
  async (req, res) => {
    if (!await verifyPassword(String(req.body?.password ?? ''), req.user.pass_hash))
      return res.status(403).json({ error: 'La password non è corretta', field: 'password' });

    const email = normEmail(req.body?.email);
    if (!validEmail(email))
      return res.status(400).json({ error: 'Indirizzo email non valido', field: 'email' });
    if (email === req.user.email)
      return res.json({ user: publicUser(req.user), unchanged: true });
    if (q.userByEmail.get(email))
      return res.status(409).json({ error: 'Esiste già un account con questa email.', field: 'email' });

    const verifyNeeded = config.requireVerification || smtpConfigured();
    const origin = verifyNeeded ? linkOrigin(req) : null;
    if (config.requireVerification && !origin)
      return res.status(503).json({
        error: 'Configurazione incompleta: il server non può inviare il link di conferma. Riprova più tardi.' });
    const token = verifyNeeded && origin ? newToken() : null;
    const t = now();
    try{
      q.setEmail.run(email, verifyNeeded ? null : req.user.verified_at,
        token ? hashToken(token) : null, token ? t : null, req.user.id);
    }catch(err){
      if (String(err.message).includes('UNIQUE'))
        return res.status(409).json({ error: 'Esiste già un account con questa email.', field: 'email' });
      throw err;
    }

    const previous = req.user.email;
    if (token) sendVerifyMail(email, `${origin}/api/auth/verify?token=${token}`).catch(() => {});
    sendEmailChangedMail(previous, email).catch(() => {});

    res.json({ user: publicUser(q.userById.get(req.user.id)),
      needsVerification: verifyNeeded,
      message: verifyNeeded
        ? 'Indirizzo aggiornato: controlla la posta e conferma il nuovo indirizzo.'
        : 'Indirizzo aggiornato.' });
  });

/* ---------------- presa visione di una nuova informativa (art. 7 §1) -------- */
authRouter.post('/accept-privacy', requireUser, (req, res) => {
  q.acceptPrivacy.run(now(), config.privacy.version, req.user.id);
  res.json({ user: publicUser(q.userById.get(req.user.id)) });
});

/* -------------------------- cancellazione (art. 17) ------------------------- */
/* Cancellazione vera, non disattivazione: la riga dell'utente sparisce e le
   chiavi esterne (ON DELETE CASCADE) portano via sessioni, creazioni,
   pubblicazioni e anteprime. Il codice di produzione di un pezzo pubblicato
   smette di rispondere: nulla di ciò che è stato pubblicato resta online.
   Chiede la password perché una sessione rubata non basti a distruggere il
   lavoro di qualcuno. */
authRouter.post('/delete-account', requireUser,
  byIp(3600_000, 10, 'Troppi tentativi. Riprova più tardi.'),
  async (req, res) => {
    if (!await verifyPassword(String(req.body?.password ?? ''), req.user.pass_hash))
      return res.status(403).json({ error: 'La password non è corretta', field: 'password' });

    const { email, id } = req.user;
    const designs = q.countDesigns.get(id).n;

    destroyAllSessions(id);
    q.deleteUser.run(id);
    clearSessionCookies(req, res);

    /* l'ultima email parte dopo la cancellazione: se l'invio fallisce, i dati
       sono comunque già spariti — è quello il punto dell'art. 17 */
    sendAccountDeletedMail(email, designs).catch(() => {});
    res.json({ ok: true, deletedDesigns: designs });
  });
