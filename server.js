import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { decodeConfig, encodeConfig, configSecurityMode } from './src/config.js';
import { KraClient } from './src/kra.js';
import { HttpError } from './src/http.js';
import { StreamCinemaClient } from './src/sc.js';
import { getStreams, makeManifest, ADDON_VERSION } from './src/stremio.js';
import { htmlEscape, safeMessage } from './src/utils.js';

const PORT = Number(process.env.PORT || 3000);

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
      sendJson(res, 200, { ok: true, version: ADDON_VERSION, node: process.version, configSecurity: configSecurityMode(), at: new Date().toISOString() }); return;
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
      sendJson(res, 200, result); return;
    }

    const streamMatch = path.match(/^\/([^/]+)\/stream\/(movie|series)\/([^/]+)\.json$/);
    if (req.method === 'GET' && streamMatch) {
      const [, token, type, id] = streamMatch;
      const config = decodeConfig(token);
      try {
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
