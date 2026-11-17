// Объёмные кости: прозрачный холст поверх страницы, кубики влетают справа, кувыркаются, подпрыгивают
// и ложатся выпавшей гранью к зрителю. Число не случайное — его заранее бросил лист или стол;
// анимация только показывает уже известный результат. Физики нет: путь, отскоки и вращение — по формулам.
import * as THREE from 'three';

const PX = 64; // точек экрана на единицу сцены (куб к6 ~ 0,9 единицы)
let renderer = null, scene, camera, raf = 0, last = 0, holder;
const live = [];
const GEOS = {}, MATS = {};

// ---------- Сцена ----------
function init() {
  holder = document.createElement('canvas');
  holder.className = 'dice3d';
  document.body.appendChild(holder);
  renderer = new THREE.WebGLRenderer({ canvas: holder, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  // Взгляд сверху с наклоном — видно и верх, и бока кубиков
  camera.position.set(0, 18, 9); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  scene.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1d14, 1.4));
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.6); sun.position.set(-6, 14, 6); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 50 }); sun.shadow.bias = -0.002;
  scene.add(sun);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  size();
  window.addEventListener('resize', size);
}
function size() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const hw = w / PX / 2, hh = h / PX / 2;
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh }); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
// Точка на полу под точкой экрана (доли ширины и высоты)
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function floorAt(fx, fy) {
  ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
  const p = new THREE.Vector3(); ray.ray.intersectPlane(plane, p); return p;
}

// ---------- Кубики ----------
// Грани: группы треугольников с одной нормалью. Для каждой — центр, нормаль, «верх» надписи и место в атласе.
function facesOf(geo, upHint) {
  const g = geo.index ? geo.toNonIndexed() : geo, pos = g.attributes.position, groups = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    // Нормаль — наружу; если треугольник обойдён наоборот, меняем две вершины местами
    if (n.dot(a) < 0) { pos.setXYZ(i + 1, c.x, c.y, c.z); pos.setXYZ(i + 2, b.x, b.y, b.z); const t = b.clone(); b.copy(c); c.copy(t); n.negate(); }
    let G = groups.find((q) => q.n.dot(n) > 0.999);
    if (!G) { G = { n: n.clone(), tris: [], pts: [] }; groups.push(G); }
    G.tris.push(i); [a, b, c].forEach((v) => { if (!G.pts.some((p) => p.distanceTo(v) < 1e-4)) G.pts.push(v.clone()); });
  }
  groups.forEach((G) => {
    G.c = G.pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / G.pts.length);
    // Верх надписи: к заданной вершине (у к10 — к острию), иначе к первой вершине грани
    const tip = upHint ? upHint(G) : G.pts[0];
    G.v = tip.clone().sub(G.c); G.v.sub(G.n.clone().multiplyScalar(G.v.dot(G.n))).normalize();
    G.u = new THREE.Vector3().crossVectors(G.v, G.n).normalize();
    G.r = Math.max(...G.pts.map((p) => p.distanceTo(G.c)));
  });
  return { g, groups };
}
function d10Geo() {
  const z0 = 0.1, h = (z0 * (1 + Math.cos(Math.PI / 5))) / (1 - Math.cos(Math.PI / 5)), R = 0.62, s = 0.95;
  const T = new THREE.Vector3(0, h, 0).multiplyScalar(s), B = new THREE.Vector3(0, -h, 0).multiplyScalar(s);
  const U = [], L = [];
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5, b = a + Math.PI / 5;
    U.push(new THREE.Vector3(Math.cos(a) * R, z0, Math.sin(a) * R).multiplyScalar(s));
    L.push(new THREE.Vector3(Math.cos(b) * R, -z0, Math.sin(b) * R).multiplyScalar(s));
  }
  // Высота острия должна быть согласована с радиусом: пересчёт при R ≠ 1
  T.y = h * R * s; B.y = -h * R * s; U.forEach((p) => (p.y = z0 * R * s)); L.forEach((p) => (p.y = -z0 * R * s));
  const tri = [];
  const quad = (p, q, r, t) => { tri.push(p, q, r, p, r, t); };
  for (let k = 0; k < 5; k++) {
    const k1 = (k + 1) % 5;
    quad(T, U[k1], L[k], U[k]);      // верхний «воздушный змей»
    quad(B, L[k], U[k1], L[k1]);     // нижний
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flatMap((v) => [v.x, v.y, v.z]), 3));
  return { g, apex: (G) => (G.n.y > 0 ? T : B) };
}
const KIND = {
  4: () => new THREE.TetrahedronGeometry(0.78),
  6: () => new THREE.BoxGeometry(0.88, 0.88, 0.88),
  8: () => new THREE.OctahedronGeometry(0.72),
  12: () => new THREE.DodecahedronGeometry(0.72),
  20: () => new THREE.IcosahedronGeometry(0.76),
};
const STYLE = {
  4: ['#2f4a2a', '#e9d48c'], 6: ['#e8dcc4', '#3a2414'], 8: ['#2a3b5c', '#f0d488'], 10: ['#4a2f5c', '#f0d488'],
  12: ['#5c3a1e', '#f3dca0'], 20: ['#6b1d1a', '#f6d77c'], 100: ['#3b3b40', '#f0d488'],
};
function labelsFor(sides) {
  if (sides === 100) return Array.from({ length: 10 }, (_, i) => `${i}0`);
  if (sides === 10) return Array.from({ length: 10 }, (_, i) => String(i)); // 10 на к10 — «0»
  return Array.from({ length: sides }, (_, i) => String(i + 1));
}
function build(sides) {
  if (GEOS[sides]) return GEOS[sides];
  const ten = sides === 10 || sides === 100;
  let raw, up = null;
  if (ten) { const d = d10Geo(); raw = d.g; up = d.apex; } else raw = KIND[sides]();
  const { g, groups } = facesOf(raw, up);
  const labels = labelsFor(sides), n = groups.length, cols = Math.ceil(Math.sqrt(n)), cell = 128, tex = document.createElement('canvas');
  tex.width = tex.height = cols * cell;
  const x = tex.getContext('2d'), [bg, fg] = STYLE[sides] || STYLE[20];
  x.fillStyle = bg; x.fillRect(0, 0, tex.width, tex.height);
  // Лёгкий узор «камня»
  for (let i = 0; i < tex.width * 2; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.06})`; x.fillRect(Math.random() * tex.width, Math.random() * tex.height, 2, 2); }
  groups.forEach((G, i) => {
    const cx = (i % cols) * cell + cell / 2, cy = Math.floor(i / cols) * cell + cell / 2, t = labels[i] || '';
    const fs = sides === 4 ? 40 : sides === 20 ? 52 : sides === 6 ? 70 : sides >= 10 && t.length > 1 ? 50 : 62;
    x.font = `700 ${fs}px 'Cormorant SC', Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(0,0,0,.45)'; x.fillText(t, cx + 2, cy + 3);
    x.fillStyle = fg; x.fillText(t, cx, cy);
    if (t === '6' || t === '9') { x.fillRect(cx - fs * 0.22, cy + fs * 0.42, fs * 0.44, 4); }
    G.cell = [cx, cy];
  });
  // Развёртка: каждая грань — в свою клетку атласа, центр грани — в центр клетки
  const pos = g.attributes.position, uv = new Float32Array(pos.count * 2), v = new THREE.Vector3(), W = tex.width;
  groups.forEach((G) => {
    const k = (cell * 0.92) / (2 * G.r);
    G.tris.forEach((i0) => {
      for (let j = 0; j < 3; j++) {
        v.fromBufferAttribute(pos, i0 + j).sub(G.c);
        const px = G.cell[0] + v.dot(G.u) * k, py = G.cell[1] - v.dot(G.v) * k;
        uv[(i0 + j) * 2] = px / W; uv[(i0 + j) * 2 + 1] = 1 - py / W;
      }
    });
  });
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const map = new THREE.CanvasTexture(tex); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  GEOS[sides] = { g, groups, labels, map };
  return GEOS[sides];
}
function material(sides) {
  return new THREE.MeshStandardMaterial({ map: build(sides).map, roughness: 0.32, metalness: 0.08, transparent: true, emissive: 0x000000 });
}

