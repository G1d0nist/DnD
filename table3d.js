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

  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0d0b09); scene.fog = new THREE.Fog(0x0d0b09, 10, 100);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 600);
  const hemi = new THREE.HemisphereLight(0xaab6d0, 0x2a2018, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe6c4, 2); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  scene.add(sun); scene.add(sun.target);
  const LAMPS = Array.from({ length: 6 }, () => { const L = new THREE.PointLight(0xff9a4a, 0, 8, 1.6); scene.add(L); return L; });

  // ---------- Пол и слои ----------
  const unit = new THREE.PlaneGeometry(1, 1); unit.rotateX(-Math.PI / 2);
  const under = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0x0a0907 })); under.position.y = -0.52; under.scale.set(4000, 1, 4000); scene.add(under);
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
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true });
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // Бесшовные рисунки из синусов: карта нормалей ряби и корка лавы (сдвигаются со временем)
  const wave = (u, v) => Math.sin(u * 6.283 * 2 + Math.sin(v * 6.283) * 1.3) * 0.5 + Math.sin(v * 6.283 * 3 + u * 6.283) * 0.3 + Math.sin((u + v) * 6.283 * 5) * 0.2;
  const sinTex = (paint) => {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), d = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [r, gg, b] = paint(x / N, y / N), i = (y * N + x) * 4; d.data[i] = r; d.data[i + 1] = gg; d.data[i + 2] = b; d.data[i + 3] = 255; }
    g.putImageData(d, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  };
  const rippleTex = sinTex((u, v) => { const e = 1 / 128, dx = (wave(u + e, v) - wave(u - e, v)) * 5, dy = (wave(u, v + e) - wave(u, v - e)) * 5, l = Math.hypot(dx, dy, 1); return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255]; });
  const lavaTex = sinTex((u, v) => { const k = Math.max(0, Math.min(1, wave(u, v) * 0.8 + 0.5)); return [70 + 185 * k, 12 + 150 * k * k, 4 + 40 * k * k * k]; }); lavaTex.colorSpace = THREE.SRGBColorSpace;
  const waterMat = new THREE.MeshStandardMaterial({ roughness: 0.12, metalness: 0.35, normalMap: rippleTex, normalScale: new THREE.Vector2(0.3, 0.3), transparent: true, opacity: 0.82, depthWrite: false });
  const iceMat = new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.7, depthWrite: false });
  const lavaMat = new THREE.MeshBasicMaterial({ map: lavaTex, toneMapped: false });
  // Рельеф пола: мягкие пятна — свет факела ложится неровно
  const bumpTex = (() => {
    const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 260; i++) { const x = Math.random() * N, y = Math.random() * N, r = 3 + Math.random() * 9, v = Math.random() > 0.5 ? 255 : 0;
      for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, `rgba(${v},${v},${v},.35)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = gr; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  layers.terrain.mesh.material.bumpMap = bumpTex; layers.terrain.mesh.material.bumpScale = 1.6;
  // Столешница: поле лежит на тёмной каменной плите
  const slab = new THREE.Mesh(box(1, 0.5, 1), new THREE.MeshStandardMaterial({ map: noise, color: 0x3a332c, roughness: 0.9 })); slab.position.y = -0.26; slab.receiveShadow = true; scene.add(slab);
  const ico = (r) => new THREE.IcosahedronGeometry(r, 1);
  // Часть препятствия: геометрия, материал, цвет, высота центра, сдвиг в клетке, v — доля случайного разброса размера
  const PROPS = {
    wall: [{ g: box(1, WALL_H, 1), m: stoneMat, c: 0x8a7f72, y: WALL_H / 2 }],
    rock: [{ g: new THREE.IcosahedronGeometry(0.5, 1), m: stoneMat, c: 0x8d867c, y: 0.3, s: [0.92, 0.75, 0.92], v: 0.2, spin: true }],
    tree: [{ g: new THREE.CylinderGeometry(0.07, 0.1, 0.6, 7), m: plainMat, c: 0x4a3220, y: 0.3 },
      { g: new THREE.ConeGeometry(0.46, 0.95, 8), m: leafMat, c: 0x2f6b2a, y: 0.95, v: 0.18, spin: true },
      { g: new THREE.ConeGeometry(0.33, 0.75, 8), m: leafMat, c: 0x3a7a30, y: 1.45, v: 0.18, spin: true }],
    crate: [{ g: box(0.5, 0.5, 0.5), m: plainMat, c: 0x8a5a2b, y: 0.25, dx: -0.16, dz: 0.14 },
      { g: new THREE.CylinderGeometry(0.17, 0.17, 0.46, 12), m: plainMat, c: 0x6e4a26, y: 0.23, dx: 0.24, dz: -0.2 }],
    furn: [{ g: box(0.8, 0.42, 0.8), m: plainMat, c: 0x6e4623, y: 0.21 }],
    grave: [{ g: box(0.42, 0.6, 0.13), m: stoneMat, c: 0x9a9aa2, y: 0.3 }],
    mushroom: [{ g: new THREE.CylinderGeometry(0.08, 0.11, 0.6, 8), m: plainMat, c: 0xd8cfc0, y: 0.3 },
      { g: new THREE.SphereGeometry(0.46, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m: plainMat, c: 0x8a4fb0, y: 0.55, s: [1, 0.6, 1] }],
    // Плоские клетки (flat): лежат чуть выше пола, под слоями областей и тумана
    water: [{ g: unit, m: waterMat, c: 0x3f78b8, y: 0.006, flat: true }],
    bog: [{ g: unit, m: waterMat, c: 0x35421f, y: 0.006, flat: true }],
    ice: [{ g: unit, m: iceMat, c: 0xbfe4f6, y: 0.006, flat: true }],
    lava: [{ g: unit, m: lavaMat, c: 0xffffff, y: 0.006, flat: true }],
    bridge: [{ g: box(1, 0.06, 1), m: plainMat, c: 0x7a5230, y: 0.04 }, { g: box(1, 0.1, 0.06), m: plainMat, c: 0x4a2e18, y: 0.12, dz: -0.47 }, { g: box(1, 0.1, 0.06), m: plainMat, c: 0x4a2e18, y: 0.12, dz: 0.47 }],
    bush: [{ g: ico(0.24), m: leafMat, c: 0x4f8a3a, y: 0.17, dx: -0.14, dz: 0.1, v: 0.2, spin: true }, { g: ico(0.19), m: leafMat, c: 0x5c9a44, y: 0.14, dx: 0.2, dz: -0.12, v: 0.2, spin: true }],
    thicket: [{ g: new THREE.ConeGeometry(0.26, 0.5, 7), m: leafMat, c: 0x1f4a20, y: 0.25, dx: -0.2, dz: -0.18, v: 0.25, spin: true },
      { g: new THREE.ConeGeometry(0.22, 0.42, 7), m: leafMat, c: 0x28592a, y: 0.21, dx: 0.22, dz: -0.05, v: 0.25, spin: true }, { g: ico(0.2), m: leafMat, c: 0x224f22, y: 0.14, dx: -0.03, dz: 0.24, v: 0.2, spin: true }],
    rubble: [{ g: ico(0.17), m: stoneMat, c: 0x8a8274, y: 0.1, dx: -0.2, dz: 0.16, s: [1, 0.7, 1], v: 0.3, spin: true }, { g: ico(0.13), m: stoneMat, c: 0x7a7366, y: 0.08, dx: 0.18, dz: -0.2, s: [1, 0.7, 1], v: 0.3, spin: true },
      { g: ico(0.1), m: stoneMat, c: 0x968d7e, y: 0.06, dx: 0.22, dz: 0.24, s: [1, 0.7, 1], v: 0.3, spin: true }],
    snow: [{ g: ico(0.3), m: plainMat, c: 0xe9eef5, y: 0.03, dx: -0.12, dz: 0.1, s: [1.2, 0.35, 1], v: 0.2, spin: true }, { g: ico(0.22), m: plainMat, c: 0xdfe6ef, y: 0.03, dx: 0.22, dz: -0.2, s: [1.2, 0.35, 1], v: 0.2, spin: true }],
    stairs: [0, 1, 2].map((i) => ({ g: box(0.9, 0.1 * (i + 1), 0.3), m: stoneMat, c: 0xa09078, y: 0.05 * (i + 1), dz: 0.3 - i * 0.3 })),
  };
  const propBox = new THREE.Group(), doorBox = new THREE.Group(), lampBox = new THREE.Group(); scene.add(propBox, doorBox, lampBox);
  let propSig = '', doorSig = '', lampSig = '', stale = true, S = null;
  const rnd = (x, y, n) => { const v = Math.sin(x * 127.1 + y * 311.7 + n * 74.7) * 43758.5453; return v - Math.floor(v); };
  function buildProps() {
    const cells = Object.entries(S.map).filter(([k, t]) => PROPS[t] && S.shade(k) >= 0);
    const sig = `${S.w}x${S.h}|` + cells.map(([k, t]) => `${k}${t}${S.shade(k)}`).join(',');
    if (sig === propSig) return; propSig = sig;
    propBox.children.slice().forEach((m) => { propBox.remove(m); m.dispose(); });
    const by = {}; cells.forEach(([k, t]) => (by[t] = by[t] || []).push(k));
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
    Object.entries(by).forEach(([t, ks]) => PROPS[t].forEach((p, pi) => {
      const im = new THREE.InstancedMesh(p.g, p.m, ks.length); im.receiveShadow = true; im.castShadow = !p.flat; if (p.flat) im.renderOrder = 0.5;
      ks.forEach((k, i) => {
        const [x, y] = k.split('_').map(Number), r = rnd(x, y, pi), k1 = 1 + (p.v ? (r - 0.5) * 2 * p.v : 0), s = p.s || [1, 1, 1];
        P.set(x + 0.5 + (p.dx || 0), p.y * (p.v ? k1 : 1), y + 0.5 + (p.dz || 0)); Q.setFromEuler(E.set(0, p.spin ? r * 6.28 : 0, 0)); SC.set(s[0] * k1, s[1] * k1, s[2] * k1);
        im.setMatrixAt(i, M.compose(P, Q, SC));
        im.setColorAt(i, C.set(p.c).multiplyScalar(S.shade(k) * (0.9 + rnd(x, y, 9) * 0.2)));
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      propBox.add(im);
    }));
  }
  const doorGeo = box(0.96, 0.82, 0.12), lockGeo = box(0.12, 0.14, 0.16);
  function buildDoors() {
    const sig = JSON.stringify(S.doors) + Object.keys(S.doors).map((k) => S.shade(k)).join('');
    if (sig === doorSig) return; doorSig = sig;
    doorBox.clear();
    Object.entries(S.doors).forEach(([k, d]) => {
      const sh = S.shade(k); if (sh < 0) return;
      const [x, y] = k.split('_').map(Number), solid = (a, b) => S.map[`${a}_${b}`] === 'wall';
      const alongX = (solid(x - 1, y) || solid(x + 1, y)) || !(solid(x, y - 1) || solid(x, y + 1));
      const g = new THREE.Group(); g.position.set(x + 0.5, 0, y + 0.5); g.rotation.y = alongX ? 0 : Math.PI / 2;
      const leaf = new THREE.Mesh(doorGeo, new THREE.MeshStandardMaterial({ color: new THREE.Color(0x7a5230).multiplyScalar(sh), roughness: 0.8 }));
      leaf.castShadow = leaf.receiveShadow = true;
      if (d.o) { leaf.rotation.y = Math.PI / 2; leaf.position.set(-0.42, 0.41, -0.42); } else leaf.position.y = 0.41;
      g.add(leaf);
      if (d.l && !d.o) { const L = new THREE.Mesh(lockGeo, new THREE.MeshStandardMaterial({ color: 0xf0c76a, metalness: 0.8, roughness: 0.3 })); L.position.set(0.3, 0.42, 0); g.add(L); }
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
  const postGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.55, 6), postMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
  const flameMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  function buildLamps() {
    const sig = JSON.stringify(S.lights) + S.amb;
    if (sig !== lampSig) {
      lampSig = sig; lampBox.clear();
      S.lights.filter((L) => L.fix).forEach((L) => {
        const p = new THREE.Mesh(postGeo, postMat); p.position.set(L.x, 0.275, L.y); p.castShadow = true;
        const f = new THREE.Sprite(flameMat); f.position.set(L.x, 0.68, L.y); f.scale.setScalar(0.5); f.userData.flame = true;
        lampBox.add(p, f);
      });
    }
    // Настоящих источников — не больше шести, ближайшие к центру экрана
    const near = S.lights.slice().sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.z) - Math.hypot(b.x - cur.x, b.y - cur.z));
    const power = S.amb === 'bright' ? 0.35 : 1;
    LAMPS.forEach((L, i) => {
      const s = near[i];
      if (!s) { L.intensity = 0; return; }
      L.position.set(s.x, 0.85, s.y); L.distance = Math.max(3, s.r * 1.25); L.userData.base = 8 * power; L.userData.seed = s.x * 7 + s.y * 13; L.intensity = L.userData.base;
    });
  }
  function pull() {
    stale = false; S = api.state();
    Object.values(layers).forEach((L) => { L.mesh.scale.set(S.w, 1, S.h); L.mesh.position.x = S.w / 2; L.mesh.position.z = S.h / 2; });
    bumpTex.repeat.set(S.w / 3, S.h / 3); slab.scale.set(S.w + 0.7, 1, S.h + 0.7); slab.position.x = S.w / 2; slab.position.z = S.h / 2;
    const a = AMB[S.amb] || AMB.bright;
    hemi.intensity = a.hemi; sun.intensity = a.sun; sun.color.set(a.col);
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
    rippleTex.offset.set(time * 0.035, time * 0.022); lavaTex.offset.set(time * 0.012, -time * 0.008);
    LAMPS.forEach((L) => { if (L.userData.base) L.intensity = L.userData.base * (0.88 + 0.12 * Math.sin(time * 9 + L.userData.seed) * Math.sin(time * 5.3 + L.userData.seed * 2)); });
    lampBox.children.forEach((o) => { if (o.userData.flame) o.scale.setScalar(0.46 + 0.07 * Math.sin(time * 11 + o.position.x * 5)); });
    return busy;
  }
  let busyLast = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!on || !wrap.offsetParent) { last = now; return; }
    acc += Math.min(0.1, (now - last) / 1000); last = now; n++;
    // В покое хватает каждого третьего кадра (пульс кольца хода, мерцание факелов)
    if (!(busyLast || now < until || stale) && n % 3) return;
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
  return { setOn, tokens, tex, ground, pick, project, tokTop, dragTo, hit, kick, step, fx: fxBox, refresh() { stale = true; kick(); }, info: () => ({ toks: toks.size, props: propBox.children.reduce((a, m) => a + m.count, 0), doors: doorBox.children.length, lamps: LAMPS.filter((L) => L.intensity > 0).length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, cam: { ...cur } }) };
}
