const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/core/store');
const { queriesToCsv, queriesToJson } = require('../src/core/query-export');

test('Anfragen-Export als CSV und JSON, mit Maskierung', () => {
  const store = new Store(':memory:');
  try {
    store.log({ domain: 'ads.example.com', type: 'A', status: 'blocked', reason: 'Filterliste', ms: 2 });
    store.log({ domain: 'ok.example.com', type: 'AAAA', status: 'allowed', reason: 'Erlaubt', ms: 4 });
    store.log({ domain: 'a"b,c.example.com', type: 'A', status: 'error', reason: 'Zeile\n2', ms: 1 });
    const blocked = store.exportQueries({ status: 'blocked' });
    assert.equal(blocked.length, 1);
    assert.equal(blocked[0].domain, 'ads.example.com');
    const csv = queriesToCsv(store.exportQueries({ search: '"' }));
    assert.ok(csv.startsWith('\uFEFF'));
    assert.match(csv, /"a""b,c\.example\.com"/);
    assert.match(csv, /"Zeile\n2"/);
    const json = JSON.parse(queriesToJson(store.exportQueries({ status: 'allowed' })));
    assert.equal(json.length, 1);
    assert.equal(json[0].domain, 'ok.example.com');
    assert.match(json[0].time, /T/);
  } finally { store.close(); }
});

test('CSV-Export entschärft Tabellenformeln in Domains', () => {
  const csv = queriesToCsv([{ time: 0, domain: '=hyperlink("http://x")', type: 'A', status: 'allowed', reason: '+1', ms: 1 }]);
  assert.match(csv, /,"'=hyperlink\(""http:\/\/x""\)",/);
  assert.match(csv, /,'\+1,/);
});
