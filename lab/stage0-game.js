'use strict';
// ===== Этап 0: бой, эффекты, кадр, панель хода =====
const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
let VW = 0, VH = 0, DPR = 1;
const cam = { x: 0, y: 0, z: 1, user: false };
const S = { round: 1, turn: 0, mode: 'move', busy: false, over: false, slots: 2, flat: false, shake: 0, flash: null, wx: -1e4, wy: -1e4, reach: null, t: 0 };
const AMB = [34, 34, 50];

// ---------- Существа ----------
const TOK0 = [
  { id: 'ilva', name: 'Илва', sub: 'Волшебница 5 ур.', kind: 'wizard', side: 'pc', x: 2, y: 4, s: 1, max: 27, ac: 15, speed: 6, dex: 2, init: 18 },
  { id: 'skel', name: 'Скелет', sub: 'Нежить', kind: 'skull', side: 'foe', x: 12, y: 3, s: 1, max: 13, ac: 14, speed: 6, dex: 3, init: 14, atk: { name: 'Короткий меч', bonus: 5, n: 1, d: 6, mod: 3, type: 'колющего' } },
  { id: 'ogre', name: 'Огр', sub: 'Великан, Большой', kind: 'ogre', side: 'foe', x: 12, y: 7, s: 2, max: 68, ac: 11, speed: 8, dex: -1, init: 9, atk: { name: 'Дубина', bonus: 6, n: 2, d: 8, mod: 4, type: 'дробящего' } },
];
let toks = [];
const pc = () => toks[0];
const cur = () => toks[S.turn];
function center(tk) { const h = tk.s * CELL / 2; return { x: tk.px + h + tk.ox, y: tk.py + h + tk.oy }; }
function initToks() {
  toks = TOK0.map(o => Object.assign({}, o, { hp: o.max, px: o.x * CELL, py: o.y * CELL, ox: 0, oy: 0, hop: 0, hit: 0, flash: 0, dead: false, dieT: 1, action: 0, move: 0, anim: null }));
  for (const tk of toks) { const R = tk.s * CELL * .42; tk.sp = makeSprite(tk.kind, tk.side, R); tk.spD = makeSprite(tk.kind, tk.side, R, true); }
}

// ---------- Свет ----------
const lights = [];
for (const [x, y] of cells('T')) lights.push({ x: (x + .5) * CELL, y: (y + 1) * CELL + 6, r: 6.2 * CELL, c: [255, 147, 64], i: 1, fl: 1, seed: x * 3.1, flame: { x: (x + .5) * CELL, y: (y + 1) * CELL - WH * .62, sc: 1 } });
for (const [x, y] of cells('B')) lights.push({ x: (x + .5) * CELL, y: (y + .5) * CELL - 8, r: 7.2 * CELL, c: [255, 128, 48], i: 1.15, fl: 1, seed: 9, flame: { x: (x + .5) * CELL, y: (y + .5) * CELL - 8, sc: 1.7 } });
for (const [x, y] of cells('C')) lights.push({ x: (x + .5) * CELL, y: (y + .5) * CELL - 14, r: 1.6 * CELL, c: [255, 200, 90], i: .35, fl: .3, seed: 2 });
for (const L of lights) L.poly = visPoly(L.x, L.y, L.r * 1.05);
const staff = { r: 3.4 * CELL, c: [110, 160, 255], i: .55, fl: .15, seed: 5 };
const dynLights = [];
const lcv = mk(W * CELL * LS, (H + 1.5) * CELL * LS), lg = lcv.getContext('2d'), LY0 = -1.5 * CELL;
function lightPass(t) {
  lg.setTransform(1, 0, 0, 1, 0, 0); lg.globalCompositeOperation = 'source-over';
  lg.fillStyle = `rgb(${AMB})`; lg.fillRect(0, 0, lcv.width, lcv.height);
  lg.setTransform(LS, 0, 0, LS, 0, -LY0 * LS); lg.globalCompositeOperation = 'lighter';
  const p = pc(), pcC = center(p);
  if (!p.dead) { staff.x = pcC.x + 10; staff.y = pcC.y - 10; if (staff.kx !== staff.x || staff.ky !== staff.y) { staff.poly = visPoly(staff.x, staff.y, staff.r); staff.kx = staff.x; staff.ky = staff.y; } }
  const all = lights.concat(p.dead ? [] : [staff], dynLights);
  for (const L of all) {
    if (L.i <= 0.01) continue;
    const k = L.fl ? 1 + L.fl * .13 * n1(t * 9 + L.seed) : 1, I = L.i * k, r = L.r * (L.fl ? 1 + .03 * n1(t * 6 + L.seed * 2) : 1);
    const pts = L.poly || visPoly(L.x, L.y, L.r);
    lg.save(); lg.beginPath(); lg.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) lg.lineTo(pts[i], pts[i + 1]); lg.closePath(); lg.clip();
    for (let pass = I; pass > 0; pass -= 1) {
      const a = Math.min(1, pass), gr = lg.createRadialGradient(L.x, L.y, 0, L.x, L.y, r), c = L.c.join(',');
      gr.addColorStop(0, `rgba(${c},${a})`); gr.addColorStop(.25, `rgba(${c},${a * .6})`); gr.addColorStop(.6, `rgba(${c},${a * .22})`); gr.addColorStop(1, `rgba(${c},0)`);
      lg.fillStyle = gr; lg.fillRect(L.x - r, L.y - r, r * 2, r * 2);
    }
    lg.restore();
  }
}

