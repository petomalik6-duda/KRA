import { debug } from './utils.js';

export const APP_USER_AGENT = 'Kodi/21.0 (Linux; Android) (sk;; ver2.6.6.0+k19)';

export class HttpError extends Error {
  constructor(message, status, body = null, url = '') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000;
  const headers = new Headers(options.headers || {});
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/plain, */*');
  const init = {
    method: options.method || 'GET',
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs)
  };
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json; charset=utf-8');
    init.body = JSON.stringify(options.json);
  } else if (options.body !== undefined) {
    init.body = options.body;
  }

  debug(init.method, String(url).replace(/([?&](?:krt|token|session_id|auth|uid)=)[^&]+/gi, '$1***'));
  const response = await fetch(url, init);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { data = { _raw: text.slice(0, 2000) }; }
  }
  if (!response.ok) throw new HttpError(`HTTP ${response.status}`, response.status, data, String(url));
  return data;
}
