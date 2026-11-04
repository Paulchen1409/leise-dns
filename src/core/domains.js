const { domainToASCII } = require('node:url');
const { isIP } = require('node:net');

function normalizeDomain(input) {
  if (typeof input !== 'string' || input.length > 1024) throw new Error('Bitte eine gültige Domain eingeben.');
  const plain = input.trim().normalize('NFC').toLowerCase().replace(/\.$/, '');
  if (/[^\p{L}\p{N}.-]/u.test(plain)) throw new Error('Bitte nur die Domain eingeben, ohne URL, Pfad oder Filterzeichen.');
  const name = domainToASCII(plain);
  if (!name || name.length > 253 || isIP(name) || !name.includes('.') ||
      name.split('.').some(p => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))) {
    throw new Error('Bitte nur die Domain eingeben, zum Beispiel werbung.example – ohne https:// oder Pfad.');
  }
  return name;
}
function matches(set, domain) {
  for (let d = domain.toLowerCase().replace(/\.$/, ''); d.includes('.'); d = d.slice(d.indexOf('.') + 1)) {
    if (set.has(d)) return true;
  }
  return false;
}
function parseList(text) {
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new Error('Die URL liefert eine Webseite statt einer Filterliste.');
  const domains = new Set(); let skipped = 0;
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || /^[!#\[]/.test(line)) continue;
    let candidates;
    if (/^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|0)\s/.test(line)) candidates = line.split('#')[0].split(/\s+/).slice(1);
    else if (/^\|\|[^\^]+\^$/.test(line)) candidates = [line.slice(2, -1)];
    else candidates = [line];
    for (const candidate of candidates) {
      try { const d = normalizeDomain(candidate); if (d !== 'localhost.localdomain') domains.add(d); }
      catch { skipped++; }
    }
  }
  return { domains: [...domains], skipped };
}
module.exports = { normalizeDomain, matches, parseList };
