/* Riempie l'informativa e la pagina dei cookie con i dati di /api/legal.
   Il testo giuridico sta nell'HTML — è quello che va letto e versionato; da
   qui arrivano solo i valori che cambiano da un'installazione all'altra:
   titolare, recapiti, responsabili, tempi di conservazione. */
import { api } from './api.js';

const $ = id => document.getElementById(id);
const txt = (el, s) => { el.textContent = s; };

/* «titolare.nome» → legal.titolare.nome */
const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

function row(cells){
  const tr = document.createElement('tr');
  for (const [head, value] of cells){
    const td = document.createElement('td');
    td.dataset.th = head;
    /* sempre come testo: questi valori arrivano dalla configurazione del
       server, ma non c'è motivo di dar loro il potere di scrivere HTML */
    td.textContent = value ?? '—';
    tr.append(td);
  }
  return tr;
}

function fillTable(id, head, rows){
  const table = $(id);
  if (!table) return;
  const body = table.tBodies[0];
  body.replaceChildren(...rows.map(r => row(head.map((h, i) => [h, r[i]]))));
  table.hidden = !rows.length;
}

const legal = await api.legal().catch(() => null);

if (legal){
  /* segnaposto semplici */
  for (const el of document.querySelectorAll('[data-legal]')){
    const v = pick(legal, el.dataset.legal);
    txt(el, v ?? 'non indicato');
    if (v && el.hasAttribute('data-legal-mailto')){
      const a = document.createElement('a');
      a.href = 'mailto:' + v;
      a.textContent = v;
      el.replaceChildren(a);
    }
  }

  if ($('incomplete')) $('incomplete').hidden = legal.informativa.completa;

  if (legal.dpo && $('dpoLabel')){ $('dpoLabel').hidden = false; $('dpoValue').hidden = false; }

  if ($('authorityUrl') && legal.autorita.url) $('authorityUrl').href = legal.autorita.url;

  /* cookie: la tabella è la lista vera dei cookie che il server imposta */
  if (legal.cookie)
    fillTable('cookies', ['Nome', 'Tipo', 'Finalità', 'Contenuto', 'Durata', 'Attributi'],
      legal.cookie.map(c => [c.nome, c.tipo, c.finalita, c.contenuto, c.durata, c.attributi]));

  /* destinatari: sulla stessa installazione possono non essercene */
  const dest = legal.destinatari ?? [];
  fillTable('processors', ['Soggetto', 'Ruolo', 'Attività', 'Dati'],
    dest.map(d => [d.chi, d.ruolo, d.cosa, d.dati]));
  for (const id of ['noProcessors', 'noThird']) if ($(id)) $(id).hidden = dest.length > 0;

  const LABELS = {
    account: 'Account (email, password, date)',
    accountNonConfermati: 'Account mai confermati',
    accountDormienti: 'Account senza accessi',
    sessioni: 'Sessioni e cookie di sessione',
    tokenReimpostazione: 'Token di reimpostazione password',
    indirizziIp: 'Indirizzi IP (limite ai tentativi)',
    creazioni: 'Creazioni, pubblicazioni e anteprime',
  };
  fillTable('retention', ['Dato', 'Conservazione'],
    Object.entries(legal.conservazione ?? {}).map(([k, v]) => [LABELS[k] ?? k, v]));

  const RIGHTS = {
    accesso: 'Accesso ai propri dati', rettifica: 'Rettifica', cancellazione: 'Cancellazione («oblio»)',
    limitazione: 'Limitazione del trattamento', portabilita: 'Portabilità', opposizione: 'Opposizione',
    reclamo: 'Reclamo all\'autorità di controllo',
  };
  fillTable('rights', ['Diritto', 'Come esercitarlo'],
    Object.entries(legal.diritti ?? {}).map(([k, v]) => [`${RIGHTS[k] ?? k} · art. ${v.articolo}`, v.come]));

  if ($('transfers') && legal.trasferimentiExtraUe)
    txt($('transfers'), 'sono previsti trasferimenti extra UE: vedi i destinatari qui sopra');
} else {
  /* Senza la risposta del server la pagina resta leggibile: il testo c'è
     comunque, mancano solo i recapiti — e lo diciamo invece di lasciare trattini. */
  const warn = $('incomplete');
  if (warn){
    warn.textContent = 'Recapiti del titolare non raggiungibili in questo momento: ricarica la pagina.';
    warn.hidden = false;
  }
}
