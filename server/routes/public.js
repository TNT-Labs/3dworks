/* Area pubblica: dal codice di produzione al prodotto, in sola lettura.
   Qui non si entra con un account e non esce nulla che non sia già pubblico:
   niente identità dell'autore, niente file, nessuna scrittura. */
import { Router } from 'express';
import { q } from '../lib/db.js';
import { rateLimit } from '../lib/http.js';
import { normCode, decodeState } from '../../public/js/design-spec.js';

export const publicRouter = Router();

/* Il codice ha 33,5 milioni di combinazioni: il limite serve comunque a
   rendere inutile provarle a tappeto. */
const lookupLimit = rateLimit({
  windowMs: 60_000, max: 60, key: r => 'code:' + r.ip,
  message: 'Troppe ricerche consecutive. Attendi un minuto.',
});

publicRouter.get('/design/:code', lookupLimit, (req, res) => {
  const code = normCode(req.params.code);
  if (!code)
    return res.status(400).json({ error: 'Formato del codice non valido. Esempio: VRT-7K3QX', code: 'bad_format' });

  const row = q.byCode.get(code);
  if (!row)
    return res.status(404).json({ error: `Nessun prodotto pubblico con il codice ${code}.`, code: 'not_found' });

  const state = decodeState(row.published_state);
  if (!state)
    return res.status(500).json({ error: 'Questo prodotto non è leggibile. Contatta chi lo ha creato.' });

  q.bumpViews.run(row.id);

  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    product: {
      code: row.code,
      name: row.name,
      publishedAt: row.published_at,
      /* lo stato serve al visualizzatore per ricostruire la geometria:
         è la stessa informazione che il codice inciso rappresenta */
      state: row.published_state,
      meta: row.published_meta ? JSON.parse(row.published_meta) : null,
      hasPreview: !!row.has_preview,
      views: row.views + 1,
    },
  });
});

publicRouter.get('/design/:code/preview.png', lookupLimit, (req, res) => {
  const code = normCode(req.params.code);
  const row = code ? q.byCode.get(code) : null;
  if (!row) return res.status(404).end();
  const blob = q.previewOf.get(row.id)?.preview;
  if (!blob) return res.status(404).end();
  res.type('png').set('Cache-Control', 'public, max-age=300').send(Buffer.from(blob));
});
