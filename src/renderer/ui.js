// Shared by dashboard and tray popup: status wording and display preferences.
(function (global) {
  const UPSTREAM_NAMES = { cloudflare: 'Cloudflare', google: 'Google', quad9: 'Quad9' };
  const clock = t => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  function remaining(until, now) {
    const minutes = Math.max(1, Math.ceil((until - now) / 60000));
    return minutes === 1 ? 'Noch eine Minute' : `Noch ${minutes} Minuten`;
  }

  // Maps the service status to one of the visual states of the protection card.
  // `pending` is the mode this window requested, if any ('active', 'off', '5', …).
  function describeStatus(s, { pending = null, now = Date.now() } = {}) {
    const mode = s.mode?.kind || 'active';
    const dns = s.dns || {};
    const provider = UPSTREAM_NAMES[s.upstream] || 'Cloudflare';
    let connection;
    if (!s.running) connection = { tone: 'danger', text: 'Lokaler DNS-Dienst nicht erreichbar' };
    else if (dns.configured) connection = { tone: 'success', text: `Windows-DNS verbunden · ${provider} als Anbieter` };
    else if (dns.partial) connection = { tone: 'warning', text: 'Windows-DNS nur teilweise verbunden' };
    else connection = { tone: 'neutral', text: 'Lokaler Dienst bereit · Windows-DNS nicht verbunden' };

    const base = { connection, error: s.error || '', toggle: s.active ? 'on' : 'off', action: null };

    if (s.busy) {
      const turningOn = pending ? pending === 'active' : !s.active;
      if (turningOn && !s.helper) {
        return { ...base, key: 'approval', tone: 'info', icon: 'lock', toggle: 'pending', pill: 'Freigabe nötig',
          kicker: 'Windows-Freigabe erforderlich', title: 'Bitte Windows-Freigabe bestätigen',
          description: 'Windows fragt nach Administratorrechten. Nach deiner Bestätigung stellt Leise DNS die DNS-Einstellungen dieses PCs um.'
            + (s.approval?.remember && s.approval.task !== 'registered' ? ' Die Freigabe wird gespeichert, danach fragt Windows nicht mehr.' : '') };
      }
      if (turningOn) {
        return { ...base, key: 'activating', tone: 'info', icon: 'shield', toggle: 'pending', pill: 'Wird eingeschaltet',
          kicker: 'Einen Moment bitte', title: 'Schutz wird eingeschaltet …',
          description: 'Windows-DNS wird auf den lokalen Dienst umgestellt. Der Schutz gilt erst nach der Bestätigung als aktiv.' };
      }
      return { ...base, key: 'deactivating', tone: 'info', icon: 'shield', toggle: 'pending', pill: 'Wird zurückgesetzt',
        kicker: 'Einen Moment bitte', title: 'DNS wird zurückgesetzt …',
        description: 'Windows erhält die ursprünglichen DNS-Einstellungen zurück.' };
    }

    if (!s.running) {
      return { ...base, key: 'unreachable', tone: 'danger', icon: 'alert', pill: 'Dienst gestoppt',
        kicker: 'Dienst nicht erreichbar', title: 'Der lokale DNS-Dienst läuft nicht',
        description: 'Leise DNS konnte keinen lokalen DNS-Dienst auf diesem PC starten. Möglicherweise belegt ein anderes Programm Port 53.',
        action: { label: 'Erneut versuchen', mode: 'active', icon: 'refresh' } };
    }

    if (s.active) {
      return { ...base, key: 'active', tone: 'success', icon: 'shield-check', pill: 'Schutz aktiv',
        kicker: 'Schutz aktiv · nur auf diesem PC', title: 'Dein Schutz ist aktiv',
        description: 'Werbung und Tracker werden direkt auf diesem PC blockiert, bevor sie geladen werden.' };
    }

    if (s.error) {
      const setup = mode === 'active';
      return { ...base, key: 'failed', tone: 'danger', icon: 'shield-alert', pill: 'Fehler',
        kicker: setup ? 'Einrichtung fehlgeschlagen' : 'Zurücksetzen fehlgeschlagen',
        title: setup ? 'Der Schutz konnte nicht eingeschaltet werden' : 'DNS konnte nicht zurückgesetzt werden',
        description: setup ? 'Deine bisherigen DNS-Einstellungen bleiben erhalten. Die Details stehen unten.'
          : 'Die Details stehen unten. Versuche es erneut oder prüfe den Status in den Einstellungen.',
        action: setup ? { label: 'Erneut versuchen', mode: 'active', icon: 'refresh' } : { label: 'Schutz einschalten', mode: 'active', icon: 'power' } };
    }

    if (mode === 'timed') {
      return { ...base, key: 'paused-timed', tone: 'warning', icon: 'shield-pause', pill: 'Pausiert',
        kicker: 'Pausiert', title: `Pausiert bis ${clock(s.mode.until)} Uhr`,
        description: `${remaining(s.mode.until, now)}. Danach schaltet sich der Schutz automatisch wieder ein.`,
        action: { label: 'Jetzt einschalten', mode: 'active', icon: 'play' } };
    }
    if (mode === 'restart') {
      return { ...base, key: 'paused-restart', tone: 'warning', icon: 'shield-pause', pill: 'Pausiert',
        kicker: 'Pausiert bis zum App-Neustart', title: 'Dein Schutz pausiert',
        description: 'Er bleibt aus, bis Leise DNS neu gestartet wird. Du kannst ihn jederzeit wieder einschalten.',
        action: { label: 'Jetzt einschalten', mode: 'active', icon: 'play' } };
    }
    if (mode === 'off') {
      return { ...base, key: 'off', tone: 'neutral', icon: 'shield-off', pill: 'Ausgeschaltet',
        kicker: 'Dauerhaft ausgeschaltet', title: 'Dein Schutz ist ausgeschaltet',
        description: 'Windows verwendet wieder die ursprünglichen DNS-Einstellungen, bis du den Schutz einschaltest.',
        action: { label: 'Schutz einschalten', mode: 'active', icon: 'power' } };
    }

    return { ...base, key: 'setup', tone: 'neutral', icon: 'shield', pill: 'Einrichtung nötig',
      kicker: 'Einrichtung erforderlich', title: 'Bereit für ein ruhigeres Netz',
      description: dns.partial
        ? 'Windows-DNS ist nur teilweise umgestellt. Richte den Schutz erneut ein, damit alle Netzwerkadapter verbunden sind.'
        : 'Richte den lokalen DNS-Schutz mit einem Klick ein. Windows fragt dabei einmal nach Administratorrechten.',
      action: { label: 'Mit einem Klick einrichten', mode: 'active', icon: 'arrow' } };
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
