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

const build = async (kind = 'vessel') => {
  const r = await V.runExport({ kind, P: PAR, profKey:'clessidra', format:'3mf', logo: LOGO });
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

test('i perimetri che fanno la tenuta sono nella ricetta', async () => {
  const { files } = await build();
  const cfg = files.get('Metadata/Slic3r_PE.config');
  assert.match(cfg, /^perimeters = 4$/m, 'sono i perimetri a chiudere la parete');
  assert.match(cfg, /^layer_height = 0\.2$/m);
  assert.match(cfg, /^support_material = 0$/m, 'il pezzo è progettato per non averne bisogno');
  const orca = JSON.parse(files.get('Metadata/project_settings.config'));
  assert.equal(orca.wall_loops, '4');
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

test("l'STL non trasporta la ricetta: è una differenza da dichiarare", async () => {
  const r = await V.runExport({ kind:'vessel', P: PAR, profKey:'clessidra', format:'stl', logo: LOGO });
  assert.equal(r.ok, true);
  /* un STL binario è un'intestazione di 80 byte + conteggio + 50 byte a triangolo:
     non c'è alcun posto dove infilare impostazioni di stampa */
  const b = Buffer.from(r.buffer);
  assert.equal(b.length, 84 + b.readUInt32LE(80) * 50);
});
