import { KraClient } from './kra.js';
import {
  StreamCinemaClient,
  decryptStreamCinemaIdent,
  itemLabel,
  menuItems,
  rankSearchCandidates,
  rankTraversalItems,
  rawResponsePreview,
  responseShape,
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

export const ADDON_ID = 'org.stream-cinema.online';
export const ADDON_VERSION = '2.4.1';

export const CATALOGS = [
  { id:'sc-movie-latest', type:'movie', name:'⏳ SC: Najnovšie filmy', path:'/FMovies/latest', extra:[{name:'skip',isRequired:false}] },
  { id:'sc-movie-popular', type:'movie', name:'🔥 SC: Populárne filmy', path:'/FMovies/popular', extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}] },
  { id:'sc-movie-latest-dubbed', type:'movie', name:'🇨🇿🇸🇰 SC: Novinky dabované – filmy', path:'/FMovies/latest', extra:[{name:'skip',isRequired:false}], derivedDubbed:true },
  { id:'sc-movie-concerts', type:'movie', name:'🎵 SC: Koncerty / Hudba', path:'/FMovies/filter', fixedExtra:{genre:'Music'} },
  { id:'sc-series-latest', type:'series', name:'⏳ SC: Najnovšie seriály', path:'/FSeries/latest', extra:[{name:'skip',isRequired:false}] },
  { id:'sc-series-popular', type:'series', name:'🔥 SC: Populárne seriály', path:'/FSeries/popular', extra:[{name:'search',isRequired:false},{name:'skip',isRequired:false}] },
  { id:'sc-series-latest-dubbed', type:'series', name:'🇨🇿🇸🇰 SC: Novinky dabované – seriály', path:'/FSeries/latest', extra:[{name:'skip',isRequired:false}], derivedDubbed:true },

  // Derived movie catalogs. These map to the upstream movie filter catalog.
  { id:'sc-movie-2026', type:'movie', name:'🎬 SC: Filmy 2026', path:'/FMovies/filter', fixedExtra:{year:'2026'} },
  { id:'sc-movie-2025', type:'movie', name:'🎬 SC: Filmy 2025', path:'/FMovies/filter', fixedExtra:{year:'2025'} },
  { id:'sc-movie-action', type:'movie', name:'💥 SC: Akčné filmy', path:'/FMovies/filter', fixedExtra:{genre:'Action'} },
  { id:'sc-movie-comedy', type:'movie', name:'😂 SC: Komédie', path:'/FMovies/filter', fixedExtra:{genre:'Comedy'} },
  { id:'sc-movie-horror', type:'movie', name:'👻 SC: Horory', path:'/FMovies/filter', fixedExtra:{genre:'Horror'} },
  { id:'sc-movie-scifi', type:'movie', name:'🚀 SC: Sci‑Fi filmy', path:'/FMovies/filter', fixedExtra:{genre:'Sci-Fi'} },
  { id:'sc-movie-crime', type:'movie', name:'🔎 SC: Krimi filmy', path:'/FMovies/filter', fixedExtra:{genre:'Crime'} },
  { id:'sc-movie-thriller', type:'movie', name:'⚡ SC: Thrillery', path:'/FMovies/filter', fixedExtra:{genre:'Thriller'} },
  { id:'sc-movie-documentary', type:'movie', name:'🎥 SC: Dokumenty', path:'/FMovies/filter', fixedExtra:{genre:'Documentary'} },
  { id:'sc-movie-animation', type:'movie', name:'🧸 SC: Animované filmy', path:'/FMovies/filter', fixedExtra:{genre:'Animation'} },
  { id:'sc-movie-family', type:'movie', name:'👨‍👩‍👧 SC: Rodinné filmy', path:'/FMovies/filter', fixedExtra:{genre:'Family'} },
  { id:'sc-movie-romance', type:'movie', name:'❤️ SC: Romantické filmy', path:'/FMovies/filter', fixedExtra:{genre:'Romance'} },

  // Derived series catalogs. These map to the upstream series filter catalog.
  { id:'sc-series-2026', type:'series', name:'📺 SC: Seriály 2026', path:'/FSeries/filter', fixedExtra:{year:'2026'} },
  { id:'sc-series-2025', type:'series', name:'📺 SC: Seriály 2025', path:'/FSeries/filter', fixedExtra:{year:'2025'} },
  { id:'sc-series-drama', type:'series', name:'🎭 SC: Dramatické seriály', path:'/FSeries/filter', fixedExtra:{genre:'Drama'} },
  { id:'sc-series-comedy', type:'series', name:'😂 SC: Komediálne seriály', path:'/FSeries/filter', fixedExtra:{genre:'Comedy'} },
  { id:'sc-series-crime', type:'series', name:'🔎 SC: Krimi seriály', path:'/FSeries/filter', fixedExtra:{genre:'Crime'} },
  { id:'sc-series-scifi', type:'series', name:'🚀 SC: Sci‑Fi seriály', path:'/FSeries/filter', fixedExtra:{genre:'Sci-Fi'} },
  { id:'sc-series-thriller', type:'series', name:'⚡ SC: Thriller seriály', path:'/FSeries/filter', fixedExtra:{genre:'Thriller'} },
  { id:'sc-series-documentary', type:'series', name:'🎥 SC: Dokumentárne seriály', path:'/FSeries/filter', fixedExtra:{genre:'Documentary'} },
  { id:'sc-series-animation', type:'series', name:'🧸 SC: Animované seriály', path:'/FSeries/filter', fixedExtra:{genre:'Animation'} },

  { id:'sc-movie-filter', type:'movie', name:'🔧 SC: Filter filmov', path:'/FMovies/filter', filter:true },
  { id:'sc-series-filter', type:'series', name:'🔧 SC: Filter seriálov', path:'/FSeries/filter', filter:true }
];

