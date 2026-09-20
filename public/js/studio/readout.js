/* =====================================================================
   READOUT · scrive nel DOM la scheda di misure che il modello calcola.
   Il modello non conosce il DOM e qui non si fa un solo conto: la
   separazione è ciò che permette di testare la geometria senza browser.
   ===================================================================== */
import { fmtTime } from '../format.js';
import { FID_MIN } from '../design-model.js';

const $ = id => document.getElementById(id);
const text = (id, v) => { const el = $(id); if (el && el.textContent !== v) el.textContent = v; };
const dot = (id, state) => { const el = $(id); if (el) el.className = 'dot ' + state; };
const pct = x => Math.round(x * 100) + '%';

/** Percorso SVG di una curva normalizzata in [-1..1] sul riquadro 300×64. */
function plotPath(vals, n){
  let d = '';
  for (let k = 0; k < n; k++)
    d += (k ? 'L' : 'M') + (k / (n - 1) * 300).toFixed(1) + ' ' + (32 - 26 * vals[k]).toFixed(1);
  return d;
}

export function renderReadout(m, model){
  if (!m) return;

  /* ------------------------------ piatto ------------------------------ */
  $('plateBox').hidden = !m.plateMode;
  if (m.plate){
    const p = m.plate;
    text('plLay', p.fits ? (p.layout === 'fila' ? 'in fila' : 'in diagonale') : 'non entrano');
    text('plSize', p.fits ? `${Math.ceil(p.W)} × ${Math.ceil(p.D)} mm su ${p.free}` : (p.why || '—'));
    dot('plDot', p.fits ? 'ok' : 'bad');
    text('plH', `${Math.round(p.H)} mm${p.overZ ? ' · oltre la corsa Z' : ''}`);
    text('plMat', `${Math.round(p.grams)} g · ≈ ${Math.round(p.cm3)} cm³`);
    text('plTime', '≈ ' + fmtTime(p.seconds));
  }

  /* ------------------------------ pezzo ------------------------------ */
  text('mSize',  `Ø ${Math.round(m.diameter)} × ${Math.round(m.height)} mm`);
  text('mCap',   `≈ ${Math.round(m.capML)} ml`);
  text('mDepth', `≈ ${Math.round(m.depth)} mm`);
  text('mPass',  `Ø min ${m.pass.toFixed(0)} mm`);
  text('mTilt',  `${m.tilt.toFixed(0)}° max`);
  text('mWall',  `${m.wall.toFixed(2)} mm · ${m.wallPerimeters} perimetri`);
  text('mSeal',  `≥ ${m.seal.toFixed(1)} mm pieni`);
  text('mVol',   `≈ ${Math.round(m.matVol / 1000)} cm³`);
  text('mFil',   `${Math.round(m.grams)} g · ${Math.round(m.meters)} m`);
  text('mTime',  '≈ ' + fmtTime(m.seconds));
  text('mTri',   `≈ ${Math.round(m.tris / 1000)} mila triangoli`);
  dot('fitDot',  m.fitsBed ? 'ok' : 'bad');
  dot('passDot', m.passOk ? 'ok' : 'bad');
  dot('tiltDot', m.tiltOk ? 'ok' : 'bad');
  dot('sealDot', m.sealOk ? 'ok' : 'bad');
  dot('wallDot', m.wallOk ? 'ok' : 'bad');

  /* ------------------------------ segnale ------------------------------ */
  renderSignal(m.signal, model);

  /* ------------------------------ didascalia ------------------------------ */
  const cap = $('caption');
  const plateTxt = m.plate
    ? (m.plate.fits
        ? `set · 2 pezzi ${m.plate.layout} · ${Math.ceil(m.plate.W)} × ${Math.ceil(m.plate.D)} mm su ${m.plate.free} · h ${Math.round(m.plate.H)} mm`
        : `i due pezzi non entrano insieme · ${m.plate.why}`)
    : null;
  const bad = !m.ok || (m.plate && !m.plate.fits);
  text('capTxt', plateTxt && !m.plate.fits ? plateTxt
    : !m.ok ? m.issues.join(' · ')
    : plateTxt || `Ø ${Math.round(m.diameter)} × ${Math.round(m.height)} mm · ≈${Math.round(m.capML)} ml · pareti ${m.tilt.toFixed(0)}°`);
  cap.className = 'stage-caption ' + (bad ? 'bad' : 'ok');
  $('capIc').innerHTML = bad ? ICON_BAD : ICON_OK;
}

const ICON_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5 5L20 6.5"/></svg>';
const ICON_BAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4.5"/><path d="M12 17.5v.01"/></svg>';

function renderSignal(s, model){
  if (!s){
    $('plotI').setAttribute('d', '');
    $('plotR').setAttribute('d', '');
    text('mAdapt', '—');
    text('mFid', '—');
    $('sigHint').hidden = true;
    return;
  }
  $('sigAxis').textContent = s.axis;
  $('plotI').setAttribute('d', plotPath(s.input, s.n));
  $('plotR').setAttribute('d', s.realized ? plotPath(s.realized, s.n) : '');

  text('mAdapt', s.adapt);
  dot('adaptDot', s.adaptOk ? 'ok' : 'warn');

  if (s.fid == null){
    text('mFid', '—');
    dot('fidDot', 'ok');
  } else {
    text('mFid', `${pct(s.fid)} · ±${s.amplitude.toFixed(1)} mm`);
    dot('fidDot', s.fid >= FID_MIN ? 'ok' : 'warn');
  }

  const h = $('sigHint');
  h.hidden = !s.hint;
  if (s.hint)
    h.innerHTML = `Il vaso limita il segnale. Con <b>${s.hint.label}</b> l'intensità stampabile `
      + `sale a <b>${pct(s.hint.a)}</b> (ora ${pct(s.hint.current)}).`;
}
