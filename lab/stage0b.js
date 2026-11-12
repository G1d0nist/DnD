// ===== Этап 0б: та же сцена в 3D (Three.js). Карта, текстура пола, иконки и правила берутся из stage0-gfx.js =====
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = id => document.getElementById(id);
const WALL_H = 1.25;
const S = { round: 1, turn: 0, mode: 'move', busy: false, over: false, slots: 2, shake: 0, t: 0, wx: -99, wz: -99, reach: null, pause: false };
window.S = S;

// ---------- Рендер ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
view.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x050407); scene.fog = new THREE.FogExp2(0x07060a, .035);
const camera = new THREE.PerspectiveCamera(38, 1, .1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = .12; controls.screenSpacePanning = false;
controls.minDistance = 4; controls.maxDistance = 26; controls.minPolarAngle = .15; controls.maxPolarAngle = 1.2;
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), .75, .55, .82); composer.addPass(bloom);
composer.addPass(new OutputPass());
function homeView() {
  const wide = innerWidth > 820;
  controls.target.set(wide ? 10.6 : 8, 0, 5.8);
  camera.position.set(controls.target.x - 1.5, wide ? 13 : 17, controls.target.z + (wide ? 10.5 : 12));
  controls.update();
}
function resize() {
  const w = innerWidth, h = innerHeight; renderer.setSize(w, h); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  pmat.uniforms.scale.value = smat.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
}

// ---------- Текстуры ----------
function canvasTex(c, srgb = true) { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; }
buildFloor();
const floorTex = canvasTex(floorCv);
function brickCanvas(dark) {
  const c = mk(256, 256), g = c.getContext('2d'), R = mulberry32(dark ? 11 : 3);
  g.fillStyle = dark ? '#16130f' : '#1d1814'; g.fillRect(0, 0, 256, 256);
  if (dark) { for (let i = 0; i < 400; i++) { g.fillStyle = R() < .5 ? 'rgba(255,240,220,.05)' : 'rgba(0,0,0,.3)'; g.fillRect(R() * 256, R() * 256, 2 + R() * 4, 2 + R() * 4); } return c; }
  const rh = 32;
  for (let r = 0; r < 8; r++) for (let x = -(r % 2) * 24 - R() * 10; x < 256;) {
    const w = 40 + R() * 26, x0 = Math.max(0, x) + 2, x1 = Math.min(256, x + w) - 2;
    if (x1 > x0) {
      const L = 22 + R() * 12; g.fillStyle = `hsl(${24 + R() * 14},${6 + R() * 8}%,${L}%)`; g.fillRect(x0, r * rh + 2, x1 - x0, rh - 4);
      g.fillStyle = 'rgba(255,235,210,.12)'; g.fillRect(x0, r * rh + 2, x1 - x0, 2);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x0, r * rh + rh - 5, x1 - x0, 3);
      for (let k = 0; k < 12; k++) { g.fillStyle = R() < .5 ? 'rgba(255,240,220,.06)' : 'rgba(0,0,0,.18)'; g.fillRect(x0 + R() * (x1 - x0), r * rh + 2 + R() * (rh - 4), 2, 2); }
    }
    x += w;
  }
  for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(50,75,30,.45)'; g.fillRect(R() * 256, 200 + R() * 56, 6 + R() * 12, 4); }
  return c;
}
const brickTex = canvasTex(brickCanvas(false)), topTex = canvasTex(brickCanvas(true));
const glowTex = canvasTex(glowSprite('255,255,255')), smokeTex = canvasTex(smokeSprite('255,255,255'));
function circleCanvas() {
  const c = mk(512, 512), g = c.getContext('2d'); g.translate(256, 256); g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 240, 0, TAU); g.stroke(); g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 200, 0, TAU); g.stroke();
  for (let i = 0; i < 24; i++) { g.save(); g.rotate(i * TAU / 24); g.fillRect(205, -2, 30, 4); g.restore(); }
  g.lineWidth = 3; g.beginPath(); for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + i * TAU * 2 / 6; i ? g.lineTo(Math.cos(a) * 196, Math.sin(a) * 196) : g.moveTo(Math.cos(a) * 196, Math.sin(a) * 196); } g.stroke();
  g.beginPath(); g.arc(0, 0, 90, 0, TAU); g.stroke();
  return c;
}
const circleTex = canvasTex(circleCanvas());

// ---------- Уровень ----------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: floorTex, bumpMap: floorTex, bumpScale: 2.5, roughness: .88, metalness: 0 }));
floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, H / 2); floor.receiveShadow = true; scene.add(floor);
const isFloorish = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !wallAt(x, y);
const wallCells = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!wallAt(x, y)) continue;
  let near = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloorish(x + dx, y + dy)) near = true;
  if (near) wallCells.push([x, y]);
}
const wallMats = [new THREE.MeshStandardMaterial({ map: brickTex, bumpMap: brickTex, bumpScale: 4, roughness: .92 })];
const topMat = new THREE.MeshStandardMaterial({ map: topTex, roughness: 1, color: 0x8a8580 });
const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, WALL_H, 1), [wallMats[0], wallMats[0], topMat, topMat, wallMats[0], wallMats[0]], wallCells.length);
const m4 = new THREE.Matrix4();
wallCells.forEach(([x, y], i) => wallMesh.setMatrixAt(i, m4.makeTranslation(x + .5, WALL_H / 2, y + .5)));
wallMesh.castShadow = wallMesh.receiveShadow = true; scene.add(wallMesh);
const blackGround = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ color: 0x030203 }));
blackGround.rotation.x = -Math.PI / 2; blackGround.position.set(W / 2, -.01, H / 2); scene.add(blackGround);

const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6a5e52, roughness: .85, bumpMap: brickTex, bumpScale: 1 });
for (const [x, y] of cells('P')) {
  const g = new THREE.Group(); g.position.set(x + .5, 0, y + .5);
  const parts = [[new THREE.CylinderGeometry(.42, .46, .22, 8), .11], [new THREE.CylinderGeometry(.27, .3, 1.35, 16), .89], [new THREE.CylinderGeometry(.4, .33, .2, 8), 1.66]];
  for (const [geo, yy] of parts) { const m = new THREE.Mesh(geo, stoneMat); m.position.y = yy; m.castShadow = m.receiveShadow = true; g.add(m); }
  scene.add(g);
}
const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: .5, metalness: .8 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3820, roughness: .8 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xd6a548, roughness: .3, metalness: 1 });
for (const [x, y] of cells('B')) {
  const g = new THREE.Group(); g.position.set(x + .5, 0, y + .5);
  for (let i = 0; i < 3; i++) { const a = i * TAU / 3, leg = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .62), ironMat); leg.position.set(Math.cos(a) * .2, .3, Math.sin(a) * .2); leg.rotation.set(Math.sin(a) * .35, 0, -Math.cos(a) * .35); leg.castShadow = true; g.add(leg); }
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(.34, 20, 10, 0, TAU, Math.PI / 2, Math.PI / 2), ironMat); bowl.position.y = .78; bowl.castShadow = true; g.add(bowl);
  const coals = new THREE.Mesh(new THREE.CircleGeometry(.3, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, .42, .08), toneMapped: false })); coals.rotation.x = -Math.PI / 2; coals.position.y = .76; g.add(coals);
  scene.add(g);
}
for (const [x, y] of cells('C')) {
  const g = new THREE.Group(); g.position.set(x + .5, 0, y + .5); g.rotation.y = .25;
  const box = new THREE.Mesh(new THREE.BoxGeometry(.7, .38, .45), woodMat); box.position.y = .19; g.add(box);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(.225, .225, .7, 16, 1, false, 0, Math.PI), woodMat); lid.rotation.z = Math.PI / 2; lid.rotation.y = Math.PI / 2; lid.position.y = .38; g.add(lid);
  for (const dx of [-.22, .22]) { const b = new THREE.Mesh(new THREE.BoxGeometry(.05, .62, .47), ironMat); b.position.set(dx, .3, 0); g.add(b); }
  const lock = new THREE.Mesh(new THREE.BoxGeometry(.08, .1, .03), goldMat); lock.position.set(0, .34, .235); g.add(lock);
  g.traverse(o => { o.castShadow = o.receiveShadow = true; }); scene.add(g);
}
for (const [x, y] of cells('D')) {
  const d = new THREE.Mesh(new THREE.BoxGeometry(.08, 1.05, .82), woodMat); d.position.set(x + .9, .53, y + .08 + .41); d.rotation.y = 1.25; d.castShadow = true; scene.add(d);
}
const rubR = mulberry32(5);
for (const [x, y] of cells('r')) for (let k = 0; k < 6; k++) {
  const s = new THREE.Mesh(new THREE.DodecahedronGeometry(.05 + rubR() * .09), stoneMat); s.position.set(x + .2 + rubR() * .6, .04, y + .2 + rubR() * .6); s.rotation.set(rubR() * 3, rubR() * 3, 0); s.castShadow = true; scene.add(s);
}
// Вода
const waterGeoms = [];
const waterMat = new THREE.MeshStandardMaterial({ color: 0x2a6e7c, roughness: .18, metalness: 0, emissive: 0x08222a, transparent: true, opacity: .9 });
function rippleCanvas(ph) {
  const c = mk(256, 256), g = c.getContext('2d'); g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) { const y = (i * 6.4 + ph * 12) % 256; g.strokeStyle = `rgba(${110 + (i % 3) * 25},${150 - (i % 4) * 12},255,.5)`; g.lineWidth = 3; g.beginPath(); for (let x = 0; x <= 256; x += 8) g.lineTo(x, y + Math.sin(x * .05 + i) * 4); g.stroke(); }
  return c;
}
const rippleTex = canvasTex(rippleCanvas(0), false); rippleTex.wrapS = rippleTex.wrapT = THREE.RepeatWrapping; rippleTex.repeat.set(2, 2);
waterMat.normalMap = rippleTex; waterMat.normalScale.set(.35, .35);
for (const [x, y] of WATER) { const m = new THREE.Mesh(new THREE.CircleGeometry(.72, 24), waterMat); m.rotation.x = -Math.PI / 2; m.position.set(x + .5, .025 + (x + y) * .0004, y + .5); m.receiveShadow = true; scene.add(m); }

