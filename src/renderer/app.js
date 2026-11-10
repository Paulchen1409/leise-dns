const api = window.leise;
const { describeStatus, prefs, chartGroups, gapRanges } = window.LeiseUI;
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls) => Icons.svg(name, cls);
const L = () => window.LeiseI18n.locale();
const t = (key, vars) => window.LeiseI18n.t(key, vars);
const te = message => window.LeiseI18n.te(message);
const number = n => new Intl.NumberFormat(L()).format(n);
const time = v => new Date(v).toLocaleTimeString(L(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const day = v => new Date(v).toLocaleDateString(L(), { day: '2-digit', month: '2-digit' });
const date = v => new Date(v).toLocaleString(L(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

let snapshot, days = 1, chart, chartTitles = [], feed = true, page = 'dashboard';
let toastTimer, refreshTimer, queryTimer, liveTimer;
let pendingMode = null, pauseChoice = null, queryStatus = 'all';
const lastAdded = { white: null, black: null };
const rendered = new Map();
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(e.message));

// Re-render a section only when its data actually changed (keeps focus and avoids flicker).
function changed(key, value) {
  const json = JSON.stringify(value);
  if (rendered.get(key) === json) return false;
  rendered.set(key, json);
  return true;
}

/* ---------- Feedback ---------- */
function toast(message, error = false) {
  clearTimeout(toastTimer);
  const el = $('#toast');
  el.classList.remove('is-leaving');
  el.classList.toggle('is-error', error);
  el.setAttribute('aria-live', error ? 'assertive' : 'polite');
  el.innerHTML = `${icon(error ? 'alert' : 'check')}<span>${esc(error ? te(message) : message)}</span>`;
  el.hidden = false;
  toastTimer = setTimeout(() => {
    el.classList.add('is-leaving');
    toastTimer = setTimeout(() => { el.hidden = true; }, 220);
  }, error ? 10000 : 4200);
}

async function action(button, fn, message) {
  if (button) { button.disabled = true; button.setAttribute('aria-busy', 'true'); }
  try {
    const result = await fn();
    if (message) toast(message);
    await refresh();
    return result;
  } catch (e) {
    toast(e.message, true);
    throw e;
  } finally {
    if (button) { button.disabled = false; button.removeAttribute('aria-busy'); }
  }
}
const quietly = promise => promise.catch(() => {});

function empty(symbol, title, detail = '') {
  return `<div class="empty"><span class="empty-symbol">${icon(symbol)}</span>${esc(title)}${detail ? `<small>${esc(detail)}</small>` : ''}</div>`;
}

// State changes refresh quickly; bursts of DNS queries at most once per second.
let refreshDue = Infinity;
function scheduleRefresh(delay = 1000) {
  const due = Date.now() + delay;
  if (refreshTimer && due >= refreshDue) return;
  clearTimeout(refreshTimer);
  refreshDue = due;
  refreshTimer = setTimeout(() => { refreshTimer = null; refreshDue = Infinity; refresh().catch(e => toast(e.message, true)); }, delay);
}

/* ---------- Segmented controls & navigation indicator ---------- */
function syncThumb(group) {
  const thumb = group.querySelector('.seg-thumb');
  if (!thumb) return;
  const active = group.querySelector('[aria-pressed="true"]');
  group.classList.toggle('is-plain', !active);
  if (!active || !active.offsetWidth) return;
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
  requestAnimationFrame(() => thumb.classList.add('is-ready'));
}
function press(group, selector, match) {
  group.querySelectorAll(selector).forEach(b => b.setAttribute('aria-pressed', String(match(b))));
  syncThumb(group);
}
const syncAllThumbs = () => $$('.segmented').forEach(syncThumb);

function syncNav() {
  const link = $(`.nav a[data-page="${page}"]`);
  const indicator = $('.nav-indicator');
  if (!link || !indicator) return;
  indicator.style.transform = `translateY(${link.offsetTop}px)`;
  indicator.style.height = `${link.offsetHeight}px`;
  requestAnimationFrame(() => indicator.classList.add('is-ready'));
}

/* ---------- Routing ---------- */
const pages = {
  dashboard: ['nav.dashboard', 'page.dashboard.sub'],
  queries: ['nav.queries', 'page.queries.sub'],
  filters: ['nav.filters', 'page.filters.sub'],
  white: ['nav.allow', 'page.allow.sub'],
  black: ['nav.block', 'page.block.sub'],
  settings: ['nav.settings', 'page.settings.sub']
};
const tr = key => t(key);
function route() {
  const previous = page;
  page = location.hash.slice(1);
  if (!pages[page]) page = 'dashboard';
  $$('.page').forEach(el => {
    const show = el.id === `page-${page}`;
    el.hidden = !show;
    if (show && previous !== page) {
      el.classList.remove('is-entering');
      void el.offsetWidth;
      el.classList.add('is-entering');
    }
  });
  $$('.nav a').forEach(el => {
    if (el.dataset.page === page) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  document.documentElement.classList.toggle('on-queries', page === 'queries');
  $('#page-title').textContent = tr(pages[page][0]);
  $('#page-subtitle').textContent = tr(pages[page][1]);
  document.title = page === 'dashboard' ? 'Leise DNS' : `${tr(pages[page][0])} · Leise DNS`;
  if (previous !== page) window.scrollTo(0, 0);
  syncNav();
  syncAllThumbs();
  measureLayout();
  GlassLens.attach();
  if (snapshot) {
    renderGlobalError(snapshot.status);
    if (page === 'queries') loadQueries({ reset: true }).catch(e => toast(e.message, true));
    updateNewPill();
    if (page === 'dashboard') chart?.resize();
  }
}
$$('.page').forEach(el => el.addEventListener('animationend', () => el.classList.remove('is-entering')));

function measureLayout() {
  const root = document.documentElement;
  root.style.setProperty('--topbar-h', `${$('#topbar').offsetHeight}px`);
  const toolbar = $('#log-toolbar');
  if (toolbar.offsetHeight) root.style.setProperty('--log-head-top', `${$('#topbar').offsetHeight - 6 + toolbar.offsetHeight + 12}px`);
}

/* ---------- Protection status ---------- */
function renderStatus(s) {
  const d = describeStatus(s, { pending: pendingMode });
  const card = $('#status-card');
  card.dataset.state = d.key;
  card.className = `hero glass glass-lg tone-${d.tone}`;
  $('#status-wrap').className = `hero-wrap tone-${d.tone}`;
  $('#status-label').textContent = d.kicker;
  $('#status-title').textContent = d.title;
  $('#status-description').textContent = d.description;
  const symbolKey = d.icon + d.toggle;
  if (changed('symbol', symbolKey)) $('#status-symbol').innerHTML = icon(d.icon) + (d.toggle === 'pending' ? '<span class="busy-badge"><span class="spinner"></span></span>' : '');

  const toggle = $('#main-toggle');
  toggle.dataset.state = d.toggle;
  toggle.setAttribute('aria-checked', String(d.toggle === 'on'));
  toggle.setAttribute('aria-busy', String(d.toggle === 'pending'));
  toggle.disabled = d.toggle === 'pending';
  toggle.setAttribute('aria-label', d.toggle === 'on' ? t('toggle.off') : d.toggle === 'pending' ? d.title : t('toggle.on'));
  $('#switch-caption').textContent = d.toggle === 'on' ? t('switch.on') : d.toggle === 'pending' ? t('switch.wait') : t('switch.off');

  const errorBox = $('#status-error');
  errorBox.hidden = !d.error;
  $('#status-error-text').textContent = te(d.error);

  const connection = $('#connection');
  connection.className = `status-text tone-${d.connection.tone}`;
  $('#connection-label').textContent = d.connection.text;

  const setup = $('#setup-button');
  setup.hidden = !d.action;
  setup.disabled = !!s.busy;
  if (d.action) {
    setup.dataset.target = d.action.mode;
    if (changed('setup', d.action)) setup.innerHTML = `<span>${esc(d.action.label)}</span>${icon(d.action.icon)}`;
  }

  const pill = $('#status-pill');
  pill.className = `status-pill glass glass-thin tone-${d.tone}`;
  $('#status-pill-text').textContent = d.pill;

  let current = null;
  if (s.mode.kind === 'off' || s.mode.kind === 'restart') current = s.mode.kind;
  if (s.mode.kind === 'timed') current = pauseChoice || (s.mode.until - Date.now() > 5 * 60000 ? '30' : '5');
  if (s.active || s.busy || s.error) current = null;
  press($('#pause-group'), '[data-mode]', b => b.dataset.mode === current);
  $$('[data-mode]').forEach(b => { b.disabled = !!s.busy; });

  press($('#upstream'), '[data-upstream]', b => b.dataset.upstream === s.upstream);
  const cacheNote = $('#cache-note');
  if (cacheNote && s.cache) cacheNote.textContent = t('up.cacheLive', { entries: number(s.cache.entries), max: number(s.cache.maxEntries), ttl: s.cache.maxTtl, hits: number(s.cache.hits) });
  const memoryNote = $('#metric-memory');
  if (memoryNote && s.memory) {
    const mb = (s.memory.heapUsed / 1048576).toLocaleString(L(), { maximumFractionDigits: 1 });
    memoryNote.textContent = t('metric.memory', { mb });
  }
  const version = $('#app-version');
  if (version && s.version) version.textContent = t('app.version', { version: s.version });
  renderUpdate(s);
  $('#autostart-toggle').setAttribute('aria-checked', String(!!s.autostart));
  $('#autoupdate-toggle').setAttribute('aria-checked', String(!!s.autoUpdate));
  renderApproval(s);
  renderBlockPage(s);

  if (changed('adapters', [s.dns.adapters || [], window.LeiseI18n.lang()])) {
    const adapters = s.dns.adapters || [];
    $('#adapter-status').innerHTML = adapters.length
      ? adapters.map(a => `<div class="adapter">${icon('network')}<span class="adapter-name">${esc(a.Name)}<small>${esc(a.Family)}</small></span><code>${esc((a.Servers || []).join(', ') || t('adapter.auto'))}</code></div>`).join('')
      : empty('network', t('adapter.none'), t('adapter.noneHint'));
  }
  renderGlobalError(s);
}

function renderUpdate(s) {
  const status = $('#update-status');
  const text = $('#update-status-text');
  const notes = $('#update-notes');
  const open = $('#open-update');
  if (!status || !text) return;
  const info = s.update;
  if (!info) {
    status.className = 'approval-status status-text tone-neutral';
    text.textContent = s.version ? t('ver.installedNotChecked', { version: s.version }) : t('ver.notChecked');
    if (notes) notes.hidden = true;
    if (open) open.hidden = true;
    return;
  }
  if (info.updateAvailable) {
    status.className = 'approval-status status-text tone-warning';
    text.textContent = t('ver.available', { latest: info.latest, current: info.current || s.version });
    if (notes) { notes.hidden = !info.notes; notes.textContent = info.notes || ''; }
    if (open) open.hidden = false;
  } else {
    status.className = 'approval-status status-text tone-success';
    text.textContent = t('ver.current', { version: info.current || s.version });
    if (notes) notes.hidden = true;
    if (open) open.hidden = true;
  }
}

// "Windows-Freigabe merken": setting plus the real state of the Windows task.
function renderApproval(s) {
  const a = s.approval || { remember: false, task: 'unknown', error: '' };
  const toggle = $('#approval-toggle');
  toggle.setAttribute('aria-checked', String(!!a.remember));
  toggle.disabled = !!s.busy;
  const [tone, text] = a.remember
    ? a.task === 'registered' ? ['success', t('approval.registered')]
    : a.task === 'failed' ? ['warning', t('approval.failed', { error: te(a.error) || t('approval.unknownError') })]
    : a.task === 'unknown' ? ['neutral', t('checking')]
    : ['neutral', t('approval.pending')]
    : a.task === 'registered' || a.task === 'removing' ? ['warning', t('approval.removing')]
    : ['neutral', t('approval.off')];
  $('#approval-status').className = `approval-status status-text tone-${tone}`;
  $('#approval-status-text').textContent = text;
}

function renderGlobalError(s) {
  $('#global-error').hidden = !s.error || page === 'dashboard';
  $('#global-error-text').textContent = te(s.error);
}

/* ---------- Statistics & chart ---------- */
function seriesColors() {
  const css = getComputedStyle(document.documentElement);
  const get = name => css.getPropertyValue(name).trim();
  return { allowed: get('--series-allowed'), blocked: get('--series-blocked'), error: get('--series-error'), text: get('--text-3') };
}
function withAlpha(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha})`;
}
function areaFill(color) {
  return ctx => {
    const { chartArea, ctx: c } = ctx.chart;
    if (!chartArea) return withAlpha(color, 0.08);
    const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    g.addColorStop(0, withAlpha(color, 0.2));
    g.addColorStop(1, withAlpha(color, 0));
    return g;
  };
}
// A hairline that follows the hovered hour.
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(c) {
    const active = c.tooltip?.getActiveElements?.();
    if (!active?.length) return;
    const x = active[0].element.x;
    const { top, bottom } = c.chartArea;
    c.ctx.save();
    c.ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    c.ctx.lineWidth = 1;
    c.ctx.beginPath();
    c.ctx.moveTo(Math.round(x) + 0.5, top);
    c.ctx.lineTo(Math.round(x) + 0.5, bottom);
    c.ctx.stroke();
    c.ctx.restore();
  }
};
// Marks periods without data, so a gap reads as "not measured" and not as a broken chart.
let chartGaps = [];
const gapBands = {
  id: 'gapBands',
  beforeDatasetsDraw(c) {
    const { left, right, top, bottom } = c.chartArea;
    const last = c.data.labels.length - 1;
    const x = c.scales.x;
    c.ctx.save();
    for (const [first, end] of chartGaps) {
      const from = first > 0 ? x.getPixelForValue(first - 1) : left;
      const to = end < last ? x.getPixelForValue(end + 1) : right;
      c.ctx.fillStyle = 'rgba(255,255,255,0.025)';
      c.ctx.fillRect(from, top, to - from, bottom - top);
      if (to - from >= 84) {
        c.ctx.fillStyle = seriesColors().text;
        c.ctx.font = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
        c.ctx.textAlign = 'center';
        c.ctx.textBaseline = 'middle';
        c.ctx.fillText(t('chart.noData'), (from + to) / 2, (top + bottom) / 2);
      }
    }
    c.ctx.restore();
  }
};
// Lines hide their points, so a value between two gaps needs a visible dot.
function isolatedPoint(ctx) {
  const data = ctx.dataset.data, i = ctx.dataIndex;
  return data?.[i] != null && data[i - 1] == null && data[i + 1] == null ? 2.5 : 0;
}

function createChart() {
  const colors = seriesColors();
  Chart.defaults.font.family = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = colors.text;
  const line = (label, color) => ({
    label, data: [], borderColor: color, backgroundColor: areaFill(color), fill: 'origin',
    borderWidth: 1.75, tension: 0.35, cubicInterpolationMode: 'monotone',
    pointRadius: isolatedPoint, pointBackgroundColor: color, pointBorderWidth: 0,
    pointHitRadius: 14, pointHoverRadius: 4, pointHoverBorderWidth: 2,
    pointHoverBackgroundColor: '#0e121a', pointHoverBorderColor: color
  });
  chart = new Chart($('#traffic-chart'), {
    type: 'line',
    data: { labels: [], datasets: [line('blocked', colors.blocked), line('error', colors.error), line('allowed', colors.allowed)] },
    plugins: [gapBands, crosshair],
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 6 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(26, 32, 43, 0.96)', borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1,
          cornerRadius: 14, padding: { x: 14, y: 11 }, caretSize: 0, caretPadding: 12,
          titleColor: '#f2f5f9', bodyColor: 'rgba(226,233,242,0.85)',
          titleFont: { size: 12.5, weight: '600' }, bodyFont: { size: 12.5 }, titleMarginBottom: 7, bodySpacing: 5,
          usePointStyle: true, boxWidth: 7, boxHeight: 7, boxPadding: 5,
          itemSort: (a, b) => ['allowed', 'blocked', 'error'].indexOf(a.dataset.label) - ['allowed', 'blocked', 'error'].indexOf(b.dataset.label),
          callbacks: {
            title: items => chartTitles[items[0]?.dataIndex] || '',
            label: ctx => ` ${t('q.' + ctx.dataset.label)}: ${number(ctx.parsed.y)}`,
            labelColor: ctx => ({ borderColor: ctx.dataset.borderColor, backgroundColor: ctx.dataset.borderColor, borderWidth: 0, borderRadius: 4 })
          }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 7, maxRotation: 0, padding: 8, autoSkipPadding: 18 } },
        y: { beginAtZero: true, suggestedMax: 5, border: { display: false }, grid: { color: 'rgba(255,255,255,0.055)', drawTicks: false }, ticks: { precision: 0, maxTicksLimit: 5, padding: 12, callback: v => number(v) } }
      }
    }
  });
}

function renderStats(data, s) {
  $('#metric-total').textContent = number(data.total);
  $('#metric-blocked').textContent = number(data.blocked);
  $('#metric-rate').innerHTML = `${data.rate.toLocaleString(L(), { maximumFractionDigits: 1 })}<span class="unit">%</span>`;
  $('#rate-meter').style.width = `${Math.min(100, data.rate)}%`;
  $('#metric-domains').textContent = number(s.domainCount);
  $('#stats-range-label').textContent = days === 1 ? t('stats.today') : t('stats.days', { days });
  // Longer ranges are grouped into 3 h / 12 h buckets so the lines stay readable.
  const bucket = days === 1 ? 1 : days === 7 ? 3 : 12;
  const groups = chartGroups(data.history, bucket);
  const gaps = data.total === 0 ? [] : gapRanges(groups);
  const range = days === 1 ? t('chart.hourly') : t('chart.bucket', { bucket, days });
  $('#chart-sub').textContent = gaps.length ? t('chart.gaps', { range }) : range;
  $('#legend-allowed').textContent = number(data.total - data.blocked - data.errors);
  $('#legend-blocked').textContent = number(data.blocked);
  $('#legend-error').textContent = number(data.errors);

  if (window.Chart && changed('chart', [days, data.history, window.LeiseI18n.lang()])) {
    if (!chart) createChart();
    chartGaps = gaps;
    const hour = v => new Date(v).toLocaleTimeString(L(), { hour: '2-digit', minute: '2-digit' });
    chart.data.labels = groups.map(g => days === 1 ? hour(g.time) : t('chart.dayHour', { day: day(g.time), hour: new Date(g.time).getHours() }));
    chartTitles = groups.map(g => days === 1 ? t('chart.span', { from: hour(g.time), to: hour(g.time + 3600000) }) : t('chart.daySpan', { day: day(g.time), from: hour(g.time), to: hour(g.time + bucket * 3600000) }));
    // null leaves a gap in the line; hours without data are not "0 blocked".
    chart.data.datasets[0].data = groups.map(g => g.noData ? null : g.blocked);
    chart.data.datasets[1].data = groups.map(g => g.noData ? null : g.errors);
    chart.data.datasets[2].data = groups.map(g => g.noData ? null : g.total - g.blocked - g.errors);
    chart.update('none');
  }
  const noData = data.total === 0;
  $('#chart-empty').hidden = !noData;
  $('.chart-wrap').classList.toggle('is-empty', noData);

  if (changed('top', [data.top, window.LeiseI18n.lang()])) {
    const max = Math.max(1, ...data.top.map(r => r.count));
    $('#top-domains').innerHTML = data.top.length
      ? `<ol class="top-list">${data.top.map((r, i) => `<li class="top-item"><span class="top-rank">${i + 1}</span><span class="top-domain" title="${esc(r.domain)}">${esc(r.domain)}</span><span class="top-count">${number(r.count)}</span><span class="top-bar"><span data-share="${r.count / max}"></span></span></li>`).join('')}</ol>`
      : empty('block', t('top.empty'), t('top.emptyHint'));
    $$('#top-domains [data-share]').forEach(el => { el.style.width = `${Math.max(2, Number(el.dataset.share) * 100)}%`; });
  }
}

/* ---------- Query tables ---------- */
const STATUS = {
  blocked: ['is-blocked', 'block', 'q.blocked'],
  error: ['is-error', 'alert', 'q.error'],
  allowed: ['is-allowed', 'allow', 'q.allowed']
};
// Malware/phishing blocks carry "Phishing · <Liste>" as reason.
const threatOf = r => r.status === 'blocked' ? (/^(Phishing|Malware) · /.exec(r.reason || '') || [])[1] || null : null;
function queryRow(r, full) {
  const threat = threatOf(r);
  const [cls, symbol, labelKey] = threat ? ['is-threat', 'shield-alert', null] : STATUS[r.status] || STATUS.allowed;
  const label = threat || t(labelKey);
  const reason = te(r.reason);
  const detail = [r.domain, r.type, reason].filter(Boolean).join(' · ');
  const act = r.status === 'blocked'
    ? `<button class="btn btn-sm row-action" data-rule-domain="${esc(r.domain)}" data-rule-kind="white"${threat ? ` data-threat="${threat}"` : ''} aria-label="${esc(t('query.allowAria', { domain: r.domain }))}">${icon('allow')}${t('query.allow')}</button>`
    : `<button class="btn btn-sm row-action" data-rule-domain="${esc(r.domain)}" data-rule-kind="black" aria-label="${esc(t('query.blockAria', { domain: r.domain }))}">${icon('block')}${t('query.block')}</button>`;
  return `<tr data-id="${r.id}"><td class="cell-time" title="${esc(date(r.time))}">${time(r.time)}${full && new Date(r.time).toDateString() !== new Date().toDateString() ? `<small>${day(r.time)}</small>` : ''}</td>`
    + `<td class="cell-domain" title="${esc(detail)}">${esc(r.domain)}${full && r.type ? `<span class="domain-type">${esc(r.type)}</span>` : ''}</td>`
    + `<td><span class="status-text ${cls}" title="${esc(reason || label)}">${icon(symbol, 'icon-sm')}${label}</span></td>`
    + `${full ? `<td class="cell-action">${act}</td>` : ''}</tr>`;
}
function table(rows, full = false) {
  if (!rows.length) {
    return full
      ? empty('search', t('queries.none'), t('queries.noneHint'))
      : empty('activity', t('recent.none'), t('recent.noneHint'));
  }
  return `<table class="data-table"><colgroup><col class="col-time"><col><col class="col-status">${full ? '<col class="col-action">' : ''}</colgroup>`
    + `<thead><tr><th scope="col">${t('table.time')}</th><th scope="col">${t('table.domain')}</th><th scope="col">${t('table.status')}</th>${full ? `<th scope="col"><span class="sr-only">${t('table.action')}</span></th>` : ''}</tr></thead>`
    + `<tbody>${rows.map(r => queryRow(r, full)).join('')}</tbody></table>`;
}

let logTopId = null, newCount = 0;
async function loadQueries({ reset = false } = {}) {
  const rows = await api.call('queries', { search: $('#query-search').value, status: queryStatus });
  const box = $('#query-table');
  const body = box.querySelector('tbody');
  if (reset || !body || !rows.length || logTopId === null) {
    box.innerHTML = table(rows, true);
    logTopId = rows[0]?.id ?? null;
    newCount = 0;
    updateNewPill();
    return;
  }
  const fresh = rows.filter(r => r.id > logTopId);
  if (!fresh.length) return;
  logTopId = rows[0].id;
  // Insert only the new rows. While the user reads further down, the view is
  // shifted by exactly the inserted height so the visible rows stay in place.
  const reading = window.scrollY > 40;
  const anchor = body.rows[0];
  const before = anchor.getBoundingClientRect().top;
  body.insertAdjacentHTML('afterbegin', fresh.map(r => queryRow(r, true)).join(''));
  while (body.rows.length > 200) body.deleteRow(-1);
  if (reading) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
  if (!reading && fresh.length <= 12 && document.documentElement.dataset.motion !== 'reduce') {
    [...body.rows].slice(0, fresh.length).forEach(row => row.classList.add('is-new'));
  }
  if (reading) { newCount += fresh.length; updateNewPill(); }
}
function updateNewPill() {
  const pill = $('#new-queries');
  pill.hidden = newCount === 0 || page !== 'queries';
  $('#new-queries-text').textContent = newCount === 1 ? t('queries.newOne') : t('queries.newMany', { count: number(newCount) });
}

/* ---------- Filter lists ---------- */
function filterCard(l) {
  const state = l.busy
    ? `<span class="status-text tone-info"><span class="spinner"></span>${t('list.updating')}</span>`
    : l.error ? `<span class="status-text tone-danger">${icon('alert')}${t('list.failed')}</span>`
    : l.enabled ? `<span class="status-text tone-success"><span class="dot"></span>${t('list.active')}</span>`
    : `<span class="status-text tone-neutral"><span class="dot"></span>${t('list.off')}</span>`;
  const coverage = l.rules > 0
    ? t('list.coverage', { used: number(l.used), rules: number(l.rules), pct: Math.round(100 * l.used / l.rules), skipped: number(l.skipped) })
    : (l.skipped ? t('list.skippedOnly', { skipped: number(l.skipped) }) : '');
  const detail = (l.error ? `<div class="callout callout-danger" role="alert">${icon('alert')}<span class="callout-text">${esc(te(l.error))}</span></div>` : '')
    + (coverage ? `<p class="skipped-note">${coverage}</p>` : '');
  return `<article class="filter-card${l.enabled ? '' : ' is-off'}" aria-label="${esc(l.name)}">
    <div class="filter-icon">${icon('layers')}</div>
    <div class="filter-main"><div class="filter-title"><h3 title="${esc(l.name)}">${esc(l.name)}</h3></div><div class="filter-sub">${l.preset ? `<span class="tag${l.category === 'ads' ? '' : ' tag-danger'}">${esc(t({ malware: 'list.cat.malware', phishing: 'list.cat.phishing' }[l.category] || 'list.cat.ads'))}</span>` : `<span class="tag">${t('list.own')}</span>`}<span class="filter-url" title="${esc(l.url)}">${esc(l.url.replace(/^https:\/\//, ''))}</span></div></div>
    <div class="filter-count"><strong>${number(l.count)}</strong><span>${t('list.domains')}</span></div>
    <div class="filter-state">${state}<span class="sub">${l.updated ? t('list.updated', { date: date(l.updated) }) : t('list.notLoaded')}</span></div>
    <div class="filter-actions">
      <button class="btn btn-sm btn-update" data-list-update="${esc(l.id)}" ${l.busy ? 'disabled aria-busy="true"' : ''} aria-label="${esc(t('list.updateAria', { name: l.name }))}">${l.busy ? '<span class="spinner"></span>' : icon('refresh')}<span class="label">${l.busy ? t('list.loading') : t('list.update')}</span></button>
      ${l.preset ? '<span class="btn-slot" aria-hidden="true"></span>' : `<button class="btn btn-sm btn-danger btn-icon-sm" data-list-remove="${esc(l.id)}" ${l.busy ? 'disabled' : ''} aria-label="${esc(t('list.removeAria', { name: l.name }))}" title="${t('list.remove')}">${icon('trash')}</button>`}
    </div>
    <button class="switch switch-sm filter-toggle" role="switch" aria-checked="${Boolean(l.enabled)}" aria-label="${esc(t('list.useAria', { name: l.name }))}" data-list-toggle="${esc(l.id)}"><span class="switch-track-fill"></span><span class="switch-knob"><span class="spinner"></span></span></button>
    <div class="filter-detail">${detail}</div>
  </article>`;
}
function renderFilters(lists) {
  if (!changed('lists', [lists, window.LeiseI18n.lang()])) return;
  const focused = document.activeElement?.closest('.filter-card') && ['listToggle', 'listUpdate', 'listRemove'].find(k => document.activeElement.dataset[k]);
  const focusId = focused && document.activeElement.dataset[focused];
  $('#filter-lists').innerHTML = lists.map(filterCard).join('');
  if (focusId) $(`[data-${focused.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}="${CSS.escape(focusId)}"]`)?.focus();
}

function showFormError(form, message) {
  const box = form.querySelector('.field-error');
  box.hidden = !message;
  box.innerHTML = message ? `${icon('alert')}<span>${esc(te(message))}</span>` : '';
}

/* ---------- Allowed / blocked domains ---------- */
// Texts come from i18n.js; keys are 'rules.<kind>.<field>'.
const RULES = {
  white: { symbol: 'allow', tone: 'tone-success', nav: 'nav.allow' },
  black: { symbol: 'block', tone: 'tone-danger', nav: 'nav.block' }
};
const ruleText = (kind, field) => t(`rules.${kind}.${field}`);
function initRules(kind) {
  const r = RULES[kind];
  const typed = $(`#${kind}-content input[name="domain"]`)?.value || '';
  const searched = $(`#search-${kind}`)?.value || '';
  $(`#${kind}-content`).innerHTML = `
    <article class="content panel form-panel ${r.tone}">
      <header class="rule-intro"><span class="rule-symbol">${icon(r.symbol)}</span><div><h2 class="panel-title">${ruleText(kind, 'title')}</h2><p class="panel-sub">${ruleText(kind, 'intro')}</p></div></header>
      <form class="form-grid" id="add-${kind}" novalidate>
        <label class="form-label grow">${t('rules.domain')}<span class="field">${icon('globe')}<input name="domain" required maxlength="253" placeholder="${esc(t('rules.placeholder'))}" autocomplete="off" spellcheck="false" aria-describedby="hint-${kind} error-${kind}"></span></label>
        <button type="submit" class="btn btn-accent">${icon('plus')}<span>${ruleText(kind, 'button')}</span></button>
        <p class="field-error form-error" id="error-${kind}" role="alert" hidden></p>
      </form>
      <p class="field-hint" id="hint-${kind}">${esc(t('rules.hint'))}</p>
    </article>
    <section class="content panel rule-panel ${r.tone}" aria-label="${esc(t(r.nav))}">
      <header class="rule-toolbar">
        <label class="field field-pill">${icon('search')}<input id="search-${kind}" type="search" placeholder="${esc(t('rules.searchPh'))}" aria-label="${esc(ruleText(kind, 'search'))}" autocomplete="off" spellcheck="false"></label>
        <span class="rule-count num" id="count-${kind}" aria-live="polite"></span>
      </header>
      <div class="rule-list" id="rules-${kind}"></div>
    </section>`;
  const form = $(`#add-${kind}`);
  form.elements.domain.value = typed;
  $(`#search-${kind}`).value = searched;
  form.addEventListener('submit', e => {
    e.preventDefault();
    const input = form.elements.domain;
    if (!input.value.trim()) { showFormError(form, t('rules.required')); input.closest('.field').classList.add('is-invalid'); input.focus(); return; }
    quietly(action(e.submitter, async () => {
      try {
        lastAdded[kind] = await api.call('rule:add', { kind, domain: input.value });
      } catch (err) {
        showFormError(form, err.message);
        input.closest('.field').classList.add('is-invalid');
        throw err;
      }
      input.value = '';
      showFormError(form, '');
      input.closest('.field').classList.remove('is-invalid');
    }, ruleText(kind, 'done')));
  });
  form.elements.domain.addEventListener('input', () => { form.elements.domain.closest('.field').classList.remove('is-invalid'); showFormError(form, ''); });
  $(`#search-${kind}`).addEventListener('input', () => renderRules(kind, true));
}
function renderRules(kind, force = false) {
  const search = $(`#search-${kind}`).value.trim().toLowerCase();
  const all = snapshot[kind];
  if (!changed('rules-' + kind, [all, search]) && !force && !lastAdded[kind]) return;
  const rows = all.filter(d => d.includes(search));
  $(`#count-${kind}`).textContent = search ? t('rules.countFiltered', { shown: number(rows.length), total: number(all.length) })
    : all.length === 1 ? t('rules.countOne') : t('rules.countMany', { count: number(all.length) });
  const focusIndex = [...$$(`#rules-${kind} [data-remove-domain]`)].indexOf(document.activeElement);
  const r = RULES[kind];
  $(`#rules-${kind}`).innerHTML = rows.length
    ? rows.map(d => `<div class="rule-item${d === lastAdded[kind] ? ' is-new' : ''}">${icon(r.symbol)}<span class="rule-domain" title="${esc(d)}">${esc(d)}<small>${t('rules.sub')}</small></span><button class="btn btn-sm btn-quiet" data-remove-domain="${esc(d)}" data-kind="${kind}" aria-label="${esc(t('rules.removeAria', { domain: d }))}">${icon('close')}${t('rules.remove')}</button></div>`).join('')
    : search ? empty('search', t('rules.noMatch'), t('rules.noMatchHint'))
    : empty(r.symbol, ruleText(kind, 'none'), t('rules.emptyHint'));
  lastAdded[kind] = null;
  if (focusIndex >= 0) {
    const buttons = $$(`#rules-${kind} [data-remove-domain]`);
    (buttons[Math.min(focusIndex, buttons.length - 1)] || $(`#search-${kind}`)).focus();
  }
}

/* ---------- Refresh loop ---------- */
let refreshing = false, refreshAgain = false;
async function refresh() {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    snapshot = await api.call('snapshot', { days });
    renderStatus(snapshot.status);
    renderStats(snapshot.stats, snapshot.status);
    renderFilters(snapshot.lists);
    renderRules('white');
    renderRules('black');
    const recent = (await api.call('queries')).slice(0, 5);
    if (changed('recent', recent.map(r => r.id))) $('#recent-queries').innerHTML = table(recent);
  } finally {
    // Also after an error: the toast explains it, the skeletons must not shimmer forever.
    document.body.classList.remove('is-loading');
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; scheduleRefresh(120); }
  }
}

function modeAction(button, kind) {
  pendingMode = kind;
  if (['5', '30'].includes(kind)) pauseChoice = kind;
  if (snapshot) renderStatus({ ...snapshot.status, busy: true });
  const done = kind === 'active' ? t('toast.on') : kind === 'off' ? t('toast.off') : t('toast.paused');
  return quietly(action(button, () => api.call('mode', { kind }), done)).finally(() => {
    pendingMode = null;
    if (snapshot) renderStatus(snapshot.status);
  });
}

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mode) modeAction(b, b.dataset.mode);
  if (b.dataset.days) {
    days = Number(b.dataset.days);
    press($('#range-group'), '[data-days]', x => x === b);
    refresh().catch(err => toast(err.message, true));
  }
  if (b.dataset.status) {
    queryStatus = b.dataset.status;
    press($('#query-status'), '[data-status]', x => x === b);
    loadQueries({ reset: true }).catch(err => toast(err.message, true));
  }
  if (b.dataset.upstream) quietly(action(b, () => api.call('upstream', { value: b.dataset.upstream }), t('toast.upstream')));
  if (b.dataset.value && b.closest('[data-pref]')) {
    prefs.set(b.closest('[data-pref]').dataset.pref, b.dataset.value);
  }
  if (b.dataset.lang) {
    window.LeiseI18n.setLang(b.dataset.lang);
    quietly(api.call('lang:set', { lang: window.LeiseI18n.lang() }));
  }
  if (b.dataset.listToggle) {
    const l = snapshot.lists.find(x => x.id === b.dataset.listToggle);
    b.setAttribute('aria-checked', String(!l.enabled));
    quietly(action(b, () => api.call('list:toggle', { id: l.id, enabled: !l.enabled }), t(l.enabled ? 'toast.listOff' : 'toast.listOn', { name: l.name })));
  }
  if (b.dataset.listUpdate) {
    const l = snapshot.lists.find(x => x.id === b.dataset.listUpdate);
    renderFilters(snapshot.lists.map(x => x.id === l.id ? { ...x, busy: true } : x));
    quietly(action(null, () => api.call('list:update', { id: l.id }), t('toast.listUpdated', { name: l.name })));
  }
  if (b.dataset.listRemove) {
    const l = snapshot.lists.find(x => x.id === b.dataset.listRemove);
    confirmDialog({ title: t('dialog.removeList.title'), text: t('dialog.removeList.text', { name: l.name }), confirm: t('list.remove') })
      .then(ok => ok && quietly(action(b, () => api.call('list:remove', { id: l.id }), t('toast.listRemoved'))));
  }
  if (b.dataset.preview) quietly(api.call('blockpage:preview', { category: b.dataset.preview }).catch(err => { toast(err.message, true); throw err; }));
  if (b.dataset.help) quietly(api.call('help:open', { id: b.dataset.help }).catch(err => { toast(err.message, true); throw err; }));
  if (b.dataset.ruleDomain) allowOrBlock(b);
  if (b.dataset.removeDomain) quietly(action(b, () => api.call('rule:remove', { kind: b.dataset.kind, domain: b.dataset.removeDomain }), t('toast.ruleRemoved')));
});

// Switching the language re-renders everything that was built from texts.
document.documentElement.addEventListener('leise-lang', () => {
  press($('#language'), '[data-lang]', x => x.dataset.lang === window.LeiseI18n.lang());
  rendered.clear();
  initRules('white');
  initRules('black');
  $('#feed-toggle').innerHTML = feed ? `${icon('pause')}<span>${t('feed.pause')}</span>` : `${icon('play')}<span>${t('feed.resume')}</span>`;
  $('#feed-label-text').textContent = feed ? t('live') : t('feed.paused');
  $('#today').textContent = new Date().toLocaleDateString(L(), { weekday: 'long', day: 'numeric', month: 'long' });
  route();
  if (snapshot) {
    renderStatus(snapshot.status);
    renderStats(snapshot.stats, snapshot.status);
    renderFilters(snapshot.lists);
    renderRules('white', true);
    renderRules('black', true);
    updateNewPill();
  }
  refresh().catch(e => toast(e.message, true));
  if (page === 'queries') loadQueries({ reset: true }).catch(e => toast(e.message, true));
});

// Allowing a known malware/phishing domain needs an explicit second confirmation.
async function allowOrBlock(b) {
  const kind = b.dataset.ruleKind;
  if (b.dataset.threat && !(await confirmDialog({ title: t('dialog.threat.title', { threat: b.dataset.threat }), symbol: 'shield-alert',
    text: t('dialog.threat.text', { domain: b.dataset.ruleDomain, threat: b.dataset.threat }), confirm: t('dialog.threat.confirm') }))) return;
  quietly(action(b, async () => { lastAdded[kind] = await api.call('rule:add', { kind, domain: b.dataset.ruleDomain }); },
    t(kind === 'white' ? 'toast.allowed' : 'toast.blocked', { domain: b.dataset.ruleDomain })));
}

// Generic confirmation dialog (glass); resolves true only on the confirm button.
function confirmDialog({ title, text, confirm, symbol = 'trash', danger = true, alt = '', acknowledge = '' }) {
  return new Promise(resolve => {
    const dialog = $('#confirm-dialog'), ok = $('#confirm-delete'), other = $('#confirm-alt');
    const ack = $('#confirm-ack'), ackInput = $('#confirm-ack-input');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-symbol').innerHTML = icon(symbol);
    ok.className = `btn ${danger ? 'btn-danger-solid' : 'btn-accent'}`;
    ok.innerHTML = `${icon(symbol)}<span>${esc(confirm)}</span>`;
    other.hidden = !alt;
    other.textContent = alt || '';
    ack.hidden = !acknowledge;
    $('#confirm-ack-text').textContent = acknowledge || '';
    ackInput.checked = false;
    ok.disabled = !!acknowledge;
    ackInput.onchange = () => { ok.disabled = acknowledge ? !ackInput.checked : false; };
    let result = false;
    ok.onclick = () => { if (acknowledge && !ackInput.checked) return; result = true; dialog.close(); };
    other.onclick = () => { result = 'alt'; dialog.close(); };
    $('#confirm-cancel').onclick = () => dialog.close();
    dialog.onclose = () => { other.hidden = true; ack.hidden = true; ok.disabled = false; resolve(result); };
    dialog.showModal();
  });
}

// Block page settings: server status and the optional https certificate.
function renderBlockPage(s) {
  const b = s.blockPage;
  const toggle = $('#blockpage-https-toggle');
  if (!b) { $('#blockpage-status-text').textContent = t('bp.unavailable'); toggle.disabled = true; return; }
  const [tone, text] = b.running ? ['success', t('bp.running', { address: b.address })] : ['warning', te(b.error) || t('bp.notRunning')];
  $('#blockpage-status').className = `approval-status status-text tone-${tone}`;
  $('#blockpage-status-text').textContent = text;
  const h = b.https;
  toggle.setAttribute('aria-checked', String(h.enabled || h.installed));
  toggle.dataset.state = h.busy ? 'pending' : '';
  toggle.disabled = h.busy || !b.running;
  const until = h.expires ? new Date(h.expires).toLocaleDateString(L()) : '';
  const [htone, htext] = h.busy ? ['info', t('bp.waiting')]
    : h.error ? ['warning', te(h.error)]
    : h.enabled ? ['success', t('bp.httpsOn', { date: until })]
    : ['neutral', t('bp.httpsOff')];
  $('#blockpage-https-status').className = `approval-status status-text tone-${htone}`;
  $('#blockpage-https-status-text').textContent = htext;
  const box = $('#blockpage-conflict');
  const conflict = b.conflict || h.conflict;
  if (box) {
    box.hidden = !conflict;
    if (conflict) {
      const title = $('#blockpage-conflict-title');
      const steps = $('#blockpage-conflict-steps');
      if (title) title.textContent = te(conflict.summary);
      if (steps) steps.innerHTML = (conflict.steps || []).map(step => `<li>${esc(te(step))}</li>`).join('');
    }
  }
  document.querySelectorAll('[data-preview]').forEach(x => { x.disabled = !b.running; });
}

$('#blockpage-https-toggle').addEventListener('click', async e => {
  const toggle = e.currentTarget;
  const enable = toggle.getAttribute('aria-checked') !== 'true';
  const ok = enable
    ? await confirmDialog({ title: t('dialog.cert.title'), symbol: 'lock', danger: false, confirm: t('dialog.cert.confirm'),
        acknowledge: t('dialog.cert.ack'), text: t('dialog.cert.text') })
    : await confirmDialog({ title: t('dialog.uncert.title'), confirm: t('dialog.uncert.confirm'), text: t('dialog.uncert.text') });
  if (ok) quietly(action(toggle, () => api.call('blockpage:https', { enabled: enable }), enable ? t('toast.httpsOn') : t('toast.certRemoved')));
});

$('#main-toggle').addEventListener('click', e => modeAction(e.currentTarget, snapshot?.status.active ? 'off' : 'active'));
$('#setup-button').addEventListener('click', e => modeAction(e.currentTarget, e.currentTarget.dataset.target || 'active'));
$('#update-all').addEventListener('click', e => quietly(action(e.currentTarget, async () => {
  const results = await api.call('list:updateAll');
  const failed = results.filter(r => !r.ok);
  toast(failed.length === 1 ? t('toast.updateFailedOne') : failed.length ? t('toast.updateFailedMany', { count: failed.length }) : t('toast.updatedAll'), !!failed.length);
})));

$('#add-list').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const { name, url } = form.elements;
  [name, url].forEach(i => i.closest('.field').classList.remove('is-invalid'));
  const invalid = !name.value.trim() ? [name, t('toast.listNameRequired')]
    : !/^https:\/\/\S+\.\S+/i.test(url.value.trim()) ? [url, t('toast.listUrlRequired')] : null;
  if (invalid) { invalid[0].closest('.field').classList.add('is-invalid'); showFormError(form, invalid[1]); invalid[0].focus(); return; }
  quietly(action(e.submitter, async () => {
    try { await api.call('list:add', { name: name.value, url: url.value.trim() }); }
    catch (err) { showFormError(form, err.message); throw err; }
    form.reset();
    showFormError(form, '');
  }, t('toast.listAdded')));
});
$('#add-list').addEventListener('input', e => { e.target.closest('.field')?.classList.remove('is-invalid'); });
$('#add-list').addEventListener('reset', e => { e.target.querySelectorAll('.is-invalid').forEach(f => f.classList.remove('is-invalid')); showFormError(e.target, ''); });

