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
  // get/set работают с текущим G.g: автомат подменяет массив клеток целиком
  function grid(w, h, fill = '') {
    const inb = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
    const G = { w, h, g: Array.from({ length: h }, () => Array(w).fill(fill)), inb };
    G.get = (x, y) => (inb(x, y) ? G.g[y][x] : 'wall');
    G.set = (x, y, v) => { if (inb(x, y)) G.g[y][x] = v; };
    return G;
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
      const pc = i ? c : null;
      drift = Math.max(-1, Math.min(1, drift + (R.f() - 0.5) * 0.8));
      c = Math.max(1, Math.min(span - width - 1, Math.round(c + drift)));
      // Ручей пересекает дорогу прямо: пока под ним дорога, вбок он не уходит — мост выходит коротким и ровным, без лишних кусков
      if (t === 'water' && pc != null) { for (let j = 0; j < width; j++) if (['road', 'bridge'].includes(G.get(vertical ? pc + j : i, vertical ? i : pc + j))) { c = pc; drift = 0; break; } }
      path.push(c);
      // Сдвиг вбок закрывается клеткой-перемычкой (иначе ручей в одну клетку рвётся по диагонали);
      // дорога через воду и вода через дорогу — мост
      for (let v = pc == null ? c : Math.min(pc, c), hi = (pc == null ? c : Math.max(pc, c)) + width - 1; v <= hi; v++) {
        const x = vertical ? v : i, y = vertical ? i : v, cur = G.get(x, y);
        if (!keep(cur)) G.set(x, y, t === 'road' && cur === 'water' ? 'bridge' : t); else if (t === 'water' && cur === 'road') G.set(x, y, 'bridge');
      }
    }
    return path;
  }
  // Пруд или озеро: сплошное пятно с неровным берегом, в стороне от дороги и построек
  function pond(G, R, rmin, rmax, t = 'water') {
    for (let k = 0; k < 40; k++) {
      const r = R.i(rmin, rmax), cx = R.i(r + 2, G.w - r - 3), cy = R.i(r + 2, G.h - r - 3), ph = R.f() * 6.28, n = R.i(2, 4);
      let ok = true;
      for (let y = cy - r - 2; y <= cy + r + 2 && ok; y++) for (let x = cx - r - 2; x <= cx + r + 2; x++) if (['road', 'bridge', 'wall', 'floor', 'furn'].includes(G.get(x, y))) { ok = false; break; }
      if (!ok) continue;
      for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) if (Math.hypot(x - cx, (y - cy) * 1.2) <= r * (0.82 + 0.2 * Math.sin(Math.atan2(y - cy, x - cx) * n + ph)) + 0.35) G.set(x, y, t);
      return true;
    }
    return false;
  }
  // Место под постройку: вода (и дорога, пока есть попытки) под неё не попадает — ручей и дорога не рвутся
  const siteBusy = (G, x, y, w, h, roads) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { const v = G.get(i, j); if (v === 'water' || v === 'bridge' || (roads && v === 'road')) return true; } return false; };
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
  // closed — дом под крышей: внутри клетки «крыша» (непроходимы и непрозрачны), интерьер создаётся отдельной сценой при входе в дверь
  function building(G, out, x, y, w, h, side, R, lockP = 0, closed = false) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) G.set(i, j, j === y || j === y + h - 1 || i === x || i === x + w - 1 ? 'wall' : closed ? 'roof' : 'floor');
    const d = side === 'n' ? [x + Math.floor(w / 2), y] : side === 's' ? [x + Math.floor(w / 2), y + h - 1] : side === 'w' ? [x, y + Math.floor(h / 2)] : [x + w - 1, y + Math.floor(h / 2)];
    G.set(d[0], d[1], '');
    out.doors[`${d[0]}_${d[1]}`] = { o: 0, ...(R && R.ch(lockP) ? { l: 1 } : {}) };
    out.rooms.push({ x: x + 1, y: y + 1, w: w - 2, h: h - 2, kind: 'house', ...(closed ? { closed: 1, door: `${d[0]}_${d[1]}` } : {}) });
    return d;
  }
  // Починка проходимости: в комнату, куда нельзя дойти от входа, прорубается дверь в сторону открытого двора,
  // а если такой стороны нет — с пути убираются деревья, ящики и кусты
  const HARD = new Set(['wall', 'tree', 'rock', 'furn', 'lava', 'chasm', 'grave', 'mushroom', 'crate', 'board', 'well', 'roof', 'water']);
  const SOFT = new Set(['tree', 'crate', 'bush', 'mushroom']);
  function reachFrom(G, s0) {
    const ok = (x, y) => x >= 0 && y >= 0 && x < G.w && y < G.h && !HARD.has(G.get(x, y));
    const seen = new Set([`${s0.x}_${s0.y}`]), q = [[s0.x, s0.y]];
    while (q.length) {
      const [x, y] = q.pop();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const k = `${x + dx}_${y + dy}`; if (!seen.has(k) && ok(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } });
    }
    return seen;
  }
  function fixReach(G, out, box) {
    if (!out.start) return;
    const inRoom = (r, set) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (set.has(`${x}_${y}`)) return true; return false; };
    for (let pass = 0; pass < 12; pass++) {
      const seen = reachFrom(G, out.start);
      const r = out.rooms.find((q) => !q.closed && !q.unreach && q.w > 0 && q.h > 0 && !inRoom(q, seen) && G.get(q.x, q.y) !== undefined && [...Array(q.w * q.h).keys()].some((i) => !HARD.has(G.get(q.x + (i % q.w), q.y + Math.floor(i / q.w)))));
      if (!r) return;
      // 1) Стена комнаты, за которой — достижимая клетка: там новая дверь
      const cand = [];
      for (let x = r.x; x < r.x + r.w; x++) { cand.push([x, r.y - 1, x, r.y - 2, x, r.y]); cand.push([x, r.y + r.h, x, r.y + r.h + 1, x, r.y + r.h - 1]); }
      for (let y = r.y; y < r.y + r.h; y++) { cand.push([r.x - 1, y, r.x - 2, y, r.x, y]); cand.push([r.x + r.w, y, r.x + r.w + 1, y, r.x + r.w - 1, y]); }
      const good = cand.filter(([wx, wy, ox, oy, ix, iy]) => G.get(wx, wy) === 'wall' && seen.has(`${ox}_${oy}`) && !HARD.has(G.get(ix, iy)) && (!box || (ox > box[0] && oy > box[1] && ox < box[2] && oy < box[3])));
      if (good.length) {
        const [wx, wy] = good[Math.floor(good.length / 2)];
        G.set(wx, wy, G.get(wx + 1, wy) === 'floor' || G.get(wx - 1, wy) === 'floor' || G.get(wx, wy + 1) === 'floor' || G.get(wx, wy - 1) === 'floor' ? 'floor' : '');
        out.doors[`${wx}_${wy}`] = { o: 0 };
        continue;
      }
      // 2) Путь до достижимого через мягкие преграды: их убираем
      const start = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!HARD.has(G.get(x, y))) start.push([x, y]);
      const prev = new Map(start.map(([x, y]) => [`${x}_${y}`, null])), q = [...start];
      let hit = null;
      while (q.length && !hit) {
        const [x, y] = q.shift();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, k = `${nx}_${ny}`, c = G.get(nx, ny);
          if (prev.has(k) || nx < 0 || ny < 0 || nx >= G.w || ny >= G.h) continue;
          if (HARD.has(c) && !SOFT.has(c) && !out.doors[k]) continue;
          prev.set(k, `${x}_${y}`);
          if (seen.has(k)) { hit = k; break; }
          q.push([nx, ny]);
        }
      }
      if (!hit) { r.unreach = 1; continue; }
      for (let k = hit; k; k = prev.get(k)) { const [x, y] = k.split('_').map(Number); if (SOFT.has(G.get(x, y))) G.set(x, y, ''); }
    }
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
    // Чащи — густой подлесок: пройти можно, но вдвое медленнее
    blobs(G, R, 'thicket', Math.round(((G.w * G.h) / 160) * (0.5 + d * 2)), 2, 3, 0.7);
    const cx = R.i(Math.floor(G.w * 0.35), Math.floor(G.w * 0.65)), cy = R.i(Math.floor(G.h * 0.35), Math.floor(G.h * 0.65));
    clearCircle(G, cx, cy, Math.max(2, Math.floor(Math.min(G.w, G.h) / 5)));
    if (o.road) band(G, R, 'road', 2, false);
    if (R.ch(0.35)) band(G, R, 'water', 1, true, (v) => v === 'road');
    out.ground = 'grass'; out.start = openNear(G, 1, Math.floor(G.h / 2));
    const fv = o.variant || (R.ch(0.4) ? 'none' : R.pick(['hut', 'ruin', 'goblins', 'bandits', 'goblins', 'bandits', 'idol', 'fallen', 'fairy', 'circle']));
    if (fv === 'fairy' || fv === 'circle') place(G, R, o, out, fv); else feature(G, R, o, out, fv);
    // Поляны и поваленные деревья — в любом лесу
    for (let i = 0; i < R.i(1, 2); i++) { const c = site(G, R, out, 2); if (c) clearCircle(G, c[0], c[1], R.i(1, 2)); }
    place(G, R, o, out, 'logs');
    if (fv !== 'fairy' && R.ch(0.2)) place(G, R, o, out, 'fairy');
  }
  // Постройки на местности: лачуга (жилая или заброшенная) и лагерь гоблинов или бандитов
  function feature(G, R, o, out, f) {
    if (f === 'hut' || f === 'ruin') hut(G, R, o, out, f === 'ruin');
    if (f === 'goblins' || f === 'bandits') camp(G, R, o, out, f === 'goblins' ? 'goblin' : 'bandit');
    if (['idol', 'fallen', 'ford', 'mill', 'mine', 'rockslide', 'sunken', 'witch', 'pyramid', 'oasis', 'wreck', 'lighthouse'].includes(f)) {
      if (f === 'fallen' && !Object.values(G.g).some((row) => row.includes('water'))) band(G, R, 'water', 2, true, (v) => v === 'road');
      terrainFeature(G, R, out, f);
    }
  }
  // Лачуга на поляне: жилая — с огородом и светом в окне; заброшенная — с проломами, мусором и, бывает, забытым тайником
  // ---------- Особые места на местности ----------
  // Свободное место радиусом rad: не у входа, не на постройках, дороге и воде
  function site(G, R, out, rad) {
    for (let t = 0; t < 120; t++) {
      const x = R.i(rad + 2, G.w - rad - 3), y = R.i(rad + 2, G.h - rad - 3);
      if (Math.max(Math.abs(x - out.start.x), Math.abs(y - out.start.y)) < rad + 6) continue;
      let ok = true; for (let j = y - rad - 1; j <= y + rad + 1 && ok; j++) for (let i = x - rad - 1; i <= x + rad + 1; i++) if (['road', 'bridge', 'water', 'wall', 'floor', 'furn', 'chasm', 'lava', 'stairs'].includes(G.get(i, j)) || out.doors[`${i}_${j}`]) { ok = false; break; }
      if (ok) return [x, y];
    }
    return null;
  }
  const propAt = (G, out, x, y, p) => { G.set(x, y, 'furn'); (out.props || (out.props = {}))[`${x}_${y}`] = p; };
  function place(G, R, o, out, f) {
    if (f === 'circle') { // каменный круг: стоячие камни по кругу, в середине — плоский алтарный камень
      const c = site(G, R, out, 4); if (!c) return; const [cx, cy] = c; clearCircle(G, cx, cy, 4, '');
      const n = R.i(7, 10); for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, x = Math.round(cx + Math.cos(a) * 3.4), y = Math.round(cy + Math.sin(a) * 3.4); if (R.ch(0.85)) propAt(G, out, x, y, R.ch(0.2) ? 'menhir_f' : 'menhir'); }
      propAt(G, out, cx, cy, 'slab'); out.rooms.push({ x: cx - 3, y: cy - 3, w: 7, h: 7, kind: 'circle' });
    }
    if (f === 'fairy') { // кольцо фей: грибы по кругу на полянке
      const c = site(G, R, out, 3); if (!c) return; const [cx, cy] = c; clearCircle(G, cx, cy, 3, '');
      for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2, x = Math.round(cx + Math.cos(a) * 2.2), y = Math.round(cy + Math.sin(a) * 2.2); if (R.ch(0.6) && !(x === cx && y === cy)) G.set(x, y, 'mushroom'); }
      out.rooms.push({ x: cx - 2, y: cy - 2, w: 5, h: 5, kind: 'fairy' });
    }
    if (f === 'tower') { // развалины сторожевой башни: круглые стены разной высоты, проём, обломки, внутри тайник
      const c = site(G, R, out, 4); if (!c) return; const [cx, cy] = c; clearCircle(G, cx, cy, 4, '');
      const gap = R.i(0, 3), D = [[0, -1], [1, 0], [0, 1], [-1, 0]][gap];
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) { const d = Math.hypot(x - cx, y - cy); if (d < 2.2) G.set(x, y, 'floor'); else if (d < 3.2) G.set(x, y, 'wall'); }
      for (let k = 1; k <= 3; k++) G.set(cx + D[0] * k, cy + D[1] * k, k < 3 ? 'floor' : '');
      for (let i = 0; i < 2; i++) { const a = R.f() * 6.28, x = Math.round(cx + Math.cos(a) * 2.8), y = Math.round(cy + Math.sin(a) * 2.8); if (!(x === cx + D[0] * 3 && y === cy + D[1] * 3) && G.get(x, y) === 'wall' && R.ch(0.7)) G.set(x, y, 'rubble'); }
      for (let i = 0; i < 4; i++) { const a = R.f() * 6.28, x = Math.round(cx + Math.cos(a) * 4), y = Math.round(cy + Math.sin(a) * 4); if (G.get(x, y) === '') G.set(x, y, 'rubble'); }
      out.rooms.push({ x: cx - 3, y: cy - 3, w: 7, h: 7, kind: 'tower', ruin: true });
      if (R.ch(0.6)) out.chests.push({ x: cx - D[0], y: cy - D[1] });
    }
    if (f === 'barrow') { // курган: кольцо камней вокруг насыпи, на вершине — погребальный камень, внутри — клад
      const c = site(G, R, out, 4); if (!c) return; const [cx, cy] = c; clearCircle(G, cx, cy, 4, '');
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (Math.hypot(x - cx, y - cy) <= 2.3) G.set(x, y, 'slope');
      for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2, x = Math.round(cx + Math.cos(a) * 3.6), y = Math.round(cy + Math.sin(a) * 3.6); if (R.ch(0.7)) propAt(G, out, x, y, 'menhir_s'); }
      G.set(cx, cy, 'grave'); out.chests.push({ x: cx + 1, y: cy });
      out.rooms.push({ x: cx - 3, y: cy - 3, w: 7, h: 7, kind: 'barrow' });
    }
    if (f === 'skeleton') { // кости великана: хребет, рёбра дугами, огромный череп
      const c = site(G, R, out, 5); if (!c) return; const [cx, cy] = c, hor = R.ch(0.5), L = R.i(6, 8);
      for (let t = 0; t < L; t++) { const x = hor ? cx - Math.floor(L / 2) + t : cx, y = hor ? cy : cy - Math.floor(L / 2) + t; if (t === 0) propAt(G, out, x, y, hor ? 'gskull_w' : 'gskull_n'); else propAt(G, out, x, y, hor ? 'spine_w' : 'spine_n'); if (t % 2 === 1 && t < L - 1) { propAt(G, out, hor ? x : x - 1, hor ? y - 1 : y, hor ? 'rib_n' : 'rib_w'); propAt(G, out, hor ? x : x + 1, hor ? y + 1 : y, hor ? 'rib_s' : 'rib_e'); } }
      out.rooms.push({ x: cx - 4, y: cy - 4, w: 9, h: 9, kind: 'bones' });
    }
    if (f === 'logs') { // поваленные деревья — по две клетки вдоль
      for (let n = 0; n < R.i(3, 6); n++) for (let t = 0; t < 30; t++) {
        const x = R.i(2, G.w - 4), y = R.i(2, G.h - 4), hor = R.ch(0.5), x2 = x + (hor ? 1 : 0), y2 = y + (hor ? 0 : 1);
        if (G.get(x, y) !== '' || G.get(x2, y2) !== '' || Math.hypot(x - out.start.x, y - out.start.y) < 4) continue;
        propAt(G, out, x, y, hor ? 'log_w' : 'log_n'); propAt(G, out, x2, y2, hor ? 'log_e' : 'log_s'); break;
      }
    }
    if (f === 'ravine') { // овраг поперёк карты: обрыв, через него — мостки (и мост на дороге)
      const hor = R.ch(0.5); band(G, R, 'chasm', 1, !hor, (v) => v === 'road');
      const len = hor ? G.w : G.h; let last = -99;
      for (let t = 2; t < len - 2; t++) {
        const cells = []; for (let s = 0; s < (hor ? G.h : G.w); s++) { const x = hor ? t : s, y = hor ? s : t; if (G.get(x, y) === 'chasm') cells.push([x, y]); }
        if (cells.length && t - last >= R.i(8, 11)) { cells.forEach(([x, y]) => G.set(x, y, 'bridge')); last = t; }
      }
    }
  }
  function hut(G, R, o, out, abandoned) {
    for (let t = 0; t < 80; t++) {
      const w = R.i(5, 6), h = R.i(4, 5), x = R.i(3, G.w - w - 3), y = R.i(3, G.h - h - 3);
      if (Math.max(Math.abs(x - out.start.x), Math.abs(y - out.start.y)) < 8 || (t < 72 && siteBusy(G, x - 2, y - 2, w + 4, h + 4, t < 50))) continue;
      fillRect(G, x - 2, y - 2, w + 4, h + 4, '');
      const side = R.pick(['n', 's', 'w', 'e']);
      building(G, out, x, y, w, h, side, R, abandoned ? 0 : 0.3);
      const r = out.rooms[out.rooms.length - 1];
      r.kind = 'hut';
      if (abandoned) {
        r.abandoned = true;
        for (let k = 0; k < 2; k++) { const bx = x + R.i(1, w - 2), by = R.pick([y, y + h - 1]); if (!out.doors[`${bx}_${by}`]) G.set(bx, by, 'rubble'); }
        G.set(x + 1, y + 1, 'rubble');
        if (o.chests || R.ch(0.5)) out.chests.push({ x: x + w - 2, y: y + h - 2 });
      } else {
        G.set(x + w - 2, y + 1, 'furn');
        out.lights.push({ x: x + 1, y: y + 1, b: 10, d: 10 });
        const gx = x + (side === 'w' ? w : -4);
        for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) if (G.get(gx + i, y + j) === '') G.set(gx + i, y + j, 'difficult');
      }
      return;
    }
  }
  // Лагерь: поляна, костёр, палатки по кругу; у гоблинов — частокол с проходом, у бандитов — повозки и ящики
  function camp(G, R, o, out, faction) {
    for (let t = 0; t < 80; t++) {
      const r = Math.max(3, Math.min(R.i(5, 7), Math.floor((Math.min(G.w, G.h) - 8) / 2))), cx = R.i(r + 3, G.w - r - 4), cy = R.i(r + 3, G.h - r - 4);
      if (Math.max(Math.abs(cx - out.start.x), Math.abs(cy - out.start.y)) < r + 8 || (t < 76 && siteBusy(G, cx - 3, cy - 3, 7, 7, true))) continue;
      // Поляна: ручей и дорога, если идут через лагерь, остаются как есть (у костра их нет — см. проверку выше)
      const kept = (x, y) => ['water', 'bridge', 'road'].includes(G.get(x, y)), cr = r + (faction === 'goblin' ? 1 : 0);
      for (let y = cy - cr; y <= cy + cr; y++) for (let x = cx - cr; x <= cx + cr; x++) if (Math.hypot(x - cx, y - cy) <= cr + 0.3 && !kept(x, y)) G.set(x, y, '');
      G.set(cx, cy, 'furn'); out.lights.push({ x: cx, y: cy + 1, b: 20, d: 20 });
      const n = R.i(3, 5), a0 = R.f() * Math.PI * 2;
      for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2, tr = Math.max(5, r - 1), tx = Math.round(cx + Math.cos(a) * tr - 0.5), ty = Math.round(cy + Math.sin(a) * tr - 0.5); if (![[0, 0], [1, 0], [0, 1], [1, 1]].some(([i, j]) => kept(tx + i, ty + j))) fillRect(G, tx, ty, 2, 2, 'furn'); } // палатки — по краю поляны, не вплотную к костру
      if (faction === 'goblin') {
        const gapA = R.f() * Math.PI * 2;
        for (let a = 0; a < Math.PI * 2; a += 0.06) {
          // Два прохода с противоположных сторон — частокол не перегородит карту
          if (Math.abs(Math.atan2(Math.sin(a - gapA), Math.cos(a - gapA))) < 0.45 || Math.abs(Math.atan2(Math.sin(a - gapA - Math.PI), Math.cos(a - gapA - Math.PI))) < 0.35) continue;
          const px = Math.round(cx + Math.cos(a) * (r + 1)), py = Math.round(cy + Math.sin(a) * (r + 1));
          if (!kept(px, py)) G.set(px, py, 'wall');
        }
      } else {
        // Повозка и ящики — там, где свободно и ни к чему не примыкают (иначе предметы слипаются)
        const lone = (cs) => cs.every(([x, y]) => G.get(x, y) === '' && [[0, -1], [1, 0], [0, 1], [-1, 0]].every(([ex, ey]) => cs.some(([a, b]) => a === x + ex && b === y + ey) || !['furn', 'crate'].includes(G.get(x + ex, y + ey))));
        for (let k = 0, put = 0; k < 30 && put < 2; k++) {
          const a = R.f() * Math.PI * 2, wx = Math.round(cx + Math.cos(a) * (r - 1)), wy = Math.round(cy + Math.sin(a) * (r - 1)), cs = put ? [[wx, wy]] : [[wx, wy], [wx, wy + 1]];
          if (Math.hypot(wx - cx, wy - cy) < 3.2 || !lone(cs)) continue;
          cs.forEach(([x, y]) => G.set(x, y, put ? 'crate' : 'furn')); put++;
        }
      }
      // Брёвна вокруг костра — на них сидят; seats — места между бревном и огнём (туда встают хозяева лагеря)
      const seats = [], gap = R.i(0, 3); // одна сторона всегда открыта — к костру можно подойти
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([dx, dy], side) => {
        const log = [-1, 0, 1].map((i) => [cx + dx * 2 + (dx ? 0 : i), cy + dy * 2 + (dy ? 0 : i)]), own = (x, y) => log.some(([a, b]) => a === x && b === y);
        if (side === gap || R.ch(0.15) || !log.every(([x, y]) => G.get(x, y) === '' && [[0, -1], [1, 0], [0, 1], [-1, 0]].every(([ex, ey]) => own(x + ex, y + ey) || G.get(x + ex, y + ey) !== 'furn'))) return;
        log.forEach(([x, y]) => { G.set(x, y, 'furn'); const sx = x - dx, sy = y - dy; if (G.get(sx, sy) === '' && !(sx === cx + 1 && sy === cy - 1) && !seats.some(([a, b]) => a === sx && b === sy)) seats.push([sx, sy]); });
      });
      out.rooms.push({ x: cx - r + 2, y: cy - r + 2, w: 2 * r - 3, h: 2 * r - 3, kind: 'camp', faction, seats });
      if (o.chests || R.ch(0.7)) out.chests.push({ x: cx + 1, y: cy - 1 });
      return;
    }
  }
  function river(G, R, o, out) {
    const vertical = R.ch(0.5), width = R.i(2, 4), path = band(G, R, 'water', width, vertical);
    // Берега: кусты и редкие деревья; переправа — мост или брод
    blobs(G, R, 'bush', Math.round((G.w * G.h) / 70), 1, 2, 0.6);
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 90 * (0.5 + o.density * 2)), 1, 3, 0.6);
    // Переправа целиком одного вида: мост (чаще) или брод — не вперемешку по клеткам
    const at = R.i(Math.floor(path.length * 0.3), Math.floor(path.length * 0.7)), cross = R.ch(0.3) ? 'difficult' : 'bridge';
    for (let k = 0; k < 2; k++) for (let j = 0; j < (vertical ? G.w : G.h); j++) {
      const x = vertical ? j : at + k, y = vertical ? at + k : j;
      if (G.get(x, y) === 'water') G.set(x, y, cross);
    }
    if (o.road) { // дорога к мосту с обеих сторон
      const L = vertical ? G.w : G.h;
      for (let s = 0; s < L; s++) for (let k = 0; k < 2; k++) { const x = vertical ? s : at + k, y = vertical ? at + k : s; if (['', 'bush', 'tree'].includes(G.get(x, y))) G.set(x, y, 'road'); }
    }
    for (let i = 0; i < width * 2; i++) { const p = R.i(0, path.length - 1), x = vertical ? path[p] + R.i(0, width - 1) : p, y = vertical ? p : path[p] + R.i(0, width - 1); if (G.get(x, y) === 'water' && R.ch(0.5)) G.set(x, y, 'rock'); }
    { const vf = o.variant || (R.ch(0.4) ? R.pick(['ford', 'mill']) : 'none'); if (vf !== 'none') feature(G, R, o, out, vf); }
    out.ground = 'grass'; out.start = openNear(G, vertical ? 1 : Math.floor(G.w / 2), vertical ? Math.floor(G.h / 2) : 1);
  }
  function mountains(G, R, o, out) {
    automaton(G, R, 'rock', 0.36 + o.density * 0.2, 4, false);
    keepLargest(G, (v) => v === 'rock', 'rock');
    // У скал — крутые склоны, кое-где осыпи
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '' && near8(G, x, y, 'rock') >= 2 && R.ch(0.5)) G.g[y][x] = 'slope';
    blobs(G, R, 'rubble', Math.round(2 + o.density * 4), 1, 2, 0.6);
    if (o.road) band(G, R, 'road', 2, false, (v) => false);
    blobs(G, R, 'tree', 3, 1, 2, 0.5);
    if (R.ch(0.4)) pond(G, R, 1, 2);
    // Заснеженные горы: снег на открытых местах, озёра подо льдом
    const snowy = R.ch(0.35);
    if (snowy) for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      const v = G.g[y][x];
      if (v === 'water') G.g[y][x] = 'ice';
      else if ((v === '' || v === 'slope') && R.ch(v === 'slope' ? 0.5 : 0.35)) G.g[y][x] = 'snow';
    }
    out.ground = snowy ? 'snow' : 'stone'; out.start = openNear(G, 1, Math.floor(G.h / 2));
    feature(G, R, o, out, o.variant || (R.ch(0.45) ? 'none' : R.pick(['goblins', 'bandits', 'ruin', 'goblins', 'mine', 'rockslide'])));
  }
  function plains(G, R, o, out) {
    blobs(G, R, 'bush', Math.round((G.w * G.h) / 90), 1, 2, 0.5);
    blobs(G, R, 'tree', Math.round(2 + o.density * 8), 1, 3, 0.6);
    for (let i = 0; i < G.w * G.h * 0.01; i++) { const x = R.i(0, G.w - 1), y = R.i(0, G.h - 1); if (G.get(x, y) === '') G.set(x, y, 'rock'); }
    if (o.road) band(G, R, 'road', 2, R.ch(0.3));
    if (R.ch(0.5)) pond(G, R, 2, 3);
    out.ground = 'grass'; out.start = openNear(G, 1, Math.floor(G.h / 2));
    const pv = o.variant || (R.ch(0.35) ? 'none' : R.pick(['bandits', 'hut', 'ruin', 'circle', 'barrow', 'tower', 'ravine']));
    if (['circle', 'barrow', 'tower', 'ravine'].includes(pv)) place(G, R, o, out, pv); else feature(G, R, o, out, pv);
    if (pv !== 'tower' && R.ch(0.2)) place(G, R, o, out, 'tower');
  }
  function swamp(G, R, o, out) {
    automaton(G, R, 'water', 0.42 + o.density * 0.1, 3, false);
    // Топь у воды — глубокое болото, дальше — просто вязкая земля
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '' && R.ch(0.45)) G.g[y][x] = near8(G, x, y, 'water') >= 2 ? 'bog' : 'difficult';
    const soft = (v) => v === '' || v === 'difficult' || v === 'bog';
    blobs(G, R, 'bush', Math.round((G.w * G.h) / 70), 1, 2, 0.6, soft);
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 120 * (0.5 + o.density * 2)), 1, 2, 0.5, soft);
    blobs(G, R, 'thicket', Math.round((G.w * G.h) / 260), 1, 2, 0.6, soft);
    if (o.road) band(G, R, 'bridge', 1, false);
    { const vf = o.variant || (R.ch(0.4) ? R.pick(['sunken', 'witch']) : 'none'); if (vf !== 'none') feature(G, R, o, out, vf); }
    out.ground = 'swamp'; out.start = openNear(G, 1, Math.floor(G.h / 2), (v) => soft(v) || v === 'bridge');
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
    { const vf = o.variant || (R.ch(0.3) ? 'pyramid' : R.ch(0.45) ? 'skeleton' : 'none'); if (vf === 'skeleton') place(G, R, o, out, vf); else if (vf !== 'none') feature(G, R, o, out, vf); }
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
    { const vf = o.variant || (R.ch(0.4) ? R.pick(['wreck', 'lighthouse']) : 'none'); if (vf !== 'none') feature(G, R, o, out, vf); }
    out.ground = 'grass'; out.start = openNear(G, 1, Math.floor(G.h / 2));
  }

  /* --- Новые шаблоны --- */
  // Комнаты в толще стен, коридоры между ними (с петлями) и двери на входах — для склепов, шахт, канализации, особняков
  function carveRooms(G, R, out, o) {
    const { n, wMin = 3, wMax = 7, hMin = 3, hMax = 6, gap = 2, x0 = 1, y0 = 1, x1 = G.w - 1, y1 = G.h - 1, doorP = 0.6, lockP = 0.1, floor = 'floor' } = o;
    const rooms = [];
    for (let t = 0; t < 400 && rooms.length < n; t++) {
      const w = R.i(wMin, wMax), h = R.i(hMin, hMax), x = R.i(x0, x1 - w - 1), y = R.i(y0, y1 - h - 1);
      if (x < x0 || y < y0 || rooms.some((r) => x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y)) continue;
      rooms.push({ x, y, w, h });
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) G.g[j][i] = floor;
    }
    rooms.sort((a, b) => a.x + a.y * 0.3 - (b.x + b.y * 0.3));
    const cen = (r) => [r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2)];
    const carve = (x, y) => { if (G.get(x, y) === 'wall' && x > x0 - 1 && y > y0 - 1 && x < x1 && y < y1) G.g[y][x] = 'corr'; };
    const corridor = (a, b) => {
      const [ax, ay] = cen(a), [bx, by] = cen(b);
      if (R.ch(0.5)) { for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, ay); for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(bx, y); }
      else { for (let y = Math.min(ay, by); y <= Math.max(ay, by); y++) carve(ax, y); for (let x = Math.min(ax, bx); x <= Math.max(ax, bx); x++) carve(x, by); }
    };
    for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
    for (let i = 0; i < Math.ceil(rooms.length / 4); i++) corridor(R.pick(rooms), R.pick(rooms));
    const inRoom = (x, y) => rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    for (let y = 1; y < G.h - 1; y++) for (let x = 1; x < G.w - 1; x++) {
      if (G.g[y][x] !== 'corr' || inRoom(x, y)) continue;
      const nr = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => inRoom(x + dx, y + dy));
      if (nr.length !== 1) continue;
      const [dx, dy] = nr[0];
      if (G.get(x + dy, y + dx) === 'wall' && G.get(x - dy, y - dx) === 'wall' && R.ch(doorP)) out.doors[`${x}_${y}`] = { o: 0, ...(R.ch(lockP) ? { l: 1 } : {}) };
    }
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === 'corr') G.g[y][x] = floor;
    return { rooms, cen };
  }
  const fillAll = (G, v) => { for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) G.g[y][x] = v; };
  // Свободно ли вокруг клетки внутри комнаты (чтобы не загородить вход)
  const freeAround = (G, r, x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy, o_ = nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h; if (o_ && G.get(nx, ny) !== 'wall') return false; } return true; };
  // ---------- Сюжетная начинка: что это за комната и что в ней случилось ----------
  const ROOM_N = { entrance: 'Вход', boss: 'Логово', hall: 'Зал', crypt: 'Склеп', storage: 'Кладовая', shrine: 'Святилище', barracks: 'Казарма', armory: 'Оружейная', guard: 'Караульная',
    mess: 'Трапезная', statues: 'Зал статуй', fountain: 'Фонтанный зал', ritual: 'Ритуальный зал', cells: 'Темница', niches: 'Зал ниш', pool: 'Затопленный зал', chasm: 'Провал',
    river: 'Подземная река', traps: 'Зал-ловушка', library: 'Библиотека', prison: 'Тюрьма', throne: 'Тронный зал', lab: 'Лаборатория', treasury: 'Сокровищница', puzzle: 'Комната-загадка' };
  const ROOM_D = {
    entrance: ['Ступени уходят во тьму, на стенах копоть старых факелов.', 'Сквозняк несёт запах сырости и тлена; у порога — чьи-то брошенные ножны.'],
    hall: ['Высокий свод теряется в темноте, шаги отдаются эхом.', 'Пыльный зал; на стенах — выцветшие следы фресок.'],
    crypt: ['Саркофаги с полустёртыми именами; крышка одного сдвинута изнутри.', 'Запах тлена; на плитах — свечные огарки и засохшие цветы.'],
    storage: ['Бочки рассохлись, ящики разбиты — кто-то уже искал здесь поживу.', 'Мешки с истлевшим зерном; крысы шуршат за ящиками.'],
    shrine: ['Алтарь забытому божеству; подношения на нём совсем свежие.', 'Святилище; над алтарём — стёртый лик, глаза которого будто следят за вошедшими.'],
    barracks: ['Ряды коек с истлевшими одеялами; под одной — чей-то дневник.', 'Казарма; на стене углём отмечены дни — последний зачёркнут недавно.'],
    armory: ['Стойки почти пусты; в углу — ржавые, но годные щиты.', 'Оружейная; на точильном камне ещё блестит свежая стружка.'],
    guard: ['Стол с недоигранной партией в кости — караул ушёл в спешке.', 'Караульная; на крюке висит связка ключей.'],
    mess: ['Длинный стол, перевёрнутые миски; крысы доедают остатки.', 'Трапезная; котёл ещё тёплый.'],
    statues: ['Каменные воины смотрят на вход; у одного отбита голова.', 'Статуи героев; одна стоит иначе, чем на старой фреске у входа.'],
    fountain: ['Вода в чаше фонтана тёмная и неподвижная; на дне поблёскивают монеты.', 'Фонтан всё ещё журчит — откуда-то сверху сочится вода.'],
    ritual: ['Круг на полу начерчен свежей кровью; свечи ещё не догорели.', 'Ритуальный зал; в воздухе — запах серы и палёной шерсти.'],
    cells: ['Клетки вдоль стен; в одной — кости и обрывки одежды.', 'Темница; из дальней клетки доносится тихий плач.'],
    niches: ['В нишах — урны с прахом; печати на некоторых не тронуты.', 'Погребальные ниши; на одной урне выбит знак знатного рода.'],
    pool: ['Вода по колено, холодная; под ней угадывается мозаика.', 'Зал затоплен; по воде расходятся круги, хотя здесь никого нет.'],
    boss: ['Логово хозяина подземелья: следы когтей на полу, кости у стен.', 'Сердце подземелья; здесь холоднее, чем везде, и тихо, как в склепе.'],
    chasm: ['Пол обрывается в пропасть; снизу тянет холодом и слышен далёкий плеск.'], river: ['Чёрная вода быстро бежит по каменному руслу.'],
    traps: ['Пол из ровных плит, некоторые чуть выше остальных; в стенах — узкие прорези.'], library: ['Стеллажи с отсыревшими книгами; одна раскрыта на кафедре.'],
    prison: ['Окованные двери камер; в одной кто-то есть.'], throne: ['Трон у дальней стены, к нему ведёт истёртый ковёр.'], lab: ['Котёл, перегонные кубы, полки с мутными склянками; пахнет серой.'],
    treasury: ['Сундуки и россыпи монет за запертыми дверями.'], puzzle: ['Три рычага на стенах и сфера на постаменте посредине.'],
  };
  // Событие в комнате: описание и следы на полу
  const ROOM_EV = [
    ['battle', 'Здесь недавно был бой: кровь на плитах, обломки оружия, следы волочения к выходу.'],
    ['camp', 'Брошенный лагерь: остывшее кострище, скатка — ушли дня два-три назад.'],
    ['dig', 'Кто-то копал: плиты сняты, в полу яма, рядом лопата — искали что-то под полом.'],
    ['tracks', 'Свежие следы в пыли ведут через комнату — кто-то прошёл здесь совсем недавно.'],
    ['collapse', 'Часть свода обвалилась; из-под камней торчит рука в латной перчатке.'],
  ];
  // Связность: всё, куда можно ступить, должно быть достижимо от входа (sx, sy). Если часть карты отрезана предметами,
  // поставленными генератором (cand — их клетки), убираем тот, что стоит на границе отрезанного, — и так, пока не откроется всё
  function unblock(G, out, sx, sy, cand) {
    const block = (x, y) => ['wall', 'furn', 'crate', 'grave'].includes(G.get(x, y)), D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let pass = 0; pass < 80; pass++) {
      const seen = new Set([`${sx}_${sy}`]), q = [[sx, sy]];
      while (q.length) { const [x, y] = q.pop(); D.forEach(([dx, dy]) => { const k = `${x + dx}_${y + dy}`; if (!seen.has(k) && G.inb(x + dx, y + dy) && !block(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } }); }
      let fix = null;
      for (const k of cand) { const [x, y] = k.split('_').map(Number); if (!block(x, y)) continue; const nb = D.map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => G.inb(a, b) && !block(a, b)); if (nb.some(([a, b]) => seen.has(`${a}_${b}`)) && nb.some(([a, b]) => !seen.has(`${a}_${b}`))) { fix = [x, y, k]; break; } }
      if (!fix) return;
      G.set(fix[0], fix[1], 'floor'); if (out.props) delete out.props[fix[2]]; cand.delete(fix[2]);
    }
  }
  // Склеп и катакомбы: тесные залы с саркофагами вдоль стен, оссуарий, главная гробница
  function crypt(G, R, o, out) {
    fillAll(G, 'wall');
    const { rooms, cen } = carveRooms(G, R, out, { n: Math.max(5, Math.round((G.w * G.h) / 55)), wMin: 3, wMax: 6, hMin: 3, hMax: 5, lockP: 0.2 });
    rooms.forEach((r, i) => {
      const kind = i === 0 ? 'entrance' : i === rooms.length - 1 ? 'boss' : R.pick(['tomb', 'tomb', 'ossuary', 'shrine']);
      out.rooms.push({ ...r, kind });
      if (kind === 'tomb' || kind === 'boss') for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) [r.y, r.y + r.h - 1].forEach((y) => { if (freeAround(G, r, x, y) && R.ch(0.8)) G.set(x, y, 'grave'); });
      if (kind === 'boss') { const [cx, cy] = cen(r); G.set(cx, cy, 'grave'); out.lights.push({ x: cx, y: cy - 1, b: 10, d: 20 }); }
      if (kind === 'ossuary') blobs(G, R, 'rubble', 1, 1, 1, 0.8, (v) => v === 'floor');
      if (kind === 'shrine') { const [cx, cy] = cen(r); G.set(cx, cy, 'furn'); out.lights.push({ x: cx, y: cy, b: 10, d: 10 }); }
      if (i > 0 && (kind === 'boss' || R.ch(o.chests ? 0.3 : 0))) out.chests.push({ x: r.x + r.w - 1, y: r.y + Math.floor(r.h / 2), room: i, boss: kind === 'boss' });
    });
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision';
    if (rooms.length) {
      const [x, y] = cen(rooms[0]); out.start = { x, y };
      // Саркофаги вдоль стен могли перегородить проход коридора по краю зала — убираем лишние
      const cand = new Set(); for (let j = 0; j < G.h; j++) for (let i = 0; i < G.w; i++) if (['grave', 'furn'].includes(G.get(i, j))) cand.add(`${i}_${j}`);
      unblock(G, out, x, y, cand);
    }
  }
  // Храм: неф со скамьями и алтарём, боковые часовни, двор с кладбищем
  function temple(G, R, o, out) {
    // Ширина нечётная: проход и алтарь — точно посередине
    const w0 = Math.min(G.w - 8, R.i(15, 19)), w = w0 - ((w0 + 1) % 2), h = Math.min(G.h - 8, R.i(19, 25)), x = Math.floor((G.w - w) / 2), y = 3;
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 120), 1, 2, 0.6);
    fillRect(G, x - 2, y - 2, w + 4, h + 4, '');
    building(G, out, x, y, w, h, 's', R, 0);
    const r = out.rooms[out.rooms.length - 1]; r.kind = 'nave';
    out.props = {};
    const put = (i, j, p) => { G.set(i, j, 'furn'); out.props[`${i}_${j}`] = p; };
    const ax = x + Math.floor(w / 2);
    // Алтарная часть: у дальней стены — заалтарный образ, перед ним алтарь, по сторонам подсвечники, сбоку кафедра
    for (let i = ax - 1; i <= ax + 1; i++) { put(i, y + 1, 'retable'); put(i, y + 2, 'altar'); }
    [ax - 3, ax + 3].forEach((i) => { put(i, y + 2, 'candelabra'); out.lights.push({ x: i, y: y + 2, b: 20, d: 20 }); });
    put(ax - 3, y + 4, 'lectern');
    out.rooms.push({ x: ax - 2, y: y + 3, w: 5, h: 2, kind: 'altar' });
    // Скамьи рядами по обе стороны прохода — все смотрят на алтарь; по проходу — ковровая дорожка
    for (let j = y + 6; j < y + h - 3; j += 2) { for (let i = x + 2; i <= ax - 2; i++) put(i, j, 'pew'); for (let i = ax + 2; i <= x + w - 3; i++) put(i, j, 'pew'); }
    for (let j = y + 3; j <= y + h - 2; j++) out.props[`${ax}_${j}`] = 'rug';
    out.props[`${ax - 1}_${y + 3}`] = 'rug'; out.props[`${ax + 1}_${y + 3}`] = 'rug';
    for (let j = y + 8; j < y + h - 2; j += 5) out.lights.push({ x: x + 1, y: j, b: 15, d: 15 }, { x: x + w - 2, y: j, b: 15, d: 15 });
    // Часовни по бокам
    const cw = 5, ch = 5;
    [[x - cw + 1, y + 3, 'e'], [x + w - 1, y + 3, 'w']].forEach(([cx, cy, side]) => {
      if (cx < 1 || cx + cw >= G.w) return;
      building(G, out, cx, cy, cw, ch, side, R, 0.2);
      out.rooms[out.rooms.length - 1].kind = 'chapel';
      put(side === 'e' ? cx + 1 : cx + cw - 2, cy + 2, 'altar');
      out.lights.push({ x: cx + 2, y: cy + 1, b: 10, d: 10 });
      if (o.chests && R.ch(0.5)) out.chests.push({ x: cx + 2, y: cy + 3 });
    });
    // Кладбище у храма
    const gy = y + h + 2;
    for (let j = gy; j < G.h - 2; j += 2) for (let i = 2; i < G.w - 2; i += 2) if (G.get(i, j) === '' && Math.abs(i - ax) > 2 && R.ch(0.45)) G.set(i, j, 'grave');
    for (let j = y + h; j < G.h; j++) G.set(ax, j, 'road');
    out.ground = 'grass'; out.start = { x: ax, y: G.h - 2 };
  }
  // Башня мага: круглые стены, лестница наверх в центре, лаборатория, библиотека, спальня — этажи связываются лестницами
  function tower(G, R, o, out) {
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 70), 1, 3, 0.6);
    blobs(G, R, 'rock', 4, 1, 2, 0.6);
    const cx = Math.floor(G.w / 2), cy = Math.floor(G.h / 2), rad = Math.max(5, Math.min(Math.floor(Math.min(G.w, G.h) / 2) - 3, 8));
    for (let y = cy - rad - 2; y <= cy + rad + 2; y++) for (let x = cx - rad - 2; x <= cx + rad + 2; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad + 1.5) G.set(x, y, d > rad - 0.5 ? 'wall' : 'floor');
    }
    // Перегородки: крест из стен с проходами — четыре зала
    for (let k = -rad + 1; k < rad; k++) { if (Math.abs(k) > 1) { G.set(cx + k, cy, 'wall'); G.set(cx, cy + k, 'wall'); } }
    G.set(cx, cy, 'stairs');
    [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(([dx, dy]) => G.set(cx + dx, cy + dy, 'floor'));
    const halls = [['lab', -1, -1], ['library', 1, -1], ['bedroom', -1, 1], ['vault', 1, 1]];
    halls.forEach(([kind, sx, sy]) => {
      const rx = sx < 0 ? cx - rad + 1 : cx + 1, ry = sy < 0 ? cy - rad + 1 : cy + 1, rw = rad - 1, rh = rad - 1;
      out.rooms.push({ x: rx, y: ry, w: rw, h: rh, kind: kind === 'vault' ? 'boss' : kind });
      const mx = rx + Math.floor(rw / 2), my = ry + Math.floor(rh / 2);
      if (kind === 'library') for (let x = rx + 1; x < rx + rw - 1; x++) if (G.get(x, my) === 'floor' && x !== cx) G.set(x, my, 'furn');
      if (kind === 'lab') { G.set(mx, my, 'furn'); out.lights.push({ x: mx, y: my - 1, b: 10, d: 20 }); }
      if (kind === 'bedroom') G.set(mx, my, 'furn');
      if (kind === 'vault') out.chests.push({ x: mx, y: my, boss: true });
    });
    // Вход снизу
    const dy = cy + rad;
    // Стена в две клетки толщиной: проход насквозь, дверь — во внутренней клетке; за ней — сени перед перегородкой
    for (let y = dy - 1; y <= dy + 2; y++) if (G.get(cx, y) === 'wall') G.set(cx, y, y === dy - 1 ? 'floor' : '');
    G.set(cx, dy, ''); out.doors[`${cx}_${dy}`] = { o: 0, ...(R.ch(0.4) ? { l: 1 } : {}) };
    for (let y = dy + 1; y < G.h; y++) if (G.get(cx, y) !== 'wall') G.set(cx, y, 'road');
    out.lights.push({ x: cx - 1, y: dy + 1, b: 10, d: 10 });
    out.ground = 'grass'; out.amb = 'dim'; out.start = { x: cx, y: G.h - 2 };
  }
  // Шахта: штольни (пещера) с рельсами, крепь из ящиков, обвалы
  function mine(G, R, o, out) {
    automaton(G, R, 'wall', 0.47, 4, true);
    keepLargest(G, (v) => v === 'wall', 'wall');
    // Рельсы — прямые штреки через гору
    for (let k = 0; k < R.i(2, 3); k++) {
      const vert = R.ch(0.4), c = R.i(3, (vert ? G.w : G.h) - 4);
      for (let i = 1; i < (vert ? G.h : G.w) - 1; i++) { const x = vert ? c : i, y = vert ? i : c; G.set(x, y, 'road'); }
    }
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '') G.g[y][x] = R.ch(0.06) ? 'rubble' : 'floor';
    // Ящики крепи — только на просторных местах, чтобы не перегородить штольню
    for (let i = 0; i < Math.round((G.w * G.h) / 150); i++) { const x = R.i(1, G.w - 2), y = R.i(1, G.h - 2); if (G.g[y][x] === 'floor' && near8(G, x, y, 'wall') === 0) G.g[y][x] = 'crate'; }
    // Рельсы соединили разные пещеры; отрезанные закутки — в камень
    const reg = keepLargest(G, (v) => v === 'wall' || v === 'crate', 'wall').filter(([x, y]) => x > 0 && y > 0 && x < G.w - 1 && y < G.h - 1);
    for (let i = 0; i < Math.round(reg.length / 70); i++) { const [x, y] = R.pick(reg); out.lights.push({ x, y, b: 15, d: 15 }); }
    const nooks = reg.filter(([x, y]) => near8(G, x, y, 'wall') >= 5);
    for (let i = 0; i < (o.chests ? 2 : 0) && nooks.length; i++) { const [x, y] = R.pick(nooks); out.chests.push({ x, y }); }
    out.rooms.push({ x: 0, y: 0, w: G.w, h: G.h, kind: 'cave' });
    const s = reg.slice().sort((a, b) => a[0] - b[0])[0] || [1, 1];
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision'; out.start = { x: s[0], y: s[1] };
  }
  // Кладбище: ограда с воротами, ряды надгробий, склеп-мавзолей, старые деревья
  function graveyard(G, R, o, out) {
    ringRect(G, 2, 2, G.w - 3, G.h - 3, 'wall');
    const gx = Math.floor(G.w / 2); G.set(gx, G.h - 3, ''); out.doors[`${gx}_${G.h - 3}`] = { o: 1 };
    for (let j = 4; j < G.h - 5; j += 2) for (let i = 4; i < G.w - 4; i += 2) if (Math.abs(i - gx) > 1 && R.ch(0.6)) G.set(i, j, 'grave');
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 160), 1, 1, 0.7);
    blobs(G, R, 'bush', 6, 1, 2, 0.5);
    const mw = 7, mh = 6, mx = R.ch(0.5) ? 4 : G.w - 4 - mw, my = 4;
    fillRect(G, mx - 1, my - 1, mw + 2, mh + 2, '');
    building(G, out, mx, my, mw, mh, 's', R, 0.5);
    out.rooms[out.rooms.length - 1].kind = 'boss';
    G.set(mx + 3, my + 2, 'grave');
    out.chests.push({ x: mx + 1, y: my + 1, boss: true });
    for (let y = G.h - 3; y < G.h; y++) G.set(gx, y, 'road');
    for (let y = 3; y < G.h - 3; y++) if (G.get(gx, y) !== 'wall') G.set(gx, y, 'road');
    out.lights.push({ x: gx - 1, y: G.h - 2, b: 10, d: 10 });
    out.rooms.push({ x: 3, y: 3, w: G.w - 6, h: G.h - 6, kind: 'yard' });
    out.ground = 'grass'; out.amb = 'dim'; out.fog = 'vision'; out.start = { x: gx, y: G.h - 1 };
  }
  // Руины города: обвалившиеся дома без крыш, завалы, заросли, площадь с колодцем
  function ruins(G, R, o, out) {
    blobs(G, R, 'thicket', Math.round((G.w * G.h) / 160), 1, 3, 0.6);
    for (let t = 0; t < 200 && out.rooms.length < Math.round((G.w * G.h) / 90); t++) {
      const w = R.i(5, 8), h = R.i(4, 7), x = R.i(2, G.w - w - 2), y = R.i(2, G.h - h - 2);
      if (!fits(G, x, y, w, h, (v) => v === '' || v === 'thicket')) continue;
      building(G, out, x, y, w, h, R.pick(['n', 's', 'w', 'e']), R, 0);
      out.rooms[out.rooms.length - 1].kind = R.ch(0.2) ? 'boss' : 'ruin';
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
        const c = G.get(i, j);
        if (c === 'wall' && R.ch(0.3)) G.set(i, j, 'rubble');
        else if (c === 'floor' && R.ch(0.15)) G.set(i, j, R.pick(['rubble', 'bush']));
      }
      if (o.chests && R.ch(0.3)) out.chests.push({ x: x + 1, y: y + 1 });
    }
    Object.keys(out.doors).forEach((k) => { if (R.ch(0.6)) delete out.doors[k]; }); // двери сгнили
    const px = Math.floor(G.w / 2), py = Math.floor(G.h / 2);
    clearCircle(G, px, py, 3, 'road'); G.set(px, py, 'well');
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 200), 1, 1, 0.6);
    out.ground = 'dirt'; out.amb = 'bright'; out.start = openNear(G, 1, Math.floor(G.h / 2));
  }
  // Перевал и мост над пропастью: скалы по краям, ущелье поперёк, узкая тропа; бывает снег
  function pass(G, R, o, out) {
    automaton(G, R, 'rock', 0.4, 3, false);
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) { const e = Math.min(y, G.h - 1 - y); if (e < 3 && R.ch(0.8)) G.g[y][x] = 'rock'; }
    const path = band(G, R, 'road', 2, false);
    if (o.variant !== 'pass') {
      const cx = R.i(Math.floor(G.w * 0.35), Math.floor(G.w * 0.65)), wid = R.i(3, 5);
      for (let y = 0; y < G.h; y++) for (let x = cx; x < cx + wid; x++) G.set(x + Math.round(Math.sin(y / 3) * 1.2), y, 'chasm');
      for (let x = cx - 2; x < cx + wid + 3; x++) for (let k = 0; k < 2; k++) G.set(x, path[Math.min(path.length - 1, x)] + k, 'bridge');
    }
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '' && near8(G, x, y, 'rock') >= 3 && R.ch(0.5)) G.g[y][x] = 'slope';
    blobs(G, R, 'rubble', 4, 1, 2, 0.6);
    const snowy = o.variant === 'snow' || (!o.variant && R.ch(0.35));
    if (snowy) for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (['', 'slope'].includes(G.g[y][x]) && R.ch(0.45)) G.g[y][x] = 'snow';
    out.ground = snowy ? 'snow' : 'stone'; out.start = openNear(G, 1, path[1] || Math.floor(G.h / 2), (v) => v === 'road' || v === '');
  }
  // Вулкан: реки и озёра лавы, остывшая корка, пепел и обломки
  function volcano(G, R, o, out) {
    automaton(G, R, 'rock', 0.33, 3, false);
    keepLargest(G, (v) => v === 'rock', 'rock');
    const v1 = R.ch(0.5);
    band(G, R, 'lava', R.i(2, 3), v1, (v) => v === 'rock');
    if (R.ch(0.6)) band(G, R, 'lava', 1, !v1, (v) => v === 'rock');
    blobs(G, R, 'lava', R.i(1, 3), 1, 3, 0.9, (v) => v === '');
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      if (G.g[y][x] === '' && near8(G, x, y, 'lava') > 0 && R.ch(0.5)) G.g[y][x] = 'difficult';
      else if (G.g[y][x] === '' && R.ch(0.08)) G.g[y][x] = R.pick(['rubble', 'slope']);
    }
    // Свечение лавы — источники света
    for (let i = 0; i < Math.round((G.w * G.h) / 120); i++) { const x = R.i(0, G.w - 1), y = R.i(0, G.h - 1); if (G.get(x, y) === 'lava') out.lights.push({ x, y, b: 10, d: 20 }); }
    out.ground = 'stone'; out.amb = 'dim'; out.start = openNear(G, 1, Math.floor(G.h / 2));
  }
  // Подземье: огромные пещеры, грибной лес, подземные озёра
  function underdark(G, R, o, out) {
    automaton(G, R, 'wall', 0.42, 5, true);
    keepLargest(G, (v) => v === 'wall', 'wall');
    blobs(G, R, 'mushroom', Math.round((G.w * G.h) / 90), 1, 2, 0.6);
    blobs(G, R, 'water', R.i(1, 3), 2, 3, 0.9);
    blobs(G, R, 'bog', 2, 1, 2, 0.6);
    // Грибы могли отрезать закутки — они становятся частью грибницы
    const reg = keepLargest(G, (v) => v === 'wall' || v === 'mushroom', 'mushroom');
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '') G.g[y][x] = R.ch(0.05) ? 'rubble' : 'floor';
    // Светящиеся грибы
    for (let i = 0; i < Math.round((G.w * G.h) / 150); i++) { const x = R.i(1, G.w - 2), y = R.i(1, G.h - 2); if (G.get(x, y) === 'mushroom') out.lights.push({ x, y, b: 5, d: 15 }); }
    const nooks = reg.filter(([x, y]) => G.g[y][x] === 'floor' && near8(G, x, y, 'wall') >= 5);
    for (let i = 0; i < (o.chests ? 2 : 0) && nooks.length; i++) { const [x, y] = R.pick(nooks); out.chests.push({ x, y }); }
    out.rooms.push({ x: 0, y: 0, w: G.w, h: G.h, kind: 'cave' });
    const s = reg.slice().sort((a, b) => a[0] - b[0])[0] || [1, 1];
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision'; out.start = { x: s[0], y: s[1] };
  }
  // Палуба корабля в море: борта, мачты, грузы, каюта на корме; вариант — два корабля сцеплены для абордажа
  function ship(G, R, o, out) {
    fillAll(G, 'water');
    const hull = (cx, cy, L, Wd) => {
      for (let y = cy - Wd; y <= cy + Wd; y++) for (let x = cx - L; x <= cx + L; x++) {
        const t = (x - cx) / L, half = Wd * (t > 0.55 ? Math.max(0.15, (1 - t) / 0.45) : 1);
        const d = Math.abs(y - cy);
        if (d <= half + 0.5) G.set(x, y, d > half - 0.5 ? 'wall' : 'floor');
      }
      // Мачты, груз, каюта на корме
      [-Math.floor(L / 2), 0, Math.floor(L / 2)].forEach((dx) => G.set(cx + dx, cy, 'furn'));
      for (let k = 0; k < 4; k++) { const x = cx + R.i(-L + 3, L - 4), y = cy + R.pick([-Wd + 1, Wd - 1]); if (G.get(x, y) === 'floor') G.set(x, y, 'crate'); }
      const kx = cx - L + 1;
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = kx; x < kx + 4; x++) if (G.get(x, y) === 'floor') G.set(x, y, x === kx + 3 || y === cy - 2 || y === cy + 2 ? 'wall' : 'floor');
      G.set(kx + 3, cy, 'floor'); out.doors[`${kx + 3}_${cy}`] = { o: 0 };
      out.rooms.push({ x: kx + 1, y: cy - 1, w: 2, h: 3, kind: 'boss' });
      out.rooms.push({ x: cx - L + 5, y: cy - Wd + 1, w: 2 * L - 8, h: 2 * Wd - 1, kind: 'deck' });
      out.chests.push({ x: kx + 1, y: cy, boss: true });
      out.lights.push({ x: cx, y: cy - 1, b: 20, d: 20 });
    };
    const two = o.variant === 'two' || (!o.variant && R.ch(0.4)), L = Math.max(8, Math.floor(G.w * (two ? 0.4 : 0.42))), Wd = Math.max(3, Math.min(5, Math.floor(G.h / (two ? 6 : 4))));
    if (two) {
      const y1 = Math.floor(G.h / 2) - Wd - 1, y2 = Math.floor(G.h / 2) + Wd + 1, cx = Math.floor(G.w / 2);
      hull(cx, y1, L, Wd); hull(cx, y2, L, Wd);
      for (let k = -2; k <= 2; k += 2) for (let y = y1 + Wd; y <= y2 - Wd; y++) G.set(cx + k * 2, y, 'bridge'); // абордажные мостки
      out.start = { x: cx, y: y2 + 1 };
    } else { const cx = Math.floor(G.w / 2), cy = Math.floor(G.h / 2); hull(cx, cy, L, Wd); out.start = { x: cx + Math.floor(L / 3), y: cy + 1 }; }
    out.ground = 'wood'; out.amb = 'bright';
  }
  // Особняк: дом с залами и коридорами, сад со стрижеными кустами и фонтаном
  function manor(G, R, o, out) {
    const w = Math.min(G.w - 6, R.i(22, 28)), h = Math.min(G.h - 10, R.i(14, 18)), x = Math.floor((G.w - w) / 2), y = 2;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) G.set(i, j, 'wall');
    const { rooms } = carveRooms(G, R, out, { n: 9, wMin: 4, wMax: 7, hMin: 3, hMax: 5, gap: 1, x0: x + 1, y0: y + 1, x1: x + w - 1, y1: y + h - 1, doorP: 0.9, lockP: 0.1 });
    const KIND = ['hall', 'dining', 'kitchen', 'library', 'bedroom', 'bedroom', 'study', 'gallery', 'cellar'];
    rooms.forEach((r, i) => {
      const kind = i === 0 ? 'hall' : KIND[i % KIND.length];
      out.rooms.push({ ...r, kind: kind === 'study' ? 'boss' : kind });
      const mx = r.x + Math.floor(r.w / 2), my = r.y + Math.floor(r.h / 2);
      if (['dining', 'library', 'study', 'bedroom'].includes(kind) && freeAround(G, r, mx, my)) G.set(mx, my, 'furn');
      if (R.ch(0.6)) out.lights.push({ x: r.x, y: r.y, b: 15, d: 15 });
      if (kind === 'study' && o.chests !== false) out.chests.push({ x: r.x + r.w - 1, y: r.y, boss: true });
    });
    // Парадный вход снизу: от ближайшей комнаты к краю дома
    const front = rooms.slice().sort((a, b) => b.y + b.h - (a.y + a.h))[0];
    const ex = front ? front.x + Math.floor(front.w / 2) : x + Math.floor(w / 2);
    for (let j = front ? front.y + front.h : y + h - 1; j < y + h; j++) G.set(ex, j, 'floor');
    G.set(ex, y + h - 1, ''); out.doors[`${ex}_${y + h - 1}`] = { o: 0 };
    // Сад
    for (let j = y + h + 1; j < G.h - 1; j++) G.set(ex, j, 'road');
    const fy = y + h + Math.floor((G.h - y - h) / 2);
    clearCircle(G, ex, fy, 2, 'road'); G.set(ex, fy, 'well');
    for (let j = y + h + 1; j < G.h - 1; j += 3) for (let i = 2; i < G.w - 2; i++) if (Math.abs(i - ex) > 3 && G.get(i, j) === '' && R.ch(0.7)) G.set(i, j, 'bush');
    blobs(G, R, 'tree', 4, 1, 1, 0.7);
    out.rooms.push({ x: 1, y: y + h + 1, w: G.w - 2, h: G.h - y - h - 2, kind: 'garden' });
    out.ground = 'grass'; out.start = { x: ex, y: G.h - 2 };
  }
  // Арена: овальные трибуны, песок, колонны, ворота и клетки бойцов
  function arena(G, R, o, out) {
    const cx = Math.floor(G.w / 2), cy = Math.floor(G.h / 2), a = Math.floor(G.w / 2) - 2, b = Math.floor(G.h / 2) - 2;
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      const d = Math.hypot((x - cx) / a, (y - cy) / b);
      G.g[y][x] = d > 1 ? '' : d > 0.8 ? 'wall' : d > 0.72 ? 'furn' : 'sand';
    }
    // Ворота с запада и востока, клетки бойцов за ними
    [[-1, 'w'], [1, 'e']].forEach(([s]) => {
      for (let x = cx + s * Math.floor(a * 0.72); Math.abs(x - cx) <= a; x += s) G.set(x, cy, 'sand');
      const gx = cx + s * Math.round(a * 0.8);
      out.doors[`${gx}_${cy}`] = { o: 0, l: 1 };
      out.rooms.push({ x: cx + s * Math.round(a * 0.86) - 1, y: cy - 1, w: 2, h: 3, kind: 'pit' });
    });
    for (let k = 0; k < 4; k++) { const ang = (Math.PI / 2) * k + Math.PI / 4; G.set(Math.round(cx + Math.cos(ang) * a * 0.4), Math.round(cy + Math.sin(ang) * b * 0.4), 'rock'); }
    out.rooms.push({ x: cx - Math.floor(a * 0.6), y: cy - Math.floor(b * 0.6), w: Math.floor(a * 1.2), h: Math.floor(b * 1.2), kind: 'ring' });
    out.rooms.push({ x: cx - 2, y: cy - b, w: 5, h: 2, kind: 'stands' });
    [[cx, cy - b + 1], [cx, cy + b - 1]].forEach(([x, y]) => out.lights.push({ x, y, b: 30, d: 30 }));
    for (let y = cy + Math.round(b * 0.8); y < G.h; y++) G.set(cx, y, 'road');
    G.set(cx, cy + Math.round(b * 0.8), ''); out.doors[`${cx}_${cy + Math.round(b * 0.8)}`] = { o: 1 };
    out.ground = 'dirt'; out.start = { x: cx, y: G.h - 1 };
  }
  // Канализация: каналы с водой и узкие дорожки вдоль них, мостки, коллекторы, логово
  function sewer(G, R, o, out) {
    fillAll(G, 'wall');
    const { rooms, cen } = carveRooms(G, R, out, { n: Math.max(4, Math.round((G.w * G.h) / 110)), wMin: 4, wMax: 8, hMin: 4, hMax: 6, doorP: 0.4 });
    // Главные каналы: вода посередине широких проходов
    for (let k = 0; k < 2; k++) {
      const vert = k === 1, c = R.i(4, (vert ? G.w : G.h) - 6);
      for (let i = 1; i < (vert ? G.h : G.w) - 1; i++) for (let j = -1; j <= 2; j++) {
        const x = vert ? c + j : i, y = vert ? i : c + j;
        G.set(x, y, j === 0 || j === 1 ? 'water' : 'floor');
      }
    }
    for (let i = 0; i < 6; i++) { const x = R.i(2, G.w - 3), y = R.i(2, G.h - 3); if (G.get(x, y) === 'water') G.set(x, y, 'bridge'); }
    rooms.forEach((r, i) => {
      out.rooms.push({ ...r, kind: i === 0 ? 'entrance' : i === rooms.length - 1 ? 'boss' : 'cistern' });
      if (R.ch(0.4)) blobs(G, R, 'bog', 1, 1, 1, 0.8, (v) => v === 'floor');
      if (i > 0 && (i === rooms.length - 1 || R.ch(o.chests ? 0.3 : 0))) out.chests.push({ x: r.x + r.w - 1, y: r.y + r.h - 1, boss: i === rooms.length - 1 });
    });
    const s = rooms.length ? cen(rooms[0]) : [2, 2];
    out.lights.push({ x: s[0], y: s[1], b: 10, d: 15 });
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision'; out.start = { x: s[0], y: s[1] };
  }
  // Логово дракона: пещера с огромным залом и сокровищницей; огненный — лава, синий — вода
  function lair(G, R, o, out) {
    automaton(G, R, 'wall', 0.45, 5, true);
    const cx = Math.floor(G.w * 0.6), cy = Math.floor(G.h / 2), r = Math.max(5, Math.floor(Math.min(G.w, G.h) / 3.2));
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r - 2; x <= cx + r + 2; x++) if (Math.hypot((x - cx) / 1.3, y - cy) <= r) G.set(x, y, '');
    // Тоннель от входа слева до зала
    let y = Math.floor(G.h / 2);
    for (let x = 1; x < cx; x++) { y = Math.max(2, Math.min(G.h - 3, y + R.i(-1, 1))); G.set(x, y, ''); G.set(x, y + 1, ''); }
    const reg = keepLargest(G, (v) => v === 'wall', 'wall');
    const fire = o.variant === 'red' || (!o.variant && R.ch(0.5));
    blobs(G, R, fire ? 'lava' : 'water', R.i(2, 3), 1, 2, 0.9, (v) => v === '');
    for (let yy = 0; yy < G.h; yy++) for (let x = 0; x < G.w; x++) if (G.g[yy][x] === '') G.g[yy][x] = R.ch(0.06) ? 'rubble' : 'floor';
    // Груда сокровищ
    for (let k = 0; k < 3; k++) out.chests.push({ x: cx + R.i(-1, 2), y: cy + R.i(-1, 1), boss: k === 0 });
    out.rooms.push({ x: cx - r, y: cy - r + 1, w: 2 * r, h: 2 * r - 1, kind: 'boss' });
    if (fire) for (let i = 0; i < 5; i++) { const p = R.pick(reg); if (p && G.get(p[0], p[1]) === 'lava') out.lights.push({ x: p[0], y: p[1], b: 10, d: 20 }); }
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision';
    const s = reg.slice().sort((a, b) => a[0] - b[0])[0] || [1, 1]; out.start = { x: s[0], y: s[1] };
  }
  // Ярмарка: площадь, ряды лотков с фонарями, шатры, сцена с артистами
  // Торговые ряды: лавка — прилавок в 2–3 клетки под навесом, продавец стоит за ним (комната 'stall', goods — чем торгует),
  // покупатели — перед ним; рядом ящики и бочки. Лавки смотрят вниз (поворот карты — в generate), между рядами — проход
  const STALL_GOODS = ['food', 'potions', 'cloth', 'weapons', 'pottery', 'curio', 'books', 'herbs', 'food', 'cloth'];
  function stalls(G, R, out, x0, y0, x1, y1) {
    out.props = out.props || {};
    const free = (x, y) => G.get(x, y) === 'road' && !out.doors[`${x}_${y}`];
    let n = R.i(0, STALL_GOODS.length - 1);
    for (let j = y0 + 1; j <= y1 - 1; j += x1 - x0 > 20 ? 5 : 4) for (let i = x0 + R.i(0, 1); i <= x1 - 1;) {
      const w = R.ch(0.6) ? 3 : 2;
      let ok = i + w - 1 <= x1 && !R.ch(0.1);
      for (let a = i - 1; ok && a <= i + w; a++) for (let b = j - 1; b <= j + 1; b++) if (!free(a, b)) { ok = false; break; }
      if (!ok) { i += 2; continue; }
      const goods = STALL_GOODS[n++ % STALL_GOODS.length];
      for (let a = i; a < i + w; a++) { G.set(a, j, 'furn'); out.props[`${a}_${j}`] = `stall:${goods}`; }
      out.rooms.push({ x: i, y: j - 1, w, h: 1, kind: 'stall', goods });
      if (R.ch(0.55)) out.lights.push({ x: i + (w > 2 ? 1 : 0), y: j, b: 10, d: 10 });
      if (R.ch(0.5)) G.set(i + w, j, 'crate');
      i += w + (x1 - x0 > 20 ? R.i(3, 4) : R.i(2, 3));
    }
  }
  function fair(G, R, o, out) {
    blobs(G, R, 'tree', 6, 1, 2, 0.6);
    const x0 = 3, y0 = 3, x1 = G.w - 4, y1 = G.h - 4;
    fillRect(G, x0, y0, x1 - x0, y1 - y0, 'road');
    // Сцена и два шатра
    const sx = Math.floor(G.w / 2) - 3;
    fillRect(G, sx, y0, 7, 2, 'floor'); out.rooms.push({ x: sx, y: y0, w: 7, h: 2, kind: 'stage' }); out.lights.push({ x: sx + 3, y: y0, b: 20, d: 20 });
    [[x0 + 1, y1 - 5], [x1 - 6, y1 - 5]].forEach(([tx, ty]) => { if (fits(G, tx, ty, 5, 4, (v) => v === 'road' || v === '')) { building(G, out, tx, ty, 5, 4, 'n', R, 0); out.rooms[out.rooms.length - 1].kind = 'tent'; } });
    // Ряды торговых лавок
    stalls(G, R, out, x0 + 1, y0 + 3, x1 - 2, y1 - 2);
    out.rooms.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind: 'market' });
    out.ground = 'grass'; out.start = { x: Math.floor(G.w / 2), y: G.h - 2 };
  }
  // Варианты уже знакомых местностей: особые места на карте
  function terrainFeature(G, R, out, f) {
    let cx = R.i(Math.floor(G.w * 0.3), Math.floor(G.w * 0.7)), cy = R.i(Math.floor(G.h * 0.3), Math.floor(G.h * 0.7));
    if (f === 'idol') {
      // Поляна с идолом — в стороне от ручья и дороги (они не рвутся)
      for (let t = 0; t < 40 && siteBusy(G, cx - 3, cy - 3, 7, 7, true); t++) { cx = R.i(Math.floor(G.w * 0.2), Math.floor(G.w * 0.8)); cy = R.i(Math.floor(G.h * 0.2), Math.floor(G.h * 0.8)); }
      clearCircle(G, cx, cy, 3, ''); G.set(cx, cy, 'rock'); [[-2, 0], [2, 0], [0, -2], [0, 2]].forEach(([dx, dy]) => G.set(cx + dx, cy + dy, 'grave')); out.lights.push({ x: cx, y: cy + 1, b: 10, d: 10 }); out.rooms.push({ x: cx - 2, y: cy - 2, w: 5, h: 5, kind: 'boss' }); }
    if (f === 'fallen') { // ствол поперёк воды в ближайшем к центру ряду, где она есть
      for (let d = 0; d < G.h; d++) {
        const y = cy + (d % 2 ? -1 : 1) * Math.ceil(d / 2), xs = [];
        for (let x = 0; x < G.w; x++) if (G.get(x, y) === 'water') xs.push(x);
        if (!xs.length) continue;
        const a = xs[0], b = xs.filter((x, i) => i === 0 || x - xs[i - 1] === 1).pop();
        for (let x = a; x <= b; x++) G.set(x, y, 'bridge'); // только над водой: концы настила сами ложатся на берег
        break;
      }
    }
    if (f === 'ford') { for (let y = 0; y < G.h; y++) for (let x = cx - 2; x <= cx + 2; x++) if (G.get(x, y) === 'water') G.set(x, y, 'difficult'); }
    if (f === 'mill') { fillRect(G, cx - 3, cy - 3, 8, 7, ''); building(G, out, cx - 2, cy - 2, 5, 5, 's', R, 0); out.rooms[out.rooms.length - 1].kind = 'hut'; G.set(cx + 3, cy, 'furn'); }
    if (f === 'mine') { clearCircle(G, cx, cy, 2, ''); G.set(cx, cy - 1, 'wall'); G.set(cx - 1, cy - 1, 'wall'); G.set(cx + 1, cy - 1, 'wall'); G.set(cx, cy, 'stairs'); G.set(cx + 2, cy + 1, 'crate'); out.lights.push({ x: cx - 1, y: cy, b: 10, d: 10 }); }
    if (f === 'rockslide') blobs(G, R, 'rubble', 1, 3, 4, 0.85);
    if (f === 'sunken') { for (let k = 0; k < 3; k++) { const x = cx + R.i(-4, 4), y = cy + R.i(-3, 3); ringRect(G, x, y, x + 3, y + 3, 'wall'); G.set(x + 1, y, 'rubble'); G.set(x + 1, y + 1, 'bog'); } out.rooms.push({ x: cx - 3, y: cy - 3, w: 7, h: 7, kind: 'boss', ruin: 1 }); }
    if (f === 'witch') { fillRect(G, cx - 3, cy - 3, 8, 7, 'difficult'); building(G, out, cx - 2, cy - 2, 5, 4, 's', R, 0.3); out.rooms[out.rooms.length - 1].kind = 'boss'; out.lights.push({ x: cx, y: cy - 1, b: 10, d: 10 }); out.chests.push({ x: cx - 1, y: cy - 1 }); }
    if (f === 'pyramid') { for (let r = 4; r >= 0; r--) ringRect(G, cx - r, cy - r, cx + r, cy + r, r % 2 ? 'rock' : 'sand'); G.set(cx, cy + 4, 'stairs'); out.rooms.push({ x: cx - 3, y: cy - 3, w: 7, h: 7, kind: 'boss' }); }
    if (f === 'oasis') { clearCircle(G, cx, cy, 3, ''); clearCircle(G, cx, cy, 1, 'water'); for (let i = 0; i < 6; i++) { const a = R.f() * Math.PI * 2; G.set(Math.round(cx + Math.cos(a) * 3), Math.round(cy + Math.sin(a) * 3), 'tree'); } }
    if (f === 'wreck') { for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 5; x <= cx + 5; x++) { const edge = Math.abs(y - cy) === 2 || Math.abs(x - cx) === 5; G.set(x, y, edge ? (R.ch(0.7) ? 'wall' : 'rubble') : 'floor'); } G.set(cx, cy, 'furn'); out.chests.push({ x: cx + 3, y: cy, boss: true }); out.rooms.push({ x: cx - 4, y: cy - 1, w: 9, h: 3, kind: 'boss', ruin: 1 }); }
    if (f === 'lighthouse') { const lx = Math.min(G.w - 4, cx + 6); for (let y = cy - 2; y <= cy + 2; y++) for (let x = lx - 2; x <= lx + 2; x++) G.set(x, y, Math.hypot(x - lx, y - cy) > 1.6 ? 'wall' : 'floor'); G.set(lx, cy, 'stairs'); G.set(lx - 2, cy, ''); out.doors[`${lx - 2}_${cy}`] = { o: 0 }; out.lights.push({ x: lx, y: cy, b: 60, d: 60 }); }
  }

  /* --- Мир: регион в масштабе миля на клетку --- */
  // Гладкий шум (сумма октав решёточного шума) — высота, влажность, температура; значения 0…1
  function noise(R, w, h, scale, oct = 4) {
    const out = Array.from({ length: h }, () => Array(w).fill(0));
    let amp = 1, tot = 0;
    const sm = (t) => t * t * (3 - 2 * t);
    for (let o = 0; o < oct; o++) {
      const s = Math.max(1.5, scale / 2 ** o), gw = Math.ceil(w / s) + 2, gh = Math.ceil(h / s) + 2;
      const L = Array.from({ length: gh }, () => Array.from({ length: gw }, () => R.f()));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const fx = x / s, fy = y / s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
        const a = L[y0][x0] + (L[y0][x0 + 1] - L[y0][x0]) * tx, b = L[y0 + 1][x0] + (L[y0 + 1][x0 + 1] - L[y0 + 1][x0]) * tx;
        out[y][x] += amp * (a + (b - a) * ty);
      }
      tot += amp; amp *= 0.5;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y][x] /= tot;
    return out;
  }
  const quant = (A, q) => { const v = A.flat().sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(q * v.length))]; };
  // Названия мест
  const PN1 = ['Камен', 'Сер', 'Тихо', 'Сосно', 'Дубо', 'Ясно', 'Черно', 'Бело', 'Ольхо', 'Волче', 'Медве', 'Красно', 'Дально', 'Зелено', 'Ветро', 'Звено', 'Хмеле', 'Ржаво', 'Лисо', 'Ворон'];
  const PN2 = ['град', 'бор', 'поле', 'водье', 'горье', 'брод', 'лесье', 'мост', 'долье', 'ярь', 'ница', 'ск', 'кам', 'дол', 'гать'];
  // Родительный падеж: «Руины Тиховодья», «Пещера Камнеграда»
  const PN2G = { град: 'града', бор: 'бора', поле: 'поля', водье: 'водья', горье: 'горья', брод: 'брода', лесье: 'лесья', мост: 'моста', долье: 'долья', ярь: 'яри', ница: 'ницы', ск: 'ска', кам: 'кама', дол: 'дола', гать: 'гати' };
  const TAVERNS = ['«Пьяный гоблин»', '«Серебряная кружка»', '«Три дуба»', '«Хромой пони»', '«Последний привал»', '«Тёплый очаг»', '«Сломанный щит»', '«Весёлый тролль»'];
  const RUINS = ['Руины', 'Забытый склеп', 'Старая крепость', 'Затонувший храм', 'Курган', 'Проклятая башня'];
  function world(G, R, o, out) {
    const w = G.w, h = G.h;
    const Hh = noise(R, w, h, Math.max(w, h) / 3, 5), M = noise(R, w, h, Math.max(w, h) / 2.5, 3), Tn = noise(R, w, h, Math.max(w, h) / 2, 2);
    // Где море: с одной стороны, островом или озёрами внутри
    const sea = R.pick(['n', 's', 'e', 'w', 'island', 'lakes']);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = { n: y / h, s: 1 - y / h, w: x / w, e: 1 - x / w }[sea];
      if (d != null) Hh[y][x] += Math.min(0.25, d * 0.6) - 0.12;
      if (sea === 'island') Hh[y][x] -= Math.max(0, Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) - 0.55) * 0.9;
    }
    const qSea = quant(Hh, sea === 'lakes' ? 0.1 : 0.24), qHill = quant(Hh, 0.76), qMount = quant(Hh, 0.87), qPeak = quant(Hh, 0.95);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const e = Hh[y][x], m = M[y][x], temp = (1 - y / h) * 0.25 + Tn[y][x] * 0.75; // севернее — холоднее (верх карты — север)
      let v = '';
      if (e < qSea) v = 'water';
      else if (e >= qPeak) v = 'rock';
      else if (e >= qMount) v = temp < 0.55 || e > quant(Hh, 0.92) ? 'snow' : 'slope';
      else if (e >= qHill) v = R.ch(0.55) ? 'slope' : m > 0.55 ? 'thicket' : '';
      else if (temp < 0.3) v = R.ch(0.7) ? 'snow' : m > 0.6 ? 'thicket' : '';
      else if (m > 0.66 && e < quant(Hh, 0.45)) v = R.ch(0.75) ? 'bog' : 'water';
      else if (m > 0.52) v = R.ch(0.12) ? 'tree' : 'thicket';
      else if (m < 0.3 && temp > 0.55) v = 'sand';
      else v = R.ch(0.05) ? 'bush' : '';
      G.g[y][x] = v;
    }
    // Берег — песок
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (['', 'bush', 'thicket'].includes(G.g[y][x]) && near8(G, x, y, 'water') >= 3 && R.ch(0.5)) G.g[y][x] = 'sand';
    // Реки: от гор вниз по склону к морю; в низине без выхода — озеро
    const nRiv = R.i(2, 4);
    for (let r = 0; r < nRiv; r++) {
      let x = 0, y = 0, ok = false;
      for (let t = 0; t < 200 && !ok; t++) { x = R.i(2, w - 3); y = R.i(2, h - 3); ok = Hh[y][x] >= qHill && Hh[y][x] < qPeak; }
      if (!ok) continue;
      const seen = new Set();
      for (let s = 0; s < w + h; s++) {
        seen.add(`${x}_${y}`);
        if (G.g[y][x] === 'water' && s > 2) break;
        G.g[y][x] = 'water';
        let best = null;
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          if (!G.inb(nx, ny) || seen.has(`${nx}_${ny}`)) return;
          const c = Hh[ny][nx] + R.f() * 0.02;
          if (!best || c < best[2]) best = [nx, ny, c];
        });
        if (!best || best[2] > Hh[y][x] + 0.03) { clearCircle(G, x, y, R.i(1, 2), 'water'); break; }
        [x, y] = best;
      }
    }
    // Места: города и деревни у воды и на равнинах, замок на холме, пещеры в горах, лагеря в лесах
    const land = (v) => ['', 'bush', 'sand', 'thicket', 'slope', 'snow'].includes(v);
    const pois = [], far = (x, y, d) => pois.every((p) => Math.max(Math.abs(p.x - x), Math.abs(p.y - y)) >= d);
    const place = (k, tpl, n, want, v = '') => {
      for (let t = 0; t < 400; t++) {
        const x = R.i(2, w - 3), y = R.i(2, h - 3), c = G.g[y][x];
        if (!land(c) || !want(x, y, c, t) || !far(x, y, t < 300 ? 7 : 4)) continue;
        pois.push({ x, y, k, tpl, n, ...(v ? { v } : {}) });
        return true;
      }
      return false;
    };
    const town = () => `${R.pick(PN1)}${R.pick(PN2)}`;
    const townOf = () => { const a = R.pick(PN1), b = R.pick(PN2); return `${a}${PN2G[b]}`; };
    const wet = (x, y) => near8(G, x, y, 'water') > 0 || [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => G.get(x + dx, y + dy) === 'water');
    for (let i = 0; i < R.i(1, 2); i++) place('city', 'city', town(), (x, y, c, t) => (c === '' || c === 'sand') && (t > 250 || wet(x, y)));
    for (let i = 0; i < R.i(3, 5); i++) place('village', 'village', town(), (x, y, c) => c === '' || c === 'bush' || c === 'snow');
    place('castle', 'castle', `Замок ${town()}`, (x, y, c, t) => c === 'slope' || t > 250);
    for (let i = 0; i < 2; i++) place('tavern', 'tavern', `Таверна ${R.pick(TAVERNS)}`, (x, y, c) => c === '' || c === 'bush');
    for (let i = 0; i < R.i(2, 3); i++) place('ruin', R.pick(['dungeon', 'ruins']), `${R.pick(RUINS)} ${townOf()}`, () => true);
    for (let i = 0; i < R.i(1, 2); i++) place('cave', 'cave', `Пещера ${townOf()}`, (x, y, c, t) => (c === 'slope' || c === 'snow') && (near8(G, x, y, 'rock') > 0 || t > 200));
    for (let i = 0; i < R.i(1, 2); i++) { const gob = R.ch(0.5); place('camp', gob ? 'forest' : 'plains', gob ? 'Лагерь гоблинов' : 'Лагерь разбойников', (x, y, c) => (gob ? c === 'thicket' : c === '' || c === 'bush'), gob ? 'goblins' : 'bandits'); }
    place('tower', 'tower', `Башня ${townOf()}`, (x, y, c) => ['', 'thicket', 'slope'].includes(c));
    if (R.ch(0.7)) place('temple', 'temple', `Храм ${R.pick(['Света', 'Зари', 'Луны', 'Бури', 'Жатвы', 'Странника'])}`, (x, y, c) => c === '' || c === 'bush');
    { const cr = R.ch(0.5); place('crypt', cr ? 'crypt' : 'graveyard', `${cr ? 'Склеп' : 'Кладбище'} ${townOf()}`, () => true); }
    place('mine', 'mine', `Шахта ${townOf()}`, (x, y, c, t) => c === 'slope' || c === 'snow' || t > 250);
    if (R.ch(0.6)) place('lair', 'lair', `Логово ${R.pick(['Пепельного', 'Лазурного', 'Древнего', 'Чёрного'])} дракона`, (x, y, c, t) => c === 'slope' || c === 'snow' || t > 250, R.ch(0.5) ? 'red' : 'blue');
    if (sea !== 'lakes') place('ship', 'ship', `Корабль «${R.pick(['Чайка', 'Морской волк', 'Удача', 'Кракен'])}»`, (x, y, c) => c === 'sand' && near8(G, x, y, 'water') > 1);
    pois.forEach((p) => { if (G.g[p.y][p.x] !== 'sand') G.g[p.y][p.x] = ''; });
    // Дороги между поселениями: самый дешёвый путь по местности; через воду — мосты
    const COST = { '': 1, bush: 1.2, sand: 1.3, road: 0.4, bridge: 0.4, thicket: 2, snow: 2.5, slope: 3, bog: 4, tree: 3, water: 9 };
    const path = (a, b) => {
      const dist = new Map([[`${a.x}_${a.y}`, 0]]), prev = new Map(), q = [[0, a.x, a.y]];
      while (q.length) {
        let bi = 0;
        for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
        const [d, x, y] = q.splice(bi, 1)[0];
        if (x === b.x && y === b.y) break;
        if (d > dist.get(`${x}_${y}`)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy, c = COST[G.get(nx, ny)];
          if (!G.inb(nx, ny) || c == null) continue;
          const nd = d + c, k = `${nx}_${ny}`;
          if (dist.has(k) && dist.get(k) <= nd) continue;
          dist.set(k, nd); prev.set(k, `${x}_${y}`); q.push([nd, nx, ny]);
        }
      }
      for (let k = prev.get(`${b.x}_${b.y}`); k && k !== `${a.x}_${a.y}`; k = prev.get(k)) {
        const [x, y] = k.split('_').map(Number), c = G.g[y][x];
        G.g[y][x] = c === 'water' || c === 'bridge' ? 'bridge' : 'road';
      }
    };
    const towns = pois.filter((p) => ['city', 'village', 'castle', 'tavern'].includes(p.k));
    for (let i = 1; i < towns.length; i++) {
      const b = towns[i], a = towns.slice(0, i).reduce((m, p) => (Math.hypot(p.x - b.x, p.y - b.y) < Math.hypot(m.x - b.x, m.y - b.y) ? p : m));
      path(a, b);
    }
    const home = pois.find((p) => p.k === 'village') || pois[0];
    out.pois = pois;
    out.ground = 'grass'; out.amb = 'bright'; out.fog = 'vision';
    out.start = home ? openNear(G, home.x + 1, home.y, (v) => land(v) || v === 'road') : openNear(G, Math.floor(w / 2), Math.floor(h / 2));
  }

  /* --- Локации --- */
  // Подземелье: комнаты, коридоры между ними, двери (иногда запертые), факелы, места для сундуков
  // Темы подземелья: виды комнат (кроме входа и логова), как стоят колонны, свет, особенности
  const DTHEME = {
    classic: { n: 'старое подземелье', kinds: ['hall', 'hall', 'crypt', 'storage', 'shrine'], pillars: ['corners', 'rows', 'rows', 'center', 'none', 'ring'], lights: 0, shapes: ['rect', 'rect', 'round', 'oct', 'ell', 'cross', 'niche'], special: ['chasm', 'river', 'traps', 'library', 'prison', 'throne', 'lab', 'treasury', 'puzzle'] },
    fort: { n: 'заброшенная крепость', kinds: ['barracks', 'armory', 'guard', 'mess', 'storage', 'hall'], pillars: ['corners', 'none', 'none', 'rows'], lights: 0.5, shapes: ['rect', 'rect', 'rect', 'ell', 'ell', 'oct'], special: ['prison', 'throne', 'treasury', 'traps', 'library'] },
    temple: { n: 'древний храм', kinds: ['hall', 'statues', 'shrine', 'fountain', 'statues', 'hall'], pillars: ['rows', 'rows', 'ring', 'center'], lights: 0.2, mosaic: 1, shapes: ['round', 'oct', 'cross', 'niche', 'rect', 'round'], special: ['puzzle', 'traps', 'library', 'chasm', 'treasury'] },
    cult: { n: 'логово культа', kinds: ['ritual', 'cells', 'shrine', 'storage', 'hall', 'cells'], pillars: ['none', 'corners', 'center'], lights: 0, blood: 1, shapes: ['round', 'oct', 'rect', 'ell', 'niche'], special: ['prison', 'lab', 'traps', 'puzzle', 'library'] },
    tomb: { n: 'гробница', kinds: ['niches', 'crypt', 'niches', 'statues', 'crypt'], pillars: ['rows', 'none', 'corners'], lights: 0, shapes: ['niche', 'niche', 'cross', 'oct', 'rect'], special: ['traps', 'treasury', 'puzzle', 'chasm'] },
    flooded: { n: 'затопленные руины', kinds: ['pool', 'hall', 'pool', 'storage', 'crypt', 'hall'], pillars: ['corners', 'rows', 'center', 'none'], lights: 0, shapes: ['round', 'ell', 'rect', 'oct', 'cross'], special: ['river', 'chasm', 'treasury', 'traps'] },
  };
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
    // Тема подземелья: какие комнаты бывают и чем обставлены (в объёмном виде — ещё камень стен и пола)
    const theme = DTHEME[o.variant] ? o.variant : R.pick(Object.keys(DTHEME)), TH = DTHEME[theme];
    out.v = theme;
    // Форма комнаты (внутри своего прямоугольника; середина всегда пол — к ней идут коридоры):
    // круглый зал, восьмиугольник со срезанными углами, буква «Г» (без одной четверти), крест, прямоугольник с нишами в стенах
    const niches = [];
    rooms.forEach((r, i) => {
      const [mx, my] = cen(r), big = r.w >= 6 && r.h >= 5, boss = i === rooms.length - 1 && i > 0;
      const pool = boss ? ['round', 'oct', 'oct', 'rect'] : big ? TH.shapes : ['rect', 'rect', 'oct', 'niche'];
      r.shape = i === 0 ? R.pick(['rect', 'rect', 'oct']) : R.pick(pool);
      const cut = (f) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!(x === mx && y === my) && f(x, y)) G.g[y][x] = 'wall'; };
      if (r.shape === 'round') { const ax = r.w / 2, ay = r.h / 2, cx = r.x + ax - 0.5, cy = r.y + ay - 0.5; cut((x, y) => ((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2 > 1.08); }
      else if (r.shape === 'oct') { const k = Math.max(1, Math.floor(Math.min(r.w, r.h) / 3)); cut((x, y) => { const dx = Math.min(x - r.x, r.x + r.w - 1 - x), dy = Math.min(y - r.y, r.y + r.h - 1 - y); return dx + dy < k; }); }
      else if (r.shape === 'ell') { const sx = R.ch(0.5) ? 1 : -1, sy = R.ch(0.5) ? 1 : -1; cut((x, y) => (x - mx) * sx >= 1 + Math.floor(r.w / 6) && (y - my) * sy >= 1 + Math.floor(r.h / 6)); }
      else if (r.shape === 'cross') { const bw = Math.max(1, Math.floor(r.w / 5)), bh = Math.max(1, Math.floor(r.h / 5)); cut((x, y) => Math.abs(x - mx) > bw && Math.abs(y - my) > bh); }
      else if (r.shape === 'niche') {
        // Ниши — по клетке вглубь стены через одну, только где за ней ещё есть стена (комнаты не сливаются)
        const tryN = (x, y, bx, by) => { if (G.inb(bx, by) && bx > 0 && by > 0 && bx < G.w - 1 && by < G.h - 1 && G.get(x, y) === 'wall' && G.get(bx, by) === 'wall' && R.ch(0.6)) { G.g[y][x] = 'floor'; niches.push([x, y, i]); } };
        for (let x = r.x + 1; x < r.x + r.w - 1; x += 2) { tryN(x, r.y - 1, x, r.y - 2); tryN(x, r.y + r.h, x, r.y + r.h + 1); }
        for (let y = r.y + 1; y < r.y + r.h - 1; y += 2) { tryN(r.x - 1, y, r.x - 2, y); tryN(r.x + r.w, y, r.x + r.w + 1, y); }
      }
    });
    const placed = new Set(); // клетки, где генератор поставил предмет (колонну, бочку, статую…) — их можно убрать, если перекрыли проход
    const corrSet = new Set(); // прорубленные под коридоры клетки — на них ничего не ставим (коридор мог пройти по срезанному краю комнаты)
    const carve = (x, y) => { if (G.get(x, y) === 'wall' && G.inb(x, y) && x > 0 && y > 0 && x < G.w - 1 && y < G.h - 1) { G.g[y][x] = 'corr'; corrSet.add(`${x}_${y}`); } };
    // Отрезок коридора по прямой; широкий коридор — в две клетки
    const line = (x0, y0, x1, y1, wide) => {
      if (y0 === y1) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) { carve(x, y0); if (wide) carve(x, y0 + 1); }
      else for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) { carve(x0, y); if (wide) carve(x0 + 1, y); }
    };
    // Коридор: «Г» (как раньше), зигзаг через случайную точку между комнатами или ступенькой; иногда широкий
    const corridor = (a, b) => {
      const [x0, y0] = cen(a), [x1, y1] = cen(b), wide = R.ch(0.15), q = R.f();
      if (q < 0.35 && Math.abs(x1 - x0) > 3 && Math.abs(y1 - y0) > 3) {
        const xm = R.i(Math.min(x0, x1) + 1, Math.max(x0, x1) - 1);
        line(x0, y0, xm, y0, wide); line(xm, y0, xm, y1, wide); line(xm, y1, x1, y1, wide);
      } else if (q < 0.55 && Math.abs(x1 - x0) > 3 && Math.abs(y1 - y0) > 3) {
        const ym = R.i(Math.min(y0, y1) + 1, Math.max(y0, y1) - 1);
        line(x0, y0, x0, ym, wide); line(x0, ym, x1, ym, wide); line(x1, ym, x1, y1, wide);
      } else if (R.ch(0.5)) { line(x0, y0, x1, y0, wide); line(x1, y0, x1, y1, wide); }
      else { line(x0, y0, x0, y1, wide); line(x0, y1, x1, y1, wide); }
    };
    for (let i = 1; i < rooms.length; i++) corridor(rooms[i - 1], rooms[i]);
    for (let i = 0; i < Math.ceil(rooms.length / 4); i++) corridor(R.pick(rooms), R.pick(rooms)); // петли
    // Тупики: короткий отросток от коридора в толщу камня — в конце тайник (сундук) или обвал
    const stubs = [];
    for (let n = 0, t = 0; n < R.i(1, 3) && t < 200; t++) {
      const x = R.i(2, G.w - 3), y = R.i(2, G.h - 3); if (G.g[y][x] !== 'corr') continue;
      const [dx, dy] = R.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]), L = R.i(3, 6); let ok = true;
      for (let k = 1; k <= L + 1 && ok; k++) { const cx = x + dx * k, cy = y + dy * k; if (!(cx > 0 && cy > 0 && cx < G.w - 1 && cy < G.h - 1) || G.get(cx, cy) !== 'wall' || G.get(cx + dy, cy + dx) !== 'wall' || G.get(cx - dy, cy - dx) !== 'wall') ok = false; }
      if (!ok) continue;
      for (let k = 1; k <= L; k++) G.g[y + dy * k][x + dx * k] = 'corr';
      stubs.push([x + dx * L, y + dy * L]); n++;
    }
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
    // Особые комнаты (одна-две на карту, по теме): провал с мостом, подземная река, зал-ловушка, библиотека, тюрьма,
    // тронный зал, лаборатория, сокровищница, комната-загадка
    const special = new Map(), spPool = TH.special.slice();
    const spCand = rooms.map((r, i) => i).filter((i) => i > 0 && i < rooms.length - 1 && rooms[i].w >= 5 && rooms[i].h >= 5 && rooms[i].shape !== 'round' && rooms[i].shape !== 'cross');
    for (let n = 0; n < (rooms.length >= 9 ? 2 : 1) && spCand.length && spPool.length; n++) {
      const i = spCand.splice(R.i(0, spCand.length - 1), 1)[0], k = spPool.splice(R.i(0, spPool.length - 1), 1)[0]; special.set(i, k);
    }
    const notes = out.notes = [], spUndo = [];
    rooms.forEach((r, i) => {
      const kind = i === 0 ? 'entrance' : i === rooms.length - 1 ? 'boss' : special.get(i) || R.pick(TH.kinds);
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
      // Убранство по назначению комнаты (на клетке — «мебель», вид предмета — в props): колонны в залах, бочки и ящики в кладовой,
      // саркофаг в склепе, алтарь в святилище, трон в логове. Где сколько колонн и как стоят — каждый раз по-разному
      const P = out.props || (out.props = {}), [mx, my] = cen(r);
      const put = (x, y, p, t = 'furn') => { if (!safe(x, y) || G.get(x, y) !== 'floor' || corrSet.has(`${x}_${y}`)) return false; G.set(x, y, t); placed.add(`${x}_${y}`); if (p) P[`${x}_${y}`] = p; return true; };
      // Предметы у стен: n штук в двух-трёх местах (не у входов)
      const alongWalls = (want, make) => {
        let got = 0;
        for (let k = 0; k < 16 && got < want; k++) {
          const side = R.i(0, 3), t = R.i(0, (side % 2 ? r.h : r.w) - 1), x0 = side === 1 ? r.x + r.w - 1 : side === 3 ? r.x : r.x + t, y0 = side === 0 ? r.y : side === 2 ? r.y + r.h - 1 : r.y + t;
          for (let n = 0; n < R.i(1, 3) && got < want; n++) { const x = x0 + (side % 2 ? 0 : n), y = y0 + (side % 2 ? n : 0); if (make(x, y)) got++; }
        }
        return got;
      };
      // Узор на полу (мозаика, ритуальный круг) — клетки остаются полом, по ним можно ходить
      const decal = (rad, p) => { for (let y = my - rad; y <= my + rad; y++) for (let x = mx - rad; x <= mx + rad; x++) if (Math.hypot(x - mx, y - my) <= rad + 0.3 && G.get(x, y) === 'floor' && !P[`${x}_${y}`]) P[`${x}_${y}`] = p; };
      const pillar = (x, y) => { if (put(x, y, R.ch(0.15) ? 'pillar_b' : 'pillar') && P[`${x}_${y}`] === 'pillar_b') { const [dx, dy] = R.pick([[1, 0], [-1, 0], [0, 1], [0, -1]]); if (safe(x + dx, y + dy) && G.get(x + dx, y + dy) === 'floor') G.set(x + dx, y + dy, 'rubble'); } };
      if ((kind === 'hall' || kind === 'boss' || kind === 'entrance' || kind === 'statues') && r.w >= 6 && r.h >= 5) {
        const pat = R.pick(TH.pillars);
        if (pat === 'corners') [[1, 1], [r.w - 2, 1], [1, r.h - 2], [r.w - 2, r.h - 2]].forEach(([dx, dy]) => pillar(r.x + dx, r.y + dy));
        else if (pat === 'rows') { const along = r.w >= r.h, n = along ? r.w : r.h, step = R.pick([2, 3]); for (let t = 1; t < n - 1; t += step) [1, (along ? r.h : r.w) - 2].forEach((s) => pillar(along ? r.x + t : r.x + s, along ? r.y + s : r.y + t)); }
        else if (pat === 'center') { if (r.w >= r.h) { pillar(mx - 1, my); pillar(mx + 1, my); } else { pillar(mx, my - 1); pillar(mx, my + 1); } }
        else if (pat === 'ring' && r.w >= 7 && r.h >= 6) [[-2, -2], [2, -2], [-2, 2], [2, 2], [0, -2], [0, 2]].forEach(([dx, dy]) => pillar(mx + dx, my + dy));
      }
      if (kind === 'hall' && R.ch(0.35)) { const ox = R.i(r.x + 1, r.x + r.w - 2), oy = R.i(r.y + 1, r.y + r.h - 2); [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([dx, dy], i) => { const x = ox + dx, y = oy + dy; if ((!i || R.ch(0.5)) && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h && G.get(x, y) === 'floor') G.set(x, y, 'rubble'); }); } // обвал
      if (kind === 'shrine') { if (R.ch(0.6)) G.set(mx, my, 'water'); const wy = r.y; put(mx, wy, 'altar'); if (R.ch(0.6)) { put(mx - 1, wy, 'candelabra'); put(mx + 1, wy, 'candelabra'); } }
      // Бочки и ящики грудами у стен
      if (kind === 'storage') alongWalls(R.i(3, 5), (x, y) => (R.ch(0.55) ? put(x, y, 'barrel') : put(x, y, null, 'crate')));
      // Крепость: казарма — койки у стен; оружейная — стойки с оружием и доспехи; караулка — стол; трапезная — длинный стол
      if (kind === 'barracks') alongWalls(R.i(3, 6), (x, y) => put(x, y, 'bed'));
      if (kind === 'armory') alongWalls(R.i(3, 5), (x, y) => put(x, y, R.ch(0.7) ? 'rack' : 'armor'));
      if (kind === 'guard') { put(mx, my, 'table'); if (R.ch(0.5)) put(mx + 1, my, 'table'); alongWalls(R.i(1, 2), (x, y) => put(x, y, 'rack')); }
      if (kind === 'mess') { const along = r.w >= r.h, L = Math.max(2, (along ? r.w : r.h) - 4); for (let t = 0; t < L; t++) put(along ? r.x + 2 + t : mx, along ? my : r.y + 2 + t, 'table'); alongWalls(R.i(1, 3), (x, y) => put(x, y, 'barrel')); }
      // Храм: мозаика посреди зала, статуи вдоль стен, фонтан
      if (TH.mosaic && (kind === 'hall' || kind === 'statues' || kind === 'boss') && R.ch(0.7)) decal(Math.min(2, Math.floor((Math.min(r.w, r.h) - 1) / 2)), 'mosaic');
      if (kind === 'statues') alongWalls(R.i(2, 4), (x, y) => put(x, y, 'statue'));
      if (kind === 'fountain') { [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { if (G.get(mx + dx, my + dy) === 'floor') G.set(mx + dx, my + dy, 'water'); }); put(mx, my, 'statue', 'furn'); alongWalls(R.i(0, 2), (x, y) => put(x, y, 'statue')); }
      // Культ: ритуальный круг со свечами и алтарём, клетки с пленниками, кровь на полу
      if (kind === 'ritual') {
        decal(2, 'circle'); put(mx, my, 'altar');
        [[-2, -2], [2, -2], [-2, 2], [2, 2]].forEach(([dx, dy]) => { if (put(mx + dx, my + dy, 'candelabra')) out.lights.push({ x: mx + dx, y: my + dy, b: 10, d: 10 }); });
      }
      if (kind === 'cells') alongWalls(R.i(2, 4), (x, y) => put(x, y, 'cage'));
      if (TH.blood && R.ch(0.45)) for (let n = 0; n < R.i(1, 3); n++) { const x = R.i(r.x, r.x + r.w - 1), y = R.i(r.y, r.y + r.h - 1); if (G.get(x, y) === 'floor' && !P[`${x}_${y}`]) P[`${x}_${y}`] = 'blood'; }
      // Гробница: урны в нишах вдоль стен
      if (kind === 'niches') { alongWalls(R.i(3, 6), (x, y) => put(x, y, 'urn')); if (R.ch(0.5)) put(mx, my, null, 'grave'); }
      // Затопленные руины: вода стоит в комнате (вброд — труднопроходимо)
      if (kind === 'pool') for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (G.get(x, y) === 'floor' && Math.hypot((x - mx) / (r.w / 2), (y - my) / (r.h / 2)) < 0.85 + R.f() * 0.25) G.set(x, y, 'water');
      if (kind === 'crypt') { if (r.w >= r.h) { put(mx - 1, my, null, 'grave'); if (R.ch(0.5)) put(mx + 1, my, null, 'grave'); } else { put(mx, my - 1, null, 'grave'); if (R.ch(0.5)) put(mx, my + 1, null, 'grave'); } }
      if (kind === 'boss' && R.ch(0.6)) put(mx, r.y, 'throne');
      // ---- Особые комнаты ----
      const undo = { cells: [], doors: [] }, setU = (x, y, t) => { undo.cells.push([x, y, G.get(x, y)]); G.set(x, y, t); };
      const longX = r.w >= r.h;
      if (kind === 'chasm' || kind === 'river') {
        // Полоса поперёк длинной стороны, мост — посередине; провал не пройти, реку — вброд
        const t = kind === 'chasm' ? 'chasm' : 'water', wB = kind === 'chasm' ? 2 : R.i(2, 3);
        for (let a = 0; a < wB; a++) for (let b = 0; b < (longX ? r.h : r.w); b++) {
          const x = longX ? mx - Math.floor(wB / 2) + a : r.x + b, y = longX ? r.y + b : my - Math.floor(wB / 2) + a;
          if (G.get(x, y) !== 'floor') continue;
          setU(x, y, (longX ? y === my : x === mx) ? 'bridge' : t);
        }
        if (kind === 'chasm') notes.push({ x: mx, y: my, ic: '⚠', txt: 'Провал: узкий мост без перил. Толчок или неудачный рывок на мосту — спасбросок Ловкости СЛ {dc}, при провале падение в пропасть ({fall} дробящего урона)' });
        spUndo.push(undo);
      }
      if (kind === 'traps') {
        for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++) if ((x + y) % 2 === 0 && G.get(x, y) === 'floor' && !P[`${x}_${y}`] && R.ch(0.55)) P[`${x}_${y}`] = 'plate';
        notes.push({ x: mx, y: my, ic: '⚠', txt: 'Зал-ловушка: нажимные плиты (они на полу). Заметить подвох — Мудрость (Внимательность) СЛ {dc}; наступил на плиту — из стен бьёт пламя: спасбросок Ловкости СЛ {dc}, при провале {dmg} огнём (при успехе половина)' });
      }
      if (kind === 'library') { alongWalls(R.i(4, 7), (x, y) => put(x, y, 'books')); put(mx, my, 'lectern'); if (R.ch(0.6)) put(mx + (longX ? 2 : 0), my + (longX ? 0 : 2), 'table'); }
      if (kind === 'lab') { put(mx, my, 'cauldron'); alongWalls(R.i(2, 3), (x, y) => put(x, y, R.ch(0.5) ? 'alembic' : 'potions')); out.lights.push({ x: mx, y: my, b: 5, d: 10 }); }
      if (kind === 'throne') {
        // Трон у дальней стены (если там вход — у противоположной), к нему ковровая дорожка, по сторонам колонны и свечи
        const spot = [[mx, r.y, 1], [mx - 1, r.y, 1], [mx + 1, r.y, 1], [mx, r.y + r.h - 1, -1], [mx - 1, r.y + r.h - 1, -1], [mx + 1, r.y + r.h - 1, -1]].find(([x, y]) => put(x, y, 'throne'));
        if (spot) {
          const [tx, ty, d] = spot;
          for (let y = ty + d; y >= r.y && y < r.y + r.h; y += d) if (G.get(tx, y) === 'floor' && !P[`${tx}_${y}`]) P[`${tx}_${y}`] = 'rug';
          for (let y = ty + d; y >= r.y + 1 && y < r.y + r.h - 1; y += 2 * d) { pillar(tx - 2, y); pillar(tx + 2, y); }
          [-1, 1].forEach((q) => { if (put(tx + q, ty, 'candelabra')) out.lights.push({ x: tx + q, y: ty, b: 10, d: 10 }); });
        }
      }
      if (kind === 'treasury') {
        // Все двери в сокровищницу заперты; внутри сундуки и россыпи монет
        Object.keys(out.doors).forEach((k) => { const [x, y] = k.split('_').map(Number); if (x >= r.x - 1 && x <= r.x + r.w && y >= r.y - 1 && y <= r.y + r.h) out.doors[k].l = 1; });
        for (let n = 0; n < R.i(2, 3); n++) { const x = R.i(r.x, r.x + r.w - 1), y = r.y; if (G.get(x, y) === 'floor' && !P[`${x}_${y}`] && !out.chests.some((c) => c.x === x && c.y === y)) out.chests.push({ x, y, room: i, boss: n === 0 }); }
        for (let n = 0; n < R.i(3, 6); n++) { const x = R.i(r.x, r.x + r.w - 1), y = R.i(r.y + 1, r.y + r.h - 1); if (G.get(x, y) === 'floor' && !P[`${x}_${y}`]) P[`${x}_${y}`] = 'gold'; }
        notes.push({ x: mx, y: my, ic: '💰', txt: 'Сокровищница: двери заперты — Ловкость (воровские инструменты) СЛ {dc} или выломать: Сила (Атлетика) СЛ {dc2}' });
      }
      if (kind === 'puzzle') {
        put(mx, my, 'orb');
        // Три рычага на стене комнаты
        const D = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }, walls = [];
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (G.get(x, y) === 'floor') Object.entries(D).forEach(([sd, [dx, dy]]) => { if (G.get(x + dx, y + dy) === 'wall' && !out.doors[`${x + dx}_${y + dy}`]) walls.push([`${x + dx}_${y + dy}`, { n: 's', s: 'n', e: 'w', w: 'e' }[sd]]); });
        const dec = out.decor || (out.decor = {});
        for (let n = 0; n < 3 && walls.length; n++) { const [k, sd] = walls.splice(R.i(0, walls.length - 1), 1)[0]; if (!dec[k]) dec[k] = `lever:${sd}`; }
        const order = [1, 2, 3].sort(() => R.f() - 0.5).join('-');
        notes.push({ x: mx, y: my, ic: '👁', txt: `Комната-загадка: три рычага на стенах и сфера на постаменте. Верный порядок ${order} — сфера светится, под постаментом открывается тайник. Неверный — разряд из сферы: спасбросок Ловкости СЛ {dc}, при провале {dmg} молнией` });
      }
      if (kind === 'prison') {
        // Камеры вдоль глухой длинной стены: перегородки и решётчатые двери (часть заперта)
        const top = [...Array(r.w).keys()].every((a) => G.get(r.x + a, r.y - 1) === 'wall' && !corrSet.has(`${r.x + a}_${r.y}`) && !corrSet.has(`${r.x + a}_${r.y + 1}`) && !corrSet.has(`${r.x + a}_${r.y + 2}`));
        if (r.shape === 'rect' && r.h >= 6 && r.w >= 5 && top) {
          for (let a = 0; a < r.w; a++) { const x = r.x + a, cellX = a % 3; if (cellX === 2) { setU(x, r.y, 'wall'); setU(x, r.y + 1, 'wall'); setU(x, r.y + 2, 'wall'); } else if (cellX === 0 && a + 1 < r.w && (a + 2) % 3 !== 0) { setU(x, r.y + 2, 'floor'); const k = `${x}_${r.y + 2}`; out.doors[k] = { o: 0, ...(R.ch(0.6) ? { l: 1 } : {}) }; undo.doors.push(k); } else if (cellX === 0) { setU(x, r.y, 'wall'); setU(x, r.y + 1, 'wall'); setU(x, r.y + 2, 'wall'); } else setU(x, r.y + 2, 'wall'); }
          for (let a = 0; a + 1 < r.w; a += 3) if (R.ch(0.5)) P[`${r.x + a}_${r.y}`] = 'shackle';
          spUndo.push(undo);
        } else alongWalls(R.i(2, 4), (x, y) => put(x, y, 'cage'));
        notes.push({ x: mx, y: my, ic: '🚪', txt: 'Тюрьма: двери камер окованы, часть заперта (Ловкость, воровские инструменты СЛ {dc}). В камерах могут сидеть пленники — расспросите их' });
      }
      if (kind === 'boss' && theme === 'cult') { decal(1, 'circle'); if (!P[`${mx}_${my}`] || P[`${mx}_${my}`] === 'circle') put(mx, my, 'altar'); }
      if (kind === 'boss' && theme === 'tomb') put(mx, my, null, 'grave');
      if (i === 0 || R.ch(0.5)) { const pool_ = TH.lights; if (pool_ > 0 && R.ch(pool_)) out.lights.push({ x: r.x + r.w - 1, y: r.y + r.h - 1, b: 20, d: 20 }); }
      if (i > 0 && (kind === 'storage' || kind === 'boss' || R.ch(o.chests ? 0.35 : 0))) {
        // Сундук — в дальнем углу; у круглой и срезанной комнаты угол — стена: берём ближайшую к нему клетку пола
        let best = null, bd = 1e9; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { if (G.get(x, y) !== 'floor' || P[`${x}_${y}`] || out.doors[`${x}_${y}`]) continue; const d = Math.hypot(x - (r.x + r.w - 1), y - (r.y + r.h - 1)); if (d < bd) { bd = d; best = [x, y]; } }
        if (best) out.chests.push({ x: best[0], y: best[1], room: i, boss: kind === 'boss' });
      }
    });
    // Ниши в стенах: в гробнице — урны, в храме — статуи, у культа — свечи; иначе пустые
    niches.forEach(([x, y]) => {
      // Только глухая ниша (проход лишь со стороны комнаты): через неё мог пройти коридор — тогда она часть прохода
      if (G.get(x, y) !== 'floor' || [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => G.get(x + dx, y + dy) !== 'wall').length !== 1) return;
      const p = theme === 'tomb' ? (R.ch(0.8) ? 'urn' : null) : theme === 'temple' ? (R.ch(0.6) ? 'statue' : null) : theme === 'cult' ? (R.ch(0.5) ? 'candelabra' : null) : null;
      if (!p) return; G.set(x, y, 'furn'); (out.props || (out.props = {}))[`${x}_${y}`] = p; if (p === 'candelabra') out.lights.push({ x, y, b: 10, d: 10 });
    });
    stubs.forEach(([x, y]) => { if (G.get(x, y) !== 'floor') return; if (o.chests && R.ch(0.6)) { out.chests.push({ x, y }); notes.push({ x, y, ic: '💰', txt: 'Тайник в тупике: сундук за осыпавшейся кладкой — заметить, что здесь что-то есть: Мудрость (Внимательность) СЛ {dc}' }); } else G.set(x, y, 'rubble'); });
    // История комнат: что за комната и что в ней случилось (примерно в половине — событие со следами на полу)
    const usedD = new Set();
    out.rooms.forEach((q, i) => {
      if (i >= rooms.length) return;
      const PP = out.props || (out.props = {}), free = []; for (let y = q.y; y < q.y + q.h; y++) for (let x = q.x; x < q.x + q.w; x++) if (G.get(x, y) === 'floor' && !PP[`${x}_${y}`] && !out.doors[`${x}_${y}`] && !out.chests.some((c) => c.x === x && c.y === y)) free.push([x, y]);
      const take = () => (free.length ? free.splice(R.i(0, free.length - 1), 1)[0] : null), mark = (p) => { const c = take(); if (c) PP[`${c[0]}_${c[1]}`] = p; return c; };
      const ev = i > 0 && free.length > 6 && !['treasury', 'puzzle', 'traps', 'chasm', 'river'].includes(q.kind) && R.ch(0.5) ? R.pick(ROOM_EV) : null;
      if (ev) {
        if (ev[0] === 'battle') { for (let n = 0; n < 3; n++) mark('blood'); mark('weapon'); mark('weapon'); }
        if (ev[0] === 'camp') { mark('ash'); mark('bedroll'); if (R.ch(0.5)) mark('bedroll'); }
        if (ev[0] === 'dig') { const c = mark('hole'); mark('shovel'); if (c) [[1, 0], [0, 1]].forEach(([dx, dy]) => { if (G.get(c[0] + dx, c[1] + dy) === 'floor' && !PP[`${c[0] + dx}_${c[1] + dy}`]) G.set(c[0] + dx, c[1] + dy, 'rubble'); }); }
        if (ev[0] === 'tracks') { const hz = q.w >= q.h, [mx, my] = cen(q); for (let t = 0; t < (hz ? q.w : q.h); t++) { const x = hz ? q.x + t : mx, y = hz ? my : q.y + t; if (G.get(x, y) === 'floor' && !PP[`${x}_${y}`]) PP[`${x}_${y}`] = hz ? 'tracks_e' : 'tracks_s'; } }
        if (ev[0] === 'collapse') { const c = take(); if (c) [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([dx, dy]) => { if (G.get(c[0] + dx, c[1] + dy) === 'floor' && !PP[`${c[0] + dx}_${c[1] + dy}`]) G.set(c[0] + dx, c[1] + dy, 'rubble'); }); }
      }
      q.n = i + 1; q.title = ROOM_N[q.kind] || 'Комната';
      const opts = (ROOM_D[q.kind] || ROOM_D.hall).filter((t) => !usedD.has(t)), d0 = opts.length ? R.pick(opts) : R.pick(ROOM_D[q.kind] || ROOM_D.hall); usedD.add(d0);
      q.story = [d0, ev ? ev[1] : ''].filter(Boolean).join(' ');
    });
    // Засада: перекрёсток коридоров (3–4 прохода) подальше от входа
    {
      const inR = (x, y) => rooms.some((q) => x >= q.x - 1 && x <= q.x + q.w && y >= q.y - 1 && y <= q.y + q.h), [sx, sy] = cen(rooms[0] || { x: 0, y: 0, w: 0, h: 0 }), cross = [];
      for (let y = 1; y < G.h - 1; y++) for (let x = 1; x < G.w - 1; x++) if (G.get(x, y) === 'floor' && !inR(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => G.get(x + dx, y + dy) !== 'wall').length >= 3 && Math.hypot(x - sx, y - sy) > 10) cross.push([x, y]);
      for (let n = 0; n < Math.min(2, cross.length); n++) { const [x, y] = cross.splice(R.i(0, cross.length - 1), 1)[0]; if (notes.some((N) => Math.hypot(N.x - x, N.y - y) < 6)) continue; notes.push({ x, y, ic: '💀', txt: 'Перекрёсток: удобное место для засады — существа из соседних комнат могут ударить с двух сторон. Заметить заранее: Мудрость (Внимательность) СЛ {dc}' }); }
    }
    // Затопленные руины: вода просочилась и в коридоры, кое-где обвалы
    if (theme === 'flooded') {
      const inR = (x, y) => rooms.some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
      for (let y = 1; y < G.h - 1; y++) for (let x = 1; x < G.w - 1; x++) if (G.g[y][x] === 'floor' && !inR(x, y) && !out.doors[`${x}_${y}`] && R.ch(0.22)) G.g[y][x] = 'water';
      for (let n = 0; n < Math.round(rooms.length / 2); n++) { const q = R.pick(rooms), x = R.i(q.x, q.x + q.w - 1), y = R.i(q.y, q.y + q.h - 1); if (G.get(x, y) === 'floor') G.set(x, y, 'rubble'); }
    }
    if (rooms.length) {
      const [sx, sy] = cen(rooms[0]);
      // Провал или камеры отрезали часть карты — эта особая комната отменяется (снова обычный пол)
      const lost = () => { const block = (x, y) => ['wall', 'furn', 'crate', 'grave', 'chasm'].includes(G.get(x, y)), seen = new Set([`${sx}_${sy}`]), q = [[sx, sy]]; while (q.length) { const [x, y] = q.pop(); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const k = `${x + dx}_${y + dy}`; if (!seen.has(k) && G.inb(x + dx, y + dy) && !block(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } }); } for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (!block(x, y) && G.get(x, y) !== '' && !seen.has(`${x}_${y}`)) return true; return false; };
      unblock(G, out, sx, sy, placed);
      for (const u of spUndo) { if (!lost()) break; u.cells.slice().reverse().forEach(([x, y, t]) => G.set(x, y, t)); u.doors.forEach((k) => delete out.doors[k]); }
      unblock(G, out, sx, sy, placed);
    }
    // Обломки не ложатся на сундуки и на место входа
    out.chests.forEach((c) => { if (G.get(c.x, c.y) === 'rubble') G.set(c.x, c.y, 'floor'); });
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision';
    if (rooms.length) { const [sx, sy] = cen(rooms[0]); out.start = { x: sx, y: sy }; if (G.get(sx, sy) === 'rubble') G.set(sx, sy, 'floor'); }
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
      else if (near8(G, x, y, 'wall') >= 3 && R.ch(0.25)) G.g[y][x] = 'rubble'; // обвалы у стен
    }
    // Тупики и ниши — места для сундуков и логова
    const spots = reg.filter(([x, y]) => G.g[y][x] === '' && near8(G, x, y, 'wall') >= 5);
    for (let i = 0; i < (o.chests ? Math.max(1, Math.round(spots.length / 40)) : 0) && spots.length; i++) { const [x, y] = R.pick(spots); out.chests.push({ x, y }); }
    const s = reg.slice().sort((a, b) => a[0] - b[0])[0] || [1, 1];
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '') G.g[y][x] = 'floor'; // пол пещеры светлее стен
    out.rooms.push({ x: 0, y: 0, w: G.w, h: G.h, kind: 'cave' });
    out.ground = 'stone'; out.amb = 'dark'; out.fog = 'vision'; out.start = { x: s[0], y: s[1] };
  }
  const fillRect = (G, x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) G.set(i, j, v); };
  const ringRect = (G, x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x === x0 || x === x1 || y === y0 || y === y1) G.set(x, y, v); };
  // Верхние этажи донжона (тот же контур): вдоль южной стены — галерея с лестницами в углах; в большом донжоне от неё на север идёт
  // коридор с покоями по обе стороны, в малом — покои в ряд. Второй этаж — гостевые покои, библиотека, оружейная, зал совета;
  // верхний — опочивальня владельца и кабинет. down — проём, из которого поднялся отряд, up — марш выше
  function keepUpper(G, R, o, out, B, gx, down, up) {
    const { x0, y0, x1, y1 } = B, top = o.floor >= out.floors, wy = y1 - 3, ry0 = y0 + 1, ry1 = wy - 1;
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) G.set(x, y, x < x0 || x > x1 || y < y0 || y > y1 ? 'chasm' : x === x0 || x === x1 || y === y0 || y === y1 ? 'wall' : 'floor');
    out.props = {}; out.rooms = []; out.doors = {}; out.lights = []; out.chests = []; // двор, башни и ворота остались внизу
    const put = (x, y, p) => { if (G.get(x, y) !== 'floor' || out.doors[`${x}_${y}`]) return false; G.set(x, y, 'furn'); out.props[`${x}_${y}`] = p; return true; };
    for (let x = x0 + 1; x < x1; x++) G.set(x, wy, 'wall');
    const kinds = top ? ['lord', 'study', 'library', 'guest', 'armory'] : ['guest', 'library', 'armory', 'guest', 'council', 'guest'];
    // Обстановка: far — клетки вдоль стены напротив двери, inner — следующий ряд (если комната глубокая). Возвращает, заперта ли дверь
    const fit = (r, far, inner) => {
      const kind = kinds.length ? kinds.shift() : 'guest', n = far.length, m = Math.floor(n / 2);
      let lock = false, rk = 'chamber';
      if (kind === 'lord') {
        rk = 'bedroom'; lock = true;
        put(...far[0], 'bed'); if (n > 2) put(...far[1], 'bed'); put(...far[n - 1], 'wardrobe');
        inner.forEach(([x, y], i) => { if (i < n - 1) out.props[`${x}_${y}`] = 'rug'; });
        if (inner.length) out.chests.push({ x: inner[n - 1][0], y: inner[n - 1][1], boss: true });
      } else if (kind === 'library') { rk = 'library'; far.forEach((c) => put(...c, 'books')); if (inner.length) put(...inner[m], 'desk'); }
      else if (kind === 'armory') { rk = 'armory'; lock = true; far.forEach((c, i) => put(...c, i % 3 === 2 ? 'armor' : 'rack')); if (o.chests && inner.length) out.chests.push({ x: inner[0][0], y: inner[0][1] }); }
      else if (kind === 'study') { rk = 'office'; lock = true; put(...far[m], 'desk'); if (n > 2) { put(...far[0], 'books'); put(...far[n - 1], 'books'); } if (inner.length) out.chests.push({ x: inner[n - 1][0], y: inner[n - 1][1] }); }
      else if (kind === 'council') { rk = 'council'; if (inner.length > 2) { put(...inner[m], 'table'); put(...inner[m - 1], 'table'); } put(...far[0], 'armor'); if (n > 1) put(...far[n - 1], 'armor'); }
      else { put(...far[0], 'bed'); if (n >= 4 && R.ch(0.5)) put(...far[n - 1], 'bed'); else if (n >= 3) put(...far[n - 1], 'wardrobe'); lock = R.ch(0.3); if (o.chests && inner.length && R.ch(0.35)) out.chests.push({ x: inner[0][0], y: inner[0][1] }); }
      out.rooms.push({ ...r, kind: rk });
      out.lights.push({ x: far[m][0], y: far[m][1], b: 10, d: 10 });
      return lock;
    };
    if (x1 - x0 + 1 >= 15 && ry1 - ry0 + 1 >= 5) {
      // Коридор на север от галереи, покои — по обе стороны, двери — в коридор
      for (let y = ry0; y <= wy; y++) { G.set(gx - 2, y, 'wall'); G.set(gx + 1, y, 'wall'); }
      G.set(gx - 1, wy, 'floor'); G.set(gx, wy, 'floor');
      [[x0 + 1, gx - 3, gx - 2, 1], [gx + 2, x1 - 1, gx + 1, -1]].forEach(([xa, xb, wx, s]) => {
        for (let y = ry0; y <= ry1;) {
          let h = R.i(3, 4); if (ry1 - (y + h) < 2) h = ry1 - y + 1;
          const ye = y + h - 1, r = { x: xa, y, w: xb - xa + 1, h }, dy = R.i(y, ye), fx = s > 0 ? xa : xb, ix = s > 0 ? xa + 1 : xb - 1, far = [], inner = [];
          if (ye < ry1) for (let x = xa; x <= xb; x++) G.set(x, ye + 1, 'wall');
          for (let yy = y; yy <= ye; yy++) { far.push([fx, yy]); if (r.w >= 3) inner.push([ix, yy]); }
          G.set(wx, dy, 'floor');
          out.doors[`${wx}_${dy}`] = { o: 0, ...(fit(r, far, inner) ? { l: 1 } : {}) };
          y = ye + 2;
        }
      });
      out.rooms.push({ x: gx - 1, y: ry0, w: 2, h: ry1 - ry0 + 1, kind: 'corridor' });
      out.lights.push({ x: gx, y: ry0, b: 15, d: 15 });
    } else {
      for (let x = x0 + 1; x <= x1 - 1;) {
        let w = R.i(3, 5); if (x1 - 1 - (x + w) < 3) w = x1 - x;
        const xe = x + w - 1, r = { x, y: ry0, w, h: ry1 - ry0 + 1 }, dx = R.i(x, xe), far = [], inner = [];
        if (xe < x1 - 1) for (let y = ry0; y <= ry1; y++) G.set(xe + 1, y, 'wall');
        for (let i = x; i <= xe; i++) { far.push([i, ry0]); if (r.h >= 3) inner.push([i, ry0 + 1]); }
        G.set(dx, wy, 'floor');
        out.doors[`${dx}_${wy}`] = { o: 0, ...(fit(r, far, inner) ? { l: 1 } : {}) };
        x = xe + 2;
      }
    }
    // Галерея: доспехи на стойках у стены между дверями, светильники на южной стене
    for (let x = x0 + 5; x <= x1 - 5; x += 3) if (G.get(x, wy) === 'wall' && !out.doors[`${x}_${wy}`] && R.ch(0.5)) put(x, wy + 1, 'armor');
    for (let x = x0 + 4; x <= x1 - 4; x += 6) out.lights.push({ x, y: y1 - 1, b: 15, d: 15 });
    out.rooms.push({ x: x0 + 1, y: wy + 1, w: x1 - x0 - 1, h: 2, kind: 'corridor' });
    setFlights(G, out, up, down);
    out.ground = ''; out.amb = 'dim'; out.start = { x: down.x + down.dx, y: down.y - 1 };
  }
  // Замок воротами вниз (поворот карты — в generate). Размер построек и их число растут с картой; варианты: одна стена,
  // двойные стены с внешним двором, сад. Ров — по случаю. Донжон: большой зал и покои разной ширины, одна — сокровищница
  function castle(G, R, o, out) {
    const big = G.w >= 46 && G.h >= 36;
    const rv = R.pick(big ? ['double', 'garden', 'double', 'simple'] : ['simple', 'garden', 'simple']), v = o.variant || rv;
    out.v = v; out.props = {};
    const put = (x, y, p) => { if (G.get(x, y) !== 'floor' || out.doors[`${x}_${y}`]) return false; G.set(x, y, 'furn'); out.props[`${x}_${y}`] = p; return true; };
    const dbl = v === 'double' && G.w >= 40 && G.h >= 34, garden = v === 'garden' || (dbl && R.ch(0.5)), moat = R.ch(0.6);
    const m = moat ? 3 : 2, ox0 = m, oy0 = m, ox1 = G.w - m - 1, oy1 = G.h - m - 3, gx = Math.floor(G.w / 2);
    if (moat) { ringRect(G, ox0 - 2, oy0 - 2, ox1 + 2, oy1 + 2, 'water'); ringRect(G, ox0 - 1, oy0 - 1, ox1 + 1, oy1 + 1, 'water'); }
    ringRect(G, ox0, oy0, ox1, oy1, 'wall');
    const gap = dbl ? R.i(5, 7) : 0, ix0 = ox0 + gap, iy0 = oy0 + gap, ix1 = ox1 - gap, iy1 = oy1 - gap;
    if (dbl) ringRect(G, ix0, iy0, ix1, iy1, 'wall');
    // Ворота в обеих стенах, дорога от края карты, мост через ров
    [oy1, ...(dbl ? [iy1] : [])].forEach((wy) => { G.set(gx, wy, 'floor'); G.set(gx - 1, wy, 'floor'); out.doors[`${gx}_${wy}`] = { o: 0 }; out.doors[`${gx - 1}_${wy}`] = { o: 0 }; });
    for (let y = oy1 + 1; y < G.h; y++) [gx - 1, gx].forEach((x) => G.set(x, y, G.get(x, y) === 'water' ? 'bridge' : 'road'));
    out.lights.push({ x: gx + 1, y: oy1 - 1, b: 20, d: 20 });
    // Башни: углы и через каждые 12 клеток длинных стен, кроме места ворот
    const towers = (x0, y0, x1, y1) => {
      const spots = [[x0, y0], [x1 - 3, y0], [x0, y1 - 3], [x1 - 3, y1 - 3]];
      for (let x = x0 + 12; x < x1 - 14; x += 12) { spots.push([x, y0]); if (Math.abs(x + 2 - gx) > 4) spots.push([x, y1 - 3]); }
      for (let y = y0 + 12; y < y1 - 14; y += 12) { spots.push([x0, y]); spots.push([x1 - 3, y]); }
      spots.forEach(([tx, ty]) => {
        building(G, out, tx, ty, 4, 4, ty === y0 ? 's' : ty === y1 - 3 ? 'n' : tx === x0 ? 'e' : 'w', R);
        out.rooms[out.rooms.length - 1].kind = 'tower';
      });
    };
    towers(ox0, oy0, ox1, oy1);
    // Внутренний двор и донжон у дальней стены, его размер — от размера двора
    const cx0 = ix0 + 1, cy0 = iy0 + 1, cx1 = ix1 - 1, cy1 = iy1 - 1, iw = cx1 - cx0 + 1, ih = cy1 - cy0 + 1;
    const kw = Math.max(9, Math.min(28, Math.round(iw * (0.38 + R.f() * 0.14)))), kh = Math.max(7, Math.min(18, Math.round(ih * (0.34 + R.f() * 0.1))));
    const kx = gx - Math.floor(kw / 2), ky = cy0 + (dbl ? 1 : 4);
    // Этажи донжона: лестницы — в нижних углах большого зала; наверху покои, библиотека, оружейная (см. keepUpper)
    out.floors = kh >= 12 ? 3 : 2;
    const stA = FL(kx + kw - 3, ky + kh - 2, 1, 0), stB = FL(kx + 2, ky + kh - 2, -1, 0);
    if (o.floor > 1) { keepUpper(G, R, o, out, { x0: kx, y0: ky, x1: kx + kw - 1, y1: ky + kh - 1 }, gx, ...flight(o, out.floors, stA, stB)); return; }
    building(G, out, kx, ky, kw, kh, 's', R); out.rooms[out.rooms.length - 1].kind = 'keep';
    const part = ky + Math.max(3, Math.floor(kh * 0.45));
    for (let x = kx; x < kx + kw; x++) G.set(x, part, 'wall');
    // Покои за перегородкой — разной ширины; одна запертая — сокровищница
    const walls = [];
    for (let x = kx + R.i(3, 5); x < kx + kw - 3; x += R.i(3, 6)) walls.push(x);
    walls.forEach((wx) => { for (let y = ky; y <= part; y++) G.set(wx, y, 'wall'); });
    const xs = [kx, ...walls, kx + kw - 1], treasury = R.i(0, xs.length - 2);
    for (let k = 0; k < xs.length - 1; k++) {
      const rx0 = xs[k] + 1, rx1 = xs[k + 1] - 1;
      if (rx1 < rx0) continue;
      const dm = rx0 + Math.floor((rx1 - rx0) / 2), dx = dm !== gx ? dm : dm < rx1 ? dm + 1 : dm > rx0 ? dm - 1 : dm; // дверь — не за спинкой трона
      G.set(dx, part, 'floor'); out.doors[`${dx}_${part}`] = { o: 0, ...(k === treasury ? { l: 1 } : {}) };
      out.rooms.push({ x: rx0, y: ky + 1, w: rx1 - rx0 + 1, h: part - ky - 1, kind: k === treasury ? 'treasury' : 'chamber' });
      if (k === treasury && o.chests) out.chests.push({ x: rx0, y: ky + 1, boss: true });
      else if (rx1 > rx0) { put(rx1, ky + 1, 'bed'); if (rx1 - rx0 >= 2) put(rx0, ky + 1, 'wardrobe'); }
    }
    // Большой зал: трон у перегородки, к нему от входа — ковровая дорожка, столы рядами; в нижних углах — лестницы
    const hy0 = part + 1, hy1 = ky + kh - 2;
    put(gx, hy0, 'throne');
    for (let y = hy0 + 1; y <= hy1; y++) out.props[`${gx}_${y}`] = 'rug';
    setFlights(G, out, stA, null);
    for (let y = hy0 + 2; y < hy1; y += 2) for (let x = kx + 2; x < kx + kw - 2; x += 1) if (Math.abs(x - gx) > 1 && (x - kx) % 4 !== 1) G.set(x, y, 'furn');
    out.rooms.push({ x: kx + 1, y: hy0, w: kw - 2, h: hy1 - hy0 + 1, kind: 'hall' });
    out.lights.push({ x: kx + 1, y: hy0, b: 20, d: 20 }, { x: kx + kw - 2, y: hy0, b: 20, d: 20 }, { x: gx + 1, y: ky + kh, b: 20, d: 20 });
    for (let y = ky + kh; y < (dbl ? iy1 : oy1); y++) [gx - 1, gx].forEach((x) => { if (G.get(x, y) === '') G.set(x, y, 'road'); });
    // Постройки двора вдоль боковых стен: их больше на большой карте
    const kinds = ['barracks', 'stable', 'smithy', 'chapel', 'granary', 'kitchen', 'barracks', 'storehouse', 'armory'], want = Math.max(2, Math.min(9, Math.round((iw * ih) / 120)));
    let placed = 0;
    for (let t = 0; t < 300 && placed < want; t++) {
      // Сначала вдоль боковых стен, потом где угодно во дворе (кроме дороги к донжону)
      const w = R.i(6, 10), h = R.i(4, 7), left = R.ch(0.5), free_ = t > 120, bx = free_ ? R.i(cx0 + 1, cx1 - w) : left ? cx0 + 1 : cx1 - w, y = R.i(cy0 + 1, cy1 - h - 1);
      if (!fits(G, bx, y, w, h, (c) => c === '')) continue;
      if (Math.abs(bx + w / 2 - gx) < w / 2 + 3) continue; // не загораживать дорогу к донжону
      building(G, out, bx, y, w, h, bx + w / 2 < gx ? 'e' : 'w', R);
      const kind = kinds[placed % kinds.length];
      out.rooms[out.rooms.length - 1].kind = kind;
      if (kind === 'stable') for (let i = bx + 1; i < bx + w - 1; i += 2) G.set(i, y + 1, 'difficult');
      if (kind === 'smithy') { G.set(bx + 1, y + 1, 'rock'); out.lights.push({ x: bx + 2, y: y + 1, b: 15, d: 15 }); put(bx + 3, y + 1, 'anvil'); put(bx + w - 2, y + 1, 'bench'); if (w >= 8) put(bx + w - 3, y + 1, 'rack'); }
      if (kind === 'chapel') { put(bx + Math.floor(w / 2), y + 1, 'altar'); if (h >= 6) for (let i = bx + 2; i <= bx + w - 3; i++) if (i !== bx + Math.floor(w / 2)) put(i, y + 3, 'pew'); }
      if (kind === 'barracks') for (let i = bx + 1; i < bx + w - 1; i += 2) put(i, y + 1, 'bed');
      if (kind === 'armory') for (let i = bx + 1; i < bx + w - 1; i++) put(i, y + 1, i % 3 ? 'rack' : 'armor');
      if (kind === 'kitchen') { G.set(bx + 1, y + 1, 'rock'); out.lights.push({ x: bx + 2, y: y + 1, b: 15, d: 15 }); put(bx + 3, y + 1, 'cauldron'); put(bx + w - 2, y + 1, 'table'); put(bx + w - 3, y + 1, 'table'); }
      if (kind === 'granary' || kind === 'storehouse') for (let i = bx + 1; i < bx + w - 1; i++) if (R.ch(0.6)) G.set(i, y + 1, 'crate');
      placed++;
    }
    // Колодец и плац во дворе, сад — во внешнем дворе или в углу внутреннего
    const wl = openNear(G, gx + 4, cy1 - 3, (c) => c === ''); G.set(wl.x, wl.y, 'well');
    const tp = openNear(G, gx - 7, cy1 - 4, (c) => c === '');
    if (fits(G, tp.x, tp.y, 4, 3, (c) => c === '')) { fillRect(G, tp.x, tp.y, 4, 3, 'sand'); G.set(tp.x + 1, tp.y + 1, 'furn'); G.set(tp.x + 3, tp.y + 1, 'furn'); }
    if (garden) {
      const gw = R.i(6, 9), gh = R.i(5, 7), area = dbl ? { x: R.ch(0.5) ? ox0 + 1 : ox1 - gw, y: oy0 + Math.floor((oy1 - oy0 - gh) / 2) } : { x: R.ch(0.5) ? cx0 + 1 : cx1 - gw, y: cy1 - gh - 1 };
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
        const x = area.x + i, y = area.y + j;
        if (G.get(x, y) !== '') continue;
        const edge = i === 0 || j === 0 || i === gw - 1 || j === gh - 1;
        G.set(x, y, edge ? (R.ch(0.5) ? 'tree' : 'bush') : R.ch(0.2) ? 'bush' : '');
      }
      G.set(area.x + Math.floor(gw / 2), area.y + Math.floor(gh / 2), 'water');
      out.rooms.push({ x: area.x + 1, y: area.y + 1, w: gw - 2, h: gh - 2, kind: 'garden' });
    }
    if (dbl) for (let i = 0; i < gap * 6; i++) { const x = R.i(ox0 + 1, ox1 - 1), y = R.i(oy0 + 1, oy1 - 1); if (G.get(x, y) === '' && (x < ix0 || x > ix1 || y < iy0 || y > iy1) && Math.abs(x - gx) > 2) G.set(x, y, R.ch(0.6) ? 'tree' : 'bush'); }
    // Снаружи — лес и луг
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === '' && (x < ox0 - 2 || x > ox1 + 2 || y < oy0 - 2 || y > oy1 + 2) && R.ch(0.07)) G.g[y][x] = 'tree';
    out.ground = 'grass'; out.start = { x: gx, y: G.h - 1 };
    fixReach(G, out, [ox0, oy0, ox1, oy1]);
  }
  // Участки разного размера: режем прямоугольник, пока он больше max (иногда — и меньший, для разнообразия)
  function splitLots(R, x, y, w, h, maxW, maxH, minS, out = []) {
    const canW = w >= minS * 2, canH = h >= minS * 2;
    const cutW = canW && (w > maxW || R.ch(0.25)), cutH = canH && (h > maxH || R.ch(0.25));
    if (cutW && (!cutH || w >= h)) { const s = R.i(minS, w - minS); splitLots(R, x, y, s, h, maxW, maxH, minS, out); splitLots(R, x + s, y, w - s, h, maxW, maxH, minS, out); return out; }
    if (cutH) { const s = R.i(minS, h - minS); splitLots(R, x, y, w, s, maxW, maxH, minS, out); splitLots(R, x, y + s, w, h - s, maxW, maxH, minS, out); return out; }
    out.push({ x, y, w, h });
    return out;
  }
  // Сторона для двери: за ней улица (или клетка отступа, а за ней улица)
  function doorSide(G, x, y, w, h, R, good = (v) => v === 'road' || v === 'bridge') {
    const mid = { n: [x + Math.floor(w / 2), y - 1, 0, -1], s: [x + Math.floor(w / 2), y + h, 0, 1], w: [x - 1, y + Math.floor(h / 2), -1, 0], e: [x + w, y + Math.floor(h / 2), 1, 0] };
    const ok = Object.keys(mid).filter((k) => { const [ox, oy, dx, dy] = mid[k], c = G.get(ox, oy); return good(c) || (c === '' && good(G.get(ox + dx, oy + dy))); });
    return ok.length ? R.pick(ok) : null;
  }
  // Город: улицы с разным шагом (главные — в две клетки, переулки — в одну), дома разного размера, площадь и рынок.
  // Варианты: портовый (море снизу — поворот карты даёт любую сторону; набережная, причалы, лодки, склады),
  // на реке (мосты на улицах), за крепостной стеной (ворота на главных улицах)
  function city(G, R, o, out) {
    const v = o.variant || R.pick(['plain', 'port', 'river', 'port', 'river', 'walled']);
    const port = v === 'port', river = v === 'river' || (port && R.ch(0.25)), walled = v === 'walled' || (G.w >= 50 && G.h >= 38 && R.ch(0.35));
    let x0 = 0, y0 = 0, x1 = G.w - 1, y1 = G.h - 1;
    const shore = port ? G.h - R.i(6, 9) : G.h;
    if (port) { for (let x = 0; x < G.w; x++) { const s = shore + R.i(-1, 1); for (let y = s; y < G.h; y++) G.set(x, y, 'water'); } y1 = shore - 3; }
    if (walled) { x0 = 3; y0 = 3; x1 = G.w - 4; if (!port) y1 = G.h - 4; }
    // Улицы
    const lines = (a, b) => { const res = []; let p = a + R.i(1, 3); while (p < b - 5) { const wd = R.ch(0.6) ? 2 : 1; res.push([p, wd]); p += wd + R.i(6, 11); } return res; };
    const vx = lines(x0, x1), hy = lines(y0, y1);
    // За стеной улицы идут до края карты — там, где они пересекают стену, будут ворота
    const ya = walled ? 0 : y0, yb = walled && !port ? G.h - 1 : y1, xa = walled ? 0 : x0, xb = walled ? G.w - 1 : x1;
    vx.forEach(([x, wd]) => { for (let y = ya; y <= yb; y++) for (let k = 0; k < wd; k++) G.set(x + k, y, 'road'); });
    hy.forEach(([y, wd]) => { for (let x = xa; x <= xb; x++) for (let k = 0; k < wd; k++) G.set(x, y + k, 'road'); });
    if (port) { for (let x = 0; x < G.w; x++) { G.set(x, y1 + 1, 'road'); G.set(x, y1 + 2, 'road'); } vx.forEach(([x, wd]) => { for (let y = y1; y <= y1 + 2; y++) for (let k = 0; k < wd; k++) G.set(x + k, y, 'road'); }); }
    // Река через город: улицы над ней становятся мостами
    if (river) {
      const vert = R.ch(0.5), roadsBefore = new Set();
      for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (G.g[y][x] === 'road') roadsBefore.add(`${x}_${y}`);
      band(G, R, 'water', 3, vert, (c) => port && c === 'water');
      roadsBefore.forEach((k) => { const [x, y] = k.split('_').map(Number); if (G.g[y][x] === 'water') G.g[y][x] = 'bridge'; });
    }
    // Кварталы между улицами
    const xs = [[x0 - 1, 1], ...vx, [x1 + 1, 1]], ys = [[y0 - 1, 1], ...hy, [y1 + 1, 1]], blocks = [];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      const bx = xs[i][0] + xs[i][1], by = ys[j][0] + ys[j][1], bw = xs[i + 1][0] - bx, bh = ys[j + 1][0] - by;
      if (bw >= 3 && bh >= 3) blocks.push({ x: bx, y: by, w: bw, h: bh, i, j });
    }
    // Площадь — квартал у центра, иногда вместе с соседним (тогда улица между ними тоже становится площадью)
    const dist = (b) => Math.hypot(b.x + b.w / 2 - G.w / 2, b.y + b.h / 2 - (port ? y1 : G.h) / 2);
    const land = blocks.filter((b) => { let water = 0; for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (G.get(x, y) === 'water') water++; return water < (b.w * b.h) / 3; });
    const plaza = land.slice().sort((a, b) => dist(a) - dist(b))[0];
    const plazaRect = plaza ? { ...plaza } : null;
    if (plaza) {
      const nb = land.find((b) => b.j === plaza.j && b.i === plaza.i + 1 && R.ch(0.5));
      if (nb) { plazaRect.w = nb.x + nb.w - plaza.x; nb.used = true; }
      for (let y = plazaRect.y; y < plazaRect.y + plazaRect.h; y++) for (let x = plazaRect.x; x < plazaRect.x + plazaRect.w; x++) if (G.get(x, y) !== 'water') G.set(x, y, 'road');
      const cx = plazaRect.x + Math.floor(plazaRect.w / 2), cy = plazaRect.y + Math.floor(plazaRect.h / 2);
      if (R.ch(0.6)) { G.set(cx, cy, 'water'); if (plazaRect.w >= 8) G.set(cx - 1, cy, 'water'); if (plazaRect.h >= 7) { G.set(cx, cy - 1, 'water'); if (plazaRect.w >= 8) G.set(cx - 1, cy - 1, 'water'); } }
      else G.set(cx, cy, 'rock'); // статуя
      if (plazaRect.w >= 7 && plazaRect.h >= 6) [[1, 1], [plazaRect.w - 2, 1], [1, plazaRect.h - 2], [plazaRect.w - 2, plazaRect.h - 2]].forEach(([dx, dy]) => { if (R.ch(0.6)) G.set(plazaRect.x + dx, plazaRect.y + dy, 'tree'); });
      out.lights.push({ x: cx + 1, y: cy + 1, b: 30, d: 30 });
      out.rooms.push({ ...plazaRect, kind: 'plaza' });
      plaza.used = true;
    }
    // Рынок — соседний с площадью квартал: прилавки рядами с проходами
    const market = land.filter((b) => !b.used && b.w >= 5 && b.h >= 5).sort((a, b) => dist(a) - dist(b))[0];
    if (market) {
      market.used = true;
      for (let y = market.y; y < market.y + market.h; y++) for (let x = market.x; x < market.x + market.w; x++) if (G.get(x, y) !== 'water') G.set(x, y, 'road');
      stalls(G, R, out, market.x, market.y, market.x + market.w - 1, market.y + market.h - 1);
      out.rooms.push({ x: market.x, y: market.y, w: market.w, h: market.h, kind: 'market' });
      out.lights.push({ x: market.x, y: market.y, b: 20, d: 20 });
    }
    // Дома: участки разного размера, иногда с отступом; внутренние участки без выхода на улицу — сады и дворы
    blocks.filter((b) => !b.used).forEach((b) => {
      splitLots(R, b.x, b.y, b.w, b.h, R.i(7, 11), R.i(6, 9), 4).forEach((L) => {
        const mx0 = R.ch(0.25) ? 1 : 0, my0 = R.ch(0.25) ? 1 : 0, mx1 = R.ch(0.25) ? 1 : 0, my1 = R.ch(0.25) ? 1 : 0;
        const hx = L.x + mx0, hy_ = L.y + my0, hw = L.w - mx0 - mx1, hh = L.h - my0 - my1;
        let clear = hw >= 4 && hh >= 4;
        for (let y = hy_; clear && y < hy_ + hh; y++) for (let x = hx; x < hx + hw; x++) if (G.get(x, y) !== '') { clear = false; break; }
        const side = clear ? doorSide(G, hx, hy_, hw, hh, R) : null;
        if (!side) { // сад или двор
          for (let y = L.y; y < L.y + L.h; y++) for (let x = L.x; x < L.x + L.w; x++) if (G.get(x, y) === '' && R.ch(0.25)) G.set(x, y, R.ch(0.5) ? 'tree' : 'bush');
          return;
        }
        building(G, out, hx, hy_, hw, hh, side, R, 0, true);
        const area = hw * hh, nearSea = port && hy_ + hh >= y1 - 1;
        out.rooms[out.rooms.length - 1].kind = nearSea && R.ch(0.5) ? 'warehouse' : area >= 56 ? R.pick(['manor', 'temple', 'tavern', 'house', 'warehouse']) : R.ch(0.2) ? 'shop' : 'house';
      });
    });
    // В каждом городе — хотя бы две лавки, таверна и храм
    [['shop', 5], ['tavern', 1], ['temple', 1], ['guild', 1]].forEach(([k, n]) => { for (let have = out.rooms.filter((r) => r.kind === k).length; have < n; have++) { const h = out.rooms.filter((r) => r.kind === 'house'); if (!h.length) break; R.pick(h).kind = k; } });
    // Лавки разные: кузница, алхимик, книжная, диковины и обычные
    out.rooms.filter((r) => r.kind === 'shop').forEach((r, i) => { r.shop = ['smithy', 'alchemy', 'shop', 'books', 'magic'][i % 5]; });
    // Порт: причалы в море, лодки у причалов
    if (port) {
      for (let x = R.i(2, 6); x < G.w - 3; x += R.i(7, 11)) {
        const len = R.i(3, 6), wd = R.ch(0.5) ? 2 : 1;
        for (let y = y1 + 3; y < Math.min(G.h - 1, y1 + 3 + len); y++) for (let k = 0; k < wd; k++) G.set(x + k, y, 'bridge');
        out.rooms.push({ x, y: y1 + 3, w: wd, h: len, kind: 'pier' });
        if (R.ch(0.7)) { const bx = x + wd + 1, by = y1 + 3 + R.i(1, Math.max(1, len - 2)); if (G.get(bx, by) === 'water' && G.get(bx, by + 1) === 'water') { G.set(bx, by, 'furn'); G.set(bx, by + 1, 'furn'); } }
      }
    }
    // Крепостная стена с воротами на главных улицах и башнями по углам
    if (walled) {
      const wx0 = x0 - 2, wy0 = y0 - 2, wx1 = x1 + 2, wy1 = port ? y1 + 3 : y1 + 2;
      for (let y = wy0; y <= wy1; y++) for (let x = wx0; x <= wx1; x++) {
        if (!(x === wx0 || x === wx1 || y === wy0 || (!port && y === wy1))) continue;
        if (G.get(x, y) === 'road' || G.get(x, y) === 'bridge') { out.doors[`${x}_${y}`] = { o: 1 }; continue; } // ворота открыты
        if (G.get(x, y) !== 'water') G.set(x, y, 'wall');
      }
      [[wx0, wy0], [wx1 - 2, wy0], ...(port ? [] : [[wx0, wy1 - 2], [wx1 - 2, wy1 - 2]])].forEach(([tx, ty]) => fillRect(G, tx, ty, 3, 3, 'wall'));
    }
    // Фонари на некоторых перекрёстках
    vx.forEach(([x]) => hy.forEach(([y]) => { if (R.ch(0.35)) out.lights.push({ x, y, b: 15, d: 15 }); }));
    out.ground = 'dirt';
    out.start = port && R.ch(0.5) ? openNear(G, Math.floor(G.w / 2), y1 + 2) : openNear(G, vx.length ? vx[0][0] : 1, 0);
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
      building(G, out, x, y, w, h, vertical ? (up ? 'e' : 'w') : (up ? 's' : 'n'), R, 0, true);
      { const r = out.rooms[out.rooms.length - 1]; r.kind = n === 0 ? 'tavern' : n === 1 || n === 2 ? 'shop' : 'house'; if (n === 1) r.shop = 'shop'; if (n === 2) r.shop = 'smithy'; }
      if (R.ch(0.5)) { const fx = vertical ? (up ? x - 4 : x + w + 1) : x, fy = vertical ? y : (up ? y - 3 : y + h + 1); for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) if (G.get(fx + i, fy + j) === '') G.set(fx + i, fy + j, 'difficult'); }
      n++;
    }
    // Мало места у дороги — остальные дома где свободно, дверью к дороге
    for (let t = 0; t < 400 && n < Math.ceil(houses / 2); t++) {
      const w = R.i(4, 5), h = 4, x = R.i(1, G.w - w - 1), y = R.i(1, G.h - h - 1);
      if (!fits(G, x, y, w, h)) continue;
      const c = road[Math.min(road.length - 1, vertical ? y : x)];
      building(G, out, x, y, w, h, vertical ? (x < c ? 'e' : 'w') : (y < c ? 's' : 'n'), R, 0, true);
      n++;
    }
    const wc = openNear(G, Math.floor(G.w / 2), Math.floor(G.h / 2), (v) => v === '');
    G.set(wc.x, wc.y, 'well');
    blobs(G, R, 'tree', Math.round(4 + o.density * 10), 1, 3, 0.6);
    blobs(G, R, 'bush', 5, 1, 2, 0.5);
    out.lights.push({ x: wc.x, y: wc.y + 1, b: 20, d: 20 });
    out.ground = 'grass'; out.start = vertical ? { x: road[0], y: 0 } : { x: 0, y: road[0] };
  }
  // Таверна: здание во дворе. Зал со стойкой, очагом и столами; за перегородкой — комнаты разной высоты и кухня с чёрным ходом.
  // Варианты: корчма (маленькая), постоялый двор (с конюшней), большая таверна (с кабинетом хозяина). Поворот карты — в generate
  // Верхний этаж здания (тот же контур, что у первого): посередине коридор, по обе стороны — комнаты с кроватями; у лестницы — открытая
  // площадка. Вокруг здания — пустота. down — лестница вниз (здесь появляется отряд), up — лестница выше (если этаж не последний)
  function upper(G, R, o, out, B, down, up, kind, span) {
    const { x0, y0, x1, y1 } = B;
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) G.set(x, y, x < x0 || x > x1 || y < y0 || y > y1 ? 'chasm' : x === x0 || x === x1 || y === y0 || y === y1 ? 'wall' : '');
    const ih = y1 - y0 - 1, cw = ih >= 13 ? 2 : 1, yc = y0 + 1 + Math.floor((ih - cw) / 2);
    let special = kind === 'guild' ? ['office', 'archive'] : [];
    // Комнаты на отрезке xa..xb; ya..yb — ряды комнаты, yw — ряд стены с дверью в коридор, far — ряд у наружной стены
    const rooms = (xa, xb, ya, yb, yw, far) => {
      for (let x = xa; x <= xb;) {
        let w = R.i(3, 5); if (xb - (x + w) < 3) w = xb - x + 1;
        const xe = x + w - 1, dx = R.i(x, xe), rk = special.length && w >= 3 ? special.shift() : 'room';
        if (xe < xb) for (let y = ya; y <= yb; y++) G.set(xe + 1, y, 'wall');
        G.set(dx, yw, ''); out.doors[`${dx}_${yw}`] = { o: 0, ...(rk === 'office' || R.ch(0.35) ? { l: 1 } : {}) };
        out.rooms.push({ x, y: ya, w, h: yb - ya + 1, kind: rk });
        const bx = dx - x > xe - dx ? x : xe, ox = bx === x ? xe : x;
        if (rk === 'archive') { for (let i = x; i <= xe; i++) G.set(i, far, 'furn'); } // полки вдоль стены
        else if (rk === 'office') { G.set(x + Math.floor(w / 2), far, 'furn'); out.chests.push({ x: bx, y: far }); } // стол главы и сундук
        else {
          G.set(bx, far, 'furn'); // кровать
          if (w >= 4 && R.ch(0.5)) G.set(ox, far, 'furn');
          if (o.chests && R.ch(0.35)) out.chests.push({ x: ox, y: far === ya ? yb : ya });
        }
        x = xe + 2;
      }
    };
    // Площадка у лестниц — в верхней полосе, открыта в коридор
    const ya = y0 + 1, yb = yc - 2;
    let lx0 = Math.max(x0 + 1, span[0]), lx1 = Math.min(x1 - 1, span[1]);
    if (lx0 - 1 - (x0 + 1) < 3) lx0 = x0 + 1;
    if (x1 - 1 - (lx1 + 1) < 3) lx1 = x1 - 1;
    for (let x = x0 + 1; x < x1; x++) { if (x < lx0 || x > lx1) G.set(x, yc - 1, 'wall'); G.set(x, yc + cw, 'wall'); }
    if (lx0 > x0 + 1) { for (let y = ya; y <= yb; y++) G.set(lx0 - 1, y, 'wall'); rooms(x0 + 1, lx0 - 2, ya, yb, yc - 1, ya); }
    if (lx1 < x1 - 1) { for (let y = ya; y <= yb; y++) G.set(lx1 + 1, y, 'wall'); rooms(lx1 + 2, x1 - 1, ya, yb, yc - 1, ya); }
    rooms(x0 + 1, x1 - 1, yc + cw + 1, y1 - 1, yc + cw, y1 - 1);
    setFlights(G, out, up, down);
    out.rooms.push({ x: lx0, y: ya, w: lx1 - lx0 + 1, h: yb - ya + 1, kind: 'landing' }, { x: x0 + 1, y: yc, w: x1 - x0 - 1, h: cw, kind: 'corridor' });
    out.lights.push({ x: lx0, y: yb, b: 15, d: 15 });
    for (let x = x0 + 3; x < x1 - 1; x += 7) out.lights.push({ x, y: yc, b: 15, d: 15 });
    // Отряд появляется на площадке рядом с проёмом, из которого поднялся
    out.ground = 'wood'; out.amb = 'dim'; out.start = { x: down.x + down.dx, y: down.y + down.dy + 1 };
  }
  // Лестничный марш — две клетки: (x, y) — нижняя, (dx, dy) — куда поднимается; высотой марш со стену.
  // Марши A и B стоят вдоль одной стены и чередуются: с нечётного этажа вверх ведёт A, с чётного — B
  const FL = (x, y, dx, dy) => ({ x, y, dx, dy });
  const flight = (o, floors, A, B) => [o.floor % 2 ? B : A, o.floor < floors ? (o.floor % 2 ? A : B) : null];
  function setFlights(G, out, up, down) {
    out.flights = [];
    [[up, 0], [down, 1]].forEach(([f, dn]) => { if (!f) return; G.set(f.x, f.y, 'stairs'); G.set(f.x + f.dx, f.y + f.dy, 'stairs'); out.flights.push({ ...f, down: dn }); });
  }
  function tavern(G, R, o, out) {
    const rv = R.pick(['inn', 'small', 'big', 'inn']), v = o.variant || rv;
    const bw = Math.min(G.w - 4, v === 'small' ? R.i(14, 18) : v === 'big' ? R.i(26, 34) : R.i(20, 26));
    const bh = Math.min(G.h - (v === 'inn' ? 9 : 5), v === 'small' ? R.i(10, 12) : v === 'big' ? R.i(15, 20) : R.i(12, 16));
    const x0 = Math.max(2, Math.floor((G.w - bw) / 2) + R.i(-2, 2)), y0 = 2, x1 = x0 + bw - 1, y1 = y0 + bh - 1;
    const split = x0 + Math.round(bw * (v === 'small' ? 0.62 : 0.5 + R.f() * 0.15));
    // Этажи: наверху номера; в большой таверне — два верхних этажа. Лестница — в углу зала у перегородки
    out.v = v; out.floors = v === 'big' ? 3 : 2;
    const stA = FL(split - 2, y0 + 1, 1, 0), stB = FL(split - 4, y0 + 1, -1, 0);
    if (o.floor > 1) { upper(G, R, o, out, { x0, y0, x1, y1 }, ...flight(o, out.floors, stA, stB), 'tavern', [split - 5, split - 1]); return; }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G.set(x, y, x === x0 || x === x1 || y === y0 || y === y1 ? 'wall' : 'floor');
    for (let y = y0; y <= y1; y++) G.set(split, y, 'wall');
    setFlights(G, out, stA, null);
    // Комнаты справа — нарезка по высоте 3–6 клеток; нижняя — кухня (не меньше 4)
    const cuts = [];
    let yy = y0;
    while (y1 - yy > 9) { yy += R.i(4, 6); cuts.push(yy); }
    cuts.forEach((cy) => { for (let x = split; x <= x1; x++) G.set(x, cy, 'wall'); });
    const bounds = [y0, ...cuts, y1];
    let kitchenDoor = null;
    for (let k = 0; k < bounds.length - 1; k++) {
      const ry0 = bounds[k], ry1 = bounds[k + 1], dy0 = ry0 + 1 + R.i(0, Math.max(0, ry1 - ry0 - 3)), dy = !k && dy0 === y0 + 1 && ry1 - ry0 > 2 ? dy0 + 1 : dy0, kitchen = k === bounds.length - 2; // дверь не упирается в лестницу
      G.set(split, dy, 'floor'); out.doors[`${split}_${dy}`] = { o: 0, ...(!kitchen && R.ch(0.45) ? { l: 1 } : {}) };
      const room = { x: split + 1, y: ry0 + 1, w: x1 - split - 1, h: ry1 - ry0 - 1, kind: kitchen ? 'kitchen' : 'room' };
      out.rooms.push(room);
      if (kitchen) {
        kitchenDoor = dy;
        G.set(x1 - 1, ry0 + 1, 'rock'); out.lights.push({ x: x1 - 2, y: ry0 + 1, b: 15, d: 15 }); // печь
        if (room.w >= 4 && room.h >= 3) G.set(split + 2, ry1 - 1, 'furn');
        const bd = ry0 + 1 + Math.floor(room.h / 2); G.set(x1, bd, 'floor'); out.doors[`${x1}_${bd}`] = { o: 0 }; // чёрный ход во двор
      } else {
        G.set(x1 - 1, ry0 + 1, 'furn'); // кровать
        if (room.h >= 3 && R.ch(0.5)) G.set(x1 - 1, ry1 - 1, 'furn');
        if (o.chests && R.ch(0.4)) out.chests.push({ x: split + 1, y: ry1 - 1 });
      }
    }
    // Стойка у двери на кухню: вертикальная с загибом
    const hx0 = x0 + 1, hx1 = split - 1, hy0 = y0 + 1, hy1 = y1 - 1, kd = kitchenDoor || Math.floor((y0 + y1) / 2);
    const barX = split - 3, barY0 = Math.max(hy0 + 1, kd - 2), barY1 = Math.min(hy1 - 2, kd + 2);
    for (let y = barY0; y <= barY1; y++) G.set(barX, y, 'furn');
    G.set(barX + 1, barY1, 'furn');
    if (barY0 < kd - 1) G.set(split - 1, barY0, 'crate'); // бочки за стойкой
    out.rooms.push({ x: barX + 1, y: barY0, w: 1, h: barY1 - barY0, kind: 'bar' });
    // Очаг на внешней стене и кабинет хозяина в большой таверне
    const fy = hy0 + R.i(1, Math.max(1, hy1 - hy0 - 3));
    G.set(hx0, fy, 'rock'); G.set(hx0, fy + 1, 'rock'); out.lights.push({ x: hx0 + 1, y: fy, b: 20, d: 20 });
    let office = null;
    if (v === 'big' && hx1 - hx0 > 12) {
      office = { x: hx0, y: hy0, w: 5, h: 4 };
      for (let y = hy0; y <= hy0 + 4; y++) G.set(hx0 + 5, y, 'wall');
      for (let x = hx0; x <= hx0 + 5; x++) G.set(x, hy0 + 4, 'wall');
      G.set(hx0 + 5, hy0 + 2, 'floor'); out.doors[`${hx0 + 5}_${hy0 + 2}`] = { o: 0, l: 1 };
      G.set(hx0 + 1, hy0 + 1, 'furn');
      out.rooms.push({ x: hx0, y: hy0, w: 5, h: 4, kind: 'office' });
      if (o.chests) out.chests.push({ x: hx0 + 3, y: hy0 + 1 });
    }
    // Столы 1×1, 2×1 и 2×2 там, где вокруг свободно — проходы остаются
    const freeArea = (x, y, w, h) => { for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) if (G.get(i, j) !== 'floor') return false; return true; };
    const inOffice = (x, y) => office && x <= office.x + 6 && y <= office.y + 5;
    for (let t = 0, n = 0; t < 300 && n < Math.round(((hx1 - hx0) * (hy1 - hy0)) / 14); t++) {
      const [w, h] = R.pick([[1, 1], [2, 1], [2, 1], [1, 2], [2, 2]]), x = R.i(hx0 + 1, hx1 - w - 2), y = R.i(hy0 + 1, hy1 - h);
      if (x + w >= barX - 1 || inOffice(x, y) || !freeArea(x, y, w, h)) continue;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) G.set(x + i, y + j, 'furn');
      n++;
    }
    out.rooms.push({ x: hx0, y: hy0, w: hx1 - hx0 + 1, h: hy1 - hy0 + 1, kind: 'hall' });
    out.lights.push({ x: Math.floor((hx0 + barX) / 2), y: hy1, b: 20, d: 20 }, { x: barX + 1, y: barY0 - 1, b: 15, d: 15 });
    // Вход снизу посередине зала, дорога со двора к краю карты
    const ex = Math.floor((hx0 + barX) / 2);
    G.set(ex, y1, 'floor'); out.doors[`${ex}_${y1}`] = { o: 0 };
    for (let y = y1 + 1; y < G.h; y++) G.set(ex, y, 'road');
    out.lights.push({ x: ex + 1, y: y1 + 1, b: 15, d: 15 });
    // Постоялый двор: конюшня и колодец во дворе
    if (v === 'inn' && G.h - y1 >= 8) {
      const sw = R.i(6, 8), sx = ex + 3 <= G.w - sw - 2 ? ex + 3 : Math.max(1, ex - sw - 2), sy = y1 + 3;
      if (fits(G, sx, sy, sw, 4)) {
        building(G, out, sx, sy, sw, 4, sx > ex ? 'w' : 'e', R);
        out.rooms[out.rooms.length - 1].kind = 'stable';
        for (let i = sx + 1; i < sx + sw - 1; i += 2) G.set(i, sy + 1, 'difficult');
      }
      const wl = openNear(G, ex - 3, y1 + 3, (c) => c === '');
      G.set(wl.x, wl.y, 'well');
    }
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 160), 1, 2, 0.6);
    blobs(G, R, 'bush', 3, 1, 1, 0.5);
    out.ground = 'grass'; out.amb = 'dim'; out.start = { x: ex, y: G.h - 1 };
    fixReach(G, out, [x0 - 1, y0 - 1, G.w, G.h]);
  }

  // Гильдия приключенцев: зал со стойкой регистрации и доской заказов; за стойкой — канцелярия и хранилище, в углу — лестница.
  // Наверху (второй этаж) — кабинет главы гильдии, архив и комнаты для приезжих
  function guild(G, R, o, out) {
    const bw = Math.min(G.w - 4, R.i(22, 28)), bh = Math.min(G.h - 6, R.i(14, 17));
    const x0 = Math.max(2, Math.floor((G.w - bw) / 2) + R.i(-1, 1)), y0 = 2, x1 = x0 + bw - 1, y1 = y0 + bh - 1;
    out.floors = 2;
    const stA = FL(x1 - 2, y0 + 1, 1, 0);
    if (o.floor > 1) { upper(G, R, o, out, { x0, y0, x1, y1 }, ...flight(o, out.floors, stA, stA), 'guild', [x1 - 4, x1 - 1]); return; }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G.set(x, y, x === x0 || x === x1 || y === y0 || y === y1 ? 'wall' : 'floor');
    // Задняя полоса: канцелярия | хранилище | лестничный угол (открыт в зал)
    const yb = y0 + 5, xa = x0 + Math.round(bw * 0.36), xs = x1 - 5;
    for (let x = x0; x <= xs; x++) G.set(x, yb, 'wall');
    for (let y = y0; y <= yb; y++) { G.set(xa, y, 'wall'); G.set(xs, y, 'wall'); }
    setFlights(G, out, stA, null);
    const od = R.i(x0 + 2, xa - 2), vd = R.i(xa + 2, xs - 2);
    G.set(od, yb, 'floor'); out.doors[`${od}_${yb}`] = { o: 0 };
    G.set(vd, yb, 'floor'); out.doors[`${vd}_${yb}`] = { o: 0, l: 1 };
    G.set(x0 + 1, y0 + 1, 'furn'); G.set(x0 + 2, y0 + 1, 'furn'); if (xa - x0 > 5) G.set(xa - 1, y0 + 2, 'furn'); // столы писарей
    for (let x = xa + 1; x < xs; x++) if (R.ch(0.6)) G.set(x, y0 + 1, 'crate'); // трофеи и припасы
    out.chests.push({ x: xa + 1, y: yb - 1 }, { x: xs - 1, y: yb - 1 });
    out.rooms.push({ x: x0 + 1, y: y0 + 1, w: xa - x0 - 1, h: 4, kind: 'office' }, { x: xa + 1, y: y0 + 1, w: xs - xa - 1, h: 4, kind: 'vault' }, { x: xs + 1, y: y0 + 1, w: x1 - xs - 1, h: 4, kind: 'landing' });
    // Стойка регистрации перед дверями в заднюю полосу; с краёв — проходы для служащих
    const yr = yb + 3, cx0 = x0 + 4, cx1 = xs - 1;
    for (let x = cx0; x <= cx1; x++) G.set(x, yr, 'furn');
    out.rooms.push({ x: cx0, y: yb + 1, w: cx1 - cx0 + 1, h: 2, kind: 'reception' });
    // Доска заказов — на стене зала слева от входа
    const by1 = y1 - 1, by0 = Math.max(yr + 1, by1 - 2);
    for (let y = by0; y <= by1; y++) G.set(x0 + 1, y, 'board');
    out.rooms.push({ x: x0 + 2, y: by0, w: 2, h: by1 - by0 + 1, kind: 'board' });
    // Столы для отдыхающих авантюристов — в правой части зала
    const ex = Math.floor((x0 + x1) / 2);
    const freeArea = (x, y, w, h) => { for (let j = y - 1; j <= y + h; j++) for (let i = x - 1; i <= x + w; i++) if (G.get(i, j) !== 'floor') return false; return true; };
    for (let t = 0, n = 0; t < 200 && n < Math.max(2, Math.round((x1 - ex) / 3)); t++) {
      const [w, h] = R.pick([[1, 1], [2, 1], [1, 2], [2, 2]]), x = R.i(ex + 2, x1 - w - 1), y = R.i(yb + 2, y1 - h - 1);
      if (!freeArea(x, y, w, h)) continue;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) G.set(x + i, y + j, 'furn');
      n++;
    }
    out.rooms.push({ x: x0 + 1, y: yr + 1, w: x1 - x0 - 1, h: y1 - yr - 1, kind: 'hall' });
    G.set(ex, y1, 'floor'); out.doors[`${ex}_${y1}`] = { o: 0 };
    for (let y = y1 + 1; y < G.h; y++) G.set(ex, y, 'road');
    out.lights.push({ x: ex + 1, y: y1 + 1, b: 15, d: 15 }, { x: x0 + 2, y: by0, b: 15, d: 15 }, { x: cx0 + 1, y: yb + 1, b: 20, d: 20 }, { x: cx1 - 1, y: yb + 1, b: 20, d: 20 }, { x: x1 - 1, y: y1 - 1, b: 20, d: 20 }, { x: x1 - 1, y: yb, b: 15, d: 15 });
    blobs(G, R, 'tree', Math.round((G.w * G.h) / 170), 1, 2, 0.6);
    blobs(G, R, 'bush', 3, 1, 1, 0.5);
    out.ground = 'grass'; out.amb = 'dim'; out.start = { x: ex, y: G.h - 1 };
  }

  // Интерьер закрытого дома: всё поле — одно здание изнутри (вокруг пустота), выход — дверь внизу (out.exit).
  // Впереди зал (у лавок — с прилавком и товаром), за перегородкой — две задние комнаты: спальня, кладовая, контора.
  // out.props — что за предмет стоит в клетке мебели, out.decor — что висит на стене ('вид:сторона')
  function house(G, R, o, out) {
    const rv = R.pick(['home', 'home', 'smithy', 'shop', 'books', 'magic', 'alchemy']), v = o.variant || rv;
    const SZ = { home: [14, 11], smithy: [17, 13], shop: [16, 12], books: [18, 13], magic: [16, 12], alchemy: [16, 12], warehouse: [18, 12], tavern: [20, 14], chapel: [15, 18], guildhall: [20, 15] }[v] || [14, 11];
    const bw = Math.min(G.w - 2, SZ[0] + R.i(0, 2)), bh = Math.min(G.h - 2, SZ[1] + R.i(0, 1));
    const x0 = Math.floor((G.w - bw) / 2), y0 = Math.floor((G.h - bh) / 2), x1 = x0 + bw - 1, y1 = y0 + bh - 1;
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) G.set(x, y, x < x0 || x > x1 || y < y0 || y > y1 ? 'chasm' : x === x0 || x === x1 || y === y0 || y === y1 ? 'wall' : '');
    out.props = {}; out.decor = {}; out.v = v;
    const put = (x, y, p) => { if (G.get(x, y) !== '') return false; G.set(x, y, 'furn'); out.props[`${x}_${y}`] = p; return true; };
    const lay = (x, y, p) => { if (G.get(x, y) === '') out.props[`${x}_${y}`] = p; }; // ковёр: лежит на полу, ходить не мешает
    const hang = (x, y, d, side) => { if (G.get(x, y) === 'wall' && !out.doors[`${x}_${y}`]) out.decor[`${x}_${y}`] = `${d}:${side}`; };
    const ix0 = x0 + 1, ix1 = x1 - 1, iy0 = y0 + 1, iy1 = y1 - 1, ex = x0 + Math.floor(bw / 2);
    G.set(ex, y1, ''); out.doors[`${ex}_${y1}`] = { o: 0 }; out.exit = { x: ex, y: y1 };
    let hy0 = iy0;
    const bdx = []; // двери задних комнат: клетку под ними в зале оставляем свободной
    if (v !== 'warehouse') {
      // Задние комнаты
      const yb = iy0 + 3, xm = ix0 + Math.floor((ix1 - ix0) * (0.42 + R.f() * 0.16));
      for (let x = x0; x <= x1; x++) G.set(x, yb, 'wall');
      for (let y = y0; y <= yb; y++) G.set(xm, y, 'wall');
      const A = { x: ix0, y: iy0, w: xm - ix0, h: 3 }, B = { x: xm + 1, y: iy0, w: ix1 - xm, h: 3 };
      const bed = (r, locked) => { put(r.x, r.y, 'bed'); if (r.w >= 5 && R.ch(0.6)) put(r.x + r.w - 1, r.y, 'bed'); put(r.x + Math.floor(r.w / 2), r.y, 'wardrobe'); lay(r.x + 1, r.y + 1, 'rug'); out.rooms.push({ ...r, kind: 'room' }); return locked; };
      const store = (r, chests) => { for (let x = r.x; x < r.x + r.w; x++) if (R.ch(0.6)) G.set(x, r.y, 'crate'); if (R.ch(0.5)) G.set(r.x, r.y + 2, 'crate'); for (let i = 0; i < chests; i++) out.chests.push({ x: r.x + r.w - 1 - i, y: r.y + 2 }); out.rooms.push({ ...r, kind: 'store' }); };
      const office = (r) => { put(r.x + Math.floor(r.w / 2), r.y + 1, 'desk'); for (let x = r.x; x < r.x + r.w; x++) put(x, r.y, 'books'); out.chests.push({ x: r.x, y: r.y + 2 }); out.rooms.push({ ...r, kind: 'office' }); };
      const plan = { home: ['bed', 'bed'], smithy: ['bed', 'store'], shop: ['store', 'bed'], books: ['office', 'bed'], magic: ['vault', 'bed'], alchemy: ['store', 'bed'], tavern: ['store', 'bed'], chapel: ['office', 'store'], guildhall: ['office', 'vault'] }[v] || ['bed', 'store'];
      [A, B].forEach((r, i) => {
        const k = plan[i], dx = R.i(r.x + 1, r.x + r.w - 2), lock = k === 'vault' || (k !== 'bed' && R.ch(0.4));
        G.set(dx, yb, ''); out.doors[`${dx}_${yb}`] = { o: 0, ...(lock ? { l: 1 } : {}) }; bdx.push(dx);
        if (k === 'bed') bed(r); else if (k === 'office') office(r); else store(r, k === 'vault' ? 2 : R.ch(0.5) ? 1 : 0); if (G.get(dx, yb - 1) === 'crate') G.set(dx, yb - 1, ''); // проход от двери в кладовую
        out.lights.push({ x: r.x + r.w - 1, y: r.y + 1, b: 10, d: 10 });
      });
      hy0 = yb + 1;
    }
    const hall = { x: ix0, y: hy0, w: ix1 - ix0 + 1, h: iy1 - hy0 + 1 }, wy = hy0 - 1; // wy — ряд стены над залом
    const shelfW = (p, from = hy0 + 2) => { for (let y = from; y <= iy1 - 1; y++) put(ix0, y, p); }, shelfE = (p, from = hy0 + 2) => { for (let y = from; y <= iy1 - 1; y++) put(ix1, y, p); };
    // Прилавок: продавец стоит за ним, у задней стены; справа — проход
    const counter = () => { for (let x = ix0 + 1; x <= ix1 - 3; x++) put(x, hy0 + 1, 'counter'); out.rooms.push({ x: ix0, y: hy0, w: ix1 - ix0 - 2, h: 1, kind: 'counter' }); };
    if (v === 'home') {
      G.set(ix0, hy0 + 1, 'rock'); out.lights.push({ x: ix0 + 1, y: hy0 + 1, b: 15, d: 15 }); // очаг
      put(ix0 + 1, hy0 + 2, 'cauldron');
      put(ex - 3, hy0 + 3, 'table'); put(ex - 2, hy0 + 3, 'table');
      put(ix1, hy0 + 1, 'goods'); put(ix1, hy0 + 2, 'goods'); put(ix1, iy1, 'wardrobe');
      lay(ex, hy0 + 2, 'rug'); lay(ex + 1, hy0 + 2, 'rug');
      out.chests.push({ x: ix1 - 1, y: iy1 });
      hang(ex + 2, wy, 'painting', 's'); hang(x0, hy0 + 3, 'painting', 'e'); hang(x1, hy0 + 4, 'antlers', 'w');
    } else if (v === 'smithy') {
      // Горн у стены, наковальня рядом, верстак с инструментом, стойка с оружием, бочка с водой; справа — прилавок
      G.set(ix0, hy0 + 2, 'rock'); G.set(ix0, hy0 + 3, 'rock'); out.lights.push({ x: ix0 + 1, y: hy0 + 2, b: 20, d: 20 });
      put(ix0 + 2, hy0 + 3, 'anvil'); put(ix0 + 2, hy0 + 1, 'trough'); put(ix0 + 1, hy0 + 5, 'coal');
      put(ix0 + 1, iy1, 'bench'); put(ix0 + 2, iy1, 'bench'); put(ix0 + 3, iy1, 'grind');
      for (let x = ex + 2; x <= ix1 - 1; x++) put(x, hy0 + 2, 'counter');
      out.rooms.push({ x: ex + 2, y: hy0, w: ix1 - ex - 1, h: 2, kind: 'counter' });
      shelfE('rack', hy0 + 3); put(ex + 3, iy1, 'armor');
      [ix0 + 2, ix0 + 4, ex - 1].forEach((x) => hang(x, wy, 'tools', 's')); hang(x0, hy0 + 5, 'tools', 'e'); hang(x1, hy0 + 1, 'shield', 'w');
    } else if (v === 'tavern') {
      // Зал таверны: стойка с бочками справа, очаг слева, столы рядами
      for (let x = ex + 2; x <= ix1 - 1; x++) put(x, hy0 + 2, 'counter');
      out.rooms.push({ x: ex + 2, y: hy0, w: ix1 - ex - 1, h: 2, kind: 'bar' });
      G.set(ix1, hy0, 'crate'); G.set(ix1 - 1, hy0, 'crate');
      G.set(ix0, hy0 + 2, 'rock'); G.set(ix0, hy0 + 3, 'rock'); out.lights.push({ x: ix0 + 1, y: hy0 + 2, b: 20, d: 20 });
      for (let y = hy0 + 4; y <= iy1 - 2; y += 3) for (let x = ix0 + 2; x <= ix1 - 2; x += 4) if (Math.abs(x - ex) > 1 && Math.abs(x + 1 - ex) > 1) { put(x, y, 'table'); put(x + 1, y, 'table'); }
      lay(ex, iy1 - 1, 'rug');
      hang(ix0 + 2, wy, 'antlers', 's'); hang(x0, hy0 + 5, 'shield', 'e'); hang(x1, iy1 - 2, 'painting', 'w'); hang(ex - 2, wy, 'painting', 's');
    } else if (v === 'chapel') {
      // Часовня: алтарь и запрестольный образ в дальнем конце, свечи, кафедра, скамьи по обе стороны прохода
      for (let i = ex - 1; i <= ex + 1; i++) { put(i, hy0, 'retable'); put(i, hy0 + 1, 'altar'); }
      [ex - 3, ex + 3].forEach((i) => { put(i, hy0 + 1, 'candelabra'); out.lights.push({ x: i, y: hy0 + 1, b: 20, d: 20 }); });
      put(ex - 3, hy0 + 3, 'lectern');
      out.rooms.push({ x: ex - 2, y: hy0 + 2, w: 5, h: 2, kind: 'altar' });
      for (let y = hy0 + 5; y <= iy1 - 2; y += 2) { for (let x = ix0 + 1; x <= ex - 2; x++) put(x, y, 'pew'); for (let x = ex + 2; x <= ix1 - 1; x++) put(x, y, 'pew'); }
      for (let y = hy0 + 2; y <= iy1; y++) lay(ex, y, 'rug');
      hang(x0, hy0 + 4, 'tapestry', 'e'); hang(x1, hy0 + 4, 'tapestry', 'w'); hang(x0, iy1 - 2, 'tapestry', 'e'); hang(x1, iy1 - 2, 'tapestry', 'w');
    } else if (v === 'guildhall') {
      // Гильдия: стойка регистратора, доска заданий у стены, столы для сделок, стойка с оружием
      for (let x = ix0 + 4; x <= ex + 2; x++) put(x, hy0 + 1, 'counter');
      out.rooms.push({ x: ix0 + 4, y: hy0, w: ex - ix0 - 1, h: 1, kind: 'reception' });
      for (let y = hy0 + 3; y <= hy0 + 5; y++) G.set(ix0, y, 'board');
      out.rooms.push({ x: ix0 + 1, y: hy0 + 3, w: 2, h: 3, kind: 'board' });
      [[ex + 3, hy0 + 4], [ex + 3, iy1 - 2], [ex - 4, iy1 - 2]].forEach(([x, y]) => { put(x, y, 'table'); put(x + 1, y, 'table'); });
      shelfE('rack', hy0 + 2);
      hang(ex - 1, wy, 'map', 's'); hang(ex + 4, wy, 'shield', 's'); hang(x0, iy1 - 1, 'painting', 'e');
    } else if (v === 'warehouse') {
      for (let y = iy0 + 1; y <= iy1 - 2; y += 3) for (let x = ix0 + 1; x <= ix1 - 1; x++) if (Math.abs(x - ex) > 1 && R.ch(0.8)) { G.set(x, y, 'crate'); if (R.ch(0.5)) G.set(x, y + 1, 'crate'); }
      put(ix1, iy1, 'desk'); out.chests.push({ x: ix0, y: iy0 });
    } else {
      counter();
      const goods = { shop: 'goods', books: 'books', magic: 'curio', alchemy: 'potions' }[v];
      shelfW(goods); shelfE(goods);
      if (v === 'shop') { [[ex - 3, hy0 + 3], [ex + 3, hy0 + 4]].forEach(([x, y]) => { put(x, y, 'table'); put(x + 1, y, 'table'); }); G.set(ix0 + 2, iy1, 'crate'); G.set(ix1 - 2, iy1, 'crate'); hang(ex + 2, wy, 'painting', 's'); }
      if (v === 'books') { for (let x = ix0 + 3; x <= ix1 - 3; x += 3) if (Math.abs(x - ex) > 1) for (let y = hy0 + 3; y <= iy1 - 1; y++) put(x, y, 'books'); put(ex + 1, iy1, 'desk'); hang(ix0 + 3, wy, 'painting', 's'); hang(ix1 - 2, wy, 'map', 's'); }
      if (v === 'magic') { [[ex - 3, hy0 + 3], [ex + 3, hy0 + 3], [ex - 3, iy1 - 1], [ex + 3, iy1 - 1]].forEach(([x, y], i) => put(x, y, i % 2 ? 'orb' : 'pedestal')); for (let y = hy0 + 3; y <= hy0 + 4; y++) for (let x = ex - 1; x <= ex + 1; x++) lay(x, y, 'rug'); hang(ix0 + 2, wy, 'tapestry', 's'); hang(ix1 - 2, wy, 'tapestry', 's'); hang(ex, wy, 'mirror', 's'); }
      if (v === 'alchemy') { put(ex - 3, hy0 + 3, 'alembic'); put(ex - 2, hy0 + 3, 'alembic'); put(ex + 3, hy0 + 4, 'cauldron'); G.set(ix1 - 1, iy1, 'crate'); hang(ix0 + 2, wy, 'herbs', 's'); hang(ix1 - 2, wy, 'herbs', 's'); hang(ex + 2, wy, 'herbs', 's'); }
    }
    bdx.forEach((x) => { if (G.get(x, hy0) !== '') { G.set(x, hy0, ''); delete out.props[`${x}_${hy0}`]; } });
    out.rooms.push({ ...hall, kind: v === 'home' || v === 'tavern' || v === 'guildhall' ? 'hall' : v === 'chapel' ? 'nave' : v === 'warehouse' ? 'warehouse' : 'shop' });
    out.lights.push({ x: ex - 1, y: iy1, b: 15, d: 15 }, { x: ix1 - 1, y: hy0, b: 15, d: 15 });
    // Пол: в кузнице и у алхимика каменный, в остальных — дощатый
    out.ground = v === 'smithy' || v === 'alchemy' || v === 'chapel' ? '' : 'wood'; out.amb = 'dim'; out.start = { x: ex, y: iy1 };
  }

  // variants — особенности на выбор ('' — случайно); rot — карту можно повернуть (ворота, море, вход — с любой стороны)
  const CAMPS = [['goblins', 'лагерь гоблинов'], ['bandits', 'лагерь бандитов']];
  const TEMPLATES = {
    forest: { n: '🌲 Лес', kind: 'terrain', fn: forest, w: 36, h: 26, road: true, variants: [['none', 'только лес'], ['hut', 'жилая лачуга'], ['ruin', 'заброшенная лачуга'], ...CAMPS, ['fairy', 'кольцо фей'], ['circle', 'каменный круг'], ['idol', 'поляна с идолом'], ['fallen', 'упавшее дерево через ручей']] },
    river: { n: '🏞 Река', kind: 'terrain', fn: river, w: 36, h: 26, road: true, variants: [['none', 'только река'], ['ford', 'брод'], ['mill', 'водяная мельница']] },
    mountains: { n: '⛰ Горы', kind: 'terrain', fn: mountains, w: 36, h: 26, road: true, variants: [['none', 'без построек'], ...CAMPS, ['ruin', 'заброшенная хижина'], ['mine', 'вход в шахту'], ['rockslide', 'обвал']] },
    plains: { n: '🌾 Равнина', kind: 'terrain', fn: plains, w: 36, h: 26, road: true, variants: [['none', 'без построек'], ['hut', 'хутор'], ['ruin', 'заброшенный хутор'], ['bandits', 'лагерь бандитов'], ['circle', 'каменный круг'], ['barrow', 'курган'], ['tower', 'развалины сторожевой башни'], ['ravine', 'овраг']] },
    swamp: { n: '🐸 Болото', kind: 'terrain', fn: swamp, w: 36, h: 26, road: false, variants: [['none', 'только болото'], ['sunken', 'затонувшие руины'], ['witch', 'хижина ведьмы']] },
    desert: { n: '🏜 Пустыня', kind: 'terrain', fn: desert, w: 36, h: 26, road: false, variants: [['none', 'только пески'], ['oasis', 'оазис'], ['pyramid', 'руины пирамиды'], ['skeleton', 'кости великана']] },
    coast: { n: '🌊 Побережье', kind: 'terrain', fn: coast, w: 36, h: 26, road: false, variants: [['none', 'только берег'], ['wreck', 'затонувший корабль'], ['lighthouse', 'маяк']] },
    dungeon: { n: '🏚 Подземелье', kind: 'location', fn: dungeon, w: 48, h: 34, chests: true, minW: 20, minH: 16, variants: Object.entries(DTHEME).map(([k, t]) => [k, t.n]) },
    cave: { n: '🕳 Пещеры', kind: 'location', fn: cave, w: 42, h: 30, chests: true, minW: 16, minH: 12 },
    castle: { n: '🏰 Замок', kind: 'location', fn: castle, w: 52, h: 42, chests: true, peaceful: true, minW: 34, minH: 28, rot: true, connect: true,
      variants: [['simple', 'одна стена'], ['double', 'двойные стены'], ['garden', 'с садом']] },
    city: { n: '🏙 Город', kind: 'location', fn: city, w: 60, h: 44, chests: false, peaceful: true, minW: 34, minH: 26, rot: true, connect: true,
      variants: [['plain', 'обычный'], ['port', 'портовый'], ['river', 'на реке'], ['walled', 'за крепостной стеной']] },
    village: { n: '🏡 Деревня', kind: 'location', fn: village, w: 46, h: 34, chests: false, peaceful: true, minW: 24, minH: 18, connect: true },
    tavern: { n: '🍺 Таверна', kind: 'location', fn: tavern, w: 34, h: 26, chests: false, peaceful: true, minW: 22, minH: 18, rot: true, connect: true,
      variants: [['small', 'корчма'], ['inn', 'постоялый двор'], ['big', 'большая таверна']] },
    house: { n: '🏠 Дом или лавка (внутри)', kind: 'location', fn: house, w: 22, h: 17, chests: false, peaceful: true, minW: 20, minH: 15,
      variants: [['home', 'жилой дом'], ['smithy', 'кузница'], ['shop', 'лавка: снаряжение и припасы'], ['books', 'книжная лавка'], ['magic', 'лавка диковин'], ['alchemy', 'лавка алхимика'], ['warehouse', 'склад'], ['tavern', 'таверна (зал)'], ['chapel', 'храм (часовня)'], ['guildhall', 'гильдия (зал)']] },
    guild: { n: '🛡 Гильдия приключенцев', kind: 'location', fn: guild, w: 36, h: 26, chests: false, peaceful: true, minW: 28, minH: 24, rot: true, connect: true },
    pass: { n: '🏔 Перевал', kind: 'terrain', fn: pass, w: 40, h: 26, variants: [['bridge', 'мост над пропастью'], ['pass', 'горная тропа'], ['snow', 'заснеженный, с пропастью']] },
    volcano: { n: '🌋 Вулкан', kind: 'terrain', fn: volcano, w: 38, h: 28 },
    ruins: { n: '🏚 Руины города', kind: 'terrain', fn: ruins, w: 44, h: 32, chests: true, connect: true },
    graveyard: { n: '🪦 Кладбище', kind: 'location', fn: graveyard, w: 32, h: 24, chests: true, minW: 22, minH: 18, connect: true },
    crypt: { n: '⚰ Склеп и катакомбы', kind: 'location', fn: crypt, w: 40, h: 30, chests: true, minW: 20, minH: 16 },
    temple: { n: '⛪ Храм', kind: 'location', fn: temple, w: 34, h: 36, chests: true, peaceful: true, minW: 26, minH: 30, rot: true, connect: true },
    tower: { n: '🗼 Башня мага', kind: 'location', fn: tower, w: 30, h: 28, chests: true, minW: 22, minH: 22 },
    manor: { n: '🏛 Особняк', kind: 'location', fn: manor, w: 34, h: 30, chests: true, peaceful: true, minW: 28, minH: 26, rot: true },
    mine: { n: '⛏ Шахта', kind: 'location', fn: mine, w: 44, h: 30, chests: true, minW: 20, minH: 16 },
    sewer: { n: '🕳 Канализация', kind: 'location', fn: sewer, w: 44, h: 32, chests: true, minW: 24, minH: 18 },
    underdark: { n: '🍄 Подземье', kind: 'location', fn: underdark, w: 50, h: 36, chests: true, minW: 20, minH: 16 },
    lair: { n: '🐉 Логово дракона', kind: 'location', fn: lair, w: 46, h: 32, chests: true, minW: 26, minH: 20, variants: [['red', 'огненное (лава)'], ['blue', 'водное']] },
    ship: { n: '⛵ Корабль', kind: 'location', fn: ship, w: 40, h: 26, chests: true, minW: 26, minH: 16, variants: [['one', 'один корабль'], ['two', 'два корабля — абордаж']] },
    arena: { n: '🏟 Арена', kind: 'location', fn: arena, w: 40, h: 30, chests: false, minW: 24, minH: 18 },
    fair: { n: '🎪 Ярмарка', kind: 'location', fn: fair, w: 40, h: 30, chests: false, peaceful: true, minW: 24, minH: 18 },
    // Карта мира: клетка — миля; места на ней открываются локальными картами
    world: { n: '🌍 Регион (карта мира)', kind: 'world', fn: world, w: 64, h: 46, minW: 30, minH: 22 },
  };
  // Поворот на 90° по часовой: клетки, двери, свет, сундуки, комнаты и вход
  function rot90(G, out) {
    const H = G.h, NG = grid(H, G.w), P = (x, y) => [H - 1 - y, x];
    for (let y = 0; y < H; y++) for (let x = 0; x < G.w; x++) NG.g[x][H - 1 - y] = G.g[y][x];
    out.doors = Object.fromEntries(Object.entries(out.doors).map(([k, d]) => { const [x, y] = k.split('_').map(Number), [nx, ny] = P(x, y); return [`${nx}_${ny}`, d]; }));
    out.lights = out.lights.map((L) => { const [x, y] = P(L.x, L.y); return { ...L, x, y }; });
    out.chests = out.chests.map((c) => { const [x, y] = P(c.x, c.y); return { ...c, x, y }; });
    const PK = (k) => { const [x, y] = k.split('_').map(Number), [nx, ny] = P(x, y); return `${nx}_${ny}`; };
    out.rooms = out.rooms.map((r) => ({ ...r, x: H - (r.y + r.h), y: r.x, w: r.h, h: r.w, ...(r.door ? { door: PK(r.door) } : {}) }));
    if (out.props) out.props = Object.fromEntries(Object.entries(out.props).map(([k, v]) => [PK(k), v]));
    if (out.decor) out.decor = Object.fromEntries(Object.entries(out.decor).map(([k, v]) => [PK(k), v.replace(/:([nesw])$/, (m, d) => `:${{ n: 'e', e: 's', s: 'w', w: 'n' }[d]}`)]));
    if (out.exit) { const [x, y] = P(out.exit.x, out.exit.y); out.exit = { x, y }; }
    const [sx, sy] = P(out.start.x, out.start.y);
    out.start = { x: sx, y: sy };
    if (out.flights) out.flights = out.flights.map((f) => { const [x, y] = P(f.x, f.y); return { x, y, dx: -f.dy, dy: f.dx, down: f.down }; });
    return NG;
  }
  // Местность: замкнутые деревьями и скалами карманы соединяются с основной областью просекой
  const SOLID = new Set(['wall', 'tree', 'rock', 'furn', 'lava', 'chasm', 'grave', 'mushroom', 'crate', 'board', 'well', 'roof']);
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
        if (SOLID.has(G.g[cy][cx])) G.g[cy][cx] = { rock: 'rubble', tree: 'thicket', chasm: 'bridge', lava: 'rubble' }[G.g[cy][cx]] || '';
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
    // Поворачиваемые шаблоны строятся «входом вниз» на поле нужной ориентации и затем поворачиваются
    const R = rng(o.seed || 1), k = T.rot ? R.i(0, 3) : 0;
    let G = grid(k % 2 ? h : w, k % 2 ? w : h);
    const out = { w, h, doors: {}, lights: [], chests: [], rooms: [], start: { x: 1, y: Math.floor(G.h / 2) }, ground: '', amb: 'bright', fog: 'off' };
    // floor — этаж здания (со второго — тот же контур при том же зерне; см. upper)
    const floor = Math.max(1, +o.floor || 1);
    T.fn(G, R, { density: o.density != null ? o.density : 0.3, road: o.road != null ? o.road : !!T.road, chests: o.chests != null ? o.chests : !!T.chests, variant: o.variant || '', floor }, out);
    if (out.floors) { out.seed = o.seed || 1; out.floor = floor; out.v = out.v || o.variant || ''; }
    if (out.props) { Object.keys(out.props).forEach((k) => { const [x, y] = k.split('_').map(Number), c = G.get(x, y); if (c !== 'furn' && c !== '' && c !== 'floor') delete out.props[k]; }); }
    for (let i = 0; i < k; i++) G = rot90(G, out);
    // Дверь всегда проходима: дерево, камень или мебель на её клетке убираются
    Object.keys(out.doors).forEach((k) => { const [x, y] = k.split('_').map(Number), c = G.get(x, y); if (c !== 'wall' && SOLID.has(c)) G.set(x, y, ''); });
    if ((T.kind === 'terrain' || T.connect) && floor < 2) { if (SOLID.has(G.get(out.start.x, out.start.y))) G.set(out.start.x, out.start.y, ''); connectOutdoor(G, out); }
    // Поселения: недоступные закутки на улице (между домами у края карты) засаживаем деревьями — туда никого не поставят
    if ((T.connect || T.kind === 'terrain') && floor < 2) {
      const seen = new Set([`${out.start.x}_${out.start.y}`]), q = [[out.start.x, out.start.y]], pass = (x, y) => G.inb(x, y) && !SOLID.has(G.g[y][x]);
      while (q.length) { const [x, y] = q.pop(); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const k = `${x + dx}_${y + dy}`; if (!seen.has(k) && pass(x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); } } }
      const fill = ['stone', 'sand', 'snow'].includes(out.ground) ? 'rock' : 'tree';
      for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) if (!seen.has(`${x}_${y}`) && ['', 'bush', 'difficult', 'sand', 'road', 'thicket', 'bog', 'rubble', 'slope', 'snow', 'ice'].includes(G.g[y][x])) G.g[y][x] = fill;
    }
    // Двери и сундуки — только на проходимых клетках
    out.cells = {};
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (G.g[y][x]) out.cells[`${x}_${y}`] = G.g[y][x];
    Object.keys(out.doors).forEach((k) => { if (out.cells[k] === 'wall') delete out.doors[k]; });
    // Мост, под которым и рядом с которым нет ни воды, ни пропасти, — просто дорога
    { const hz = (k) => ['water', 'bog', 'lava', 'chasm'].includes(out.cells[k]), seen = new Set();
      Object.keys(out.cells).forEach((k0) => {
        if (out.cells[k0] !== 'bridge' || seen.has(k0)) return;
        const comp = [], q = [k0]; let wet = false; seen.add(k0);
        while (q.length) { const k = q.pop(), [x, y] = k.split('_').map(Number); comp.push(k); [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { const n = `${x + dx}_${y + dy}`; if (hz(n) || x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) wet = true; else if (out.cells[n] === 'bridge' && !seen.has(n)) { seen.add(n); q.push(n); } }); }
        if (!wet) comp.forEach((k) => { out.cells[k] = 'road'; });
      }); }
    // Две двери подряд в одном проходе — вторая лишняя (двустворчатые ворота поперёк прохода остаются)
    Object.keys(out.doors).forEach((k) => {
      if (!out.doors[k]) return;
      const [x, y] = k.split('_').map(Number), wall = (a, b) => out.cells[`${a}_${b}`] === 'wall';
      [[1, 0], [0, 1]].forEach(([dx, dy]) => { const n = `${x + dx}_${y + dy}`; if (out.doors[n] && wall(x + dy, y + dx) && wall(x - dy, y - dx)) { if (out.doors[n].l) out.doors[k].l = 1; delete out.doors[n]; } });
    });
    out.chests = out.chests.filter((c, i, a) => !['wall', 'rock', 'tree', 'water', 'furn', 'lava', 'chasm', 'grave', 'mushroom', 'crate', 'stairs', 'board', 'well', 'roof'].includes(out.cells[`${c.x}_${c.y}`]) && a.findIndex((d) => d.x === c.x && d.y === c.y) === i && !out.doors[`${c.x}_${c.y}`]);
    return out;
  }
  return { TEMPLATES, generate };
})();