// ---------- Частицы и эффекты ----------
const P = [], FX = [], FT = [];
function emit(o) { if (P.length < 1800) P.push(Object.assign({ t: 0, life: 1, vx: 0, vy: 0, ax: 0, ay: 0, drag: 1, size: 4, grow: 0, a: 1, col: '255,170,80', mode: 'add' }, o)); }
function addFx(o) { return new Promise(res => { o.t = 0; o.done = res; FX.push(o); }); }
function floatText(x, y, text, col, size) { FT.push({ x, y, text, col, size: size || 22, t: 0, life: 1.4 }); }
const decalCv = mk(W * CELL * RS, H * CELL * RS), dg = decalCv.getContext('2d'); dg.setTransform(RS, 0, 0, RS, 0, 0);
function scorch(x, y, r, a) {
  for (let i = 0; i < 9; i++) {
    const cx = x + rnd(-r, r) * .4, cy = y + rnd(-r, r) * .4, rr = r * rnd(.35, .7), gr = dg.createRadialGradient(cx, cy, 0, cx, cy, rr);
    gr.addColorStop(0, `rgba(12,6,3,${a})`); gr.addColorStop(1, 'rgba(12,6,3,0)'); dg.fillStyle = gr; dg.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
  }
}
const FIRE = ['255,180,80', '255,120,40', '255,220,140', '255,90,30'];
function updateParticles(dt) {
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.t += dt; if (p.t >= p.life) { P.splice(i, 1); continue; }
    const k = Math.pow(p.drag, dt * 60); p.vx = p.vx * k + p.ax * dt; p.vy = p.vy * k + p.ay * dt; p.x += p.vx * dt; p.y += p.vy * dt;
  }
}
function drawParticles(g, mode) {
  for (const p of P) {
    if (p.mode !== mode) continue;
    const f = p.t / p.life, a = p.a * Math.min(1, f * 6) * (1 - f), s = p.size + p.grow * p.t;
    if (mode === 'add') glow(g, p.x, p.y, s, p.col, a);
    else if (mode === 'smoke') { g.globalAlpha = a; g.drawImage(smokeSprite(p.col), p.x - s, p.y - s, s * 2, s * 2); g.globalAlpha = 1; }
    else { g.globalAlpha = a; g.fillStyle = `rgb(${p.col})`; g.fillRect(p.x - s / 2, p.y - s / 2, s, s); g.globalAlpha = 1; }
  }
}
function runFx(dt) { for (let i = FX.length - 1; i >= 0; i--) { const f = FX[i]; f.t += dt; if (f.update && f.update(dt) === false || (f.dur && f.t >= f.dur)) { FX.splice(i, 1); f.end && f.end(); f.done(); } } }
function drawFx(g, pass) { for (const f of FX) if (f.draw) f.draw(g, pass); }

