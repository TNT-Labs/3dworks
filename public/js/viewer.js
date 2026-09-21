/* =====================================================================
   VIEWER PUBBLICO · dal codice di produzione al pezzo, in sola lettura.
   Costruisce la stessa geometria dello studio con lo stesso motore, ma non
   espone nulla che possa modificarla: niente slider, niente export, niente
   salvataggio. I comandi presenti cambiano solo il punto di vista.
   ===================================================================== */
import { api } from './api.js';
import { decodeState, normCode, THREAD_STD } from './design-spec.js';
import { DesignModel, TILT_MAX } from './design-model.js';
import { Stage } from './stage.js';
import { fmtTime, fmtDate } from './format.js';

const $ = id => document.getElementById(id);

function fatal(msg){
  $('fatalMsg').textContent = msg;
  $('fatal').style.display = 'flex';
}
window.addEventListener('error', e => {
  if ($('fatal').style.display !== 'flex')
    fatal((e.message || 'Errore inatteso') + ' — ricarica la pagina.');
});

let toastT;
function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3400);
}

const PROFILE_NAMES = { clessidra:'Clessidra', fiamma:'Fiamma', tornado:'Tornado', bulbo:'Bulbo' };
const PIECE_NAMES = { disp:'Dispenser', tooth:'Portaspazzolino', plate:'Set sul piatto (2 pezzi)' };

/* il codice sta nel percorso /p/VRT-XXXXX */
const code = normCode(decodeURIComponent(location.pathname.split('/').pop() || ''));

function showMissing(title, msg){
  $('loading').hidden = true;
  $('missing').hidden = false;
  $('missingTitle').textContent = title;
  $('missingMsg').textContent = msg;
}

if (!code){
  showMissing('Codice non valido',
    'Il codice deve essere nella forma VRT-XXXXX, come inciso sul fondo del pezzo.');
} else {
  start().catch(err => {
    console.error(err);
    showMissing('Impossibile aprire il prodotto', err.message || String(err));
  });
}

async function start(){
  const { product } = await api.public.byCode(code).catch(err => {
    if (err.status === 404) showMissing('Codice non trovato',
      `Nessun prodotto pubblico con il codice ${code}. Controlla la lettura sul fondo del pezzo: le lettere I, L, O e U non vengono mai usate.`);
    else showMissing('Impossibile aprire il prodotto', err.message);
    throw err;
  });

  const state = decodeState(product.state);
  if (!state) throw new Error('Il modello di questo prodotto non è leggibile.');

  document.title = `${product.name} · ${product.code} · VORTICE`;

  /* modello fermo: nessuna animazione da riprodurre, il pezzo è già deciso */
  const model = new DesignModel({ animate: false });
  model.applyState(state, false);
  /* sul pezzo reale è inciso il codice di produzione, non l'impronta */
  model.setSerial(product.code);
  model.build(true);

  fillPanel(product, state, model);

  $('loading').hidden = true;
  $('app').hidden = false;

  const stage = new Stage({ container: $('stage'), model, autoRotate: true });
  stage.sync();
  stage.on('error', err => { console.error(err); fatal('Errore nel disegno del modello: ' + err.message); });
  wireTools(stage);
  stage.start();

  $('caption').textContent = captionFor(model.metrics);
}

function captionFor(m){
  if (m.plate)
    return m.plate.fits
      ? `set · 2 pezzi ${m.plate.layout} · ${Math.ceil(m.plate.W)} × ${Math.ceil(m.plate.D)} mm`
      : 'i due pezzi non entrano insieme sul piatto';
  return `Ø ${Math.round(m.diameter)} × ${Math.round(m.height)} mm · ≈${Math.round(m.capML)} ml · pareti ${m.tilt.toFixed(0)}°`;
}

