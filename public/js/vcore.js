/* =====================================================================
   VCORE · geometria pura, senza DOM né Three.js.
   Unica fonte di verità per la forma: lo stesso file viene caricato
     (1) dalla pagina come <script> classico, che espone window.VCore;
     (2) dal Web Worker dell'export, come `new Worker('/js/vcore.js')`.
   Nella V3 single-file il Worker nasceva da un Blob col testo dello
   script: ora è un file vero, quindi la CSP non ha bisogno di deroghe
   e il browser lo mette in cache una volta sola.
   Nessuna dipendenza da stato globale: tutto entra per parametro.
   ===================================================================== */
(function(G){
'use strict';
const TAU = Math.PI * 2;
const sstep = x => x <= 0 ? 0 : x >= 1 ? 1 : x*x*(3 - 2*x);
const clamp = (v,a,b) => v < a ? a : v > b ? b : v;

/* ================= profili in quota e preset ================= */
const PROFILES = {
  clessidra: t => 1 - .34 * Math.exp(-(((t - .46) / .21) ** 2)) - .22 * t,
  fiamma:    t => .30 + .70 * Math.pow(1 - t, .62),
  tornado:   t => .40 + .60 * Math.pow(t, .85),
  bulbo:     t => .52 + .50 * Math.exp(-(((t - .34) / .30) ** 2)) - .18 * t,
};

/* Font a tratto singolo: glifi in corpi [0..1] (baseline 0, capitale 1). */
const GLYPHS = {
  'A':{w:.72,g:[[[0,0],[.5,1],[1,0]],[[.18,.42],[.82,.42]]]},
  'B':{w:.62,g:[[[0,0],[0,1]],[[0,1],[.45,1],[.62,.84],[.45,.66],[0,.66]],[[0,.66],[.5,.66],[.68,.33],[.45,0],[0,0]]]},
  'C':{w:.7,g:[[[.8,.9],[.5,1],[.15,.85],[0,.5],[.15,.15],[.5,0],[.8,.1]]]},
  'D':{w:.68,g:[[[0,0],[0,1]],[[0,1],[.5,1],[.72,.7],[.72,.3],[.5,0],[0,0]]]},
  'E':{w:.55,g:[[[1,1],[0,1],[0,0],[1,0]],[[0,.55],[.68,.55]]]},
  'F':{w:.55,g:[[[1,1],[0,1],[0,0]],[[0,.55],[.68,.55]]]},
  'G':{w:.72,g:[[[.82,.88],[.55,1],[.2,.95],[0,.6],[0,.4],[.2,.08],[.55,0],[.8,.12],[.8,.35],[.5,.35]]]},
  'H':{w:.7,g:[[[0,0],[0,1]],[[1,0],[1,1]],[[0,.55],[1,.55]]]},
  'I':{w:.5,g:[[[0,1],[.5,1]],[[.25,1],[.25,0]],[[0,0],[.5,0]]]},
  'J':{w:.6,g:[[[.6,1],[.6,.25],[.45,.05],[.2,0],[.05,.1]]]},
  'K':{w:.65,g:[[[0,0],[0,1]],[[.95,1],[.05,.5],[1,0]]]},
  'L':{w:.55,g:[[[0,1],[0,0],[.9,0]]]},
  'M':{w:1,g:[[[0,0],[0,1],[.5,.6],[1,1],[1,0]]]},
  'N':{w:.85,g:[[[0,0],[0,1],[1,0],[1,1]]]},
  'O':{w:.8,g:[[[.5,1],[.85,.85],[1,.5],[.85,.15],[.5,0],[.15,.15],[0,.5],[.15,.85],[.5,1]]]},
  'P':{w:.6,g:[[[0,0],[0,1]],[[0,1],[.55,1],[.7,.8],[.55,.6],[0,.6]]]},
  'Q':{w:.8,g:[[[.5,1],[.85,.85],[1,.5],[.85,.15],[.5,0],[.15,.15],[0,.5],[.15,.85],[.5,1]],[[.65,.3],[.98,.02]]]},
  'R':{w:.62,g:[[[0,0],[0,1]],[[0,1],[.55,1],[.7,.8],[.55,.6],[0,.6]],[[.4,.62],[1,0]]]},
  'S':{w:.65,g:[[[.85,.9],[.55,1],[.2,.95],[.05,.75],[.25,.55],[.65,.45],[.9,.3],[.85,.08],[.5,0],[.15,.1]]]},
  'T':{w:.8,g:[[[0,1],[1,1]],[[.5,1],[.5,0]]]},
  'U':{w:.85,g:[[[0,1],[0,.25],[.2,.05],[.5,0],[.8,.05],[1,.25],[1,1]]]},
  'V':{w:.8,g:[[[0,1],[.5,0],[1,1]]]},
  'W':{w:1,g:[[[0,1],[.25,0],[.5,.55],[.75,0],[1,1]]]},
  'X':{w:.8,g:[[[0,0],[1,1]],[[0,1],[1,0]]]},
  'Y':{w:.8,g:[[[0,1],[.5,.5]],[[1,1],[.5,.5]],[[.5,.5],[.5,0]]]},
  'Z':{w:.72,g:[[[0,1],[1,1],[0,0],[1,0]]]},
  '0':{w:.62,g:[[[.5,1],[.85,.85],[1,.5],[.85,.15],[.5,0],[.15,.15],[0,.5],[.15,.85],[.5,1]]]},
  '1':{w:.55,g:[[[.2,.85],[.5,1],[.5,0]],[[.15,0],[.85,0]]]},
  '2':{w:.62,g:[[[.1,.8],[.35,1],[.7,.95],[.9,.7],[.75,.45],[.3,.2],[0,0],[.95,0]]]},
  '3':{w:.62,g:[[[.05,1],[.85,1],[.4,.55],[.8,.5],[.95,.3],[.8,.05],[.4,0],[.05,.12]]]},
  '4':{w:.62,g:[[[.65,1],[0,.3],[.95,.3]],[[.65,1],[.65,0]]]},
  '5':{w:.62,g:[[[.95,1],[.15,1],[.1,.55],[.5,.5],[.85,.35],[.95,.12],[.7,0],[.2,0],[.05,.1]]]},
  '6':{w:.62,g:[[[.85,.9],[.55,1],[.25,.85],[.1,.5],[.15,.2],[.4,.02],[.65,.05],[.85,.2],[.8,.45],[.5,.55],[.15,.5]]]},
  '7':{w:.62,g:[[[0,1],[1,1],[.35,0]]]},
  '8':{w:.62,g:[[[.5,1],[.8,.85],[.65,.66],[.5,.6],[.35,.66],[.2,.85],[.5,1]],[[.5,.6],[.85,.48],[1,.28],[.8,.06],[.5,0],[.2,.06],[0,.28],[.15,.48],[.5,.6]]]},
  '9':{w:.62,g:[[[.15,.1],[.45,0],[.75,.15],[.9,.5],[.85,.8],[.6,.98],[.35,.95],[.15,.8],[.2,.55],[.5,.45],[.85,.5]]]},
  '.':{w:.3,g:[[[.5,.08],[.5,0]]]},
  '-':{w:.55,g:[[[.1,.5],[.9,.5]]]},
  "'":{w:.25,g:[[[.5,.72],[.42,1]]]},
  '!':{w:.3,g:[[[.5,1],[.5,.3]],[[.5,.08],[.5,0]]]},
  '&':{w:.8,g:[[[1,.05],[.3,.72],[.42,1],[.68,.9],[.12,.25],[0,.08],[.22,0],[.55,.2],[1,.65]]]},
};
const TRACK = .34;

/* layoutLogo: sviluppa il testo in segmenti normalizzati su r95 (u,v ∈ [-1..1]).
   CORRETTO: la lunghezza del testo (corpi) viene prima convertita in unità
   normalizzate con sN = size/r95, poi in angolo sull'arco. Nella versione
   precedente la conversione mancava e il default veniva scartato (fit≈0,14). */
function layoutLogo(logo, r95){
  const text = logo.text.toUpperCase();
  const segs = [];
  let rMinN = 1e9, rMaxN = -1e9;
  let dev = 0;
  for (const ch of text){ const g = GLYPHS[ch]; dev += (g ? g.w : .5) + TRACK; }
  dev = Math.max(.1, dev - TRACK);
  const sN = logo.size / r95;
  const ROT = logo.rot * Math.PI / 180;
  let fit;
  if (logo.arc){
    const RARC = .72;                        // raggio arco (normalizzato)
    const avail = 5.2;                       // ampiezza massima ~300°
    fit = Math.min(1, avail * RARC / (dev * sN));
    const thC = Math.PI / 2 + ROT;
    let acc = 0;
    for (const ch of text){
      const g = GLYPHS[ch]; if (!g){ acc += (.5 + TRACK) * fit; continue; }
      for (const poly of g.g){
        let prev = null;
        for (const [u, v] of poly){
          const s = (acc + u * fit - dev * fit / 2) * sN;   // arco dal centro testo
          const th = thC - s / RARC;
          const rr = RARC - v * fit * sN;                   // alto lettera verso il centro
          const X = rr * Math.cos(th), Y = rr * Math.sin(th);
          const q = Math.hypot(X, Y);
          if (q < rMinN) rMinN = q; if (q > rMaxN) rMaxN = q;
          if (prev) segs.push(prev[0], prev[1], X, Y);
          prev = [X, Y];
        }
      }
      acc += (g.w + TRACK) * fit;
    }
  } else {
    fit = Math.min(1, 1.3 / (dev * sN));
    const cs = Math.cos(ROT), sn = Math.sin(ROT);
    let acc = 0;
    for (const ch of text){
      const g = GLYPHS[ch]; if (!g){ acc += (.5 + TRACK) * fit; continue; }
      for (const poly of g.g){
        let prev = null;
        for (const [u, v] of poly){
          const lx = (acc + u * fit - dev * fit / 2) * sN;
          const ly = (.5 - v) * fit * sN;
          const X = lx * cs - ly * sn, Y = lx * sn + ly * cs;
          const q = Math.hypot(X, Y);
          if (q < rMinN) rMinN = q; if (q > rMaxN) rMaxN = q;
          if (prev) segs.push(prev[0], prev[1], X, Y);
          prev = [X, Y];
        }
      }
      acc += (g.w + TRACK) * fit;
    }
  }
  return { segs, rMinN, rMaxN, fit, ok: segs.length > 0 && logo.size * fit >= 3.2 };
}


/* raster 256² su [-1..1]²: deposito gocce lungo i tratti, inviluppo (non somma).
   Ritorna null (fondo liscio), {ok:false} (testo non entra), {ok:false, blank:true}
   (nessun tratto da incidere) o {ok:true,data}. Il codice del design, se presente
   in logo.serial, viene impaginato come seconda riga (layoutSerial). */
const RRES = 256;
function depositSegs(data, segs, r95){
  const half = .75 / r95;
  const stepN = .7 / r95;
  const cc = v => clamp(Math.round((v + 1) * RRES / 2 - .5), 0, RRES - 1);
  for (let s = 0; s < segs.length; s += 4){
    const x1 = segs[s], y1 = segs[s+1], x2 = segs[s+2], y2 = segs[s+3];
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.ceil(len / stepN));
    for (let k = 0; k <= n; k++){
      const t = k / n, px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
      const cx = cc(px), cy = cc(py);
      const rad = Math.ceil(half * RRES / 2);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++){
        const gx = cx + dx, gy = cy + dy;
        if (gx < 0 || gy < 0 || gx >= RRES || gy >= RRES) continue;
        const wx = (gx + .5) * 2 / RRES - 1, wy = (gy + .5) * 2 / RRES - 1;
        const d2 = ((wx - px) ** 2 + (wy - py) ** 2) / (half * half);
        if (d2 >= 1) continue;
        const q = 1 - d2;
        const idx = gy * RRES + gx;
        if (q > data[idx]) data[idx] = q;
      }
    }
  }
}

/* codice del design: riga dritta, ruotata come il testo.
   Arco → al centro del fondo, dentro l'arco. Dritto (o testo vuoto) → sotto il testo.
   Luce minima 3 mm tra le mezzerie: tratto largo 1,5 mm + 1,5 mm di pieno tra i solchi
   (≈ 4 linee da 0,4 mm: il setto resta stampabile e leggibile). */
const SERIAL_MIN_MM = 3.2;
function layoutSerial(logo, code, r95, main){
  const text = code.toUpperCase();
  let dev = 0;
  for (const ch of text){ const g = GLYPHS[ch]; dev += (g ? g.w : .5) + TRACK; }
  dev = Math.max(.1, dev - TRACK);
  const sizeMM = clamp(logo.size * .7, 3.6, 5);
  const sN = sizeMM / r95, clr = 3 / r95;
  const inArc = !!(main && logo.arc);
  const rLim = inArc ? main.rMinN - clr : 1 - clr;
  const mainHalf = (main && !logo.arc) ? main.fit * logo.size / r95 / 2 : 0;
  const cyOf = f => (main && !logo.arc) ? mainHalf + clr + f * sN / 2 : 0;
  const fits = f => Math.hypot(dev * f * sN / 2, Math.abs(cyOf(f)) + f * sN / 2) <= rLim;
  let fit = 1;
  while (fit > .5 && !fits(fit)) fit -= .01;
  const ok = rLim > 0 && fits(fit) && sizeMM * fit >= SERIAL_MIN_MM;
  const segs = [];
  let rMinN = 1e9, rMaxN = -1e9;
  if (ok){
    const ROT = logo.rot * Math.PI / 180, cs = Math.cos(ROT), sn = Math.sin(ROT), cy = cyOf(fit);
    let acc = 0;
    for (const ch of text){
      const g = GLYPHS[ch]; if (!g){ acc += (.5 + TRACK) * fit; continue; }
      for (const poly of g.g){
        let prev = null;
        for (const [u, v] of poly){
          const lx = (acc + u * fit - dev * fit / 2) * sN;
          const ly = cy + (.5 - v) * fit * sN;
          const X = lx * cs - ly * sn, Y = lx * sn + ly * cs;
          const q = Math.hypot(X, Y);
          if (q < rMinN) rMinN = q; if (q > rMaxN) rMaxN = q;
          if (prev) segs.push(prev[0], prev[1], X, Y);
          prev = [X, Y];
        }
      }
      acc += (g.w + TRACK) * fit;
    }
  }
  return { segs, rMinN, rMaxN, ok, sizeMM: sizeMM * fit };
}

function buildLogoRaster(logo, r95){
  if (!logo.on) return null;
  const serial = typeof logo.serial === 'string' ? logo.serial : '';
  const L = layoutLogo(logo, r95);
  if (!L.segs.length && !serial) return null;  // testo vuoto/solo spazi: fondo liscio, nessun avviso
  if (L.segs.length && !L.ok)
    return { data:null, ok:false, rMinN:L.rMinN, rMaxN:L.rMaxN, r95, serial, serialOk:false, hasSerial:false };
  let segs = L.segs, serialOk = false;
  const bands = L.segs.length ? [[L.rMinN, L.rMaxN]] : [];
  if (serial){
    const S = layoutSerial(logo, serial, r95, L.segs.length ? L : null);
    if (S.ok){ segs = segs.concat(S.segs); bands.push([S.rMinN, S.rMaxN]); serialOk = true; }
  }
  if (!segs.length)
    return { data:null, ok:false, blank:true, rMinN:1e9, rMaxN:-1e9, r95, serial, serialOk:false, hasSerial:false };
  const data = new Float32Array(RRES * RRES);
  depositSegs(data, segs, r95);
  /* rMinN/rMaxN restano quelli del testo: senza codice il raster è identico alla versione precedente */
  return { data, ok:true, rMinN:L.segs.length ? L.rMinN : 1e9, rMaxN:L.segs.length ? L.rMaxN : -1e9,
           r95, serial, serialOk, hasSerial:serialOk, bands };
}
/* raster: null o non ok → 0 (stessa semantica del vecchio controllo su logo.on/ok) */
function logoDepth(raster, depth, x, y, r95){
  if (!raster || !raster.ok) return 0;
  const u = x / r95, v = y / r95;
  if (u <= -1 || u >= 1 || v <= -1 || v >= 1) return 0;
  const fx = (u + 1) * RRES / 2 - .5, fy = (v + 1) * RRES / 2 - .5;
  const x0 = clamp(Math.floor(fx), 0, RRES - 2), y0 = clamp(Math.floor(fy), 0, RRES - 2);
  const tx = clamp(fx - x0, 0, 1), ty = clamp(fy - y0, 0, 1);
  const D = raster.data;
  const a = D[y0*RRES+x0], b = D[y0*RRES+x0+1], c = D[(y0+1)*RRES+x0], d = D[(y0+1)*RRES+x0+1];
  const val = (a*(1-tx)+b*tx)*(1-ty) + (c*(1-tx)+d*tx)*ty;
  return val * depth;
}

