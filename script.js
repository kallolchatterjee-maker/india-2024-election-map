/*============================================================================
  The Majority — India 2024 Lok Sabha scrollytelling map
  ----------------------------------------------------------------------------
  Data sources:
    data/india_pc_2019_simplified.geojson   — constituency boundaries
    data/lok_sabha_2024_constituency_winners.csv — 2024 winner per seat
    data/national.json — official national and state-level election statistics
  Every figure MUST be verified against indiavotes.com / ECI before publishing.
  ============================================================================*/
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// BJP winners are highlighted; other results remain neutral.
// ---------------------------------------------------------------------------
const RESULT_COLOR = {
  bjp: 0xff6600,
  other: 0x9aa5b1
};
const TURNOUT_BINS = [
  { label: 'under 60%', min: 0, max: 60, color: '#f6e3cc' },
  { label: '60–65%', min: 60, max: 65, color: '#f7c79a' },
  { label: '65–70%', min: 65, max: 70, color: '#f6a560' },
  { label: '70–75%', min: 70, max: 75, color: '#ff7a1f' },
  { label: '75–80%', min: 75, max: 80, color: '#d65400' },
  { label: '80% and over', min: 80, max: 101, color: '#8a3300' }
];
const C = {};
let needsRender = true;
let prevMarginActive = false;
function cs() {
  const s = getComputedStyle(document.documentElement);
  ['bg', 'tile', 'n', 'i', 'o', 'line', 'map-line'].forEach(k => {
    const v = s.getPropertyValue('--' + k).trim();
    C[k] = new THREE.Color(v || '#000000');
  });
  needsRender = true;
}
cs();

// ---------------------------------------------------------------------------
// Damped spring animator — frame-rate independent and critically damped, so
// map moves settle smoothly without overshoot or a long sluggish tail.
// ---------------------------------------------------------------------------
class Spring {
  constructor(value = 0) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.w = 7.5;   // natural frequency (rad/s) — higher = snappier
    this.z = 1.0;   // damping ratio — 1.0 = critical damping, no overshoot
  }
  setTarget(target) { this.target = target; }
  update(dt) {
    if (reduce) { this.value = this.target; this.velocity = 0; return true; }
    const x = this.value - this.target;
    const a = -(2 * this.z * this.w) * this.velocity - (this.w * this.w) * x;
    this.velocity += a * dt;
    this.value += this.velocity * dt;
    const settled = Math.abs(x) < 0.01 && Math.abs(this.velocity) < 0.5;
    if (settled) { this.value = this.target; this.velocity = 0; }
    return settled;
  }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------
let scene, camera, renderer, linesMesh;
let csData = [];
let stationPoints;
let particleLayouts;
let currentParticleStage = 'map';
let turnoutLabels = [];
let springTx, springTz, springZoom, springOrbit, springTilt, reduce;
let systemReduceMotion = false;
let motionOverride = null;
let mapBounds, stateBounds;
let animationFrame = 0;
let raycaster, mouseVec, constituencyMeshes, meshToC, pcTooltip, tooltipInner, hoveredPC;
let orbitDragging = false, orbitLastX = 0, orbitTargetAngle = 0;
// ---------------------------------------------------------------------------
// Helper: walk every (lon, lat) point in a geometry, calling fn(lon, lat)
// ---------------------------------------------------------------------------
function forEachPoint(geometry, fn) {
  const coords = geometry.coordinates;
  if (geometry.type === 'MultiPolygon') {
    coords.forEach(polygon => {
      polygon.forEach(ring => {
        ring.forEach(p => fn(p[0], p[1]));
      });
    });
  } else if (geometry.type === 'Polygon') {
    coords.forEach(ring => {
      ring.forEach(p => fn(p[0], p[1]));
    });
  }
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geometryContainsPoint(geometry, lon, lat) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some(rings => pointInRing(lon, lat, rings[0])
    && !rings.slice(1).some(ring => pointInRing(lon, lat, ring)));
}

function turnoutStateKey(name) {
  const key = normalizeName(name);
  const aliases = {
    andamannicobar: 'andamanandnicobarislands',
    andamanandnicobar: 'andamanandnicobarislands',
    dadranagarhaveli: 'dadraandnagarhavelianddamananddiu',
    dadraandnagarhaveli: 'dadraandnagarhavelianddamananddiu',
    damandiu: 'dadraandnagarhavelianddamananddiu',
    delhi: 'delhinct',
    jammukashmir: 'jammuandkashmir',
    orissa: 'odisha'
  };
  return aliases[key] || key;
}

function turnoutRegionKey(feature) {
  return normalizeName(feature.properties.pc_name) === 'ladakh'
    ? 'ladakh'
    : turnoutStateKey(feature.properties.st_name);
}

function radicalInverse(value, base) {
  let result = 0;
  let factor = 1 / base;
  while (value > 0) {
    result += (value % base) * factor;
    value = Math.floor(value / base);
    factor /= base;
  }
  return result;
}

