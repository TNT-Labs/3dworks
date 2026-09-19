/* Creazioni dell'utente: elenco, salvataggio, pubblicazione, anteprima.
   Lo stato arriva dal client ma NON viene mai creduto sulla parola: passa da
   normalizeState (stessa spec del browser) prima di toccare il database. */
import { Router } from 'express';
import { config } from '../lib/config.js';
import { q, now } from '../lib/db.js';
import { requireAuth } from '../lib/http.js';
import { allocateCode } from '../lib/auth.js';
import {
  decodeState, encodeState, normalizeState, designFingerprint, sanitizeText,
} from '../../public/js/design-spec.js';

export const designsRouter = Router();
designsRouter.use(requireAuth);

const NAME_MAX = 60;
const cleanName = (n, fallback) => {
  const s = sanitizeText(n).trim().slice(0, NAME_MAX);
  return s || fallback;
};

/** Stato in ingresso (query string o oggetto) → query string canonica. */
function canonicalState(input){
  if (typeof input === 'string'){
    const s = decodeState(input);
    if (!s) return null;
    return encodeState(s);
  }
  if (input && typeof input === 'object') return encodeState(normalizeState(input));
  return null;
}

/* La scheda tecnica arriva dal client (la calcola lo stesso motore geometrico
   dell'anteprima). È informativa — il viewer pubblico la ricalcola comunque —
   quindi la accettiamo solo come numeri finiti dentro limiti plausibili. */
const META_FIELDS = {
  capML:   [0, 100_000],
  grams:   [0, 100_000],
  minutes: [0, 100_000],
  height:  [0, 1000],
  diameter:[0, 1000],
  tilt:    [0, 90],
  tris:    [0, 100_000_000],
};
function cleanMeta(m){
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(META_FIELDS)){
    const v = Number(m[k]);
    if (Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
  }
  if (typeof m.piece === 'string') out.piece = m.piece.slice(0, 16);
  return Object.keys(out).length ? out : null;
}

const rowToDesign = r => ({
  id: r.id,
  name: r.name,
  state: r.state,
  fingerprint: r.fingerprint,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  code: r.code,
  publishedAt: r.published_at,
  /* published ≠ ha un codice: un design può essere stato ritirato e conservare
     il codice, che resta suo per sempre e non verrà mai riassegnato */
  published: !!r.published_at,
  publishedMeta: r.published_meta ? JSON.parse(r.published_meta) : null,
  hasPreview: !!r.has_preview,
  /* true quando il progetto è stato modificato dopo la pubblicazione: il
     pezzo già stampato non corrisponde più a quello che si sta disegnando */
  stale: !!r.stale && !!r.published_at,
  views: r.views,
});

/* --------------------------------- elenco --------------------------------- */
designsRouter.get('/', (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = q.listDesigns.all(req.user.id, limit, offset);
  res.json({
    designs: rows.map(rowToDesign),
    total: q.countDesigns.get(req.user.id).n,
    limit, offset,
  });
});

designsRouter.get('/:id(\\d+)', (req, res) => {
  const row = q.designById.get(Number(req.params.id));
  if (!row || row.user_id !== req.user.id)
    return res.status(404).json({ error: 'Creazione non trovata' });
  res.json({ design: { ...rowToDesign(row), publishedState: row.published_state } });
});

/* -------------------------------- creazione -------------------------------- */
designsRouter.post('/', (req, res) => {
  const state = canonicalState(req.body?.state);
  if (!state) return res.status(400).json({ error: 'Stato del design non valido' });

  const n = q.countDesigns.get(req.user.id).n;
  if (n >= config.maxDesignsPerUser)
    return res.status(409).json({
      error: `Hai raggiunto il limite di ${config.maxDesignsPerUser} creazioni. Eliminane qualcuna per continuare.` });

  const t = now();
  const info = q.insertDesign.run({
    user_id: req.user.id,
    name: cleanName(req.body?.name, 'Senza titolo'),
    state,
    fingerprint: designFingerprint(decodeState(state)),
    created_at: t, updated_at: t,
  });
  res.status(201).json({ design: rowToDesign(q.designById.get(info.lastInsertRowid)) });
});

