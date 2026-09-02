import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptStreamCinemaIdent, versionIdent, rankSearchCandidates } from '../src/sc.js';
import { parseStremioId } from '../src/utils.js';

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
