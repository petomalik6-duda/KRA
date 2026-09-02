import { KraClient } from './kra.js';
import {
  StreamCinemaClient,
  decryptStreamCinemaIdent,
  itemLabel,
  menuItems,
  rankSearchCandidates,
  rankTraversalItems,
  streamItems,
  versionIdent
} from './sc.js';
import {
  firstString,
  formatBytes,
  languageRank,
  parseStremioId,
  qualityRank,
  safeMessage
} from './utils.js';

export const ADDON_ID = 'community.kra.streamcinema.bridge';
export const ADDON_VERSION = '1.0.5';

export function makeManifest(configured = false) {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: 'KRA • Stream Cinema',
    description: 'Streams for movies and series via the user\'s own KRA account and Stream Cinema metadata.',
    resources: [
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }
    ],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    behaviorHints: {
      configurable: true,
      configurationRequired: !configured
    }
  };
}

async function getCinemeta(type, imdbId) {
  const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Cinemeta HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.meta) throw new Error('Cinemeta returned no metadata.');
  return data.meta;
}

function findEpisodeMeta(meta, season, episode) {
  if (season == null || episode == null) return null;
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  return videos.find((v) => Number(v?.season) === season && Number(v?.episode) === episode) || null;
}

function yearFromMeta(meta) {
  const candidates = [meta?.year, meta?.releaseInfo, meta?.released];
  for (const v of candidates) {
    const m = String(v ?? '').match(/(?:19|20)\d{2}/);
    if (m) return Number(m[0]);
  }
  return null;
}

