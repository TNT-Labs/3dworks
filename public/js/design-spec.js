/* =====================================================================
   DESIGN SPEC · unica fonte di verità per i parametri di un design.
   Usata IDENTICA dal browser (studio e viewer) e da Node (validazione API):
   i limiti degli slider, la serializzazione nel link e la validazione
   server-side non possono più divergere.

   Formato del link invariato rispetto alla V3 single-file:
   v=1&h=185&r=62&n=6&tw=60&sh=36&w=2.4&pf=clessidra&...
   I link già condivisi continuano quindi a funzionare.
   ===================================================================== */

export const STATE_V = '1';

/* profili in quota disponibili (devono combaciare con VCore.PROFILES) */
export const PROFILE_KEYS = ['clessidra', 'fiamma', 'tornado', 'bulbo'];

/* pezzi selezionabili; 'plate' non è un pezzo ma la vista "set sul piatto" */
export const PIECE_KEYS = ['disp', 'tooth'];
export const PIECE_MODES = [...PIECE_KEYS, 'plate'];

export const LOGO_MAX = 30;
export const SIG_N = 64;
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/* Ogni parametro vive in due spazi:
     · SLIDER — intero, quello dell'<input type=range> (min/max/step qui sotto)
     · STATO  — il valore reale usato dalla geometria = slider / scale
   Sul filo (query string del link) i parametri in percentuale viaggiano in
   spazio slider (sh=36), tutti gli altri in spazio stato (w=2.4): è il formato
   della V3 single-file e va conservato perché i link già condivisi funzionino.
   `pct: true` marca esattamente quei campi, così la conversione sta in un
   punto solo (fromWire/toWire) invece che sparsa nel codice. */
export const RANGES = {
  h:      { key:'h',      q:'h',   slider:'sH',  min:120, max:235, step:1, scale:1,   digits:0 },
  r:      { key:'r',      q:'r',   slider:'sR',  min:30,  max:100, step:1, scale:1,   digits:0 },
  petals: { key:'petals', q:'n',   slider:'sP',  min:3,   max:9,   step:1, scale:1,   digits:0 },
  twist:  { key:'twist',  q:'tw',  slider:'sT',  min:0,   max:360, step:5, scale:1,   digits:0 },
  sharp:  { key:'sharp',  q:'sh',  slider:'sS',  min:0,   max:100, step:1, scale:100, digits:2, pct:true },
  /* Parete: fino a 8 mm. Il tetto di 3,2 era il limite dei 4 perimetri fissi
     della ricetta; ora la ricetta segue la parete, quindi il limite vero e'
     quello del pezzo. Un guscio da 5-6 mm e' cio' che rende un vaso stampato
     robusto in mano invece che fragile appena nato. */
  w:      { key:'w',      q:'w',   slider:'sW',  min:20,  max:80,  step:1, scale:10,  digits:1 },
  thD:    { key:'thD',    q:'td',  slider:'sD',  min:180, max:320, step:1, scale:10,  digits:2 },
  pitch:  { key:'pitch',  q:'tp',  slider:'sP2', min:24,  max:50,  step:1, scale:10,  digits:2 },
  turns:  { key:'turns',  q:'tg',  slider:'sG',  min:10,  max:30,  step:5, scale:10,  digits:1 },
};

export const LOGO_RANGES = {
  size:  { key:'size',  q:'ls', slider:'sLS', min:40, max:100, step:1, scale:10, digits:1 },
  depth: { key:'depth', q:'ld', slider:'sLD', min:4,  max:12,  step:1, scale:10, digits:1 },
  rot:   { key:'rot',   q:'lr', slider:'sLR', min:0,  max:355, step:5, scale:1,  digits:0 },
};

export const SIG_RANGES = {
  amp:    { key:'amp',    q:'ga', slider:'sA', min:0, max:40,  step:1, scale:100, digits:2, pct:true },
  smooth: { key:'smooth', q:'gl', slider:'sL', min:0, max:100, step:1, scale:100, digits:2, pct:true },
};

export const PRESETS = {
  aureo:    { h:185, r:62, petals:6, twist:60, sharp:.36, profile:'clessidra' },
  tempesta: { h:225, r:58, petals:5, twist:70, sharp:.50, profile:'tornado'   },
  fiamma:   { h:170, r:66, petals:7, twist:70, sharp:.38, profile:'fiamma'    },
  marea:    { h:155, r:58, petals:9, twist:30, sharp:.28, profile:'bulbo'     },
};