/* ============ collo filettato ESTERNO: quote critiche (lato bottiglia) ============ */
/* ---- pezzi del set: stesso DNA (profilo, costole, torsione, segnale), misure derivate.
   Il codice del design identifica il SET: entrambi i pezzi lo portano inciso. ---- */
const PIECES = {
  disp:  { name:'Dispenser',       hK:1,   rK:1,   neck:true  },
  tooth: { name:'Portaspazzolino', hK:.58, rK:.62, neck:false },
};
const pieceOf = P => PIECES[P && P.piece] || PIECES.disp;
/* misure del pezzo a partire dai parametri del set */
function piecePar(P, key){
  const pc = PIECES[key] || PIECES.disp;
  if (pc === PIECES.disp) return { ...P, piece:'disp' };
  /* la torsione scala con l'altezza: i pezzi del set condividono l'INCLINAZIONE
     dell'elica delle costole, non l'angolo totale (che su un pezzo più basso
     darebbe un'elica più ripida e mangerebbe il budget dei 44°) */
  return { ...P, piece:key, h: clamp(P.h * pc.hK, 40, 235), r: clamp(P.r * pc.rK, 20, 110),
           twist: P.twist * pc.hK };
}
function neckSpec(P){
  if (!pieceOf(P).neck)                      // pezzo aperto: nessun collo, nessun filetto
    return { ridgeH:0, crestR:0, rootR:0, neckBoreR:0, entry:1, land:0, Hn:0, open:true };
  const ridgeH     = Math.min(1.5, Math.max(.9, P.thD * .044));
  const crestR     = P.thD / 2;
  const rootR      = crestR - ridgeH;
  /* Il collo è la parte che la pompa stringe, e con la parete oltre i 3 mm non
     ha senso che resti l'unico punto sottile del pezzo: l'alesaggio rientra
     quel tanto che basta perché il collo segua lo slider. Fino a 3 mm non
     cambia nulla, e il minimo di 6 mm di raggio resta a proteggere i filetti
     più piccoli. Il passaggio per la cannuccia perde al massimo 0,4 mm di Ø. */
  const wallMin    = Math.max(3, Number.isFinite(P.w) ? P.w : 3);
  const neckBoreR  = Math.max(6, rootR - wallMin);
  const entry      = Math.max(1.4, ridgeH / .6);
  const land       = 2.4;
  const Hn         = entry + P.turns * P.pitch + land;
  return { ridgeH, crestR, rootR, neckBoreR, entry, land, Hn };
}

/* ================= segnale personale (GPX / voce) =================
   64 campioni quantizzati 0..63 (base64url, 1 carattere ciascuno) modulano il
   PROFILO IN QUOTA prima di clampProfile: il limitatore di pendenza garantisce
   i ~44° per costruzione. Mappa: dal fondo fino a SIG_SPAN dell'altezza del
   corpo; nei primi SIG_BASE la modulazione sale da 0 (appoggio, firma e
   stabilità restano governati dal raggio base). */
const SIG_N = 64, SIG_SPAN = .8, SIG_BASE = .08;

/* Fondo scala assoluto dello spessore del guscio: sotto questa misura nessuno
   slicer riesce a chiudere la parete e il pezzo perde. Con la cavita' derivata
   dalla faccia esterna non dovrebbe mai entrare in funzione; resta come rete di
   sicurezza, e quando entra viene contato e riportato. */
const WALL_FLOOR = 1.2;

/* Soglia di tenuta: larghezza di estrusione (~0,45 mm con ugello 0,4) per i
   4 perimetri della ricetta. Sotto questa misura i perimetri non si chiudono
   e nessuna impostazione dello slicer recupera la perdita. */
const WALL_SEAL_MIN = .45 * 4;

/* ====================== spessore del fondo ======================
   Il fondo seguiva una costante di 3 mm mentre la parete arrivava a 3,2: con
   la parete che ora sale fino a 8 mm quel pavimento resterebbe il punto debole
   del pezzo proprio dove il liquido preme e dove il vaso appoggia quando lo
   posi. Il fondo segue quindi la parete, con 3 mm come minimo storico (sotto i
   3 mm nessun design cambia di un micron) e un quinto dell'altezza come tetto,
   perche' su un pezzo basso il pavimento non mangi la cavita'. */
const FLOOR_MIN = 3;
function floorMin(P){
  const w = P && Number.isFinite(P.w) ? P.w : FLOOR_MIN;
  const h = P && Number.isFinite(P.h) ? P.h : 120;
  return clamp(Math.max(FLOOR_MIN, w), FLOOR_MIN, Math.max(FLOOR_MIN, h * .2));
}

const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function sigValid(q){
  if (typeof q !== 'string' || q.length !== SIG_N) return false;
  for (const c of q) if (B64U.indexOf(c) < 0) return false;
  return true;
}
/* valori qualsiasi (≥ 2 distinti) → stringa canonica min-max su 0..63 */
function sigEncode(vals){
  let lo = Infinity, hi = -Infinity;
  for (const v of vals){ if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi - lo > 1e-9)) return null;
  let q = '';
  for (const v of vals) q += B64U[Math.round((v - lo) / (hi - lo) * 63)];
  return q;
}
/* valori grezzi 0..1 con verso/inversione applicati */
function sigRaw(sig){
  if (!sig || !sigValid(sig.q)) return null;
  const v = new Float64Array(SIG_N);
  for (let i = 0; i < SIG_N; i++) v[i] = B64U.indexOf(sig.q[i]) / 63;
  if (sig.rev) v.reverse();
  if (sig.inv) for (let i = 0; i < SIG_N; i++) v[i] = 1 - v[i];
  return v;
}
/* gaussiana σ in campioni, bordi a specchio (nessuna normalizzazione) */
function gaussRaw(raw, sigma){
  if (!(sigma > .05)) return Float64Array.from(raw);
  const R = Math.ceil(sigma * 3), w = new Float64Array(2 * R + 1);
  let ws = 0;
  for (let k = -R; k <= R; k++){ w[k + R] = Math.exp(-(k * k) / (2 * sigma * sigma)); ws += w[k + R]; }
  const v = new Float64Array(SIG_N);
  for (let i = 0; i < SIG_N; i++){
    let acc = 0;
    for (let k = -R; k <= R; k++){
      let j = i + k;
      while (j < 0 || j >= SIG_N) j = j < 0 ? -j - 1 : 2 * SIG_N - j - 1;
      acc += raw[j] * w[k + R];
    }
    v[i] = acc / ws;
  }
  return v;
}
/* media nulla, picco ±1 (null = piatta) */
function normZero(v){
  const o = Float64Array.from(v);
  let mean = 0; for (let i = 0; i < SIG_N; i++) mean += o[i]; mean /= SIG_N;
  let mx = 0; for (let i = 0; i < SIG_N; i++){ o[i] -= mean; if (Math.abs(o[i]) > mx) mx = Math.abs(o[i]); }
  if (mx < 1e-6) return null;
  for (let i = 0; i < SIG_N; i++) o[i] /= mx;
  return o;
}
const smoothNorm = (raw, sigma) => normZero(gaussRaw(raw, sigma));
/* tolleranza di stampabilità: lo stampato non si scosta dal voluto più di 0,4 mm (2 layer).
   Levigatura: σ fino a 16 campioni. */
const SIG_SIGMA_MAX = 16, SIG_TOL = .4;
/* Catmull-Rom sui campioni: curva C1, niente spigoli che il limitatore dovrebbe tagliare */
function shapeAt(shape, t){
  const u = clamp(t / SIG_SPAN, 0, 1) * (SIG_N - 1);
  const i = Math.min(SIG_N - 2, Math.floor(u)), f = u - i;
  const p0 = shape[Math.max(0, i - 1)], p1 = shape[i], p2 = shape[i + 1], p3 = shape[Math.min(SIG_N - 1, i + 2)];
  return p1 + .5 * f * (p2 - p0 + f * (2*p0 - 5*p1 + 4*p2 - p3 + f * (3*(p1 - p2) + p3 - p0)));
}
const sigWeight = t => sstep(t / SIG_BASE);
/* ---- adattamento ai vincoli con il limitatore VERO ----
   Si esegue clampProfile sulle righe dell'export e si misura quanta modulazione il
   limitatore altera: scostamento massimo |ΔBo_limitato − ΔBo_libero| sul corpo.
   Una curva è stampabile se lo scostamento ≤ SIG_TOL mm ovunque: la forma voluta
   è quella stampata a meno di 2 layer, per costruzione. */
function sigRig(P, base){
  const n = neckSpec(P), rows = pieceRows(P, PE), zs = new Float64Array(rows);
  buildRows(P, n, PE.nB, PE.nN, zs);
  const rig = { P, n, zs, rows, Rc:new Float64Array(rows), Bo:new Float64Array(rows), Bi:new Float64Array(rows),
    BoB:new Float64Array(rows), BiB:new Float64Array(rows), s:new Float64Array(rows), jTop:0 };
  clampProfile(P, n, base, zs, rig.Rc, rig.BoB, rig.BiB);
  for (let j = 0; j < rows && zs[j] <= P.h; j++){
    const u = Math.min(1, Math.max(0, (zs[j] / P.h - .6) / .4));
    rig.s[j] = u*u*(3 - 2*u); rig.jTop = j;
  }
  return rig;
}
/* scostamento massimo (mm) tra modulazione limitata e libera di fnA rispetto a fnB
   (fnB già limitata in refBo), su TUTTE le righe del corpo: il limitatore procede
   riga per riga e un taglio sposta anche le righe successive */
function sigResidual(rig, fnA, fnB, refBo){
  const { P, n, zs, s: sb } = rig;
  clampProfile(P, n, fnA, zs, rig.Rc, rig.Bo, rig.Bi);
  let mx = 0;
  for (let j = 0; j <= rig.jTop; j++){
    const t = zs[j] / P.h, dU = P.r * (fnA(t) - fnB(t)) * (1 - sb[j]), dC = rig.Bo[j] - refBo[j];
    const e = Math.abs(dC - dU); if (e > mx) mx = e;
  }
  return mx;
}
/* ---- voce attorno alla circonferenza ---- */
const RING_SIGMA_MAX = 6;
function gaussCirc(raw, sigma){
  if (!(sigma > .05)) return Float64Array.from(raw);
  const R = Math.min(SIG_N >> 1, Math.ceil(sigma * 3)), w = new Float64Array(2 * R + 1);
  let ws = 0;
  for (let k = -R; k <= R; k++){ w[k + R] = Math.exp(-(k * k) / (2 * sigma * sigma)); ws += w[k + R]; }
  const v = new Float64Array(SIG_N);
  for (let i = 0; i < SIG_N; i++){
    let acc = 0;
    for (let k = -R; k <= R; k++) acc += raw[((i + k) % SIG_N + SIG_N) % SIG_N] * w[k + R];
    v[i] = acc / ws;
  }
  return v;
}
/* Catmull-Rom periodico: inizio e fine della frase si incontrano senza cucitura */
function shapeCirc(c, th){
  const u = ((th / TAU) % 1 + 1) % 1 * SIG_N, i = Math.floor(u), f = u - i;
  const at = k => c[((k % SIG_N) + SIG_N) % SIG_N];
  const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
  return p1 + .5 * f * (p2 - p0 + f * (2*p0 - 5*p1 + 4*p2 - p3 + f * (3*(p1 - p2) + p3 - p0)));
}
/* rampa di attivazione dal fondo: abbastanza lunga da non rubare più di ~1/3 del budget */
const ringRamp = (A, Bmax) => Math.max(12, 3.5 * Bmax * A);
function ringTable(vr, nTh){
  const c = new Float64Array(nTh);
  for (let i = 0; i < nTh; i++) c[i] = vr.A * shapeCirc(vr.shape, i * TAU / nTh);
  return c;
}
/* intensità stampabile, due condizioni:
   1) la silhouette (guscio e cavità) non si sposta più di SIG_TOL mm rispetto al vaso senza voce;
   2) nessuna riga resta con pendenza oltre il budget grezzo del limitatore più di quanto
      già accada senza voce (il minimo di sicurezza 0,05 non deve diventare un taglio dei 44°). */
