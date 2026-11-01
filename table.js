// Игровой стол: комната по коду, поле в клетку, токены, местность, инициатива.
// Данные — Firebase Realtime Database: codes/{КОД} = gameId; games/{gameId}/{meta, members, tokens, map, init}.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = window.dndApp;
const esc = app.esc;
const CELL = 40; // пикселей на клетку (5 фт) при масштабе 100%
const GAME_KEY = 'dnd55-game';
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TERRAIN = {
  wall: { n: 'Стена', color: '#4a4038', block: true },
  difficult: { n: 'Труднопроходимая', color: 'rgba(140,100,40,.45)', cost: 2 },
  water: { n: 'Вода', color: 'rgba(60,110,170,.55)', cost: 2 },
};
const SIZE_N = { 'Крошечный': 1, 'Маленький': 1, 'Средний': 1, 'Большой': 2, 'Огромный': 3, 'Громадный': 4 };
const PALETTE = ['#d4a64a', '#5b8fc9', '#5a9e5a', '#9b6fd1', '#c97a3d', '#3db0a8', '#c95b8f'];

let FB = null, R = null, db = null, user = null;
let game = null; // { id, code, meta, members, tokens, map, init }
let unsubs = [];
let tool = 'move', zoom = 1, selId = null;
let drag = null; // перетаскивание токена / панорама / рисование
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } } };
const ref = (p) => R.ref(db, p);
const gpath = (p = '') => `games/${game.id}${p ? '/' + p : ''}`;
const isDM = () => !!(game && user && game.meta && game.meta.dm === user.uid);
const me = () => (game && user ? (game.members || {})[user.uid] : null);
const canMove = (t) => isDM() || (user && t.owner === user.uid);
const die = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return 1 + (a[0] % n); };
const colorOf = (s) => PALETTE[[...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const condName = (k) => ((typeof CONDITIONS !== 'undefined' && CONDITIONS.find((c) => c.k === k)) || { n: k }).n;
const INCAP = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
const speedOf = (t) => (t.speed != null && t.speed !== '' ? +t.speed || 0 : 30);

/* ---------- Запуск ---------- */
function boot() {
  if (FB || !window.dndFirebase) return;
  FB = window.dndFirebase; R = FB.R; db = FB.rtdb;
  FB.onUser((u) => {
    const was = user && user.uid;
    user = u;
    if (!u) leaveLocal();
    else if (was !== u.uid) { if (game) { unsubs.forEach((f) => f()); unsubs = []; game = null; selId = null; } tryRejoin(); }
    renderAll();
  });
}
document.addEventListener('dnd-firebase', boot);
boot();
// Ссылка-приглашение ?game=КОД — сразу открыть стол с кодом
const urlCode = new URLSearchParams(location.search).get('game');
if (urlCode) setTimeout(() => { $('[data-tab="table"]')?.click(); }, 300);
document.addEventListener('dnd-tab', (e) => { if (e.detail === 'table') renderAll(); });
document.addEventListener('dnd-render', () => { if (game) pushMyChar(); });

/* ---------- Комната ---------- */
async function createGame(name) {
  const gid = R.push(ref('games')).key;
  let code = '';
  for (let i = 0; i < 6 && !code; i++) {
    const c = Array.from({ length: 6 }, () => CODE_ABC[die(CODE_ABC.length) - 1]).join('');
    try { await R.set(ref(`codes/${c}`), gid); code = c; } catch (e) { /* код занят — следующий */ }
  }
  if (!code) throw new Error('не удалось выдать код');
  await R.set(ref(`games/${gid}/meta`), { dm: user.uid, name: name || 'Новая игра', code, w: 30, h: 20, created: R.serverTimestamp() });
  await R.set(ref(`games/${gid}/members/${user.uid}`), { name: user.displayName || user.email, role: 'dm', online: true });
  subscribe(gid, code);
  app.toast(`🗺 Игра создана. Код: <b>${code}</b> — отправьте его игрокам`, 'crit');
}
async function joinGame(code, charId) {
  code = String(code || '').trim().toUpperCase();
  const snap = await R.get(ref(`codes/${code}`));
  if (!snap.exists()) { app.toast('Игра с таким кодом не найдена', 'fumble'); return; }
  const gid = snap.val();
  try {
    await R.set(ref(`games/${gid}/members/${user.uid}`), { name: user.displayName || user.email, role: 'player', charId, char: app.summary(charId), online: true });
  } catch (e) { app.toast('Не удалось подключиться — игра уже завершена или код устарел', 'fumble'); return; }
  subscribe(gid, code);
  app.toast('🗺 Вы подключились к игре. Поставьте своего персонажа на поле');
}
function subscribe(gid, code) {
  unsubs.forEach((u) => u());
  unsubs = [];
  game = { id: gid, code, meta: null, members: {}, tokens: {}, map: {}, init: null, econ: {} };
  ls.set(GAME_KEY, JSON.stringify({ id: gid, code, uid: user.uid }));
  const lost = (e) => { if (String(e && e.code).includes('PERMISSION')) { app.toast('Нет доступа к игре — возможно, вас исключили'); leaveLocal(); renderAll(); } };
  const on = (p, fn) => unsubs.push(R.onValue(ref(gpath(p)), (s) => { if (game && game.id === gid) { fn(s.val()); renderAll(); } }, lost));
  on('meta', (v) => { if (!v) { app.toast('Игра завершена мастером'); leaveLocal(); } else game.meta = v; });
  on('members', (v) => { game.members = v || {}; });
  on('tokens', (v) => { game.tokens = v || {}; });
  on('map', (v) => { game.map = v || {}; drawTerrain(); });
  on('init', (v) => { game.init = v; checkMyTurn(); });
  on('econ', (v) => { game.econ = v || {}; });
  // Присутствие: онлайн, пока открыта вкладка
  unsubs.push(R.onValue(ref('.info/connected'), (s) => {
    if (!s.val() || !game) return;
    const p = ref(gpath(`members/${user.uid}/online`));
    R.onDisconnect(p).set(false);
    R.set(p, true).catch(() => {});
  }));
}
function tryRejoin() {
  let saved = null;
  try { saved = JSON.parse(ls.get(GAME_KEY)); } catch (e) { saved = null; }
  if (saved && saved.id && saved.uid === user.uid && (!game || game.id !== saved.id)) subscribe(saved.id, saved.code);
}
function leaveLocal() {
  unsubs.forEach((u) => u());
  unsubs = [];
  game = null; selId = null;
  ls.set(GAME_KEY, '');
}
async function leaveGame() {
  if (isDM()) {
    if (!app.confirm('Завершить игру для всех? Поле, токены и инициатива будут удалены.')) return;
    const { id, code } = game;
    leaveLocal();
    // Сначала код (правило проверяет, что вы мастер этой игры), затем сама игра
    await R.remove(ref(`codes/${code}`)).catch(() => {});
    await R.remove(ref(`games/${id}`));
  } else {
    if (!app.confirm('Покинуть игру? Ваш токен уберётся с поля.')) return;
    const id = game.id;
    await R.remove(ref(`games/${id}/tokens/pc_${user.uid}`)).catch(() => {});
    await R.remove(ref(`games/${id}/init/list/${user.uid}`)).catch(() => {});
    await R.remove(ref(`games/${id}/members/${user.uid}`)).catch(() => {});
    leaveLocal();
  }
  renderAll();
}

/* ---------- Персонаж игрока → поле ---------- */
let lastSent = '', pushTimer = null;
function pushMyChar() {
  const m = me();
  if (!m || !m.charId) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const s = app.summary(m.charId);
    if (!s || !game) return;
    const key = JSON.stringify(s);
    if (key === lastSent) return;
    lastSent = key;
    const upd = { [`members/${user.uid}/char`]: s };
    if (game.tokens[`pc_${user.uid}`]) {
      Object.assign(upd, { [`tokens/pc_${user.uid}/name`]: s.name, [`tokens/pc_${user.uid}/hp`]: s.hp, [`tokens/pc_${user.uid}/hpMax`]: s.hpMax,
        [`tokens/pc_${user.uid}/temp`]: s.temp, [`tokens/pc_${user.uid}/ac`]: s.ac, [`tokens/pc_${user.uid}/cond`]: s.cond, [`tokens/pc_${user.uid}/speed`]: s.speed,
        [`tokens/pc_${user.uid}/size`]: SIZE_N[s.size] || 1, [`tokens/pc_${user.uid}/init`]: s.init });
    }
    R.update(ref(gpath()), upd).catch(() => {});
  }, 300);
}
function placeMyToken(x, y) {
  const m = me(), s = m && app.summary(m.charId);
  if (!s) { app.toast('Персонаж не найден на этом устройстве'); return; }
  R.set(ref(gpath(`tokens/pc_${user.uid}`)), { kind: 'pc', owner: user.uid, name: s.name, x, y, size: SIZE_N[s.size] || 1, color: colorOf(user.uid),
    hp: s.hp, hpMax: s.hpMax, temp: s.temp, ac: s.ac, cond: s.cond, speed: s.speed, init: s.init });
  lastSent = '';
}

