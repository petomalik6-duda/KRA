import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptStreamCinemaIdent, versionIdent, rankSearchCandidates } from '../src/sc.js';
import { parseStremioId } from '../src/utils.js';
import { ADDON_VERSION, CATALOGS, makeManifest } from '../src/stremio.js';
import { decorateStream } from '../src/stream-presentation.js';

test('plain and v0 Stream Cinema identifiers', () => {
  assert.equal(decryptStreamCinemaIdent('plain-ident'), 'plain-ident');
  assert.equal(decryptStreamCinemaIdent('v0:plain-ident'), 'plain-ident');
  assert.equal(decryptStreamCinemaIdent('v3:not-supported'), null);
  assert.equal(decryptStreamCinemaIdent('v1:'), null);
});

test('versionIdent mirrors APK model behavior', () => {
  assert.equal(versionIdent({ version: 1, v1: 'abc' }), 'v1:abc');
  assert.equal(versionIdent({ version: 2, v2: 'xyz' }), 'v2:xyz');
  assert.equal(versionIdent({ version: 3, v1: 'abc' }), null);
});

test('Stremio series ids are parsed', () => {
  assert.deepEqual(parseStremioId('series', 'tt1234567:2:4'), { imdbId: 'tt1234567', season: 2, episode: 4 });
});

test('IMDb exact match outranks title-only match', () => {
  const ranked = rankSearchCandidates([
    { title: 'Example Film', info: { year: 2026 } },
    { title: 'Wrong title', unique_ids: { imdb: 'tt1234567' } }
  ], { title: 'Example Film', year: 2026, imdbId: 'tt1234567' });
  assert.equal(ranked[0].exactId, true);
});

test('encrypted configuration round-trip', async () => {
  process.env.CONFIG_SECRET = 'unit-test-secret';
  const { encodeConfig, decodeConfig } = await import('../src/config.js');
  const token = encodeConfig({ username: 'u', password: 'p', uid: '12345678-1234-4234-8234-123456789abc', preferredLanguages: ['sk','cs'], maxStreams: 10 });
  assert.match(token, /^v1\./);
  const decoded = decodeConfig(token);
  assert.equal(decoded.username, 'u');
  assert.equal(decoded.password, 'p');
  assert.equal(decoded.maxStreams, 10);
});

test('APK catalog routes used by v2.8.0 are preserved', () => {
  assert.equal(ADDON_VERSION, '2.8.0');
  const byId = Object.fromEntries(CATALOGS.map(c => [c.id, c]));
  assert.equal(byId['sc-movie-latest-dubbed'].path, '/FMovies/latestd');
  assert.equal(byId['sc-movie-concerts'].path, '/FKoncert/latest');
  assert.equal(byId['sc-series-latest'].path, '/FSeries/latestt');
  assert.equal(byId['sc-series-latest-dubbed'].path, '/FSeries/latestd');
  assert.equal(byId['sc-series-added'].path, '/FSeries/latest');
  assert.equal(byId['sc-series-newep'].path, '/FSeries/newep');
  assert.equal(byId['sc-movie-newstream'].path, '/FMovies/newstream');
  assert.equal(byId['sc-movie-latest-dubbed'].nativePreferred, true);
  assert.equal(byId['sc-movie-concerts'].nativePreferred, true);
});

test('manifest exposes new native KRA catalogs', () => {
  const manifest = makeManifest(true);
  const ids = new Set(manifest.catalogs.map(c => `${c.type}:${c.id}`));
  assert.ok(ids.has('movie:sc-movie-newstream'));
  assert.ok(ids.has('series:sc-series-added'));
  assert.ok(ids.has('series:sc-series-newep'));
});

test('stream presentation exposes NardBadges-compatible tokens and description', () => {
  const stream = decorateStream({
    name: 'Stream Cinema',
    title: 'Movie.2026.2160p.WEB-DL.DV.HDR10+.HEVC.TrueHD.Atmos.7.1.CZ.SK.mkv',
    url: 'https://example.test/video',
    behaviorHints: { videoSize: 18 * 1024 * 1024 * 1024 }
  });
  assert.match(stream.name, /^KRA/);
  assert.match(stream.title, /2160p/);
  assert.match(stream.title, /4K/);
  assert.match(stream.title, /WEB-DL/);
  assert.match(stream.title, /DV/);
  assert.match(stream.title, /HDR10\+/);
  assert.match(stream.title, /HEVC/);
  assert.match(stream.title, /Atmos/);
  assert.match(stream.title, /CZ/);
  assert.match(stream.title, /SK/);
  assert.match(stream.description, /🎞/);
  assert.match(stream.description, /🔊/);
  assert.match(stream.description, /18 GB/);
});

test('stream presentation preserves playback and proxy hints', () => {
  const original = {
    name: 'KRA • 1080p',
    title: '1080p • CZ • 5.1',
    url: 'https://example.test/video',
    behaviorHints: { notWebReady:true, proxyHeaders:{request:{Referer:'https://example.test/'}} }
  };
  const decorated = decorateStream(original);
  assert.equal(decorated.url, original.url);
  assert.deepEqual(decorated.behaviorHints, original.behaviorHints);
});