// ---------- Свет ----------
scene.add(new THREE.HemisphereLight(0x4a5888, 0x1a120a, .55));
const flames = [];
function pointLight(color, intensity, dist, x, y, z, shadow) {
  const L = new THREE.PointLight(color, intensity, dist, 1.4); L.position.set(x, y, z);
  if (shadow) { L.castShadow = true; L.shadow.mapSize.set(512, 512); L.shadow.camera.near = .1; L.shadow.camera.far = dist; L.shadow.bias = -.004; L.shadow.normalBias = .03; }
  scene.add(L); return L;
}
function flameSprites(x, y, z, sc) {
  const outer = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff6a20, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const inner = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd080, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  outer.position.set(x, y, z); inner.position.set(x, y - .03 * sc, z); outer.scale.setScalar(.9 * sc); inner.scale.setScalar(.32 * sc);
  scene.add(outer, inner); return { outer, inner };
}
for (const [x, y] of cells('T')) {
  const br = new THREE.Mesh(new THREE.BoxGeometry(.1, .32, .14), ironMat); br.position.set(x + .5, .9, y + 1.05); br.rotation.x = -.35; scene.add(br);
  const L = pointLight(0xff9a50, 9, 9, x + .5, 1.15, y + 1.45, true);
  flames.push({ L, base: 9, x: x + .5, y: 1.13, z: y + 1.12, sc: 1, seed: x * 3.1, spr: flameSprites(x + .5, 1.15, y + 1.12, 1) });
}
for (const [x, y] of cells('B')) {
  const L = pointLight(0xff8a40, 11, 11, x + .5, 1.35, y + .5, true);
  flames.push({ L, base: 11, x: x + .5, y: .82, z: y + .5, sc: 1.6, seed: 9, spr: flameSprites(x + .5, 1.0, y + .5, 1.1) });
}
for (const [x, y] of cells('C')) pointLight(0xffc860, 1.2, 2.2, x + .5, .7, y + .8, false);
const staffLight = pointLight(0x7aa8ff, 3.2, 4.5, 0, 1.2, 0, false);
const dynLights = [];
function tempLight(color, intensity, dist, x, y, z) { const L = new THREE.PointLight(color, intensity, dist, 1.4); L.position.set(x, y, z); scene.add(L); dynLights.push(L); return L; }
function dropLight(L) { scene.remove(L); L.dispose(); dynLights.splice(dynLights.indexOf(L), 1); }

// ---------- Частицы (GPU) ----------
const VS = `attribute float size; attribute float alpha; attribute vec3 pcol; uniform float scale; varying vec3 vC; varying float vA;
void main(){ vC=pcol; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }`;
const FS = `uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t=texture2D(map,gl_PointCoord); gl_FragColor=vec4(vC*t.rgb,t.a*vA); }`;
const pmat = new THREE.ShaderMaterial({ uniforms: { map: { value: glowTex }, scale: { value: 500 } }, vertexShader: VS, fragmentShader: FS, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const smat = new THREE.ShaderMaterial({ uniforms: { map: { value: smokeTex }, scale: { value: 500 } }, vertexShader: VS, fragmentShader: FS, blending: THREE.NormalBlending, depthWrite: false, transparent: true });
class PSys {
  constructor(max, mat) {
    this.max = max; this.ps = []; const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3); this.col = new THREE.BufferAttribute(new Float32Array(max * 3), 3);
    this.sz = new THREE.BufferAttribute(new Float32Array(max), 1); this.al = new THREE.BufferAttribute(new Float32Array(max), 1);
    for (const a of [this.pos, this.col, this.sz, this.al]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos); g.setAttribute('pcol', this.col); g.setAttribute('size', this.sz); g.setAttribute('alpha', this.al);
    this.pts = new THREE.Points(g, mat); this.pts.frustumCulled = false; this.pts.renderOrder = 5; scene.add(this.pts); this.g = g;
  }
  emit(o) { if (this.ps.length < this.max) this.ps.push(Object.assign({ t: 0, life: 1, vx: 0, vy: 0, vz: 0, gy: 0, drag: 1, size: .2, grow: 0, a: 1, c: [1, .6, .2] }, o)); }
  update(dt) {
    const ps = this.ps; let n = 0;
    for (let i = ps.length - 1; i >= 0; i--) { const p = ps[i]; p.t += dt; if (p.t >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); } }
    for (const p of ps) {
      const k = Math.pow(p.drag, dt * 60); p.vx *= k; p.vy = p.vy * k + p.gy * dt; p.vz *= k; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f = p.t / p.life, a = p.a * Math.min(1, f * 8) * (1 - f);
      this.pos.array.set([p.x, p.y, p.z], n * 3); this.col.array.set(p.c, n * 3); this.sz.array[n] = Math.max(.01, p.size + p.grow * p.t); this.al.array[n] = a; n++;
    }
    this.g.setDrawRange(0, n); for (const a of [this.pos, this.col, this.sz, this.al]) a.needsUpdate = true;
  }
}
const FX3 = new PSys(4000, pmat), SMOKE = new PSys(600, smat); SMOKE.pts.renderOrder = 4; FX3.pts.renderOrder = 6;
const FIRE = [[1, .55, .2], [1, .38, .1], [1, .72, .35], [.9, .26, .06]];

