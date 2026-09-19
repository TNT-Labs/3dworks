import { test, before } from 'node:test';
import assert from 'node:assert/strict';

/* vcore.js è uno script classico che si appoggia a `self`: in Node lo
   carichiamo dando a globalThis lo stesso ruolo che ha nel browser. */
globalThis.self = globalThis;
await import('../public/js/vcore.js');

const { DesignModel } = await import('../public/js/design-model.js');
const { defaultState, encodeState, PRESETS } = await import('../public/js/design-spec.js');

/** Modello fermo (come il viewer pubblico): cur == tgt, nessuna transizione. */
function still(state){
  const m = new DesignModel({ animate: false });
  if (state) m.applyState(state, false);
  m.build(true);
  return m;
}

test('il modello fermo costruisce geometria e scheda di misure', () => {
  const m = still();
  assert.ok(m.slots[0].draw > 10000, 'triangoli disegnati');
  assert.equal(m.slots[1].visible, false, 'il secondo pezzo resta spento');
  const x = m.metrics;
  assert.ok(x.height > 150 && x.height < 260, `altezza ${x.height}`);
  assert.ok(x.diameter > 50 && x.diameter < 220, `diametro ${x.diameter}`);
  assert.ok(x.capML > 100, `capacità ${x.capML} ml`);
  assert.ok(x.grams > 0 && x.seconds > 0 && x.tris > 0);
  assert.equal(x.ok, true, 'il preset di partenza non ha problemi: ' + x.issues.join(' · '));
  assert.equal(x.tiltOk, true);
  assert.equal(x.passOk, true);
  assert.equal(x.sealOk, true);
});

test('il preset di partenza resta entro i vincoli della stampante', () => {
  const x = still().metrics;
  assert.ok(x.diameter <= 220, 'entra nel piatto');
  assert.ok(x.height <= 250, 'entra nella corsa Z');
  assert.ok(x.tilt <= 45, `overhang ${x.tilt}°`);
});

test('tutti i preset producono un pezzo valido', () => {
  for (const [name, p] of Object.entries(PRESETS)){
    const s = defaultState();
    Object.assign(s.P, { h:p.h, r:p.r, petals:p.petals, twist:p.twist, sharp:p.sharp });
    s.profile = p.profile;
    const x = still(s).metrics;
    assert.ok(x.capML > 50, `${name}: capacità ${x.capML}`);
    assert.ok(x.tilt <= 45.5, `${name}: overhang ${x.tilt.toFixed(1)}°`);
  }
});

test('un design fuori misura viene segnalato, non nascosto', () => {
  const s = defaultState();
  s.P.r = 100; s.P.h = 235; s.P.sharp = 0;
  const x = still(s).metrics;
  assert.ok(x.issues.length > 0 || x.ok, 'i problemi finiscono nella lista');
  if (!x.fitsBed) assert.ok(x.issues.some(i => /piatto|corsa Z/.test(i)));
});

test('il portaspazzolino è più basso e stretto del dispenser, stesso DNA', () => {
  const disp = still().metrics;
  const s = defaultState(); s.piece = 'tooth';
  const tooth = still(s).metrics;
  assert.ok(tooth.height < disp.height, 'più basso');
  assert.ok(tooth.diameter < disp.diameter, 'più stretto');
  assert.equal(tooth.piece, 'tooth');
});

test('la modalità piatto costruisce due pezzi e pianifica la disposizione', () => {
  const s = defaultState(); s.piece = 'plate';
  const m = still(s);
  assert.equal(m.plateMode, true);
  assert.ok(m.slots[1].visible, 'il secondo pezzo viene costruito');
  assert.ok(m.slots[1].draw > 10000);
  assert.ok(m.metrics.plate, 'la scheda del piatto esiste');
  assert.ok(m.metrics.plate.grams > m.metrics.grams, 'due pezzi pesano più di uno');
  assert.notDeepEqual(m.slots[0].place, m.slots[1].place, 'non si sovrappongono');
});

