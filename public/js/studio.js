/* =====================================================================
   STUDIO · l'area di creazione, riservata a chi ha un account.
   Mette insieme il modello (geometria), lo stage (scena) e la libreria
   (creazioni sul server). Gli slider prendono i limiti dalla spec
   condivisa: il server valida gli stessi numeri con lo stesso file.
   ===================================================================== */
import {
  RANGES, LOGO_RANGES, SIG_RANGES, PRESETS, THREAD_STD, THREAD_DEFAULT,
  encodeState, decodeState, defaultState, toSlider, fromSlider, sanitizeText,
} from './design-spec.js';
import { DesignModel } from './design-model.js';
import { Stage } from './stage.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { runJob, saveBlob, jobFor, fileNameFor } from './exporter.js';
import { fmtBytes, it } from './format.js';
import { renderReadout } from './studio/readout.js';
import { Library, closeDrawer } from './studio/library.js';
import { parseGPX, signalFromAudio, recordVoice } from './studio/signal-io.js';

const $ = id => document.getElementById(id);
const PIECE_NAMES = { disp:'Dispenser', tooth:'Portaspazzolino' };

function fatal(msg){
  $('fatalMsg').innerHTML = msg;
  $('fatal').style.display = 'flex';
}
window.addEventListener('error', e => {
  if ($('fatal').style.display !== 'flex')
    fatal((e.message || 'Errore inatteso') + '<br><br>Se il problema persiste, ricarica la pagina.');
});

/* ====================== accesso ====================== */
const { user } = await api.auth.me().catch(() => ({ user: null }));
if (!user){
  location.replace('/accedi.html?next=' + encodeURIComponent(location.pathname + location.search));
  throw new Error('accesso richiesto');
}
$('who').textContent = user.email;
$('gate').hidden = true;
$('shell').hidden = false;

$('outBtn').addEventListener('click', async () => {
  if (library.dirty && !confirm('Hai modifiche non salvate. Uscire comunque?')) return;
  await api.auth.logout().catch(() => {});
  location.href = '/';
});

/* ====================== modello e scena ====================== */
const model = new DesignModel({ animate: true });
let pending = true;          // una ricostruzione è in attesa anche senza movimento
let lastMetrics = 0;

const stage = new Stage({ container: $('stage'), model, autoRotate: true });
stage.on('error', err => { console.error(err); fatal('Errore durante la generazione della geometria:<br>' + err.message); });

function rebuild(withMetrics){
  model.build(withMetrics);
  stage.sync();
  if (withMetrics) renderReadout(model.metrics, model);
}

stage.start(dt => {
  const moved = model.step(dt);
  if (moved){
    const now = performance.now();
    const full = now - lastMetrics > 120;
    if (full) lastMetrics = now;
    rebuild(full);
    if (!full) pending = true;
  } else if (pending){
    rebuild(true);
    pending = false;
  }
});

/* ====================== slider ====================== */
/* min/max/step vengono dalla spec: l'HTML non li ripete e non possono
   divergere da quelli che il server userà per validare. */
function bindSlider(spec, read, write, { onChange, format }){
  const input = $(spec.slider);
  const out = $('v' + spec.slider.slice(1));
  input.min = spec.min; input.max = spec.max; input.step = spec.step;

  const paint = () => {
    const p = (+input.value - spec.min) / (spec.max - spec.min) * 100;
    input.style.background = `linear-gradient(90deg,var(--acc) ${p}%,#2c2822 ${p}%)`;
  };
  const show = () => { out.textContent = format(+input.value); paint(); };

  input.addEventListener('input', () => {
    write(fromSlider(spec, input.value));
    show();
    onChange?.();
    pending = true;
  });

  input._sync = () => { input.value = toSlider(spec, read()); show(); };
  input._sync();
  return input;
}

const fmt = {
  h: v => v + ' mm', r: v => v + ' mm', petals: v => String(v), twist: v => v + '°',
  sharp: v => v + '%', w: v => (v / 10).toFixed(1) + ' mm',
  thD: v => (v / 10).toFixed(1) + ' mm', pitch: v => (v / 10).toFixed(1) + ' mm',
  turns: v => (v / 10).toFixed(1),
  size: v => (v / 10).toFixed(1) + ' mm', depth: v => (v / 10).toFixed(1) + ' mm', rot: v => v + '°',
  amp: v => v + '%', smooth: v => v + '%',
};

