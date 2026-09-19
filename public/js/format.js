/* Formattazione dei numeri per l'interfaccia. Tenuta fuori dal modello:
   il modello produce misure, non testo. */

export const it = n => n.toLocaleString('it-IT');

/** Secondi → «3 h 40 min» oppure «45 min». */
export function fmtTime(seconds){
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60), m = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export const fmtPct = x => Math.round(x * 100) + '%';
export const fmtMm  = (x, d = 0) => x.toFixed(d) + ' mm';

/** Byte → «4,2 MB». */
export const fmtBytes = b => b >= 1048576
  ? (b / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' MB'
  : Math.round(b / 1024) + ' kB';

/** Data → «19 set 2026». */
export const fmtDate = t => new Date(t).toLocaleDateString('it-IT',
  { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtDateTime = t => new Date(t).toLocaleString('it-IT',
  { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const esc = t => String(t ?? '')
  .replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
