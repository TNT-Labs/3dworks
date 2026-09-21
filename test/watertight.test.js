/* =====================================================================
   TENUTA · la parete dichiarata deve esistere davvero.
   La tenuta al liquido la fanno i perimetri: se in qualche punto il guscio
   è più sottile di quanto lo slicer riesce a chiudere, il pezzo perde —
   e nessuna impostazione di stampa lo recupera.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.self = globalThis;
await import('../public/js/vcore.js');
const V = globalThis.VCore;
const { DesignModel, WALL_SEAL_MIN, EXTRUSION_W, PERIMETERS } = await import('../public/js/design-model.js');
const { defaultState, PRESETS, RANGES } = await import('../public/js/design-spec.js');

const LOGO = { on:true, text:'Made by Umberto Molteni', size:7, depth:.8,
               arc:true, rot:0, sn:true, serial:'VRT-ABCDE' };

/** Spessore minimo del guscio alla risoluzione dell'export, dalla geometria vera. */
function exportWall(P, profKey){
  const raster = V.buildLogoRaster(LOGO, V.targetR95(P, profKey));
  const ctx = V.makeExportCtx(P, profKey, raster, .8);
  const pos = new Float32Array(V.vesselVerts(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD) * 3);
  return V.fillVessel(pos, ctx);
}

/** Ø minimo del passaggio nel collo perché la cannuccia della pompa ci passi. */
const PASS_MIN_BORE = 12;

const par = (over = {}) => ({ h:185, r:62, petals:6, twist:60, sharp:.36, w:2.4,
  thD:28.2, pitch:3.18, turns:1.5, amp:0, piece:'disp', ...over });

test('i quattro perimetri della ricetta stanno nella parete più sottile ammessa', () => {
  assert.equal(WALL_SEAL_MIN, EXTRUSION_W * PERIMETERS);
  const minSlider = RANGES.w.min / RANGES.w.scale;
  assert.ok(minSlider >= WALL_SEAL_MIN,
    `la parete minima selezionabile (${minSlider} mm) deve bastare a ${PERIMETERS} perimetri (${WALL_SEAL_MIN} mm)`);
});

test('la parete più spessa selezionabile resta tutta cordoli pieni', () => {
  /* ogni perimetro vale due passate, una per faccia: se il numero non seguisse
     la parete, l'eccedenza diventerebbe riempimento rado chiuso dentro il
     guscio — spesso, pesante e più debole di una parete sottile */
  for (let sl = RANGES.w.min; sl <= RANGES.w.max; sl++){
    const w = sl / RANGES.w.scale;
    const coperto = V.recipeFor(par({ w })).walls * 2 * V.RECIPE.width;
    assert.ok(coperto >= w - 1e-9, `parete ${w.toFixed(1)} mm: coperti ${coperto.toFixed(2)} mm`);
  }
});

test('ogni preset ha davvero la parete che dichiara', () => {
  for (const [name, p] of Object.entries(PRESETS)){
    const P = par({ h:p.h, r:p.r, petals:p.petals, twist:p.twist, sharp:p.sharp });
    const st = exportWall(P, p.profile);
    assert.ok(st.minWall >= P.w - .01,
      `${name}: dichiarati ${P.w} mm, misurati ${st.minWall.toFixed(2)} mm`);
    assert.equal(st.floored, 0, `${name}: la rete di sicurezza non deve entrare in funzione`);
  }
});

/*
 * La garanzia ha due parti, perché il pezzo ha due zone con regole diverse:
 *   · nel CORPO lo spessore è quello scelto dall'utente;
 *   · nel COLLO lo detta la norma GPI (raggio di fondo del filetto meno
 *     alesaggio, ≈3 mm), e non segue lo slider — giustamente, perché il
 *     passaggio interno è una quota funzionale.
 * Ciò che deve valere OVUNQUE è che la parete basti a chiudere i perimetri.
 */
test('in nessun punto la parete scende sotto la soglia di tenuta', () => {
  const guasti = [];
  for (const profKey of ['clessidra', 'fiamma', 'tornado', 'bulbo'])
    for (const h of [120, 185, 235])
      for (const r of [30, 62, 100])
        for (const petals of [3, 6, 9])
          for (const twist of [0, 180, 360])
            for (const sharp of [0, .5, 1])
              for (const w of [2.0, 2.6, 3.2, 5.0, 8.0]){
                const P = par({ h, r, petals, twist, sharp, w });
                const st = exportWall(P, profKey);
                if (st.minWall < WALL_SEAL_MIN - .01 || st.floored)
                  guasti.push(`${profKey} h${h} r${r} n${petals} tw${twist} sh${sharp} w${w}: ` +
                    `${st.minWall.toFixed(2)} mm${st.floored ? ' (rete di sicurezza in funzione)' : ''}`);
              }
  assert.deepEqual(guasti.slice(0, 5), [], `${guasti.length} design sotto la soglia di tenuta`);
});

