// Shared by dashboard and tray popup: status wording and display preferences.
(function (global) {
  if (typeof module !== 'undefined') { try { require('./i18n'); } catch { /* loaded by the page in the browser */ } }
  const tr = (key, vars) => global.LeiseI18n ? global.LeiseI18n.t(key, vars) : key;
  const locale = () => global.LeiseI18n?.lang() === 'en' ? 'en-GB' : 'de-DE';
  const UPSTREAM_NAMES = { cloudflare: 'Cloudflare', google: 'Google', quad9: 'Quad9' };
  const clock = t => new Date(t).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

  function remaining(until, now) {
    const minutes = Math.max(1, Math.ceil((until - now) / 60000));
    return minutes === 1 ? tr('time.oneMinute') : tr('time.minutes', { minutes });
  }

  // Maps the service status to one of the visual states of the protection card.
  // `pending` is the mode this window requested, if any ('active', 'off', '5', …).
  function describeStatus(s, { pending = null, now = Date.now() } = {}) {
    const mode = s.mode?.kind || 'active';
    const dns = s.dns || {};
    const provider = UPSTREAM_NAMES[s.upstream] || 'Cloudflare';
    let connection;
    if (!s.running) connection = { tone: 'danger', text: tr('conn.down') };
    else if (dns.configured) connection = { tone: 'success', text: tr('conn.up', { provider }) };
    else if (dns.partial) connection = { tone: 'warning', text: tr('conn.partial') };
    else connection = { tone: 'neutral', text: tr('conn.ready') };

    const base = { connection, error: s.error || '', toggle: s.active ? 'on' : 'off', action: null };

    if (s.busy) {
      const turningOn = pending ? pending === 'active' : !s.active;
      if (turningOn && !s.helper) {
        return { ...base, key: 'approval', tone: 'info', icon: 'lock', toggle: 'pending', pill: tr('status.approval.pill'),
          kicker: tr('status.approval.kicker'), title: tr('status.approval.title'),
          description: tr('status.approval.desc')
            + (s.approval?.remember && s.approval.task !== 'registered' ? tr('status.approval.remember') : '') };
      }
      if (turningOn) {
        return { ...base, key: 'activating', tone: 'info', icon: 'shield', toggle: 'pending', pill: tr('status.activating.pill'),
          kicker: tr('status.activating.kicker'), title: tr('status.activating.title'),
          description: tr('status.activating.desc') };
      }
      return { ...base, key: 'deactivating', tone: 'info', icon: 'shield', toggle: 'pending', pill: tr('status.deactivating.pill'),
        kicker: tr('status.deactivating.kicker'), title: tr('status.deactivating.title'),
        description: tr('status.deactivating.desc') };
    }

    if (!s.running) {
      return { ...base, key: 'unreachable', tone: 'danger', icon: 'alert', pill: tr('status.unreachable.pill'),
        kicker: tr('status.unreachable.kicker'), title: tr('status.unreachable.title'),
        description: tr('status.unreachable.desc'),
        action: { label: tr('status.unreachable.action'), mode: 'active', icon: 'refresh' } };
    }

    if (s.active) {
      return { ...base, key: 'active', tone: 'success', icon: 'shield-check', pill: tr('status.active.pill'),
        kicker: tr('status.active.kicker'), title: tr('status.active.title'),
        description: tr('status.active.desc') };
    }

    if (s.error) {
      const setup = mode === 'active';
      return { ...base, key: 'failed', tone: 'danger', icon: 'shield-alert', pill: tr('status.failed.pill'),
        kicker: setup ? tr('status.failed.setupKicker') : tr('status.failed.resetKicker'),
        title: setup ? tr('status.failed.setupTitle') : tr('status.failed.resetTitle'),
        description: setup ? tr('status.failed.setupDesc') : tr('status.failed.resetDesc'),
        action: setup ? { label: tr('status.failed.retry'), mode: 'active', icon: 'refresh' } : { label: tr('status.failed.on'), mode: 'active', icon: 'power' } };
    }

    if (mode === 'timed') {
      return { ...base, key: 'paused-timed', tone: 'warning', icon: 'shield-pause', pill: tr('status.timed.pill'),
        kicker: tr('status.timed.kicker'), title: tr('status.timed.title', { time: clock(s.mode.until) }),
        description: tr('status.timed.desc', { remaining: remaining(s.mode.until, now) }),
        action: { label: tr('status.timed.action'), mode: 'active', icon: 'play' } };
    }
    if (mode === 'restart') {
      return { ...base, key: 'paused-restart', tone: 'warning', icon: 'shield-pause', pill: tr('status.restart.pill'),
        kicker: tr('status.restart.kicker'), title: tr('status.restart.title'),
        description: tr('status.restart.desc'),
        action: { label: tr('status.timed.action'), mode: 'active', icon: 'play' } };
    }
    if (mode === 'off') {
      return { ...base, key: 'off', tone: 'neutral', icon: 'shield-off', pill: tr('status.off.pill'),
        kicker: tr('status.off.kicker'), title: tr('status.off.title'),
        description: tr('status.off.desc'),
        action: { label: tr('status.off.action'), mode: 'active', icon: 'power' } };
    }

    return { ...base, key: 'setup', tone: 'neutral', icon: 'shield', pill: tr('status.setup.pill'),
      kicker: tr('status.setup.kicker'), title: tr('status.setup.title'),
      description: dns.partial ? tr('status.setup.partial') : tr('status.setup.desc'),
      action: { label: tr('status.setup.action'), mode: 'active', icon: 'arrow' } };
  }

  // Display preferences are per device and purely visual, so localStorage is enough.
  const PREFS = { transparency: ['auto', 'reduce'], motion: ['auto', 'reduce'], refraction: ['on', 'off'] };
  const read = key => {
    try { const v = localStorage.getItem('leise.' + key); return PREFS[key].includes(v) ? v : PREFS[key][0]; } catch { return PREFS[key][0]; }
  };
  const prefs = {
    get: read,
    set(key, value) {
      if (!PREFS[key]?.includes(value)) return;
      try { localStorage.setItem('leise.' + key, value); } catch {}
      prefs.apply();
    },
    apply() {
      if (typeof document === 'undefined') return;
      const media = q => global.matchMedia?.(q).matches;
      const root = document.documentElement;
      const transparency = read('transparency') === 'reduce' || media('(prefers-reduced-transparency: reduce)') ? 'reduce' : 'full';
      const motion = read('motion') === 'reduce' || media('(prefers-reduced-motion: reduce)') ? 'reduce' : 'full';
      root.dataset.transparency = transparency;
      root.dataset.motion = motion;
      root.dataset.refraction = transparency === 'reduce' || read('refraction') === 'off' ? 'off' : 'on';
      root.dispatchEvent(new CustomEvent('prefs-changed'));
    },
    watch() {
      if (typeof document === 'undefined') return;
      for (const q of ['(prefers-reduced-transparency: reduce)', '(prefers-reduced-motion: reduce)']) global.matchMedia?.(q).addEventListener?.('change', prefs.apply);
      global.addEventListener('storage', e => { if (e.key?.startsWith('leise.')) prefs.apply(); });
      prefs.apply();
    }
  };

  // Groups hourly history for the chart. A group without any recorded hour stays marked as
  // noData, so the chart shows a gap instead of pretending nothing was blocked.
  function chartGroups(history, bucket = 1) {
    const groups = [];
    for (let i = 0; i < history.length; i += bucket) {
      const slice = history.slice(i, i + bucket);
      const sum = key => slice.reduce((n, r) => n + r[key], 0);
      groups.push({ time: slice[0].time, total: sum('total'), blocked: sum('blocked'), errors: sum('errors'), noData: slice.every(r => r.noData) });
    }
    return groups;
  }
  // Index ranges [first, last] of consecutive groups without data.
  function gapRanges(groups) {
    const ranges = [];
    groups.forEach((g, i) => {
      if (!g.noData) return;
      const open = ranges[ranges.length - 1];
      if (open && open[1] === i - 1) open[1] = i; else ranges.push([i, i]);
    });
    return ranges;
  }

  const api = { describeStatus, prefs, UPSTREAM_NAMES, chartGroups, gapRanges };
  global.LeiseUI = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