$('#autoupdate-toggle').addEventListener('click', e => {
  const enabled = e.currentTarget.getAttribute('aria-checked') !== 'true';
  e.currentTarget.setAttribute('aria-checked', String(enabled));
  quietly(action(e.currentTarget, () => api.call('autoupdate:set', { enabled }), enabled ? t('toast.autoOn') : t('toast.autoOff')));
});
$('#autostart-toggle').addEventListener('click', e => {
  const enabled = e.currentTarget.getAttribute('aria-checked') !== 'true';
  e.currentTarget.setAttribute('aria-checked', String(enabled));
  quietly(action(e.currentTarget, () => api.call('autostart:set', { enabled }), enabled ? t('toast.startOn') : t('toast.startOff')));
});
$('#approval-toggle').addEventListener('click', e => {
  const remember = e.currentTarget.getAttribute('aria-checked') !== 'true';
  e.currentTarget.setAttribute('aria-checked', String(remember));
  quietly(action(e.currentTarget, () => api.call('approval:set', { remember }), remember ? t('toast.approvalOn') : t('toast.approvalOff')));
});
$('#check-dns').addEventListener('click', e => quietly(action(e.currentTarget, () => api.call('dns:inspect'), t('toast.dnsChecked'))));
$('#check-update').addEventListener('click', e => quietly(action(e.currentTarget, async () => {
  const info = await api.call('update:check');
  toast(info.updateAvailable ? t('toast.updateAvailable', { version: info.latest }) : t('toast.upToDate'));
})));
$('#open-update')?.addEventListener('click', () => quietly(api.call('update:open').catch(err => { toast(err.message, true); throw err; })));
$('#export-rules')?.addEventListener('click', e => quietly(action(e.currentTarget, async () => {
  const result = await api.call('rules:export');
  if (!result.canceled) toast(t('toast.rulesSaved', { count: number(result.count) }));
})));
$('#import-rules')?.addEventListener('click', async () => {
  try {
    const picked = await api.call('rules:pick');
    if (picked.canceled) return;
    const choice = await confirmDialog({
      title: t('dialog.import.title'), symbol: 'list', danger: false, confirm: t('dialog.merge'), alt: t('dialog.replace'),
      text: t('dialog.import.text', { white: number(picked.white), black: number(picked.black) })
    });
    if (!choice) return;
    const result = await api.call('rules:apply', { mode: choice === 'alt' ? 'replace' : 'merge' });
    toast(result.mode === 'replace' ? t('toast.rulesReplaced') : t('toast.rulesMerged'));
    await refresh();
  } catch (err) { toast(err.message, true); }
});
$('#quit-app').addEventListener('click', () => api.call('app:quit'));
// The encrypted-DNS hint can be closed; "Gut zu wissen" in the settings brings it back.
const BYPASS_KEY = 'leise.bypassHintHidden';
function showBypassHint(visible) {
  $('.bypass-hint').hidden = !visible;
  $('#bypass-show').hidden = visible;
}
$('#bypass-close').addEventListener('click', () => {
  try { localStorage.setItem(BYPASS_KEY, '1'); } catch { /* still hidden for this session */ }
  showBypassHint(false);
  toast(t('toast.hintHidden'));
});
$('#bypass-show').addEventListener('click', () => {
  try { localStorage.removeItem(BYPASS_KEY); } catch { /* ignore */ }
  showBypassHint(true);
  toast(t('toast.hintShown'));
});
try { showBypassHint(localStorage.getItem(BYPASS_KEY) !== '1'); } catch { showBypassHint(true); }
$('#query-search').addEventListener('input', () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => loadQueries({ reset: true }).catch(e => toast(e.message, true)), 150);
});
async function exportQueries(format) {
  const result = await api.call('queries:export', { format, search: $('#query-search').value, status: queryStatus });
  if (!result.canceled) toast(t('toast.exported', { count: number(result.count), format: format.toUpperCase() }));
}
$('#export-csv')?.addEventListener('click', e => quietly(action(e.currentTarget, () => exportQueries('csv'))));
$('#export-json')?.addEventListener('click', e => quietly(action(e.currentTarget, () => exportQueries('json'))));
$('#feed-toggle').addEventListener('click', e => {
  feed = !feed;
  const b = e.currentTarget;
  b.setAttribute('aria-pressed', String(!feed));
  b.innerHTML = feed ? `${icon('pause')}<span>${t('feed.pause')}</span>` : `${icon('play')}<span>${t('feed.resume')}</span>`;
  $('#feed-label').classList.toggle('is-paused', !feed);
  $('#feed-label-text').textContent = feed ? t('live') : t('feed.paused');
  if (feed) loadQueries({ reset: true }).catch(err => toast(err.message, true));
});
$('#new-queries').addEventListener('click', () => {
  newCount = 0;
  updateNewPill();
  window.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth' });
});

