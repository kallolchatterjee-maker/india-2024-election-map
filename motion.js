// Site-wide motion and interface touches: reading-progress bar, headline word reveals, numbers that
// count up, staggered lists, pointer-following glow and gentle tilt on cards, and a quiet animated background for
// each dark page opening. Page-to-page transitions are pure CSS (site.css, "Motion"). Everything respects
// prefers-reduced-motion and pauses when out of view. No third-party code.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---- header: compact on scroll, with a thin reading-progress bar
  const header = document.querySelector('.site-header');
  const bar = document.createElement('div');
  bar.className = 'read-progress';
  bar.setAttribute('aria-hidden', 'true');
  (document.body || document.documentElement).appendChild(bar);
  let ticking = false;
  const update = () => {
    ticking = false;
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    if (header) header.classList.toggle('scrolled', y > 12);
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  addEventListener('resize', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
  if (reduce) { document.documentElement.classList.add('motion-off'); return; }
  document.documentElement.classList.add('motion-on');

  // ---- headlines revealed word by word (the page title on load, section titles as they scroll in)
  function splitWords(h) {
    if (h.dataset.split) return; h.dataset.split = '1';
    let i = 0;
    const walk = node => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) {
          const parts = n.textContent.split(/(\s+)/), frag = document.createDocumentFragment();
          for (const p of parts) {
            if (!p) continue;
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(p)); continue; }
            const s = document.createElement('span'); s.className = 'w'; s.style.setProperty('--wi', i++); s.textContent = p; frag.appendChild(s);
          }
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !/^(BR|IMG|SVG)$/.test(n.tagName)) walk(n);
      }
    };
    walk(h); h.classList.add('words');
  }
  const heroTitle = document.querySelector('.hero h1, header h1');
  if (heroTitle) { splitWords(heroTitle); setTimeout(() => heroTitle.classList.add('words-in'), 120); }
  const titles = $$('main h2').filter(h => !h.closest('#story, .sf, .pc-card, .ck, figure, .card, .legal-doc'));
  titles.forEach(splitWords);
  const tio = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('words-in'); tio.unobserve(e.target); } }), { threshold: 0.3 });
  titles.forEach(h => tio.observe(h));
  const storySteps = $$('.step');
  if (storySteps.length) {
    let storyTicking = false;
    const revealActiveTitle = () => {
      storyTicking = false;
      const center = innerHeight / 2;
      const active = storySteps.find(step => {
        const bounds = step.getBoundingClientRect();
        return bounds.top <= center && bounds.bottom > center;
      });
      active?.querySelector('h2')?.classList.add('words-in');
    };
    addEventListener('scroll', () => {
      if (!storyTicking) { storyTicking = true; requestAnimationFrame(revealActiveTitle); }
    }, { passive: true });
    addEventListener('resize', revealActiveTitle, { passive: true });
    revealActiveTitle();
  }

  // ---- numbers that count up when they come into view (keeps their format: decimals, Indian or Western commas)
  const nums = $$('.kpi-strip b, .es-studies b').filter(b => /^[\d][\d,]*(\.\d+)?$/.test((b.firstChild && b.firstChild.nodeType === 3 ? b.firstChild.textContent : '').trim()));
  const nio = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; nio.unobserve(e.target);
    const node = e.target.firstChild, raw = node.textContent.trim(), dec = (raw.split('.')[1] || '').length;
    const indian = /\d,\d\d,\d{3}/.test(raw), target = parseFloat(raw.replace(/,/g, '')), t0 = performance.now(), D = 1400;
    const fmt = v => (raw.includes(',') ? v.toLocaleString(indian ? 'en-IN' : 'en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : v.toFixed(dec));
    const step = now => { const k = Math.min(1, (now - t0) / D), v = target * (1 - Math.pow(1 - k, 3)); node.textContent = fmt(k < 1 ? v : target); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), { threshold: 0.6 });
  nums.forEach(b => nio.observe(b));

  // ---- staggered lists: children of these groups arrive one after another
  $$('.reveal:is(.takeaways, .stages, .steps, .es-funcs, .vd-eight, .vd-vars, .es-myths, .es-pairs, .kpi-strip, .vd-mistakes, .es-evidence, .vd-five, .flow3), .reveal .steps').forEach(g => {
    [...g.children].forEach((c, i) => c.style.setProperty('--si', i));
    g.classList.add('stagger');
  });

  // ---- cards: a soft glow follows the pointer, with a gentle tilt (desktop only)
  if (fine) {
    const cards = $$('.card, .es-ev, .es-funcs > div, .vd-mistakes li, .es-pairs > div, .stage, .vd-vars > div, .es-myths > div');
    cards.forEach(c => {
      c.classList.add('tilt');
      c.addEventListener('pointermove', e => {
        const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        c.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); c.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        c.style.setProperty('--ry', ((x - 0.5) * 5).toFixed(2) + 'deg'); c.style.setProperty('--rx', ((0.5 - y) * 4).toFixed(2) + 'deg');
      });
      c.addEventListener('pointerleave', () => { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); });
    });
  }

  // ---- animated backgrounds for dark/light page openings (not the home page, which has its own 3D story)
  const hero = document.querySelector('main > .hero');
  if (hero && !document.getElementById('story')) {
    const page = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
    const kind = /data|strata|about|elections/.test(page) ? 'grid' : /strategy|voters|privacy|terms/.test(page) ? 'network' : 'contours';
    const cv = document.createElement('canvas'); cv.className = 'hero-bg' + (hero.querySelector('.hero-media') ? ' beside-media' : ''); cv.setAttribute('aria-hidden', 'true'); hero.prepend(cv);
    const g = cv.getContext('2d'); let w = 0, h = 0, t = 0, on = true, last = 0, nodes = null;
    const size = () => { const r = hero.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 1.5); w = r.width; h = r.height; cv.width = w * d; cv.height = h * d; g.setTransform(d, 0, 0, d, 0, 0); nodes = null; };
    size(); new ResizeObserver(size).observe(hero);
    new IntersectionObserver(es => { on = es.some(e => e.isIntersecting); }).observe(hero);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const draw = () => {
      g.clearRect(0, 0, w, h);
      if (kind === 'grid') {
        const s = 34, cx = w * (0.62 + 0.18 * Math.sin(t * 0.13)), cy = h * (0.5 + 0.25 * Math.cos(t * 0.11));
        for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) {
          const d = Math.hypot(x - cx, y - cy), wave = Math.max(0, Math.sin(d / 48 - t * 1.6)) * Math.exp(-d / 520);
          g.fillStyle = wave > 0.55 ? `rgba(255,102,0,${(wave * 0.5).toFixed(3)})` : `rgba(255,253,246,${(0.05 + wave * 0.16).toFixed(3)})`;
          g.beginPath(); g.arc(x, y, 1.1 + wave * 1.6, 0, Math.PI * 2); g.fill();
        }
      } else if (kind === 'contours') {
        for (let i = 0; i < 9; i++) {
          const base = h * (0.12 + i * 0.1), amp = 18 + i * 3, sp = 0.25 + i * 0.03, sa = i === 4;
          g.strokeStyle = sa ? 'rgba(255,102,0,0.28)' : `rgba(255,253,246,${0.05 + (i % 3) * 0.015})`; g.lineWidth = sa ? 1.4 : 1;
          g.beginPath();
          for (let x = 0; x <= w; x += 12) { const y = base + Math.sin(x / 210 + t * sp + i) * amp + Math.sin(x / 90 - t * sp * 1.7) * amp * 0.35; x ? g.lineTo(x, y) : g.moveTo(x, y); }
          g.stroke();
        }
      } else {
        if (!nodes) { seed = 11; nodes = Array.from({ length: Math.round(Math.min(70, w * h / 16000)) }, (_, i) => ({ x: rnd() * w, y: rnd() * h, vx: (rnd() - 0.5) * 9, vy: (rnd() - 0.5) * 9, s: i % 9 === 0 })); }
        nodes.forEach(n => { n.x += n.vx / 30; n.y += n.vy / 30; if (n.x < 0 || n.x > w) n.vx *= -1; if (n.y < 0 || n.y > h) n.vy *= -1; });
        for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
          const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y); if (d > 150) continue;
          g.strokeStyle = `rgba(255,253,246,${((1 - d / 150) * 0.07).toFixed(3)})`; g.beginPath(); g.moveTo(nodes[a].x, nodes[a].y); g.lineTo(nodes[b].x, nodes[b].y); g.stroke();
        }
        nodes.forEach(n => { g.fillStyle = n.s ? 'rgba(255,102,0,0.5)' : 'rgba(255,253,246,0.16)'; g.beginPath(); g.arc(n.x, n.y, n.s ? 2.4 : 1.5, 0, Math.PI * 2); g.fill(); });
      }
    };
    const loop = now => { requestAnimationFrame(loop); if (!on || document.hidden || now - last < 33) return; t += Math.min(0.1, (now - (last || now)) / 1000); last = now; draw(); };
    draw(); requestAnimationFrame(loop);
  }
})();