/* =====================================================================
   SEGNALE PERSONALE · da un file GPX o dalla voce a 64 campioni.
   Tutto avviene nel browser: della registrazione non esce nulla, resta
   solo la curva di volume già ridotta a 64 numeri.
   ===================================================================== */
import { esc } from '../format.js';

const { SIG_N, sigEncode } = globalThis.VCore;

/* --------------------------------- GPX --------------------------------- */
/**
 * Estrae la quota lungo il percorso, ricampionata a passo di distanza costante.
 * @returns {{q:string, meta:string}}
 * @throws  {Error} con un messaggio già leggibile dall'utente
 */
export function parseGPX(text){
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('file GPX non leggibile');

  let pts = [...doc.getElementsByTagNameNS('*', 'trkpt')];
  if (!pts.length) pts = [...doc.getElementsByTagNameNS('*', 'rtept')];

  const P = [];
  for (const p of pts){
    const lat = parseFloat(p.getAttribute('lat'));
    const lon = parseFloat(p.getAttribute('lon'));
    const e = p.getElementsByTagNameNS('*', 'ele')[0];
    const ele = e ? parseFloat(e.textContent) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(ele)) P.push([lat, lon, ele]);
  }
  if (P.length < 8)
    throw new Error(pts.length ? 'la traccia non contiene quote (tag <ele>)' : 'nessun punto traccia nel file');

  /* distanza cumulata sulla sfera: il campionamento segue il terreno, non
     il numero di punti, che i GPS distribuiscono in modo irregolare */
  const R = 6371008.8, rad = Math.PI / 180;
  const dist = new Float64Array(P.length);
  for (let i = 1; i < P.length; i++){
    const [la1, lo1] = P[i-1], [la2, lo2] = P[i];
    const a = Math.sin((la2-la1)*rad/2) ** 2
            + Math.cos(la1*rad) * Math.cos(la2*rad) * Math.sin((lo2-lo1)*rad/2) ** 2;
    dist[i] = dist[i-1] + 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const D = dist[P.length - 1];
  const useIdx = !(D > 50);                     // traccia senza spostamento: passo per punto
  const X = i => useIdx ? i : dist[i];
  const span = useIdx ? P.length - 1 : D;

  const vals = new Float64Array(SIG_N);
  let q = 0;
  for (let k = 0; k < SIG_N; k++){
    const c = (k + .5) / SIG_N * span, hw = span / SIG_N / 2;
    let acc = 0, cnt = 0;
    for (let i = 0; i < P.length; i++){
      const x = X(i);
      if (x >= c - hw && x <= c + hw){ acc += P[i][2]; cnt++; }
    }
    if (cnt) vals[k] = acc / cnt;
    else {                                       // finestra vuota: interpolazione lineare
      while (q < P.length - 2 && X(q + 1) < c) q++;
      const f = Math.min(1, Math.max(0, (c - X(q)) / ((X(q + 1) - X(q)) || 1)));
      vals[k] = P[q][2] + (P[q + 1][2] - P[q][2]) * f;
    }
  }

  const encoded = sigEncode(vals);
  if (!encoded) throw new Error('la traccia è piatta: nessuna variazione di quota');

  let lo = Infinity, hi = -Infinity, gain = 0, prev = null;
  for (const p of P){ lo = Math.min(lo, p[2]); hi = Math.max(hi, p[2]); }
  for (const v of vals){ if (prev !== null && v > prev) gain += v - prev; prev = v; }

  const nameEl = doc.getElementsByTagNameNS('*', 'trk')[0]?.getElementsByTagNameNS('*', 'name')[0]
              || doc.getElementsByTagNameNS('*', 'name')[0];
  const name = nameEl ? nameEl.textContent.trim().slice(0, 40) : '';
  const km = (D / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 });

  const meta = (name ? esc(name) + '<br>' : '')
    + `${useIdx ? P.length + ' punti' : km + ' km'} · D+ ${Math.round(gain)} m `
    + `<span>(sui 64 punti)</span> · ${Math.round(lo)}–${Math.round(hi)} m`;

  return { q: encoded, meta };
}

