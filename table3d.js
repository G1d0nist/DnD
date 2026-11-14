// Объёмный вид стола (этапы 1, 2 и 5 графики). Правил здесь нет: модуль только рисует то, что ему отдаёт table.js.
// Слои 2D-поля (местность, области, досягаемость, туман, вспышки) ложатся на пол как текстуры,
// стены и препятствия поднимаются над клетками, существа — фигурки на подставках.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MODEL_DIR = 'lab/models/';
// Имя существа → файл модели и рост в клетках (для размера «Средний»)
const MODELS = [[/гоблин/i, 'goblin', 0.9]];
const PITCH = (55 * Math.PI) / 180, FOV = 35, WALL_H = 0.9, BASE_H = 0.07;
const BLOOM = [0.7, 0.5, 0.95]; // свечение: сила, радиус, порог яркости
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
    if (name === 'areas' || name === 'fog') zoneStale = true;
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
  // Серые рисунки (цвет дают вершины): скала — слои и трещины, дерево — волокна вдоль доски
  const grey = (paint) => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); paint(g, mulberry(19)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
  const rockTex = grey((g, R) => {
    g.fillStyle = '#cfcfcf'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 1400; i++) { const v = 150 + R() * 105; g.fillStyle = `rgba(${v},${v},${v},.5)`; const s = 2 + R() * 9; g.fillRect(R() * 256, R() * 256, s * (1 + R() * 2), s); }
    g.strokeStyle = 'rgba(0,0,0,.4)';
    for (let i = 0; i < 26; i++) { let x = R() * 256, y = R() * 256; g.lineWidth = 0.6 + R() * 1.6; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (R() - 0.3) * 40; y += (R() - 0.5) * 22; g.lineTo(x, y); } g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 1; for (let i = 0; i < 14; i++) { const y = R() * 256; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + (R() - 0.5) * 30, 170, y + (R() - 0.5) * 30, 256, y); g.stroke(); }
  });
  const woodTex = grey((g, R) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 240; i++) { const y = R() * 256, v = R() < 0.5 ? 0 : 255; g.strokeStyle = `rgba(${v},${v},${v},${0.05 + R() * 0.13})`; g.lineWidth = 0.6 + R() * 1.8; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(70, y + (R() - 0.5) * 9, 180, y + (R() - 0.5) * 9, 256, y); g.stroke(); }
    for (let y = 0; y < 256; y += 64) { g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, y, 256, 2); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(0, y + 2, 256, 1.5); }
  });
  const rockMat = new THREE.MeshStandardMaterial({ map: rockTex, bumpMap: rockTex, bumpScale: 2.5, roughness: 1, vertexColors: true });
  const cragMat = new THREE.MeshStandardMaterial({ map: rockTex, bumpMap: rockTex, bumpScale: 2.5, roughness: 1, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85, vertexColors: true });
  // Холст палаток: мелкое плетение, швы и пятна
  const clothTex = grey((g, R) => {
    g.fillStyle = '#dedede'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5200; i++) { const v = R() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${0.03 + R() * 0.06})`; g.fillRect(R() * 256, R() * 256, 1 + R() * 2, 1 + R() * 2); }
    for (let i = 0; i < 9; i++) { const x = R() * 256, y = R() * 256, r = 18 + R() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(0,0,0,.14)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1.2; [40, 128, 214].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); });
    g.setLineDash([5, 5]); g.strokeStyle = 'rgba(255,255,255,.3)'; [44, 132, 218].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); });
  });
  const clothMat = new THREE.MeshStandardMaterial({ map: clothTex, roughness: 1, vertexColors: true, side: THREE.DoubleSide });
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
  // ---------- Вода, болото и лава: шейдеры в мировых координатах — рисунок один на всю реку, без швов по клеткам ----------
  // Общий шум: значение по решётке, фрактальный (FBM) и ячеистый (Вороной, точки ячеек плавают со временем)
  const waterTime = { value: 0 }, fieldSize = { value: new THREE.Vector2(1, 1) };
  const GLSL_NOISE = `
    vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h22(i).x, h22(i + vec2(1.0, 0.0)).x, f.x), mix(h22(i + vec2(0.0, 1.0)).x, h22(i + vec2(1.0, 1.0)).x, f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; } return s; }
    float vor(vec2 p, float t){ vec2 i = floor(p), f = fract(p); float d = 1.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) { vec2 g = vec2(float(x), float(y)), o = 0.5 + 0.38 * sin(t + 6.2831 * h22(i + g)), r = g + o - f; d = min(d, dot(r, r)); }
      return sqrt(d); }
    float swellH(vec2 p, float t){ return vnoise(p * 1.6 + t * vec2(0.12, 0.07)) + 0.5 * vnoise(p * 3.4 - t * vec2(0.09, -0.13)); }`;
  // Вода: обычный материал сцены (свет факелов, тени, дымка работают), в который вписаны цвет по глубине, блики, рябь и пена
  function waterMat(P, L) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: P.rough, metalness: 0.05, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime: waterTime, uSize: fieldSize, tMask: { value: L.tex }, tDepth: L.depthU, uShallow: { value: new THREE.Color(P.shallow) }, uDeep: { value: new THREE.Color(P.deep) },
        uGlint: { value: P.glint }, uFoam: { value: P.foam }, uAlpha: { value: new THREE.Vector2(P.alpha[0], P.alpha[1]) } });
      sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `#define OCT 4\n${fine ? '' : '#define LITE\n'}uniform float uTime, uGlint, uFoam; uniform vec2 uSize, uAlpha; uniform vec3 uShallow, uDeep; uniform sampler2D tMask, tDepth; varying vec3 vWp;\n${GLSL_NOISE}\n` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 wp = vWp.xz, guv = wp / uSize;
          float msk = texture2D(tMask, vec2(guv.x, 1.0 - guv.y)).r;
          float dep = texture2D(tDepth, guv).r; // 0 — у берега, 1 — глубина
          // Близость кромки: маска, усреднённая по кругу (0 — далеко от берега, около 0.5 — на самой кромке)
          float e = 0.0;
          for (int i = 0; i < 8; i++) { float a = float(i) * 0.7854; vec2 o = vec2(cos(a), sin(a)) * (mod(float(i), 2.0) < 0.5 ? 0.13 : 0.3) / uSize; e += texture2D(tMask, vec2(guv.x + o.x, 1.0 - guv.y - o.y)).r; }
          float edge = 1.0 - e / 8.0, t = uTime;
          // Два слоя ячеистого шума плывут в разные стороны — там, где их границы сходятся, вспыхивают блики
          float v1 = vor(wp * 1.25 + t * vec2(0.07, 0.04), t * 0.7), v2 = vor(wp * 2.3 + t * vec2(-0.05, 0.06) + 11.0, t * 0.9 + 2.0);
          float caust = smoothstep(0.52, 0.95, v1 * v2 * 2.6);
          vec3 wcol = mix(uShallow, uDeep, smoothstep(0.0, 0.85, dep)) * (0.9 + 0.2 * vnoise(wp * 0.55 + t * 0.03));
          wcol += uGlint * caust * mix(1.0, 0.35, dep);
          // Пена: полоса у берега, набегает и отступает, рвётся шумом
          float lap = 0.5 + 0.5 * sin(t * 1.3 + vnoise(wp * 1.1) * 6.2831);
          float foam = smoothstep(0.4, 0.62, edge * (1.15 + 0.6 * lap) * (0.5 + 1.0 * vnoise(wp * 4.5 + t * vec2(0.3, -0.2)))) * uFoam;
          wcol = mix(wcol, vec3(0.86, 0.94, 0.98), foam * 0.8);
          diffuseColor.rgb = wcol;
          diffuseColor.a = msk * max(mix(uAlpha.x, uAlpha.y, smoothstep(0.0, 0.7, dep)), foam * 0.85);
        }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifndef LITE
        { // рябь: наклон поверхности по плывущему шуму — от него играют отблески солнца и факелов
          vec2 wq = vWp.xz; float h0 = swellH(wq, uTime), hx = swellH(wq + vec2(0.06, 0.0), uTime), hz = swellH(wq + vec2(0.0, 0.06), uTime);
          normal = normalize((viewMatrix * vec4(normalize(vec3(-(hx - h0) * 3.2, 1.0, -(hz - h0) * 3.2)), 0.0)).xyz);
        }
        #endif`);
    };
    return mat;
  }
  // Лава светится сама: тёмная остывающая корка и раскалённые трещины. Рисунок — фрактальный шум, искажённый сам собой
  // (domain warping) и медленно текущий; трещины пульсируют. uGlow — запас яркости для ореола (когда включено свечение)
  function lavaMat(L) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: waterTime, uSize: fieldSize, tMask: { value: L.tex }, tDepth: L.depthU, uGlow: { value: glowK ? 1.2 : 0 } },
      fog: true, transparent: true, depthWrite: false, toneMapped: false,
      vertexShader: `varying vec3 vWp;
        #include <fog_pars_vertex>
        void main(){ vec4 wpos = modelMatrix * vec4(position, 1.0); vWp = wpos.xyz; vec4 mvPosition = viewMatrix * wpos; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#define OCT ${fine ? 5 : 3}
        uniform float uTime, uGlow; uniform vec2 uSize; uniform sampler2D tMask, tDepth; varying vec3 vWp;
        #include <fog_pars_fragment>
        ${GLSL_NOISE}
        void main(){
          vec2 wp = vWp.xz, guv = wp / uSize;
          float msk = texture2D(tMask, vec2(guv.x, 1.0 - guv.y)).r; if (msk < 0.01) discard;
          float dep = texture2D(tDepth, guv).r, t = uTime * 0.05;
          vec2 p = wp * 0.55;
          vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.7, 0.0)));
          vec2 r = vec2(fbm(p + 2.6 * q + vec2(1.7, 9.2) + t * 0.6), fbm(p + 2.6 * q + vec2(8.3, 2.8) - t * 0.5));
          float f = fbm(p + 2.4 * r + vec2(t, -t * 0.4));
          // Корка — плиты (ячейки, смятые тем же потоком), между ними раскалённые трещины; ещё трещины — где шум проходит
          // через середину; широкие тёплые пятна — где поток «мнётся»
          float plate = vor(p * 1.8 + 1.4 * r + vec2(t * 0.5, 0.0), 0.0);
          float crack = max(smoothstep(0.42, 0.66, plate), 0.8 * smoothstep(0.9, 0.995, 1.0 - abs(2.0 * f - 1.0)));
          float warm = smoothstep(0.6, 1.0, length(r) * 1.25);
          float pulse = 0.8 + 0.2 * sin(uTime * 1.1 + f * 9.0 + wp.x * 0.7);
          float heat = clamp(crack + warm * 0.35, 0.0, 1.0) * pulse * mix(0.55, 1.0, smoothstep(0.0, 0.5, dep));
          vec3 col = mix(vec3(0.02, 0.006, 0.005), vec3(0.11, 0.014, 0.01), vnoise(wp * 3.1));
          col = mix(col, vec3(0.62, 0.05, 0.008), smoothstep(0.04, 0.42, heat));
          col = mix(col, vec3(1.0, 0.33, 0.03), smoothstep(0.34, 0.72, heat));
          col = mix(col, vec3(1.0, 0.8, 0.28), smoothstep(0.72, 1.0, heat));
          col *= 1.0 + uGlow * smoothstep(0.3, 1.0, heat);
          gl_FragColor = vec4(col, msk);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    return mat;
  }
  // Столешница: поле лежит на тёмной каменной плите
  const slab = new THREE.Mesh(box(1, 0.5, 1), new THREE.MeshStandardMaterial({ map: noise, color: 0x3a332c, roughness: 0.9 })); slab.position.y = -0.26; slab.receiveShadow = true; scene.add(slab);
  const ico = (r) => new THREE.IcosahedronGeometry(r, 1);
  // Часть препятствия: геометрия, материал, цвет, высота центра, сдвиг в клетке, v — доля случайного разброса размера
  // Валун: гранёный камень неровной формы (вершины сдвинуты, грани плоские)
  const crag = (r, seed) => { const g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), v = Math.sin(Math.round(x * 40) * 12.9 + Math.round(y * 40) * 78.2 + Math.round(z * 40) * 37.7 + seed) * 43758.5453, k = 0.74 + (v - Math.floor(v)) * 0.46; p.setXYZ(i, x * k, y * k, z * k); } g.computeVertexNormals(); return g; };
  const hearthMat = new THREE.MeshStandardMaterial({ map: noise, roughness: 0.95 }), emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a22, toneMapped: false });
  const PROPS = {
    rock: [{ g: crag(0.5, 1), m: cragMat, c: 0x8d867c, y: 0.26, s: [0.95, 0.9, 0.95], v: 0.2, spin: true }, { g: crag(0.2, 2), m: cragMat, c: 0x7d766c, y: 0.1, dx: 0.3, dz: 0.28, v: 0.3, spin: true }],
    // Очаг или печь в доме: каменная кладка с топкой и трубой
    hearth: [{ g: box(0.94, 0.6, 0.94), m: hearthMat, c: 0x9a8c7c, y: 0.3 }, { g: box(0.46, 0.5, 0.46), m: hearthMat, c: 0x857869, y: 0.85 },
      { g: box(0.5, 0.24, 0.96), m: emberMat, c: 0xffffff, y: 0.2, glow: true }, { g: box(0.96, 0.24, 0.5), m: emberMat, c: 0xffffff, y: 0.2, glow: true }],
    tree: [{ g: new THREE.CylinderGeometry(0.06, 0.09, 0.5, 7), m: barkMat, c: 0x6a4a30, y: 0.25 },
      { g: firTier(0.5, 0.62), m: firMat, c: 0x2f6e2c, y: 0.56, v: 0.15, spin: true }, { g: firTier(0.4, 0.56), m: firMat, c: 0x357632, y: 0.9, v: 0.15, spin: true },
      { g: firTier(0.3, 0.5), m: firMat, c: 0x3d8038, y: 1.22, v: 0.15, spin: true }, { g: firTier(0.18, 0.44), m: firMat, c: 0x488c42, y: 1.52, v: 0.15, spin: true }],
    tree2: [{ g: new THREE.CylinderGeometry(0.07, 0.1, 0.75, 7), m: barkMat, c: 0x6a4a30, y: 0.37 },
      { g: blob(0.42), m: leafMat, c: 0x4a8a34, y: 1.05, v: 0.15, spin: true }, { g: blob(0.3, 2), m: leafMat, c: 0x3f7c2c, y: 0.86, dx: -0.24, dz: 0.1, v: 0.15, spin: true },
      { g: blob(0.3, 3), m: leafMat, c: 0x55963c, y: 0.92, dx: 0.22, dz: -0.12, v: 0.15, spin: true }, { g: blob(0.25, 4), m: leafMat, c: 0x5fa044, y: 1.36, dx: 0.04, dz: 0.08, v: 0.15, spin: true }],
    crate: [{ g: box(0.5, 0.5, 0.5), m: plainMat, c: 0x8a5a2b, y: 0.25, dx: -0.16, dz: 0.14 },
      { g: new THREE.CylinderGeometry(0.17, 0.17, 0.46, 12), m: plainMat, c: 0x6e4a26, y: 0.23, dx: 0.24, dz: -0.2 }],
    // Надгробия разного вида (выбор — в buildProps): плита с круглым верхом, крест, обелиск, старый покосившийся камень; перед каждым — холмик
    grave: [{ g: box(0.5, 0.07, 0.22), m: cragMat, c: 0x77777c, y: 0.035, dz: -0.22 }, { g: box(0.4, 0.4, 0.11), m: cragMat, c: 0x9a9aa2, y: 0.27, dz: -0.22 },
      { g: new THREE.CylinderGeometry(0.2, 0.2, 0.11, 14).rotateX(Math.PI / 2), m: cragMat, c: 0x9a9aa2, y: 0.47, dz: -0.22 }, { g: ico(0.3), m: plainMat, c: 0x4a3a28, y: 0, dz: 0.2, s: [0.75, 0.2, 0.75] }],
    grave2: [{ g: box(0.34, 0.1, 0.24), m: cragMat, c: 0x77777c, y: 0.05, dz: -0.22 }, { g: box(0.1, 0.72, 0.1), m: cragMat, c: 0xa2a2a8, y: 0.46, dz: -0.22 },
      { g: box(0.42, 0.1, 0.1), m: cragMat, c: 0xa2a2a8, y: 0.6, dz: -0.22 }, { g: ico(0.3), m: plainMat, c: 0x4a3a28, y: 0, dz: 0.2, s: [0.75, 0.2, 0.75] }],
    grave3: [{ g: box(0.4, 0.12, 0.4), m: cragMat, c: 0x77777c, y: 0.06, dz: -0.12 }, { g: new THREE.CylinderGeometry(0.09, 0.16, 0.7, 4).rotateY(Math.PI / 4), m: cragMat, c: 0x8f8f96, y: 0.47, dz: -0.12 },
      { g: new THREE.ConeGeometry(0.127, 0.16, 4).rotateY(Math.PI / 4), m: cragMat, c: 0x8f8f96, y: 0.9, dz: -0.12 }],
    grave4: [{ g: box(0.38, 0.34, 0.1), m: cragMat, c: 0x84887c, y: 0.15, dz: -0.15 }, { g: crag(0.1, 3), m: cragMat, c: 0x7a7d72, y: 0.05, dx: 0.26, dz: 0.05 }, { g: crag(0.07, 4), m: cragMat, c: 0x8a8d82, y: 0.04, dx: -0.2, dz: 0.2 }],
    mushroom: [{ g: new THREE.CylinderGeometry(0.08, 0.11, 0.6, 8), m: plainMat, c: 0xd8cfc0, y: 0.3 },
      { g: new THREE.SphereGeometry(0.46, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), m: plainMat, c: 0x8a4fb0, y: 0.55, s: [1, 0.6, 1] }],
    // Кусты: от одного до трёх в клетке, разного размера и оттенка, где придётся (skip — доля клеток без этого куста, jit — разброс места)
    bush: [{ g: blob(0.27, 5), m: leafMat, c: 0x5a9a40, y: 0.2, v: 0.4, vi: 1, jit: 0.4, spin: true }, { g: blob(0.2, 6), m: leafMat, c: 0x6aac4a, y: 0.15, v: 0.4, vi: 1, jit: 0.62, skip: 0.4, spin: true },
      { g: blob(0.15, 9), m: leafMat, c: 0x4a8636, y: 0.11, v: 0.4, vi: 1, jit: 0.7, skip: 0.6, spin: true }],
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
    stone: ['#59544c', ['#69635a', '#4a453e', '#746d62'], ''],
  };
  const PEBBLES = { road: 3, difficult: 9, rubble: 16, dirt: 1.5, sand: 0.6, stone: 7 };
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
    ['difficult', ['difficult'], 0.1, 'rgba(0,0,0,.35)', 0.1, 0.92], ['rubble', ['rubble'], 0.1, 'rgba(0,0,0,.35)', 0.1, 0.88], ['rubble', ['massif'], 0.2, 'rgba(0,0,0,.4)', 0.14, 1], ['shade', ['tree', 'thicket', 'bush', 'mushroom'], 0.16, '', 0, 0.72],
    ['bog', ['bog'], 0.12, 'rgba(8,12,6,.75)', 0.16, 1], ['water', ['water'], 0.12, 'rgba(8,12,10,.8)', 0.18, 1], ['ice', ['ice'], 0.1, 'rgba(220,240,255,.4)', 0.1, 1],
    ['lava', ['lava'], 0.1, 'rgba(255,110,20,.95)', 0.28, 1], ['chasm', ['chasm'], 0.06, 'rgba(0,0,0,.95)', 0.22, 1]];
  // Блестящая плёнка над водой, болотом, льдом и лавой — одной плоскостью по маске пятна
  // Вода и болото: цвет у берега и в глубине, сила бликов и пены, непрозрачность у берега и в глубине
  const LIQ = { water: { flow: 1, shallow: 0x58b8c4, deep: 0x0d3a66, glint: 0.3, foam: 1, alpha: [0.5, 0.94], rough: 0.36 }, bog: { flow: 1, shallow: 0x5c6a30, deep: 0x1a2410, glint: 0.05, foam: 0.3, alpha: [0.55, 0.9], rough: 0.45 },
    ice: { color: 0xe2f4ff, opacity: 0.3, rough: 0.05 }, lava: { lava: 1 } };
  const liquids = {}, tmpCv = document.createElement('canvas');
  let groundSig = '', mapRev = 0, glowK = 0, lavaGlow = []; // glowK — включено ли свечение; lavaGlow — откуда лава светит на берега
  function paintGround() {
    const map = S.map, sig = `${S.w}x${S.h}|${S.ground}${S.rocky ? 'r' : ''}|${S.tpl}|${JSON.stringify(S.flights)}|` + Object.entries(map).map(([k, t]) => k + t).join(',');
    if (sig === groundSig) return; groundSig = sig; mapRev++; planRev = mapRev; classify();
    const s = Math.max(24, Math.min(64, Math.floor(4096 / Math.max(S.w, S.h)))), W = S.w * s, H = S.h * s;
    if (groundCv.width !== W || groundCv.height !== H) { groundTex.dispose(); groundCv.width = W; groundCv.height = H; }
    tmpCv.width = W; tmpCv.height = H; gs = s;
    const g = groundCv.getContext('2d'), tg = tmpCv.getContext('2d'), R = mulberry(S.w * 31 + S.h), at = (x, y) => map[`${x}_${y}`];
    const by = {}; Object.entries(map).forEach(([k, t]) => { const [x, y] = k.split('_').map(Number); if (x >= 0 && y >= 0 && x < S.w && y < S.h) { const key = massif.has(k) ? 'massif' : wells.has(k) ? (D4.some(([dx, dy]) => map[`${x + dx}_${y + dy}`] === 'road') ? 'road' : 'wellc') : t; (by[key] = by[key] || []).push([x, y]); } });
    // Основа: грунт по виду местности, доски или каменные плиты
    const gk = S.ground === 'stone' && !S.rocky ? '' : S.ground; // каменная земля гор — не плиты подземелья
    if (SOIL[gk]) soil(g, gk, 0, 0, W, H, s, R);
    else if (S.ground === 'wood') { g.fillStyle = '#1a120b'; g.fillRect(0, 0, W, H); planks(g, W, H, s, R); }
    else for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) flag(g, x, y, s, false);
    PATCH.forEach(([kind, types, grow, rim, rimW, alpha], pi) => {
      let cells = types.flatMap((t) => by[t] || []);
      // Мост над водой — вода идёт и под ним
      if (LIQ[kind]) cells = cells.concat((by.bridge || []).filter(([x, y]) => [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => at(x + dx, y + dy) === kind)));
      const L = LIQ[kind] && (liquids[kind] = liquids[kind] || {});
      if (L && L.mesh) L.mesh.visible = cells.length > 0;
      if (kind === 'lava') lavaGlow = [];
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
        L.cv = document.createElement('canvas'); L.tex = new THREE.CanvasTexture(L.cv); L.depthU = { value: null };
        let mat;
        if (P.lava) mat = lavaMat(L); else if (P.flow) mat = waterMat(P, L);
        else { mat = new THREE.MeshStandardMaterial({ color: P.color, roughness: P.rough, metalness: 0.3 }); mat.alphaMap = L.tex; mat.transparent = true; mat.opacity = P.opacity; mat.depthWrite = false; }
        L.mesh = new THREE.Mesh(unit, mat); L.mesh.position.y = 0.002; L.mesh.renderOrder = -0.5; L.mesh.receiveShadow = !P.lava; scene.add(L.mesh);
      }
      // Глубина: расстояние клетки до берега (за краем поля вода продолжается) — по нему вода темнеет, а лава раскаляется
      {
        const dw = S.w, dh = S.h, d = new Float32Array(dw * dh), da = (x, y) => (x < 0 || y < 0 || x >= dw || y >= dh ? 1e3 : d[y * dw + x]);
        cells.forEach(([x, y]) => { d[y * dw + x] = 1e3; });
        for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) if (d[y * dw + x]) d[y * dw + x] = Math.min(d[y * dw + x], da(x - 1, y) + 1, da(x, y - 1) + 1, da(x - 1, y - 1) + 1.41, da(x + 1, y - 1) + 1.41);
        for (let y = dh - 1; y >= 0; y--) for (let x = dw - 1; x >= 0; x--) if (d[y * dw + x]) d[y * dw + x] = Math.min(d[y * dw + x], da(x + 1, y) + 1, da(x, y + 1) + 1, da(x + 1, y + 1) + 1.41, da(x - 1, y + 1) + 1.41);
        const px = new Uint8Array(dw * dh); for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, ((d[i] - 0.5) / 2.5) * 255));
        if (L.depthU.value) L.depthU.value.dispose();
        const dt = new THREE.DataTexture(px, dw, dh, THREE.RedFormat); dt.magFilter = dt.minFilter = THREE.LinearFilter; dt.needsUpdate = true; L.depthU.value = dt;
        if (kind === 'lava') lavaGlow = cells.filter(([x, y]) => (x * 7 + y * 13) % 4 === 0 && D4.some(([dx, dy]) => !has(x + dx, y + dy))).slice(0, 60).map(([x, y]) => ({ x: x + 0.5, y: y + 0.5, px: x + 0.5, pz: y + 0.5, py: 0.4, r: 3.4, lava: 1 }));
      }
      if (L.cv.width !== S.w * ms || L.cv.height !== S.h * ms) { L.tex.dispose(); L.cv.width = S.w * ms; L.cv.height = S.h * ms; }
      const mg = L.cv.getContext('2d'); mg.fillStyle = '#000'; mg.fillRect(0, 0, L.cv.width, L.cv.height);
      blot(mg, cells, has, ms, grow, mulberry(pi * 977 + 5)); L.tex.needsUpdate = true;
      L.mesh.scale.set(S.w, 1, S.h); L.mesh.position.x = S.w / 2; L.mesh.position.z = S.h / 2; L.mesh.visible = true;
    });
    // Пол в доме — тёплые плиты ровно по клеткам
    (by.floor || []).forEach(([x, y]) => flag(g, x, y, s, true));
    // …и под мебелью, ящиками, лестницей и очагом, которые стоят на этом полу
    const inside = new Set(), fq = (by.floor || []).slice();
    while (fq.length) {
      const [x, y] = fq.pop();
      D4.forEach(([dx, dy]) => { const k = `${x + dx}_${y + dy}`, t = map[k]; if (inside.has(k) || !(['furn', 'board', 'crate', 'stairs'].includes(t) || (t === 'rock' && hearth.has(k)))) return; inside.add(k); flag(g, x + dx, y + dy, s, true); fq.push([x + dx, y + dy]); });
    }
    (by.wall || []).forEach(([x, y]) => { g.fillStyle = '#100d0b'; g.fillRect(x * s, y * s, s, s); });
    // Проём лестницы вниз — темнота
    flightAt.forEach(({ f }, k) => { if (!f.down) return; const [x, y] = k.split('_').map(Number); g.fillStyle = '#060504'; g.fillRect(x * s, y * s, s, s); });
    // Тень у основания стен и под предметами
    for (let y = 0; y < S.h; y++) for (let x = 0; x < S.w; x++) {
      const t = at(x, y); if (t === 'wall') continue;
      const X = x * s, Y = y * s;
      for (const [dx, dy, d, a] of [[0, -1, 0.5, 0.6], [0, 1, 0.25, 0.35], [-1, 0, 0.32, 0.4], [1, 0, 0.32, 0.4]]) {
        if (at(x + dx, y + dy) !== 'wall') continue;
        const gr = dy === -1 ? g.createLinearGradient(0, Y, 0, Y + d * s) : dy === 1 ? g.createLinearGradient(0, Y + s, 0, Y + s - d * s) : dx === -1 ? g.createLinearGradient(X, 0, X + d * s, 0) : g.createLinearGradient(X + s, 0, X + s - d * s, 0);
        gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X, Y, s, s);
      }
      if ((PROPS[t] || t === 'furn' || t === 'board' || wells.has(`${x}_${y}`)) && t !== 'bridge' && t !== 'snow' && !flightAt.has(`${x}_${y}`)) { const gr = g.createRadialGradient(X + s / 2, Y + s / 2, 0, X + s / 2, Y + s / 2, s * 0.6); gr.addColorStop(0, 'rgba(0,0,0,.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(X - s * 0.1, Y - s * 0.1, s * 1.2, s * 1.2); }
    }
    fieldSize.value.set(S.w, S.h);
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
  const GRAVES = ['grave', 'grave', 'grave2', 'grave2', 'grave3', 'grave4'], RIG = { grave: [0.14, 0.5], grave2: [0.12, 0.5], grave3: [0.05, 0.7], grave4: [0.55, 0.9] }; // наклон и поворот
  function buildProps() {
    const cells = Object.entries(S.map).filter(([k, t]) => PROPS[t] && S.shade(k) >= 0 && !massif.has(k) && !flightAt.has(k));
    const sig = `${S.w}x${S.h}|${mapRev}|` + cells.map(([k, t]) => `${k}${t}${S.shade(k)}`).join(',');
    if (sig === propSig) return; propSig = sig;
    propBox.children.slice().forEach((m) => { propBox.remove(m); m.dispose(); });
    const leafy = !['snow', 'sand'].includes(S.ground), by = {};
    cells.forEach(([k, t]) => { const [x, y] = k.split('_').map(Number), v = t === 'tree' && leafy && rnd(x, y, 5) > 0.6 ? 'tree2' : t === 'rock' && hearth.has(k) ? 'hearth' : t === 'grave' ? GRAVES[Math.floor(rnd(x, y, 6) * GRAVES.length)] : t; (by[v] = by[v] || []).push(k); });
    const GM = new THREE.Matrix4(), ZERO = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3(), E = new THREE.Euler(), C = new THREE.Color();
    Object.entries(by).forEach(([t, ks]) => PROPS[t].forEach((p, pi) => {
      const im = new THREE.InstancedMesh(p.g, p.m, ks.length); im.receiveShadow = !p.glow; im.castShadow = !p.flat && !p.glow; if (p.flat) im.renderOrder = 0.5;
      ks.forEach((k, i) => {
        const [x, y] = k.split('_').map(Number), r = rnd(x, y, pi), k1 = 1 + (p.v ? (rnd(x, y, p.vi ? 77 + pi : 77) - 0.5) * 2 * p.v : 0), s = p.s || [1, 1, 1], rig = RIG[t];
        const jx = p.jit ? (rnd(x, y, 91 + pi) - 0.5) * p.jit : 0, jz = p.jit ? (rnd(x, y, 92 + pi) - 0.5) * p.jit : 0;
        P.set((rig ? 0 : x + 0.5) + (p.dx || 0) + jx, p.y * (p.v ? k1 : 1), (rig ? 0 : y + 0.5) + (p.dz || 0) + jz); Q.setFromEuler(E.set(0, p.spin ? r * 6.28 : 0, 0)); SC.set(s[0] * k1, s[1] * k1, s[2] * k1);
        if (p.skip && rnd(x, y, 90 + pi) < p.skip) SC.set(0, 0, 0);
        M.compose(P, Q, SC);
        // Предмет из нескольких частей (надгробие) наклоняется и поворачивается целиком
        if (rig) { Q.setFromEuler(E.set((rnd(x, y, 93) - 0.5) * rig[0], (rnd(x, y, 94) - 0.5) * rig[1], (rnd(x, y, 95) - 0.5) * rig[0])); M.premultiply(GM.compose(P.set(x + 0.5, 0, y + 0.5), Q, ONE)); }
        im.setMatrixAt(i, M);
        im.setColorAt(i, C.set(p.c).offsetHSL((rnd(x, y, p.vi ? 11 + pi * 3 : 11) - 0.5) * (p.vi ? 0.1 : 0.06), 0, 0).multiplyScalar(S.shade(k) * (0.88 + rnd(x, y, 9 + (p.vi ? pi : 0)) * 0.24)));
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      propBox.add(im);
    }));
  }
  // ---------- Горы: скалы, стоящие сплошным пятном, — один массив с гребнями; чем дальше от края пятна, тем выше ----------
  const D4 = [[0, -1], [1, 0], [0, 1], [-1, 0]], NOROOF = ['dungeon', 'cave', 'crypt', 'mine', 'sewer', 'underdark', 'lair'];
  let planRev = -1, massif = new Set(), hearth = new Set(), deep = null, rockMesh = null, rockSig = '', furnMesh = null, furnSig = '';
  // Колодцы: своя клетка «колодец», а на старых картах поселений — одинокая клетка воды
  const SETTLE = ['village', 'city', 'castle', 'tavern', 'manor', 'temple', 'fair', 'guild', 'graveyard', 'arena'];
  let wells = new Set(), flightAt = new Map(), stairY = new Map(), clothMesh = null;
  function classify() {
    massif = new Set(); hearth = new Set(); wells = new Set();
    Object.entries(S.map).forEach(([k, t]) => {
      if (t === 'well') { wells.add(k); return; }
      if (t !== 'water' || !SETTLE.includes(S.tpl)) return;
      const [x, y] = k.split('_').map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && ['water', 'bridge'].includes(S.map[`${x + dx}_${y + dy}`])) return;
      wells.add(k);
    });
    // Лестничные марши: клетка → марш и её место в нём (0 — нижняя, 1 — верхняя); высота, на которой стоит фигурка
    flightAt = new Map(); stairY = new Map();
    S.flights.forEach((f) => [0, 1].forEach((i) => { const k = `${f.x + f.dx * i}_${f.y + f.dy * i}`; if (S.map[k] !== 'stairs') return; flightAt.set(k, { f, idx: i }); if (!f.down) stairY.set(k, WALL_H * (i ? 0.78 : 0.28)); }));
    const seen = new Set(), homes = !NOROOF.includes(S.tpl);
    Object.entries(S.map).forEach(([k, t]) => {
      if (t !== 'rock' || seen.has(k)) return;
      const comp = [], q = [k]; let house = false; seen.add(k);
      while (q.length) {
        const c = q.pop(), [x, y] = c.split('_').map(Number); comp.push(c);
        for (const [dx, dy] of D4) { const n = `${x + dx}_${y + dy}`, nt = S.map[n]; if (nt === 'rock') { if (!seen.has(n)) { seen.add(n); q.push(n); } } else if (nt === 'floor' || nt === 'wall') house = true; }
      }
      if (comp.length <= 3 && house && homes) comp.forEach((c) => hearth.add(c)); else if (comp.length >= 4) comp.forEach((c) => massif.add(c));
    });
    // Расстояние до края пятна (в клетках); за краем поля массив продолжается
    const W = S.w, H = S.h, d = deep = new Float32Array(W * H), at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 1e3 : d[y * W + x]);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y * W + x] = massif.has(`${x}_${y}`) ? 1e3 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[y * W + x]) d[y * W + x] = Math.min(d[y * W + x], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.41, at(x + 1, y - 1) + 1.41);
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) if (d[y * W + x]) d[y * W + x] = Math.min(d[y * W + x], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.41, at(x - 1, y + 1) + 1.41);
  }
  const C3 = (hex, k = 1) => { const c = new THREE.Color(hex); return [c.r * k, c.g * k, c.b * k]; };
  const meshOf = (B, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3)); const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; scene.add(m); return m; };
  function buildRocks() {
    const cells = [...massif].filter((k) => S.shade(k) >= 0);
    const sig = `${mapRev}|${S.ground}|` + cells.map((k) => k + S.shade(k)).join(',');
    if (sig === rockSig) return; rockSig = sig;
    if (rockMesh) { scene.remove(rockMesh); rockMesh.geometry.dispose(); rockMesh = null; }
    if (!cells.length) return;
    const W = S.w, H = S.h, B = { pos: [], nor: [], uv: [], col: [] }, cache = new Map();
    // Вершины — через полклетки. На границе пятна высота 0 (подножие ровно по краю клетки), дальше — круто вверх
    const vert = (i, j) => {
      const id = i * (2 * H + 1) + j; let v = cache.get(id); if (v) return v;
      const xs = i & 1 ? [(i - 1) >> 1] : [i / 2 - 1, i / 2], ys = j & 1 ? [(j - 1) >> 1] : [j / 2 - 1, j / 2]; let e = 99;
      for (const y of ys) for (const x of xs) { if (x < 0 || y < 0 || x >= W || y >= H) continue; e = Math.min(e, deep[y * W + x]); }
      if (e > 0 && (i & 1) && (j & 1)) e -= 0.5;
      let h = 0, jx = 0, jz = 0;
      if (e > 0) {
        const lf = 0.5 + 0.5 * Math.sin(i * 0.19 + 1.3) * Math.sin(j * 0.23 + 0.7), n = rnd(i, j, 21);
        h = Math.min(3.6, 3 * (1 - Math.exp(-Math.min(e, 6) * 0.6)) * (0.7 + 0.36 * n + 0.32 * lf) * ((i & 1) && (j & 1) ? 1.16 : 1));
        if (i > 0 && i < 2 * W) jx = (rnd(i, j, 22) - 0.5) * 0.3; if (j > 0 && j < 2 * H) jz = (rnd(i, j, 23) - 0.5) * 0.3;
      } else if (i > 0 && j > 0 && i < 2 * W && j < 2 * H) {
        // Подножие: наружные углы и края пятна втянуты внутрь — контур горы не идёт по клеткам
        let sx = 0, sz = 0, n = 0, m = 0;
        for (const y of ys) for (const x of xs) { m++; if (deep[y * W + x] > 0) { n++; sx += x + 0.5 - i / 2; sz += y + 0.5 - j / 2; } }
        if (n && n * 2 <= m) { const f = 0.3 + 0.5 * rnd(i, j, 24); jx = (sx / n) * f; jz = (sz / n) * f; }
      }
      v = [i / 2 + jx, h, j / 2 + jz]; cache.set(id, v); return v;
    };
    const lo = C3(0x6a645b), hi = C3(0xa9a296), snow = C3(0xe9eef5), moss = C3(0x586a3a), dark = C3(0x4a453f);
    const snowLine = S.ground === 'snow' ? 0.9 : 2.15, mossy = S.ground === 'grass' || S.ground === 'swamp';
    // Треугольник с плоской гранью; (ox, oy, oz) — куда грань должна смотреть
    const tri = (a, b, c, sh, ox, oy, oz, seed, flat) => {
      let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      if (nx * ox + ny * oy + nz * oz < 0) { const t = b; b = c; c = t; nx = -nx; ny = -ny; nz = -nz; }
      const hA = (a[1] + b[1] + c[1]) / 3, k = Math.min(1, hA / 2.4);
      let col = flat ? dark : [lo[0] + (hi[0] - lo[0]) * k, lo[1] + (hi[1] - lo[1]) * k, lo[2] + (hi[2] - lo[2]) * k];
      if (!flat && hA > snowLine && ny > 0.5) col = snow; else if (!flat && mossy && hA < 0.55 && ny > 0.45) col = [(col[0] + moss[0]) / 2, (col[1] + moss[1]) / 2, (col[2] + moss[2]) / 2];
      const m = sh * (flat ? 1 : (0.9 + 0.2 * ny) * (0.9 + 0.2 * seed));
      [a, b, c].forEach((p) => { B.pos.push(p[0], p[1], p[2]); B.nor.push(nx, ny, nz); B.uv.push(p[0] * 0.45 + p[1] * 0.3, p[2] * 0.45 + p[1] * 0.3); B.col.push(col[0] * m, col[1] * m, col[2] * m); });
    };
    cells.forEach((key) => {
      const [x, y] = key.split('_').map(Number), sh = S.shade(key), c = vert(2 * x + 1, 2 * y + 1);
      // Восемь граней веером от середины клетки
      const ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]].map(([a, b]) => vert(2 * x + a, 2 * y + b));
      ring.forEach((p, i) => tri(c, p, ring[(i + 1) % 8], sh, 0, 1, 0, rnd(x * 8 + i, y, 31)));
      // Срез по краю поля
      const cut = (i0, j0, i1, j1, ox, oz) => { const a = vert(i0, j0), b = vert(i1, j1); if (a[1] + b[1] <= 0) return; const a0 = [a[0], 0, a[2]], b0 = [b[0], 0, b[2]]; tri(a0, b0, b, sh * 0.8, ox, 0, oz, 0, true); tri(a0, b, a, sh * 0.8, ox, 0, oz, 0, true); };
      for (let q = 0; q < 2; q++) {
        if (x === 0) cut(0, 2 * y + q, 0, 2 * y + q + 1, -1, 0); if (x === W - 1) cut(2 * W, 2 * y + q, 2 * W, 2 * y + q + 1, 1, 0);
        if (y === 0) cut(2 * x + q, 0, 2 * x + q + 1, 0, 0, -1); if (y === H - 1) cut(2 * x + q, 2 * H, 2 * x + q + 1, 2 * H, 0, 1);
      }
    });
    rockMesh = meshOf(B, rockMat);
  }
  // ---------- Мебель одной сеткой: столы с посудой, стойки, кровати, полки, доска заказов ----------
  // Четырёхугольник с плоской гранью; смотрит наружу от точки o
  function pquad(B, a, b, c, d, col, o) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3], flip = nx * (m[0] - o[0]) + ny * (m[1] - o[1]) + nz * (m[2] - o[2]) < 0;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    (flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d]).forEach((p) => { B.pos.push(p[0], p[1], p[2]); B.nor.push(nx, ny, nz); B.uv.push(p[0] + p[1] * 0.5, p[2] + p[1] * 0.5); B.col.push(col[0], col[1], col[2]); });
  }
  // Бревно: восьмигранник вдоль оси X (ax = 0) или Z (ax = 1), кора и светлый спил на торцах
  function plog(B, cx, cy, cz, len, r, ax, bark, cut, n = 8) { // ax = 2 — стоит (бочка)
    const pt = (t, i) => { const a = ((i + 0.5) * 6.2832) / n, u = Math.cos(a) * r, v = Math.sin(a) * r; return ax === 2 ? [cx + u, cy + t, cz + v] : ax ? [cx + u, cy + v, cz + t] : [cx + t, cy + v, cz + u]; }, o = [cx, cy, cz];
    for (let i = 0; i < n; i++) pquad(B, pt(-len / 2, i), pt(len / 2, i), pt(len / 2, i + 1), pt(-len / 2, i + 1), bark, o);
    [-len / 2, len / 2].forEach((t) => { for (let i = 1; i < n - 1; i++) pquad(B, pt(t, 0), pt(t, i), pt(t, i + 1), pt(t, i + 1), cut, o); });
  }
  // sw — доски на верхней грани идут вдоль Z (иначе — вдоль длинной стороны)
  function pbox(B, x, y, z, w, h, d, c, sw = w < d) {
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y - h / 2, y1 = y + h / 2, z0 = z - d / 2, z1 = z + d / 2;
    const f = (p, n, t) => [0, 1, 2, 0, 2, 3].forEach((i) => { B.pos.push(p[i][0], p[i][1], p[i][2]); B.nor.push(n[0], n[1], n[2]); B.uv.push(t[i][0], t[i][1]); B.col.push(c[0], c[1], c[2]); });
    f([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], !sw ? [[x0, z1], [x1, z1], [x1, z0], [x0, z0]] : [[z1, x0], [z1, x1], [z0, x1], [z0, x0]]);
    f([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    f([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], [[x1, y0], [x0, y0], [x0, y1], [x1, y1]]);
    f([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], [[z1, y0], [z0, y0], [z0, y1], [z1, y1]]);
    f([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
  }
  const BEDS = ['room', 'bedroom', 'barracks', 'chamber', 'cell'], SHELVES = ['archive', 'library', 'shop'], DESKS = ['bar', 'reception', 'shop', 'stall'];
  const WOODS = [0x8a5a2e, 0x7a4c26, 0x94683a, 0x6e4623], BLANKETS = [0x8a2f2a, 0x2f4f7a, 0x3d6b3a, 0x6a3f7a, 0x8a6a2a], BOOKS = [0x7a2a24, 0x2a4a6a, 0x34582e, 0x6a5a2a, 0x4a2e5a, 0x8a7a5a], PAPERS = [0xefe4c4, 0xe2d3a8, 0xf4ecd6, 0xd9c797];
  const TENTS = [0xb9a47a, 0x9c8f6c, 0x8a8f6a, 0xa8926a], HAZ = ['water', 'bog', 'lava', 'chasm'], STONE_B = ['castle', 'city', 'dungeon', 'crypt', 'sewer', 'temple', 'ruins', 'lair', 'volcano', 'graveyard'];
  const masonMat = new THREE.MeshStandardMaterial({ map: brickTex, bumpMap: brickTex, bumpScale: 3, roughness: 0.92, vertexColors: true });
  let masonMesh = null, fires = [];
  function buildFurn() {
    const cells = Object.entries(S.map).filter(([k, t]) => (t === 'furn' || t === 'board' || t === 'bridge' || flightAt.has(k) || wells.has(k)) && S.shade(k) >= 0);
    const sig = `${mapRev}|${S.rooms.length}|${S.tpl}|` + cells.map(([k]) => k + S.shade(k)).join(',') + '|' + Object.keys(S.doors).length;
    if (sig === furnSig) return; furnSig = sig;
    if (furnMesh) { scene.remove(furnMesh); furnMesh.geometry.dispose(); furnMesh = null; }
    if (masonMesh) { scene.remove(masonMesh); masonMesh.geometry.dispose(); masonMesh = null; }
    if (clothMesh) { scene.remove(clothMesh); clothMesh.geometry.dispose(); clothMesh = null; }
    fires = [];
    if (!cells.length) return;
    const B = { pos: [], nor: [], uv: [], col: [] }, B2 = { pos: [], nor: [], uv: [], col: [] }, B3 = { pos: [], nor: [], uv: [], col: [] }, at = (x, y) => S.map[`${x}_${y}`], isF = (x, y) => at(x, y) === 'furn';
    const inb = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h, stoneB = STONE_B.includes(S.tpl) || Object.values(S.map).includes('lava');
    // Свободная клетка рядом (туда можно поставить стул): не препятствие, не вода, не дверь
    const open = (x, y) => inb(x, y) && [undefined, '', 'floor', 'road', 'sand'].includes(at(x, y)) && !S.doors[`${x}_${y}`] && S.shade(`${x}_${y}`) >= 0;
    const camps = S.rooms.filter((r) => r.kind === 'camp').map((r) => ({ cx: r.x + Math.floor(r.w / 2), cy: r.y + Math.floor(r.h / 2), r: Math.max(r.w, r.h) / 2 + 3.5 }));
    // Самая тесная комната, в которой стоит клетка, — по ней видно, кровать это или стол
    const roomAt = (x, y) => S.rooms.filter((r) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const nearKind = (x0, y0, x1, y1, kinds) => S.rooms.some((r) => kinds.includes(r.kind) && r.x <= x1 + 1 && r.x + r.w - 1 >= x0 - 1 && r.y <= y1 + 1 && r.y + r.h - 1 >= y0 - 1);
    // Сторона стены у клетки: 0 — север, 1 — восток, 2 — юг, 3 — запад (−1 — стены рядом нет)
    const wallSide = (x, y) => [0, 1, 2, 3].find((r) => at(x + D4[r][0], y + D4[r][1]) === 'wall') ?? -1;
    // Часть предмета в своих осях: «голова» предмета смотрит на сторону r
    const part = (x, y, r, sh) => (lx, ly, lz, w, h, d, hex, k = 1) => {
      const [ox, oz] = r === 1 ? [-lz, lx] : r === 2 ? [-lx, -lz] : r === 3 ? [lz, -lx] : [lx, lz];
      pbox(B, x + 0.5 + ox, ly, y + 0.5 + oz, r & 1 ? d : w, h, r & 1 ? w : d, C3(hex, sh * k));
    };
    const things = (x0, y0, w, h, top, sh, n) => { // посуда на столешнице
      for (let i = 0; i < n; i++) {
        const px = x0 + 0.22 + rnd(x0 + i, y0, 41) * (w - 0.44), pz = y0 + 0.22 + rnd(x0, y0 + i, 42) * (h - 0.44), q = rnd(x0 + i, y0 + i, 43);
        if (q < 0.4) pbox(B, px, top + 0.045, pz, 0.07, 0.09, 0.07, C3(q < 0.2 ? 0xb9a07a : 0x9aa0a8, sh));
        else if (q < 0.7) pbox(B, px, top + 0.012, pz, 0.17, 0.024, 0.17, C3(0xd8cdb4, sh));
        else if (q < 0.87) pbox(B, px, top + 0.085, pz, 0.05, 0.17, 0.05, C3(0x3f6a3a, sh));
        else { pbox(B, px, top + 0.05, pz, 0.035, 0.1, 0.035, C3(0xe8dcc0, sh)); }
      }
    };
    const done = new Set();
    cells.forEach(([key, t]) => {
      const [x, y] = key.split('_').map(Number), sh = S.shade(key);
      const FA = flightAt.get(key);
      if (FA) {
        // Лестничный марш в две клетки: первая поднимает до половины стены, вторая — до самого верха
        const { f, idx } = FA, dx = f.dx, dy = f.dy, at4 = (i) => { const gi = idx * 4 + i, o = -0.375 + i * 0.25; return [gi, x + 0.5 + dx * o, y + 0.5 + dy * o]; };
        if (!f.down) {
          for (let i = 0; i < 4; i++) {
            const [gi, px, pz] = at4(i), top = ((gi + 1) / 8) * WALL_H;
            pbox(B, px, top / 2, pz, dx ? 0.25 : 0.92, top, dx ? 0.92 : 0.25, C3(0x6a4726, sh * (0.86 + 0.14 * (gi % 2))), !!dx);
            pbox(B, px, top + 0.014, pz, dx ? 0.29 : 0.96, 0.03, dx ? 0.96 : 0.29, C3(0x9c7040, sh), !!dx);
          }
          // Перила — с той стороны, где нет стены
          [[-dy, dx], [dy, -dx]].forEach(([sx, sy]) => {
            if (at(x + sx, y + sy) === 'wall') return;
            for (let i = 0; i < 4; i++) {
              const [gi, px, pz] = at4(i), top = ((gi + 1) / 8) * WALL_H, rx = px + sx * 0.46, rz = pz + sy * 0.46;
              pbox(B, rx, top + 0.46, rz, dx ? 0.27 : 0.05, 0.05, dx ? 0.05 : 0.27, C3(0x4a3018, sh));
              if (i % 2 === 0) pbox(B, rx, top + 0.23, rz, 0.05, 0.46, 0.05, C3(0x4a3018, sh));
            }
          });
        } else {
          // Проём вниз: ступени уходят в темноту; вокруг нижней половины — ограждение, у верхней клетки вход открыт
          for (let i = 0; i < 4; i++) { const [gi, px, pz] = at4(i), k = (gi + 1) / 8; pbox(B, px, 0.007, pz, dx ? 0.23 : 0.9, 0.012, dx ? 0.9 : 0.23, C3(0x8a6238, sh * (0.06 + 0.85 * k * k)), !!dx); }
          if (!idx) [[-dy, dx], [dy, -dx], [-dx, -dy]].forEach(([sx, sy]) => {
            if (at(x + sx, y + sy) === 'wall') return;
            const ex = x + 0.5 + sx * 0.47, ez = y + 0.5 + sy * 0.47;
            pbox(B, ex, 0.46, ez, sx ? 0.05 : 1, 0.05, sx ? 1 : 0.05, C3(0x4a3018, sh)); pbox(B, ex, 0.26, ez, sx ? 0.035 : 1, 0.035, sx ? 1 : 0.035, C3(0x4a3018, sh));
            [-0.47, 0.47].forEach((o) => pbox(B, ex + (sx ? 0 : o), 0.23, ez + (sx ? o : 0), 0.06, 0.46, 0.06, C3(0x4a3018, sh)));
          });
        }
        return;
      }
      if (t === 'stairs') return;
      if (wells.has(key)) {
        // Колодец: каменный сруб, вода внутри, навес на двух столбах, ворот и ведро
        const cx = x + 0.5, cz = y + 0.5, st = C3(0xa39b8f, sh * 1.8), cap = C3(0xc4bcb0, sh * 2);
        [-1, 1].forEach((s) => { pbox(B2, cx, 0.18, cz + s * 0.3, 0.74, 0.36, 0.14, st); pbox(B2, cx + s * 0.3, 0.18, cz, 0.14, 0.36, 0.46, st); pbox(B2, cx, 0.375, cz + s * 0.3, 0.8, 0.04, 0.2, cap); pbox(B2, cx + s * 0.3, 0.375, cz, 0.2, 0.04, 0.4, cap); });
        pbox(B, cx, 0.2, cz, 0.46, 0.02, 0.46, C3(0x16405e, sh));
        [-1, 1].forEach((s) => pbox(B, cx + s * 0.33, 0.74, cz, 0.07, 0.72, 0.07, C3(0x4a3018, sh)));
        plog(B, cx, 0.92, cz, 0.6, 0.04, 0, C3(0x5e3d1f, sh), C3(0x8a6238, sh)); pbox(B, cx + 0.08, 0.7, cz, 0.014, 0.44, 0.014, C3(0xb8a070, sh)); pbox(B, cx + 0.08, 0.47, cz, 0.13, 0.12, 0.13, C3(0x6e4a28, sh));
        const o = [cx, 0.9, cz], rc = C3(0x5a3a24, sh);
        [-1, 1].forEach((s) => pquad(B, [cx - 0.5, 1.06, cz + s * 0.36], [cx + 0.5, 1.06, cz + s * 0.36], [cx + 0.5, 1.3, cz], [cx - 0.5, 1.3, cz], rc, o));
        [-1, 1].forEach((s) => pquad(B, [cx + s * 0.5, 1.06, cz - 0.36], [cx + s * 0.5, 1.06, cz + 0.36], [cx + s * 0.5, 1.3, cz], [cx + s * 0.5, 1.3, cz], C3(0x4a3018, sh), o));
        return;
      }
      if (t === 'bridge') {
        // Мост: настил сливается в одно полотно; перила — только там, где за краем вода, лава или пропасть.
        // Каменный — в замках, городах и подземельях, над лавой; в остальных местах — деревянный
        const hz = D4.map(([dx, dy]) => !inb(x + dx, y + dy) || HAZ.includes(at(x + dx, y + dy)));
        const alongX = (hz[0] || hz[2]) !== (hz[1] || hz[3]) ? hz[0] || hz[2] : at(x - 1, y) === 'bridge' || at(x + 1, y) === 'bridge';
        const BB = stoneB ? B2 : B, tone = 0.9 + rnd(x, y, 71) * 0.2;
        pbox(BB, x + 0.5, 0.03, y + 0.5, 1, 0.06, 1, C3(stoneB ? 0xb4aca0 : [0x8a6238, 0x7c5730, 0x93693c][Math.floor(rnd(x, y, 72) * 3)], sh * tone * (stoneB ? 1.9 : 1)), alongX);
        hz.forEach((h, d) => {
          if (!h) return;
          const [dx, dy] = D4[d], ex = x + 0.5 + dx * 0.46, ez = y + 0.5 + dy * 0.46, lw = dx ? 0 : 1, ld = dx ? 1 : 0; // перила идут вдоль края
          if (stoneB) { pbox(B2, ex, 0.22, ez, lw || 0.16, 0.36, ld || 0.16, C3(0xa39b8f, sh * 1.8)); pbox(B2, ex, 0.42, ez, lw || 0.22, 0.05, ld || 0.22, C3(0xc4bcb0, sh * 2)); return; }
          pbox(B, ex, 0.45, ez, lw || 0.06, 0.05, ld || 0.06, C3(0x5a3a1c, sh)); pbox(B, ex, 0.27, ez, lw || 0.04, 0.04, ld || 0.04, C3(0x5a3a1c, sh));
          [-0.46, 0.46].forEach((o) => pbox(B, ex + (dx ? 0 : o), 0.26, ez + (dx ? o : 0), 0.07, 0.46, 0.07, C3(0x4a3018, sh)));
        });
        return;
      }
      if (t === 'board') { // доска заказов: щит на столбах у стены, листы с печатями
        const r = wallSide(x, y), P = part(x, y, r < 0 ? 0 : r, sh), z = r < 0 ? 0 : -0.38;
        P(-0.43, 0.5, z, 0.08, 1, 0.08, 0x4a3018); P(0.43, 0.5, z, 0.08, 1, 0.08, 0x4a3018);
        P(0, 0.62, z, 0.94, 0.62, 0.05, 0x6b4826); P(0, 0.97, z + 0.02, 1, 0.07, 0.16, 0x4a3018);
        for (let i = 0; i < 6; i++) {
          if (rnd(x * 6 + i, y, 51) < 0.2) continue;
          const pw = 0.17 + rnd(x + i, y, 52) * 0.08, ph = 0.19 + rnd(x, y + i, 53) * 0.08, px = -0.3 + (i % 3) * 0.3 + (rnd(x + i, y, 54) - 0.5) * 0.06, py = 0.47 + Math.floor(i / 3) * 0.29 + (rnd(x, y + i, 55) - 0.5) * 0.04;
          P(px, py, z + 0.032, pw, ph, 0.014, PAPERS[Math.floor(rnd(x + i, y + i, 56) * 4)]); P(px, py + ph / 2 - 0.03, z + 0.044, 0.03, 0.03, 0.012, 0xa03020);
        }
        return;
      }
      if (done.has(key)) return;
      // Предмет — связное пятно клеток мебели
      const comp = [], q = [[x, y]]; done.add(key);
      while (q.length) { const [cx, cy] = q.pop(); comp.push([cx, cy]); D4.forEach(([dx, dy]) => { const k = `${cx + dx}_${cy + dy}`; if (isF(cx + dx, cy + dy) && !done.has(k)) { done.add(k); q.push([cx + dx, cy + dy]); } }); }
      const xs = comp.map((c) => c[0]), ys = comp.map((c) => c[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 + 1, h = Math.max(...ys) - y0 + 1;
      const rect = comp.length === w * h, room = roomAt(x, y), kind = room ? room.kind : '', wood = WOODS[Math.floor(rnd(x0, y0, 61) * 4)];
      const camp = camps.find((c) => Math.abs(x0 + w / 2 - 0.5 - c.cx) <= c.r && Math.abs(y0 + h / 2 - 0.5 - c.cy) <= c.r);
      if (camp) {
        // Лагерь: посередине костёр, вокруг брёвна (на них сидят), дальше — палатки, повозка, ящики
        const mx = x0 + w / 2, mz = y0 + h / 2, tx = camp.cx + 0.5 - mx, tz = camp.cy + 0.5 - mz, dist = Math.hypot(tx, tz);
        if (comp.some(([cx, cy]) => cx === camp.cx && cy === camp.cy)) {
          for (let i = 0; i < 8; i++) { const a = i * 0.7854; pbox(B, mx + Math.cos(a) * 0.34, 0.05, mz + Math.sin(a) * 0.34, 0.14 + rnd(x + i, y, 81) * 0.06, 0.1, 0.14 + rnd(x, y + i, 82) * 0.06, C3(0x8a857c, sh)); }
          plog(B, mx, 0.08, mz, 0.5, 0.055, 0, C3(0x2a1c12, sh), C3(0x3a2a1a, sh)); plog(B, mx, 0.11, mz, 0.5, 0.055, 1, C3(0x2a1c12, sh), C3(0x3a2a1a, sh));
          pbox(B, mx, 0.03, mz, 0.34, 0.05, 0.34, C3(0xa8421a, sh));
          fires.push({ x: mx, y: mz });
        } else if (rect && w === 2 && h === 2) {
          // Палатка: холст на двух шестах — конёк провисает, скаты прогибаются, низ растянут колышками; вход (полы отвёрнуты) — к костру
          const ax = Math.abs(tx) >= Math.abs(tz) ? 0 : 1, face = (ax ? tz : tx) >= 0 ? 1 : -1, hw = 0.86, hl = 0.86, H = 1.2, NT = 8, NS = 5, o = [mx, 0.35, mz];
          const base = C3(TENTS[Math.floor(rnd(x0, y0, 83) * 4)], sh), tone = (k) => [base[0] * k, base[1] * k, base[2] * k];
          const W3 = (t, u, v) => (ax ? [mx + u, v, mz + t] : [mx + t, v, mz + u]);
          const pt = (t, s, out = 0) => { // t — вдоль конька (−1…1), s — поперёк (0 — конёк, ±1 — земля)
            const a = Math.abs(s), ridge = H - 0.11 * (1 - t * t), sag = 0.085 * Math.sin(a * Math.PI) * (1 - 0.45 * t * t), wide = hw * (1 + 0.05 * Math.cos(t * Math.PI * 4)) * (1 - 0.07 * Math.sin(a * Math.PI));
            return W3(t * hl + out, s * wide, Math.max(0, ridge * (1 - a) - sag));
          };
          for (let i = 0; i < NT; i++) for (let j = -NS; j < NS; j++) {
            const t0 = -1 + (2 * i) / NT, t1 = -1 + (2 * (i + 1)) / NT, s0 = j / NS, s1 = (j + 1) / NS, a = Math.abs((s0 + s1) / 2);
            pquad(B3, pt(t0, s0), pt(t1, s0), pt(t1, s1), pt(t0, s1), tone((0.95 + 0.1 * rnd(x0 + i, y0 + j, 85)) * (1 - 0.16 * a * a)), o);
          }
          [-1, 1].forEach((e) => {
            const front = e === face, dk = front ? C3(0x120d09, sh) : tone(0.8), g0 = (s, out) => W3(e * hl + out, s * hw, 0);
            for (let j = -NS; j < NS; j++) pquad(B3, pt(e, j / NS), pt(e, (j + 1) / NS), g0(0, 0), g0(0, 0), dk, o); // торец: глухой сзади, тёмный проём спереди
            if (front) [-1, 1].forEach((s) => { // отвёрнутые полы по сторонам входа
              const q = e * 0.02; pquad(B3, pt(e, s, q), pt(e, s * 0.7, q), pt(e, s * 0.34, q), g0(s * 0.36, q), tone(0.9), [mx, 0.35, mz]);
              pquad(B3, pt(e, s * 0.34, q), pt(e, s * 0.12, q), g0(s * 0.5, q * 4), g0(s * 0.36, q), tone(1.02), [mx, 0.35, mz]);
            });
            // Шест, растяжка и колышек
            const [px, , pz] = W3(e * hl, 0, 0), [gx, , gz] = W3(e * (hl + 0.34), 0, 0);
            pbox(B, px, (H + 0.14) / 2, pz, 0.045, H + 0.14, 0.045, C3(0x4a3018, sh));
            pquad(B, W3(e * hl, -0.008, H + 0.1), W3(e * hl, 0.008, H + 0.1), W3(e * (hl + 0.34), 0.008, 0.04), W3(e * (hl + 0.34), -0.008, 0.04), C3(0xb8a070, sh), [mx, -3, mz]);
            pbox(B, gx, 0.05, gz, 0.04, 0.1, 0.04, C3(0x4a3018, sh));
          });
        } else if (rect && Math.min(w, h) === 1 && comp.length <= 3 && dist <= 3.9) {
          // Бревно лежит поперёк взгляда на костёр
          const ax = w > h ? 0 : h > w ? 1 : Math.abs(tx) >= Math.abs(tz) ? 1 : 0, len = Math.max(w, h) - 0.12;
          plog(B, mx, 0.17, mz, len, 0.17, ax, C3(0x4e3722, sh), C3(0xb8905a, sh));
          [-1, 1].forEach((s) => { const q = s * (len / 2 - 0.25 - rnd(x0, y0 + s, 84) * 0.3); plog(B, mx + (ax ? 0 : q), 0.3, mz + (ax ? q : 0), 0.14, 0.035, ax ? 0 : 1, C3(0x4e3722, sh), C3(0xb8905a, sh)); });
        } else if (rect && comp.length === 2) {
          // Повозка: кузов с бортами на колёсах, в нём мешки
          // a — вдоль повозки, b — поперёк
          const lx = w > h, Wp = (a, b) => (lx ? [mx + a, mz + b] : [mx + b, mz + a]);
          const Wb = (a, yy, b, la, hh, lb, hex, k = 1) => { const [px, pz] = Wp(a, b); pbox(B, px, yy, pz, lx ? la : lb, hh, lx ? lb : la, C3(hex, sh * k), !lx); };
          Wb(0, 0.43, 0, 1.62, 0.07, 0.76, 0x7a5230);
          [-1, 1].forEach((s) => { Wb(0, 0.6, s * 0.36, 1.62, 0.28, 0.05, 0x5e3d1f); Wb(s * 0.79, 0.6, 0, 0.05, 0.28, 0.76, 0x5e3d1f); Wb(0, 0.76, s * 0.36, 1.66, 0.04, 0.08, 0x4a3018); });
          [-0.5, 0.5].forEach((a) => {
            Wb(a, 0.27, 0, 0.08, 0.08, 1, 0x3a2614); // ось
            [-1, 1].forEach((s) => { // колесо: обод, ступица, спицы крестом
              const [px, pz] = Wp(a, s * 0.47), [hx, hz] = Wp(a, s * 0.51);
              plog(B, px, 0.27, pz, 0.07, 0.27, lx ? 1 : 0, C3(0x33221a, sh), C3(0x7a5a38, sh), 16);
              plog(B, hx, 0.27, hz, 0.05, 0.07, lx ? 1 : 0, C3(0x2a1c12, sh), C3(0x2a1c12, sh), 8);
              Wb(a, 0.27, s * 0.512, 0.46, 0.04, 0.012, 0x3a2614); Wb(a, 0.27, s * 0.512, 0.04, 0.46, 0.012, 0x3a2614);
            });
          });
          Wb(1.2, 0.34, 0, 0.82, 0.05, 0.07, 0x4a3018); // дышло
          // Груз: бочки с обручами, мешки, ящик
          [[-0.5, 0.17], [-0.5, -0.17]].forEach(([a, b]) => { const [px, pz] = Wp(a, b); plog(B, px, 0.66, pz, 0.38, 0.15, 2, C3(0x7a5230, sh), C3(0x94683a, sh), 12); [0.56, 0.76].forEach((yy) => plog(B, px, yy, pz, 0.03, 0.157, 2, C3(0x2e2a26, sh), C3(0x2e2a26, sh), 12)); });
          Wb(0.02, 0.55, 0.14, 0.36, 0.17, 0.26, 0xb8a070); Wb(0.04, 0.69, 0.12, 0.3, 0.13, 0.22, 0xa8935f); Wb(0.0, 0.54, -0.17, 0.32, 0.15, 0.24, 0xc4ad7a);
          Wb(0.5, 0.63, 0, 0.38, 0.33, 0.42, 0x8a5a2b); Wb(0.5, 0.8, 0, 0.42, 0.03, 0.46, 0x5e3d1f); [-0.2, 0.2].forEach((b) => Wb(0.5, 0.63, b, 0.4, 0.34, 0.035, 0x5e3d1f));
        } else comp.forEach(([cx, cy]) => { pbox(B, cx + 0.42, 0.26, cy + 0.5, 0.52, 0.52, 0.52, C3(0x8a5a2b, sh)); pbox(B, cx + 0.72, 0.16, cy + 0.3, 0.32, 0.32, 0.32, C3(0x7a4c26, sh)); });
      } else if (BEDS.includes(kind) && comp.length <= 2) {
        comp.forEach(([cx, cy]) => { // кровать: изголовьем к стене
          const r = wallSide(cx, cy), P = part(cx, cy, r < 0 ? 0 : r, sh);
          P(0, 0.14, 0, 0.84, 0.2, 0.94, 0x5e3d1f); P(0, 0.29, 0.02, 0.76, 0.1, 0.84, 0xd9cfb8);
          P(0, 0.345, 0.18, 0.78, 0.03, 0.52, BLANKETS[Math.floor(rnd(cx, cy, 62) * 5)]); P(0, 0.37, -0.28, 0.5, 0.07, 0.2, 0xf0ebe0); P(0, 0.33, -0.45, 0.84, 0.56, 0.06, 0x4a3018);
        });
      } else if (SHELVES.includes(kind)) {
        comp.forEach(([cx, cy]) => { // полки с книгами и свитками у стены
          const r = wallSide(cx, cy), P = part(cx, cy, r < 0 ? 0 : r, sh);
          P(0, 0.5, -0.26, 0.96, 1, 0.42, 0x4a3018);
          [0.2, 0.5, 0.8].forEach((py, row) => { for (let i = 0; i < 5; i++) { const bh = 0.15 + rnd(cx * 5 + i, cy + row, 63) * 0.08; P(-0.36 + i * 0.18, py - 0.11 + bh / 2, -0.04, 0.14, bh, 0.05, BOOKS[Math.floor(rnd(cx + i, cy * 3 + row, 64) * 6)]); } P(0, py - 0.125, -0.04, 0.9, 0.025, 0.06, 0x6b4826); });
        });
      } else if ((rect && Math.min(w, h) === 1 && comp.length >= 3 && nearKind(x0, y0, x0 + w - 1, y0 + h - 1, DESKS)) || !rect) {
        comp.forEach(([cx, cy]) => { // стойка: сплошной прилавок, клетки сливаются
          const n = D4.map(([dx, dy]) => (comp.some(([a, b]) => a === cx + dx && b === cy + dy) ? 0 : 1)), k = S.shade(`${cx}_${cy}`), s1 = k >= 0 ? k : sh;
          const bx0 = cx + 0.15 * n[3], bx1 = cx + 1 - 0.15 * n[1], bz0 = cy + 0.15 * n[0], bz1 = cy + 1 - 0.15 * n[2];
          pbox(B, (bx0 + bx1) / 2, 0.25, (bz0 + bz1) / 2, bx1 - bx0, 0.5, bz1 - bz0, C3(0x5a3a1c, s1));
          pbox(B, (bx0 + bx1) / 2, 0.53, (bz0 + bz1) / 2, bx1 - bx0 + 0.14 * (n[3] + n[1]), 0.06, bz1 - bz0 + 0.14 * (n[0] + n[2]), C3(0x8a5a2e, s1));
          things(cx, cy, 1, 1, 0.56, s1, rnd(cx, cy, 65) < 0.6 ? 1 : 2);
          // Табуреты — со стороны посетителей (не за стойкой)
          D4.forEach(([dx, dy], d) => {
            const nx = cx + dx, ny = cy + dy, nr = roomAt(nx, ny);
            if (!n[d] || !open(nx, ny) || (nr && DESKS.includes(nr.kind)) || rnd(nx, ny, 67 + d) < 0.45) return;
            const P = part(nx, ny, (d + 2) % 4, S.shade(`${nx}_${ny}`));
            P(0, 0.33, -0.3, 0.24, 0.045, 0.24, 0x7a4c26); P(0, 0.16, -0.3, 0.07, 0.32, 0.07, 0x4a3018); P(0, 0.02, -0.3, 0.2, 0.03, 0.2, 0x4a3018);
          });
        });
      } else { // стол: столешница на ножках, на ней посуда
        pbox(B, x0 + w / 2, 0.43, y0 + h / 2, w - 0.16, 0.06, h - 0.16, C3(wood, sh));
        [[0.17, 0.17], [w - 0.17, 0.17], [0.17, h - 0.17], [w - 0.17, h - 0.17]].forEach(([dx, dz]) => pbox(B, x0 + dx, 0.2, y0 + dz, 0.08, 0.4, 0.08, C3(wood, sh * 0.7)));
        things(x0, y0, w, h, 0.46, sh, Math.round(w * h * (0.8 + rnd(x0, y0, 66) * 1.4)));
        // Стулья вокруг стола: стоят у края соседней свободной клетки, спинкой наружу
        comp.forEach(([cx, cy]) => D4.forEach(([dx, dy], d) => {
          const nx = cx + dx, ny = cy + dy;
          if (!open(nx, ny) || rnd(nx, ny, 68 + d) < 0.25) return;
          const P = part(nx, ny, (d + 2) % 4, S.shade(`${nx}_${ny}`)), cw = wood, z = -0.33;
          P(0, 0.25, z, 0.27, 0.04, 0.27, cw);
          [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]].forEach(([a, b]) => P(a, 0.115, z + b, 0.04, 0.23, 0.04, cw, 0.7));
          P(0, 0.44, z + 0.12, 0.27, 0.34, 0.035, cw, 0.85);
        }));
      }
    });
    if (B.pos.length) furnMesh = meshOf(B, woodMat);
    if (B2.pos.length) masonMesh = meshOf(B2, masonMat);
    if (B3.pos.length) clothMesh = meshOf(B3, clothMat);
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
  // Сундук: дощатый короб на цоколе, выпуклая крышка на петлях, железные полосы, замок; в открытом — золото
  const chestG = box(0.62, 0.28, 0.4), trimG = box(0.66, 0.05, 0.44), bandG = box(0.06, 0.29, 0.415), lidRimG = box(0.64, 0.035, 0.42), lockG = box(0.1, 0.13, 0.035), coinG = box(0.52, 0.03, 0.3), sackG = new THREE.SphereGeometry(0.15, 10, 8);
  const lidG = new THREE.CylinderGeometry(0.2, 0.2, 0.62, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), lidBandG = new THREE.CylinderGeometry(0.208, 0.208, 0.06, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4a64a, metalness: 0.85, roughness: 0.35 });
  function buildLoot() {
    const all = [...S.chests.map((c) => ({ ...c, chest: 1 })), ...S.drops], sig = all.map((c) => `${c.x}_${c.y}${c.chest ? (c.o ? 'o' : 'c') : 'd'}${S.shade(`${c.x}_${c.y}`)}`).join(',');
    if (sig === lootSig) return; lootSig = sig;
    lootBox.children.slice().forEach((g) => { lootBox.remove(g); g.traverse((o) => { if (o.userData.own) o.material.dispose(); }); });
    all.forEach((c) => {
      const sh = S.shade(`${c.x}_${c.y}`); if (sh < 0) return;
      const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ map: c.chest ? woodTex : null, color: new THREE.Color(c.chest ? 0x9a6a38 : 0x8a6a3c).multiplyScalar(sh), roughness: 0.82 });
      const add = (geo, mat, x, y, z, own) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.userData.own = !!own; g.add(m); return m; };
      if (c.chest) {
        g.position.set(c.x + 0.5, 0, c.y + 0.5);
        add(trimG, jambMat(sh), 0, 0.025, 0); add(chestG, wood, 0, 0.19, 0, 1); [-0.2, 0.2].forEach((bx) => add(bandG, ironMat, bx, 0.19, 0));
        const lid = new THREE.Group(); lid.position.set(0, 0.33, -0.2); g.add(lid); // петли — по задней кромке
        const addL = (geo, mat, x, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, 0.2); m.castShadow = m.receiveShadow = true; lid.add(m); };
        addL(lidRimG, wood, 0, 0.0175); addL(lidG, wood, 0, 0.035); [-0.2, 0.2].forEach((bx) => addL(lidBandG, ironMat, bx, 0.035));
        if (c.o) { lid.rotation.x = -1.3; add(coinG, goldMat, 0, 0.3, 0); } else add(lockG, goldMat, 0, 0.3, 0.205);
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
  // Пламя: язычок (широкий снизу, острый сверху) и слабый ореол вокруг — факел, а не фонарь
  const tongueTex = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 96; const g = c.getContext('2d');
    const shape = (w, h, col, blur) => { g.filter = `blur(${blur}px)`; g.fillStyle = col; g.beginPath(); g.moveTo(32, 88 - h); g.bezierCurveTo(32 + w * 0.8, 88 - h * 0.5, 32 + w, 88 - h * 0.12, 32, 88); g.bezierCurveTo(32 - w, 88 - h * 0.12, 32 - w * 0.8, 88 - h * 0.5, 32, 88 - h); g.fill(); };
    shape(22, 80, 'rgba(255,96,20,.8)', 4); shape(15, 58, 'rgba(255,170,50,.95)', 2.5); shape(8, 32, 'rgba(255,240,190,1)', 1.5);
    return new THREE.CanvasTexture(c);
  })();
  const flameMat = new THREE.SpriteMaterial({ map: tongueTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const coreMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a3a, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  function buildLamps() {
    const wall = (x, y) => S.map[`${x}_${y}`] === 'wall', inb = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h;
    // Где висит каждый источник: у стены — на держателе (сначала дальняя от камеры стена), иначе — на стойке посреди клетки
    S.lights.forEach((L) => {
      L.px = L.x; L.pz = L.y; L.py = 0.85; L.dir = null;
      if (!L.fix) return;
      let cx = Math.floor(L.x), cy = Math.floor(L.y), dir = null;
      if (wall(cx, cy)) { const o = [[0, 1], [1, 0], [-1, 0], [0, -1]].find(([dx, dy]) => inb(cx + dx, cy + dy) && !wall(cx + dx, cy + dy)); if (o) { dir = [-o[0], -o[1]]; cx += o[0]; cy += o[1]; } }
      else dir = [[0, -1], [-1, 0], [1, 0], [0, 1]].find(([dx, dy]) => wall(cx + dx, cy + dy)) || null;
      const fire = fires.find((f) => Math.abs(f.x - L.x) <= 1.6 && Math.abs(f.y - L.y) <= 1.6);
      if (fire) { L.fire = 1; L.px = fire.x; L.pz = fire.y; L.py = 0.55; }
      else if (dir) { L.dir = dir; L.cx = cx; L.cy = cy; L.px = cx + 0.5 + dir[0] * 0.22; L.pz = cy + 0.5 + dir[1] * 0.22; L.py = 0.92; } else L.py = 0.98;
    });
    const sig = JSON.stringify(S.lights) + S.amb;
    if (sig !== lampSig) {
      lampSig = sig; lampBox.clear();
      const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); lampBox.add(m); return m; };
      const flame = (x, y, z, k = 1, bare = false) => { const a = new THREE.Sprite(flameMat); a.center.set(0.5, 0.08); a.position.set(x, y - 0.07, z); a.userData.flame = [0.17 * k, 0.27 * k]; lampBox.add(a); if (bare) return; const b = new THREE.Sprite(coreMat); b.position.set(x, y, z); b.userData.flame = [0.42 * k, 0.42 * k]; lampBox.add(b); };
      S.lights.filter((L) => L.fix).forEach((L) => {
        if (L.fire) { flame(L.px, 0.2, L.pz, 1.6, true); flame(L.px + 0.09, 0.17, L.pz - 0.06, 1.05, true); flame(L.px - 0.1, 0.17, L.pz + 0.05, 0.9, true); }
        else if (L.dir) {
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
    const near = S.lights.concat(S.bg ? [] : lavaGlow.filter((g) => S.shade(`${Math.floor(g.x)}_${Math.floor(g.y)}`) >= 0)).sort((a, b) => Math.hypot(a.x - cur.x, a.y - cur.z) - Math.hypot(b.x - cur.x, b.y - cur.z));
    const power = S.amb === 'bright' ? 0.35 : 1;
    LAMPS.forEach((L, i) => {
      const s = near[i];
      if (!s) { L.intensity = 0; L.userData.base = 0; return; }
      L.position.set(s.px, s.py, s.pz); L.distance = Math.max(3, s.r * 1.25); L.userData.base = s.lava ? 5 * Math.max(power, 0.6) : (s.fire ? 4.2 : 6.5) * power; L.color.set(s.lava ? 0xff4a14 : 0xff9a4a); L.userData.seed = s.x * 7 + s.y * 13; L.intensity = L.userData.base;
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
    SMOKE.dim = S.amb === 'bright' ? 1 : S.amb === 'dim' ? 0.75 : 0.5; // дым не светится в темноте
    if (planRev !== mapRev) { planRev = mapRev; classify(); }
    buildRocks(); buildFurn(); buildProps(); buildDoors(); buildLoot(); buildLamps();
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
    g.rotation.order = 'YXZ'; g.rotation.x = -0.2;
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
    stale = true; zoneStale = true; kick(1100);
  }
  function dragTo(id, x, y) { const T = toks.get(id); if (!T) return; T.pos.set(x + T.t.size / 2, 0, y + T.t.size / 2); T.to.copy(T.pos); T.mt = 1; T.lift = 1; kick(); }
  function hit(id, miss) { const T = toks.get(id); if (!T) return; if (miss) T.miss = 0.32; else T.hit = 0.34; kick(500); }

  // ---------- Камера ----------
  const cur = { x: 0, z: 0, d: 0, yaw: 0, pitch: PITCH, ok: false }, tan = Math.tan((FOV * Math.PI) / 360);
  function camStep(dt) {
    const v = api.view(), d = v.vh / (CELL * v.zoom) / (2 * tan), k = cur.ok ? 1 - Math.exp(-dt * 16) : 1;
    // Поворот — вокруг точки, на которую смотрит камера; к новому углу идём кратчайшей дугой
    const turn = Math.atan2(Math.sin((v.yaw || 0) - cur.yaw), Math.cos((v.yaw || 0) - cur.yaw));
    const tilt = (v.pitch || PITCH) - cur.pitch;
    const moved = Math.abs(v.cx - cur.x) + Math.abs(v.cy - cur.z) + Math.abs(d - cur.d) / Math.max(1, d) + Math.abs(turn) + Math.abs(tilt) > 0.002;
    cur.x += (v.cx - cur.x) * k; cur.z += (v.cy - cur.z) * k; cur.d += (d - cur.d) * k; cur.yaw += turn * k; cur.pitch += tilt * k; cur.ok = true;
    const flat = cur.d * Math.cos(cur.pitch);
    camera.position.set(cur.x + flat * Math.sin(cur.yaw), cur.d * Math.sin(cur.pitch), cur.z + flat * Math.cos(cur.yaw)); camera.lookAt(cur.x, 0, cur.z);
    if (shake > 0) { const q = shake * cur.d * 0.012; camera.position.x += rr(-q, q); camera.position.y += rr(-q, q); camera.position.z += rr(-q, q); } // встряска от взрыва
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

  // ---------- Эффекты (этап 5): частицы, вспышки света, заклинания по виду урона ----------
  const rr = (a, b) => a + Math.random() * (b - a), pickOf = (a) => a[Math.floor(Math.random() * a.length)], ease = (t) => 1 - Math.pow(1 - t, 3), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dotTex = (stops) => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([p, a]) => gr.addColorStop(p, `rgba(255,255,255,${a})`)); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); };
  const PVS = 'attribute float size; attribute float alpha; attribute vec3 pcol; uniform float scale; varying vec3 vC; varying float vA; void main(){ vC=pcol; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }';
  const PFS = 'uniform sampler2D map; uniform float lin; uniform float gain; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(map,gl_PointCoord); vec3 c=vC*t.rgb; if(lin>.5) c=c*c*gain; gl_FragColor=vec4(c,t.a*vA); }';
  // Частицы: одна сетка точек на всё; у частицы скорость, тяжесть, торможение, рост и время жизни
  function psys(max, map, additive, order) {
    const ps = [], g = new THREE.BufferGeometry(), A = (n) => { const a = new THREE.BufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const pos = A(3), col = A(3), sz = A(1), al = A(1);
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, scale: { value: 500 }, lin: { value: 0 }, gain: { value: additive ? 2.2 : 1 } }, vertexShader: PVS, fragmentShader: PFS, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false, transparent: true });
    g.setAttribute('position', pos); g.setAttribute('pcol', col); g.setAttribute('size', sz); g.setAttribute('alpha', al); g.setDrawRange(0, 0);
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = order; scene.add(pts);
    const sys = { ps, mat, dim: 1,
      emit(o) { if (ps.length < max) ps.push(Object.assign({ t: 0, life: 1, vx: 0, vy: 0, vz: 0, gy: 0, drag: 1, size: 0.2, grow: 0, a: 1, c: [1, 0.6, 0.2] }, o)); },
      update(dt) {
        for (let i = ps.length - 1; i >= 0; i--) { const p = ps[i]; p.t += dt; if (p.t >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); } }
        const P = pos.array, C = col.array;
        ps.forEach((p, n) => {
          const k = Math.pow(p.drag, dt * 60); p.vx *= k; p.vy = p.vy * k + p.gy * dt; p.vz *= k; p.x += p.vx * dt; p.y = Math.max(0.02, p.y + p.vy * dt); p.z += p.vz * dt;
          const f = p.t / p.life; P[n * 3] = p.x; P[n * 3 + 1] = p.y; P[n * 3 + 2] = p.z; C[n * 3] = p.c[0] * sys.dim; C[n * 3 + 1] = p.c[1] * sys.dim; C[n * 3 + 2] = p.c[2] * sys.dim;
          sz.array[n] = Math.max(0.01, p.size + p.grow * p.t); al.array[n] = p.a * Math.min(1, f * 8) * (1 - f);
        });
        g.setDrawRange(0, ps.length); pos.needsUpdate = col.needsUpdate = sz.needsUpdate = al.needsUpdate = true;
      } };
    return sys;
  }
  const SPARK = psys(3000, dotTex([[0, 1], [0.2, 0.6], [0.5, 0.18], [1, 0]]), true, 6), SMOKE = psys(500, dotTex([[0, 0.8], [0.6, 0.3], [1, 0]]), false, 5);
  // Короткие действия с отсчётом времени: update каждый кадр, end в конце; delay — отложенный старт
  const FX = [];
  function addFx(o) { o.t = -(o.delay || 0); FX.push(o); return o; }
  function runFx(dt) { for (let i = FX.length - 1; i >= 0; i--) { const f = FX[i]; f.t += dt; if (f.t < 0) continue; if (f.update) f.update(dt); if (f.t >= f.dur) { FX.splice(i, 1); if (f.end) f.end(); } } }
  // Вспышки света: два источника на все эффекты (число источников в сцене не меняется — шейдеры не пересобираются)
  const FXL = [0, 1].map(() => { const L = new THREE.PointLight(0xffffff, 0, 10, 1.5); scene.add(L); return L; });
  let lightSeq = 0, shake = 0, gs = 64;
  function glow(color, power, dist, x, y, z, dur) {
    const L = FXL[0].intensity <= FXL[1].intensity ? FXL[0] : FXL[1], id = ++lightSeq; L.userData.id = id; L.color.set(color); L.intensity = power; L.distance = dist; L.position.set(x, y, z);
    addFx({ dur, update() { if (L.userData.id === id) L.intensity = power * Math.pow(1 - this.t / dur, 2); }, end() { if (L.userData.id === id) L.intensity = 0; } });
    return { L, id };
  }
  const ringG = new THREE.RingGeometry(0.9, 1, 64); ringG.rotateX(-Math.PI / 2);
  const ballG = new THREE.SphereGeometry(1, 20, 14), cubeG = new THREE.BoxGeometry(1, 1, 1), arcG = new THREE.RingGeometry(0.3, 0.46, 20, 1, 0, 2.2);
  const hot = (c, k) => new THREE.Color(c[0] * k, c[1] * k, c[2] * k);
  const addM = (geo, color, opacity) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false })); m.renderOrder = 4; scene.add(m); return m; };
  const dropM = (m) => { scene.remove(m); m.material.dispose(); };
  function ringWave(x, z, r, c, dur = 0.55, delay = 0) { const m = addM(ringG, hot(c, 1.8), 0); m.position.set(x, 0.07, z); addFx({ dur, delay, update() { const f = this.t / dur; m.scale.setScalar(0.2 + r * 1.1 * ease(f)); m.material.opacity = 0.75 * (1 - f); }, end() { dropM(m); } }); }
  function flashBall(x, y, z, r, c, dur = 0.3) { const m = addM(ballG, hot(c, 3), 0.7); m.position.set(x, y, z); addFx({ dur, update() { const f = this.t / dur; m.scale.setScalar(r * (0.2 + 0.8 * ease(f))); m.material.opacity = Math.pow(1 - f, 2) * 0.7; }, end() { dropM(m); } }); }
  // След на полу (гарь, иней, кислота) — прямо в рисунок пола; исчезнет при перерисовке карты
  function scorch(x, z, r, rgb, a) {
    if (!S || S.bg || !groundCv.width) return;
    const g = groundCv.getContext('2d');
    for (let i = 0; i < 10; i++) { const cx = (x + rr(-r, r) * 0.4) * gs, cy = (z + rr(-r, r) * 0.4) * gs, q = r * rr(0.35, 0.7) * gs, gr = g.createRadialGradient(cx, cy, 0, cx, cy, q); gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(cx - q, cy - q, q * 2, q * 2); }
    groundTex.needsUpdate = true;
  }
  // Вид урона узнаётся по цвету, которым стол красит эффект (table.js: DMG_COLOR); лечение — зелёный
  const EL = {
    '#e0703a': { n: 'fire', c: [[1, 0.55, 0.2], [1, 0.38, 0.1], [1, 0.72, 0.35], [0.9, 0.26, 0.06]], light: 0xff7a30, smoke: [0.14, 0.12, 0.11] },
    '#6fb7e8': { n: 'cold', c: [[0.6, 0.85, 1], [0.8, 0.95, 1], [0.45, 0.7, 1]], light: 0x8fd0ff, smoke: [0.6, 0.7, 0.8] },
    '#b9a6ff': { n: 'lightning', c: [[0.75, 0.8, 1], [0.9, 0.9, 1], [0.6, 0.6, 1]], light: 0x9db8ff },
    '#8f9ccf': { n: 'thunder', c: [[0.6, 0.68, 0.9], [0.8, 0.85, 1]], light: 0x9aa8e0 },
    '#8bc34a': { n: 'acid', c: [[0.55, 0.9, 0.2], [0.7, 1, 0.3], [0.4, 0.75, 0.15]], light: 0x9be040 },
    '#6fae3a': { n: 'poison', c: [[0.4, 0.75, 0.2], [0.5, 0.85, 0.3]], light: 0x70c040, smoke: [0.25, 0.42, 0.15] },
    '#f0d36a': { n: 'radiant', c: [[1, 0.9, 0.5], [1, 1, 0.8], [1, 0.8, 0.35]], light: 0xffe08a },
    '#9b6fd1': { n: 'necrotic', c: [[0.55, 0.3, 0.8], [0.4, 0.2, 0.6], [0.7, 0.45, 0.95]], light: 0x8a50d0, smoke: [0.12, 0.06, 0.16] },
    '#d07ab0': { n: 'psychic', c: [[1, 0.5, 0.8], [0.9, 0.4, 0.7], [1, 0.7, 0.9]], light: 0xe070b0 },
    '#b07ae0': { n: 'force', c: [[0.7, 0.5, 1], [0.85, 0.7, 1]], light: 0xa070f0 },
    '#5a9e5a': { n: 'heal', c: [[0.5, 1, 0.5], [0.8, 1, 0.6], [1, 0.95, 0.6]], light: 0x80ff90 },
  };
  const ARC = { n: 'arcane', c: [[1, 0.8, 0.4], [1, 0.9, 0.6], [0.95, 0.65, 0.25]], light: 0xffc060 };
  function elOf(color) {
    const k = String(color || '').toLowerCase(); if (EL[k]) return EL[k];
    if (!/^#[0-9a-f]{6}$/.test(k) || k === '#d4a64a') return ARC;
    const c = [1, 3, 5].map((i) => parseInt(k.slice(i, i + 2), 16) / 255); // свой цвет заклинания — искры этого цвета
    return { n: 'arcane', c: [c, c.map((v) => Math.min(1, v + 0.25))], light: parseInt(k.slice(1), 16) };
  }
  const STYLE = { fire: { smoke: 1, embers: 1, mark: ['10,5,2', 0.7], coals: 1 }, cold: { smoke: 0.6, embers: 0.8, mark: ['205,228,245', 0.3] }, lightning: { bolts: 1, mark: ['10,8,14', 0.45] }, thunder: { rings: 3, shake: 0.45, thin: 1 },
    acid: { embers: 1.5, mark: ['38,58,10', 0.5] }, poison: { smoke: 1.4, thin: 1 }, radiant: { up: 1 }, necrotic: { inward: 1, smoke: 0.8 }, psychic: { rings: 3, thin: 1 }, force: { rings: 2 }, heal: { up: 1, soft: 1 }, arcane: {} };
  // Молния: ломаная трубка с ореолом, перерисовывается несколько раз — мерцает
  function jag(a, b, disp, it) { let pts = [a.clone(), b.clone()]; for (let i = 0; i < it; i++) { const np = [pts[0]]; for (let j = 1; j < pts.length; j++) { const m = pts[j - 1].clone().add(pts[j]).multiplyScalar(0.5); m.x += rr(-disp, disp); m.y += rr(-disp, disp) * 0.5; m.z += rr(-disp, disp); np.push(m, pts[j]); } pts = np; disp *= 0.55; } return pts; }
  function tube(pts, r, mat) { const path = new THREE.CurvePath(); for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i])); return new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 2, r, 5, false), mat); }
  function bolt(a, b, c = [0.75, 0.87, 1], dur = 0.55, branches = 3, delay = 0) {
    const core = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), halo = new THREE.MeshBasicMaterial({ color: hot(c, 1.7), transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    let meshes = [], next = 0, lit = false;
    const clear = () => { meshes.forEach((m) => { scene.remove(m); m.geometry.dispose(); }); meshes = []; };
    const regen = () => {
      clear(); const main = jag(a, b, 0.4, 5), sets = [main];
      for (let k = 0; k < branches; k++) { const m = main[Math.floor(rr(0.15, 0.85) * main.length)], d = b.clone().sub(a).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), rr(-0.9, 0.9)).multiplyScalar(rr(0.6, 1.6)); d.y = rr(-0.4, 0.2); sets.push(jag(m, m.clone().add(d), 0.2, 4)); }
      sets.forEach((p, i) => { const w = i ? 0.5 : 1; meshes.push(tube(p, 0.022 * w, core), tube(p, 0.09 * w, halo)); }); meshes.forEach((m) => scene.add(m));
    };
    addFx({ dur, delay, update() {
      if (!lit) { lit = true; shake = Math.max(shake, 0.2); glow(0x9db8ff, 30, 9, (a.x + b.x) / 2, 1, (a.z + b.z) / 2, dur + 0.1);
        for (let i = 0; i < 40; i++) { const f = Math.random(); SPARK.emit({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f, vx: rr(-3, 3), vy: rr(-1, 3), vz: rr(-3, 3), gy: -6, drag: 0.93, life: rr(0.3, 0.8), size: rr(0.05, 0.09), c: [0.75, 0.87, 1] }); }
        for (let i = 0; i < 30; i++) SPARK.emit({ x: b.x, y: b.y, z: b.z, vx: rr(-4, 4), vy: rr(-1, 4), vz: rr(-4, 4), gy: -8, drag: 0.9, life: rr(0.3, 0.7), size: rr(0.05, 0.1), c: [0.86, 0.92, 1] }); }
      if (this.t >= next) { regen(); next = this.t + 0.06; }
      const k = 1 - this.t / dur; halo.opacity = 0.45 * k; core.color.setRGB(4 * k + 0.2, 4.4 * k + 0.2, 5.6 * k + 0.2);
    }, end() { clear(); core.dispose(); halo.dispose(); } });
  }
  // Взрыв в точке: вспышка, кольцо по полу, частицы — и своё у каждого вида урона (дым, брызги, молнии, след на полу)
  function blast(x, z, r, E, small) {
    const st = STYLE[E.n] || {}, k = small ? 0.35 : 1, c = E.c;
    if (!st.soft) { shake = Math.max(shake, (st.shake || (r >= 3 ? 0.3 : 0.12)) * k); flashBall(x, 0.6, z, Math.max(0.5, r * 0.5), c[0]); }
    glow(E.light, small ? 14 : 30 + r * 7, r * 2.4 + 4, x, 1.2, z, st.soft ? 1.4 : 1.1);
    ringWave(x, z, r, c[0]); for (let i = 1; i < (st.rings || 0); i++) ringWave(x, z, r, c[i % c.length], 0.55, i * 0.14);
    const n = Math.round(Math.min(300, 50 + r * r * 13) * k * (st.thin ? 0.35 : 1));
    for (let i = 0; i < n; i++) {
      const th = rr(0, 6.283), d = Math.sqrt(Math.random()) * r;
      if (st.inward) { const q = rr(0.5, 1) * r; SPARK.emit({ x: x + Math.cos(th) * q, y: rr(0.2, 1.4), z: z + Math.sin(th) * q, vx: -Math.cos(th) * q * 2.2, vy: rr(-0.3, 0.6), vz: -Math.sin(th) * q * 2.2, drag: 0.96, life: rr(0.4, 0.8), size: rr(0.25, 0.5), a: 0.6, c: pickOf(c) }); }
      else if (st.up) SPARK.emit({ x: x + Math.cos(th) * d, y: rr(0.05, 0.4), z: z + Math.sin(th) * d, vy: rr(1.5, st.soft ? 3 : 6), drag: 0.95, life: rr(0.6, 1.3), size: rr(0.12, st.soft ? 0.25 : 0.4), a: 0.7, c: pickOf(c) });
      else { const ph = Math.acos(rr(-0.2, 1)), sp = Math.sqrt(Math.random()) * r * 3.4; SPARK.emit({ x, y: 0.5, z, vx: Math.sin(ph) * Math.cos(th) * sp, vy: Math.cos(ph) * sp * 0.8, vz: Math.sin(ph) * Math.sin(th) * sp, drag: 0.9, life: rr(0.45, 1), size: rr(0.35, 0.7), grow: 0.6, a: 0.55, c: pickOf(c) }); }
    }
    for (let i = 0; i < 90 * k * (st.embers || 0); i++) { const th = rr(0, 6.283), sp = rr(1, 2.2) * Math.max(1, r); SPARK.emit({ x, y: 0.5, z, vx: Math.cos(th) * sp, vy: rr(1, 5), vz: Math.sin(th) * sp, gy: -9, drag: 0.97, life: rr(0.6, 1.4), size: rr(0.05, 0.09), c: c[c.length > 2 ? 2 : 0].map((v) => Math.min(1, v + 0.25)) }); }
    for (let i = 0; i < 55 * k * (st.smoke || 0); i++) { const th = rr(0, 6.283), q = rr(0, r * 0.7); SMOKE.emit({ x: x + Math.cos(th) * q, y: rr(0.3, 1.2), z: z + Math.sin(th) * q, vx: Math.cos(th) * rr(0.2, 0.9), vy: rr(0.4, 1.2), vz: Math.sin(th) * rr(0.2, 0.9), drag: 0.97, life: rr(1.6, 3), size: rr(0.8, 1.3), grow: 1.2, a: 0.3, c: E.smoke || [0.14, 0.12, 0.11] }); }
    if (st.coals && !small) for (let i = 0; i < 30; i++) { const th = rr(0, 6.283), q = Math.sqrt(Math.random()) * r * 0.9; SPARK.emit({ x: x + Math.cos(th) * q, y: 0.05, z: z + Math.sin(th) * q, life: rr(2.5, 4.5), size: rr(0.12, 0.22), a: 0.8, c: [1, 0.35, 0.08] }); }
    if (st.bolts) for (let i = 0; i < (small ? 1 : 4); i++) { const th = rr(0, 6.283), q = small ? 0 : rr(0, r * 0.7), px = x + Math.cos(th) * q, pz = z + Math.sin(th) * q; bolt(new THREE.Vector3(px + rr(-0.6, 0.6), 5, pz + rr(-0.6, 0.6)), new THREE.Vector3(px, 0.05, pz), c[0], 0.4, 2, i * 0.09); }
    if (st.mark && !small) scorch(x, z, r * 0.85, st.mark[0], st.mark[1]);
  }
  // Конус: струя частиц из вершины в пределах угла (ширина конуса равна его длине)
  function coneFx(f, E) {
    const st = STYLE[E.n] || {}, L = f.len, half = Math.atan(0.5), ux = Math.cos(f.ang), uz = Math.sin(f.ang);
    shake = Math.max(shake, 0.15); glow(E.light, 26, L * 1.6 + 4, f.x + ux * L * 0.45, 1, f.y + uz * L * 0.45, 0.9);
    addFx({ dur: 0.35, update() {
      for (let i = 0; i < 16; i++) { const a = f.ang + rr(-half, half), sp = L * rr(2.4, 3.6); SPARK.emit({ x: f.x, y: rr(0.4, 0.8), z: f.y, vx: Math.cos(a) * sp, vy: rr(-0.3, 0.9), vz: Math.sin(a) * sp, drag: 0.9, life: rr(0.4, 0.8), size: rr(0.25, 0.55), grow: 0.7, a: 0.55, c: pickOf(E.c) }); }
      if (st.smoke) for (let i = 0; i < 2; i++) { const a = f.ang + rr(-half, half), q = rr(0.4, 1) * L; SMOKE.emit({ x: f.x + Math.cos(a) * q, y: rr(0.3, 1), z: f.y + Math.sin(a) * q, vy: rr(0.3, 0.9), life: rr(1.2, 2.2), size: rr(0.7, 1.1), grow: 1, a: 0.28, c: E.smoke || [0.14, 0.12, 0.11] }); }
    } });
    if (st.mark) scorch(f.x + ux * L * 0.6, f.y + uz * L * 0.6, L * 0.4, st.mark[0], st.mark[1] * 0.8);
  }
  // Линия: молния бьёт разрядом, остальное — светящийся луч с искрами по всей длине
  function beamFx(f, E) {
    const st = STYLE[E.n] || {}, L = f.len, ux = Math.cos(f.ang), uz = Math.sin(f.ang), a = new THREE.Vector3(f.x, 0.75, f.y), b = new THREE.Vector3(f.x + ux * L, 0.75, f.y + uz * L);
    if (E.n === 'lightning') { bolt(a, b, E.c[0], 0.6, 4); return; }
    shake = Math.max(shake, 0.15); glow(E.light, 28, L + 5, (a.x + b.x) / 2, 1, (a.z + b.z) / 2, 0.8);
    const m = addM(cubeG, hot(E.c[0], 3), 0.8); m.position.set((a.x + b.x) / 2, 0.75, (a.z + b.z) / 2); m.rotation.y = -f.ang;
    addFx({ dur: 0.45, update() { const k = 1 - this.t / 0.45; m.scale.set(L, 0.1 + 0.22 * k, Math.max(0.12, f.hw * 1.2) * (0.4 + 0.6 * k)); m.material.opacity = 0.8 * k;
      for (let i = 0; i < 10; i++) { const q = Math.random() * L; SPARK.emit({ x: f.x + ux * q, y: rr(0.5, 1), z: f.y + uz * q, vx: rr(-1.5, 1.5), vy: rr(-0.5, 1.5), vz: rr(-1.5, 1.5), drag: 0.92, life: rr(0.3, 0.7), size: rr(0.15, 0.35), a: 0.6, c: pickOf(E.c) }); } }, end() { dropM(m); } });
    if (st.mark) for (let i = 1; i < 4; i++) scorch(f.x + ux * L * i / 4, f.y + uz * L * i / 4, Math.max(0.6, f.hw * 1.5), st.mark[0], st.mark[1] * 0.6);
  }
  // Куб: столб частиц по всей площади и вспышка по полу
  function cubeFx(f, E) {
    const st = STYLE[E.n] || {}, L = f.len, ux = Math.cos(f.ang), uz = Math.sin(f.ang), cx = f.x + ux * L / 2, cz = f.y + uz * L / 2;
    shake = Math.max(shake, 0.2); glow(E.light, 32, L * 1.6 + 4, cx, 1.3, cz, 1);
    const m = addM(unit, hot(E.c[0], 2.4), 0.6); m.position.set(cx, 0.07, cz); m.rotation.y = -f.ang; m.scale.set(L, 1, L);
    const at = () => { const p = Math.random() * L, q = rr(-L / 2, L / 2); return [f.x + ux * p - uz * q, f.y + uz * p + ux * q]; };
    addFx({ dur: 0.4, update() { m.material.opacity = 0.6 * (1 - this.t / 0.4);
      for (let i = 0; i < 14; i++) { const [px, pz] = at(); SPARK.emit({ x: px, y: rr(0.05, 0.3), z: pz, vx: rr(-0.4, 0.4), vy: rr(2, 6), vz: rr(-0.4, 0.4), drag: 0.93, life: rr(0.4, 0.9), size: rr(0.25, 0.55), grow: 0.3, a: 0.6, c: pickOf(E.c) }); }
      if (st.smoke) { const [px, pz] = at(); SMOKE.emit({ x: px, y: rr(0.4, 1.2), z: pz, vy: rr(0.4, 1), life: rr(1.4, 2.4), size: rr(0.8, 1.2), grow: 1, a: 0.28, c: E.smoke || [0.14, 0.12, 0.11] }); } }, end() { dropM(m); } });
    if (st.mark) scorch(cx, cz, L * 0.5, st.mark[0], st.mark[1]);
  }
  // Вспышка области из журнала: f — { shape, x, y, r, len, hw, ang, color } в клетках
  function burst(f) {
    const E = elOf(f.color);
    if (f.shape === 'sphere' || f.shape === 'aura') blast(f.x, f.y, Math.max(0.6, f.r), E, false);
    else if (f.shape === 'target') blast(f.x, f.y, Math.max(0.6, f.r), E, true);
    else if (f.shape === 'cone') coneFx(f, E);
    else if (f.shape === 'line') beamFx(f, E);
    else if (f.shape === 'cube') cubeFx(f, E);
    kick(1500);
  }
  // Попадание: искры из точки; крит — больше и со вспышкой
  function impact(p, E, crit) {
    const n = crit ? 60 : 22;
    for (let i = 0; i < n; i++) SPARK.emit({ x: p.x, y: p.y, z: p.z, vx: rr(-3, 3), vy: rr(-0.5, 4), vz: rr(-3, 3), gy: -9, drag: 0.92, life: rr(0.25, 0.6), size: rr(0.05, crit ? 0.14 : 0.1), c: pickOf(E.c) });
    glow(E.light, crit ? 22 : 9, crit ? 6 : 4, p.x, p.y, p.z, crit ? 0.5 : 0.3);
    if (crit) { flashBall(p.x, p.y, p.z, 0.6, E.c[0], 0.25); shake = Math.max(shake, 0.2); }
  }
  const arrowG = new THREE.CylinderGeometry(0.012, 0.012, 0.55, 5); arrowG.rotateX(Math.PI / 2);
  const knifeG = new THREE.BoxGeometry(0.05, 0.05, 0.3), orbG = new THREE.SphereGeometry(0.09, 12, 8);
  // Атака из журнала: взмах, стрела, бросок или сгусток магии. Возвращает, через сколько миллисекунд долетит (тогда стол покажет урон)
  function attack(o) {
    const E = o.kind === 'bolt' ? elOf(o.color) : { ...elOf(o.color), ...(String(o.color).toLowerCase() === '#d4a64a' ? { c: [[1, 0.95, 0.85], [1, 0.85, 0.6]], light: 0xfff0d0 } : {}) };
    const TA = toks.get(o.from), TB = toks.get(o.to), a = new THREE.Vector3(o.ax, (TA ? TA.top : 1) * 0.6 + BASE_H, o.ay), b = new THREE.Vector3(o.bx, (TB ? TB.top : 1) * 0.6 + BASE_H, o.by), dist = a.distanceTo(b);
    kick(1500);
    if (o.kind === 'melee') {
      // Выпад атакующего и дуга удара у цели
      if (TA) { TA.lg = 0.24; const d = Math.hypot(b.x - a.x, b.z - a.z) || 1; TA.ldx = (b.x - a.x) / d; TA.ldz = (b.z - a.z) / d; TA.yaw = Math.atan2(TA.ldx, TA.ldz); }
      const g = new THREE.Group(), m = addM(arcG, hot(E.c[0], 2.5), 0); scene.remove(m); g.add(m); g.position.copy(b); g.rotation.order = 'YXZ'; g.rotation.x = -0.5; g.rotation.y = cur.yaw; scene.add(g);
      const s = o.crit ? 1.9 : 1.35;
      addFx({ dur: 0.3, delay: 0.08, update() { const f = this.t / 0.3; m.rotation.z = 2.6 - 3.4 * ease(f); m.scale.setScalar(s * (0.7 + 0.5 * f)); m.material.opacity = Math.sin(Math.PI * Math.min(1, f * 1.15)); }, end() { scene.remove(g); m.material.dispose(); } });
      if (o.hit) addFx({ dur: 0.01, delay: 0.18, end() { impact(b, E, o.crit); } });
      return 200;
    }
    if (o.kind === 'bolt' && E.n === 'lightning') { bolt(a, b, E.c[0], 0.4, 2); if (o.hit) impact(b, E, o.crit); return 120; }
    const magic = o.kind === 'bolt', dur = clamp(dist / (magic ? 14 : o.kind === 'throw' ? 12 : 26), 0.18, 0.75), arc = magic ? dist * 0.04 : o.kind === 'throw' ? dist * 0.16 : dist * 0.06;
    const mesh = new THREE.Mesh(magic ? orbG : o.kind === 'throw' ? knifeG : arrowG, new THREE.MeshBasicMaterial({ color: magic ? hot(E.c[0], 3.5) : o.kind === 'throw' ? 0xd8dde4 : 0xd8c8a0, toneMapped: !magic }));
    scene.add(mesh);
    const p = new THREE.Vector3(), q = new THREE.Vector3(), at = (f, v) => { v.lerpVectors(a, b, f); v.y += Math.sin(Math.PI * f) * arc; return v; }, light = magic ? glow(E.light, 9, 6, a.x, a.y, a.z, dur + 0.25) : null;
    addFx({ dur, update() {
      const f = Math.min(1, this.t / dur); at(f, p); mesh.position.copy(p); mesh.lookAt(at(Math.min(1, f + 0.03), q)); if (o.kind === 'throw') mesh.rotateX(this.t * 26);
      if (magic) { if (light.L.userData.id === light.id) light.L.position.copy(p);
        for (let i = 0; i < 5; i++) SPARK.emit({ x: p.x + rr(-0.05, 0.05), y: p.y + rr(-0.05, 0.05), z: p.z + rr(-0.05, 0.05), vx: rr(-0.4, 0.4), vy: rr(-0.2, 0.6), vz: rr(-0.4, 0.4), life: rr(0.25, 0.5), size: rr(0.15, 0.3), grow: -0.2, c: pickOf(E.c) });
        if (E.smoke && Math.random() < 0.4) SMOKE.emit({ x: p.x, y: p.y, z: p.z, vy: 0.3, life: 1, size: 0.3, grow: 0.6, a: 0.3, c: E.smoke }); }
    }, end() { scene.remove(mesh); mesh.material.dispose(); if (o.hit) { if (magic) blast(b.x, b.z, 0.7, E, true); else impact(b, E, o.crit); } } });
    return dur * 1000;
  }
  // ---------- Зоны: стены заклинаний и области, которые держатся на поле ----------
  let zones = [], zoneStale = true, zoneSig = '';
  const zoneBox = new THREE.Group(); scene.add(zoneBox);
  const zStone = new THREE.MeshStandardMaterial({ map: brickTex, bumpMap: brickTex, bumpScale: 3, roughness: 0.95 }), zIce = new THREE.MeshStandardMaterial({ color: 0xbfe6fb, transparent: true, opacity: 0.62, roughness: 0.08, metalness: 0.1 });
  const zForce = new THREE.MeshBasicMaterial({ color: 0x9a70f0, transparent: true, opacity: 0.17, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const zThorn = new THREE.MeshStandardMaterial({ color: 0x3a5226, roughness: 0.9 }), thornG = new THREE.ConeGeometry(0.08, 0.8, 5), slabG = new THREE.BoxGeometry(1, WALL_H, 1), iceG = new THREE.BoxGeometry(0.96, 0.86, 0.96), paneG = new THREE.BoxGeometry(0.98, 1.15, 0.98);
  function pullZones() {
    zoneStale = false; zones = api.zones ? api.zones() : []; zones.forEach((z) => { z.acc = 0; z.E = elOf(z.color); });
    const solid = zones.filter((z) => /^wall-(stone|ice|force|prism|thorns)$/.test(z.kind)), sig = JSON.stringify(solid.map((z) => [z.kind, z.cells]));
    if (sig === zoneSig) return; zoneSig = sig;
    zoneBox.children.slice().forEach((m) => { zoneBox.remove(m); if (m.userData.own) m.material.dispose(); });
    solid.forEach((z) => z.cells.forEach(([x, y], i) => {
      const add = (geo, mat, px, py, pz, shadow) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.castShadow = m.receiveShadow = !!shadow; zoneBox.add(m); return m; };
      if (z.kind === 'wall-stone') add(slabG, zStone, x + 0.5, WALL_H / 2, y + 0.5, true);
      else if (z.kind === 'wall-ice') add(iceG, zIce, x + 0.5, 0.43, y + 0.5, true);
      else if (z.kind === 'wall-force') add(paneG, zForce, x + 0.5, 0.575, y + 0.5);
      else if (z.kind === 'wall-prism') { const m = add(paneG, zForce.clone(), x + 0.5, 0.575, y + 0.5); m.material.color.setHSL(((i * 47) % 360) / 360, 0.9, 0.6); m.material.opacity = 0.3; m.userData.own = true; }
      else for (let k = 0; k < 5; k++) { const m = add(thornG, zThorn, x + 0.15 + rnd(x, y, k) * 0.7, 0.36, y + 0.15 + rnd(y, x, k + 9) * 0.7, true); m.rotation.set((rnd(x, y, k + 20) - 0.5) * 0.9, 0, (rnd(x, y, k + 30) - 0.5) * 0.9); m.scale.setScalar(0.7 + rnd(x, y, k + 40) * 0.7); }
    }));
  }
  const FIRE = EL['#e0703a'].c, mote = (x, z, c, up = 1) => SPARK.emit({ x, y: rr(0.1, 1), z, vx: rr(-0.15, 0.15), vy: rr(0.2, 0.7) * up, vz: rr(-0.15, 0.15), life: rr(0.8, 1.6), size: rr(0.06, 0.12), a: 0.8, c });
  const flame = (x, z, k = 1) => { SPARK.emit({ x, y: rr(0.05, 0.3), z, vx: rr(-0.2, 0.2), vy: rr(1.2, 2.6) * k, vz: rr(-0.2, 0.2), life: rr(0.5, 1), size: rr(0.5, 0.9) * k, grow: -0.4, a: 0.7, c: pickOf(FIRE) }); if (Math.random() < 0.07) SMOKE.emit({ x, y: 1, z, vy: rr(0.5, 1), life: rr(1, 1.8), size: 0.6, grow: 0.7, a: 0.22, c: [0.14, 0.12, 0.11] }); };
  const puff = (x, z, c, a, size = 1.1) => SMOKE.emit({ x, y: rr(0.2, 1.2), z, vx: rr(-0.15, 0.15), vy: rr(0, 0.25), vz: rr(-0.15, 0.15), life: rr(1.4, 2.2), size: rr(0.8, 1.2) * size, grow: 0.3, a, c });
  // [частиц в секунду на клетку, что испускать]
  const ZK = {
    'wall-fire': [26, (x, z) => flame(x, z)], 'wall-wind': [9, (x, z) => SPARK.emit({ x, y: rr(0.1, 1.1), z, vx: rr(-2.5, 2.5), vy: rr(0, 0.8), vz: rr(-2.5, 2.5), drag: 0.94, life: rr(0.3, 0.6), size: rr(0.1, 0.2), a: 0.35, c: [0.8, 0.9, 1] })],
    'wall-blades': [8, (x, z) => SPARK.emit({ x, y: rr(0.2, 1.1), z, vx: rr(-1, 1), vz: rr(-1, 1), life: rr(0.12, 0.3), size: rr(0.08, 0.16), c: [1, 1, 1] })],
    'wall-force': [1.2, (x, z) => mote(x, z, [0.7, 0.5, 1])], 'wall-prism': [2.5, (x, z) => mote(x, z, hot([1, 1, 1], 1).setHSL(Math.random(), 0.9, 0.6).toArray())],
    dark: [2.6, (x, z) => puff(x, z, [0.01, 0.01, 0.02], 0.85, 1.15)], cloud: [1.7, (x, z) => puff(x, z, [0.72, 0.74, 0.78], 0.32, 1.2)], glyph: [1.5, (x, z) => mote(x, z, [1, 0.85, 0.45])],
  };
  const ZE = { fire: [6, (x, z) => flame(x, z, 0.7)], cold: [5, (x, z) => SPARK.emit({ x, y: rr(0.8, 1.6), z, vx: rr(-0.2, 0.2), vy: rr(-0.9, -0.4), vz: rr(-0.2, 0.2), life: rr(1, 1.8), size: rr(0.05, 0.1), a: 0.9, c: [0.9, 0.97, 1] })],
    poison: [1.2, (x, z, E) => puff(x, z, E.smoke, 0.3)], necrotic: [1.2, (x, z, E) => { puff(x, z, E.smoke, 0.4); mote(x, z, pickOf(E.c)); }],
    acid: [3, (x, z, E) => SPARK.emit({ x, y: 0.05, z, vy: rr(0.3, 0.9), life: rr(0.5, 1), size: rr(0.06, 0.14), a: 0.8, c: pickOf(E.c) })],
    lightning: [2, (x, z, E) => { for (let i = 0; i < 3; i++) SPARK.emit({ x, y: rr(0.2, 1), z, vx: rr(-2, 2), vy: rr(-1, 2), vz: rr(-2, 2), life: rr(0.1, 0.25), size: rr(0.05, 0.1), c: pickOf(E.c) }); }] };
  function emitZones(dt) {
    let budget = 70;
    zones.forEach((z) => {
      const K = ZK[z.kind] || (z.kind === 'zone' && (ZE[z.E.n] || [2, (x, zz, E) => mote(x, zz, pickOf(E.c))])); if (!K) return;
      z.acc = Math.min(40, z.acc + K[0] * z.cells.length * dt);
      while (z.acc >= 1 && budget-- > 0) { z.acc -= 1; const c = pickOf(z.cells); K[1](c[0] + Math.random(), c[1] + Math.random(), z.E); }
    });
  }
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
      const sy = stairY.size ? stairY.get(`${Math.floor(T.pos.x)}_${Math.floor(T.pos.z)}`) || 0 : 0; // на лестнице — на высоте ступеней
      T.root.position.set(T.pos.x, sy, T.pos.z);
      if (T.lg > 0) { T.lg -= dt; const q = Math.sin((Math.max(0, T.lg) / 0.24) * Math.PI) * 0.3; T.root.position.x += T.ldx * q; T.root.position.z += T.ldz * q; busy = true; } // выпад при ударе
      T.fig.position.set(ox, BASE_H + hop + lift + Math.min(2, (t.alt || 0) / 10), 0);
      // Без сознания — фигурка лежит
      const lie = t.down ? 1 : 0; T.lie = (T.lie || 0) + (lie - (T.lie || 0)) * Math.min(1, dt * 8); if (Math.abs(lie - T.lie) > 0.01) busy = true;
      T.fig.rotation.z = T.lie * 1.35; T.fig.position.x += T.lie * 0.2 * t.size;
      T.body.rotation.y = T.spin ? T.yaw : cur.yaw; // модель смотрит, куда шла; медальон — всегда лицом к камере
      if (T.turn.visible) { T.turn.material.opacity = 0.55 + 0.4 * Math.sin(time * 4); const k = t.size * (1 + 0.04 * Math.sin(time * 4)); T.turn.scale.set(k, 1, k); }
      const p = project(T.pos.x, T.pos.z, (T.top + BASE_H) * (1 - T.lie * 0.6) + 0.12 + hop + lift + sy), lx = Math.round(p.x), ly = Math.round(p.y);
      if (lx !== T.lx || ly !== T.ly) { T.lx = lx; T.ly = ly; T.lab.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -100%)`; }
    });
    waterTime.value = time;
    LAMPS.forEach((L) => { if (L.userData.base) L.intensity = L.userData.base * (0.88 + 0.12 * Math.sin(time * 9 + L.userData.seed) * Math.sin(time * 5.3 + L.userData.seed * 2)); });
    lampBox.children.forEach((o) => { const f = o.userData.flame; if (!f) return; const ph = o.position.x * 5 + o.position.z * 3, k = Math.sin(time * 11 + ph) * Math.sin(time * 7.3 + ph); o.scale.set(f[0] * (1 - 0.1 * k), f[1] * (1 + 0.16 * k + 0.06 * Math.sin(time * 23 + ph)), 1); });
    if (zoneStale) pullZones();
    emitZones(dt); runFx(dt); SPARK.update(dt); SMOKE.update(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 1.3);
    if (FX.length || SPARK.ps.length || SMOKE.ps.length || shake > 0) busy = true;
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
    draw();
  }
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); kick();
    SPARK.mat.uniforms.scale.value = SMOKE.mat.uniforms.scale.value = canvas.height / (2 * tan);
    if (composer) composer.setSize(canvas.width, canvas.height);
  }
  const ro = window.ResizeObserver ? new ResizeObserver(resize) : null; if (ro) ro.observe(wrap);
  // Свечение (bloom): всё яркое — пламя факелов, заклинания, молнии, лава — даёт мягкий ореол, как в образце стиля.
  // Сцена рисуется в буфер, яркие места размываются и накладываются обратно. Только на компьютерах: телефонам это тяжело
  let composer = null;
  const draw = () => (composer ? composer.render() : renderer.render(scene, camera));
  if (fine) Promise.all(['EffectComposer', 'RenderPass', 'UnrealBloomPass', 'OutputPass'].map((n) => import(`three/addons/postprocessing/${n}.js`))).then(([A, B, C, D]) => {
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    const c = new A.EffectComposer(renderer, new THREE.WebGLRenderTarget(Math.max(1, sz.x), Math.max(1, sz.y), { type: THREE.HalfFloatType, samples: 4 }));
    c.addPass(new B.RenderPass(scene, camera)); c.addPass(new C.UnrealBloomPass(new THREE.Vector2(sz.x / 2, sz.y / 2), BLOOM[0], BLOOM[1], BLOOM[2])); c.addPass(new D.OutputPass());
    composer = c; glowK = 1;
    // Частицы теперь пишутся в линейный буфер; источники огня — ярче порога свечения
    SPARK.mat.uniforms.lin.value = SMOKE.mat.uniforms.lin.value = 1; flameMat.color.setScalar(1.7);
    if (liquids.lava && liquids.lava.mesh) liquids.lava.mesh.material.uniforms.uGlow.value = 1.2;
    resize(); kick(600);
  }).catch(() => { /* без свечения — как раньше */ });
  function setOn(v) {
    on = v; canvas.hidden = over.hidden = fxBox.hidden = !v;
    if (v) { resize(); cur.ok = false; stale = true; Object.keys(layers).forEach(tex); last = performance.now(); if (!raf) raf = requestAnimationFrame(frame); kick(1000); }
    else { cancelAnimationFrame(raf); raf = 0; }
  }
  // Для проверок: прогнать кадры без requestAnimationFrame (в скрытой вкладке он стоит)
  function step(k = 1, dt = 1 / 30) { resize(); for (let i = 0; i < k; i++) update(dt); draw(); }
  return { setOn, tokens, tex, ground, pick, project, tokTop, dragTo, hit, kick, step, attack, burst, fx: fxBox, refresh() { stale = true; kick(); }, info: () => ({ toks: toks.size, props: propBox.children.reduce((a, m) => a + m.count, 0), walls: wallMesh ? wallMesh.geometry.index.count / 3 : 0, ground: [groundCv.width, groundCv.height], liquids: Object.keys(liquids).filter((k) => liquids[k].mesh && liquids[k].mesh.visible), doors: doorBox.children.length, lamps: LAMPS.filter((L) => L.intensity > 0).length, sparks: SPARK.ps.length, smoke: SMOKE.ps.length, fx: FX.length, zones: zones.map((z) => z.kind), zoneMeshes: zoneBox.children.length, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, cam: { ...cur } }) };
}