// ---------- Существа ----------
const TOK0 = [
  { id: 'ilva', name: 'Илва', sub: 'Волшебница 5 ур.', kind: 'wizard', side: 'pc', x: 2, y: 4, s: 1, max: 27, ac: 15, speed: 6, dex: 2, init: 18, h: 1.05 },
  { id: 'skel', name: 'Скелет', sub: 'Нежить', kind: 'skull', side: 'foe', x: 12, y: 3, s: 1, max: 13, ac: 14, speed: 6, dex: 3, init: 14, h: 1.05, atk: { name: 'Короткий меч', bonus: 5, n: 1, d: 6, mod: 3, type: 'колющего' } },
  { id: 'ogre', name: 'Огр', sub: 'Великан, Большой', kind: 'ogre', side: 'foe', x: 12, y: 7, s: 2, max: 68, ac: 11, speed: 8, dex: -1, init: 9, h: 2.0, atk: { name: 'Дубина', bonus: 6, n: 2, d: 8, mod: 4, type: 'дробящего' } },
];
const MODEL_FILE = { wizard: 'wizard', skull: 'skeleton', ogre: 'ogre' };
let toks = [];
const pc = () => toks[0], cur = () => toks[S.turn];
const std = (color, o) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: .7 }, o || {}));
function addMesh(g, geo, mat, x, y, z, rx, ry, rz) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, rz || 0); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; }
function placeholder(kind) {
  const g = new THREE.Group();
  if (kind === 'wizard') {
    const robe = std(0x2c3a8c), skin = std(0xd9b08c), hat = std(0x3a2d78);
    addMesh(g, new THREE.ConeGeometry(.24, .72, 20), robe, 0, .4, 0);
    addMesh(g, new THREE.CylinderGeometry(.13, .16, .2, 16), robe, 0, .72, 0);
    addMesh(g, new THREE.SphereGeometry(.105, 16, 12), skin, 0, .9, 0);
    addMesh(g, new THREE.CylinderGeometry(.21, .21, .02, 24), hat, 0, .98, 0);
    addMesh(g, new THREE.ConeGeometry(.12, .36, 16), hat, .02, 1.16, 0, 0, 0, -.18);
    addMesh(g, new THREE.CylinderGeometry(.11, .11, .03, 16), goldMat, 0, 1.0, 0);
    for (const s of [-1, 1]) addMesh(g, new THREE.CylinderGeometry(.04, .05, .34, 8), robe, s * .17, .66, .04, .3, 0, s * .35);
    addMesh(g, new THREE.CylinderGeometry(.015, .018, 1.15, 8), std(0x4a2e18), .25, .6, .12);
    const gem = addMesh(g, new THREE.OctahedronGeometry(.055), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 4), toneMapped: false }), .25, 1.22, .12);
    g.userData.gem = gem;
  } else if (kind === 'skull') {
    const bone = std(0xd8cfb4, { roughness: .6 }), dark = std(0x111111);
    for (const s of [-1, 1]) { addMesh(g, new THREE.CylinderGeometry(.03, .025, .45, 6), bone, s * .08, .24, 0); addMesh(g, new THREE.CylinderGeometry(.025, .02, .42, 6), bone, s * .19, .62, .05, .5, 0, s * .2); }
    addMesh(g, new THREE.CylinderGeometry(.03, .03, .4, 6), bone, 0, .62, -.02);
    for (let i = 0; i < 4; i++) addMesh(g, new THREE.TorusGeometry(.11 - i * .012, .014, 6, 16, Math.PI * 1.6), bone, 0, .55 + i * .07, 0, Math.PI / 2, 0, Math.PI * .7);
    addMesh(g, new THREE.CylinderGeometry(.12, .1, .06, 10), bone, 0, .46, 0);
    addMesh(g, new THREE.SphereGeometry(.11, 16, 12), bone, 0, .94, 0);
    addMesh(g, new THREE.BoxGeometry(.13, .06, .1), bone, 0, .84, .03);
    for (const s of [-1, 1]) { addMesh(g, new THREE.SphereGeometry(.03, 8, 6), dark, s * .045, .95, .09); addMesh(g, new THREE.SphereGeometry(.012, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, .5, .3), toneMapped: false }), s * .045, .95, .115); }
    addMesh(g, new THREE.BoxGeometry(.03, .5, .07), std(0x9aa0a6, { metalness: .9, roughness: .3 }), .24, .6, .25, .9, 0, 0);
  } else {
    const skin = std(0x7a8a48, { roughness: .8 }), cloth = std(0x5a3d22);
    for (const s of [-1, 1]) addMesh(g, new THREE.CapsuleGeometry(.14, .5, 4, 10), skin, s * .24, .38, 0);
    addMesh(g, new THREE.CapsuleGeometry(.46, .55, 6, 16), skin, 0, 1.12, 0);
    addMesh(g, new THREE.CylinderGeometry(.46, .5, .3, 16), cloth, 0, .72, 0);
    addMesh(g, new THREE.SphereGeometry(.26, 16, 12), skin, 0, 1.78, .05);
    addMesh(g, new THREE.BoxGeometry(.34, .1, .16), skin, 0, 1.68, .2);
    for (const s of [-1, 1]) { addMesh(g, new THREE.ConeGeometry(.035, .12, 6), std(0xf1e6c8), s * .1, 1.75, .27); addMesh(g, new THREE.SphereGeometry(.03, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, .4), toneMapped: false }), s * .09, 1.84, .27); }
    addMesh(g, new THREE.CapsuleGeometry(.12, .7, 4, 10), skin, -.58, 1.05, .05, 0, 0, .2);
    addMesh(g, new THREE.CapsuleGeometry(.12, .6, 4, 10), skin, .56, 1.15, .2, -.8, 0, -.25);
    addMesh(g, new THREE.CylinderGeometry(.14, .06, 1.0, 10), std(0x4a2e18, { roughness: .9 }), .66, 1.25, .62, -1.25, 0, 0);
  }
  return g;
}
function baseDisc(tk) {
  const r = tk.s * .44, g = new THREE.Group();
  const rim = tk.side === 'pc' ? std(0xb8862f, { metalness: .9, roughness: .35 }) : std(0x7a2018, { metalness: .7, roughness: .4 });
  addMesh(g, new THREE.CylinderGeometry(r, r * 1.04, .07, 40), rim, 0, .035, 0);
  addMesh(g, new THREE.CylinderGeometry(r * .86, r * .86, .074, 40), std(0x1c1814, { roughness: .9 }), 0, .037, 0);
  return g;
}
const loader = new GLTFLoader(); let modelsLoaded = 0;
function tryModel(tk) {
  loader.load(`models/${MODEL_FILE[tk.kind]}.glb`, gltf => {
    const m = gltf.scene, box = new THREE.Box3().setFromObject(m), size = box.getSize(new THREE.Vector3()), k = tk.h / size.y;
    m.scale.setScalar(k); box.setFromObject(m); const c = box.getCenter(new THREE.Vector3());
    m.position.set(-c.x, .07 - box.min.y, -c.z);
    m.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    tk.figure.remove(tk.body); tk.body = m; tk.figure.add(m); tk.mats = collectMats(m);
    modelsLoaded++; $('modelState').textContent = `Модели: ${modelsLoaded} из 3 загружены`;
  }, undefined, () => {});
}
function collectMats(o) { const out = []; o.traverse(n => { if (n.isMesh) for (const m of [].concat(n.material)) if (m.emissive && !out.includes(m)) out.push(m); }); return out; }
function makeTok(o) {
  const tk = Object.assign({}, o, { hp: o.max, ox: 0, oz: 0, hop: 0, hit: 0, flash: 0, dead: false, dieT: 1, action: 0, move: 0, anim: null });
  tk.root = new THREE.Group(); tk.figure = new THREE.Group(); tk.root.add(baseDisc(tk)); tk.root.add(tk.figure);
  tk.body = placeholder(tk.kind); tk.body.position.y = .07; tk.figure.add(tk.body); tk.mats = collectMats(tk.body);
  tk.root.traverse(n => { if (n.isMesh) n.castShadow = true; });
  tk.wx = tk.x + tk.s / 2; tk.wz = tk.y + tk.s / 2; tk.yaw = tk.side === 'pc' ? Math.PI / 2 : -Math.PI / 2; tk.yawT = tk.yaw;
  scene.add(tk.root);
  const R = tk.s * CELL * .42; tk.sp = makeSprite(tk.kind, tk.side, R);
  tk.plate = document.createElement('div'); tk.plate.className = 'plate ' + tk.side; tk.plate.innerHTML = `<div class="pn">${tk.name}</div><div class="pb"><i></i></div>`; document.body.appendChild(tk.plate);
  tryModel(tk);
  return tk;
}
function center(tk) { return { x: tk.wx, z: tk.wz }; }
function chest(tk) { return new THREE.Vector3(tk.wx + tk.ox, tk.h * .6 + tk.hop, tk.wz + tk.oz); }