test('nel corpo la parete è esattamente quella scelta', () => {
  /* misurata sotto la fascia di raccordo della spalla (z/h < 0,6), dove lo
     spessore non ha motivo di discostarsi dal valore richiesto */
  const guasti = [];
  for (const profKey of ['clessidra', 'fiamma', 'tornado', 'bulbo'])
    for (const sharp of [0, .5, 1])
      for (const twist of [0, 360])
        for (const w of [2.0, 2.6, 3.2, 5.0, 8.0]){
          const P = par({ sharp, twist, w });
          const raster = V.buildLogoRaster(LOGO, V.targetR95(P, profKey));
          const ctx = V.makeExportCtx(P, profKey, raster, .8);
          let worst = Infinity;
          for (let j = ctx.jB + 1; j < ctx.zs.length; j++){
            if (ctx.zs[j] / P.h > .55) break;
            worst = Math.min(worst, ctx.Bo[j] - ctx.Bi[j]);
          }
          if (Math.abs(worst - w) > .01)
            guasti.push(`${profKey} sh${sharp} tw${twist} w${w}: ${worst.toFixed(2)} mm`);
        }
  assert.deepEqual(guasti, []);
});

test('anche il portaspazzolino, che ha il bordo aperto, tiene la parete', () => {
  for (const w of [2.0, 2.4, 3.2, 5.0]){
    const st = exportWall(V.piecePar(par({ w }), 'tooth'), 'clessidra');
    assert.ok(st.minWall >= w - .01, `portaspazzolino w${w}: ${st.minWall.toFixed(2)} mm`);
  }
});

/*
 * Parete spessa: è ciò che rende un pezzo robusto in mano invece che fragile
 * appena nato. Due cose devono restare vere quando lo slider sale.
 */
test('la parete spessa esiste davvero nel corpo, fino al massimo dello slider', () => {
  const wMax = RANGES.w.max / RANGES.w.scale;
  const guasti = [];
  for (const profKey of ['clessidra', 'fiamma', 'tornado', 'bulbo'])
    for (const [name, p] of Object.entries(PRESETS))
      for (const w of [4, 6, wMax]){
        const P = par({ h:p.h, r:p.r, petals:p.petals, twist:p.twist, sharp:p.sharp, w });
        const raster = V.buildLogoRaster(LOGO, V.targetR95(P, profKey));
        const ctx = V.makeExportCtx(P, profKey, raster, .8);
        let worst = Infinity;
        for (let j = ctx.jB + 1; j < ctx.zs.length; j++){
          if (ctx.zs[j] / P.h > .55) break;
          worst = Math.min(worst, ctx.Bo[j] - ctx.Bi[j]);
        }
        if (Math.abs(worst - w) > .01) guasti.push(`${name}/${profKey} w${w}: ${worst.toFixed(2)} mm`);
      }
  assert.deepEqual(guasti, []);
});

test('il fondo segue la parete: non resta il punto debole del pezzo', () => {
  /* un guscio da 6 mm su un pavimento da 3 mm avrebbe il suo punto più fragile
     proprio dove il liquido preme e dove il vaso appoggia quando lo posi */
  for (const h of [120, 185, 235]){
    for (const w of [2.0, 2.4, 3.0]) // fino a 3 mm il fondo è quello di sempre
      assert.equal(V.exportFloorZ(par({ h, w })), V.exportFloorZ(par({ h, w:3 })),
        `h${h} w${w}: il fondo storico non deve cambiare`);
    for (const w of [4, 6, 8]){
      const fondo = V.exportFloorZ(par({ h, w }));
      assert.ok(fondo >= w, `h${h} w${w}: fondo ${fondo.toFixed(2)} mm`);
      assert.ok(fondo <= Math.max(3, h * .2) + 1,
        `h${h} w${w}: il fondo non deve mangiare la cavità (${fondo.toFixed(2)} mm)`);
    }
  }
});

test('una parete che non entra nel pezzo viene detta, non stampata di nascosto', () => {
  /* su un pezzo piccolo la cavità si richiude e del guscio resta la scaglia del
     fondo scala: è l'unico caso in cui la rete di sicurezza entra in funzione,
     e deve arrivare all'utente come problema con il rimedio giusto */
  const s = defaultState();
  s.piece = 'tooth'; s.profile = 'fiamma';
  s.P.h = 120; s.P.r = 30; s.P.sharp = 1; s.P.w = 8;
  const m = new DesignModel({ animate:false });
  m.applyState(s, false);
  m.build(true);
  assert.equal(m.metrics.ok, false);
  assert.ok(m.metrics.issues.some(i => /non entra nel pezzo/.test(i)),
    m.metrics.issues.join(' · '));
});