/* i parametri di forma escono dai preset; quelli del filetto dagli standard GPI */
const SHAPE_KEYS = new Set(['h', 'r', 'petals', 'twist', 'sharp', 'w']);
const shapeSliders = [], logoSliders = [], sigSliders = [];

for (const spec of Object.values(RANGES)){
  const shape = SHAPE_KEYS.has(spec.key);
  shapeSliders.push(bindSlider(spec,
    () => model.tgt[spec.key],
    v => { model.tgt[spec.key] = v; },
    {
      format: fmt[spec.key],
      onChange(){
        if (shape){
          setActivePreset('custom');
          /* raggio e affilatura cambiano il raggio utile del fondo: il raster va rifatto */
          if (spec.key === 'r' || spec.key === 'sharp') model.rebuildLogoRaster(serial());
        } else syncThreadSeg('free');
      },
    }));
}

for (const spec of Object.values(LOGO_RANGES)){
  logoSliders.push(bindSlider(spec,
    () => model.logo[spec.key],
    v => { model.logo[spec.key] = v; },
    {
      format: fmt[spec.key],
      /* corpo e rotazione ridisegnano il raster; la profondità è solo geometria */
      onChange(){ if (spec.key !== 'depth') model.rebuildLogoRaster(serial()); },
    }));
}

for (const spec of Object.values(SIG_RANGES)){
  sigSliders.push(bindSlider(spec,
    () => model.sig[spec.key],
    v => { model.sig[spec.key] = v; },
    { format: fmt[spec.key], onChange(){ model.syncSignal(false); } }));
}

const syncSliders = () => { for (const s of [...shapeSliders, ...logoSliders, ...sigSliders]) s._sync(); };

/* ====================== segmenti ====================== */
/* Accende il bottone del gruppo il cui attributo `data-<attr>` combacia. */
const setActive = (id, attr, value) =>
  $(id).querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset[attr] === value));

/* --- preset --- */
function setActivePreset(key){
  document.querySelectorAll('.preset').forEach(b => b.classList.toggle('active', b.dataset.p === key));
}
document.querySelectorAll('.preset').forEach(b => b.addEventListener('click', () => {
  const p = PRESETS[b.dataset.p];
  Object.assign(model.tgt, { h:p.h, r:p.r, petals:p.petals, twist:p.twist, sharp:p.sharp });
  model.setProfile(p.profile);
  setActive('segProfile', 'prof', p.profile);
  setActivePreset(b.dataset.p);
  syncSliders();
  model.rebuildLogoRaster(serial());
  pending = true;
}));

/* --- profilo --- */
$('segProfile').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  model.setProfile(b.dataset.prof);
  setActive('segProfile', 'prof', b.dataset.prof);
  setActivePreset('custom');
  model.rebuildLogoRaster(serial());
  pending = true;
}));

/* --- pezzo --- */
function syncPieceUI(){
  const mode = model.plateMode ? 'plate' : model.piece;
  setActive('segPiece', 'p', mode);
  const neck = model.plateMode || model.piece === 'disp';
  $('secNeck').hidden = !neck;
  $('plateBox').hidden = !model.plateMode;
  $('noteTube').hidden = !neck;
  $('dl').querySelector('span').textContent = 'Scarica ' + (format === '3mf' ? '3MF' : 'STL') + ' ' +
    (model.plateMode ? 'del set (2 pezzi)' : model.piece === 'disp' ? 'del dispenser' : 'del portaspazzolino');
  $('lead').innerHTML = neck
    ? 'Vaso a guscio sottile con <b>collo filettato esterno (norma GPI)</b> e <b>firma incisa sul fondo</b>. La pompa commerciale porta la vite interna e si avvita sopra, come su una bottiglia. Tutto vincolato a ~44° — <b>senza supporti</b>.'
    : 'Bicchiere a guscio sottile con <b>bordo aperto</b> e <b>firma incisa sul fondo</b>, dello stesso DNA del dispenser: stesse costole, stessa inclinazione dell\'elica, stesso codice. Tutto vincolato a ~44° — <b>senza supporti</b>.';
}
$('segPiece').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.p === 'plate') model.setPlateMode(true);
  else { model.setPlateMode(false); model.setPiece(b.dataset.p); }
  syncPieceUI();
  pending = true;
}));

