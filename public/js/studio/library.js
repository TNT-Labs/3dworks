/* =====================================================================
   LIBRERIA · le creazioni dell'utente sul server.
   Nella V3 l'archivio viveva in localStorage e spariva cambiando browser:
   qui è legato all'account, così il codice inciso sul pezzo ritrova il
   design da qualunque dispositivo.
   ===================================================================== */
import { api } from '../api.js';
import { fmtDate } from '../format.js';
import { toast } from '../toast.js';

const $ = id => document.getElementById(id);

export class Library {
  /**
   * @param {object}   opts
   * @param {()=>string} opts.currentState  stato canonico da salvare
   * @param {(design:object)=>void} opts.onOpen  chiamata quando si apre una creazione
   */
  constructor({ currentState, onOpen }){
    this.currentState = currentState;
    this.onOpen = onOpen;
    this.designs = [];
    this.total = 0;
    this.pageSize = 30;
    this.current = null;          // creazione aperta (record del server)
    this.savedState = null;       // stato dell'ultimo salvataggio riuscito
    this.savedName = null;
    this.#wire();
  }

  /* --------------------------- stato di salvataggio --------------------------- */

  get name(){ return $('docName').value.trim() || 'Senza titolo'; }
  set name(v){ $('docName').value = v; }

  get dirty(){
    if (!this.current) return true;
    return this.currentState() !== this.savedState || this.name !== this.savedName;
  }

  refreshBadge(){
    const el = $('docState');
    if (!this.current){ el.textContent = 'non salvato'; el.className = 'doc-state dirty'; return; }
    if (this.dirty){ el.textContent = 'modifiche non salvate'; el.className = 'doc-state dirty'; return; }
    el.textContent = 'salvato'; el.className = 'doc-state saved';
  }

  /* --------------------------- salvataggio --------------------------- */

  async save({ silent = false } = {}){
    const state = this.currentState();
    const name = this.name;
    try{
      const r = this.current
        ? await api.designs.update(this.current.id, { name, state })
        : await api.designs.create(name, state);
      this.#adopt(r.design);
      await this.reload();
      if (!silent) toast(`«${r.design.name}» salvata`);
      return r.design;
    }catch(err){
      toast('Salvataggio non riuscito · ' + err.message);
      throw err;
    }
  }

  /** Salva come nuova creazione, lasciando intatta quella di partenza. */
  async duplicate(){
    const base = this.current;
    this.current = null;
    this.name = base ? `${base.name} (copia)`.slice(0, 60) : this.name;
    const d = await this.save({ silent: true });
    toast(`Creata «${d.name}»`);
    return d;
  }

  #adopt(design){
    this.current = design;
    this.savedState = design.state;
    this.savedName = design.name;
    this.name = design.name;
    this.refreshBadge();
    this.renderPublish();
    /* l'indirizzo porta l'identificativo: ricaricando si riapre la stessa creazione */
    const url = new URL(location.href);
    url.searchParams.set('id', design.id);
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  /* --------------------------- apertura --------------------------- */

  async open(id){
    const { design } = await api.designs.get(id);
    this.#adopt(design);
    this.onOpen(design);
    this.render();
    return design;
  }

  /** Comincia da capo: nessuna creazione aperta, nulla da sovrascrivere. */
  startNew(){
    this.current = null;
    this.savedState = null;
    this.savedName = null;
    this.name = '';
    this.refreshBadge();
    this.renderPublish();
    const url = new URL(location.href);
    url.searchParams.delete('id');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    this.render();
  }

  async remove(design){
    if (!confirm(`Eliminare «${design.name}»?\n\nL'operazione non si può annullare` +
                 (design.published ? ' e la scheda pubblica smetterà di funzionare.' : '.'))) return;
    await api.designs.remove(design.id);
    if (this.current?.id === design.id) this.startNew();
    await this.reload();
    toast(`«${design.name}» eliminata`);
  }

  /* --------------------------- pubblicazione --------------------------- */

  async publish({ meta, preview }){
    if (!this.current) await this.save({ silent: true });
    const state = this.currentState();

    let r;
    try{
      r = await api.designs.publish(this.current.id, { state, meta });
    }catch(err){
      if (err.code !== 'already_published') throw err;
      const ok = confirm(
        `Il codice ${this.current.code} è già pubblicato con parametri diversi.\n\n` +
        'Aggiornandolo, chi digita quel codice vedrà la forma nuova — ma i pezzi ' +
        'già stampati con quel codice inciso restano quelli vecchi.\n\n' +
        'Vuoi sostituire la versione pubblicata?');
      if (!ok) return null;
      r = await api.designs.publish(this.current.id, { state, meta, replace: true });
    }

    this.#adopt(r.design);
    this.savedState = state;
    this.refreshBadge();
    if (preview) await api.designs.putPreview(r.design.id, preview).catch(() => {});
    await this.reload();
    return r.design;
  }

