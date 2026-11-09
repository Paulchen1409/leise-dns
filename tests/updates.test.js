const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, parseRelease } = require('../src/core/updates');

test('Versionen werden als major.minor.patch verglichen', () => {
  assert.equal(compareVersions('0.6.1', '0.6.1'), 0);
  assert.equal(compareVersions('v0.7.0', '0.6.1') > 0, true);
  assert.equal(compareVersions('0.6.1', '0.10.0') < 0, true);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), 0);
});

test('Ein GitHub-Release wird nur von diesem Projekt übernommen', () => {
  const info = parseRelease({ tag_name: 'v0.8.0', name: 'Leise DNS 0.8.0', html_url: 'https://github.com/Paulchen1409/leise-dns/releases/tag/v0.8.0', body: 'Neu:\n- Cache' }, '0.7.0');
  assert.equal(info.updateAvailable, true);
  assert.equal(info.latest, '0.8.0');
  assert.match(info.notes, /Cache/);
  assert.equal(parseRelease({ tag_name: 'v0.7.0', html_url: 'https://github.com/Paulchen1409/leise-dns/releases/tag/v0.7.0', body: '' }, '0.7.0').updateAvailable, false);
  assert.throws(() => parseRelease({ tag_name: 'v9', html_url: 'https://evil.example/release', body: '' }, '0.7.0'), /Release-Adresse/);
  assert.throws(() => parseRelease({}, '0.7.0'), /unvollständig/);
});
