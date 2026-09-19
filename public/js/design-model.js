/* =====================================================================
   DESIGN MODEL · lo stato di un design e la sua geometria di anteprima.
   Non conosce né il DOM né Three.js: produce buffer di vertici/indici e
   una scheda di misure. Lo usano identico lo studio (con animazione e
   controlli) e il visualizzatore pubblico (fermo, in sola lettura).

   Nella V3 single-file questa logica era intrecciata con l'interfaccia:
   separarla è ciò che rende possibile una pagina pubblica che mostra il
   pezzo senza portarsi dietro un solo comando di modifica.
   ===================================================================== */
import {
  RANGES, PROFILE_KEYS, defaultState, normalizeState, designFingerprint,
} from './design-spec.js';

const V = globalThis.VCore;
if (!V) throw new Error('VCore non caricato: includi /js/vcore.js prima di questo modulo');

const {
  PROFILES, PIECES, piecePar, platePlan, clamp, neckSpec, buildRows, clampProfile,
  targetR95, fillVessel, vesselTriCount, writeVesselIndex, PN, PE, discCounts, discSpec,
  r95Of, SIG_SPAN, SIG_SIGMA_MAX, sigRaw, smoothNorm, shapeAt, sigWeight, fitSignal,
  fitProfile, fitRing, ringTable, shapeCirc, normZero, baseCtx, firstInnerRow,
  exportFloorRow, matVolOf, printSeconds, rippleQ, pieceRows, buildLogoRaster,
} = V;

export const PLATE_PIECES = ['disp', 'tooth'];
export const Z_MAX = 250;
export const BED = 220;
export const PASS_MIN = 10;      // Ø minimo del passaggio interno perché la cannuccia arrivi al fondo
export const FID_MIN = .5;       // sotto questa correlazione il dato non si riconosce più
export const TILT_MAX = 45;      // oltre questa pendenza servirebbero i supporti

const ease = x => x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;
const pct = x => Math.round(x * 100) + '%';

/* soglie di arresto dell'animazione: sotto queste il valore scatta a destinazione */
const EPS = { h:.05, r:.05, twist:.05, sharp:.002, w:.004, thD:.02, pitch:.005, turns:.005, amp:.001 };
const ANIM_KEYS = Object.keys(EPS);

export class DesignModel {
  /**
   * @param {object}  opts
   * @param {boolean} opts.animate  false = nessuna transizione (viewer pubblico)
   */
  constructor({ animate = true } = {}){
    this.animate = animate;
    const d = defaultState();

    /* cur = valori mostrati ora, tgt = valori richiesti. Con animate=false
       coincidono sempre e il modello si comporta come una funzione pura. */
    this.cur = { h:animate ? 2 : d.P.h, r:animate ? 6 : d.P.r, petals:d.P.petals,
                 twist:animate ? 0 : d.P.twist, sharp:animate ? 0 : d.P.sharp,
                 w:d.P.w, thD:d.P.thD, pitch:d.P.pitch, turns:d.P.turns, amp:0 };
    this.tgt = { ...d.P, amp:0, sig:null };

    this.piece = d.piece === 'plate' ? 'disp' : d.piece;
    this.plateMode = d.piece === 'plate';
    /* il cambio pezzo è una transizione, non un salto: questi fattori sono animati */
    this.pieceK = { h: PIECES[this.piece].hK, r: PIECES[this.piece].rK };

    this.sig = { ...d.sig };
    this.sigStore = { gpx:null, voce:null };   // ultimo dato per fonte: cambiare scheda non lo perde
    this.sigPrev = null;                        // specifica attiva: serve anche alla dissolvenza in spegnimento

    this.logo = { ...d.logo, serial:'' };
    this.logoRaster = null;

    this.profKey = d.profile;
    this.profFrom = PROFILES[d.profile];
    this.profTo = this.profFrom;
    this.profBlend = 1;
    this.smoothNormals = true;

    this.curP = piecePar(this.cur, this.piece);
    this.tgtP = piecePar(this.tgt, this.piece);

    /* due slot: il secondo serve solo quando si guarda il set sul piatto */
    this.rows = PN.nB + PN.nN;
    const D0 = discCounts(PN, false), D1 = discCounts(PN, true);
    this.vertCap = Math.max(V.vesselVerts(this.rows, PN.nTh, 1, D0.K, D0.nD),
                            V.vesselVerts(this.rows, PN.nTh, 1, D1.K, D1.nD));
    this.idxCap = Math.max(vesselTriCount(this.rows, PN.nTh, 1, D0.K, D0.nD),
                           vesselTriCount(this.rows, PN.nTh, 1, D1.K, D1.nD)) * 3;
    this.slots = [this.#makeSlot(), this.#makeSlot()];

    /* buffer di servizio per il confronto "con segnale / senza segnale" */
    this.fidBo = new Float64Array(this.rows);
    this.fidBi = new Float64Array(this.rows);
    this.fidRc = new Float64Array(this.rows);

    this.metrics = null;
    this.lastFit = null;
    this.fitMemo = { key:'', fit:null, hintKey:'', hint:null };

    this.#syncPieceP();
    this.rebuildLogoRaster();
  }

  #makeSlot(){
    const ctx = baseCtx(this.curP, PN.nTh, PN.K);
    ctx.buf = { zb: new Float64Array(this.rows), ob: new Float64Array(this.rows), ib: new Float64Array(this.rows) };
    return {
      pos: new Float32Array(this.vertCap * 3),
      idx: new Uint32Array(this.idxCap),
      draw: 0,
      sphere: { x:0, y:0, z:0, r:100 },
      place: { x:0, y:0, footR:0 },
      visible: false,
      ctx,
    };
  }

