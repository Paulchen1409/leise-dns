const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HELP, helpUrl } = require('../src/core/help-links');

test('Hilfe-Links sind fest und nur https auf bekannten Seiten', () => {
  assert.deepEqual(Object.keys(HELP).sort(), ['chrome', 'edge', 'firefox', 'windows']);
  for (const id of Object.keys(HELP)) {
    const url = new URL(helpUrl(id));
    assert.equal(url.protocol, 'https:');
    assert.match(url.hostname, /^(support\.google\.com|support\.microsoft\.com|support\.mozilla\.org)$/);
  }
  assert.throws(() => helpUrl('https://example.com'), /Unbekannte Hilfe/);
  assert.throws(() => helpUrl('file'), /Unbekannte Hilfe/);
});
