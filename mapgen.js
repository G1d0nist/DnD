'use strict';
// Генератор местности и локаций для игрового стола. Чистые функции: на входе шаблон и настройки, на выходе —
// { w, h, cells: { 'x_y': тип клетки }, doors: { 'x_y': { o: 0, l? } }, lights: [{ x, y, b, d }], chests: [{ x, y, room }],
//   rooms: [{ x, y, w, h, kind }], start: { x, y }, ground, amb, fog }. Одно и то же «зерно» даёт одну и ту же карту.
const MAPGEN = (() => {
  // Детерминированный генератор случайных чисел (mulberry32)
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { f: next, i: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), ch: (p) => next() < p, pick: (arr) => arr[Math.floor(next() * arr.length)] };
  }
  // Карта клеток: '' — открытая земля
  function grid(w, h, fill = '') {
    const g = Array.from({ length: h }, () => Array(w).fill(fill));
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    return { w, h, g, inb, get: (x, y) => (inb(x, y) ? g[y][x] : 'wall'), set: (x, y, v) => { if (inb(x, y)) g[y][x] = v; } };
  }
  const near8 = (G, x, y, t) => { let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && G.get(x, y) !== undefined && G.get(x + dx, y + dy) === t) n++; return n; };
  // Клеточный автомат: «стена», если вокруг много стен (пещеры, скалы, болотные озёра)
  function automaton(G, R, t, p, steps, edge = true) {
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (R.ch(p)) G.g[y][x] = t;
    for (let s = 0; s < steps; s++) {
      const nx = G.g.map((row) => row.slice());
      for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const v = G.inb(x + dx, y + dy) ? G.g[y + dy][x + dx] : edge ? t : '';
          if (v === t) n++;
        }
        nx[y][x] = n >= 5 ? t : n <= 2 ? '' : G.g[y][x] === t ? t : '';
      }
      G.g = nx;
    }
  }
  // Оставить только самую большую связную открытую область (остальное заполнить type) — чтобы всё было достижимо
  function keepLargest(G, solid, type) {
    const seen = new Set(), regions = [];
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      const k = `${x}_${y}`;
      if (seen.has(k) || solid(G.g[y][x])) continue;
      const reg = [], q = [[x, y]];
      seen.add(k);
      while (q.length) {
        const [cx, cy] = q.pop();
        reg.push([cx, cy]);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const nx = cx + dx, ny = cy + dy, nk = `${nx}_${ny}`;
          if (G.inb(nx, ny) && !seen.has(nk) && !solid(G.g[ny][nx])) { seen.add(nk); q.push([nx, ny]); }
        });
      }
      regions.push(reg);
    }
    regions.sort((a, b) => b.length - a.length);
    regions.slice(1).forEach((reg) => reg.forEach(([x, y]) => { G.g[y][x] = type; }));
    return regions[0] || [];
  }
  // Пятна: деревья, скалы, кусты вокруг центров
  function blobs(G, R, t, count, rmin, rmax, dens = 0.75, only = (v) => v === '') {
    for (let i = 0; i < count; i++) {
      const cx = R.i(0, G.w - 1), cy = R.i(0, G.h - 1), r = R.i(rmin, rmax);
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy) / (r + 0.5);
        if (G.inb(x, y) && d <= 1 && only(G.g[y][x]) && R.ch(dens * (1 - d * 0.6))) G.g[y][x] = t;
      }
    }
  }
  // Извилистая полоса через всю карту (река, дорога): горизонтально или вертикально
  function band(G, R, t, width, vertical, keep = () => false) {
    const len = vertical ? G.h : G.w, span = vertical ? G.w : G.h, path = [];
    let c = R.i(Math.floor(span * 0.3), Math.floor(span * 0.7)), drift = 0;
    for (let i = 0; i < len; i++) {
      drift = Math.max(-1, Math.min(1, drift + (R.f() - 0.5) * 0.8));
      c = Math.max(1, Math.min(span - width - 1, Math.round(c + drift)));
      path.push(c);
      for (let j = 0; j < width; j++) { const x = vertical ? c + j : i, y = vertical ? i : c + j; if (!keep(G.get(x, y))) G.set(x, y, t); }
    }
    return path;
  }
  const clearCircle = (G, cx, cy, r, v = '') => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (Math.hypot(x - cx, y - cy) <= r + 0.3) G.set(x, y, v); };
  // Открытая клетка поближе к точке (старт, сундук)
  function openNear(G, x, y, ok = (v) => ['', 'road', 'floor', 'sand', 'bridge'].includes(v)) {
    for (let r = 0; r < Math.max(G.w, G.h); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      if (G.inb(x + dx, y + dy) && ok(G.g[y + dy][x + dx])) return { x: x + dx, y: y + dy };
    }
    return { x, y };
  }
  // Здание: стены по периметру, пол внутри, дверь в середине стороны side (n, s, w, e)
  function building(G, out, x, y, w, h, side, R, lockP = 0) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) G.set(i, j, j === y || j === y + h - 1 || i === x || i === x + w - 1 ? 'wall' : 'floor');
    const d = side === 'n' ? [x + Math.floor(w / 2), y] : side === 's' ? [x + Math.floor(w / 2), y + h - 1] : side === 'w' ? [x, y + Math.floor(h / 2)] : [x + w - 1, y + Math.floor(h / 2)];
    G.set(d[0], d[1], '');
    out.doors[`${d[0]}_${d[1]}`] = { o: 0, ...(R && R.ch(lockP) ? { l: 1 } : {}) };
    out.rooms.push({ x: x + 1, y: y + 1, w: w - 2, h: h - 2, kind: 'house' });
    return d;
  }
  const fits = (G, x, y, w, h, ok = (v) => v === '' || v === 'bush') => {
    if (x < 1 || y < 1 || x + w >= G.w || y + h >= G.h) return false;
    for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) if (!ok(G.get(i, j))) return false;
    return true;
  };

  /* --- Местность --- */
  function forest(G, R, o, out) {
    const d = o.density;
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 60 * (0.6 + d * 2)), 2, 4, 0.55 + d * 0.4);
    for (let i = 0; i < G.w * G.h * d * 0.12; i++) { const x = R.i(0, G.w - 1), y = R.i(0, G.h - 1); if (G.get(x, y) === '') G.set(x, y, 'tree'); }
    blobs(G, R, 'bush', Math.round((G.w * G.h) / 80), 1, 3, 0.6);
    const cx = R.i(Math.floor(G.w * 0.35), Math.floor(G.w * 0.65)), cy = R.i(Math.floor(G.h * 0.35), Math.floor(G.h * 0.65));
    clearCircle(G, cx, cy, Math.max(2, Math.floor(Math.min(G.w, G.h) / 5)));
    if (o.road) band(G, R, 'road', 2, false);
    if (R.ch(0.35)) band(G, R, 'water', 1, true, (v) => v === 'road');
    out.ground = 'grass'; out.start = openNear(G, 1, Math.floor(G.h / 2));
  }
  function river(G, R, o, out) {
    const vertical = R.ch(0.5), width = R.i(2, 4), path = band(G, R, 'water', width, vertical);
    // Берега: кусты и редкие деревья; переправа — мост или брод
    blobs(G, R, 'bush', Math.round((G.w * G.h) / 70), 1, 2, 0.6);
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 90 * (0.5 + o.density * 2)), 1, 3, 0.6);
    const at = R.i(Math.floor(path.length * 0.3), Math.floor(path.length * 0.7)), c = path[at];
    for (let j = -1; j <= width; j++) for (let k = 0; k < 2; k++) {
      const x = vertical ? c + j : at + k, y = vertical ? at + k : c + j;
      if (G.get(x, y) === 'water') G.set(x, y, R.ch(0.3) ? 'difficult' : 'bridge');
    }
    if (o.road) { // дорога к мосту с обеих сторон
      const L = vertical ? G.w : G.h;
      for (let s = 0; s < L; s++) for (let k = 0; k < 2; k++) { const x = vertical ? s : at + k, y = vertical ? at + k : s; if (['', 'bush', 'tree'].includes(G.get(x, y))) G.set(x, y, 'road'); }
    }
    for (let i = 0; i < width * 2; i++) { const p = R.i(0, path.length - 1), x = vertical ? path[p] + R.i(0, width - 1) : p, y = vertical ? p : path[p] + R.i(0, width - 1); if (G.get(x, y) === 'water' && R.ch(0.5)) G.set(x, y, 'rock'); }
    out.ground = 'grass'; out.start = openNear(G, vertical ? 1 : Math.floor(G.w / 2), vertical ? Math.floor(G.h / 2) : 1);
  }
  function mountains(G, R, o, out) {
    automaton(G, R, 'rock', 0.36 + o.density * 0.2, 4, false);
    keepLargest(G, (v) => v === 'rock', 'rock');
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '' && near8(G, x, y, 'rock') >= 2 && R.ch(0.5)) G.g[y][x] = 'difficult';
    if (o.road) band(G, R, 'road', 2, false, (v) => false);
    blobs(G, R, 'tree', 3, 1, 2, 0.5);
    if (R.ch(0.4)) blobs(G, R, 'water', 1, 1, 2, 0.9);
    out.ground = 'stone'; out.start = openNear(G, 1, Math.floor(G.h / 2));
  }
  function plains(G, R, o, out) {
    blobs(G, R, 'bush', Math.round((G.w * G.h) / 90), 1, 2, 0.5);
    blobs(G, R, 'tree', Math.round(2 + o.density * 8), 1, 3, 0.6);
    for (let i = 0; i < G.w * G.h * 0.01; i++) { const x = R.i(0, G.w - 1), y = R.i(0, G.h - 1); if (G.get(x, y) === '') G.set(x, y, 'rock'); }
    if (R.ch(0.5)) blobs(G, R, 'water', 1, 2, 3, 0.95);
    if (o.road) band(G, R, 'road', 2, R.ch(0.3));
    out.ground = 'grass'; out.start = openNear(G, 1, Math.floor(G.h / 2));
  }
  function swamp(G, R, o, out) {
    automaton(G, R, 'water', 0.42 + o.density * 0.1, 3, false);
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '' && R.ch(0.45)) G.g[y][x] = 'difficult';
    blobs(G, R, 'bush', Math.round((G.w * G.h) / 70), 1, 2, 0.6, (v) => v === '' || v === 'difficult');
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 120 * (0.5 + o.density * 2)), 1, 2, 0.5, (v) => v === '' || v === 'difficult');
    if (o.road) band(G, R, 'bridge', 1, false);
    out.ground = 'swamp'; out.start = openNear(G, 1, Math.floor(G.h / 2), (v) => v === '' || v === 'difficult' || v === 'bridge');
  }
  function desert(G, R, o, out) {
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) G.g[y][x] = 'sand';
    // Дюны — полосы трудной местности
    for (let i = 0; i < Math.round(G.h / 4); i++) band(G, R, 'difficult', R.i(1, 2), false, (v) => v !== 'sand');
    blobs(G, R, 'rock', Math.round(2 + o.density * 6), 1, 2, 0.7, (v) => v === 'sand' || v === 'difficult');
    if (R.ch(0.5)) { // оазис
      const cx = R.i(5, G.w - 6), cy = R.i(4, G.h - 5);
      clearCircle(G, cx, cy, 3, ''); clearCircle(G, cx, cy, 1, 'water');
      for (let i = 0; i < 6; i++) { const a = R.f() * Math.PI * 2; G.set(Math.round(cx + Math.cos(a) * 3), Math.round(cy + Math.sin(a) * 3), 'tree'); }
    }
    out.ground = 'sand'; out.start = openNear(G, 1, Math.floor(G.h / 2), (v) => v === 'sand' || v === '');
  }
  function coast(G, R, o, out) {
    // Море с одной стороны, извилистая линия берега, пляж, скалы и деревья дальше от воды
    let c = Math.floor(G.w * 0.65), drift = 0;
    for (let y = 0; y < G.h; y++) {
      drift = Math.max(-1, Math.min(1, drift + (R.f() - 0.5)));
      c = Math.max(Math.floor(G.w * 0.45), Math.min(Math.floor(G.w * 0.8), Math.round(c + drift)));
      for (let x = 0; x < G.w; x++) G.g[y][x] = x >= c ? 'water' : x >= c - 3 ? 'sand' : '';
    }
    blobs(G, R, 'rock', Math.round(3 + o.density * 5), 1, 2, 0.7, (v) => v === 'sand' || v === 'water' || v === '');
    blobs(G, R, 'tree', Math.round(3 + o.density * 10), 1, 3, 0.6);
    blobs(G, R, 'bush', 6, 1, 2, 0.5);
    if (o.road) band(G, R, 'road', 1, true, (v) => v === 'water' || v === 'sand');
    out.ground = 'grass'; out.start = openNear(G, 1, Math.floor(G.h / 2));
  }

  /* --- Локации --- */
  // Подземелье: комнаты, коридоры между ними, двери (иногда запертые), факелы, места для сундуков
  function dungeon(G, R, o, out) {
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) G.g[y][x] = 'wall';
    const rooms = [], target = Math.max(4, Math.round((G.w * G.h) / 70));
    for (let t = 0; t < 300 && rooms.length < target; t++) {
      const w = R.i(4, 9), h = R.i(4, 7), x = R.i(1, G.w - w - 1), y = R.i(1, G.h - h - 1);
      if (rooms.some((r) => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      rooms.push({ x, y, w, h });
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) G.g[j][i] = 'floor';
    }
    rooms.sort((a, b) => a.x + a.y * 0.3 - (b.x + b.y * 0.3));
    const cen = (r) => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)];
    const carve = (x, y) => { if (G.get(x, y) === 'wall' && G.inb(x, y) && x > 0 && y > 0 && x < G.w - 1 && y < G.h - 1) G.g[y][x] = 'corr'; };
    const corridor = (a, b) => {
      const [x0, y0] = cen(a), [x1, y1] = cen(b), hFirst = R.ch(0.5);
      if (hFirst) { for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) carve(x, y0); for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) carve(x1, y); }
      else { for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) carve(x0, y); for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) carve(x, y1); }
    };
    for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
    for (let i = 0; i < Math.ceil(rooms.length / 4); i++) corridor(R.pick(rooms), R.pick(rooms)); // петли
    // Двери: там, где коридор входит в комнату (клетка коридора рядом с комнатой, со стенами по бокам)
    const inRoom = (x, y) => rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    for (let y = 1; y < G.h - 1; y++) for (let x = 1; x < G.w - 1; x++) {
      if (G.g[y][x] !== 'corr' || inRoom(x, y)) continue;
      const nRoom = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inRoom(x + dx, y + dy));
      if (nRoom.length !== 1) continue;
      const [dx, dy] = nRoom[0], side1 = G.get(x + dy, y + dx), side2 = G.get(x - dy, y - dx);
      if (side1 === 'wall' && side2 === 'wall' && R.ch(0.65)) out.doors[`${x}_${y}`] = { o: 0, ...(R.ch(0.15) ? { l: 1 } : {}) };
    }
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === 'corr') G.g[y][x] = 'floor';
    rooms.forEach((r, i) => {
      const kind = i === 0 ? 'entrance' : i === rooms.length - 1 ? 'boss' : R.pick(['hall', 'hall', 'crypt', 'storage', 'shrine']);
      out.rooms.push({ ...r, kind });
      if (R.ch(0.55) || i === 0) out.lights.push({ x: r.x, y: r.y, b: 20, d: 20 }); // факел в углу
      // Колонны в больших залах, вода в святилище
      // Препятствие можно ставить, только если рядом нет входа в комнату (клетки вне комнаты вокруг — стены)
      const safe = (x, y) => {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, out_ = nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h;
          if (out_ && G.get(nx, ny) !== 'wall') return false;
        }
        return true;
      };
      if (r.w >= 7 && r.h >= 5 && R.ch(0.5)) [[2, 1], [r.w - 3, 1], [2, r.h - 2], [r.w - 3, r.h - 2]].forEach(([dx, dy]) => { if (safe(r.x + dx, r.y + dy)) G.set(r.x + dx, r.y + dy, 'rock'); });
      if (kind === 'shrine') G.set(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), 'water');
      if (kind === 'storage') for (let k = 0; k < 3; k++) { const fx = r.x + R.i(0, r.w - 1); if (safe(fx, r.y)) G.set(fx, r.y, 'furn'); }
      if (i > 0 && (kind === 'storage' || kind === 'boss' || R.ch(o.chests ? 0.35 : 0))) out.chests.push({ x: r.x + r.w - 1, y: r.y + r.h - 1, room: i, boss: kind === 'boss' });
    });
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision';
    if (rooms.length) { const [sx, sy] = cen(rooms[0]); out.start = { x: sx, y: sy }; }
  }
  // Пещера: клеточный автомат, одна связная область, подземные озёра и осыпи
  function cave(G, R, o, out) {
    automaton(G, R, 'wall', 0.44 + o.density * 0.08, 5, true);
    const reg = keepLargest(G, (v) => v === 'wall', 'wall');
    const pools = grid(G.w, G.h);
    automaton(pools, R, 'water', 0.38, 3, false);
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      if (G.g[y][x] !== '') continue;
      if (pools.g[y][x] === 'water' && near8(G, x, y, 'wall') <= 1 && R.ch(0.5)) G.g[y][x] = 'water';
      else if (near8(G, x, y, 'wall') >= 3 && R.ch(0.25)) G.g[y][x] = 'difficult';
    }
    // Тупики и ниши — места для сундуков и логова
    const spots = reg.filter(([x, y]) => G.g[y][x] === '' && near8(G, x, y, 'wall') >= 5);
    for (let i = 0; i < (o.chests ? Math.max(1, Math.round(spots.length / 40)) : 0) && spots.length; i++) { const [x, y] = R.pick(spots); out.chests.push({ x, y }); }
    const s = reg.slice().sort((a, b) => a[0] - b[0])[0] || [1, 1];
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '') G.g[y][x] = 'floor'; // пол пещеры светлее стен
    out.rooms.push({ x: 0, y: 0, w: G.w, h: G.h, kind: 'cave' });
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision'; out.start = { x: s[0], y: s[1] };
  }
  // Замок: стена с башнями и воротами, ров с мостом, двор, донжон с залами, казармы, конюшня, колодец
  function castle(G, R, o, out) {
    const m = 3, x0 = m, y0 = m, x1 = G.w - m - 1, y1 = G.h - m - 1, gx = Math.floor(G.w / 2);
    // Ров
    for (let y = y0 - 2; y <= y1 + 2; y++) for (let x = x0 - 2; x <= x1 + 2; x++) if ((x === x0 - 2 || x === x1 + 2 || y === y0 - 2 || y === y1 + 2) && R.ch(0.92)) G.set(x, y, 'water');
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x === x0 || x === x1 || y === y0 || y === y1) G.set(x, y, 'wall');
    // Башни по углам
    [[x0, y0], [x1 - 3, y0], [x0, y1 - 3], [x1 - 3, y1 - 3]].forEach(([tx, ty], i) => building(G, out, tx, ty, 4, 4, i < 2 ? 's' : 'n', R));
    // Ворота и мост
    G.set(gx, y1, ''); G.set(gx - 1, y1, '');
    out.doors[`${gx}_${y1}`] = { o: 0 }; out.doors[`${gx - 1}_${y1}`] = { o: 0 };
    for (let y = y1 + 1; y < G.h; y++) { G.set(gx, y, G.get(gx, y) === 'water' ? 'bridge' : 'road'); G.set(gx - 1, y, G.get(gx - 1, y) === 'water' ? 'bridge' : 'road'); }
    // Донжон: большой зал и комнаты за перегородкой
    const kw = Math.min(14, Math.floor((x1 - x0) * 0.5)), kh = Math.min(8, Math.floor((y1 - y0) * 0.45)), kx = gx - Math.floor(kw / 2), ky = y0 + 4;
    building(G, out, kx, ky, kw, kh, 's', R);
    // За перегородкой — три покоя, каждый с дверью в зал
    const part = ky + Math.floor(kh / 2), third = Math.floor(kw / 3);
    for (let x = kx; x < kx + kw; x++) G.set(x, part, 'wall');
    for (let k = 1; k < 3; k++) for (let y = ky; y <= part; y++) G.set(kx + third * k, y, 'wall');
    for (let k = 0; k < 3; k++) { const dx = kx + third * k + Math.max(1, Math.floor(third / 2)); G.set(dx, part, 'floor'); out.doors[`${dx}_${part}`] = { o: 0, ...(k === 1 ? { l: 1 } : {}) }; }
    for (let x = kx + 2; x < kx + kw - 2; x += 3) G.set(x, part + 2, 'furn'); // столы в зале
    out.lights.push({ x: gx, y: ky + kh - 2, b: 20, d: 20 }, { x: gx, y: y1 - 1, b: 20, d: 20 });
    // Казармы и конюшня по бокам двора
    const sideH = Math.max(4, Math.floor((y1 - y0) * 0.35));
    if (x0 + 9 < kx) building(G, out, x0 + 2, y0 + 6, Math.min(7, kx - x0 - 3), sideH, 'e', R);
    if (x1 - 9 > kx + kw) building(G, out, Math.max(kx + kw + 2, x1 - 8), y0 + 6, Math.min(7, x1 - kx - kw - 3), sideH, 'w', R);
    // Дорога от ворот к донжону и колодец
    for (let y = ky + kh; y < y1; y++) { if (G.get(gx, y) === '') G.set(gx, y, 'road'); if (G.get(gx - 1, y) === '') G.set(gx - 1, y, 'road'); }
    G.set(gx + 3, y1 - 3, 'water');
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '' && (x < x0 - 2 || x > x1 + 2 || y < y0 - 2 || y > y1 + 2) && R.ch(0.06)) G.g[y][x] = 'tree';
    if (o.chests) out.chests.push({ x: kx + 1, y: ky + 1, boss: true });
    out.ground = 'grass'; out.start = { x: gx, y: G.h - 1 };
  }
  // Город: улицы сеткой, кварталы с домами (двери на улицу), площадь с фонтаном и рынком
  function city(G, R, o, out) {
    const step = R.i(9, 11), streets = (n) => { const a = []; for (let s = 2 + R.i(0, 2); s < n - 2; s += step) a.push(s); return a; };
    const sx = streets(G.w), sy = streets(G.h);
    sx.forEach((x) => { for (let y = 0; y < G.h; y++) { G.set(x, y, 'road'); G.set(x + 1, y, 'road'); } });
    sy.forEach((y) => { for (let x = 0; x < G.w; x++) { G.set(x, y, 'road'); G.set(x, y + 1, 'road'); } });
    // Кварталы между улицами
    const xs = [-2, ...sx, G.w], ys = [-2, ...sy, G.h], blocks = [];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      const bx = xs[i] + 2, by = ys[j] + 2, bw = xs[i + 1] - bx, bh = ys[j + 1] - by;
      if (bw >= 4 && bh >= 4) blocks.push({ x: bx, y: by, w: bw, h: bh });
    }
    const plaza = blocks.length ? blocks.reduce((best, b) => (Math.hypot(b.x + b.w / 2 - G.w / 2, b.y + b.h / 2 - G.h / 2) < Math.hypot(best.x + best.w / 2 - G.w / 2, best.y + best.h / 2 - G.h / 2) ? b : best)) : null;
    blocks.forEach((b) => {
      if (b === plaza) { // площадь
        for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) G.set(x, y, 'road');
        const cx = b.x + Math.floor(b.w / 2), cy = b.y + Math.floor(b.h / 2);
        G.set(cx, cy, 'water'); G.set(cx - 1, cy, 'water');
        for (let k = 0; k < Math.min(6, b.w - 2); k += 2) G.set(b.x + 1 + k, b.y + 1, 'furn'); // прилавки
        out.lights.push({ x: cx, y: cy + 1, b: 30, d: 30 });
        out.rooms.push({ ...b, kind: 'plaza' });
        return;
      }
      // Дома: делим квартал на 1–3 части по длинной стороне
      const n = Math.max(1, Math.min(3, Math.floor((b.w >= b.h ? b.w : b.h) / 5))), horiz = b.w >= b.h;
      for (let k = 0; k < n; k++) {
        const hw = horiz ? Math.floor(b.w / n) : b.w, hh = horiz ? b.h : Math.floor(b.h / n), hx = horiz ? b.x + k * hw : b.x, hy = horiz ? b.y : b.y + k * hh;
        if (hw < 4 || hh < 4) continue;
        if (R.ch(0.12)) { G.set(hx + 1, hy + 1, 'tree'); continue; } // садик
        // Дверь — на сторону, за которой улица (не край карты и не соседний дом)
        const outside = { n: [hx + Math.floor(hw / 2), hy - 1], s: [hx + Math.floor(hw / 2), hy + hh], w: [hx - 1, hy + Math.floor(hh / 2)], e: [hx + hw, hy + Math.floor(hh / 2)] };
        const sides = Object.keys(outside).filter((sd) => G.get(outside[sd][0], outside[sd][1]) === 'road');
        if (!sides.length) continue;
        building(G, out, hx, hy, hw, hh, R.pick(sides), R, 0.2);
        out.rooms[out.rooms.length - 1].kind = R.pick(['house', 'house', 'shop', 'tavern', 'temple']);
      }
    });
    if (o.chests) out.rooms.filter((r) => r.kind === 'shop').slice(0, 2).forEach((r) => out.chests.push({ x: r.x, y: r.y }));
    out.ground = 'dirt'; out.start = openNear(G, sx.length ? sx[0] : 1, 0);
  }
  // Деревня: дорога, домики вдоль неё, колодец, огороды, деревья, иногда ручей
  function village(G, R, o, out) {
    const vertical = R.ch(0.3), road = band(G, R, 'road', 2, vertical);
    if (R.ch(0.4)) band(G, R, 'water', 1, !vertical, (v) => v === 'road');
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === 'water' && (G.get(x - 1, y) === 'road' || G.get(x + 1, y) === 'road' || G.get(x, y - 1) === 'road' || G.get(x, y + 1) === 'road')) G.g[y][x] = 'bridge';
    const houses = Math.round((G.w * G.h) / 90);
    let n = 0;
    for (let t = 0; t < 900 && n < houses; t++) {
      const w = R.i(4, 6), h = R.i(4, 5), along = R.i(2, (vertical ? G.h : G.w) - 8), c = road[Math.min(road.length - 1, along)], up = R.ch(0.5);
      const gap = R.i(1, t < 300 ? 3 : 6), x = vertical ? (up ? c - w - gap : c + 2 + gap) : along, y = vertical ? along : (up ? c - h - gap : c + 2 + gap);
      if (!fits(G, x, y, w, h)) continue;
      building(G, out, x, y, w, h, vertical ? (up ? 'e' : 'w') : (up ? 's' : 'n'), R, 0.1);
      out.rooms[out.rooms.length - 1].kind = n === 0 ? 'tavern' : 'house';
      if (R.ch(0.5)) { const fx = vertical ? (up ? x - 4 : x + w + 1) : x, fy = vertical ? y : (up ? y - 3 : y + h + 1); for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) if (G.get(fx + i, fy + j) === '') G.set(fx + i, fy + j, 'difficult'); }
      n++;
    }
    // Мало места у дороги — остальные дома где свободно, дверью к дороге
    for (let t = 0; t < 400 && n < Math.ceil(houses / 2); t++) {
      const w = R.i(4, 5), h = 4, x = R.i(1, G.w - w - 1), y = R.i(1, G.h - h - 1);
      if (!fits(G, x, y, w, h)) continue;
      const c = road[Math.min(road.length - 1, vertical ? y : x)];
      building(G, out, x, y, w, h, vertical ? (x < c ? 'e' : 'w') : (y < c ? 's' : 'n'), R, 0.1);
      n++;
    }
    const wc = openNear(G, Math.floor(G.w / 2), Math.floor(G.h / 2), (v) => v === '');
    G.set(wc.x, wc.y, 'water');
    blobs(G, R, 'tree', Math.round(4 + o.density * 10), 1, 3, 0.6);
    blobs(G, R, 'bush', 5, 1, 2, 0.5);
    out.lights.push({ x: wc.x, y: wc.y + 1, b: 20, d: 20 });
    out.ground = 'grass'; out.start = vertical ? { x: road[0], y: 0 } : { x: 0, y: road[0] };
  }
  // Таверна изнутри: общий зал со столами, стойка, кухня, комнаты для постояльцев
  function tavern(G, R, o, out) {
    const x0 = 1, y0 = 1, x1 = G.w - 2, y1 = G.h - 2;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G.set(x, y, x === x0 || x === x1 || y === y0 || y === y1 ? 'wall' : 'floor');
    const split = x0 + Math.floor((x1 - x0) * 0.65), mid = y0 + Math.floor((y1 - y0) / 2);
    for (let y = y0; y <= y1; y++) G.set(split, y, 'wall');
    // Комнаты справа: перегородки и двери в зал
    const nRooms = Math.max(2, Math.floor((y1 - y0) / 4));
    for (let k = 1; k < nRooms; k++) { const ry = y0 + Math.floor(((y1 - y0) * k) / nRooms); for (let x = split; x <= x1; x++) G.set(x, ry, 'wall'); }
    for (let k = 0; k < nRooms; k++) {
      const ry0 = y0 + Math.floor(((y1 - y0) * k) / nRooms), ry1 = y0 + Math.floor(((y1 - y0) * (k + 1)) / nRooms), dy = Math.floor((ry0 + ry1) / 2);
      G.set(split, dy, 'floor'); out.doors[`${split}_${dy}`] = { o: 0, ...(R.ch(0.5) ? { l: 1 } : {}) };
      G.set(x1 - 1, ry0 + 1, 'furn'); // кровать
      out.rooms.push({ x: split + 1, y: ry0 + 1, w: x1 - split - 1, h: ry1 - ry0 - 1, kind: k === nRooms - 1 ? 'kitchen' : 'room' });
      if (o.chests && k > 0 && R.ch(0.5)) out.chests.push({ x: x1 - 1, y: ry1 - 1 });
    }
    // Стойка и столы в зале
    for (let y = y0 + 2; y <= y0 + Math.min(6, y1 - y0 - 3); y++) G.set(split - 2, y, 'furn');
    for (let y = y0 + 3; y < y1 - 1; y += 3) for (let x = x0 + 3; x < split - 4; x += 4) { G.set(x, y, 'furn'); G.set(x + 1, y, 'furn'); }
    // Вход и очаг
    G.set(x0, mid, 'floor'); out.doors[`${x0}_${mid}`] = { o: 0 };
    out.lights.push({ x: x0 + 1, y: y0 + 1, b: 20, d: 20 }, { x: Math.floor((x0 + split) / 2), y: y1 - 1, b: 20, d: 20 }, { x: split - 3, y: y0 + 1, b: 20, d: 20 });
    out.rooms.push({ x: x0 + 1, y: y0 + 1, w: split - x0 - 1, h: y1 - y0 - 1, kind: 'hall' });
    out.ground = 'wood'; out.amb = 'dim'; out.start = { x: x0, y: mid };
  }

  const TEMPLATES = {
    forest: { n: '🌲 Лес', kind: 'terrain', fn: forest, w: 30, h: 20, road: true },
    river: { n: '🏞 Река', kind: 'terrain', fn: river, w: 30, h: 20, road: true },
    mountains: { n: '⛰ Горы', kind: 'terrain', fn: mountains, w: 30, h: 20, road: true },
    plains: { n: '🌾 Равнина', kind: 'terrain', fn: plains, w: 30, h: 20, road: true },
    swamp: { n: '🐸 Болото', kind: 'terrain', fn: swamp, w: 30, h: 20, road: false },
    desert: { n: '🏜 Пустыня', kind: 'terrain', fn: desert, w: 30, h: 20, road: false },
    coast: { n: '🌊 Побережье', kind: 'terrain', fn: coast, w: 30, h: 20, road: false },
    dungeon: { n: '🏚 Подземелье', kind: 'location', fn: dungeon, w: 40, h: 28, chests: true, minW: 20, minH: 16 },
    cave: { n: '🕳 Пещеры', kind: 'location', fn: cave, w: 36, h: 24, chests: true, minW: 16, minH: 12 },
    castle: { n: '🏰 Замок', kind: 'location', fn: castle, w: 40, h: 30, chests: true, peaceful: true, minW: 32, minH: 26 },
    city: { n: '🏙 Город', kind: 'location', fn: city, w: 44, h: 32, chests: false, peaceful: true, minW: 26, minH: 20 },
    village: { n: '🏡 Деревня', kind: 'location', fn: village, w: 36, h: 26, chests: false, peaceful: true, minW: 24, minH: 18, connect: true },
    tavern: { n: '🍺 Таверна', kind: 'location', fn: tavern, w: 22, h: 16, chests: false, peaceful: true, minW: 16, minH: 12 },
  };
  // Местность: замкнутые деревьями и скалами карманы соединяются с основной областью просекой
  const SOLID = new Set(['wall', 'tree', 'rock', 'furn']);
  function connectOutdoor(G, out) {
    const pass = (x, y) => G.inb(x, y) && !SOLID.has(G.g[y][x]);
    const reach = new Set(), q = [[out.start.x, out.start.y]];
    reach.add(`${out.start.x}_${out.start.y}`);
    while (q.length) { const [x, y] = q.pop(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = `${x + dx}_${y + dy}`; if (!reach.has(k) && pass(x + dx, y + dy)) { reach.add(k); q.push([x + dx, y + dy]); } } }
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      if (!pass(x, y) || reach.has(`${x}_${y}`)) continue;
      // Путь сквозь препятствия к ближайшей достижимой клетке (поиск в ширину), препятствия на пути вырубаются
      const prev = new Map([[`${x}_${y}`, null]]), qq = [[x, y]];
      let hit = null;
      while (qq.length && !hit) {
        const [cx, cy] = qq.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, k = `${nx}_${ny}`;
          // Рубить можно деревья, скалы и кусты — стены домов не трогаем
          if (!G.inb(nx, ny) || prev.has(k) || G.g[ny][nx] === 'wall' || G.g[ny][nx] === 'furn') continue;
          prev.set(k, `${cx}_${cy}`);
          if (reach.has(k)) { hit = k; break; }
          qq.push([nx, ny]);
        }
      }
      for (let k = hit; k; k = prev.get(k)) {
        const [cx, cy] = k.split('_').map(Number);
        if (SOLID.has(G.g[cy][cx])) G.g[cy][cx] = G.g[cy][cx] === 'rock' ? 'difficult' : '';
        reach.add(k);
      }
      // Заодно всё, что связано с этой клеткой
      const qq2 = [[x, y]];
      while (qq2.length) { const [cx, cy] = qq2.pop(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = `${cx + dx}_${cy + dy}`; if (!reach.has(k) && pass(cx + dx, cy + dy)) { reach.add(k); qq2.push([cx + dx, cy + dy]); } } }
    }
  }
  function generate(tpl, o = {}) {
    const T = TEMPLATES[tpl] || TEMPLATES.forest, mw = T.minW || 12, mh = T.minH || 10;
    const w = Math.max(mw, Math.min(80, o.w || T.w)), h = Math.max(mh, Math.min(80, o.h || T.h));
    const R = rng(o.seed || 1), G = grid(w, h);
    const out = { w, h, doors: {}, lights: [], chests: [], rooms: [], start: { x: 1, y: Math.floor(h / 2) }, ground: '', amb: 'bright', fog: 'off' };
    T.fn(G, R, { density: o.density != null ? o.density : 0.3, road: o.road != null ? o.road : !!T.road, chests: o.chests != null ? o.chests : !!T.chests }, out);
    if (T.kind === 'terrain' || T.connect) { if (SOLID.has(G.get(out.start.x, out.start.y))) G.set(out.start.x, out.start.y, ''); connectOutdoor(G, out); }
    // Двери и сундуки — только на проходимых клетках
    out.cells = {};
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (G.g[y][x]) out.cells[`${x}_${y}`] = G.g[y][x];
    Object.keys(out.doors).forEach((k) => { if (out.cells[k] === 'wall') delete out.doors[k]; });
    out.chests = out.chests.filter((c, i, a) => !['wall', 'rock', 'tree', 'water', 'furn'].includes(out.cells[`${c.x}_${c.y}`]) && a.findIndex((d) => d.x === c.x && d.y === c.y) === i && !out.doors[`${c.x}_${c.y}`]);
    return out;
  }
  return { TEMPLATES, generate };
})();
