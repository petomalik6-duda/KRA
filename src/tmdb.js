const TMDB_BASE = 'https://api.themoviedb.org/3/';
const IMG = 'https://image.tmdb.org/t/p/';
const cache = new Map();
const TTL = 6 * 60 * 60 * 1000;

function authHeaders() {
  const bearer = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim();
  return bearer ? { Authorization: `Bearer ${bearer}`, Accept: 'application/json' } : { Accept: 'application/json' };
}
function keyParam(url) {
  const key = String(process.env.TMDB_API_KEY || '').trim();
  if (key && !process.env.TMDB_READ_ACCESS_TOKEN) url.searchParams.set('api_key', key);
}
export function tmdbConfigured() {
  return Boolean(String(process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_API_KEY || '').trim());
}
async function get(path, params={}) {
  if (!tmdbConfigured()) return null;
  const url = new URL(path.replace(/^\/+/, ''), TMDB_BASE);
  keyParam(url);
  for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k,String(v));
  const ck=url.toString(); const hit=cache.get(ck); if(hit && Date.now()-hit.at<TTL) return hit.data;
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:authHeaders()});
  if(!r.ok) return null;
  const data=await r.json(); cache.set(ck,{at:Date.now(),data}); return data;
}
function yearOf(v){ const m=String(v||'').match(/(?:19|20)\d{2}/); return m?m[0]:''; }
function imdbFrom(meta,id){
  const vals=[id,meta?.id,meta?.imdb_id,meta?.imdbId,meta?.external_ids?.imdb_id,meta?.behaviorHints?.defaultVideoId];
  for(const v of vals){ const m=String(v||'').match(/tt\d{5,12}/i); if(m) return m[0].toLowerCase(); }
  return '';
}
async function locate(type,id,meta){
  const imdb=imdbFrom(meta,id);
  if(imdb){
    const found=await get(`find/${imdb}`,{external_source:'imdb_id',language:'cs-CZ'});
    const arr=type==='series'?found?.tv_results:found?.movie_results;
    if(Array.isArray(arr)&&arr[0]?.id) return arr[0].id;
  }
  const name=meta?.name||meta?.title; if(!name) return null;
  const params={query:name,language:'cs-CZ',include_adult:'false'};
  const y=yearOf(meta?.releaseInfo||meta?.year||meta?.released); if(y) params[type==='series'?'first_air_date_year':'year']=y;
  const result=await get(type==='series'?'search/tv':'search/movie',params);
  return result?.results?.[0]?.id||null;
}
function credits(detail){
  const cast=(detail?.credits?.cast||[]).slice(0,8).map(x=>x?.name).filter(Boolean);
  const crew=detail?.credits?.crew||[];
  const directors=crew.filter(x=>x?.job==='Director').map(x=>x?.name).filter(Boolean).slice(0,3);
  return {cast,directors};
}
export async function enrichMetaWithTmdb(type,id,meta){
  if(!tmdbConfigured()||!meta) return meta;
  try{
    const tmdbId=await locate(type,id,meta); if(!tmdbId) return meta;
    const detail=await get(`${type==='series'?'tv':'movie'}/${tmdbId}`,{language:'cs-CZ',append_to_response:'credits,external_ids'});
    if(!detail) return meta;
    const c=credits(detail); const out={...meta};
    out.name=detail.title||detail.name||out.name;
    if(detail.overview) out.description=detail.overview;
    if(detail.poster_path) out.poster=`${IMG}w500${detail.poster_path}`;
    if(detail.backdrop_path) out.background=`${IMG}original${detail.backdrop_path}`;
    if(Array.isArray(detail.genres)&&detail.genres.length) out.genres=detail.genres.map(g=>g.name).filter(Boolean);
    if(c.cast.length) out.cast=c.cast;
    if(c.directors.length) out.director=c.directors;
    const date=detail.release_date||detail.first_air_date; if(date) out.releaseInfo=yearOf(date)||out.releaseInfo;
    if(!out.imdbRating && Number(detail.vote_average)>0) out.imdbRating=Number(detail.vote_average).toFixed(1);
    if(type==='movie'&&Number(detail.runtime)>0) out.runtime=`${detail.runtime} min`;
    if(type==='series'&&Array.isArray(detail.episode_run_time)&&detail.episode_run_time[0]) out.runtime=`${detail.episode_run_time[0]} min`;
    const countries=(detail.production_countries||detail.origin_country||[]).map(x=>typeof x==='string'?x:x?.name).filter(Boolean);
    if(countries.length) out.country=countries.join(', ');
    out.links=Array.isArray(out.links)?[...out.links]:[];
    const imdb=detail?.external_ids?.imdb_id||imdbFrom(meta,id);
    if(imdb&&!out.links.some(x=>x?.category==='imdb')) out.links.push({name:'IMDb',category:'imdb',url:`https://www.imdb.com/title/${imdb}/`});
    return out;
  }catch{return meta;}
}