/* ------------------------------- salvataggio ------------------------------- */
designsRouter.put('/:id(\\d+)', (req, res) => {
  const row = q.designById.get(Number(req.params.id));
  if (!row || row.user_id !== req.user.id)
    return res.status(404).json({ error: 'Creazione non trovata' });

  const state = req.body?.state === undefined ? row.state : canonicalState(req.body.state);
  if (!state) return res.status(400).json({ error: 'Stato del design non valido' });

  q.updateDesign.run({
    id: row.id, user_id: req.user.id,
    name: cleanName(req.body?.name ?? row.name, row.name),
    state,
    fingerprint: designFingerprint(decodeState(state)),
    updated_at: now(),
  });
  res.json({ design: rowToDesign(q.designById.get(row.id)) });
});

designsRouter.delete('/:id(\\d+)', (req, res) => {
  const info = q.deleteDesign.run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Creazione non trovata' });
  res.json({ ok: true });
});

/* ------------------------------ pubblicazione ------------------------------ */
/* Pubblicare congela lo stato: è quello che vedrà chi digita il codice, e resta
   fermo anche se poi il progetto viene modificato. Il codice viene assegnato
   una volta sola e non cambia più, perché finisce inciso sul pezzo. */
designsRouter.post('/:id(\\d+)/publish', (req, res) => {
  const row = q.designById.get(Number(req.params.id));
  if (!row || row.user_id !== req.user.id)
    return res.status(404).json({ error: 'Creazione non trovata' });

  const state = req.body?.state === undefined ? row.state : canonicalState(req.body.state);
  if (!state) return res.status(400).json({ error: 'Stato del design non valido' });

  /* ripubblicare con parametri diversi va chiesto esplicitamente: il codice
     inciso sui pezzi già stampati punterebbe a una forma diversa */
  const changing = !!row.published_at && row.published_state !== state;
  if (changing && !req.body?.replace)
    return res.status(409).json({
      error: 'Questo codice è già pubblicato con parametri diversi.',
      code: 'already_published',
      publishedState: row.published_state,
    });

  const t = now();
  if (req.body?.state !== undefined && state !== row.state)
    q.updateDesign.run({ id: row.id, user_id: req.user.id, name: row.name, state,
      fingerprint: designFingerprint(decodeState(state)), updated_at: t });

  q.publish.run({
    id: row.id, user_id: req.user.id,
    code: row.code || allocateCode(),
    published_at: t,
    published_state: state,
    published_meta: JSON.stringify(cleanMeta(req.body?.meta)),
  });

  const saved = q.designById.get(row.id);
  /* l'anteprima congelata non vale più per una geometria diversa */
  if (changing) q.setPreview.run(null, row.id, req.user.id);
  res.json({ design: rowToDesign(saved), replaced: changing });
});

designsRouter.post('/:id(\\d+)/unpublish', (req, res) => {
  const info = q.unpublish.run(Number(req.params.id), req.user.id);
  if (!info.changes) return res.status(404).json({ error: 'Creazione non trovata' });
  /* il codice resta assegnato: digitandolo si otterrà "non più pubblico",
     mai il pezzo di qualcun altro */
  res.json({ design: rowToDesign(q.designById.get(Number(req.params.id))) });
});

/* --------------------------------- anteprima --------------------------------- */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

designsRouter.put('/:id(\\d+)/preview', (req, res) => {
  const row = q.designById.get(Number(req.params.id));
  if (!row || row.user_id !== req.user.id)
    return res.status(404).json({ error: 'Creazione non trovata' });

  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length < PNG_MAGIC.length || !body.subarray(0, 8).equals(PNG_MAGIC))
    return res.status(400).json({ error: 'L\'anteprima deve essere un PNG' });
  if (body.length > config.maxPreviewBytes)
    return res.status(413).json({ error: 'Anteprima troppo grande' });

  q.setPreview.run(body, row.id, req.user.id);
  res.json({ ok: true, bytes: body.length });
});

designsRouter.get('/:id(\\d+)/preview.png', (req, res) => {
  const row = q.designById.get(Number(req.params.id));
  if (!row || row.user_id !== req.user.id) return res.status(404).end();
  const blob = q.previewOf.get(row.id)?.preview;
  if (!blob) return res.status(404).end();
  res.type('png').set('Cache-Control', 'private, max-age=60').send(Buffer.from(blob));
});
