/* =====================================================================
   RICETTA NEL 3MF · le impostazioni che non stanno nella geometria.
   La cucitura Z è l'ultimo punto debole per la tenuta: ogni giro di
   perimetro si interrompe da qualche parte, e il default degli slicer
   (`aligned`) incolonna di proposito quei punti in una linea continua.
   Il 3MF è l'unico modo che l'app ha di dirlo — l'STL non trasporta nulla.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';

globalThis.self = globalThis;
await import('../public/js/vcore.js');
const V = globalThis.VCore;
const { RANGES } = await import('../public/js/design-spec.js');

/** Legge un archivio ZIP dalla sua directory centrale. @returns {Map<string,string>} */
function unzip(buf){
  const b = Buffer.from(buf);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'archivio ZIP senza end-of-central-directory');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++){
    assert.equal(b.readUInt32LE(p), 0x02014b50, 'voce di directory malformata');
    const method = b.readUInt16LE(p + 10);
    const compSize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const name = b.toString('utf8', p + 46, p + 46 + nameLen);
    /* l'intestazione locale ha lunghezze proprie per nome ed extra */
    const lNameLen = b.readUInt16LE(local + 26), lExtraLen = b.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = b.subarray(start, start + compSize);
    out.set(name, (method === 8 ? inflateRawSync(raw) : raw).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const PAR = { h:185, r:62, petals:6, twist:60, sharp:.36, w:2.4,
              thD:28.2, pitch:3.18, turns:1.5, amp:0, piece:'disp' };
const LOGO = { on:true, text:'Made by Umberto Molteni', size:7, depth:.8,
               arc:true, rot:0, sn:true, serial:'VRT-ABCDE' };

const build = async (kind = 'vessel', over = {}, mat = undefined) => {
  const r = await V.runExport({ kind, P: { ...PAR, ...over }, profKey:'clessidra', format:'3mf', logo: LOGO, mat });
  assert.equal(r.ok, true, r.error);
  return { r, files: unzip(r.buffer) };
};

test('il 3MF contiene geometria e ricette per entrambi gli slicer', async () => {
  const { files } = await build();
  for (const atteso of ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model',
                        'Metadata/Slic3r_PE.config', 'Metadata/project_settings.config'])
    assert.ok(files.has(atteso), `manca ${atteso}`);
  assert.match(files.get('3D/3dmodel.model'), /<triangle /, 'il modello contiene triangoli');
});

test('la cucitura è sparsa, non incolonnata — PrusaSlicer', async () => {
  const { files } = await build();
  const cfg = files.get('Metadata/Slic3r_PE.config');
  assert.match(cfg, /^seam_position = random$/m,
    'senza questa riga PrusaSlicer usa «aligned» e impila le cuciture in un canale continuo');
  assert.match(cfg, /^staggered_inner_seams = 1$/m,
    'le cuciture dei perimetri interni non devono cadere sopra quella esterna');
  assert.ok(!/seam_position = aligned/.test(cfg));
});

test('la cucitura è sparsa, non incolonnata — OrcaSlicer', async () => {
  const { files } = await build();
  const cfg = JSON.parse(files.get('Metadata/project_settings.config'));
  assert.equal(cfg.seam_position, 'random');
});

test('il fondo è pieno per tutto lo spessore, non solo nei primi strati', async () => {
  /* senza questa impostazione restano ~2 mm solidi su 3-4 mm di fondo, e il
     vero sbarramento sotto il liquido è 1 mm stampato sopra riempimento rado */
  const { files } = await build();
  assert.match(files.get('Metadata/Slic3r_PE.config'), /^bottom_solid_min_thickness = 4$/m);
  const orca = JSON.parse(files.get('Metadata/project_settings.config'));
  assert.equal(orca.bottom_shell_thickness, '4');

  /* lo spessore imposto deve coprire il fondo più alto che la geometria
     produce, a QUALUNQUE parete: il fondo segue la parete, e la ricetta il fondo */
  const guasti = [];
  for (let h = 120; h <= 235; h += 5)
    for (const w of [2, 2.4, 3.2, 4, 5, 6, 8]){
      const P = { ...PAR, h, w };
      const fondo = V.exportFloorZ(P), imposto = V.recipeFor(P).floorSolid;
      if (imposto < fondo) guasti.push(`h${h} w${w}: fondo ${fondo.toFixed(2)} mm, ricetta ${imposto}`);
    }
  assert.deepEqual(guasti, []);
});

test('i perimetri della ricetta riempiono la parete, qualunque sia', async () => {
  /* È il punto che rende utile una parete spessa. La parete di un vaso ha due
     contorni, quindi ogni perimetro vale due passate: con un numero fisso, tutto
     ciò che eccede `perimetri × 2 × larghezza` non sarebbe guscio pieno ma
     gyroid al 6% chiuso dentro la parete — più spesso, più lento e più debole. */
  const guasti = [];
  for (let sl = RANGES.w.min; sl <= RANGES.w.max; sl++){
    const w = sl / RANGES.w.scale;
    const coperto = V.recipeFor({ ...PAR, w }).walls * 2 * V.RECIPE.width;
    if (coperto < w - 1e-9) guasti.push(`parete ${w.toFixed(1)}: coperti ${coperto.toFixed(2)} mm`);
  }
  assert.deepEqual(guasti, []);

  /* e nel file, non solo nella funzione: i perimetri scritti devono coprire
     la parete del design, qualunque numero venga fuori */
  for (const w of [2.4, 6]){
    const { files } = await build('vessel', { w });
    const n = Number(files.get('Metadata/Slic3r_PE.config').match(/^perimeters = (\d+)$/m)[1]);
    assert.ok(n * 2 * V.RECIPE.width >= w - 1e-9, `parete ${w}: ${n} perimetri`);
    assert.equal(JSON.parse(files.get('Metadata/project_settings.config')).wall_loops, String(n));
  }
});

test('i perimetri arrivano anche dentro le costole piene', async () => {
  /* Con la cavità erosa una costola più fitta della sfera resta piena, e lì il
     guscio è molto più spesso della parete. Se i perimetri si fermassero alla
     parete, il nucleo della costola si stamperebbe a riempimento rado: più
     leggero del modello, quindi il materiale dichiarato sarebbe sbagliato, e
     senza il pieno che la geometria promette. */
  const geom = (over = {}) => {
    const P = { ...PAR, ...over };
    const raster = V.buildLogoRaster(LOGO, V.targetR95(P, 'clessidra'));
    const ctx = V.makeExportCtx(P, 'clessidra', raster, .8);
    const pos = new Float32Array(V.vesselVerts(ctx.zs.length, ctx.nTh, ctx.jB, ctx.K, ctx.nD) * 3);
    return { P, st: V.fillVessel(pos, ctx) };
  };
  const guasti = [];
  for (const sharp of [0, .36, .7])
    for (const petals of [3, 6, 9]){
      const { P, st } = geom({ sharp, petals });
      const r = V.recipeFor(P, st.thickMax);
      const coperto = r.walls * 2 * V.RECIPE.width;
      if (coperto < Math.min(st.thickMax, V.RECIPE_WALLS_MAX * 2 * V.RECIPE.width) - 1e-9)
        guasti.push(`n${petals} sh${sharp}: spessore max ${st.thickMax.toFixed(1)}, coperti ${coperto.toFixed(1)}`);
    }
  assert.deepEqual(guasti, []);

  /* il tetto esiste: una costola da venti millimetri non si riempie di soli
     cordoli, e il numero non deve scappare */
  const { P, st } = geom({ sharp: 1, petals: 9 });
  assert.ok(st.thickMax > 12, `spessore max ${st.thickMax.toFixed(1)} mm`);
  assert.equal(V.recipeFor(P, st.thickMax).walls, V.RECIPE_WALLS_MAX);
});

test('la parete di serie non cambia la ricetta di prima', async () => {
  /* retrocompatibilità: fino a 3,2 mm i 4 perimetri storici bastavano già */
  for (const w of [2, 2.4, 2.8, 3.2]){
    const r = V.recipeFor({ ...PAR, w });
    assert.equal(r.walls, 4, `parete ${w}`);
  }
});

test('i perimetri che fanno la tenuta sono nella ricetta', async () => {
  const { files } = await build();
  const cfg = files.get('Metadata/Slic3r_PE.config');
  /* quattro è il minimo, non il valore: il numero segue parete e costole */
  const n = Number(cfg.match(/^perimeters = (\d+)$/m)[1]);
  assert.ok(n >= 4, `sono i perimetri a chiudere la parete: ${n}`);
  assert.match(cfg, /^layer_height = 0\.2$/m);
  assert.match(cfg, /^support_material = 0$/m, 'il pezzo è progettato per non averne bisogno');
  const orca = JSON.parse(files.get('Metadata/project_settings.config'));
  assert.equal(orca.wall_loops, String(n));
  assert.equal(orca.enable_support, '0');
});

test('lo spool di prova del filetto porta la stessa cucitura del pezzo vero', async () => {
  /* se lo spool avesse impostazioni diverse non predirebbe come si avvita
     davvero la pompa sul collo del dispenser */
  const { files } = await build('ring');
  assert.match(files.get('Metadata/Slic3r_PE.config'), /^seam_position = random$/m);
});

test('il set sul piatto porta la ricetta come il pezzo singolo', async () => {
  const r = await V.runExport({ kind:'plate', P: PAR, pieces:['disp','tooth'],
    profKey:'clessidra', format:'3mf', logo: LOGO });
  assert.equal(r.ok, true, r.error);
  const files = unzip(r.buffer);
  assert.match(files.get('Metadata/Slic3r_PE.config'), /^seam_position = random$/m);
});

/*
 * Temperatura e ventola. Sono le due impostazioni che decidono se gli strati si
 * fondono o si incollano, cioè se il pezzo è tenace o si spezza come il vetro —
 * e nella ricetta non c'erano: il 3MF portava strato, perimetri, fondo,
 * cucitura e riempimento, tutto tranne quelle due. Chi apriva il file si
 * ritrovava il proprio profilo filamento di serie, tipicamente 210 gradi con la
 * ventola al 100%, che è la ricetta esatta di un pezzo fragile.
 */
test('la ricetta porta temperatura e ventola, che decidono la saldatura fra strati', async () => {
  const { files } = await build();
  const cfg = files.get('Metadata/Slic3r_PE.config');
  const m = V.MATERIALS[V.MATERIAL_DEFAULT];
  assert.match(cfg, new RegExp('^temperature = ' + m.nozzle + '$', 'm'));
  assert.match(cfg, new RegExp('^first_layer_temperature = ' + m.nozzleFirst + '$', 'm'));
  assert.match(cfg, new RegExp('^bed_temperature = ' + m.bed + '$', 'm'));
  assert.match(cfg, new RegExp('^max_fan_speed = ' + m.fanMax + '$', 'm'));
  assert.match(cfg, new RegExp('^disable_fan_first_layers = ' + m.fanOff + '$', 'm'));
  assert.match(cfg, new RegExp('^filament_type = ' + m.tipo + '$', 'm'));

  const orca = JSON.parse(files.get('Metadata/project_settings.config'));
  /* in Orca le voci del filamento sono vettori, una per estrusore */
  assert.deepEqual(orca.nozzle_temperature, [String(m.nozzle)]);
  assert.deepEqual(orca.fan_max_speed, [String(m.fanMax)]);
  assert.deepEqual(orca.close_fan_the_first_x_layers, [String(m.fanOff)]);
});

test('il materiale scelto cambia la ricetta, e il default è quello che salda', async () => {
  /* PETG di serie: la guida di stampa del progetto lo indica come la scelta per
     un contenitore, e il PLA come «fragile fra gli strati» */
  assert.equal(V.MATERIAL_DEFAULT, 'petg');
  const visti = new Set();
  for (const key of Object.keys(V.MATERIALS)){
    const { files } = await build('vessel', {}, key);
    const cfg = files.get('Metadata/Slic3r_PE.config');
    const t = Number(cfg.match(/^temperature = (\d+)$/m)[1]);
    assert.equal(t, V.MATERIALS[key].nozzle, key);
    visti.add(t);
    /* per ogni materiale la ventola deve restare spenta sui primi strati: è lì
       che un pezzo si stacca o delamina */
    assert.ok(Number(cfg.match(/^disable_fan_first_layers = (\d+)$/m)[1]) >= 2, key);
  }
  assert.equal(visti.size, Object.keys(V.MATERIALS).length, 'tre materiali, tre temperature');
});

test('il materiale non entra nel design: è una scelta di stampa', async () => {
  /* se finisse nello stato, cambierebbe l'impronta incisa sul fondo e i codici
     di produzione già assegnati non combacerebbero più */
  const { designFingerprint, defaultState, encodeState } = await import('../public/js/design-spec.js');
  const s = defaultState();
  const prima = designFingerprint(s);
  assert.ok(!/mat|petg|pla|asa/i.test(encodeState(s)), 'il link non nomina il materiale');
  assert.equal(designFingerprint(s), prima);
});

test('il provino di robustezza è stampabile e cambia una cosa sola', async () => {
  /* Due barrette identiche, una eretta e una coricata: la differenza è
     l'orientamento degli strati, quindi fletterle separa la saldatura fra
     strati dal materiale. Serve quando il pezzo grosso è fragile e non si sa
     perché: venti minuti invece di venti ore. */
  const r = await V.runExport({ kind:'coupon', P: PAR, profKey:'clessidra', format:'3mf', mat:'petg', logo: LOGO });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.pieces, 2);
  const files = unzip(r.buffer);
  const modello = files.get('3D/3dmodel.model');
  assert.match(modello, /eretta/, 'la barretta eretta è nel file');
  assert.match(modello, /coricata/, 'e anche quella coricata');
  /* stessa ricetta del pezzo: è lo stesso guscio in piccolo, o non predice niente */
  const cfg = files.get('Metadata/Slic3r_PE.config');
  assert.match(cfg, new RegExp('^temperature = ' + V.MATERIALS.petg.nozzle + '$', 'm'));
  assert.match(cfg, /^perimeters = \d+$/m);
  /* col brim: una barretta alta e sottile senza bordino si stacca dal piatto */
  assert.match(cfg, /^brim_width = [1-9]\d*$/m);

  /* le barrette hanno lo spessore della parete del design */
  for (const w of [2.0, 6.0]){
    const q = await V.runExport({ kind:'coupon', P:{ ...PAR, w }, profKey:'clessidra', format:'stl', mat:'petg', logo: LOGO });
    assert.equal(q.ok, true, q.error);
    const atteso = 2 * V.COUPON.L * V.COUPON.W * w;
    assert.ok(Math.abs(q.matVol - atteso) < 1, `parete ${w}: ${q.matVol} invece di ${atteso}`);
  }
});

test("l'STL non trasporta la ricetta: è una differenza da dichiarare", async () => {
  const r = await V.runExport({ kind:'vessel', P: PAR, profKey:'clessidra', format:'stl', logo: LOGO });
  assert.equal(r.ok, true);
  /* un STL binario è un'intestazione di 80 byte + conteggio + 50 byte a triangolo:
     non c'è alcun posto dove infilare impostazioni di stampa */
  const b = Buffer.from(r.buffer);
  assert.equal(b.length, 84 + b.readUInt32LE(80) * 50);
});
