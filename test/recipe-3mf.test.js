/* =====================================================================
   RICETTA NEL 3MF · le impostazioni che non stanno nella geometria.
   Perimetri, fondo, cucitura, riempimento: ciò che decide se il pezzo tiene.
   Viaggiano come IMPOSTAZIONI PER OGGETTO, le uniche che uno slicer applica
   senza sostituire i profili dell'utente — stampante compresa. Il 3MF è
   l'unico modo che l'app ha di dirlo: l'STL non trasporta nulla.
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

/** Impostazioni per oggetto di PrusaSlicer: una Map per oggetto, più i volumi. */
function prusaObjects(xml){
  const out = [];
  for (const m of xml.matchAll(/<object id="(\d+)"[^>]*>([\s\S]*?)<\/object>/g)){
    const cfg = new Map(), vols = [];
    for (const md of m[2].matchAll(/<metadata type="object" key="([^"]+)" value="([^"]*)"\/>/g)) cfg.set(md[1], md[2]);
    for (const v of m[2].matchAll(/<volume firstid="(\d+)" lastid="(\d+)">/g)) vols.push([+v[1], +v[2]]);
    out.push({ id: +m[1], cfg, vols });
  }
  return out;
}
/** Impostazioni per oggetto di Orca / Bambu Studio. */
function orcaObjects(xml){
  const out = [];
  for (const m of xml.matchAll(/<object id="(\d+)">([\s\S]*?)<\/object>/g)){
    const cfg = new Map();
    for (const md of m[2].matchAll(/<metadata key="([^"]+)" value="([^"]*)"\/>/g)) cfg.set(md[1], md[2]);
    out.push({ id: +m[1], cfg });
  }
  return out;
}
const PRUSA = 'Metadata/Slic3r_PE_model.config', ORCA = 'Metadata/model_settings.config';
const prusa0 = files => prusaObjects(files.get(PRUSA))[0].cfg;
const orca0  = files => orcaObjects(files.get(ORCA))[0].cfg;

const PAR = { h:185, r:62, petals:6, twist:60, sharp:.36, w:2.4,
              thD:28.2, pitch:3.18, turns:1.5, amp:0, piece:'disp' };
const LOGO = { on:true, text:'Made by Umberto Molteni', size:7, depth:.8,
               arc:true, rot:0, sn:true, serial:'VRT-ABCDE' };

const build = async (kind = 'vessel', over = {}, mat = undefined) => {
  const r = await V.runExport({ kind, P: { ...PAR, ...over }, profKey:'clessidra', format:'3mf', logo: LOGO, mat });
  assert.equal(r.ok, true, r.error);
  return { r, files: unzip(r.buffer) };
};

