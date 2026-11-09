// Pages the app may open for the "apps can bypass DNS" hint.
// Anything else is refused; the renderer never gets to pass a free-form URL.
const HELP = {
  chrome: 'https://support.google.com/chrome/answer/10468684?hl=de',
  edge: 'https://support.microsoft.com/edge/securely-browse-the-web-in-microsoft-edge',
  firefox: 'https://support.mozilla.org/kb/firefox-dns-over-https',
  windows: 'https://support.microsoft.com/windows/experience/connectivity-networking/essential-network-settings-and-tasks-in-windows'
};
const HOSTS = new Set(['support.google.com', 'support.microsoft.com', 'support.mozilla.org']);
function helpUrl(id) {
  const url = HELP[id];
  if (!url) throw new Error('Unbekannte Hilfe.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname)) throw new Error('Unbekannte Hilfe.');
  return parsed.href;
}
module.exports = { HELP, helpUrl };