function particleNoise(index, salt) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function makeTurnoutGrid(features, featureBounds, national, count, cx, cy, scale, mapHeight) {
  const regions = new Map();
  features.forEach((feature, index) => {
    const key = turnoutRegionKey(feature);
    const items = regions.get(key) || [];
    items.push({ feature, bounds: featureBounds[index] });
    regions.set(key, items);
  });

  const states = national.turnout2024.states;
  const totalStations = states.reduce((sum, state) => sum + state.stations, 0);
  const allocations = states.map(state => {
    const exact = count * state.stations / totalStations;
    return { state, count: Math.floor(exact), remainder: exact % 1 };
  });
  let remaining = count - allocations.reduce((sum, item) => sum + item.count, 0);
  allocations.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < remaining; i++) allocations[i].count++;

  const positions = new Float32Array(count * 3);
  const turnout = new Float32Array(count);
  const centers = new Map();
  let dot = 0;
  allocations.forEach(({ state, count: stateCount }, stateIndex) => {
    const stateFeatures = regions.get(turnoutStateKey(state.name));
    if (!stateFeatures || !stateFeatures.length) {
      throw new Error(`Missing constituency boundaries for ${state.name} turnout.`);
    }
    const bounds = stateFeatures.reduce((result, item) => ({
      minX: Math.min(result.minX, item.bounds.minX),
      maxX: Math.max(result.maxX, item.bounds.maxX),
      minY: Math.min(result.minY, item.bounds.minY),
      maxY: Math.max(result.maxY, item.bounds.maxY)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    let placed = 0;
    let candidate = 0;
    const maxCandidates = Math.max(10000, stateCount * 1000);
    while (placed < stateCount && candidate < maxCandidates) {
      const sequence = candidate++ + 1 + stateIndex * 4099;
      const lon = bounds.minX + radicalInverse(sequence, 2) * (bounds.maxX - bounds.minX);
      const lat = bounds.minY + radicalInverse(sequence, 3) * (bounds.maxY - bounds.minY);
      const inside = stateFeatures.some(item =>
        lon >= item.bounds.minX && lon <= item.bounds.maxX
        && lat >= item.bounds.minY && lat <= item.bounds.maxY
        && geometryContainsPoint(item.feature.geometry, lon, lat));
      if (!inside) continue;

      const i3 = dot * 3;
      positions[i3] = -(lon - cx) * scale;
      positions[i3 + 1] = 2 + (state.turnout - 50) / 35 * mapHeight * 0.12;
      positions[i3 + 2] = (lat - cy) * scale;
      turnout[dot] = state.turnout;
      const center = centers.get(state.name) || { x: 0, z: 0, count: 0, turnout: state.turnout };
      center.x += positions[i3];
      center.z += positions[i3 + 2];
      center.count++;
      centers.set(state.name, center);
      dot++;
      placed++;
    }
    if (placed !== stateCount) {
      throw new Error(`Could only place ${placed} of ${stateCount} turnout dots in ${state.name}.`);
    }
  });
  centers.forEach(center => {
    center.x /= center.count;
    center.z /= center.count;
  });
  return { positions, turnout, centers };
}

// ---------------------------------------------------------------------------
// Helper: build THREE shapes from a geometry, scaled & centred
// ---------------------------------------------------------------------------
function buildShapes(geometry, sx, sy, cx, cy) {
  const shapes = [];
  const addRing = (ring) => {
    const pts = ring.map(([lon, lat]) => new THREE.Vector2(-(lon - cx) * sx, -(lat - cy) * sy));
    return new THREE.Shape(pts);
  };
  const coords = geometry.coordinates;
  if (geometry.type === 'MultiPolygon') {
    coords.forEach(polygon => {
      const rings = polygon;
      const shape = addRing(rings[0]);
      for (let h = 1; h < rings.length; h++) shape.holes.push(addRing(rings[h]));
      shapes.push(shape);
    });
  } else if (geometry.type === 'Polygon') {
    const rings = coords;
    const shape = addRing(rings[0]);
    for (let h = 1; h < rings.length; h++) shape.holes.push(addRing(rings[h]));
    shapes.push(shape);
  }
  return shapes;
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some(value => value !== '')) rows.push(row);
  const headers = (rows.shift() || []).map(value => value.replace(/^\uFEFF/, '').trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function normalizeName(value) {
  return (value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Load geo + CSV data
// ---------------------------------------------------------------------------
async function loadData() {
  const [geoRes, csvRes, stateRes, ge2024Res, nationalRes, stationRes] = await Promise.all([
    fetch('data/india_pc_2019_simplified.geojson'),
    fetch('data/lok_sabha_2024_constituency_winners.csv'),
    fetch('data/lok_sabha_2024_state_seats.csv'),
    fetch('data/GE2024.json'),
    fetch('data/national.json'),
    fetch('data/film.bin')
  ]);
  for (const [response, path] of [
    [geoRes, 'data/india_pc_2019_simplified.geojson'],
    [csvRes, 'data/lok_sabha_2024_constituency_winners.csv'],
    [stateRes, 'data/lok_sabha_2024_state_seats.csv'],
    [ge2024Res, 'data/GE2024.json'],
    [nationalRes, 'data/national.json'],
    [stationRes, 'data/film.bin']
  ]) {
    if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  }
  const geojson = await geoRes.json();
  const ge2024 = await ge2024Res.json();
  const national = await nationalRes.json();
  const stationBuffer = await stationRes.arrayBuffer();
  const [winnerRows, stateRows] = await Promise.all([
    csvRes.text().then(parseCSV),
    stateRes.text().then(parseCSV)
  ]);
  const winners = new Map(winnerRows.map(row => [normalizeName(row.constituency), row]));

  // First pass: compute overall bounds of all geometry
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const featureBounds = geojson.features.map(feature => {
    const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    forEachPoint(feature.geometry, (x, y) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
    });
    return bounds;
  });
  // Fit India into a ~1200-unit wide view, keep aspect
  const width = maxX - minX;
  const height = maxY - minY;
  const targetWidth = 1200;
  const scale = targetWidth / width;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const mapHeight = height * scale;
  const stationCount = 24000;
  const stationValues = new Uint16Array(stationBuffer);
  if (stationValues.length < stationCount * 2) {
    throw new Error(`data/film.bin contains ${Math.floor(stationValues.length / 2)} coordinate pairs; ${stationCount} are required.`);
  }
  const indiaBounds = { lon0: minX, lon1: maxX, lat0: minY, lat1: maxY };
  const deq = (values, index, bounds) => [
    bounds.lon0 + values[index * 2] / 65535 * (bounds.lon1 - bounds.lon0),
    bounds.lat0 + values[index * 2 + 1] / 65535 * (bounds.lat1 - bounds.lat0)
  ];
  const stationPositions = new Float32Array(stationCount * 3);
  for (let i = 0; i < stationCount; i++) {
    const [lon, lat] = deq(stationValues, i, indiaBounds);
    stationPositions[i * 3] = -(lon - cx) * scale;
    stationPositions[i * 3 + 1] = 2;
    stationPositions[i * 3 + 2] = (lat - cy) * scale;
  }
  const mapBounds = { minX: -(maxX - minX) * scale / 2, maxX: (maxX - minX) * scale / 2,
    minZ: -(maxY - minY) * scale / 2, maxZ: (maxY - minY) * scale / 2 };
  const turnoutGrid = makeTurnoutGrid(geojson.features, featureBounds, national, stationCount, cx, cy, scale, mapHeight);
  const stateExtents = new Map();

  // Second pass: build constituency records with scaled/centred coords
  const constituencies = [];
  geojson.features.forEach(feature => {
    const props = feature.properties;
    const pcName = props.pc_name;
    const w = winners.get(normalizeName(pcName));
    const party = w?.party || '';
    const hasWinner = Boolean(w?.winner && party && !party.startsWith('PARTY-UNKNOWN'));

    // Pre-compute scaled boundary line positions
    const linePositions = [];
    const emitSegments = (geometry) => {
      if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(polygon => {
          polygon.forEach(ring => {
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i]; const b = ring[(i + 1) % ring.length];
              linePositions.push(-(a[0] - cx) * scale, 0.1, (a[1] - cy) * scale,
                                 -(b[0] - cx) * scale, 0.1, (b[1] - cy) * scale);
            }
          });
        });
      } else if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach(ring => {
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i]; const b = ring[(i + 1) % ring.length];
            linePositions.push(-(a[0] - cx) * scale, 0.1, (a[1] - cy) * scale,
                               -(b[0] - cx) * scale, 0.1, (b[1] - cy) * scale);
          }
        });
      }
    };
    emitSegments(feature.geometry);

    const constituency = {
      id: props.pc_id,
      name: pcName,
      state: props.st_name,
      party,
      winner: w?.winner || '',
      hasWinner,
      result: party === 'BJP' && hasWinner ? 'bjp' : 'other',
      geometry: feature.geometry,
      linePositions
    };
    constituencies.push(constituency);

    let bounds = stateExtents.get(normalizeName(props.st_name));
    if (!bounds) {
      bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, state: props.st_name };
      stateExtents.set(normalizeName(props.st_name), bounds);
    }
    forEachPoint(feature.geometry, (lon, lat) => {
      const x = -(lon - cx) * scale;
      const z = (lat - cy) * scale;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minZ = Math.min(bounds.minZ, z);
      bounds.maxZ = Math.max(bounds.maxZ, z);
    });
  });

  const stateSeatCounts = new Map(stateRows.map(row => [normalizeName(row.state_ut), Number(row.seats)]));
  const pcDataMap = new Map();
  ge2024.states.forEach(state => {
    (state.constituencies || []).forEach(pc => {
      pcDataMap.set(normalizeName(state.name) + '|' + normalizeName(pc.name), { state: state.name, ...pc });
    });
  });
  constituencies.forEach(c => {
    c.ge2024 = pcDataMap.get(normalizeName(c.state) + '|' + normalizeName(c.name)) || null;
    c.marginVal = c.ge2024?.margin != null ? Number(c.ge2024.margin) : 0;
  });
  const maxMargin = Math.max(0, ...constituencies.map(c => c.marginVal));
  const namedWinnerCount = constituencies.filter(c => c.hasWinner).length;
  return {
    constituencies,
    stationPositions,
    turnoutGridPositions: turnoutGrid.positions,
    turnoutGridTurnout: turnoutGrid.turnout,
    turnoutCenters: turnoutGrid.centers,
    scale,
    cx,
    cy,
    mapBounds,
    stateBounds: stateExtents,
    national,
    stateSeatCounts,
    namedWinnerCount,
    maxMargin
  };
}