const RING_TOP = .6;
function fitRing(P, base, sig, A){
  const raw = sigRaw(sig);
  if (!raw || !(A > 0)) return null;
  const sigma = clamp(+sig.smooth || 0, 0, 1) * RING_SIGMA_MAX;
  const shape = normZero(gaussCirc(raw, sigma));
  if (!shape) return null;
  /* il limitatore assume |c| ≤ 1: normalizzo sul massimo della curva INTERPOLATA
     (Catmull-Rom supera i campioni fino al ~16% senza levigatura) */
  let cmx = 0;
  for (let i = 0; i < 2048; i++) cmx = Math.max(cmx, Math.abs(shapeCirc(shape, i * TAU / 2048)));
  for (let i = 0; i < SIG_N; i++) shape[i] /= cmx;
  const rig = sigRig(P, base), rows = rig.rows, zs = rig.zs, zTop = RING_TOP * P.h;
  let Bmax = 0; for (let j = 0; j <= rig.jTop; j++) Bmax = Math.max(Bmax, rig.BoB[j]);
  /* sforamento del budget RIGA PER RIGA: un confronto sul massimo globale lascerebbe
     peggiorare righe diverse da quella peggiore del vaso base */
  const overBudget = (Bo, Bi, lim, out) => {
    for (let j = 1; j < rows; j++){
      const dz = Math.max(zs[j] - zs[j-1], 1e-6);
      const need = Math.max(Math.abs(Bo[j] - Bo[j-1]), Math.abs(Bi[j] - Bi[j-1])) / dz;
      out[j] = need - lim(Bo[j-1], j);
    }
    return out;
  };
  const dB = {}; clampProfile(P, rig.n, base, zs, rig.Rc, rig.BoB, rig.BiB, null, dB);
  const baseOver = overBudget(rig.BoB, rig.BiB, dB.limRaw, new Float64Array(rows));
  const ringOver = new Float64Array(rows);
  const vrOf = a => ({ A:a, ramp:ringRamp(a, Bmax), zTop });
  const ok = a => {
    const d = {}; clampProfile(P, rig.n, base, zs, rig.Rc, rig.Bo, rig.Bi, vrOf(a), d);
    let mx = 0;
    for (let j = 0; j < rows; j++) mx = Math.max(mx, Math.abs(rig.Bo[j] - rig.BoB[j]), Math.abs(rig.Bi[j] - rig.BiB[j]));
    if (mx > SIG_TOL) return false;
    overBudget(rig.Bo, rig.Bi, d.limRaw, ringOver);
    for (let j = 1; j < rows; j++) if (ringOver[j] > Math.max(0, baseOver[j]) + 1e-4) return false;
    return true;
  };
  let Aeff = A;
  if (!ok(A)){
    let lo = 0, hi = A;
    for (let it = 0; it < 14; it++){ const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
    Aeff = lo < 1e-3 ? 0 : lo;
  }
  return { kind:'ring', shape, A:Aeff, Areq:A, sigma, ...vrOf(Aeff), Bmax };
}
const ringCache = new Map();
function ringFor(P, profKey){
  if (!(P.amp > 0) || !P.sig || P.sig.kind !== 'ring') return null;
  const key = [P.piece, P.h, P.r, P.petals, P.twist, P.sharp, P.w, P.thD, P.pitch, P.turns, P.amp, profKey,
               P.sig.q, P.sig.smooth, !!P.sig.rev, !!P.sig.inv].join('|');
  if (ringCache.has(key)) return ringCache.get(key);
  let f = fitRing(P, PROFILES[profKey], P.sig, P.amp);
  if (f && !(f.A > 0)) f = null;
  if (ringCache.size > 16) ringCache.clear();
  ringCache.set(key, f);
  return f;
}

const modFn = (base, shape, A) => t => base(t) * (1 + A * sigWeight(t) * shapeAt(shape, t));
/* adattamento deterministico:
   1) levigatura richiesta; 2) altrimenti la minima levigatura stampabile (bisezione);
   3) se nemmeno la massima basta, la massima intensità stampabile. */
function fitSignal(P, base, sig, A){
  const raw = sigRaw(sig);
  if (!raw || !(A > 0)) return null;
  const s0 = clamp(+sig.smooth || 0, 0, 1) * SIG_SIGMA_MAX;
  const sh0 = smoothNorm(raw, s0);
  if (!sh0) return null;
  const rig = sigRig(P, base);
  const ok = (sh, a) => sigResidual(rig, modFn(base, sh, a), base, rig.BoB) <= SIG_TOL;
  if (ok(sh0, A)) return { shape:sh0, A, sigma:s0, sigmaReq:s0, Areq:A };
  const shM = smoothNorm(raw, SIG_SIGMA_MAX);
  if (shM && ok(shM, A)){
    let lo = s0, hi = SIG_SIGMA_MAX, shHi = shM;
    for (let it = 0; it < 12; it++){
      const mid = (lo + hi) / 2, sh = smoothNorm(raw, mid);
      if (sh && ok(sh, A)){ hi = mid; shHi = sh; } else lo = mid;
    }
    return { shape:shHi, A, sigma:hi, sigmaReq:s0, Areq:A };
  }
  const sh = shM || sh0;
  let lo = 0, hi = A;
  for (let it = 0; it < 14; it++){ const mid = (lo + hi) / 2; if (ok(sh, mid)) lo = mid; else hi = mid; }
  return { shape:sh, A: lo < 1e-3 ? 0 : lo, sigma:SIG_SIGMA_MAX, sigmaReq:s0, Areq:A };
}
const fitCache = new Map();
function fitSignalFor(P, profKey){
  if (!(P.amp > 0) || !P.sig || P.sig.kind === 'ring') return null;
  const key = [P.piece, P.h, P.r, P.petals, P.twist, P.sharp, P.thD, P.pitch, P.turns, P.amp, profKey,
               P.sig.q, P.sig.smooth, !!P.sig.rev, !!P.sig.inv].join('|');
  if (fitCache.has(key)) return fitCache.get(key);
  const f = fitSignal(P, PROFILES[profKey], P.sig, P.amp);
  if (fitCache.size > 16) fitCache.clear();
  fitCache.set(key, f);
  return f;
}
/* profilo effettivo: unica fonte per export, raggio del fondo e layout del logo.
   Senza segnale (o intensità 0, o intensità stampabile nulla) ritorna il profilo
   base: STL identici al bit. */
function fitProfile(base, fit){ return fit && fit.A > 0 ? modFn(base, fit.shape, fit.A) : base; }
function profileFn(P, profKey){ return fitProfile(PROFILES[profKey], fitSignalFor(P, profKey)); }

/* ================= righe in quota ================= */
function buildRows(P, n, nB, nN, zs){
  for (let j = 0; j < nB; j++) zs[j] = P.h * j / (nB - 1);
  if (n.open) return;                        // senza collo le righe finiscono al bordo
  for (let k = 1; k <= nN; k++) zs[nB + k - 1] = P.h + n.Hn * k / nN;
}
/* righe totali del pezzo: senza collo solo il corpo */
const pieceRows = (P, cfg) => neckSpec(P).open ? cfg.nB : cfg.nB + cfg.nN;

/* ====== profilo autocostretto: budget di pendenza per riga (~44°) ====== */
/* vr (opzionale) = voce attorno alla circonferenza {A, ramp}: termine angolare
   G = f(θ − twist) + A·wv(z)·c(θ), con c fermo rispetto alla torsione e |c| ≤ 1.
   wv(z) = sstep(z/ramp)·sstep((zTop − z)/ramp): fascia dal fondo a zTop, sotto la spalla.
   Il budget di pendenza tiene conto di ampiezza extra (anche nel raccordo di spalla),
   derivata esatta della fascia wv' e denominatore.
   diag (opzionale): riceve limRaw(B, j), il budget senza il minimo di sicurezza. */
function ringBand(z, vr){
  const u = Math.min(1, Math.max(0, z / vr.ramp)), v = Math.min(1, Math.max(0, (vr.zTop - z) / vr.ramp));
  const a = u*u*(3 - 2*u), b = v*v*(3 - 2*v);
  const da = (u > 0 && u < 1) ? 6*u*(1-u) / vr.ramp : 0, db = (v > 0 && v < 1) ? 6*v*(1-v) / vr.ramp : 0;
  return [a * b, Math.abs(da * b - a * db)];
}
function clampProfile(P, n, prof, zs, Rc, Bo, Bi, vr, diag){
  const fm  = P.sharp*.42 + 2*P.sharp*P.sharp*.10;
  const fmx = P.sharp*.42 +   P.sharp*P.sharp*.10;
  const mp  = P.petals * (P.twist*Math.PI/180) / Math.max(40, P.h);
  const CAP = .97;
  const rows = zs.length;
  const fd  = new Float64Array(rows), fdd = new Float64Array(rows);
  const open = !!n.open;                     // bordo aperto: costole a piena ampiezza fino in cima
  for (let j = 0; j < rows; j++){
    const t = Math.min(1, zs[j] / P.h);
    const u = Math.min(1, Math.max(0, (t - .6) / .4));
    fd[j]  = open ? 1 : 1 - u*u*(3 - 2*u);
    fdd[j] = open ? 0 : (u > 0 && u < 1) ? 6*u*(1-u)*2.5/P.h : 0;
  }
  const VA = vr && vr.A > 0 ? vr.A : 0;
  let wv = null, wvd = null;
  if (VA){
    wv = new Float64Array(rows); wvd = new Float64Array(rows);
    for (let j = 0; j < rows; j++){ const w = ringBand(zs[j], vr); wv[j] = w[0]; wvd[j] = w[1]; }
  }
  if (diag) diag.limRaw = VA ? (B, j) => {
    const f = fd[j], g = fdd[j], ax = fmx + VA*wv[j], ad = VA*wvd[j];
    return Math.min((CAP - B*f*fm*mp - B*f*ad - B*g*ax) / (1 + f*ax), (CAP - B*f*f*fm*mp - B*f*f*ad - 2*B*f*g*ax) / (1 + f*f*ax));
  } : (B, j) => {
    const f = fd[j], g = fdd[j];
    return Math.min((CAP - B*f*fm*mp - B*g*fmx) / (1 + f*fmx), (CAP - B*f*f*fm*mp - 2*B*f*g*fmx) / (1 + f*f*fmx));
  };
  const limAt = VA ? (B, j) => {
    const f = fd[j], g = fdd[j], ax = fmx + VA*wv[j], ad = VA*wvd[j];
    const lBo = (CAP - B*f*fm*mp   - B*f*ad   - B*g*ax)     / (1 + f*ax);
    const lBi = (CAP - B*f*f*fm*mp - B*f*f*ad - 2*B*f*g*ax) / (1 + f*f*ax);
    return Math.max(.05, Math.min(lBo, lBi));
  } : (B, j) => {
    const f = fd[j], g = fdd[j];
    const lBo = (CAP - B*f*fm*mp   - B*g*fmx)     / (1 + f*fmx);
    const lBi = (CAP - B*f*f*fm*mp - 2*B*f*g*fmx) / (1 + f*f*fmx);
    return Math.max(.05, Math.min(lBo, lBi));
  };
  let prev = Rc[0] = P.r * prof(0);
  for (let j = 1; j < rows; j++){
    const dz = Math.max(zs[j] - zs[j-1], 1e-6);
    const raw = zs[j] <= P.h ? P.r * prof(zs[j] / P.h) : prev;
    let d = raw - prev;
    const lim = limAt(prev, j);
    if (d >  lim*dz) d =  lim*dz;
    if (d < -lim*dz) d = -lim*dz;
    prev = Rc[j] = prev + d;
  }
  for (let j = 0; j < rows; j++){
    const t = Math.min(1, zs[j] / P.h);
    const u = Math.min(1, Math.max(0, (t - .6) / .4));
    const s = open ? 0 : u*u*(3 - 2*u);
    Bo[j] = Rc[j]*(1-s) + n.rootR*s;
    Bi[j] = (Rc[j] - P.w)*(1-s) + n.neckBoreR*s;
  }
  const sweep = (B, inner) => {
    for (let j = 1; j < rows && zs[j] <= P.h; j++){
      const dz = Math.max(zs[j] - zs[j-1], 1e-6);
      let d = B[j] - B[j-1];
      const lim = limAt(inner ? Bo[j-1] : B[j-1], j);
      if (d >  lim*dz) d =  lim*dz;
      if (d < -lim*dz) d = -lim*dz;
      B[j] = B[j-1] + d;
    }
  };
  const cone = (B, inner) => {
    for (let j = rows - 2; j >= 0; j--){
      const dz = Math.max(zs[j+1] - zs[j], 1e-6);
      const bound = B[j+1] + limAt(inner ? Bo[j+1] : B[j+1], j+1) * dz;
      if (B[j] > bound) B[j] = bound;
    }
  };
  sweep(Bo, false); cone(Bo, false);

  /* Bi non e' piu' la cavita': e' lo SPESSORE VOLUTO riga per riga, scritto come
     raggio perche' il resto del motore lo legge cosi' (Bo[j] − Bi[j]). La cavita'
     vera la costruisce erodeCavity, erodendo il corpo con una sfera di questo
     raggio — uno spostamento radiale lascerebbe sul fianco delle costole uno
     spessore vero di w·cos(alfa), cioe' il 60-70% sui preset.
     Qui resta il raccordo dello spessore fra corpo e collo, che e' una scelta
     di progetto: lo spessore passa dolcemente da quello del cursore a quello
     che la norma GPI impone al collo. Bo non viene toccato da questa riga in
     poi: la faccia esterna resta identica. */
  for (let j = 0; j < rows; j++){
    const t = Math.min(1, zs[j] / P.h);
    const u = Math.min(1, Math.max(0, (t - .6) / .4));
    const sBlend = open ? 0 : u*u*(3 - 2*u);
    /* lo spessore passa dolcemente da quello del corpo a quello del collo */
    Bi[j] = Bo[j] - (P.w * (1 - sBlend) + (n.rootR - n.neckBoreR) * sBlend);
  }
}


/* raggio di riferimento del fondo: 95% del minimo reale della riga 0 del guscio */
/* CORRETTO: il raggio della riga 0 va preso DOPO clampProfile, che per rispettare
   i 44° può restringerla a ritroso (fino a −35%). Con il valore teorico il disco
   usciva dalla parete: corona del fondo ripiegata e testo oltre il bordo. */
function r95Of(P, prof0, Bo0){
  const a = P.sharp*.42, bb = P.sharp*P.sharp*.10;
  /* stesso ordine delle operazioni della versione precedente quando la riga non è
     ristretta: design non interessati dal difetto → STL identici al bit */
  return P.r * prof0 <= Bo0 ? Math.max(3, .95 * P.r * prof0 * (1 - a - bb))
                            : Math.max(3, .95 * Bo0 * (1 - a - bb));
}
function targetR95(P, profKey){
  /* stesse righe dell'export: il valore coincide con ctx.r95 di makeExportCtx */
  const n = neckSpec(P), rows = pieceRows(P, PE), zs = new Float64Array(rows);
  buildRows(P, n, PE.nB, PE.nN, zs);
  const Bo = new Float64Array(rows), Bi = new Float64Array(rows);
  clampProfile(P, n, profileFn(P, profKey), zs, new Float64Array(rows), Bo, Bi, ringFor(P, profKey));
  return r95Of(P, PROFILES[profKey](0), Bo[0]);          // profileFn(0) ≡ base(0): peso nullo al fondo
}

/* raggi degli anelli interni del disco (densi sulla fascia della scritta);
   l'anello esterno del disco È la riga 0 del guscio: condivisa, zero cuciture */
function buildRadK(KI, r95, rMinN, rMaxN){
  const rad = new Float64Array(KI);
  const has = rMaxN > rMinN && rMinN > 0 && rMaxN < 1e8;
  const z0 = has ? clamp(rMinN*r95 - 1.5, 0, r95*.75) : 0;
  const z1 = has ? clamp(rMaxN*r95 + 1.5, Math.min(z0 + 2, r95*.9), r95*.9) : r95*.9;
  const n0 = clamp(Math.round(KI * z0 / r95), 0, KI - 2);
  const n1 = clamp(Math.round(KI * (z1 - z0) / r95 * 2), 1, KI - n0 - 1);
  const n2 = KI - n0 - n1;
  let p = 0;
  for (let k = 1; k <= n0; k++) rad[p++] = z0 * k / (n0 + 1);
  for (let k = 1; k <= n1; k++) rad[p++] = z0 + (z1 - z0) * k / n1;
  for (let k = 1; k <= n2; k++) rad[p++] = z1 + (r95 - z1) * k / n2;
  return rad;
}

/* anelli del disco con più fasce dense (testo + codice): distribuzione per
   densità, peso 6 dentro le fasce (±1,5 mm), 1 fuori. L'ultimo anello è r95. */
function buildRadKBands(KI, r95, bands, W = 6){
  const N = 4096, pad = 1.5;
  const iv = bands.map(([a, b]) => [Math.max(0, a * r95 - pad), Math.min(r95, b * r95 + pad)]);
  const w = r => { for (const [a, b] of iv) if (r >= a && r <= b) return W; return 1; };
  const cdf = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) cdf[i] = cdf[i-1] + w((i - .5) * r95 / N);
  const tot = cdf[N], rad = new Float64Array(KI);
  let i = 1;
  for (let k = 1; k <= KI; k++){
    const target = tot * k / KI;
    while (i < N && cdf[i] < target) i++;
    rad[k-1] = r95 * (i - 1 + (target - cdf[i-1]) / (cdf[i] - cdf[i-1])) / N;
  }
  rad[KI-1] = r95;
  return rad;
}