// ---------- Эффекты ----------
const FX = [];
function addFx(o) { return new Promise(res => { o.t = 0; o.done = res; FX.push(o); }); }
function runFx(dt) { for (let i = FX.length - 1; i >= 0; i--) { const f = FX[i]; f.t += dt; const alive = f.update ? f.update(dt) !== false : true; if (!alive || (f.dur && f.t >= f.dur)) { FX.splice(i, 1); f.end && f.end(); f.done(); } } }
const wait = ms => new Promise(r => setTimeout(r, ms));
function flatMesh(geo, color, opacity, additive) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: !additive }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 3; return m;
}
function charge(tk, c, ms) {
  const ring = flatMesh(new THREE.PlaneGeometry(1, 1), new THREE.Color(c[0] * 2, c[1] * 2, c[2] * 2), 0, true); ring.material.map = circleTex;
  ring.position.set(tk.wx, .03, tk.wz); ring.scale.setScalar(tk.s * 1.8); scene.add(ring);
  const L = tempLight(new THREE.Color(...c), 0, 4, tk.wx, 1.2, tk.wz);
  return addFx({ dur: ms / 1000, update() { const k = Math.min(1, this.t / this.dur); ring.material.opacity = k; ring.rotation.z = this.t * 2; L.intensity = 6 * k;
      for (let i = 0; i < 4; i++) { const a = rnd(0, TAU), r = rnd(.8, 1.3), y = rnd(.1, 1.3); FX3.emit({ x: tk.wx + Math.cos(a) * r, y, z: tk.wz + Math.sin(a) * r, vx: -Math.cos(a) * r * 2.4, vy: (1.1 - y) * 2.4, vz: -Math.sin(a) * r * 2.4, life: .4, size: rnd(.06, .12), c }); } },
    end() { dropLight(L); addFx({ dur: .5, update() { ring.material.opacity = 1 - this.t / .5; }, end() { scene.remove(ring); } }); } });
}
function projectile(from, to) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.14, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, .8), toneMapped: false })); scene.add(ball);
  const L = tempLight(0xff8a40, 10, 6, from.x, from.y, from.z);
  const dur = clamp(from.distanceTo(to) / 13, .3, .75), p = new THREE.Vector3();
  return addFx({ dur, update() { const f = ease(Math.min(1, this.t / dur)); p.lerpVectors(from, to, f); p.y += Math.sin(Math.PI * f) * 1.6; ball.position.copy(p); L.position.copy(p);
      for (let i = 0; i < 6; i++) FX3.emit({ x: p.x + rnd(-.05, .05), y: p.y + rnd(-.05, .05), z: p.z + rnd(-.05, .05), vx: rnd(-.4, .4), vy: rnd(-.2, .6), vz: rnd(-.4, .4), life: rnd(.25, .5), size: rnd(.15, .3), grow: -.2, c: pick(FIRE) });
      if (Math.random() < .4) SMOKE.emit({ x: p.x, y: p.y, z: p.z, vy: .3, life: 1, size: .3, grow: .6, a: .35, c: [.3, .27, .25] }); },
    end() { scene.remove(ball); dropLight(L); } });
}
function scorch(x, z, r, a) {
  const g = floorCv.getContext('2d'); g.setTransform(RS, 0, 0, RS, 0, 0);
  for (let i = 0; i < 10; i++) { const cx = (x + rnd(-r, r) * .4) * CELL, cy = (z + rnd(-r, r) * .4) * CELL, rr = r * rnd(.35, .7) * CELL, gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr); gr.addColorStop(0, `rgba(10,5,2,${a})`); gr.addColorStop(1, 'rgba(10,5,2,0)'); g.fillStyle = gr; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2); }
  floorTex.needsUpdate = true;
}
const FB_R = 4;
function explosion(x, z) {
  S.shake = .35;
  const L = tempLight(0xff7a30, 60, 14, x, 1.5, z);
  addFx({ dur: 1.3, update() { L.intensity = 60 * Math.pow(1 - this.t / 1.3, 2); }, end() { dropLight(L); } });
  const core = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, .35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  core.position.set(x, .6, z); scene.add(core);
  addFx({ dur: .3, update() { const f = this.t / .3; core.scale.setScalar(.3 + 1.7 * ease(f)); core.material.opacity = Math.pow(1 - f, 2) * .7; }, end() { scene.remove(core); } });
  const wave = flatMesh(new THREE.RingGeometry(.9, 1, 64), new THREE.Color(3, 1.4, .4), 1, true); wave.position.set(x, .05, z); scene.add(wave);
  addFx({ dur: .55, update() { const f = this.t / .55; wave.scale.setScalar(.2 + FB_R * 1.1 * ease(f)); wave.material.opacity = 1 - f; }, end() { scene.remove(wave); } });
  for (let i = 0; i < 260; i++) {
    const th = rnd(0, TAU), ph = Math.acos(rnd(-.2, 1)), sp = Math.sqrt(Math.random()) * FB_R * 3.4;
    FX3.emit({ x, y: .5, z, vx: Math.sin(ph) * Math.cos(th) * sp, vy: Math.cos(ph) * sp * .8, vz: Math.sin(ph) * Math.sin(th) * sp, drag: .9, life: rnd(.45, 1), size: rnd(.35, .7), grow: .6, a: .55, c: pick(FIRE) });
  }
  for (let i = 0; i < 90; i++) { const th = rnd(0, TAU), sp = rnd(2, 7); FX3.emit({ x, y: .5, z, vx: Math.cos(th) * sp, vy: rnd(1, 5), vz: Math.sin(th) * sp, gy: -9, drag: .97, life: rnd(.6, 1.4), size: rnd(.05, .09), c: [1, .85, .55] }); }
  for (let i = 0; i < 60; i++) { const th = rnd(0, TAU), r = rnd(0, FB_R * .7); SMOKE.emit({ x: x + Math.cos(th) * r, y: rnd(.3, 1.2), z: z + Math.sin(th) * r, vx: Math.cos(th) * rnd(.2, .9), vy: rnd(.4, 1.2), vz: Math.sin(th) * rnd(.2, .9), drag: .97, life: rnd(1.6, 3), size: rnd(.8, 1.3), grow: 1.2, a: .3, c: [.14, .12, .11] }); }
  for (let i = 0; i < 30; i++) { const th = rnd(0, TAU), r = Math.sqrt(Math.random()) * FB_R * .9; FX3.emit({ x: x + Math.cos(th) * r, y: .05, z: z + Math.sin(th) * r, life: rnd(2.5, 4.5), size: rnd(.12, .22), a: .8, c: [1, .35, .08] }); }
  scorch(x, z, FB_R * .85, .75);
}
function jag(a, b, disp, it) {
  let pts = [a.clone(), b.clone()];
  for (let i = 0; i < it; i++) { const np = [pts[0]]; for (let j = 1; j < pts.length; j++) { const m = pts[j - 1].clone().add(pts[j]).multiplyScalar(.5); m.x += rnd(-disp, disp); m.y += rnd(-disp, disp) * .5; m.z += rnd(-disp, disp); np.push(m, pts[j]); } pts = np; disp *= .55; }
  return pts;
}
function tube(pts, r, mat) { const path = new THREE.CurvePath(); for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i])); return new THREE.Mesh(new THREE.TubeGeometry(path, pts.length * 2, r, 5, false), mat); }
function boltFx(a, b) {
  S.shake = .2;
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5.5, 7), toneMapped: false });
  const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(.6, .9, 2.4), transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const Ls = [.15, .5, .85].map(f => tempLight(0x8cb8ff, 30, 8, lerp(a.x, b.x, f), 1, lerp(a.z, b.z, f)));
  let meshes = [], next = 0;
  const regen = () => {
    for (const m of meshes) { scene.remove(m); m.geometry.dispose(); } meshes = [];
    const main = jag(a, b, .45, 6), sets = [main];
    for (let k = 0; k < 4; k++) { const m = main[Math.floor(rnd(.15, .85) * main.length)], d = b.clone().sub(a).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), rnd(-.9, .9)).multiplyScalar(rnd(.8, 2)); d.y = rnd(-.4, .2); sets.push(jag(m, m.clone().add(d), .2, 4)); }
    sets.forEach((p, i) => { const w = i ? .5 : 1; meshes.push(tube(p, .025 * w, core), tube(p, .1 * w, halo)); });
    for (const m of meshes) scene.add(m);
  };
  for (let i = 0; i < 50; i++) { const f = Math.random(); FX3.emit({ x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), z: lerp(a.z, b.z, f), vx: rnd(-3, 3), vy: rnd(-1, 3), vz: rnd(-3, 3), gy: -6, drag: .93, life: rnd(.3, .8), size: rnd(.05, .09), c: [.75, .87, 1] }); }
  for (let i = 0; i < 40; i++) FX3.emit({ x: b.x, y: b.y, z: b.z, vx: rnd(-4, 4), vy: rnd(-1, 4), vz: rnd(-4, 4), gy: -8, drag: .9, life: rnd(.3, .7), size: rnd(.05, .1), c: [.86, .92, 1] });
  const g = floorCv.getContext('2d'); g.setTransform(RS, 0, 0, RS, 0, 0); g.strokeStyle = 'rgba(10,8,12,.5)'; g.lineWidth = 5; g.beginPath();
  jag(new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z), .15, 5).forEach((p, i) => i ? g.lineTo(p.x * CELL, p.z * CELL) : g.moveTo(p.x * CELL, p.z * CELL)); g.stroke(); floorTex.needsUpdate = true;
  return addFx({ dur: .65, update() { if (this.t >= next) { regen(); next = this.t + .06; } const k = 1 - this.t / .65; halo.opacity = .45 * k; core.color.setRGB(5 * k + .2, 5.5 * k + .2, 7 * k + .2); for (const L of Ls) L.intensity = 30 * k; },
    end() { for (const m of meshes) { scene.remove(m); m.geometry.dispose(); } for (const L of Ls) dropLight(L); } });
}
function slash(att, tgt) {
  const heavy = att.kind === 'ogre', c = chest(tgt), r = tgt.s * .55;
  const m = new THREE.Mesh(new THREE.RingGeometry(r, r + (heavy ? .12 : .07), 32, 1, 0, .01), new THREE.MeshBasicMaterial({ color: heavy ? new THREE.Color(3, 2.2, 1.4) : new THREE.Color(2.6, 2.8, 3.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  m.position.copy(c); m.lookAt(camera.position); m.rotateZ(Math.atan2(att.wz - tgt.wz, att.wx - tgt.wx) + 2); scene.add(m);
  const dur = heavy ? .3 : .22;
  return addFx({ dur, update() { const f = this.t / dur; m.geometry.dispose(); m.geometry = new THREE.RingGeometry(r, r + (heavy ? .12 : .07), 32, 1, Math.max(0, 2.6 * ease(f) - 1), Math.min(1, 2.6 * ease(f)) + .01); m.material.opacity = 1 - f; }, end() { scene.remove(m); } });
}

// ---------- Подписи и всплывающие числа ----------
const v3 = new THREE.Vector3();
function toScreen(p) { v3.copy(p).project(camera); return { x: (v3.x + 1) / 2 * innerWidth, y: (1 - v3.y) / 2 * innerHeight, vis: v3.z < 1 }; }
const FT = [];
function floatText(tk, text, col, size) {
  const el = document.createElement('div'); el.className = 'ft'; el.textContent = text; el.style.color = col; el.style.fontSize = (size || 24) + 'px'; document.body.appendChild(el);
  FT.push({ el, p: chest(tk).add(new THREE.Vector3(0, tk.h * .6, 0)), t: 0, life: 1.4 });
}
function updateUI(dt) {
  for (const tk of toks) {
    const s = toScreen(new THREE.Vector3(tk.wx + tk.ox, tk.h + .25 + tk.hop, tk.wz + tk.oz));
    tk.plate.style.display = tk.dead || !s.vis ? 'none' : ''; tk.plate.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`;
    tk.plate.querySelector('i').style.width = (tk.hp / tk.max * 100) + '%';
    tk.plate.classList.toggle('show', S.hoverTok === tk);
  }
  for (let i = FT.length - 1; i >= 0; i--) {
    const f = FT[i]; f.t += dt; const k = f.t / f.life;
    if (k >= 1) { f.el.remove(); FT.splice(i, 1); continue; }
    const s = toScreen(f.p.clone().add(new THREE.Vector3(0, ease(Math.min(1, k * 1.3)) * .8, 0))), sc = k < .12 ? .6 + k / .12 * .7 : 1.3 - .3 * Math.min(1, (k - .12) * 5);
    f.el.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-50%) scale(${sc})`; f.el.style.opacity = k > .7 ? 1 - (k - .7) / .3 : 1;
  }
}

// ---------- Правила ----------
const d = n => 1 + Math.floor(Math.random() * n);
function roll(n, s) { const r = Array.from({ length: n }, () => d(s)); return { r, sum: r.reduce((a, b) => a + b, 0) }; }
function free(tk, x, y) {
  for (let dy = 0; dy < tk.s; dy++) for (let dx = 0; dx < tk.s; dx++) if (terrBlock(x + dx, y + dy)) return false;
  for (const o of toks) if (o !== tk && !o.dead && x < o.x + o.s && x + tk.s > o.x && y < o.y + o.s && y + tk.s > o.y) return false;
  return true;
}
function bfs(tk, max) {
  const dist = new Map(), prev = new Map(), q = [[tk.x, tk.y]]; dist.set(tk.y * W + tk.x, 0);
  while (q.length) {
    const [x, y] = q.shift(), k = y * W + x, dd = dist.get(k); if (dd >= max) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy, nk = ny * W + nx; if (dist.has(nk) || !free(tk, nx, ny)) continue;
      if (dx && dy && (!free(tk, x + dx, y) || !free(tk, x, y + dy))) continue;
      dist.set(nk, dd + 1); prev.set(nk, k); q.push([nx, ny]);
    }
  }
  return { dist, prev };
}
function pathFrom(prev, k) { const out = []; while (prev.has(k)) { out.unshift([k % W, Math.floor(k / W)]); k = prev.get(k); } return out; }
function gap(a, ax, ay, b) { return Math.max(Math.max(0, b.x - (ax + a.s), ax - (b.x + b.s)), Math.max(0, b.y - (ay + a.s), ay - (b.y + b.s))); }
const adjacent = (a, b) => gap(a, a.x, a.y, b) === 0;
const losC = (a, b) => los({ x: a.x * CELL, y: a.z * CELL }, { x: b.x * CELL, y: b.z * CELL });
function occ(tk) { const o = []; for (let dy = 0; dy < tk.s; dy++) for (let dx = 0; dx < tk.s; dx++) o.push({ x: tk.x + dx + .5, z: tk.y + dy + .5 }); return o; }
function inFireball(tk, px, pz) { return !tk.dead && occ(tk).some(c => Math.hypot(c.x - px, c.z - pz) <= FB_R + .01 && losC({ x: px, z: pz }, c)); }
function boltLine(me) {
  let dx = S.wx - me.wx, dz = S.wz - me.wz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const T = rayT(me.wx * CELL, me.wz * CELL, dx, dz, 20 * CELL) / CELL; return { x1: me.wx, z1: me.wz, x2: me.wx + dx * T, z2: me.wz + dz * T, len: T };
}
function segDist(px, pz, L) { const vx = L.x2 - L.x1, vz = L.z2 - L.z1, t = clamp(((px - L.x1) * vx + (pz - L.z1) * vz) / (vx * vx + vz * vz || 1), 0, 1); return Math.hypot(px - L.x1 - vx * t, pz - L.z1 - vz * t); }
function inBolt(tk, L, me) { return tk !== me && !tk.dead && occ(tk).some(c => segDist(c.x, c.z, L) <= .55); }
function face(tk, x, z) { tk.yawT = Math.atan2(x - tk.wx, z - tk.wz); }

function log(html) { const p = document.createElement('p'); p.innerHTML = html; $('logBody').appendChild(p); $('log').scrollTop = 1e9; }
let bannerT = 0;
function banner(text, sub, ms) { const b = $('banner'); b.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); b.style.opacity = 1; clearTimeout(bannerT); if (ms !== 0) bannerT = setTimeout(() => b.style.opacity = 0, ms || 1300); }
const nm = tk => `<span class="${tk.side === 'pc' ? 'c' : 'r'}">${tk.name}</span>`;
function damage(tk, n, type) {
  tk.hp = Math.max(0, tk.hp - n); tk.hit = .4; tk.flash = .3;
  floatText(tk, '−' + n, type === 'fire' ? '#ffa24a' : type === 'bolt' ? '#a9d0ff' : '#ff6b5b', n >= 20 ? 32 : 26);
  if (type === 'melee') { const c = chest(tk); for (let i = 0; i < 16; i++) FX3.emit({ x: c.x, y: c.y, z: c.z, vx: rnd(-2, 2), vy: rnd(0, 3), vz: rnd(-2, 2), gy: -9, drag: .95, life: rnd(.4, .8), size: rnd(.04, .08), c: tk.kind === 'skull' ? [.8, .78, .7] : [.6, .08, .05] }); }
  if (tk.hp === 0) kill(tk);
  hud();
}
function kill(tk) {
  tk.dead = true; tk.dieT = 0; log(tk.side === 'pc' ? `${nm(tk)} теряет сознание.` : `${nm(tk)} повержен.`);
  for (let i = 0; i < 30; i++) SMOKE.emit({ x: tk.wx + rnd(-.3, .3), y: rnd(.1, tk.h), z: tk.wz + rnd(-.3, .3), vx: rnd(-.5, .5), vy: rnd(.2, .8), vz: rnd(-.5, .5), drag: .96, life: rnd(1, 2), size: rnd(.4, .7), grow: .5, a: .4, c: tk.kind === 'skull' ? [.55, .53, .5] : [.3, .27, .23] });
  scorch(tk.wx, tk.wz, tk.s * .5, .25);
}
function save(tk, dc) { const r = d(20), tot = r + tk.dex, ok = tot >= dc; return { ok, txt: `спасбросок Ловкости ${r}${tk.dex >= 0 ? '+' : '−'}${Math.abs(tk.dex)} = ${tot} — <span class="${ok ? 'g' : 'r'}">${ok ? 'успех' : 'провал'}</span>` }; }

async function castFireball(px, pz) {
  const me = cur(); S.busy = true; me.action = 0; S.slots--; S.mode = 'move'; face(me, px, pz); hud();
  log(`${nm(me)} читает <span class="f">Огненный шар</span>.`);
  await charge(me, [1, .55, .2], 500);
  const gem = me.body.userData.gem, from = gem ? gem.getWorldPosition(new THREE.Vector3()) : chest(me);
  await projectile(from, new THREE.Vector3(px, .5, pz));
  explosion(px, pz);
  const hit = toks.filter(tk => inFireball(tk, px, pz)), dmg = roll(8, 6);
  log(`8d6 [${dmg.r.join(', ')}] = <b class="f">${dmg.sum}</b> урона огнём.`); if (!hit.length) log('<span class="m">Никто не задет.</span>');
  await wait(160);
  for (const tk of hit) { const s = save(tk, 15), n = s.ok ? Math.floor(dmg.sum / 2) : dmg.sum; log(`${nm(tk)}: ${s.txt}, получает ${n}.`); damage(tk, n, 'fire'); }
  await wait(900); S.busy = false; afterAction();
}
async function castBolt() {
  const me = cur(), L = boltLine(me); S.busy = true; me.action = 0; S.slots--; S.mode = 'move'; face(me, L.x2, L.z2); hud();
  log(`${nm(me)} читает <span class="l">Молнию</span>.`);
  await charge(me, [.55, .75, 1], 450);
  const hit = toks.filter(tk => inBolt(tk, L, me)), gem = me.body.userData.gem;
  const fx = boltFx(gem ? gem.getWorldPosition(new THREE.Vector3()) : chest(me), new THREE.Vector3(L.x2, .7, L.z2)), dmg = roll(8, 6);
  log(`8d6 [${dmg.r.join(', ')}] = <b class="l">${dmg.sum}</b> урона электричеством.`); if (!hit.length) log('<span class="m">Никто не задет.</span>');
  for (const tk of hit) { const s = save(tk, 15), n = s.ok ? Math.floor(dmg.sum / 2) : dmg.sum; log(`${nm(tk)}: ${s.txt}, получает ${n}.`); damage(tk, n, 'bolt'); }
  await fx; await wait(700); S.busy = false; afterAction();
}
async function melee(att, tgt) {
  const A = att.atk, an = Math.atan2(tgt.wz - att.wz, tgt.wx - att.wx); face(att, tgt.wx, tgt.wz);
  await addFx({ dur: .34, update() { const k = Math.sin(Math.PI * this.t / .34) * .35; att.ox = Math.cos(an) * k; att.oz = Math.sin(an) * k; }, end() { att.ox = att.oz = 0; } });
  const r = d(20), tot = r + A.bonus, crit = r === 20, ok = crit || (r !== 1 && tot >= tgt.ac), sl = slash(att, tgt);
  if (ok) { const dm = roll(A.n * (crit ? 2 : 1), A.d), n = dm.sum + A.mod; log(`${nm(att)} — ${A.name}: ${r}+${A.bonus} = ${tot} против КД ${tgt.ac}${crit ? ' <b class="f">крит!</b>' : ''} — попадание, ${n} ${A.type}.`); if (att.kind === 'ogre') S.shake = .25; damage(tgt, n, 'melee'); }
  else { log(`${nm(att)} — ${A.name}: ${r}+${A.bonus} = ${tot} против КД ${tgt.ac} — <span class="m">промах</span>.`); floatText(tgt, 'промах', '#bdb3a2', 16); }
  await sl;
}
function walk(tk, steps) {
  let p = Promise.resolve();
  for (const [x, y] of steps) p = p.then(() => new Promise(res => { const tx = x + tk.s / 2, tz = y + tk.s / 2; face(tk, tx, tz); tk.anim = { fx: tk.wx, fz: tk.wz, tx, tz, t: 0, dur: .22, res }; tk.x = x; tk.y = y; }));
  return p;
}

// ---------- Ходы ----------
function startTurn() {
  if (checkEnd()) return; const tk = cur(); if (tk.dead) return nextTurn();
  tk.action = 1; tk.move = tk.speed;
  if (tk.side === 'pc') { S.mode = 'move'; banner('Ваш ход', `Раунд ${S.round}`); } else banner(`Ход: ${tk.name}`);
  hud(); if (tk.side === 'foe') enemyTurn(tk);
}
function nextTurn() { if (checkEnd()) return; S.turn = (S.turn + 1) % toks.length; if (S.turn === 0) S.round++; startTurn(); }
function afterAction() { hud(); checkEnd(); }
function checkEnd() {
  if (S.over) return true;
  if (toks.filter(t => t.side === 'foe').every(t => t.dead)) { S.over = true; banner('Победа', 'Нажмите «Заново», чтобы повторить бой', 0); hud(); return true; }
  if (pc().dead) { S.over = true; banner('Поражение', 'Илва без сознания. «Заново» — повторить бой', 0); hud(); return true; }
  return false;
}
async function enemyTurn(tk) {
  S.busy = true; hud(); await wait(700); const tgt = pc();
  if (!adjacent(tk, tgt)) {
    const { dist, prev } = bfs(tk, 60); let best = null, bd = 1e9;
    for (const [k, dd] of dist) { const x = k % W, y = Math.floor(k / W); if (gap(tk, x, y, tgt) === 0 && dd < bd) { bd = dd; best = k; } }
    if (best == null) { let bg = 1e9; for (const [k, dd] of dist) { if (dd > tk.speed) continue; const gp = gap(tk, k % W, Math.floor(k / W), tgt) * 100 + dd; if (gp < bg) { bg = gp; best = k; } } if (best === tk.y * W + tk.x) best = null; }
    if (best != null) { const steps = pathFrom(prev, best).slice(0, tk.speed); log(`${nm(tk)} идёт на ${steps.length * 5} фт.`); await walk(tk, steps); }
  }
  if (adjacent(tk, tgt)) { await wait(150); await melee(tk, tgt); } else log(`${nm(tk)} не дотягивается до цели.`);
  await wait(550); S.busy = false; if (!checkEnd()) nextTurn();
}
async function pcMove(cx, cy) {
  const me = cur(), k = cy * W + cx; if (!S.reach || !S.reach.dist.has(k)) return;
  const steps = pathFrom(S.reach.prev, k); if (!steps.length) return;
  S.busy = true; me.move -= steps.length; hud(); await walk(me, steps); S.busy = false; hud();
}

// ---------- Панель ----------
const ACTS = [
  { id: 'move', key: 'M', icon: 'move', name: 'Движение', sub: 'Скорость 30 фт', text: 'Щёлкните по подсвеченной клетке. Диагональ тоже 5 фт.' },
  { id: 'fire', key: '1', icon: 'fire', name: 'Огненный шар', sub: '3 круг · Воплощение · 150 фт', text: 'Сфера радиусом 20 фт от точки на пересечении клеток. Спасбросок Ловкости СЛ 15: 8d6 огня, при успехе половина. Задевает и своих.', cost: 1 },
  { id: 'bolt', key: '2', icon: 'bolt', name: 'Молния', sub: '3 круг · Воплощение · линия 100 фт', text: 'Линия 100×5 фт в выбранном направлении, обрывается о стену. Спасбросок Ловкости СЛ 15: 8d6 электричеством, при успехе половина.', cost: 1 },
  { id: 'end', key: '␣', icon: 'end', name: 'Конец хода', sub: 'Пробел', text: 'Передать ход следующему по инициативе.' },
];
function drawCoin(cnv, sp) { const g = cnv.getContext('2d'), s = cnv.width; g.clearRect(0, 0, s, s); g.drawImage(sp, s / 2 - sp.ox * s / sp.ww, s / 2 - sp.oy * s / sp.ww, s, sp.hh * s / sp.ww); }
function buildHud() {
  const acts = $('acts'); acts.innerHTML = '';
  for (const a of ACTS) {
    const b = document.createElement('button'); b.className = 'slot'; b.id = 'act_' + a.id;
    const c = mk(116, 116); ICONS[a.icon](c.getContext('2d'), 116); b.appendChild(c);
    b.insertAdjacentHTML('beforeend', `<kbd>${a.key}</kbd>${a.cost ? '<span class="cost"></span>' : ''}`);
    b.onclick = () => act(a.id);
    b.onmouseenter = () => { const t = $('tip'); t.innerHTML = `<h5>${a.name}</h5><div class="sub">${a.sub}</div><p>${a.text}</p>`; t.style.display = 'block'; const r = b.getBoundingClientRect(); t.style.left = clamp(r.left + r.width / 2 - 135, 8, innerWidth - 278) + 'px'; t.style.top = (r.top - t.offsetHeight - 10) + 'px'; };
    b.onmouseleave = () => $('tip').style.display = 'none';
    acts.appendChild(b);
  }
  drawCoin($('portrait'), pc().sp);
  const ini = $('init'); ini.innerHTML = '<div class="round">Раунд<b id="roundN">1</b></div>';
  for (const tk of toks) { const m = document.createElement('div'); m.className = 'med'; m.id = 'med_' + tk.id; const c = mk(88, 88); drawCoin(c, tk.sp); m.appendChild(c); m.insertAdjacentHTML('beforeend', `<span class="n">${tk.name} · ${tk.init}</span>`); ini.appendChild(m); }
}
function hud() {
  const p = pc(), myTurn = cur() === p && !S.busy && !S.over;
  $('whoName').textContent = p.name; $('whoSub').textContent = `${p.sub} · КД ${p.ac}`;
  $('hpFill').style.width = (p.hp / p.max * 100) + '%'; $('hpText').textContent = `${p.hp} / ${p.max}`;
  $('pipAct').className = 'pip' + (cur() === p && p.action ? '' : ' off');
  $('pipSlots').innerHTML = [0, 1].map(i => `<span class="pip sl${i < S.slots ? '' : ' off'}"></span>`).join('');
  const mv = cur() === p ? p.move : p.speed; $('mvText').textContent = `${mv * 5} фт`; $('mvFill').style.width = (mv / p.speed * 100) + '%';
  $('act_move').disabled = !myTurn || p.move <= 0;
  $('act_fire').disabled = $('act_bolt').disabled = !myTurn || !p.action || S.slots <= 0;
  $('act_end').disabled = !myTurn;
  for (const a of ['move', 'fire', 'bolt']) $('act_' + a).classList.toggle('on', myTurn && S.mode === a);
  $('roundN').textContent = S.round;
  toks.forEach((tk, i) => { const m = $('med_' + tk.id); m.classList.toggle('cur', i === S.turn && !S.over); m.classList.toggle('dead', tk.dead); });
  $('hint').textContent = S.over ? '' : cur() !== p ? 'Ход противника…' : S.busy ? '' :
    S.mode === 'fire' ? 'Выберите точку — центр сферы. Esc — отмена' : S.mode === 'bolt' ? 'Наведите линию и щёлкните. Esc — отмена' :
    'Щелчок — идти · 1 Огненный шар · 2 Молния · Пробел — конец хода · ПКМ — вращать · ЛКМ-перетаскивание — двигать · колесо — масштаб';
  S.reach = myTurn && S.mode === 'move' && p.move > 0 ? bfs(p, p.move) : null;
  refreshReach();
}
function act(id) {
  const p = pc(); if (cur() !== p || S.busy || S.over) return;
  if (id === 'end') { S.mode = 'move'; log(`${nm(p)} заканчивает ход.`); return nextTurn(); }
  if ((id === 'fire' || id === 'bolt') && (!p.action || S.slots <= 0)) return;
  S.mode = S.mode === id ? 'move' : id; hud();
}
window.act = act;

// ---------- Подсветка на полу ----------
const reachMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(.88, .88).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x8cb4ff, transparent: true, opacity: .09, depthWrite: false }), W * H);
reachMesh.renderOrder = 2; reachMesh.count = 0; scene.add(reachMesh);
const dotMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(.05, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf0c76a, transparent: true, opacity: .95, depthWrite: false }), 200);
dotMesh.renderOrder = 3; dotMesh.count = 0; scene.add(dotMesh);
function refreshReach() {
  let n = 0; const p = pc();
  if (S.reach) for (const k of S.reach.dist.keys()) { const x = k % W, y = Math.floor(k / W); if (x === p.x && y === p.y) continue; reachMesh.setMatrixAt(n++, m4.makeTranslation(x + .5, .015, y + .5)); }
  reachMesh.count = n; reachMesh.instanceMatrix.needsUpdate = true;
}
const cursorRing = flatMesh(new THREE.RingGeometry(.36, .44, 40), 0xf0c76a, .9); cursorRing.visible = false; scene.add(cursorRing);
const activeRing = new THREE.Group(); scene.add(activeRing);
for (let i = 0; i < 3; i++) activeRing.add(flatMesh(new THREE.RingGeometry(.92, 1, 32, 1, i * TAU / 3, 1.4), new THREE.Color(2.2, 1.6, .7), .9, true));
const fbDisc = flatMesh(new THREE.CircleGeometry(FB_R, 64), 0xff7a30, .14), fbRing = flatMesh(new THREE.RingGeometry(FB_R - .05, FB_R + .02, 96), new THREE.Color(2.5, 1.2, .4), .9, true);
fbDisc.visible = fbRing.visible = false; scene.add(fbDisc, fbRing);
const boltRect = flatMesh(new THREE.PlaneGeometry(1, 1), 0x7fb4ff, .18); boltRect.visible = false; scene.add(boltRect);
const markRings = toks0Rings();
function toks0Rings() { const a = []; for (let i = 0; i < 3; i++) { const m = flatMesh(new THREE.RingGeometry(.5, .58, 40), 0xff5a3a, .8); m.visible = false; scene.add(m); a.push(m); } return a; }
const lbl = $('lbl');
function showLabel(p, text, col) { const s = toScreen(p); lbl.style.display = 'block'; lbl.style.transform = `translate(${s.x}px,${s.y}px) translate(-50%,-100%)`; lbl.style.color = col; lbl.textContent = text; }
function updateOverlays() {
  const me = cur(), p = pc(), mine = me === p && !S.busy && !S.over;
  lbl.style.display = 'none'; cursorRing.visible = false; dotMesh.count = 0; fbDisc.visible = fbRing.visible = boltRect.visible = false; markRings.forEach(m => m.visible = false);
  activeRing.visible = !S.over && !me.dead; activeRing.position.set(me.wx + me.ox, .03, me.wz + me.oz); activeRing.scale.setScalar(me.s * .55); activeRing.rotation.y = S.t * 1.2;
  if (!mine) return;
  const marks = [];
  if (S.mode === 'move' && S.reach) {
    const hx = Math.floor(S.wx), hy = Math.floor(S.wz), hk = hy * W + hx;
    if (S.reach.dist.has(hk) && !(hx === p.x && hy === p.y)) {
      const steps = pathFrom(S.reach.prev, hk); let lx = p.wx, lz = p.wz, n = 0;
      for (const [x, y] of steps) { for (let f = .25; f <= 1.001; f += .25) dotMesh.setMatrixAt(n++, m4.makeTranslation(lerp(lx, x + .5, f), .02, lerp(lz, y + .5, f))); lx = x + .5; lz = y + .5; }
      dotMesh.count = n; dotMesh.instanceMatrix.needsUpdate = true;
      cursorRing.visible = true; cursorRing.position.set(hx + .5, .025, hy + .5);
      showLabel(new THREE.Vector3(hx + .5, .3, hy + .5), steps.length * 5 + ' фт', '#f0c76a');
    }
  } else if (S.mode === 'fire') {
    const cx = Math.round(S.wx), cz = Math.round(S.wz), ok = losC({ x: p.wx, z: p.wz }, { x: cx, z: cz }) && cx > 0 && cz > 0 && cx < W && cz < H;
    fbDisc.visible = fbRing.visible = true; fbDisc.position.set(cx, .02, cz); fbRing.position.set(cx, .03, cz);
    fbDisc.material.color.set(ok ? 0xff7a30 : 0xd03a30); fbRing.material.color.setRGB(ok ? 2.5 : 2.2, ok ? 1.2 : .3, ok ? .4 : .2);
    if (ok) for (const tk of toks) if (inFireball(tk, cx, cz)) marks.push([tk, tk === p ? 0xffd24a : 0xff5a3a]);
    showLabel(new THREE.Vector3(cx, 1, cz - FB_R), ok ? 'Огненный шар · 20 фт' : 'Нет линии обзора', ok ? '#ffb070' : '#e0665b');
  } else if (S.mode === 'bolt') {
    const L = boltLine(p); boltRect.visible = true; boltRect.scale.set(L.len, 1, 1); boltRect.position.set((L.x1 + L.x2) / 2, .02, (L.z1 + L.z2) / 2);
    boltRect.rotation.set(-Math.PI / 2, 0, -Math.atan2(L.z2 - L.z1, L.x2 - L.x1));
    for (const tk of toks) if (inBolt(tk, L, p)) marks.push([tk, 0x7fb4ff]);
    showLabel(new THREE.Vector3(L.x2, .5, L.z2), Math.round(L.len * 5) + ' фт', '#a9d0ff');
  }
  marks.forEach(([tk, col], i) => { const m = markRings[i]; m.visible = true; m.material.color.set(col); m.material.opacity = .6 + .4 * Math.sin(S.t * 8); m.position.set(tk.wx, .03, tk.wz); m.scale.setScalar(tk.s * 1.05); });
}

