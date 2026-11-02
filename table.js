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
let aim = null; // выбор цели атаки: { from, charId, atk, way, left }
const openedAt = Date.now(); // уведомления — только о событиях после открытия страницы
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
  game = { id: gid, code, meta: null, members: {}, tokens: {}, map: {}, init: null, econ: {}, log: {}, areas: {} };
  ls.set(GAME_KEY, JSON.stringify({ id: gid, code, uid: user.uid }));
  const lost = (e) => { if (String(e && e.code).includes('PERMISSION')) { app.toast('Нет доступа к игре — возможно, вас исключили'); leaveLocal(); renderAll(); } };
  const on = (p, fn) => unsubs.push(R.onValue(ref(gpath(p)), (s) => { if (game && game.id === gid) { fn(s.val()); renderAll(); } }, lost));
  on('meta', (v) => { if (!v) { app.toast('Игра завершена мастером'); leaveLocal(); } else game.meta = v; });
  on('members', (v) => { game.members = v || {}; });
  on('tokens', (v) => { game.tokens = v || {}; });
  on('map', (v) => { game.map = v || {}; drawTerrain(); });
  on('init', (v) => { game.init = v; checkMyTurn(); });
  on('econ', (v) => { game.econ = v || {}; });
  on('log', (v) => { game.log = v || {}; applyLog(); notifyLog(); });
  on('areas', (v) => { game.areas = v || {}; drawAreas(); notifyAreas(); autoNpcSaves(); });
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
  game = null; selId = null; aim = null; cast = null; ruler = null;
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
  ['#tblTerrain', '#tblAreas', '#tblRange'].forEach((s) => { const cv = $(s); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } });
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
  // Размещение области: нажатие фиксирует её; для заклинания на одну цель — нажатие на существо
  if (cast) {
    if (cast.area.shape === 'target') { if (tokEl) { cast.area.tgt = tokEl.dataset.tok; confirmCast(); } return; }
    castFollow(p.px / CELL, p.py / CELL);
    confirmCast();
    return;
  }
  // Выбор цели атаки: нажатие на чужой токен — атака; по пустому месту и своему токену — как обычно
  if (aim && tokEl && tokEl.dataset.tok !== aim.from) { attackTarget(tokEl.dataset.tok); return; }
  if (TERRAIN[tool] || tool === 'erase') {
    drag = { kind: 'paint', pending: {} };
    paintAt(p);
  } else if (tool === 'ruler') {
    ruler = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    drag = { kind: 'ruler' };
    drawRuler();
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
function aimHint(e) {
  const tokEl = e.target.closest && e.target.closest('[data-tok]'), from = game.tokens[aim.from];
  const T = tokEl && tokEl.dataset.tok !== aim.from && game.tokens[tokEl.dataset.tok];
  if (!T || !from) { hint('', e); return; }
  const d = distFt(from, T), r = aim.atk.rng;
  hint(r.reach && d <= r.reach ? `${d} фт — ближний бой` : r.near && d <= r.far ? `${d} фт${d > r.near ? ' — большая дистанция (помеха)' : ''}` : `${d} фт — не достать`, e);
}
function onMove(e) {
  if (!drag) {
    const over = game && e.target.closest && e.target.closest('#tblBoard');
    if (cast && over) {
      if (cast.area.shape === 'target') { const tokEl = e.target.closest('[data-tok]'); cast.area.tgt = tokEl ? tokEl.dataset.tok : null; }
      else { const p = cellAt(e); castFollow(p.px / CELL, p.py / CELL); }
      drawAreas();
      castHint(e);
    } else if (aim && over) aimHint(e);
    else if ((aim || cast) && game) $('#tblHint').hidden = true;
    return;
  }
  const p = cellAt(e);
  if (drag.kind === 'ruler') {
    Object.assign(ruler, { x1: p.x, y1: p.y });
    drawRuler();
    hint(`${5 * Math.max(Math.abs(p.x - ruler.x0), Math.abs(p.y - ruler.y0))} фт`, e);
  } else if (drag.kind === 'pan') {
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
    // Предупреждение заранее: уход из досягаемости врага без Отхода
    if (drag.counted && d != null && txt && !drag.occ.has(`${tx}_${ty}`) && !econ(drag.id).dis) {
      const t = game.tokens[drag.id], oa = foesNear({ ...t, x: drag.sx, y: drag.sy }, drag.id).filter(([, o]) => distFt({ ...t, x: tx, y: ty }, o) > 5);
      if (t && oa.length) txt += ` · ⚠ атака по возможности: ${oa.map(([, o]) => o.name).join(', ')}`;
    }
    hint(txt, e);
  }
}
function onUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  hint('');
  if (d.kind === 'ruler') { ruler = null; drawRuler(); return; }
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
      if (d.counted) {
        upd[`econ/${d.id}/move`] = (econ(d.id).move || 0) + (cost != null ? cost : 5 * Math.max(Math.abs(x - d.sx), Math.abs(y - d.sy)));
        checkOpportunity(d.id, { ...t, x, y }, d.sx, d.sy);
      }
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
  if (turn >= l.length) { turn = 0; round += 1; addLog({ kind: 'sys', txt: `Раунд ${round}` }); }
  aim = null;
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
  const ACT_LOG = { dash: 'Рывок', dashB: 'Рывок (бонусное действие)', dis: 'Отход', disB: 'Отход (бонусное действие)', dodge: 'Уклонение', stand: 'встаёт' };
  if (ACT_LOG[a]) addLog({ kind: 'act', who: t.name, txt: ACT_LOG[a] });
}