  /* ===================== profilo in quota ===================== */

  /** Profilo corrente, eventualmente in dissolvenza fra due preset. */
  profAt = t => this.profBlend >= 1
    ? this.profTo(t)
    : this.profFrom(t) + (this.profTo(t) - this.profFrom(t)) * ease(this.profBlend);

  #snapshotProfile(){
    if (this.profBlend >= 1) return this.profTo;
    const f = this.profFrom, g = this.profTo, e = ease(this.profBlend);
    return t => f(t) + (g(t) - f(t)) * e;
  }

  setProfile(key, animate = this.animate){
    if (!PROFILE_KEYS.includes(key)) return;
    if (animate){
      this.profFrom = this.#snapshotProfile();
      this.profTo = PROFILES[key];
      this.profBlend = 0;
    } else {
      this.profFrom = this.profTo = PROFILES[key];
      this.profBlend = 1;
    }
    this.profKey = key;
  }

  /* ===================== pezzo del set ===================== */

  #syncPieceP(){
    Object.assign(this.tgtP, piecePar(this.tgt, this.piece));
    Object.assign(this.curP, this.cur, {
      piece: this.piece,
      h: clamp(this.cur.h * this.pieceK.h, 40, 235),
      r: clamp(this.cur.r * this.pieceK.r, 20, 110),
      /* la torsione scala con l'altezza: i pezzi del set condividono
         l'INCLINAZIONE dell'elica, non l'angolo totale */
      twist: this.cur.twist * this.pieceK.h,
    });
  }

  setPiece(key, animate = this.animate){
    if (!PIECES[key] || key === this.piece) return;
    this.plateMode = false;
    this.piece = key;
    if (!animate){ this.pieceK.h = PIECES[key].hK; this.pieceK.r = PIECES[key].rK; }
    this.#syncPieceP();
    this.rebuildLogoRaster();
  }

  setPlateMode(on){ this.plateMode = !!on; }

  /* ===================== segnale personale ===================== */

  get sigActive(){ return this.sig.on && !!this.sig.q; }

  /** GPX → silhouette in quota; voce → anello attorno alla circonferenza. */
  sigSpec(){
    return { q:this.sig.q, smooth:this.sig.smooth, rev:this.sig.rev, inv:this.sig.inv,
             kind: this.sig.src === 'voce' ? 'ring' : 'sil' };
  }

  /**
   * Allinea il bersaglio del segnale allo stato dell'interfaccia.
   * @param {boolean} regrow  true = un cambio di forma riparte da intensità 0
   *                          (la nuova curva cresce invece di scattare)
   */
  syncSignal(regrow = true){
    if (this.sigActive){
      const spec = this.sigSpec();
      const p = this.sigPrev;
      if (regrow && this.animate && p &&
          (p.q !== spec.q || p.rev !== spec.rev || p.inv !== spec.inv || p.kind !== spec.kind))
        this.cur.amp = 0;
      this.sigPrev = spec;
    }
    this.tgt.amp = this.sigActive ? this.sig.amp : 0;
    this.tgt.sig = this.sigActive ? this.sigSpec() : null;
    if (!this.animate) this.cur.amp = this.tgt.amp;
  }

  /** Carica un nuovo dato (64 campioni già codificati) per una fonte. */
  loadSignal(src, q, meta){
    Object.assign(this.sig, { on:true, src, q, meta });
    this.sigStore[src] = { q, meta };
    this.syncSignal(true);
    this.rebuildLogoRaster();
  }

  /* ===================== logo e codice incisi ===================== */

  /**
   * Ricostruisce il raster dell'incisione sul fondo.
   * @param {string|null} serial  codice da incidere; null = impronta del design
   */
  rebuildLogoRaster(serial = this.serialOverride ?? null){
    this.logo.serial = this.logo.sn ? (serial || this.fingerprint()) : '';
    this.#syncPieceP();
    this.logoRaster = buildLogoRaster(this.logo, targetR95(this.tgtP, this.profKey));
  }

  /** Forza il codice inciso (quello di produzione, dopo la pubblicazione). */
  setSerial(code){
    this.serialOverride = code || null;
    this.rebuildLogoRaster();
  }

  get engraved(){ return !!(this.logo.on && this.logoRaster && this.logoRaster.ok); }

  /* ===================== stato canonico ===================== */

  /** Stato canonico del design (quello che finisce nel link e nel database). */
  getState(){
    const P = this.tgt;
    return normalizeState({
      piece: this.plateMode ? 'plate' : this.piece,
      profile: this.profKey,
      P: { h:P.h, r:P.r, petals:P.petals, twist:P.twist, sharp:P.sharp,
           w:P.w, thD:P.thD, pitch:P.pitch, turns:P.turns },
      logo: { on:this.logo.on, text:this.logo.text, size:this.logo.size,
              depth:this.logo.depth, arc:this.logo.arc, rot:this.logo.rot, sn:this.logo.sn },
      sig: { ...this.sig },
    });
  }

  fingerprint(){ return designFingerprint(this.getState()); }

  /** Applica uno stato canonico. Con animate=false il modello ci salta sopra. */
  applyState(input, animate = this.animate){
    const s = normalizeState(input);
    Object.assign(this.tgt, s.P);
    Object.assign(this.logo, s.logo);

    const piece = s.piece === 'plate' ? this.piece : s.piece;
    this.plateMode = s.piece === 'plate';
    if (piece !== this.piece){
      this.piece = piece;
      if (!animate){ this.pieceK.h = PIECES[piece].hK; this.pieceK.r = PIECES[piece].rK; }
    }

    Object.assign(this.sig, s.sig);
    if (this.sig.on && this.sig.q) this.sigStore[this.sig.src] = { q:this.sig.q, meta:this.sig.meta || '' };
    this.syncSignal(animate);

    if (s.profile !== this.profKey) this.setProfile(s.profile, animate);
    if (!animate) this.settle();
    this.#syncPieceP();
    this.rebuildLogoRaster();
    return s;
  }

  /** Porta immediatamente cur su tgt: nessuna transizione residua. */
  settle(){
    for (const k of ANIM_KEYS) this.cur[k] = this.tgt[k];
    this.cur.petals = this.tgt.petals;
    this.pieceK.h = PIECES[this.piece].hK;
    this.pieceK.r = PIECES[this.piece].rK;
    this.profFrom = this.profTo = PROFILES[this.profKey];
    this.profBlend = 1;
    this.#syncPieceP();
  }

  /** Avanza l'animazione. @returns {boolean} true se qualcosa si è mosso. */
  step(dt){
    if (!this.animate) return false;
    let moved = false;
    for (const k of ANIM_KEYS){
      const d = this.tgt[k] - this.cur[k];
      if (Math.abs(d) > EPS[k]){ this.cur[k] += d * Math.min(1, dt * 7); moved = true; }
      else if (this.cur[k] !== this.tgt[k]){ this.cur[k] = this.tgt[k]; moved = true; }
    }
    if (this.cur.petals !== this.tgt.petals){ this.cur.petals = this.tgt.petals; moved = true; }
    for (const k of ['h', 'r']){
      const t = PIECES[this.piece][k + 'K'], d = t - this.pieceK[k];
      if (Math.abs(d) > .002){ this.pieceK[k] += d * Math.min(1, dt * 7); moved = true; }
      else this.pieceK[k] = t;
    }
    if (this.profBlend < 1){ this.profBlend = Math.min(1, this.profBlend + dt * 2.6); moved = true; }
    return moved;
  }

  /* ===================== costruzione della geometria ===================== */

  /** Riempie uno slot con la geometria di un pezzo. */
  #buildSlot(slot, P){
    const ctx = slot.ctx;
    const n = neckSpec(P);
    const rows = n.open ? PN.nB : this.rows;
    if (!ctx.zs || ctx.zs.length !== rows){
      const b = ctx.buf;
      ctx.zs = b.zb.subarray(0, rows);
      ctx.Bo = b.ob.subarray(0, rows);
      ctx.Bi = b.ib.subarray(0, rows);
    }
    ctx.P = P; ctx.open = !!n.open;
    buildRows(P, n, PN.nB, PN.nN, ctx.zs);

    const prev = this.sigPrev;
    const rp = (P.amp > 0 && prev && prev.kind === 'ring') ? fitRing(P, this.profAt, prev, P.amp) : null;
    const ring = rp && rp.A > 0 ? rp : null;
    const fit = (P.amp > 0 && prev && prev.kind !== 'ring') ? fitSignal(P, this.profAt, prev, P.amp) : null;

    clampProfile(P, n, fitProfile(this.profAt, fit), ctx.zs,
      new Float64Array(ctx.zs.length), ctx.Bo, ctx.Bi, ring);

    ctx.vr = ring ? { A:ring.A, ramp:ring.ramp, zTop:ring.zTop, cth: ringTable(ring, PN.nTh) } : null;
    ctx.n = n;
    ctx.jB = firstInnerRow(ctx.zs);
    ctx.zBase = P.h;
    ctx.Ht = ctx.zs[ctx.zs.length - 1];
    ctx.r95 = r95Of(P, this.profAt(0), ctx.Bo[0]);

    const raster = (this.logo.on && this.logoRaster && this.logoRaster.ok) ? this.logoRaster : null;
    ctx.raster = raster;
    ctx.depth = this.logo.depth;
    Object.assign(ctx, discSpec(PN, raster, ctx.r95));

    const st = fillVessel(slot.pos, ctx);
    const tri = writeVesselIndex(slot.idx, ctx.zs.length, PN.nTh, ctx.jB, ctx.K, ctx.nD);
    slot.idx.fill(0, tri);
    slot.draw = tri;
    slot.sphere.x = 0; slot.sphere.y = 0; slot.sphere.z = ctx.Ht * .5;
    slot.sphere.r = Math.hypot(ctx.Ht * .5, st.maxR) + 10;
    return { st, fit, ring };
  }

  /**
   * Ricostruisce la geometria e (opzionalmente) la scheda di misure.
   * @param {boolean} withMetrics  false durante l'animazione fluida
   */
  build(withMetrics = true){
    this.#syncPieceP();
    const A = this.#buildSlot(this.slots[0], this.curP);
    this.lastFit = A.fit;
    this.slots[0].visible = true;

    let plan = null, B = null;
    if (this.plateMode){
      plan = platePlan(this.cur, this.profKey, PLATE_PIECES);
      const otherKey = PLATE_PIECES.find(k => k !== this.piece) || 'tooth';
      B = this.#buildSlot(this.slots[1], piecePar(this.cur, otherKey));
      const mine = plan.items.find(i => i.key === this.piece) || plan.items[0];
      const his = plan.items.find(i => i !== mine);
      this.slots[0].place = { x:mine.x, y:mine.y, footR:mine.R };
      this.slots[1].place = { x:his.x, y:his.y, footR:his.R };
    } else {
      this.slots[0].place = { x:0, y:0, footR:0 };
    }
    this.slots[1].visible = this.plateMode;

    if (withMetrics) this.metrics = this.#readout(A.st, plan, B && B.st);
    return this.metrics;
  }

  /* ===================== scheda di misure ===================== */

  /* La base piena dell'anteprima è più grossolana di quella dell'export:
     riporta il volume allo spessore che il pavimento avrà davvero nell'STL. */
  #fixBase(st, ctx){
    const exportFloor = ctx.P.h * exportFloorRow(ctx.P.h) / (PE.nB - 1);
    const previewFloor = ctx.zs[ctx.jB] || exportFloor;
    return st.wallV + (matVolOf(st) - st.wallV) * (exportFloor / previewFloor);
  }

  #readout(st, plan, stB){
    const ctx = this.slots[0].ctx;
    const P = this.curP;
    const diameter = st.maxR * 2;
    const height = ctx.Ht;
    const tilt = Math.atan(st.maxW) * 180 / Math.PI;
    const capML = st.capV / 1000;

    const floorZ = P.h * exportFloorRow(P.h) / (PE.nB - 1);
    const matVol = this.#fixBase(st, ctx);
    const q = rippleQ(this.slots[0].pos, ctx);
    const seconds = printSeconds(matVol, q);
    const seal = this.engraved ? floorZ - this.logo.depth : floorZ;
    const pass = st.minRi * 2;

    const signal = this.#signalReadout();

    const issues = [];
    const overXY = diameter - BED, overZ = height - Z_MAX;
    if (overXY > 0) issues.push(`sfora il piatto di ${Math.ceil(overXY)} mm — riduci raggio o affilatura`);
    if (overZ > 0) issues.push(`supera i ${Z_MAX} mm di corsa Z di ${Math.ceil(overZ)} mm — riduci l'altezza o i giri del filetto`);
    if (tilt > TILT_MAX) issues.push(`pareti a ${tilt.toFixed(0)}° — ` + tiltHint(this.cur, st.maxWz, st.maxWall));
    if (pass < PASS_MIN)
      issues.push(`strozzatura interna Ø ${pass.toFixed(0)} mm — la cannuccia rischia di non arrivare al fondo; riduci l'intensità del segnale o la parete`);
    const R = this.logoRaster;
    if (this.logo.on && this.logo.sn && R && (R.ok || R.blank) && !R.serialOk)
      issues.push('il codice non entra nel fondo e verrà omesso — riduci il corpo testo o aumenta il raggio base');
    if (this.logo.on && R && !R.ok && !R.blank)
      issues.push('logo troppo lungo per il fondo — accorcia il testo, riduci il corpo' + (this.logo.arc ? '' : ' o passa ad arco'));

    let plate = null;
    if (this.plateMode && plan){
      const matA = this.#fixBase(st, ctx);
      const matB = stB ? this.#fixBase(stB, this.slots[1].ctx) : 0;
      const secA = printSeconds(matA, rippleQ(this.slots[0].pos, ctx));
      const secB = stB ? printSeconds(matB, rippleQ(this.slots[1].pos, this.slots[1].ctx)) : 0;
      plate = {
        fits: plan.fits, layout: plan.layout, why: plan.why,
        W: plan.W, D: plan.D, free: plan.free, H: plan.H,
        overZ: plan.H > Z_MAX,
        grams: (matA + matB) * 1.24e-3,
        cm3: (matA + matB) / 1000,
        seconds: secA + secB,
      };
    }

    return {
      piece: this.piece,
      plateMode: this.plateMode,
      diameter, height, capML, tilt, pass, seal,
      depth: height - floorZ,
      matVol, grams: matVol * 1.24e-3, meters: matVol / 2405, seconds,
      tris: vesselTriCount(pieceRows(P, PE), PE.nTh, exportFloorRow(P.h),
        discCounts(PE, this.engraved).K, discCounts(PE, this.engraved).nD),
      fitsBed: overXY <= 0 && overZ <= 0,
      tiltOk: tilt <= TILT_MAX,
      passOk: pass >= PASS_MIN,
      sealOk: seal >= 1.5,
      issues,
      ok: issues.length === 0,
      plate,
      signal,
    };
  }

  /* ===================== lettura del segnale ===================== */
  /* Fedeltà = correlazione di Pearson fra il dato originale e la modulazione
     davvero presente nel guscio. Dice quanto del percorso (o della voce) si
     riconosce ancora dopo che il limitatore dei 44° ha fatto il suo lavoro. */

  #signalReadout(){
    if (!this.sigActive) return null;
    const spec = this.sigSpec();
    const key = JSON.stringify([this.piece, this.tgt.h, this.tgt.r, this.tgt.petals, this.tgt.twist,
      this.tgt.sharp, this.tgt.w, this.tgt.thD, this.tgt.pitch, this.tgt.turns,
      this.sig.amp, this.profKey, spec]);
    return spec.kind === 'ring' ? this.#ringReadout(spec, key) : this.#silhouetteReadout(spec, key);
  }

  /* Il suggerimento è calcolato, non generico: prova le tre modifiche del vaso
     che liberano più budget di pendenza e riporta quella che rende di più. */
  #adaptHint(fitter, spec, key, current){
    if (this.fitMemo.hintKey !== key){
      const tries = [
        ['affilatura a 0%', { sharp:0 }],
        ['torsione a 0°', { twist:0 }],
        [`altezza a ${RANGES.h.max} mm`, { h: RANGES.h.max }],
      ];
      let best = null;
      for (const [label, change] of tries){
        if (Object.keys(change).every(k => this.tgt[k] === change[k])) continue;
        const f = fitter(piecePar({ ...this.tgt, ...change }, this.piece),
          PROFILES[this.profKey], spec, this.sig.amp);
        const a = f ? f.A : 0;
        if (a > current + .005 && (!best || a > best.a)) best = { label, a, current };
      }
      this.fitMemo.hintKey = key;
      this.fitMemo.hint = best;
    }
    return this.fitMemo.hint;
  }

  #ringReadout(spec, key){
    const raw = normZero(sigRaw(spec));
    if (!raw) return null;
    if (this.fitMemo.key !== key)
      this.fitMemo = { ...this.fitMemo, key, fit: fitRing(this.tgtP, PROFILES[this.profKey], spec, this.sig.amp) };
    const fT = this.fitMemo.fit;

    const NP = 128, input = new Float64Array(NP);
    let mx = 0;
    for (let k = 0; k < NP; k++){ input[k] = shapeCirc(raw, k / (NP - 1) * V.TAU); mx = Math.max(mx, Math.abs(input[k])); }
    for (let k = 0; k < NP; k++) input[k] /= mx || 1;

    const printable = fT && fT.A > 0;
    let adapt = 'nessuno', adaptOk = true;
    if (!printable){
      adapt = this.sig.amp > 0 ? 'non stampabile con questo vaso' : 'intensità 0';
      adaptOk = !(this.sig.amp > 0);
    } else if (fT.A < fT.Areq - 1e-6){
      adapt = `intensità ${pct(fT.Areq)} → ${pct(fT.A)}`;
      adaptOk = false;
    }
    const hint = (!adaptOk && this.sig.amp > 0)
      ? this.#adaptHint(fitRing, spec, key, printable ? fT.A : 0) : null;

    if (!printable)
      return { kind:'ring', axis:'giro completo · 0 → 360°', input, realized:null, n:NP, adapt, adaptOk, hint, fid:null, amplitude:null };

    const realized = new Float64Array(NP);
    for (let k = 0; k < NP; k++) realized[k] = shapeCirc(fT.shape, k / (NP - 1) * V.TAU);

    const ctx = this.slots[0].ctx;
    const jm = Math.max(0, ctx.zs.findIndex(z => z >= .35 * this.curP.h));
    return {
      kind:'ring', axis:'giro completo · 0 → 360°',
      input, realized, n:NP, adapt, adaptOk, hint,
      fid: pearson(input, realized, NP),
      amplitude: fT.A * ctx.Bo[jm],
    };
  }

  #silhouetteReadout(spec, key){
    const rawN = smoothNorm(sigRaw(spec), 0);
    if (!rawN) return null;

    const NP = 96, input = new Float64Array(NP);
    for (let k = 0; k < NP; k++){
      const t = k / (NP - 1) * SIG_SPAN;
      input[k] = shapeAt(rawN, t) * sigWeight(t);
    }

    /* l'adattamento si misura sul bersaglio (tgt): è quello che finirà nell'STL */
    if (this.fitMemo.key !== key)
      this.fitMemo = { ...this.fitMemo, key, fit: fitSignal(this.tgtP, PROFILES[this.profKey], spec, this.sig.amp) };
    const fT = this.fitMemo.fit;

    let adaptOk = true;
    let adapt;
    if (!fT || !(fT.A > 0)){
      adapt = this.sig.amp > 0 ? 'non stampabile con questo vaso' : 'intensità 0';
      adaptOk = !(this.sig.amp > 0);
    } else {
      const parts = [];
      if (fT.sigma > fT.sigmaReq + 1e-6)
        parts.push(`levigatura ${pct(fT.sigmaReq / SIG_SIGMA_MAX)} → ${pct(fT.sigma / SIG_SIGMA_MAX)}`);
      if (fT.A < fT.Areq - 1e-6){ parts.push(`intensità ${pct(fT.Areq)} → ${pct(fT.A)}`); adaptOk = false; }
      adapt = parts.length ? parts.join(' · ') : 'nessuno';
    }
    const hint = (!adaptOk && this.sig.amp > 0)
      ? this.#adaptHint(fitSignal, spec, key, fT && fT.A > 0 ? fT.A : 0) : null;

    const base = { kind:'sil', axis:'fondo → 80% altezza', input, realized:null, n:NP,
                   adapt, adaptOk, hint, fid:null, amplitude:null };
    if (!(this.cur.amp > .004) || !this.lastFit || !(this.lastFit.A > 0)) return base;

    /* differenza fra il guscio con segnale e lo stesso pezzo senza: è la
       modulazione realmente stampata, non quella richiesta */
    const ctx = this.slots[0].ctx, zs = ctx.zs;
    clampProfile(this.curP, ctx.n, this.profAt, zs, this.fidRc, this.fidBo, this.fidBi);
    const T = [], M = [];
    let peak = 0;
    for (let j = 0; j < zs.length && zs[j] <= this.curP.h * SIG_SPAN; j++){
      const d = ctx.Bo[j] - this.fidBo[j];
      T.push(zs[j] / this.curP.h); M.push(d);
      if (Math.abs(d) > peak) peak = Math.abs(d);
    }
    if (!T.length) return base;

    const realized = new Float64Array(NP);
    let seg = 0;
    for (let k = 0; k < NP; k++){
      const t = k / (NP - 1) * SIG_SPAN;
      while (seg < T.length - 2 && T[seg + 1] < t) seg++;
      const f = Math.min(1, Math.max(0, (t - T[seg]) / ((T[seg + 1] - T[seg]) || 1)));
      realized[k] = (M[seg] + ((M[seg + 1] ?? M[seg]) - M[seg]) * f) / (peak || 1);
    }

    /* la correlazione guarda solo le righe a peso pieno: vicino alla base la
       modulazione è volutamente spenta e falserebbe il conto */
    const xs = [], ys = [];
    for (let k = 0; k < NP; k++){
      const t = k / (NP - 1) * SIG_SPAN;
      if (sigWeight(t) < .5) continue;
      xs.push(shapeAt(rawN, t)); ys.push(realized[k]);
    }
    return { ...base, realized, fid: pearson(xs, ys, xs.length), amplitude: peak };
  }
}

/* Correlazione di Pearson, 0 se una delle due serie è piatta. */
function pearson(x, y, n){
  if (!n) return 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < n; k++){
    const a = x[k], b = y[k];
    sx += a; sy += b; sxx += a*a; syy += b*b; sxy += a*b;
  }
  const cov = sxy - sx*sy/n, vx = sxx - sx*sx/n, vy = syy - sy*sy/n;
  return vx > 1e-9 && vy > 1e-9 ? Math.max(0, cov / Math.sqrt(vx * vy)) : 0;
}

function tiltHint(P, z, wall){
  if (wall === 1) return 'la cavità si restringe salendo — riduci il raggio base o aumenta l\'altezza';
  return z > P.h + .5
    ? 'spalla troppo ripida — riduci il raggio base o aumenta l\'altezza'
    : 'costole troppo ripide — riduci torsione o affilatura';
}