const GENRES=['Action','Animation','Adventure','Documentary','Drama','Erotic','Fantasy','History','Horror','Music','Comedy','Crime','Musical','Mystery','Family','Romance','Sci-Fi','Sport','Stand-up','Thriller','War','Western','Biography','Fairy Tale'];
const YEARS=Array.from({length:37},(_,i)=>String(2026-i));
const LETTERS=['0-9',...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
function catalogExtras(c){
  if(c.filter) return [
    {name:'genre',isRequired:false,options:GENRES},
    {name:'year',isRequired:false,options:YEARS},
    {name:'letter',isRequired:false,options:LETTERS},
    {name:'skip',isRequired:false}
  ];
  return c.extra || [{name:'skip',isRequired:false}];
}

export function makeManifest(configured = false) {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: 'Stream Cinema',
    description: 'Stream Cinema compatible addon for Stremio/Nuvio with catalogs, metadata and streams.',
    resources: [
      { name:'catalog', types:['movie','series'], idPrefixes:['tt','sc'] },
      { name:'meta', types:['movie','series'], idPrefixes:['tt','sc'] },
      { name:'stream', types:['movie','series'], idPrefixes:['tt','sc'] }
    ],
    types: ['movie','series'],
    catalogs: CATALOGS.map(c => ({ id:c.id, type:c.type, name:c.name, extra:catalogExtras(c) })),
    idPrefixes: ['tt','sc'],
    behaviorHints: { configurable:true, configurationRequired:!configured }
  };
}

function encodeScId(payload) {
  return 'sc:' + Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');
}

function decodeScId(id) {
  if (!String(id).startsWith('sc:')) return null;
  try {
    const obj = JSON.parse(Buffer.from(String(id).slice(3),'base64url').toString('utf8'));
    if (!obj || typeof obj !== 'object' || !obj.u) return null;
    return obj;
  } catch { return null; }
}

function cleanKodiText(v) {
  return String(v ?? '').replace(/\[(?:\/?[BIC]|COLOR[^\]]*|\/COLOR)\]/gi,'').replace(/\s+/g,' ').trim();
}

function itemTitle(item) {
  return cleanKodiText(firstString(item?.info?.title, item?.title, item?.name,
    item?.i18n_info?.sk?.title, item?.i18n_info?.cs?.title, item?.i18n_info?.en?.title));
}

function itemPoster(item) {
  return firstString(item?.art?.poster, item?.poster, item?.info?.poster, item?.art?.thumb, item?.thumb, item?.art?.icon);
}
function itemBackground(item) { return firstString(item?.art?.fanart, item?.fanart, item?.background, item?.info?.fanart); }
function itemDescription(item) { return cleanKodiText(firstString(item?.info?.plot, item?.plot, item?.description)); }
function itemYear(item) {
  const raw = firstString(item?.info?.year, item?.year, itemTitle(item));
  const m = String(raw).match(/(?:19|20)\d{2}/); return m ? m[0] : undefined;
}
function itemGenres(item) {
  const v = item?.info?.genre ?? item?.genre ?? item?.genres;
  if (Array.isArray(v)) return v.map(cleanKodiText).filter(Boolean);
  return String(v ?? '').split(/[,/|]/).map(cleanKodiText).filter(Boolean);
}