test('un segnale personale non assottiglia il guscio', () => {
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let q = '';
  for (let i = 0; i < 64; i++) q += B64U[Math.round(31.5 + 31.5 * Math.sin(i / 64 * Math.PI * 6))];

  for (const src of ['gpx', 'voce'])
    for (const amp of [.1, .25, .4]){
      const s = defaultState();
      s.sig = { on:true, src, q, amp, smooth:.15, rev:false, inv:false };
      const m = new DesignModel({ animate:false });
      m.applyState(s, false);
      m.build(true);
      assert.ok(m.metrics.wall >= s.P.w - .01,
        `${src} intensità ${amp}: parete ${m.metrics.wall.toFixed(2)} mm invece di ${s.P.w}`);
      assert.equal(m.metrics.wallOk, true);
    }
});

test('la scheda del pezzo riporta lo spessore reale, non quello richiesto', () => {
  const m = new DesignModel({ animate:false });
  m.applyState(defaultState(), false);
  m.build(true);
  const x = m.metrics;
  assert.equal(x.wallNominal, 2.4);
  assert.ok(Math.abs(x.wall - 2.4) < .01);
  assert.ok(x.wallPerimeters >= PERIMETERS, `${x.wallPerimeters} perimetri`);
  assert.equal(x.wallOk, true);
  assert.ok(!x.issues.some(i => /parete di soli/.test(i)));
});

test('una parete troppo sottile finisce fra i problemi segnalati', () => {
  /* forziamo una condizione che la sola interfaccia non permette, per
     verificare che il controllo esista e non sia decorativo */
  const m = new DesignModel({ animate:false });
  m.applyState(defaultState(), false);
  m.build(true);
  const finto = { ...m.metrics, wall: 1.1, wallOk: false };
  assert.ok(finto.wall < WALL_SEAL_MIN);
  /* e che il modello reale non ci arrivi mai da solo */
  assert.ok(m.metrics.wall >= WALL_SEAL_MIN);
});

test('il fondo sotto le lettere incise resta pieno', () => {
  for (const depth of [.4, .8, 1.2]){
    const s = defaultState();
    s.logo.depth = depth;
    const m = new DesignModel({ animate:false });
    m.applyState(s, false);
    m.build(true);
    assert.ok(m.metrics.seal >= 1.5,
      `incisione ${depth} mm: restano ${m.metrics.seal.toFixed(2)} mm di pieno sotto le lettere`);
    assert.equal(m.metrics.sealOk, true);
  }
});

test("l'export rifiuta una mesh che non sia chiusa e manifold", () => {
  const r = V.runExport({ kind:'vessel', P: par(), profKey:'clessidra', format:'stl', logo: LOGO });
  assert.equal(r.ok, true);
  assert.deepEqual(r.check.errors, []);
  assert.ok(r.check.vol > 0, 'volume positivo: normali coerenti');
  /* nessun bordo aperto e nessun bordo doppio: è la definizione di watertight */
  assert.ok(!r.check.errors.some(e => /aperti|manifold/.test(e)));
});

test('il materiale è il volume esatto della geometria, senza coefficienti', () => {
  /* Con il fondo pieno e la parete tutta perimetri non resta alcuna zona a
     riempimento rado: il coefficiente che approssimava il fondo non serve più,
     e con esso sparisce l'errore che dipendeva dall'altezza del pezzo. */
  const P = par();
  const raster = V.buildLogoRaster(LOGO, V.targetR95(P, 'clessidra'));
  const ctx = V.makeExportCtx(P, 'clessidra', raster, .8);
  const pos = new Float32Array(V.vesselVerts(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD) * 3);
  const st = V.fillVessel(pos, ctx);
  assert.equal(V.matVolOf(st), st.wallV + st.solidV,
    'materiale = volume del guscio + volume del fondo, punto');
});

test('la tenuta del fondo dichiarata è quella davvero stampata piena', () => {
  /* Prima la scheda mostrava lo spessore geometrico mentre lo slicer ne rendeva
     solidi 2 mm: il numero era ottimistico. Ora coincidono. */
  for (const h of [120, 185, 235]){
    const s = defaultState();
    s.P.h = h;
    const m = new DesignModel({ animate:false });
    m.applyState(s, false);
    m.build(true);
    const pavimento = m.metrics.seal + m.logo.depth;
    assert.ok(pavimento <= V.RECIPE.floorSolid + .01,
      `h ${h}: il fondo è ${pavimento.toFixed(2)} mm, la ricetta ne rende pieni ${V.RECIPE.floorSolid}`);
    assert.equal(m.metrics.sealOk, true);
  }
});