// Поворот, при котором грань с номером idx смотрит на зрителя, а надпись стоит прямо (с небольшим случайным наклоном)
const toCam = new THREE.Vector3(), scrUp = new THREE.Vector3();
function finalQuat(D, idx) {
  const G = D.groups[idx];
  camera.getWorldDirection(toCam).negate();
  scrUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const q1 = new THREE.Quaternion().setFromUnitVectors(G.n, toCam);
  const v1 = G.v.clone().applyQuaternion(q1);
  const ang = Math.atan2(new THREE.Vector3().crossVectors(v1, scrUp).dot(toCam), v1.dot(scrUp)) + (Math.random() - 0.5) * 0.5;
  return new THREE.Quaternion().setFromAxisAngle(toCam, ang).multiply(q1);
}

const ease = (t) => 1 - Math.pow(1 - t, 3), smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const DUR = 1.25, HOLD = 1.9, FADE = 0.45;
const REST = { 4: 0.3, 6: 0.44, 8: 0.42, 10: 0.42, 12: 0.57, 20: 0.6, 100: 0.42 }; // высота центра лежащего кубика

// list: [{ sides, value, dim, hi }]; hi — подсветка (крит), dim — отброшенный кубик при преимуществе/помехе
export function roll(list, opts = {}) {
  if (!list || !list.length) return;
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!renderer) init();
  // Новый бросок убирает старые кубики
  live.splice(0).forEach((d) => { scene.remove(d.mesh); d.mesh.material.dispose(); });
  const dice = list.slice(0, 12), n = dice.length, gap = 1.25, row = Math.min(n, 6);
  dice.forEach((spec, i) => {
    const sides = [4, 6, 8, 10, 12, 20, 100].includes(spec.sides) ? spec.sides : 20;
    const D = build(sides), mesh = new THREE.Mesh(D.g, material(sides));
    mesh.castShadow = true;
    // Номер грани: у к100 десятки, у к10 «0» значит 10
    const val = sides === 100 ? Math.floor((spec.value % 100) / 10) : sides === 10 ? spec.value % 10 : spec.value - 1;
    const idx = Math.max(0, Math.min(D.groups.length - 1, val));
    const r = Math.floor(i / row), c = i % row, rn = Math.min(row, n - r * row);
    const end = floorAt(0.5, 0.62).add(new THREE.Vector3((c - (rn - 1) / 2) * gap, 0, r * gap * 1.1));
    const start = end.clone().add(new THREE.Vector3(9 + Math.random() * 3, 0, -2 + Math.random() * 4));
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const d = { mesh, start, end, axis, q0, qf: finalQuat(D, idx), t: -i * 0.06, spin: 14 + Math.random() * 6, dim: !!spec.dim, hi: spec.hi || '', R: REST[sides] || 0.5 };
    mesh.position.copy(start); mesh.quaternion.copy(q0);
    scene.add(mesh); live.push(d);
  });
  holder.style.opacity = '1';
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
}
const qs = new THREE.Quaternion();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let alive = false;
  live.forEach((d) => {
    d.t += dt; const t = Math.max(0, d.t), f = Math.min(1, t / DUR);
    if (t > DUR + HOLD + FADE) { d.gone = true; return; }
    alive = true;
    // Путь: быстро влетает и тормозит; три отскока, каждый ниже прежнего
    d.mesh.position.lerpVectors(d.start, d.end, ease(f));
    const b = f * 3.2, hop = Math.abs(Math.sin(Math.PI * b)) * Math.pow(1 - f, 2) * 2.4;
    d.mesh.position.y = d.R + hop;
    // Вращение затухает, к концу кубик доворачивается выпавшей гранью к зрителю
    const ang = d.spin * (f - f * f / 2) * DUR;
    qs.setFromAxisAngle(d.axis, ang).multiply(d.q0);
    d.mesh.quaternion.copy(qs).slerp(d.qf, smooth(0.45, 0.97, f));
    const m = d.mesh.material;
    if (f >= 1) {
      // Крит — золотое свечение, единица — красное; отброшенный кубик тускнеет
      const pulse = 0.5 + 0.5 * Math.sin((t - DUR) * 7);
      if (d.hi === 'crit') m.emissive.setRGB(0.55 * pulse, 0.4 * pulse, 0.08 * pulse);
      else if (d.hi === 'fumble') m.emissive.setRGB(0.5 * pulse, 0.03, 0.02);
      if (d.dim) m.color.setScalar(0.45);
    }
    m.opacity = t > DUR + HOLD ? 1 - (t - DUR - HOLD) / FADE : 1;
  });
  for (let i = live.length - 1; i >= 0; i--) if (live[i].gone) { scene.remove(live[i].mesh); live[i].mesh.material.dispose(); live.splice(i, 1); }
  renderer.render(scene, camera);
  if (alive) raf = requestAnimationFrame(frame);
  else { raf = 0; holder.style.opacity = '0'; renderer.clear(); }
}

