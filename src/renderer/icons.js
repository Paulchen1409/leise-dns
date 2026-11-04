// Local icon set: 24px grid, 1.75px stroke, round caps and joins.
// Placeholders like <i data-icon="shield"></i> are replaced by inline SVG.
(function (global) {
  const shield = '<path d="M12 3.2 19 6v5.6c0 4.5-3 7.8-7 9.2-4-1.4-7-4.7-7-9.2V6z"/>';

  function gear() {
    const point = (r, deg) => {
      const a = (deg - 90) * Math.PI / 180;
      return `${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
    };
    let d = '';
    for (let k = 0; k < 8; k++) {
      const c = k * 45;
      d += `${k ? 'L' : 'M'}${point(7.1, c - 13)}L${point(9.3, c - 8)}L${point(9.3, c + 8)}L${point(7.1, c + 13)}`;
    }
    return `<path d="${d}Z"/><circle cx="12" cy="12" r="2.9"/>`;
  }

  const paths = {
    overview: '<rect x="3.75" y="3.75" width="7" height="7" rx="2"/><rect x="13.25" y="3.75" width="7" height="7" rx="2"/><rect x="3.75" y="13.25" width="7" height="7" rx="2"/><rect x="13.25" y="13.25" width="7" height="7" rx="2"/>',
    activity: '<path d="M3 12.5h3.6l2.6-6.3 4.1 11.6 2.6-5.3H21"/>',
    layers: '<path d="M12 3.6 20.6 8 12 12.4 3.4 8z"/><path d="m3.4 12 8.6 4.4 8.6-4.4"/><path d="m3.4 16 8.6 4.4 8.6-4.4"/>',
    allow: '<circle cx="12" cy="12" r="8.6"/><path d="m8.4 12.3 2.5 2.5 4.8-5.2"/>',
    block: '<circle cx="12" cy="12" r="8.6"/><path d="M6 6l12 12"/>',
    settings: gear(),
    shield,
    'shield-check': shield + '<path d="m8.9 11.9 2.2 2.2 4.1-4.5"/>',
    'shield-pause': shield + '<path d="M10.2 9.4v5.2M13.8 9.4v5.2"/>',
    'shield-off': shield + '<path d="M4 4l16 16"/>',
    'shield-alert': shield + '<path d="M12 8.3v4.4M12 15.7v.02"/>',
    pause: '<path d="M9 6.5v11M15 6.5v11"/>',
    timer: '<circle cx="12" cy="13.2" r="7.3"/><path d="M12 9.6v3.6l2.3 1.5M9.6 2.9h4.8"/>',
    restart: '<path d="M19.4 12a7.4 7.4 0 1 1-2.17-5.23"/><path d="M19.6 4.2v4.4h-4.4"/>',
    power: '<path d="M12 3.6v7.6"/><path d="M7.1 6.6a7.4 7.4 0 1 0 9.8 0"/>',
    refresh: '<path d="M19.6 10.6A7.8 7.8 0 0 0 5.8 7.1M4.4 4.6v3.9h3.9"/><path d="M4.4 13.4a7.8 7.8 0 0 0 13.8 3.5M19.6 19.4v-3.9h-3.9"/>',
    plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
    trash: '<path d="M4.6 7h14.8M9.9 3.9h4.2M6.6 7l.8 11.3a2 2 0 0 0 2 1.8h5.2a2 2 0 0 0 2-1.8L17.4 7M10.1 10.8v5.6M13.9 10.8v5.6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m19.6 19.6-4.3-4.3"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2M12 7.8v.02"/>',
    alert: '<path d="M10.3 4.4 3.3 16.9A2 2 0 0 0 5 19.9h14a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z"/><path d="M12 9.4v4.1M12 16.6v.02"/>',
    close: '<path d="M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4"/>',
    check: '<path d="m5.2 12.6 4.3 4.3 9.3-9.6"/>',
    chevron: '<path d="m9.5 5.8 6.2 6.2-6.2 6.2"/>',
    arrow: '<path d="M5 12h14M13.2 6.2 19 12l-5.8 5.8"/>',
    computer: '<rect x="3.8" y="4.8" width="16.4" height="11" rx="2.2"/><path d="M8.5 19.4h7M12 15.8v3.6"/>',
    lock: '<rect x="5" y="10.4" width="14" height="10" rx="2.6"/><path d="M8.4 10.4V8a3.6 3.6 0 0 1 7.2 0v2.4"/>',
    globe: '<circle cx="12" cy="12" r="8.6"/><path d="M3.4 12h17.2M12 3.4c2.3 2.5 3.5 5.4 3.5 8.6s-1.2 6.1-3.5 8.6c-2.3-2.5-3.5-5.4-3.5-8.6S9.7 5.9 12 3.4z"/>',
    network: '<rect x="4" y="4" width="16" height="6.4" rx="2"/><rect x="4" y="13.6" width="16" height="6.4" rx="2"/><path d="M7.9 7.2h.02M7.9 16.8h.02"/>',
    play: '<path d="M8 5.8v12.4l10-6.2z"/>',
    appearance: '<circle cx="12" cy="12" r="8.6"/><path d="M12 3.4a8.6 8.6 0 0 1 0 17.2z" fill="currentColor" stroke="none"/>',
    link: '<path d="M10.2 13.8a4 4 0 0 0 5.6 0l2.9-2.9a4 4 0 0 0-5.6-5.6l-1 1"/><path d="M13.8 10.2a4 4 0 0 0-5.6 0l-2.9 2.9a4 4 0 0 0 5.6 5.6l1-1"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l2.9 1.8"/>',
    list: '<path d="M8.8 7h10.4M8.8 12h10.4M8.8 17h10.4M4.8 7h.02M4.8 12h.02M4.8 17h.02"/>'
  };

  function svg(name, className = '') {
    return `<svg class="icon${className ? ' ' + className : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ''}</svg>`;
  }

  // App mark: a small glass tile with the "l·" signature of Leise DNS.
  function brand(id = 'bm') {
    return `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><defs>
      <linearGradient id="${id}-fill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a6f2d0"/><stop offset=".55" stop-color="#5ccaa5"/><stop offset="1" stop-color="#2d8a8f"/></linearGradient>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".75"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>
      <radialGradient id="${id}-sheen" cx=".3" cy="0" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs><rect width="32" height="32" rx="9.6" fill="url(#${id}-fill)"/><rect width="32" height="32" rx="9.6" fill="url(#${id}-sheen)"/>
    <rect x=".5" y=".5" width="31" height="31" rx="9.1" fill="none" stroke="url(#${id}-rim)"/>
    <path d="M12.6 8.6v13.2" stroke="#0c2a22" stroke-width="3.3" stroke-linecap="round"/><circle cx="19.6" cy="18.4" r="2.15" fill="#0c2a22"/></svg>`;
  }

  function hydrate(root = document) {
    root.querySelectorAll('i[data-icon]').forEach(el => {
      el.outerHTML = svg(el.dataset.icon, el.className);
    });
    root.querySelectorAll('i[data-brand]').forEach(el => {
      el.outerHTML = brand(el.dataset.brand);
    });
  }

  global.Icons = { svg, brand, hydrate, names: Object.keys(paths) };
})(typeof window !== 'undefined' ? window : globalThis);