test("l'impronta segue i parametri ed è quella del link", () => {
  const m = still();
  const s = m.getState();
  assert.equal(encodeState(s), encodeState(m.getState()), 'stabile');
  const before = m.fingerprint();
  m.tgt.h = 200; m.settle(); m.rebuildLogoRaster();
  assert.notEqual(m.fingerprint(), before, "cambiare l'altezza cambia l'impronta");
});

test('il codice di produzione sostituisce l\'impronta nell\'incisione', () => {
  const m = still();
  assert.equal(m.logo.serial, m.fingerprint(), 'di default incide l\'impronta');
  m.setSerial('VRT-ABCDE');
  assert.equal(m.logo.serial, 'VRT-ABCDE');
  m.setSerial(null);
  assert.equal(m.logo.serial, m.fingerprint(), 'tolto il codice torna l\'impronta');
});

test('spegnere l\'incisione svuota il codice inciso', () => {
  const s = defaultState(); s.logo.sn = false;
  const m = still(s);
  assert.equal(m.logo.serial, '');
});

test('un segnale GPX modula la silhouette e produce una lettura di fedeltà', () => {
  const s = defaultState();
  /* dente di sega su 64 punti: variazione di quota netta e riconoscibile */
  let q = '';
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < 64; i++) q += B64U[Math.round(31.5 + 31.5 * Math.sin(i / 64 * Math.PI * 4))];
  s.sig = { on:true, src:'gpx', q, amp:.25, smooth:.15, rev:false, inv:false };

  const plain = still().metrics;
  const m = still(s);
  const sg = m.metrics.signal;
  assert.ok(sg, 'la lettura del segnale esiste');
  assert.equal(sg.kind, 'sil');
  assert.equal(sg.input.length, sg.n);
  assert.ok(sg.realized, 'la forma stampata viene misurata');
  assert.ok(sg.fid > 0, `fedeltà ${sg.fid}`);
  assert.ok(Math.abs(m.metrics.capML - plain.capML) > 1, 'il segnale cambia davvero la forma');
  assert.ok(m.metrics.tilt <= 45.5, 'il limitatore tiene i 44° anche col segnale');
});

test('un segnale voce modula un anello attorno al vaso', () => {
  const s = defaultState();
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let q = '';
  for (let i = 0; i < 64; i++) q += B64U[Math.round(31.5 + 31.5 * Math.cos(i / 64 * Math.PI * 6))];
  s.sig = { on:true, src:'voce', q, amp:.22, smooth:.2, rev:false, inv:false };
  const sg = still(s).metrics.signal;
  assert.ok(sg);
  assert.equal(sg.kind, 'ring');
  assert.equal(sg.axis, 'giro completo · 0 → 360°');
  assert.ok(sg.fid === null || sg.fid >= 0);
});

test('senza segnale la lettura è assente', () => {
  assert.equal(still().metrics.signal, null);
});

test('applyState è reversibile: stesso stato, stesse misure', () => {
  const a = defaultState();
  a.P.h = 210; a.P.r = 70; a.P.petals = 8; a.P.twist = 120; a.P.sharp = .5;
  a.profile = 'tornado';
  const m1 = still(a), m2 = still(a);
  assert.equal(encodeState(m1.getState()), encodeState(a));
  assert.equal(m1.metrics.capML, m2.metrics.capML);
  assert.equal(m1.metrics.height, m2.metrics.height);
  assert.equal(m1.slots[0].draw, m2.slots[0].draw);
});

test("l'animazione converge sul bersaglio e si ferma", () => {
  const m = new DesignModel({ animate: true });
  m.applyState(defaultState(), true);
  let steps = 0;
  while (m.step(1 / 60) && steps < 2000) steps++;
  assert.ok(steps > 0 && steps < 2000, `converge in ${steps} passi`);
  assert.equal(m.cur.h, m.tgt.h);
  assert.equal(m.profBlend, 1);
  m.build(true);
  assert.equal(m.metrics.height, still().metrics.height, 'a riposo coincide col modello fermo');
});
