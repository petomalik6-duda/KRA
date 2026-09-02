import { APP_USER_AGENT, fetchJson, HttpError } from './http.js';
import { asArray, collectImdbIds, debug, firstString, normalizeText, parseYear, titleSimilarity } from './utils.js';

export const SC_BASE = 'https://stream-cinema.online/';
export const SC_VERSION = '2.0';
export const SC_LANGUAGE = 'sk';
export const SC_SKIN = 'skin.estuary';
const AUTH_TTL_MS = 2 * 60 * 60 * 1000;
const authCache = new Map();
const searchPathCache = new Map();

// Public RSA modulus/exponent embedded in the supplied APK. It verifies/recovers signed SC identifiers.
const SC_RSA_MODULUS = BigInt('0x' +
  'e6693bcbba8c960b83da0dc208f9a94a2ecc929dd0a923b1e0e6558a4328dcf1341bbaab1493a05bb5970d875cafa1a7889e7c25f3dd02626d3ce6b7a4547970b65fe55bd4dcb6d74950026bd392f5eb62759a62be1990356a9382ec3b9871548e61f6523b22eb253f378ab76cc595b008c402ebaffdd75f700ff382f9d1e3c172bd7741555b7a60b85df1bfac0ab8ad81c0f76b0e0597857ff5b7ee5a1654039004391a0f9aa7db444ae5600e9964c471d0c93fd8f86b12c94534de2dbe00eb6cb83b063f19bde4b12b3937facb303405ac496fa681b4f382c3e77dd5b59ca55051833bbbb3faea663ca81c63b96cc04f4021fc0ebb216675216f52f72e7381');
const SC_RSA_EXPONENT = 0x10001n;
const SC_RSA_BYTES = Math.ceil(SC_RSA_MODULUS.toString(2).length / 8);

function bigintFromBuffer(buf) {
  if (!buf?.length) return 0n;
  return BigInt('0x' + Buffer.from(buf).toString('hex'));
}

function bufferFromBigint(value, length) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let out = Buffer.from(hex, 'hex');
  if (out.length > length) out = out.subarray(out.length - length);
  if (out.length < length) out = Buffer.concat([Buffer.alloc(length - out.length), out]);
  return out;
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    exponent >>= 1n;
    base = (base * base) % modulus;
  }
  return result;
}