/* --- filetto --- */
const syncThreadSeg = key => setActive('segThread', 't', key);
$('segThread').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  syncThreadSeg(b.dataset.t);
  const std = THREAD_STD[b.dataset.t];
  if (!std) return;
  model.tgt.thD = std.d; model.tgt.pitch = std.p; model.tgt.turns = std.t;
  syncSliders();
  toast(`Filetto ${b.dataset.t} · lato bottiglia, la pompa si avvita sopra`);
}));

function currentThreadKey(){
  return Object.keys(THREAD_STD).find(k => {
    const t = THREAD_STD[k];
    return Math.abs(t.d - model.tgt.thD) < .01 && Math.abs(t.p - model.tgt.pitch) < .005
        && Math.abs(t.t - model.tgt.turns) < .01;
  }) || 'free';
}

/* --- incisione --- */
$('logoTxt').addEventListener('input', e => {
  model.logo.text = sanitizeText(e.target.value);
  model.rebuildLogoRaster(serial());
  pending = true;
});
for (const [id, attr, apply] of [
  ['segLogo', 'l', b => { model.logo.on = b.dataset.l === 'on'; }],
  ['segSN',   's', b => { model.logo.sn = b.dataset.s === 'on'; }],
  ['segArc',  'a', b => { model.logo.arc = b.dataset.a === 'arc'; }],
]){
  $(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    apply(b);
    setActive(id, attr, b.dataset[attr]);
    model.rebuildLogoRaster(serial());
    pending = true;
  }));
}

/* --- segnale --- */
function syncSigUI(){
  const mode = model.sig.on ? model.sig.src : 'off';
  setActive('segSig', 'g', mode);
  $('sigGpx').hidden = mode !== 'gpx';
  $('sigVoce').hidden = mode !== 'voce';
  $('sigBody').hidden = !(model.sig.on && model.sig.q);
  $('sigMeta').innerHTML = model.sig.meta || '—';
  const ring = model.sig.src === 'voce';
  const rb = $('segRev').querySelectorAll('button');
  rb[0].textContent = ring ? 'Antiorario (da sopra)' : 'Inizio in basso';
  rb[1].textContent = ring ? 'Orario (da sopra)' : 'Inizio in alto';
  $('vLlab').textContent = ring ? 'Levigatura' : 'Levigatura minima';
  setActive('segRev', 'r', model.sig.rev ? '1' : '0');
  setActive('segInv', 'i', model.sig.inv ? '1' : '0');
  for (const s of sigSliders) s._sync();
}

function signalChanged(regrow = true){
  model.syncSignal(regrow);
  syncSigUI();
  model.rebuildLogoRaster(serial());   // il raggio utile del fondo può cambiare
  pending = true;
}

$('segSig').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  const g = b.dataset.g;
  if (g === 'off') model.sig.on = false;
  else {
    const stored = model.sigStore[g];      // un dato GPX non diventa «voce»
    Object.assign(model.sig, { on:true, src:g, q: stored?.q ?? '', meta: stored?.meta ?? '' });
  }
  signalChanged();
}));
for (const [id, attr, key] of [['segRev', 'r', 'rev'], ['segInv', 'i', 'inv']])
  $(id).querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    model.sig[key] = b.dataset[attr] === '1';
    signalChanged();
  }));

function loadSignal(src, q, meta, msg){
  model.loadSignal(src, q, meta);
  syncSigUI();
  pending = true;
  toast(msg);
}

$('gpxBtn').addEventListener('click', () => $('gpxFile').click());
$('gpxFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try{
    const { q, meta } = parseGPX(await f.text());
    loadSignal('gpx', q, meta, 'Traccia caricata · il profilo del percorso modella il vaso');
  }catch(err){ console.error(err); toast('GPX non caricato · ' + err.message); }
});

$('audBtn').addEventListener('click', () => $('audFile').click());
$('audFile').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try{
    const { q, meta } = await signalFromAudio(await f.arrayBuffer(), f.name.slice(0, 32));
    loadSignal('voce', q, meta, 'Voce caricata · il volume della frase modella il vaso');
  }catch(err){ console.error(err); toast('Audio non caricato · ' + (err.message || 'formato non decodificabile')); }
});

