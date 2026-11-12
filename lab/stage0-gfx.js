'use strict';
// ===== Этап 0: графика только кодом (Canvas 2D). Карта, текстуры, свет, фишки, частицы =====
const TAU = Math.PI * 2, CELL = 64, WH = CELL * 0.4, RS = 1.5, LS = 0.5;
const RAW = [
  '######################',
  '###T#####T############',
  '##...........r.#######',
  '#...P.....P....###T###',
  '#..............##....#',
  '#....~~~.......##.C..#',
  '#...~~~~~..B...D.....#',
  '#....~~~.......##....#',
  '#...P.....P....##....#',
  '##.......r....########',
  '######################',
];
const W = 22, H = RAW.length;
const MAP = RAW.map(r => (r + '#'.repeat(W)).slice(0, W));
const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? '#' : MAP[y][x];
const wallAt = (x, y) => { const c = at(x, y); return c === '#' || c === 'T'; };
const terrBlock = (x, y) => '#TP~BC'.includes(at(x, y));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const n1 = t => Math.sin(t) * .5 + Math.sin(t * 2.31 + 1.7) * .3 + Math.sin(t * 5.13 + .4) * .2;
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; }
function poly(g, p) { g.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) g.lineTo(p[i][0], p[i][1]); g.closePath(); }
function cells(ch) { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (at(x, y) === ch) out.push([x, y]); return out; }
const WATER = cells('~');

// ---------- Отрезки стен для теней ----------
const SEGS = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!wallAt(x, y)) continue;
  const X = x * CELL, Y = y * CELL;
  if (y > 0 && !wallAt(x, y - 1)) SEGS.push([X, Y, X + CELL, Y]);
  if (y < H - 1 && !wallAt(x, y + 1)) SEGS.push([X, Y + CELL, X + CELL, Y + CELL]);
  if (x > 0 && !wallAt(x - 1, y)) SEGS.push([X, Y, X, Y + CELL]);
  if (x < W - 1 && !wallAt(x + 1, y)) SEGS.push([X + CELL, Y, X + CELL, Y + CELL]);
}
for (const [x, y] of cells('P')) {
  const cx = (x + .5) * CELL, cy = (y + .5) * CELL, r = CELL * .3;
  for (let i = 0; i < 8; i++) {
    const a = i * TAU / 8 + TAU / 16, b = a + TAU / 8;
    SEGS.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(b) * r, cy + Math.sin(b) * r]);
  }
}
function rayT(ox, oy, dx, dy, maxT, segs) {
  let best = maxT;
  for (const s of segs || SEGS) {
    const sx = s[2] - s[0], sy = s[3] - s[1], den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-9) continue;
    const ax = s[0] - ox, ay = s[1] - oy;
    const t = (ax * sy - ay * sx) / den, u = (ax * dy - ay * dx) / den;
    if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
  }
  return best;
}
function los(a, b) { const d = Math.hypot(b.x - a.x, b.y - a.y); if (d < 1) return true; return rayT(a.x, a.y, (b.x - a.x) / d, (b.y - a.y) / d, d) >= d - 1; }
function visPoly(lx, ly, R) {
  const segs = SEGS.filter(s => Math.min(s[0], s[2]) <= lx + R && Math.max(s[0], s[2]) >= lx - R && Math.min(s[1], s[3]) <= ly + R && Math.max(s[1], s[3]) >= ly - R);
  const angs = [];
  for (const s of segs) for (const [px, py] of [[s[0], s[1]], [s[2], s[3]]]) { const a = Math.atan2(py - ly, px - lx); angs.push(a - 1e-4, a, a + 1e-4); }
  for (let i = 0; i < 72; i++) angs.push(-Math.PI + i * TAU / 72);
  angs.sort((a, b) => a - b);
  const pts = [], pen = CELL * .48;
  for (const a of angs) {
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = rayT(lx, ly, dx, dy, R, segs);
    if (t < R) t = Math.min(R, t + pen); // свет немного «заходит» в стену — освещает её лицевую грань
    pts.push(lx + dx * t, ly + dy * t);
  }
  return pts;
}

