const { describeStatus, prefs } = window.LeiseUI;
const tr = key => window.LeiseI18n ? window.LeiseI18n.t(key) : key;
const $ = s => document.querySelector(s);
let status, pending = null, pauseChoice = null, lastIcon = '';

function showError(message) {
  $('#popup-error').hidden = !message;
  $('#popup-error-text').textContent = window.LeiseI18n ? window.LeiseI18n.te(message) : (message || '');
}

function render(s) {
  const d = describeStatus(s, { pending });
  $('#panel').className = `popup-panel tone-${d.tone}`;
  $('#popup-title').textContent = d.key === 'paused-timed' ? d.title.replace(/ Uhr$/, '') : d.pill;
  $('#popup-description').textContent = {
    active: tr('status.active.desc'),
    setup: tr('status.setup.desc'),
    off: tr('status.off.desc'),
    'paused-restart': tr('status.restart.desc'),
    approval: tr('status.approval.desc')
  }[d.key] || d.description.split('. ')[0].replace(/\.$/, '') + '.';
  const iconKey = d.icon + d.toggle;
  if (iconKey !== lastIcon) {
    lastIcon = iconKey;
    $('#popup-symbol').innerHTML = Icons.svg(d.icon) + (d.toggle === 'pending' ? '<span class="busy-badge"><span class="spinner"></span></span>' : '');
  }
  const toggle = $('#popup-toggle');
  toggle.dataset.state = d.toggle;
  toggle.setAttribute('aria-checked', String(d.toggle === 'on'));
  toggle.setAttribute('aria-busy', String(d.toggle === 'pending'));
  toggle.setAttribute('aria-label', d.toggle === 'on' ? tr('popup.toggleOff') : tr('popup.toggleOn'));
  toggle.disabled = !!s.busy;

  let current = null;
  if (!s.active && !s.busy && !s.error) {
    if (s.mode.kind === 'off' || s.mode.kind === 'restart') current = s.mode.kind;
    if (s.mode.kind === 'timed') current = pauseChoice || (s.mode.until - Date.now() > 5 * 60000 ? '30' : '5');
  }
  document.querySelectorAll('[data-mode]').forEach(b => {
    b.disabled = !!s.busy;
    b.setAttribute('aria-pressed', String(b.dataset.mode === current));
  });
  showError(s.error);
}

async function update() {
  try {
    status = (await window.leise.call('snapshot')).status;
    // Fallback if the storage event from the dashboard did not arrive.
    if (document.documentElement.lang !== window.LeiseI18n.lang()) { window.LeiseI18n.apply(); document.title = tr('popup.title'); lastIcon = ''; }
    render(status);
  } catch (e) { showError(e.message); }
}

async function mode(kind) {
  pending = kind;
  if (['5', '30'].includes(kind)) pauseChoice = kind;
  if (status) render({ ...status, busy: true, error: '' });
  try { await window.leise.call('mode', { kind }); }
  catch (e) { showError(e.message); }
  finally { pending = null; await update(); }
}

Icons.hydrate();
prefs.watch();
window.LeiseI18n.apply();
document.title = tr('popup.title');
// The language is chosen in the dashboard; follow it right away.
document.documentElement.addEventListener('leise-lang', () => {
  document.title = tr('popup.title');
  lastIcon = '';
  if (status) render(status);
});
$('#popup-toggle').addEventListener('click', () => mode(status?.active ? 'off' : 'active'));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => mode(b.dataset.mode)));
$('#open').addEventListener('click', () => window.leise.call('window:open'));
$('#quit').addEventListener('click', () => window.leise.call('app:quit'));
window.leise.onChange(update);
setInterval(() => { if (status?.mode.kind === 'timed') render(status); }, 15000);
update();
// The window follows the content height, so errors never get cut off.
new ResizeObserver(() => window.leise.call('popup:fit', { height: $('#panel').offsetHeight + 20 }).catch(() => {})).observe($('#panel'));