function magicCircle(g, x, y, r, col, a, t) {
  g.globalAlpha = a; g.strokeStyle = `rgb(${col})`; g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); g.lineWidth = 1; g.beginPath(); g.arc(x, y, r * .8, 0, TAU); g.stroke();
  for (let i = 0; i < 12; i++) { const an = t * 1.2 + i * TAU / 12; g.beginPath(); g.moveTo(x + Math.cos(an) * r * .8, y + Math.sin(an) * r * .8); g.lineTo(x + Math.cos(an + .2) * r, y + Math.sin(an + .2) * r); g.stroke(); }
  g.beginPath(); for (let i = 0; i <= 6; i++) { const an = -t * .8 + i * TAU * 2 / 6; i ? g.lineTo(x + Math.cos(an) * r * .78, y + Math.sin(an) * r * .78) : g.moveTo(x + Math.cos(an) * r * .78, y + Math.sin(an) * r * .78); } g.stroke();
  g.globalAlpha = 1; glow(g, x, y, r * 1.2, col, a * .25);
}
function charge(tk, col, ms) {
  const R = tk.s * CELL * .5;
  return addFx({ dur: ms / 1000, update() { const c = center(tk); for (let k = 0; k < 3; k++) { const an = rnd(0, TAU), r = CELL * rnd(.9, 1.5); emit({ x: c.x + Math.cos(an) * r, y: c.y + Math.sin(an) * r, vx: -Math.cos(an) * r * 2.3, vy: -Math.sin(an) * r * 2.3, life: .42, size: rnd(3, 6), col }); } },
    draw(g, pass) { if (pass !== 'glow') return; const c = center(tk), k = Math.min(1, this.t / this.dur); magicCircle(g, c.x, c.y, R * 1.7, col, k, S.t); glow(g, c.x + 10, c.y - 10, 20 + 30 * k, col, .5 + .5 * k); } });
}
function projectile(x1, y1, x2, y2) {
  const L = { x: x1, y: y1, r: 3.6 * CELL, c: [255, 140, 60], i: 1.2, fl: .3, seed: 3 }; dynLights.push(L);
  const dur = clamp(Math.hypot(x2 - x1, y2 - y1) / (CELL * 13), .25, .7);
  return addFx({ dur, update() { const f = ease(Math.min(1, this.t / dur)); this.x = lerp(x1, x2, f); this.y = lerp(y1, y2, f) - Math.sin(Math.PI * f) * CELL * 1.2; L.x = this.x; L.y = this.y;
      for (let k = 0; k < 5; k++) emit({ x: this.x + rnd(-4, 4), y: this.y + rnd(-4, 4), vx: rnd(-30, 30), vy: rnd(-40, 10), life: rnd(.25, .5), size: rnd(6, 11), col: pick(FIRE) });
      if (Math.random() < .5) emit({ mode: 'smoke', x: this.x, y: this.y, vx: rnd(-10, 10), vy: rnd(-20, 0), life: 1, size: 8, grow: 18, col: '80,70,62', a: .3 }); },
    draw(g, pass) { if (pass === 'glow' && this.x != null) { glow(g, this.x, this.y, 46, '255,120,40', .9); glow(g, this.x, this.y, 16, '255,245,200', 1); } },
    end() { dynLights.splice(dynLights.indexOf(L), 1); } });
}
function explosion(x, y, R) {
  S.shake = 16; S.flash = { c: '255,170,90', a: .35 };
  const L = { x, y: y - 10, r: R * 1.9, c: [255, 120, 40], i: 1.5, seed: 1 }; dynLights.push(L);
  addFx({ dur: 1.2, update() { L.i = 1.5 * Math.pow(1 - this.t / 1.2, 2); }, end() { dynLights.splice(dynLights.indexOf(L), 1); } });
  addFx({ dur: .5, draw(g, pass) { if (pass !== 'glow') return; const f = this.t / .5; g.globalAlpha = 1 - f; g.strokeStyle = 'rgb(255,170,80)'; g.lineWidth = 12 * (1 - f) + 1; g.beginPath(); g.arc(x, y, R * 1.15 * ease(f), 0, TAU); g.stroke(); g.globalAlpha = 1; glow(g, x, y, R * (.6 + .5 * f), '255,160,80', .8 * (1 - f)); } });
  for (let i = 0; i < 160; i++) { const an = rnd(0, TAU), sp = Math.sqrt(Math.random()) * R * 2.6; emit({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, drag: .9, life: rnd(.45, .95), size: rnd(10, 22), grow: 18, a: .5, col: pick(['255,150,60', '255,100,30', '255,190,90', '230,70,20']) }); }
  for (let i = 0; i < 70; i++) { const an = rnd(0, TAU), sp = rnd(.5, 1.4) * R * 3; emit({ x, y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, drag: .95, ay: 60, life: rnd(.6, 1.3), size: rnd(2, 3.5), col: '255,220,150' }); }
  for (let i = 0; i < 46; i++) { const an = rnd(0, TAU), sp = rnd(.2, .9) * R * 1.4; emit({ mode: 'smoke', x: x + Math.cos(an) * R * .3, y: y + Math.sin(an) * R * .3, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 20, drag: .95, life: rnd(1.4, 2.6), size: rnd(18, 30), grow: 26, col: '82,74,66', a: .4 }); }
  scorch(x, y, R * .85, .75);
  const embers = Array.from({ length: 26 }, () => { const an = rnd(0, TAU), r = Math.sqrt(Math.random()) * R * .9; return [x + Math.cos(an) * r, y + Math.sin(an) * r, rnd(0, 9)]; });
  addFx({ dur: 4, draw(g, pass) { if (pass !== 'glow') return; const k = 1 - this.t / 4; for (const [ex, ey, s] of embers) glow(g, ex, ey, 7, '255,110,30', k * (.5 + .5 * Math.sin(S.t * 6 + s))); } });
}
function jag(x1, y1, x2, y2, disp, it) {
  let pts = [[x1, y1], [x2, y2]];
  for (let i = 0; i < it; i++) { const np = [pts[0]]; for (let j = 1; j < pts.length; j++) { const [ax, ay] = pts[j - 1], [bx, by] = pts[j], nx = ay - by, ny = bx - ax, l = Math.hypot(nx, ny) || 1, o = rnd(-1, 1) * disp; np.push([(ax + bx) / 2 + nx / l * o, (ay + by) / 2 + ny / l * o], [bx, by]); } pts = np; disp *= .55; }
  return pts;
}
function boltFx(x1, y1, x2, y2) {
  S.shake = 9; S.flash = { c: '170,200,255', a: .45 };
  const Ls = [.15, .5, .85].map(f => ({ x: lerp(x1, x2, f), y: lerp(y1, y2, f), r: 4.5 * CELL, c: [140, 180, 255], i: 1.6, fl: 1, seed: f * 10 }));
  dynLights.push(...Ls);
  let paths = [], next = 0;
  const regen = () => { paths = [jag(x1, y1, x2, y2, 30, 6)]; for (let b = 0; b < 4; b++) { const m = paths[0][Math.floor(rnd(.15, .85) * paths[0].length)], an = Math.atan2(y2 - y1, x2 - x1) + rnd(-.9, .9), l = rnd(50, 140); paths.push(jag(m[0], m[1], m[0] + Math.cos(an) * l, m[1] + Math.sin(an) * l, 14, 4)); } };
  for (let i = 0; i < 40; i++) { const f = Math.random(); emit({ x: lerp(x1, x2, f), y: lerp(y1, y2, f), vx: rnd(-160, 160), vy: rnd(-160, 160), drag: .92, life: rnd(.3, .8), size: rnd(2, 3.5), col: '190,220,255' }); }
  for (let i = 0; i < 30; i++) emit({ x: x2, y: y2, vx: rnd(-220, 220), vy: rnd(-220, 220), drag: .9, life: rnd(.3, .7), size: rnd(2, 4), col: '220,235,255' });
  dg.strokeStyle = 'rgba(10,8,12,.45)'; dg.lineWidth = 5; dg.beginPath(); jag(x1, y1, x2, y2, 10, 5).forEach((p, i) => i ? dg.lineTo(p[0], p[1]) : dg.moveTo(p[0], p[1])); dg.stroke();
  return addFx({ dur: .6, update() { if (this.t >= next) { regen(); next = this.t + .06; } const k = 1 - this.t / .6; for (const L of Ls) L.i = 1.6 * k; },
    draw(g, pass) { if (pass !== 'glow') return; const k = 1 - this.t / .6; g.lineJoin = 'round'; g.lineCap = 'round';
      for (const [w, col, a] of [[16, '110,160,255', .22], [7, '160,200,255', .6], [2.4, '255,255,255', 1]]) { g.strokeStyle = `rgba(${col},${a * k})`; for (const p of paths) { g.lineWidth = w * (p === paths[0] ? 1 : .55); g.beginPath(); p.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.stroke(); } }
      glow(g, x1, y1, 50, '150,190,255', k); glow(g, x2, y2, 60, '150,190,255', k); },
    end() { for (const L of Ls) dynLights.splice(dynLights.indexOf(L), 1); } });
}
function slash(att, tgt, heavy) {
  const a = center(att), b = center(tgt), an = Math.atan2(b.y - a.y, b.x - a.x), R = tgt.s * CELL * .62;
  const dur = heavy ? .3 : .22;
  return addFx({ dur, draw(g, pass) { if (pass !== 'glow') return; const f = this.t / dur, c = center(tgt), a0 = an - 1.3, a1 = a0 + 2.6 * ease(f);
      for (let i = 0; i < 6; i++) { g.strokeStyle = `rgba(${heavy ? '255,210,160' : '235,240,255'},${(1 - f) * (1 - i / 6) * .9})`; g.lineWidth = (heavy ? 10 : 6) * (1 - i / 6); g.beginPath(); g.arc(c.x - Math.cos(an) * 8, c.y - Math.sin(an) * 8, R + i * 2, Math.max(a0, a1 - .9), a1); g.stroke(); } } });
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
  const dist = new Map(), prev = new Map(), k0 = tk.y * W + tk.x, q = [[tk.x, tk.y]]; dist.set(k0, 0);
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
function gap(a, ax, ay, b) { const gx = Math.max(0, b.x - (ax + a.s), ax - (b.x + b.s)), gy = Math.max(0, b.y - (ay + a.s), ay - (b.y + b.s)); return Math.max(gx, gy); }
const adjacent = (a, b) => gap(a, a.x, a.y, b) === 0;
function walk(tk, steps) {
  let p = Promise.resolve();
  for (const [x, y] of steps) p = p.then(() => new Promise(res => { tk.anim = { fx: tk.px, fy: tk.py, tx: x * CELL, ty: y * CELL, t: 0, dur: .17, res }; tk.x = x; tk.y = y; }));
  return p;
}
function occCenters(tk) { const o = []; for (let dy = 0; dy < tk.s; dy++) for (let dx = 0; dx < tk.s; dx++) o.push({ x: (tk.x + dx + .5) * CELL, y: (tk.y + dy + .5) * CELL }); return o; }
const FB_R = 4 * CELL;
function inFireball(tk, px, py) { return !tk.dead && occCenters(tk).some(c => Math.hypot(c.x - px, c.y - py) <= FB_R + 1 && los({ x: px, y: py }, c)); }
function boltLine(me) {
  const a = center(me); let dx = S.wx - a.x, dy = S.wy - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
  const T = rayT(a.x, a.y, dx, dy, 20 * CELL); return { x1: a.x, y1: a.y, x2: a.x + dx * T, y2: a.y + dy * T };
}
function segDist(px, py, L) { const vx = L.x2 - L.x1, vy = L.y2 - L.y1, t = clamp(((px - L.x1) * vx + (py - L.y1) * vy) / (vx * vx + vy * vy || 1), 0, 1); return Math.hypot(px - L.x1 - vx * t, py - L.y1 - vy * t); }
function inBolt(tk, L, me) { return tk !== me && !tk.dead && occCenters(tk).some(c => segDist(c.x, c.y, L) <= CELL * .55); }
function snapCorner(x, y) { return { x: Math.round(x / CELL) * CELL, y: Math.round(y / CELL) * CELL }; }

// ---------- Журнал, баннер ----------
function log(html) { const p = document.createElement('p'); p.innerHTML = html; $('logBody').appendChild(p); $('log').scrollTop = 1e9; }
let bannerT = 0;
function banner(text, sub, ms) { const b = $('banner'); b.innerHTML = text + (sub ? `<small>${sub}</small>` : ''); b.style.opacity = 1; clearTimeout(bannerT); if (ms !== 0) bannerT = setTimeout(() => b.style.opacity = 0, ms || 1300); }
const nm = tk => `<span class="${tk.side === 'pc' ? 'c' : 'r'}">${tk.name}</span>`;

function damage(tk, n, type) {
  tk.hp = Math.max(0, tk.hp - n); tk.hit = .4; tk.flash = .25;
  const c = center(tk), col = type === 'fire' ? '#ffa24a' : type === 'bolt' ? '#a9d0ff' : '#ff6b5b';
  floatText(c.x, c.y - tk.s * CELL * .45, '−' + n, col, n >= 20 ? 30 : 24);
  if (type === 'melee') for (let i = 0; i < 14; i++) emit({ mode: 'debris', x: c.x, y: c.y, vx: rnd(-120, 120), vy: rnd(-120, 120), drag: .88, life: rnd(.4, .8), size: rnd(2, 4), col: tk.kind === 'skull' ? '210,200,180' : '120,20,15' });
  if (tk.hp === 0) kill(tk);
  hud();
}
function kill(tk) {
  tk.dead = true; tk.dieT = 0; const c = center(tk);
  log(tk.side === 'pc' ? `${nm(tk)} теряет сознание.` : `${nm(tk)} повержен.`);
  for (let i = 0; i < 30; i++) emit({ mode: 'smoke', x: c.x + rnd(-10, 10), y: c.y + rnd(-10, 10), vx: rnd(-40, 40), vy: rnd(-50, 10), drag: .95, life: rnd(1, 2), size: rnd(10, 18), grow: 14, col: tk.kind === 'skull' ? '120,115,105' : '50,45,38', a: .45 });
  if (tk.kind === 'skull') for (let i = 0; i < 22; i++) emit({ mode: 'debris', x: c.x, y: c.y, vx: rnd(-150, 150), vy: rnd(-150, 150), drag: .86, life: rnd(.6, 1.2), size: rnd(2, 5), col: '215,205,185' });
  scorch(c.x, c.y + 6, tk.s * CELL * .5, .25);
}
function save(tk, dc, label) { const r = d(20), tot = r + tk.dex, ok = tot >= dc; return { ok, txt: `спасбросок Ловкости ${r}${tk.dex >= 0 ? '+' : '−'}${Math.abs(tk.dex)} = ${tot} — <span class="${ok ? 'g' : 'r'}">${ok ? 'успех' : 'провал'}</span>` }; }

// ---------- Заклинания ----------
async function castFireball(px, py) {
  const me = cur(); S.busy = true; me.action = 0; S.slots--; S.mode = 'move'; hud();
  log(`${nm(me)} читает <span class="f">Огненный шар</span>.`);
  const c = center(me);
  await charge(me, '255,140,50', 450);
  await projectile(c.x + 10, c.y - 12, px, py);
  explosion(px, py, FB_R);
  const hit = toks.filter(tk => inFireball(tk, px, py));
  const dmg = roll(8, 6);
  log(`8d6 [${dmg.r.join(', ')}] = <b class="f">${dmg.sum}</b> урона огнём.`);
  if (!hit.length) log('<span class="m">Никто не задет.</span>');
  await new Promise(r => setTimeout(r, 160));
  for (const tk of hit) { const s = save(tk, 15); const n = s.ok ? Math.floor(dmg.sum / 2) : dmg.sum; log(`${nm(tk)}: ${s.txt}, получает ${n}.`); damage(tk, n, 'fire'); if (s.ok) { const cc = center(tk); floatText(cc.x, cc.y + 20, 'спасся', '#cfc3b0', 14); } }
  await new Promise(r => setTimeout(r, 900)); S.busy = false; afterAction();
}
async function castBolt() {
  const me = cur(), L = boltLine(me); S.busy = true; me.action = 0; S.slots--; S.mode = 'move'; hud();
  log(`${nm(me)} читает <span class="l">Молнию</span>.`);
  await charge(me, '140,190,255', 420);
  const hit = toks.filter(tk => inBolt(tk, L, me));
  const fx = boltFx(L.x1 + 10, L.y1 - 10, L.x2, L.y2);
  const dmg = roll(8, 6);
  log(`8d6 [${dmg.r.join(', ')}] = <b class="l">${dmg.sum}</b> урона электричеством.`);
  if (!hit.length) log('<span class="m">Никто не задет.</span>');
  for (const tk of hit) { const s = save(tk, 15); const n = s.ok ? Math.floor(dmg.sum / 2) : dmg.sum; log(`${nm(tk)}: ${s.txt}, получает ${n}.`); damage(tk, n, 'bolt'); }
  await fx; await new Promise(r => setTimeout(r, 700)); S.busy = false; afterAction();
}
async function melee(att, tgt) {
  const A = att.atk, a = center(att), b = center(tgt), an = Math.atan2(b.y - a.y, b.x - a.x);
  await addFx({ dur: .32, update() { const f = this.t / .32, k = Math.sin(Math.PI * f) * 14; att.ox = Math.cos(an) * k; att.oy = Math.sin(an) * k; }, end() { att.ox = att.oy = 0; } }).catch(() => {});
  const r = d(20), tot = r + A.bonus, crit = r === 20, hitOk = crit || (r !== 1 && tot >= tgt.ac);
  const sl = slash(att, tgt, att.kind === 'ogre');
  if (hitOk) {
    const dm = roll(A.n * (crit ? 2 : 1), A.d), n = dm.sum + A.mod;
    log(`${nm(att)} — ${A.name}: ${r}+${A.bonus} = ${tot} против КД ${tgt.ac}${crit ? ' <b class="f">крит!</b>' : ''} — попадание, ${n} ${A.type}.`);
    if (att.kind === 'ogre') S.shake = 10;
    damage(tgt, n, 'melee');
  } else {
    log(`${nm(att)} — ${A.name}: ${r}+${A.bonus} = ${tot} против КД ${tgt.ac} — <span class="m">промах</span>.`);
    floatText(b.x, b.y - tgt.s * CELL * .45, 'промах', '#bdb3a2', 16);
  }
  await sl;
}

// ---------- Ходы ----------
function startTurn() {
  if (checkEnd()) return;
  const tk = cur(); if (tk.dead) return nextTurn();
  tk.action = 1; tk.move = tk.speed;
  if (tk.side === 'pc') { S.mode = 'move'; banner('Ваш ход', `Раунд ${S.round}`); }
  else banner(`Ход: ${tk.name}`);
  hud();
  if (tk.side === 'foe') enemyTurn(tk);
}
function nextTurn() { if (checkEnd()) return; S.turn = (S.turn + 1) % toks.length; if (S.turn === 0) S.round++; startTurn(); }
function afterAction() { hud(); checkEnd(); }
function checkEnd() {
  if (S.over) return true;
  if (toks.filter(t => t.side === 'foe').every(t => t.dead)) { S.over = true; banner('Победа', 'Нажмите «Заново», чтобы повторить бой', 0); hud(); return true; }
  if (pc().dead) { S.over = true; banner('Поражение', 'Илва без сознания. «Заново» — повторить бой', 0); hud(); return true; }
  return false;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function enemyTurn(tk) {
  S.busy = true; hud(); await wait(700);
  const tgt = pc();
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
function buildHud() {
  const acts = $('acts'); acts.innerHTML = '';
  for (const a of ACTS) {
    const b = document.createElement('button'); b.className = 'slot'; b.id = 'act_' + a.id;
    const c = mk(116, 116), g = c.getContext('2d'); ICONS[a.icon](g, 116); b.appendChild(c);
    b.insertAdjacentHTML('beforeend', `<kbd>${a.key}</kbd>${a.cost ? '<span class="cost"></span>' : ''}`);
    b.onclick = () => act(a.id);
    b.onmouseenter = () => { const t = $('tip'); t.innerHTML = `<h5>${a.name}</h5><div class="sub">${a.sub}</div><p>${a.text}</p>`; t.style.display = 'block'; const r = b.getBoundingClientRect(); t.style.left = clamp(r.left + r.width / 2 - 135, 8, innerWidth - 278) + 'px'; t.style.top = (r.top - t.offsetHeight - 10) + 'px'; };
    b.onmouseleave = () => $('tip').style.display = 'none';
    acts.appendChild(b);
  }
  const pg = $('portrait').getContext('2d'); pg.clearRect(0, 0, 128, 128); const sp = pc().sp; pg.drawImage(sp, 64 - sp.ox * 128 / sp.ww, 64 - sp.oy * 128 / sp.ww, 128, sp.hh * 128 / sp.ww);
  const ini = $('init'); ini.innerHTML = '<div class="round">Раунд<b id="roundN">1</b></div>';
  for (const tk of toks) {
    const m = document.createElement('div'); m.className = 'med'; m.id = 'med_' + tk.id;
    const c = mk(88, 88); c.getContext('2d').drawImage(tk.sp, 44 - tk.sp.ox * 88 / tk.sp.ww, 44 - tk.sp.oy * 88 / tk.sp.ww, 88, tk.sp.hh * 88 / tk.sp.ww);
    m.appendChild(c); m.insertAdjacentHTML('beforeend', `<span class="n">${tk.name} · ${tk.init}</span>`); ini.appendChild(m);
  }
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
    'Щёлкните клетку, чтобы идти · 1 Огненный шар · 2 Молния · Пробел — конец хода · колесо — масштаб';
  S.reach = myTurn && S.mode === 'move' && p.move > 0 ? bfs(p, p.move) : null;
}
function act(id) {
  const p = pc(); if (cur() !== p || S.busy || S.over) return;
  if (id === 'end') { S.mode = 'move'; log(`${nm(p)} заканчивает ход.`); return nextTurn(); }
  if ((id === 'fire' || id === 'bolt') && (!p.action || S.slots <= 0)) return;
  S.mode = S.mode === id ? 'move' : id; hud();
}

// ---------- Ввод и камера ----------
function toWorld(sx, sy) { return { x: (sx - VW / 2) / cam.z + cam.x, y: (sy - VH / 2) / cam.z + cam.y }; }
function fitCam() {
  const wide = VW > 820, L = 12, Rm = wide ? 312 : 12, T = wide ? 74 : 60, B = wide ? 124 : 150, fw = VW - L - Rm, fh = VH - T - B;
  const mw = W * CELL, mh = (H + .5) * CELL; cam.z = Math.min(fw / mw, fh / mh);
  cam.x = mw / 2 - (L + fw / 2 - VW / 2) / cam.z; cam.y = (H * CELL - .5 * CELL) / 2 - (T + fh / 2 - VH / 2) / cam.z;
}
function resize() { DPR = Math.min(2, devicePixelRatio || 1); VW = innerWidth; VH = innerHeight; cv.width = VW * DPR; cv.height = VH * DPR; cv.style.width = VW + 'px'; cv.style.height = VH + 'px'; if (!cam.user) fitCam(); }
let down = null;
cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, pan: e.button !== 0, id: e.pointerId }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => {
  const w = toWorld(e.clientX, e.clientY); S.wx = w.x; S.wy = w.y;
  if (down) { const dx = e.clientX - down.x, dy = e.clientY - down.y; if (down.pan || Math.hypot(dx, dy) > 8) { down.pan = true; cam.user = true; cam.x = down.cx - dx / cam.z; cam.y = down.cy - dy / cam.z; } }
});
cv.addEventListener('pointerup', e => { const wasPan = down && down.pan; down = null; if (!wasPan && e.button === 0) { const w = toWorld(e.clientX, e.clientY); S.wx = w.x; S.wy = w.y; click(w.x, w.y); } });
cv.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('wheel', e => { e.preventDefault(); const w = toWorld(e.clientX, e.clientY); cam.z = clamp(cam.z * Math.pow(1.0015, -e.deltaY), .2, 3); cam.x = w.x - (e.clientX - VW / 2) / cam.z; cam.y = w.y - (e.clientY - VH / 2) / cam.z; cam.user = true; }, { passive: false });
addEventListener('resize', resize);
addEventListener('keydown', e => {
  if (e.key === '1') act('fire'); else if (e.key === '2') act('bolt'); else if (e.key === 'm' || e.key === 'ь') act('move');
  else if (e.key === 'Escape') { S.mode = 'move'; hud(); } else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); act('end'); }
  else if (e.key === 'f' || e.key === 'а') { cam.user = false; fitCam(); }
});
function click(wx, wy) {
  const me = cur(); if (S.busy || S.over || me !== pc()) return;
  if (S.mode === 'fire') { const p = snapCorner(wx, wy); if (!los(center(me), p) || p.x <= 0 || p.y <= 0 || p.x >= W * CELL || p.y >= H * CELL) { const c = center(me); floatText(p.x, p.y, 'не видно', '#e0665b', 14); return; } castFireball(p.x, p.y); }
  else if (S.mode === 'bolt') castBolt();
  else pcMove(Math.floor(wx / CELL), Math.floor(wy / CELL));
}
$('flatBtn').onclick = () => { S.flat = !S.flat; $('flatBtn').classList.toggle('on', S.flat); };
$('resetBtn').onclick = reset;
$('logBtn').onclick = () => $('log').classList.toggle('show');

