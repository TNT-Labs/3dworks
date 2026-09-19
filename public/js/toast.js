/* Avviso a comparsa condiviso da tutte le pagine. */
let timer;
export function toast(msg, ms = 3600){
  const t = document.getElementById('toast');
  if (!t){ console.info(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove('show'), ms);
}
