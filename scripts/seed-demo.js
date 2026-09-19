/* Crea un account e un prodotto pubblicato di prova.
   Serve allo sviluppo e ai controlli visivi: `node scripts/seed-demo.js [baseUrl]` */
const base = process.argv[2] || 'http://localhost:3100';
const email = process.argv[3] || `demo.${Date.now()}@esempio.it`;
const password = 'password-di-prova-1';

const jar = new Map();
async function call(method, path, body){
  const headers = { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
  if (jar.has('vt_csrf')) headers['x-csrf-token'] = jar.get('vt_csrf');
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
  for (const c of res.headers.getSetCookie?.() ?? []){
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i).trim(), decodeURIComponent(pair.slice(i + 1).trim()));
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

await call('GET', '/api/health');
/* acceptPrivacy: il server non apre account senza presa visione dell'informativa */
await call('POST', '/api/auth/register', { email, password, acceptPrivacy: true })
  .catch(() => call('POST', '/api/auth/login', { email, password }));

const { encodeState, defaultState } = await import('../public/js/design-spec.js');

const demos = [
  ['Dispenser sapone · bagno', s => { s.P.h = 185; s.P.r = 62; s.profile = 'clessidra'; }],
  ['Maelström · cucina',       s => { s.P.h = 225; s.P.r = 58; s.P.petals = 5; s.P.twist = 70; s.P.sharp = .5; s.profile = 'tornado'; }],
  ['Portaspazzolino',          s => { s.piece = 'tooth'; s.P.petals = 7; s.profile = 'fiamma'; }],
];

const out = [];
for (const [name, tweak] of demos){
  const s = defaultState();
  s.logo.text = 'Made by Umberto Molteni';
  tweak(s);
  const { design } = await call('POST', '/api/designs', { name, state: encodeState(s) });
  const pub = await call('POST', `/api/designs/${design.id}/publish`, {});
  out.push({ name, code: pub.design.code, url: `${base}/p/${pub.design.code}` });
}

console.log(`account: ${email} / ${password}`);
for (const d of out) console.log(`  ${d.code}  ${d.name}\n            ${d.url}`);