function fillPanel(product, state, model){
  const m = model.metrics;
  const set = (id, text) => { $(id).textContent = text; };
  const dot = (id, ok, warn = false) => {
    const el = $(id);
    const i = document.createElement('i');
    i.className = 'dot ' + (ok ? 'ok' : warn ? 'warn' : 'bad');
    el.prepend(i);
  };

  set('pCode', product.code);
  set('pName', product.name);
  set('pKind', PIECE_NAMES[state.piece] || PIECE_NAMES.disp);
  set('pWhen', `Pubblicato il ${fmtDate(product.publishedAt)} · ${product.views.toLocaleString('it-IT')} visualizzazioni`);

  /* scheda del pezzo — ricalcolata qui dalla stessa geometria, non copiata */
  set('mSize',  `Ø ${Math.round(m.diameter)} × ${Math.round(m.height)} mm`);
  set('mCap',   `≈ ${Math.round(m.capML)} ml`);
  set('mDepth', `≈ ${Math.round(m.depth)} mm`);
  set('mPass',  `Ø min ${m.pass.toFixed(0)} mm`);
  set('mTilt',  `${m.tilt.toFixed(0)}° max`);
  set('mWall',  `${m.wall.toFixed(2)} mm · ${m.wallPerimeters} passate`);
  /* i perimetri della ricetta seguono la parete del pezzo: su un guscio spesso
     un numero fisso lascerebbe riempimento rado chiuso dentro la parete */
  set('mWalls', `${m.recipeWalls} perimetri (tenuta)`);
  set('mSeal',  `≥ ${m.seal.toFixed(1)} mm pieni`);
  set('mVol',   `≈ ${Math.round(m.matVol / 1000)} cm³`);
  set('mFil',   `${Math.round(m.grams)} g · ${Math.round(m.meters)} m`);
  set('mTime',  `≈ ${fmtTime(m.seconds)}`);
  dot('mPass', m.passOk);
  dot('mTilt', m.tilt <= TILT_MAX);
  dot('mSeal', m.sealOk);
  dot('mWall', m.wallOk);

  /* collo filettato: solo sui pezzi che ce l'hanno */
  const hasNeck = state.piece !== 'tooth';
  $('secNeck').hidden = !hasNeck;
  if (hasNeck){
    const std = Object.entries(THREAD_STD).find(([, t]) =>
      Math.abs(t.d - state.P.thD) < .01 && Math.abs(t.p - state.P.pitch) < .005 && Math.abs(t.t - state.P.turns) < .01);
    set('nStd', std ? `GPI ${std[0]}` : 'misure personali');
    set('nD', `${state.P.thD.toFixed(1)} mm`);
    set('nP', `${state.P.pitch.toFixed(2)} mm`);
    set('nG', String(state.P.turns));
  }

  /* forma */
  set('fProf', PROFILE_NAMES[state.profile] || state.profile);
  set('fPet',  String(state.P.petals));
  set('fTw',   `${state.P.twist}°`);
  set('fSh',   `${Math.round(state.P.sharp * 100)}%`);
  set('fW',    `${state.P.w.toFixed(1)} mm`);
  if (state.sig.on && state.sig.q){
    $('rowSig').hidden = false;
    const kind = state.sig.src === 'voce' ? 'voce · anello attorno al vaso' : 'traccia GPX · silhouette in quota';
    const fid = m.signal && m.signal.fid != null ? ` · fedeltà ${Math.round(m.signal.fid * 100)}%` : '';
    set('fSig', kind + fid);
  }

  /* incisione sul fondo */
  const engraved = model.logoRaster && model.logoRaster.ok;
  if (!state.logo.on){
    set('eText', 'fondo liscio');
    set('eNote', 'Questo pezzo è stato generato senza incisione.');
  } else {
    set('eText', state.logo.text + (state.logo.sn ? `\n${product.code}` : ''));
    set('eNote', `${state.logo.arc ? 'Ad arco' : 'Su riga dritta'} · corpo ${state.logo.size.toFixed(1)} mm · ` +
      `profondità ${state.logo.depth.toFixed(1)} mm` +
      (engraved ? '' : ' · il testo non entrava nel fondo e non è stato inciso'));
  }
}

function wireTools(stage){
  const bind = (id, action, event) => {
    const btn = $(id);
    btn.addEventListener('click', action);
    if (event) stage.on(event, on => {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  };
  bind('tSpin', () => stage.toggleAutoRotate(), 'spin');
  bind('tView', () => stage.resetView());
  bind('tCut',  () => stage.toggleCut(), 'cut');
  bind('tFlat', () => stage.toggleSmooth(), 'smooth');
  /* "sfaccettato" è acceso quando le normali NON sono lisce */
  stage.on('smooth', smooth => {
    $('tFlat').classList.toggle('on', !smooth);
    $('tFlat').setAttribute('aria-pressed', String(!smooth));
  });

  $('shareBtn').addEventListener('click', async () => {
    const url = location.origin + `/p/${code}`;
    try{
      await navigator.clipboard.writeText(url);
      toast('Link copiato negli appunti');
    }catch{
      toast('Copia non riuscita · usa l\'indirizzo nella barra');
    }
  });
}
