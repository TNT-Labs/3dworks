/* Impostazione della nuova password dal link ricevuto via email. */
import { api } from './api.js';

const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get('token');

if (!token){
  $('formErr').textContent = 'Questo link non contiene un codice di recupero. Richiedine uno nuovo dalla pagina di accesso.';
  $('formErr').hidden = false;
  $('resetForm').hidden = true;
}

$('resetForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  for (const id of ['formErr', 'passwordErr', 'confirmErr']) $(id).hidden = true;

  const password = $('password').value;
  const confirm = $('confirm').value;
  if (password !== confirm){
    $('confirmErr').textContent = 'Le due password non coincidono.';
    $('confirmErr').hidden = false;
    $('confirm').focus();
    return;
  }

  const btn = $('submitBtn');
  btn.disabled = true;
  btn.classList.add('busy');
  try{
    await api.auth.reset(token, password);
    location.href = '/studio.html';
  }catch(err){
    const target = err.field === 'password' ? 'passwordErr' : 'formErr';
    $(target).textContent = err.message;
    $(target).hidden = false;
  }finally{
    btn.disabled = false;
    btn.classList.remove('busy');
  }
});