function toMetaPreview(item, type) {
  if (!item?.url) return null;
  const name = itemTitle(item);
  if (!name) return null;
  const payload = { u:item.url, t:type, n:name, p:itemPoster(item)||'', y:itemYear(item)||'', s:null, e:null };
  const id = encodeScId(payload);
  const meta = { id, type, name };
  const poster = itemPoster(item); if (poster && /^https?:\/\//i.test(poster)) meta.poster = poster;
  const bg = itemBackground(item); if (bg && /^https?:\/\//i.test(bg)) meta.background = bg;
  const desc = itemDescription(item); if (desc) meta.description = desc;
  const year = itemYear(item); if (year) meta.releaseInfo = year;
  const genres = itemGenres(item); if (genres.length) meta.genres = genres.slice(0,8);
  const rating = Number(item?.info?.rating ?? item?.rating); if (Number.isFinite(rating) && rating>0) meta.imdbRating = String(rating);
  return meta;
}

export async function getCatalog(config, type, catalogId, extra = {}) {
  const cat = CATALOGS.find(c => c.id===catalogId && c.type===type);
  if (!cat) return { metas:[], diagnostics:{stage:'catalog',error:'Unknown catalog'} };
  const kra = new KraClient(config); const sc = new StreamCinemaClient(config,kra);
  const effectiveExtra = { ...(cat.fixedExtra || {}), ...(extra || {}) };
  const skip = Math.max(0, Number(effectiveExtra.skip)||0);
  const response = await sc.getMenu(cat.path, { skip, type, ...effectiveExtra });
  const items = menuItems(response);
  const metas = items.map(x=>toMetaPreview(x,type)).filter(Boolean);
  return { metas:metas.slice(0,100), diagnostics:{stage:'ok',path:cat.path,route:response?.__menuRoute||null,items:items.length,shape:responseShape(response),rawPreview:rawResponsePreview(response)} };
}

async function getCinemeta(type, imdbId) {
  const url = `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(imdbId)}.json`;
  const response = await fetch(url,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
  if (!response.ok) throw new Error(`Cinemeta HTTP ${response.status}`);
  const data=await response.json(); if(!data?.meta) throw new Error('Cinemeta returned no metadata.'); return data.meta;
}

function parseSeasonEpisode(text, fallbackSeason=null) {
  const s=String(text||'');
  let m=s.match(/s(\d{1,2})\s*e(\d{1,3})/i); if(m) return {season:Number(m[1]),episode:Number(m[2])};
  m=s.match(/(?:^|[^0-9])(\d{1,2})[x×](\d{1,3})(?:[^0-9]|$)/i); if(m) return {season:Number(m[1]),episode:Number(m[2])};
  m=s.match(/(?:episode|epizoda|epizóda|d[ií]l|časť)\s*(\d{1,3})/i); if(m) return {season:fallbackSeason||1,episode:Number(m[1])};
  return null;
}
function parseSeason(text) { const m=String(text||'').match(/(?:season|serie|séria|sezona|sezóna)\s*(\d{1,2})/i); return m?Number(m[1]):null; }

async function buildSeriesVideos(sc, root) {
  const videos=[]; const queue=[{u:root.u,depth:0,season:null}]; const seen=new Set();
  while(queue.length && seen.size<90) {
    const node=queue.shift(); if(!node?.u||seen.has(node.u)||node.depth>3) continue; seen.add(node.u);
    let r; try{r=await sc.getMenu(node.u,{type:'series',detail:true});}catch{continue;}
    for(const it of menuItems(r)) {
      if(!it?.url) continue;
      const title=itemTitle(it)||it.url;
      const season=parseSeason(title) ?? node.season;
      const ep=parseSeasonEpisode(`${title} ${it.url}`,season);
      if(ep) {
        videos.push({ id:encodeScId({u:it.url,t:'series',n:title,s:ep.season,e:ep.episode,p:itemPoster(it)||''}), title, season:ep.season, episode:ep.episode, released:new Date(0).toISOString() });
      } else if(node.depth<3) queue.push({u:it.url,depth:node.depth+1,season});
    }
  }
  const uniq=new Map(); for(const v of videos){const k=`${v.season}:${v.episode}`; if(!uniq.has(k)) uniq.set(k,v);} return [...uniq.values()].sort((a,b)=>a.season-b.season||a.episode-b.episode);
}

export async function getMeta(config,type,id) {
  const local=decodeScId(id);
  if(!local) return getCinemeta(type,id);
  const meta={id,type,name:local.n||'Stream Cinema'};
  if(local.p) meta.poster=local.p; if(local.y) meta.releaseInfo=String(local.y);
  const kra=new KraClient(config); const sc=new StreamCinemaClient(config,kra);
  try {
    const r=await sc.getMenu(local.u,{type,detail:true});
    const items=menuItems(r);
    const self=items.find(x=>itemTitle(x)===local.n)||null;
    if(self){ const desc=itemDescription(self); if(desc) meta.description=desc; const bg=itemBackground(self); if(bg) meta.background=bg; }
    if(type==='series') { const videos=await buildSeriesVideos(sc,local); if(videos.length) meta.videos=videos; }
  } catch {}
  return meta;
}

function findEpisodeMeta(meta,season,episode){const videos=Array.isArray(meta?.videos)?meta.videos:[];return videos.find(v=>Number(v?.season)===season&&Number(v?.episode)===episode)||null;}
function yearFromMeta(meta){for(const v of [meta?.year,meta?.releaseInfo,meta?.released]){const m=String(v??'').match(/(?:19|20)\d{2}/);if(m)return Number(m[0]);}return null;}
function directScUrl(stream){const url=String(stream?.url||'').trim();return /^https?:\/\//i.test(url)?url:null;}
function scProvider(stream){return String(stream?.provider||'').trim().toLowerCase();}
function traversalKey(url){return String(url||'').replace(/([?&](?:ver|uid|lang|skin|HDR|DV|old|token|krt)=[^&]*)/gi,'');}

async function fetchStreamBranch(sc,rootItem,target,options={}){
  const maxNodes=options.maxNodes??80,maxDepth=options.maxDepth??5,queue=[],seen=new Set(); if(rootItem?.url)queue.push({url:rootItem.url,depth:0,score:1000});
  let bestStreams=[],bestScore=-Infinity,visited=0;
  while(queue.length&&visited<maxNodes){queue.sort((a,b)=>b.score-a.score);const node=queue.shift(),key=traversalKey(node.url);if(!node.url||seen.has(key)||node.depth>maxDepth)continue;seen.add(key);visited++;
    let response;try{response=await sc.getMenu(node.url,{type:target.type,detail:true});}catch{continue;}
    const streams=streamItems(response);if(streams.length){const score=node.score+(target.episode!=null?0:100);if(score>bestScore){bestStreams=streams;bestScore=score;}if(target.episode==null||node.score>=1150)break;}
    const children=menuItems(response);if(!children.length||node.depth>=maxDepth)continue;for(const {item,score} of rankTraversalItems(children,target,node.depth).slice(0,target.episode!=null?24:16)){if(item?.url)queue.push({url:item.url,depth:node.depth+1,score:node.score*.2+score+5});}
  }
  return {streams:bestStreams,visited};
}

async function resolveScStream(sc,kra,stream){
  const provider=scProvider(stream);
  if(provider==='kraska'||provider==='kra'||provider==='kra.sk') { const descriptor=await sc.getMenu(stream.url,{detail:true}); const wrapped=versionIdent(descriptor); if(!wrapped)throw new Error('Stream Cinema returned no version ident.'); const ident=decryptStreamCinemaIdent(wrapped); if(!ident)throw new Error('Could not decode KRA ident.'); return kra.resolveIdent(ident); }
  const direct=directScUrl(stream);if(direct)return direct;
  if(stream?.url){try{const d=await sc.getMenu(stream.url,{detail:true});const w=versionIdent(d);if(w){const ident=decryptStreamCinemaIdent(w);if(ident)return kra.resolveIdent(ident);}}catch{}}
  throw new Error(`Unsupported stream provider: ${provider||'unknown'}`);
}
function streamTitle(stream){const quality=firstString(stream?.quality,/2160|4k/i.test(stream?.name||'')?'4K':'');const lang=Array.isArray(stream?.lang)?stream.lang.join('/'):firstString(stream?.lang,stream?.langs?.join?.('/'));const size=formatBytes(stream?.size);return [quality,lang,size,stream?.ainfo,stream?.vinfo].filter(Boolean).join(' • ')||firstString(stream?.title,stream?.name,'Stream');}
function normalizePlaybackUrl(value){const raw=String(value||'').trim(),pipe=raw.indexOf('|');if(pipe<0)return{url:raw,headers:null};const url=raw.slice(0,pipe),headers={};for(const part of raw.slice(pipe+1).split('&')){const[k,...rest]=part.split('=');if(k&&rest.length){try{headers[decodeURIComponent(k)]=decodeURIComponent(rest.join('='));}catch{headers[k]=rest.join('=');}}}return{url,headers:Object.keys(headers).length?headers:null};}

async function streamsFromLocal(config,type,rawId){
  const local=decodeScId(rawId); if(!local)return null;
  const kra=new KraClient(config),sc=new StreamCinemaClient(config,kra); const target={type,title:local.n||'',season:local.s??null,episode:local.e??null,episodeTitle:local.n||''};
  const found=await fetchStreamBranch(sc,{url:local.u},target,{maxNodes:type==='series'?100:55,maxDepth:type==='series'?6:5}); return resolveSourceStreams(config,sc,kra,found.streams,{branchVisited:found.visited,stagePrefix:'local'});
}

async function resolveSourceStreams(config,sc,kra,sourceStreams,extraDiag={}){
  if(!sourceStreams.length)return{streams:[],diagnostics:{stage:'branch',sourceStreams:0,...extraDiag}};
  const preferred=Array.isArray(config.preferredLanguages)&&config.preferredLanguages.length?config.preferredLanguages:['sk','cs'];sourceStreams.sort((a,b)=>(qualityRank(b)+languageRank(b,preferred))-(qualityRank(a)+languageRank(a,preferred)));
  const maxStreams=Math.max(1,Math.min(20,Number(config.maxStreams)||10)),resolved=[],errors=[];
  for(const source of sourceStreams.slice(0,Math.max(maxStreams*2,12))){try{const rawUrl=await resolveScStream(sc,kra,source),parsed=normalizePlaybackUrl(rawUrl);if(!/^https?:\/\//i.test(parsed.url))throw new Error('Resolved link is not HTTP(S).');if(resolved.some(x=>x.url===parsed.url))continue;const behaviorHints={notWebReady:true};if(parsed.headers)behaviorHints.proxyHeaders={request:parsed.headers};resolved.push({name:`KRA • ${firstString(source?.quality,'Stream')}`,title:streamTitle(source),url:parsed.url,behaviorHints});if(resolved.length>=maxStreams)break;}catch(e){errors.push(safeMessage(e));}}
  return{streams:resolved,diagnostics:{stage:resolved.length?'ok':'resolve',sourceStreams:sourceStreams.length,resolvedStreams:resolved.length,resolveErrors:[...new Set(errors)].slice(0,6),...extraDiag}};
}

export async function getStreams(config,type,rawId){
  const local=await streamsFromLocal(config,type,rawId); if(local)return local;
  const id=parseStremioId(type,rawId),meta=await getCinemeta(type,id.imdbId),episodeMeta=type==='series'?findEpisodeMeta(meta,id.season,id.episode):null;
  const target={type,imdbId:id.imdbId,title:meta.name||meta.title||id.imdbId,year:yearFromMeta(meta),season:id.season,episode:id.episode,episodeTitle:episodeMeta?.name||episodeMeta?.title||''};
  const kra=new KraClient(config),sc=new StreamCinemaClient(config,kra),searchResponse=await sc.search(type,target.title,target.imdbId),searchItems=menuItems(searchResponse),ranked=rankSearchCandidates(searchItems,target),candidates=ranked.filter(x=>x.exactId||x.titleScore>=.35).slice(0,4);
  if(!candidates.length)return{streams:[],diagnostics:{stage:'search',route:searchResponse?.__searchRoute||null,extractedItems:searchItems.length,responseShape:responseShape(searchResponse),rawPreview:rawResponsePreview(searchResponse),candidates:[]}};
  let sourceStreams=[],branchVisited=0;for(const candidate of candidates){const found=await fetchStreamBranch(sc,candidate.item,target,{maxNodes:type==='series'?100:45,maxDepth:type==='series'?6:4});branchVisited+=found.visited;if(found.streams.length){sourceStreams=found.streams;break;}}
  return resolveSourceStreams(config,sc,kra,sourceStreams,{branchVisited});
}