/* ============ la cavita': il corpo eroso, non il raggio scalato ============
 *
 * Il difetto che questa funzione esiste per togliere.
 *
 * Prima di questa revisione la cavita' era la faccia esterna spostata di w
 * LUNGO IL RAGGIO:
 * ri = ro - w. Su un cilindro e' giusto. Su un vaso a costole no, perche' sul
 * fianco di una costola la normale alla superficie non e' radiale: uno
 * spostamento radiale di w vi lascia uno spessore vero di w·cos(alfa), con
 * alfa l'angolo fra raggio e normale. Misurato sui preset di listino, con
 * 2,40 mm richiesti: 1,67 (Aureo), 1,46 (Maelstrom), 1,48 (Fiamma), 1,57
 * (Marea). Tutti sotto la soglia di tenuta, mentre la scheda dichiarava 2,40 —
 * perche' misurava anche lei il raggio.
 *
 * Peggiora con le costole: 9 costole e affilatura 1 rendono il 14% del
 * nominale. E' anche il motivo per cui ingrossare la parete non serviva a
 * nulla: la resa e' una frazione della geometria, non un valore assoluto, e
 * 8 mm dichiarati restavano 1,08 mm veri.
 *
 * Ora la cavita' e' il corpo EROSO da una sfera del raggio della parete:
 * l'insieme dei punti in cui quella sfera ci sta tutta. Per definizione ogni
 * punto della superficie esterna ha almeno w di materiale sotto di se',
 * misurato dove conta — perpendicolarmente. Dove le costole sono piu' fitte
 * della sfera, la sfera non entra e la costola resta piena: smette di essere
 * una piega sottile del guscio e diventa un nervo di rinforzo, che e' il modo
 * in cui si irrigidisce un recipiente a parete sottile.
 *
 * Il conto e' esatto, non approssimato: per ogni direzione si cerca il raggio
 * massimo a cui il disco di raggio w non tocca nessun segmento del contorno
 * dello strato — intersezione raggio/capsula, in forma chiusa. Il contorno
 * dello strato e' esattamente il poligono che finisce nell'STL, quindi la
 * misura e' quella che lo slicer riempira' davvero.
 *
 * La pendenza verticale entra come fattore sqrt(1 + Rz²) sul raggio della
 * sfera: una parete inclinata di 44° attraversata in orizzontale e' piu'
 * spessa di quanto sia perpendicolarmente, e senza quel fattore la spalla
 * resterebbe sottile proprio dove la pompa la sollecita.
 */

/* faccia esterna del corpo senza il cordolo del filetto: e' la superficie da
   cui si ricava la cavita', e serve tutta insieme perche' l'erosione guarda i
   vicini. */
function outerGrid(ctx, RO){
  const { zs, Bo, nTh, P } = ctx, rows = zs.length;
  const twist = P.twist * Math.PI / 180;
  const a = P.sharp * .42, b = -P.sharp * P.sharp * .10, DTH = TAU / nTh;
  const vrc = ctx.vr;
  for (let j = 0; j < rows; j++){
    const z = zs[j];
    let fade, m;
    if (ctx.ring){ fade = 0; m = 0; }
    else {
      const t = Math.min(1, z / P.h);
      const u = Math.min(1, Math.max(0, (t - .6) / .4));
      fade = ctx.open ? 1 : 1 - u*u*(3 - 2*u);
      m = twist * t;
    }
    const wvz = vrc ? ringBand(z, vrc)[0] : 0;
    const B = Bo[j], amp = B * fade, o = j * nTh;
    for (let i = 0; i < nTh; i++){
      const x = P.petals * (i * DTH - m);
      let f = a * Math.cos(x) + b * Math.cos(2*x);
      if (vrc) f += wvz * vrc.cth[i];
      RO[o + i] = B + amp * f;
    }
  }
}

/* Raggio massimo, sulla semiretta di direzione (ux,uy), a cui un disco di
   raggio w non tocca il segmento AB: il minore fra le due calotte tonde e la
   fascia parallela al segmento. `best` entra come limite corrente e serve
   anche a saltare le soluzioni peggiori senza calcolarle. */
function rayCapsule(ux, uy, ax, ay, bx, by, w, w2, best){
  let p = ux*ax + uy*ay, D = p*p - (ax*ax + ay*ay) + w2;
  if (D >= 0){ const r = p - Math.sqrt(D); if (r >= 0 && r < best) best = r; }
  p = ux*bx + uy*by; D = p*p - (bx*bx + by*by) + w2;
  if (D >= 0){ const r = p - Math.sqrt(D); if (r >= 0 && r < best) best = r; }
  const dx = bx - ax, dy = by - ay, L2 = dx*dx + dy*dy;
  if (L2 > 1e-24){
    const L = Math.sqrt(L2), nx = -dy/L, ny = dx/L, den = ux*nx + uy*ny;
    if (den > 1e-12 || den < -1e-12){
      const c = ax*nx + ay*ny;
      for (let q = 0; q < 2; q++){
        const r = (c + (q ? -w : w)) / den;
        if (r < 0 || r >= best) continue;
        const t = ((r*ux - ax)*dx + (r*uy - ay)*dy) / L2;
        if (t >= 0 && t <= 1) best = r;
      }
    }
  }
  return best;
}

/* limite di pendenza della cavita': la stessa regola dei 44° della faccia
   esterna. Si applica SCENDENDO e puo' solo stringere la cavita', mai
   allargarla: cosi' toglie l'aggetto senza mai assottigliare la parete. */
const CAVITY_SLOPE = .97;

function erodeCavity(ctx, RO, RI){
  const { zs, Bo, Bi, nTh, jB } = ctx, rows = zs.length, DTH = TAU / nTh;
  const cs = ctx.cosT, sn = ctx.sinT, px = ctx.ex, py = ctx.ey;
  /* niente costole e niente profilo (lo spool di prova): il raggio basta e
     l'erosione darebbe lo stesso identico risultato, al centesimo */
  const piatto = !!ctx.ring;
  for (let j = jB; j < rows; j++){
    const o = j * nTh, w0 = Bo[j] - Bi[j];
    if (piatto){ for (let i = 0; i < nTh; i++) RI[o + i] = RO[o + i] - w0; continue; }
    let rMin = Infinity;
    for (let i = 0; i < nTh; i++){
      const R = RO[o + i]; px[i] = R * cs[i]; py[i] = R * sn[i];
      if (R < rMin) rMin = R;
    }
    const jm = j > 0 ? j - 1 : 0, jp = j + 1 < rows ? j + 1 : rows - 1;
    const dzz = zs[jp] - zs[jm];
    for (let i = 0; i < nTh; i++){
      const R = RO[o + i];
      const Rz = dzz > 0 ? (RO[jp*nTh + i] - RO[jm*nTh + i]) / dzz : 0;
      const w = w0 * Math.sqrt(1 + Rz*Rz), w2 = w * w;
      const ux = cs[i], uy = sn[i];
      /* Finestra angolare. Il centro del disco sta sulla semiretta, quindi solo
         un segmento che entra nella BANDA di semilarghezza w attorno alla retta
         del raggio puo' toccarlo. Un punto del contorno a scarto angolare Δ dista
         dalla retta almeno rMin·|sin Δ|, con rMin il raggio minimo dello strato:
         oltre asin(w/rMin) non c'e' piu' niente da guardare. Va preso il minimo
         dello STRATO e non il raggio locale — nel fondo di una costola il
         contorno rientra, e con il raggio locale la finestra lasciava fuori
         proprio il segmento che stringe (misurato: 3,06 mm invece di 3,20). */
      const span = w >= rMin ? (nTh >> 1)
        : Math.min(nTh >> 1, ((Math.asin(w / rMin) / DTH) | 0) + 2);
      let best = R - w;
      for (let d = -span; d <= span; d++){
        let k = i + d; k = k < 0 ? k + nTh : k >= nTh ? k - nTh : k;
        let k2 = k + 1; if (k2 >= nTh) k2 -= nTh;
        /* la banda, di nuovo, ma sul singolo segmento: quattro moltiplicazioni
           che tolgono il lavoro vero sui segmenti che la finestra tiene dentro
           per prudenza */
        const c1 = py[k]*ux - px[k]*uy, c2 = py[k2]*ux - px[k2]*uy;
        if ((c1 > w && c2 > w) || (c1 < -w && c2 < -w)) continue;
        best = rayCapsule(ux, uy, px[k], py[k], px[k2], py[k2], w, w2, best);
      }
      RI[o + i] = best;
    }
  }
  for (let j = rows - 2; j >= jB; j--){
    const dz = zs[j+1] - zs[j], o = j * nTh, o1 = (j+1) * nTh;
    for (let i = 0; i < nTh; i++){
      const bound = RI[o1 + i] + CAVITY_SLOPE * dz;
      if (RI[o + i] > bound) RI[o + i] = bound;
    }
  }
}

/* le due griglie vivono sul contesto: fillVessel gira a ogni fotogramma
   dell'anteprima e non deve allocare un megabyte per volta */
function cavityGrids(ctx){
  const need = ctx.zs.length * ctx.nTh;
  if (!ctx.gRO || ctx.gRO.length < need){
    ctx.gRO = new Float64Array(need);
    ctx.gRI = new Float64Array(need);
  }
  outerGrid(ctx, ctx.gRO);
  erodeCavity(ctx, ctx.gRO, ctx.gRI);
}

/* ================= costruzione della mesh (vaso cavo, dati Z-up) =================
   Fondo = disco (anelli 1..K-1) il cui anello esterno È la riga 0 del guscio:
   condivisa, quindi watertight per costruzione. Il pavimento della cavità
   (superficie di tenuta) resta intoccato: l'incisione vive solo sotto. */
function fillVessel(pos, ctx){
  const { zs, Bo, Bi, nTh, P } = ctx;
  const n = ctx.n, rows = zs.length, jB = ctx.jB;
  const K = ctx.K, r95 = ctx.r95, KI = K - 1;
  const engr = ctx.engrave !== false;
  const DTH = TAU / nTh, snD = Math.sin(DTH);
  const pA = ctx.sA, pO = ctx.sM, pI = ctx.sI, qO = ctx.prevM, qI = ctx.prevI;
  const ridgeH = n.ridgeH, entry = n.entry, zTop = ctx.Ht - n.land;
  let maxR = 0, maxW = 0, maxWz = 0, maxWall = 0, capV = 0, wallV = 0, solidV = 0, prevZ = zs[0], minRi = 1e9;
  let minWall = 1e9, floored = 0, pinched = 0; // spessore reale del guscio, e i due clamp che lo alterano
  /* spessore massimo locale: dentro una costola piena il guscio e' molto piu'
     spesso della parete, e i perimetri devono arrivarci o il nucleo resta
     reticolo rado — piu' leggero del modello e non quello che la scheda conta */
  let thickMax = 0;

  /* faccia esterna e cavita' si calcolano prima, in due passate loro: la
     cavita' e' il corpo eroso e per ricavarla ogni punto deve poter guardare i
     vicini, cosa che una passata sola non permette */
  cavityGrids(ctx);
  const RO = ctx.gRO, RI = ctx.gRI;

  for (let j = 0; j < rows; j++){
    const z = zs[j], dz = Math.max(1e-6, z - prevZ); prevZ = z;
    const wantWall = Bo[j] - Bi[j];
    for (let i = 0; i < nTh; i++){
      const th = i * DTH;
      const ro0 = RO[j * nTh + i];
      let ro = ro0;
      if (!ctx.open && z > ctx.zBase && z <= zTop){
        const zn = z - ctx.zBase;
        const fr = th / TAU - zn / P.pitch;
        const dd = Math.abs(fr - Math.round(fr));
        let g = 0;
        if (dd < .14) g = 1;
        else if (dd < .5) g = .5 * (1 + Math.cos(Math.PI * (dd - .14) / .36));
        if (g > 0) ro = ro0 + ridgeH * g * sstep(zn / entry) * sstep((zTop - z) / (.4 * P.pitch));
      }
      if (ro > maxR) maxR = ro;
      let k = (j * nTh + i) * 3;
      pos[k] = ro * Math.cos(th); pos[k+1] = ro * Math.sin(th); pos[k+2] = z;
      if (j >= jB){
        let ri = RI[j * nTh + i], clamp = false;
        /* la cavita' si e' richiusa: la parete richiesta non ci sta. Va contato,
           perche' il rimedio (parete piu' sottile, pezzo piu' grande) e'
           l'opposto di quello di una parete sottile per distrazione. */
        if (ri < 2.5){ ri = 2.5; pinched++; clamp = true; }
        /* fondo scala di sicurezza: non deve piu' entrare in funzione, ma se
           entra va saputo, non subito in silenzio */
        if (ri > ro0 - WALL_FLOOR){ ri = ro0 - WALL_FLOOR; floored++; clamp = true; }
        /* Fuori dai clamp lo spessore VERO e' quello voluto per costruzione:
           l'erosione garantisce che la sfera di raggio w ci stia. Dove un clamp
           ha spostato la cavita' quella garanzia salta, e allora si riporta la
           misura radiale, che li' e' l'unica che si ha. */
        const wallHere = clamp ? Math.min(wantWall, ro0 - ri) : wantWall;
        if (wallHere < minWall) minWall = wallHere;
        if (ro0 - ri > thickMax) thickMax = ro0 - ri;
        pI[i] = ri;
        if (j > jB && ri < minRi) minRi = ri;                  // cerchio inscritto minimo della cavità
        k = (rows * nTh + (j - jB) * nTh + i) * 3;
        pos[k] = ri * Math.cos(th); pos[k+1] = ri * Math.sin(th); pos[k+2] = z;
      }
      pA[i] = ro;
      pO[i] = ro0;
    }
    let Ao = 0, Ai = 0;
    for (let i = 0; i < nTh; i++){
      const i2 = (i + 1) % nTh;
      Ao += pA[i] * pA[i2];
      if (j >= jB) Ai += pI[i] * pI[i2];
    }
    Ao *= .5 * snD; Ai *= .5 * snD;
    if (j <= jB) solidV += Ao * dz;
    else { wallV += (Ao - Ai) * dz; capV += Ai * dz; }
    if (j > 0){
      for (let i = 0; i < nTh; i++){
        const wo = (pO[i] - qO[i]) / dz;
        if (wo > maxW){ maxW = wo; maxWz = z; maxWall = 0; }
        if (j > jB){
          const wi = (qI[i] - pI[i]) / dz;
          if (wi > maxW){ maxW = wi; maxWz = z; maxWall = 1; }
        }
      }
    }
    qO.set(pO);
    if (j >= jB) qI.set(pI);
  }

  /* disco del fondo: anelli 1..K-1 con nD campioni angolari propri (nD = m·nTh);
     l'anello K è la riga 0 del guscio, già scritta, raccordata dalla cerniera */
  const nD = ctx.nD || nTh, DTHD = TAU / nD;
  const nIn = rows - jB;
  const D0 = rows * nTh + nIn * nTh;
  const Cf = D0 + KI * nD, C1 = Cf + 1;
  for (let a2 = 1; a2 <= KI; a2++){
    const r = ctx.radK[a2 - 1];
    for (let i = 0; i < nD; i++){
      const th = i * DTHD, x = r * Math.cos(th), y = r * Math.sin(th);
      const kk = (D0 + (a2 - 1) * nD + i) * 3;
      pos[kk] = x; pos[kk+1] = y; pos[kk+2] = engr ? logoDepth(ctx.raster, ctx.depth, x, y, r95) : 0;
    }
  }
  let kc = Cf * 3;
  pos[kc] = 0; pos[kc+1] = 0; pos[kc+2] = engr ? logoDepth(ctx.raster, ctx.depth, 0, 0, r95) : 0;
  pos[C1*3] = 0; pos[C1*3+1] = 0; pos[C1*3+2] = zs[jB];
  return { maxR, maxW, maxWz, maxWall, capV, wallV, solidV, minRi,
           minWall: minWall === 1e9 ? 0 : minWall, floored, pinched, thickMax };
}

/* ================= topologia: vertici, triangoli, indici =================
   nD = campioni angolari del disco del fondo, multiplo intero di nTh (m = nD/nTh).
   Cerniera tra l'anello esterno del disco (nD) e la riga 0 del guscio (nTh): per ogni
   settore i, i primi h=⌊m/2⌋ spicchi vanno a O(0,i), i restanti a O(0,i+1), più un
   triangolo di raccordo. Con m = 1 la topologia coincide con la versione precedente. */
