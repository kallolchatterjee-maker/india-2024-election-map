// Hero film: one continuous take. 24,000 dots keep their identity from start to finish and re-form, beat by beat, into
// India's electors, its polling stations, turnout by state, the Lok Sabha, then Uganda's register, polling stations,
// districts, regions, turnout and Parliament. Every position, colour and number comes from the site's data files
// (tools/prep-film.js and the other tools/prep-*.js); nothing is AI-generated. WebGL draws the dots; a 2D canvas on
// top carries the text, axes and labels, projected through the same camera.
// mountFilm(host, { start, mode, record, size }) -> controller. mode: 'wide' 16:9 (Home), 'compact' 16:10 (page
// heroes), 'tall' 9:16 (social export). Falls back to the 2D data reel (reel.js) if WebGL is unavailable.
import * as THREE from './vendor/three.module.min.js';

const N = 24000;
const SERIF = '"Source Serif 4", Georgia, serif', SANS = 'Inter, system-ui, sans-serif', MONO = '"IBM Plex Mono", monospace';
const C = { ink: '#000000', ivory: '#f4efe6', muted: '#a8a399', faint: 'rgba(244,239,230,0.16)', saff: '#ff6600',
  BJP: '#ef8a2a', INC: '#2a8fd0', OTHERNAT: '#8e7cc3', STATE: '#a59d90',
  NRM: '#e8b400', NUP: '#d8344a', FDC: '#2f6bd1', DP: '#3f9d63', UPC: '#b65fa8', ANT: '#4fb3a9', JEEMA: '#7f8c3a', PPP: '#9c7a5b',
  INDEPENDENT: '#a59d90', 'NO RESULT': '#4a4741' };
const UG_NAME = { NRM: 'NRM', NUP: 'NUP', FDC: 'FDC', DP: 'DP', UPC: 'UPC', ANT: 'ANT', JEEMA: 'JEEMA', PPP: 'PPP', INDEPENDENT: 'Independents', 'NO RESULT': 'No result' };
const TURN_BINS = [[0, 60, '#f6e3cc'], [60, 65, '#f7c79a'], [65, 70, '#f6a560'], [70, 75, '#ff7a1f'], [75, 80, '#d65400'], [80, 101, '#8a3300']];
const REGION_COL = { Western: C.NRM, Northern: '#3f9d63', Eastern: '#2f6bd1', Central: '#d8344a' };
const KI = Math.cos(22 * Math.PI / 180), KU = Math.cos(1.4 * Math.PI / 180);

const clamp01 = v => Math.min(1, Math.max(0, v));
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const fmtN = n => Math.round(n).toLocaleString('en-GB');
const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
const RGB = new Map();
const rgb = h => RGB.get(h) || (RGB.set(h, [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]), RGB.get(h));

const FRAMES = {
  wide: { FW: 1600, FH: 900, tx: 80, ty: 98, tw: 600, head: 54, sub: 20, eye: 16, lab: 17, box: { x: 740, y: 80, w: 800, h: 730 } },
  compact: { FW: 1000, FH: 625, tx: 48, ty: 58, tw: 900, head: 42, sub: 19, eye: 15, lab: 17, box: { x: 48, y: 232, w: 904, h: 340 } },
  tall: { FW: 900, FH: 1600, tx: 70, ty: 150, tw: 760, head: 64, sub: 26, eye: 21, lab: 24, box: { x: 60, y: 520, w: 780, h: 900 } },
};

// ---------------------------------------------------------------- data
let dataPromise = null;
function loadData() {
  const j = f => fetch(`data/${f}.json`).then(r => r.ok ? r.json() : null).catch(() => null);
  dataPromise = dataPromise || Promise.all([j('national'), j('uganda-depth'), j('uganda'), j('india-soi-outline'), j('india-soi-states'), j('film'),
    fetch('data/film.bin').then(r => r.ok ? r.arrayBuffer() : null).catch(() => null)])
    .then(([N_, UG, UJ, O, ST, FJ, bin]) => ({ N: N_, UG, UJ, O, ST, FJ, bin }));
  return dataPromise;
}

// ---------------------------------------------------------------- layout helpers (frame coords: x right, y down)
function newLayout() { return { pos: new Float32Array(N * 3), col: new Float32Array(N * 4), size: new Float32Array(N), del: new Float32Array(N) }; }
function put(L, i, x, y, z, hex, a, s, d) {
  L.pos[i * 3] = x; L.pos[i * 3 + 1] = y; L.pos[i * 3 + 2] = z;
  const c = typeof hex === 'string' ? rgb(hex) : hex;
  L.col[i * 4] = c[0]; L.col[i * 4 + 1] = c[1]; L.col[i * 4 + 2] = c[2]; L.col[i * 4 + 3] = a;
  L.size[i] = s; L.del[i] = d;
}
// Dots not needed in a layout hide on top of a visible one, so they emerge from the data when next needed.
function finish(L, nVis, used = null) {
  const vis = [];
  for (let i = 0; i < N; i++) if (used ? used[i] : i < nVis) vis.push(i);
  const nv = Math.max(1, vis.length);
  for (let i = 0, h = 0; i < N; i++) {
    if (used ? used[i] : i < nVis) continue;
    const j = vis[h++ % nv] ?? 0;
    L.pos[i * 3] = L.pos[j * 3]; L.pos[i * 3 + 1] = L.pos[j * 3 + 1]; L.pos[i * 3 + 2] = L.pos[j * 3 + 2];
    L.col[i * 4] = L.col[j * 4]; L.col[i * 4 + 1] = L.col[j * 4 + 1]; L.col[i * 4 + 2] = L.col[j * 4 + 2]; L.col[i * 4 + 3] = 0;
    L.size[i] = L.size[j]; L.del[i] = rnd(i, 9);
  }
  return L;
}
function grid(n, b) {
  const cols = Math.ceil(Math.sqrt(n * b.w / b.h)), rows = Math.ceil(n / cols), step = Math.min(b.w / cols, b.h / rows);
  const x0 = b.x + (b.w - cols * step) / 2 + step / 2, y0 = b.y + (b.h - rows * step) / 2 + step / 2;
  return { step, cols, rows, at: i => [x0 + (i % cols) * step, y0 + Math.floor(i / cols) * step] };
}
const inset = (b, f) => ({ x: b.x + b.w * f, y: b.y + b.h * f, w: b.w * (1 - 2 * f), h: b.h * (1 - 2 * f) });
function fitter(B, k, b, pad = 0.97) {
  const w = (B.lon1 - B.lon0) * k, h = B.lat1 - B.lat0, s = Math.min(b.w * pad / w, b.h * pad / h);
  const ox = b.x + (b.w - w * s) / 2, oy = b.y + (b.h - h * s) / 2;
  return { s, f: (lon, lat) => [ox + (lon - B.lon0) * k * s, oy + (B.lat1 - lat) * s] };
}
// Parliament hemicycle: seats ordered left to right; each seat is a small disc made of k dots.
function hemicycle(n, b) {
  const cx = b.x + b.w / 2, R = Math.min(b.w / 2, b.h * 0.78) * 0.97, cy = b.y + b.h * 0.08 + R, r0 = R * 0.36;
  const rows = Math.max(4, Math.round(Math.sqrt(n / 3.4)));
  const radii = Array.from({ length: rows }, (_, i) => r0 + (R - r0) * (i + 0.5) / rows), sum = radii.reduce((a, v) => a + v, 0);
  const counts = radii.map(r => Math.floor(n * r / sum)); let left = n - counts.reduce((a, v) => a + v, 0);
  for (let i = rows - 1; left > 0; i = (i - 1 + rows) % rows, left--) counts[i]++;
  const seats = [];
  radii.forEach((r, i) => { for (let j = 0; j < counts[i]; j++) { const a = Math.PI - Math.PI * (j + 0.5) / counts[i]; seats.push({ a, r, x: cx + Math.cos(a) * r, y: cy - Math.sin(a) * r }); } });
  seats.sort((p, q) => q.a - p.a || p.r - q.r);
  const seatR = 0.4 * Math.min((R - r0) / rows, Math.PI * r0 / counts[0]);
  return { seats, seatR, cx, cy, R, r0 };
}
// spacing of a lattice: the smallest gap between neighbours on the same row
function latticeStep(at, n) {
  let step = Infinity, prev = at(0);
  for (let i = 1; i < n; i++) { const p = at(i); if (Math.abs(p[1] - prev[1]) < 1e-6) { const d = Math.abs(p[0] - prev[0]); if (d > 1e-6 && d < step) step = d; } prev = p; }
  return Number.isFinite(step) ? step : 2;
}
function vogel(k, j, r) { const rr = r * Math.sqrt((j + 0.5) / k), a = j * 2.399963; return [Math.cos(a) * rr, Math.sin(a) * rr]; }
// seats -> layout; colourOf(seatIndex) -> [hex, alpha]; returns per-dot seat index in L.seatOf
function seatLayout(H, k, colourOf, delayOf) {
  const L = newLayout(), seatOf = new Int32Array(N).fill(-1), dot = H.seatR * 2 / Math.sqrt(k) * 1.05;
  H.seats.forEach((s, si) => {
    const [hex, a] = colourOf(si);
    for (let j = 0; j < k; j++) { const i = si * k + j; if (i >= N) return; const [dx, dy] = vogel(k, j, H.seatR); put(L, i, s.x + dx, s.y + dy, 0, hex, a, dot, delayOf(si, j)); seatOf[i] = si; }
  });
  finish(L, Math.min(N, H.seats.length * k));
  L.seatOf = seatOf;
  return L;
}

