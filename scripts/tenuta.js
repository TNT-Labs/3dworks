/* Analisi di tenuta ai liquidi di un design, misurata sulla geometria vera.
   Non stima: costruisce la stessa mesh dell'export e misura i tre spessori da
   cui dipende la tenuta di un vaso stampato in FDM.

     node scripts/tenuta.js                      i quattro preset
     node scripts/tenuta.js "v=1&h=185&r=62&…"   un design (lo stato del link)
     node scripts/tenuta.js --larghezza 0.45     con un'altra larghezza di estrusione

   La domanda a cui risponde: in ogni strato, la parete è abbastanza larga
   perché il slicer ci faccia stare un numero intero di perimetri? Dove non lo
   è, resta una fessura che nessuna impostazione di stampa chiude. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { defaultState, decodeState, PRESETS, RANGES } from '../public/js/design-spec.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* vcore.js è uno script classico che si appende a `self`: lo carichiamo in un
   contesto isolato invece di importarlo, così resta un file solo per pagina,
   Worker e questo strumento. */
function loadVCore(){
  const sandbox = { self: {}, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(join(ROOT, 'public', 'js', 'vcore.js'), 'utf8'), sandbox);
  return sandbox.self.VCore;
}
const V = loadVCore();

/* Quante passate di estrusione stanno nella larghezza della parete.
   È la misura che decide la tenuta di un vaso in FDM:
     < 2   nemmeno un perimetro esterno e uno interno: il slicer ci mette un
           filo solo o rinuncia, e il liquido passa;
     2–3   due perimetri che si toccano, nessun margine: basta una passata
           sotto-estrusa in un punto per aprire una via;
     ≥ 3   c'è un perimetro di mezzo che fa da tappo anche se gli altri due
           hanno un difetto.
   Con il generatore Arachne (PrusaSlicer 2.6+, OrcaSlicer) la larghezza delle
   singole passate si adatta e i valori non interi non lasciano fessure; con il
   generatore classico conviene che la parete sia un multiplo della larghezza. */
const SOGLIA_MIN = 2, SOGLIA_SICURA = 3;
/* i vertici sono Float32: 0,90 mm su 0,45 può leggersi 1,9998 passate e non
   deve diventare una bocciatura. Due centesimi di passata di tolleranza. */
const TOLL = .02;
const passate = (mm, larghezza) => mm / larghezza;