function vesselVerts(rows, nTh, jB, K, nD = nTh){
  return rows*nTh + (rows-jB)*nTh + (K-1)*nD + 2;       // unica fonte di verità
}
function vesselTriCount(rows, nTh, jB, K, nD = nTh){
  const nIn = rows - jB, m = nD / nTh;
  return (rows-1)*2*nTh + (nIn-1)*2*nTh + nD + (K-2)*2*nD + nTh*(m+1) + nTh + 2*nTh;
}
function writeVesselIndex(ind, rows, nTh, jB, K, nD = nTh){
  if (nD % nTh !== 0) throw new Error('nD deve essere multiplo di nTh');
  const nIn = rows - jB, D0 = rows*nTh + nIn*nTh, KI = K - 1, m = nD / nTh, h = m >> 1;
  const Cf = D0 + KI*nD, C1 = Cf + 1;
  let p = 0;
  const O = (j,i) => j*nTh + (i % nTh);
  const I = (j,i) => rows*nTh + (j-jB)*nTh + (i % nTh);
  const F = (a,i) => D0 + (a-1)*nD + (i % nD);
  for (let j = 0; j < rows-1; j++) for (let i = 0; i < nTh; i++){        // guscio esterno
    const A=O(j,i), B=O(j,i+1), C=O(j+1,i), D=O(j+1,i+1);
    ind[p++]=A; ind[p++]=B; ind[p++]=D;  ind[p++]=A; ind[p++]=D; ind[p++]=C;
  }
  for (let j = jB; j < rows-1; j++) for (let i = 0; i < nTh; i++){       // parete cavità
    const A=I(j,i), B=I(j,i+1), C=I(j+1,i), D=I(j+1,i+1);
    ind[p++]=A; ind[p++]=D; ind[p++]=B;  ind[p++]=A; ind[p++]=C; ind[p++]=D;
  }
  for (let i = 0; i < nD; i++){ ind[p++]=Cf; ind[p++]=F(1,i+1); ind[p++]=F(1,i); }
  for (let a2 = 1; a2 < KI; a2++) for (let i = 0; i < nD; i++){
    const A=F(a2,i), B=F(a2,i+1), C=F(a2+1,i), D=F(a2+1,i+1);
    ind[p++]=A; ind[p++]=B; ind[p++]=D;  ind[p++]=A; ind[p++]=D; ind[p++]=C;
  }
  for (let i = 0; i < nTh; i++){                                          // cerniera disco → riga 0
    const k0 = i*m, Oa = O(0,i), Ob = O(0,i+1);
    for (let k = k0; k < k0 + h; k++){ ind[p++]=F(KI,k); ind[p++]=F(KI,k+1); ind[p++]=Oa; }
    for (let k = k0 + h; k < k0 + m; k++){ ind[p++]=F(KI,k); ind[p++]=F(KI,k+1); ind[p++]=Ob; }
    ind[p++]=F(KI,k0+h); ind[p++]=Ob; ind[p++]=Oa;
  }
  for (let i = 0; i < nTh; i++){ ind[p++]=C1; ind[p++]=I(jB,i); ind[p++]=I(jB,i+1); }
  for (let i = 0; i < nTh; i++){
    ind[p++]=O(rows-1,i); ind[p++]=O(rows-1,i+1); ind[p++]=I(rows-1,i+1);
    ind[p++]=O(rows-1,i); ind[p++]=I(rows-1,i+1); ind[p++]=I(rows-1,i);
  }
  return p;
}
function vesselIndex(rows, nTh, jB, K, nD = nTh){
  const ind = new Uint32Array(vesselTriCount(rows, nTh, jB, K, nD) * 3);
  writeVesselIndex(ind, rows, nTh, jB, K, nD);
  return ind;
}

/* ================= contesti ================= */
/* Disco del fondo. Liscio: K anelli, nTh campioni (mesh invariata).
   Inciso: KD anelli con peso WD sulle fasce di testo/codice, nTh·mD campioni.
   Export ≈ 0,31 mm tangenziali a 35 mm dal centro e ≈ 0,35 mm radiali in fascia. */
const PN = { nTh:112, nB:132, nN:56, K:26, KD:48, mD:2, WD:10 };
const PE = { nTh:176, nB:240, nN:96, K:38, KD:72, mD:4, WD:10 };
function discCounts(cfg, engraved){
  return engraved ? { K:cfg.KD, nD:cfg.nTh * cfg.mD } : { K:cfg.K, nD:cfg.nTh };
}
function discSpec(cfg, L, r95){
  const c = discCounts(cfg, !!L);
  c.radK = L ? buildRadKBands(c.K - 1, r95, L.bands, cfg.WD) : buildRadK(cfg.K - 1, r95, 1e9, -1e9);
  return c;
}
const mkScratch = nTh => {
  /* tabelle angolari e contorno dello strato: l'erosione della cavita' lavora
     in cartesiane e le rifarebbe a ogni punto */
  const cosT = new Float64Array(nTh), sinT = new Float64Array(nTh);
  for (let i = 0; i < nTh; i++){ cosT[i] = Math.cos(i * TAU / nTh); sinT[i] = Math.sin(i * TAU / nTh); }
  return { sA:new Float32Array(nTh), sM:new Float32Array(nTh), sI:new Float32Array(nTh),
           prevM:new Float32Array(nTh), prevI:new Float32Array(nTh),
           cosT, sinT, ex:new Float64Array(nTh), ey:new Float64Array(nTh) };
};

function baseCtx(P, nTh, K){
  return { P, nTh, nD:nTh, K, ring:false, open:false, vr:null, engrave:true, jB:1, zBase:0, Ht:10, n:null, r95:10,
    raster:null, depth:0, radK:new Float64Array(Math.max(1, K-1)), ...mkScratch(nTh) };
}
/* prima riga della cavita': il pavimento sta appena sopra floorMin(P).
   Senza P vale il minimo storico di 3 mm, cosi' i richiami di comodo
   (strumenti, test) restano quelli di prima. */
function firstInnerRow(zs, P){
  const fl = floorMin(P);
  let jB = 1; while (jB < zs.length - 1 && zs[jB] < fl) jB++;
  return jB;
}
/* stessa regola di firstInnerRow applicata alle righe di esportazione */
function exportFloorRow(h, P){
  const fl = floorMin(P || { h, w: FLOOR_MIN });
  let j = 1; while (j < PE.nB - 1 && h * j / (PE.nB - 1) < fl) j++;
  return j;
}
/* quota del pavimento nell'STL esportato: e' il pieno che sta sotto il liquido */
const exportFloorZ = P => P.h * exportFloorRow(P.h, P) / (PE.nB - 1);
/* contesto per una qualsiasi risoluzione: PE per l'export, PS per la ricerca.
   Con cfg = PE il percorso è identico alla versione precedente (STL invariati). */
function makeCtxFor(cfg, P, profKey, raster, depth){
  const n = neckSpec(P), rows = pieceRows(P, cfg);
  const zs = new Float64Array(rows);
  buildRows(P, n, cfg.nB, cfg.nN, zs);
  const Bo = new Float64Array(rows), Bi = new Float64Array(rows);
  const vr = ringFor(P, profKey);
  clampProfile(P, n, profileFn(P, profKey), zs, new Float64Array(rows), Bo, Bi, vr);
  const L = (raster && raster.ok) ? raster : null;
  const ctx = baseCtx(P, cfg.nTh, cfg.K);
  ctx.zs = zs; ctx.Bo = Bo; ctx.Bi = Bi;
  ctx.n = n; ctx.open = !!n.open;
  ctx.jB = firstInnerRow(zs, P); ctx.zBase = P.h; ctx.Ht = zs[rows-1];
  ctx.r95 = r95Of(P, PROFILES[profKey](0), Bo[0]);
  ctx.raster = L; ctx.depth = depth;
  ctx.vr = vr ? { A:vr.A, ramp:vr.ramp, zTop:vr.zTop, cth: ringTable(vr, cfg.nTh) } : null;
  Object.assign(ctx, discSpec(cfg, L, ctx.r95));
  return ctx;
}
const makeExportCtx = (P, profKey, raster, depth) => makeCtxFor(PE, P, profKey, raster, depth);
function makeRingCtx(P){
  const n = neckSpec(P), base = 2.4;
  const Ht = base + n.entry + P.turns * P.pitch + n.land, nTh = PE.nTh;
  const list = [0, base], steps = Math.max(14, Math.round((Ht - base) / .2));
  for (let k = 1; k <= steps; k++) list.push(base + (Ht - base) * k / steps);
  const zs = Float64Array.from(list);
  const ctx = baseCtx(P, nTh, 4);
  ctx.zs = zs;
  ctx.Bo = new Float64Array(zs.length).fill(n.rootR);
  ctx.Bi = new Float64Array(zs.length).fill(n.neckBoreR);
  ctx.n = n;
  ctx.jB = 1; ctx.zBase = base; ctx.Ht = Ht; ctx.ring = true; ctx.engrave = false;
  ctx.r95 = n.rootR;
  for (let k = 0; k < 3; k++) ctx.radK[k] = n.rootR * (.3 + .3*k);
  return ctx;
}

/* ============ provino di robustezza: due barrette e un verdetto ============
 *
 * A cosa serve. Tre revisioni della geometria non hanno tolto la fragilita' di
 * un pezzo stampato, e una parete che ora c'e' davvero non basta se gli strati
 * non si saldano fra loro. Il punto e' che dal pezzo finito non si capisce
 * quale delle due cose e' rotta, e ogni tentativo costa venti ore di stampa.
 *
 * Il provino separa le due cause in venti minuti, e lo fa cambiando una sola
 * variabile: l'orientamento.
 *
 * · la barretta CORICATA ha gli strati paralleli alla flessione. Fletterla
 *   misura il materiale: e' il riferimento.
 * · la barretta ERETTA ha gli strati perpendicolari. Fletterla misura la
 *   SALDATURA fra strati, ed e' l'unica differenza fra le due.
 *
 * Verdetto, fletterle fra le dita:
 * · coricata flette, eretta si spezza di netto con frattura piatta e lucida
 *   → saldatura: piu' caldo, meno ventola, filo asciutto. Nessuna modifica al
 *     disegno la aggiusta.
 * · si spezzano entrambe di netto → materiale: bobina umida o vecchia.
 * · flettono entrambe e sbiancano → la stampa e' sana, e la fragilita' del
 *   pezzo grosso va cercata altrove (spessore, urto, aggressione chimica).
 *
 * Le barrette hanno lo spessore della parete del design e si stampano con la
 * ricetta del design: e' lo stesso guscio, in piccolo.
 */
const COUPON = { L:40, W:15, gap:18, brim:6 };

/* scatola: 8 vertici, 12 triangoli, normali verso l'esterno */
function boxMesh(dx, dy, dz){
  const pos = new Float32Array(8 * 3), ind = new Uint32Array(36);
  const X = [0, dx], Y = [0, dy], Z = [0, dz];
  const V = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];
  for (let k = 0; k < 8; k++){
    pos[k*3] = X[V[k][0]] - dx/2;            // centrata in XY, appoggiata a z=0
    pos[k*3+1] = Y[V[k][1]] - dy/2;
    pos[k*3+2] = Z[V[k][2]];
  }
  ind.set([0,2,1, 0,3,2,  4,5,6, 4,6,7,  0,1,5, 0,5,4,
           3,7,6, 3,6,2,  0,4,7, 0,7,3,  1,2,6, 1,6,5]);
  return { pos, ind, vol: dx * dy * dz };
}

function runCoupon(job){
  const P = job.P, w = Math.max(.4, P.w);
  const eretta   = boxMesh(COUPON.W, w, COUPON.L);        // alta: strati perpendicolari
  const coricata = boxMesh(COUPON.L, COUPON.W, w);        // bassa: strati paralleli
  const mat = materialOf(job.mat), firma = `${mat.nome} ${mat.nozzle}C · parete ${w.toFixed(1)} mm`;
  const parts = [
    { name: `eretta · strati perpendicolari · ${firma}`,
      pos: eretta.pos,   ind: eretta.ind,   x: 0, y: -COUPON.gap },
    { name: `coricata · strati paralleli · ${firma}`,
      pos: coricata.pos, ind: coricata.ind, x: 0, y: COUPON.gap },
  ];
  for (const m of [eretta, coricata]){
    const chk = validateMesh(m.pos, m.ind, m.vol);
    if (!chk.ok) return { ok:false, error:'provino non valido · ' + chk.errors.join(' · ') };
  }
  /* La temperatura nel nome: il provino si stampa due o tre volte a gradi
     diversi per trovare la finestra della propria macchina, e senza il numero
     addosso le barrette si confondono sul tavolo. */
  const label = `VORTICE provino di robustezza · ${firma} · fletti entrambe le barrette`;
  const matVol = eretta.vol + coricata.vol;
  const summary = { ok:true, check:{ tris:24, errors:[] }, matVol,
    secs: printSeconds(matVol, 1), Ht: COUPON.L, D: COUPON.L, tris:24, pieces:2 };
  /* stessa ricetta del pezzo, piu' il bordino: una barretta alta e sottile
     senza brim si stacca dal piatto e il provino non dice piu' niente */
  const R = { ...recipeFor(P, 0, job.mat), brim: COUPON.brim };
  if (job.format === '3mf')
    return build3MF(parts, label, R).then(buffer => ({ ...summary, buffer, format:'3mf' }));
  return { ...summary, buffer: plateSTL(parts, label), format:'stl' };
}

/* ================= STL binario ================= */
function buildSTLBuffer(pos, ind, label){
  const tris = ind.length / 3;
  const buf = new ArrayBuffer(84 + tris*50), dv = new DataView(buf);
  for (let i = 0; i < label.length && i < 80; i++) dv.setUint8(i, label.charCodeAt(i) & 0x7f);
  dv.setUint32(80, tris, true);
  let o = 84;
  for (let p = 0; p < ind.length; p += 3){
    const A=ind[p]*3, B=ind[p+1]*3, C=ind[p+2]*3;
    const ax=pos[A],ay=pos[A+1],az=pos[A+2], bx=pos[B],by=pos[B+1],bz=pos[B+2], cx=pos[C],cy=pos[C+1],cz=pos[C+2];
    let nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay),
        ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az),
        nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    const l = Math.hypot(nx,ny,nz) || 1; nx/=l; ny/=l; nz/=l;
    dv.setFloat32(o,nx,true); dv.setFloat32(o+4,ny,true); dv.setFloat32(o+8,nz,true);
    dv.setFloat32(o+12,ax,true); dv.setFloat32(o+16,ay,true); dv.setFloat32(o+20,az,true);
    dv.setFloat32(o+24,bx,true); dv.setFloat32(o+28,by,true); dv.setFloat32(o+32,bz,true);
    dv.setFloat32(o+36,cx,true); dv.setFloat32(o+40,cy,true); dv.setFloat32(o+44,cz,true);
    dv.setUint16(o+48,0,true); o += 50;
  }
  return buf;
}