function directScUrl(stream) {
  const url = String(stream?.url || '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  return null;
}

function scProvider(stream) {
  return String(stream?.provider || '').trim().toLowerCase();
}

function traversalKey(url) {
  return String(url || '').replace(/([?&](?:ver|uid|lang|skin|HDR|DV|old|token|krt)=[^&]*)/gi, '');
}

async function fetchStreamBranch(sc, rootItem, target, options = {}) {
  const maxNodes = options.maxNodes ?? 80;
  const maxDepth = options.maxDepth ?? 5;
  const queue = [];
  const seen = new Set();
  if (rootItem?.url) queue.push({ url: rootItem.url, depth: 0, score: 1000, via: itemLabel(rootItem) });

  let bestStreams = [];
  let bestStreamScore = -Infinity;
  let visited = 0;
  while (queue.length && visited < maxNodes) {
    queue.sort((a, b) => b.score - a.score);
    const node = queue.shift();
    const key = traversalKey(node.url);
    if (!node.url || seen.has(key) || node.depth > maxDepth) continue;
    seen.add(key);
    visited++;

    let response;
    try { response = await sc.get(node.url); }
    catch { continue; }
    const streams = streamItems(response);
    if (streams.length) {
      const matchScore = node.score + (target.episode != null ? 0 : 100);
      if (matchScore > bestStreamScore) {
        bestStreams = streams;
        bestStreamScore = matchScore;
      }
      // Strong episode match: don't traverse unrelated siblings further.
      if (target.episode == null || node.score >= 1150) break;
    }

    const children = menuItems(response);
    if (!children.length || node.depth >= maxDepth) continue;
    const ranked = rankTraversalItems(children, target, node.depth);
    const limit = target.episode != null ? 24 : 16;
    for (const { item, score } of ranked.slice(0, limit)) {
      if (!item?.url) continue;
      // Once we are looking for an episode, prioritize matches but keep a few directory fallbacks.
      const type = String(item?.type || '').toLowerCase();
      const fallback = /dir|folder|season|episode|video|file/.test(type) ? 5 : 0;
      queue.push({
        url: item.url,
        depth: node.depth + 1,
        score: node.score * 0.2 + score + fallback,
        via: itemLabel(item)
      });
    }
  }
  return { streams: bestStreams, visited };
}

async function resolveScStream(sc, kra, stream) {
  const provider = scProvider(stream);
  if (provider === 'kraska' || provider === 'kra' || provider === 'kra.sk') {
    if (!stream?.url) throw new Error('KRA stream has no Stream Cinema URL.');
    const descriptor = await sc.get(stream.url);
    const wrapped = versionIdent(descriptor);
    if (!wrapped) throw new Error('Stream Cinema returned no version ident.');
    const ident = decryptStreamCinemaIdent(wrapped);
    if (!ident) throw new Error('Could not verify/decode Stream Cinema KRA ident.');
    return kra.resolveIdent(ident);
  }

  const direct = directScUrl(stream);
  if (direct) return direct;

  // Some responses omit provider but still point to an SC descriptor containing v1/v2.
  if (stream?.url) {
    try {
      const descriptor = await sc.get(stream.url);
      const wrapped = versionIdent(descriptor);
      if (wrapped) {
        const ident = decryptStreamCinemaIdent(wrapped);
        if (ident) return kra.resolveIdent(ident);
      }
    } catch { /* keep as unresolved */ }
  }
  throw new Error(`Unsupported stream provider: ${provider || 'unknown'}`);
}

function streamTitle(stream) {
  const quality = firstString(stream?.quality, /2160|4k/i.test(stream?.name || '') ? '4K' : '');
  const lang = Array.isArray(stream?.lang) ? stream.lang.join('/') : firstString(stream?.lang, stream?.langs?.join?.('/'));
  const size = formatBytes(stream?.size);
  const bitrate = Number(stream?.bitrate);
  return [quality, lang, size, Number.isFinite(bitrate) && bitrate > 0 ? `${Math.round(bitrate / 1000)} kbps` : '', stream?.ainfo, stream?.vinfo]
    .filter(Boolean).join(' • ') || firstString(stream?.title, stream?.name, 'Stream');
}

function normalizePlaybackUrl(value) {
  const raw = String(value || '').trim();
  const pipe = raw.indexOf('|');
  if (pipe < 0) return { url: raw, headers: null };
  const url = raw.slice(0, pipe);
  const headerText = raw.slice(pipe + 1);
  const headers = {};
  for (const part of headerText.split('&')) {
    const [k, ...rest] = part.split('=');
    if (!k || !rest.length) continue;
    try { headers[decodeURIComponent(k)] = decodeURIComponent(rest.join('=')); }
    catch { headers[k] = rest.join('='); }
  }
  return { url, headers: Object.keys(headers).length ? headers : null };
}

export async function getStreams(config, type, rawId) {
  const id = parseStremioId(type, rawId);
  const meta = await getCinemeta(type, id.imdbId);
  const episodeMeta = type === 'series' ? findEpisodeMeta(meta, id.season, id.episode) : null;
  const target = {
    imdbId: id.imdbId,
    title: meta.name || meta.title || id.imdbId,
    year: yearFromMeta(meta),
    season: id.season,
    episode: id.episode,
    episodeTitle: episodeMeta?.name || episodeMeta?.title || ''
  };

  const kra = new KraClient(config);
  const sc = new StreamCinemaClient(config, kra);
  const searchResponse = await sc.search(type, target.title, target.imdbId);
  const searchItems = menuItems(searchResponse);
  const ranked = rankSearchCandidates(searchItems, target);
  const candidates = ranked.filter((x) => x.exactId || x.titleScore >= 0.35).slice(0, 4);
  if (!candidates.length) return {
    streams: [],
    diagnostics: {
      stage: 'search',
      route: searchResponse?.__searchRoute || null,
      extractedItems: searchItems.length,
      responseShape: responseShape(searchResponse),
      candidates: ranked.slice(0, 8).map(({score, exactId, titleScore, year, item}) => ({score, exactId, titleScore, year, title:itemLabel(item), url:!!item?.url}))
    }
  };

  let sourceStreams = [];
  let branchVisited = 0;
  for (const candidate of candidates) {
    const found = await fetchStreamBranch(sc, candidate.item, target, {
      maxNodes: type === 'series' ? 100 : 45,
      maxDepth: type === 'series' ? 6 : 4
    });
    branchVisited += found.visited;
    if (found.streams.length) {
      sourceStreams = found.streams;
      break;
    }
  }
  if (!sourceStreams.length) return { streams: [], diagnostics: { stage: 'branch', candidateCount: candidates.length, branchVisited } };

  const preferred = Array.isArray(config.preferredLanguages) && config.preferredLanguages.length
    ? config.preferredLanguages
    : ['sk', 'cs'];
  sourceStreams.sort((a, b) => (qualityRank(b) + languageRank(b, preferred)) - (qualityRank(a) + languageRank(a, preferred)));

  const maxStreams = Math.max(1, Math.min(20, Number(config.maxStreams) || 10));
  const resolved = [];
  const errors = [];
  for (const source of sourceStreams.slice(0, Math.max(maxStreams * 2, 12))) {
    try {
      const rawUrl = await resolveScStream(sc, kra, source);
      const parsed = normalizePlaybackUrl(rawUrl);
      if (!/^https?:\/\//i.test(parsed.url)) throw new Error('Resolved link is not HTTP(S).');
      if (resolved.some((x) => x.url === parsed.url)) continue;
      const behaviorHints = { notWebReady: true };
      if (parsed.headers) behaviorHints.proxyHeaders = { request: parsed.headers };
      resolved.push({
        name: `KRA • ${firstString(source?.quality, 'Stream')}`,
        title: streamTitle(source),
        url: parsed.url,
        behaviorHints
      });
      if (resolved.length >= maxStreams) break;
    } catch (e) {
      errors.push(safeMessage(e));
    }
  }

  return {
    streams: resolved,
    diagnostics: {
      stage: resolved.length ? 'ok' : 'resolve',
      sourceStreams: sourceStreams.length,
      resolvedStreams: resolved.length,
      branchVisited,
      resolveErrors: [...new Set(errors)].slice(0, 6)
    }
  };
}