export const THREAD_STD = {
  '24/410': { d:24.2, p:3.18, t:1.5 },
  '24/415': { d:24.2, p:3.18, t:2.0 },
  '28/410': { d:28.2, p:3.18, t:1.5 },
};
export const THREAD_DEFAULT = '28/410';
export const Z_MAX = 250;
export const BED = 220;

const TD = THREAD_STD[THREAD_DEFAULT];

/** Stato di default: il preset Aureo con il filetto standard. */
export function defaultState(){
  return {
    v: STATE_V,
    piece: 'disp',
    profile: PRESETS.aureo.profile,
    P: { h:PRESETS.aureo.h, r:PRESETS.aureo.r, petals:PRESETS.aureo.petals,
         twist:PRESETS.aureo.twist, sharp:PRESETS.aureo.sharp,
         w:2.4, thD:TD.d, pitch:TD.p, turns:TD.t },
    logo: { on:true, text:'Made by Umberto Molteni (2026)', size:7, depth:.8, arc:true, rot:0, sn:true },
    sig:  { on:false, src:'gpx', q:'', amp:.2, smooth:.15, rev:false, inv:false },
  };
}

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const round = (v, d) => d == null ? v : +v.toFixed(d);

/* Solo limiti e arrotondamento: NON aggancia allo step.
   Serve a conservare i valori che lo slider non sa esprimere ma che sono
   legittimi, come il passo GPI reale di 3,18 mm (lo slider va a passi di 0,1). */
function clampRaw(spec, sliderSpaceValue){
  return round(clamp(sliderSpaceValue, spec.min, spec.max) / spec.scale, spec.digits);
}

/** Valore prodotto da un <input type=range> → valore di stato (agganciato allo step). */
export function fromSlider(spec, sliderValue){
  const v = Number(sliderValue);
  if (!Number.isFinite(v)) return null;
  return clampRaw(spec, Math.round(v / spec.step) * spec.step);
}

/** Valore di stato → posizione dello slider (intero dentro min/max). */
export const toSlider = (spec, stateValue) =>
  clamp(Math.round(stateValue * spec.scale), spec.min, spec.max);

/** Valore letto dal link → valore di stato validato. null se illeggibile. */
export function fromWire(spec, raw){
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return clampRaw(spec, spec.pct ? v : v * spec.scale);
}

/** Valore di stato → valore da scrivere nel link. */
export const toWire = (spec, stateValue) =>
  spec.pct ? Math.round(stateValue * spec.scale) : round(stateValue, spec.digits);

/** Riporta un valore di stato dentro i limiti della sua spec. */
export function clampState(spec, stateValue){
  const v = Number(stateValue);
  return Number.isFinite(v) ? clampRaw(spec, v * spec.scale) : null;
}

export const sigValid = q => {
  if (typeof q !== 'string' || q.length !== SIG_N) return false;
  for (const c of q) if (B64U.indexOf(c) < 0) return false;
  return true;
};

/* ============================ serializzazione ============================ */

/** Stato canonico → query string del link (formato v1, retrocompatibile). */
export function encodeState(s){
  const q = new URLSearchParams();
  const { P, logo, sig } = s;
  const put = (spec, src) => q.set(spec.q, toWire(spec, src[spec.key]));
  q.set('v', STATE_V);
  for (const spec of Object.values(RANGES)) put(spec, P);
  q.set('pf', s.profile);
  q.set('lo', logo.on ? 1 : 0);
  q.set('lt', logo.text);
  for (const spec of Object.values(LOGO_RANGES)) put(spec, logo);
  q.set('la', logo.arc ? 1 : 0);
  if (sig && sig.on && sig.q){
    q.set('gs', sig.src === 'voce' ? 'v' : 'g');
    q.set('gq', sig.q);
    for (const spec of Object.values(SIG_RANGES)) put(spec, sig);
    q.set('gr', sig.rev ? 1 : 0);
    q.set('gi', sig.inv ? 1 : 0);
  }
  q.set('sn', logo.sn ? 1 : 0);
  q.set('pc', s.piece);
  return q.toString();
}

/**
 * Query string → stato canonico completo, con ogni valore riportato nei limiti.
 * Ritorna null solo se la versione non combacia: tutto il resto viene sanato,
 * così un link storpiato non manda in errore l'app né sporca il database.
 */