/* ---------- Журнал ---------- */
// games/{id}/log/{key}: { t, by, kind: atk | act | oa | sys, who, txt, … }; для атак — цель, бросок, урон.
// Урон применяет клиент владельца цели (мастер — существам, игрок — своему персонажу) и ставит applied.
const LOG_MAX = 80;
function addLog(e) {
  const k = R.push(ref(gpath('log'))).key;
  R.set(ref(gpath(`log/${k}`)), { ...e, t: Date.now(), by: user.uid }).catch(() => {});
  const keys = Object.keys(game.log || {});
  if (keys.length >= LOG_MAX) {
    const old = keys.sort((a, b) => (game.log[a].t || 0) - (game.log[b].t || 0)).slice(0, keys.length - LOG_MAX + 1);
    R.update(ref(gpath('log')), Object.fromEntries(old.map((x) => [x, null]))).catch(() => {});
  }
}
const logList = () => Object.entries(game.log || {}).map(([k, e]) => ({ k, ...e })).sort((a, b) => (b.t || 0) - (a.t || 0));
const applying = new Set();
function applyLog() {
  if (!game || !user) return;
  logList().forEach((e) => {
    const t = e.tgt && game.tokens[e.tgt];
    if (!e.dmg || e.applied || !t || applying.has(e.k)) return;
    if (t.kind === 'npc' ? !isDM() : t.owner !== user.uid) return;
    applying.add(e.k);
    const upd = { [`log/${e.k}/applied`]: true };
    if (t.kind === 'npc') {
      const hp = Math.max(0, (+t.hp || 0) - e.dmg);
      upd[`tokens/${e.tgt}/hp`] = hp;
      if (hp === 0 && (+t.hp || 0) > 0) upd[`log/${e.k}/down`] = true;
    } else {
      const m = me();
      if (m && m.charId) app.takeDamage(m.charId, e.dmg);
    }
    R.update(ref(gpath()), upd).catch(() => applying.delete(e.k));
  });
}
// Всплывающие уведомления о том, что касается меня: атаки по моему персонажу, возможность атаки по возможности
const notified = new Set();
function notifyLog() {
  if (!game || !user) return;
  logList().forEach((e) => {
    if ((e.t || 0) < openedAt || e.by === user.uid || notified.has(e.k)) return;
    notified.add(e.k);
    const t = e.tgt && game.tokens[e.tgt];
    if (e.kind === 'atk' && t && t.owner === user.uid && t.kind === 'pc')
      app.toast(`🗡 ${esc(e.who)} атакует вас: ${e.hit ? `${e.crit ? 'КРИТ! ' : ''}попадание, <b>${e.dmg}</b> урона` : 'промах'}`, e.hit ? 'fumble' : '');
    if (e.kind === 'oa' && (e.foes || []).some((id) => game.tokens[id] && canMove(game.tokens[id])))
      app.toast(`⚠ ${esc(e.txt)}`, 'crit');
  });
}
function renderLog() {
  const box = $('#tblLog');
  if (!box) return;
  const dm = isDM();
  $('#tblLogClear').hidden = !dm;
  box.innerHTML = logList().slice(0, 40).map((e) => {
    const time = e.t ? new Date(e.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '';
    if (e.kind === 'atk') {
      const res = e.hit ? `<b class="lg-hit">${e.crit ? 'КРИТ! ' : 'попадание'}</b> · <b>${e.dmg}</b> ${esc(e.dtype || 'урона')}` : '<b class="lg-miss">промах</b>';
      return `<div class="lg atk ${e.hit ? 'hit' : 'miss'}"><div><b>${esc(e.who)}</b> → <b>${esc(e.tgtName)}</b>: ${esc(e.txt)}</div>
        <div><span class="lg-roll">${e.total}</span>${dm && e.ac ? ` против КД ${e.ac}` : ''} — ${res}${e.down ? ' · ☠ повержен' : ''}</div>
        <div class="muted small">${esc(e.detail || '')}${e.dmgDetail ? ` · урон: ${esc(e.dmgDetail)}` : ''}${e.way ? ` · ${esc(e.way)}` : ''} · ${time}</div></div>`;
    }
    return `<div class="lg ${e.kind}"><div>${e.who ? `<b>${esc(e.who)}</b>: ` : ''}${esc(e.txt)}</div><div class="muted small">${e.detail ? `${esc(e.detail)} · ` : ''}${time}</div></div>`;
  }).join('') || '<p class="muted small">Здесь появятся атаки и действия участников.</p>';
}

/* ---------- Атака по цели ---------- */
// Расстояние между существами (фт): по ближайшим клеткам, диагональ — тоже 5 фт
function distFt(a, b) {
  const as = a.size || 1, bs = b.size || 1;
  const dx = Math.max(0, a.x - (b.x + bs - 1), b.x - (a.x + as - 1)), dy = Math.max(0, a.y - (b.y + bs - 1), b.y - (a.y + as - 1));
  return 5 * Math.max(dx, dy);
}
const incapTok = (t) => (t.hpMax && (+t.hp || 0) <= 0) || (t.cond || []).some((k) => INCAP.includes(k));
const hostile = (a, b) => a.kind !== b.kind;
// Враги рядом (5 фт), способные действовать
const foesNear = (t, id) => Object.entries(game.tokens).filter(([k, o]) => k !== id && hostile(t, o) && !incapTok(o) && !(o.hidden && !isDM()) && distFt(t, o) <= 5);
const WAYS = { action: 'действие «Атака»', magic: 'действие «Магия»', bonus: 'бонусное действие', reaction: 'реакция' };
function openAttack(id) {
  const t = game.tokens[id], m = me(), e = econ(id), turn = isTurnOf(id);
  if (!t || !m || !m.charId) return;
  const atks = app.attacks(m.charId), per = (app.summary(m.charId) || {}).atks || 1;
  const ways = [];
  if (turn && (e.atk > 0 || !e.a)) ways.push(['action', e.atk > 0 ? `Действие «Атака» — осталось атак: ${e.atk}` : `Действие «Атака»${per > 1 ? ` (${per} атаки)` : ''}`]);
  if (turn && !e.b) ways.push(['bonus', 'Бонусное действие (второе оружие, Боевые искусства…)']);
  if (!e.r) ways.push(['reaction', 'Реакция (атака по возможности)']);
  if (!ways.length) { app.toast('Нет доступных действий для атаки'); return; }
  const rng = (r) => (r.near ? `${r.reach ? `${r.reach} фт / бросок ` : ''}${r.near}${r.far > r.near ? `/${r.far}` : ''} фт` : `досягаемость ${r.reach} фт`);
  app.openModal(`<h2>⚔ Атака</h2>
    <div class="atk-ways">${ways.map(([k, n], i) => `<label class="check"><input type="radio" name="atkWay" value="${k}" ${i ? '' : 'checked'}> ${esc(n)}</label>`).join('')}</div>
    <div class="list mt">${atks.map((a) => `<button class="atk-pick" data-atk="${esc(a.id)}" ${a.ammo === 0 ? 'disabled title="Нет боеприпасов"' : ''}>
      <b>${esc(a.n)}</b><span class="muted small">${a.bonus >= 0 ? '+' : ''}${a.bonus} к попаданию · ${esc(a.dmg)} ${esc(a.type)}${a.beams > 1 ? ` ×${a.beams} луча` : ''} · ${rng(a.rng)}${a.ammo != null ? ` · 🏹 ${a.ammo}` : ''}${a.mastery ? ` · ⚔ ${esc(a.mastery)}` : ''}</span></button>`).join('') || '<p class="muted">В листе нет атак — добавьте оружие или заговор с атакой.</p>'}</div>
    <p class="muted small">Затем нажмите на цель на поле. Преимущество и помеха (цель лежит, уклоняется, враг рядом с вами при выстреле, дальняя дистанция) учитываются сами.</p>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  $$('.atk-pick').forEach((b) => b.addEventListener('click', () => {
    const A = atks.find((x) => x.id === b.dataset.atk);
    let way = ($('input[name="atkWay"]:checked') || {}).value;
    if (A.cantrip) {
      if (!turn || e.atk > 0 || e.a) { app.toast(turn ? 'Заговор накладывается действием «Магия», а действие уже потрачено' : 'Заговор накладывается действием — только в свой ход'); return; }
      way = 'magic';
    }
    const left = way === 'action' ? (e.atk > 0 ? e.atk : per) : way === 'magic' ? A.beams || 1 : 1;
    app.closeModal();
    aim = { from: id, charId: m.charId, atk: A, way, left };
    renderAll();
  }));
}
function attackTarget(tid) {
  const a = aim, me_ = game.tokens[a.from], T = game.tokens[tid], A = a.atk, r = A.rng;
  if (!me_ || !T) return;
  const d = distFt(me_, T);
  let ranged;
  if (r.reach && d <= r.reach) ranged = false;
  else if (r.near) { if (d > r.far) { app.toast(`Слишком далеко: ${d} фт, предел ${r.far} фт`); return; } ranged = true; }
  else { app.toast(`Цель вне досягаемости: ${d} фт, досягаемость ${r.reach} фт`); return; }
  // Преимущество и помеха от обстановки (2024): состояние цели, Уклонение, дистанция, враг рядом со стрелком
  const adv = [], dis = [], tc = T.cond || [], incapT = incapTok(T);
  if (econ(tid).dodge && !incapT) dis.push('цель уклоняется');
  if (tc.includes('prone') || tc.includes('unconscious')) (d <= 5 ? adv : dis).push('цель лежит');
  ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned'].forEach((k) => { if (tc.includes(k)) adv.push(`цель: ${condName(k).toLowerCase()}`); });
  if (tc.includes('invisible')) dis.push('цель невидима');
  if (ranged && d > r.near) dis.push('большая дистанция');
  if (ranged && foesNear(me_, a.from).length) dis.push('враг рядом');
  const res = app.attack(a.charId, A.id, { target: T.name, ac: +T.ac || 10, adv, dis, autoCrit: d <= 5 && (tc.includes('paralyzed') || tc.includes('unconscious')) });
  if (!res) { aim = null; renderAll(); return; }
  addLog({ kind: 'atk', who: me_.name, txt: A.n, tgt: tid, tgtName: T.name, total: res.total, nat: res.nat, ac: +T.ac || 10, hit: res.hit, crit: res.crit,
    dmg: res.dmg, dtype: res.type, detail: res.detail, dmgDetail: res.dmgDetail, way: WAYS[a.way] });
  // Расход: первая атака тратит действие (остаток Дополнительной атаки — в atk), бонусное действие или реакцию
  const upd = {};
  if (a.way === 'action') { upd.a = 1; upd.atk = a.left - 1 || null; }
  if (a.way === 'magic') upd.a = 1;
  if (a.way === 'bonus') upd.b = 1;
  if (a.way === 'reaction') upd.r = 1;
  if (inFight()) R.update(ref(gpath(`econ/${a.from}`)), upd).catch(() => {});
  a.left -= 1;
  if (a.left <= 0) aim = null;
  renderAll();
}
// Атака по возможности: существо уходит из досягаемости врага без Отхода
function checkOpportunity(id, t, fromX, fromY) {
  if (econ(id).dis) return;
  const before = { ...t, x: fromX, y: fromY };
  const foes = foesNear(before, id).filter(([k, o]) => distFt(t, o) > 5 && !econ(k).r).map(([k]) => k);
  if (!foes.length) return;
  addLog({ kind: 'oa', who: '', foes, txt: `${t.name} покидает досягаемость: ${foes.map((k) => game.tokens[k].name).join(', ')} — можно атаку по возможности (реакция)` });
}

/* ---------- Области заклинаний и спасброски ---------- */
// games/{id}/areas/{key}: { by, who, n, shape: sphere | cone | line | cube | aura | target, size, width, ox, oy, ang, from, tgt, color,
//   abil, dc, half, expr, dmg, dtype, keep, t, tg: { tokenId: { done, ok, roll, dmg } } }
// Координаты в клетках (дробные): ox, oy — точка начала, ang — направление. Аура следует за существом from.
const AB_N = { str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы' };
const SHAPE_N = { sphere: 'сфера', cone: 'конус', line: 'линия', cube: 'куб', aura: 'вокруг себя', target: 'одна цель' };
const CONE_HALF = Math.atan(0.5); // ширина конуса равна расстоянию от точки начала
const AUTO_FAIL_T = ['paralyzed', 'stunned', 'unconscious', 'petrified'];
let cast = null; // размещение области: { area, info, caster, charId, slotKey, dm }
let ruler = null; // линейка: { x0, y0, x1, y1 } — клетки
const DMG_COLOR = [[/огн|огонь/, '#e0703a'], [/холод/, '#6fb7e8'], [/электр|молни/, '#b9a6ff'], [/звук|гром/, '#8f9ccf'], [/кислот/, '#8bc34a'],
  [/яд/, '#6fae3a'], [/излуч/, '#f0d36a'], [/некрот/, '#9b6fd1'], [/псих/, '#d07ab0'], [/силов/, '#b07ae0']];
const colorFor = (dtype) => (DMG_COLOR.find(([re]) => re.test(String(dtype || '').toLowerCase())) || [0, '#d4a64a'])[1];
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function geo(A) {
  const t = A.shape === 'aura' && A.from && game.tokens[A.from];
  if (!t) return A;
  const s = t.size || 1;
  return { ...A, ox: t.x + s / 2, oy: t.y + s / 2, r: A.size / 5 + s / 2 };
}
function ptIn(A, px, py) {
  const vx = px - A.ox, vy = py - A.oy, L = A.size / 5, e = 1e-6;
  if (A.shape === 'sphere' || A.shape === 'aura') return Math.hypot(vx, vy) <= (A.r || L) + e;
  const ux = Math.cos(A.ang || 0), uy = Math.sin(A.ang || 0), along = vx * ux + vy * uy, across = -vx * uy + vy * ux;
  if (A.shape === 'cone') return along > 0 && Math.hypot(vx, vy) <= L + e && Math.abs(Math.atan2(across, along)) <= CONE_HALF + e;
  if (A.shape === 'line') return along >= -e && along <= L + e && Math.abs(across) <= (A.width || 5) / 10 + e;
  if (A.shape === 'cube') return along >= -e && along <= L + e && Math.abs(across) <= L / 2 + e;
  return false;
}
// Клетка в области, если покрыта больше чем наполовину (9 точек внутри клетки)
function cellIn(A, x, y) {
  let n = 0;
  for (const dx of [0.17, 0.5, 0.83]) for (const dy of [0.17, 0.5, 0.83]) if (ptIn(A, x + dx, y + dy)) n++;
  return n >= 5;
}
function areaCells(A) {
  const g = geo(A), out = [];
  if (g.shape === 'target') return out;
  const R = Math.max(g.r || 0, g.size / 5) + 1;
  for (let x = Math.max(0, Math.floor(g.ox - R)); x < Math.min(W(), Math.ceil(g.ox + R)); x++)
    for (let y = Math.max(0, Math.floor(g.oy - R)); y < Math.min(H(), Math.ceil(g.oy + R)); y++) if (cellIn(g, x, y)) out.push([x, y]);
  return out;
}
function areaTokens(A) {
  if (A.shape === 'target') return A.tgt && game.tokens[A.tgt] ? [A.tgt] : [];
  const set = new Set(areaCells(A).map(([x, y]) => `${x}_${y}`));
  return Object.entries(game.tokens).filter(([id, t]) => {
    if ((A.shape === 'aura' && id === A.from) || (t.hidden && !isDM())) return false;
    const s = t.size || 1;
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) if (set.has(`${t.x + dx}_${t.y + dy}`)) return true;
    return false;
  }).map(([id]) => id);
}
function shapePath(g, A) {
  const ox = A.ox * CELL, oy = A.oy * CELL, L = (A.size / 5) * CELL, ang = A.ang || 0, ux = Math.cos(ang), uy = Math.sin(ang);
  if (A.shape === 'sphere' || A.shape === 'aura') { g.arc(ox, oy, (A.r || A.size / 5) * CELL, 0, Math.PI * 2); return; }
  if (A.shape === 'cone') { g.moveTo(ox, oy); g.arc(ox, oy, L, ang - CONE_HALF, ang + CONE_HALF); g.closePath(); return; }
  const w = A.shape === 'line' ? ((A.width || 5) / 10) * CELL : L / 2, nx = -uy * w, ny = ux * w;
  g.moveTo(ox + nx, oy + ny); g.lineTo(ox + ux * L + nx, oy + uy * L + ny); g.lineTo(ox + ux * L - nx, oy + uy * L - ny); g.lineTo(ox - nx, oy - ny); g.closePath();
}
function drawAreas() {
  const cv = $('#tblAreas'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  if (!game) return;
  const list = Object.values(game.areas || {});
  if (cast && cast.area && cast.area.ox != null) list.push({ ...cast.area, preview: true });
  list.forEach((A) => {
    const col = A.color || '#d4a64a';
    g.save();
    g.strokeStyle = col; g.lineWidth = 2; g.setLineDash(A.preview ? [6, 4] : []);
    if (A.shape === 'target') {
      const t = game.tokens[A.tgt];
      if (t) { const s = (t.size || 1) * CELL; g.beginPath(); g.arc(t.x * CELL + s / 2, t.y * CELL + s / 2, s / 2 + 4, 0, Math.PI * 2); g.stroke(); }
    } else {
      const G = geo(A);
      g.fillStyle = rgba(col, A.preview ? 0.32 : 0.22);
      areaCells(A).forEach(([x, y]) => g.fillRect(x * CELL, y * CELL, CELL, CELL));
      g.beginPath(); shapePath(g, G); g.stroke();
      g.setLineDash([]); g.font = '600 12px system-ui, sans-serif'; g.fillStyle = '#fff'; g.shadowColor = '#000'; g.shadowBlur = 3;
      g.fillText(A.n || '', G.ox * CELL + 6, G.oy * CELL - 6);
    }
    g.restore();
  });
}
// Размещение: «от себя» — конус, линия, куб тянутся от существа к указателю; сфера и куб на расстоянии — центр под указателем
function castFollow(mx, my) {
  const A = cast.area, src = cast.caster && game.tokens[cast.caster];
  if (A.shape === 'target' || A.shape === 'aura') return;
  if ((A.shape === 'cone' || A.shape === 'line' || (A.shape === 'cube' && cast.self)) && src) {
    const s = src.size || 1, cx = src.x + s / 2, cy = src.y + s / 2;
    let ang = Math.atan2(my - cy, mx - cx);
    if (A.shape === 'cube') ang = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
    Object.assign(A, { ang, ox: cx + Math.cos(ang) * (s / 2), oy: cy + Math.sin(ang) * (s / 2) });
  } else if (A.shape === 'sphere') Object.assign(A, { ox: Math.round(mx), oy: Math.round(my) });
  else if (A.shape === 'cube') {
    const n = A.size / 5, snap = (v) => (n % 2 ? Math.floor(v) + 0.5 : Math.round(v)), cx = snap(mx), cy = snap(my);
    Object.assign(A, { ang: 0, ox: cx - n / 2, oy: cy });
  }
}
// Центр размещённой области в пределах дистанции заклинания
function castInRange() {
  const A = cast.area, src = cast.caster && game.tokens[cast.caster];
  if (!src || !cast.range || cast.self || A.shape === 'aura') return true;
  if (A.shape === 'target') return !!A.tgt && distFt(src, game.tokens[A.tgt]) <= cast.range;
  const cx = A.shape === 'cube' ? A.ox + A.size / 10 : A.ox;
  return distFt(src, { x: Math.floor(cx - 0.001), y: Math.floor(A.oy - 0.001), size: 1 }) <= cast.range
    || distFt(src, { x: Math.floor(cx), y: Math.floor(A.oy), size: 1 }) <= cast.range;
}
function castHint(e) {
  const A = cast.area, n = areaTokens(A).length;
  hint(A.shape === 'target' ? (A.tgt ? `${game.tokens[A.tgt].name}${castInRange() ? '' : ' — слишком далеко'}` : 'выберите цель')
    : `${castInRange() ? '' : 'слишком далеко · '}в области: ${n}`, e);
}
function startCast(c) {
  const I = c.info;
  cast = { ...c, self: !!I.self, range: I.range || 0,
    area: { n: I.n, shape: I.shape, size: I.size, width: I.width || 5, color: colorFor(I.dtype), from: I.shape === 'aura' ? c.caster : null } };
  if (I.shape === 'aura') { cast.area.ox = 0; confirmCast(); return; }
  aim = null;
  renderAll();
  app.toast(I.shape === 'target' ? `✨ ${esc(I.n)}: нажмите на цель` : `✨ ${esc(I.n)}: наведите область и нажмите на поле · Esc — отмена`);
}
function cancelCast() { cast = null; hint(''); renderAll(); }
// Игрок: список заклинаний с областью/спасброском → ячейка → размещение
function openCast(id) {
  const m = me(), e = econ(id), turn = isTurnOf(id);
  if (!m || !m.charId) return;
  const list = app.areaSpells(m.charId);
  const can = (act) => !inFight() || (act === 'reaction' ? !e.r : turn && (act === 'bonus' ? !e.b : !e.a && !(e.atk > 0)));
  const ACT_N = { action: 'действие', bonus: 'бонусное', reaction: 'реакция' };
  app.openModal(`<h2>✨ Заклинание</h2>
    <div class="list">${list.map((s) => `<button class="atk-pick" data-sp="${esc(s.id)}" ${can(s.act) ? '' : 'disabled'}>
      <b>${esc(s.n)} <span class="muted small">${s.l ? `${s.l} ур.` : 'заговор'}</span></b>
      <span class="muted small">${SHAPE_N[s.shape]}${s.size ? ` ${s.size} фт` : ''}${s.range ? ` · дистанция ${s.range} фт` : s.self ? ' · от себя' : ''}${s.save ? ` · спасбросок ${AB_N[s.save]} СЛ ${s.dc}` : ''}${s.f ? ` · ${esc(s.f)}${s.dtype ? ' ' + esc(s.dtype) : ''}` : ''} · ${ACT_N[s.act]}</span></button>`).join('')
      || '<p class="muted">Нет подготовленных заклинаний с областью или спасброском.</p>'}</div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  $$('[data-sp]').forEach((b) => b.addEventListener('click', () => {
    const I = list.find((x) => x.id === b.dataset.sp);
    const go = (slotKey) => { app.closeModal(); startCast({ info: I, caster: id, charId: m.charId, slotKey }); };
    const slots = I.slots.filter((s) => s.left > 0);
    if (!I.l) { go('free'); return; }
    if (!slots.length) { app.toast('Нет свободных ячеек'); return; }
    $('#modalBody').innerHTML = `<h2>${esc(I.n)}</h2><p class="muted small">Выберите ячейку${I.u ? ` — выше уровня: +${esc(I.u)} за уровень` : ''}.</p>
      <div class="slot-choice">${slots.map((s) => `<button data-slot="${s.key}">${esc(s.label)}</button>`).join('')}</div>
      <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`;
    $$('[data-slot]').forEach((x) => x.addEventListener('click', () => go(x.dataset.slot)));
  }));
}
// Мастер: область без заклинания из листа (дыхание дракона, ловушка) — источник — выбранное существо
function dmAreaDialog() {
  app.openModal(`<h2>◯ Область</h2><div class="form-grid">
    <label style="grid-column:1/-1">Название<input id="aN" value="Дыхание"></label>
    <label>Форма<select id="aS">${Object.entries(SHAPE_N).filter(([k]) => k !== 'target').map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    <label>Размер, фт<input id="aZ" type="number" step="5" value="15"></label>
    <label>Спасбросок<select id="aA"><option value="">— нет —</option>${Object.entries(AB_N).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
    <label>СЛ<input id="aD" type="number" value="13"></label>
    <label>Урон<input id="aF" placeholder="6d6"></label><label>Тип урона<input id="aT" placeholder="огнём"></label>
    <label class="check"><input type="checkbox" id="aH" checked> Половина при успехе</label>
    <label class="check"><input type="checkbox" id="aK"> Оставить на поле</label></div>
    <p class="muted small">Конус, линия и «вокруг себя» исходят от выбранного на поле существа — сначала выделите его.</p>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="aOk">Разместить</button></div>`);
  $('#aOk').onclick = () => {
    const shape = $('#aS').value, abil = $('#aA').value;
    const needSrc = shape === 'cone' || shape === 'line' || shape === 'aura';
    if (needSrc && !(selId && game.tokens[selId])) { app.toast('Выделите существо-источник на поле'); return; }
    const info = { n: $('#aN').value.trim() || 'Область', shape, size: Math.max(5, +$('#aZ').value || 5), width: 5, save: abil, dc: +$('#aD').value || 10,
      f: $('#aF').value.trim(), dtype: $('#aT').value.trim(), half: $('#aH').checked, keepAlways: $('#aK').checked, self: needSrc };
    app.closeModal();
    startCast({ dm: true, caster: needSrc ? selId : null, info });
  };
}
function confirmCast() {
  const A = cast.area, I = cast.info;
  if (!castInRange()) { app.toast(`Слишком далеко: дистанция ${cast.range} фт`); return; }
  const ids = areaTokens(A);
  if (A.shape === 'target' && !ids.length) return;
  // Область задевает всех, кто в ней, включая союзников — выбирать цели нельзя
  const tok = (id) => game.tokens[id], src = cast.caster && tok(cast.caster);
  const allies = src ? ids.filter((id) => tok(id).kind === src.kind) : [];
  app.openModal(`<h2>✨ ${esc(I.n)}</h2>
    <p class="small">${I.save ? `Спасбросок <b>${AB_N[I.save]}</b>, СЛ <b>${I.dc}</b>` : 'Без спасброска'}${I.f ? ` · ${esc(I.f)} ${esc(I.dtype || '')}${I.save ? (I.half ? ', половина при успехе' : ', при успехе — без урона') : ''}` : ''}</p>
    ${ids.length ? `<p>Задевает: ${ids.map((id) => `<b class="${allies.includes(id) ? 'warn-text' : ''}">${esc(tok(id).name)}${allies.includes(id) ? ' (союзник!)' : ''}</b>`).join(', ')}</p>
      ${allies.length ? '<p class="small warn-text">⚠ В области союзники — они тоже получат урон.</p>' : ''}` : '<p class="muted">В области никого нет.</p>'}
    <div class="modal-actions"><button id="cBack">Назад</button><button class="primary" id="cOk">✨ Сотворить</button></div>`);
  $('#cBack').onclick = () => { app.closeModal(); if (A.shape === 'aura') cancelCast(); };
  $('#cOk').onclick = () => { app.closeModal(); doCastArea(ids); };
}
function doCastArea(chosen) {
  const A = cast.area, I = cast.info, c = cast;
  let roll = null;
  if (c.charId) { roll = app.castArea(c.charId, I.id, c.slotKey); if (!roll) { cancelCast(); return; } }
  else if (I.f) roll = app.rollFormula(I.f, I.n);
  const src = c.caster && game.tokens[c.caster];
  const keep = c.dm ? !!I.keepAlways : !!I.cn || !/мгновен/i.test(I.dur || '');
  const lvlTxt = roll && roll.castLvl > I.l ? ` (${roll.castLvl} ур.)` : '';
  const entry = { ...A, by: user.uid, who: src ? src.name : 'Мастер', n: I.n + lvlTxt, abil: I.save || '', dc: I.dc || 0, half: !!I.half,
    expr: (roll && roll.expr) || I.f || '', dmg: roll ? roll.dmg || roll.total || 0 : 0, dmgDetail: roll ? roll.dmgDetail || roll.detail || '' : '', dtype: I.dtype || '', keep, t: Date.now() };
  if (I.save && chosen.length) entry.tg = Object.fromEntries(chosen.map((id) => [id, { done: false }]));
  const k = R.push(ref(gpath('areas'))).key;
  R.set(ref(gpath(`areas/${k}`)), entry).catch((err) => app.toast(`Не удалось создать область: ${esc(err.code || err.message)}`));
  if (c.charId && inFight()) R.update(ref(gpath(`econ/${c.caster}`)), { [I.act === 'bonus' ? 'b' : I.act === 'reaction' ? 'r' : 'a']: 1 }).catch(() => {});
  addLog({ kind: 'area', who: entry.who, txt: `✨ ${entry.n}${entry.dmg ? ` — ${entry.dmg} ${entry.dtype || ''}` : ''}${I.save ? ` · спасбросок ${AB_N[I.save]} СЛ ${entry.dc}` : ''}${chosen.length ? ` · цели: ${chosen.map((id) => game.tokens[id].name).join(', ')}` : ''}`,
    detail: entry.dmgDetail });
  if (!keep && !entry.tg) setTimeout(() => R.remove(ref(gpath(`areas/${k}`))).catch(() => {}), 8000);
  cast = null; hint('');
  renderAll();
}
// Урон по итогам спасброска: успех — половина или ничего; Увёртливость (спасбросок Ловкости) — ничего при успехе, половина при провале
function saveDmg(A, ok, evasion) {
  if (!A.dmg) return 0;
  if (evasion && A.abil === 'dex' && A.half) return ok ? 0 : Math.floor(A.dmg / 2);
  return ok ? (A.half ? Math.floor(A.dmg / 2) : 0) : A.dmg;
}
function finishArea(k, doneIds) {
  const A = game.areas[k];
  if (!A || A.keep) return;
  const left = Object.entries(A.tg || {}).filter(([id, v]) => !v.done && !doneIds.includes(id) && game.tokens[id]);
  if (!left.length) setTimeout(() => R.remove(ref(gpath(`areas/${k}`))).catch(() => {}), 6000);
}
function saveMine(k, tid) {
  const A = game.areas[k], t = game.tokens[tid], m = me();
  if (!A || !t || !m || !m.charId || !(A.tg || {})[tid] || A.tg[tid].done) return;
  const adv = econ(tid).dodge && A.abil === 'dex' ? ['Уклонение'] : [];
  const r = app.rollSave(m.charId, A.abil, A.dc, { label: A.n, adv });
  if (!r) return;
  const dmg = saveDmg(A, r.ok, (app.summary(m.charId) || {}).evasion);
  R.update(ref(gpath(`areas/${k}/tg/${tid}`)), { done: true, ok: r.ok, roll: r.total, dmg }).catch(() => {});
  if (dmg) app.takeDamage(m.charId, dmg);
  addLog({ kind: 'save', who: t.name, txt: `${A.n}: спасбросок ${AB_N[A.abil]} ${r.total} — ${r.ok ? 'успех' : 'провал'}${dmg ? `, ${dmg} ${A.dtype || 'урона'}` : ', без урона'}`, detail: r.detail });
  finishArea(k, [tid]);
}
// Спасброски существ бросает браузер мастера автоматически, как только они попали в область; итог — в журнале.
// Бонус спасброска — из токена (sv), автопровал и преимущество/помеха — от состояний
const npcSaving = new Set();
function autoNpcSaves() {
  if (!game || !isDM()) return;
  Object.entries(game.areas || {}).forEach(([k, A]) => {
    const key = `${k}:${A.dmgDetail || ''}:${Object.keys(A.tg || {}).join(',')}`;
    if (npcSaving.has(key) || !Object.entries(A.tg || {}).some(([id, v]) => !v.done && game.tokens[id] && game.tokens[id].kind === 'npc')) return;
    npcSaving.add(key);
    saveNpcs(k);
  });
}
function saveNpcs(k) {
  const A = game.areas[k];
  if (!A || !isDM()) return;
  const ids = Object.entries(A.tg || {}).filter(([id, v]) => !v.done && game.tokens[id] && game.tokens[id].kind === 'npc').map(([id]) => id);
  if (!ids.length) return;
  const upd = {}, parts = [];
  ids.forEach((id) => {
    const t = game.tokens[id], cond = t.cond || [], bonus = +((t.sv || {})[A.abil]) || 0;
    let ok, total, note = '';
    if ((A.abil === 'str' || A.abil === 'dex') && ((t.hpMax && (+t.hp || 0) <= 0) || cond.some((x) => AUTO_FAIL_T.includes(x)))) { ok = false; total = '—'; note = ' (автопровал)'; }
    else {
      const mode = (econ(id).dodge && A.abil === 'dex' ? 1 : 0) - (cond.includes('restrained') && A.abil === 'dex' ? 1 : 0);
      const d1 = die(20), d2 = die(20), nat = mode > 0 ? Math.max(d1, d2) : mode < 0 ? Math.min(d1, d2) : d1;
      total = nat + bonus; ok = total >= A.dc;
      if (mode) note = mode > 0 ? ` (преим. ${d1}, ${d2})` : ` (помеха ${d1}, ${d2})`;
    }
    const dmg = saveDmg(A, ok, false), hp = Math.max(0, (+t.hp || 0) - dmg);
    upd[`areas/${k}/tg/${id}`] = { done: true, ok, roll: total, dmg };
    if (dmg) upd[`tokens/${id}/hp`] = hp;
    parts.push(`${t.name} ${total}${note} ${ok ? '✔' : '✘'}${dmg ? ` −${dmg}` : ''}${dmg && hp === 0 ? ' ☠' : ''}`);
  });
  R.update(ref(gpath()), upd).catch((err) => app.toast(`Ошибка: ${esc(err.code || err.message)}`));
  addLog({ kind: 'save', who: '', txt: `${A.n} — спасброски ${AB_N[A.abil]} (СЛ ${A.dc}): ${parts.join('; ')}` });
  finishArea(k, ids);
}
// Повторное срабатывание (Духовные стражи, Лунный луч…): новый бросок урона и спасброски для тех, кто сейчас в области
function areaAgain(k) {
  const A = game.areas[k];
  if (!A) return;
  const r = A.expr ? app.rollFormula(A.expr, A.n) : null, ids = areaTokens(A);
  if (!ids.length) { app.toast('В области никого нет'); return; }
  R.update(ref(gpath(`areas/${k}`)), { dmg: r ? r.total : 0, dmgDetail: r ? r.detail : '', tg: Object.fromEntries(ids.map((id) => [id, { done: false }])) });
  addLog({ kind: 'area', who: A.who, txt: `⟳ ${A.n}${r ? ` — ${r.total} ${A.dtype || ''}` : ''} · цели: ${ids.map((id) => game.tokens[id].name).join(', ')}`, detail: r ? r.detail : '' });
}
const notifiedSaves = new Set();
function notifyAreas() {
  if (!game || !user) return;
  Object.entries(game.areas || {}).forEach(([k, A]) => Object.entries(A.tg || {}).forEach(([id, v]) => {
    const t = game.tokens[id], key = `${k}:${id}:${A.dmgDetail || ''}`;
    if (v.done || !t || notifiedSaves.has(key)) return;
    const mine = t.kind === 'pc' ? t.owner === user.uid : isDM();
    if (!mine) return;
    notifiedSaves.add(key);
    if (t.kind === 'pc') app.toast(`✨ ${esc(A.n)}: спасбросок ${AB_N[A.abil]} СЛ ${A.dc} — бросьте в панели «Спасброски»`, 'crit');
  }));
}
function renderSaves() {
  const box = $('#tblSaves');
  if (!box) return;
  const dm = isDM(), rows = [];
  Object.entries(game.areas || {}).sort((a, b) => (a[1].t || 0) - (b[1].t || 0)).forEach(([k, A]) => {
    const pend = Object.entries(A.tg || {}).filter(([id, v]) => !v.done && game.tokens[id]);
    const mine = pend.filter(([id]) => game.tokens[id].kind === 'pc' && game.tokens[id].owner === user.uid);
    const own = dm || A.by === user.uid;
    let html = `<div class="sv-area"><div class="row between"><b style="color:${A.color}">${esc(A.n)}</b><span>
      ${own && A.keep && A.abil ? `<button class="ghost" data-tbl="areaAgain" data-k="${k}" title="Сработать снова: новый урон и спасброски">⟳</button>` : ''}
      ${own ? `<button class="ghost" data-tbl="areaDel" data-k="${k}" title="Убрать с поля">✕</button>` : ''}</span></div>`;
    if (A.abil) html += `<div class="muted small">Спасбросок ${AB_N[A.abil]} СЛ ${A.dc}${A.dmg ? ` · ${A.dmg} ${esc(A.dtype || 'урона')}${A.half ? ', половина при успехе' : ''}` : ''}</div>`;
    mine.forEach(([id]) => { html += `<div class="row between mt"><span>${esc(game.tokens[id].name)}</span><button class="primary" data-tbl="saveMine" data-k="${k}" data-id="${id}">🎲 Спасбросок</button></div>`; });
    const waiting = pend.filter(([id]) => !mine.some(([x]) => x === id));
    if (waiting.length) html += `<div class="muted small mt">Ждём: ${waiting.map(([id]) => esc(game.tokens[id].name)).join(', ')}</div>`;
    rows.push(html + '</div>');
  });
  box.hidden = !rows.length;
  box.innerHTML = `<h3>Области и спасброски</h3>${rows.join('')}`;
}
function renderCastBar() {
  const bar = $('#tblCastBar');
  if (!bar) return;
  bar.hidden = !cast;
  if (cast) bar.innerHTML = `✨ <b>${esc(cast.info.n)}</b>: ${cast.area.shape === 'target' ? 'нажмите на цель' : 'наведите область и нажмите на поле'}<button data-tbl="castOff">Отмена</button>`;
}
// Линейка: расстояние по клеткам (диагональ — 5 фт)
function drawRuler() {
  const cv = $('#tblRange'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  if (!ruler) return;
  const c = (v) => v * CELL + CELL / 2;
  g.save(); g.strokeStyle = '#f0c76a'; g.lineWidth = 3; g.setLineDash([8, 5]);
  g.beginPath(); g.moveTo(c(ruler.x0), c(ruler.y0)); g.lineTo(c(ruler.x1), c(ruler.y1)); g.stroke();
  g.fillStyle = 'rgba(240,199,106,.35)'; [[ruler.x0, ruler.y0], [ruler.x1, ruler.y1]].forEach(([x, y]) => g.fillRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4));
  g.restore();
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
  if (aim && (!inFight() || !game.tokens[aim.from])) aim = null;
  if (aim) $('#tblBoard').dataset.tool = 'aim';
  if (cast) $('#tblBoard').dataset.tool = 'aim';
  if (!drag) drawAimRange();
  drawAreas();
  renderTokens();
  renderTurn();
  renderInit();
  renderSide();
  renderMembers();
  renderLog();
  renderSaves();
  renderCastBar();
}
// Подсветка дальности выбранной атаки: досягаемость, обычная и максимальная дистанция
function drawAimRange() {
  const cv = $('#tblRange'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const from = aim && game.tokens[aim.from];
  if (!from) return;
  const r = aim.atk.rng;
  for (let x = 0; x < W(); x++) for (let y = 0; y < H(); y++) {
    const d = distFt(from, { x, y, size: 1 });
    if (!d) continue;
    const c = r.reach && d <= r.reach ? 'rgba(201,74,61,.25)' : r.near && d <= r.near ? 'rgba(91,143,201,.16)' : r.near && d <= r.far ? 'rgba(212,166,74,.10)' : null;
    if (c) { g.fillStyle = c; g.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2); }
  }
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
  $('#tblTools').innerHTML = `<div class="seg">${t('move', '✋ Двигать', 'Перетаскивайте токены, по пустому месту — прокрутка')}${t('ruler', '📏 Линейка', 'Протяните, чтобы измерить расстояние')}
    ${isDM() ? t('wall', '▮ Стена') + t('difficult', '▦ Трудная') + t('water', '≈ Вода') + t('erase', '⌫ Ластик') + t('enemy', '＋ Враг', 'Нажмите на клетку, чтобы поставить существо')
      + t('area', '◯ Область', 'Область со спасброском: дыхание, ловушка… Конус и линия — от выделенного существа') : ''}
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
    ${e.atk > 0 ? `<div class="small mt">Дополнительная атака: осталось атак — <b>${e.atk}</b></div>` : ''}
    ${aim && aim.from === id ? `<div class="aim-bar mt">🎯 Выберите цель для «${esc(aim.atk.n)}»${aim.left > 1 ? ` · атак: ${aim.left}` : ''}<button data-tbl="aimOff">${aim.way === 'action' && aim.left < ((app.summary(aim.charId) || {}).atks || 1) ? 'Готово' : 'Отмена'}</button></div>`
      : !dm && !mv.incap && ((turn && (e.atk > 0 || !e.a || !e.b)) || !e.r) ? `<div class="row gap wrap mt"><button class="primary" data-tbl="attack" data-id="${id}">⚔ Атака${e.atk > 0 ? ` (ещё ${e.atk})` : !turn ? ' реакцией' : ''}</button>
        ${!(e.atk > 0) ? `<button class="primary" data-tbl="spell" data-id="${id}">✨ Заклинание</button>` : ''}</div>` : ''}
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
      <button data-tbl="npcCopy">⧉ Копия</button><button data-tbl="npcInit">🎲 В инициативу</button></div>
      <div class="muted small mt">Бонусы спасбросков (бросаются автоматически):</div>
      <div class="sv-grid">${Object.entries(AB_N).map(([k]) => `<label>${{ str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' }[k]}<input type="number" data-tbl-sv="${k}" value="${+((t.sv || {})[k]) || 0}"></label>`).join('')}</div>` : ''}
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
  if (toolBtn && toolBtn.dataset.tool === 'area') { dmAreaDialog(); return; }
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
    } else if (a === 'startFight') { await R.update(ref(gpath()), { 'init/active': true, 'init/round': 1, 'init/turn': 0, econ: null }); addLog({ kind: 'sys', txt: '⚔ Бой начался · раунд 1' }); }
    else if (a === 'next' || a === 'endTurn') nextTurn();
    else if (a === 'endFight') { if (app.confirm('Закончить бой и очистить инициативу?')) { await R.update(ref(gpath()), { init: null, econ: null }); addLog({ kind: 'sys', txt: 'Бой окончен' }); } }
    else if (a === 'attack') openAttack(b.dataset.id);
    else if (a === 'aimOff') { aim = null; hint(''); renderAll(); }
    else if (a === 'spell') openCast(b.dataset.id);
    else if (a === 'castOff') cancelCast();
    else if (a === 'saveMine') saveMine(b.dataset.k, b.dataset.id);
    else if (a === 'areaAgain') areaAgain(b.dataset.k);
    else if (a === 'areaDel') await R.remove(ref(gpath(`areas/${b.dataset.k}`)));
    else if (a === 'logClear') { if (app.confirm('Очистить журнал для всех?')) await R.remove(ref(gpath('log'))); }
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
  if (e.target.matches('[data-tbl-sv]') && game && selId) R.update(ref(gpath(`tokens/${selId}/sv`)), { [e.target.dataset.tblSv]: +e.target.value || 0 });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (cast) cancelCast();
  else if (aim) { aim = null; hint(''); renderAll(); }
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
