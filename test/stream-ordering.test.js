import test from 'node:test';
import assert from 'node:assert/strict';
import { decorateStreams } from '../src/stream-presentation.js';

test('4K CZ outranks FHD CZ+SK because both are dubbed', () => {
  const streams = decorateStreams([
    {
      quality:'FHD',
      title:'Avatar.2009.1080p.CZ.SK',
      url:'https://example.test/avatar-fhd'
    },
    {
      quality:'4K',
      title:'Avatar.2009.2160p.CZ',
      url:'https://example.test/avatar-4k'
    }
  ]);
  assert.equal(streams[0].url, 'https://example.test/avatar-4k');
  assert.equal(streams[1].url, 'https://example.test/avatar-fhd');
});

test('dubbed stream still outranks non-dubbed higher-resolution stream', () => {
  const streams = decorateStreams([
    { quality:'8K', title:'Avatar.4320p.EN', url:'https://example.test/en-8k' },
    { quality:'1080p', title:'Avatar.1080p.CZ', url:'https://example.test/cz-fhd' }
  ]);
  assert.equal(streams[0].url, 'https://example.test/cz-fhd');
});