/* ================= export del piatto: più pezzi in un solo file ================= */
function pieceMesh(P, profKey, logo){
  const raster = buildLogoRaster(logo, targetR95(P, profKey));
  const ctx = makeExportCtx(P, profKey, raster, logo.depth);
  const pos = new Float32Array(vesselVerts(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD) * 3);
  const st = fillVessel(pos, ctx);
  const ind = vesselIndex(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD);
  const check = validateMesh(pos, ind, st.solidV + st.wallV);
  const folds = discFolds(pos, ind, ctx);
  if (folds){ check.ok = false; check.errors.push(folds + ' triangoli del fondo ripiegati'); }
  return { ctx, pos, ind, st, check, raster };
}
/* STL: nessuna trasformazione nel formato, quindi le coordinate vengono traslate */
function plateSTL(parts, label){
  let tris = 0; for (const p of parts) tris += p.ind.length / 3;
  const buf = new ArrayBuffer(84 + tris*50), dv = new DataView(buf);
  for (let i = 0; i < label.length && i < 80; i++) dv.setUint8(i, label.charCodeAt(i) & 0x7f);
  dv.setUint32(80, tris, true);
  let o = 84;
  for (const p of parts){
    const { pos, ind, x, y } = p;
    for (let q = 0; q < ind.length; q += 3){
      const A=ind[q]*3, B=ind[q+1]*3, C=ind[q+2]*3;
      const ax=pos[A]+x, ay=pos[A+1]+y, az=pos[A+2], bx=pos[B]+x, by=pos[B+1]+y, bz=pos[B+2], cx=pos[C]+x, cy=pos[C+1]+y, cz=pos[C+2];
      let nx=(by-ay)*(cz-az)-(bz-az)*(cy-ay), ny=(bz-az)*(cx-ax)-(bx-ax)*(cz-az), nz=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      const l = Math.hypot(nx,ny,nz) || 1; nx/=l; ny/=l; nz/=l;
      dv.setFloat32(o,nx,true); dv.setFloat32(o+4,ny,true); dv.setFloat32(o+8,nz,true);
      dv.setFloat32(o+12,ax,true); dv.setFloat32(o+16,ay,true); dv.setFloat32(o+20,az,true);
      dv.setFloat32(o+24,bx,true); dv.setFloat32(o+28,by,true); dv.setFloat32(o+32,bz,true);
      dv.setFloat32(o+36,cx,true); dv.setFloat32(o+40,cy,true); dv.setFloat32(o+44,cz,true);
      dv.setUint16(o+48,0,true); o += 50;
    }
  }
  return buf;
}
function runPlate(job){
  const plan = platePlan(job.P, job.profKey, job.pieces || ['disp','tooth']);
  const parts = [], errs = [], recParts = [];
  let tris = 0, matVol = 0, secs = 0, Ht = 0;
  for (const it of plan.items){
    const m = pieceMesh(it.P, job.profKey, job.logo);
    if (!m.check.ok) errs.push(pieceOf(it.P).name + ': ' + m.check.errors.join(' · '));
    tris += m.check.tris; matVol += matVolOf(m.st); secs += printSeconds(matVolOf(m.st), rippleQ(m.pos, m.ctx)); Ht = Math.max(Ht, m.ctx.Ht);
    const code = job.logo && job.logo.serial ? job.logo.serial + ' · ' : '';
    parts.push({ name: code + pieceOf(it.P).name, pos:m.pos, ind:m.ind, x:it.x, y:it.y });
    recParts.push([it.P, m.st.thickMax]);
  }
  if (errs.length) return { ok:false, error:'mesh non valida · ' + errs.join(' | ') };
  if (!plan.fits) return { ok:false, error:'i pezzi non stanno insieme sul piatto · ' + plan.why };
  const label = 'VORTICE set: ' + parts.map(p => p.name).join(' + ');
  const summary = { ok:true, check:{ tris }, plate:{ W:plan.W, D:plan.D, H:plan.H }, matVol, secs, Ht, tris, pieces:parts.length };
  if (job.format === '3mf')
    return build3MF(parts, label, recipeForAll(recParts, job.mat))
      .then(buffer => ({ ...summary, buffer, format:'3mf' }));
  return { ...summary, buffer: plateSTL(parts, label), format:'stl' };
}

/* ================= 3MF =================
   ZIP (deflate-raw quando il browser lo offre, altrimenti non compresso) con:
   · 3D/3dmodel.model  — geometria standard, multi-oggetto, letta da qualsiasi slicer
   · Metadata/Slic3r_PE.config      — ricetta per PrusaSlicer
   · Metadata/project_settings.config — ricetta per OrcaSlicer / famiglia Bambu
   Cura importa la sola geometria: le impostazioni vanno messe a mano. */
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++){ let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0; }
  return t;
})();
function crc32(buf){
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function deflateRaw(bytes){
  if (typeof CompressionStream === 'undefined') return null;
  try{
    const cs = new CompressionStream('deflate-raw');
    const w = cs.writable.getWriter(); w.write(bytes); w.close();
    const parts = [], rd = cs.readable.getReader();
    for (;;){ const { value, done } = await rd.read(); if (done) break; parts.push(value); }
    let n = 0; for (const p of parts) n += p.length;
    const out = new Uint8Array(n); let o = 0;
    for (const p of parts){ out.set(p, o); o += p.length; }
    return out;
  }catch(_){ return null; }
}
async function zipArchive(entries){
  const enc = new TextEncoder(), locals = [], dirs = [];
  let offset = 0;
  for (const e of entries){
    const name = enc.encode(e.name), raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const def = await deflateRaw(raw);
    const body = def && def.length < raw.length ? def : raw, method = body === def ? 8 : 0;
    const crc = crc32(raw);
    const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, method, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x2821, true);   // data fissa
    dv.setUint32(14, crc, true); dv.setUint32(18, body.length, true); dv.setUint32(22, raw.length, true);
    dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
    lh.set(name, 30);
    locals.push(lh, body);
    const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, method, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x2821, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true);
    ch.set(name, 46);
    dirs.push(ch);
    offset += lh.length + body.length;
  }
  let dirSize = 0; for (const d of dirs) dirSize += d.length;
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, dirs.length, true); ev.setUint16(10, dirs.length, true);
  ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true);
  let total = offset + dirSize + 22;
  const out = new Uint8Array(total); let o = 0;
  for (const p of locals){ out.set(p, o); o += p.length; }
  for (const d of dirs){ out.set(d, o); o += d.length; }
  out.set(end, o);
  return out.buffer;
}
const xmlEsc = t => String(t).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' })[c]);
/* parti: [{name, pos, ind, x, y}] — x,y in mm sul piatto (centro del pezzo) */
function model3MF(parts, title){
  const L = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `<metadata name="Application">VORTICE</metadata>`,
    `<metadata name="Title">${xmlEsc(title)}</metadata>`,
    '<resources>'];
  parts.forEach((p, k) => {
    L.push(`<object id="${k+1}" type="model" name="${xmlEsc(p.name)}"><mesh><vertices>`);
    const v = [];
    for (let i = 0; i < p.pos.length; i += 3)
      v.push(`<vertex x="${p.pos[i].toFixed(4)}" y="${p.pos[i+1].toFixed(4)}" z="${p.pos[i+2].toFixed(4)}"/>`);
    L.push(v.join(''), '</vertices><triangles>');
    const t = [];
    for (let i = 0; i < p.ind.length; i += 3)
      t.push(`<triangle v1="${p.ind[i]}" v2="${p.ind[i+1]}" v3="${p.ind[i+2]}"/>`);
    L.push(t.join(''), '</triangles></mesh></object>');
  });
  L.push('</resources>', '<build>');
  parts.forEach((p, k) => L.push(`<item objectid="${k+1}" transform="1 0 0 0 1 0 0 0 1 ${(p.x||0).toFixed(3)} ${(p.y||0).toFixed(3)} 0"/>`));
  L.push('</build>', '</model>');
  return L.join('\n');
}
/* ricetta di stampa: stessi valori della scheda */
/*
 * Ricetta di stampa incorporata nel 3MF.
 *
 * `seam` merita una riga di spiegazione. Ogni giro di perimetro deve iniziare e
 * finire da qualche parte, e in quel punto l'estrusione si interrompe: resta un
 * grumo o un microvuoto. Il default di PrusaSlicer e di Orca è `aligned`, che
 * impila di proposito tutte le cuciture sulla stessa verticale per farle sembrare
 * una riga sola — bello a vedersi, pessimo in un contenitore, perché quei
 * microvuoti si incolonnano e formano un canale continuo dal fondo al collo.
 * Con `random` ogni strato parte da un angolo diverso: i difetti restano isolati
 * e lo strato sopra copre quello sotto. Non esiste piu' un percorso continuo.
 *
 * Nota: la cucitura casuale lascia una punteggiatura fine sulla superficie. Su un
 * vaso a costole ritorte è praticamente invisibile, e comunque la tenuta viene
 * prima dell'estetica in un pezzo che deve contenere sapone.
 */
/*
 * `floorSolid` merita anch'essa una spiegazione. Il fondo e' alto 3-4 mm di
 * geometria piena, ma con i soli `bottom`/`top` strati solidi ne venivano
 * stampati pieni appena 2,0 mm: in mezzo restava riempimento al 6%, e il vero
 * sbarramento sotto il liquido erano gli strati solidi superiori, 1 mm stampato
 * sopra il vuoto. E' la costruzione normale di qualsiasi stampa e di solito
 * tiene, ma qui sotto c'e' sapone e non vale la pena rischiarlo: il fondo va
 * pieno per tutto il suo spessore.
 *
 * Effetto collaterale utile: cosi' il pezzo non ha piu' alcuna zona a
 * riempimento rado (la parete e' gia' tutta perimetri), quindi il materiale
 * torna a essere esattamente il volume della geometria.
 */
/* ===================== materiale: la parte che decide se il pezzo e' tenace
 * oppure di cristallo, e che la ricetta non diceva.
 *
 * Tre revisioni della geometria non hanno tolto la fragilita' di un pezzo
 * stampato, e c'e' un motivo: un pezzo che si rompe come il vetro non e'
 * sottile, e' MAL SALDATO. Fra uno strato e il successivo il polimero deve
 * rifondere; se arriva troppo freddo, o se una ventola al massimo lo raffredda
 * prima che il cordolo sopra ci si posi, gli strati restano incollati invece di
 * fusi. Il pezzo tiene a schiacciarlo e si spezza di netto a fletterlo, con una
 * frattura piatta e lucida. Nessuno spessore lo compensa: raddoppiando la
 * parete si raddoppia la sezione di una saldatura che non c'e'.
 *
 * Le impostazioni che decidono quella saldatura sono la temperatura e la
 * ventola. Nel 3MF non c'erano: la ricetta portava strato, perimetri, fondo,
 * cucitura e riempimento — tutto tranne le due che contano. Chi apriva il file
 * si ritrovava il proprio profilo PLA di serie, tipicamente 210 gradi con la
 * ventola al 100%, che e' la ricetta esatta di un pezzo di cristallo.
 *
 * Qui ci sono tre materiali, con i valori della guida di stampa del progetto.
 * Non sono ottimizzati per l'aspetto: sono scelti per la tenacita' fra strati,
 * che e' un'altra cosa (piu' caldo e meno ventola fanno un pezzo piu' brutto e
 * molto piu' forte).
 */
const MATERIALS = {
  petg: {
    nome:'PETG', tipo:'PETG',
    /* la scelta per un contenitore: salda bene, regge acqua e tensioattivi, e
       flette invece di delaminare */
    nozzle:240, nozzleFirst:245, bed:80, bedFirst:80,
    fanMin:20, fanMax:30, fanOff:5, slowLayer:15,
    nota:'la scelta per sapone e detersivo · flette invece di rompersi',
  },
  pla: {
    nome:'PLA', tipo:'PLA',
    /* PLA TENACE, non PLA bello. Un profilo PLA di serie sta sui 210 gradi con
       la ventola al 100%: e' tarato per gli spigoli netti e gli sporti puliti,
       ed e' esattamente la ricetta di un pezzo che si spezza come il vetro. Qui
       sono ribaltate le due voci che decidono la saldatura fra strati: +20 gradi
       e ventola tenuta al minimo. In cambio gli sporti vengono meno definiti e
       qualche filo resta da togliere — un filo si taglia, una delaminazione no.
       Il vaso non ha sporti oltre i 44°, quindi la ventola non gli serve.
       230 gradi stanno al limite alto: la maggior parte dei PLA dichiara 190-220,
       qualcuno 200-230, e il polimero degrada davvero sopra i 240-250. E'
       voluto, perche' e' proprio li' che la saldatura fra strati cambia; se il
       filo cola troppo si scende a 225 e si compensa con meno ventola. */
    nozzle:230, nozzleFirst:235, bed:60, bedFirst:60,
    fanMin:0, fanMax:25, fanOff:5, slowLayer:20,
    nota:'tarato per la tenacita\u0301, non per l\'aspetto · 230 \u00b0C e ventola quasi ferma',
  },
  asa: {
    nome:'ASA', tipo:'ABS',
    /* regge alcol e oli essenziali, ma su stampante aperta ritira: ventola
       quasi ferma o delamina da sola */
    nozzle:255, nozzleFirst:255, bed:100, bedFirst:100,
    fanMin:0, fanMax:15, fanOff:5, slowLayer:20,
    nota:'per alcol e oli essenziali · serve una camera chiusa',
  },
};
const MATERIAL_DEFAULT = 'petg';
const materialOf = key => MATERIALS[key] || MATERIALS[MATERIAL_DEFAULT];

const RECIPE = { layer:.2, first:.24, nozzle:.4, walls:4, top:5, bottom:5, infill:6,
                 pattern:'gyroid', seam:'random', floorSolid:4,
                 /* Le pareti che lo studio propone sono multipli esatti di
                    0,40: i perimetri le riempiono senza avanzi. Col default di
                    PrusaSlicer per un ugello da 0,4 (0,45) una parete da 2,4
                    lascerebbe una fessura che corre per tutta l'altezza del
                    pezzo. */
                 width:.4, generator:'arachne' };

/*
 * La parete di un vaso ha DUE contorni — la faccia esterna e quella della
 * cavita' — quindi ogni perimetro della ricetta vale due passate, una per
 * lato. Con 4 perimetri da 0,40 si coprono 3,2 mm: era esattamente la parete
 * massima di prima, e per questo il numero poteva restare fisso.
 *
 * Con la parete fino a 8 mm non puo' piu' restarlo. Un guscio da 6 mm slicciato
 * con 4 perimetri verrebbe 3,2 mm di cordoli pieni e 2,8 mm di GYROID AL 6%
 * chiuso in mezzo: piu' spesso, piu' pesante, piu' lento — e piu' debole di
 * prima, perche' la parete diventa una scatola vuota che cede alla prima
 * pressione e lascia passare il liquido lungo il reticolo. E' il difetto
 * esattamente opposto a quello che si vuole ottenere ingrossando il guscio.
 *
 * Il conto e' quindi derivato dal design: tanti perimetri quante passate
 * servono a riempire la parete senza lasciare un millimetro al riempimento.
 * Stessa regola per il fondo, che ora segue la parete (floorMin).
 */
function recipeWalls(w, width = RECIPE.width){
  return Math.max(RECIPE.walls, Math.ceil(w / (2 * width) - 1e-9));
}
/* Tetto al numero di perimetri. Con la cavita' erosa una costola molto affilata
   resta piena per venti millimetri e oltre: riempirla di soli cordoli costerebbe
   ore per un nucleo che, chiuso dentro un guscio pieno, il reticolo regge
   benissimo. Oltre questo numero il nucleo resta riempimento, e il materiale
   dichiarato diventa un limite superiore invece di una misura. */
