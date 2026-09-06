function asText(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' ');
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniq(values) {
  const seen = new Set();
  const out = [];
  for (const value of values.filter(Boolean)) {
    const key = String(value).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function sourceText(stream) {
  return [
    stream?.title,
    stream?.name,
    stream?.description,
    stream?.quality,
    stream?.lang,
    stream?.langs,
    stream?.language,
    stream?.audio,
    stream?.ainfo,
    stream?.vinfo,
    stream?.filename,
    stream?.fileName,
    stream?.behaviorHints?.filename
  ].map(asText).filter(Boolean).join(' ');
}

function ascii(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function resolutionFromText(text) {
  const s = String(text || '');
  if (/\b4320[pi]?\b|\b8k\b/i.test(s)) return { rank:600, short:'8K', tokens:['4320p','8K'] };
  if (/\b2160[pi]?\b|\b4k\b|\buhd\b/i.test(s)) return { rank:500, short:'4K', tokens:['2160p','4K'] };
  if (/\b1440[pi]?\b/i.test(s)) return { rank:450, short:'1440p', tokens:['1440p'] };
  if (/\b1080[pi]?\b|\bfhd\b|\bfull[ ._-]?hd\b/i.test(s)) return { rank:400, short:'1080p', tokens:['1080p'] };
  if (/\b720[pi]?\b/i.test(s)) return { rank:300, short:'720p', tokens:['720p'] };
  if (/\b576[pi]?\b/i.test(s)) return { rank:220, short:'576p', tokens:['576p'] };
  if (/\b480[pi]?\b|\bsd\b/i.test(s)) return { rank:200, short:'480p', tokens:['480p'] };
  return null;
}

// Use the most authoritative concrete-stream field first. This prevents a
// generic title/description from overriding an explicit quality such as FHD.
function resolutionInfo(stream) {
  const fields = [
    stream?.quality,
    stream?.filename,
    stream?.fileName,
    stream?.behaviorHints?.filename,
    stream?.title,
    stream?.vinfo,
    stream?.name
  ];
  for (const field of fields) {
    const info = resolutionFromText(asText(field));
    if (info) return info;
  }
  return { rank:100, short:'', tokens:[] };
}

function releaseTokens(text) {
  if (/\bremux\b/i.test(text)) return ['REMUX'];
  if (/\bblu[ ._-]?ray\b|\bbluray\b/i.test(text)) return ['BluRay'];
  if (/\bweb[ ._-]?dl\b|\bwebdl\b/i.test(text)) return ['WEB-DL'];
  if (/\bweb[ ._-]?rip\b|\bwebrip\b/i.test(text)) return ['WEBRip'];
  if (/\bhdtv\b/i.test(text)) return ['HDTV'];
  if (/\bdvd[ ._-]?rip\b/i.test(text)) return ['DVDRip'];
  return [];
}

function visualTokens(text) {
  const out = [];
  if (/\bimax[ ._-]?enhanced\b/i.test(text)) out.push('IMAX Enhanced');
  else if (/\bimax\b/i.test(text)) out.push('IMAX');
  if (/\b(dv|dovi|dolby[ ._-]?vision)\b/i.test(text)) out.push('DV', 'Dolby Vision');
  if (/hdr[ ._-]?10[ ._-]?(\+|plus)/i.test(text)) out.push('HDR10+');
  else if (/\bhdr[ ._-]?10\b/i.test(text)) out.push('HDR10');
  else if (/\bhdr\b|\bhlg\b|\bpq\b/i.test(text)) out.push('HDR');
  return uniq(out);
}

function codecTokens(text) {
  if (/\bav1\b/i.test(text)) return ['AV1'];
  if (/\b(hevc|h[ ._-]?265|x265)\b/i.test(text)) return ['HEVC','x265'];
  if (/\b(avc|h[ ._-]?264|x264)\b/i.test(text)) return ['AVC','x264'];
  return [];
}

function audioTokens(text) {
  const out = [];
  if (/\batmos\b/i.test(text)) out.push('Atmos');
  if (/\btrue[ ._-]?hd\b/i.test(text)) out.push('TrueHD');
  if (/\bdts[ ._-]?x\b/i.test(text)) out.push('DTS:X');
  if (/\bdts[ ._-]?hd[ ._-]?(ma|master audio)\b/i.test(text)) out.push('DTS-HD MA');
  else if (/\bdts[ ._-]?hd\b/i.test(text)) out.push('DTS-HD');
  else if (/\bdts\b/i.test(text)) out.push('DTS');
  if (/\b(ddp|dd\+|e-?ac-?3|eac3)\b/i.test(text)) out.push('DD+','EAC3');
  else if (/\b(dd|ac-?3|ac3)\b/i.test(text)) out.push('DD','AC3');
  if (/\baac\b/i.test(text)) out.push('AAC');
  if (/\bflac\b/i.test(text)) out.push('FLAC');
  if (/\bopus\b/i.test(text)) out.push('Opus');
  return uniq(out);
}

function channelToken(text) {
  if (/\b7[ ._-]?1\b/.test(text)) return '7.1';
  if (/\b5[ ._-]?1\b/.test(text)) return '5.1';
  if (/\b2[ ._-]?0\b/.test(text)) return '2.0';
  return '';
}

const LANGUAGE_RULES = [
  ['CZ','🇨🇿',/(^|[^a-z])(cz|cs|cze|czech|cesky|ceska|cestina)(?=$|[^a-z])/i],
  ['SK','🇸🇰',/(^|[^a-z])(sk|svk|slovak|slovensky|slovencina)(?=$|[^a-z])/i],
  ['EN','🇬🇧',/(^|[^a-z])(en|eng|english)(?=$|[^a-z])/i],
  ['DE','🇩🇪',/(^|[^a-z])(de|ger|deu|german|deutsch)(?=$|[^a-z])/i],
  ['PL','🇵🇱',/(^|[^a-z])(pl|pol|polish|polski)(?=$|[^a-z])/i],
  ['HU','🇭🇺',/(^|[^a-z])(hu|hun|hungarian|magyar)(?=$|[^a-z])/i],
  ['FR','🇫🇷',/(^|[^a-z])(fr|fre|fra|french)(?=$|[^a-z])/i],
  ['ES','🇪🇸',/(^|[^a-z])(es|spa|spanish)(?=$|[^a-z])/i],
  ['IT','🇮🇹',/(^|[^a-z])(it|ita|italian)(?=$|[^a-z])/i]
];

function languageTokens(text) {
  const t = ascii(text);
  return LANGUAGE_RULES.filter(([, ,re]) => re.test(t)).map(([label]) => label);
}

function languageDisplay(languages) {
  return languages.map((lang) => {
    const rule = LANGUAGE_RULES.find(([label]) => label === lang);
    return rule ? `${rule[1]} ${lang}` : lang;
  });
}

// Any CZ or SK audio counts as the same dubbed priority group. Once a stream
// is dubbed, resolution decides before whether it has one or both languages.
function dubbingRank(languages) {
  const set = new Set(languages);
  if (set.has('CZ') || set.has('SK')) return 300;
  if (languages.length) return 200;
  return 100;
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  const units = ['B','KB','MB','GB','TB'];
  let x = n, i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x >= 10 || i === 0 ? x.toFixed(0) : x.toFixed(1)} ${units[i]}`;
}

function parseSizeText(text) {
  const m = String(text || '').match(/\b(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|B)\b/i);
  if (!m) return 0;
  const value = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return 0;
  const powers = { B:0, KB:1, MB:2, GB:3, TB:4 };
  return value * (1024 ** powers[m[2].toUpperCase()]);
}

function sizeBytes(stream) {
  const numeric = Number(stream?.size ?? stream?.behaviorHints?.videoSize);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  for (const field of [stream?.filename, stream?.fileName, stream?.behaviorHints?.filename, stream?.title, stream?.name, stream?.description]) {
    const parsed = parseSizeText(asText(field));
    if (parsed > 0) return parsed;
  }
  return 0;
}

function sourceName(stream) {
  for (const raw of [stream?.filename, stream?.fileName, stream?.behaviorHints?.filename, stream?.title, stream?.name]) {
    const value = compactText(raw);
    if (!value) continue;
    if (/^(kra|stream|stream cinema)(?:\s*[•|:-].*)?$/i.test(value)) continue;
    return value;
  }
  return '';
}

function descriptionLines(parts, originalDescription) {
  const lines = [];
  if (parts.sourceName) lines.push(`📄 ${parts.sourceName}`);
  const video = uniq([...parts.resolution.tokens, ...parts.release, ...parts.visual, ...parts.codec]);
  const langDisplay = languageDisplay(parts.languages);
  const audio = uniq([...parts.audio, parts.channels].filter(Boolean));
  if (video.length) lines.push(`🎞 ${video.join(' • ')}`);
  if (langDisplay.length || audio.length) {
    const languagePart = langDisplay.length ? `Dabing: ${langDisplay.join(' • ')}` : '';
    lines.push(`🔊 ${[languagePart, audio.join(' • ')].filter(Boolean).join(' • ')}`);
  }
  if (parts.size) lines.push(`💾 ${parts.size}`);
  const old = compactText(originalDescription);
  if (old && !lines.some(line => line.includes(old))) lines.push(old);
  return lines.join('\n');
}

export function decorateStream(stream) {
  if (!stream || typeof stream !== 'object') return stream;
  const text = sourceText(stream);
  const resolution = resolutionInfo(stream);
  const release = releaseTokens(text);
  const visual = visualTokens(text);
  const codec = codecTokens(text);
  const audio = audioTokens(text);
  const channels = channelToken(text);
  const languages = languageTokens(text);
  const bytes = sizeBytes(stream);
  const size = bytes > 0 ? formatBytes(bytes) : '';
  const originalSourceName = sourceName(stream);

  const badgeTokens = uniq([
    ...resolution.tokens,
    ...release,
    ...visual,
    ...codec,
    ...audio,
    channels,
    ...languages,
    size
  ].filter(Boolean));

  const originalTitle = compactText(stream.title || stream?.behaviorHints?.filename || stream.name);
  const badgeTitle = badgeTokens.join(' • ');
  const title = [badgeTitle, originalTitle && !badgeTitle.toLowerCase().includes(originalTitle.toLowerCase()) ? originalTitle : '']
    .filter(Boolean).join(' • ') || 'KRA Stream';

  const flaggedLanguages = languageDisplay(languages);
  const name = ['KRA', resolution.short, flaggedLanguages.length ? flaggedLanguages.join(' / ') : '']
    .filter(Boolean).join(' • ') || compactText(stream.name) || 'KRA';

  const description = descriptionLines({
    sourceName:originalSourceName,
    resolution,
    release,
    visual,
    codec,
    audio,
    channels,
    languages,
    size
  }, stream.description);

  return {
    ...stream,
    name,
    title,
    ...(description ? { description } : {})
  };
}

function compareRawStreams(a, b) {
  const aLanguages = languageTokens(sourceText(a));
  const bLanguages = languageTokens(sourceText(b));

  const dubbingDiff = dubbingRank(bLanguages) - dubbingRank(aLanguages);
  if (dubbingDiff) return dubbingDiff;

  const qualityDiff = resolutionInfo(b).rank - resolutionInfo(a).rank;
  if (qualityDiff) return qualityDiff;

  const sizeDiff = sizeBytes(b) - sizeBytes(a);
  if (sizeDiff) return sizeDiff;

  return 0;
}

export function decorateStreams(streams) {
  if (!Array.isArray(streams)) return [];
  return streams
    .map((stream, index) => ({ stream, index }))
    .sort((a, b) => compareRawStreams(a.stream, b.stream) || a.index - b.index)
    .map(({ stream }) => decorateStream(stream));
}
