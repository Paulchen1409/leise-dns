const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeStatus } = require('../src/renderer/ui');
const { setLang, DICT, lang } = require('../src/renderer/i18n');

test('Deutsch und Englisch haben dieselben Texte', () => {
  assert.deepEqual(Object.keys(DICT.en).sort(), Object.keys(DICT.de).sort());
  for (const key of Object.keys(DICT.de)) assert.ok(DICT.en[key] && DICT.de[key]);
});

test('Deutsch bleibt voreingestellt, Englisch schaltet die Statuszeilen um', () => {
  setLang('de');
  assert.equal(lang(), 'de');
  const base = { mode: { kind: 'active' }, dns: { configured: true }, running: true, busy: false, error: '', helper: true, active: true, upstream: 'cloudflare' };
  assert.match(describeStatus(base).title, /Schutz ist aktiv/);
  setLang('en');
  try {
    assert.equal(lang(), 'en');
    assert.match(describeStatus(base).title, /protection is active/i);
    assert.match(describeStatus({ ...base, active: false, dns: { configured: false }, error: 'nope' }).title, /could not be turned on/i);
  } finally { setLang('de'); }
});