// ---------------------------------------------------------------------------
// Constituency margin material — vertical gradient on the Z-axis (world Y)
// extrusion so the seat lift reads as a margin: darker orange at the base,
// brighter orange at the top. Non-BJP seats stay a flat neutral colour.
// ---------------------------------------------------------------------------
function marginMaterial(c, depth) {
  const isBJP = c.result === 'bjp';
  const base = new THREE.Color(isBJP ? RESULT_COLOR.bjp : RESULT_COLOR.other);
  const bottom = isBJP ? base.clone().multiplyScalar(0.55) : base; // darker at base
  const top = isBJP ? base.clone().lerp(new THREE.Color(0xffffff), 0.35) : base; // brighter at top
  const lightDir = new THREE.Vector3(-0.4, 0.6, -0.5).normalize();
  return new THREE.ShaderMaterial({
    uniforms: {
      uBottomColor: { value: bottom },
      uTopColor: { value: top },
      uDepth: { value: depth > 0 ? depth : 1 },
      uLightDir: { value: lightDir }
    },
    vertexShader: `
      varying float vHeight;
      varying vec3 vNormal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vHeight = world.y;
        vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uBottomColor;
      uniform vec3 uTopColor;
      uniform float uDepth;
      uniform vec3 uLightDir;
      varying float vHeight;
      varying vec3 vNormal;
      void main() {
        float t = uDepth > 0.0 ? clamp(vHeight / uDepth, 0.0, 1.0) : 0.0;
        vec3 color = mix(uBottomColor, uTopColor, t);
        float diff = max(dot(vNormal, uLightDir), 0.0);
        color *= 0.85 + 0.45 * diff;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    transparent: true
  });
}

// ---------------------------------------------------------------------------
// Build Three.js scene from constituency boundaries
// ---------------------------------------------------------------------------
function buildScene({ constituencies, stationPositions, scale, cx, cy, maxMargin }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg || 0xffffff);

  const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 1, 8000);
  camera.up.set(0, 0, 1);
  camera.position.set(0, 1800, 0);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const host = document.getElementById('gl');
  host.appendChild(renderer.domElement);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const dl = new THREE.DirectionalLight(0xffffff, 0.7);
  dl.position.set(-400, 800, 500);
  scene.add(dl);

  const constituencyData = [];

  // Build a mesh for each constituency boundary
  constituencies.forEach(c => {
    const shapes = buildShapes(c.geometry, scale, scale, cx, cy);
    const maxWorldDepth = 520;
    const depth = c.result === 'bjp' && c.marginVal > 0 && maxMargin > 0
      ? (c.marginVal / maxMargin) * maxWorldDepth
      : 0;
    const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // lay flat on XZ plane; extrusion runs along world Y

    const color = new THREE.Color(c.result === 'bjp' ? RESULT_COLOR.bjp : RESULT_COLOR.other);
    const lambert = new THREE.MeshLambertMaterial({ color });
    const gradient = marginMaterial(c, depth);
    const mesh = new THREE.Mesh(geo, lambert);

    // Keep the original flat Lambert look for the state-focus chapters (UP, Maharashtra, Kerala)
    // and only switch to the vertical gradient shader during the BJP victory-margins chapter.
    mesh.userData.depth = depth;
    mesh.userData.lambertMat = lambert;
    mesh.userData.gradMat = gradient;
    mesh.material.transparent = true;
    mesh.material.opacity = 0;

    c.mesh = mesh;
    c.currentAlpha = 0;
    c.targetAlpha = 0;
    c.springZ = new Spring(0);
    mesh.scale.set(1, 0, 1);

    scene.add(mesh);
    constituencyData.push(c);
  });

  // Boundary lines (one combined LineSegments)
  const allLinePositions = [];
  constituencies.forEach(c => {
    allLinePositions.push(...c.linePositions);
  });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(allLinePositions, 3));
  linesMesh = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: C['map-line'], transparent: true, opacity: 0.35 }));
  scene.add(linesMesh);

  const stationGeo = new THREE.BufferGeometry();
  const stationPositionAttribute = new THREE.BufferAttribute(new Float32Array(stationPositions), 3);
  stationPositionAttribute.setUsage(THREE.DynamicDrawUsage);
  stationGeo.setAttribute('position', stationPositionAttribute);
  stationGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(particleLayouts.map.colors), 3));
  stationPoints = new THREE.Points(stationGeo, new THREE.PointsMaterial({
    color: 0xffffff,
    size: 3,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    vertexColors: true
  }));
  stationPoints.frustumCulled = false;
  stationPoints.renderOrder = 1;
  scene.add(stationPoints);

  return { scene, camera, renderer, constituencies: constituencyData };
}

function makeParticleLayouts({ stationPositions, turnoutGridPositions, turnoutGridTurnout, turnoutCenters, national, mapBounds }) {
  const count = stationPositions.length / 3;
  const width = mapBounds.maxX - mapBounds.minX;
  const height = mapBounds.maxZ - mapBounds.minZ;
  const makeLayout = (positions, colors, opacity, size = 3) => ({ positions, colors, opacity, size });
  const colorCache = new Map();
  const fillColor = (colors, index, hex) => {
    let color = colorCache.get(hex);
    if (!color) {
      color = new THREE.Color(hex);
      colorCache.set(hex, color);
    }
    colors[index * 3] = color.r;
    colors[index * 3 + 1] = color.g;
    colors[index * 3 + 2] = color.b;
  };
  const neutralColors = new Float32Array(count * 3);
  const boothColors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    fillColor(neutralColors, i, '#d3d3d3');
    fillColor(boothColors, i, '#d3d3d3');
  }
  const layouts = {
    map: makeLayout(new Float32Array(stationPositions), neutralColors, 0.2),
    booths: makeLayout(new Float32Array(stationPositions), boothColors, 0.2)
  };

  const turnoutPositions = new Float32Array(count * 3);
  const turnoutColors = new Float32Array(count * 3);
  const turnoutColor = value => TURNOUT_BINS.find(bin => value >= bin.min && value < bin.max)?.color;
  turnoutPositions.set(turnoutGridPositions);
  for (let i = 0; i < count; i++) {
    fillColor(turnoutColors, i, turnoutColor(turnoutGridTurnout[i]));
  }
  layouts.turnout = makeLayout(turnoutPositions, turnoutColors, 0.9);
  const turnoutLift = value => (value - 50) / 35 * height * 0.12;
  const centerMap = turnoutCenters || new Map();
  layouts.turnoutLabels = [...national.turnout2024.states]
    .map(state => {
      const center = centerMap.get(state.name);
      return center && center.count >= 150
        ? { name: state.name, turnout: state.turnout, position: [center.x, 2 + turnoutLift(state.turnout) + 18, center.z] }
      : null;
    }).filter(Boolean).sort((a, b) => a.turnout - b.turnout);

  const ls = national.ls2024;
  const groupColors = {
    BJP: '#ff6600',
    INC: '#2a8fd0',
    OTHERNAT: '#8e7cc3',
    STATE: '#a59d90'
  };
  const groups = new Map(ls.seatGroups.map(row => [row.key || row.party, row.seats]));
  const seatOrder = ['INC', 'OTHERNAT', 'STATE', 'BJP'];
  const seats = [];
  const radius = Math.min(width * 0.46, height * 0.72);
  const hemicycleCenterZ = mapBounds.minZ + height * 0.22;
  const innerRadius = radius * 0.36;
  const seatRows = Math.max(4, Math.round(Math.sqrt(ls.totalSeats / 3.4)));
  const radii = Array.from({ length: seatRows }, (_, i) => innerRadius + (radius - innerRadius) * (i + 0.5) / seatRows);
  const radiusSum = radii.reduce((sum, value) => sum + value, 0);
  const rowCounts = radii.map(value => Math.floor(ls.totalSeats * value / radiusSum));
  let remainingSeats = ls.totalSeats - rowCounts.reduce((sum, value) => sum + value, 0);
  for (let i = seatRows - 1; remainingSeats > 0; i = (i - 1 + seatRows) % seatRows, remainingSeats--) rowCounts[i]++;
  radii.forEach((seatRadius, row) => {
    for (let column = 0; column < rowCounts[row]; column++) {
      const angle = Math.PI - Math.PI * (column + 0.5) / rowCounts[row];
      seats.push({
        x: Math.cos(angle) * seatRadius,
        z: hemicycleCenterZ + Math.sin(angle) * seatRadius
      });
    }
  });
  seats.sort((a, b) => Math.atan2(b.z - hemicycleCenterZ, b.x) - Math.atan2(a.z - hemicycleCenterZ, a.x));

  const seatGroups = [];
  seatOrder.forEach(key => {
    for (let i = 0; i < (groups.get(key) || 0); i++) seatGroups.push(key);
  });
  if (seats.length !== ls.totalSeats || seatGroups.length !== ls.totalSeats) {
    throw new Error('Lok Sabha particle layout does not match the official seat total.');
  }
  const hemicyclePositions = new Float32Array(count * 3);
  const hemicycleColors = new Float32Array(count * 3);
  const seatR = radius * 0.64 / seatRows * 0.4;
  for (let i = 0; i < count; i++) {
    const seatIndex = Math.floor(i * seats.length / count);
    const localIndex = i - Math.floor(seatIndex * count / seats.length);
    const dotsAtSeat = Math.ceil((seatIndex + 1) * count / seats.length) - Math.floor(seatIndex * count / seats.length);
    const r = seatR * Math.sqrt((localIndex + 0.5) / dotsAtSeat);
    const angle = localIndex * 2.399963;
    const i3 = i * 3;
    hemicyclePositions[i3] = seats[seatIndex].x + Math.cos(angle) * r;
    hemicyclePositions[i3 + 1] = 2;
    hemicyclePositions[i3 + 2] = seats[seatIndex].z + Math.sin(angle) * r;
    fillColor(hemicycleColors, i, groupColors[seatGroups[seatIndex]]);
  }
  layouts.hemicycle = makeLayout(hemicyclePositions, hemicycleColors, 0.92);

  const votesSeatsPositions = new Float32Array(count * 3);
  const votesSeatsColors = new Float32Array(count * 3);
  const votesSeatsDelays = new Float32Array(count);
  const shares = ls.voteShare.map(row => ({
    key: row.key || row.party,
    vote: row.pct,
    seats: (groups.get(row.key || row.party) || 0) / ls.totalSeats * 100
  }));
  const half = Math.floor(count / 2);
  const barX = width * 0.82;
  const columns = Math.max(1, Math.floor(barX / 3));
  const rows = Math.ceil(half / columns);
  shares.forEach((share, row) => {
    const rowStart = row * half;
    const rowZ = mapBounds.minZ + height * (row === 0 ? 0.39 : 0.61);
    for (let j = 0; j < half; j++) {
      const i = rowStart + j;
      if (i >= count) break;
      const column = j % columns;
      const localRow = Math.floor(j / columns);
      const proportion = columns > 1 ? column / (columns - 1) : 0.5;
      let total = 0;
      const group = shares.find(item => {
        total += row === 0 ? item.vote : item.seats;
        return proportion * 100 < total;
      }) || shares[shares.length - 1];
      const i3 = i * 3;
      votesSeatsPositions[i3] = mapBounds.minX + width * 0.91 - proportion * barX;
      votesSeatsPositions[i3 + 1] = 2;
      votesSeatsPositions[i3 + 2] = rowZ + (localRow - (rows - 1) / 2) * 3;
      fillColor(votesSeatsColors, i, groupColors[group.key] || '#9aa5b1');
      votesSeatsDelays[i] = proportion * 0.75 + particleNoise(i, 11) * 0.2;
    }
  });
  if (count % 2) {
    votesSeatsPositions.set(votesSeatsPositions.subarray(0, 3), (count - 1) * 3);
    votesSeatsColors.set(votesSeatsColors.subarray(0, 3), (count - 1) * 3);
  }
  layouts.votesSeats = {
    ...makeLayout(votesSeatsPositions, votesSeatsColors, 0.92, 1.1),
    delays: votesSeatsDelays
  };
  return layouts;
}

function setParticleBlend(fromStage, toStage, progress) {
  if (!stationPoints || !particleLayouts) return;
  const fromName = particleLayouts[fromStage] ? fromStage : 'map';
  const toName = particleLayouts[toStage] ? toStage : 'map';
  const amount = reduce ? (progress < 0.5 ? 0 : 1) : progress;
  const eased = amount * amount * (3 - 2 * amount);
  const from = particleLayouts[fromName];
  const to = particleLayouts[toName];
  const positions = stationPoints.geometry.attributes.position.array;
  const colors = stationPoints.geometry.attributes.color.array;
  const hemicycleToShares = (fromName === 'hemicycle' && toName === 'votesSeats')
    || (fromName === 'votesSeats' && toName === 'hemicycle');
  if (hemicycleToShares && !reduce) {
    const reverse = fromName === 'votesSeats';
    const forwardProgress = reverse ? 1 - progress : progress;
    const start = particleLayouts.hemicycle;
    const end = particleLayouts.votesSeats;
    const spread = 0.55;
    for (let i = 0; i < positions.length; i += 3) {
      const particle = i / 3;
      const local = THREE.MathUtils.clamp(
        (forwardProgress - end.delays[particle] * spread) / (1 - spread),
        0,
        1
      );
      const t = local * local * (3 - 2 * local);
      const bump = Math.sin(Math.PI * t);
      const dx = end.positions[i] - start.positions[i];
      const dz = end.positions[i + 2] - start.positions[i + 2];
      const length = Math.hypot(dx, dz);
      const side = (particleNoise(particle, 97) - 0.5) * length * 0.3 * bump;
      const offsetX = length > 0 ? -dz / length * side : 0;
      const offsetZ = length > 0 ? dx / length * side : 0;
      const amount = reverse ? 1 - t : t;
      positions[i] = THREE.MathUtils.lerp(from.positions[i], to.positions[i], amount) + offsetX;
      positions[i + 1] = THREE.MathUtils.lerp(from.positions[i + 1], to.positions[i + 1], amount);
      positions[i + 2] = THREE.MathUtils.lerp(from.positions[i + 2], to.positions[i + 2], amount) + offsetZ;
      for (let axis = 0; axis < 3; axis++) {
        colors[i + axis] = THREE.MathUtils.lerp(from.colors[i + axis], to.colors[i + axis], amount);
      }
    }
  } else {
    for (let i = 0; i < positions.length; i++) {
      positions[i] = THREE.MathUtils.lerp(from.positions[i], to.positions[i], eased);
      colors[i] = THREE.MathUtils.lerp(from.colors[i], to.colors[i], eased);
    }
  }
  stationPoints.material.opacity = THREE.MathUtils.lerp(from.opacity, to.opacity, eased);
  stationPoints.material.size = THREE.MathUtils.lerp(from.size, to.size, eased);
  stationPoints.geometry.attributes.position.needsUpdate = true;
  stationPoints.geometry.attributes.color.needsUpdate = true;

  currentParticleStage = eased < 0.5 ? fromName : toName;
  turnoutLabels.forEach(label => { label.element.hidden = currentParticleStage !== 'turnout'; });
  needsRender = true;
  if (!animationFrame) animationFrame = requestAnimationFrame(animate);
}

function createTurnoutLabels(states) {
  const host = document.getElementById('labs');
  if (!host || !states.length) return [];
  const extremes = [states[0], states[states.length - 1]];
  return extremes.map(state => {
    const element = document.createElement('span');
    element.className = 'turnout-label';
    element.textContent = `${state.name} ${state.turnout.toFixed(1)}%`;
    element.hidden = true;
    host.append(element);
    return { element, position: new THREE.Vector3(...state.position) };
  });
}

function updateTurnoutLabels() {
  turnoutLabels.forEach(label => {
    if (currentParticleStage !== 'turnout') {
      label.element.hidden = true;
      return;
    }
    const point = label.position.clone().project(camera);
    label.element.hidden = point.z < -1 || point.z > 1;
    label.element.style.left = `${(point.x + 1) * window.innerWidth / 2}px`;
    label.element.style.top = `${(1 - point.y) * window.innerHeight / 2}px`;
  });
}

// ---------------------------------------------------------------------------
// Chapters (scroll-driven narrative)
// ---------------------------------------------------------------------------
let CHAPTERS = [];
let currentChapter = -1;
let storyElements = [];

function createChapters({ constituencies, national, stateSeatCounts, namedWinnerCount }) {
  const { ls2024, turnout2024, coverage } = national;
  const bjpSeats = ls2024.top.find(row => row.code === 'BJP')?.seats || 0;
  const bjpShare = ls2024.voteShare.find(row => row.party === 'BJP')?.pct;
  const majority = ls2024.majority;
  const mappedBjp = constituencies.filter(c => c.result === 'bjp').length;
  const turnoutSorted = [...turnout2024.states].sort((a, b) => b.turnout - a.turnout);
  const coverageSorted = [...coverage.states].sort((a, b) => b.pct - a.pct);
  const coverageMissing = coverage.notYet.length;
  const coveragePartial = coverage.states.filter(row => row.partial).length;
  const formatCount = value => Number(value).toLocaleString('en-IN');
  const stateChapter = state => {
    const seats = stateSeatCounts.get(normalizeName(state));
    const countText = Number.isFinite(seats) ? `${seats} seats` : 'seat total unavailable';
    const bjpWins = constituencies.filter(c => c.state === state && c.result === 'bjp').length;
    const recordText = bjpWins === 1 ? 'constituency record names' : 'constituency records name';
    return {
      focus: state,
      title: state,
      text: `${state} has ${countText} in the state-seat data. ${bjpWins} ${recordText} a BJP winner here. Explore the boundaries, then scroll on to return to the national map.`
    };
  };
  const marginChapter = () => ({
    focus: 'bjp-margins',
    title: 'BJP victory margins',
    text: 'Constituencies won by BJP are lifted on the Z axis in proportion to their margin of victory — taller seats mark bigger wins. Scroll across the national map to see where BJP margins ran deepest.'
  });
  return [
    {
      focus: 'all',
      title: '543 seats, one map',
      text: `Each shape is one parliamentary constituency. The ECI recorded ${formatCount(turnout2024.stations)} polling stations in 2024; the map shows 24,000 sampled locations from the booth atlas.`
    },
    {
      focus: 'all',
      title: 'The BJP result',
      text: Number.isFinite(bjpSeats)
        ? `The 2024 results record ${bjpSeats} BJP seats, ${majority - bjpSeats} short of the ${majority} needed for a majority on its own${Number.isFinite(bjpShare) ? `, with ${bjpShare}% of the vote` : ''}. Orange marks constituency records that name a BJP winner.`
        : 'A verified BJP seat total is not available in national.json.'
    },
    stateChapter('Uttar Pradesh'),
    stateChapter('Maharashtra'),
    stateChapter('Kerala'),
    marginChapter(),
    {
      focus: 'all',
      title: "India's electors",
      text: `${formatCount(turnout2024.electors)} electors were registered for the 2024 general election. ${formatCount(turnout2024.votes)} votes were recorded across ${formatCount(turnout2024.stations)} polling stations.`,
      chart: {
        type: 'metrics',
        rows: [
          { label: 'Registered electors', value: formatCount(turnout2024.electors) },
          { label: 'Votes recorded', value: formatCount(turnout2024.votes) },
          { label: 'Polling stations', value: formatCount(turnout2024.stations) }
        ],
        note: turnout2024.source
      }
    },
    {
      focus: 'all',
      title: 'Polling stations',
      visualStage: 'booths',
      text: `The ECI recorded ${formatCount(turnout2024.stations)} polling stations. The booth atlas has geolocated ${formatCount(coverage.geoTotal)} (${(coverage.geoTotal / coverage.eciTotal * 100).toFixed(1)}%); the 24,000 dots shown here are a sample of those mapped locations. Coverage data is available for ${coverage.states.length} states/UTs; ${coveragePartial} is partial and ${coverageMissing} are not yet represented.`,
      chart: {
        type: 'ranking',
        label: 'Geolocated stations',
        rows: [
          ...coverageSorted.slice(0, 5).map(row => ({ label: row.name, value: row.pct, partial: row.partial })),
          ...coverageSorted.slice(-5).reverse().map(row => ({ label: row.name, value: row.pct, partial: row.partial }))
        ],
        note: `${coverage.source} Top and bottom coverage rates among states/UTs with data.`
      }
    },
    {
      focus: 'all',
      title: 'Turnout, state by state.',
      visualStage: 'turnout',
      text: `From ${turnoutSorted[turnoutSorted.length - 1].turnout.toFixed(1)}% in ${turnoutSorted[turnoutSorted.length - 1].name} to ${turnoutSorted[0].turnout.toFixed(1)}% in ${turnoutSorted[0].name}; national turnout was ${turnout2024.national}%. Height and colour show turnout.`,
      chart: {
        type: 'turnout-legend',
        rows: TURNOUT_BINS,
        note: `${turnout2024.source} Height and colour show state turnout.`
      }
    },
    {
      focus: 'all',
      title: `${ls2024.totalSeats} seats in the Lok Sabha`,
      visualStage: 'hemicycle',
      text: `The official results recorded ${ls2024.totalSeats} seats. The BJP won ${bjpSeats}, Congress ${ls2024.seatGroups.find(row => row.party === 'INC')?.seats || 0}, other national parties ${ls2024.seatGroups.find(row => row.key === 'OTHERNAT')?.seats || 0}, and state parties and independents ${ls2024.seatGroups.find(row => row.key === 'STATE')?.seats || 0}.`,
      chart: {
        type: 'seats',
        total: ls2024.totalSeats,
        rows: ls2024.seatGroups.map((row, index) => ({
          label: row.party,
          value: row.seats,
          style: ['bjp', 'inc', 'other', 'state'][index]
        })),
        note: ls2024.source
      }
    },
    {
      focus: 'all',
      title: '543 seats, 272 for a majority',
      visualStage: 'hemicycle',
      text: `Each dot represents one seat in the Lok Sabha, grouped by party category. The majority line marks ${majority} seats; the BJP won ${bjpSeats}, short of a majority on its own.`,
      chart: {
        type: 'hemicycle',
        total: ls2024.totalSeats,
        majority,
        rows: ['INC', 'OTHERNAT', 'STATE', 'BJP'].map(key => {
          const row = ls2024.seatGroups.find(group => (group.key || group.party) === key);
          if (!row) throw new Error(`Missing seat chart group: ${key}`);
          return {
            label: row.party,
            value: row.seats,
            style: { BJP: 'bjp', INC: 'inc', OTHERNAT: 'other', STATE: 'state' }[key]
          };
        }),
        note: ls2024.source
      }
    },
    {
      focus: 'all',
      title: 'Votes into seats',
      visualStage: 'votesSeats',
      text: `Compare each party group’s share of the national vote with its share of the ${ls2024.totalSeats} seats. The BJP’s ${bjpShare}% of votes translated to ${(ls2024.seatGroups.find(row => row.party === 'BJP').seats / ls2024.totalSeats * 100).toFixed(1)}% of seats.`,
      chart: {
        type: 'votes-seats',
        rows: ls2024.voteShare.map((row, index) => ({
          label: row.party,
          style: ['bjp', 'inc', 'other', 'state'][index],
          vote: row.pct,
          seats: (ls2024.seatGroups.find(group => (group.key || group.party) === (row.key || row.party))?.seats || 0) / ls2024.totalSeats * 100
        })),
        note: ls2024.source
      }
    },
    {
      focus: 'all',
      title: 'The national picture',
      text: `${namedWinnerCount} of ${ls2024.totalSeats} constituency records include a named winner and party. The national results report ${bjpSeats} BJP seats, while ${mappedBjp} mapped constituencies currently identify a BJP winner. The remaining records are not guessed.`
    }
  ];
}

function buildStory() {
  const box = document.getElementById('steps');
  box.replaceChildren(...CHAPTERS.map((chapter, index) => {
    const section = document.createElement('section');
    section.className = 'step';
    section.dataset.chapter = String(index);
    if (chapter.visualStage) section.dataset.visualStage = chapter.visualStage;
    const card = document.createElement('div');
    const title = document.createElement('h2');
    title.textContent = chapter.title;
    const text = document.createElement('p');
    text.textContent = chapter.text;
    card.append(title, text);
    if (chapter.chart) {
      const chart = document.createElement('div');
      chart.className = `chapter-chart ${chapter.chart.type}`;
      chart.setAttribute('aria-label', chapter.title);
      if (chapter.chart.type === 'metrics') {
        chapter.chart.rows.forEach(row => {
          const item = document.createElement('div');
          item.className = 'chart-metric';
          const label = document.createElement('span');
          label.textContent = row.label;
          const value = document.createElement('strong');
          value.textContent = row.value;
          item.append(label, value);
          chart.append(item);
        });
      } else if (chapter.chart.type === 'ranking') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('ranking-chart');
        svg.setAttribute('viewBox', '0 0 440 250');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `${chapter.chart.label}, top and bottom five`);
        chart.append(svg);
        renderRankingChart(svg, chapter.chart);
      } else if (chapter.chart.type === 'turnout-legend') {
        chapter.chart.rows.forEach(row => {
          const item = document.createElement('div');
          item.className = 'turnout-bin';
          const swatch = document.createElement('i');
          swatch.style.backgroundColor = row.color;
          const label = document.createElement('span');
          label.textContent = row.label;
          item.append(swatch, label);
          chart.append(item);
        });
      } else if (chapter.chart.type === 'seats') {
        chapter.chart.rows.forEach(row => {
          const item = document.createElement('div');
          item.className = 'chart-seat-row';
          const heading = document.createElement('div');
          heading.className = 'chart-row-heading';
          const label = document.createElement('span');
          label.textContent = row.label;
          const value = document.createElement('strong');
          value.textContent = String(row.value);
          heading.append(label, value);
          const track = document.createElement('div');
          track.className = 'chart-track';
          track.setAttribute('aria-hidden', 'true');
          const bar = document.createElement('span');
          bar.className = `chart-bar ${row.style}`;
          bar.style.width = `${row.value / chapter.chart.total * 100}%`;
          track.append(bar);
          item.append(heading, track);
          chart.append(item);
        });
      } else if (chapter.chart.type === 'votes-seats') {
        chapter.chart.rows.forEach(row => {
          const item = document.createElement('div');
          item.className = 'chart-share-row';
          const heading = document.createElement('div');
          heading.className = 'chart-row-heading';
          const label = document.createElement('span');
          label.textContent = row.label;
          heading.append(label);
          item.append(heading);
          [['Vote share', row.vote], ['Seat share', row.seats]].forEach(([name, value]) => {
            const line = document.createElement('div');
            line.className = 'chart-share-line';
            const lineLabel = document.createElement('span');
            lineLabel.textContent = name;
            const track = document.createElement('div');
            track.className = 'chart-track';
            track.setAttribute('aria-hidden', 'true');
            const bar = document.createElement('span');
            bar.className = `chart-bar ${row.style}`;
            bar.style.width = `${Math.max(0, Math.min(100, value))}%`;
            track.append(bar);
            const amount = document.createElement('strong');
            amount.textContent = `${value.toFixed(1)}%`;
            line.append(lineLabel, track, amount);
            item.append(line);
          });
          chart.append(item);
        });
      } else if (chapter.chart.type === 'hemicycle') {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.classList.add('hemicycle-chart');
        svg.setAttribute('viewBox', '0 0 440 230');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', `${chapter.chart.total} Lok Sabha seats grouped by party category; ${chapter.chart.majority} seats needed for a majority`);
        chart.append(svg);
        renderHemicycleChart(svg, chapter.chart);

        const legend = document.createElement('div');
        legend.className = 'hemicycle-legend';
        chapter.chart.rows.forEach(row => {
          const item = document.createElement('span');
          item.className = 'hemicycle-key';
          const swatch = document.createElement('i');
          swatch.className = `chart-bar ${row.style}`;
          const label = document.createElement('span');
          label.textContent = `${row.label}: ${row.value}`;
          item.append(swatch, label);
          legend.append(item);
        });
        chart.append(legend);
      }
      const note = document.createElement('small');
      note.className = 'chart-note';
      note.textContent = chapter.chart.note;
      chart.append(note);
      card.append(chart);
    }
    section.append(card);
    return section;
  }));
}

function renderRankingChart(svg, chartData) {
  const d3 = window.d3;
  if (!d3) throw new Error('D3 failed to load; ranking charts cannot be rendered.');
  const width = 440;
  const rowHeight = 19;
  const plotX = 142;
  const plotWidth = 222;
  const rowsTop = 22;
  const x = d3.scaleLinear().domain([0, 100]).range([plotX, plotX + plotWidth]);
  const root = d3.select(svg);
  const styles = getComputedStyle(document.documentElement);
  const ink = styles.getPropertyValue('--ink').trim();
  const muted = styles.getPropertyValue('--mute').trim();
  const accent = '#56b4a9';
  root.append('text')
    .attr('x', 0)
    .attr('y', 11)
    .attr('fill', muted)
    .attr('font-size', 10)
    .text(`${chartData.label} · top five and bottom five`);
  const rows = root.append('g')
    .selectAll('g')
    .data(chartData.rows)
    .join('g')
    .attr('transform', (_, index) => `translate(0,${rowsTop + index * rowHeight})`);

  rows.append('text')
    .attr('x', 0)
    .attr('y', 11)
    .attr('fill', ink)
    .attr('font-size', 11)
    .text((row, index) => `${index === 5 ? '· ' : ''}${row.label}${row.partial ? ' (partial)' : ''}`);

  rows.append('rect')
    .attr('x', plotX)
    .attr('y', 1)
    .attr('width', plotWidth)
    .attr('height', 10)
    .attr('rx', 5)
    .attr('fill', 'rgba(203,213,225,.2)');

  rows.append('rect')
    .attr('x', plotX)
    .attr('y', 1)
    .attr('width', row => Math.max(0, x(Math.max(0, Math.min(100, row.value))) - plotX))
    .attr('height', 10)
    .attr('rx', 5)
    .attr('fill', accent);

  rows.append('text')
    .attr('x', width)
    .attr('y', 11)
    .attr('fill', ink)
    .attr('font-size', 11)
    .attr('text-anchor', 'end')
    .text(row => `${row.value.toFixed(1)}%`);

  const axis = d3.axisBottom(x).tickValues([0, 50, 100]).tickFormat(value => `${value}%`).tickSize(0);
  root.append('g')
    .attr('transform', 'translate(0,224)')
    .call(axis)
    .call(group => group.select('.domain').attr('stroke', muted).attr('stroke-opacity', 0.45))
    .call(group => group.selectAll('text').attr('fill', muted).attr('font-size', 10).attr('dy', '1.2em'));
  root.append('line')
    .attr('x1', 0)
    .attr('x2', width)
    .attr('y1', rowsTop + 5 * rowHeight - 3)
    .attr('y2', rowsTop + 5 * rowHeight - 3)
    .attr('stroke', muted)
    .attr('stroke-opacity', 0.35)
    .attr('stroke-dasharray', '2 4');
}

function renderHemicycleChart(svg, chartData) {
  const seatTotal = chartData.rows.reduce((sum, row) => sum + row.value, 0);
  if (!Number.isInteger(chartData.total) || seatTotal !== chartData.total) {
    throw new Error(`Seat chart expected ${chartData.total} seats but received ${seatTotal}.`);
  }
  if (chartData.rows.some(row => !Number.isInteger(row.value) || row.value < 0)) {
    throw new Error('Seat chart party totals must be non-negative integers.');
  }

  const box = { x: 18, y: 10, w: 404, h: 210 };
  const outerRadius = Math.min(box.w / 2, box.h * 0.78) * 0.97;
  const innerRadius = outerRadius * 0.36;
  const rowCount = Math.max(4, Math.round(Math.sqrt(chartData.total / 3.4)));
  const radii = Array.from(
    { length: rowCount },
    (_, index) => innerRadius + (outerRadius - innerRadius) * (index + 0.5) / rowCount
  );
  const radiusTotal = radii.reduce((sum, radius) => sum + radius, 0);
  const rowSeats = radii.map(radius => Math.floor(chartData.total * radius / radiusTotal));
  let remaining = chartData.total - rowSeats.reduce((sum, count) => sum + count, 0);
  for (let row = rowSeats.length - 1; remaining > 0; row = (row - 1 + rowSeats.length) % rowSeats.length) {
    rowSeats[row]++;
    remaining--;
  }

  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h * 0.08 + outerRadius;
  const seats = [];
  radii.forEach((radius, row) => {
    for (let index = 0; index < rowSeats[row]; index++) {
      const angle = Math.PI - Math.PI * (index + 0.5) / rowSeats[row];
      seats.push({
        angle,
        radius,
        x: centerX + Math.cos(angle) * radius,
        y: centerY - Math.sin(angle) * radius
      });
    }
  });
  seats.sort((left, right) => right.angle - left.angle || left.radius - right.radius);

  if (!Number.isInteger(chartData.majority) || chartData.majority <= 0 || chartData.majority > chartData.total) {
    throw new Error(`Seat chart majority must be between 1 and ${chartData.total}.`);
  }
  const groupEnds = [];
  chartData.rows.reduce((total, row) => {
    groupEnds.push(total + row.value);
    return total + row.value;
  }, 0);
  const colors = {
    bjp: 'var(--n)',
    inc: 'var(--i)',
    other: 'var(--o)',
    state: '#56b4a9'
  };
  const description = document.createElementNS('http://www.w3.org/2000/svg', 'desc');
  description.textContent = `${chartData.rows.map(row => `${row.label}: ${row.value} seats`).join('; ')}. ${chartData.majority} seats are needed for a majority.`;
  svg.append(description);

  let groupIndex = 0;
  seats.forEach((seat, index) => {
    while (index >= groupEnds[groupIndex]) groupIndex++;
    const row = chartData.rows[groupIndex];
    if (!row || !colors[row.style]) throw new Error(`Unknown seat chart group style: ${row?.style}`);
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', seat.x.toFixed(2));
    circle.setAttribute('cy', seat.y.toFixed(2));
    circle.setAttribute('r', '2.6');
    circle.setAttribute('fill', colors[row.style]);
    svg.append(circle);
  });

  const beforeMajority = seats[chartData.total - chartData.majority - 1];
  const atMajority = seats[chartData.total - chartData.majority];
  const angle = (beforeMajority.angle + atMajority.angle) / 2;
  const lineStartX = centerX + Math.cos(angle) * innerRadius * 0.82;
  const lineStartY = centerY - Math.sin(angle) * innerRadius * 0.82;
  const lineEndX = centerX + Math.cos(angle) * outerRadius * 1.07;
  const lineEndY = centerY - Math.sin(angle) * outerRadius * 1.07;
  const majorityLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  majorityLine.setAttribute('x1', lineStartX.toFixed(2));
  majorityLine.setAttribute('y1', lineStartY.toFixed(2));
  majorityLine.setAttribute('x2', lineEndX.toFixed(2));
  majorityLine.setAttribute('y2', lineEndY.toFixed(2));
  majorityLine.setAttribute('stroke', 'var(--ink)');
  majorityLine.setAttribute('stroke-width', '1.5');
  majorityLine.setAttribute('stroke-dasharray', '5 4');
  svg.append(majorityLine);

  const majorityLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  majorityLabel.setAttribute('x', (lineEndX - 5).toFixed(2));
  majorityLabel.setAttribute('y', (lineEndY - 7).toFixed(2));
  majorityLabel.setAttribute('fill', 'var(--ink)');
  majorityLabel.setAttribute('font-size', '10');
  majorityLabel.setAttribute('font-weight', '600');
  majorityLabel.setAttribute('text-anchor', 'end');
  majorityLabel.textContent = `${chartData.majority} = majority`;
  svg.append(majorityLabel);
}

// ---------------------------------------------------------------------------
// Chapter navigation
// ---------------------------------------------------------------------------
function chapterView(chapter) {
  const ch = CHAPTERS[chapter];
  const bounds = ch.focus === 'all' ? mapBounds : stateBounds.get(normalizeName(ch.focus));
  const targetBounds = bounds || mapBounds;
  const width = Math.max(1, targetBounds.maxX - targetBounds.minX) * 1.12;
  const height = Math.max(1, targetBounds.maxZ - targetBounds.minZ) * 1.12;
  const centerX = (targetBounds.minX + targetBounds.maxX) / 2;
  const centerZ = (targetBounds.minZ + targetBounds.maxZ) / 2;
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fitDistance = Math.max(
    (mapBounds.maxX - mapBounds.minX) / camera.aspect,
    mapBounds.maxZ - mapBounds.minZ
  ) / (2 * tanHalfFov);
  const targetDistance = Math.max(width / camera.aspect, height) / (2 * tanHalfFov);
  return {
    x: centerX,
    z: centerZ,
    zoom: fitDistance / targetDistance,
    focus: ch.focus,
    visualStage: ch.visualStage || null,
    tilt: ch.visualStage === 'turnout' ? THREE.MathUtils.degToRad(22) : 0
  };
}

function updateScrollState(elements) {
  if (!elements.length || !CHAPTERS.length || !camera) return;
  const scrollCenter = window.scrollY + window.innerHeight / 2;
  const centers = elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return bounds.top + window.scrollY + bounds.height / 2;
  });

  let from = 0;
  let progress = 0;
  if (scrollCenter >= centers[centers.length - 1]) {
    from = centers.length - 1;
  } else {
    while (from < centers.length - 1 && scrollCenter > centers[from + 1]) from++;
    if (from < centers.length - 1) {
      progress = THREE.MathUtils.clamp(
        (scrollCenter - centers[from]) / (centers[from + 1] - centers[from]),
        0,
        1
      );
    }
  }
  const to = Math.min(from + 1, CHAPTERS.length - 1);
  const firstView = chapterView(from);
  const nextView = chapterView(to);
  const mix = (start, end) => THREE.MathUtils.lerp(start, end, progress);

  springTx.setTarget(mix(firstView.x, nextView.x));
  springTz.setTarget(mix(firstView.z, nextView.z));
  springZoom.setTarget(mix(firstView.zoom, nextView.zoom));
  springTilt.setTarget(mix(firstView.tilt, nextView.tilt));
  const marginActive = firstView.focus === 'bjp-margins' || nextView.focus === 'bjp-margins';
  csData.forEach(c => {
    const startAlpha = !firstView.visualStage && chapterAlpha(firstView.focus, c) ? 1 : 0.025;
    const endAlpha = !nextView.visualStage && chapterAlpha(nextView.focus, c) ? 1 : 0.025;
    if (!c.springAlpha) c.springAlpha = new Spring(c.currentAlpha);
    c.springAlpha.setTarget(mix(startAlpha, endAlpha));
    const targetZ = marginActive && c.result === 'bjp' && c.marginVal > 0 ? 1 : 0;
    if (!c.springZ) c.springZ = new Spring(0);
    c.springZ.setTarget(targetZ);
  });
  if (linesMesh) {
    const lineOpacity = stage => stage === 'turnout' ? 0.62 : stage ? 0.035 : 0.35;
    linesMesh.material.opacity = mix(lineOpacity(firstView.visualStage), lineOpacity(nextView.visualStage));
  }

  const activeChapter = progress < 0.5 ? from : to;
  setParticleBlend(
    CHAPTERS[from].visualStage || 'map',
    CHAPTERS[to].visualStage || 'map',
    progress
  );
  if (activeChapter !== currentChapter) {
    currentChapter = activeChapter;
    const chapter = CHAPTERS[activeChapter];
    document.body.classList.toggle('turnout-active', chapter.visualStage === 'turnout');
    stationPoints.visible = chapter.focus === 'all';
    const stationLegend = document.getElementById('station-legend');
    if (stationLegend) stationLegend.hidden = !stationPoints.visible || (chapter.visualStage && chapter.visualStage !== 'booths');
    document.querySelectorAll('.map-result-legend').forEach(element => {
      element.hidden = Boolean(chapter.visualStage && chapter.visualStage !== 'booths');
    });
    const unit = document.getElementById('unit');
    if (unit) unit.textContent = chapter.visualStage === 'booths'
      ? 'Polling-station atlas · 24,000 mapped sample'
      : chapter.visualStage === 'turnout'
      ? 'Turnout by state · 24,000 sample dots'
      : chapter.visualStage === 'hemicycle'
        ? '543 Lok Sabha seats · 24,000 dots form the hemicycle'
        : chapter.visualStage === 'votesSeats'
          ? 'Vote share and seat share · 24,000 dots'
          : chapter.focus === 'all'
      ? 'North-up constituency boundaries'
      : chapter.focus === 'bjp-margins'
        ? 'BJP victory margins — Z axis = margin of victory'
        : `Focused on ${chapter.focus}`;
  }
  elements.forEach((element, index) => {
    element.classList.toggle('on', index === activeChapter);
  });

  needsRender = true;
  if (!animationFrame) animationFrame = requestAnimationFrame(animate);
}

function chapterAlpha(focus, c) {
  if (focus === 'all') return true;
  if (focus === 'bjp-margins') return c.result === 'bjp';
  return normalizeName(focus) === normalizeName(c.state);
}

function marginChapterActive() {
  return currentChapter >= 0 && CHAPTERS[currentChapter] && CHAPTERS[currentChapter].focus === 'bjp-margins';
}

function bindChapterScroll(elements) {
  const update = () => updateScrollState(elements);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
}

// ---------------------------------------------------------------------------
// Hover tooltip — GE2024 PC details (bottom right corner)
// ---------------------------------------------------------------------------
function escapeHtml(text) {
  if (text == null) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(text).replace(/[&<>"']/g, c => map[c]);
}

function formatNumber(value) {
  return value == null ? '' : Number(value).toLocaleString();
}

function tooltipField(label, candidate, party, votes, votePercent) {
  const voteText = [formatNumber(votes), votePercent != null ? `(${votePercent}%)` : ''].filter(Boolean).join(' ');
  return `<div style="margin-bottom:6px"><div style="color:var(--mute);font-size:11px">${escapeHtml(label)}</div><div style="color:var(--ink)">${escapeHtml(candidate)} — ${escapeHtml(party || '')}</div><div style="color:var(--mute);font-size:12px">${voteText}</div></div>`;
}

function positionTooltip(event) {
  if (!pcTooltip) return;
  const gap = 14;
  const margin = 8;
  const bounds = pcTooltip.getBoundingClientRect();
  let left = event.clientX + gap;
  let top = event.clientY + gap;

  if (left + bounds.width > window.innerWidth - margin) {
    left = event.clientX - bounds.width - gap;
  }
  if (top + bounds.height > window.innerHeight - margin) {
    top = event.clientY - bounds.height - gap;
  }

  pcTooltip.style.left = `${Math.max(margin, left)}px`;
  pcTooltip.style.top = `${Math.max(margin, top)}px`;
}

function showTooltip(c, event) {
  if (!c || !pcTooltip) { hideTooltip(); return; }
  if (!tooltipInner) tooltipInner = pcTooltip.querySelector('.pc-tooltip-inner');
  if (!tooltipInner) { hideTooltip(); return; }
  if (hoveredPC === c) {
    positionTooltip(event);
    return;
  }
  const d = c.ge2024;
  const winner = d ? d.winner : {};
  const runner = d ? d.runnerUp : {};
  const parts = [];
  parts.push(`<div class="pc-name">${escapeHtml(c.name)}</div>`);
  parts.push(`<div class="pc-sub">${escapeHtml(c.state)} — ${c.result === 'bjp' ? 'BJP' : 'Other / unverified'} winner</div>`);
  if (winner.candidate) {
    parts.push(tooltipField('Winner', winner.candidate, winner.party, winner.votes, winner.votePercent));
  } else if (c.winner) {
    parts.push(`<div class="pc-field"><div class="pc-label">Winner</div><div class="pc-value">${escapeHtml(c.winner)} — ${escapeHtml(c.party || '')}</div></div>`);
  }
  if (runner.candidate) parts.push(tooltipField('Runner-up', runner.candidate, runner.party, runner.votes, runner.votePercent));
  if (d && d.margin != null) parts.push(`<div class="pc-margin">Margin: ${formatNumber(d.margin)}</div>`);
  if (d && d.unopposed) parts.push(`<div class="pc-unopposed">Unopposed</div>`);
  tooltipInner.innerHTML = parts.join('');
  pcTooltip.style.display = 'block';
  positionTooltip(event);
  hoveredPC = c;
}

function hideTooltip() {
  if (pcTooltip) pcTooltip.style.display = 'none';
  hoveredPC = null;
}

function onMouseDown(event) {
  if (event.button !== 0) return;
  if (!marginChapterActive()) return;
  if (!event.target.closest('#gl')) return;
  orbitDragging = true;
  orbitLastX = event.clientX;
  orbitTargetAngle = springOrbit.value; // seed from current so it doesn't snap
}

function onMouseUp() {
  orbitDragging = false;
}

function onMouseMove(event) {
  // Orbit drag — only active during the BJP victory margins chapter
  if (marginChapterActive() && orbitDragging) {
    const dx = event.clientX - orbitLastX;
    if (dx !== 0) {
      orbitTargetAngle += dx * 0.004;
      springOrbit.setTarget(orbitTargetAngle);
      needsRender = true;
      if (!animationFrame) animationFrame = requestAnimationFrame(animate);
    }
    orbitLastX = event.clientX;
  }

  if (!camera || !raycaster || !pcTooltip) return;
  mouseVec.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouseVec.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouseVec, camera);
  const intersects = raycaster.intersectObjects(constituencyMeshes);
  if (intersects.length) {
    const c = meshToC.get(intersects[0].object);
    if (c) { showTooltip(c, event); return; }
  }
  hideTooltip();
}

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
function animate() {
  animationFrame = 0;
  const now = performance.now();
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.1) : 0;
  lastTime = now;

  let moved = false;

  // Camera springs — pan and zoom each settle on their own smooth curve
  if (!springTx.update(dt)) moved = true;
  if (!springTz.update(dt)) moved = true;
  if (!springZoom.update(dt)) moved = true;
  if (!springTilt.update(dt)) moved = true;

  // Per-constituency alpha springs
  const marginActive = marginChapterActive();
  // Only the BJP victory-margins chapter uses the vertical gradient shader.
  // State-focus chapters (UP, Maharashtra, Kerala) keep the flat Lambert look
  // so boundary rendering is unchanged: other states muted, focused state highlighted.
  if (marginActive !== prevMarginActive) {
    csData.forEach(c => {
      if (c.result === 'bjp' && c.marginVal > 0 && c.mesh) {
        c.mesh.material = marginActive ? c.mesh.userData.gradMat : c.mesh.userData.lambertMat;
        needsRender = true;
      }
    });
    prevMarginActive = marginActive;
  }
  csData.forEach(c => {
    if (!c.springAlpha.update(dt)) moved = true;
    c.mesh.material.opacity = c.springAlpha.value;
    if (c.springZ) {
      c.springZ.setTarget(marginActive && c.result === 'bjp' && c.marginVal > 0 ? 1 : 0);
      if (!c.springZ.update(dt)) moved = true;
      c.mesh.scale.y = c.springZ.value;
    }
  });

  const th = Math.tan(16 * Math.PI / 180);
  const fit = Math.max(
    (mapBounds.maxX - mapBounds.minX) / (2 * th * camera.aspect),
    (mapBounds.maxZ - mapBounds.minZ) / (2 * th)
  ) * 1.12;
  const dist = fit / springZoom.value;
  if (marginActive) {
    // Angled view so Z-axis extrusion (margin height) reads as vertical height.
    // Camera orbits the scene so SOUTH faces the viewer (180° from north-up).
    // Click + drag to rotate the orbit; the scroll springs still pan/zoom the centre.
    if (!springOrbit.update(dt)) moved = true;
    const angle = springOrbit.value;
    const r = dist * 0.85;
    camera.up.set(0, 1, 0);
    camera.position.set(springTx.value + r * Math.sin(angle), dist * 0.55, springTz.value - r * Math.cos(angle));
    camera.lookAt(springTx.value, 0, springTz.value);
  } else {
    camera.position.set(springTx.value, dist * Math.cos(springTilt.value), springTz.value - dist * Math.sin(springTilt.value));
    camera.up.set(0, 0, 1);
    camera.lookAt(springTx.value, 0, springTz.value);
  }
  camera.updateMatrixWorld();
  updateTurnoutLabels();

  if (moved || needsRender) {
    renderer.render(scene, camera);
    needsRender = false;
  }
  if (moved) animationFrame = requestAnimationFrame(animate);
}

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------
let lastTime = 0;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
systemReduceMotion = motionPreference.matches;
reduce = systemReduceMotion;
const themeToggle = document.getElementById('theme-toggle');
function setTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem('india-votes-theme', theme);
  themeToggle.setAttribute('aria-pressed', String(theme === 'light'));
  themeToggle.title = `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`;
  cs();
  if (scene) {
    scene.background.copy(C.bg);
    if (linesMesh) linesMesh.material.color.copy(C['map-line']);
    if (renderer && camera) renderer.render(scene, camera);
  }
}
themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});
window.addEventListener('storage', event => {
  if (event.key === 'india-votes-theme' && (event.newValue === 'light' || event.newValue === 'dark')) {
    setTheme(event.newValue, false);
  }
});
setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);
const motionToggle = document.getElementById('motion-toggle');
function updateMotionPreference() {
  reduce = motionOverride === null ? systemReduceMotion : !motionOverride;
  motionToggle.setAttribute('aria-pressed', String(!reduce));
  motionToggle.textContent = `Particle motion: ${reduce ? 'off' : 'on'}`;
  motionToggle.title = reduce
    ? 'Enable scroll-linked particle motion'
    : 'Disable particle motion';
  if (storyElements.length) updateScrollState(storyElements);
}
motionToggle.addEventListener('click', () => {
  motionOverride = reduce;
  updateMotionPreference();
});
motionPreference.addEventListener('change', event => {
  systemReduceMotion = event.matches;
  updateMotionPreference();
});
updateMotionPreference();
springTx = new Spring(0);
springTz = new Spring(0);
springZoom = new Spring(1);
springOrbit = new Spring(0);
springTilt = new Spring(0);

loadData().then(data => {
  mapBounds = data.mapBounds;
  stateBounds = data.stateBounds;
  particleLayouts = makeParticleLayouts(data);

  const rebuilt = buildScene(data);
  scene = rebuilt.scene;
  camera = rebuilt.camera;
  renderer = rebuilt.renderer;
  turnoutLabels = createTurnoutLabels(particleLayouts.turnoutLabels);
  csData = rebuilt.constituencies;
  constituencyMeshes = csData.map(c => c.mesh);
  meshToC = new Map(csData.map(c => [c.mesh, c]));
  raycaster = new THREE.Raycaster();
  mouseVec = new THREE.Vector2();
  pcTooltip = document.getElementById('pc-tooltip');
  tooltipInner = pcTooltip.querySelector('.pc-tooltip-inner');
  document.body.appendChild(pcTooltip);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('mouseleave', () => { hideTooltip(); hoveredPC = null; });
  CHAPTERS = createChapters(data);

  buildStory();
  const box = document.getElementById('steps');
  const els = [...box.children];

  els.forEach((e, i) => e.dataset.i = i);

  storyElements = els;
  bindChapterScroll(els);
}).catch(err => {
  console.error('Failed to load data:', err);
  const box = document.getElementById('steps');
if (box) {
  const error = document.createElement('p');
  error.style.color = '#b45309';
  error.textContent = `Failed to load local map data: ${err.message}`;
  box.replaceChildren(error);
}
});

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
function size() {
  if (!renderer || !camera) return;
  const r = document.getElementById('gl').getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
  needsRender = true;
  if (storyElements.length) updateScrollState(storyElements);
}
new ResizeObserver(size).observe(document.getElementById('gl'));
size();