// ---------- Ввод ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
function pick3(e) { ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); if (ray.ray.intersectPlane(ground, hitP)) { S.wx = hitP.x; S.wz = hitP.z; } }
let down = null;
const el = renderer.domElement;
el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
el.addEventListener('pointermove', e => {
  pick3(e); const hx = Math.floor(S.wx), hz = Math.floor(S.wz);
  S.hoverTok = toks.find(t => !t.dead && hx >= t.x && hx < t.x + t.s && hz >= t.y && hz < t.y + t.s) || null;
});
el.addEventListener('pointerup', e => { if (down && down.b === 0 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) { pick3(e); click(); } down = null; });
el.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('resize', resize);
addEventListener('keydown', e => {
  if (e.key === '1') act('fire'); else if (e.key === '2') act('bolt'); else if (e.key === 'm' || e.key === 'ь') act('move');
  else if (e.key === 'Escape') { S.mode = 'move'; hud(); } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); act('end'); }
  else if (e.key === 'f' || e.key === 'а') homeView();
});
function click() {
  const me = cur(); if (S.busy || S.over || me !== pc()) return;
  if (S.mode === 'fire') { const cx = Math.round(S.wx), cz = Math.round(S.wz); if (!losC({ x: me.wx, z: me.wz }, { x: cx, z: cz }) || cx <= 0 || cz <= 0 || cx >= W || cz >= H) return; castFireball(cx, cz); }
  else if (S.mode === 'bolt') castBolt();
  else pcMove(Math.floor(S.wx), Math.floor(S.wz));
}
window.click3 = (x, z) => { S.wx = x; S.wz = z; click(); };
$('resetBtn').onclick = reset; $('viewBtn').onclick = homeView; $('logBtn').onclick = () => $('log').classList.toggle('show');