export function recoverSignedIdent(payload) {
  try {
    const signature = Buffer.from(String(payload), 'base64url');
    if (!signature.length) return null;
    const recoveredNumber = modPow(bigintFromBuffer(signature), SC_RSA_EXPONENT, SC_RSA_MODULUS);
    const block = bufferFromBigint(recoveredNumber, SC_RSA_BYTES);
    // PKCS#1 v1.5 block type 1: 00 01 FF... FF 00 <message>
    if (block.length < 11 || block[0] !== 0x00 || block[1] !== 0x01) return null;
    let i = 2;
    while (i < block.length && block[i] === 0xff) i++;
    if (i < 10 || i >= block.length || block[i] !== 0x00) return null;
    i++;
    if (i >= block.length) return null;
    const text = block.subarray(i).toString('utf8');
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

export function decryptStreamCinemaIdent(ident) {
  const value = String(ident ?? '');
  const colon = value.indexOf(':');
  if (colon <= 1 || value[0] !== 'v') return value;
  const version = Number.parseInt(value.slice(1, colon), 10);
  if (!Number.isInteger(version)) return null;
  const payload = value.slice(colon + 1);
  if (!payload.trim()) return null;
  if (version === 0) return payload;
  if (version === 1 || version === 2) return recoverSignedIdent(payload);
  return null;
}

export function versionIdent(response) {
  const version = Number(response?.version);
  if (version === 1 && response?.v1 != null) return `v1:${response.v1}`;
  if (version === 2 && response?.v2 != null) return `v2:${response.v2}`;
  return null;
}

function commonQuery(url, config) {
  if (!url.searchParams.has('ver')) url.searchParams.set('ver', SC_VERSION);
  if (!url.searchParams.has('uid')) url.searchParams.set('uid', config.uid);
  if (!url.searchParams.has('lang')) url.searchParams.set('lang', SC_LANGUAGE);
  if (!url.searchParams.has('skin')) url.searchParams.set('skin', SC_SKIN);
  if (!url.searchParams.has('HDR')) url.searchParams.set('HDR', '1');
  if (!url.searchParams.has('DV')) url.searchParams.set('DV', '0');
  if (!url.searchParams.has('old')) url.searchParams.set('old', '1');
  return url;
}

function commonHeaders(config, authToken = null) {
  const headers = {
    'User-Agent': APP_USER_AGENT,
    'X-Uuid': config.uid
  };
  if (authToken) headers['X-AUTH-TOKEN'] = authToken;
  return headers;
}

function authKey(config) { return `${config.username}\u0000${config.uid}`; }

export class StreamCinemaClient {
  constructor(config, kraClient) {
    this.config = config;
    this.kra = kraClient;
    this.key = authKey(config);
  }

  clearAuth() { authCache.delete(this.key); }

  async getAuthToken(force = false) {
    const cached = authCache.get(this.key);
    if (!force && cached?.token && Date.now() - cached.createdAt < AUTH_TTL_MS) return cached.token;
    const kraToken = await this.kra.login(force);
    const url = new URL('kodi/auth/token', SC_BASE);
    url.searchParams.set('krt', kraToken);
    commonQuery(url, this.config);
    const data = await fetchJson(url, {
      method: 'POST',
      headers: commonHeaders(this.config)
    });
    if (!data?.token) throw new Error(`Stream Cinema authentication failed${data?.error ? `: ${data.error}` : ''}`);
    authCache.set(this.key, { token: data.token, createdAt: Date.now() });
    debug('Stream Cinema auth OK');
    return data.token;
  }

  async get(pathOrUrl, forceAuth = false) {
    const authToken = await this.getAuthToken(forceAuth);
    let url;
    try { url = new URL(pathOrUrl, SC_BASE); }
    catch { throw new Error(`Invalid Stream Cinema URL: ${pathOrUrl}`); }
    if (url.origin !== new URL(SC_BASE).origin) throw new Error(`Refusing non-Stream-Cinema menu URL: ${url.origin}`);
    commonQuery(url, this.config);
    try {
      return await fetchJson(url, { headers: commonHeaders(this.config, authToken) });
    } catch (e) {
      if (!forceAuth && e instanceof HttpError && [401, 403].includes(e.status)) {
        this.clearAuth();
        return this.get(pathOrUrl, true);
      }
      throw e;
    }
  }

  async search(type, query, imdbId = '') {
    const searchId = type === 'series' ? 'search-series' : 'search-movie';
    const mediaPath = type === 'series' ? 'FSeries/search' : 'FMovies/search';

    // The APK exposes two pieces of information:
    //  1) Retrofit: GET kodi/Search/{searchId}
    //  2) static menu: /FMovies/search or /FSeries/search with action id search-movie/search-series.
    // Some SC deployments route one form and return 404 for the other, so probe safe GET
    // variants on 404 and cache the first one that works. This avoids guessing forever.
    const candidates = [
      `kodi/Search/${searchId}`,
      `kodi/Search/${searchId}/`,
      `kodi/${mediaPath}`,
      mediaPath,
      `Search/${searchId}`,
      `Search/${searchId}/`
    ];
    const cacheKey = type;
    const cached = searchPathCache.get(cacheKey);
    if (cached) {
      const i = candidates.indexOf(cached);
      if (i > 0) candidates.unshift(candidates.splice(i, 1)[0]);
    }

    const attempts = [];
    let lastError = null;
    for (const path of candidates) {
      const url = new URL(path, SC_BASE);
      url.searchParams.set('search', query);
      url.searchParams.set('id', searchId);
      url.searchParams.set('ms', '0');
      try {
        const data = await this.get(url.toString());
        searchPathCache.set(cacheKey, path);
        if (data && typeof data === 'object') {
          Object.defineProperty(data, '__searchRoute', { value: path, enumerable: false });
        }
        return data;
      } catch (e) {
        lastError = e;
        attempts.push({ path: url.pathname, status: e instanceof HttpError ? e.status : null });
        if (!(e instanceof HttpError) || e.status !== 404) throw e;
      }
    }

    if (lastError instanceof HttpError) {
      throw new HttpError(
        'HTTP 404 on all Stream Cinema search route variants',
        404,
        { searchAttempts: attempts },
        lastError.url
      );
    }
    throw lastError || new Error('Stream Cinema search failed.');
  }
}

export function menuItems(response) {
  const out = [];
  const seenObjects = new Set();
  const seenItems = new Set();
  const preferredKeys = new Set(['menu', 'items', 'results', 'result', 'data', 'content', 'list', 'movies', 'series']);

  const looksLikeItem = (x) => {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
    return Boolean(
      x.url || x.title || x.name || x.label || x.info || x.i18n_info ||
      x.unique_ids || x.imdb || x.imdb_id || x.ident || x.id
    );
  };

  const pushItem = (x) => {
    if (!looksLikeItem(x) || seenItems.has(x)) return;
    seenItems.add(x);
    out.push(x);
  };

  const walk = (node, depth = 0, fromPreferredKey = false) => {
    if (node == null || depth > 6) return;
    if (Array.isArray(node)) {
      for (const x of node) {
        if (fromPreferredKey) pushItem(x);
        if (x && typeof x === 'object') walk(x, depth + 1, false);
      }
      return;
    }
    if (typeof node !== 'object' || seenObjects.has(node)) return;
    seenObjects.add(node);

    // Some SC responses wrap one result object directly instead of an array.
    if (fromPreferredKey) pushItem(node);

    for (const [key, value] of Object.entries(node)) {
      if (value == null || typeof value !== 'object') continue;
      walk(value, depth + 1, preferredKeys.has(String(key).toLowerCase()));
    }
  };

  walk(response, 0, false);
  return out;
}

export function responseShape(response) {
  if (response == null) return { type: String(response), keys: [], arrays: [] };
  if (Array.isArray(response)) return { type: 'array', keys: [], arrays: [{ path: '$', length: response.length }] };
  if (typeof response !== 'object') return { type: typeof response, keys: [], arrays: [] };

  const arrays = [];
  const seen = new Set();
  const walk = (node, path = '$', depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 3 || seen.has(node)) return;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (Array.isArray(value)) {
        arrays.push({ path: childPath, length: value.length });
        for (const item of value.slice(0, 2)) walk(item, `${childPath}[]`, depth + 1);
      } else if (value && typeof value === 'object') {
        walk(value, childPath, depth + 1);
      }
      if (arrays.length >= 20) return;
    }
  };
  walk(response);
  return { type: 'object', keys: Object.keys(response).slice(0, 30), arrays: arrays.slice(0, 20) };
}