// ---------- Кадр ----------
function update(dt) {
  S.t += dt;
  for (const tk of toks) {
    if (tk.anim) { const a = tk.anim; a.t += dt; const f = Math.min(1, a.t / a.dur); tk.px = lerp(a.fx, a.tx, f); tk.py = lerp(a.fy, a.ty, f); tk.hop = Math.sin(Math.PI * f) * 6; if (f >= 1) { tk.anim = null; tk.hop = 0; a.res(); } }
    tk.hit = Math.max(0, tk.hit - dt); tk.flash = Math.max(0, tk.flash - dt); if (tk.dead && tk.dieT < 1) tk.dieT = Math.min(1, tk.dieT + dt / .8);
  }
  runFx(dt); updateParticles(dt);
  for (let i = FT.length - 1; i >= 0; i--) { FT[i].t += dt; if (FT[i].t > FT[i].life) FT.splice(i, 1); }
  S.shake *= Math.pow(.02, Math.max(dt, 1e-4)); if (S.flash) { S.flash.a -= dt * 1.4; if (S.flash.a <= 0) S.flash = null; }
  if (!S.flat) {
    for (const L of lights) if (L.flame && Math.random() < dt * (L.flame.sc > 1 ? 14 : 6)) emit({ x: L.flame.x + rnd(-4, 4) * L.flame.sc, y: L.flame.y - 8 * L.flame.sc, vx: rnd(-12, 12), vy: rnd(-45, -80), ax: rnd(-20, 20), drag: .99, life: rnd(1, 2), size: rnd(1.6, 2.6), col: '255,150,60' });
    if (Math.random() < dt * 6) { const L = pick(lights.filter(l => l.flame)), an = rnd(0, TAU), r = Math.sqrt(Math.random()) * L.r * .5; emit({ x: L.x + Math.cos(an) * r, y: L.y + Math.sin(an) * r, vx: rnd(-6, 6), vy: rnd(-6, 4), life: rnd(5, 9), size: rnd(1.4, 2.4), col: '255,225,180', a: .4 }); }
  }
}
function tokRow(tk) { return clamp(Math.floor((tk.py + tk.s * CELL - 1) / CELL), 0, H - 1); }
function drawTok(g, tk) {
  const c = center(tk), sh = tk.hit > 0 ? Math.sin(S.t * 90) * 4 * tk.hit / .4 : 0, x = c.x + sh, y = c.y - tk.hop;
  const sp = tk.sp, spD = tk.spD;
  if (tk.dead) {
    const f = tk.dieT;
    if (f < 1) { g.globalAlpha = 1 - f; g.drawImage(sp, x - sp.ox, y - sp.oy, sp.ww, sp.hh); }
    g.globalAlpha = f; g.save(); g.translate(x, y + 4 * f); g.rotate(.35 * f); g.scale(1 - .08 * f, 1 - .08 * f); g.drawImage(spD, -spD.ox, -spD.oy, spD.ww, spD.hh); g.restore(); g.globalAlpha = 1;
    return;
  }
  const br = 1 + .012 * Math.sin(S.t * 2 + tk.init);
  g.save(); g.translate(x, y); g.scale(br, br); g.drawImage(sp, -sp.ox, -sp.oy, sp.ww, sp.hh); g.restore();
  if (tk.flash > 0) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = tk.flash / .25 * .7; g.drawImage(sp, x - sp.ox, y - sp.oy, sp.ww, sp.hh); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; }
}
const shadowSp = (() => { const c = mk(64, 64), g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c; })();
function tokShadows(g) {
  for (const tk of toks) {
    const c = center(tk), R = tk.s * CELL * .42, k = tk.dead ? .6 : 1 - tk.hop / 14;
    g.globalAlpha = .8 * k; g.drawImage(shadowSp, c.x - R * 1.15 + 3, c.y + R * .1, R * 2.3, R * 1.1);
    for (const L of lights.concat(pc().dead ? [] : [staff], dynLights)) {
      const dx = c.x - L.x, dy = c.y - L.y, dd = Math.hypot(dx, dy); if (dd > L.r * .8 || dd < 4 || !los(L, c)) continue;
      const s = (1 - dd / (L.r * .8)) * Math.min(1, L.i) * .9 * k;
      g.save(); g.translate(c.x, c.y + R * .3); g.rotate(Math.atan2(dy, dx)); g.globalAlpha = s; g.drawImage(shadowSp, -R * .2, -R * .75, R * 2.6, R * 1.5); g.restore();
    }
  }
  g.globalAlpha = 1;
}
function drawFlat(g) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = at(x, y); g.fillStyle = ch === '#' || ch === 'T' ? '#262626' : ch === '~' ? '#35628f' : '#565656'; g.fillRect(x * CELL, y * CELL, CELL, CELL);
    if (ch === 'P' || ch === 'B' || ch === 'C') { g.fillStyle = ch === 'B' ? '#a5522a' : ch === 'C' ? '#7a5530' : '#3a3a3a'; g.beginPath(); g.arc((x + .5) * CELL, (y + .5) * CELL, CELL * .32, 0, TAU); g.fill(); }
  }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.beginPath(); for (let x = 0; x <= W; x++) { g.moveTo(x * CELL, 0); g.lineTo(x * CELL, H * CELL); } for (let y = 0; y <= H; y++) { g.moveTo(0, y * CELL); g.lineTo(W * CELL, y * CELL); } g.stroke();
  for (const tk of toks) { const c = center(tk), R = tk.s * CELL * .42; g.fillStyle = tk.dead ? '#555' : tk.side === 'pc' ? '#3b82f6' : '#dc2626'; g.beginPath(); g.arc(c.x, c.y, R, 0, TAU); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff'; g.font = `700 ${R}px Inter`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(tk.name[0], c.x, c.y + 1); }
}
function drawOverlays(g) {
  const me = cur(), p = pc();
  if (S.reach && me === p) {
    g.fillStyle = 'rgba(140,180,255,.07)'; g.strokeStyle = 'rgba(160,200,255,.18)'; g.lineWidth = 1;
    for (const k of S.reach.dist.keys()) { const x = k % W, y = Math.floor(k / W); if (x === p.x && y === p.y) continue; g.fillRect(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6); g.strokeRect(x * CELL + 3.5, y * CELL + 3.5, CELL - 7, CELL - 7); }
    const hx = Math.floor(S.wx / CELL), hy = Math.floor(S.wy / CELL), hk = hy * W + hx;
    if (S.reach.dist.has(hk) && !S.busy && !(hx === p.x && hy === p.y)) {
      const steps = pathFrom(S.reach.prev, hk), c0 = center(p);
      g.fillStyle = 'rgba(240,199,106,.9)'; let lx = c0.x, ly = c0.y;
      for (const [x, y] of steps) { const cx = (x + .5) * CELL, cy = (y + .5) * CELL; for (let f = .25; f <= 1; f += .25) { g.beginPath(); g.arc(lerp(lx, cx, f), lerp(ly, cy, f), 2.2, 0, TAU); g.fill(); } lx = cx; ly = cy; }
      g.globalAlpha = .45; g.drawImage(p.sp, (hx + .5) * CELL - p.sp.ox, (hy + .5) * CELL - p.sp.oy, p.sp.ww, p.sp.hh); g.globalAlpha = 1;
      label(g, (hx + .5) * CELL, hy * CELL - 6, steps.length * 5 + ' фт', '#f0c76a');
    }
  }
  if (me === p && !S.busy && S.mode === 'fire') {
    const c = snapCorner(S.wx, S.wy), ok = los(center(p), c), col = ok ? '255,140,50' : '220,60,50';
    const gr = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, FB_R); gr.addColorStop(0, `rgba(${col},.05)`); gr.addColorStop(.85, `rgba(${col},.16)`); gr.addColorStop(1, `rgba(${col},.3)`);
    g.fillStyle = gr; g.beginPath(); g.arc(c.x, c.y, FB_R, 0, TAU); g.fill();
    g.setLineDash([10, 8]); g.lineDashOffset = -S.t * 30; g.strokeStyle = `rgba(${col},.85)`; g.lineWidth = 2; g.stroke(); g.setLineDash([]);
    g.strokeStyle = `rgba(${col},.9)`; g.beginPath(); g.moveTo(c.x - 8, c.y); g.lineTo(c.x + 8, c.y); g.moveTo(c.x, c.y - 8); g.lineTo(c.x, c.y + 8); g.stroke();
    if (ok) for (const tk of toks) if (inFireball(tk, c.x, c.y)) mark(g, tk, tk === p ? '#ffd24a' : '#ff5a3a');
    label(g, c.x, c.y - FB_R - 8, ok ? 'Огненный шар · 20 фт' : 'Нет линии обзора', ok ? '#ffb070' : '#e0665b');
  }
  if (me === p && !S.busy && S.mode === 'bolt') {
    const L = boltLine(p), an = Math.atan2(L.y2 - L.y1, L.x2 - L.x1), len = Math.hypot(L.x2 - L.x1, L.y2 - L.y1);
    g.save(); g.translate(L.x1, L.y1); g.rotate(an); g.fillStyle = 'rgba(120,170,255,.16)'; g.fillRect(0, -CELL / 2, len, CELL);
    g.setLineDash([10, 8]); g.lineDashOffset = -S.t * 40; g.strokeStyle = 'rgba(150,195,255,.8)'; g.lineWidth = 2; g.strokeRect(0, -CELL / 2, len, CELL); g.setLineDash([]); g.restore();
    for (const tk of toks) if (inBolt(tk, L, p)) mark(g, tk, '#7fb4ff');
    label(g, L.x2, L.y2 - 12, Math.round(len / CELL * 5) + ' фт', '#a9d0ff');
  }
}
function mark(g, tk, col) { const c = center(tk), R = tk.s * CELL * .42; g.strokeStyle = col; g.lineWidth = 3; g.globalAlpha = .6 + .4 * Math.sin(S.t * 8); g.beginPath(); g.arc(c.x, c.y, R * 1.18, 0, TAU); g.stroke(); g.globalAlpha = 1; }
function label(g, x, y, text, col) {
  g.font = '600 13px Inter'; g.textAlign = 'center'; g.textBaseline = 'middle'; const w = g.measureText(text).width + 14;
  g.fillStyle = 'rgba(15,12,9,.85)'; g.beginPath(); g.roundRect(x - w / 2, y - 11, w, 22, 6); g.fill(); g.strokeStyle = 'rgba(240,199,106,.35)'; g.lineWidth = 1; g.stroke();
  g.fillStyle = col; g.fillText(text, x, y + .5);
}
function drawTokUI(g) {
  const me = cur();
  for (const tk of toks) {
    if (tk.dead) continue;
    const c = center(tk), R = tk.s * CELL * .42, y = c.y - tk.hop;
    if (tk === me && !S.over) {
      g.globalCompositeOperation = 'lighter'; glow(g, c.x, c.y + R * .2, R * 2, '255,200,110', .25);
      g.strokeStyle = 'rgba(255,210,120,.85)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { const a0 = S.t * 1.4 + i * TAU / 3; g.beginPath(); g.arc(c.x, y, R * 1.28, a0, a0 + 1.4); g.stroke(); }
      g.globalCompositeOperation = 'source-over';
    }
    const f = tk.hp / tk.max; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.7)'; g.beginPath(); g.arc(c.x, y, R * 1.1, 0, TAU); g.stroke();
    g.strokeStyle = f > .5 ? '#6fcf5a' : f > .25 ? '#e0b84a' : '#e0503f'; g.lineWidth = 3; g.beginPath(); g.arc(c.x, y, R * 1.1, -Math.PI / 2, -Math.PI / 2 + TAU * f); g.stroke();
    const hov = Math.hypot(S.wx - c.x, S.wy - c.y) < R * 1.1;
    if (hov) label(g, c.x, y - R * 1.1 - 16, `${tk.name} · ${tk.hp}/${tk.max} · КД ${tk.ac}`, tk.side === 'pc' ? '#f0c76a' : '#f0a090');
  }
}
function drawFT(g) {
  for (const f of FT) {
    const k = f.t / f.life, y = f.y - 46 * ease(Math.min(1, k * 1.3)), sc = k < .12 ? .6 + k / .12 * .7 : 1.3 - .3 * Math.min(1, (k - .12) * 5), a = k > .7 ? 1 - (k - .7) / .3 : 1;
    g.globalAlpha = a; g.font = `800 ${f.size * sc}px Inter`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(f.text, f.x, y); g.fillStyle = f.col; g.fillText(f.text, f.x, y);
  }
  g.globalAlpha = 1;
}
let last = performance.now();
function frame(now) {
  const dt = S.pause ? 0 : Math.min(.05, (now - last) / 1000); last = now; update(dt);
  const g = ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#050407'; g.fillRect(0, 0, cv.width, cv.height);
  const shx = (Math.random() - .5) * S.shake, shy = (Math.random() - .5) * S.shake;
  g.setTransform(DPR * cam.z, 0, 0, DPR * cam.z, DPR * (VW / 2 - cam.x * cam.z + shx), DPR * (VH / 2 - cam.y * cam.z + shy));
  if (S.flat) { drawFlat(g); drawOverlays(g); drawTokUI(g); drawFT(g); requestAnimationFrame(frame); return; }
  g.drawImage(floorCv, 0, 0, W * CELL, H * CELL); g.drawImage(decalCv, 0, 0, W * CELL, H * CELL);
  drawWater(g, S.t); tokShadows(g); drawParticles(g, 'debris');
  for (let r = 0; r < H; r++) {
    g.drawImage(rowCv[r], 0, (r - 1.5) * CELL, W * CELL, 2.5 * CELL);
    for (const tk of toks.filter(t => tokRow(t) === r).sort((a, b) => (b.dead - a.dead) || a.px - b.px)) drawTok(g, tk);
  }
  lightPass(S.t);
  g.globalCompositeOperation = 'multiply'; g.drawImage(lcv, 0, LY0, W * CELL, (H + 1.5) * CELL);
  g.globalCompositeOperation = 'screen'; g.globalAlpha = .14; g.drawImage(lcv, 0, LY0, W * CELL, (H + 1.5) * CELL); g.globalAlpha = 1;
  g.globalCompositeOperation = 'lighter';
  for (const L of lights) if (L.flame) flame(g, L.flame.x, L.flame.y, L.flame.sc, S.t, L.seed);
  for (const L of lights) if (!L.flame) glow(g, L.x, L.y + 8, 10, '255,210,120', .35 + .25 * Math.sin(S.t * 3));
  drawWaterGlow(g, S.t, lights.filter(l => l.flame).concat(pc().dead ? [] : [staff], dynLights));
  drawParticles(g, 'add'); drawFx(g, 'glow');
  g.globalCompositeOperation = 'source-over'; drawParticles(g, 'smoke');
  drawOverlays(g); drawTokUI(g); drawFT(g);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const vg = g.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .35, VW / 2, VH / 2, Math.max(VW, VH) * .75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = vg; g.fillRect(0, 0, VW, VH);
  if (S.flash) { g.fillStyle = `rgba(${S.flash.c},${Math.max(0, S.flash.a)})`; g.globalCompositeOperation = 'lighter'; g.fillRect(0, 0, VW, VH); g.globalCompositeOperation = 'source-over'; }
  requestAnimationFrame(frame);
}

// ---------- Старт ----------
function reset() {
  initToks(); P.length = 0; FX.length = 0; FT.length = 0; dynLights.length = 0;
  dg.setTransform(1, 0, 0, 1, 0, 0); dg.clearRect(0, 0, decalCv.width, decalCv.height); dg.setTransform(RS, 0, 0, RS, 0, 0);
  Object.assign(S, { round: 1, turn: 0, mode: 'move', busy: false, over: false, slots: 2, shake: 0, flash: null });
  $('logBody').innerHTML = ''; $('banner').style.opacity = 0;
  buildHud();
  log('<span class="m">Склеп под старой часовней. У жаровни — скелет и огр. Инициатива: Илва 18, Скелет 14, Огр 9.</span>');
  startTurn();
}
buildFloor(); buildRows(); resize(); reset(); requestAnimationFrame(frame);