export function decodeState(str){
  const q = new URLSearchParams(String(str || '').replace(/^[#?]/, ''));
  if (q.get('v') !== STATE_V) return null;
  const s = defaultState();
  const take = (spec, target) => {
    if (!q.has(spec.q)) return;
    const v = fromWire(spec, q.get(spec.q));
    if (v !== null) target[spec.key] = v;
  };
  for (const spec of Object.values(RANGES)) take(spec, s.P);
  if (PROFILE_KEYS.includes(q.get('pf'))) s.profile = q.get('pf');
  if (q.has('lo')) s.logo.on = q.get('lo') === '1';
  if (q.has('lt')) s.logo.text = sanitizeText(q.get('lt'));
  for (const spec of Object.values(LOGO_RANGES)) take(spec, s.logo);
  if (q.has('la')) s.logo.arc = q.get('la') === '1';
  /* sn assente = link anteriore al codice inciso: non incidere, così la
     geometria di quei link resta esattamente quella originale */
  s.logo.sn = q.get('sn') === '1';
  s.piece = PIECE_MODES.includes(q.get('pc')) ? q.get('pc') : 'disp';
  const gq = q.get('gq');
  if (gq && sigValid(gq)){
    s.sig = { on:true, src: q.get('gs') === 'v' ? 'voce' : 'gpx', q:gq,
              rev: q.get('gr') === '1', inv: q.get('gi') === '1', amp:.2, smooth:.15 };
    for (const spec of Object.values(SIG_RANGES)) take(spec, s.sig);
  }
  return s;
}

/** Ripulisce il testo inciso: niente controlli, niente a capo, lunghezza massima. */
export function sanitizeText(t){
  // eslint-disable-next-line no-control-regex
  return String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, LOGO_MAX);
}

/** Normalizza qualunque input a uno stato valido, passando dal round-trip.
    Accetta stati parziali: i rami mancanti prendono il valore di default. */
export function normalizeState(input){
  const d = defaultState();
  if (!input || typeof input !== 'object') return d;
  const s = {
    v: STATE_V,
    piece: input.piece ?? d.piece,
    profile: input.profile ?? d.profile,
    P:    { ...d.P,    ...(input.P    && typeof input.P    === 'object' ? input.P    : null) },
    logo: { ...d.logo, ...(input.logo && typeof input.logo === 'object' ? input.logo : null) },
    sig:  { ...d.sig,  ...(input.sig  && typeof input.sig  === 'object' ? input.sig  : null) },
  };
  s.logo.text = sanitizeText(s.logo.text);
  if (!PROFILE_KEYS.includes(s.profile)) s.profile = d.profile;
  if (!PIECE_MODES.includes(s.piece)) s.piece = d.piece;
  if (!sigValid(s.sig.q)) s.sig = { ...d.sig };
  for (const [ranges, obj] of [[RANGES, s.P], [LOGO_RANGES, s.logo], [SIG_RANGES, s.sig]])
    for (const spec of Object.values(ranges)){
      const v = clampState(spec, obj[spec.key]);
      obj[spec.key] = v === null ? d[obj === s.P ? 'P' : obj === s.logo ? 'logo' : 'sig'][spec.key] : v;
    }
  for (const k of ['on', 'arc', 'sn']) s.logo[k] = !!s.logo[k];
  s.sig.on = !!s.sig.on && !!s.sig.q;
  s.sig.src = s.sig.src === 'voce' ? 'voce' : 'gpx';
  s.sig.rev = !!s.sig.rev; s.sig.inv = !!s.sig.inv;
  return decodeState(encodeState(s)) || d;
}

/* ======================= impronta del design ======================= */
/* FNV-1a 32 bit sullo stato canonico (escluso l'interruttore del codice e il
   pezzo scelto: l'impronta è del SET). 25 bit in base32 Crockford — niente
   I L O U, quindi nessuna ambiguità con 1 e 0 quando si legge dal fondo. */
export const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function designFingerprint(state){
  const q = new URLSearchParams(encodeState(state));
  q.delete('sn'); q.delete('pc');
  const str = q.toString();
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  let c = '';
  for (let k = 0; k < 5; k++) c += B32[(h >>> (k * 5)) & 31];
  return 'VRT-' + c;
}

/** Normalizza un codice digitato a mano: maiuscole, O→0, I/L→1, prefisso opzionale. */
export function normCode(raw){
  let c = String(raw ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (c.startsWith('VRT')) c = c.slice(3);
  c = c.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  return /^[0-9A-HJKMNP-TV-Z]{5}$/.test(c) ? 'VRT-' + c : null;
}
