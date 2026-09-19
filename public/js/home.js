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

/* la barra cambia se si è già dentro: evita di proporre "Accedi" a chi è entrato */
api.auth.me().then(({ user }) => {
  if (!user) return;
  $('nav').innerHTML = '';
  const studio = document.createElement('a');
  studio.className = 'btn btn--small';
  studio.href = '/studio.html';
  studio.textContent = 'Apri lo studio';
  $('nav').append(studio);
}).catch(() => {});