let recording = null, recBusy = false;
const setRecLabel = (txt, on) => {
  $('recBtn').querySelector('span').textContent = txt;
  $('recBtn').classList.toggle('rec', !!on);
};
$('recBtn').addEventListener('click', async () => {
  if (recording){ recording.stop(); return; }
  if (recBusy) return;                          // microfono o analisi in corso
  recBusy = true;
  try{
    recording = recordVoice(setRecLabel);
    const { q, meta } = await recording.done;
    loadSignal('voce', q, meta, 'Voce registrata · il volume della frase modella il vaso');
  }catch(err){ console.error(err); toast('Voce non caricata · ' + err.message); }
  finally{ recording = null; recBusy = false; setRecLabel('Registra · max 10 s', false); }
});

/* ====================== strumenti della scena ====================== */
const bindTool = (id, action, event, invert = false) => {
  $(id).addEventListener('click', action);
  if (event) stage.on(event, v => {
    const on = invert ? !v : v;
    $(id).classList.toggle('on', on);
    $(id).setAttribute('aria-pressed', String(on));
  });
};
bindTool('tSpin', () => stage.toggleAutoRotate(), 'spin');
bindTool('tView', () => stage.resetView());
bindTool('tCut',  () => stage.toggleCut(), 'cut');
bindTool('tFlat', () => stage.toggleSmooth(), 'smooth', true);

$('tShot').addEventListener('click', async () => {
  const blob = await stage.snapshot();
  saveBlob(blob, `vortice-${library.name.replace(/\s+/g, '-').toLowerCase() || 'anteprima'}.png`);
  const f = $('flash');
  f.classList.add('go'); void f.offsetWidth; f.classList.remove('go');
  toast('Screenshot salvato');
});

$('tLink').addEventListener('click', async () => {
  writeHash();
  const url = location.origin + location.pathname + '#' + encodeState(model.getState());
  try{ await navigator.clipboard.writeText(url); toast('Link del design copiato'); }
  catch{ toast('Copia non riuscita · usa l\'indirizzo nella barra'); }
});

/* ====================== export ====================== */
let format = 'stl';
$('segFmt').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  format = b.dataset.f;
  setActive('segFmt', 'f', format);
  $('fmtNote').hidden = format !== '3mf';
  syncPieceUI();
}));

async function withBusy(btn, label, fn){
  if (btn.classList.contains('busy')) return;
  const span = btn.querySelector('span');
  const original = span.textContent;
  btn.classList.add('busy');
  btn.setAttribute('aria-busy', 'true');
  span.textContent = label;
  try{ await fn(); }
  catch(err){ console.error(err); toast('Errore: ' + (err.message || err)); }
  finally{
    btn.classList.remove('busy');
    btn.removeAttribute('aria-busy');
    span.textContent = original;
  }
}

/** Codice da incidere: quello di produzione se pubblicato, altrimenti l'impronta. */
const serial = () => library?.current?.code ?? null;

$('dl').addEventListener('click', () => withBusy($('dl'), 'Genero e verifico…', async () => {
  model.profBlend = 1;           // niente dissolvenze a metà nell'STL
  pending = true;
  const code = serial() || model.fingerprint();
  const job = jobFor(model, 'vessel', { format, serial: code });
  const r = await runJob(job);
  if (!r.ok){ console.error(r.check || r.error); toast('File non salvato · ' + r.error); return; }

  saveBlob(new Blob([r.buffer], { type: r.format === '3mf' ? 'model/3mf' : 'model/stl' }),
    fileNameFor(model, r, code));

  const warn = r.tilt > 45 ? ` — attenzione: pareti a ${r.tilt.toFixed(0)}°` : '';
  const sn = job.kind !== 'plate' && job.logo.on && job.logo.serial && !r.serialOk
    ? ' · codice NON inciso (non entra)' : '';
  const what = job.kind === 'plate'
    ? `${it(r.tris)} triangoli · ${Math.ceil(r.plate.W)} × ${Math.ceil(r.plate.D)} mm sul piatto`
    : `mesh chiusa · parete ${r.minWall.toFixed(2)} mm · profondità ${Math.round(r.depth)} mm`;
  toast(`${job.kind === 'plate' ? 'Set (2 pezzi)' : PIECE_NAMES[model.piece]} ${code} · ` +
        `${r.format === '3mf' ? '3MF' : 'STL'} ${fmtBytes(r.buffer.byteLength)} · ${what}${sn}${warn}`);
}));