// ---------------------------------------------------------------- the script
function script(D, F) {
  const box = F.box, S = [], B = [];
  const T = D.N.turnout2024, LS = D.N.ls2024, UG = D.UG, UJ = D.UJ, FJ = D.FJ;
  const u16 = k => new Uint16Array(D.bin, FJ.layout[k].offset, FJ.layout[k].bytes / 2);
  const u8 = k => new Uint8Array(D.bin, FJ.layout[k].offset, FJ.layout[k].bytes);
  const deq = (a, i, Bx) => [Bx.lon0 + a[i * 2] / 65535 * (Bx.lon1 - Bx.lon0), Bx.lat0 + a[i * 2 + 1] / 65535 * (Bx.lat1 - Bx.lat0)];
  const fI = fitter(D.O.bbox, KI, box), fU = fitter(UJ.bbox, KU, box);
  const camC = { tilt: 0, zoom: 1, wave: 0, px: box.x + box.w / 2, py: box.y + box.h / 2 };
  const state = (at, dur, make, o = {}) => S.push({ at, dur, make, spread: o.spread ?? 0.45, arc: o.arc ?? 0.25,
    cam: { ...camC, ...o.cam }, lines: { io: 0, is: 0, ud: 0, ...o.lines } });
  const memo = f => { let v = null; return () => v || (v = f()); };
  const dotSize = (lo, hi) => Math.max(lo, Math.min(hi, box.h / 330));

  // ---- 1. India's electors: scattered dust condenses into one dot per 100,000 electors
  const nE = Math.round(T.electors / 1e5);
  state(0, 1.4, () => { const L = newLayout(); const iv = rgb(C.ivory);
    for (let i = 0; i < N; i++) put(L, i, -0.25 * F.FW + rnd(i, 1) * 1.5 * F.FW, -0.25 * F.FH + rnd(i, 2) * 1.5 * F.FH, 250 - 1600 * rnd(i, 3), iv, 0.28, 2.6, rnd(i, 4));
    return L; }, { spread: 0.3, arc: 0.1 });
  state(0.5, 3.6, () => { const L = newLayout(), g = grid(nE, inset(box, 0.05)), iv = rgb(C.ivory);
    for (let i = 0; i < nE; i++) { const [x, y] = g.at(i); put(L, i, x, y, 0, iv, 0.92, g.step * 0.62, i / nE * 0.88 + rnd(i, 5) * 0.1); }
    return finish(L, nE); }, { spread: 0.8, arc: 0.12 });
  B.push({ label: 'India · Lok Sabha 2024', start: 0, end: 7.2,
    heads: [[0, t => `${fmtN(T.electors / 1e6 * easeOut(seg(t, 0.6, 0.5 + 3.6 * 0.9)))} million people were registered to vote.`]],
    sub: `One dot for every 100,000 electors: ${fmtN(T.electors)} in all.`,
    source: 'Source: Election Commission of India, General Election 2024' });

  // ---- 2. ...at a million polling stations: the dots fly to geo-located stations inside the official boundary
  const ib = u16('indiaBooths'), IB = FJ.india.boothBox;
  state(7.2, 2.8, () => { const L = newLayout(), sa = rgb(C.saff), ds = dotSize(1.1, 2.1);
    for (let i = 0; i < N; i++) { const [x, y] = fI.f(...deq(ib, i, IB)); put(L, i, x, y, 0, sa, 0.82, ds, clamp01((y - box.y) / box.h) * 0.85 + rnd(i, 6) * 0.15); }
    return L; }, { spread: 0.55, arc: 0.35, lines: { io: 1 } });
  B.push({ label: 'India · Polling stations', start: 7.2, end: 14.4,
    heads: [[0, `Voting took place at ${fmtN(T.stations)} polling stations.`]],
    sub: `Each dot is one of ${fmtN(N)} sampled from the ${fmtN(FJ.india.boothsAll)} stations Polity Lab has geo-located so far.`,
    source: 'Stations: ECI 2024; Polity Lab booth atlas · Boundary. Source: Survey of India, Government of India' });

  // ---- 3. Turnout, state by state: an even lattice of dots, states lifting and colouring from lowest to highest
  const tmap = new Map(T.states.map(s => [s.name, s.turnout])), names = FJ.india.states;
  const rankOf = new Map([...T.states].sort((a, b) => a.turnout - b.turnout).map((s, r) => [s.name, r]));
  const ig = u16('indiaGrid'), igs = u8('indiaGridState'), SB = FJ.india.gridBox, nIG = FJ.india.grid;
  const binCol = v => (TURN_BINS.find(([a, b]) => v >= a && v < b) || TURN_BINS[0])[2];
  const lift = v => (v - 50) / 35 * box.h * 0.12;
  const turnoutL = memo(() => { const L = newLayout(); let step = 0;
    step = latticeStep(i => fI.f(...deq(ig, i, SB)), nIG);
    const cen = new Map();
    for (let i = 0; i < nIG; i++) { const nm = names[igs[i]], v = tmap.get(nm) ?? 50, [x, y] = fI.f(...deq(ig, i, SB));
      put(L, i, x, y, lift(v), binCol(v), 0.96, step * 0.8, (rankOf.get(nm) ?? 0) / T.states.length * 0.85 + rnd(i, 7) * 0.1);
      const c = cen.get(nm) || [0, 0, 0]; c[0] += x; c[1] += y; c[2]++; cen.set(nm, c); }
    L.cen = cen; return finish(L, nIG); });
  state(14.4, 3.2, turnoutL, { spread: 0.65, arc: 0.2, cam: { tilt: 0.62, zoom: 1.12 }, lines: { io: 0.7, is: 0.22 } });
  const tLow = [...T.states].sort((a, b) => a.turnout - b.turnout)[0], tHigh = [...T.states].sort((a, b) => b.turnout - a.turnout)[0];
  B.push({ label: 'India · Turnout 2024', start: 14.4, end: 22.4,
    heads: [[0, 'Turnout, state by state.']],
    sub: `From ${tLow.turnout.toFixed(1)}% in ${tLow.name} to ${tHigh.turnout.toFixed(1)}% in ${tHigh.name}; ${T.national}% nationally. Height and colour show turnout.`,
    source: 'Turnout: ECI 2024 · Boundaries. Source: Survey of India, Government of India',
    draw(g, t, P) {
      const L = turnoutL(), a = easeOut(seg(t, 2.6, 3.4));
      if (a <= 0) return;
      g.globalAlpha *= a;
      // the lowest and the highest of the larger states, labelled where they sit on the tilted map
      const big = [...L.cen].filter(([, c]) => c[2] > 150).map(([nm, c]) => ({ nm, v: tmap.get(nm), x: c[0] / c[2], y: c[1] / c[2] })).filter(s => s.v != null);
      const lo = big.reduce((m, s) => s.v < m.v ? s : m), hi = big.reduce((m, s) => s.v > m.v ? s : m);
      for (const s of [lo, hi]) { const [x, y] = P.proj(s.x, s.y, lift(s.v)); P.pin(g, x, y, `${s.nm} ${s.v.toFixed(1)}%`); }
      P.legend(g, TURN_BINS.map(([lo_, hi_, c], i) => [c, i === 0 ? 'under 60%' : i === TURN_BINS.length - 1 ? '80% and over' : `${lo_}–${hi_}%`]), 'Turnout');
    } });

  // ---- 4. 543 seats: the map pours into the Lok Sabha; then the seats take their colours
  const H543 = hemicycle(543, inset(box, 0.02)), K543 = Math.floor(N / 543);
  const LS_ORDER = [['INC', 'Congress'], ['OTHERNAT', 'Other national parties'], ['STATE', 'State parties and independents'], ['BJP', 'BJP']];
  const lsSeats = Object.fromEntries(LS.seatGroups.map(s => [s.key || s.party, s.seats]));
  const groupOfSeat = []; LS_ORDER.forEach(([k]) => { for (let j = 0; j < lsSeats[k]; j++) groupOfSeat.push(k); });
  state(22.4, 3.0, () => seatLayout(H543, K543, () => [C.ivory, 0.5], (si, j) => si / 543 * 0.7 + rnd(j, si) * 0.25), { spread: 0.6, arc: 0.3 });
  const lsColoured = memo(() => seatLayout(H543, K543, si => [C[groupOfSeat[si]], 0.95], si => LS_ORDER.findIndex(([k]) => k === groupOfSeat[si]) / 4 * 0.8 + rnd(si, 3) * 0.1));
  state(25.8, 1.6, lsColoured, { spread: 0.5, arc: 0 });
  B.push({ label: 'India · Lok Sabha 2024', start: 22.4, end: 30.4,
    heads: [[0, `${LS.totalSeats} seats. ${LS.majority} for a majority.`], [3.4, `The BJP won ${lsSeats.BJP}, short of a majority on its own.`]],
    sub: 'One disc for every seat in the Lok Sabha, by party group.',
    source: 'Source: Election Commission of India, constituency results 2024 (543 seats)',
    draw(g, t, P) {
      const H = H543, a = easeOut(seg(t, 1.6, 2.4));
      if (a > 0) { // majority line: 272 seats counted from the right-hand end
        const s1 = H.seats[543 - LS.majority], s0 = H.seats[543 - LS.majority - 1], ang = (s0.a + s1.a) / 2;
        const p0 = P.proj(H.cx + Math.cos(ang) * H.r0 * 0.82, H.cy - Math.sin(ang) * H.r0 * 0.82, 0), p1 = P.proj(H.cx + Math.cos(ang) * H.R * 1.07, H.cy - Math.sin(ang) * H.R * 1.07, 0);
        g.save(); g.globalAlpha *= a; g.strokeStyle = C.ivory; g.lineWidth = 1.5; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke(); g.setLineDash([]);
        P.text(g, `${LS.majority} = majority`, p1[0], p1[1] - 10, { align: 'center', color: C.ivory, weight: 600 }); g.restore();
      }
      const b = easeOut(seg(t, 3.6, 4.3));
      if (b > 0) { g.save(); g.globalAlpha *= b; P.legend(g, [...LS_ORDER].reverse().map(([k, nm]) => [C[k], `${nm} ${lsSeats[k]}`]), null, P.proj(H.cx, H.cy + 24, 0)); g.restore(); }
    } });

  // ---- 5. Votes into seats: the same dots split into a share-of-votes bar and a share-of-seats bar
  const VS = LS.voteShare.map(v => ({ k: v.key || v.party, vote: v.pct, seat: lsSeats[v.key || v.party] / LS.totalSeats * 100 }));
  const barsL = memo(() => {
    const src = lsColoured(), L = newLayout(), used = new Uint8Array(N);
    const W = box.w * 0.9, x0 = box.x + (box.w - W) / 2, bh = Math.min(84, box.h * 0.17), per = 9000;
    const rows = Math.max(4, Math.round(Math.sqrt(per * bh / W))), cols = Math.ceil(per / rows), step = W / cols;
    const yV = box.y + box.h * 0.22, yS = box.y + box.h * 0.6;
    const slots = (y0, key) => { const out = new Map(); let c0 = 0; VS.forEach((v, gi) => { const c1 = gi === VS.length - 1 ? cols : Math.round(c0 + cols * v[key] / 100);
      const arr = []; for (let c = c0; c < c1; c++) for (let r = 0; r < rows; r++) arr.push([x0 + (c + 0.5) * step, y0 + (r + 0.5) * step]); out.set(v.k, arr); c0 = c1; }); return out; };
    const sv = slots(yV, 'vote'), ss = slots(yS, 'seat');
    const byGroup = new Map(VS.map(v => [v.k, []])), pool = [];
    for (let i = 0; i < N; i++) { const si = src.seatOf[i]; if (si >= 0) byGroup.get(groupOfSeat[si]).push(i); else pool.push(i); }
    const place = (i, [x, y], k) => { put(L, i, x, y, 0, C[k], 0.95, step * 0.78, clamp01((x - x0) / W) * 0.75 + rnd(i, 11) * 0.2); used[i] = 1; };
    const spare = [];
    for (const v of VS) { const own = byGroup.get(v.k), need = ss.get(v.k); let o = 0;
      for (const p of need) { if (o < own.length) place(own[o++], p, v.k); }
      const vneed = sv.get(v.k); let q = 0;
      for (; q < vneed.length && o < own.length; q++) place(own[o++], vneed[q], v.k);
      v.short = vneed.slice(q); spare.push(...own.slice(o)); }
    spare.push(...pool); let sp = 0;
    for (const v of VS) for (const p of v.short) if (sp < spare.length) place(spare[sp++], p, v.k);
    L.bars = { x0, W, yV, yS, bh: rows * step };
    return finish(L, 0, used); });
  state(30.4, 2.8, barsL, { spread: 0.55, arc: 0.3 });
  B.push({ label: 'India · Lok Sabha 2024', start: 30.4, end: 38.4,
    heads: [[0, `${VS[0].vote.toFixed(1)}% of the votes became ${VS[0].seat.toFixed(1)}% of the seats.`]],
    sub: 'Share of votes and share of the 543 seats, by party group.',
    source: 'Source: ECI Statistical Report 2024 (vote share) and constituency results (seats)',
    draw(g, t, P) {
      const b = barsL().bars, a = easeOut(seg(t, 2.4, 3.2)); if (a <= 0) return;
      g.save(); g.globalAlpha *= a;
      const pr = (x, y) => P.proj(x, y, 0);
      P.text(g, 'Share of votes', ...pr(b.x0, b.yV - 14), { color: C.muted });
      P.text(g, 'Share of seats', ...pr(b.x0, b.yS - 14), { color: C.muted });
      let cv = 0, cs = 0;
      for (const v of VS) {
        const xv0 = b.x0 + b.W * cv / 100, xv1 = b.x0 + b.W * (cv + v.vote) / 100, xs0 = b.x0 + b.W * cs / 100, xs1 = b.x0 + b.W * (cs + v.seat) / 100;
        if (v.vote > 7) P.text(g, `${v.vote.toFixed(1)}%`, ...pr((xv0 + xv1) / 2, b.yV + b.bh + 22), { align: 'center', color: C.ivory, weight: 600 });
        if (v.seat > 7) { P.text(g, `${v.seat.toFixed(1)}%`, ...pr((xs0 + xs1) / 2, b.yS + b.bh + 22), { align: 'center', color: C.ivory, weight: 600 });
          P.text(g, v.k === 'INC' ? 'Congress' : v.k === 'STATE' ? 'State parties & ind.' : v.k === 'BJP' ? 'BJP' : 'Other national', ...pr((xs0 + xs1) / 2, b.yS + b.bh + 44), { align: 'center', color: C.muted }); }
        cv += v.vote; cs += v.seat;
      }
      g.restore();
    } });

  // ---- 6. Uganda's register: the dots travel west and re-form, one per 1,000 registered voters, year by year
  const reg = UG.register, nR = Math.round(reg[reg.length - 1].registered / 1000), gR = grid(nR, F === FRAMES.wide ? inset(box, 0.04) : { x: box.x, y: box.y + box.h * 0.12, w: box.w, h: box.h * 0.86 }), r0n = Math.round(reg[0].registered / 1000);
  const regL = j => () => { const L = newLayout(), lit = Math.round(reg[j].registered / 1000), prev = j ? Math.round(reg[j - 1].registered / 1000) : 0;
    for (let i = 0; i < nR; i++) { const [x, y] = gR.at(i), on = i < lit;
      put(L, i, x, y, 0, on && i >= r0n ? C.saff : C.ivory, on ? 0.92 : 0.1, gR.step * 0.66, j === 0 ? rnd(i, 12) : clamp01((i - prev) / Math.max(1, lit - prev)) * 0.9); }
    return finish(L, nR); };
  state(38.4, 3.4, regL(0), { spread: 0.55, arc: 1.4 });
  const REG_T0 = 42.2, REG_DT = 0.62;
  for (let j = 1; j < reg.length; j++) state(REG_T0 + (j - 1) * REG_DT, 0.55, regL(j), { spread: 0.85, arc: 0 });
  B.push({ label: 'Uganda · Voters’ register 2007–2025', start: 38.4, end: 48.8,
    heads: [[0, t => { const j = Math.max(0, Math.min(reg.length - 1, Math.floor((t + 38.4 - REG_T0) / REG_DT) + 1)); return `${(reg[j].registered / 1e6).toFixed(1)} million registered voters, ${reg[j].year}.`; }]],
    sub: `One dot for every 1,000 people on Uganda’s register: ${(reg[0].registered / 1e6).toFixed(1)} million in ${reg[0].year}, more than doubled by ${reg[reg.length - 1].year}.`,
    source: 'Source: Electoral Commission of Uganda, voter-register statistics 2007–2025',
    draw(g, t, P) { const a = easeOut(seg(t, 3.6, 4.2)); if (a > 0) { g.save(); g.globalAlpha *= a; P.legend(g, [[C.ivory, `On the ${reg[0].year} register`], [C.saff, 'Added since']]); g.restore(); } } });

  // ---- 7. Every polling station of 2016, mapped
  const us = u16('ugStations'), UB = FJ.uganda.box, nUS = FJ.uganda.stations;
  state(48.8, 2.8, () => { const L = newLayout(), sa = rgb(C.saff), ds = dotSize(1.2, 2.4);
    for (let i = 0; i < nUS; i++) { const [x, y] = fU.f(...deq(us, i, UB)); put(L, i, x, y, 0, sa, 0.85, ds, clamp01((x - box.x) / box.w) * 0.85 + rnd(i, 13) * 0.15); }
    return finish(L, nUS); }, { spread: 0.55, arc: 0.3, lines: { ud: 0.4 } });
  B.push({ label: 'Uganda · Polling stations', start: 48.8, end: 55.6,
    heads: [[0, `${fmtN(nUS)} polling stations, mapped.`]],
    sub: `Every polling station of the 2016 election with GPS coordinates. By 2021 there were ${fmtN(D.N.ugPres.stations2021)}.`,
    source: 'Source: Electoral Commission of Uganda, 2016 results with GPS · Districts: 2021 results' });

  // ---- 8. 2021 by district: a lattice of the 146 districts in the leader's colour, then raised by the leader's share
  const ugg = u16('ugGrid'), ugd = u8('ugGridDistrict'), nUG = FJ.uganda.grid, dist = FJ.uganda.districts;
  const ugLift = s => s / 100 * box.h * 0.16;
  const distL = raised => () => { const L = newLayout(); let step = 0;
    step = latticeStep(i => fU.f(...deq(ugg, i, UB)), nUG);
    for (let i = 0; i < nUG; i++) { const d = dist[ugd[i]], [x, y] = fU.f(...deq(ugg, i, UB));
      put(L, i, x, y, raised ? ugLift(d.s) : 0, C[d.p] || C.INDEPENDENT, 0.96, step * 0.8, raised ? d.s / 100 : rnd(i, 14)); }
    return finish(L, nUG); };
  state(55.6, 2.4, distL(false), { spread: 0.5, arc: 0.2, lines: { ud: 0.5 } });
  state(59.0, 2.2, distL(true), { spread: 0.5, arc: 0, cam: { tilt: 0.62, zoom: 0.96, py: box.y + box.h * 0.56 }, lines: { ud: 0.3 } });
  const wins = UJ.districtWins, n21 = UJ.national2021;
  B.push({ label: 'Uganda · Presidential 2021', start: 55.6, end: 64.0,
    heads: [[0, `Museveni led in ${wins.NRM} districts; Kyagulanyi in ${wins.NUP}.`]],
    sub: `Leading candidate in each of ${n21.districts} districts; height shows the leader’s share. Nationally: Museveni ${n21.museveni.toFixed(1)}%, Kyagulanyi ${n21.kyagulanyi.toFixed(1)}%.`,
    source: 'Source: Electoral Commission of Uganda, presidential results by district, 2021',
    draw(g, t, P) { const a = easeOut(seg(t, 1.8, 2.5)); if (a > 0) { g.save(); g.globalAlpha *= a;
      P.legend(g, [[C.NRM, `Museveni (NRM) ${wins.NRM}`], [C.NUP, `Kyagulanyi (NUP) ${wins.NUP}`], [C.FDC, `Amuriat (FDC) ${wins.FDC || 0}`]], 'Districts led'); g.restore(); } } });

  // ---- 9. The regions: the map unravels into four ribbons of dots, Museveni's share 2006-2021
  const yrs = UG.regionYears, rb = { x: box.x + box.w * 0.08, y: box.y + box.h * 0.06, w: box.w * 0.72, h: box.h * 0.82 };
  const RX = i => rb.x + rb.w * i / (yrs.length - 1), RY = v => rb.y + rb.h - rb.h * v / 90;
  const regionL = () => { const L = newLayout(); let i = 0;
    for (const r of UG.byRegion) { const hero = r.name === 'Northern' || r.name === 'Central', n = hero ? 2600 : 1500, th = hero ? 3.2 : 2;
      const pts = r.values.map((v, k) => [RX(k), RY(v)]), lens = [0]; for (let k = 1; k < pts.length; k++) lens.push(lens[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
      const tot = lens[lens.length - 1];
      for (let j = 0; j < n; j++, i++) { const u = (j + rnd(i, 15)) / n * tot; let k = 1; while (k < pts.length - 1 && lens[k] < u) k++;
        const f = (u - lens[k - 1]) / (lens[k] - lens[k - 1]), dx = pts[k][0] - pts[k - 1][0], dy = pts[k][1] - pts[k - 1][1], dl = Math.hypot(dx, dy), off = (rnd(i, 16) - 0.5) * 2 * th;
        put(L, i, lerp(pts[k - 1][0], pts[k][0], f) - dy / dl * off, lerp(pts[k - 1][1], pts[k][1], f) + dx / dl * off, 0, REGION_COL[r.name], hero ? 0.95 : 0.5, hero ? 2.4 : 2, u / tot * 0.85 + rnd(i, 17) * 0.05); } }
    return finish(L, i); };
  state(64.0, 3.2, regionL, { spread: 0.75, arc: 0.25 });
  const north = UG.byRegion.find(r => r.name === 'Northern').values, centre = UG.byRegion.find(r => r.name === 'Central').values;
  B.push({ label: 'Uganda · Presidential 2006–2021', start: 64.0, end: 72.0,
    heads: [[0, 'Uganda’s political map turned over.']],
    sub: `Museveni’s share of valid votes by region: the North rose from ${Math.round(north[0])}% to ${Math.round(north[3])}%, the Centre fell from ${Math.round(centre[0])}% to ${Math.round(centre[3])}%.`,
    source: 'Source: Electoral Commission of Uganda district results (2006–2016 compiled by UEDP/IRI)',
    draw(g, t, P) {
      const a = easeOut(seg(t, 1.8, 2.6)); if (a <= 0) return;
      g.save(); g.globalAlpha *= a; g.strokeStyle = C.faint; g.lineWidth = 1;
      for (const v of [0, 30, 60, 90]) { const p0 = P.proj(rb.x, RY(v), 0), p1 = P.proj(rb.x + rb.w, RY(v), 0); g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke(); P.text(g, v + '%', p0[0] - 10, p0[1] + 5, { align: 'right', color: C.muted }); }
      yrs.forEach((y, k) => { const p = P.proj(RX(k), rb.y + rb.h, 0); P.text(g, String(y), p[0], p[1] + 24, { align: 'center', color: C.muted }); });
      const b = easeOut(seg(t, 3.0, 3.6));
      if (b > 0) { g.globalAlpha *= b; const ends = UG.byRegion.map(r => ({ r, y: RY(r.values[3]) })).sort((p, q) => p.y - q.y);
        for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 22);
        for (const e of ends) { const hero = e.r.name === 'Northern' || e.r.name === 'Central', p = P.proj(RX(3) + 14, e.y, 0);
          P.text(g, `${e.r.name} ${e.r.values[3]}%`, p[0], p[1] + 5, { color: REGION_COL[e.r.name], weight: hero ? 600 : 500 }); } }
      g.restore();
    } });

  // ---- 10. Turnout: one column per election, one dot per 10,000 registered; lit dots voted
  const TO = UG.turnout, cb = { x: box.x + box.w * 0.04, y: box.y + box.h * 0.1, w: box.w * 0.92, h: box.h * 0.76 };
  const colsPer = 14, maxRows = Math.ceil(Math.max(...TO.map(e => e.registered)) / 1e4 / colsPer);
  const tStep = Math.min(cb.w / (TO.length * colsPer + (TO.length - 1) * 5), cb.h / maxRows), colW = colsPer * tStep, gap = (cb.w - TO.length * colW) / (TO.length - 1);
  const colX = k => cb.x + k * (colW + gap), base = cb.y + cb.h;
  state(72.0, 2.8, () => { const L = newLayout(); let i = 0;
    TO.forEach((e, k) => { const n = Math.round(e.registered / 1e4), lit = Math.round(e.cast / 1e4);
      for (let j = 0; j < n; j++, i++) put(L, i, colX(k) + (j % colsPer + 0.5) * tStep, base - (Math.floor(j / colsPer) + 0.5) * tStep, 0, j < lit ? C.saff : C.ivory, j < lit ? 0.95 : 0.16, tStep * 0.7, k / TO.length * 0.5 + j / n * 0.4); });
    return finish(L, i); }, { spread: 0.6, arc: 0.25 });
  B.push({ label: 'Uganda · Presidential turnout 1996–2021', start: 72.0, end: 80.0,
    heads: [[0, `Turnout fell from ${TO[0].pct}% in ${TO[0].year} to ${TO[TO.length - 1].pct}% in ${TO[TO.length - 1].year}.`]],
    sub: 'One dot for every 10,000 registered voters; lit dots are votes cast.',
    source: 'Source: Electoral Commission of Uganda, presidential results 1996–2021',
    draw(g, t, P) { const a = easeOut(seg(t, 1.2, 2.0)); if (a <= 0) return; g.save(); g.globalAlpha *= a;
      TO.forEach((e, k) => { const cx = colX(k) + colW / 2, top = base - Math.ceil(e.registered / 1e4 / colsPer) * tStep;
        const pb = P.proj(cx, base, 0), pt = P.proj(cx, top, 0);
        P.text(g, String(e.year), pb[0], pb[1] + 24, { align: 'center', color: C.muted });
        P.text(g, `${e.pct}%`, pt[0], pt[1] - 12, { align: 'center', color: C.ivory, weight: 600 }); });
      g.restore(); } });

  // ---- 11. Parliament grows: the hemicycle adds seats election by election, then takes the 2026 result
  const GR = UG.growth, KUG = 60, last = UG.seats[UG.seats.length - 1];
  const UG_ORDER = ['NUP', 'FDC', 'DP', 'UPC', 'ANT', 'JEEMA', 'PPP', 'INDEPENDENT', 'NO RESULT', 'NRM'].filter(k => last.seats[k]);
  const partyOfSeat = []; UG_ORDER.forEach(k => { for (let j = 0; j < last.seats[k]; j++) partyOfSeat.push(k); });
  const hemiOf = memo(() => new Map(GR.map(e => [e.constituencies, hemicycle(e.constituencies, inset(box, 0.02))])));
  const growth = GR.filter((e, k) => k === 0 || e.constituencies !== GR[k - 1].constituencies);
  const P_T0 = 80.0, P_STEPS = [80.0, 83.2, 84.7, 86.2];
  growth.forEach((e, k) => state(P_STEPS[k], k ? 1.1 : 2.6, () => seatLayout(hemiOf().get(e.constituencies), KUG, () => [C.ivory, 0.85], (si, j) => si / e.constituencies * 0.6 + rnd(j, si) * 0.3), { spread: k ? 0.3 : 0.5, arc: k ? 0.1 : 0.3 }));
  const ugFinal = memo(() => seatLayout(hemiOf().get(last.total), KUG, si => [C[partyOfSeat[si]] || C.INDEPENDENT, 0.95], si => UG_ORDER.indexOf(partyOfSeat[si]) / UG_ORDER.length * 0.8 + rnd(si, 4) * 0.1));
  const P_COLOUR = 87.8;
  state(P_COLOUR, 1.8, ugFinal, { spread: 0.5, arc: 0 });
  const women = GR[GR.length - 1].women;
  B.push({ label: 'Uganda · Parliament 2006–2026', start: P_T0, end: 94.0,
    heads: [[0, t => { let k = 0; P_STEPS.forEach((s, j) => { if (t + P_T0 >= s && j < growth.length) k = j; }); return `${growth[k].constituencies} constituency seats, ${growth[k].year}.`; }],
      [P_COLOUR - P_T0, `${last.year}: the NRM won ${last.seats.NRM} of ${last.total} constituency seats.`]],
    sub: `Directly elected constituency seats only; ${women} district woman representatives also sit.`,
    source: 'Source: Electoral Commission of Uganda, parliamentary results 2006–2026',
    draw(g, t, P) { const a = easeOut(seg(t, P_COLOUR - P_T0 + 1.2, P_COLOUR - P_T0 + 1.9)); if (a <= 0) return;
      const H = hemiOf().get(last.total); g.save(); g.globalAlpha *= a;
      P.legend(g, [...UG_ORDER].reverse().map(k => [C[k] || C.INDEPENDENT, `${UG_NAME[k] || k} ${last.seats[k]}`]), null, P.proj(H.cx, H.cy + 24, 0)); g.restore(); } });

  // ---- 12. Close: the dots settle into a slow wave; the reversed logo
  state(94.0, 3.2, () => { const L = newLayout(), cols = 200, rows = N / cols, iv = rgb(C.ivory), sa = rgb(C.saff);
    for (let i = 0; i < N; i++) { const c = i % cols, r = Math.floor(i / cols), x = -0.4 * F.FW + c / (cols - 1) * 1.8 * F.FW, y = 0.15 * F.FH + r / (rows - 1) * 1.5 * F.FH;
      const band = Math.sin(x * 0.004 + y * 0.003) > 0.9; put(L, i, x, y, 0, band ? sa : iv, band ? 0.85 : 0.45, 2.6, rnd(i, 18)); }
    return L; }, { spread: 0.5, arc: 0.4, cam: { tilt: 1.12, zoom: 1, wave: 1, px: F.FW / 2, py: F.FH * 0.62 } });
  B.push({ label: '', start: 94.0, end: 101.0, heads: [[0, '']], sub: '', source: 'Every figure in this film is drawn from official results held by Polity Lab.', outro: true });

  return { S, B, total: 101.0 };
}

// ---------------------------------------------------------------- engine
function wrapLines(g, text, maxW) {
  const words = text.split(' '), lines = []; let line = '';
  for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t; }
  if (line) lines.push(line); return lines;
}
function lineGeometry(rings, f) {
  const pos = [];
  for (const r of rings) for (let i = 1; i < r.length; i++) { const a = f(...r[i - 1]), b = f(...r[i]); pos.push(a[0], a[1], 0, b[0], b[1], 0); }
  return pos;
}

