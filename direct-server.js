import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { decodeConfig, encodeConfig, configSecurityMode } from './src/config.js';
import { KraClient } from './src/kra.js';
import { StreamCinemaClient, menuItems } from './src/sc-direct.js';
import { getStreams, getMeta, makeManifest, CATALOGS } from './src/stremio.js';
import { enrichMetaWithTmdb, tmdbConfigured } from './src/tmdb.js';
import { enrichMetaWithCsfd, csfdConfigured } from './src/csfd.js';
import { decorateStreams } from './src/stream-presentation.js';
import { safeMessage, firstString } from './src/utils.js';

const PORT = Number(process.env.PORT || 3000);
const DIRECT_VERSION = '1.0.1';
const DIRECT_ID = 'sk.kra.direct.stremio.nuvio';

function headers(type='application/json; charset=utf-8') { return {'Content-Type':type,'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Cache-Control':'no-store'}; }
function json(res,status,body){res.writeHead(status,headers());res.end(JSON.stringify(body));}
function html(res,status,body){res.writeHead(status,headers('text/html; charset=utf-8'));res.end(body);}
function baseUrl(req){const proto=String(req.headers['x-forwarded-proto']||'http').split(',')[0].trim();const host=req.headers['x-forwarded-host']||req.headers.host||`localhost:${PORT}`;return `${proto}://${host}`;}
function readJson(req,max=65536){return new Promise((resolve,reject)=>{let n=0;const chunks=[];req.on('data',c=>{n+=c.length;if(n>max){reject(new Error('Request too large'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);});}

function manifest(configured=false){const m=makeManifest(configured);return {...m,id:DIRECT_ID,version:DIRECT_VERSION,name:'KRA Direct',description:'Direct KRA / Stream Cinema addon for Stremio and Nuvio. No cder.club bridge.',behaviorHints:{configurable:true,configurationRequired:!configured}};}

function cleanText(v){return String(v??'').replace(/\[(?:\/?[BIC]|COLOR[^\]]*|\/COLOR)\]/gi,'').replace(/\s+/g,' ').trim();}
function titleOf(x){return cleanText(firstString(x?.info?.title,x?.title,x?.name,x?.label,x?.i18n_info?.sk?.title,x?.i18n_info?.cs?.title,x?.i18n_info?.en?.title));}
function posterOf(x){return firstString(x?.art?.poster,x?.poster,x?.info?.poster,x?.art?.thumb,x?.thumb,x?.art?.icon);}
function bgOf(x){return firstString(x?.art?.fanart,x?.fanart,x?.background,x?.info?.fanart);}
function yearOf(x){const m=String(firstString(x?.info?.year,x?.year,titleOf(x))).match(/(?:19|20)\d{2}/);return m?m[0]:'';}
function descOf(x){return cleanText(firstString(x?.info?.plot,x?.plot,x?.description));}
function encodeSc(payload){return 'sc:'+Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');}
function toMeta(item,type){if(!item?.url)return null;const name=titleOf(item);if(!name)return null;const p={u:item.url,t:type,n:name,p:posterOf(item)||'',y:yearOf(item)||'',s:null,e:null};const meta={id:encodeSc(p),type,name};const poster=posterOf(item);if(/^https?:\/\//i.test(poster||''))meta.poster=poster;const bg=bgOf(item);if(/^https?:\/\//i.test(bg||''))meta.background=bg;const d=descOf(item);if(d)meta.description=d;const y=yearOf(item);if(y)meta.releaseInfo=y;return meta;}

async function directCatalog(config,type,catalogId,extra={}){
  const cat=CATALOGS.find(c=>c.id===catalogId&&c.type===type);
  if(!cat) return {metas:[],diagnostics:{stage:'catalog',error:'Unknown catalog'}};
  const kra=new KraClient(config);const sc=new StreamCinemaClient(config,kra);
  const effective={...(cat.fixedExtra||{}),...(extra||{})};
  const response=await sc.getMenu(cat.path,{skip:Math.max(0,Number(effective.skip)||0),type,...effective});
  const items=menuItems(response);const metas=items.map(x=>toMeta(x,type)).filter(Boolean).slice(0,100);
  return {metas,diagnostics:{stage:'ok',path:cat.path,items:items.length,metas:metas.length}};
}

function configPage(req){const root=baseUrl(req);return `<!doctype html><html lang="sk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KRA Direct</title><style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;max-width:760px;margin:40px auto;padding:0 20px}.c{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:24px}input,select,button{width:100%;box-sizing:border-box;padding:12px;margin-top:8px;border-radius:9px;border:1px solid #30363d;background:#0d1117;color:#e6edf3}label{display:block;margin-top:15px;font-weight:700}button{background:#238636;border:0;font-weight:800;cursor:pointer}.muted{color:#8b949e}code{overflow-wrap:anywhere}</style></head><body><div class="c"><h1>KRA Direct</h1><p class="muted">Priame prihlásenie cez KRA účet. Bez cder.club.</p><form id="f"><label>KRA username</label><input name="username" required autocomplete="username"><label>KRA password</label><input name="password" type="password" required autocomplete="current-password"><label>Preferovaný jazyk</label><select name="language"><option value="sk,cs">SK → CZ</option><option value="cs,sk">CZ → SK</option></select><label>Max. streamov</label><input name="maxStreams" type="number" min="1" max="20" value="10"><button>Vytvoriť addon URL</button></form><div id="out"></div><p class="muted">Health: <a href="${root}/health">${root}/health</a></p></div><script>const f=document.getElementById('f'),o=document.getElementById('out');f.addEventListener('submit',async e=>{e.preventDefault();o.innerHTML='<p>Overujem KRA účet…</p>';const d=new FormData(f);const b={username:d.get('username'),password:d.get('password'),preferredLanguages:String(d.get('language')).split(','),maxStreams:Number(d.get('maxStreams'))};try{const r=await fetch('/api/configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Chyba');o.innerHTML='<hr><p><b>Manifest URL</b><br><code>'+j.manifestUrl+'</code></p><p><a href="'+j.stremioUrl+'">Otvoriť v Stremio</a></p><p class="muted">V Nuvio vlož manifest URL ručne.</p>';}catch(err){o.innerHTML='<p>'+String(err.message)+'</p>';}});</script></body></html>`;}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,headers());res.end();return;}
  const url=new URL(req.url,baseUrl(req));const raw=url.pathname;const path=decodeURIComponent(raw);
  try{
    if(req.method==='GET'&&path==='/'){res.writeHead(302,{Location:'/configure'});res.end();return;}
    if(req.method==='GET'&&path==='/configure'){html(res,200,configPage(req));return;}
    if(req.method==='GET'&&path==='/health'){json(res,200,{ok:true,addon:'KRA Direct',version:DIRECT_VERSION,node:process.version,direct:true,cder:false,configSecurity:configSecurityMode(),tmdb:tmdbConfigured(),csfd:csfdConfigured(),at:new Date().toISOString()});return;}
    if(req.method==='GET'&&path==='/manifest.json'){json(res,200,manifest(false));return;}
    if(req.method==='POST'&&path==='/api/configure'){
      const b=await readJson(req);const config={username:String(b.username||'').trim(),password:String(b.password||''),preferredLanguages:Array.isArray(b.preferredLanguages)?b.preferredLanguages.map(String).slice(0,4):['sk','cs'],maxStreams:Math.max(1,Math.min(20,Number(b.maxStreams)||10)),uid:crypto.randomUUID()};
      if(!config.username||!config.password){json(res,400,{ok:false,error:'Username and password are required.'});return;}
      const kra=new KraClient(config);const info=await kra.userInfo();
      // Do not require a fresh SC token during configuration. Official SC can restore it from KRA lazily.
      const token=encodeConfig(config),root=baseUrl(req),manifestUrl=`${root}/${token}/manifest.json`;
      json(res,200,{ok:true,manifestUrl,stremioUrl:`stremio://${manifestUrl.replace(/^https?:\/\//,'')}`,account:{username:info?.data?.username||config.username,daysLeft:info?.data?.days_left??null},configSecurity:configSecurityMode()});return;
    }
    const mm=path.match(/^\/([^/]+)\/manifest\.json$/);if(req.method==='GET'&&mm){decodeConfig(mm[1]);json(res,200,manifest(true));return;}
    const cm=path.match(/^\/([^/]+)\/catalog\/(movie|series)\/([^/]+)(?:\/([^/]+))?\.json$/);
    if(req.method==='GET'&&cm){const [,token,type,catalogId,extraRaw]=cm;const config=decodeConfig(token);const extra={};if(extraRaw){for(const[k,v]of new URLSearchParams(extraRaw).entries())extra[k]=v;}try{const result=await directCatalog(config,type,catalogId,extra);console.log('[direct catalog]',catalogId,result.diagnostics);json(res,200,{metas:result.metas});}catch(e){console.error('[direct catalog error]',catalogId,safeMessage(e),e?.status||'');json(res,200,{metas:[]});}return;}
    const metam=raw.match(/^\/([^/]+)\/meta\/(movie|series)\/([^/]+)\.json$/);
    if(req.method==='GET'&&metam){const [,tokenRaw,type,idRaw]=metam;const config=decodeConfig(decodeURIComponent(tokenRaw));const id=decodeURIComponent(idRaw);let meta=await getMeta(config,type,id);meta=await enrichMetaWithTmdb(type,id,meta);meta=await enrichMetaWithCsfd(type,id,meta);if(meta)meta={...meta,id,type};json(res,200,{meta:meta||null});return;}
    const sm=raw.match(/^\/([^/]+)\/stream\/(movie|series)\/([^/]+)\.json$/);
    if(req.method==='GET'&&sm){const [,tokenRaw,type,idRaw]=sm;const config=decodeConfig(decodeURIComponent(tokenRaw));const id=decodeURIComponent(idRaw);const result=await getStreams(config,type,id);json(res,200,{streams:decorateStreams(Array.isArray(result?.streams)?result.streams:[])});return;}
    const dm=path.match(/^\/([^/]+)\/diagnostics\.json$/);
    if(req.method==='GET'&&dm){const config=decodeConfig(dm[1]);const kra=new KraClient(config);const info=await kra.userInfo();const out={ok:true,direct:true,cder:false,version:DIRECT_VERSION,kra:{login:true,username:info?.data?.username||config.username,daysLeft:info?.data?.days_left??null},catalogs:CATALOGS.length,at:new Date().toISOString()};const catalog=url.searchParams.get('catalog');if(catalog){const type=catalog.includes('series')?'series':'movie';try{const r=await directCatalog(config,type,catalog,{skip:0});out.catalog={id:catalog,type,count:r.metas.length,diagnostics:r.diagnostics};}catch(e){out.ok=false;out.catalog={id:catalog,error:safeMessage(e),status:e?.status||null};}}json(res,200,out);return;}
    json(res,404,{error:'not found',path});
  }catch(e){console.error('[direct request error]',safeMessage(e));json(res,500,{ok:false,error:safeMessage(e)});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`KRA Direct v${DIRECT_VERSION} listening on :${PORT}`));