/* ---------- Поле ---------- */
const W = () => (game && game.meta ? game.meta.w : 30);
const H = () => (game && game.meta ? game.meta.h : 20);
function layoutBoard() {
  const w = W() * CELL, h = H() * CELL;
  const b = $('#tblBoard');
  b.style.width = w + 'px'; b.style.height = h + 'px';
  b.style.transform = `scale(${zoom})`;
  $('#tblSizer').style.width = w * zoom + 'px';
  $('#tblSizer').style.height = h * zoom + 'px';
  ['#tblTerrain', '#tblRange'].forEach((s) => { const cv = $(s); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } });
  $('#tblZoom').textContent = Math.round(zoom * 100) + '%';
}
function drawTerrain() {
  if (!game) return;
  const cv = $('#tblTerrain'), g = cv.getContext('2d');
  layoutBoard();
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#1f1b16';
  g.fillRect(0, 0, cv.width, cv.height);
  Object.entries(game.map || {}).forEach(([k, type]) => {
    const [x, y] = k.split('_').map(Number), T = TERRAIN[type];
    if (!T) return;
    g.fillStyle = T.color;
    g.fillRect(x * CELL, y * CELL, CELL, CELL);
    if (type === 'difficult') { // штриховка
      g.strokeStyle = 'rgba(200,150,70,.5)';
      g.beginPath();
      for (let i = -CELL; i < CELL; i += 10) { g.moveTo(x * CELL + i, y * CELL + CELL); g.lineTo(x * CELL + i + CELL, y * CELL); }
      g.stroke();
    }
  });
  g.strokeStyle = 'rgba(255,255,255,.07)';
  g.beginPath();
  for (let x = 0; x <= W(); x++) { g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, cv.height); }
  for (let y = 0; y <= H(); y++) { g.moveTo(0, y * CELL + 0.5); g.lineTo(cv.width, y * CELL + 0.5); }
  g.stroke();
}
// Клетки, занятые другими существами: сквозь союзника, недееспособного или существо на 2+ размера больше/меньше пройти можно
// (это труднопроходимая местность), сквозь врага — нельзя. Закончить перемещение в занятой клетке нельзя.
function occupancy(moverId) {
  const mv = game.tokens[moverId], occ = new Map();
  Object.entries(game.tokens || {}).forEach(([id, t]) => {
    if (id === moverId || (t.hidden && !isDM())) return;
    const s = t.size || 1, incap = (t.hpMax && (t.hp || 0) <= 0) || (t.cond || []).some((k) => INCAP.includes(k));
    const pass = t.kind === mv.kind || incap || Math.abs(s - (mv.size || 1)) >= 2;
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) occ.set(`${t.x + dx}_${t.y + dy}`, pass ? 'pass' : 'block');
  });
  return occ;
}
// Стоимость пути до клеток (футы): 5 за клетку (по диагонали тоже, правила 2024), +5 в труднопроходимой, +5 ползком; стены непроходимы
function reachMap(sx, sy, limit, occ, crawl) {
  const dist = new Map(), q = [[sx, sy, 0]];
  dist.set(`${sx}_${sy}`, 0);
  while (q.length) {
    q.sort((a, b) => a[2] - b[2]);
    const [x, y, d] = q.shift();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy, k = `${nx}_${ny}`;
      if (nx < 0 || ny < 0 || nx >= W() || ny >= H()) continue;
      const T = TERRAIN[(game.map || {})[k]], o = occ && occ.get(k);
      if ((T && T.block) || o === 'block') continue;
      const nd = d + 5 + ((T && T.cost) || o === 'pass' ? 5 : 0) + (crawl ? 5 : 0);
      if (nd > limit || (dist.has(k) && dist.get(k) <= nd)) continue;
      dist.set(k, nd);
      q.push([nx, ny, nd]);
    }
  }
  return dist;
}
function drawRange(dist, speed, occ) {
  const cv = $('#tblRange'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  if (!dist) return;
  dist.forEach((d, k) => {
    if (occ && occ.has(k)) return; // остановиться там нельзя
    const [x, y] = k.split('_').map(Number);
    g.fillStyle = d <= speed ? 'rgba(90,158,90,.28)' : 'rgba(212,166,74,.16)';
    g.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
  });
}
function renderTokens() {
  const box = $('#tblTokens'), cur = currentEntry();
  const seen = new Set();
  Object.entries(game.tokens || {}).forEach(([id, t]) => {
    if (t.hidden && !isDM()) return;
    seen.add(id);
    let el = box.querySelector(`[data-tok="${id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'tok'; el.dataset.tok = id; box.appendChild(el); }
    const s = t.size || 1, pct = Math.max(0, Math.min(1, (t.hp || 0) / (t.hpMax || 1)));
    const showNums = t.kind === 'pc' || isDM();
    if (!(drag && drag.kind === 'token' && drag.id === id)) { el.style.left = t.x * CELL + 'px'; el.style.top = t.y * CELL + 'px'; }
    el.style.width = el.style.height = s * CELL + 'px';
    el.style.setProperty('--tc', t.color || (t.kind === 'npc' ? '#c94a3d' : '#d4a64a'));
    el.className = `tok ${t.kind} ${canMove(t) ? 'mine' : ''} ${selId === id ? 'sel' : ''} ${cur && cur.tokenId === id ? 'turn' : ''} ${t.hidden ? 'hid' : ''} ${(t.hp || 0) <= 0 && t.hpMax ? 'down' : ''}`;
    const ec = inFight() ? econ(id) : {};
    el.title = `${t.name}${showNums ? ` · ${t.hp}/${t.hpMax} хитов${t.ac ? ` · КД ${t.ac}` : ''}` : ''}${(t.cond || []).length ? ` · ${t.cond.map(condName).join(', ')}` : ''}${ec.dodge ? ' · уклоняется' : ''}${ec.dis ? ' · отходит' : ''}`;
    const html = `<div class="tok-face">${esc((t.name || '?').trim().slice(0, 2))}</div>
      ${t.hpMax ? `<div class="tok-hp"><div style="width:${pct * 100}%;background:${pct > .5 ? '#5a9e5a' : pct > .25 ? '#d4a64a' : '#c94a3d'}"></div></div>` : ''}
      <div class="tok-name">${esc(t.name || '')}${(t.cond || []).length ? ` <span class="tok-cond">●${t.cond.length}</span>` : ''}</div>`;
    // Пересоздавать содержимое только при изменении — иначе касание пальцем «теряет» токен посреди перетаскивания
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  });
  $$('[data-tok]', box).forEach((el) => { if (!seen.has(el.dataset.tok)) el.remove(); });
}

/* ---------- Мышь и касания на поле ---------- */
function cellAt(e) {
  const r = $('#tblBoard').getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left) / zoom / CELL), y: Math.floor((e.clientY - r.top) / zoom / CELL), px: (e.clientX - r.left) / zoom, py: (e.clientY - r.top) / zoom };
}
function hint(text, e) {
  const h = $('#tblHint');
  if (!text) { h.hidden = true; return; }
  const p = cellAt(e);
  h.hidden = false; h.textContent = text;
  h.style.left = p.px + 14 + 'px'; h.style.top = p.py - 28 + 'px';
}
function onDown(e) {
  if (!game || e.button > 0) return;
  const tokEl = e.target.closest('[data-tok]'), p = cellAt(e);
  // «Переставить меня»: нажатие на клетку ставит персонажа; нажатие на свой токен — сразу обычное перетаскивание
  if (tool === 'place') {
    tool = 'move'; renderTools(); $('#tblBoard').dataset.tool = tool;
    const own = tokEl && game.tokens[tokEl.dataset.tok] && canMove(game.tokens[tokEl.dataset.tok]);
    if (!own) {
      if (inFight() && game.tokens[`pc_${user.uid}`]) { app.toast('В бою персонаж не переставляется — перетаскивайте его в свой ход'); return; }
      placeMyToken(p.x, p.y);
      return;
    }
  }
  if (tool === 'enemy') { newEnemyDialog(p.x, p.y); return; }
  if (TERRAIN[tool] || tool === 'erase') {
    drag = { kind: 'paint', pending: {} };
    paintAt(p);
  } else if (tokEl) {
    const id = tokEl.dataset.tok, t = game.tokens[id];
    selId = id; renderSide(); renderTokens();
    if (!t || !canMove(t)) return;
    const speed = speedOf(t), dm = isDM();
    const dg = { kind: 'token', id, sx: t.x, sy: t.y, offX: p.px - t.x * CELL, offY: p.py - t.y * CELL, speed, moved: false };
    if (inFight()) {
      // В бою: игрок ходит только в свой ход и не дальше оставшейся скорости; мастер — без ограничений
      const turn = isTurnOf(id);
      if (!dm && !turn) { app.toast('Сейчас не ваш ход — дождитесь своей очереди в инициативе'); return; }
      const mv = moveInfo(id), occ = occupancy(id);
      if (!dm && !mv.left) { app.toast(mv.speed ? `Скорость на этот ход потрачена${mv.canDash ? ' — можно сделать Рывок' : ''}` : 'Скорость 0 — персонаж не может перемещаться'); return; }
      Object.assign(dg, { fight: true, counted: turn, occ, left: turn ? mv.left : Infinity,
        dist: reachMap(t.x, t.y, dm ? 9999 : mv.left + (mv.canDash ? mv.speed : 0), occ, mv.prone) });
      drawRange(dg.dist, turn ? mv.left : speed * 2, occ);
    } else {
      dg.dist = reachMap(t.x, t.y, speed * 2);
      drawRange(dg.dist, speed);
    }
    drag = dg;
    tokEl.classList.add('dragging');
  } else {
    const w = $('#tblWrap');
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, sl: w.scrollLeft, st: w.scrollTop };
    if (selId) { selId = null; renderSide(); renderTokens(); }
  }
  try { $('#tblBoard').setPointerCapture(e.pointerId); } catch (err) { /* указатель уже отпущен */ }
  e.preventDefault();
}
function onMove(e) {
  if (!drag) return;
  const p = cellAt(e);
  if (drag.kind === 'pan') {
    const w = $('#tblWrap');
    w.scrollLeft = drag.sl - (e.clientX - drag.x); w.scrollTop = drag.st - (e.clientY - drag.y);
  } else if (drag.kind === 'paint') paintAt(p);
  else if (drag.kind === 'token') {
    drag.moved = true;
    const el = $(`[data-tok="${drag.id}"]`);
    if (el) { el.style.left = p.px - drag.offX + 'px'; el.style.top = p.py - drag.offY + 'px'; }
    const tx = Math.round((p.px - drag.offX) / CELL), ty = Math.round((p.py - drag.offY) / CELL);
    const d = drag.dist.get(`${tx}_${ty}`);
    let txt;
    if (tx === drag.sx && ty === drag.sy) txt = '';
    else if (!drag.fight) txt = d == null ? 'дальше двойной скорости' : `${d} фт${d > drag.speed ? ' — с Рывком' : ''}`;
    else if (drag.occ.has(`${tx}_${ty}`)) txt = 'клетка занята';
    else if (d == null) txt = isDM() ? 'путь закрыт' : 'не хватает скорости';
    else if (!drag.counted) txt = `${d} фт`;
    else txt = d <= drag.left ? `${d} фт · останется ${drag.left - d}` : `${d} фт — не хватает ${d - drag.left} фт${isDM() ? '' : ', нужен Рывок'}`;
    hint(txt, e);
  }
}
function onUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  hint('');
  if (d.kind === 'paint') {
    if (Object.keys(d.pending).length) R.update(ref(gpath('map')), d.pending).catch((err) => app.toast(`Не удалось сохранить карту: ${esc(err.code || err.message)}`));
  } else if (d.kind === 'token') {
    drawRange(null);
    const p = cellAt(e), t = game.tokens[d.id];
    $(`[data-tok="${d.id}"]`)?.classList.remove('dragging');
    if (!t || !d.moved) { renderTokens(); return; }
    const s = t.size || 1;
    const x = Math.max(0, Math.min(W() - s, Math.round((p.px - d.offX) / CELL))), y = Math.max(0, Math.min(H() - s, Math.round((p.py - d.offY) / CELL)));
    const T = TERRAIN[(game.map || {})[`${x}_${y}`]];
    if (T && T.block) { app.toast('Там стена'); renderTokens(); return; }
    if (x === d.sx && y === d.sy) { renderTokens(); return; }
    const upd = { [`tokens/${d.id}/x`]: x, [`tokens/${d.id}/y`]: y };
    if (d.fight) {
      const cost = d.dist.get(`${x}_${y}`);
      let busy = false;
      for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) if (d.occ.has(`${x + dx}_${y + dy}`)) busy = true;
      if (busy) { app.toast('Клетка занята другим существом'); renderTokens(); return; }
      if (!isDM() && (cost == null || cost > d.left)) {
        app.toast(cost == null ? 'Туда не дойти' : `Не хватает скорости: нужно ${cost} фт, осталось ${d.left} фт`);
        renderTokens();
        return;
      }
      if (d.counted) upd[`econ/${d.id}/move`] = (econ(d.id).move || 0) + (cost != null ? cost : 5 * Math.max(Math.abs(x - d.sx), Math.abs(y - d.sy)));
    }
    t.x = x; t.y = y;
    renderTokens();
    R.update(ref(gpath()), upd).catch((err) => { app.toast(`Не удалось переместить: ${esc(err.code || err.message)}`); });
  }
}
function paintAt(p) {
  if (p.x < 0 || p.y < 0 || p.x >= W() || p.y >= H()) return;
  const k = `${p.x}_${p.y}`, v = tool === 'erase' ? null : tool;
  if ((game.map || {})[k] === (v || undefined)) return;
  game.map = { ...(game.map || {}) };
  if (v) game.map[k] = v; else delete game.map[k];
  drag.pending[k] = v;
  drawTerrain();
}

/* ---------- Враги ---------- */
function newEnemyDialog(x, y, base) {
  const b = base || { name: 'Гоблин', hpMax: 7, ac: 15, size: 1, speed: 30, init: 2 };
  app.openModal(`<h2>${base ? 'Копия существа' : '＋ Существо'}</h2>
    <div class="form-grid"><label style="grid-column:1/-1">Название<input id="nN" value="${esc(b.name)}"></label>
    <label>Хиты<input id="nH" type="number" value="${b.hpMax}"></label><label>КД<input id="nA" type="number" value="${b.ac}"></label>
    <label>Скорость, фт<input id="nS" type="number" step="5" value="${b.speed}"></label><label>Бонус инициативы<input id="nI" type="number" value="${b.init}"></label>
    <label>Размер<select id="nZ">${[[1, 'Средний/маленький'], [2, 'Большой'], [3, 'Огромный'], [4, 'Громадный']].map(([v, n]) => `<option value="${v}" ${b.size === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Количество<input id="nC" type="number" min="1" max="12" value="1"></label>
    <label class="check"><input type="checkbox" id="nHid"> Скрыт от игроков</label></div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="nOk">Поставить</button></div>`);
  $('#nOk').onclick = () => {
    const n = Math.max(1, Math.min(12, +$('#nC').value || 1)), size = +$('#nZ').value || 1, upd = {};
    for (let i = 0; i < n; i++) {
      const id = R.push(ref(gpath('tokens'))).key, name = $('#nN').value.trim() || 'Существо';
      upd[id] = { kind: 'npc', owner: user.uid, name: n > 1 ? `${name} ${i + 1}` : name, x: Math.min(W() - size, x + i * size), y, size, color: '#c94a3d',
        hp: +$('#nH').value || 1, hpMax: +$('#nH').value || 1, ac: +$('#nA').value || 10, speed: +$('#nS').value || 30, init: +$('#nI').value || 0, hidden: $('#nHid').checked, cond: [] };
    }
    R.update(ref(gpath('tokens')), upd);
    app.closeModal();
    tool = 'move'; renderTools();
  };
}

/* ---------- Инициатива ---------- */
const initList = () => Object.entries((game.init && game.init.list) || {}).map(([id, e]) => ({ id, ...e }))
  .sort((a, b) => b.roll - a.roll || String(a.name).localeCompare(String(b.name), 'ru'));
function currentEntry() {
  if (!game || !game.init || !game.init.active) return null;
  const l = initList();
  return l.length ? l[(game.init.turn || 0) % l.length] : null;
}
// Новый ход существа: его перемещение, действия и реакция восстанавливаются
function nextTurn() {
  const l = initList();
  if (!l.length) return;
  let turn = (game.init.turn || 0) + 1, round = game.init.round || 1;
  if (turn >= l.length) { turn = 0; round += 1; }
  R.update(ref(gpath()), { 'init/turn': turn, 'init/round': round, [`econ/${l[turn].tokenId || l[turn].id}`]: null });
}

/* ---------- Действия и перемещение в бою ---------- */
// games/{id}/econ/{tokenId}: move — потрачено футов; dash — сколько раз Рывок; a, b, r — потрачены действие, бонусное действие, реакция;
// dis, dodge — совершены Отход, Уклонение. Запись сбрасывается в начале хода этого существа.
const inFight = () => !!(game && game.init && game.init.active);
const econ = (id) => (game.econ || {})[id] || {};
const isTurnOf = (id) => { const c = currentEntry(); return !!(c && c.tokenId === id); };
// Сводка листа владельца токена — нужна, чтобы знать бонусные действия класса
function charOf(t) {
  if (t.kind !== 'pc') return null;
  const m = me();
  if (user && t.owner === user.uid && m && m.charId) return app.summary(m.charId);
  return (game.members[t.owner] || {}).char || null;
}
function moveInfo(id) {
  const t = game.tokens[id], e = econ(id), speed = speedOf(t), cond = t.cond || [];
  const incap = cond.some((k) => INCAP.includes(k)), bonus = (charOf(t) || {}).bonus || [];
  const total = speed * (1 + (e.dash || 0));
  return { speed, total, used: e.move || 0, left: Math.max(0, total - (e.move || 0)), prone: cond.includes('prone'), incap, bonus,
    canDash: !incap && speed > 0 && (!e.a || (bonus.includes('dash') && !e.b)) };
}
async function econAct(a, id, k) {
  const t = game.tokens[id], e = econ(id);
  if (!t || !canMove(t)) return;
  let upd;
  if (a === 'eco') upd = { [k]: e[k] ? null : 1 };
  else if (a === 'dash' || a === 'dashB') upd = { [a === 'dash' ? 'a' : 'b']: 1, dash: (e.dash || 0) + 1 };
  else if (a === 'dis' || a === 'disB') upd = { [a === 'dis' ? 'a' : 'b']: 1, dis: 1 };
  else if (a === 'dodge') upd = { a: 1, dodge: 1 };
  else if (a === 'stand') {
    // Встать: половина скорости, состояние снимается в листе и уходит на поле
    upd = { move: (e.move || 0) + Math.ceil(speedOf(t) / 2) };
    const m = me();
    if (m && m.charId) app.setCond(m.charId, 'prone', false);
  }
  await R.update(ref(gpath(`econ/${id}`)), upd);
}
// Начало моего хода: уведомление и отсчёт эффектов в листе (раз за ход)
function checkMyTurn() {
  const cur = currentEntry(), m = me();
  if (!cur || !m || cur.owner !== user.uid || cur.kind !== 'pc') return;
  const key = `${game.id}:${game.init.round}:${game.init.turn}`;
  if (ls.get('dnd55-turn') === key) return;
  ls.set('dnd55-turn', key);
  app.toast('⚔ Ваш ход!', 'crit');
  // С начала 2-го раунда каждый ваш ход сдвигает эффекты в листе на раунд
  if (game.init.round > 1) app.tickRound(m.charId);
}

/* ---------- Отрисовка ---------- */
function renderAll() {
  const lobby = $('#tblLobby'), box = $('#tblGame');
  if (!lobby) return;
  const inGame = !!(game && game.meta && user);
  box.hidden = !inGame;
  lobby.hidden = inGame;
  if (!inGame) { renderLobby(); return; }
  $('#tblName').textContent = game.meta.name;
  $('#tblCode').textContent = `Код: ${game.code}`;
  $('#tblLeave').textContent = isDM() ? 'Завершить игру' : 'Покинуть';
  renderTools();
  layoutBoard();
  if (!$('#tblTerrain').dataset.drawn || $('#tblTerrain').dataset.drawn !== game.id) { $('#tblTerrain').dataset.drawn = game.id; drawTerrain(); }
  renderTokens();
  renderTurn();
  renderInit();
  renderSide();
  renderMembers();
}
function renderLobby() {
  const lobby = $('#tblLobby');
  if (!FB) { lobby.innerHTML = '<div class="card"><h2>🗺 Игровой стол</h2><p class="muted">Стол работает на опубликованном сайте с входом через Google (кнопка ☁ в шапке).</p></div>'; return; }
  if (!db) { lobby.innerHTML = '<div class="card"><h2>🗺 Игровой стол</h2><p class="muted">Не настроена база данных стола (databaseURL в firebase-config.js).</p></div>'; return; }
  if (!user) {
    lobby.innerHTML = '<div class="card"><h2>🗺 Игровой стол</h2><p>Чтобы играть с друзьями, войдите через Google.</p><button class="primary" data-tbl="signin">☁ Войти</button></div>';
    return;
  }
  const chars = Object.values(app.chars());
  const code = (urlCode || '').toUpperCase();
  lobby.innerHTML = `<div class="grid g-combat">
    <div class="card"><h2>🎲 Подключиться к игре</h2>
      <label>Код от мастера<input id="tblJoinCode" maxlength="6" value="${esc(code)}" placeholder="Например, K7F2QX" style="text-transform:uppercase"></label>
      <label>Ваш персонаж<select id="tblJoinChar">${chars.map((c) => `<option value="${c.id}">${esc(c.info.name || 'Без имени')}${c.info.cls ? ` — ${esc(c.info.cls)}` : ''}</option>`).join('')}</select></label>
      <button class="primary" data-tbl="join">Подключиться</button>
      <p class="muted small">Хиты, КД и состояния персонажа будут видны на поле и обновляться из листа.</p></div>
    <div class="card"><h2>👑 Создать игру (мастер)</h2>
      <label>Название<input id="tblNewName" placeholder="Например, Затерянные шахты"></label>
      <button class="primary" data-tbl="create">Создать игру</button>
      <p class="muted small">Вы получите код приглашения. Мастер расставляет врагов, рисует карту и ведёт инициативу.</p></div></div>`;
}
function renderTools() {
  const t = (k, label, title) => `<button class="${tool === k ? 'on' : ''}" data-tool="${k}" title="${title || ''}">${label}</button>`;
  const hasMine = user && game.tokens[`pc_${user.uid}`];
  $('#tblBoard').dataset.tool = tool; // курсор поля соответствует инструменту
  $('#tblTools').innerHTML = `<div class="seg">${t('move', '✋ Двигать', 'Перетаскивайте токены, по пустому месту — прокрутка')}
    ${isDM() ? t('wall', '▮ Стена') + t('difficult', '▦ Трудная') + t('water', '≈ Вода') + t('erase', '⌫ Ластик') + t('enemy', '＋ Враг', 'Нажмите на клетку, чтобы поставить существо') : ''}
    ${!isDM() && !(hasMine && inFight()) ? t('place', hasMine ? '📍 Переставить меня' : '📍 Поставить персонажа', 'Нажмите на клетку') : ''}</div>`;
}
// Карточка хода: игроку — свой персонаж, мастеру — существо, чей сейчас ход
function renderTurn() {
  const box = $('#tblTurn'), dm = isDM();
  let id = null;
  if (inFight()) {
    const c = currentEntry();
    if (dm) id = c && game.tokens[c.tokenId] ? c.tokenId : null;
    else if (user && game.tokens[`pc_${user.uid}`]) id = `pc_${user.uid}`;
  }
  if (!id) { box.hidden = true; return; }
  box.hidden = false;
  const t = game.tokens[id], e = econ(id), mv = moveInfo(id), turn = isTurnOf(id), canAct = (turn || dm) && !mv.incap;
  const pip = (k, n, hintOk) => `<button class="pip ${e[k] ? 'used' : ''}" data-tbl="eco" data-id="${id}" data-k="${k}"
    ${!dm && (k === 'r' ? mv.incap : !canAct || !turn) ? 'disabled' : ''} title="${e[k] ? 'Потрачено — нажмите, чтобы вернуть' : hintOk}">${e[k] ? '✕' : '●'} ${n}</button>`;
  const btn = (a, label, title, ok) => (ok ? `<button data-tbl="${a}" data-id="${id}" title="${title}">${label}</button>` : '');
  const half = Math.ceil(mv.speed / 2);
  box.innerHTML = `<div class="row between"><h3>${dm ? `Ход: ${esc(t.name)}` : turn ? 'Ваш ход' : 'Ваши ресурсы хода'}</h3>${turn && !dm ? '<span class="badge">сейчас</span>' : ''}</div>
    ${turn || dm ? `<div class="small">Перемещение: <b>${mv.left}</b> из ${mv.total} фт${e.dash ? ` · Рывок ×${e.dash}` : ''}${mv.prone ? ' · ползком (×2)' : ''}</div>
    <div class="mvbar"><div style="width:${mv.total ? Math.min(100, (mv.left / mv.total) * 100) : 0}%"></div></div>`
    : `<div class="small muted" style="margin-bottom:8px">Скорость ${mv.speed} фт — перемещение и действия в ваш ход, реакция доступна всегда</div>`}
    <div class="pips">${pip('a', 'Действие', 'Атака, заклинание, Рывок и т. п. — нажмите, когда потратите')}${pip('b', 'Бонусное', 'Нажмите, когда потратите бонусное действие')}${pip('r', 'Реакция', 'Атака по возможности, «Щит» и т. п.; восстанавливается в начале вашего хода')}</div>
    ${mv.incap ? '<p class="small warn-text">Недееспособен — не может совершать действия, бонусные действия и реакции.</p>' : ''}
    ${canAct && turn ? `<div class="row gap wrap mt">
      ${btn('dash', '🏃 Рывок', 'Действие: ещё одна скорость перемещения на этот ход', !e.a && mv.speed > 0)}
      ${btn('dis', '↩ Отход', 'Действие: до конца хода ваше перемещение не провоцирует атаки по возможности', !e.a && !e.dis)}
      ${btn('dodge', '🛡 Уклонение', 'Действие: до начала вашего следующего хода атаки по вам с помехой, спасброски Ловкости с преимуществом', !e.a && !e.dodge)}
      ${btn('dashB', '🏃 Рывок бонусным', 'Хитрое действие / Шаг ветра: Рывок бонусным действием', mv.bonus.includes('dash') && !e.b && mv.speed > 0)}
      ${btn('disB', '↩ Отход бонусным', 'Хитрое действие / Терпеливая оборона: Отход бонусным действием', mv.bonus.includes('dis') && !e.b && !e.dis)}
      ${btn('stand', `⬆ Встать (${half} фт)`, 'Тратит половину скорости и снимает «Лежит ничком»', mv.prone && !dm && mv.speed > 0 && mv.left >= half)}
    </div>` : ''}
    ${e.dis || e.dodge ? `<div class="chips mt">${e.dis ? '<span class="chip on"><span>Отход</span></span>' : ''}${e.dodge ? '<span class="chip on"><span>Уклонение</span></span>' : ''}</div>` : ''}
    ${turn && !dm ? '<div class="mt"><button class="primary" data-tbl="endTurn">✓ Закончить ход</button></div>' : ''}`;
}
function renderInit() {
  const l = initList(), cur = currentEntry(), inList = user && game.init && game.init.list && game.init.list[user.uid];
  const active = game.init && game.init.active;
  $('#tblRound').textContent = active ? `Раунд ${game.init.round || 1}` : 'вне боя';
  $('#tblInit').innerHTML = (l.length ? `<div class="list">${l.map((e) => `<div class="init-row ${cur && cur.id === e.id ? 'cur' : ''} ${e.kind}">
      <b>${e.roll}</b><span>${esc(e.name)}</span>${isDM() ? `<button class="ghost" data-tbl="initDel" data-id="${e.id}" title="Убрать">✕</button>` : ''}</div>`).join('')}</div>` : '<p class="muted small">Пока никто не бросил инициативу.</p>')
    + `<div class="row gap wrap mt">
      ${!isDM() && me() && !inList ? '<button class="primary" data-tbl="rollInit">🎲 Бросить инициативу</button>' : ''}
      ${isDM() ? `<button data-tbl="rollNpc" title="Бросить за всех существ на поле">🎲 Враги</button>
        ${active ? '<button class="primary" data-tbl="next">▶ Следующий ход</button><button class="ghost" data-tbl="endFight">Закончить бой</button>'
          : `<button class="primary" data-tbl="startFight" ${l.length ? '' : 'disabled'}>⚔ Начать бой</button>`}` : ''}</div>`;
}
function renderSide() {
  const box = $('#tblSel'), t = selId && game.tokens[selId];
  if (!t) { box.hidden = true; return; }
  box.hidden = false;
  const dm = isDM(), mine = user && t.owner === user.uid, nums = t.kind === 'pc' || dm;
  box.innerHTML = `<div class="row between"><h3>${esc(t.name)}</h3><button class="ghost" data-tbl="unsel">✕</button></div>
    ${t.hpMax ? `<div>${nums ? `Хиты <b>${t.hp}</b> / ${t.hpMax}${t.temp ? ` (+${t.temp})` : ''}${t.ac ? ` · КД <b>${t.ac}</b>` : ''}` : `<span class="muted">${(t.hp || 0) <= 0 ? 'повержен' : t.hp / t.hpMax > .5 ? 'бодр' : t.hp / t.hpMax > .25 ? 'ранен' : 'тяжело ранен'}</span>`}</div>` : ''}
    ${t.speed ? `<div class="muted small">Скорость ${t.speed} фт${t.init != null ? ` · инициатива ${t.init >= 0 ? '+' : ''}${t.init}` : ''}</div>` : ''}
    ${(t.cond || []).length ? `<div class="chips mt">${t.cond.map((c) => `<span class="chip on"><span>${esc(c)}</span></span>`).join('')}</div>` : ''}
    ${dm && t.kind === 'npc' ? `<div class="row gap wrap mt"><input type="number" id="tblDmg" min="0" placeholder="0" style="width:70px"><button data-tbl="npcDmg">− Урон</button><button data-tbl="npcHeal">＋ Лечение</button></div>
      <div class="row gap wrap mt"><label class="check"><input type="checkbox" data-tbl-hidden ${t.hidden ? 'checked' : ''}> Скрыт от игроков</label>
      <button data-tbl="npcCopy">⧉ Копия</button><button data-tbl="npcInit">🎲 В инициативу</button></div>` : ''}
    ${t.kind === 'pc' && mine ? '<p class="muted small">Хиты и состояния меняются в вашем листе — на поле они обновятся сами.</p>' : ''}
    ${dm || mine ? `<div class="mt"><button class="danger" data-tbl="tokDel">Убрать с поля</button></div>` : ''}`;
}
function renderMembers() {
  $('#tblMembers').innerHTML = Object.entries(game.members || {}).map(([uid, m]) => `<div class="mem ${m.online ? 'on' : ''}">
      <span class="dot"></span><span><b>${esc(m.char ? m.char.name : m.name)}</b>${m.role === 'dm' ? ' <span class="tag g">мастер</span>' : ''}
      <span class="muted small">${esc(m.role === 'dm' ? m.name : `${m.name}${m.char && m.char.cls ? ' · ' + m.char.cls : ''}`)}</span></span>
      ${m.char && m.role !== 'dm' ? `<span class="small">${m.char.hp}/${m.char.hpMax}</span>` : ''}
      ${isDM() && uid !== user.uid ? `<button class="ghost" data-tbl="kick" data-id="${uid}" title="Исключить">✕</button>` : ''}</div>`).join('');
}

/* ---------- Кнопки ---------- */
async function onClick(e) {
  const toolBtn = e.target.closest('[data-tool]');
  if (toolBtn) { tool = toolBtn.dataset.tool; renderTools(); $('#tblBoard').dataset.tool = tool; return; }
  const b = e.target.closest('[data-tbl]');
  if (!b || b.disabled) return;
  const a = b.dataset.tbl;
  try {
    if (a === 'signin') FB.signIn();
    else if (a === 'create') await createGame($('#tblNewName').value.trim());
    else if (a === 'join') {
      const code = $('#tblJoinCode').value, charId = $('#tblJoinChar').value;
      if (!charId) { app.toast('Сначала создайте персонажа'); return; }
      await joinGame(code, charId);
    } else if (a === 'copy') {
      const link = `${location.origin}${location.pathname}?game=${game.code}`;
      await navigator.clipboard.writeText(link).catch(() => {});
      app.toast(`🔗 Ссылка скопирована: ${esc(link)}`);
    } else if (a === 'leave') await leaveGame();
    else if (a === 'zoomIn' || a === 'zoomOut') { zoom = Math.max(0.4, Math.min(2, +(zoom + (a === 'zoomIn' ? 0.2 : -0.2)).toFixed(1))); layoutBoard(); }
    else if (a === 'rollInit') {
      const m = me(), roll = app.rollInit(m.charId), s = app.summary(m.charId);
      await R.set(ref(gpath(`init/list/${user.uid}`)), { name: s.name, roll, owner: user.uid, kind: 'pc', tokenId: `pc_${user.uid}` });
    } else if (a === 'rollNpc') {
      const upd = {};
      Object.entries(game.tokens).forEach(([id, t]) => {
        if (t.kind !== 'npc' || (game.init && game.init.list && game.init.list[id])) return;
        upd[`list/${id}`] = { name: t.name, roll: die(20) + (+t.init || 0), owner: user.uid, kind: 'npc', tokenId: id };
      });
      if (!Object.keys(upd).length) { app.toast('Нет существ без инициативы'); return; }
      await R.update(ref(gpath('init')), upd);
    } else if (a === 'npcInit') {
      const t = game.tokens[selId];
      await R.set(ref(gpath(`init/list/${selId}`)), { name: t.name, roll: die(20) + (+t.init || 0), owner: user.uid, kind: 'npc', tokenId: selId });
    } else if (a === 'startFight') await R.update(ref(gpath()), { 'init/active': true, 'init/round': 1, 'init/turn': 0, econ: null });
    else if (a === 'next' || a === 'endTurn') nextTurn();
    else if (a === 'endFight') { if (app.confirm('Закончить бой и очистить инициативу?')) await R.update(ref(gpath()), { init: null, econ: null }); }
    else if (['eco', 'dash', 'dashB', 'dis', 'disB', 'dodge', 'stand'].includes(a)) await econAct(a, b.dataset.id, b.dataset.k);
    else if (a === 'initDel') await R.remove(ref(gpath(`init/list/${b.dataset.id}`)));
    else if (a === 'unsel') { selId = null; renderSide(); renderTokens(); }
    else if (a === 'tokDel') { if (app.confirm('Убрать токен с поля?')) { await R.remove(ref(gpath(`tokens/${selId}`))); selId = null; } }
    else if (a === 'npcDmg' || a === 'npcHeal') {
      const t = game.tokens[selId], n = Math.max(0, +$('#tblDmg').value || 0);
      if (!n) return;
      const hp = a === 'npcDmg' ? Math.max(0, t.hp - n) : Math.min(t.hpMax, t.hp + n);
      await R.update(ref(gpath(`tokens/${selId}`)), { hp });
      if (hp === 0 && a === 'npcDmg') app.toast(`☠ ${esc(t.name)} повержен`);
    } else if (a === 'npcCopy') { const t = game.tokens[selId]; newEnemyDialog(Math.min(W() - 1, t.x + (t.size || 1)), t.y, t); }
    else if (a === 'kick') {
      const uid = b.dataset.id;
      if (!app.confirm('Исключить участника из игры?')) return;
      await R.update(ref(gpath()), { [`members/${uid}`]: null, [`tokens/pc_${uid}`]: null, [`init/list/${uid}`]: null });
    }
  } catch (err) {
    app.toast(`Ошибка: ${esc(err.code || err.message)}`, 'fumble');
  }
}
document.addEventListener('click', (e) => { if (e.target.closest('#tab-table')) onClick(e); });
document.addEventListener('change', (e) => {
  if (e.target.matches('[data-tbl-hidden]') && game && selId) R.update(ref(gpath(`tokens/${selId}`)), { hidden: e.target.checked });
});
const board = $('#tblBoard');
board.addEventListener('pointerdown', onDown);
// Движение и отпускание слушаем на всём окне: палец может «уйти» с поля или с токена во время перетаскивания
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);
$('#tblWrap').addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return; // масштаб — Ctrl + колесо, обычное колесо прокручивает
  e.preventDefault();
  zoom = Math.max(0.4, Math.min(2, +(zoom + (e.deltaY < 0 ? 0.1 : -0.1)).toFixed(1)));
  layoutBoard();
}, { passive: false });
renderAll();
