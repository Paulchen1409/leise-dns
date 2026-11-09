// Update check against the public GitHub releases of this app.
// The release page is only accepted from that one repository.
const RELEASE = 'https://api.github.com/repos/Paulchen1409/leise-dns/releases/latest';
const RELEASE_PAGE = /^https:\/\/github\.com\/Paulchen1409\/leise-dns\/releases\/(?:tag\/[A-Za-z0-9._+-]+|latest)$/;

function parts(value) {
  return String(value || '').replace(/^v/i, '').split('-')[0].split('.').slice(0, 3).map(n => parseInt(n, 10) || 0);
}
function compareVersions(left, right) {
  const a = parts(left), b = parts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function parseRelease(json, current) {
  if (!json || typeof json !== 'object' || !json.tag_name) throw new Error('Die Update-Antwort war unvollständig.');
  const latest = String(json.tag_name).replace(/^v/i, '');
  const url = String(json.html_url || 'https://github.com/Paulchen1409/leise-dns/releases/latest');
  if (!RELEASE_PAGE.test(url)) throw new Error('Unerwartete Release-Adresse.');
  return {
    current: String(current),
    latest,
    url,
    notes: String(json.body || '').replace(/\r/g, '').slice(0, 4000),
    name: String(json.name || latest).slice(0, 160),
    updateAvailable: compareVersions(latest, current) > 0
  };
}
module.exports = { compareVersions, parseRelease, RELEASE, RELEASE_PAGE };