export function analizza(state, { larghezza = .4, layer = .2 } = {}){
  const P = { ...state.P, piece: state.piece,
    amp: state.sig?.on ? state.sig.amp : 0,
    sig: state.sig?.on ? { kind: state.sig.src === 'voce' ? 'ring' : 'prof', q: state.sig.q,
                           smooth: state.sig.smooth, rev: state.sig.rev, inv: state.sig.inv } : null };
  const logo = { ...state.logo };
  const raster = V.buildLogoRaster(logo, V.targetR95(P, state.profile));
  const ctx = V.makeExportCtx(P, state.profile, raster, logo.depth);
  const rows = ctx.zs.length, nTh = ctx.nTh, jB = ctx.jB;
  const pos = new Float32Array(V.vesselVerts(rows, nTh, jB, ctx.K, ctx.nD) * 3);
  const st = V.fillVessel(pos, ctx);
  const ind = V.vesselIndex(rows, nTh, jB, ctx.K, ctx.nD);
  const mesh = V.validateMesh(pos, ind, st.solidV + st.wallV);

  const R = k => Math.hypot(pos[k*3], pos[k*3+1]);

  /* parete: spessore ORIZZONTALE, che è quello che il slicer vede nel piano di
     ogni strato. Lo spessore perpendicolare alla superficie è minore (conta per
     la resistenza, non per la tenuta). */
  let min = Infinity, minZ = 0, hSottile = 0, hCritica = 0, prevZ = null;
  const perFascia = [];
  for (let j = jB; j < rows; j++){
    const z = ctx.zs[j];
    if (z > P.h) break;                                   // il collo si misura a parte
    let rigaMin = Infinity;
    for (let i = 0; i < nTh; i++)
      rigaMin = Math.min(rigaMin, R(j*nTh + i) - R(rows*nTh + (j - jB)*nTh + i));
    if (rigaMin < min){ min = rigaMin; minZ = z; }
    const np = passate(rigaMin, larghezza);
    if (prevZ != null){
      if (np < SOGLIA_SICURA - TOLL) hSottile += z - prevZ;
      if (np < SOGLIA_MIN - TOLL)    hCritica += z - prevZ;
    }
    prevZ = z;
    perFascia.push([z, rigaMin]);
  }

  /* fondo: quota del pavimento della cavità meno la massima profondità incisa */
  const floorZ = P.h * V.exportFloorRow(P.h) / (V.PE.nB - 1);
  const inciso = !!(raster && raster.ok);
  const fondo = floorZ - (inciso ? logo.depth : 0);

  const n = V.neckSpec(P);
  return {
    mesh, P, profilo: state.profile,
    parete: { nominale: P.w, minima: min, z: minZ,
              passate: passate(min, larghezza), altezzaSottile: hSottile, altezzaCritica: hCritica,
              perFascia },
    fondo: { totale: floorZ, inciso, residuo: fondo, strati: Math.floor(fondo / layer) },
    collo: n.open ? null : { parete: n.rootR - n.neckBoreR, creste: n.crestR*2, fondo: n.rootR*2,
                             foro: n.neckBoreR*2, tenuta: n.rootR - n.neckBoreR, giri: P.turns, passo: P.pitch },
    inclinazione: Math.atan(st.maxW) * 180 / Math.PI,
    passaggio: st.minRi * 2,
    capacita: st.capV / 1000,
  };
}

/* ------------------------------ presentazione ------------------------------ */
const g = s => `\x1b[32m${s}\x1b[0m`, r = s => `\x1b[31m${s}\x1b[0m`, y = s => `\x1b[33m${s}\x1b[0m`;
const esito = (ok, warn) => ok ? g('passa') : warn ? y('limite') : r('non passa');

function stampa(nome, a, larghezza){
  const np = a.parete.passate;
  const pareteOk = np >= SOGLIA_SICURA - TOLL;
  const pareteLimite = np >= SOGLIA_MIN - TOLL;
  console.log(`\n${nome}`);
  console.log(`  ${a.P.h}×Ø${a.P.r*2} mm · parete ${a.P.w} · costole ${a.P.petals}×${a.P.sharp} · torsione ${a.P.twist}°`
    + ` · ${a.profilo} · ≈${a.capacita.toFixed(0)} ml`);
  console.log(`  mesh          ${a.mesh.ok ? g('chiusa') : r(a.mesh.errors.join('; '))}`
    + ` · ${a.mesh.tris.toLocaleString('it-IT')} triangoli`);
  console.log(`  fondo         ${esito(a.fondo.residuo >= 1.5)} · ${a.fondo.residuo.toFixed(2)} mm pieni`
    + ` sotto l'incisione (${a.fondo.strati} strati)`);
  console.log(`  parete corpo  ${esito(pareteOk, pareteLimite)} · minimo ${a.parete.minima.toFixed(2)} mm`
    + ` a z=${a.parete.z.toFixed(0)} mm = ${np.toFixed(1)} passate da ${larghezza}`
    + ` (nominale ${a.parete.nominale} = ${(a.parete.nominale/larghezza).toFixed(1)})`);
  if (a.parete.altezzaSottile > 0)
    console.log(`                fascia sotto ${SOGLIA_SICURA} passate: ${y(a.parete.altezzaSottile.toFixed(0) + ' mm')}`
      + ` di altezza, in spalla`
      + (a.parete.altezzaCritica > 0 ? ` · sotto ${SOGLIA_MIN}: ${r(a.parete.altezzaCritica.toFixed(0) + ' mm')}` : ''));
  if (a.collo)
    console.log(`  collo         ${esito(a.collo.parete >= 2)} · parete ${a.collo.parete.toFixed(1)} mm`
      + ` · T Ø${a.collo.creste.toFixed(1)} · E Ø${a.collo.fondo.toFixed(1)} · foro Ø${a.collo.foro.toFixed(1)}`
      + ` · battuta di tenuta ${a.collo.tenuta.toFixed(1)} mm`);
  console.log(`  inclinazione  ${esito(a.inclinazione <= 45, a.inclinazione <= 50)} · ${a.inclinazione.toFixed(0)}° massimi`
    + (a.inclinazione > 45 ? ' — servirebbero supporti, impossibili dentro la cavità' : ''));
}