export function streamItems(response) {
  const streams = response?.strms ?? response?.streams;
  return asArray(streams).filter((x) => x && typeof x === 'object');
}

function itemTitles(item) {
  const values = [item?.title, item?.info?.title];
  for (const info of Object.values(item?.i18n_info || {})) values.push(info?.title);
  return values.filter((v) => typeof v === 'string' && v.trim());
}

function candidateYear(item) {
  return parseYear(item?.info?.year ?? item?.year ?? item?.title ?? Object.values(item?.i18n_info || {}).map((x) => x?.year));
}

export function rankSearchCandidates(items, target) {
  const wantedId = String(target.imdbId || '').toLowerCase();
  return items.map((item) => {
    const ids = collectImdbIds(item);
    const exactId = wantedId && ids.has(wantedId);
    const titles = itemTitles(item);
    let titleScore = 0;
    for (const t of titles) titleScore = Math.max(titleScore, titleSimilarity(t, target.title));
    const year = candidateYear(item);
    let score = titleScore * 100;
    if (exactId) score += 10000;
    if (target.year && year) score += year === target.year ? 35 : Math.max(-30, -Math.abs(year - target.year) * 10);
    if (item?.url) score += 5;
    return { item, score, exactId, titleScore, year };
  }).sort((a, b) => b.score - a.score);
}

function episodeText(item) {
  return [item?.title, item?.info?.title, item?.url, item?.id, item?.ident]
    .filter(Boolean).join(' ');
}

function numberPatternScore(text, season, episode) {
  const n = normalizeText(text);
  const raw = String(text || '').toLowerCase();
  let score = 0;
  if (season != null && episode != null) {
    const ss = String(season).padStart(2, '0');
    const ee = String(episode).padStart(2, '0');
    if (new RegExp(`s0*${season}\\s*e0*${episode}`, 'i').test(raw)) score += 200;
    if (new RegExp(`(?:^|[^0-9])0*${season}\\s*[x×]\\s*0*${episode}(?:[^0-9]|$)`, 'i').test(raw)) score += 190;
    if (raw.includes(`s${ss}e${ee}`)) score += 210;
    if (new RegExp(`(?:season|serie|séria|sezona|sezóna)\\s*0*${season}(?:[^0-9]|$)`, 'i').test(raw)) score += 40;
    if (new RegExp(`(?:episode|epizoda|epizóda|dil|díl|cast|časť)\\s*0*${episode}(?:[^0-9]|$)`, 'i').test(raw)) score += 90;
    if (new RegExp(`(?:^|[/_-])0*${season}(?:[/_-])0*${episode}(?:[/_.?_-]|$)`, 'i').test(raw)) score += 150;
    if (n.includes(`${season} ${episode}`)) score += 20;
  } else if (season != null) {
    if (new RegExp(`(?:season|serie|séria|sezona|sezóna)\\s*0*${season}(?:[^0-9]|$)`, 'i').test(raw)) score += 80;
  }
  return score;
}

export function rankTraversalItems(items, target, depth = 0) {
  return items.map((item, index) => {
    const text = episodeText(item);
    let score = numberPatternScore(text, target.season, target.episode);
    if (target.episodeTitle) score += titleSimilarity(text, target.episodeTitle) * 100;
    const type = String(item?.type || '').toLowerCase();
    if (/video|file|play/.test(type)) score += target.episode != null ? 20 : 5;
    if (/dir|folder|season|episode/.test(type)) score += 5;
    if (depth === 0 && target.season != null && new RegExp(`(?:^|[^0-9])0*${target.season}(?:[^0-9]|$)`).test(text)) score += 10;
    return { item, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
}

export function itemLabel(item) {
  return firstString(item?.info?.title, item?.title, item?.url, 'item');
}
