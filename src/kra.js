import { APP_USER_AGENT, fetchJson, HttpError } from './http.js';
import { debug, safeMessage } from './utils.js';

export const KRA_BASE = 'https://api.kra.sk/';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const sessionCache = new Map();

function cacheKey(config) {
  return `${config.username}\u0000${config.uid}`;
}

function commonHeaders(config) {
  return {
    'User-Agent': APP_USER_AGENT,
    'X-Uuid': config.uid
  };
}

export class KraClient {
  constructor(config) {
    this.config = config;
    this.key = cacheKey(config);
  }

  clearSession() {
    sessionCache.delete(this.key);
  }

  async login(force = false) {
    const cached = sessionCache.get(this.key);
    if (!force && cached?.sessionId && Date.now() - cached.createdAt < SESSION_TTL_MS) return cached.sessionId;

    const data = await fetchJson(new URL('api/user/login', KRA_BASE), {
      method: 'POST',
      headers: commonHeaders(this.config),
      json: { data: { username: this.config.username, password: this.config.password } }
    });
    if (!data?.session_id) {
      throw new Error(`KRA login failed${data?.msg ? `: ${data.msg}` : data?.error != null ? ` (error ${data.error})` : ''}`);
    }
    sessionCache.set(this.key, { sessionId: data.session_id, createdAt: Date.now() });
    debug('KRA login OK');
    return data.session_id;
  }

  async userInfo() {
    const call = async (force = false) => {
      const sessionId = await this.login(force);
      return fetchJson(new URL('api/user/info', KRA_BASE), {
        method: 'POST',
        headers: commonHeaders(this.config),
        json: { session_id: sessionId }
      });
    };
    try { return await call(false); }
    catch (e) {
      if (e instanceof HttpError && [401, 403].includes(e.status)) return call(true);
      throw e;
    }
  }

  async listFiles(filter = null, parent = null) {
    const call = async (force = false) => {
      const sessionId = await this.login(force);
      return fetchJson(new URL('api/file/list', KRA_BASE), {
        method: 'POST',
        headers: commonHeaders(this.config),
        json: { data: { parent, filter }, session_id: sessionId }
      });
    };
    try { return await call(false); }
    catch (e) {
      if (e instanceof HttpError && [401, 403].includes(e.status)) return call(true);
      throw e;
    }
  }

  async resolveIdent(ident) {
    if (!ident) throw new Error('Empty KRA ident.');
    const call = async (force = false) => {
      const sessionId = await this.login(force);
      const data = await fetchJson(new URL('api/file/download', KRA_BASE), {
        method: 'POST',
        headers: commonHeaders(this.config),
        json: { data: { ident }, session_id: sessionId }
      });
      const link = data?.data?.link;
      if (typeof link === 'string' && link.trim()) return link.trim();
      const msg = String(data?.msg || 'KRA returned no stream link');
      const err = new Error(`${msg}${data?.error != null ? ` (error ${data.error})` : ''}`);
      err.kraResponse = data;
      throw err;
    };

    try { return await call(false); }
    catch (e) {
      const text = safeMessage(e).toLowerCase();
      const code = Number(e?.kraResponse?.error);
      const authish = e instanceof HttpError && [401, 403].includes(e.status)
        || [401, 403].includes(code)
        || /session|token|auth|login|prihl/.test(text);
      if (!authish) throw e;
      this.clearSession();
      return call(true);
    }
  }
}
