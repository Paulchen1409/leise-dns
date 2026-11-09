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
const BLOCK_OPTIONS = new Set(['third-party','script','image','stylesheet','object','object-subrequest','xmlhttprequest','xhr','subdocument','ping','media','other','font','websocket','webrtc','popup','document','important','match-case','all','frame']);
// Options that still mean "this whole domain", not "only on page X" or "only this path".
function optionsAllowDomainBlock(options) {
  if (!options) return true;
  for (const raw of options.split(',')) {
    const opt = raw.trim().toLowerCase();
    if (!opt) continue;
    if (opt.startsWith('~') || opt.includes('=')) return false;
    if (!BLOCK_OPTIONS.has(opt)) return false;
  }
  return true;
}
// ||domain^, ||domain^$third-party, |https://domain^ — never a path, wildcard or sitekey.
function domainFromRule(body) {
  let rule = body.trim();
  let options = '';
  const dollar = rule.indexOf('$');
  if (dollar !== -1) { options = rule.slice(dollar + 1); rule = rule.slice(0, dollar); }
  if (!optionsAllowDomainBlock(options)) return null;
  if (rule.startsWith('||')) rule = rule.slice(2);
  else if (rule.startsWith('|https://')) rule = rule.slice('|https://'.length);
  else if (rule.startsWith('|http://')) rule = rule.slice('|http://'.length);
  else if (rule.startsWith('|')) return null;
  rule = rule.replace(/[\^|/]+$/g, '');
  if (!rule || /[/*?:\\@]/.test(rule) || rule.includes('..')) return null;
  return rule;
}
function parseList(text) {
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new Error('Die URL liefert eine Webseite statt einer Filterliste.');
  const domains = new Set();
  let skipped = 0, used = 0, total = 0;
  for (let line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith('!') || raw.startsWith('#') || raw.startsWith('[')) continue;
    total++;
    if (raw.startsWith('@@') || raw.includes('##') || raw.includes('#@#') || raw.includes('#?#')) { skipped++; continue; }
    let produced = false;
    const take = candidate => {
      try {
        const domain = normalizeDomain(candidate);
        if (domain !== 'localhost.localdomain') { domains.add(domain); produced = true; }
      } catch { /* not a whole domain */ }
    };
    if (/^(?:0\.0\.0\.0|127\.0\.0\.1|::1?|0)\s/.test(raw)) raw.split('#')[0].split(/\s+/).slice(1).forEach(take);
    else { const candidate = domainFromRule(raw); if (candidate) take(candidate); }
    if (produced) used++; else skipped++;
  }
  return { domains: [...domains], skipped, used, total };
}
module.exports = { normalizeDomain, matches, parseList, domainFromRule };
