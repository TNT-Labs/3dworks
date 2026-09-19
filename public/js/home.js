/* Landing pubblica: normalizza il codice mentre lo si digita e porta al pezzo. */
import { normCode } from './design-spec.js';
import { api } from './api.js';

const $ = id => document.getElementById(id);
const input = $('codeIn'), form = $('codeForm'), err = $('codeErr'), go = $('codeGo');

function showError(msg){
  err.textContent = msg;
  err.hidden = !msg;
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
}

/* Il campo NON viene riscritto mentre si digita: riformattare a ogni tasto
   fa perdere caratteri quando l'inserimento è più veloce della riscrittura
   (incolla, tastiere software, autocompletamento). Le maiuscole le fa il CSS;
   la forma canonica compare uscendo dal campo, e normCode accetta comunque
   ogni variante — «VRT-7K3QX», «vrt 7k3qx» o le sole cinque cifre. */
input.addEventListener('input', () => showError(''));

input.addEventListener('blur', () => {
  const c = normCode(input.value);
  if (c) input.value = c;
});

form.addEventListener('submit', async ev => {
  ev.preventDefault();
  const code = normCode(input.value);
  if (!code){
    showError('Il codice è fatto da 5 caratteri dopo VRT-, per esempio VRT-7K3QX.');
    input.focus();
    return;
  }
  input.value = code;
  go.classList.add('busy');
  go.disabled = true;
  try{
    /* controlliamo prima di navigare: così l'errore resta qui, con il campo
       ancora compilato, invece di sbattere su una pagina vuota */
    await api.public.byCode(code);
    location.href = `/p/${code}`;
  }catch(e){
    showError(e.status === 404
      ? `Nessun prodotto pubblico con il codice ${code}. Controlla la lettura sul fondo del pezzo.`
      : e.message);
    input.focus();
    input.select();
  }finally{
    go.classList.remove('busy');
    go.disabled = false;
  }
});

/* se si arriva da un link con codice, precompila */
const fromUrl = new URLSearchParams(location.search).get('codice');
if (fromUrl && fromUrl !== 'nonvalido'){
  input.value = normCode(fromUrl) || fromUrl.toUpperCase().slice(0, 12);
} else if (fromUrl === 'nonvalido'){
  showError('Quel link contiene un codice in un formato che non riconosciamo.');
}

/* conferma della cancellazione dell'account: la pagina che l'ha chiesta non
   esiste più per quell'utente, quindi la buona notizia va data qui */
const params = new URLSearchParams(location.search);
if (params.get('eliminato') === '1'){
  const n = Number(params.get('creazioni'));
  const p = document.createElement('p');
  p.className = 'notice notice--ok';
  p.setAttribute('role', 'status');
  p.textContent = 'Account eliminato. Sono state cancellate anche '
    + (Number.isFinite(n) && n >= 0 ? (n === 1 ? 'la tua creazione' : `le tue ${n} creazioni`) : 'le tue creazioni')
    + ', le pubblicazioni e tutte le sessioni: di te non resta nulla sul server.';
  document.querySelector('.hero').after(p);
  history.replaceState(null, '', location.pathname);
}

/* la barra cambia se si è già dentro: evita di proporre "Accedi" a chi è entrato */
api.auth.me().then(({ user }) => {
  if (!user) return;
  $('nav').replaceChildren();
  for (const [href, label, cls] of [['/studio.html', 'Apri lo studio', 'btn btn--small'],
                                    ['/account.html', 'Account', 'btn btn--ghost btn--small']]){
    const a = document.createElement('a');
    a.className = cls;
    a.href = href;
    a.textContent = label;
    $('nav').append(a);
  }
}).catch(() => {});