// ---------- Кадр ----------
const clock = new THREE.Clock();
function update(dt) {
  S.t += dt;
  for (const tk of toks) {
    if (tk.anim) { const a = tk.anim; a.t += dt; const f = Math.min(1, a.t / a.dur); tk.wx = lerp(a.fx, a.tx, f); tk.wz = lerp(a.fz, a.tz, f); tk.hop = Math.sin(Math.PI * f) * .12; if (f >= 1) { tk.anim = null; tk.hop = 0; a.res(); } }
    tk.hit = Math.max(0, tk.hit - dt); tk.flash = Math.max(0, tk.flash - dt);
    let dy = tk.yawT - tk.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); tk.yaw += dy * Math.min(1, dt * 10);
    const sh = tk.hit > 0 ? Math.sin(S.t * 70) * .05 * tk.hit / .4 : 0;
    tk.root.position.set(tk.wx + tk.ox + sh, 0, tk.wz + tk.oz);
    tk.figure.position.y = tk.hop; tk.figure.rotation.y = tk.yaw;
    if (!tk.dead) { const br = 1 + .015 * Math.sin(S.t * 2.2 + tk.init); tk.figure.scale.set(1, br, 1); }
    if (tk.dead && tk.dieT < 1) tk.dieT = Math.min(1, tk.dieT + dt / .9);
    if (tk.dead) { const f = ease(tk.dieT); tk.figure.rotation.x = -f * Math.PI / 2 * .92; tk.figure.position.y = -f * .02; tk.figure.scale.set(1, 1, 1); }
    for (const m of tk.mats) m.emissive.setRGB(tk.flash * 2.5, tk.flash * .6, tk.flash * .4);
    if (tk === pc()) { const gem = tk.body.userData.gem; if (gem) { gem.getWorldPosition(staffLight.position); gem.rotation.y += dt * 2; } else staffLight.position.set(tk.wx + .25, 1.25, tk.wz); staffLight.intensity = tk.dead ? 0 : 1.8 * (1 + .1 * n1(S.t * 3)); }
  }
  for (const f of flames) {
    const k = 1 + .14 * n1(S.t * 9 + f.seed); f.L.intensity = f.base * k;
    const ss = f.sc > 1 ? 1.1 : 1; f.spr.outer.scale.setScalar(.9 * ss * (1 + .1 * n1(S.t * 11 + f.seed))); f.spr.inner.scale.setScalar(.32 * ss * k);
    if (Math.random() < dt * 40 * f.sc) FX3.emit({ x: f.x + rnd(-.04, .04) * f.sc, y: f.y, z: f.z + rnd(-.04, .04) * f.sc, vx: rnd(-.1, .1), vy: rnd(.6, 1.1), vz: rnd(-.1, .1), life: rnd(.25, .45), size: rnd(.12, .2) * f.sc, grow: -.25 * f.sc, a: .8, c: pick(FIRE) });
    if (Math.random() < dt * 3 * f.sc) FX3.emit({ x: f.x, y: f.y + .2, z: f.z, vx: rnd(-.2, .2), vy: rnd(.8, 1.5), vz: rnd(-.2, .2), drag: .99, life: rnd(1.2, 2.2), size: rnd(.03, .05), c: [1, .55, .2] });
  }
  rippleTex.offset.set(S.t * .02, S.t * .035);
  runFx(dt); FX3.update(dt); SMOKE.update(dt);
}
function frame() {
  const dt = S.pause ? 0 : Math.min(.05, clock.getDelta());
  update(dt);
  controls.target.x = clamp(controls.target.x, 0, W); controls.target.z = clamp(controls.target.z, 0, H); controls.update();
  const shx = (Math.random() - .5) * S.shake, shy = (Math.random() - .5) * S.shake; S.shake *= Math.pow(.02, Math.max(dt, 1e-4));
  camera.position.x += shx; camera.position.y += shy;
  updateOverlays(); composer.render(); updateUI(dt);
  camera.position.x -= shx; camera.position.y -= shy;
}
window.step3 = (n, dt) => { for (let i = 0; i < n; i++) update(dt || 1 / 60); controls.update(); updateOverlays(); composer.render(); updateUI(0); };
window.dbg = { toks: () => toks, explosion, boltFx, camera, controls, homeView, cur, pc };

// ---------- Старт ----------
function reset() {
  for (const tk of toks) { scene.remove(tk.root); tk.plate.remove(); }
  for (const f of FT) f.el.remove(); FT.length = 0;
  FX.length = 0; FX3.ps.length = 0; SMOKE.ps.length = 0; while (dynLights.length) dropLight(dynLights[0]);
  buildFloor(); floorTex.needsUpdate = true; modelsLoaded = 0; $('modelState').textContent = 'Модели: заглушки';
  toks = TOK0.map(makeTok);
  Object.assign(S, { round: 1, turn: 0, mode: 'move', busy: false, over: false, slots: 2, shake: 0 });
  $('logBody').innerHTML = ''; $('banner').style.opacity = 0;
  buildHud();
  log('<span class="m">Склеп под старой часовней. У жаровни — скелет и огр. Инициатива: Илва 18, Скелет 14, Огр 9.</span>');
  startTurn();
}
resize(); homeView(); reset();
renderer.setAnimationLoop(frame);
$('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 600);