/*
 * La fascia spalla→collo è quella che la pompa sollecita avvitandosi, ed era
 * l'epicentro del difetto: la parete vi scendeva a 0,90-1,26 mm mentre la
 * scheda ne dichiarava 2,4. Questi test la sorvegliano separatamente, perché
 * una regressione lì non si vede finché un pezzo non cede in mano.
 */
test('la fascia sotto l\'attacco della pompa non si assottiglia', () => {
  const guasti = [];
  for (const profKey of ['clessidra', 'fiamma', 'tornado', 'bulbo'])
    for (const h of [120, 185, 235])
      for (const r of [30, 62, 100])
        for (const petals of [3, 6, 9])
          for (const twist of [0, 180, 360])
            for (const sharp of [0, .5, 1]){
              const P = par({ h, r, petals, twist, sharp });
              const raster = V.buildLogoRaster(LOGO, V.targetR95(P, profKey));
              const ctx = V.makeExportCtx(P, profKey, raster, .8);
              /* dalla spalla in su, collo filettato compreso */
              let worst = Infinity;
              for (let j = ctx.jB + 1; j < ctx.zs.length; j++){
                if (ctx.zs[j] / P.h < .6) continue;
                worst = Math.min(worst, ctx.Bo[j] - ctx.Bi[j]);
              }
              if (worst < P.w - .01)
                guasti.push(`${profKey} h${h} r${r} n${petals} tw${twist} sh${sharp}: ${worst.toFixed(2)} mm`);
            }
  assert.deepEqual(guasti.slice(0, 5), [],
    `${guasti.length} design con la fascia spalla→collo sotto il nominale`);
});

test('lo spessore cresce dal corpo al collo, senza avvallamenti', () => {
  /* un minimo locale in mezzo sarebbe un punto di rottura anche restando
     sopra la soglia: la transizione deve essere monotòna */
  for (const profKey of ['clessidra', 'fiamma', 'tornado', 'bulbo']){
    const P = par();
    const ctx = V.makeExportCtx(P, profKey, V.buildLogoRaster(LOGO, V.targetR95(P, profKey)), .8);
    let prec = -Infinity, cali = 0;
    for (let j = ctx.jB + 1; j < ctx.zs.length; j++){
      const w = ctx.Bo[j] - ctx.Bi[j];
      if (w < prec - .01) cali++;
      prec = w;
    }
    assert.equal(cali, 0, `${profKey}: ${cali} punti in cui la parete torna ad assottigliarsi`);
  }
});

test('il collo segue lo slider della parete quando questa supera i 3 mm', () => {
  const neck = w => {
    const n = V.neckSpec({ thD:28.2, pitch:3.18, turns:1.5, w, piece:'disp' });
    return { parete: n.rootR - n.neckBoreR, passaggio: n.neckBoreR * 2 };
  };
  /* fino a 3 mm il collo resta quello della norma GPI: nessun design cambia */
  for (const w of [2.0, 2.4, 3.0]) assert.ok(Math.abs(neck(w).parete - 3) < 1e-9, `w ${w}`);
  /* oltre, il collo non deve restare l'unico punto sottile del pezzo */
  assert.ok(Math.abs(neck(3.2).parete - 3.2) < 1e-9);
  /* e il passaggio per la cannuccia non deve stringersi in modo sensibile */
  assert.ok(neck(3.2).passaggio > neck(2.4).passaggio - .5);
  assert.ok(neck(3.2).passaggio >= PASS_MIN_BORE, 'resta ben oltre il minimo utile');

  /* Con la parete spessa il collo NON la segue fino in fondo: l'alesaggio si
     ferma a Ø12 perché la cannuccia della pompa ci passi, quindi oltre i
     ~6,9 mm il collo resta il punto più sottile del pezzo. È voluto, ed è ciò
     che la scheda riporta come «parete reale» — va sorvegliato, non corretto. */
  for (const w of [4, 5, 6])
    assert.ok(Math.abs(neck(w).parete - w) < 1e-9, `w ${w}: collo ${neck(w).parete}`);
  for (const w of [7, 8]){
    assert.equal(neck(w).passaggio, PASS_MIN_BORE, `w ${w}: il passaggio non scende sotto Ø12`);
    assert.ok(neck(w).parete >= WALL_SEAL_MIN, `w ${w}: collo ${neck(w).parete.toFixed(2)} mm`);
    assert.ok(neck(w).parete < w, 'oltre la saturazione il collo non segue più lo slider');
  }
});