// ---------- Пол ----------
const floorCv = mk(W * CELL * RS, H * CELL * RS);
function floorCell(g, x, y) {
  const R = mulberry32(x * 7919 + y * 104729 + 13), X = x * CELL, Y = y * CELL, lay = R();
  const rects = lay < .3 ? [[0, 0, 1, 1]] : lay < .55 ? [[0, 0, 1, .5], [0, .5, 1, .5]] : lay < .8 ? [[0, 0, .5, 1], [.5, 0, .5, 1]] : [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]];
  for (const [a, b, c, d] of rects) {
    const x0 = X + a * CELL + 1.5, y0 = Y + b * CELL + 1.5, w = c * CELL - 3, h = d * CELL - 3, j = () => (R() - .5) * 2.4;
    const p = [[x0 + j(), y0 + j()], [x0 + w + j(), y0 + j()], [x0 + w + j(), y0 + h + j()], [x0 + j(), y0 + h + j()]];
    const L = 25 + R() * 11, hue = 24 + R() * 16, sat = 6 + R() * 9;
    g.beginPath(); poly(g, p);
    const gr = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
    gr.addColorStop(0, `hsl(${hue},${sat}%,${L + 5}%)`); gr.addColorStop(1, `hsl(${hue},${sat}%,${L - 7}%)`);
    g.fillStyle = gr; g.fill();
    g.save(); g.clip();
    for (let k = 0; k < 30; k++) { g.fillStyle = R() < .5 ? 'rgba(255,240,220,.05)' : 'rgba(0,0,0,.13)'; g.fillRect(x0 + R() * w, y0 + R() * h, 1 + R() * 2.5, 1 + R() * 2.5); }
    if (R() < .55) { const bx = x0 + R() * w, by = y0 + R() * h, br = 8 + R() * 18, bg = g.createRadialGradient(bx, by, 0, bx, by, br); bg.addColorStop(0, R() < .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,230,200,.07)'); bg.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = bg; g.fillRect(bx - br, by - br, br * 2, br * 2); }
    if (R() < .25) { g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.beginPath(); let cx = x0 + R() * w, cy = y0 + R() * h; g.moveTo(cx, cy); for (let k = 0; k < 4; k++) { cx += (R() - .5) * 18; cy += (R() - .5) * 18; g.lineTo(cx, cy); } g.stroke(); }
    g.restore();
    g.lineWidth = 1.2;
    g.strokeStyle = 'rgba(255,235,210,.10)'; g.beginPath(); g.moveTo(p[3][0], p[3][1]); g.lineTo(p[0][0], p[0][1]); g.lineTo(p[1][0], p[1][1]); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.38)'; g.beginPath(); g.moveTo(p[1][0], p[1][1]); g.lineTo(p[2][0], p[2][1]); g.lineTo(p[3][0], p[3][1]); g.stroke();
  }
}
function stone(g, x, y, r, R) {
  const p = []; const n = 5 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) { const a = i * TAU / n + R() * .5, rr = r * (.7 + R() * .4); p.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * .8]); }
  g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); poly(g, p.map(q => [q[0] + 2, q[1] + 2])); g.fill();
  const gr = g.createLinearGradient(x - r, y - r, x + r, y + r); gr.addColorStop(0, '#6a6055'); gr.addColorStop(1, '#2c2620');
  g.fillStyle = gr; g.beginPath(); poly(g, p); g.fill();
}
function bone(g, x1, y1, x2, y2) {
  g.lineCap = 'round'; g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 4; g.beginPath(); g.moveTo(x1 + 1.5, y1 + 1.5); g.lineTo(x2 + 1.5, y2 + 1.5); g.stroke();
  g.strokeStyle = '#bdb29a'; g.lineWidth = 3.2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.fillStyle = '#cfc5ad'; for (const [x, y] of [[x1, y1], [x2, y2]]) { g.beginPath(); g.arc(x, y, 2.6, 0, TAU); g.fill(); }
}
function buildFloor() {
  const g = floorCv.getContext('2d'); g.setTransform(RS, 0, 0, RS, 0, 0);
  g.fillStyle = '#0d0b09'; g.fillRect(0, 0, W * CELL, H * CELL);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!wallAt(x, y)) floorCell(g, x, y);
  const R = mulberry32(99);
  for (let i = 0; i < 80; i++) { const x = R() * W * CELL, y = R() * H * CELL, r = 20 + R() * 70, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(18,12,6,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
  // мох и мокрый край у воды
  for (const [x, y] of WATER) for (let k = 0; k < 3; k++) { const cx = (x + .5 + (R() - .5) * 1.8) * CELL, cy = (y + .5 + (R() - .5) * 1.8) * CELL, r = 14 + R() * 20, gr = g.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, 'rgba(60,85,40,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(cx - r, cy - r, r * 2, r * 2); }
  g.beginPath(); for (const [x, y] of WATER) { const cx = (x + .5) * CELL, cy = (y + .5) * CELL; g.moveTo(cx + CELL * .8, cy); g.arc(cx, cy, CELL * .8, 0, TAU); }
  g.fillStyle = 'rgba(8,12,10,.6)'; g.fill();
  // тень у основания стен
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (wallAt(x, y)) continue;
    const X = x * CELL, Y = y * CELL;
    for (const [dx, dy, d, s] of [[0, -1, .5, .6], [0, 1, .25, .35], [-1, 0, .32, .4], [1, 0, .32, .4]]) {
      if (!wallAt(x + dx, y + dy)) continue;
      let gr;
      if (dy === -1) gr = g.createLinearGradient(0, Y, 0, Y + d * CELL);
      else if (dy === 1) gr = g.createLinearGradient(0, Y + CELL, 0, Y + CELL - d * CELL);
      else if (dx === -1) gr = g.createLinearGradient(X, 0, X + d * CELL, 0);
      else gr = g.createLinearGradient(X + CELL, 0, X + CELL - d * CELL, 0);
      gr.addColorStop(0, `rgba(0,0,0,${s})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(X, Y, CELL, CELL);
    }
  }
  for (const [x, y] of cells('r')) for (let k = 0; k < 7; k++) stone(g, (x + .2 + R() * .6) * CELL, (y + .2 + R() * .6) * CELL, 3 + R() * 6, R);
  for (let k = 0; k < 14; k++) { const x = 1 + Math.floor(R() * 14), y = 2 + Math.floor(R() * 8); if (at(x, y) === '.') stone(g, (x + R()) * CELL, (y + R()) * CELL, 2 + R() * 3, R); }
  bone(g, 6.2 * CELL, 9.3 * CELL, 6.7 * CELL, 9.55 * CELL); bone(g, 6.5 * CELL, 9.15 * CELL, 6.8 * CELL, 9.4 * CELL);
  bone(g, 13.2 * CELL, 2.4 * CELL, 13.75 * CELL, 2.6 * CELL);
  g.fillStyle = '#c9bfa6'; g.beginPath(); g.arc(13.9 * CELL, 2.55 * CELL, 5, 0, TAU); g.fill();
  g.fillStyle = '#1a120c'; g.beginPath(); g.arc(13.85 * CELL, 2.52 * CELL, 1.4, 0, TAU); g.arc(13.96 * CELL, 2.52 * CELL, 1.4, 0, TAU); g.fill();
}

// ---------- Стены и предметы (по рядам, для правильного перекрытия) ----------
const rowCv = [];
function wallFace(g, X, Y, w, h, R, torch) {
  const gr = g.createLinearGradient(0, Y, 0, Y + h); gr.addColorStop(0, '#4a4038'); gr.addColorStop(1, '#231e1a');
  g.fillStyle = gr; g.fillRect(X, Y, w + .5, h);
  const rows = 3, rh = h / rows;
  for (let i = 0; i < rows; i++) {
    for (let bx = X - (i % 2) * 11 - R() * 6; bx < X + w;) {
      const bw = 15 + R() * 13, x0 = Math.max(bx, X) + 1, x1 = Math.min(bx + bw, X + w) - 1;
      if (x1 > x0 + 1) {
        g.fillStyle = `hsla(28,${6 + R() * 8}%,${20 + R() * 10}%,.92)`; g.fillRect(x0, Y + i * rh + 1, x1 - x0, rh - 2);
        g.fillStyle = 'rgba(255,230,200,.09)'; g.fillRect(x0, Y + i * rh + 1, x1 - x0, 1);
      }
      bx += bw;
    }
  }
  const sh = g.createLinearGradient(0, Y, 0, Y + h); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.45)');
  g.fillStyle = sh; g.fillRect(X, Y, w + .5, h);
  g.fillStyle = 'rgba(255,225,190,.16)'; g.fillRect(X, Y, w + .5, 1.6);
  if (R() < .35) { g.fillStyle = 'rgba(55,80,35,.5)'; for (let k = 0; k < 5; k++) g.fillRect(X + R() * w, Y + h * (.5 + R() * .5), 2 + R() * 4, 2); }
  if (torch) {
    const cx = X + w / 2, cy = Y + h * .55;
    g.fillStyle = '#1b1612'; g.fillRect(cx - 5, cy - 6, 10, 12);
    g.fillStyle = '#5c4a36'; g.fillRect(cx - 5, cy - 6, 10, 1.5);
    g.fillStyle = '#2a211a'; g.beginPath(); g.moveTo(cx - 6, cy - 9); g.lineTo(cx + 6, cy - 9); g.lineTo(cx + 3, cy - 3); g.lineTo(cx - 3, cy - 3); g.closePath(); g.fill();
  }
}
function wallTile(g, x, y, torch) {
  const X = x * CELL, Y = y * CELL, R = mulberry32(x * 31 + y * 977 + 5), ty = Y - WH;
  const faceVis = y < H - 1 && !wallAt(x, y + 1);
  g.fillStyle = '#1b1815'; g.fillRect(X, ty, CELL + .5, CELL + .5);
  for (let k = 0; k < 24; k++) { g.fillStyle = R() < .5 ? 'rgba(255,240,220,.04)' : 'rgba(0,0,0,.25)'; g.fillRect(X + R() * CELL, ty + R() * CELL, 1 + R() * 3, 1 + R() * 3); }
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X, ty + CELL * .5); g.lineTo(X + CELL, ty + CELL * .5); g.moveTo(X + CELL * (.3 + R() * .4), ty); g.lineTo(X + CELL * (.3 + R() * .4), ty + CELL * .5); g.stroke();
  const rim = (c, x1, y1, x2, y2, col) => { if (!c) return; g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
  rim(y > 0 && !wallAt(x, y - 1), X, ty + 1, X + CELL, ty + 1, '#4f453a');
  rim(x > 0 && !wallAt(x - 1, y), X + 1, ty, X + 1, ty + CELL, '#433a31');
  rim(x < W - 1 && !wallAt(x + 1, y), X + CELL - 1, ty, X + CELL - 1, ty + CELL, '#2e2822');
  rim(faceVis, X, ty + CELL - 1, X + CELL, ty + CELL - 1, '#6d5f50');
  if (faceVis) wallFace(g, X, Y + CELL - WH, CELL, WH, R, torch);
}
function pillar(g, x, y) {
  const cx = (x + .5) * CELL, cy = (y + .5) * CELL, r = CELL * .3, top = cy - 1.25 * CELL;
  g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.ellipse(cx + 3, cy + r * .5, r * 1.5, r * .6, 0, 0, TAU); g.fill();
  const hg = (a, b) => { const gr = g.createLinearGradient(a, 0, b, 0); gr.addColorStop(0, '#1b1814'); gr.addColorStop(.32, '#6a5e52'); gr.addColorStop(.6, '#3d352d'); gr.addColorStop(1, '#13110e'); return gr; };
  g.fillStyle = hg(cx - r * 1.25, cx + r * 1.25); g.fillRect(cx - r * 1.25, cy - r * .35, r * 2.5, r * .75);
  g.fillStyle = '#51473d'; g.beginPath(); g.ellipse(cx, cy - r * .35, r * 1.25, r * .3, 0, 0, TAU); g.fill();
  g.fillStyle = hg(cx - r, cx + r); g.fillRect(cx - r, top, r * 2, cy - r * .35 - top);
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 1;
  for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(cx + i * r * .38, top + 4); g.lineTo(cx + i * r * .38, cy - r * .4); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.moveTo(cx + r * .2, top + 20); g.lineTo(cx + r * .45, top + 34); g.lineTo(cx + r * .3, top + 46); g.stroke();
  g.fillStyle = hg(cx - r * 1.3, cx + r * 1.3); g.fillRect(cx - r * 1.3, top - r * .55, r * 2.6, r * .6);
  g.fillStyle = '#5a4f44'; g.beginPath(); g.ellipse(cx, top - r * .55, r * 1.3, r * .32, 0, 0, TAU); g.fill();
  g.fillStyle = '#2a241f'; g.beginPath(); g.ellipse(cx, top - r * .55, r * 1.0, r * .22, 0, 0, TAU); g.fill();
}
function brazier(g, x, y) {
  const cx = (x + .5) * CELL, cy = (y + .5) * CELL;
  g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.ellipse(cx + 2, cy + 14, 22, 8, 0, 0, TAU); g.fill();
  g.strokeStyle = '#17120e'; g.lineWidth = 3;
  for (const dx of [-14, 0, 14]) { g.beginPath(); g.moveTo(cx + dx * .5, cy - 2); g.lineTo(cx + dx, cy + 15); g.stroke(); }
  const gr = g.createLinearGradient(cx - 20, 0, cx + 20, 0); gr.addColorStop(0, '#1c1612'); gr.addColorStop(.35, '#5a4a3b'); gr.addColorStop(1, '#120e0b');
  g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy - 6, 20, 13, 0, 0, Math.PI); g.fill();
  g.fillStyle = '#2a1c14'; g.beginPath(); g.ellipse(cx, cy - 6, 20, 7, 0, 0, TAU); g.fill();
  const cg = g.createRadialGradient(cx, cy - 6, 0, cx, cy - 6, 18); cg.addColorStop(0, '#ffb04a'); cg.addColorStop(.5, '#c33d0a'); cg.addColorStop(1, '#2a0a03');
  g.fillStyle = cg; g.beginPath(); g.ellipse(cx, cy - 6, 17, 5.5, 0, 0, TAU); g.fill();
  g.strokeStyle = '#7a654e'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(cx, cy - 6, 20, 7, 0, 0, TAU); g.stroke();
}
function chest(g, x, y) {
  const cx = (x + .5) * CELL, cy = (y + .5) * CELL;
  g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.ellipse(cx + 3, cy + 14, 28, 8, 0, 0, TAU); g.fill();
  let gr = g.createLinearGradient(0, cy - 8, 0, cy + 14); gr.addColorStop(0, '#6a4426'); gr.addColorStop(1, '#2e1c0f');
  g.fillStyle = gr; g.fillRect(cx - 23, cy - 8, 46, 22);
  gr = g.createLinearGradient(0, cy - 24, 0, cy - 8); gr.addColorStop(0, '#8a5a32'); gr.addColorStop(1, '#4e3119');
  g.fillStyle = gr; g.beginPath(); g.moveTo(cx - 23, cy - 8); g.lineTo(cx - 23, cy - 16); g.quadraticCurveTo(cx, cy - 28, cx + 23, cy - 16); g.lineTo(cx + 23, cy - 8); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = 1; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(cx - 23, cy - 1 + i * 6); g.lineTo(cx + 23, cy - 1 + i * 6); g.stroke(); }
  g.fillStyle = '#2b2622'; for (const dx of [-16, 12]) g.fillRect(cx + dx, cy - 21, 4, 35);
  g.fillStyle = '#e2b04c'; g.fillRect(cx - 4, cy - 10, 8, 9); g.fillStyle = '#3a2a10'; g.fillRect(cx - 1, cy - 7, 2, 4);
}
function door(g, x, y) {
  const X = x * CELL, Y = y * CELL;
  g.fillStyle = '#3c342c'; g.fillRect(X + 2, Y + 4, CELL - 4, CELL - 8);
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.strokeRect(X + 2, Y + 4, CELL - 4, CELL - 8);
  const gr = g.createLinearGradient(X, 0, X + CELL, 0); gr.addColorStop(0, '#5b3a20'); gr.addColorStop(1, '#2c1b0e');
  g.fillStyle = gr; g.fillRect(X + 6, Y + 2, CELL - 12, 10);
  g.fillStyle = 'rgba(0,0,0,.35)'; for (let i = 1; i < 5; i++) g.fillRect(X + 6 + i * (CELL - 12) / 5, Y + 2, 1, 10);
  g.fillStyle = '#26211c'; g.fillRect(X + 10, Y + 2, 3, 10); g.fillRect(X + CELL - 16, Y + 2, 3, 10);
}
function buildRows() {
  rowCv.length = 0;
  for (let r = 0; r < H; r++) {
    const c = mk(W * CELL * RS, 2.5 * CELL * RS), g = c.getContext('2d');
    g.setTransform(RS, 0, 0, RS, 0, -(r - 1.5) * CELL * RS);
    for (let x = 0; x < W; x++) {
      const ch = at(x, r);
      if (ch === '#' || ch === 'T') wallTile(g, x, r, ch === 'T');
      else if (ch === 'P') pillar(g, x, r);
      else if (ch === 'B') brazier(g, x, r);
      else if (ch === 'C') chest(g, x, r);
      else if (ch === 'D') door(g, x, r);
    }
    rowCv.push(c);
  }
}

// ---------- Вода ----------
let WB = null;
function drawWater(g, t) {
  if (!WB) { const xs = WATER.map(c => c[0]), ys = WATER.map(c => c[1]); WB = { x0: (Math.min(...xs) - .3) * CELL, y0: (Math.min(...ys) - .3) * CELL, x1: (Math.max(...xs) + 1.3) * CELL, y1: (Math.max(...ys) + 1.3) * CELL }; }
  g.save(); g.beginPath();
  for (const [x, y] of WATER) { const cx = (x + .5) * CELL, cy = (y + .5) * CELL; g.moveTo(cx + CELL * .7, cy); g.arc(cx, cy, CELL * .7, 0, TAU); }
  g.clip();
  const gr = g.createLinearGradient(0, WB.y0, 0, WB.y1); gr.addColorStop(0, '#2a6670'); gr.addColorStop(1, '#0f3640');
  g.fillStyle = gr; g.fillRect(WB.x0, WB.y0, WB.x1 - WB.x0, WB.y1 - WB.y0);
  g.lineWidth = 1.3;
  for (let i = 0; i < 16; i++) {
    const yy = WB.y0 + i * (WB.y1 - WB.y0) / 16; g.beginPath();
    for (let x = WB.x0; x <= WB.x1; x += 8) { const y = yy + Math.sin(x * .045 + t * 1.3 + i * 1.7) * 3 + Math.sin(x * .11 - t * 2 + i) * 1.2; x === WB.x0 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.strokeStyle = `rgba(170,225,235,${.12 + .06 * Math.sin(t + i)})`; g.stroke();
  }
  const ww = WB.x1 - WB.x0, wh = WB.y1 - WB.y0;
  for (let k = 0; k < 22; k++) { const a = .5 + .5 * Math.sin(t * 3 + k * 1.3); g.fillStyle = `rgba(220,245,255,${.3 * a})`; g.fillRect(WB.x0 + ((k * 97.3 + t * 9 * (k % 3 + 1)) % ww), WB.y0 + (k * 53.7 % wh), 2.5, 1.2); }
  const eg = g.createRadialGradient((WB.x0 + WB.x1) / 2, (WB.y0 + WB.y1) / 2, 20, (WB.x0 + WB.x1) / 2, (WB.y0 + WB.y1) / 2, ww * .6);
  eg.addColorStop(0, 'rgba(0,0,0,0)'); eg.addColorStop(1, 'rgba(0,0,0,.45)'); g.fillStyle = eg; g.fillRect(WB.x0, WB.y0, ww, wh);
  g.restore();
}

// Блики огня на воде (в режиме сложения, после освещения)
function drawWaterGlow(g, t, srcs) {
  g.save(); g.beginPath();
  for (const [x, y] of WATER) { const cx = (x + .5) * CELL, cy = (y + .5) * CELL; g.moveTo(cx + CELL * .7, cy); g.arc(cx, cy, CELL * .7, 0, TAU); }
  g.clip();
  for (const [x, y] of WATER) glow(g, (x + .5) * CELL, (y + .5) * CELL, CELL * .9, '60,150,170', .07);
  for (const L of srcs) for (const [x, y] of WATER) {
    const cx = (x + .5) * CELL, cy = (y + .5) * CELL, dd = Math.hypot(cx - L.x, cy - L.y); if (dd > L.r) continue;
    const k = (1 - dd / L.r) * Math.min(1.5, L.i);
    for (let j = 0; j < 3; j++) {
      const sx = cx + Math.sin(t * 1.7 + x * 3 + j * 2.1) * CELL * .3, sy = cy + Math.cos(t * 1.3 + y * 2 + j) * CELL * .2;
      g.globalAlpha = k * (.35 + .3 * Math.sin(t * 4 + j + x)); g.drawImage(glowSprite(L.c.join(',')), sx - 22, sy - 5, 44, 10);
    }
  }
  g.globalAlpha = 1; g.restore();
}

// ---------- Спрайты ----------
const spriteCache = {};
function glowSprite(col) {
  const k = 'g' + col; if (spriteCache[k]) return spriteCache[k];
  const c = mk(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${col},1)`); gr.addColorStop(.2, `rgba(${col},.6)`); gr.addColorStop(.5, `rgba(${col},.18)`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return spriteCache[k] = c;
}
function smokeSprite(col) {
  const k = 's' + col; if (spriteCache[k]) return spriteCache[k];
  const c = mk(128, 128), g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${col},.8)`); gr.addColorStop(.6, `rgba(${col},.3)`); gr.addColorStop(1, `rgba(${col},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return spriteCache[k] = c;
}
function glow(g, x, y, r, col, a) { if (a <= 0) return; g.globalAlpha = Math.min(1, a); g.drawImage(glowSprite(col), x - r, y - r, r * 2, r * 2); g.globalAlpha = 1; }

// Языки пламени (рисуются в режиме сложения)
function flame(g, x, y, sc, t, seed) {
  glow(g, x, y - 8 * sc, 48 * sc, '255,110,30', .3);
  glow(g, x, y - 5 * sc, 20 * sc, '255,170,70', .6);
  const layers = [['255,70,20', .55, 1], ['255,140,40', .7, .75], ['255,235,170', .9, .45]];
  layers.forEach(([col, a, k], i) => {
    const h = 20 * sc * k * (1 + .2 * n1(t * 11 + seed + i * 3)), sway = n1(t * 7 + seed * 2 + i) * 4 * sc, w = 7 * sc * (k * .8 + .2);
    const gr = g.createLinearGradient(x, y, x, y - h); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - w, y);
    g.quadraticCurveTo(x - w * .8 + sway * .3, y - h * .55, x + sway, y - h);
    g.quadraticCurveTo(x + w * .8 + sway * .3, y - h * .55, x + w, y);
    g.quadraticCurveTo(x, y + w * .6, x - w, y); g.fill();
  });
}

// ---------- Фишки: монета с рамкой и тиснёным гербом ----------
function emboss(g, path, fill, d) {
  d = d || 1.4;
  g.save(); g.translate(d, d); path(); g.fillStyle = 'rgba(0,0,0,.6)'; g.fill(); g.restore();
  g.save(); g.translate(-d * .6, -d * .6); path(); g.fillStyle = 'rgba(255,255,255,.2)'; g.fill(); g.restore();
  path(); g.fillStyle = fill; g.fill();
}
const FIELD = { wizard: ['#2b3870', '#080b1c'], skull: ['#3d4a43', '#0d1311'], ogre: ['#4e3d24', '#120d07'] };
const EMB = {
  skull(g, cx, cy, R) {
    const bone = g.createLinearGradient(0, cy - R * .6, 0, cy + R * .6); bone.addColorStop(0, '#f1e9d2'); bone.addColorStop(1, '#93876e');
    emboss(g, () => { g.beginPath(); g.arc(cx, cy - R * .14, R * .5, Math.PI * .8, Math.PI * 2.2); g.lineTo(cx + R * .34, cy + R * .2); g.lineTo(cx + R * .26, cy + R * .5); g.quadraticCurveTo(cx, cy + R * .6, cx - R * .26, cy + R * .5); g.lineTo(cx - R * .34, cy + R * .2); g.closePath(); }, bone);
    g.fillStyle = '#120a08';
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * R * .19, cy + R * .0, R * .14, R * .12, s * .2, 0, TAU); g.fill(); }
    for (const s of [-1, 1]) glow(g, cx + s * R * .19, cy + R * .01, R * .1, '255,60,40', .9);
    g.fillStyle = '#120a08'; g.beginPath(); g.moveTo(cx, cy + R * .1); g.lineTo(cx - R * .06, cy + R * .25); g.lineTo(cx + R * .06, cy + R * .25); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(30,20,15,.85)'; g.lineWidth = R * .025; g.beginPath(); g.moveTo(cx - R * .21, cy + R * .37); g.lineTo(cx + R * .21, cy + R * .37);
    for (let i = -2; i <= 2; i++) { g.moveTo(cx + i * R * .08, cy + R * .31); g.lineTo(cx + i * R * .08, cy + R * .45); }
    g.moveTo(cx + R * .1, cy - R * .6); g.lineTo(cx + R * .16, cy - R * .42); g.lineTo(cx + R * .1, cy - R * .32); g.stroke();
  },
  ogre(g, cx, cy, R) {
    const skin = g.createLinearGradient(0, cy - R * .6, 0, cy + R * .7); skin.addColorStop(0, '#a4ab6c'); skin.addColorStop(1, '#4a5428');
    for (const s of [-1, 1]) emboss(g, () => { g.beginPath(); g.ellipse(cx + s * R * .52, cy - R * .02, R * .1, R * .16, s * .3, 0, TAU); }, '#6f7a40');
    emboss(g, () => { g.beginPath(); g.moveTo(cx - R * .42, cy - R * .25); g.quadraticCurveTo(cx, cy - R * .66, cx + R * .42, cy - R * .25); g.lineTo(cx + R * .5, cy + R * .15); g.quadraticCurveTo(cx + R * .45, cy + R * .64, cx, cy + R * .68); g.quadraticCurveTo(cx - R * .45, cy + R * .64, cx - R * .5, cy + R * .15); g.closePath(); }, skin);
    g.strokeStyle = '#262b10'; g.lineCap = 'round'; g.lineWidth = R * .09;
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * R * .33, cy - R * .17); g.lineTo(cx + s * R * .07, cy - R * .05); g.stroke(); }
    for (const s of [-1, 1]) { g.fillStyle = '#f2d24a'; g.beginPath(); g.ellipse(cx + s * R * .18, cy + R * .03, R * .07, R * .045, 0, 0, TAU); g.fill(); g.fillStyle = '#000'; g.beginPath(); g.arc(cx + s * R * .17, cy + R * .03, R * .025, 0, TAU); g.fill(); }
    g.fillStyle = '#5f6a33'; g.beginPath(); g.ellipse(cx, cy + R * .17, R * .13, R * .085, 0, 0, TAU); g.fill();
    g.fillStyle = '#20240c'; for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * R * .05, cy + R * .2, R * .022, 0, TAU); g.fill(); }
    g.strokeStyle = '#20240c'; g.lineWidth = R * .045; g.beginPath(); g.moveTo(cx - R * .29, cy + R * .38); g.quadraticCurveTo(cx, cy + R * .31, cx + R * .29, cy + R * .38); g.stroke();
    for (const s of [-1, 1]) { g.fillStyle = '#f1e6c8'; g.strokeStyle = '#3a3320'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx + s * R * .22, cy + R * .37); g.lineTo(cx + s * R * .12, cy + R * .355); g.lineTo(cx + s * R * .19, cy + R * .16); g.closePath(); g.fill(); g.stroke(); }
  },
  wizard(g, cx, cy, R) {
    g.fillStyle = 'rgba(255,255,255,.7)'; const Rr = mulberry32(7); for (let i = 0; i < 14; i++) g.fillRect(cx + (Rr() - .5) * R * 1.6, cy + (Rr() - .5) * R * 1.6, 1.2, 1.2);
    for (const s of [-1, 1]) emboss(g, () => { g.beginPath(); g.moveTo(cx + s * R * .2, cy + R * .1); g.quadraticCurveTo(cx + s * R * .48, cy + R * .4, cx + s * R * .34, cy + R * .78); g.lineTo(cx + s * R * .16, cy + R * .7); g.quadraticCurveTo(cx + s * R * .24, cy + R * .4, cx + s * R * .08, cy + R * .2); g.closePath(); }, '#cfc8dd');
    g.fillStyle = '#1a1426'; g.beginPath(); g.ellipse(cx, cy + R * .3, R * .25, R * .26, 0, 0, TAU); g.fill();
    for (const s of [-1, 1]) glow(g, cx + s * R * .09, cy + R * .3, R * .09, '150,200,255', 1);
    const hat = g.createLinearGradient(cx - R * .4, cy - R * .6, cx + R * .4, cy + R * .1); hat.addColorStop(0, '#7466c9'); hat.addColorStop(1, '#221a55');
    emboss(g, () => { g.beginPath(); g.ellipse(cx, cy + R * .1, R * .64, R * .16, 0, 0, TAU); }, hat);
    emboss(g, () => { g.beginPath(); g.moveTo(cx - R * .36, cy + R * .07); g.quadraticCurveTo(cx - R * .1, cy - R * .3, cx + R * .22, cy - R * .68); g.quadraticCurveTo(cx + R * .04, cy - R * .26, cx + R * .36, cy + R * .07); g.closePath(); }, hat);
    g.strokeStyle = '#e0b04a'; g.lineWidth = R * .07; g.beginPath(); g.moveTo(cx - R * .33, cy - R * .0); g.quadraticCurveTo(cx, cy + R * .05, cx + R * .33, cy - R * .0); g.stroke();
    g.fillStyle = '#f5d070'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? R * .035 : R * .085; g.lineTo(cx - R * .02 + Math.cos(a) * rr, cy - R * .24 + Math.sin(a) * rr); } g.closePath(); g.fill();
  },
};
function coin(g, cx, cy, R, kind, side, edge) {
  const pal = side === 'pc' ? { hi: '#ffe9a8', mid: '#c8963e', lo: '#5e4114', edge: '#3d2a0c' } : { hi: '#f2b3a1', mid: '#9a3328', lo: '#3e0f0b', edge: '#240706' };
  g.fillStyle = pal.edge; g.beginPath(); g.arc(cx, cy + edge, R, 0, TAU); g.fill();
  g.fillStyle = pal.lo; g.beginPath(); g.arc(cx, cy + edge * .5, R, 0, TAU); g.fill();
  let gr = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); gr.addColorStop(0, pal.hi); gr.addColorStop(.45, pal.mid); gr.addColorStop(1, pal.lo);
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  gr = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R); gr.addColorStop(0, pal.lo); gr.addColorStop(.55, pal.mid); gr.addColorStop(1, pal.hi);
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, R * .87, 0, TAU); g.fill();
  const f = FIELD[kind], rg = g.createRadialGradient(cx, cy - R * .25, 0, cx, cy, R * .82); rg.addColorStop(0, f[0]); rg.addColorStop(1, f[1]);
  g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, R * .8, 0, TAU); g.fill();
  g.save(); g.beginPath(); g.arc(cx, cy, R * .8, 0, TAU); g.clip();
  EMB[kind](g, cx, cy, R * .8);
  const ish = g.createRadialGradient(cx, cy, R * .5, cx, cy, R * .8); ish.addColorStop(0, 'rgba(0,0,0,0)'); ish.addColorStop(1, 'rgba(0,0,0,.6)');
  g.fillStyle = ish; g.fillRect(cx - R, cy - R, R * 2, R * 2); g.restore();
  for (let i = 0; i < 12; i++) { const a = i * TAU / 12; g.fillStyle = i % 2 ? pal.lo : pal.hi; g.beginPath(); g.arc(cx + Math.cos(a) * R * .935, cy + Math.sin(a) * R * .935, R * .028, 0, TAU); g.fill(); }
  g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
  g.fillStyle = 'rgba(255,255,255,.1)'; g.beginPath(); g.ellipse(cx - R * .3, cy - R * .5, R * .75, R * .32, -.5, 0, TAU); g.fill(); g.restore();
}
function makeSprite(kind, side, R, dead) {
  const sc = 2, edge = R * .12, pad = 4, c = mk((2 * R + pad * 2) * sc, (2 * R + edge + pad * 2) * sc), g = c.getContext('2d');
  g.scale(sc, sc);
  if (dead) g.filter = 'grayscale(1) brightness(.5)';
  coin(g, R + pad, R + pad, R, kind, side, edge);
  if (dead) { g.filter = 'none'; g.strokeStyle = 'rgba(10,5,5,.85)'; g.lineWidth = R * .08; g.lineCap = 'round'; g.beginPath(); g.moveTo(R + pad - R * .45, R + pad - R * .45); g.lineTo(R + pad + R * .45, R + pad + R * .45); g.moveTo(R + pad + R * .45, R + pad - R * .45); g.lineTo(R + pad - R * .45, R + pad + R * .45); g.stroke(); }
  c.ox = R + pad; c.oy = R + pad; c.ww = c.width / sc; c.hh = c.height / sc;
  return c;
}

