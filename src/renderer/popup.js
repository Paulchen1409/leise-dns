const { describeStatus, prefs } = window.LeiseUI;
const $ = s => document.querySelector(s);
let status, pending = null, pauseChoice = null, lastIcon = '';

function showError(message) {
  $('#popup-error').hidden = !message;
  $('#popup-error-text').textContent = message || '';
}

function render(s) {
  const d = describeStatus(s, { pending });
  $('#panel').className = `popup-panel tone-${d.tone}`;
  $('#popup-title').textContent = d.key === 'paused-timed' ? d.title.replace(/ Uhr$/, '') : d.pill;
  $('#popup-description').textContent = {
    active: 'Werbung und Tracker werden blockiert.',
    setup: 'Im Dashboard mit einem Klick einrichten.',
    off: 'Über den Schalter wieder einschalten.',
    'paused-restart': 'Bis zum Neustart der App.',
    approval: 'Bitte die Windows-Abfrage bestätigen.'
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
  toggle.setAttribute('aria-label', d.toggle === 'on' ? 'Schutz ausschalten' : 'Schutz einschalten');
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
$('#popup-toggle').addEventListener('click', () => mode(status?.active ? 'off' : 'active'));
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => mode(b.dataset.mode)));
$('#open').addEventListener('click', () => window.leise.call('window:open'));
$('#quit').addEventListener('click', () => window.leise.call('app:quit'));
window.leise.onChange(update);
setInterval(() => { if (status?.mode.kind === 'timed') render(status); }, 15000);
update();
// The window follows the content height, so errors never get cut off.
new ResizeObserver(() => window.leise.call('popup:fit', { height: $('#panel').offsetHeight + 20 }).catch(() => {})).observe($('#panel'));
