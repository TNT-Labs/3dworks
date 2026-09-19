/* =====================================================================
   EXPORTER · i lavori pesanti (STL, 3MF, ricerca inversa) nel Web Worker.
   Il Worker carica /js/vcore.js, lo stesso file dell'anteprima: una sola
   fonte di verità per la geometria, nessun rischio che l'STL scaricato sia
   diverso da quello che si è visto sullo schermo.
   Se il Worker non è disponibile si ripiega sul calcolo in pagina.
   ===================================================================== */

let worker = null, broken = false, seq = 0;
const jobs = new Map();

function getWorker(){
  if (worker || broken) return worker;
  try{
    worker = new Worker('/js/vcore.js');
    worker.onmessage = e => {
      const job = jobs.get(e.data.id);
      if (job){ jobs.delete(e.data.id); job.resolve(e.data); }
    };
    worker.onerror = e => {
      e.preventDefault();
      console.warn('Worker non disponibile, passo al calcolo in pagina:', e.message);
      broken = true;
      worker.terminate();
      worker = null;
      /* i lavori in coda non vanno persi: finiscono in pagina */
      for (const [id, job] of jobs){ jobs.delete(id); job.resolve(runLocal(job.job)); }
    };
  }catch(err){
    console.warn('Worker non creabile, calcolo in pagina:', err);
    broken = true;
    worker = null;
  }
  return worker;
}

function runLocal(job){
  try{ return globalThis.VCore.runExport(job); }
  catch(err){ return { ok:false, error: String(err?.message || err) }; }
}

/** Esegue un lavoro di export/ricerca. Risolve sempre, anche in errore. */
export function runJob(job){
  const w = getWorker();
  /* il ritardo lascia al browser il tempo di dipingere lo stato "sto lavorando"
     prima di bloccare il thread principale */
  if (!w) return new Promise(res => setTimeout(() => res(runLocal(job)), 30));
  return new Promise(resolve => {
    const id = ++seq;
    jobs.set(id, { resolve, job });
    w.postMessage({ id, job });
  });
}

/** Scarica un Blob con un nome di file. */
export function saveBlob(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 8000);
}

/**
 * Descrive il lavoro di export a partire da un modello.
 * @param {DesignModel} model
 * @param {'vessel'|'ring'} kind
 * @param {{format:string, serial:string|null}} opts
 */
export function jobFor(model, kind, { format = 'stl', serial = null } = {}){
  const { piecePar } = globalThis.VCore;
  const logo = { ...model.logo, serial: model.logo.sn ? (serial || model.fingerprint()) : '' };
  if (kind === 'vessel' && model.plateMode)
    return { kind:'plate', P:{ ...model.tgt }, pieces:['disp', 'tooth'], profKey: model.profKey, format, logo };
  return { kind, P: piecePar(model.tgt, model.piece), profKey: model.profKey, format, logo };
}

/** Nome del file scaricato: parlante e ordinabile. */
export function fileNameFor(model, result, code){
  const set = model.plateMode;
  const ext = result.format === '3mf' ? '3mf' : 'stl';
  const slug = set ? 'set' : model.piece === 'disp' ? 'dispenser' : 'portaspazzolino';
  const tag = set ? `${Math.ceil(result.plate.W)}x${Math.ceil(result.plate.D)}mm_`
    : model.piece === 'disp' ? `T${model.tgt.thD.toFixed(1)}mm_`
    : `D${Math.round(result.D)}mm_`;
  return `vortice-${slug}_${code}_${tag}${Math.round(result.Ht)}mm.${ext}`;
}