// ---------- Иконки для панели ----------
const ICONS = {
  move(g, s) {
    g.fillStyle = '#d9c7a1';
    for (const [x, y, r] of [[.38, .6, -.3], [.6, .38, -.3]]) {
      g.save(); g.translate(x * s, y * s); g.rotate(r);
      g.beginPath(); g.ellipse(0, 0, s * .075, s * .13, 0, 0, TAU); g.fill();
      for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(-s * .06 + i * s * .04, -s * .17 + Math.abs(i - 1.5) * s * .015, s * .022, 0, TAU); g.fill(); }
      g.restore();
    }
  },
  fire(g, s) {
    g.globalCompositeOperation = 'lighter'; glow(g, s * .5, s * .55, s * .45, '255,110,30', .7); g.globalCompositeOperation = 'source-over';
    flame(g, s * .62, s * .42, s * .028, 2, 1);
    const gr = g.createRadialGradient(s * .44, s * .56, 0, s * .48, s * .6, s * .22); gr.addColorStop(0, '#fff6c0'); gr.addColorStop(.4, '#ff9a2a'); gr.addColorStop(1, '#8a1600');
    g.fillStyle = gr; g.beginPath(); g.arc(s * .48, s * .6, s * .2, 0, TAU); g.fill();
  },
  bolt(g, s) {
    g.globalCompositeOperation = 'lighter'; glow(g, s * .5, s * .5, s * .45, '110,160,255', .7); g.globalCompositeOperation = 'source-over';
    g.shadowColor = '#8fc0ff'; g.shadowBlur = s * .1;
    const gr = g.createLinearGradient(0, s * .15, 0, s * .85); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#6aa4ff');
    g.fillStyle = gr; g.beginPath(); poly(g, [[.58, .12], [.3, .52], [.48, .52], [.38, .88], [.72, .42], [.53, .42], [.66, .12]].map(p => [p[0] * s, p[1] * s])); g.fill(); g.shadowBlur = 0;
  },
  end(g, s) {
    g.strokeStyle = '#e0b04a'; g.lineWidth = s * .05; g.lineCap = 'round';
    g.beginPath(); g.moveTo(s * .3, s * .2); g.lineTo(s * .7, s * .2); g.moveTo(s * .3, s * .8); g.lineTo(s * .7, s * .8); g.stroke();
    g.lineWidth = s * .035; g.beginPath(); g.moveTo(s * .34, s * .22); g.quadraticCurveTo(s * .34, s * .45, s * .5, s * .5); g.quadraticCurveTo(s * .66, s * .45, s * .66, s * .22);
    g.moveTo(s * .34, s * .78); g.quadraticCurveTo(s * .34, s * .55, s * .5, s * .5); g.quadraticCurveTo(s * .66, s * .55, s * .66, s * .78); g.stroke();
    g.fillStyle = '#d9b46a'; g.beginPath(); g.moveTo(s * .4, s * .76); g.quadraticCurveTo(s * .5, s * .6, s * .6, s * .76); g.closePath(); g.fill();
  },
};