/* --------------------------------- voce --------------------------------- */
/** Inviluppo di volume in dB con i silenzi iniziale e finale rimossi. */
function envelopeFromBuffer(buf){
  const sr = buf.sampleRate, len = buf.length, nc = buf.numberOfChannels;
  const win = Math.max(1, Math.round(sr * .01)), nW = Math.floor(len / win);
  if (nW < 30) throw new Error('registrazione troppo breve');

  const chans = [];
  for (let c = 0; c < nc; c++) chans.push(buf.getChannelData(c));

  const pw = new Float64Array(nW);
  for (let w = 0; w < nW; w++){
    let acc = 0;
    for (let c = 0; c < nc; c++){
      const d = chans[c];
      for (let i = w * win, e = i + win; i < e; i++) acc += d[i] * d[i];
    }
    pw[w] = acc / (win * nc);
  }

  const dB = p => 10 * Math.log10(p + 1e-12);
  let peak = -Infinity;
  for (const p of pw) peak = Math.max(peak, dB(p));
  if (peak < -60) throw new Error('registrazione silenziosa');

  const thr = peak - 30;
  let a = 0, b = nW - 1;
  while (a < nW && dB(pw[a]) < thr) a++;
  while (b > a && dB(pw[b]) < thr) b--;
  if (b - a + 1 < 30) throw new Error('parlato troppo breve: servono almeno 0,3 s sopra il rumore');

  const vals = new Float64Array(SIG_N), n = b - a + 1;
  for (let k = 0; k < SIG_N; k++){
    const i0 = a + Math.floor(k * n / SIG_N);
    const i1 = Math.max(i0 + 1, a + Math.floor((k + 1) * n / SIG_N));
    let acc = 0;
    for (let i = i0; i < i1; i++) acc += pw[i];
    vals[k] = Math.max(peak - 40, dB(acc / (i1 - i0)));   // dinamica utile: 40 dB sotto il picco
  }
  return { vals, dur: n * .01 };
}

/** Decodifica un audio e ne ricava il segnale. @returns {{q:string, meta:string}} */
export async function signalFromAudio(bytes, label){
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) throw new Error('audio non supportato da questo browser');
  const ac = new AC();
  try{
    const buf = await ac.decodeAudioData(bytes);
    const { vals, dur } = envelopeFromBuffer(buf);
    const q = sigEncode(vals);
    if (!q) throw new Error('la registrazione non ha variazioni di volume');
    const secs = dur.toLocaleString('it-IT', { maximumFractionDigits: 1 });
    return { q, meta: `${esc(label)} · ${secs} s di parlato <span>(silenzi rimossi)</span>` };
  } finally { ac.close?.(); }
}

/**
 * Registra dal microfono, al massimo `maxSeconds`.
 * @param {(label:string, recording:boolean)=>void} onTick  aggiorna l'etichetta del bottone
 * @returns {{stop:()=>void, done:Promise<{q:string,meta:string}>}}
 */
export function recordVoice(onTick, maxSeconds = 10){
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    throw new Error('Registrazione non disponibile qui · usa «Carica audio»');

  let recorder = null;
  const done = (async () => {
    onTick('Attendo il microfono…', false);
    let stream;
    try{
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation:false, autoGainControl:false, noiseSuppression:true } });
    }catch(err){
      throw new Error(err?.name === 'NotAllowedError' ? 'Microfono non autorizzato' : 'Microfono non disponibile');
    }

    const chunks = [];
    const mr = recorder = new MediaRecorder(stream);
    const t0 = performance.now();
    const timer = setInterval(() => {
      const left = Math.max(0, maxSeconds - (performance.now() - t0) / 1000);
      onTick(`Ferma · ${Math.ceil(left)} s`, true);
      if (left <= 0 && mr.state === 'recording') mr.stop();
    }, 200);

    mr.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    const stopped = new Promise(res => { mr.onstop = res; });
    mr.start(100);
    onTick(`Ferma · ${maxSeconds} s`, true);

    await stopped;
    clearInterval(timer);
    stream.getTracks().forEach(t => t.stop());
    onTick('Analizzo…', false);
    return signalFromAudio(await new Blob(chunks, { type: mr.mimeType }).arrayBuffer(), 'Registrazione');
  })();

  return { done, stop: () => { if (recorder?.state === 'recording') recorder.stop(); } };
}
