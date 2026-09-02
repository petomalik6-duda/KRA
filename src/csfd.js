const cache = new Map();
const TTL = 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (compatible; Stremio-KRA-Metadata/2.7.0)';

export function csfdConfigured(){ return String(process.env.CSFD_ENRICH ?? '1') !== '0'; }
function dec(s=''){ return String(s).replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/\s+/g,' ').trim(); }
function strip(s=''){ return dec(String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ')); }
function yearOf(v){ const m=String(v||'').match(/(?:19|20)\d{2}/); return m?m[0]:''; }
function existingUrl(meta){
  const vals=[meta?.csfd,meta?.csfdUrl,meta?.url, ...(Array.isArray(meta?.links)?meta.links.map(x=>x?.url):[])];
  for(const v of vals){ if(/^https?:\/\/(?:www\.)?csfd\.cz\//i.test(String(v||''))) return String(v); }
  return '';
}
async function fetchText(url){
  const hit=cache.get(url); if(hit&&Date.now()-hit.at<TTL)return hit.text;
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),headers:{'User-Agent':UA,'Accept-Language':'cs-CZ,cs;q=0.9,sk;q=0.8,en;q=0.5'}});
  if(!r.ok)return ''; const text=await r.text(); cache.set(url,{at:Date.now(),text}); return text;
}
function norm(s){ return strip(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function scoreTitle(a,b){ const A=norm(a),B=norm(b); if(!A||!B)return 0; if(A===B)return 1; if(A.includes(B)||B.includes(A))return .8; const as=new Set(A.split(' ')), bs=new Set(B.split(' ')); let inter=0; for(const x of as)if(bs.has(x))inter++; return inter/Math.max(as.size,bs.size); }
async function searchCsfd(name,year){
  if(!name)return '';
  const html=await fetchText(`https://www.csfd.cz/hledat/?q=${encodeURIComponent(name)}`); if(!html)return '';
  const re=/<a[^>]+href="([^"]*\/film\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi; let m,best=null;
  while((m=re.exec(html))){ const href=m[1], label=strip(m[2]); const y=yearOf(label); const ts=scoreTitle(name,label); const ys=!year||!y?0:(String(year)===y?0.35:-0.25); const score=ts+ys; if(!best||score>best.score)best={href,label,score}; }
  if(!best||best.score<0.65)return '';
  try{return new URL(best.href,'https://www.csfd.cz').toString();}catch{return '';}
}
function metaContent(html,prop){ const r=new RegExp(`<meta[^>]+(?:property|name)=["']${prop.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}["'][^>]+content=["']([^"']*)["']`,`i`); const m=html.match(r); return m?dec(m[1]):''; }
function parseDetail(url,html){
  const title=metaContent(html,'og:title').replace(/\s*\|\s*ČSFD.*$/i,'').trim();
  const image=metaContent(html,'og:image');
  const description=metaContent(html,'og:description');
  let rating=''; const rm=html.match(/(?:film-rating-average|rating-average)[^>]*>\s*([0-9]{1,3})%/i)||html.match(/([0-9]{1,3})%\s*<\/div>\s*<[^>]*class="[^"]*rating/i); if(rm)rating=rm[1];
  const genres=[]; const gm=html.match(/(?:Žánry|Žánr)[\s\S]{0,500}?<\/div>/i); if(gm){ for(const x of strip(gm[0]).replace(/.*?(?:Žánry|Žánr)\s*:?/i,'').split(/[,/]/)){ const g=x.trim(); if(g&&g.length<40)genres.push(g); } }
  const originMatch=strip(html).match(/(?:USA|Česko|Slovensko|Velká Británie|Francie|Německo|Kanada|Španělsko|Itálie|Japonsko)(?:\s*\/\s*[A-Za-zÁ-ž ]+){0,3}/);
  return {url,title,image,description,rating,genres:[...new Set(genres)].slice(0,8),country:originMatch?.[0]||''};
}
export async function enrichMetaWithCsfd(type,id,meta){
  if(!csfdConfigured()||!meta)return meta;
  try{
    const name=meta.name||meta.title; const year=yearOf(meta.releaseInfo||meta.year||meta.released);
    let url=existingUrl(meta); if(!url)url=await searchCsfd(name,year); if(!url)return meta;
    const html=await fetchText(url); if(!html)return meta; const d=parseDetail(url,html); const out={...meta};
    if(d.title)out.name=d.title; if(d.description)out.description=d.description; if(d.image)out.poster=d.image; if(d.genres.length)out.genres=d.genres; if(d.country)out.country=d.country; if(d.rating)out.imdbRating=String((Number(d.rating)/10).toFixed(1));
    out.links=Array.isArray(out.links)?[...out.links]:[]; if(!out.links.some(x=>x?.category==='csfd'||/csfd\.cz/i.test(x?.url||'')))out.links.push({name:'ČSFD',category:'csfd',url});
    out.csfdUrl=url; return out;
  }catch{return meta;}
}
