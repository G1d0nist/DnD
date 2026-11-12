// Объёмный вид стола (этапы 1–2 графики). Правил здесь нет: модуль только рисует то, что ему отдаёт table.js.
// Слои 2D-поля (местность, области, досягаемость, туман, вспышки) ложатся на пол как текстуры,
// стены и препятствия поднимаются над клетками, существа — фигурки на подставках.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_DIR = 'lab/models/';
// Имя существа → файл модели и рост в клетках (для размера «Средний»)
const MODELS = [[/гоблин/i, 'goblin', 0.9]];
const PITCH = (55 * Math.PI) / 180, FOV = 35, WALL_H = 0.9, BASE_H = 0.07;
const AMB = { bright: { hemi: 1.15, sun: 2.3, col: 0xffe6c4 }, dim: { hemi: 0.6, sun: 1.0, col: 0xc9b6d6 }, dark: { hemi: 0.5, sun: 0.6, col: 0x7f94d6 } };

export function create(wrap, api) {
  const CELL = api.CELL;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement; canvas.className = 'tbl-g3';
  const over = document.createElement('div'); over.className = 'tbl-g3-over';
  const fxBox = document.createElement('div'); fxBox.className = 'tbl-g3-fx';
  wrap.prepend(fxBox); wrap.prepend(over); wrap.prepend(canvas);

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0a0806); scene.fog = new THREE.Fog(0x0a0806, 10, 100);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 600);
  const hemi = new THREE.HemisphereLight(0xaab6d0, 0x2a2018, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c4, 2); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);
  // Источников света — до шести; два ближайших к центру экрана отбрасывают тени (на телефонах — без теней)
  const fine = !(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  const LAMPS = Array.from({ length: 6 }, (_, i) => {
    const L = new THREE.PointLight(0xff9a4a, 0, 8, 1.6);
    if (i < 2 && fine) { L.castShadow = true; L.shadow.mapSize.set(512, 512); L.shadow.camera.near = 0.05; L.shadow.camera.far = 14; L.shadow.bias = -0.004; L.shadow.normalBias = 0.03; }
    scene.add(L); return L;
  });

  // ---------- Пол и слои ----------
  const unit = new THREE.PlaneGeometry(1, 1); unit.rotateX(-Math.PI / 2);
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const under = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0x0a0806, toneMapped: false, fog: false })); under.position.y = -0.52; under.scale.set(4000, 1, 4000); scene.add(under);
  const layers = {};
  ['terrain', 'areas', 'range', 'fog', 'fx'].forEach((name, i) => {
    const cv = api.canvases[name], tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const mat = i ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.55 }); // краски поля рассчитаны на показ без света — пол немного светится сам
    const mesh = new THREE.Mesh(unit, mat); mesh.position.y = i * 0.012; mesh.renderOrder = i; mesh.receiveShadow = !i;
    scene.add(mesh);
    layers[name] = { cv, tex, mesh, w: 0, h: 0 };
  });
  // Местность. С картой-подложкой холст 2D и есть пол. Без неё пол рисуется здесь (paintGround) — плиты, трава, песок,
  // вода с неровным берегом, — а холст 2D ложится сверху прозрачным слоем пометок (сетка, заметки, значки мастера)
  const terr = layers.terrain, terrLit = terr.mesh.material, terrMarks = new THREE.MeshBasicMaterial({ map: terr.tex, transparent: true, depthWrite: false, toneMapped: false });
  const groundCv = document.createElement('canvas'), groundTex = new THREE.CanvasTexture(groundCv);
  groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const groundMesh = new THREE.Mesh(unit, new THREE.MeshStandardMaterial({ map: groundTex, bumpMap: groundTex, bumpScale: 2.2, roughness: 0.9, emissive: 0xffffff, emissiveMap: groundTex, emissiveIntensity: 0.1 }));
  groundMesh.receiveShadow = true; groundMesh.renderOrder = -1; scene.add(groundMesh);
  function tex(name) {
    const L = layers[name]; if (!L) return;
    // Холст поменял размер — текстуру создаём заново (память под неё выделяется один раз)
    if (L.w !== L.cv.width || L.h !== L.cv.height) { L.tex.dispose(); L.w = L.cv.width; L.h = L.cv.height; }
    L.tex.needsUpdate = true;
    if (name === 'terrain' || name === 'fog') stale = true;
    kick(name === 'fx' ? 80 : 250);
  }

  // ---------- Стены и препятствия ----------
  const noise = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), d = g.createImageData(64, 64);
    for (let i = 0; i < 64 * 64; i++) { const v = 185 + Math.random() * 70; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
    g.putImageData(d, 0, 0); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
    g.strokeRect(0, 0, 64, 32); g.strokeRect(-32, 32, 64, 32); g.strokeRect(32, 32, 64, 32);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const stoneMat = new THREE.MeshStandardMaterial({ map: noise, roughness: 0.95 });
  const plainMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  // Листва: серый рисунок (цвет даёт сама крона) — хвоя штрихами вниз с зубцами по краю яруса и пёстрые листья
  const foliage = (broad) => {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), R = mulberry(broad ? 21 : 22);
    if (broad) {
      g.fillStyle = '#4a4a4a'; g.fillRect(0, 0, N, N);
      for (let i = 0; i < 1100; i++) { const x = R() * N, y = R() * N, r = 4 + R() * 9, v = Math.floor(95 + R() * 160), a = R() * 3.14; g.fillStyle = `rgba(${v},${v},${v},.85)`; for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) { g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.6, a, 0, 6.283); g.fill(); } }
    } else {
      const gr = g.createLinearGradient(0, 0, 0, N); gr.addColorStop(0, '#404040'); gr.addColorStop(0.55, '#909090'); gr.addColorStop(1, '#dcdcdc'); g.fillStyle = gr; g.fillRect(0, 0, N, N);
      g.lineWidth = 1.6; for (let i = 0; i < 1500; i++) { const x = R() * N, y = R() * N, l = 6 + R() * 13; g.strokeStyle = R() < 0.5 ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.32)'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 6, y + l); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,.6)'; for (let x = 0; x < N; x += 16) { g.beginPath(); g.moveTo(x, N); g.lineTo(x + 8, N - 22 - R() * 16); g.lineTo(x + 16, N); g.fill(); }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; if (!broad) t.repeat.set(2, 1); return t;
  };
  const firTex = foliage(false), broadTex = foliage(true);
  const firMat = new THREE.MeshStandardMaterial({ map: firTex, bumpMap: firTex, bumpScale: 2, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ map: broadTex, bumpMap: broadTex, bumpScale: 2.5, roughness: 1 });
  const barkMat = new THREE.MeshStandardMaterial({ map: noise, roughness: 1 });
  // Ярус ели: конус с зубчатым краем (лапы); крона лиственного: неровный шар
  const firTier = (r, h) => { const g = new THREE.ConeGeometry(r, h, 14, 1, true), p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) { const k = (Math.round(Math.atan2(p.getZ(i), p.getX(i)) / (Math.PI / 7)) & 1) ? 0.7 : 1.06; p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); } g.computeVertexNormals(); return g; };
  const blob = (r, seed = 1) => { const g = new THREE.SphereGeometry(r, 12, 9), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = Math.sin(x * 31.7 * seed + y * 47.3 + z * 23.1) * 43758.5453, k = 0.86 + (v - Math.floor(v)) * 0.3; p.setXYZ(i, x * k, y * k * 0.88, z * k); } g.computeVertexNormals(); return g; };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // Бесшовные рисунки из синусов: карта нормалей ряби и корка лавы (сдвигаются со временем)
  const wave = (u, v) => Math.sin(u * 6.283 * 2 + Math.sin(v * 6.283) * 1.3) * 0.5 + Math.sin(v * 6.283 * 3 + u * 6.283) * 0.3 + Math.sin((u + v) * 6.283 * 5) * 0.2;
  const sinTex = (paint) => {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), d = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [r, gg, b] = paint(x / N, y / N), i = (y * N + x) * 4; d.data[i] = r; d.data[i + 1] = gg; d.data[i + 2] = b; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  // Рябь: волны разных направлений со случайной фазой (плитка бесшовная, полос не видно)
  const WV = (() => { const R = mulberry(77), a = []; while (a.length < 14) { const fx = Math.round((R() - 0.5) * 10), fy = Math.round((R() - 0.5) * 10); if (fx || fy) a.push([fx, fy, R() * 6.283, 1 / Math.hypot(fx, fy)]); } return a; })();
  const swell = (u, v) => WV.reduce((h, [fx, fy, ph, am]) => h + Math.sin((u * fx + v * fy) * 6.283 + ph) * am, 0);
  const rippleTex = sinTex((u, v) => { const e = 1 / 128, dx = (swell(u + e, v) - swell(u - e, v)) * 1.6, dy = (swell(u, v + e) - swell(u, v - e)) * 1.6, l = Math.hypot(dx, dy, 1); return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255]; });
  // Блики на воде: светлая сетка по гребням
  const glintTex = sinTex((u, v) => { const k = Math.pow(1 - Math.abs(Math.sin(swell(u, v) * 1.7)), 5) * 255; return [k, k, k]; }); glintTex.colorSpace = THREE.SRGBColorSpace;
  const waterTime = { value: 0 };
  // Три слоя ряби разного размера, плывущие в разные стороны, — рисунок не повторяется и не стоит на месте
  function flowing(mat) {
    mat.onBeforeCompile = (sh) => {
      const from = 'texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0', chunk = THREE.ShaderChunk.normal_fragment_maps;
      if (!chunk.includes(from)) return;
      sh.uniforms.uT = waterTime;
      sh.fragmentShader = 'uniform float uT;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', chunk.replace(from,
        '( texture2D( normalMap, vNormalMapUv + uT * vec2( 0.021, 0.013 ) ).xyz + texture2D( normalMap, vNormalMapUv * 0.43 + uT * vec2( -0.011, 0.017 ) ).xyz + texture2D( normalMap, vNormalMapUv * 1.9 + uT * vec2( 0.006, -0.03 ) ).xyz ) * 0.6667 - 1.0'));
    };
    return mat;
  }
  const lavaTex = sinTex((u, v) => { const k = Math.max(0, Math.min(1, wave(u, v) * 0.8 + 0.5)); return [70 + 185 * k, 12 + 150 * k * k, 4 + 40 * k * k * k]; }); lavaTex.colorSpace = THREE.SRGBColorSpace;
  // Столешница: поле лежит на тёмной каменной плите
  const slab = new THREE.Mesh(box(1, 0.5, 1), new THREE.MeshStandardMaterial({ map: noise, color: 0x3a332c, roughness: 0.9 })); slab.position.y = -0.26; slab.receiveShadow = true; scene.add(slab);
  const ico = (r) => new THREE.IcosahedronGeometry(r, 1);
  // Часть препятствия: геометрия, материал, цвет, высота центра, сдвиг в клетке, v — доля случайного разброса размера
  const PROPS = {
    rock: [{ g: new THREE.IcosahedronGeometry(0.5, 1), m: stoneMat, c: 0x8d867c, y: 0.3, s: [0.92, 0.75, 0.92], v: 0.2, spin: true }],
    tree: [{ g: new THREE.CylinderGeometry(0.06, 0.09, 0.5, 7), m: barkMat, c: 0x6a4a30, y: 0.25 },
      { g: firTier(0.5, 0.62), m: firMat, c: 0x2f6e2c, y: 0.56, v: 0.15, spin: true }, { g: firTier(0.4, 0.56), m: firMat, c: 0x357632, y: 0.9, v: 0.15, spin: true },
      { g: firTier(0.3, 0.5), m: firMat, c: 0x3d8038, y: 1.22, v: 0.15, spin: true }, { g: firTier(0.18, 0.44), m: firMat, c: 0x488c42, y: 1.52, v: 0.15, spin: true }],
    tree2: [{ g: new THREE.CylinderGeometry(0.07, 0.1, 0.75, 7), m: barkMat, c: 0x6a4a30, y: 0.37 },
      { g: blob(0.42), m: leafMat, c: 0x4a8a34, y: 1.05, v: 0.15, spin: true }, { g: blob(0.3, 2), m: leafMat, c: 0x3f7c2c, y: 0.86, dx: -0.24, dz: 0.1, v: 0.15, spin: true },
      { g: blob(0.3, 3), m: leafMat, c: 0x55963c, y: 0.92, dx: 0.22, dz: -0.12, v: 0.15, spin: true }, { g: blob(0.25, 4), m: leafMat, c: 0x5fa044, y: 1.36, dx: 0.04, dz: 0.08, v: 0.15, spin: true }],
    crate: [{ g: box(0.5, 0.5, 0.5), m: plainMat, c: 0x8a5a2b, y: 0.25, dx: -0.16, dz: 0.14 },
      { g: new THREE.CylinderGeometry(0.17, 0.17, 0.46, 12), m: plainMat, c: 0x6e4a26, y: 0.23, dx: 0.24, dz: -0.2 }],
    furn: [{ g: box(0.8, 0.42, 0.8), m: plainMat, c: 0x6e4623, y: 0.21 }],
    grave: [{ g: box(0.42, 0.6, 0.13), m: stoneMat, c: 0x9a9aa2, y: 0.3 }],
    mushroom: [{ g: new THREE.CylinderGeometry(0.08, 0.11, 0.6, 8), m: plainMat, c: 0xd8cfc0, y: 0.3 },
      { g: new THREE.SphereGeometry(0.46, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m: plainMat, c: 0x8a4fb0, y: 0.55, s: [1, 0.6, 1] }],
    bridge: [{ g: box(1, 0.06, 1), m: plainMat, c: 0x7a5230, y: 0.04 }, { g: box(1, 0.1, 0.06), m: plainMat, c: 0x4a2e18, y: 0.12, dz: -0.47 }, { g: box(1, 0.1, 0.06), m: plainMat, c: 0x4a2e18, y: 0.12, dz: 0.47 }],
    bush: [{ g: blob(0.25, 5), m: leafMat, c: 0x5a9a40, y: 0.18, dx: -0.14, dz: 0.1, v: 0.2, spin: true }, { g: blob(0.2, 6), m: leafMat, c: 0x68aa4a, y: 0.15, dx: 0.2, dz: -0.12, v: 0.2, spin: true }],
    thicket: [{ g: firTier(0.26, 0.5), m: firMat, c: 0x2a5e2a, y: 0.27, dx: -0.2, dz: -0.18, v: 0.25, spin: true },
      { g: blob(0.24, 7), m: leafMat, c: 0x356e30, y: 0.2, dx: 0.2, dz: -0.05, v: 0.25, spin: true }, { g: blob(0.2, 8), m: leafMat, c: 0x2c6228, y: 0.15, dx: -0.03, dz: 0.24, v: 0.2, spin: true }],
    rubble: [{ g: ico(0.17), m: stoneMat, c: 0x8a8274, y: 0.1, dx: -0.2, dz: 0.16, s: [1, 0.7, 1], v: 0.3, spin: true }, { g: ico(0.13), m: stoneMat, c: 0x7a7366, y: 0.08, dx: 0.18, dz: -0.2, s: [1, 0.7, 1], v: 0.3, spin: true },
      { g: ico(0.1), m: stoneMat, c: 0x968d7e, y: 0.06, dx: 0.22, dz: 0.24, s: [1, 0.7, 1], v: 0.3, spin: true }],
    snow: [{ g: ico(0.3), m: plainMat, c: 0xe9eef5, y: 0.03, dx: -0.12, dz: 0.1, s: [1.2, 0.35, 1], v: 0.2, spin: true }, { g: ico(0.22), m: plainMat, c: 0xdfe6ef, y: 0.03, dx: 0.22, dz: -0.2, s: [1.2, 0.35, 1], v: 0.2, spin: true }],
    stairs: [0, 1, 2].map((i) => ({ g: box(0.9, 0.1 * (i + 1), 0.3), m: stoneMat, c: 0xa09078, y: 0.05 * (i + 1), dz: 0.3 - i * 0.3 })),
  };
  // ---------- Пол и стены: рисунок как в образце стиля (этап 0б) ----------
  const rgba = (hex, a) => `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;
  // Грунт: основной цвет, оттенки пятен, цвет травинок
  const SOIL = {
    grass: ['#2f4a25', ['#3d5c2e', '#26401f', '#4a6a35'], '#5d8040'], swamp: ['#2a3724', ['#35452b', '#222e1e', '#3f4c2c'], '#52663a'],
    sand: ['#8d7a4c', ['#9d8858', '#7b693f', '#ab9762'], ''], dirt: ['#4a3a2a', ['#584633', '#3c2e21', '#64513b'], ''],
    snow: ['#b4c0cf', ['#c9d3e0', '#a3b0c2', '#dde5ee'], ''], road: ['#6a5842', ['#7a674e', '#5a4a37', '#857258'], ''],
    difficult: ['#3d3226', ['#4a3d2e', '#30271d', '#55483a'], ''], rubble: ['#4b463f', ['#5a554d', '#3c3832', '#676158'], ''],
    shade: ['#1f3019', ['#27391f', '#182613', '#2d4223'], '#3a5a2c'], bog: ['#27321d', ['#324024', '#1c2616', '#3b4a26'], '#6f8a45'],
    water: ['#1c4d6b', ['#235d7e', '#143a54', '#2a6a8c'], ''], ice: ['#93bbd2', ['#b4d8ea', '#7fa9c2', '#cfe8f4'], ''],
    lava: ['#8a2207', ['#c9480d', '#4a1205', '#e8731a'], ''], chasm: ['#050404', ['#0a0807', '#000000', '#0d0b09'], ''],
  };
  const PEBBLES = { road: 3, difficult: 9, rubble: 16, dirt: 1.5, sand: 0.6 };
  function pebble(g, x, y, r, R) {
    const p = [], n = 5 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) { const a = (i * 6.283) / n + R() * 0.5, rr = r * (0.7 + R() * 0.4); p.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8]); }
    const path = (dx, dy) => { g.beginPath(); p.forEach(([px, py], i) => (i ? g.lineTo(px + dx, py + dy) : g.moveTo(px + dx, py + dy))); g.closePath(); };
    g.fillStyle = 'rgba(0,0,0,.45)'; path(r * 0.25, r * 0.25); g.fill();
    g.fillStyle = `hsl(${25 + R() * 15},${5 + R() * 8}%,${30 + R() * 18}%)`; path(0, 0); g.fill();
    g.fillStyle = 'rgba(255,240,220,.12)'; path(-r * 0.15, -r * 0.2); g.fill();
  }
  // Закрасить прямоугольник грунтом: пятна, крапинки, травинки, камешки, трещины льда, жилы лавы
  function soil(g, kind, x0, y0, w, h, s, R) {
    const [base, tones, blade] = SOIL[kind], n = (w * h) / (s * s), pick = () => tones[Math.floor(R() * tones.length)];
    g.fillStyle = base; g.fillRect(x0, y0, w, h);
    for (let i = 0; i < n * 1.8; i++) { const x = x0 + R() * w, y = y0 + R() * h, r = s * (0.3 + R() * 0.9), c = pick(), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, rgba(c, 0.55)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    for (let i = 0; i < n * 40; i++) { g.fillStyle = R() < 0.4 ? 'rgba(0,0,0,.16)' : rgba(pick(), 0.6); const d = (1 + R() * 2.2) * (s / 64); g.fillRect(x0 + R() * w, y0 + R() * h, d, d); }
    if (blade) { g.strokeStyle = rgba(blade, 0.55); g.lineWidth = Math.max(1, s / 56); g.beginPath(); for (let i = 0; i < n * 34; i++) { const x = x0 + R() * w, y = y0 + R() * h, l = s * (0.04 + R() * 0.08); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * l, y - l); } g.stroke(); }
    for (let i = 0; i < n * (PEBBLES[kind] || 0); i++) pebble(g, x0 + R() * w, y0 + R() * h, s * (0.025 + R() * 0.06), R);
    const veins = kind === 'ice' ? ['rgba(255,255,255,.5)', 1.4, 0.02] : kind === 'lava' ? ['rgba(255,214,110,.75)', 2.2, 0.035] : null;
    if (veins) { g.strokeStyle = veins[0]; g.lineWidth = s * veins[2]; for (let i = 0; i < n * veins[1]; i++) { let x = x0 + R() * w, y = y0 + R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (R() - 0.5) * s * 0.5; y += (R() - 0.5) * s * 0.5; g.lineTo(x, y); } g.stroke(); } }
  }
  // Каменные плиты клетки: одна, две или четыре, с фаской, крапом и трещинами; warm — светлее (пол в доме)
  function flag(g, x, y, s, warm) {
    const R = mulberry(x * 7919 + y * 104729 + 13), X = x * s, Y = y * s, lay = R(), k = s / 64;
    const rects = lay < 0.3 ? [[0, 0, 1, 1]] : lay < 0.55 ? [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]] : lay < 0.8 ? [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]] : [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]];
    g.fillStyle = '#0d0b09'; g.fillRect(X, Y, s, s);
    for (const [a, b, c, d] of rects) {
      const x0 = X + a * s + 1.5 * k, y0 = Y + b * s + 1.5 * k, w = c * s - 3 * k, h = d * s - 3 * k, j = () => (R() - 0.5) * 2.4 * k;
      const p = [[x0 + j(), y0 + j()], [x0 + w + j(), y0 + j()], [x0 + w + j(), y0 + h + j()], [x0 + j(), y0 + h + j()]];
      const L = (warm ? 33 : 25) + R() * 11, hue = 24 + R() * 16, sat = (warm ? 12 : 6) + R() * 9;
      g.beginPath(); p.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.closePath();
      const gr = g.createLinearGradient(x0, y0, x0 + w, y0 + h); gr.addColorStop(0, `hsl(${hue},${sat}%,${L + 5}%)`); gr.addColorStop(1, `hsl(${hue},${sat}%,${L - 7}%)`);
      g.fillStyle = gr; g.fill();
      g.save(); g.clip();
      for (let i = 0; i < 30; i++) { g.fillStyle = R() < 0.5 ? 'rgba(255,240,220,.05)' : 'rgba(0,0,0,.13)'; g.fillRect(x0 + R() * w, y0 + R() * h, (1 + R() * 2.5) * k, (1 + R() * 2.5) * k); }
      if (R() < 0.55) { const bx = x0 + R() * w, by = y0 + R() * h, br = (8 + R() * 18) * k, bg = g.createRadialGradient(bx, by, 0, bx, by, br); bg.addColorStop(0, R() < 0.5 ? 'rgba(0,0,0,.18)' : 'rgba(255,230,200,.07)'); bg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = bg; g.fillRect(bx - br, by - br, br * 2, br * 2); }
      if (R() < 0.25) { g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = k; g.beginPath(); let cx = x0 + R() * w, cy = y0 + R() * h; g.moveTo(cx, cy); for (let i = 0; i < 4; i++) { cx += (R() - 0.5) * 18 * k; cy += (R() - 0.5) * 18 * k; g.lineTo(cx, cy); } g.stroke(); }
      g.restore();
      g.lineWidth = 1.2 * k;
      g.strokeStyle = 'rgba(255,235,210,.10)'; g.beginPath(); g.moveTo(p[3][0], p[3][1]); g.lineTo(p[0][0], p[0][1]); g.lineTo(p[1][0], p[1][1]); g.stroke();
      g.strokeStyle = 'rgba(0,0,0,.38)'; g.beginPath(); g.moveTo(p[1][0], p[1][1]); g.lineTo(p[2][0], p[2][1]); g.lineTo(p[3][0], p[3][1]); g.stroke();
    }
  }
  // Дощатый пол на всё поле: доски вдоль, разной длины, со стыками и волокнами
  function planks(g, W, H, s, R) {
    const bh = s / 3;
    for (let r = 0; r * bh < H; r++) for (let x = -R() * s; x < W;) {
      const len = s * (1.5 + R() * 2), y = r * bh, L = 19 + R() * 9;
      g.fillStyle = `hsl(${24 + R() * 10},${28 + R() * 10}%,${L}%)`; g.fillRect(x, y, len, bh);
      g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = Math.max(1, s / 90); g.beginPath();
      for (let i = 0; i < 4; i++) { const yy = y + R() * bh; g.moveTo(x + R() * len * 0.3, yy); g.lineTo(x + len * (0.6 + R() * 0.4), yy + (R() - 0.5) * 2); } g.stroke();
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x + len - s / 40, y, s / 40, bh); g.fillRect(x, y + bh - s / 48, len, s / 48);
      g.fillStyle = 'rgba(255,230,190,.07)'; g.fillRect(x, y, len, s / 48);
      x += len;
    }
  }
  // Пятно местности: клетки, раздутые и с неровным краем — чтобы граница не шла по квадратам
  function blot(g, cells, has, s, grow, R) {
    g.fillStyle = g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.lineWidth = grow * 2 * s;
    cells.forEach(([x, y]) => {
      g.fillRect(x * s - 0.5, y * s - 0.5, s + 1, s + 1); g.strokeRect(x * s, y * s, s, s);
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy]) => {
        if (has(x + dx, y + dy)) return;
        for (let i = 0; i < 6; i++) {
          const t = R(), out = grow * s * (0.2 + R() * 1.2), r = s * (0.05 + R() * 0.13);
          const cx = (x + 0.5 + dx * 0.5 + (dx ? 0 : t - 0.5)) * s + dx * out, cy = (y + 0.5 + dy * 0.5 + (dy ? 0 : t - 0.5)) * s + dy * out;
          g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill();
        }
      });
    });
  }
  // [грунт, типы клеток, раздутие, цвет каймы, ширина каймы, плотность]
  const PATCH = [['road', ['road'], 0.1, 'rgba(0,0,0,.3)', 0.1, 1], ['sand', ['sand'], 0.14, '', 0, 1], ['snow', ['snow'], 0.14, 'rgba(255,255,255,.3)', 0.12, 1],
    ['difficult', ['difficult'], 0.1, 'rgba(0,0,0,.35)', 0.1, 0.92], ['rubble', ['rubble'], 0.1, 'rgba(0,0,0,.35)', 0.1, 0.88], ['shade', ['tree', 'thicket', 'bush', 'mushroom'], 0.16, '', 0, 0.72],
    ['bog', ['bog'], 0.12, 'rgba(8,12,6,.75)', 0.16, 1], ['water', ['water'], 0.12, 'rgba(8,12,10,.8)', 0.18, 1], ['ice', ['ice'], 0.1, 'rgba(220,240,255,.4)', 0.1, 1],
    ['lava', ['lava'], 0.1, 'rgba(255,110,20,.95)', 0.28, 1], ['chasm', ['chasm'], 0.06, 'rgba(0,0,0,.95)', 0.22, 1]];
  // Блестящая плёнка над водой, болотом, льдом и лавой — одной плоскостью по маске пятна
  const LIQ = { water: { color: 0x3a86aa, opacity: 0.5, rough: 0.1, ripple: 1 }, bog: { color: 0x3c4c26, opacity: 0.45, rough: 0.2, ripple: 1 }, ice: { color: 0xe2f4ff, opacity: 0.3, rough: 0.05 }, lava: { lava: 1, opacity: 0.8 } };
  const liquids = {}, tmpCv = document.createElement('canvas');
  let groundSig = '', mapRev = 0;
  function paintGround() {
    const map = S.map, sig = `${S.w}x${S.h}|${S.ground}|` + Object.entries(map).map(([k, t]) => k + t).join(',');
    if (sig === groundSig) return; groundSig = sig; mapRev++;
    const s = Math.max(24, Math.min(64, Math.floor(4096 / Math.max(S.w, S.h)))), W = S.w * s, H = S.h * s;
    if (groundCv.width !== W || groundCv.height !== H) { groundTex.dispose(); groundCv.width = W; groundCv.height = H; }
    tmpCv.width = W; tmpCv.height = H;
    const g = groundCv.getContext('2d'), tg = tmpCv.getContext('2d'), R = mulberry(S.w * 31 + S.h), at = (x, y) => map[`${x}_${y}`];
    const by = {}; Object.entries(map).forEach(([k, t]) => { const [x, y] = k.split('_').map(Number); if (x >= 0 && y >= 0 && x < S.w && y < S.h) (by[t] = by[t] || []).push([x, y]); });
    // Основа: грунт по виду местности, доски или каменные плиты
    if (SOIL[S.ground]) soil(g, S.ground, 0, 0, W, H, s, R);
    else if (S.ground === 'wood') { g.fillStyle = '#1a120b'; g.fillRect(0, 0, W, H); planks(g, W, H, s, R); }
    else for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) flag(g, x, y, s, false);
    PATCH.forEach(([kind, types, grow, rim, rimW, alpha], pi) => {
      let cells = types.flatMap((t) => by[t] || []);
      // Мост над водой — вода идёт и под ним
      if (LIQ[kind]) cells = cells.concat((by.bridge || []).filter(([x, y]) => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => at(x + dx, y + dy) === kind)));
      const L = LIQ[kind] && (liquids[kind] = liquids[kind] || {});
      if (L && L.mesh) L.mesh.visible = cells.length > 0;
      if (!cells.length) return;
      const set = new Set(cells.map(([x, y]) => `${x}_${y}`)), has = (x, y) => set.has(`${x}_${y}`);
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]), x0 = (Math.min(...xs) - 1) * s, y0 = (Math.min(...ys) - 1) * s, w = (Math.max(...xs) + 2) * s - x0, h = (Math.max(...ys) + 2) * s - y0;
      tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, W, H);
      blot(tg, cells, has, s, grow, mulberry(pi * 977 + 5));
      tg.globalCompositeOperation = 'source-atop'; soil(tg, kind, x0, y0, w, h, s, mulberry(pi * 131 + 7));
      g.save(); g.globalAlpha = alpha; if (rim) { g.shadowColor = rim; g.shadowBlur = rimW * s; } g.drawImage(tmpCv, 0, 0); g.restore();
      if (!L) return;
      // Маска для блестящей плёнки — те же пятна (то же зерно), вдвое мельче
      const ms = s / 2, P = LIQ[kind];
      if (!L.mesh) {
        L.cv = document.createElement('canvas'); L.tex = new THREE.CanvasTexture(L.cv);
        const mat = P.lava ? new THREE.MeshBasicMaterial({ map: lavaTex, toneMapped: false }) : new THREE.MeshStandardMaterial({ color: P.color, roughness: P.rough, metalness: 0.3, normalMap: P.ripple ? rippleTex : null, normalScale: new THREE.Vector2(0.55, 0.55) });
        if (P.ripple) flowing(mat);
        mat.alphaMap = L.tex; mat.transparent = true; mat.opacity = P.opacity; mat.depthWrite = false;
        L.mesh = new THREE.Mesh(unit, mat); L.mesh.position.y = 0.002; L.mesh.renderOrder = -0.5; L.mesh.receiveShadow = !P.lava; scene.add(L.mesh);
        if (kind === 'water') { L.glint = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ map: glintTex, alphaMap: L.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.09 })); L.glint.position.y = 0.003; L.glint.renderOrder = -0.4; L.mesh.add(L.glint); L.glint.position.set(0, 0.001, 0); }
      }
      if (L.cv.width !== S.w * ms || L.cv.height !== S.h * ms) { L.tex.dispose(); L.cv.width = S.w * ms; L.cv.height = S.h * ms; }
      const mg = L.cv.getContext('2d'); mg.fillStyle = '#000'; mg.fillRect(0, 0, L.cv.width, L.cv.height);
      blot(mg, cells, has, ms, grow, mulberry(pi * 977 + 5)); L.tex.needsUpdate = true;
      L.mesh.scale.set(S.w, 1, S.h); L.mesh.position.x = S.w / 2; L.mesh.position.z = S.h / 2; L.mesh.visible = true;
    });
    // Пол в доме — тёплые плиты ровно по клеткам
    (by.floor || []).forEach(([x, y]) => flag(g, x, y, s, true));
    (by.wall || []).forEach(([x, y]) => { g.fillStyle = '#100d0b'; g.fillRect(x * s, y * s, s, s); });
    // Тень у основания стен и под предметами
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const t = at(x, y); if (t === 'wall') continue;
      const X = x * s, Y = y * s;
      for (const [dx, dy, d, a] of [[0, -1, 0.5, 0.6], [0, 1, 0.25, 0.35], [-1, 0, 0.32, 0.4], [1, 0, 0.32, 0.4]]) {
        if (at(x + dx, y + dy) !== 'wall') continue;
        const gr = dy === -1 ? g.createLinearGradient(0, Y, 0, Y + d * s) : dy === 1 ? g.createLinearGradient(0, Y + s, 0, Y + s - d * s) : dx === -1 ? g.createLinearGradient(X, 0, X + d * s, 0) : g.createLinearGradient(X + s, 0, X + s - d * s, 0);
        gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X, Y, s, s);
      }
      if (PROPS[t] && t !== 'bridge' && t !== 'snow') { const gr = g.createRadialGradient(X + s / 2, Y + s / 2, 0, X + s / 2, Y + s / 2, s * 0.6); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - s * 0.1, Y - s * 0.1, s * 1.2, s * 1.2); }
    }
    rippleTex.repeat.set(S.w / 1.6, S.h / 1.6); glintTex.repeat.set(S.w / 2.7, S.h / 2.7); lavaTex.repeat.set(S.w / 2, S.h / 2);
    groundTex.needsUpdate = true;
  }
  // Кладка стен: камни рядами со сдвигом; верх стены — тёмный срез
  function brickCanvas(top) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), R = mulberry(top ? 11 : 3);
    g.fillStyle = top ? '#16130f' : '#1d1814'; g.fillRect(0, 0, 256, 256);
    if (top) { for (let i = 0; i < 400; i++) { g.fillStyle = R() < 0.5 ? 'rgba(255,240,220,.05)' : 'rgba(0,0,0,.3)'; g.fillRect(R() * 256, R() * 256, 2 + R() * 4, 2 + R() * 4); } return c; }
    for (let r = 0; r < 8; r++) for (let x = -(r % 2) * 24 - R() * 10; x < 256;) {
      const w = 40 + R() * 26, x0 = Math.max(0, x) + 2, x1 = Math.min(256, x + w) - 2;
      if (x1 > x0) {
        g.fillStyle = `hsl(${24 + R() * 14},${6 + R() * 8}%,${33 + R() * 14}%)`; g.fillRect(x0, r * 32 + 2, x1 - x0, 28);
        g.fillStyle = 'rgba(255,235,210,.12)'; g.fillRect(x0, r * 32 + 2, x1 - x0, 2);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0, r * 32 + 27, x1 - x0, 3);
        for (let k = 0; k < 12; k++) { g.fillStyle = R() < 0.5 ? 'rgba(255,240,220,.06)' : 'rgba(0,0,0,.18)'; g.fillRect(x0 + R() * (x1 - x0), r * 32 + 2 + R() * 28, 2, 2); }
      }
      x += w;
    }
    return c;
  }
  const brickTex = new THREE.CanvasTexture(brickCanvas(false)), topTex = new THREE.CanvasTexture(brickCanvas(true));
  [brickTex, topTex].forEach((t) => { t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); });
  const wallMats = [new THREE.MeshStandardMaterial({ map: brickTex, bumpMap: brickTex, bumpScale: 3.5, roughness: 0.92, vertexColors: true }), new THREE.MeshStandardMaterial({ map: topTex, roughness: 1, color: 0xd0c8c0, vertexColors: true })];
  // Стены одной сеткой: грани только наружу, кладка идёт сплошной лентой через клетки (а не повторяется в каждой)
  let wallMesh = null, wallSig = '';
  function buildWalls() {
    // Яркость грани берётся у клетки пола, на которую грань смотрит: стена комнаты видна так же, как сама комната
    // (клетка стены, заслонённая соседней стеной, «не видна» туману войны, хотя её грань у всех на глазах)
    const isWall = (x, y) => S.map[`${x}_${y}`] === 'wall', inb = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h;
    const D = [[0, -1], [0, 1], [1, 0], [-1, 0]], plan = [];
    Object.entries(S.map).forEach(([k, t]) => {
      if (t !== 'wall') return;
      const [x, y] = k.split('_').map(Number), own = S.shade(k);
      const f = D.map(([dx, dy]) => (isWall(x + dx, y + dy) ? -1 : inb(x + dx, y + dy) ? S.shade(`${x + dx}_${y + dy}`) : own));
      let top = own; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && inb(x + dx, y + dy) && !isWall(x + dx, y + dy)) top = Math.max(top, S.shade(`${x + dx}_${y + dy}`));
      if (top >= 0 || f.some((v) => v >= 0)) plan.push([x, y, f, top]);
    });
    const sig = JSON.stringify(plan);
    if (sig === wallSig) return; wallSig = sig;
    if (wallMesh) { scene.remove(wallMesh); wallMesh.geometry.dispose(); wallMesh = null; }
    if (!plan.length) return;
    const pos = [], nor = [], uv = [], col = [], side = [], top = [], Hh = WALL_H;
    const quad = (v, n, uvs, c, into) => { const i = pos.length / 3; v.forEach((p, j) => { pos.push(...p); nor.push(...n); uv.push(...uvs[j]); col.push(c, c, c); }); into.push(i, i + 1, i + 2, i, i + 2, i + 3); };
    plan.forEach(([x, y, f, ts]) => {
      const j = 0.92 + rnd(x, y, 3) * 0.16, u0 = x / 2, u1 = (x + 1) / 2, w0 = y / 2, w1 = (y + 1) / 2, V = 0.5;
      if (f[0] >= 0) quad([[x + 1, 0, y], [x, 0, y], [x, Hh, y], [x + 1, Hh, y]], [0, 0, -1], [[u1, 0], [u0, 0], [u0, V], [u1, V]], f[0] * j, side);
      if (f[1] >= 0) quad([[x, 0, y + 1], [x + 1, 0, y + 1], [x + 1, Hh, y + 1], [x, Hh, y + 1]], [0, 0, 1], [[u0, 0], [u1, 0], [u1, V], [u0, V]], f[1] * j, side);
      if (f[2] >= 0) quad([[x + 1, 0, y + 1], [x + 1, 0, y], [x + 1, Hh, y], [x + 1, Hh, y + 1]], [1, 0, 0], [[w1, 0], [w0, 0], [w0, V], [w1, V]], f[2] * j, side);
      if (f[3] >= 0) quad([[x, 0, y], [x, 0, y + 1], [x, Hh, y + 1], [x, Hh, y]], [-1, 0, 0], [[w0, 0], [w1, 0], [w1, V], [w0, V]], f[3] * j, side);
      if (ts >= 0) quad([[x, Hh, y + 1], [x + 1, Hh, y + 1], [x + 1, Hh, y], [x, Hh, y]], [0, 1, 0], [[u0, w1], [u1, w1], [u1, w0], [u0, w0]], ts * j, top);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(side.concat(top)); geo.addGroup(0, side.length, 0); geo.addGroup(side.length, top.length, 1);
    wallMesh = new THREE.Mesh(geo, wallMats); wallMesh.castShadow = wallMesh.receiveShadow = true; scene.add(wallMesh);
  }
  const propBox = new THREE.Group(), doorBox = new THREE.Group(), lampBox = new THREE.Group(); scene.add(propBox, doorBox, lampBox);
  let propSig = '', doorSig = '', lampSig = '', stale = true, S = null;
  const rnd = (x, y, n) => { const v = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453; return v - Math.floor(v); };
  function buildProps() {
    const cells = Object.entries(S.map).filter(([k, t]) => PROPS[t] && S.shade(k) >= 0);
    const sig = `${S.w}x${S.h}|` + cells.map(([k, t]) => `${k}${t}${S.shade(k)}`).join(',');
    if (sig === propSig) return; propSig = sig;
    propBox.children.slice().forEach((m) => { propBox.remove(m); m.dispose(); });
    const leafy = !['snow', 'sand'].includes(S.ground), by = {};
    cells.forEach(([k, t]) => { const [x, y] = k.split('_').map(Number), v = t === 'tree' && leafy && rnd(x, y, 5) > 0.6 ? 'tree2' : t; (by[v] = by[v] || []).push(k); });
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
    Object.entries(by).forEach(([t, ks]) => PROPS[t].forEach((p, pi) => {
      const im = new THREE.InstancedMesh(p.g, p.m, ks.length); im.receiveShadow = true; im.castShadow = !p.flat; if (p.flat) im.renderOrder = 0.5;
      ks.forEach((k, i) => {
        const [x, y] = k.split('_').map(Number), r = rnd(x, y, pi), k1 = 1 + (p.v ? (rnd(x, y, 77) - 0.5) * 2 * p.v : 0), s = p.s || [1, 1, 1];
        P.set(x + 0.5 + (p.dx || 0), p.y * (p.v ? k1 : 1), y + 0.5 + (p.dz || 0)); Q.setFromEuler(E.set(0, p.spin ? r * 6.28 : 0, 0)); SC.set(s[0] * k1, s[1] * k1, s[2] * k1);
        im.setMatrixAt(i, M.compose(P, Q, SC));
        im.setColorAt(i, C.set(p.c).offsetHSL((rnd(x, y, 11) - 0.5) * 0.06, 0, 0).multiplyScalar(S.shade(k) * (0.88 + rnd(x, y, 9) * 0.24)));
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      propBox.add(im);
    }));
  }
  const doorGeo = box(0.96, 0.84, 0.1), lockGeo = box(0.12, 0.14, 0.14), jambGeo = box(0.09, 0.9, 0.2);
  const doorTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), R = mulberry(41);
    for (let i = 0; i < 5; i++) {
      const x = i * 25.6; g.fillStyle = `hsl(${24 + R() * 8},${36 + R() * 10}%,${22 + R() * 8}%)`; g.fillRect(x, 0, 25.6, 128);
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; for (let k = 0; k < 5; k++) { const gx = x + 3 + R() * 20; g.beginPath(); g.moveTo(gx, R() * 30); g.lineTo(gx + (R() - 0.5) * 3, 128 - R() * 30); g.stroke(); }
      g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(x, 0, 1.6, 128); g.fillStyle = 'rgba(255,225,180,.1)'; g.fillRect(x + 1.6, 0, 1.2, 128);
    }
    [20, 94].forEach((y) => { g.fillStyle = '#2b2724'; g.fillRect(0, y, 128, 13); g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, y, 128, 1.5); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + 13, 128, 2); for (let x = 9; x < 128; x += 22) { g.fillStyle = '#77716a'; g.beginPath(); g.arc(x, y + 6.5, 2.6, 0, 6.283); g.fill(); } });
    g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 4; g.beginPath(); g.arc(101, 66, 8, 0, 6.283); g.stroke(); g.strokeStyle = '#9a9388'; g.lineWidth = 2.6; g.beginPath(); g.arc(100, 64, 8, 0, 6.283); g.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const doorMats = {}, doorMat = (sh) => (doorMats[sh] = doorMats[sh] || new THREE.MeshStandardMaterial({ map: doorTex, bumpMap: doorTex, bumpScale: 2.5, roughness: 0.8, color: new THREE.Color(sh, sh, sh) }));
  const jambMats = {}, jambMat = (sh) => (jambMats[sh] = jambMats[sh] || new THREE.MeshStandardMaterial({ map: noise, roughness: 0.9, color: new THREE.Color(0x5a4a3c).multiplyScalar(sh) }));
  function buildDoors() {
    const sig = JSON.stringify(S.doors) + Object.keys(S.doors).map((k) => S.shade(k)).join('') + mapRev;
    if (sig === doorSig) return; doorSig = sig;
    doorBox.clear();
    Object.entries(S.doors).forEach(([k, d]) => {
      const sh = S.shade(k); if (sh < 0 || !d) return;
      const [x, y] = k.split('_').map(Number), solid = (a, b) => S.map[`${a}_${b}`] === 'wall';
      const alongX = (solid(x - 1, y) || solid(x + 1, y)) || !(solid(x, y - 1) || solid(x, y + 1));
      const g = new THREE.Group(); g.position.set(x + 0.5, 0, y + 0.5); g.rotation.y = alongX ? 0 : Math.PI / 2;
      const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
      // Косяки по сторонам проёма; открытая створка стоит вдоль косяка
      add(jambGeo, jambMat(sh), -0.46, 0.45, 0); add(jambGeo, jambMat(sh), 0.46, 0.45, 0);
      const leaf = add(doorGeo, doorMat(sh), 0, 0.42, 0);
      if (d.o) { leaf.rotation.y = Math.PI / 2; leaf.position.set(-0.36, 0.42, 0.4); leaf.scale.x = 0.9; }
      else if (d.l) add(lockGeo, goldMat, 0.3, 0.42, 0);
      doorBox.add(g);
    });
  }
  // Сундуки (закрытый и открытый) и брошенные вещи (мешок в углу клетки)
  const lootBox = new THREE.Group(); scene.add(lootBox); let lootSig = '';
  const chestG = box(0.6, 0.32, 0.4), lidG = box(0.62, 0.12, 0.42), bandG = box(0.08, 0.34, 0.42), sackG = new THREE.SphereGeometry(0.15, 10, 8);
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4a64a, metalness: 0.85, roughness: 0.35 });
  function buildLoot() {
    const all = [...S.chests.map((c) => ({ ...c, chest: 1 })), ...S.drops], sig = all.map((c) => `${c.x}_${c.y}${c.chest ? (c.o ? 'o' : 'c') : 'd'}${S.shade(`${c.x}_${c.y}`)}`).join(',');
    if (sig === lootSig) return; lootSig = sig;
    lootBox.children.slice().forEach((g) => { lootBox.remove(g); g.traverse((o) => { if (o.userData.own) o.material.dispose(); }); });
    all.forEach((c) => {
      const sh = S.shade(`${c.x}_${c.y}`); if (sh < 0) return;
      const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(c.chest ? 0x6b4423 : 0x8a6a3c).multiplyScalar(sh), roughness: 0.85 });
      const add = (geo, mat, x, y, z, own) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.userData.own = !!own; g.add(m); return m; };
      if (c.chest) {
        g.position.set(c.x + 0.5, 0, c.y + 0.5);
        add(chestG, wood, 0, 0.16, 0, 1); add(bandG, goldMat, -0.2, 0.17, 0); add(bandG, goldMat, 0.2, 0.17, 0);
        const lid = add(lidG, wood, 0, 0.38, 0);
        if (c.o) { lid.rotation.x = -1.15; lid.position.set(0, 0.5, -0.24); } else add(box(0.1, 0.12, 0.04), goldMat, 0, 0.3, 0.21);
      } else { g.position.set(c.x + 0.76, 0, c.y + 0.78); add(sackG, wood, 0, 0.11, 0, 1).scale.set(1, 0.8, 1); add(new THREE.SphereGeometry(0.05, 8, 6), wood, 0, 0.25, 0); }
      lootBox.add(g);
    });
  }
  // ---------- Свет: факелы на поле и свет в руках ----------
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.3, 'rgba(255,160,60,.7)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  const stickGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.34, 6), cupGeo = new THREE.CylinderGeometry(0.055, 0.03, 0.07, 8), plateGeo = box(0.13, 0.2, 0.05);
  const postGeo = new THREE.CylinderGeometry(0.03, 0.045, 0.75, 6), footGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.05, 8);
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5, metalness: 0.8 }), stickMat = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.9 });
  const flameMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const coreMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xfff4d0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  function buildLamps() {
    const wall = (x, y) => S.map[`${x}_${y}`] === 'wall', inb = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h;
    // Где висит каждый источник: у стены — на держателе (сначала дальняя от камеры стена), иначе — на стойке посреди клетки
    S.lights.forEach((L) => {
      L.px = L.x; L.pz = L.y; L.py = 0.85; L.dir = null;
      if (!L.fix) return;
      let cx = Math.floor(L.x), cy = Math.floor(L.y), dir = null;
      if (wall(cx, cy)) { const o = [[0, 1], [1, 0], [-1, 0], [0, -1]].find(([dx, dy]) => inb(cx + dx, cy + dy) && !wall(cx + dx, cy + dy)); if (o) { dir = [-o[0], -o[1]]; cx += o[0]; cy += o[1]; } }
      else dir = [[0, -1], [-1, 0], [1, 0], [0, 1]].find(([dx, dy]) => wall(cx + dx, cy + dy)) || null;
      if (dir) { L.dir = dir; L.cx = cx; L.cy = cy; L.px = cx + 0.5 + dir[0] * 0.22; L.pz = cy + 0.5 + dir[1] * 0.22; L.py = 0.92; } else L.py = 0.98;
    });
    const sig = JSON.stringify(S.lights) + S.amb;
    if (sig !== lampSig) {
      lampSig = sig; lampBox.clear();
      const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); lampBox.add(m); return m; };
      const flame = (x, y, z) => { const a = new THREE.Sprite(flameMat); a.position.set(x, y, z); a.scale.setScalar(0.5); a.userData.flame = 0.5; const b = new THREE.Sprite(coreMat); b.position.set(x, y - 0.03, z); b.scale.setScalar(0.17); b.userData.flame = 0.17; lampBox.add(a, b); };
      S.lights.filter((L) => L.fix).forEach((L) => {
        if (L.dir) {
          const [dx, dy] = L.dir, wx = L.cx + 0.5 + dx * 0.5, wz = L.cy + 0.5 + dy * 0.5;
          add(plateGeo, ironMat, wx - dx * 0.03, 0.58, wz - dy * 0.03).rotation.y = dx ? Math.PI / 2 : 0;
          const st = add(stickGeo, stickMat, wx - dx * 0.11, 0.66, wz - dy * 0.11); st.rotation.set(-dy * 0.5, 0, dx * 0.5);
          add(cupGeo, ironMat, wx - dx * 0.19, 0.81, wz - dy * 0.19).rotation.set(-dy * 0.5, 0, dx * 0.5);
          flame(wx - dx * 0.21, 0.92, wz - dy * 0.21);
        } else {
          add(footGeo, ironMat, L.x, 0.025, L.y); add(postGeo, stickMat, L.x, 0.4, L.y).castShadow = true; add(cupGeo, ironMat, L.x, 0.8, L.y).scale.setScalar(1.5);
          flame(L.x, 0.95, L.y);
        }
      });
    }
    // Настоящих источников — не больше шести, ближайшие к центру экрана
    const near = S.lights.slice().sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.z) - Math.hypot(b.x - cur.x, b.y - cur.z));
    const power = S.amb === 'bright' ? 0.35 : 1;
    LAMPS.forEach((L, i) => {
      const s = near[i];
      if (!s) { L.intensity = 0; L.userData.base = 0; return; }
      L.position.set(s.px, s.py, s.pz); L.distance = Math.max(3, s.r * 1.25); L.userData.base = 8 * power; L.userData.seed = s.x * 7 + s.y * 13; L.intensity = L.userData.base;
    });
  }
  function pull() {
    stale = false; S = api.state();
    [groundMesh, ...Object.values(layers).map((L) => L.mesh)].forEach((m) => { m.scale.set(S.w, 1, S.h); m.position.x = S.w / 2; m.position.z = S.h / 2; });
    terr.mesh.material = S.bg ? terrLit : terrMarks; terr.mesh.position.y = S.bg ? 0 : 0.004; groundMesh.visible = !S.bg;
    if (S.bg) Object.values(liquids).forEach((L) => { if (L.mesh) L.mesh.visible = false; }); else paintGround();
    buildWalls();
    slab.scale.set(S.w + 0.7, 1, S.h + 0.7); slab.position.x = S.w / 2; slab.position.z = S.h / 2;
    const a = AMB[S.amb] || AMB.bright;
    hemi.intensity = a.hemi; sun.intensity = a.sun; sun.color.set(a.col);
    if (liquids.water && liquids.water.glint) liquids.water.glint.material.opacity = S.amb === 'bright' ? 0.09 : S.amb === 'dim' ? 0.05 : 0.025;
    buildProps(); buildDoors(); buildLoot(); buildLamps();
  }

  // ---------- Существа ----------
  const toks = new Map(), loader = new GLTFLoader(), modelCache = {};
  const model = (file) => (modelCache[file] = modelCache[file] || new Promise((ok) => loader.load(`${MODEL_DIR}${file}.glb`, (g) => ok(g.scene), undefined, () => ok(null))));
  const ringGeo = new THREE.RingGeometry(0.47, 0.54, 48); ringGeo.rotateX(-Math.PI / 2);
  const turnGeo = new THREE.RingGeometry(0.57, 0.62, 48); turnGeo.rotateX(-Math.PI / 2);
  const pickMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  function faceCanvas(t) {
    const c = document.createElement('canvas'); c.width = c.height = 160; const g = c.getContext('2d');
    const paint = (img) => {
      const gr = g.createRadialGradient(80, 70, 10, 80, 80, 90); gr.addColorStop(0, t.dead ? '#4a4744' : '#3a3229'); gr.addColorStop(1, '#14110e');
      g.fillStyle = gr; g.fillRect(0, 0, 160, 160);
      if (img) { const k = Math.min(img.naturalWidth, img.naturalHeight); g.drawImage(img, (img.naturalWidth - k) / 2, (img.naturalHeight - k) / 2, k, k, 0, 0, 160, 160); return; }
      const txt = t.dead ? '☠' : t.ic || (t.name || '?').trim().slice(0, 2);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = t.dead ? '#b9b2a6' : '#f2e3bf';
      g.font = `${t.dead || t.ic ? 92 : 70}px Georgia, "Segoe UI Emoji", serif`; g.fillText(txt, 80, 88);
    };
    paint(null);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    if (t.img && !t.dead) {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { try { paint(im); tx.needsUpdate = true; kick(); } catch (e) { /* чужая картинка без разрешения — остаются буквы */ } };
      im.src = t.img;
    }
    return tx;
  }
  // Фигурка: модель по имени существа, иначе — медальон с портретом на ножке
  function buildBody(T, t) {
    const s = t.size, col = new THREE.Color(t.color), g = new THREE.Group();
    if (T.body) { T.fig.remove(T.body); T.body.traverse((o) => { if (o.userData.own) { o.material.map && o.material.map.dispose(); o.material.dispose(); o.geometry.dispose(); } }); }
    T.mats = []; T.spin = false;
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.userData.own = true; g.add(m); T.mats.push(mat); return m; };
    const r = 0.4 * s, cy = 0.3 * s + r, face = faceCanvas(t);
    add(new THREE.CylinderGeometry(0.035 * s, 0.06 * s, 0.32 * s, 8), new THREE.MeshStandardMaterial({ color: 0x2a231c, roughness: 0.6, metalness: 0.5 }), 0, 0.15 * s, 0);
    const coin = add(new THREE.CylinderGeometry(r, r, 0.06 * s, 40), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.7 }), 0, cy, 0); coin.rotation.x = Math.PI / 2;
    const fm = new THREE.MeshStandardMaterial({ map: face, roughness: 0.6, emissive: 0xffffff, emissiveMap: face, emissiveIntensity: 0.55 });
    add(new THREE.CircleGeometry(r * 0.9, 40), fm, 0, cy, 0.031 * s + 0.002);
    T.faceMat = fm; T.top = 0.3 * s + 2 * r;
    g.rotation.x = -0.2;
    T.body = g; T.fig.add(g);
    const hit = MODELS.find(([re]) => re.test(t.name || ''));
    if (hit && !t.dead) model(hit[1]).then((src) => {
      if (!src || T.body !== g || !toks.has(T.id)) return;
      const m = src.clone(true), b = new THREE.Box3().setFromObject(m), k = (hit[2] * s) / (b.max.y - b.min.y);
      m.scale.setScalar(k); b.setFromObject(m); const c = b.getCenter(new THREE.Vector3());
      m.position.set(-c.x, -b.min.y, -c.z); m.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
      const h = new THREE.Group(); h.add(m);
      T.fig.remove(g); T.body = h; T.fig.add(h); T.faceMat = null; T.mats = []; T.spin = true; T.top = hit[2] * s; T.pick.scale.y = T.top + 0.1;
      kick();
    });
  }
  function makeTok(id) {
    const T = { id, root: new THREE.Group(), fig: new THREE.Group(), pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), mt: 1, dur: 0.3, hit: 0, miss: 0, yaw: 0, sig: '', lab: document.createElement('div'), lx: -1, ly: -1 };
    T.base = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.46, BASE_H, 40), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.6 })); T.base.position.y = BASE_H / 2; T.base.castShadow = T.base.receiveShadow = true;
    T.sel = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd56a, toneMapped: false })); T.sel.position.y = 0.075;
    T.turn = new THREE.Mesh(turnGeo, new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, toneMapped: false, depthWrite: false })); T.turn.position.y = 0.08;
    T.pick = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 1, 12), pickMat); T.pick.userData.tok = id;
    T.fig.position.y = BASE_H;
    T.root.add(T.base, T.sel, T.turn, T.fig, T.pick);
    T.lab.className = 't3-lab'; over.appendChild(T.lab);
    scene.add(T.root); toks.set(id, T);
    return T;
  }
  function dropTok(T) {
    scene.remove(T.root); T.lab.remove(); toks.delete(T.id);
    T.root.traverse((o) => { if (o.userData.own) { o.material.map && o.material.map.dispose(); o.material.dispose(); o.geometry.dispose(); } });
    T.base.geometry.dispose(); T.base.material.dispose(); T.sel.material.dispose(); T.turn.material.dispose(); T.pick.geometry.dispose();
  }
  let dragId = null;
  function tokens(list, drag) {
    const seen = new Set(); dragId = drag || null;
    list.forEach((t) => {
      seen.add(t.id);
      const fresh = !toks.has(t.id), T = fresh ? makeTok(t.id) : toks.get(t.id), s = t.size;
      const sig = `${s}|${t.color}|${t.img || ''}|${t.ic || ''}|${t.name}|${t.dead}`;
      if (sig !== T.sig) {
        T.sig = sig; T.base.scale.set(s, 1, s); T.base.material.color.set(t.color); T.sel.scale.set(s, 1, s); T.turn.scale.set(s, 1, s);
        buildBody(T, t); T.pick.scale.set(s, T.top + 0.1, s); T.pick.position.y = (T.top + 0.1) / 2 + BASE_H;
      }
      T.t = t; T.sel.visible = !!t.sel; T.turn.visible = !!t.turn;
      const op = t.ghost ? 0.45 : 1;
      T.mats.forEach((m) => { m.transparent = op < 1; m.opacity = op; }); T.base.material.transparent = op < 1; T.base.material.opacity = op;
      const tx = t.x + s / 2, tz = t.y + s / 2;
      if (fresh) { T.pos.set(tx, 0, tz); T.to.copy(T.pos); T.from.copy(T.pos); } else if (t.id !== dragId && (T.to.x !== tx || T.to.z !== tz)) {
        const n = Math.max(Math.abs(T.to.x - tx), Math.abs(T.to.z - tz));
        T.from.copy(T.pos); T.to.set(tx, 0, tz); T.mt = 0; T.dur = Math.min(1, 0.2 + n * 0.12);
        T.yaw = Math.atan2(tx - T.from.x, tz - T.from.z);
      }
      const html = `<div class="t3-n">${t.label}</div>${t.pct != null ? `<div class="t3-hp"><i style="width:${t.pct * 100}%;background:${t.pct > 0.5 ? '#5a9e5a' : t.pct > 0.25 ? '#d4a64a' : '#c94a3d'}"></i></div>` : ''}`;
      if (T.html !== html) { T.html = html; T.lab.innerHTML = html; }
      T.lab.className = `t3-lab ${t.cls || ''}`;
    });
    [...toks.values()].forEach((T) => { if (!seen.has(T.id)) dropTok(T); });
    stale = true; kick(1100);
  }
  function dragTo(id, x, y) { const T = toks.get(id); if (!T) return; T.pos.set(x + T.t.size / 2, 0, y + T.t.size / 2); T.to.copy(T.pos); T.mt = 1; T.lift = 1; kick(); }
  function hit(id, miss) { const T = toks.get(id); if (!T) return; if (miss) T.miss = 0.32; else T.hit = 0.34; kick(500); }

  // ---------- Камера ----------
  const cur = { x: 0, z: 0, d: 0, ok: false }, tan = Math.tan((FOV * Math.PI) / 360);
  function camStep(dt) {
    const v = api.view(), d = v.vh / (CELL * v.zoom) / (2 * tan), k = cur.ok ? 1 - Math.exp(-dt * 16) : 1;
    const moved = Math.abs(v.cx - cur.x) + Math.abs(v.cy - cur.z) + Math.abs(d - cur.d) / Math.max(1, d) > 0.002;
    cur.x += (v.cx - cur.x) * k; cur.z += (v.cy - cur.z) * k; cur.d += (d - cur.d) * k; cur.ok = true;
    camera.position.set(cur.x, cur.d * Math.sin(PITCH), cur.z + cur.d * Math.cos(PITCH)); camera.lookAt(cur.x, 0, cur.z);
    camera.far = cur.d * 4 + 100; camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    scene.fog.near = cur.d * 1.15; scene.fog.far = cur.d * 3.4; // даль тонет в дымке
    const R = Math.max(10, Math.min(60, cur.d * 0.75)), sc = sun.shadow.camera;
    sun.target.position.set(cur.x, 0, cur.z); sun.position.set(cur.x - R * 0.5, R * 1.1, cur.z + R * 0.45);
    if (sc.right !== R) { sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = R * 4; sc.updateProjectionMatrix(); }
    return moved;
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), v3 = new THREE.Vector3();
  function aimRay(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); }
  // Точка пола под указателем — в пикселях 2D-поля
  function ground(e) { aimRay(e); const p = ray.ray.intersectPlane(floor, v3); return p ? { px: p.x * CELL, py: p.z * CELL } : { px: cur.x * CELL, py: cur.z * CELL }; }
  // Существо под указателем (фигурка выше клетки — попадание считается по ней, а не по полу)
  function pick(e) { aimRay(e); const h = ray.intersectObjects([...toks.values()].map((T) => T.pick), false)[0]; return h ? h.object.userData.tok : null; }
  function project(x, y, h) { v3.set(x, h || 0, y).project(camera); return { x: (v3.x * 0.5 + 0.5) * wrap.clientWidth, y: (-v3.y * 0.5 + 0.5) * wrap.clientHeight }; }
  const tokTop = (id) => { const T = toks.get(id); return T ? T.top + BASE_H : 1; };

  // ---------- Кадр ----------
  let on = false, raf = 0, last = 0, acc = 0, n = 0, until = 0, time = 0;
  function kick(ms = 400) { until = Math.max(until, performance.now() + ms); }
  function update(dt) {
    time += dt;
    if (stale) pull();
    let busy = camStep(dt);
    toks.forEach((T) => {
      const t = T.t;
      if (T.mt < 1) { T.mt = Math.min(1, T.mt + dt / T.dur); const f = T.mt * T.mt * (3 - 2 * T.mt); T.pos.lerpVectors(T.from, T.to, f); busy = true; }
      const hop = T.mt < 1 ? Math.sin(Math.PI * T.mt) * 0.14 : 0, lift = T.id === dragId ? 0.25 : 0;
      let ox = 0;
      if (T.hit > 0) { T.hit -= dt; ox = Math.sin(T.hit * 60) * 0.07 * Math.max(0, T.hit / 0.34); busy = true; }
      if (T.miss > 0) { T.miss -= dt; ox = Math.sin((Math.max(0, T.miss) / 0.32) * Math.PI) * 0.2; busy = true; }
      if (T.faceMat) T.faceMat.emissiveIntensity = 0.55 + (T.hit > 0 ? 1.6 * (T.hit / 0.34) : 0);
      T.root.position.set(T.pos.x, 0, T.pos.z);
      T.fig.position.set(ox, BASE_H + hop + lift + Math.min(2, (t.alt || 0) / 10), 0);
      // Без сознания — фигурка лежит
      const lie = t.down ? 1 : 0; T.lie = (T.lie || 0) + (lie - (T.lie || 0)) * Math.min(1, dt * 8); if (Math.abs(lie - T.lie) > 0.01) busy = true;
      T.fig.rotation.z = T.lie * 1.35; T.fig.position.x += T.lie * 0.2 * t.size;
      if (T.spin) T.body.rotation.y = T.yaw;
      if (T.turn.visible) { T.turn.material.opacity = 0.55 + 0.4 * Math.sin(time * 4); const k = t.size * (1 + 0.04 * Math.sin(time * 4)); T.turn.scale.set(k, 1, k); }
      const p = project(T.pos.x, T.pos.z, (T.top + BASE_H) * (1 - T.lie * 0.6) + 0.12 + hop + lift), lx = Math.round(p.x), ly = Math.round(p.y);
      if (lx !== T.lx || ly !== T.ly) { T.lx = lx; T.ly = ly; T.lab.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -100%)`; }
    });
    waterTime.value = time; glintTex.offset.set(time * 0.016, time * 0.011); lavaTex.offset.set(time * 0.012, -time * 0.008);
    LAMPS.forEach((L) => { if (L.userData.base) L.intensity = L.userData.base * (0.88 + 0.12 * Math.sin(time * 9 + L.userData.seed) * Math.sin(time * 5.3 + L.userData.seed * 2)); });
    lampBox.children.forEach((o) => { if (o.userData.flame) o.scale.setScalar(o.userData.flame * (0.92 + 0.14 * Math.sin(time * 11 + o.position.x * 5) * Math.sin(time * 7.3))); });
    return busy;
  }
  let busyLast = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!on || !wrap.offsetParent) { last = now; return; }
    acc += Math.min(0.1, (now - last) / 1000); last = now; n++;
    // В покое хватает каждого третьего кадра (пульс кольца хода, мерцание факелов)
    // …а где видна вода или лава — каждого второго
    if (!(busyLast || now < until || stale) && n % (Object.values(liquids).some((L) => L.mesh && L.mesh.visible) ? 2 : 3)) return;
    busyLast = update(acc); acc = 0;
    renderer.render(scene, camera);
  }
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); kick();
  }
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(wrap);
  function setOn(v) {
    on = v; canvas.hidden = over.hidden = fxBox.hidden = !v;
    if (v) { resize(); cur.ok = false; stale = true; Object.keys(layers).forEach(tex); last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); kick(1000); }
    else { cancelAnimationFrame(raf); raf = 0; }
  }
  // Для проверок: прогнать кадры без requestAnimationFrame (в скрытой вкладке он стоит)
  function step(k = 1, dt = 1 / 30) { resize(); for (let i = 0; i < k; i++) update(dt); renderer.render(scene, camera); }
  return { setOn, tokens, tex, ground, pick, project, tokTop, dragTo, hit, kick, step, fx: fxBox, refresh() { stale = true; kick(); }, info: () => ({ toks: toks.size, props: propBox.children.reduce((a, m) => a + m.count, 0), walls: wallMesh ? wallMesh.geometry.index.count / 3 : 0, ground: [groundCv.width, groundCv.height], liquids: Object.keys(liquids).filter((k) => liquids[k].mesh && liquids[k].mesh.visible), doors: doorBox.children.length, lamps: LAMPS.filter((L) => L.intensity > 0).length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, cam: { ...cur } }) };
}