$('dlTest').addEventListener('click', () => withBusy($('dlTest'), 'Genero lo spool…', async () => {
  const job = jobFor(model, 'ring', { format, serial: serial() });
  const r = await runJob(job);
  if (!r.ok){ console.error(r.check || r.error); toast('File non salvato · ' + r.error); return; }
  const three = r.format === '3mf';
  saveBlob(new Blob([r.buffer], { type: three ? 'model/3mf' : 'model/stl' }),
    `vortice-spool-prova_T${job.P.thD.toFixed(1)}mm-P${job.P.pitch.toFixed(1)}.${three ? '3mf' : 'stl'}`);
  toast(`Spool di prova · ${it(r.check.tris)} triangoli · avvita la pompa reale sopra`);
}));

/* ====================== progettazione inversa ====================== */
let goal = 'fid', searchScope = 0;
$('segGoal').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  goal = b.dataset.g; setActive('segGoal', 'g', goal);
}));
$('segScope').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
  searchScope = +b.dataset.x; setActive('segScope', 'x', b.dataset.x);
}));
const numOr0 = id => { const v = +$(id).value; return Number.isFinite(v) && v > 0 ? v : 0; };

function applyFound(res){
  Object.assign(model.tgt, res.v);
  model.setProfile(res.prof);
  setActive('segProfile', 'prof', res.prof);
  setActivePreset('custom');
  syncSliders();
  model.rebuildLogoRaster(serial());
  pending = true;
  toast(`Design applicato · ${Math.round(res.exact.capML)} ml · ${Math.round(res.exact.grams)} g · ${(res.exact.minutes/60).toFixed(1)} h`);
}

function renderFound(r, opt){
  const box = $('findRes');
  box.textContent = '';
  if (!r.results?.length){
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Nessun candidato trovato';
    box.append(p);
    return;
  }
  for (const res of r.results){
    const b = document.createElement('button');
    b.type = 'button';
    b.className = res.ok ? '' : 'ko';
    const e = res.exact;
    const bits = [`${Math.round(e.capML)} ml`, `${Math.round(e.grams)} g`, `${(e.minutes/60).toFixed(1)} h`,
                  `h ${Math.round(e.Ht)} mm`, `pareti ${e.tilt.toFixed(0)}°`];
    if (opt.plate) bits.push(e.fits ? `set ${e.layout}` : 'non entra nel piatto');
    if (res.sig) bits.push(`segnale ${Math.round(res.sig.corr * 100)}% · ${Math.round(res.sig.A * 100)}%`);
    if (res.engrave === 0) bits.push('firma non entra nel fondo');
    else if (res.engrave < 1) bits.push('codice non entra nel fondo');

    const head = document.createElement('b');
    head.textContent = `${res.prof} · h ${res.v.h} · r ${res.v.r} · ${res.v.petals} costole · ${res.v.twist}° · aff. ${Math.round(res.v.sharp*100)}%`;
    const sub = document.createElement('i');
    sub.textContent = bits.join(' · ') + (res.ok ? '' : ' · ' + res.bad.join(' · '));
    b.append(head, document.createElement('br'), sub);
    b.addEventListener('click', () => applyFound(res));
    box.append(b);
  }
}

$('findBtn').addEventListener('click', () => withBusy($('findBtn'), 'Cerco…', async () => {
  const opt = { goal, plate: !!searchScope, piece: model.piece,
    capMin: numOr0('cMin'), hMax: numOr0('cH'), tMax: numOr0('cT'), gMax: numOr0('cG'),
    logo: { ...model.logo, serial: model.logo.sn ? (serial() || model.fingerprint()) : '' } };
  if (goal === 'fid' && !model.sigActive)
    toast('Senza segnale la fedeltà non si applica: cerco la capacità massima');
  const t0 = performance.now();
  const r = await runJob({ kind:'search', P:{ ...model.tgt }, profKey: model.profKey, opt });
  if (!r?.ok){ toast('Ricerca non riuscita · ' + (r?.error || 'errore')); return; }
  renderFound(r, opt);
  const ok = r.results.filter(x => x.ok).length;
  toast(`${it(r.evals)} combinazioni in ${((performance.now()-t0)/1000).toFixed(1)} s · ` +
    (ok ? `${ok} design entro i limiti` : 'nessuno entro i limiti: i migliori compromessi sotto'));
}));

/* ====================== stato nell'indirizzo ====================== */
let lastHash = '';
function writeHash(){
  const enc = encodeState(model.getState());
  if (enc === lastHash) return;
  lastHash = enc;
  const url = new URL(location.href);
  url.hash = enc;
  history.replaceState(null, '', url);
}