const RECIPE_WALLS_MAX = 16;
function recipeFor(P, thickMax = 0, mat = MATERIAL_DEFAULT){
  const w = P && Number.isFinite(P.w) ? P.w : 2.4;
  /* i perimetri seguono la parete, ma anche lo spessore massimo locale: e' la
     costola piena, che senza di loro si stamperebbe vuota dentro */
  const walls = Math.min(RECIPE_WALLS_MAX,
    Math.max(recipeWalls(w), thickMax > 0 ? recipeWalls(thickMax) : 0));
  return { ...RECIPE, walls, mat: materialOf(mat),
           floorSolid: Math.max(RECIPE.floorSolid, Math.ceil(exportFloorZ(P) - 1e-9)) };
}
/* ricetta di un piatto con piu' pezzi: vale la piu' esigente */
function recipeForAll(list, mat = MATERIAL_DEFAULT){
  let r = { ...RECIPE, mat: materialOf(mat) };
  for (const it of list){
    const c = Array.isArray(it) ? recipeFor(it[0], it[1], mat) : recipeFor(it, 0, mat);
    if (c.walls > r.walls || c.floorSolid > r.floorSolid)
      r = { ...c, walls: Math.max(r.walls, c.walls), floorSolid: Math.max(r.floorSolid, c.floorSolid) };
  }
  return r;
}
const slic3rConfig = (R = RECIPE) => [
  '; ricetta VORTICE — tenuta al liquido affidata ai perimetri',
  `layer_height = ${R.layer}`, `first_layer_height = ${R.first}`,
  `perimeters = ${R.walls}`, `top_solid_layers = ${R.top}`, `bottom_solid_layers = ${R.bottom}`,
  `fill_density = ${R.infill}%`, `fill_pattern = ${R.pattern}`,
  '; cucitura sparsa: i punti di partenza non si incolonnano in un canale',
  `seam_position = ${R.seam}`,
  '; e le cuciture dei perimetri interni non cadono sopra quella esterna',
  'staggered_inner_seams = 1',
  '; fondo pieno per tutto lo spessore: sotto il liquido non resta riempimento rado',
  `bottom_solid_min_thickness = ${R.floorSolid}`,
  '; larghezza di estrusione che divide esattamente le pareti proposte',
  `extrusion_width = ${R.width}`,
  `perimeter_extrusion_width = ${R.width}`,
  `external_perimeter_extrusion_width = ${R.width}`,
  '; adatta la larghezza delle singole passate allo spessore che trova',
  `perimeter_generator = ${R.generator}`,
  /* Le due righe che decidono se il pezzo e' tenace o di cristallo, e che
     prima non c'erano: senza, lo slicer usa il profilo del filamento che
     l'utente ha in memoria — tipicamente 210 gradi e ventola al 100%, cioe'
     strati incollati invece di fusi. */
  '; temperatura: piu' + String.fromCharCode(39) + ' caldo salda meglio, ed e' + String.fromCharCode(39) + ' la saldatura che tiene il pezzo',
  `filament_type = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).tipo}`,
  `temperature = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).nozzle}`,
  `first_layer_temperature = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).nozzleFirst}`,
  `bed_temperature = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).bed}`,
  `first_layer_bed_temperature = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).bedFirst}`,
  '; ventola: raffredda il cordolo prima che quello sopra ci si saldi',
  'cooling = 1', 'fan_always_on = 1',
  `min_fan_speed = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).fanMin}`,
  `max_fan_speed = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).fanMax}`,
  `disable_fan_first_layers = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).fanOff}`,
  /* Gli strati piccoli — il collo, che e' un anello da Ø28 — si stampano in
     pochi secondi e senza raffreddamento slumpano. La risposta giusta non e'
     riaccendere la ventola, che rovinerebbe la saldatura su tutto il pezzo: e'
     rallentare quegli strati e dargli il tempo di solidificare da soli. */
  `slowdown_below_layer_time = ${(R.mat || MATERIALS[MATERIAL_DEFAULT]).slowLayer}`,
  'min_print_speed = 15',
  'support_material = 0', `brim_width = ${R.brim ?? 0}`, 'nozzle_diameter = ' + R.nozzle, ''].join('\n');