test('il 3MF contiene geometria e impostazioni per oggetto per entrambi gli slicer', async () => {
  const { files } = await build();
  for (const atteso of ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model', PRUSA, ORCA])
    assert.ok(files.has(atteso), `manca ${atteso}`);
  assert.match(files.get('3D/3dmodel.model'), /<triangle /, 'il modello contiene triangoli');
});

/*
 * I file di progetto non devono esserci. Slic3r_PE.config era scritto senza
 * il «; » davanti alle righe e PrusaSlicer lo scartava per intero: il pezzo
 * usciva con 3 perimetri e riempimento al 20% dentro la parete. Scritto bene
 * sarebbe stato peggio: PrusaSlicer e Orca caricano un file di progetto sopra i
 * profili di default, e il profilo della stampante dell'utente diventerebbe
 * uno generico da 200×200 con il G-code iniziale di serie.
 */
test('nessun file di progetto: i profili dell\'utente non vengono sostituiti', async () => {
  for (const kind of ['vessel', 'ring']){
    const { files } = await build(kind);
    assert.ok(!files.has('Metadata/Slic3r_PE.config'), kind);
    assert.ok(!files.has('Metadata/project_settings.config'), kind);
  }
});

/* Solo chiavi che gli slicer ammettono per oggetto (PrintObjectConfig e
   PrintRegionConfig, verificate sui sorgenti di PrusaSlicer 2.7 e 2.9.4 e di Orca): una
   chiave globale in un oggetto verrebbe ignorata in silenzio. */
const PRUSA_PER_OGGETTO = new Set(['name', 'layer_height', 'perimeters', 'top_solid_layers',
  'bottom_solid_layers', 'bottom_solid_min_thickness', 'fill_density', 'fill_pattern',
  'seam_position', 'staggered_inner_seams', 'perimeter_generator', 'extrusion_width',
  'perimeter_extrusion_width', 'external_perimeter_extrusion_width', 'support_material',
  'brim_type', 'brim_width']);
const ORCA_PER_OGGETTO = new Set(['name', 'layer_height', 'wall_loops', 'top_shell_layers',
  'bottom_shell_layers', 'bottom_shell_thickness', 'sparse_infill_density',
  'sparse_infill_pattern', 'seam_position', 'staggered_inner_seams', 'wall_generator',
  'line_width', 'inner_wall_line_width', 'outer_wall_line_width', 'enable_support',
  'brim_type', 'brim_width']);

test('le impostazioni sono tutte ammesse per oggetto, e PrusaSlicer riceve la geometria', async () => {
  for (const kind of ['vessel', 'ring']){
    const { files } = await build(kind);
    const tris = (files.get('3D/3dmodel.model').match(/<triangle /g) || []).length;
    const [p] = prusaObjects(files.get(PRUSA));
    for (const k of p.cfg.keys()) assert.ok(PRUSA_PER_OGGETTO.has(k), `PrusaSlicer, ${kind}: ${k}`);
    /* con i metadati di un oggetto PrusaSlicer genera solo i volumi dichiarati:
       senza questa riga l'oggetto resterebbe vuoto */
    assert.deepEqual(p.vols, [[0, tris - 1]], kind);
    const [o] = orcaObjects(files.get(ORCA));
    for (const k of o.cfg.keys()) assert.ok(ORCA_PER_OGGETTO.has(k), `Orca, ${kind}: ${k}`);
  }
});

/*
 * Cucitura. Era `random` per non incolonnare i microvuoti; il pezzo stampato
 * è uscito coperto di peli, perché ogni partenza sparsa è una goccia e un filo.
 * Il canale che `random` voleva evitare non si forma comunque con le cuciture
 * interne sfalsate su almeno quattro giri per lato — ed è per questo che quella
 * chiave è sorvegliata insieme alla cucitura.
 */
test('cucitura allineata, cuciture interne sfalsate — in entrambi gli slicer', async () => {
  const { files } = await build();
  assert.equal(prusa0(files).get('seam_position'), 'aligned');
  assert.equal(prusa0(files).get('staggered_inner_seams'), '1');
  assert.equal(orca0(files).get('seam_position'), 'aligned');
  assert.equal(orca0(files).get('staggered_inner_seams'), '1');
});

test('spostamenti e materiale restano nella ricetta mostrata, non nel file', async () => {
  /* sono impostazioni globali: nessuno slicer le accetta per oggetto */
  assert.deepEqual({ ...V.RECIPE.travel }, { avoidCrossing:true, wipe:true, retractLayer:true, zHop:0 });
  const { files } = await build();
  for (const k of ['avoid_crossing_perimeters', 'wipe', 'retract_lift', 'temperature', 'max_fan_speed'])
    assert.ok(!prusa0(files).has(k), k);
});

test('il fondo è pieno per tutto lo spessore, non solo nei primi strati', async () => {
  /* senza questa impostazione restano ~2 mm solidi su 3-4 mm di fondo, e il
     vero sbarramento sotto il liquido è 1 mm stampato sopra riempimento rado */
  const { files } = await build();
  assert.equal(prusa0(files).get('bottom_solid_min_thickness'), '4');
  assert.equal(orca0(files).get('bottom_shell_thickness'), '4');

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
    const n = Number(prusa0(files).get('perimeters'));
    assert.ok(n * 2 * V.RECIPE.width >= w - 1e-9, `parete ${w}: ${n} perimetri`);
    assert.equal(orca0(files).get('wall_loops'), String(n));
    /* e dentro la parete non resta reticolo: il riempimento c'è solo sulla carta */
    assert.equal(prusa0(files).get('perimeter_generator'), 'arachne');
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
  const cfg = prusa0(files);
  /* quattro è il minimo, non il valore: il numero segue parete e costole */
  const n = Number(cfg.get('perimeters'));
  assert.ok(n >= 4, `sono i perimetri a chiudere la parete: ${n}`);
  assert.equal(cfg.get('layer_height'), '0.2');
  assert.equal(cfg.get('support_material'), '0', 'il pezzo è progettato per non averne bisogno');
  assert.equal(orca0(files).get('wall_loops'), String(n));
  assert.equal(orca0(files).get('enable_support'), '0');
});

test('lo spool di prova del filetto porta la stessa cucitura del pezzo vero', async () => {
  /* se lo spool avesse impostazioni diverse non predirebbe come si avvita
     davvero la pompa sul collo del dispenser */
  const { files } = await build('ring');
  assert.equal(prusa0(files).get('seam_position'), 'aligned');
});

test('il set sul piatto porta a ogni pezzo la sua ricetta', async () => {
  const r = await V.runExport({ kind:'plate', P: { ...PAR, w: 6 }, pieces:['disp','tooth'],
    profKey:'clessidra', format:'3mf', logo: LOGO });
  assert.equal(r.ok, true, r.error);
  const files = unzip(r.buffer);
  const model = files.get('3D/3dmodel.model');
  const tris = [...model.matchAll(/<object id="\d+"[\s\S]*?<\/object>/g)].map(m => (m[0].match(/<triangle /g) || []).length);
  const p = prusaObjects(files.get(PRUSA)), o = orcaObjects(files.get(ORCA));
  assert.equal(p.length, 2); assert.equal(o.length, 2);
  p.forEach((obj, k) => {
    assert.equal(obj.id, k + 1);
    assert.deepEqual(obj.vols, [[0, tris[k] - 1]], `pezzo ${k + 1}: volume`);
    assert.equal(obj.cfg.get('seam_position'), 'aligned');
    const n = Number(obj.cfg.get('perimeters'));
    assert.ok(n * 2 * V.RECIPE.width >= 6 - 1e-9, `pezzo ${k + 1}: ${n} perimetri`);
    assert.equal(o[k].cfg.get('wall_loops'), String(n));
  });
});

/*
 * Temperatura e ventola decidono se gli strati si fondono o si incollano, ma
 * sono impostazioni del filamento: lo studio le mostra, il 3MF non può
 * imporle. Qui si sorvegliano i valori che lo studio mostra.
 */
test('il materiale scelto cambia la ricetta, e il default è quello che salda', async () => {
  /* PETG di serie: la guida di stampa del progetto lo indica come la scelta per
     un contenitore, e il PLA come «fragile fra gli strati» */
  assert.equal(V.MATERIAL_DEFAULT, 'petg');
  const visti = new Set();
  for (const key of Object.keys(V.MATERIALS)){
    const m = V.recipeFor(PAR, 0, key).mat;
    assert.equal(m, V.MATERIALS[key], key);
    visti.add(m.nozzle);
    /* per ogni materiale la ventola deve restare spenta sui primi strati: è lì
       che un pezzo si stacca o delamina */
    assert.ok(m.fanOff >= 2, key);
    assert.ok(m.fanMin <= m.fanMax, key);
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
  /* la eretta ha strati da pochi secondi: senza ventola fissa lo slicer la
     stampa alla massima e misura una saldatura peggiore di quella del corpo.
     La ventola non viaggia nel file, quindi lo dice il nome */
  assert.match(modello, new RegExp(`eretta[^"]*ventola fissa ${V.MATERIALS.petg.fanMin}%`));
  /* stessa ricetta del pezzo, su entrambe le barrette: è lo stesso guscio in
     piccolo, o non predice niente */
  const barrette = prusaObjects(files.get(PRUSA));
  assert.equal(barrette.length, 2);
  for (const b of barrette){
    assert.equal(b.cfg.get('perimeters'), String(V.recipeFor(PAR).walls));
    /* col brim: una barretta alta e sottile senza bordino si stacca dal piatto */
    assert.match(b.cfg.get('brim_width'), /^[1-9]\d*$/);
    assert.equal(b.cfg.get('brim_type'), 'outer_only');
  }

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
