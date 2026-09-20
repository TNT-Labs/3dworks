/* Pagina account: i diritti dell'interessato resi azioni.
   Accesso e portabilità (art. 15 e 20) sono un link di download; rettifica
   (art. 16) e cancellazione (art. 17) sono due moduli che chiedono la
   password, perché una sessione lasciata aperta su un computer altrui non
   deve bastare né a cambiare l'indirizzo né a distruggere il lavoro. */
import { api, ApiError } from './api.js';
import { toast } from './toast.js';

const $ = id => document.getElementById(id);

const dateFmt = new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeStyle: 'short' });
const showDate = ms => (ms ? dateFmt.format(new Date(ms)) : '—');

function clear(){ $('err').hidden = true; $('ok').hidden = true; }
function fail(e){
  $('err').textContent = e instanceof ApiError ? e.message : (e?.message || String(e));
  $('err').hidden = false;
  $('err').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function done(msg){
  $('ok').textContent = msg;
  $('ok').hidden = false;
  $('ok').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* Un modulo alla volta, con il bottone spento mentre la richiesta è in volo:
   due invii dello stesso «elimina» sarebbero un guaio. */
function submitting(form, fn){
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    clear();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.classList.add('busy');
    try{ await fn(); }
    catch(err){ fail(err); }
    finally{ btn.disabled = false; btn.classList.remove('busy'); }
  });
}

const { user, privacyVersion } = await api.auth.me().catch(() => ({ user: null }));

if (!user){
  $('gate').hidden = false;
} else {
  $('shell').hidden = false;
  render(user);

  /* il numero di creazioni non sta in /me: lo chiede l'elenco, che risponde
     con il totale anche chiedendone una sola */
  api.designs.list(1, 0)
    .then(({ total }) => {
      $('vDesigns').textContent = total === 0 ? 'nessuna'
        : total === 1 ? '1 creazione' : `${total} creazioni`;
      /* «le tue 0 creazioni» non lo scrive nessuno */
      $('vDesignsDel').textContent = total === 0 ? 'ciò che hai disegnato'
        : total === 1 ? 'la tua creazione' : `le tue ${total} creazioni`;
    })
    .catch(() => { $('vDesigns').textContent = 'non disponibile'; });

  /* Informativa cambiata dopo la presa visione — o mai presa visione, come
     per gli account nati prima che questa pagina esistesse: in entrambi i
     casi va chiesta, ed è la stessa richiesta. */
  if (privacyVersion && user.privacyVersion !== privacyVersion)
    $('privacyUpdated').hidden = false;
}

function render(u){
  $('vEmail').textContent = u.email;
  $('vVerified').textContent = u.verified ? 'sì' : 'no, controlla la posta';
  $('vCreated').textContent = showDate(u.createdAt);
  $('vPrivacy').textContent = u.privacyAcceptedAt
    ? `versione ${u.privacyVersion || '—'}, presa visione il ${showDate(u.privacyAcceptedAt)}`
    : 'nessuna presa visione registrata';
}

$('acceptPrivacyBtn')?.addEventListener('click', async () => {
  clear();
  try{
    const r = await api.auth.acceptPrivacy();
    render(r.user);
    $('privacyUpdated').hidden = true;
    done('Presa visione registrata.');
  }catch(err){ fail(err); }
});

$('outBtn').addEventListener('click', async () => {
  await api.auth.logout().catch(() => {});
  location.href = '/';
});

$('logoutAllBtn').addEventListener('click', async () => {
  clear();
  try{
    await api.auth.logoutAll();
    toast('Tutte le sessioni sono state chiuse.');
    location.href = '/accedi.html';
  }catch(err){ fail(err); }
});

/* ------------------------------ rettifica ------------------------------ */
submitting($('emailForm'), async () => {
  const r = await api.auth.changeEmail($('emailPw').value, $('newEmail').value.trim());
  render(r.user);
  $('emailForm').reset();
  done(r.unchanged ? 'È già il tuo indirizzo: non è cambiato nulla.' : (r.message || 'Indirizzo aggiornato.'));
});

submitting($('pwForm'), async () => {
  await api.auth.changePassword($('curPw').value, $('newPw').value);
  $('pwForm').reset();
  done('Password cambiata. Le altre sessioni sono state chiuse.');
});

/* ---------------------------- cancellazione ---------------------------- */
submitting($('delForm'), async () => {
  if ($('delWord').value.trim().toUpperCase() !== 'ELIMINA')
    throw new ApiError('Scrivi ELIMINA nel campo di conferma per procedere.');
  /* ultima rete di sicurezza prima di un'operazione senza ritorno */
  if (!confirm('Eliminare l\'account e tutte le creazioni? L\'operazione è immediata e non è reversibile.'))
    return;

  const r = await api.auth.deleteAccount($('delPw').value);
  /* niente toast: la pagina sta per cambiare, e la conferma deve restare
     leggibile su quella dopo */
  location.href = `/?eliminato=1&creazioni=${r.deletedDesigns}`;
});
