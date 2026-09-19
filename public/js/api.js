/* Client delle API. Un posto solo per cookie, token CSRF e messaggi d'errore. */

const CSRF_COOKIE = 'vt_csrf';

const readCookie = name => document.cookie.split(';')
  .map(c => c.trim())
  .filter(c => c.startsWith(name + '='))
  .map(c => decodeURIComponent(c.slice(name.length + 1)))[0] ?? null;

/** Errore di API con lo stato HTTP e il campo del form eventualmente colpevole. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = null, field = null, data = null } = {}){
    super(message);
    this.name = 'ApiError';
    this.status = status; this.code = code; this.field = field; this.data = data;
  }
}

async function request(method, path, body, { raw = false } = {}){
  const headers = {};
  const csrf = readCookie(CSRF_COOKIE);
  if (csrf) headers['X-CSRF-Token'] = csrf;

  let payload;
  if (body instanceof Blob){ headers['Content-Type'] = body.type || 'application/octet-stream'; payload = body; }
  else if (body !== undefined){ headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res;
  try{
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  }catch{
    throw new ApiError('Connessione al server non riuscita. Controlla la rete e riprova.', { code:'offline' });
  }

  if (raw) return res;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok)
    throw new ApiError(data?.error || `Errore del server (${res.status})`,
      { status: res.status, code: data?.code ?? null, field: data?.field ?? null, data });
  return data;
}

const get  = (p, o)    => request('GET', p, undefined, o);
const post = (p, b, o) => request('POST', p, b, o);
const put  = (p, b, o) => request('PUT', p, b, o);
const del  = (p, o)    => request('DELETE', p, undefined, o);

export const api = {
  auth: {
    me:       ()        => get('/api/auth/me'),
    register: (email, password) => post('/api/auth/register', { email, password }),
    login:    (email, password) => post('/api/auth/login', { email, password }),
    logout:   ()        => post('/api/auth/logout'),
    logoutAll:()        => post('/api/auth/logout-all'),
    forgot:   email     => post('/api/auth/forgot', { email }),
    reset:    (token, password) => post('/api/auth/reset', { token, password }),
    changePassword: (current, password) => post('/api/auth/change-password', { current, password }),
    resendVerification: () => post('/api/auth/resend-verification'),
  },
  designs: {
    list:      (limit = 50, offset = 0) => get(`/api/designs?limit=${limit}&offset=${offset}`),
    get:       id            => get(`/api/designs/${id}`),
    create:    (name, state) => post('/api/designs', { name, state }),
    update:    (id, patch)   => put(`/api/designs/${id}`, patch),
    remove:    id            => del(`/api/designs/${id}`),
    publish:   (id, payload) => post(`/api/designs/${id}/publish`, payload),
    unpublish: id            => post(`/api/designs/${id}/unpublish`),
    putPreview:(id, blob)    => put(`/api/designs/${id}/preview`, blob),
    previewUrl:id            => `/api/designs/${id}/preview.png`,
  },
  public: {
    byCode:     code => get(`/api/public/design/${encodeURIComponent(code)}`),
    previewUrl: code => `/api/public/design/${encodeURIComponent(code)}/preview.png`,
  },
};