export async function mountFilm(host, { start = 0, mode = 'wide', record = false, size = null } = {}) {
  const fallback = async () => { const { mountReel } = await import('./reel.js'); return mountReel(host, { start: 0, compact: mode !== 'wide', record, size }); };
  const testGL = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
  if (!testGL) return fallback();
  const D = await loadData();
  if (!D.N || !D.UG || !D.UJ || !D.O || !D.ST || !D.FJ || !D.bin) return fallback();
  await Promise.all([`500 40px ${SERIF}`, `400 16px ${SANS}`, `600 16px ${SANS}`, `500 14px ${MONO}`].map(f => document.fonts.load(f).catch(() => {})));
  const F = FRAMES[mode] || FRAMES.wide, { S, B, total } = script(D, F);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const logo = new Image(); logo.src = 'brand/reversed/PolityLab_Reversed_White_Saffron.png';

  // ---- DOM: WebGL canvas + 2D overlay, controls
  const stage = document.createElement('div'); stage.className = 'film-stage';
  const glc = document.createElement('canvas'), ov = document.createElement('canvas');
  glc.setAttribute('aria-hidden', 'true'); ov.setAttribute('role', 'img');
  stage.append(glc, ov); host.appendChild(stage); host.classList.add('film');
  let ui = null;
  if (!record) {
    ui = document.createElement('div'); ui.className = 'reel-ui';
    ui.innerHTML = `<button class="reel-play" type="button" aria-label="Pause the film"><span></span></button>` +
      B.map((b, i) => `<button class="reel-seg" type="button" aria-label="Show part ${i + 1}: ${b.label || 'Close'}"><i></i></button>`).join('');
    host.appendChild(ui);
  }
  const cap = host.parentElement?.querySelector('.reel-source');

  // ---- three.js
  const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!record });
  renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene(), FOV = 24, dist = (F.FH / 2) / Math.tan(FOV / 2 * Math.PI / 180);
  const camera = new THREE.PerspectiveCamera(FOV, F.FW / F.FH, 10, dist * 4);
  camera.position.set(0, 0, dist);
  const rig = new THREE.Group(), inner = new THREE.Group(); rig.add(inner); scene.add(rig);
  const W3 = (x, y, z = 0) => [x - F.FW / 2, F.FH / 2 - y, z];

  const geo = new THREE.BufferGeometry();
  const A = { aFrom: 3, aTo: 3, aCf: 4, aCt: 4, aS: 2, aD: 2 }, buf = {};
  for (const [k, n] of Object.entries(A)) { buf[k] = new Float32Array(N * n); geo.setAttribute(k, new THREE.BufferAttribute(buf[k], n)); }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  for (let i = 0; i < N; i++) buf.aD[i * 2 + 1] = rnd(i, 99);
  const U = { uP: { value: 0 }, uSpread: { value: 0 }, uArc: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 }, uFocus: { value: dist }, uWave: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: /* glsl */`
      attribute vec3 aFrom, aTo; attribute vec4 aCf, aCt; attribute vec2 aS, aD;
      uniform float uP, uSpread, uArc, uTime, uPx, uFocus, uWave;
      varying vec4 vC;
      float io(float t){ return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0; }
      void main(){
        float l = clamp((uP - aD.x * uSpread) / max(1e-4, 1.0 - uSpread), 0.0, 1.0), e = io(l);
        vec3 d = aTo - aFrom; float len = length(d.xy);
        vec3 p = mix(aFrom, aTo, e);
        float bump = sin(3.14159265 * e);
        vec2 nrm = len > 1e-3 ? vec2(-d.y, d.x) / len : vec2(0.0);
        p.xy += nrm * bump * len * uArc * (aD.y - 0.5);
        p.z += bump * len * uArc * 0.35 * (aD.y - 0.3);
        p.xy += vec2(sin(uTime * 0.7 + aD.y * 61.0), cos(uTime * 0.55 + aD.y * 37.0)) * 0.35;
        p.z += uWave * 26.0 * sin(p.x * 0.011 + uTime * 0.9) * cos(p.y * 0.013 + uTime * 0.6);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float blur = abs(-mv.z - uFocus) / uFocus;
        vC = mix(aCf, aCt, e);
        float ps = mix(aS.x, aS.y, e) * uPx * (uFocus / -mv.z) * (1.0 + blur * 2.5);
        vC.a /= 1.0 + blur * 3.0;
        if (ps < 1.0) { vC.a *= ps; ps = 1.0; }
        gl_PointSize = ps;
      }`,
    fragmentShader: /* glsl */`
      varying vec4 vC;
      void main(){ float d = length(gl_PointCoord - 0.5), a = smoothstep(0.5, 0.4, d) * vC.a; if (a < 0.004) discard; gl_FragColor = vec4(vC.rgb, a); }`,
  });
  const points = new THREE.Points(geo, mat); points.frustumCulled = false; inner.add(points);

  // boundaries: India (Survey of India outline + state lines) and Uganda districts, in the same frame coordinates
  const fI = fitter(D.O.bbox, KI, F.box), fU = fitter(D.UJ.bbox, KU, F.box);
  const mkLines = (pos, hex) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos.map((v, i) => i % 3 === 0 ? v - F.FW / 2 : i % 3 === 1 ? F.FH / 2 - v : v)), 3));
    const m = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0, depthTest: false, depthWrite: false }); const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.visible = false; inner.add(l); return l; };
  const LINES = { io: mkLines(lineGeometry(D.O.rings, fI.f), 0xf4efe6), is: mkLines(lineGeometry(D.ST.states.flatMap(s => s.rings), fI.f), 0xf4efe6),
    ud: mkLines(lineGeometry(D.UJ.districts.flatMap(d => d.polys.flat()), fU.f), 0xf4efe6) };

  // ---- layouts (computed on demand, few kept)
  const cache = new Map();
  const layout = i => { if (cache.has(i)) return cache.get(i); const L = S[i].make();
    for (let k = 0; k < N; k++) { const p = W3(L.pos[k * 3], L.pos[k * 3 + 1], L.pos[k * 3 + 2]); L.pos[k * 3] = p[0]; L.pos[k * 3 + 1] = p[1]; L.pos[k * 3 + 2] = p[2]; }
    cache.set(i, L); if (cache.size > 5) cache.delete(cache.keys().next().value); return L; };
  // make() may hand back a memoised object: convert a copy, never the shared original
  for (const s of S) { const mk = s.make; s.make = () => { const L = mk(); return { pos: L.pos.slice(), col: L.col, size: L.size, del: L.del }; }; }
  let cur = -1;
  function load(i) {
    const a = layout((i - 1 + S.length) % S.length), b = layout(i);
    buf.aFrom.set(a.pos); buf.aTo.set(b.pos); buf.aCf.set(a.col); buf.aCt.set(b.col);
    for (let k = 0; k < N; k++) { buf.aS[k * 2] = a.size[k]; buf.aS[k * 2 + 1] = b.size[k]; buf.aD[k * 2] = b.del[k]; }
    for (const k of Object.keys(A)) geo.attributes[k].needsUpdate = true;
    cur = i;
  }

  // ---- sizing
  let cssW = 1, cssH = 1, dpr = 1;
  const g = ov.getContext('2d');
  const resize = () => {
    cssW = size ? size[0] : host.clientWidth || 800; cssH = size ? size[1] : Math.round(cssW * F.FH / F.FW);
    dpr = size ? 1 : Math.min(devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr); renderer.setSize(cssW, cssH, false);
    glc.style.width = ov.style.width = cssW + 'px'; glc.style.height = ov.style.height = cssH + 'px';
    ov.width = Math.round(cssW * dpr); ov.height = Math.round(cssH * dpr);
    U.uPx.value = cssW * dpr / F.FW;
  };
  resize();
  if (!size) new ResizeObserver(() => { if (Math.abs(host.clientWidth - cssW) > 1) resize(); }).observe(host);

  // ---- overlay helpers (all in frame units)
  const k = () => cssW / F.FW;                       // CSS px per frame unit
  const fs = px => record ? px * 1.5 : Math.max(px / k(), px * 0.8); // screen: constant CSS size; video: readable at 1080p
  const v3 = new THREE.Vector3();
  const P = {
    proj(x, y, z) { const p = W3(x, y, z); v3.set(p[0], p[1], p[2]).applyMatrix4(inner.matrixWorld).project(camera); return [(v3.x + 1) / 2 * F.FW, (1 - v3.y) / 2 * F.FH]; },
    text(gg, s, x, y, o = {}) { gg.font = `${o.weight || 500} ${fs(o.size || 13)}px ${SANS}`; gg.textAlign = o.align || 'left'; gg.fillStyle = o.color || C.muted; gg.fillText(s, x, y); },
    pin(gg, x, y, s) { gg.fillStyle = C.ivory; gg.beginPath(); gg.arc(x, y, fs(3), 0, Math.PI * 2); gg.fill(); gg.strokeStyle = 'rgba(244,239,230,.6)'; gg.lineWidth = 1; gg.beginPath(); gg.moveTo(x, y); gg.lineTo(x + fs(18), y - fs(18)); gg.stroke();
      P.text(gg, s, x + fs(22), y - fs(20), { color: C.ivory, weight: 600 }); },
    legend(gg, items, title, at) {
      const sz = fs(13), row = sz * 1.75;
      if (at) { // one centred row (wraps) under a chart
        gg.font = `500 ${sz}px ${SANS}`; const ws = items.map(([, s]) => gg.measureText(s).width + sz * 2.2), maxW = F.box.w;
        const rows = [[]]; let w = 0; ws.forEach((wi, i) => { if (w + wi > maxW && rows[rows.length - 1].length) { rows.push([]); w = 0; } rows[rows.length - 1].push(i); w += wi; });
        rows.forEach((r, ri) => { let x = at[0] - r.reduce((a, i) => a + ws[i], 0) / 2; const y = at[1] + ri * row;
          for (const i of r) { gg.fillStyle = items[i][0]; gg.fillRect(x, y - sz * 0.8, sz * 0.9, sz * 0.9); P.text(gg, items[i][1], x + sz * 1.35, y, { color: C.ivory }); x += ws[i]; } });
        return;
      }
      if (F !== FRAMES.wide && (!title || F === FRAMES.tall)) { // narrow frames: rows under the headline, clear of the chart
        gg.font = `500 ${sz}px ${SANS}`; let x = F.tx, y = P.textBottom + fs(16);
        for (const [c, s] of items) { const w = gg.measureText(s).width + sz * 2.6; if (x > F.tx && x + w > F.tx + F.tw) { x = F.tx; y += row; }
          gg.fillStyle = c; gg.fillRect(x, y - sz * 0.8, sz * 0.9, sz * 0.9); P.text(gg, s, x + sz * 1.35, y, { color: C.ivory }); x += w; }
        return;
      }
      const x = F === FRAMES.wide ? F.tx : F.box.x, y0 = F === FRAMES.wide ? P.textBottom + fs(34) : F.box.y + fs(18);
      if (title) { gg.font = `500 ${fs(11)}px ${MONO}`; gg.fillStyle = C.muted; gg.textAlign = 'left'; gg.fillText(title.toUpperCase(), x, y0); }
      items.forEach(([c, s], i) => { const y = y0 + (title ? row : 0) + i * row; gg.fillStyle = c; gg.fillRect(x, y - sz * 0.8, sz * 0.9, sz * 0.9); P.text(gg, s, x + sz * 1.4, y, { color: C.ivory }); });
    },
    textBottom: 0,
  };

  // ---- frame
  let clock = 0, playing = !reduce && !record, visible = true, raf = 0, lastBeat = -1, errLogged = false;
  const beatAt = c => { let i = 0; B.forEach((b, k) => { if (c >= b.start) i = k; }); return i; };
  const setClock = c => { clock = ((c % total) + total) % total; };
  setClock(reduce ? B[start]?.end - 0.4 : B[start]?.start ?? 0);

  function render() {
    let i = 0; for (let k2 = 0; k2 < S.length; k2++) if (S[k2].at <= clock) i = k2;
    if (i !== cur) load(i);
    const st = S[i], prev = S[(i - 1 + S.length) % S.length], p = clamp01((clock - st.at) / st.dur), e = ease(p);
    U.uP.value = p; U.uSpread.value = st.spread; U.uArc.value = st.arc; U.uTime.value = clock;
    const cam = {}; for (const key of Object.keys(st.cam)) cam[key] = lerp(prev.cam[key], st.cam[key], e);
    U.uWave.value = cam.wave;
    const pv = W3(cam.px, cam.py);
    rig.position.set(pv[0], pv[1], 0); inner.position.set(-pv[0], -pv[1], 0);
    rig.rotation.set(-cam.tilt, 0.035 * Math.sin(clock * 0.21) * cam.tilt, 0); rig.scale.setScalar(cam.zoom);
    for (const [key, l] of Object.entries(LINES)) { const o = lerp(prev.lines[key], st.lines[key], e); l.material.opacity = o * 0.55; l.visible = o > 0.003; }
    rig.updateMatrixWorld(true);
    renderer.render(scene, camera);
    overlay();
  }

  function overlay() {
    const bi = beatAt(clock), b = B[bi], t = clock - b.start, dur = b.end - b.start, s = F === FRAMES.wide ? 1 : 1;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ov.width, ov.height);
    g.setTransform(ov.width / F.FW, 0, 0, ov.height / F.FH, 0, 0);
    // vignette
    const vg = g.createRadialGradient(F.FW / 2, F.FH / 2, Math.min(F.FW, F.FH) * 0.35, F.FW / 2, F.FH / 2, Math.max(F.FW, F.FH) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = vg; g.fillRect(0, 0, F.FW, F.FH);
    const env = Math.min(easeOut(seg(t, 0.15, 0.85)), 1 - ease(seg(t, dur - 0.55, dur - 0.05)));
    g.globalAlpha = env; g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    const narrow = mode !== 'wide' && cssW < 520;
    let y = F.ty;
    if (b.label) { g.fillStyle = C.saff; g.fillRect(F.tx, y - fs(10) * s, fs(22), fs(2.2)); g.font = `500 ${fs(F === FRAMES.tall ? 15 : 12)}px ${MONO}`; g.fillText(b.label.toUpperCase(), F.tx + fs(32), y - fs(4)); }
    // headline: the current one of the beat's headlines, rising in line by line
    let hi = 0; b.heads.forEach(([at], k2) => { if (t >= at) hi = k2; });
    const [hAt, hTxt] = b.heads[hi], head = typeof hTxt === 'function' ? hTxt(t) : hTxt;
    const hs = record ? F.head : Math.max(F.head, narrow ? 21 / k() : 0), lh = hs * 1.16;
    g.font = `500 ${hs}px ${SERIF}`; g.fillStyle = C.ivory;
    const lines = head ? wrapLines(g, head, F.tw) : [];
    const hIn = hi === 0 ? 1 : easeOut(seg(t, hAt, hAt + 0.6));
    lines.forEach((ln, k2) => { const r = easeOut(seg(t, (hi ? hAt : 0.15) + k2 * 0.09, (hi ? hAt : 0.15) + 0.8 + k2 * 0.09));
      g.globalAlpha = env * hIn * r; g.fillText(ln, F.tx, y + hs + k2 * lh + (1 - r) * 16); });
    g.globalAlpha = env;
    y += hs + lines.length * lh;
    if (b.sub && !narrow) { g.font = `400 ${fs(F === FRAMES.tall ? 19 : 15)}px ${SANS}`; g.fillStyle = C.muted;
      const sl = wrapLines(g, b.sub, F.tw); sl.forEach((ln, k2) => g.fillText(ln, F.tx, y + fs(6) + k2 * fs(22))); y += fs(6) + sl.length * fs(22); }
    P.textBottom = y;
    if (b.draw) { g.save(); try { b.draw(g, t, P); } catch (err) { if (!errLogged) { errLogged = true; console.error('Film part', bi + 1, err); } } finally { g.restore(); } }
    g.globalAlpha = env;
    if (b.outro && logo.complete && logo.naturalWidth) { // reversed logo on black: approved use; never wider than its file allows
      const a = easeOut(seg(t, 1.4, 2.4)), lw = Math.min(220, F.FW * 0.22), lh2 = lw * logo.naturalHeight / logo.naturalWidth;
      g.globalAlpha = env * a; g.drawImage(logo, (F.FW - lw) / 2, F.FH * 0.36 - lh2 / 2, lw, lh2);
      P.text(g, 'politylab.org', F.FW / 2, F.FH * 0.36 + lh2 / 2 + fs(40), { align: 'center', color: C.muted, size: 14 });
      g.globalAlpha = env;
    }
    // source line and site name, inside the frame (also in the exported video)
    if (mode !== 'compact' || record) { const yb = F.FH - fs(record ? 30 : 46);
      if (F === FRAMES.tall) { // tall: the source wraps on its own lines, the site name above it
        g.font = `500 ${fs(12)}px ${SANS}`; const sl = wrapLines(g, b.source, F.tw), lh = fs(17);
        sl.forEach((ln, k2) => P.text(g, ln, F.tx, yb - (sl.length - 1 - k2) * lh, { size: 12, color: C.muted }));
        if (!b.outro) P.text(g, 'politylab.org', F.tx, yb - sl.length * lh - fs(6), { size: 12, color: C.ivory });
      } else { P.text(g, b.source, F.tx, yb, { size: 12, color: C.muted });
        if (!b.outro) P.text(g, 'politylab.org', F.FW - F.tx, yb, { size: 12, align: 'right', color: C.muted }); } }
    g.globalAlpha = 1;
    if (record || mode === 'wide') { g.fillStyle = C.faint; g.fillRect(0, F.FH - 4, F.FW, 4); g.fillStyle = C.saff; g.fillRect(0, F.FH - 4, F.FW * clock / total, 4); }
    if (bi !== lastBeat) {
      lastBeat = bi;
      const h = b.heads[b.heads.length - 1][1], finalHead = typeof h === 'function' ? h(dur) : h;
      ov.setAttribute('aria-label', `Data film, part ${bi + 1} of ${B.length}: ${finalHead} ${b.sub} ${b.source}`);
      if (cap && mode === 'compact') cap.textContent = b.source;
    }
    if (ui) ui.querySelectorAll('.reel-seg').forEach((el, k2) => el.style.setProperty('--p', k2 < bi ? 1 : k2 > bi ? 0 : clamp01(t / dur)));
  }

  let last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!visible || document.hidden) return;
    if (playing) setClock(clock + dt);
    render();
  }
  const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.1 });
  if (!record) { io.observe(host); raf = requestAnimationFrame(frame); } else render();
  if (ui) {
    const btn = ui.querySelector('.reel-play');
    const setPlay = p => { playing = p; btn.classList.toggle('paused', !p); btn.setAttribute('aria-label', p ? 'Pause the film' : 'Play the film'); };
    setPlay(playing);
    btn.addEventListener('click', () => setPlay(!playing));
    ui.querySelectorAll('.reel-seg').forEach((el, k2) => el.addEventListener('click', () => { setClock(playing ? B[k2].start + 0.01 : B[k2].end - 0.4); render(); }));
  }
  return {
    total, parts: B.length, canvas: ov, glCanvas: glc, frameSize: [F.FW, F.FH],
    seek(sec) { setClock(sec); render(); },
    // for the video export: draw the current frame (dots + text) onto a 2D context
    composite(ctx) { ctx.drawImage(glc, 0, 0, ctx.canvas.width, ctx.canvas.height); ctx.drawImage(ov, 0, 0, ctx.canvas.width, ctx.canvas.height); },
    stop() { cancelAnimationFrame(raf); io.disconnect(); renderer.dispose(); geo.dispose(); mat.dispose(); },
  };
}

// Auto-mount every [data-film] on the page, when it first comes near the viewport (the data is ~2 MB).
for (const el of document.querySelectorAll('[data-film]')) {
  let started = false;
  const go = () => !started && (started = true) && mountFilm(el, { start: Number(el.dataset.start || 0), mode: el.dataset.film || 'wide' }).then(r => { el.film = r; })
    .catch(err => { console.error('Data film', err); el.classList.add('reel-failed'); });
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '400px' });
  io.observe(el);
  setTimeout(() => { io.disconnect(); go(); }, 6000); // in case the observer never reports (some embedded views)
}
