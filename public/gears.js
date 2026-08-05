/* ------------------------------------------------------------------
   Builders Club — shared gear + scroll engine
   Used by all three site versions. Self-contained, no dependencies.
------------------------------------------------------------------ */

/** Build an SVG <path> "d" string for a gear with `teeth` trapezoidal teeth. */
function gearPathD(teeth, rOuter, rInner) {
  const S = (Math.PI * 2) / teeth;
  const pt = (r, a) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * S;
    const p1 = pt(rInner, a);
    const p2 = pt(rOuter, a + 0.16 * S);
    const p3 = pt(rOuter, a + 0.34 * S);
    const p4 = pt(rInner, a + 0.50 * S);
    d += (i === 0 ? `M${p1}` : `L${p1}`) + `L${p2}L${p3}L${p4}`;
  }
  return d + 'Z';
}

/**
 * Returns an <svg> markup string for a gear.
 * opts: { teeth, color, fill, stroke, hub, bolts, size }
 */
function gearSVG({ teeth = 12, color = '#ffffff', fill = 'none', stroke = 2.5,
                   hub = 0.30, bolts = 0, size = 200 } = {}) {
  const rOuter = 48, rInner = 40, view = 100;
  const d = gearPathD(teeth, rOuter, rInner);
  const rHub = rInner * hub * 2 * 0.5; // hub radius in viewbox units
  let boltMarkup = '';
  if (bolts > 0) {
    const br = rInner * 0.62;
    for (let i = 0; i < bolts; i++) {
      const a = (i / bolts) * Math.PI * 2;
      const cx = (br * Math.cos(a)).toFixed(2);
      const cy = (br * Math.sin(a)).toFixed(2);
      boltMarkup += `<circle cx="${cx}" cy="${cy}" r="${(rInner*0.13).toFixed(2)}" fill="none" stroke="${color}" stroke-width="${stroke}"/>`;
    }
  }
  return `<svg viewBox="-${view/2} -${view/2} ${view} ${view}" width="${size}" height="${size}" style="display:block;overflow:visible">
    <path d="${d}" fill="${fill}" stroke="${color}" stroke-width="${stroke}" stroke-linejoin="round"/>
    <circle cx="0" cy="0" r="${rHub.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${stroke}"/>
    ${boltMarkup}
  </svg>`;
}

/**
 * Wire a set of elements to rotate based on page scroll progress.
 * Each element should carry:
 *   data-gear-speed  — degrees of rotation per full-page scroll (default 360)
 *   data-gear-dir    — "1" or "-1" (default 1)
 */
function initScrollGears(selector = '[data-gear]') {
  const gears = Array.from(document.querySelectorAll(selector));
  if (!gears.length) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const doc = document.documentElement;
    const max = (doc.scrollHeight - window.innerHeight) || 1;
    const p = Math.min(1, Math.max(0, window.scrollY / max));
    for (const g of gears) {
      const speed = parseFloat(g.dataset.gearSpeed || '360');
      const dir = parseFloat(g.dataset.gearDir || '1');
      g.style.transform = `rotate(${(p * speed * dir).toFixed(2)}deg)`;
    }
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

/** Reveal-on-scroll for [data-reveal] elements. */
function initReveal(selector = '[data-reveal]') {
  const els = document.querySelectorAll(selector);
  if (!('IntersectionObserver' in window)) {
    els.forEach((el) => { el.style.opacity = '1'; el.style.transform = 'none'; });
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        const d = e.target.getAttribute('data-reveal-delay') || 0;
        e.target.style.transitionDelay = d + 'ms';
        e.target.style.opacity = '1';
        e.target.style.transform = 'none';
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  els.forEach((el) => io.observe(el));
}

/** A thin scroll-progress bar fed by the page. el = the bar fill element. */
function initProgressBar(el) {
  if (!el) return;
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
    const p = Math.min(1, Math.max(0, window.scrollY / max));
    el.style.transform = `scaleX(${p})`;
  };
  const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
}

window.BuildersGears = { gearSVG, initScrollGears, initReveal, initProgressBar };