/** Riallinea tutta l'interfaccia al modello. */
function syncAll(){
  syncSliders();
  setActive('segProfile', 'prof', model.profKey);
  $('logoTxt').value = model.logo.text;
  setActive('segLogo', 'l', model.logo.on ? 'on' : 'off');
  setActive('segArc', 'a', model.logo.arc ? 'arc' : 'line');
  setActive('segSN', 's', model.logo.sn ? 'on' : 'off');
  syncThreadSeg(currentThreadKey());
  const preset = Object.keys(PRESETS).find(k => {
    const p = PRESETS[k];
    return p.h === model.tgt.h && p.r === model.tgt.r && p.petals === model.tgt.petals
        && p.twist === model.tgt.twist && Math.abs(p.sharp - model.tgt.sharp) < 1e-6
        && p.profile === model.profKey;
  }) || 'custom';
  setActivePreset(preset);
  syncSigUI();
  syncPieceUI();
}

function applyState(state, animate){
  model.applyState(state, animate);
  model.rebuildLogoRaster(serial());
  syncAll();
  pending = true;
}

/* ====================== libreria ====================== */
const library = new Library({
  currentState: () => encodeState(model.getState()),
  onOpen: design => {
    if (design) applyState(decodeState(design.state) || defaultState(), true);
    else applyState(defaultState(), true);
    lastHash = encodeState(model.getState());
    writeHash();
  },
});

$('saveBtn').addEventListener('click', () => library.save());

$('pubBtn').addEventListener('click', () => withBusy($('pubBtn'), 'Pubblico…', async () => {
  const m = model.metrics;
  if (m && !m.ok && !confirm(
      'Questo design ha degli avvisi:\n\n· ' + m.issues.join('\n· ') +
      '\n\nPubblicarlo comunque?')) return;

  const preview = await stage.snapshot().catch(() => null);
  const design = await library.publish({
    preview,
    meta: m && {
      capML: m.capML, grams: m.grams, minutes: m.seconds / 60,
      height: m.height, diameter: m.diameter, tilt: m.tilt, tris: m.tris,
      piece: model.plateMode ? 'plate' : model.piece,
    },
  });
  if (!design) return;
  /* da ora il pezzo porta inciso il codice di produzione, non più l'impronta */
  model.setSerial(design.code);
  pending = true;
  toast(`Pubblicato con il codice ${design.code} · il codice è ora inciso sul fondo`);
}));

$('unpubBtn').addEventListener('click', async () => {
  await library.unpublish();
  model.setSerial(serial());
  pending = true;
});

$('pubCopy').addEventListener('click', async () => {
  const url = location.origin + `/p/${library.current.code}`;
  try{ await navigator.clipboard.writeText(url); toast('Link pubblico copiato'); }
  catch{ toast('Copia non riuscita'); }
});

$('docName').addEventListener('input', () => library.refreshBadge());

/* il codice inciso e il badge «salvato» seguono qualunque modifica,
   anche quelle fatte dai preset o dalla ricerca inversa */
setInterval(() => {
  writeHash();
  const code = serial() || model.fingerprint();
  if ($('vSN').textContent !== code) $('vSN').textContent = code;
  if (model.logo.on && model.logo.sn && model.logo.serial !== code){
    model.rebuildLogoRaster(serial());
    pending = true;
  }
  library.refreshBadge();
}, 400);

window.addEventListener('beforeunload', e => {
  if (library.dirty && library.current) e.preventDefault();
});

/* ====================== avvio ====================== */
$('segThread').querySelectorAll('button').forEach(x =>
  x.classList.toggle('active', x.dataset.t === THREAD_DEFAULT));

await (async () => {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (id){
    try{ await library.open(id); return; }
    catch{ toast('Creazione non trovata: apro un design nuovo'); }
  }
  const fromHash = location.hash ? decodeState(location.hash) : null;
  applyState(fromHash || defaultState(), false);
  lastHash = encodeState(model.getState());
  if (location.hash && !fromHash) toast('Link non riconosciuto · caricato il design predefinito');
  else if (fromHash) toast('Design caricato dal link');
})();

await library.reload();
syncAll();
rebuild(true);
setTimeout(() => toast('Suggerimento: orbita SOTTO il vaso per leggere la firma incisa sul fondo'), 3000);
