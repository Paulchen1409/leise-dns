const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describeStatus } = require('../src/renderer/ui');
const fs = require('node:fs');
const path = require('node:path');
const { setLang, DICT, lang, te, t } = require('../src/renderer/i18n');
const { renderPage, portConflict } = require('../src/core/block-page');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('jeder Schlüssel aus HTML und Skripten existiert in beiden Sprachen', () => {
  const used = new Set();
  for (const file of ['src/renderer/index.html', 'src/renderer/popup.html']) {
    for (const m of read(file).matchAll(/data-i18n(?:-html|-placeholder|-aria|-title)?="([^"]+)"/g)) used.add(m[1]);
  }
  for (const file of ['src/renderer/app.js', 'src/renderer/popup.js', 'src/renderer/ui.js']) {
    for (const m of read(file).matchAll(/\b(?:t|tr)\(\s*'([a-zA-Z0-9.]+)'/g)) used.add(m[1]);
  }
  for (const kind of ['white', 'black']) for (const f of ['title', 'button', 'done', 'intro', 'none', 'search']) used.add(`rules.${kind}.${f}`);
  for (const k of ['q.allowed', 'q.blocked', 'q.error', 'list.cat.malware', 'list.cat.phishing', 'list.cat.ads']) used.add(k);
  const missing = [...used].filter(key => !key.endsWith('.') && (!DICT.de[key] || !DICT.en[key]));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 200, `nur ${used.size} Schlüssel gefunden`);
});

test('die Oberfläche enthält keine unübersetzten deutschen Texte', () => {
  // Every visible text in the HTML must sit inside an element with data-i18n or data-i18n-html.
  // Names that are the same in both languages are allowed.
  const SAME = /^(Leise|DNS|CSV|JSON|Cloudflare|Google|Quad9|Deutsch|English|Live|%|0|1\.1\.1\.1|8\.8\.8\.8|9\.9\.9\.9|Leise DNS|Leise DNS · Version [\d.]+)$/;
  const VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'col', 'hr']);
  for (const file of ['src/renderer/index.html', 'src/renderer/popup.html']) {
    const html = read(file).replace(/<head>[\s\S]*?<\/head>/, '').replace(/<!--[\s\S]*?-->/g, '');
    const stack = [];
    const bare = [];
    for (const token of html.split(/(<[^>]+>)/)) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (token.startsWith('<')) {
        const name = /^<([a-z0-9]+)/i.exec(token)?.[1]?.toLowerCase();
        if (!name || name === '!doctype') continue;
        const translated = /\sdata-i18n(?:-html)?="/.test(token) || stack.some(Boolean);
        if (!VOID.has(name) && !token.endsWith('/>')) stack.push(translated);
        continue;
      }
      const text = token.replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text || !/[A-Za-zÄÖÜäöüß]{2,}/.test(text) || SAME.test(text) || stack.some(Boolean)) continue;
      bare.push(text);
    }
    assert.deepEqual(bare, [], file);
  }
});

test('Meldungen des Dienstes werden auf Englisch übersetzt', () => {
  setLang('en');
  try {
    assert.equal(te('Der DNS-Anbieter antwortet nicht.'), 'The DNS provider is not responding.');
    assert.equal(te('Download fehlgeschlagen (HTTP 404).'), 'Download failed (HTTP 404).');
    assert.equal(te('Die Pause ist beendet, aber das Einschalten ist fehlgeschlagen: Kein aktiver Netzwerkadapter gefunden.'),
      'The pause has ended, but turning protection back on failed: No active network adapter found.');
    assert.equal(te('DNS-Hilfsdienst wurde vorzeitig beendet (Code 1). Die Windows-Freigabe wurde abgebrochen oder der Hilfsprozess konnte nicht starten.'),
      'The DNS helper stopped early (Code 1). The Windows approval was cancelled or the helper process could not start.');
    assert.equal(te('Bitte kurz warten, die Einstellung wird gerade geändert.'), 'Please wait a moment, the setting is being changed.');
    assert.equal(te('Erlaubt'), 'Allowed');
    assert.equal(te('Phishing · Phishing Army'), 'Phishing · Phishing Army');
    const conflict = portConflict(443, 'EADDRINUSE');
    assert.doesNotMatch(te(conflict.summary), /[äöü]|belegt/);
    for (const step of conflict.steps) assert.doesNotMatch(te(step), /[äöü]|Programm/);
    assert.equal(te('Something unknown'), 'Something unknown');
    assert.match(t('status.timed.title', { time: '14:30' }), /^Paused until 14:30$/);
  } finally { setLang('de'); }
  assert.equal(te('Der DNS-Anbieter antwortet nicht.'), 'Der DNS-Anbieter antwortet nicht.');
});

test('jede deutsche Dienstmeldung aus dem Quellcode hat eine englische Übersetzung', () => {
  const sources = ['src/core/filters.js', 'src/core/store.js', 'src/core/domains.js', 'src/core/service.js', 'src/core/dns-proxy.js',
    'src/core/block-page.js', 'src/core/updates.js', 'src/core/help-links.js', 'src/platform/windows-dns.js', 'src/main/main.js'];
  const messages = [];
  for (const file of sources) {
    for (const m of read(file).matchAll(/new Error\('([^']+)'\)/g)) messages.push(m[1]);
  }
  for (const m of read('src/platform/dns-helper.ps1').matchAll(/throw '([^']+)'/g)) messages.push(m[1]);
  setLang('en');
  try {
    const untranslated = messages.filter(msg => te(msg) === msg);
    assert.deepEqual(untranslated, []);
  } finally { setLang('de'); }
  assert.ok(messages.length > 30);
});

test('die Sperrseite folgt der gewählten Sprache', () => {
  const threat = { category: 'phishing', list: 'Phishing Army', matched: 'evil.example' };
  const german = renderPage({ domain: 'evil.example', threat });
  assert.match(german, /<html lang="de">/);
  assert.match(german, /Diese Seite wurde gesperrt/);
  const english = renderPage({ domain: 'evil.example', threat, lang: 'en' });
  assert.match(english, /<html lang="en">/);
  assert.match(english, /This site was blocked/);
  assert.match(english, /Source: filter list “Phishing Army”/);
  assert.doesNotMatch(english, /gesperrt|Grund|Quelle/);
  assert.match(renderPage({ domain: '', threat: null, lang: 'en' }), /local Leise DNS notice page/);
});

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
