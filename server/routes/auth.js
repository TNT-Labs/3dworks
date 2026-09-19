/* Registrazione, accesso, uscita, conferma email e reset password. */
import { Router } from 'express';
import { config, smtpConfigured } from '../lib/config.js';
import { q, now } from '../lib/db.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, destroyAllSessions,
  normEmail, validEmail, passwordProblem, newToken,
} from '../lib/auth.js';
import { setSessionCookies, clearSessionCookies, rateLimit, requireAuth, freshCsrf } from '../lib/http.js';
import { sendVerifyMail, sendResetMail } from '../lib/mailer.js';

export const authRouter = Router();

const publicUser = u => ({
  id: u.id,
  email: u.email,
  verified: !!u.verified_at,
  createdAt: u.created_at,
});

const baseUrl = req => config.baseUrl || `${req.protocol}://${req.get('host')}`;

/* Il limite per indirizzo email va accanto a quello per IP: senza, chi cambia
   IP prova all'infinito su un singolo account. */
const byIp    = (windowMs, max, message) => rateLimit({ windowMs, max, message, key: r => 'ip:' + r.ip });
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

    if (q.userByEmail.get(email))
      return res.status(409).json({ error: 'Esiste già un account con questa email. Accedi, oppure reimposta la password.', field: 'email' });

    const verifyNeeded = config.requireVerification || smtpConfigured();
    const token = verifyNeeded ? newToken() : null;
    const t = now();

    let user;
    try{
      const info = q.insertUser.run({
        email, pass_hash: await hashPassword(password), created_at: t,
        /* senza verifica richiesta l'account nasce già attivo: l'email di
           conferma, se l'SMTP c'è, serve solo a confermare l'indirizzo */
        verified_at: config.requireVerification ? null : t,
        verify_token: token, verify_sent_at: token ? t : null,
      });
      user = q.userById.get(info.lastInsertRowid);
    }catch(err){
      if (String(err.message).includes('UNIQUE'))
        return res.status(409).json({ error: 'Esiste già un account con questa email.', field: 'email' });
      throw err;
    }

    if (token) sendVerifyMail(email, `${baseUrl(req)}/api/auth/verify?token=${token}`).catch(() => {});

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
      user ? user.pass_hash : '$scrypt$32768$8$1$AAAA$AAAA');

    if (!user || !ok)
      return res.status(401).json({ error: 'Email o password non corretti' });

    if (config.requireVerification && !user.verified_at)
      return res.status(403).json({ error: 'Conferma prima il tuo indirizzo email: controlla la posta.', code: 'unverified' });

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
  res.json({ user: publicUser(req.user), csrf, registrationOpen: config.allowRegistration });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookies(req, res);
  res.json({ ok: true });
});

authRouter.post('/logout-all', requireAuth, (req, res) => {
  destroyAllSessions(req.user.id);
  clearSessionCookies(req, res);
  res.json({ ok: true });
});

/* ------------------------------ conferma email ------------------------------ */
authRouter.get('/verify', (req, res) => {
  const user = req.query.token ? q.userByVerify.get(String(req.query.token)) : null;
  if (!user) return res.redirect('/accedi.html?verify=nonvalido');
  if (!user.verified_at) q.markVerified.run(now(), user.id);
  else q.setVerifyToken.run(null, user.verify_sent_at, user.id);
  res.redirect('/accedi.html?verify=ok');
});

authRouter.post('/resend-verification', requireAuth,
  byIp(3600_000, 5, 'Hai già chiesto più volte l\'email di conferma. Riprova più tardi.'),
  async (req, res) => {
    if (req.user.verified_at) return res.json({ ok: true, alreadyVerified: true });
    if (!smtpConfigured()) return res.status(503).json({ error: 'Invio email non configurato su questa installazione.' });
    const token = newToken();
    q.setVerifyToken.run(token, now(), req.user.id);
    await sendVerifyMail(req.user.email, `${baseUrl(req)}/api/auth/verify?token=${token}`);
    res.json({ ok: true });
  });

/* ------------------------------ reset password ------------------------------ */
authRouter.post('/forgot',
  byIp(3600_000, 10, 'Troppe richieste. Riprova più tardi.'),
  byEmail(3600_000, 3, 'Hai già chiesto il reset per questo indirizzo. Controlla la posta.'),
  async (req, res) => {
    const email = normEmail(req.body?.email);
    const user = validEmail(email) ? q.userByEmail.get(email) : null;
    if (user){
      const token = newToken();
      q.setResetToken.run(token, now() + 3600_000, user.id);
      await sendResetMail(email, `${baseUrl(req)}/reimposta.html?token=${token}`);
    }
    /* risposta identica in ogni caso: non riveliamo quali email sono registrate */
    res.json({ ok: true, smtp: smtpConfigured(),
      message: 'Se l\'indirizzo è registrato, riceverai un\'email con le istruzioni.' });
  });

authRouter.post('/reset',
  byIp(3600_000, 20, 'Troppi tentativi. Riprova più tardi.'),
  async (req, res) => {
    const token = String(req.body?.token ?? '');
    const user = token ? q.userByReset.get(token) : null;
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
authRouter.post('/change-password', requireAuth,
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
