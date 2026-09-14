import { StreamCinemaClient as BaseStreamCinemaClient, SC_BASE } from './sc.js';

const directTokenCache = new Map();
const TTL = 2 * 60 * 60 * 1000;

function key(config) { return `${config.username}\u0000${config.uid}`; }

async function responseJson(url, options = {}) {
  const r = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!r.ok) {
    const e = new Error(data?.msg || data?.error || `HTTP ${r.status}`);
    e.status = r.status;
    e.body = data || text.slice(0, 300);
    throw e;
  }
  return data;
}

function headers(config, token = null) {
  const h = {
    'User-Agent': 'ArchivCZSK/3.5.2 (plugin.video.stream-cinema/3.30)',
    'X-Uuid': config.uid,
    'Accept': 'application/json'
  };
  if (token) h['X-AUTH-TOKEN'] = token;
  return h;
}

function params(config) {
  const p = new URLSearchParams({
    ver: '2.0', uid: config.uid,
    lang: (Array.isArray(config.preferredLanguages) && config.preferredLanguages[0]) || 'sk',
    gen: '0', HDR: '1', DV: '0'
  });
  return p;
}

async function tokenFromKraFile(kra, name) {
  try {
    const listed = await kra.listFiles(name, null);
    const files = Array.isArray(listed?.data) ? listed.data : [];
    for (const f of files) {
      if (f?.name && f.name !== name) continue;
      if (!f?.ident) continue;
      const link = await kra.resolveIdent(f.ident);
      const r = await fetch(link, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const text = (await r.text()).trim();
      if (/^[A-Za-z0-9_-]{32}$/.test(text)) return text;
      try {
        const parsed = JSON.parse(text);
        const token = String(parsed?.token || '').trim();
        if (/^[A-Za-z0-9_-]{32}$/.test(token)) return token;
      } catch {}
    }
  } catch {}
  return null;
}

async function tokenWorks(config, token) {
  try {
    const p = params(config);
    const url = `${SC_BASE}kodi/FMovies/latest?${p}`;
    const r = await fetch(url, { headers: headers(config, token), signal: AbortSignal.timeout(15000) });
    return r.ok;
  } catch { return false; }
}

export class StreamCinemaClient extends BaseStreamCinemaClient {
  async getAuthToken(force = false) {
    const k = key(this.config);
    const cached = directTokenCache.get(k);
    if (!force && cached?.token && Date.now() - cached.at < TTL) return cached.token;

    // Official Stream Cinema 3.30 first restores a valid SC token stored on KRA.
    if (!force) {
      for (const name of ['sc.json', 'sc_token.txt']) {
        const token = await tokenFromKraFile(this.kra, name);
        if (token && await tokenWorks(this.config, token)) {
          directTokenCache.set(k, { token, at: Date.now(), source: `kra:${name}` });
          return token;
        }
      }
    }

    // Fall back to direct SC token creation using the KRA session token (krt).
    const krt = await this.kra.login(force);
    const p = params(this.config);
    p.set('krt', krt);
    const url = `${SC_BASE}kodi/auth/token?${p}`;
    const data = await responseJson(url, { method: 'POST', headers: headers(this.config), body: '' });
    const token = String(data?.token || '').trim();
    if (!token) throw new Error(`Stream Cinema authentication failed${data?.msg ? `: ${data.msg}` : ''}`);
    directTokenCache.set(k, { token, at: Date.now(), source: 'direct' });
    return token;
  }
}

export * from './sc.js';
