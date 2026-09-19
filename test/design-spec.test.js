import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultState, encodeState, decodeState, normalizeState, designFingerprint,
  normCode, RANGES, LOGO_RANGES, SIG_RANGES, toSlider, fromSlider, PRESETS,
} from '../public/js/design-spec.js';

test('round-trip dello stato di default è identico', () => {
  const s = defaultState();
  assert.deepEqual(decodeState(encodeState(s)), s);
});

test('round-trip di ogni preset è identico', () => {
  for (const [name, p] of Object.entries(PRESETS)){
    const s = defaultState();
    Object.assign(s.P, { h:p.h, r:p.r, petals:p.petals, twist:p.twist, sharp:p.sharp });
    s.profile = p.profile;
    assert.deepEqual(decodeState(encodeState(s)), s, name);
  }
});

test('round-trip con segnale attivo', () => {
  const s = defaultState();
  s.sig = { on:true, src:'voce', q:'A'.repeat(32) + 'z9-_'.repeat(8), amp:.31, smooth:.62, rev:true, inv:true };
  assert.deepEqual(decodeState(encodeState(s)), s);
});

test('gli estremi di ogni slider sopravvivono al round-trip', () => {
  for (const [group, target] of [[RANGES, 'P'], [LOGO_RANGES, 'logo'], [SIG_RANGES, 'sig']])
    for (const spec of Object.values(group))
      for (const edge of [spec.min, spec.max]){
        const s = defaultState();
        s.sig.on = true; s.sig.q = 'A'.repeat(64);
        s[target][spec.key] = fromSlider(spec, edge);
        const back = decodeState(encodeState(s));
        assert.equal(back[target][spec.key], s[target][spec.key], `${spec.key}@${edge}`);
        assert.equal(toSlider(spec, back[target][spec.key]), edge, `slider ${spec.key}@${edge}`);
      }
});

test('valori fuori scala vengono riportati nei limiti, non rifiutati', () => {
  const enc = encodeState(defaultState());
  assert.equal(decodeState(enc.replace('h=185', 'h=9999')).P.h, 235);
  assert.equal(decodeState(enc.replace('h=185', 'h=-5')).P.h, 120);
  assert.equal(decodeState(enc.replace('sh=36', 'sh=1000')).P.sharp, 1);
  assert.equal(decodeState(enc.replace('h=185', 'h=pippo')).P.h, 185, 'valore illeggibile = default');
});

test('versione diversa = link non riconosciuto', () => {
  assert.equal(decodeState('v=2&h=185'), null);
  assert.equal(decodeState(''), null);
  assert.equal(decodeState(null), null);
});

test('normalizeState accetta stati parziali e input ostili', () => {
  assert.deepEqual(normalizeState(null), defaultState());
  assert.deepEqual(normalizeState({ P:{ h:200 } }).P.h, 200);
  assert.equal(normalizeState({ profile:'<script>' }).profile, 'clessidra');
  assert.equal(normalizeState({ piece:'../../etc' }).piece, 'disp');
  assert.equal(normalizeState({ logo:{ text:'x'.repeat(500) } }).logo.text.length, 30);
  assert.equal(normalizeState({ logo:{ text:'a\u0000b\nc' } }).logo.text, 'a b c');
  assert.equal(normalizeState({ sig:{ on:true, q:'troppo corto' } }).sig.on, false);
  assert.equal(normalizeState({ P:{ h:'NaN' } }).P.h, 185);
});

test("l'impronta è stabile e indipendente da pezzo e interruttore codice", () => {
  const a = defaultState();
  const b = structuredClone(a); b.piece = 'tooth'; b.logo.sn = false;
  assert.equal(designFingerprint(a), designFingerprint(b));
  const c = structuredClone(a); c.P.h = 186;
  assert.notEqual(designFingerprint(a), designFingerprint(c));
  assert.match(designFingerprint(a), /^VRT-[0-9A-HJKMNP-TV-Z]{5}$/);
});

test('normCode corregge gli errori di lettura dal fondo del pezzo', () => {
  assert.equal(normCode('vrt-7k3qx'), 'VRT-7K3QX');
  assert.equal(normCode('VRT7K3QX'), 'VRT-7K3QX');
  assert.equal(normCode('vrt 7o3il'), 'VRT-70311');
  assert.equal(normCode('troppo-lungo-davvero'), null);
  assert.equal(normCode(''), null);
  assert.equal(normCode(null), null);
});
