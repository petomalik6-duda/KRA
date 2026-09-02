import crypto from 'node:crypto';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

export function safeMessage(error) {
  if (!error) return 'Unknown error';
  const msg = error instanceof Error ? error.message : String(error);
  return msg.replace(/(session_id|X-AUTH-TOKEN|token|krt)=([^&\s]+)/gi, '$1=***');
}

export function debug(...args) {
  if (process.env.DEBUG === '1') console.log('[debug]', ...args.map(redactValue));
}

function redactValue(value) {
  if (typeof value === 'string') {
    return value
      .replace(/([?&](?:krt|token|session_id|auth|X-AUTH-TOKEN|uid)=)[^&]+/gi, '$1***')
      .replace(/("password"\s*:\s*")[^"]+/gi, '$1***')
      .replace(/("session_id"\s*:\s*")[^"]+/gi, '$1***');
  }
  if (value && typeof value === 'object') {
    try { return redactValue(JSON.stringify(value)); } catch { return '[object]'; }
  }
  return value;
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function titleSimilarity(a, b) {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.86;
  const xs = new Set(x.split(' ').filter(Boolean));
  const ys = new Set(y.split(' ').filter(Boolean));
  let intersection = 0;
  for (const t of xs) if (ys.has(t)) intersection++;
  const union = new Set([...xs, ...ys]).size || 1;
  return intersection / union;
}

export function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseYear(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const m = value.match(/(?:19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) {
      const y = parseYear(v);
      if (y) return y;
    }
  }
  return null;
}

export function collectImdbIds(value, out = new Set(), depth = 0) {
  if (depth > 6 || value == null) return out;
  if (typeof value === 'string') {
    for (const m of value.matchAll(/tt\d{5,12}/gi)) out.add(m[0].toLowerCase());
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectImdbIds(v, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/imdb/i.test(k) && (typeof v === 'string' || typeof v === 'number')) {
        const s = String(v);
        const m = s.match(/tt\d{5,12}/i) || s.match(/^\d{5,12}$/);
        if (m) out.add((m[0].startsWith('tt') ? m[0] : `tt${m[0]}`).toLowerCase());
      }
      collectImdbIds(v, out, depth + 1);
    }
  }
  return out;
}

export function firstString(...values) {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

export function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = n, i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x >= 10 || i === 0 ? x.toFixed(0) : x.toFixed(1)} ${units[i]}`;
}

export function qualityRank(stream) {
  const text = [stream?.quality, stream?.name, stream?.title, stream?.vinfo, stream?.ainfo]
    .filter(Boolean).join(' ').toLowerCase();
  if (/4320|8k/.test(text)) return 600;
  if (/2160|4k|uhd/.test(text)) return 500;
  if (/1440/.test(text)) return 450;
  if (/1080/.test(text)) return 400;
  if (/720/.test(text)) return 300;
  if (/576|540|480/.test(text)) return 200;
  return 100;
}

export function languageRank(stream, preferred = ['sk', 'cs']) {
  const text = JSON.stringify([stream?.lang, stream?.langs, stream?.name, stream?.title, stream?.ainfo]).toLowerCase();
  let score = 0;
  preferred.forEach((lang, idx) => {
    const variants = lang === 'cs' ? ['cs', 'cz', 'czech', 'cesk'] : lang === 'sk' ? ['sk', 'slovak', 'sloven'] : [lang];
    if (variants.some((v) => new RegExp(`(^|[^a-z])${v}`, 'i').test(text))) score = Math.max(score, 80 - idx * 10);
  });
  return score;
}

export function parseStremioId(type, rawId) {
  const clean = String(rawId || '').replace(/\.json$/i, '');
  const parts = clean.split(':');
  const imdbId = parts[0];
  if (!/^tt\d+$/i.test(imdbId)) throw new Error(`Unsupported id: ${rawId}`);
  if (type === 'series') {
    const season = Number(parts[1]);
    const episode = Number(parts[2]);
    return {
      imdbId,
      season: Number.isFinite(season) && season >= 0 ? season : null,
      episode: Number.isFinite(episode) && episode >= 0 ? episode : null
    };
  }
  return { imdbId, season: null, episode: null };
}

export function htmlEscape(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