/* ------------------------------ riga di comando ------------------------------ */
const argv = process.argv.slice(2);
const iL = argv.findIndex(x => x === '--larghezza' || x === '-l');
const larghezza = iL >= 0 ? Number(argv[iL + 1]) : .4;
if (!(larghezza > .1 && larghezza < 1)){
  console.error('--larghezza vuole la larghezza di estrusione in mm, per esempio 0.4');
  process.exit(1);
}
const link = (iL >= 0 ? argv.filter((x, i) => i !== iL && i !== iL + 1) : argv)
  .find(x => !x.startsWith('-'));

console.log(`Tenuta ai liquidi · larghezza di estrusione ${larghezza} mm, strato 0,2 mm`);
console.log('La parete passa se i perimetri la riempiono senza lasciare fessure.');

if (link){
  const s = decodeState(link);
  if (!s){
    console.error('\nStato del design illeggibile: incolla la parte dopo il # del link dello studio.');
    process.exit(1);
  }
  stampa('design dal link', analizza(s, { larghezza }), larghezza);
} else {
  for (const [nome, pre] of Object.entries(PRESETS)){
    const s = defaultState();
    Object.assign(s.P, { h:pre.h, r:pre.r, petals:pre.petals, twist:pre.twist, sharp:pre.sharp });
    s.profile = pre.profile;
    stampa(`preset · ${nome}`, analizza(s, { larghezza }), larghezza);
  }
  scansioneAffilatura(larghezza);
}

/* L'affilatura è il cursore che più mette alla prova la spalla: la conclusione
   va MISURATA a ogni esecuzione, non scritta qui una volta per tutte — una
   frase codificata a mano sopravvive alla correzione del difetto che descrive
   e finisce per raccontare il contrario del vero. */
function scansioneAffilatura(larghezza){
  const lim = RANGES.sharp;
  const lo = lim.min / lim.scale, hi = lim.max / lim.scale;
  console.log(`\nAffilatura da ${lo} a ${hi}, sul preset aureo · parete nominale e misurata:`);
  let peggiore = Infinity, peggioreA = null;
  for (let a = lo; a <= hi + 1e-9; a += (hi - lo) / 5){
    const s = defaultState();
    Object.assign(s.P, { h:PRESETS.aureo.h, r:PRESETS.aureo.r, petals:PRESETS.aureo.petals,
                         twist:PRESETS.aureo.twist, sharp:+a.toFixed(2) });
    s.profile = PRESETS.aureo.profile;
    const an = analizza(s, { larghezza });
    const np = an.parete.passate;
    if (an.parete.minima < peggiore){ peggiore = an.parete.minima; peggioreA = +a.toFixed(2); }
    console.log(`  affilatura ${a.toFixed(2)} → ${an.parete.minima.toFixed(2)} mm`
      + ` = ${np.toFixed(1)} passate da ${larghezza}`
      + `  ${np >= SOGLIA_SICURA - TOLL ? g('passa') : np >= SOGLIA_MIN - TOLL ? y('limite') : r('non passa')}`);
  }
  console.log(peggiore >= SOGLIA_SICURA * larghezza - TOLL
    ? `La spalla regge su tutta la corsa: minimo ${peggiore.toFixed(2)} mm con affilatura ${peggioreA}.`
    : `Attenzione: con affilatura ${peggioreA} la spalla scende a ${peggiore.toFixed(2)} mm.`);
}
