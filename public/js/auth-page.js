/* Accesso e registrazione nella stessa pagina: due schede, un solo modulo. */
import { api, ApiError } from './api.js';
import { toast } from './toast.js';

const $ = id => document.getElementById(id);
const form = $('authForm');
let mode = 'login';
let registrationOpen = true;

/* dove tornare dopo l'accesso, se ci si è arrivati da una pagina protetta */
const params = new URLSearchParams(location.search);
const next = (() => {
  const raw = params.get('next');
  /* Solo percorsi interni: un "next" assoluto porterebbe l'utente altrove.
     La barra rovesciata conta come una barra per il browser, quindi "/\altro"
     diventerebbe "//altro", cioè un altro sito. */
  return /^\/(?![/\\])/.test(raw ?? '') ? raw : '/studio.html';
})();

function setMode(m){
  mode = m;
  const reg = m === 'register';
  $('tabLogin').classList.toggle('active', !reg);
  $('tabRegister').classList.toggle('active', reg);
  $('tabLogin').setAttribute('aria-selected', String(!reg));
  $('tabRegister').setAttribute('aria-selected', String(reg));
  $('title').textContent = reg ? 'Crea il tuo account' : 'Bentornato';
  $('kicker').textContent = reg ? 'Registrazione' : 'Accesso allo studio';
  $('blurb').textContent = reg
    ? 'Servono solo un indirizzo email e una password: le tue creazioni restano legate a questo account.'
    : 'Entra per ritrovare le tue creazioni: restano sul server, non solo su questo browser.';
  $('submitBtn').textContent = reg ? 'Crea account' : 'Accedi';
  $('password').setAttribute('autocomplete', reg ? 'new-password' : 'current-password');
  $('pwHint').hidden = !reg;
  $('forgotBtn').hidden = reg;
  /* la presa visione dell'informativa riguarda solo chi sta aprendo un
     account: a chi rientra non si richiede di riaccettare nulla */
  $('privacyCheck').hidden = !reg;
  if (!reg) $('acceptPrivacy').checked = false;
  clearErrors();
  history.replaceState(null, '', reg ? '?modo=registrazione' : location.pathname);
}

function clearErrors(){
  for (const id of ['formErr', 'formOk', 'emailErr', 'passwordErr', 'privacyErr']) $(id).hidden = true;
  for (const id of ['email', 'password']) $(id).removeAttribute('aria-invalid');
}

function showError(err){
  const field = err instanceof ApiError ? err.field : null;
  const msg = err instanceof ApiError ? err.message : (err?.message || String(err));
  if (field && $(field + 'Err')){
    $(field + 'Err').textContent = msg;
    $(field + 'Err').hidden = false;
    /* «privacy» è una casella con un id diverso dal nome del campo: il
       messaggio ha comunque il suo posto, l'evidenziazione no */
    const input = $(field);
    if (input){ input.setAttribute('aria-invalid', 'true'); input.focus(); }
  } else {
    $('formErr').textContent = msg;
    $('formErr').hidden = false;
  }
}

function showOk(msg){
  $('formOk').textContent = msg;
  $('formOk').hidden = false;
}

$('tabLogin').addEventListener('click', () => setMode('login'));
$('tabRegister').addEventListener('click', () => {
  if (!registrationOpen){ toast('Le registrazioni sono chiuse su questa installazione.'); return; }
  setMode('register');
});

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  clearErrors();
  const email = $('email').value.trim();
  const password = $('password').value;

  if (!email){ showError(new ApiError('Inserisci il tuo indirizzo email', { field:'email' })); return; }
  if (!password){ showError(new ApiError('Inserisci la password', { field:'password' })); return; }
  if (mode === 'register' && !$('acceptPrivacy').checked){
    showError(new ApiError('Per creare l\'account devi prendere visione dell\'informativa privacy.',
      { field:'privacy' }));
    $('acceptPrivacy').focus();
    return;
  }

  const btn = $('submitBtn');
  btn.classList.add('busy');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = mode === 'register' ? 'Creo l\'account…' : 'Entro…';

  try{
    const r = mode === 'register'
      ? await api.auth.register(email, password, $('acceptPrivacy').checked)
      : await api.auth.login(email, password);

    if (r.needsVerification){
      form.hidden = true;
      showOk(r.message || 'Controlla la posta: ti abbiamo inviato il link di conferma.');
      return;
    }
    location.href = next;
  }catch(err){
    if (err.code === 'unverified'){
      showError(err);
      showOk('Non trovi l\'email? Controlla anche la cartella dello spam.');
    } else showError(err);
  }finally{
    btn.classList.remove('busy');
    btn.disabled = false;
    btn.textContent = label;
  }
});

$('forgotBtn').addEventListener('click', async () => {
  clearErrors();
  const email = $('email').value.trim();
  if (!email){
    showError(new ApiError('Scrivi prima il tuo indirizzo email, poi riprova.', { field:'email' }));
    return;
  }
  try{
    const r = await api.auth.forgot(email);
    showOk(r.smtp
      ? r.message
      : 'Su questa installazione l\'invio email non è configurato: il link di recupero compare nel log del server.');
  }catch(err){ showError(err); }
});

/* messaggi che arrivano dal link di conferma email */
const verify = params.get('verify');
if (verify === 'ok') showOk('Indirizzo confermato. Ora puoi accedere.');
else if (verify === 'scaduto') showError(new ApiError('Link di conferma scaduto: accedi e chiedine uno nuovo.'));
else if (verify === 'nonvalido') showError(new ApiError('Link di conferma non valido o già usato.'));

/* chi è già dentro non deve vedere il modulo di accesso */
api.auth.me().then(({ user, registrationOpen: open }) => {
  registrationOpen = open !== false;
  if (!registrationOpen){
    $('tabRegister').disabled = true;
    $('closedNote').hidden = false;
  }
  if (user){ location.replace(next); return; }
  if (params.get('modo') === 'registrazione' && registrationOpen) setMode('register');
}).catch(() => {});
