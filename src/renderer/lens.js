// Optional edge refraction for a few floating glass elements.
// Chromium can apply an SVG displacement filter to the backdrop. The map is
// generated per element size, so the bent rim follows its rounded shape.
// Text and icons sit above the backdrop and are never distorted.
// Without support (or with refraction disabled) the CSS blur material remains.
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const filters = new Map();
  const tracked = new Set();
  let defs, seq = 0;

  function container() {
    if (defs) return defs;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'lens-defs');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    defs = document.createElementNS(NS, 'defs');
    svg.append(defs);
    document.body.append(svg);
    return defs;
  }

  // R/G encode the sampling offset. Near the rim the backdrop is sampled further
  // inside, which stretches it towards the edge like a thick convex pane.
  function displacementMap(w, h, radius, band) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(w, h);
    const r = Math.min(radius, w / 2, h / 2);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2;
        const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
        const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
        const depth = r - outside - Math.min(Math.max(qx, qy), 0);
        let dx = 0, dy = 0;
        if (depth > 0 && depth < band) {
          let nx, ny;
          if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; }
          else if (qx > qy) { nx = 1; ny = 0; } else { nx = 0; ny = 1; }
          nx *= Math.sign(px) || 1;
          ny *= Math.sign(py) || 1;
          const t = 1 - depth / band;
          const s = t * t;
          dx = -nx * s;
          dy = -ny * s;
        }
        const i = (y * w + x) * 4;
        img.data[i] = 128 + dx * 127;
        img.data[i + 1] = 128 + dy * 127;
        img.data[i + 2] = 128;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }

  function filterFor(w, h, radius, strength) {
    const band = Math.max(6, Math.min(18, Math.min(w, h) * 0.32));
    const key = `${w}x${h}r${radius}s${strength}`;
    if (filters.has(key)) return filters.get(key);
    const id = `lens-${++seq}`;
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', '0');
    filter.setAttribute('y', '0');
    filter.setAttribute('width', String(w));
    filter.setAttribute('height', String(h));
    filter.setAttribute('filterUnits', 'userSpaceOnUse');
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const image = document.createElementNS(NS, 'feImage');
    image.setAttribute('href', displacementMap(w, h, radius, band));
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', String(w));
    image.setAttribute('height', String(h));
    image.setAttribute('preserveAspectRatio', 'none');
    image.setAttribute('result', 'map');
    const displace = document.createElementNS(NS, 'feDisplacementMap');
    displace.setAttribute('in', 'SourceGraphic');
    displace.setAttribute('in2', 'map');
    displace.setAttribute('scale', String(strength));
    displace.setAttribute('xChannelSelector', 'R');
    displace.setAttribute('yChannelSelector', 'G');
    filter.append(image, displace);
    container().append(filter);
    filters.set(key, id);
    return id;
  }

  function enabled() {
    return document.documentElement.dataset.refraction !== 'off' && CSS.supports('backdrop-filter', 'blur(1px)');
  }

  function apply(el) {
    if (!enabled()) { el.style.removeProperty('backdrop-filter'); return; }
    const box = el.getBoundingClientRect();
    const w = Math.round(box.width), h = Math.round(box.height);
    if (w < 8 || h < 8 || w > 1600) return;
    const style = getComputedStyle(el);
    const radius = Math.round(parseFloat(style.borderTopLeftRadius) || 0);
    const strength = Number(el.dataset.lens) || 24;
    const id = filterFor(w, h, radius, strength);
    // The CSS material filter follows the displacement, e.g. "blur(18px) saturate(170%)".
    const material = style.getPropertyValue('--lens-material').trim() || 'blur(10px) saturate(170%)';
    el.style.setProperty('backdrop-filter', `url(#${id}) ${material}`);
  }

  const observer = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => entries.forEach(e => apply(e.target))) : null;

  function attach(root = document) {
    root.querySelectorAll('[data-lens]').forEach(el => {
      if (tracked.has(el)) return;
      tracked.add(el);
      observer?.observe(el);
      apply(el);
    });
  }

  function refresh() { tracked.forEach(el => el.isConnected ? apply(el) : tracked.delete(el)); }

  global.GlassLens = { attach, refresh };
  if (typeof document !== 'undefined') document.documentElement.addEventListener('prefs-changed', refresh);
})(window);