  async unpublish(){
    if (!this.current?.published) return;
    if (!confirm('Ritirare la scheda pubblica?\n\nChi digita il codice non vedrà più il pezzo. ' +
                 'Il codice resta tuo e potrai ripubblicarlo quando vuoi.')) return;
    const r = await api.designs.unpublish(this.current.id);
    this.#adopt(r.design);
    await this.reload();
    toast('Scheda pubblica ritirata');
  }

  renderPublish(){
    const d = this.current;
    const live = !!(d && d.published);
    $('pubEmpty').hidden = live;
    $('pubLive').hidden = !live;
    $('unpubBtn').hidden = !live;
    $('pubBtn').querySelector('span').textContent = live
      ? 'Aggiorna la scheda pubblica'
      : 'Pubblica e ottieni il codice';
    if (!live) return;

    $('pubCode').textContent = d.code;
    $('pubWhen').textContent = `pubblicato il ${fmtDate(d.publishedAt)} · ${d.views.toLocaleString('it-IT')} visualizzazioni`;
    $('pubOpen').href = `/p/${d.code}`;
    $('pubStale').hidden = !d.stale;
  }

  /* --------------------------- elenco --------------------------- */

  /**
   * Ricarica l'elenco. Conserva quante creazioni erano già visibili, così
   * dopo un salvataggio la lista non si richiude su sé stessa.
   */
  async reload(){
    const want = Math.max(this.pageSize, this.designs.length);
    try{
      const { designs, total } = await api.designs.list(Math.min(100, want));
      this.designs = designs;
      this.total = total;
      if (this.current){
        const fresh = designs.find(x => x.id === this.current.id);
        if (fresh){ this.current = { ...this.current, ...fresh }; this.renderPublish(); }
      }
      this.render();
    }catch(err){ console.warn('elenco creazioni non aggiornato:', err.message); }
  }

  /** Aggiunge in coda la pagina successiva di creazioni. */
  async loadMore(){
    try{
      const { designs, total } = await api.designs.list(this.pageSize, this.designs.length);
      const seen = new Set(this.designs.map(d => d.id));
      this.designs = [...this.designs, ...designs.filter(d => !seen.has(d.id))];
      this.total = total;
      this.render();
    }catch(err){ toast('Elenco non caricato · ' + err.message); }
  }

  render(){
    const box = $('libList');
    box.textContent = '';
    if (!this.designs.length){
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Nessuna creazione salvata. Disegna qualcosa e premi «Salva».';
      box.append(p);
      return;
    }
    for (const d of this.designs) box.append(this.#itemFor(d));

    /* con molte creazioni le più vecchie resterebbero irraggiungibili */
    if (this.designs.length < this.total){
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn--ghost btn--small';
      more.textContent = `Mostra altre (${this.total - this.designs.length})`;
      more.addEventListener('click', () => this.loadMore());
      box.append(more);
    }
  }

  #itemFor(d){
    const wrap = document.createElement('div');
    wrap.className = 'lib-item' + (this.current?.id === d.id ? ' current' : '');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'body';
    open.title = 'Apri questa creazione';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = d.name;

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.append(fmtDate(d.updatedAt));
    if (d.published){
      meta.append(' · ');
      const c = document.createElement('b');
      c.className = 'pub';
      c.textContent = d.code;
      meta.append(c);
      if (d.stale){
        meta.append(' · ');
        const s = document.createElement('b');
        s.className = 'stale';
        s.textContent = 'modificato dopo';
        meta.append(s);
      }
    } else if (d.code){
      meta.append(` · ${d.code} · ritirato`);
    }

    open.append(name, meta);
    open.addEventListener('click', async () => {
      if (this.dirty && !confirm('Hai modifiche non salvate. Aprire comunque un\'altra creazione?')) return;
      await this.open(d.id);
      closeDrawer();
      toast(`«${d.name}» aperta`);
    });

    const kill = document.createElement('button');
    kill.type = 'button';
    kill.className = 'kill';
    kill.title = 'Elimina';
    kill.setAttribute('aria-label', `Elimina ${d.name}`);
    kill.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/></svg>';
    kill.addEventListener('click', () => this.remove(d));

    wrap.append(open, kill);
    return wrap;
  }

  /* --------------------------- cassetto --------------------------- */

  #wire(){
    $('libBtn').addEventListener('click', () => openDrawer());
    for (const el of document.querySelectorAll('[data-close]'))
      el.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('library').hidden) closeDrawer();
    });
    $('newBtn').addEventListener('click', () => {
      if (this.dirty && !confirm('Hai modifiche non salvate. Cominciare comunque una nuova creazione?')) return;
      this.startNew();
      this.onOpen(null);
      closeDrawer();
    });
    $('dupBtn').addEventListener('click', async () => {
      await this.duplicate();
      closeDrawer();
    });
  }
}

let lastFocus = null;
export function openDrawer(){
  lastFocus = document.activeElement;
  $('library').hidden = false;
  $('libBtn').setAttribute('aria-expanded', 'true');
  $('libClose').focus();
}
export function closeDrawer(){
  $('library').hidden = true;
  $('libBtn').setAttribute('aria-expanded', 'false');
  lastFocus?.focus?.();
}