// Для проверок: прокрутить анимацию на sec секунд без requestAnimationFrame
export function step(sec) {
  cancelAnimationFrame(raf); raf = 0;
  let t = performance.now(); last = t;
  for (let s = 0; s < sec; s += 1 / 30) { t += 1000 / 30; frame(t); cancelAnimationFrame(raf); raf = 0; }
}
// Разбор описания броска: «к20 [14]», «2d6 [3, 5]», «преимущество (…) [7, 15]», «к10 [4]» → список кубиков
export function parse(detail, cls) {
  const s = String(detail || ''), out = [];
  const adv = /^\s*(преимущество|помеха)[^[]*\[(\d+),\s*(\d+)\]/i.exec(s);
  if (adv) {
    const a = +adv[2], b = +adv[3], keep = /преим/i.test(adv[1]) ? Math.max(a, b) : Math.min(a, b);
    let kept = false;
    [a, b].forEach((v) => { const k = !kept && v === keep; if (k) kept = true; out.push({ sides: 20, value: v, dim: !k, hi: k ? hiOf(20, v, cls) : '' }); });
  }
  const re = /(\d*)\s*[dк](\d+)\s*\[([^\]]*)\]/gi;
  let m;
  while ((m = re.exec(s))) {
    const sides = +m[2];
    m[3].split(',').forEach((x) => { const v = parseInt(String(x).replace(/[^\d]/g, ''), 10); if (v > 0) out.push({ sides, value: v, hi: sides === 20 ? hiOf(20, v, cls) : '' }); });
  }
  if (!out.length) { const f = /предзнаменование\s*\[(\d+)\]/i.exec(s); if (f) out.push({ sides: 20, value: +f[1] }); }
  // к100: десятки и единицы
  return out.flatMap((d) => (d.sides === 100 ? [{ sides: 100, value: d.value }, { sides: 10, value: d.value % 10 || 10 }] : [d]));
}
function hiOf(sides, v, cls) { return cls === 'crit' || v === 20 ? 'crit' : cls === 'fumble' || v === 1 ? 'fumble' : ''; }
