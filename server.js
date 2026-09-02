import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { decodeConfig, encodeConfig, configSecurityMode } from './src/config.js';
import { KraClient } from './src/kra.js';
import { HttpError } from './src/http.js';
import { StreamCinemaClient } from './src/sc.js';
import { getStreams, getCatalog, getMeta, makeManifest, ADDON_VERSION, CATALOGS } from './src/stremio.js';
import { enrichMetaWithTmdb, tmdbConfigured } from './src/tmdb.js';
import { htmlEscape, safeMessage } from './src/utils.js';

const PORT = Number(process.env.PORT || 3000);

function normalizeBridgeBase(rawValue) {
  const raw = String(rawValue || '').trim().replace(/\/+$/, '');
  return raw.endsWith('/manifest.json') ? raw.slice(0, -'/manifest.json'.length) : raw;
}

function bridgeBase() { return normalizeBridgeBase(process.env.UPSTREAM_STREMIO_BASE); }

async function bridgeJson(relativePath) {
  const base = bridgeBase();
  if (!base) return null;
  const clean = String(relativePath).replace(/^\/+/, '');
  const target = `${base}/${clean}`;
  const r = await fetch(target, {
    signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'User-Agent': 'Stremio-KRA-Bridge/2.4.1' }
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Upstream bridge HTTP ${r.status}`);
    err.bridge = { status: r.status, path: clean };
    throw err;
  }
  try { return JSON.parse(text); }
  catch {
    const err = new Error('Upstream bridge returned non-JSON response.');
    err.bridge = { status: r.status, path: clean, preview: text.slice(0, 240) };
    throw err;
  }
}


function bridgeCatalogPath(type, catalogId, extra = {}) {
  const cat = CATALOGS.find(c => c.id === catalogId && c.type === type);
  if (!cat) return null;
  const merged = { ...(cat.fixedExtra || {}), ...(extra || {}) };
  let upstreamId = catalogId;
  if (cat.derivedDubbed) upstreamId = type === 'movie' ? 'sc-movie-latest' : 'sc-series-latest';
  else if (cat.fixedExtra) upstreamId = type === 'movie' ? 'sc-movie-filter' : 'sc-series-filter';
  const params = new URLSearchParams();
  for (const [k,v] of Object.entries(merged)) {
    if (v !== undefined && v !== null && String(v) !== '') params.set(k, String(v));
  }
  const suffix = params.toString();
  return `catalog/${type}/${upstreamId}${suffix ? `/${suffix}` : ''}.json`;
}


const dubbedCatalogCache = new Map();
const DUBBED_CACHE_MS = 30 * 60 * 1000;

function streamText(stream) {
  const parts = [stream?.name, stream?.title, stream?.description, stream?.lang, stream?.language, stream?.audio, stream?.behaviorHints?.filename];
  return parts.flatMap(v => Array.isArray(v) ? v : [v]).filter(Boolean).join(' ').toLowerCase();
}
function isCzSkDubbedStream(stream) {
  const t = streamText(stream).replace(/[č]/g,'c').replace(/[š]/g,'s').replace(/[ž]/g,'z');
  return /(^|[\s|•,;()\[\]_-])(cz|cs|cze|czech|cesky|cestina|sk|svk|slovak|slovensky|slovencina)(?=$|[\s|•,;()\[\]_-])/.test(t)
    || /audio[^a-z0-9]{0,6}(cz|cs|sk|czech|slovak)/.test(t)
    || /(cz|cs|sk)[^a-z0-9]{0,6}(dub|dab)/.test(t)
    || /(czech|slovak)[^a-z0-9]{0,10}(audio|dub)/.test(t);
}
async function hasDubbedStream(type, id) {
  try {
    const payload = await bridgeJson(`stream/${type}/${encodeURIComponent(String(id))}.json`);
    const streams = Array.isArray(payload?.streams) ? payload.streams : [];
    return streams.some(isCzSkDubbedStream);
  } catch { return false; }
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)}, async()=>{
    while(true){ const i=next++; if(i>=items.length) break; out[i]=await fn(items[i],i); }
  });
  await Promise.all(workers); return out;
}
async function bridgeDubbedCatalog(type, extra={}) {
  const skip=Math.max(0,Number(extra.skip)||0);
  const cacheKey=`${type}:${skip}`; const hit=dubbedCatalogCache.get(cacheKey);
  if(hit && Date.now()-hit.at<DUBBED_CACHE_MS) return hit.data;
  const upstreamId=type==='movie'?'sc-movie-latest':'sc-series-latest';
  const suffix=skip?`/skip=${skip}`:'';
  const latest=await bridgeJson(`catalog/${type}/${upstreamId}${suffix}.json`);
  const metas=Array.isArray(latest?.metas)?latest.metas:[];
  const flags=await mapLimit(metas,8,m=>m?.id?hasDubbedStream(type,m.id):false);
  const filtered=metas.filter((_,i)=>flags[i]);
  const data={metas:filtered}; dubbedCatalogCache.set(cacheKey,{at:Date.now(),data}); return data;
}

function corsHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Cache-Control': 'no-store'
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, corsHeaders());
  res.end(JSON.stringify(body));
}


function safeUpstreamError(e) {
  if (!(e instanceof HttpError)) return null;
  try {
    const u = new URL(e.url);
    for (const key of ['krt','token','session_id','auth','uid']) {
      if (u.searchParams.has(key)) u.searchParams.set(key, '***');
    }
    return {
      status: e.status,
      host: u.host,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      body: e.body && typeof e.body === 'object' ? e.body : null
    };
  } catch {
    return { status: e.status };
  }
}

function sendHtml(res, status, html) {
  res.writeHead(status, corsHeaders('text/html; charset=utf-8'));
  res.end(html);
}

function readJson(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error('Request body too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function configurePage(req, message = '') {
  const root = baseUrl(req);
  const security = configSecurityMode();
  return `<!doctype html>
<html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KRA • Stream Cinema addon</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#101218;color:#f5f7fb;max-width:760px;margin:40px auto;padding:0 20px} .card{background:#191d27;border:1px solid #2d3444;border-radius:18px;padding:24px} h1{font-size:26px;margin-top:0} label{display:block;margin:16px 0 6px;font-weight:650} input,select{width:100%;box-sizing:border-box;background:#0f1219;color:white;border:1px solid #3b4559;border-radius:10px;padding:12px;font-size:16px} button{margin-top:20px;background:#fff;color:#111;border:0;border-radius:10px;padding:12px 18px;font-size:16px;font-weight:700;cursor:pointer}.muted{color:#aab2c2;font-size:14px;line-height:1.5}.warn{background:#392c15;padding:12px;border-radius:10px}.ok{background:#173622;padding:12px;border-radius:10px} code{overflow-wrap:anywhere} a{color:#b9d1ff}</style></head>
<body><div class="card"><h1>KRA • Stream Cinema</h1>
<p class="muted">Stremio/Nuvio stream addon. Používa tvoje vlastné KRA konto. Heslo sa neposiela do prehliadača po vytvorení konfigurácie; je uložené iba v konfiguračnom tokene.</p>
${message ? `<p class="ok">${htmlEscape(message)}</p>` : ''}
${security !== 'encrypted' ? `<p class="warn"><b>Upozornenie:</b> server nemá CONFIG_SECRET. Token je iba Base64 a nie je bezpečný pre produkčné použitie.</p>` : ''}
<form id="f">
<label>KRA username</label><input name="username" autocomplete="username" required>
<label>KRA password</label><input name="password" type="password" autocomplete="current-password" required>
<label>Preferovaný jazyk</label><select name="language"><option value="sk,cs">SK → CZ</option><option value="cs,sk">CZ → SK</option><option value="sk">iba SK preferencia</option><option value="cs">iba CZ preferencia</option></select>
<label>Max. počet streamov</label><input name="maxStreams" type="number" min="1" max="20" value="10">
<button type="submit">Vytvoriť addon URL</button></form>
<div id="out"></div>
<p class="muted">Health: <a href="${root}/health">${root}/health</a></p></div>
<script>
const f=document.getElementById('f'),out=document.getElementById('out');
f.addEventListener('submit',async(e)=>{e.preventDefault();out.innerHTML='<p>Overujem KRA účet…</p>';const fd=new FormData(f);const body={username:fd.get('username'),password:fd.get('password'),preferredLanguages:String(fd.get('language')).split(','),maxStreams:Number(fd.get('maxStreams'))};try{const r=await fetch('/api/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Configuration failed');out.innerHTML='<hr><p><b>Addon URL:</b><br><code>'+j.manifestUrl+'</code></p><p><a href="'+j.stremioUrl+'">Otvoriť v Stremio</a></p><p class="muted">Pre Nuvio vlož manifest URL ručne. Diagnostika: <a href="'+j.diagnosticsUrl+'" target="_blank">otvoriť</a></p>';}catch(err){out.innerHTML='<p class="warn">'+String(err.message)+'</p>';}});
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, corsHeaders()); res.end(); return; }
  const url = new URL(req.url, baseUrl(req));
  const path = decodeURIComponent(url.pathname);

  try {
    if (req.method === 'GET' && path === '/') {
      res.writeHead(302, { Location: '/configure' }); res.end(); return;
    }
    if (req.method === 'GET' && path === '/configure') {
      sendHtml(res, 200, configurePage(req)); return;
    }
    if (req.method === 'GET' && path === '/health') {
      sendJson(res, 200, { ok: true, version: ADDON_VERSION, node: process.version, configSecurity: configSecurityMode(), bridge: Boolean(bridgeBase()), bridgeBaseConfigured: Boolean(bridgeBase()), tmdb: tmdbConfigured(), at: new Date().toISOString() }); return;
    }
    if (req.method === 'GET' && path === '/bridge-check.json') {
      if (!bridgeBase()) { sendJson(res, 200, { ok:false, bridge:false, error:'UPSTREAM_STREMIO_BASE is not configured.' }); return; }
      try {
        const upstreamManifest = await bridgeJson('manifest.json');
        const latest = await bridgeJson('catalog/movie/sc-movie-latest.json');
        const count = Array.isArray(latest?.metas) ? latest.metas.length : 0;
        sendJson(res, 200, {
          ok: count > 0,
          bridge: true,
          upstreamAddon: { id: upstreamManifest?.id || null, version: upstreamManifest?.version || null, catalogs: Array.isArray(upstreamManifest?.catalogs) ? upstreamManifest.catalogs.length : 0 },
          latestMovieCount: count,
          tmdbConfigured: tmdbConfigured(),
          hint: count > 0 ? 'Bridge catalogs are working.' : 'The cder bridge responded, but the catalog is empty. Re-create the cder configuration with enable_catalog enabled.'
        });
      } catch (e) {
        sendJson(res, 200, { ok:false, bridge:true, error:safeMessage(e), upstream:e?.bridge || null });
      }
      return;
    }
    if (req.method === 'GET' && path === '/bridge-stream-check.json') {
      if (!bridgeBase()) { sendJson(res, 200, { ok:false, bridge:false, error:'UPSTREAM_STREMIO_BASE is not configured.' }); return; }
      const type = url.searchParams.get('type') === 'series' ? 'series' : 'movie';
      const id = String(url.searchParams.get('id') || '').trim();
      if (!id) { sendJson(res, 400, { ok:false, error:'Missing id query parameter.' }); return; }
      try {
        const upstream = await bridgeJson(`stream/${type}/${encodeURIComponent(id)}.json`);
        const streams = Array.isArray(upstream?.streams) ? upstream.streams : [];
        sendJson(res, 200, { ok:true, bridge:true, type, id, streamCount:streams.length, sample:streams.slice(0,3).map(x=>({name:x?.name||null,title:x?.title||null,url:Boolean(x?.url)})) });
      } catch (e) {
        sendJson(res, 200, { ok:false, bridge:true, type, id, error:safeMessage(e), upstream:e?.bridge||null });
      }
      return;
    }
    if (req.method === 'GET' && path === '/manifest.json') {
      sendJson(res, 200, makeManifest(false)); return;
    }
    if (req.method === 'POST' && path === '/api/configure') {
      const body = await readJson(req);
      const config = {
        username: String(body.username || '').trim(),
        password: String(body.password || ''),
        preferredLanguages: Array.isArray(body.preferredLanguages) ? body.preferredLanguages.map(String).slice(0, 4) : ['sk','cs'],
        maxStreams: Math.max(1, Math.min(20, Number(body.maxStreams) || 10)),
        uid: crypto.randomUUID()
      };
      if (!config.username || !config.password) { sendJson(res, 400, { ok: false, error: 'Username and password are required.' }); return; }

      // Validate before generating install URL.
      const kra = new KraClient(config);
      const info = await kra.userInfo();
      const sc = new StreamCinemaClient(config, kra);
      await sc.getAuthToken();
      const token = encodeConfig(config);
      const root = baseUrl(req);
      const manifestUrl = `${root}/${token}/manifest.json`;
      sendJson(res, 200, {
        ok: true,
        manifestUrl,
        stremioUrl: `stremio://${manifestUrl.replace(/^https?:\/\//, '')}`,
        diagnosticsUrl: `${root}/${token}/diagnostics.json`,
        account: {
          username: info?.data?.username || config.username,
          daysLeft: info?.data?.days_left ?? null,
          subscribedUntil: info?.data?.subscribed_until ?? null
        },
        configSecurity: configSecurityMode()
      }); return;
    }

    const manifestMatch = path.match(/^\/([^/]+)\/manifest\.json$/);
    if (req.method === 'GET' && manifestMatch) {
      decodeConfig(manifestMatch[1]);
      sendJson(res, 200, makeManifest(true)); return;
    }

    const diagMatch = path.match(/^\/([^/]+)\/diagnostics\.json$/);
    if (req.method === 'GET' && diagMatch) {
      const config = decodeConfig(diagMatch[1]);
      const kra = new KraClient(config);
      const info = await kra.userInfo();
      const sc = new StreamCinemaClient(config, kra);
      await sc.getAuthToken();
      const result = {
        ok: true,
        kra: { login: true, username: info?.data?.username || config.username, daysLeft: info?.data?.days_left ?? null, subscribedUntil: info?.data?.subscribed_until ?? null },
        streamCinema: { auth: true, version: '2.0' },
        config: { maxStreams: config.maxStreams, preferredLanguages: config.preferredLanguages },
        at: new Date().toISOString()
      };
      const type = url.searchParams.get('type');
      const id = url.searchParams.get('id');
      if ((type === 'movie' || type === 'series') && id) {
        try {
          const found = await getStreams(config, type, id);
          result.lookup = { type, id, streamCount: found.streams.length, diagnostics: found.diagnostics };
        } catch (e) {
          result.ok = false;
          result.lookup = {
            type, id, streamCount: 0,
            diagnostics: { stage: 'upstream-error', error: safeMessage(e), upstream: safeUpstreamError(e) }
          };
        }
      }
      const catalogId = url.searchParams.get('catalog');
      if (catalogId) {
        const typeForCatalog = catalogId.includes('series') ? 'series' : 'movie';
        try {
          const bridgePath = bridgeCatalogPath(typeForCatalog, catalogId, { skip: 0 });
          if (bridgeBase() && bridgePath) {
            const catDef = CATALOGS.find(c => c.id === catalogId && c.type === typeForCatalog);
            const bridged = catDef?.derivedDubbed ? await bridgeDubbedCatalog(typeForCatalog, {skip:0}) : await bridgeJson(bridgePath);
            const metas = Array.isArray(bridged?.metas) ? bridged.metas : [];
            result.catalog = {
              id: catalogId,
              type: typeForCatalog,
              source: 'cder-bridge',
              bridgePath,
              metaCount: metas.length,
              sample: metas.slice(0, 3).map(m => ({ id:m?.id || null, name:m?.name || null, type:m?.type || null })),
              hint: metas.length ? null : 'Bridge returned an empty catalog. The upstream cder configuration may have Catalog disabled (enable_catalog=0).'
            };
          } else {
            const c = await getCatalog(config, typeForCatalog, catalogId, { skip: 0 });
            result.catalog = { id: catalogId, type: typeForCatalog, source:'native', metaCount: c.metas.length, diagnostics: c.diagnostics };
          }
        } catch (e) {
          result.ok = false;
          result.catalog = { id: catalogId, type: typeForCatalog, source:bridgeBase()?'cder-bridge':'native', metaCount: 0, error: safeMessage(e), upstream: e?.bridge || safeUpstreamError(e), attempts: e?.menuAttempts || null };
        }
      }
      sendJson(res, 200, result); return;
    }

    const catalogMatch = path.match(/^\/([^/]+)\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
    if (req.method === 'GET' && catalogMatch) {
      const [, token, type, catalogId, extraRaw] = catalogMatch;
      const config = decodeConfig(token);
      const extra = {};
      if (extraRaw) {
        const params = new URLSearchParams(extraRaw);
        for (const [k,v] of params.entries()) extra[k] = v;
      }
      try {
        const bridgePath = bridgeCatalogPath(type, catalogId, extra);
        const catDef = CATALOGS.find(c => c.id === catalogId && c.type === type);
        const bridged = catDef?.derivedDubbed ? await bridgeDubbedCatalog(type, extra) : (bridgePath ? await bridgeJson(bridgePath) : null);
        if (bridged) { sendJson(res, 200, bridged); return; }
        const result = await getCatalog(config, type, catalogId, extra);
        if (process.env.DEBUG === '1') console.log('[catalog]', type, catalogId, result.diagnostics);
        sendJson(res, 200, { metas: result.metas });
      } catch (e) {
        console.error('[catalog error]', type, catalogId, safeMessage(e));
        sendJson(res, 200, { metas: [] });
      }
      return;
    }

    const metaMatch = path.match(/^\/([^/]+)\/meta\/(movie|series)\/([^/]+)\.json$/);
    if (req.method === 'GET' && metaMatch) {
      const [, token, type, id] = metaMatch;
      const config = decodeConfig(token);
      try {
        const bridged = await bridgeJson(`meta/${type}/${id}.json`);
        if (bridged?.meta) { const meta = await enrichMetaWithTmdb(type, id, bridged.meta); sendJson(res, 200, { meta }); return; }
        const nativeMeta = await getMeta(config, type, id);
        const meta = await enrichMetaWithTmdb(type, id, nativeMeta);
        sendJson(res, 200, { meta });
      } catch (e) {
        console.error('[meta error]', type, id, safeMessage(e));
        sendJson(res, 200, { meta: null });
      }
      return;
    }

    const streamMatch = path.match(/^\/([^/]+)\/stream\/(movie|series)\/([^/]+)\.json$/);
    if (req.method === 'GET' && streamMatch) {
      const [, token, type, id] = streamMatch;
      const config = decodeConfig(token);
      try {
        let bridged = null;
        try { bridged = await bridgeJson(`stream/${type}/${encodeURIComponent(id)}.json`); }
        catch (firstErr) {
          try { bridged = await bridgeJson(`stream/${type}/${id}.json`); }
          catch {}
        }
        if (Array.isArray(bridged?.streams) && bridged.streams.length) { sendJson(res, 200, bridged); return; }
        const result = await getStreams(config, type, id);
        if (process.env.DEBUG === '1') console.log('[stream]', type, id, result.diagnostics);
        sendJson(res, 200, { streams: result.streams });
      } catch (e) {
        console.error('[stream error]', type, id, safeMessage(e));
        // Stremio expects a valid stream response even when upstream fails.
        sendJson(res, 200, { streams: [] });
      }
      return;
    }

    sendJson(res, 404, { error: 'not found', path });
  } catch (e) {
    console.error('[request error]', safeMessage(e));
    sendJson(res, 500, { ok: false, error: safeMessage(e), upstream: safeUpstreamError(e) });
  }
});


server.listen(PORT, '0.0.0.0', () => {
  console.log(`KRA Stream Cinema addon v${ADDON_VERSION} listening on :${PORT}`);
  console.log(`Configure at http://localhost:${PORT}/configure`);
});