const orcaConfig = (R = RECIPE) => JSON.stringify({
  layer_height: String(R.layer), initial_layer_print_height: String(R.first),
  wall_loops: String(R.walls), top_shell_layers: String(R.top), bottom_shell_layers: String(R.bottom),
  sparse_infill_density: R.infill + '%', sparse_infill_pattern: R.pattern,
  seam_position: R.seam,
  bottom_shell_thickness: String(R.floorSolid),
  line_width: String(R.width),
  inner_wall_line_width: String(R.width),
  outer_wall_line_width: String(R.width),
  wall_generator: R.generator,
  /* in Orca le impostazioni del filamento sono vettori, una voce per estrusore */
  filament_type: [(R.mat || MATERIALS[MATERIAL_DEFAULT]).tipo],
  nozzle_temperature: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).nozzle)],
  nozzle_temperature_initial_layer: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).nozzleFirst)],
  hot_plate_temp: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).bed)],
  hot_plate_temp_initial_layer: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).bedFirst)],
  fan_min_speed: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).fanMin)],
  fan_max_speed: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).fanMax)],
  close_fan_the_first_x_layers: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).fanOff)],
  slow_down_layer_time: [String((R.mat || MATERIALS[MATERIAL_DEFAULT]).slowLayer)],
  slow_down_min_speed: ['15'],
  enable_support: '0', brim_type: R.brim ? 'outer_only' : 'no_brim',
  brim_width: String(R.brim ?? 0), version: '1.0.0', from: 'VORTICE',
}, null, 1);
function build3MF(parts, title, R = RECIPE){
  return zipArchive([
    { name:'[Content_Types].xml', data:'<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/plain"/></Types>' },
    { name:'_rels/.rels', data:'<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name:'3D/3dmodel.model', data: model3MF(parts, title) },
    { name:'Metadata/Slic3r_PE.config', data: slic3rConfig(R) },
    { name:'Metadata/project_settings.config', data: orcaConfig(R) },
  ]);
}

/* ================= verifica della mesh =================
   Bloccanti: coordinate non finite, indici fuori range o ripetuti, bordi aperti,
   bordi non-manifold, winding incoerente, volume ≤ 0 (normali rovesciate).
   Informative: triangoli degeneri, vertici inutilizzati, scarto di volume. */
function validateMesh(pos, ind, expectVol){
  const nV = pos.length / 3, nT = ind.length / 3, errors = [];
  for (let k = 0; k < pos.length; k++) if (!Number.isFinite(pos[k])){ errors.push('coordinate non finite'); break; }
  const used = new Uint8Array(nV);
  const keys = new Float64Array(nT * 3);
  let bad = 0, degen = 0, vol = 0;
  for (let t = 0, e = 0; t < nT; t++){
    const a = ind[t*3], b = ind[t*3+1], c = ind[t*3+2];
    if (a >= nV || b >= nV || c >= nV || a === b || b === c || a === c){ bad++; keys[e++] = -1; keys[e++] = -1; keys[e++] = -1; continue; }
    used[a] = used[b] = used[c] = 1;
    keys[e++] = a * nV + b; keys[e++] = b * nV + c; keys[e++] = c * nV + a;
    const ax=pos[a*3],ay=pos[a*3+1],az=pos[a*3+2], bx=pos[b*3],by=pos[b*3+1],bz=pos[b*3+2], cx=pos[c*3],cy=pos[c*3+1],cz=pos[c*3+2];
    const ux=bx-ax,uy=by-ay,uz=bz-az, vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    if (nx*nx + ny*ny + nz*nz < 1e-12) degen++;
    vol += ax*(by*cz-bz*cy) + ay*(bz*cx-bx*cz) + az*(bx*cy-by*cx);
  }
  vol /= 6;
  if (bad) errors.push(bad + ' triangoli con indici non validi');
  keys.sort();
  let dup = 0, open = 0;
  const has = k => { let lo = 0, hi = keys.length - 1;
    while (lo <= hi){ const m = (lo + hi) >> 1; if (keys[m] < k) lo = m + 1; else if (keys[m] > k) hi = m - 1; else return true; }
    return false; };
  for (let i = 0; i < keys.length; i++){
    const k = keys[i]; if (k < 0) continue;
    if (i > 0 && keys[i-1] === k){ dup++; continue; }
    const a = Math.floor(k / nV), b = k - a * nV;
    if (!has(b * nV + a)) open++;
  }
  if (dup)  errors.push(dup + ' bordi non-manifold o con winding incoerente');
  if (open) errors.push(open + ' bordi aperti (mesh non chiusa)');
  if (!(vol > 0)) errors.push('volume non positivo (normali rovesciate)');
  let unused = 0; for (let v = 0; v < nV; v++) if (!used[v]) unused++;
  const volErr = expectVol > 0 ? Math.abs(vol - expectVol) / expectVol : 0;
  return { ok: errors.length === 0, errors, tris: nT, verts: nV, degen, unused, vol, volErr };
}

/* il fondo è un campo di altezze sul piano: ogni triangolo del disco e della cerniera
   deve avere proiezione xy orientata verso il basso. Un segno opposto = fondo ripiegato. */
function discFolds(pos, ind, ctx){
  const rows = ctx.zs.length, nTh = ctx.nTh, nD = ctx.nD, m = nD / nTh;
  const t0 = (rows-1)*2*nTh + (rows-ctx.jB-1)*2*nTh;
  const t1 = t0 + nD + (ctx.K-2)*2*nD + nTh*(m+1);
  let f = 0;
  for (let t = t0; t < t1; t++){
    const a = ind[t*3]*3, b = ind[t*3+1]*3, c = ind[t*3+2]*3;
    if ((pos[b]-pos[a])*(pos[c+1]-pos[a+1]) - (pos[b+1]-pos[a+1])*(pos[c]-pos[a]) >= 0) f++;
  }
  return f;
}

/* ================= materiale e tempo di stampa =================
   Tarati su 8 design affettati con PrusaSlicer 2.8.1 (ugello 0,4 · layer 0,2 ·
   4 perimetri · 5+5 solidi · gyroid 6% · 45/25/60 mm/s · accelerazione 800):
   · materiale = parete + 0,67·base  (la base non è piena: 5 layer solidi + gyroid)
   · tempo = V·(0,394 + 0,353·(Q−1)), con Q = ondulazione del contorno (1 = cerchio).
   Il termine in Q coglie il rallentamento su costole, torsione e affilatura: la
   portata reale scende da 2,5 a 1,1 mm³/s. Errore sui casi di taratura: medio 8%,
   massimo 14%. Il modello volumetrico precedente sbagliava fino a −60%. */
/*
 * Materiale. Con il fondo pieno e la parete gia' tutta perimetri il pezzo non ha
 * piu' zone a riempimento rado: il materiale e' esattamente il volume della
 * geometria, senza coefficienti.
 *
 * Prima il fondo valeva 0,672 del suo volume, un rapporto misurato affettando
 * 8 design — ma un rapporto solo, mentre quello vero dipende dall'altezza
 * (0,68 a h 120, 0,54 a h 235, perche' il fondo si ingrossa e la parte a
 * riempimento cresce). Quell'errore sistematico adesso non esiste piu'.
 */
const MAT_BASE_K = 1;
const T_V = .394, T_Q = .353;
const matVolOf = st => st.wallV + MAT_BASE_K * st.solidV;
const printSeconds = (matVol, Q) => matVol * (T_V + T_Q * Math.max(0, (Q || 1) - 1));
/* ondulazione: lunghezza del contorno esterno diviso quella del cerchio equivalente */
function rippleQ(pos, ctx){
  const nTh = ctx.nTh, zs = ctx.zs, hB = ctx.P.h;
  let L = 0, C = 0;
  for (let j = 1; j < zs.length; j++){
    if (zs[j] > hB) break;
    const o = j * nTh * 3;
    let l = 0, rm = 0;
    for (let i = 0; i < nTh; i++){
      const a = o + i*3, b = o + ((i + 1) % nTh)*3;
      l += Math.hypot(pos[b] - pos[a], pos[b+1] - pos[a+1]);
      rm += Math.hypot(pos[a], pos[a+1]);
    }
    L += l; C += 2 * Math.PI * rm / nTh;
  }
  return C > 0 ? L / C : 1;
}

/* ================= valutatore veloce per la ricerca =================
   Stessa geometria dell'export a risoluzione ridotta: niente incisione, mesh mai
   indicizzata, solo le statistiche di fillVessel. Costa ~0,3 ms per candidato. */
/* tarata sul confronto con l'export: capacità ±1,4%, grammi ±2,5%, Ø ±0,5 mm */
const PS = { nTh:48, nB:160, nN:40, K:6, KD:6, mD:1, WD:10 };
const scratchPS = { pos:null, n:0 };
function evalPiece(P, profKey){
  const ctx = makeCtxFor(PS, P, profKey, null, 0);
  const r95 = ctx.r95;
  const need = vesselVerts(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD) * 3;
  if (!scratchPS.pos || scratchPS.pos.length < need) scratchPS.pos = new Float32Array(need);
  const st = fillVessel(scratchPS.pos, ctx);
  const matVol = matVolOf(st), Q = rippleQ(scratchPS.pos, ctx);
  return { capML: st.capV / 1000, matVol, Q, grams: matVol * 1.24e-3, minutes: printSeconds(matVol, Q) / 60,
    Ht: ctx.Ht, D: st.maxR * 2, R: st.maxR, tilt: Math.atan(st.maxW) * 180 / Math.PI, minRi: st.minRi, r95 };
}
/* espressività del segnale: intensità stampabile × somiglianza della curva al dato */
function evalSignal(P, profKey){
  if (!(P.amp > 0) || !P.sig) return null;
  const raw = normZero(sigRaw(P.sig));
  if (!raw) return null;
  const ring = P.sig.kind === 'ring';
  const fit = ring ? ringFor(P, profKey) : fitSignalFor(P, profKey);
  if (!fit || !(fit.A > 0)) return { A:0, corr:0, score:0 };
  const N = 128;
  let sx=0, sy=0, sxx=0, syy=0, sxy=0;
  for (let k = 0; k < N; k++){
    const x = ring ? shapeCirc(raw, k/N*TAU) : shapeAt(raw, k/(N-1)*SIG_SPAN);
    const y = ring ? shapeCirc(fit.shape, k/N*TAU) : shapeAt(fit.shape, k/(N-1)*SIG_SPAN);
    sx+=x; sy+=y; sxx+=x*x; syy+=y*y; sxy+=x*y;
  }
  const cov = sxy - sx*sy/N, vx = sxx - sx*sx/N, vy = syy - sy*sy/N;
  const corr = vx > 1e-9 && vy > 1e-9 ? Math.max(0, cov / Math.sqrt(vx*vy)) : 0;
  return { A: fit.A, corr, score: corr * fit.A / Math.max(1e-6, fit.Areq) };
}
/* un design completo (set o pezzo singolo) rispetto ai vincoli dell'utente */
function evalDesign(setP, profKey, opt){
  const keys = opt.plate ? ['disp','tooth'] : [opt.piece || 'disp'];
  const parts = keys.map(k => { const P = piecePar(setP, k); return { key:k, P, ...evalPiece(P, profKey) }; });
  const main = parts[0];
  let grams = 0, minutes = 0, Ht = 0, tilt = 0, minRi = 1e9;
  for (const p of parts){ grams += p.grams; minutes += p.minutes; Ht = Math.max(Ht, p.Ht); tilt = Math.max(tilt, p.tilt); minRi = Math.min(minRi, p.minRi); }
  const plan = opt.plate ? platePlan(setP, profKey, keys) : null;
  const fitsBed = opt.plate ? plan.fits : main.D <= BED - 2*BED_MARGIN;
  const sig = evalSignal(piecePar(setP, keys[0]), profKey);
  /* incisione: il fondo deve restare abbastanza grande per firma e codice
     (solo impaginazione, nessun raster: costa pochi microsecondi) */
  let engrave = 1;
  if (opt.logo && opt.logo.on){
    const rr = main.r95 * .98;          // margine: alla risoluzione di ricerca r95 ha ~1% di errore
    const L = layoutLogo(opt.logo, rr);
    if (L.segs.length && !L.ok) engrave = 0;
    else if (opt.logo.serial && !layoutSerial(opt.logo, opt.logo.serial, rr, L.segs.length ? L : null).ok) engrave = .6;
  }
  const V = [];                                     // violazioni, in unità confrontabili
  if (!fitsBed) V.push(1);
  if (Ht > Z_MAX_CORE) V.push((Ht - Z_MAX_CORE) / 50);
  if (tilt > 45) V.push((tilt - 45) / 10);
  if (minRi * 2 < 10) V.push((10 - minRi*2) / 10);
  if (opt.capMin && main.capML < opt.capMin) V.push((opt.capMin - main.capML) / Math.max(50, opt.capMin));
  if (opt.capMax && main.capML > opt.capMax) V.push((main.capML - opt.capMax) / Math.max(50, opt.capMax));
  if (opt.hMax && Ht > opt.hMax) V.push((Ht - opt.hMax) / 30);
  if (opt.gMax && grams > opt.gMax) V.push((grams - opt.gMax) / Math.max(20, opt.gMax * .2));
  if (opt.tMax && minutes > opt.tMax * 60) V.push((minutes - opt.tMax * 60) / 60);
  let viol = 0; for (const v of V) viol += v;
  const goal = opt.goal === 'cap' ? main.capML / 1500
             : opt.goal === 'time' ? 1 - Math.min(1, minutes / 900)
             : sig ? sig.score : main.capML / 1500;     // fedeltà, o capacità se non c'è segnale
  return { parts, main, plan, grams, minutes, Ht, tilt, minRi, capML: main.capML, fitsBed, sig, viol, engrave,
    /* l'incisione non è un vincolo ma pesa: a parità di risultato vince il fondo che la contiene */
    score: viol > 0 ? -viol : goal * (.75 + .25 * engrave) };
}
const Z_MAX_CORE = 250;

/* ================= progettazione inversa =================
   Ricerca deterministica (seme fisso): campionamento largo, poi discesa per
   coordinate sui migliori semi. I vincoli sono penalità; a parità di fattibilità
   vince l'obiettivo scelto. Il vincitore viene riverificato alla risoluzione
   dell'export, perché il valutatore veloce ha un margine di qualche punto percentuale. */
const SEARCH_VARS = [
  { k:'h',      lo:120, hi:235, step:1 },
  { k:'r',      lo:30,  hi:100, step:1 },
  { k:'petals', lo:3,   hi:9,   step:1 },
  { k:'twist',  lo:0,   hi:360, step:5 },
  { k:'sharp',  lo:0,   hi:1,   step:.02 },
];
const PROF_KEYS = ['clessidra','fiamma','tornado','bulbo'];
/* Margine di sicurezza del valutatore veloce. Era 3%: misurato sui preset dopo
   la cavita' erosa lo scarto sul materiale arriva al 3,7%, perche' a 48
   campioni angolari il poligono dello strato e' grossolano e l'erosione ci
   legge qualche decimo in meno. Il vincitore viene comunque riverificato alla
   risoluzione dell'export: il margine serve solo a non proporre un finalista
   che poi sfora. */
const SEARCH_MARGIN = .05;
function quant(v, va){ return Math.min(va.hi, Math.max(va.lo, Math.round(v / va.step) * va.step)); }
function runSearch(job){
  const user = job.opt || {}, base = job.P;
  /* margine di sicurezza: il valutatore veloce ha ±4%, quindi cerco un po' più stretto
     dei limiti richiesti, così il controllo esatto non li supera */
  const M = 1 - SEARCH_MARGIN, opt = { ...user,
    gMax: user.gMax ? user.gMax * M : 0,
    tMax: user.tMax ? user.tMax * M : 0,
    hMax: user.hMax ? user.hMax - 2 : 0,
    capMin: user.capMin ? user.capMin / M : 0 };
  let seed = 20260918 >>> 0;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  let evals = 0;
  const score = cand => {
    evals++;
    const P = { ...base, ...cand.v, piece:'disp' };
    const e = evalDesign(P, cand.prof, opt);
    return { ...cand, e, s:e.score };
  };
  const seeds = [];
  const N1 = opt.wide ? 900 : 600;
  for (let i = 0; i < N1; i++){
    const v = {};
    for (const va of SEARCH_VARS) v[va.k] = quant(va.lo + rnd() * (va.hi - va.lo), va);
    seeds.push(score({ v, prof: PROF_KEYS[Math.floor(rnd() * 4)] }));
  }
  /* il design attuale è sempre un candidato: la ricerca non può peggiorarlo */
  for (const prof of PROF_KEYS){
    const v = {}; for (const va of SEARCH_VARS) v[va.k] = base[va.k];
    seeds.push(score({ v, prof }));
  }
  seeds.sort((a, b) => b.s - a.s);
  const out = [];
  for (const sd of seeds.slice(0, 10)){
    let cur = sd;
    for (let pass = 0; pass < 3; pass++){
      const shrink = [1, .45, .2][pass];
      for (const va of SEARCH_VARS){
        const span = Math.max(va.step, (va.hi - va.lo) * .18 * shrink);
        for (const d of [-span, span, -span/3, span/3]){
          const v = { ...cur.v }; v[va.k] = quant(v[va.k] + d, va);
          if (v[va.k] === cur.v[va.k]) continue;
          const t = score({ v, prof: cur.prof });
          if (t.s > cur.s) cur = t;
        }
      }
    }
    out.push(cur);
  }
  out.sort((a, b) => b.s - a.s);
  /* risultati distinti: scarta i quasi-uguali */
  const picks = [];
  for (const c of out){
    if (picks.some(p => p.prof === c.prof && Math.abs(p.v.h - c.v.h) < 8 && Math.abs(p.v.r - c.v.r) < 5
        && Math.abs(p.v.petals - c.v.petals) <= 1 && Math.abs(p.v.twist - c.v.twist) < 30)) continue;
    picks.push(c);
    if (picks.length === 3) break;
  }
  /* verifica alla risoluzione dell'export */
  const results = picks.map(c => {
    const keys = opt.plate ? ['disp','tooth'] : [opt.piece || 'disp'];
    const setP = { ...base, ...c.v };
    let grams = 0, minutes = 0, Ht = 0, tilt = 0, capML = 0;
    keys.forEach((k, i) => {
      const P = piecePar(setP, k);
      const ctx = makeExportCtx(P, c.prof, null, 0);
      const pos = new Float32Array(vesselVerts(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD) * 3);
      const st = fillVessel(pos, ctx);
      const mv = matVolOf(st);
      grams += mv * 1.24e-3; minutes += printSeconds(mv, rippleQ(pos, ctx)) / 60; Ht = Math.max(Ht, ctx.Ht); tilt = Math.max(tilt, Math.atan(st.maxW) * 180 / Math.PI);
      if (i === 0) capML = st.capV / 1000;
    });
    const plan = opt.plate ? platePlan(setP, c.prof, keys) : null;
    /* esito sui valori ESATTI, non su quelli della ricerca */
    const bad = [];
    if (plan ? !plan.fits : c.e.main.D > BED - 2*BED_MARGIN) bad.push('non entra nel piatto');
    if (Ht > Z_MAX_CORE) bad.push('oltre la corsa Z');
    if (tilt > 45) bad.push(`pareti ${tilt.toFixed(0)}°`);
    if (user.hMax && Ht > user.hMax) bad.push(`h ${Math.round(Ht)} > ${user.hMax} mm`);
    if (user.gMax && grams > user.gMax) bad.push(`${Math.round(grams)} > ${user.gMax} g`);
    if (user.tMax && minutes > user.tMax * 60) bad.push(`${(minutes/60).toFixed(1)} > ${user.tMax} h`);
    if (user.capMin && capML < user.capMin) bad.push(`${Math.round(capML)} < ${user.capMin} ml`);
    if (user.capMax && capML > user.capMax) bad.push(`${Math.round(capML)} > ${user.capMax} ml`);
    return { v:c.v, prof:c.prof, ok: bad.length === 0, bad,
      engrave: c.e.engrave,
      exact:{ capML, grams, minutes, Ht, tilt, fits: plan ? plan.fits : c.e.fitsBed, layout: plan && plan.layout,
              W: plan && plan.W, D: plan ? plan.D : c.e.main.D },
      sig: c.e.sig ? { corr:c.e.sig.corr, A:c.e.sig.A } : null };
  });
  return { ok:true, search:true, evals, results };
}

/* ================= piatto condiviso =================
   Ingombro di un pezzo senza costruire la mesh: raggio massimo del guscio
   (costole al colmo + eventuale voce) e altezza totale. */
const BED = 220, BED_MARGIN = 5, PIECE_GAP = 6;
function pieceExtent(P, profKey){
  const n = neckSpec(P), rows = pieceRows(P, PE), zs = new Float64Array(rows);
  buildRows(P, n, PE.nB, PE.nN, zs);
  const Bo = new Float64Array(rows), Bi = new Float64Array(rows);
  const vr = ringFor(P, profKey);
  clampProfile(P, n, profileFn(P, profKey), zs, new Float64Array(rows), Bo, Bi, vr);
  const a = P.sharp*.42, bb = P.sharp*P.sharp*.10;
  let R = 0;
  for (let j = 0; j < rows; j++){
    const t = Math.min(1, zs[j] / P.h), u = Math.min(1, Math.max(0, (t - .6) / .4));
    const fade = n.open ? 1 : 1 - u*u*(3 - 2*u);
    const ring = vr ? vr.A * ringBand(zs[j], vr)[0] : 0;
    R = Math.max(R, Bo[j] * (1 + fade * (a - bb + ring)));
  }
  return { R, H: zs[rows-1], name: pieceOf(P).name };
}
/* disposizione: prima affiancati lungo X (più leggibile), altrimenti in diagonale
   agli angoli opposti, dove un piatto quadrato offre molto più spazio */
function platePlan(setP, profKey, keys){
  const items = keys.map(k => { const P = piecePar(setP, k); const e = pieceExtent(P, profKey); return { key:k, P, ...e }; });
  const free = BED - 2 * BED_MARGIN, half = free / 2;
  let H = 0; for (const it of items) H = Math.max(H, it.H);
  const tooBig = items.find(it => 2 * it.R > free);
  if (tooBig) return { items, H, free, fits:false, why:`${tooBig.name}: Ø ${Math.ceil(2*tooBig.R)} mm su ${free} utili` };
  let W = 0; for (const it of items) W += 2 * it.R;
  W += PIECE_GAP * (items.length - 1);
  if (W <= free){                                   // affiancati e centrati
    let x = -W / 2;
    for (const it of items){ it.x = x + it.R; it.y = 0; x += 2 * it.R + PIECE_GAP; }
    return { items, H, free, fits:true, layout:'fila', W, D: Math.max(...items.map(i => 2*i.R)) };
  }
  if (items.length === 2){                          // diagonale: angoli opposti
    const [a, b] = items;
    const pa = half - a.R, pb = half - b.R;
    const dist = Math.hypot(pa + pb, pa + pb);
    if (dist >= a.R + b.R + PIECE_GAP){
      a.x = -pa; a.y = -pa; b.x = pb; b.y = pb;
      return { items, H, free, fits:true, layout:'diagonale',
        W: Math.max(a.x + a.R, b.x + b.R) - Math.min(a.x - a.R, b.x - b.R),
        D: Math.max(a.y + a.R, b.y + b.R) - Math.min(a.y - a.R, b.y - b.R) };
    }
    return { items, H, free, fits:false, W, why:`servono ${Math.ceil(a.R + b.R + PIECE_GAP)} mm tra i centri, ne restano ${Math.floor(dist)} in diagonale` };
  }
  return { items, H, free, fits:false, W, why:`servono ${Math.ceil(W)} mm in fila su ${free} utili` };
}

/* ================= lavoro di esportazione completo ================= */
function runExport(job){
  if (job.kind === 'search') return runSearch(job);
  if (job.kind === 'plate') return runPlate(job);
  if (job.kind === 'coupon') return runCoupon(job);
  const P = job.P;
  let ctx, label, st = null, raster = null;
  if (job.kind === 'ring'){
    ctx = makeRingCtx(P);
    label = 'VORTICE spool di prova, filetto esterno destro';
  } else {
    raster = buildLogoRaster(job.logo, targetR95(P, job.profKey));
    ctx = makeExportCtx(P, job.profKey, raster, job.logo.depth);
    const code = typeof job.logo.serial === 'string' && job.logo.serial ? job.logo.serial + ' ' : '';
    label = 'VORTICE ' + code + (pieceOf(P).neck
      ? 'dispenser cavo, collo GPI esterno, firma incisa sul fondo'
      : pieceOf(P).name.toLowerCase() + ' aperto, guscio cavo, firma incisa sul fondo');
  }
  const pos = new Float32Array(vesselVerts(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD) * 3);
  st = fillVessel(pos, ctx);
  const ind = vesselIndex(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD);
  const check = validateMesh(pos, ind, job.kind === 'ring' ? 0 : st.solidV + st.wallV);
  const folds = discFolds(pos, ind, ctx);
  if (folds){ check.ok = false; check.errors.push(folds + ' triangoli del fondo ripiegati (disco oltre la parete)'); }
  /* La mesh puo' essere chiusa e il pezzo perdere lo stesso: un guscio piu'
     sottile di quanto lo slicer riesce a chiudere non tiene il liquido.
     Vale solo per i pezzi cavi; lo spool di prova del filetto e' pieno. */
  if (job.kind !== 'ring' && st.minWall > 0 && st.minWall < WALL_SEAL_MIN - .01){
    check.ok = false;
    check.errors.push(`parete di soli ${st.minWall.toFixed(2)} mm ` +
      `(servono ${WALL_SEAL_MIN.toFixed(2)} mm perche' i perimetri si chiudano)`);
  }
  check.minWall = st.minWall;
  if (!check.ok) return { ok:false, error:'mesh non valida: ' + check.errors.join(' · '), check };
  if (job.format === '3mf'){
    const name = (job.logo && job.logo.serial ? job.logo.serial + ' · ' : '') + pieceOf(P).name;
    /* lo spool di prova e' pieno: non ha parete da riempire, tiene la ricetta base */
    const R = job.kind === 'ring' ? { ...RECIPE, mat: materialOf(job.mat) }
                                 : recipeFor(P, st.thickMax, job.mat);
    return build3MF([{ name, pos, ind, x:0, y:0 }], label, R).then(buffer => ({
      ok:true, buffer, check, Ht:ctx.Ht, D: st.maxR * 2, minRi: st.minRi, minWall: st.minWall,
      tilt: Math.atan(st.maxW) * 180 / Math.PI, depth: ctx.Ht - ctx.zs[ctx.jB],
      serialOk: !!(raster && raster.serialOk), format:'3mf',
    }));
  }
  const buffer = buildSTLBuffer(pos, ind, label);
  return { ok:true, buffer, check, Ht:ctx.Ht, D: st.maxR * 2, minRi: st.minRi, minWall: st.minWall,
           tilt: Math.atan(st.maxW) * 180 / Math.PI,
           depth: ctx.Ht - ctx.zs[ctx.jB], serialOk: !!(raster && raster.serialOk) };
}

G.VCore = { TAU, sstep, clamp, PROFILES, RRES, WALL_FLOOR, WALL_SEAL_MIN, RECIPE_WALLS_MAX, layoutLogo, buildLogoRaster, logoDepth, neckSpec,
  buildRows, clampProfile, targetR95, buildRadK, buildRadKBands, layoutSerial, fillVessel, vesselVerts, vesselTriCount,
  writeVesselIndex, vesselIndex, PN, PE, discCounts, discSpec, mkScratch, baseCtx, firstInnerRow, exportFloorRow, exportFloorZ, floorMin, FLOOR_MIN,
  makeExportCtx, makeRingCtx, buildSTLBuffer, validateMesh, discFolds, r95Of, runExport, PIECES, pieceOf, piecePar, pieceRows,
  matVolOf, printSeconds, rippleQ, build3MF, model3MF, zipArchive, RECIPE, recipeFor, recipeForAll, recipeWalls,
  MATERIALS, MATERIAL_DEFAULT, materialOf, COUPON, boxMesh, runCoupon, BED, BED_MARGIN, PIECE_GAP, pieceExtent, platePlan, runPlate,
  PS, makeCtxFor, evalPiece, evalSignal, evalDesign, runSearch, SEARCH_VARS,
  SIG_N, SIG_SPAN, SIG_SIGMA_MAX, SIG_TOL, B64U, sigValid, sigEncode, sigRaw, smoothNorm,
  shapeAt, sigWeight, sigRig, sigResidual, fitSignal, fitSignalFor, fitProfile, profileFn,
  RING_SIGMA_MAX, RING_TOP, ringBand, gaussCirc, shapeCirc, ringRamp, ringTable, fitRing, ringFor, normZero, clampProfile };

/* dentro un Worker: risponde ai lavori di esportazione */
if (typeof WorkerGlobalScope !== 'undefined' && G instanceof WorkerGlobalScope){
  G.onmessage = e => {
    const { id, job } = e.data;
    try{
      const r = runExport(job);
      Promise.resolve(r).then(v => G.postMessage({ id, ...v }, v.buffer ? [v.buffer] : []))
        .catch(err => G.postMessage({ id, ok:false, error: String(err && err.message || err) }));
    }catch(err){
      G.postMessage({ id, ok:false, error: String(err && err.message || err) });
    }
  };
}
})(typeof self !== 'undefined' ? self : globalThis);