window.addEventListener('scroll', () => {
  document.documentElement.classList.toggle('is-scrolled', window.scrollY > 4);
  if (window.scrollY < 40 && newCount) { newCount = 0; updateNewPill(); }
}, { passive: true });
window.addEventListener('resize', () => { syncNav(); syncAllThumbs(); measureLayout(); });
document.documentElement.addEventListener('prefs-changed', () => {
  $$('[data-pref]').forEach(g => press(g, '[data-value]', b => b.dataset.value === prefs.get(g.dataset.pref)));
});

api.onChange(() => scheduleRefresh(120));
api.onQuery(() => {
  scheduleRefresh();
  if (feed && page === 'queries' && !liveTimer) liveTimer = setTimeout(() => { liveTimer = null; loadQueries().catch(e => toast(e.message, true)); }, 250);
});
// Keep the remaining pause time current.
setInterval(() => { if (snapshot?.status.mode.kind === 'timed') renderStatus(snapshot.status); }, 15000);

/* ---------- Start ---------- */
Icons.hydrate();
prefs.watch();
window.LeiseI18n.apply();
press($('#language'), '[data-lang]', b => b.dataset.lang === window.LeiseI18n.lang());
$('#today').textContent = new Date().toLocaleDateString(L(), { weekday: 'long', day: 'numeric', month: 'long' });
// The tray menu and the block page follow the language chosen here.
quietly(api.call('lang:set', { lang: window.LeiseI18n.lang() }));
initRules('white');
initRules('black');
window.addEventListener('hashchange', route);
new ResizeObserver(() => { measureLayout(); syncAllThumbs(); }).observe($('#topbar'));
route();
refresh().catch(e => toast(e.message, true));
