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
let freeMove = false; // мастер: двигать без ограничений (толчок, перенос тела)
let bgImg = null, bgSrc = ''; // карта-подложка
let fogVis = null, fogPreview = false, seenTimer = null; // туман войны: видимые клетки, «вид игроков» у мастера
let aim = null; // выбор цели атаки: { from, charId, atk, way, left }
let cast = null; // размещение области: { area, info, caster, charId, slotKey, dm }
let ruler = null; // линейка: { x0, y0, x1, y1 } — клетки
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
  game = { id: gid, code, meta: null, members: {}, tokens: {}, map: {}, init: null, econ: {}, log: {}, areas: {}, reveal: {}, seen: {}, lights: {}, doors: {}, effects: {}, xp: {}, cs: {} };
  ls.set(GAME_KEY, JSON.stringify({ id: gid, code, uid: user.uid }));
  const lost = (e) => { if (String(e && e.code).includes('PERMISSION')) { app.toast('Нет доступа к игре — возможно, вас исключили'); leaveLocal(); renderAll(); } };
  const on = (p, fn) => unsubs.push(R.onValue(ref(gpath(p)), (s) => { if (game && game.id === gid) { fn(s.val()); renderAll(); } }, lost));
  on('meta', (v) => { if (!v) { app.toast('Игра завершена мастером'); leaveLocal(); } else { game.meta = v; drawTerrain(); } });
  on('bgimg', (v) => { loadBg(v && v.data); });
  on('reveal', (v) => { game.reveal = v || {}; });
  on('seen', (v) => { game.seen = v || {}; });
  on('lights', (v) => { game.lights = v || {}; drawTerrain(); });
  on('doors', (v) => { game.doors = v || {}; drawTerrain(); });
  on('effects', (v) => { game.effects = v || {}; syncEffects(); });
  on('xp', (v) => { game.xp = v || {}; });
  on('scenes', (v) => { game.scenes = v || {}; });
  on('rest', (v) => { game.rest = v; handleRest(); });
  on(`xpAward/${user.uid}`, (v) => { game.award = v; applyXp(); });
  on('members', (v) => { game.members = v || {}; syncEffects(); applyXp(); handleRest(); });
  on('tokens', (v) => { game.tokens = v || {}; cleanupInit(); syncEffects(); awardKills(); });
  on('map', (v) => { game.map = v || {}; drawTerrain(); });
  on('init', (v) => { game.init = v; checkMyTurn(); checkNpcTurn(); cleanupInit(); syncEffects(); });
  on('econ', (v) => { game.econ = v || {}; });
  on('cs', (v) => { game.cs = v || {}; csCheck(); notifyCs(); });
  on('log', (v) => { game.log = v || {}; applyLog(); notifyLog(); fxLog(); });
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
  game = null; selId = null; aim = null; cast = null; ruler = null; bgImg = null; bgSrc = '';
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
    const s = app.summary(m.charId), comps = app.companions(m.charId);
    if (!s || !game) return;
    const key = JSON.stringify([s, comps]);
    if (key === lastSent) return;
    lastSent = key;
    const { img, ...char } = s;
    const upd = { [`members/${user.uid}/char`]: char };
    if (game.tokens[`pc_${user.uid}`]) {
      Object.assign(upd, { [`tokens/pc_${user.uid}/name`]: s.name, [`tokens/pc_${user.uid}/hp`]: s.hp, [`tokens/pc_${user.uid}/hpMax`]: s.hpMax,
        [`tokens/pc_${user.uid}/temp`]: s.temp, [`tokens/pc_${user.uid}/ac`]: s.ac, [`tokens/pc_${user.uid}/cond`]: s.cond, [`tokens/pc_${user.uid}/speed`]: s.speed,
        [`tokens/pc_${user.uid}/size`]: SIZE_N[s.size] || 1, [`tokens/pc_${user.uid}/init`]: s.init,
        [`tokens/pc_${user.uid}/dsS`]: s.dsS || 0, [`tokens/pc_${user.uid}/dsF`]: s.dsF || 0, [`tokens/pc_${user.uid}/dv`]: s.dv || 0, [`tokens/pc_${user.uid}/img`]: img || null });
    }
    // Спутники на поле: хиты, КД и имя — из карточки в листе; убранный из листа спутник уходит и с поля
    Object.entries(game.tokens).forEach(([id, t]) => {
      if (!t.comp || t.owner !== user.uid) return;
      const p = comps.find((x) => x.id === t.comp);
      if (!p) { upd[`tokens/${id}`] = null; return; }
      Object.assign(upd, { [`tokens/${id}/hp`]: p.hp, [`tokens/${id}/hpMax`]: p.hpMax, [`tokens/${id}/ac`]: p.ac, [`tokens/${id}/name`]: p.n, [`tokens/${id}/speed`]: parseInt(p.speed) || 30 },
        Object.fromEntries(Object.entries(compStats(p)).map(([k, v]) => [`tokens/${id}/${k}`, v])));
    });
    R.update(ref(gpath()), upd).catch(() => {});
  }, 300);
}
function placeMyToken(x, y) {
  const m = me(), s = m && app.summary(m.charId);
  if (!s) { app.toast('Персонаж не найден на этом устройстве'); return; }
  R.set(ref(gpath(`tokens/pc_${user.uid}`)), { kind: 'pc', owner: user.uid, name: s.name, x, y, size: SIZE_N[s.size] || 1, color: colorOf(user.uid),
    hp: s.hp, hpMax: s.hpMax, temp: s.temp, ac: s.ac, cond: s.cond, speed: s.speed, init: s.init, dv: s.dv || 0, ...(s.img ? { img: s.img } : {}) });
  lastSent = '';
}
// Спутник из листа на поле: отдельный токен игрока pc_<uid>_<id>; ходит в ход хозяина, хиты общие с карточкой
let compPlace = null;
function placeCompanion(x, y) {
  const m = me(), p = m && app.companions(m.charId).find((c) => c.id === compPlace);
  compPlace = null;
  if (!p) return;
  R.set(ref(gpath(`tokens/pc_${user.uid}_${p.id}`)), { kind: 'pc', comp: p.id, owner: user.uid, name: p.n, x, y, size: 1, color: colorOf(user.uid),
    hp: p.hp, hpMax: p.hpMax, ac: p.ac, speed: parseInt(p.speed) || 30, cond: [], ...compStats(p) }).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
}
// Портрет: квадрат 160×160 из середины картинки
function portraitFrom(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const S = 160, cv = document.createElement('canvas'), k = Math.min(img.naturalWidth, img.naturalHeight);
      cv.width = cv.height = S;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - k) / 2, (img.naturalHeight - k) / 2, k, k, 0, 0, S, S);
      URL.revokeObjectURL(url);
      ok(cv.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('не картинка')); };
    img.src = url;
  });
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
  ['#tblTerrain', '#tblAreas', '#tblRange', '#tblFog', '#tblFxCv'].forEach((s) => { const cv = $(s); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } });
  $('#tblZoom').textContent = Math.round(zoom * 100) + '%';
}
/* ---------- Карта-подложка ---------- */
// Картинка хранится в games/{id}/bgimg/data (уменьшенный JPEG в base64 или ссылка), настройки — meta.bg:
// w — ширина карты в клетках, ox/oy — сдвиг в пикселях поля, op — непрозрачность, grid — показывать сетку

const BGDEF = { w: 0, ox: 0, oy: 0, op: 1, grid: true };
const bgSet = () => ({ ...BGDEF, ...((game && game.meta && game.meta.bg) || {}) });
function loadBg(src) {
  if (!src) { bgImg = null; bgSrc = ''; drawTerrain(); return; }
  if (src === bgSrc) return;
  bgSrc = src;
  const img = new Image();
  img.onload = () => { if (bgSrc === src) { bgImg = img; drawTerrain(); } };
  img.onerror = () => app.toast('Не удалось загрузить карту-подложку');
  img.src = src;
}
function drawTerrain() {
  if (!game) return;
  const cv = $('#tblTerrain'), g = cv.getContext('2d'), bg = bgSet();
  layoutBoard();
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#1f1b16';
  g.fillRect(0, 0, cv.width, cv.height);
  if (bgImg) {
    const w = (bg.w || W()) * CELL, h = (w * bgImg.naturalHeight) / bgImg.naturalWidth;
    g.globalAlpha = bg.op;
    g.drawImage(bgImg, bg.ox, bg.oy, w, h);
    g.globalAlpha = 1;
  }
  // Поверх карты местность полупрозрачная — чтобы рисунок оставался виден
  Object.entries(game.map || {}).forEach(([k, type]) => {
    const [x, y] = k.split('_').map(Number), T = TERRAIN[type];
    if (!T) return;
    g.fillStyle = bgImg && type === 'wall' ? 'rgba(40,30,22,.55)' : T.color;
    g.fillRect(x * CELL, y * CELL, CELL, CELL);
    if (bgImg && type === 'wall') { g.strokeStyle = 'rgba(255,190,120,.45)'; g.strokeRect(x * CELL + 1.5, y * CELL + 1.5, CELL - 3, CELL - 3); }
    if (type === 'difficult') { // штриховка
      g.strokeStyle = 'rgba(200,150,70,.5)';
      g.beginPath();
      for (let i = -CELL; i < CELL; i += 10) { g.moveTo(x * CELL + i, y * CELL + CELL); g.lineTo(x * CELL + i + CELL, y * CELL); }
      g.stroke();
    }
  });
  // Двери: закрытая — створка поперёк клетки, открытая — откинута к краю; запертая — с замком
  Object.entries(game.doors || {}).forEach(([k, d]) => {
    const [x, y] = k.split('_').map(Number), cx = x * CELL, cy = y * CELL;
    g.save();
    g.fillStyle = d.o ? 'rgba(120,80,40,.35)' : '#7a5230';
    g.strokeStyle = '#d4a64a'; g.lineWidth = 2;
    if (d.o) { g.fillRect(cx + 2, cy + 2, 7, CELL - 4); g.strokeRect(cx + 2, cy + 2, 7, CELL - 4); }
    else { g.fillRect(cx + 3, cy + CELL / 2 - 7, CELL - 6, 14); g.strokeRect(cx + 3, cy + CELL / 2 - 7, CELL - 6, 14); g.fillStyle = '#f0c76a'; g.fillRect(cx + CELL - 12, cy + CELL / 2 - 2, 4, 4); }
    if (d.l) { g.font = '13px system-ui'; g.fillText('🔒', cx + CELL / 2 - 7, cy + 13); }
    g.restore();
  });
  // Источники света видит только мастер
  if (isDM()) Object.values(game.lights || {}).forEach((L) => { g.font = '18px system-ui'; g.fillText('💡', L.x * CELL + 10, L.y * CELL + 27); });
  if (!bgImg || bg.grid) {
    g.strokeStyle = bgImg ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.07)';
    g.beginPath();
    for (let x = 0; x <= W(); x++) { g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, cv.height); }
    for (let y = 0; y <= H(); y++) { g.moveTo(0, y * CELL + 0.5); g.lineTo(cv.width, y * CELL + 0.5); }
    g.stroke();
  }
}
// Уменьшить картинку до 2400 пикселей по большей стороне и сжать в JPEG — чтобы быстро грузилась у всех
function shrinkImage(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      ok({ data: cv.toDataURL('image/jpeg', 0.82), w: cv.width, h: cv.height });
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('не картинка')); };
    img.src = url;
  });
}
function mapDialog() {
  const bg = bgSet(), fog = fogSet();
  app.openModal(`<h2>🗺 Карта и туман войны</h2>
    <h3>Карта-подложка</h3>
    <div class="form-grid"><label style="grid-column:1/-1">Картинка с компьютера<input type="file" id="mFile" accept="image/*"></label>
      <label style="grid-column:1/-1">…или ссылка на картинку<input id="mUrl" placeholder="https://…/map.jpg" value="${esc(bgSrc.startsWith('data:') ? '' : bgSrc)}"></label>
      <label>Ширина карты, клеток<input type="number" id="mW" min="1" value="${bg.w || W()}"></label>
      <label>Непрозрачность<input type="range" id="mOp" min="0.2" max="1" step="0.05" value="${bg.op}"></label>
      <label>Сдвиг вправо, px<input type="number" id="mOx" value="${bg.ox}"></label><label>Сдвиг вниз, px<input type="number" id="mOy" value="${bg.oy}"></label>
      <label class="check"><input type="checkbox" id="mGrid" ${bg.grid ? 'checked' : ''}> Сетка поверх карты</label>
      <label class="check"><input type="checkbox" id="mFit" checked> Подогнать поле под карту</label>
      <label>Поле, клеток в ширину<input type="number" id="mBw" min="5" max="80" value="${W()}"></label><label>…в высоту<input type="number" id="mBh" min="5" max="80" value="${H()}"></label></div>
    <p class="muted small">Подгонка: посчитайте, сколько клеток по 5 фт помещается на карте в ширину, и укажите это число. Сдвигом совместите линии сетки с картой. Стены рисуйте по стенам карты — они закрывают обзор в тумане.</p>
    ${bgSrc ? '<button class="danger" id="mDel">Убрать карту</button>' : ''}
    <h3 class="mt">Туман войны</h3>
    <div class="form-grid"><label>Режим<select id="fMode">${[['off', 'выключен'], ['vision', 'обзор персонажей + открытое мастером'], ['manual', 'только открытое мастером']].map(([v, n]) => `<option value="${v}" ${fog.mode === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Дальность обзора, фт<input type="number" id="fSight" step="5" min="5" value="${fog.sight}"></label>
      <label>Освещение<select id="fAmb">${[['bright', 'яркий свет (день)'], ['dim', 'тусклый (сумерки)'], ['dark', 'темнота (подземелье, ночь)']].map(([v, n]) => `<option value="${v}" ${(fog.amb || 'bright') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
    <p class="muted small">Обзор: игроки видят клетки в пределах дальности от своих персонажей и союзников, стены его перекрывают. Увиденное остаётся на карте приглушённым, но существ там не видно. Кисти «👁 Открыть» и «🌫 Скрыть» в инструментах открывают и закрывают клетки вручную.</p>
    <button id="fReset">Забыть разведанное игроками</button>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="mOk">Сохранить</button></div>`);
  $('#mOk').onclick = async () => {
    const upd = { 'meta/fog': { mode: $('#fMode').value, sight: Math.max(5, +$('#fSight').value || 60), amb: $('#fAmb').value } };
    let iw = 0, ih = 0;
    const file = $('#mFile').files[0], url = $('#mUrl').value.trim();
    try {
      if (file) {
        const r = await shrinkImage(file);
        if (r.data.length > 6e6) { app.toast('Картинка слишком большая даже после сжатия — возьмите поменьше'); return; }
        upd.bgimg = { data: r.data }; iw = r.w; ih = r.h;
      } else if (url && url !== bgSrc) upd.bgimg = { data: url };
    } catch (e) { app.toast('Не удалось прочитать картинку'); return; }
    const mw = Math.max(1, +$('#mW').value || W());
    upd['meta/bg'] = { w: mw, ox: +$('#mOx').value || 0, oy: +$('#mOy').value || 0, op: +$('#mOp').value || 1, grid: $('#mGrid').checked };
    // Размер поля: вручную или по пропорциям карты
    let bw = Math.max(5, Math.min(80, +$('#mBw').value || W())), bh = Math.max(5, Math.min(80, +$('#mBh').value || H()));
    const ratio = iw ? ih / iw : bgImg ? bgImg.naturalHeight / bgImg.naturalWidth : 0;
    if ($('#mFit').checked && ratio) { bw = Math.min(80, mw); bh = Math.max(5, Math.min(80, Math.ceil(mw * ratio))); }
    upd['meta/w'] = bw; upd['meta/h'] = bh;
    app.closeModal();
    await R.update(ref(gpath()), upd).catch((err) => app.toast(`Не удалось сохранить: ${esc(err.code || err.message)}`));
  };
  if ($('#mDel')) $('#mDel').onclick = async () => { app.closeModal(); await R.update(ref(gpath()), { bgimg: null, 'meta/bg': null }); };
  $('#fReset').onclick = async () => { if (app.confirm('Забыть всё, что игроки разведали?')) { await R.remove(ref(gpath('seen'))); app.toast('Разведанное сброшено'); } };
}

/* ---------- Туман войны ---------- */
// meta.fog: { mode: off | vision | manual, sight — дальность обзора, фт }. games/{id}/reveal — клетки, открытые мастером;
// games/{id}/seen — клетки, которые персонажи уже видели (приглушены, существа там скрыты)

const fogSet = () => ({ mode: 'off', sight: 60, ...((game && game.meta && game.meta.fog) || {}) });
const fogOn = () => fogSet().mode !== 'off';
// Видимость клетки из точки: луч не должен проходить через стену (сама стена видна)
function lineClear(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, n = Math.ceil(Math.hypot(dx, dy) * 3);
  for (let i = 1; i < n; i++) {
    const cx = Math.floor(x0 + (dx * i) / n), cy = Math.floor(y0 + (dy * i) / n);
    if (cx === Math.floor(x1) && cy === Math.floor(y1)) return true;
    if ((game.map || {})[`${cx}_${cy}`] === 'wall' || doorShut(`${cx}_${cy}`)) return false;
  }
  return true;
}
// Освещённость клеток: 2 — яркий свет, 1 — тусклый, 0 — темнота. Общий свет (meta.fog.amb) + источники
// на поле (lights) и в руках у существ (token.lt: b — яркий радиус, d — ещё столько же тусклого); стены и двери свет не пропускают
const AMB = { bright: 2, dim: 1, dark: 0 };
function lightMap() {
  const base = AMB[fogSet().amb || 'bright'] ?? 2, lv = new Map();
  if (base >= 2) return { at: () => 2 };
  const srcs = [...Object.values(game.lights || {}).map((L) => ({ x: L.x + 0.5, y: L.y + 0.5, b: +L.b || 20, d: +L.d || 20 })),
    ...Object.values(game.tokens || {}).filter((t) => t.lt && !(t.hidden && !isDM())).map((t) => { const s = t.size || 1; return { x: t.x + s / 2, y: t.y + s / 2, b: +t.lt.b || 0, d: +t.lt.d || 0 }; })];
  srcs.forEach((L) => {
    const rb = L.b / 5, rd = (L.b + L.d) / 5;
    for (let x = Math.max(0, Math.floor(L.x - rd - 1)); x < Math.min(W(), Math.ceil(L.x + rd + 1)); x++)
      for (let y = Math.max(0, Math.floor(L.y - rd - 1)); y < Math.min(H(), Math.ceil(L.y + rd + 1)); y++) {
        const dd = Math.hypot(x + 0.5 - L.x, y + 0.5 - L.y), k = `${x}_${y}`;
        if (dd > rd + 0.5 || (lv.get(k) || 0) >= 2 || !lineClear(L.x, L.y, x + 0.5, y + 0.5)) continue;
        lv.set(k, Math.max(lv.get(k) || 0, dd <= rb + 0.5 ? 2 : 1));
      }
  });
  return { at: (k) => Math.max(base, lv.get(k) || 0) };
}
// Что видит отряд: клетки в дальности обзора персонажей и союзников, где достаточно света (или в пределах
// тёмного зрения), + открытые мастером. dark — клетки, видимые только тёмным зрением; dim — в тусклом свете
let fogDim = new Set(), fogDark = new Set();
function computeVision() {
  const f = fogSet(), vis = new Set(Object.keys(game.reveal || {}));
  fogDim = new Set(); fogDark = new Set();
  if (f.mode === 'vision') {
    const R2 = f.sight / 5, L = lightMap();
    Object.values(game.tokens || {}).filter((t) => team(t) === 'pc' && !isDown(t)).forEach((t) => {
      const s = t.size || 1, ox = t.x + s / 2, oy = t.y + s / 2, dv = (+t.dv || 0) / 5;
      for (let x = Math.max(0, Math.floor(ox - R2 - 1)); x < Math.min(W(), Math.ceil(ox + R2 + 1)); x++)
        for (let y = Math.max(0, Math.floor(oy - R2 - 1)); y < Math.min(H(), Math.ceil(oy + R2 + 1)); y++) {
          const k = `${x}_${y}`, inside = x >= t.x && x < t.x + s && y >= t.y && y < t.y + s, dd = Math.hypot(x + 0.5 - ox, y + 0.5 - oy);
          if (!inside && (dd > R2 + 0.5 || !lineClear(ox, oy, x + 0.5, y + 0.5))) continue;
          const lit = L.at(k);
          if (lit >= 1 || inside || dd <= dv + 0.5) {
            if (!vis.has(k) || fogDark.has(k) || fogDim.has(k)) {
              // Тусклый свет и тёмное зрение — клетка видна, но приглушена (у кого лучше видно — того и берём)
              const kind = lit >= 2 || inside ? 2 : lit === 1 ? 1 : 0;
              const prev = vis.has(k) ? (fogDark.has(k) ? 0 : fogDim.has(k) ? 1 : 2) : -1;
              if (kind > prev) { fogDim.delete(k); fogDark.delete(k); if (kind === 1) fogDim.add(k); if (kind === 0) fogDark.add(k); }
            }
            vis.add(k);
          }
        }
    });
  }
  return vis;
}
// Существо скрыто туманом от игрока: ни одна его клетка сейчас не видна (свои и союзники видны всегда)
function fogHides(t) {
  if (!fogVis || (isDM() && !fogPreview) || team(t) === 'pc') return false;
  const s = t.size || 1;
  for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) if (fogVis.has(`${t.x + dx}_${t.y + dy}`)) return false;
  return true;
}
function drawFog() {
  const cv = $('#tblFog'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  fogVis = fogOn() ? computeVision() : null;
  if (!fogVis) return;
  const player = !isDM() || fogPreview, seen = game.seen || {};
  for (let x = 0; x < W(); x++) for (let y = 0; y < H(); y++) {
    const k = `${x}_${y}`;
    if (fogVis.has(k)) {
      if (fogDim.has(k)) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x * CELL, y * CELL, CELL, CELL); }
      else if (fogDark.has(k)) { g.fillStyle = 'rgba(14,16,30,.48)'; g.fillRect(x * CELL, y * CELL, CELL, CELL); }
      continue;
    }
    g.fillStyle = player ? (seen[k] ? 'rgba(10,8,6,.62)' : '#0a0806') : seen[k] ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.42)';
    g.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  // Игрок запоминает увиденное — общая разведка отряда
  if (!isDM() && fogSet().mode === 'vision') {
    const fresh = [...fogVis].filter((k) => !seen[k]);
    if (fresh.length) { clearTimeout(seenTimer); seenTimer = setTimeout(() => R.update(ref(gpath('seen')), Object.fromEntries(fresh.map((k) => [k, 1]))).catch(() => {}), 400); }
  }
}
// Клетки, занятые другими существами: сквозь союзника, недееспособного или существо на 2+ размера больше/меньше пройти можно
// (это труднопроходимая местность), сквозь врага — нельзя. Закончить перемещение в занятой клетке нельзя.
function occupancy(moverId) {
  const mv = game.tokens[moverId], occ = new Map();
  Object.entries(game.tokens || {}).forEach(([id, t]) => {
    if (id === moverId || (t.hidden && !isDM())) return;
    const s = t.size || 1, incap = (t.hpMax && (t.hp || 0) <= 0) || (t.cond || []).some((k) => INCAP.includes(k));
    const pass = !hostile(t, mv) || incap || Math.abs(s - (mv.size || 1)) >= 2;
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
      if ((T && T.block) || o === 'block' || doorShut(k)) continue;
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
    if ((t.hidden && !isDM()) || fogHides(t)) return;
    seen.add(id);
    let el = box.querySelector(`[data-tok="${id}"]`);
    if (!el) { el = document.createElement('div'); el.className = 'tok'; el.dataset.tok = id; box.appendChild(el); }
    const s = t.size || 1, pct = Math.max(0, Math.min(1, (t.hp || 0) / (t.hpMax || 1)));
    const showNums = t.kind === 'pc' || isDM();
    if (!(drag && drag.kind === 'token' && drag.id === id)) { el.style.left = t.x * CELL + 'px'; el.style.top = t.y * CELL + 'px'; }
    el.style.width = el.style.height = s * CELL + 'px';
    el.style.setProperty('--tc', t.kind === 'npc' ? SIDE_COLOR[t.side || 'enemy'] : t.color || '#d4a64a');
    const down = isDown(t), dead = down && isDead(t), label = down ? downLabel(t) : t.name;
    el.className = `tok ${t.kind} side-${team(t)} ${canMove(t) ? 'mine' : ''} ${selId === id ? 'sel' : ''} ${cur && cur.tokenId === id ? 'turn' : ''} ${t.hidden ? 'hid' : ''} ${down ? 'down' : ''} ${dead ? 'dead' : ''}`;
    const ec = inFight() ? econ(id) : {};
    el.title = `${label}${showNums ? ` · ${t.hp}/${t.hpMax} хитов${t.ac ? ` · КД ${t.ac}` : ''}` : ''}${(t.cond || []).length ? ` · ${t.cond.map(condName).join(', ')}` : ''}${ec.dodge ? ' · уклоняется' : ''}${ec.dis ? ' · отходит' : ''}`;
    const html = `${t.img && !dead ? `<div class="tok-face img" style="background-image:url('${t.img}')"></div>` : `<div class="tok-face">${dead ? '☠' : esc((t.name || '?').trim().slice(0, 2))}</div>`}
      ${t.hpMax ? `<div class="tok-hp"><div style="width:${pct * 100}%;background:${pct > .5 ? '#5a9e5a' : pct > .25 ? '#d4a64a' : '#c94a3d'}"></div></div>` : ''}
      <div class="tok-name">${esc(label || '')}${fxOf(id).map(([, f]) => f.ic || '').join('').slice(0, 6)}${(t.cond || []).length ? ` <span class="tok-cond">●${t.cond.length}</span>` : ''}</div>`;
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
  if (tool === 'placeComp') { placeCompanion(p.x, p.y); tool = 'move'; renderTools(); return; }
  // Размещение области: нажатие фиксирует её; для заклинания на одну цель — нажатие на существо
  if (cast) {
    if (cast.area.shape === 'target') {
      if (!tokEl) return;
      const id = tokEl.dataset.tok, src = cast.caster && game.tokens[cast.caster];
      if (cast.area.tgts) { // несколько целей: нажатие добавляет или убирает
        const L = cast.area.tgts;
        if (L.includes(id)) L.splice(L.indexOf(id), 1);
        else if (src && cast.range && distFt(src, game.tokens[id]) > cast.range) app.toast(`Слишком далеко: дистанция ${cast.range} фт`);
        else if (L.length >= cast.info.nT) app.toast(`Не больше ${cast.info.nT} целей`);
        else L.push(id);
        drawAreas(); renderCastBar();
        if (L.length >= cast.info.nT) confirmCast();
        return;
      }
      cast.area.tgt = id; confirmCast();
      return;
    }
    castFollow(p.px / CELL, p.py / CELL);
    confirmCast();
    return;
  }
  // Выбор цели атаки: нажатие на чужой токен — атака; по пустому месту и своему токену — как обычно
  if (aim && tokEl && tokEl.dataset.tok !== aim.from) { attackTarget(tokEl.dataset.tok); return; }
  // Двери и свет: мастер ставит и убирает их кистью; дверь открывается нажатием инструментом «Двигать»
  const ck = `${p.x}_${p.y}`;
  if (tool === 'door' && isDM()) { R.update(ref(gpath('doors')), { [ck]: (game.doors || {})[ck] ? null : { o: 0 } }); return; }
  if (tool === 'light' && isDM()) {
    const lk = Object.keys(game.lights || {}).find((k) => game.lights[k].x === p.x && game.lights[k].y === p.y);
    if (lk) R.remove(ref(gpath(`lights/${lk}`))); else R.set(ref(gpath(`lights/${R.push(ref(gpath('lights'))).key}`)), { x: p.x, y: p.y, b: 20, d: 20 });
    return;
  }
  if (tool === 'move' && !tokEl && (game.doors || {})[ck]) { toggleDoor(ck, e.shiftKey); return; }
  if (TERRAIN[tool] || tool === 'erase' || tool === 'reveal' || tool === 'conceal') {
    drag = { kind: 'paint', pending: {}, root: tool === 'reveal' || tool === 'conceal' };
    paintAt(p);
  } else if (tool === 'ruler') {
    ruler = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    drag = { kind: 'ruler' };
    drawRuler();
  } else if (tokEl) {
    const id = tokEl.dataset.tok, t = game.tokens[id];
    selId = id; renderSide(); renderTokens();
    if (!t || !canMove(t)) return;
    // Принудительное перемещение (толчок, перенос тела) — только мастер: с Shift или в режиме «Свободно»
    const speed = speedOf(t), dm = isDM(), forced = dm && (e.shiftKey || freeMove);
    if (isDown(t) && !forced) { app.toast(isDead(t) ? 'Это труп. Мастер может сдвинуть его с Shift или в режиме «🔓 Свободно»' : 'Без сознания — не может двигаться'); return; }
    const dg = { kind: 'token', id, sx: t.x, sy: t.y, offX: p.px - t.x * CELL, offY: p.py - t.y * CELL, speed, moved: false, forced };
    if (inFight()) {
      // В бою каждый, и существа мастера тоже, ходит только в свой ход и не дальше оставшейся скорости
      // Спутник ходит в ход своего хозяина
      const turn = isTurnOf(id) || (!!t.comp && isTurnOf(`pc_${t.owner}`));
      if (!forced && !turn) { app.toast(dm ? 'Сейчас не его ход. Сдвинуть принудительно — с Shift или в режиме «🔓 Свободно»' : 'Сейчас не ваш ход — дождитесь своей очереди в инициативе'); return; }
      const mv = moveInfo(id), occ = occupancy(id), counted = turn && !forced;
      if (!forced && !mv.left) { app.toast(mv.speed ? `Скорость на этот ход потрачена${mv.canDash ? ' — можно сделать Рывок' : ''}` : 'Скорость 0 — не может перемещаться'); return; }
      Object.assign(dg, { fight: true, counted, occ, left: counted ? mv.left : Infinity,
        dist: reachMap(t.x, t.y, forced ? 9999 : mv.left + (mv.canDash ? mv.speed : 0), occ, mv.prone) });
      drawRange(dg.dist, counted ? mv.left : speed * 2, occ);
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
      if (cast.area.shape === 'target') { const tokEl = e.target.closest('[data-tok]'); if (!cast.area.tgts) cast.area.tgt = tokEl ? tokEl.dataset.tok : null; }
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
    else if (d == null) txt = drag.forced ? 'путь закрыт' : 'не хватает скорости';
    else if (!drag.counted) txt = `${d} фт`;
    else txt = d <= drag.left ? `${d} фт · останется ${drag.left - d}` : `${d} фт — не хватает ${d - drag.left} фт, нужен Рывок`;
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
    if (Object.keys(d.pending).length) R.update(ref(d.root ? gpath() : gpath('map')), d.pending).catch((err) => app.toast(`Не удалось сохранить карту: ${esc(err.code || err.message)}`));
  } else if (d.kind === 'token') {
    drawRange(null);
    const p = cellAt(e), t = game.tokens[d.id];
    $(`[data-tok="${d.id}"]`)?.classList.remove('dragging');
    if (!t || !d.moved) { renderTokens(); return; }
    const s = t.size || 1;
    const x = Math.max(0, Math.min(W() - s, Math.round((p.px - d.offX) / CELL))), y = Math.max(0, Math.min(H() - s, Math.round((p.py - d.offY) / CELL)));
    const T = TERRAIN[(game.map || {})[`${x}_${y}`]];
    if ((T && T.block) || doorShut(`${x}_${y}`)) { app.toast(T && T.block ? 'Там стена' : 'Дверь закрыта'); renderTokens(); return; }
    if (x === d.sx && y === d.sy) { renderTokens(); return; }
    const upd = { [`tokens/${d.id}/x`]: x, [`tokens/${d.id}/y`]: y };
    if (d.fight) {
      const cost = d.dist.get(`${x}_${y}`);
      let busy = false;
      for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) if (d.occ.has(`${x + dx}_${y + dy}`)) busy = true;
      if (busy) { app.toast('Клетка занята другим существом'); renderTokens(); return; }
      if (!d.forced && (cost == null || cost > d.left)) {
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
  // Кисти тумана: «Открыть» — клетка видна всем, «Скрыть» — закрыта, разведанное там тоже забывается
  if (tool === 'reveal' || tool === 'conceal') {
    const k = `${p.x}_${p.y}`, on = tool === 'reveal';
    if (!!(game.reveal || {})[k] === on && (on || !(game.seen || {})[k])) return;
    game.reveal = { ...(game.reveal || {}) };
    if (on) game.reveal[k] = 1; else { delete game.reveal[k]; game.seen = { ...(game.seen || {}) }; delete game.seen[k]; drag.pending[`seen/${k}`] = null; }
    drag.pending[`reveal/${k}`] = on ? 1 : null;
    drawFog();
    return;
  }
  const k = `${p.x}_${p.y}`, v = tool === 'erase' ? null : tool;
  if ((game.map || {})[k] === (v || undefined)) return;
  game.map = { ...(game.map || {}) };
  if (v) game.map[k] = v; else delete game.map[k];
  drag.pending[k] = v;
  drawTerrain();
}

/* ---------- Враги и бестиарий ---------- */
const ABK = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABS = { str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' };
const abMod = (v) => Math.floor(((+v || 10) - 10) / 2);
const fmtMod = (v) => (v >= 0 ? `+${v}` : `−${-v}`);
const DICE_RE = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
// Бросок по формуле «2d6+3+1d6» (крит удваивает кости) — для существ мастера, без листа персонажа
function rollExpr(expr, crit) {
  const s = String(expr || '').replace(/\s+/g, '').toLowerCase().replace(/к/g, 'd');
  let total = 0;
  const parts = [];
  s.replace(DICE_RE, (m, sg, n, sd, sg2, num) => {
    if (sd) {
      const k = Math.min(100, +(n || 1)) * (crit ? 2 : 1), rs = Array.from({ length: k }, () => die(+sd)), sum = rs.reduce((a, b) => a + b, 0);
      total += sg === '-' ? -sum : sum;
      parts.push(`${sg === '-' ? '− ' : parts.length ? '+ ' : ''}${k}d${sd} [${rs.join(', ')}]`);
    } else if (num) { total += sg2 === '-' ? -num : +num; parts.push(`${sg2 === '-' ? '−' : '+'} ${num}`); }
    return '';
  });
  return { total: Math.max(0, total), detail: parts.join(' ') };
}
// Среднее по формуле хитов: 3d6 → 10, 2d8+2 → 11
function avgExpr(expr) {
  let t = 0;
  String(expr || '').replace(/\s+/g, '').toLowerCase().replace(/к/g, 'd').replace(DICE_RE, (m, sg, n, sd, sg2, num) => {
    if (sd) t += (sg === '-' ? -1 : 1) * ((+(n || 1) * (+sd + 1)) / 2);
    else if (num) t += sg2 === '-' ? -num : +num;
    return '';
  });
  return Math.max(1, Math.floor(t));
}
const BEST = () => (typeof BESTIARY !== 'undefined' ? BESTIARY : []);
// Атаки существа → формат стола (досягаемость и дальность)
function npcAttacks(t) {
  return (t.atk || []).map((a, i) => {
    const m = String(a.range || '').match(/(\d+)\s*\/\s*(\d+)/), reach = a.reach === 0 || a.reach === '0' ? 0 : +a.reach || (m ? 0 : 5);
    return { id: 'n' + i, n: a.n, bonus: +a.hit || 0, dmg: a.dmg || '', type: a.type || '', rng: { reach, ...(m ? { near: +m[1], far: +m[2], thrown: !!reach } : {}) }, npc: true, on: a.on || null };
  });
}
function newEnemyDialog(x, y, base) {
  let mon = base && base.mon ? BEST().find((m) => m.e === base.mon) : null;
  const b = base || { name: 'Существо', hpMax: 10, ac: 12, size: 1, speed: 30, init: 0 };
  const sizes = [[1, 'Крошечный–Средний'], [2, 'Большой'], [3, 'Огромный'], [4, 'Громадный']];
  app.openModal(`<h2>${base ? 'Копия существа' : '＋ Существо'}</h2>
    ${base ? '' : `<label>Бестиарий<input id="nFind" placeholder="Поиск: гоблин, дракон, 1/4…" autocomplete="off"></label><div id="nList" class="mon-list"></div>`}
    <div class="form-grid mt"><label style="grid-column:1/-1">Название<input id="nN" value="${esc(b.name)}"></label>
    <label>Хиты<input id="nH" type="number" value="${b.hpMax}"></label><label>КД<input id="nA" type="number" value="${b.ac}"></label>
    <label>Скорость, фт<input id="nS" type="number" step="5" value="${b.speed}"></label><label>Бонус инициативы<input id="nI" type="number" value="${b.init}"></label>
    <label>Размер<select id="nZ">${sizes.map(([v, n]) => `<option value="${v}" ${b.size === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label>Количество<input id="nC" type="number" min="1" max="12" value="1"></label>
    <label>Опыт за победу<input id="nXp" type="number" min="0" value="${b.xp != null ? b.xp : xpOf(b)}"></label>
    <label class="check" id="nRollBox" ${mon ? '' : 'hidden'}><input type="checkbox" id="nRoll"> Бросить хиты <span class="muted small" id="nHpF">${mon ? esc(mon.hp) : ''}</span></label>
    <label class="check"><input type="checkbox" id="nHid"> Скрыт от игроков</label>
    <label>Сторона<select id="nSide">${[['enemy', 'враг'], ['neutral', 'нейтральный'], ['ally', 'союзник игроков']].map(([v, n]) => `<option value="${v}" ${(b.side || 'enemy') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="check" title="На нуле хитов не умирает сразу, а делает спасброски от смерти, как персонажи"><input type="checkbox" id="nDs" ${b.dsOn ? 'checked' : ''}> Спасброски от смерти (босс, важный NPC)</label></div>
    <div id="nCustom" ${mon || (base && (base.atk || []).length) ? 'hidden' : ''}><div class="muted small mt">Атака существа (необязательно):</div>
      <div class="form-grid"><label>Название<input id="nAn" placeholder="Скимитар"></label><label>Бонус<input id="nAh" type="number" value="4"></label>
      <label>Урон<input id="nAd" placeholder="1d6+2"></label><label>Тип<input id="nAt" placeholder="рубящий"></label>
      <label>Дальность<input id="nAr" placeholder="пусто — ближний бой, 80/320 — лук"></label></div></div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="nOk">Поставить</button></div>`);
  const pick = (m) => {
    mon = m;
    Object.assign($('#nN'), { value: m.n });
    $('#nH').value = avgExpr(m.hp); $('#nA').value = m.ac; $('#nS').value = parseInt(m.speed) || 30; $('#nI').value = abMod(m.ab[1]);
    $('#nZ').value = String(SIZE_N[m.size] || 1);
    $('#nRollBox').hidden = false; $('#nHpF').textContent = m.hp; $('#nCustom').hidden = true;
    // NPC по умолчанию нейтральны и не умирают сразу; монстры — враги
    $('#nSide').value = m.cat === 'npc' ? 'neutral' : 'enemy'; $('#nDs').checked = m.cat === 'npc';
    $('#nXp').value = typeof XP_CR !== 'undefined' ? XP_CR[m.cr] || 0 : 0;
    $$('#nList [data-mon]').forEach((x) => x.classList.toggle('on', x.dataset.mon === m.e));
  };
  const list = () => {
    const q = ($('#nFind').value || '').trim().toLowerCase();
    const found = BEST().filter((m) => !q || m.n.toLowerCase().includes(q) || m.e.toLowerCase().includes(q) || m.cr === q);
    const btn = (m) => `<button data-mon="${esc(m.e)}" class="${mon && mon.e === m.e ? 'on' : ''}"><b>${esc(m.n)}</b><span class="muted small">ПО ${m.cr} · КД ${m.ac} · ${avgExpr(m.hp)} хитов</span></button>`;
    const group = (title, list) => (list.length ? `<div class="mon-head">${title}</div>${list.map(btn).join('')}` : '');
    $('#nList').innerHTML = group('Враги и чудовища', found.filter((m) => m.cat !== 'npc')) + group('NPC — жители мира', found.filter((m) => m.cat === 'npc'))
      || '<p class="muted small">Ничего не найдено — заполните поля вручную.</p>';
    $$('#nList [data-mon]').forEach((x) => x.addEventListener('click', () => pick(BEST().find((m) => m.e === x.dataset.mon))));
  };
  if (!base) { list(); $('#nFind').addEventListener('input', list); }
  $('#nOk').onclick = () => {
    const n = Math.max(1, Math.min(12, +$('#nC').value || 1)), size = +$('#nZ').value || 1, upd = {}, name = $('#nN').value.trim() || 'Существо';
    // Статблок: из бестиария, из копируемого существа или одна своя атака
    let stats;
    if (mon) stats = { mon: mon.e, cr: mon.cr, ab: mon.ab, atk: mon.atk, acts: mon.acts || [], multi: mon.multi || 1, tr: mon.x || '', spd: mon.speed,
      sv: Object.fromEntries(ABK.map((k, i) => [k, mon.sv[k] != null ? mon.sv[k] : abMod(mon.ab[i])])),
      ...['leg', 'cs', 'sdc'].reduce((o, k) => (mon[k] ? { ...o, [k]: mon[k] } : o), {}), ...(mon.lr ? { lr: mon.lr, lrMax: mon.lr } : {}) };
    else if (base) stats = { ...['mon', 'cr', 'ab', 'atk', 'acts', 'multi', 'tr', 'spd', 'sv', 'img', 'leg', 'lr', 'lrMax', 'cs', 'sdc'].reduce((o, k) => (base[k] != null ? { ...o, [k]: base[k] } : o), {}) };
    else {
      const an = $('#nAn').value.trim();
      stats = { multi: 1, atk: an ? [{ n: an, hit: +$('#nAh').value || 0, dmg: $('#nAd').value.trim(), type: $('#nAt').value.trim(), reach: $('#nAr').value.trim() ? 0 : 5, range: $('#nAr').value.trim() }] : [] };
    }
    for (let i = 0; i < n; i++) {
      const id = R.push(ref(gpath('tokens'))).key, hp = mon && $('#nRoll').checked ? Math.max(1, rollExpr(mon.hp).total) : +$('#nH').value || 1;
      upd[id] = { kind: 'npc', owner: user.uid, name: n > 1 ? `${name} ${i + 1}` : name, x: Math.min(W() - size, x + i * size), y, size, color: '#c94a3d',
        hp, hpMax: hp, ac: +$('#nA').value || 10, speed: +$('#nS').value || 30, init: +$('#nI').value || 0, hidden: $('#nHid').checked, cond: [], side: $('#nSide').value, dsOn: $('#nDs').checked, ...stats, xp: Math.max(0, +$('#nXp').value || 0) };
    }
    R.update(ref(gpath('tokens')), upd);
    app.closeModal();
    tool = 'move'; renderTools();
  };
}
// Действия существа (мастер): атаки и способности-области; вне своего хода — реакцией
// legend — легендарное действие: после хода другого существа, стоит 1–3 из запаса на раунд (одна атака, способность, перемещение)
function openNpcAttack(id, legend) {
  const t = game.tokens[id];
  if (!t || !isDM()) return;
  if (incapTok(t)) { app.toast(isDead(t) ? 'Мёртвые не атакуют' : 'Существо недееспособно — не может действовать'); return; }
  const e = econ(id), fight = inFight(), turn = !fight || isTurnOf(id), per = +t.multi || 1;
  const atks = npcAttacks(t), acts = t.acts || [], rech = t.rech || {}, legLeft = legendLeft(id);
  const ways = [];
  if (legend) {
    if (!legLeft) { app.toast('Легендарные действия на этот раунд закончились'); return; }
  } else {
    if (turn && (!fight || e.atk > 0 || !e.a)) ways.push(['action', e.atk > 0 ? `Действие «Атака» — осталось атак: ${e.atk}` : `Действие «Атака»${per > 1 ? ` (${per} атаки)` : ''}`]);
    if (turn && fight && !e.b) ways.push(['bonus', 'Бонусное действие']);
    if (fight && !e.r) ways.push(['reaction', 'Реакция (атака по возможности)']);
    if (!ways.length) { app.toast('Нет доступных действий для атаки'); return; }
  }
  const rng = (r) => (r.near ? `${r.reach ? `${r.reach} фт / бросок ` : ''}${r.near}/${r.far} фт` : `досягаемость ${r.reach} фт`);
  const actOk = legend || (turn && (!fight || (!e.a && !(e.atk > 0))));
  app.openModal(`<h2>${legend ? '👑' : '⚔'} ${esc(t.name)}${legend ? ': легендарное действие' : ''}</h2>
    ${legend ? `<div class="atk-ways">${[1, 2, 3].filter((n) => n <= legLeft).map((n) => `<label class="check"><input type="radio" name="legCost" value="${n}" ${n === 1 ? 'checked' : ''}> стоит ${n}</label>`).join('')}</div>
      <p class="muted small">Осталось ${legLeft} из ${+t.leg}. Атака — одна; сильные способности обычно стоят 2.</p>`
      : `<div class="atk-ways">${ways.map(([k, n], i) => `<label class="check"><input type="radio" name="atkWay" value="${k}" ${i ? '' : 'checked'}> ${esc(n)}</label>`).join('')}</div>`}
    <div class="list mt">${atks.map((a) => `<button class="atk-pick" data-atk="${a.id}"><b>${esc(a.n)}</b><span class="muted small">${fmtMod(a.bonus)} к попаданию${a.dmg ? ` · ${esc(a.dmg)} ${esc(a.type)}` : ''} · ${rng(a.rng)}</span></button>`).join('')}
      ${acts.map((a, i) => `<button class="atk-pick" data-act-i="${i}" ${actOk && !rech[i] ? '' : 'disabled'}><b>${esc(a.n)}</b><span class="muted small">${SHAPE_N[a.shape]} ${a.size} фт · спасбросок ${AB_N[a.save]} СЛ ${a.dc} · ${esc(a.f)} ${esc(a.dtype)}${a.rech ? ` · перезарядка ${a.rech}–6${rech[i] ? ' — не перезарядилось' : ''}` : ''}${a.sp ? ` · заклинание ${a.sp} ур.` : ''} · ${legend ? 'легендарное' : 'действие'}</span></button>`).join('')}
      ${legend ? '<button class="atk-pick" data-leg-other><b>Другое</b><span class="muted small">Перемещение, особое умение — двигайте фишку сами (🔓 свободное перемещение)</span></button>'
        : SPECIAL_ATK.map((s) => `<button class="atk-pick" data-atk="${s.id}"><b>${s.n}</b><span class="muted small">${s.d}</span></button>`).join('')}
      ${!atks.length && !acts.length ? '<p class="muted">У существа нет атак — добавьте их, поставив существо из бестиария или указав атаку при создании.</p>' : ''}</div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  // Легендарное действие оплачивается сразу при выборе
  const payLeg = (what) => {
    const cost = +(($('input[name="legCost"]:checked') || {}).value || 1);
    R.update(ref(gpath(`econ/${id}`)), { leg: (+e.leg || 0) + cost }).catch(() => {});
    addLog({ kind: 'act', who: t.name, txt: `👑 легендарное действие${cost > 1 ? ` (стоит ${cost})` : ''}: ${what}` });
  };
  $$('[data-atk]').forEach((b) => b.addEventListener('click', () => {
    const A = atks.find((x) => x.id === b.dataset.atk) || SPECIAL_ATK.find((x) => x.id === b.dataset.atk), way = legend ? 'legend' : ($('input[name="atkWay"]:checked') || {}).value;
    if (legend) payLeg(A.n);
    app.closeModal();
    aim = { from: id, npc: true, atk: A, way, left: way === 'action' ? (e.atk > 0 ? e.atk : per) : 1 };
    renderAll();
  }));
  $$('[data-act-i]').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.actI, a = acts[i], self = a.shape === 'cone' || a.shape === 'line' || a.shape === 'aura' || a.shape === 'cube';
    if (legend) payLeg(a.n);
    app.closeModal();
    startCast({ dm: true, caster: id, npcAct: i, info: { n: a.n, shape: a.shape, size: a.size, width: a.width || 5, save: a.save, dc: a.dc, f: a.f, dtype: a.dtype, half: a.half !== false, self, act: legend ? 'legend' : 'action', spell: a.sp || 0 } });
  }));
  const other = $('[data-leg-other]');
  if (other) other.addEventListener('click', () => { payLeg('другое'); app.closeModal(); });
}
// Легендарные действия: запас на раунд восстанавливается в начале хода существа (вместе с его записью econ)
const legendLeft = (id) => { const t = game.tokens[id]; return t && +t.leg ? Math.max(0, +t.leg - (+econ(id).leg || 0)) : 0; };
const legendOk = (id) => { const t = game.tokens[id]; return inFight() && !!t && !!legendLeft(id) && !isTurnOf(id) && !incapTok(t); };
// Бросок атаки существа: преимущество/помеха от обстановки и его состояний, крит на 20
function npcAttackRoll(t, A, o) {
  const cond = t.cond || [], adv = [...o.adv], dis = [...o.dis];
  ['blinded', 'frightened', 'poisoned', 'prone', 'restrained'].forEach((k) => { if (cond.includes(k)) dis.push(condName(k).toLowerCase()); });
  if (cond.includes('invisible')) adv.push('невидим');
  const mode = adv.length && !dis.length ? 1 : dis.length && !adv.length ? -1 : 0;
  // Кости эффектов (+1к4 «Благословения», −1к4 «Порчи»)
  const ex = (o.dice || []).map((x) => { const neg = String(x.e).startsWith('-'), r = rollExpr(String(x.e).replace(/^[+-]/, '')); return { v: neg ? -r.total : r.total, n: x.n }; });
  const exSum = ex.reduce((s, x) => s + x.v, 0);
  const r1 = die(20), r2 = die(20), nat = mode > 0 ? Math.max(r1, r2) : mode < 0 ? Math.min(r1, r2) : r1, total = nat + A.bonus + exSum;
  const hit = nat !== 1 && (nat === 20 || total >= o.ac), crit = hit && (nat === 20 || !!o.autoCrit);
  let detail = mode ? `${mode > 0 ? 'преимущество' : 'помеха'} (${(mode > 0 ? adv : dis).join(', ')}) [${r1}, ${r2}]` : `к20 [${r1}]`;
  detail += ` ${fmtMod(A.bonus)}${ex.map((x) => ` ${x.v >= 0 ? '+' : '−'}${Math.abs(x.v)} (${x.n})`).join('')}`;
  if (!mode && adv.length && dis.length) detail += ' · преимущество и помеха взаимно отменились';
  const d = hit && A.dmg ? rollExpr(A.dmg, crit) : null;
  return { total, nat, detail, hit, crit, dmg: d ? d.total : 0, dmgDetail: d ? d.detail : '', type: A.type };
}
// Начало хода существа (браузер мастера): перезарядка способностей — к6
function checkNpcTurn() {
  const cur = currentEntry();
  if (!cur || !isDM()) return;
  const t = game.tokens[cur.tokenId];
  if (!t || t.kind !== 'npc' || !(t.rech || isDown(t))) return;
  const key = `${game.id}:${game.init.round}:${game.init.turn}`;
  if (ls.get('dnd55-npcturn') === key) return;
  ls.set('dnd55-npcturn', key);
  const upd = {}, p = `tokens/${cur.tokenId}/`, pass = () => setTimeout(() => { const c = currentEntry(); if (c && c.id === cur.id) nextTurn(); }, 1600);
  // Без сознания (босс, важный NPC): спасбросок от смерти за него и пропуск хода
  if (isDown(t)) {
    if (isDead(t)) return;
    if (isStable(t)) { addLog({ kind: 'sys', txt: `${t.name} стабилизирован и пропускает ход` }); pass(); return; }
    const r = die(20);
    let s = +t.dsS || 0, f = +t.dsF || 0, txt;
    if (r === 20) { upd[`${p}hp`] = 1; upd[`${p}dsS`] = null; upd[`${p}dsF`] = null; txt = '20 — приходит в себя с 1 хитом!'; }
    else {
      if (r === 1) { f = Math.min(3, f + 2); txt = '1 — два провала'; } else if (r >= 10) { s += 1; txt = `${r} — успех`; } else { f += 1; txt = `${r} — провал`; }
      upd[`${p}dsS`] = s; upd[`${p}dsF`] = f;
      txt += ` (успехи ${s}/3, провалы ${f}/3)${s >= 3 ? ' — стабилизирован' : ''}${f >= 3 ? ' — погибает' : ''}`;
    }
    R.update(ref(gpath()), upd).catch(() => {});
    addLog({ kind: 'death', who: t.name, txt: `спасбросок от смерти ${txt}` });
    if (r !== 20) pass();
    return;
  }
  Object.entries(t.rech).forEach(([i, used]) => {
    const a = (t.acts || [])[i];
    if (!used || !a) return;
    const r = die(6), ok = r >= (+a.rech || 5);
    if (ok) upd[`tokens/${cur.tokenId}/rech/${i}`] = null;
    addLog({ kind: 'sys', txt: `${t.name}: «${a.n}» ${ok ? 'перезарядилось' : 'не перезарядилось'} (к6: ${r})` });
  });
  if (Object.keys(upd).length) R.update(ref(gpath()), upd).catch(() => {});
}

/* ---------- Инициатива ---------- */
// Логово ходит на счёт инициативы 20, проигрывая ничьи
const initList = () => Object.entries((game.init && game.init.list) || {}).map(([id, e]) => ({ id, ...e }))
  .sort((a, b) => b.roll - a.roll || (a.kind === 'lair') - (b.kind === 'lair') || String(a.name).localeCompare(String(b.name), 'ru'));
function currentEntry() {
  if (!game || !game.init || !game.init.active) return null;
  const l = initList();
  return l.length ? l[(game.init.turn || 0) % l.length] : null;
}
// Новый ход существа: его перемещение, действия и реакция восстанавливаются
function nextTurn() {
  const l = initList();
  if (!l.length) return;
  // Конец хода текущего существа: повторные спасброски («Удержание личности» и т. п.)
  const ending = l[(game.init.turn || 0) % l.length];
  if (ending && ending.tokenId) repeatSaves(ending.tokenId);
  let turn = (game.init.turn || 0) + 1, round = game.init.round || 1;
  if (turn >= l.length) { turn = 0; round += 1; addLog({ kind: 'sys', txt: `Раунд ${round}` }); }
  aim = null;
  const nx = l[turn], upd = { 'init/turn': turn, 'init/round': round, [`econ/${nx.tokenId || nx.id}`]: null };
  // Спутники хозяина получают свежее перемещение в его ход
  if (nx.kind === 'pc') Object.entries(game.tokens).forEach(([id, t]) => { if (t.comp && t.owner === nx.owner) upd[`econ/${id}`] = null; });
  // «Щит» и подобное — до начала следующего хода существа
  Object.entries(game.effects || {}).forEach(([k, e]) => { if (e.untilTurn && e.untilTurn === (nx.tokenId || nx.id)) upd[`effects/${k}`] = null; });
  R.update(ref(gpath()), upd);
}

// Убрать участника из инициативы, не сбив очередь: если ушёл тот, чей ход, ход переходит к следующему
function removeFromInit(entryId) {
  const l = initList(), idx = l.findIndex((x) => x.id === entryId);
  if (idx < 0) return Promise.resolve();
  const upd = { [`init/list/${entryId}`]: null };
  if (game.init && game.init.active && l.length > 1) {
    let turn = game.init.turn || 0;
    if (idx < turn) turn -= 1;
    else if (idx === turn) {
      if (turn >= l.length - 1) { turn = 0; upd['init/round'] = (game.init.round || 1) + 1; }
      const nx = l.filter((x) => x.id !== entryId)[turn];
      if (nx) upd[`econ/${nx.tokenId || nx.id}`] = null;
    }
    upd['init/turn'] = turn;
  }
  return R.update(ref(gpath()), upd);
}
// Браузер мастера: погибшие (труп, три провала) выбывают из инициативы сами
const leaving = new Set();
function cleanupInit() {
  if (!game || !isDM() || !game.init || !game.init.list) return;
  const dead = initList().find((en) => { const t = game.tokens[en.tokenId]; return t && isDead(t) && !leaving.has(en.id); });
  if (!dead) return;
  leaving.add(dead.id);
  addLog({ kind: 'sys', txt: `☠ ${dead.name} погибает и выбывает из боя` });
  removeFromInit(dead.id).finally(() => setTimeout(() => leaving.delete(dead.id), 1500));
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
  const t = game.tokens[id], e = econ(id), cond = t.cond || [];
  // Скорость с эффектами: «Ускорение» — вдвое, «Замедление» — вдвое меньше, приём «Замедление» — −10 фт
  let speed = speedOf(t);
  fxOf(id).forEach(([, f]) => { if (f.spd === 'x2') speed *= 2; else if (f.spd === 'half') speed = Math.floor(speed / 10) * 5; else if (+f.spd) speed = Math.max(0, speed + +f.spd); });
  const incap = isDown(t) || cond.some((k) => INCAP.includes(k)), bonus = (charOf(t) || {}).bonus || [];
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
    if (!(e.dmg || e.heal) || e.applied || !t || applying.has(e.k)) return;
    if (t.kind === 'npc' ? !isDM() : t.owner !== user.uid) return;
    applying.add(e.k);
    const upd = { [`log/${e.k}/applied`]: true };
    if (t.comp) { // спутник: хиты в его карточке в листе
      const m = me();
      if (m && m.charId) app.compHp(m.charId, t.comp, e.heal ? e.heal : -e.dmg);
    } else if (e.heal) {
      if (t.kind === 'npc') Object.assign(upd, healUpd(e.tgt, t, e.heal));
      else { const m = me(); if (m && m.charId) app.heal(m.charId, e.heal); }
    } else if (t.kind === 'npc') {
      Object.assign(upd, npcDamageUpd(e.tgt, t, e.dmg, e.crit));
      if (isDead({ ...t, hp: upd[`tokens/${e.tgt}/hp`], dsF: upd[`tokens/${e.tgt}/dsF`] ?? t.dsF }) && !isDead(t)) upd[`log/${e.k}/down`] = true;
    } else {
      const m = me();
      if (m && m.charId) app.takeDamage(m.charId, e.dmg, e.crit);
    }
    R.update(ref(gpath()), upd).catch(() => applying.delete(e.k));
  });
}
// Урон существу (браузер мастера). У существ со спасбросками от смерти — правила 2024, как у персонажей:
// урон на нуле хитов — провал (крит — два), урон не меньше максимума хитов — смерть, стабилизация теряется
function npcDamageUpd(id, t, dmg, crit) {
  const hp0 = +t.hp || 0, hp = Math.max(0, hp0 - dmg), p = `tokens/${id}/`, upd = { [`${p}hp`]: hp };
  if (!t.dsOn || dmg <= 0) return upd;
  if (hp0 <= 0) {
    upd[`${p}dsS`] = (+t.dsS || 0) >= 3 ? 0 : +t.dsS || 0;
    upd[`${p}dsF`] = dmg >= (+t.hpMax || 1) ? 3 : Math.min(3, (+t.dsF || 0) + (crit ? 2 : 1));
  } else if (hp === 0) { upd[`${p}dsS`] = 0; upd[`${p}dsF`] = dmg - hp0 >= (+t.hpMax || 1) ? 3 : 0; }
  return upd;
}
// Всплывающие уведомления о том, что касается меня: атаки по моему персонажу, возможность атаки по возможности
const notified = new Set();
let lastHit = null; // последнее попадание по моему персонажу — для реакций («Щит», уклонение, возмездие)
let lastAllyHit = null; // последнее попадание по союзнику рядом — для «Защиты»
function notifyLog() {
  if (!game || !user) return;
  logList().forEach((e) => {
    if ((e.t || 0) < openedAt || e.by === user.uid || notified.has(e.k)) return;
    notified.add(e.k);
    const t = e.tgt && game.tokens[e.tgt];
    if (e.kind === 'atk' && e.hit && !e.graze && t && t.owner === user.uid && t.kind === 'pc' && !t.comp)
      lastHit = { k: e.k, tgt: e.tgt, total: e.total, dmg: e.dmg, from: e.from, dtype: e.dtype || '', t: Date.now() };
    // Попадание по союзнику рядом с моим персонажем — для боевого стиля «Защита»
    const mine = user && game.tokens[`pc_${user.uid}`];
    if (e.kind === 'atk' && e.hit && !e.graze && e.nat && t && mine && e.tgt !== `pc_${user.uid}` && team(t) === team(mine) && distFt(mine, t) <= 5) {
      lastAllyHit = { k: e.k, tgt: e.tgt, from: e.from, total: e.total, nat: e.nat, ac: e.ac, dmg: e.dmg, crit: e.crit, t: Date.now() };
      const O = me() && me().charId ? app.combatOpts(me().charId) : {};
      if (O.protection && !econ(`pc_${user.uid}`).r) app.toast(`🛡 По ${esc(t.name)} попали — можно «Защиту» реакцией (панель хода)`, 'crit');
    }
    if (e.kind === 'atk' && t && t.owner === user.uid && t.kind === 'pc')
      app.toast(`🗡 ${esc(e.who)} атакует вас: ${e.hit ? `${e.crit ? 'КРИТ! ' : ''}попадание, <b>${e.dmg}</b> урона` : 'промах'}`, e.hit ? 'fumble' : '');
    if (e.kind === 'oa' && (e.foes || []).some((id) => game.tokens[id] && canMove(game.tokens[id])))
      app.toast(`⚠ ${esc(e.txt)}`, 'crit');
    if (e.kind === 'chat') app.toast(`💬 <b>${esc(e.who)}</b>: ${esc(e.txt)}`);
  });
}
// Чат и броски: сообщение, «/r 2d6+3» — бросок на всех; броски из листа уходят в журнал, если включено
const myName = () => (isDM() ? 'Мастер' : (game.tokens[`pc_${user.uid}`] || {}).name || ((me() || {}).char || {}).name || user.displayName || 'Игрок');
const shareRolls = () => ls.get('dnd55-share-rolls') !== '0';
let dmSecret = false;
function sendChat() {
  const inp = $('#tblChat'), txt = (inp.value || '').trim();
  if (!txt || !game) return;
  inp.value = '';
  const m = txt.match(/^\/(?:r|к|бросок)\s+(.+)$/i);
  if (m) {
    const r = rollExpr(m[1]);
    if (!r.detail) { app.toast('Не понял формулу броска — пример: /r 1d20+5'); return; }
    addLog({ kind: 'roll', who: myName(), txt: m[1], total: r.total, detail: r.detail, ...(isDM() && dmSecret ? { dmOnly: true } : {}) });
    return;
  }
  addLog({ kind: 'chat', who: myName(), txt: txt.slice(0, 400) });
}
document.addEventListener('dnd-roll', (ev) => {
  if (!game || !user || !game.meta || !shareRolls()) return;
  const d = ev.detail || {};
  addLog({ kind: 'roll', who: myName(), txt: d.label, total: d.total, detail: d.detail, cls: d.cls || '', ...(isDM() && dmSecret ? { dmOnly: true } : {}) });
});
function renderChatBar() {
  const bar = $('#tblChatOpts');
  if (!bar) return;
  bar.innerHTML = isDM()
    ? `<label class="check small" title="Броски мастера (из листа, кубиков и /r) видны только ему"><input type="checkbox" data-tbl-secret ${dmSecret ? 'checked' : ''}> 🙈 Скрытые броски</label>`
    : `<label class="check small" title="Проверки, спасброски и урон из листа появляются в общем журнале"><input type="checkbox" data-tbl-share ${shareRolls() ? 'checked' : ''}> 🎲 Мои броски из листа — в журнал</label>`;
}
function renderLog() {
  const box = $('#tblLog');
  if (!box) return;
  const dm = isDM();
  $('#tblLogClear').hidden = !dm;
  // Скрытые броски мастера видит только мастер
  box.innerHTML = logList().filter((e) => dm || !e.dmOnly).slice(0, 40).map((e) => {
    const time = e.t ? new Date(e.t).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) : '';
    if (e.kind === 'chat') return `<div class="lg chat"><div><b>${esc(e.who)}</b>: ${esc(e.txt)}</div><div class="muted small">${time}</div></div>`;
    if (e.kind === 'roll') return `<div class="lg roll ${e.cls || ''}${e.dmOnly ? ' secret' : ''}"><div>🎲 <b>${esc(e.who)}</b> — ${esc(e.txt)}: <span class="lg-roll">${e.total}</span>${e.dmOnly ? ' <span class="muted small">(скрыто)</span>' : ''}</div>
      <div class="muted small">${esc(e.detail || '')} · ${time}</div></div>`;
    if (e.kind === 'atk') {
      const res = e.hit ? `<b class="lg-hit">${e.crit ? 'КРИТ! ' : 'попадание'}</b> · <b>${e.dmg}</b> ${esc(e.dtype || 'урона')}` : '<b class="lg-miss">промах</b>';
      return `<div class="lg atk ${e.hit ? 'hit' : 'miss'}"><div><b>${esc(e.who)}</b> → <b>${esc(e.tgtName)}</b>: ${esc(e.txt)}</div>
        <div><span class="lg-roll">${e.total}</span>${dm && e.ac ? ` против КД ${e.ac}` : ''} — ${res}${e.down ? ' · ☠ повержен' : ''}</div>
        <div class="muted small">${esc(e.detail || '')}${e.dmgDetail ? ` · урон: ${esc(e.dmgDetail)}` : ''}${e.way ? ` · ${esc(e.way)}` : ''} · ${time}</div></div>`;
    }
    if (e.kind === 'heal') return `<div class="lg heal"><div><b>${esc(e.who)}</b> → <b>${esc(e.tgtName)}</b>: ${esc(e.txt)} — <b class="lg-heal">+${e.heal}</b> хитов</div><div class="muted small">${e.detail ? `${esc(e.detail)} · ` : ''}${time}</div></div>`;
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
// На нуле хитов: обычный монстр — сразу труп; персонажи и отмеченные мастером существа (боссы, важные NPC) —
// без сознания со спасбросками от смерти, пока не стабилизируются или не наберут три провала
const isDown = (t) => !!t.hpMax && (+t.hp || 0) <= 0;
const usesDS = (t) => (t.kind === 'pc' && !t.comp) || !!t.dsOn; // спутник на нуле хитов погибает
const isDead = (t) => isDown(t) && (!usesDS(t) || (+t.dsF || 0) >= 3);
const isStable = (t) => isDown(t) && !isDead(t) && (+t.dsS || 0) >= 3;
const downLabel = (t) => (isDead(t) ? `труп: ${t.name}` : isStable(t) ? `${t.name} (стабилен)` : `${t.name} (без сознания)`);
const incapTok = (t) => isDown(t) || (t.cond || []).some((k) => INCAP.includes(k));
// Стороны: персонажи и союзные NPC — одна, враги — другая; нейтральные ни с кем не враждуют
const team = (t) => (t.kind === 'pc' || t.side === 'ally' ? 'pc' : t.side === 'neutral' ? 'neutral' : 'npc');
const hostile = (a, b) => { const x = team(a), y = team(b); return x !== y && x !== 'neutral' && y !== 'neutral'; };
const SIDE_COLOR = { enemy: '#c94a3d', neutral: '#7f8a99', ally: '#5a9e5a' };
// Враги рядом (5 фт), способные действовать
const foesNear = (t, id) => Object.entries(game.tokens).filter(([k, o]) => k !== id && hostile(t, o) && !incapTok(o) && !(o.hidden && !isDM()) && distFt(t, o) <= 5);
const WAYS = { action: 'действие «Атака»', magic: 'действие «Магия»', bonus: 'бонусное действие', reaction: 'реакция', legend: 'легендарное действие' };
function openAttack(id) {
  const t = game.tokens[id], m = me(), e = econ(id), turn = isTurnOf(id);
  if (!t || !m || !m.charId) return;
  if (incapTok(t)) { app.toast('Вы недееспособны и не можете атаковать'); return; }
  const atks = app.attacks(m.charId), per = (app.summary(m.charId) || {}).atks || 1;
  const ways = [];
  if (turn && (e.atk > 0 || !e.a)) ways.push(['action', e.atk > 0 ? `Действие «Атака» — осталось атак: ${e.atk}` : `Действие «Атака»${per > 1 ? ` (${per} атаки)` : ''}`]);
  if (turn && !e.b) ways.push(['bonus', 'Бонусное действие (второе оружие, Боевые искусства…)']);
  if (!e.r) ways.push(['reaction', 'Реакция (атака по возможности)']);
  if (!ways.length) { app.toast('Нет доступных действий для атаки'); return; }
  const rng = (r) => (r.near ? `${r.reach ? `${r.reach} фт / бросок ` : ''}${r.near}${r.far > r.near ? `/${r.far}` : ''} фт` : `досягаемость ${r.reach} фт`);
  // Классовые возможности: приём превосходства, Божественная кара (бонусное действие), Скрытая атака — считается сама
  const O = app.combatOpts(m.charId);
  const opts = `${O.maneuvers && O.maneuvers.length && O.supLeft ? `<label>Приём превосходства (к${O.supDie}, осталось ${O.supLeft})<select id="atkMan"><option value="">— не тратить кость —</option>${O.maneuvers.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}
    ${O.smiteSlots && O.smiteSlots.length && (!inFight() || !e.b) ? `<label>Божественная кара при попадании<select id="atkSmite"><option value="">— нет —</option>${O.smiteSlots.map((s) => `<option value="${s.key}">${esc(s.label)}</option>`).join('')}</select></label>` : ''}
    ${O.sneak ? `<p class="muted small">Скрытая атака ${O.sneak}к6 добавится сама — раз в ход, фехтовальным или дальнобойным оружием при преимуществе или если рядом с целью ваш союзник.${e.sa ? ' <b>В этом ходу уже была.</b>' : ''}</p>` : ''}`;
  app.openModal(`<h2>⚔ Атака</h2>
    <div class="atk-ways">${ways.map(([k, n], i) => `<label class="check"><input type="radio" name="atkWay" value="${k}" ${i ? '' : 'checked'}> ${esc(n)}</label>`).join('')}</div>
    ${opts.trim() ? `<div class="form-grid mt">${opts}</div>` : ''}
    <div class="list mt">${atks.map((a) => `<button class="atk-pick" data-atk="${esc(a.id)}" ${a.ammo === 0 ? 'disabled title="Нет боеприпасов"' : ''}>
      <b>${esc(a.n)}</b><span class="muted small">${a.bonus >= 0 ? '+' : ''}${a.bonus} к попаданию · ${esc(a.dmg)} ${esc(a.type)}${a.beams > 1 ? ` ×${a.beams} луча` : ''} · ${rng(a.rng)}${a.ammo != null ? ` · 🏹 ${a.ammo}` : ''}${a.mastery ? ` · ⚔ ${esc(a.mastery)}` : ''}</span></button>`).join('') || '<p class="muted">В листе нет атак — добавьте оружие или заговор с атакой.</p>'}
      ${SPECIAL_ATK.map((s) => `<button class="atk-pick" data-atk="${s.id}"><b>${s.n}</b><span class="muted small">${s.d}</span></button>`).join('')}</div>
    <p class="muted small">Затем нажмите на цель на поле. Преимущество и помеха (цель лежит, уклоняется, враг рядом с вами при выстреле, дальняя дистанция) учитываются сами.</p>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  $$('.atk-pick').forEach((b) => b.addEventListener('click', () => {
    const A = atks.find((x) => x.id === b.dataset.atk) || SPECIAL_ATK.find((x) => x.id === b.dataset.atk);
    const man = ($('#atkMan') || {}).value || '', smite = ($('#atkSmite') || {}).value || '';
    let way = ($('input[name="atkWay"]:checked') || {}).value;
    if (A.cantrip) {
      if (!turn || e.atk > 0 || e.a) { app.toast(turn ? 'Заговор накладывается действием «Магия», а действие уже потрачено' : 'Заговор накладывается действием — только в свой ход'); return; }
      way = 'magic';
    }
    const left = way === 'action' ? (e.atk > 0 ? e.atk : per) : way === 'magic' ? A.beams || 1 : 1;
    app.closeModal();
    aim = { from: id, charId: m.charId, atk: A, way, left, man, smite };
    renderAll();
  }));
}
// Атака спутника: ходит в ход хозяина своим действием (атак за действие — как у зверя), вне хода — реакцией.
// Зверю-спутнику следопыта команду атаковать отдают бонусным действием хозяина — галочка это отметит
function openCompAttack(id) {
  const t = game.tokens[id];
  if (!t || !t.comp || !canMove(t)) return;
  if (incapTok(t)) { app.toast('Спутник недееспособен'); return; }
  const own = `pc_${t.owner}`, e = econ(id), eo = econ(own), fight = inFight(), turn = !fight || isTurnOf(own), per = +t.multi || 1, atks = npcAttacks(t);
  const ways = [];
  if (turn && (!fight || e.atk > 0 || !e.a)) ways.push(['action', e.atk > 0 ? `Действие «Атака» — осталось атак: ${e.atk}` : `Действие «Атака»${per > 1 ? ` (${per} атаки)` : ''}`]);
  if (fight && !e.r) ways.push(['reaction', 'Реакция (атака по возможности)']);
  if (!ways.length) { app.toast('У спутника не осталось действий'); return; }
  const rng = (r) => (r.near ? `${r.reach ? `${r.reach} фт / бросок ` : ''}${r.near}/${r.far} фт` : `досягаемость ${r.reach} фт`);
  app.openModal(`<h2>🐾 ${esc(t.name)}</h2>
    <div class="atk-ways">${ways.map(([k, n], i) => `<label class="check"><input type="radio" name="atkWay" value="${k}" ${i ? '' : 'checked'}> ${esc(n)}</label>`).join('')}</div>
    ${fight && turn && !eo.b && !(e.atk > 0) ? '<label class="check mt" title="Зверь-спутник следопыта атакует по команде — она тратит ваше бонусное действие"><input type="checkbox" id="cmpCmd"> Команда бонусным действием (ваше бонусное действие)</label>' : ''}
    <div class="list mt">${atks.map((a) => `<button class="atk-pick" data-atk="${a.id}"><b>${esc(a.n)}</b><span class="muted small">${fmtMod(a.bonus)} к попаданию${a.dmg ? ` · ${esc(a.dmg)} ${esc(a.type)}` : ''} · ${rng(a.rng)}</span></button>`).join('')
      || '<p class="muted">У спутника нет атак.</p>'}
      ${SPECIAL_ATK.map((s) => `<button class="atk-pick" data-atk="${s.id}"><b>${s.n}</b><span class="muted small">${s.d}</span></button>`).join('')}</div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  $$('[data-atk]').forEach((b) => b.addEventListener('click', () => {
    const A = atks.find((x) => x.id === b.dataset.atk) || SPECIAL_ATK.find((x) => x.id === b.dataset.atk), way = ($('input[name="atkWay"]:checked') || {}).value;
    if (($('#cmpCmd') || {}).checked) R.update(ref(gpath(`econ/${own}`)), { b: 1 }).catch(() => {});
    app.closeModal();
    aim = { from: id, npc: true, atk: A, way, left: way === 'action' ? (e.atk > 0 ? e.atk : per) : 1 };
    renderAll();
  }));
}
// Статблок спутника для поля: атаки в формате существ; характеристики, спасброски и эффекты атак — из бестиария по виду
function compStats(p) {
  const mon = BEST().find((m) => m.n === p.kind);
  const atk = (p.atk || []).map((a) => {
    const r = String(a.range || '').match(/(\d+)\s*\/\s*(\d+)/), on = mon && ((mon.atk || []).find((x) => x.n === a.n) || {}).on;
    return { n: a.n, hit: +a.hit || 0, dmg: a.dmg || '', type: a.type || '', reach: r ? 0 : parseInt(a.range) || 5, range: r ? `${r[1]}/${r[2]}` : '', ...(on ? { on } : {}) };
  });
  return { atk, multi: mon ? mon.multi || 1 : 1, ...(mon ? { ab: mon.ab, cr: mon.cr, sv: Object.fromEntries(ABK.map((k, i) => [k, mon.sv[k] != null ? mon.sv[k] : abMod(mon.ab[i])])) } : {}) };
}
// Безоружные приёмы 2024 вместо атаки: захват и толчок — цель (не больше чем на размер крупнее) делает спасбросок Силы или Ловкости
const SPECIAL_ATK = [
  { id: 'sp_grapple', special: 'grapple', n: '🤼 Захват', d: 'Безоружный удар: спасбросок Силы/Ловкости цели, иначе схвачена', rng: { reach: 5 } },
  { id: 'sp_push', special: 'push', n: '↔ Толчок: оттолкнуть', d: 'Безоружный удар: спасбросок, иначе отлетает на 5 фт', rng: { reach: 5 } },
  { id: 'sp_prone', special: 'prone', n: '⤓ Толчок: сбить с ног', d: 'Безоружный удар: спасбросок, иначе лежит ничком', rng: { reach: 5 } },
];
const pbCR = (cr) => { const v = crNum(cr ?? 0); return v >= 29 ? 9 : v >= 25 ? 8 : v >= 21 ? 7 : v >= 17 ? 6 : v >= 13 ? 5 : v >= 9 ? 4 : v >= 5 ? 3 : 2; };
const crNum = (cr) => (String(cr).includes('/') ? 1 / +String(cr).split('/')[1] : +cr || 0);
// СЛ захвата и толчка: 8 + мод. Силы + бонус мастерства; лучший спасбросок цели — Сила или Ловкость
function grappleDC(t) {
  if (t.kind === 'pc' && !t.comp) return ((charOf(t) || {}).grapDC) || 10;
  return 8 + abMod((t.ab || [])[0]) + pbCR(t.cr);
}
function bestStrDex(t) {
  if (t.kind === 'pc' && !t.comp) { const s = (charOf(t) || {}).svs || [0, 0]; return s[0] >= s[1] ? 'str' : 'dex'; }
  const sv = t.sv || {};
  return (+sv.str || 0) >= (+sv.dex || 0) ? 'str' : 'dex';
}
function specialAttack(a, tid) {
  const me_ = game.tokens[a.from], T = game.tokens[tid], A = a.atk;
  if (distFt(me_, T) > 5) { app.toast('Нужно стоять вплотную к цели'); return false; }
  if ((T.size || 1) > (me_.size || 1) + 1) { app.toast('Цель слишком крупная — не больше чем на один размер больше вас'); return false; }
  const dc = grappleDC(me_), abil = bestStrDex(T);
  const fail = A.special === 'grapple' ? { n: 'Захвачен', ic: '🤼', cond: 'grappled', grab: a.from, gdc: dc }
    : A.special === 'push' ? { n: 'Толчок', push: 1, once: true } : { n: 'Толчок', cond: 'prone', once: true };
  saveRequest(tid, { n: `${me_.name}: ${A.n.replace(/^\S+\s/, '')}`, who: me_.name, abil, dc, fail, from: a.from });
  addLog({ kind: 'act', who: me_.name, txt: `${A.n.replace(/^\S+\s/, '')} → ${T.name} (спасбросок ${AB_N[abil]} СЛ ${dc})` });
  return true;
}
function attackTarget(tid) {
  const a = aim, me_ = game.tokens[a.from], T = game.tokens[tid], A = a.atk, r = A.rng;
  if (!me_ || !T) return;
  const d = distFt(me_, T);
  let ranged;
  if (r.reach && d <= r.reach) ranged = false;
  else if (r.near) { if (d > r.far) { app.toast(`Слишком далеко: ${d} фт, предел ${r.far} фт`); return; } ranged = true; }
  else { app.toast(`Цель вне досягаемости: ${d} фт, досягаемость ${r.reach} фт`); return; }
  if (A.special) { if (specialAttack(a, tid)) spendAttack(a, {}); return; }
  // Атака заклинанием: перед первым броском враги рядом могут ответить «Контрзаклинанием»; прервано — действие потрачено
  if (A.spell && !a.npc && !a.csOk && csCands(a.from).length) {
    aim = null; renderAll();
    csGate(a.from, A.n, 0, () => { a.csOk = true; aim = a; attackTarget(tid); }, () => { a.left = 1; aim = a; spendAttack(a, {}); });
    return;
  }
  // Преимущество и помеха от обстановки (2024): состояние цели, Уклонение, дистанция, враг рядом со стрелком
  const adv = [], dis = [], tc = T.cond || [], incapT = incapTok(T);
  if (econ(tid).dodge && !incapT) dis.push('цель уклоняется');
  if (tc.includes('prone') || tc.includes('unconscious')) (d <= 5 ? adv : dis).push('цель лежит');
  ['blinded', 'paralyzed', 'petrified', 'restrained', 'stunned'].forEach((k) => { if (tc.includes(k)) adv.push(`цель: ${condName(k).toLowerCase()}`); });
  if (tc.includes('invisible')) dis.push('цель невидима');
  if (ranged && d > r.near) dis.push('большая дистанция');
  if (ranged && foesNear(me_, a.from).length) dis.push('враг рядом');
  // Эффекты: «Огонь фей» на цели, «Ослабление» на атакующем (помеха на одну атаку), «Досаждение» (преимущество по этой цели)
  const used = [];
  if (fxOf(tid).some(([, e]) => e.lit)) adv.push('цель светится');
  if (fxOf(tid).some(([, e]) => e.prot && e.from !== a.from)) dis.push('«Защита»');
  fxOf(a.from).forEach(([k, e]) => {
    if (e.sap) { dis.push('ослаблен'); used.push(k); }
    if (e.vex === tid) { adv.push('досаждение'); used.push(k); }
  });
  const ac = acOf(T, tid);
  // Скрытая атака: раз в ход; союзник атакующего (в сознании) рядом с целью
  const allyNear = Object.entries(game.tokens).some(([k, o]) => k !== a.from && k !== tid && team(o) === team(me_) && !incapTok(o) && distFt(o, T) <= 5);
  const ro = { target: T.name, ac, adv, dis, dice: fxDice(a.from), autoCrit: d <= 5 && (tc.includes('paralyzed') || tc.includes('unconscious')),
    sneakOk: !econ(a.from).sa, allyNear, maneuver: a.man || '', smite: a.smite || '' };
  const res = a.npc ? npcAttackRoll(me_, A, ro) : app.mute(() => app.attack(a.charId, A.id, ro));
  if (!res) { aim = null; renderAll(); return; }
  if (used.length) R.update(ref(gpath('effects')), Object.fromEntries(used.map((k) => [k, null]))).catch(() => {});
  addLog({ kind: 'atk', who: me_.name, txt: A.n, tgt: tid, tgtName: T.name, total: res.total, nat: res.nat, ac, hit: res.hit, crit: res.crit,
    dmg: res.dmg, dtype: res.type, detail: res.detail, dmgDetail: res.dmgDetail, way: WAYS[a.way] + ((res.extra || []).length ? ` · ${res.extra.join(', ')}` : ''),
    from: a.from, anim: A.spell ? 'bolt' : ranged ? (r.thrown ? 'throw' : 'arrow') : 'melee' });
  // Приёмы превосходства: эффект при попадании (СЛ 8 + БМ + мод. Сил/Лов)
  const R1 = inFight() ? (game.init.round || 1) + 1 : null, small = (T.size || 1) <= 2;
  if (res.man === 'Подсечка' && small) saveRequest(tid, { n: 'Подсечка', who: me_.name, abil: 'str', dc: res.manDC, fail: { n: 'Подсечка', cond: 'prone', once: true } });
  if (res.man === 'Толкающая атака' && small) saveRequest(tid, { n: 'Толкающая атака', who: me_.name, abil: 'str', dc: res.manDC, fail: { n: 'Толчок', push: 3, once: true }, from: a.from });
  if (res.man === 'Устрашающая атака') saveRequest(tid, { n: 'Устрашающая атака', who: me_.name, abil: 'wis', dc: res.manDC, fail: { n: 'Испуг', ic: '😱', cond: 'frightened', until: R1 } });
  if (res.man === 'Отвлекающий удар') addEffect(tid, { n: 'Отвлечён', ic: '👀', lit: true, by: user.uid, from: a.from, until: R1 });
  if (res.man === 'Обезоруживающая атака') saveRequest(tid, { n: 'Обезоруживающая атака (роняет предмет)', who: me_.name, abil: 'str', dc: res.manDC });
  if (res.man) a.man = '';
  // «Отталкивающий взрыв»: цель Большая или меньше отлетает на 10 фт
  if (res.repel && small) addEffect(tid, { n: 'Отталкивающий взрыв', push: 2, once: true, from: a.from, by: user.uid });
  if (res.smite) a.smite = '';
  // Приёмы оружия (2024) и эффекты атак чудовищ
  const mk = res.mastery, round = inFight() ? game.init.round || 1 : 0;
  if (res.hit && mk === 'topple') saveRequest(tid, { n: 'Опрокидывание', who: me_.name, abil: 'con', dc: res.mdc, fail: { n: 'Опрокидывание', cond: 'prone', once: true } });
  if (res.hit && mk === 'sap') addEffect(tid, { n: 'Ослабление', ic: '💫', sap: true, by: user.uid, from: a.from });
  if (res.hit && mk === 'push' && (T.size || 1) <= 2) addEffect(tid, { n: 'Толчок (приём)', push: 2, once: true, by: user.uid, from: a.from });
  if (res.hit && res.dmg && mk === 'vex') addEffect(a.from, { n: 'Досаждение', ic: '🎯', vex: tid, by: user.uid, from: a.from });
  if (res.hit && res.dmg && mk === 'slow') addEffect(tid, { n: 'Замедление (приём)', ic: '🐢', spd: -10, by: user.uid, from: a.from, until: round || null });
  if (!res.hit && mk === 'graze' && res.mmod > 0)
    addLog({ kind: 'atk', who: me_.name, txt: `${A.n} — Задевание`, tgt: tid, tgtName: T.name, total: res.total, ac, hit: false, graze: true, dmg: res.mmod, dtype: res.type, from: a.from });
  if (res.hit && A.on && A.on.cond) {
    const fail = { n: A.n, ic: '⛓', cond: A.on.cond, once: !A.on.rep && A.on.cond === 'prone' };
    if (A.on.save) saveRequest(tid, { n: `${me_.name}: ${A.n}`, who: me_.name, abil: A.on.save, dc: A.on.dc, fail, rep: A.on.rep ? { abil: A.on.save, dc: A.on.dc } : null, from: a.from });
    else addEffect(tid, { ...fail, by: user.uid, from: a.from });
  }
  spendAttack(a, { ...(res.sneak ? { sa: 1 } : {}), ...(res.smite ? { b: 1 } : {}) });
}
// Расход: первая атака тратит действие (остаток Дополнительной атаки — в atk), бонусное действие или реакцию;
// extra — отметки хода (Скрытая атака была, Божественная кара заняла бонусное действие)
function spendAttack(a, extra) {
  const upd = { ...extra };
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

/* ---------- Реакции ---------- */
// «Контрзаклинание» (2024): реакция на сотворение заклинания в 60 фт — заклинатель делает спасбросок Телосложения против СЛ
// прерывающего; провал — заклинание не срабатывает, а его ячейка не тратится. Пока враги решают, заклинание ждёт.
// games/{id}/cs/{key}: { by, caster, n, lvl, t, cands: { tokenId: 1 } — кто может прервать, no: { tokenId: 1 } — отказались,
//   res: countered | resisted, who }
const CS_WAIT = 20000;
const canCounter = (o) => (o.kind === 'npc' ? (+o.cs || 0) > 0 : !o.comp && !!((game.members[o.owner] || {}).char || {}).cs);
function csCands(casterId) {
  const src = game.tokens[casterId];
  if (!src || !inFight()) return [];
  return Object.entries(game.tokens).filter(([k, o]) => k !== casterId && hostile(src, o) && !incapTok(o) && !econ(k).r && distFt(src, o) <= 60 && canCounter(o)).map(([k]) => k);
}
let csWait = null; // моё заклинание ждёт ответа врагов: { k, go, stop, timer }
function csGate(casterId, n, lvl, go, stop) {
  const cands = csCands(casterId);
  if (!cands.length) { go(); return; }
  const k = R.push(ref(gpath('cs'))).key;
  csWait = { k, go, stop, timer: setTimeout(() => csFinish(true), CS_WAIT) };
  R.set(ref(gpath(`cs/${k}`)), { by: user.uid, caster: casterId, n, lvl: +lvl || 0, t: Date.now(), cands: Object.fromEntries(cands.map((x) => [x, 1])) }).catch(() => csFinish(true));
  app.toast(`⏳ ${esc(n)}: враги рядом могут ответить «Контрзаклинанием»…`);
  renderAll();
}
function csFinish(ok) {
  const w = csWait;
  if (!w) return;
  csWait = null;
  clearTimeout(w.timer);
  R.remove(ref(gpath(`cs/${w.k}`))).catch(() => {});
  if (ok) w.go(); else w.stop();
  renderAll();
}
// Браузер заклинателя: все отказались или заклинание устояло — срабатывает; прервано — пропадает
function csCheck() {
  if (isDM()) Object.entries(game.cs || {}).forEach(([k, r]) => { if (Date.now() - (r.t || 0) > 3 * CS_WAIT) R.remove(ref(gpath(`cs/${k}`))).catch(() => {}); });
  if (!csWait) return;
  const r = (game.cs || {})[csWait.k];
  if (!r) return;
  if (r.res === 'countered') { app.toast(`🚫 «${esc(r.n)}» прервано: ${esc(r.who || '')}`, 'fumble'); csFinish(false); }
  else if (r.res === 'resisted' || Object.keys(r.cands || {}).every((id) => (r.no || {})[id] || !game.tokens[id])) csFinish(true);
}
// Мои запросы: кто из моих существ может прервать заклинание
const csMine = () => Object.entries(game.cs || {}).filter(([, r]) => !r.res && Date.now() - (r.t || 0) < CS_WAIT + 3000)
  .flatMap(([k, r]) => Object.keys(r.cands || {}).filter((id) => !(r.no || {})[id] && game.tokens[id] && canMove(game.tokens[id]) && r.by !== user.uid).map((id) => ({ k, r, id })));
const csNotified = new Set();
function notifyCs() {
  csMine().forEach(({ k, r, id }) => {
    if (csNotified.has(k + id)) return;
    csNotified.add(k + id);
    app.toast(`🚫 ${esc((game.tokens[r.caster] || {}).name || '')} творит «${esc(r.n)}» — ${esc(game.tokens[id].name)} может ответить «Контрзаклинанием»`, 'crit');
    setTimeout(renderAll, CS_WAIT + 3500); // убрать просроченный запрос из панели
  });
}
function csUse(k, id) {
  const r = (game.cs || {})[k], t = game.tokens[id], src = r && game.tokens[r.caster];
  if (!r || r.res || !t || !src) return;
  let dc, how = '';
  if (t.kind === 'npc') { dc = +t.sdc || 13; R.update(ref(gpath(`tokens/${id}`)), { cs: Math.max(0, (+t.cs || 0) - 1) }).catch(() => {}); }
  else {
    const m = me(), c = m && m.charId && app.castReaction(m.charId, 'Counterspell');
    if (!c) { app.toast('Нет ячейки для «Контрзаклинания»'); return; }
    dc = c.dc; how = ` (${c.how})`;
  }
  if (inFight()) R.update(ref(gpath(`econ/${id}`)), { r: 1 }).catch(() => {});
  const bonus = src.kind === 'pc' && !src.comp ? +((game.members[src.owner] || {}).char || {}).svc || 0 : +((src.sv || {}).con) || 0;
  const d = die(20), total = d + bonus, ok = d !== 1 && total >= dc;
  R.update(ref(gpath(`cs/${k}`)), { res: ok ? 'resisted' : 'countered', who: t.name }).catch(() => {});
  addLog({ kind: 'act', who: t.name, txt: `🚫 «Контрзаклинание»${how} против «${r.n}» (${src.name}): спасбросок Телосложения ${total} против СЛ ${dc} — ${ok ? 'заклинание устояло' : `заклинание рассеяно${r.lvl ? ', ячейка заклинателя не потрачена' : ''}`}`,
    detail: `к20 [${d}] ${fmtMod(bonus)}` });
}
// Реакции персонажа на попадание по нему (lastHit) и по союзнику рядом (lastAllyHit): возврат урона идёт как лечение
const PHYS = /колющ|рубящ|дробящ/i;
function reactionsHtml(id, t, e, incap) {
  const m = me();
  if (isDM() || !m || !m.charId || e.r || incap) return '';
  const O = app.combatOpts(m.charId), fresh = (h) => h && Date.now() - h.t < 90000, out = [];
  const btn = (a, label, title, extra = '') => `<button class="primary" data-tbl="${a}" data-id="${id}" title="${title}" ${extra}>${label}</button>`;
  if (fresh(lastHit) && lastHit.tgt === id) {
    const H = lastHit, src = game.tokens[H.from];
    if ((O.shieldSlots || []).length && H.total < acOf(t, id) + 5) out.push(btn('shield', `🛡 «Щит»: отменить попадание (${H.total} против КД ${acOf(t, id) + 5})`, 'Реакция: +5 КД до начала вашего хода, тратит ячейку'));
    if (O.uncanny && H.dmg > 1) out.push(btn('uncanny', `🌀 Невероятное уклонение: урон ${H.dmg} → ${Math.floor(H.dmg / 2)}`, 'Плут: реакцией уменьшить вдвое урон от попавшей атаки'));
    if (O.deflect && H.dmg && (O.deflect.any || PHYS.test(H.dtype))) out.push(btn('deflect', `🥋 Отражение атак (−1к10+${O.deflect.dex}+ур.)`, 'Монах: урон уменьшается; если до нуля — можно перенаправить за 1 очко сосредоточенности'));
    if ((O.rebukeSlots || []).length && src && distFt(t, src) <= 60) out.push(btn('rebuke', `🔥 «Адское возмездие» по ${esc(src.name)}`, 'Реакция на урон: спасбросок Ловкости, 2к10 огнём (+1к10 за уровень ячейки выше 1), половина при успехе'));
  }
  if (fresh(lastAllyHit) && O.protection && game.tokens[lastAllyHit.tgt] && distFt(t, game.tokens[lastAllyHit.tgt]) <= 5)
    out.push(btn('protect', `🛡 «Защита»: помеха на атаку по ${esc(game.tokens[lastAllyHit.tgt].name)}`, 'Боевой стиль: реакцией со щитом — атака перебрасывается с помехой, и до начала вашего хода атаки по союзнику с помехой'));
  return out.length ? `<div class="react-box mt"><div class="muted small">Реакция:</div>${out.join('')}</div>` : '';
}
// Вернуть часть урона цели (отменённое попадание, уменьшение урона): лечение применяет владелец цели
function refund(tid, n, who, txt) {
  const t = game.tokens[tid];
  if (!t || !(n > 0)) return;
  addLog({ kind: 'heal', who, txt, tgt: tid, tgtName: t.name, heal: n });
}
function doReaction(a, id) {
  const t = game.tokens[id], m = me();
  if (!t || !m || !m.charId) return;
  const H = lastHit, O = app.combatOpts(m.charId), spendR = () => (inFight() ? R.update(ref(gpath(`econ/${id}`)), { r: 1 }).catch(() => {}) : null);
  if (a === 'uncanny' && H) {
    const back = H.dmg - Math.floor(H.dmg / 2);
    spendR(); refund(id, back, t.name, `🌀 Невероятное уклонение: урон вдвое меньше (${H.dmg} → ${H.dmg - back})`);
    lastHit = null;
  } else if (a === 'deflect' && H) {
    const r = app.mute(() => app.deflect(m.charId));
    if (!r) return;
    const back = Math.min(H.dmg, r.total), src = game.tokens[H.from];
    spendR(); refund(id, back, t.name, `🥋 Отражение атак: урон ${H.dmg} → ${H.dmg - back}`);
    addLog({ kind: 'act', who: t.name, txt: `🥋 Отражение атак: −${r.total}`, detail: r.detail });
    // Урон погашен полностью: за 1 очко сосредоточенности — в атакующего (рядом — рукопашная, иначе до 60 фт)
    if (back >= H.dmg && src && distFt(t, src) <= 60 && O.deflect.focus > 0 && app.confirm(`Урон погашен. Перенаправить атаку в «${src.name}» за 1 очко сосредоточенности?`)
      && app.spendFocus(m.charId)) {
      const f = rollExpr(`2d${O.deflect.die}+${O.deflect.dex}`);
      saveRequest(H.from, { n: `${t.name}: Отражение атак`, who: t.name, abil: 'dex', dc: O.deflect.dc, dmg: f.total, dmgDetail: f.detail, dtype: H.dtype, from: id });
      addLog({ kind: 'act', who: t.name, txt: `🥋 перенаправляет атаку в ${src.name}: спасбросок Ловкости СЛ ${O.deflect.dc}, иначе ${f.total} ${H.dtype || 'урона'}`, detail: f.detail });
    }
    lastHit = null;
  } else if (a === 'rebuke' && H) {
    const src = game.tokens[H.from], c = src && app.mute(() => app.castReaction(m.charId, 'Hellish Rebuke'));
    if (!c) return;
    const f = rollExpr(`${1 + (c.castLvl || 1)}d10`);
    spendR();
    saveRequest(H.from, { n: `${t.name}: «Адское возмездие»`, who: t.name, abil: 'dex', dc: c.dc, dmg: f.total, half: true, dmgDetail: f.detail, dtype: 'огнём', from: id });
    addLog({ kind: 'act', who: t.name, txt: `🔥 «Адское возмездие» (${c.how}) → ${src.name}: спасбросок Ловкости СЛ ${c.dc}, ${f.total} огнём, половина при успехе`, detail: f.detail });
    lastHit = null;
  } else if (a === 'protect' && lastAllyHit) {
    // Помеха задним числом: второй к20, берётся меньший — то же самое, что бросок с помехой
    const P = lastAllyHit, T = game.tokens[P.tgt], d = die(20), nat = Math.min(P.nat, d), total = P.total - P.nat + nat;
    const hit = nat !== 1 && (nat === 20 || total >= (+P.ac || 0));
    spendR();
    addEffect(P.tgt, { n: 'Защита', ic: '🛡', prot: true, untilTurn: id, by: user.uid, from: id });
    addLog({ kind: 'act', who: t.name, txt: `🛡 «Защита»: атака по ${T.name} с помехой — второй к20 [${d}], итог ${total}${P.ac ? ` против КД ${P.ac}` : ''}: ${hit ? 'всё равно попадание' : 'промах'}` });
    if (!hit) refund(P.tgt, P.dmg, t.name, '🛡 «Защита»: попадание отменено');
    lastAllyHit = null;
  }
  renderAll();
}

/* ---------- Области заклинаний и спасброски ---------- */
// games/{id}/areas/{key}: { by, who, n, shape: sphere | cone | line | cube | aura | target, size, width, ox, oy, ang, from, tgt, color,
//   abil, dc, half, expr, dmg, dtype, keep, t, tg: { tokenId: { done, ok, roll, dmg } } }
// Координаты в клетках (дробные): ox, oy — точка начала, ang — направление. Аура следует за существом from.
const AB_N = { str: 'Силы', dex: 'Ловкости', con: 'Телосложения', int: 'Интеллекта', wis: 'Мудрости', cha: 'Харизмы' };
const SHAPE_N = { sphere: 'сфера', cone: 'конус', line: 'линия', cube: 'куб', aura: 'вокруг себя', target: 'одна цель' };
const CONE_HALF = Math.atan(0.5); // ширина конуса равна расстоянию от точки начала
const AUTO_FAIL_T = ['paralyzed', 'stunned', 'unconscious', 'petrified'];


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
  if (A.shape === 'target') return (A.tgts && A.tgts.length ? A.tgts : A.tgt ? [A.tgt] : []).filter((id) => game.tokens[id]);
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
      (A.tgts && A.tgts.length ? A.tgts : [A.tgt]).forEach((id) => {
        const t = game.tokens[id];
        if (t) { const s = (t.size || 1) * CELL; g.beginPath(); g.arc(t.x * CELL + s / 2, t.y * CELL + s / 2, s / 2 + 4, 0, Math.PI * 2); g.stroke(); }
      });
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
  if (A.shape === 'target') { const ids = areaTokens(A); return ids.length > 0 && ids.every((id) => distFt(src, game.tokens[id]) <= cast.range); }
  const cx = A.shape === 'cube' ? A.ox + A.size / 10 : A.ox;
  return distFt(src, { x: Math.floor(cx - 0.001), y: Math.floor(A.oy - 0.001), size: 1 }) <= cast.range
    || distFt(src, { x: Math.floor(cx), y: Math.floor(A.oy), size: 1 }) <= cast.range;
}
function castHint(e) {
  const A = cast.area, n = areaTokens(A).length;
  hint(A.tgts ? `цели ${A.tgts.length}/${cast.info.nT} — нажмите на существо` : A.shape === 'target' ? (A.tgt ? `${game.tokens[A.tgt].name}${castInRange() ? '' : ' — слишком далеко'}` : 'выберите цель')
    : `${castInRange() ? '' : 'слишком далеко · '}в области: ${n}`, e);
}
function startCast(c) {
  const I = c.info;
  cast = { ...c, self: !!I.self, range: I.range || 0,
    area: { n: I.n, shape: I.shape, size: I.size, width: I.width || 5, color: colorFor(I.dtype), from: I.shape === 'aura' ? c.caster : null } };
  if (I.shape === 'aura') { cast.area.ox = 0; confirmCast(); return; }
  if (I.shape === 'target' && (I.nT || 1) > 1) cast.area.tgts = [];
  aim = null;
  renderAll();
  app.toast(I.shape === 'target' ? `✨ ${esc(I.n)}: ${(I.nT || 1) > 1 ? `выберите до ${I.nT} целей и нажмите «Готово»` : 'нажмите на цель'}` : `✨ ${esc(I.n)}: наведите область и нажмите на поле · Esc — отмена`);
}
function cancelCast() { cast = null; hint(''); renderAll(); }
// Игрок: список заклинаний с областью/спасброском → ячейка → размещение
function openCast(id) {
  const m = me(), e = econ(id), turn = isTurnOf(id);
  if (!m || !m.charId) return;
  const list = app.areaSpells(m.charId, Object.keys(SPELL_FX));
  const can = (act) => !inFight() || (act === 'reaction' ? !e.r : turn && (act === 'bonus' ? !e.b : !e.a && !(e.atk > 0)));
  const ACT_N = { action: 'действие', bonus: 'бонусное', reaction: 'реакция' };
  const what = (s) => {
    const F = SPELL_FX[s.e];
    if (F && F.heal) return ` · лечение ${esc(s.f)}${s.addMod ? '+мод.' : ''}${F.n ? `, до ${F.n} существ` : ''}`;
    if (F && F.fx) return ` · ${esc(F.fx.n)}${(F.n || 1) > 1 ? `, до ${F.n} целей` : ''}`;
    return `${s.save ? ` · спасбросок ${AB_N[s.save]} СЛ ${s.dc}` : ''}${s.f ? ` · ${esc(s.f)}${s.dtype ? ' ' + esc(s.dtype) : ''}` : ''}${F && F.fail && F.fail.cond ? ` · ${condName(F.fail.cond).toLowerCase()}` : ''}`;
  };
  app.openModal(`<h2>✨ Заклинание</h2>
    <div class="list">${list.map((s) => `<button class="atk-pick" data-sp="${esc(s.id)}" ${can(s.act) ? '' : 'disabled'}>
      <b>${esc(s.n)} <span class="muted small">${s.l ? `${s.l} ур.` : 'заговор'}</span></b>
      <span class="muted small">${SHAPE_N[s.shape]}${s.size ? ` ${s.size} фт` : ''}${s.range ? ` · дистанция ${s.range} фт` : s.self ? ' · от себя' : ''}${what(s)} · ${ACT_N[s.act]}</span></button>`).join('')
      || '<p class="muted">Нет подготовленных заклинаний, которые можно применить на столе.</p>'}</div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  $$('[data-sp]').forEach((b) => b.addEventListener('click', () => {
    const I = list.find((x) => x.id === b.dataset.sp), F = SPELL_FX[I.e];
    // Число целей растёт с уровнем ячейки («Благословение»: 3 + 1 за уровень выше 1)
    const go = (slotKey, lvl) => {
      app.closeModal();
      const nT = F && I.shape === 'target' ? (F.n || 1) + Math.max(0, (lvl || I.l) - I.l) * (F.up || 0) : 1;
      startCast({ info: { ...I, fxDef: F || null, nT, pick: I.pick || !!(F && F.heal) }, caster: id, charId: m.charId, slotKey, lvl: lvl || I.l });
    };
    const slots = I.slots.filter((s) => s.left > 0);
    if (!I.l) { go('free', 0); return; }
    if (!slots.length) { app.toast('Нет свободных ячеек'); return; }
    $('#modalBody').innerHTML = `<h2>${esc(I.n)}</h2><p class="muted small">Выберите ячейку${I.u ? ` — выше уровня: +${esc(I.u)} за уровень` : ''}${F && F.up ? ` — выше уровня: +${F.up} цель за уровень` : ''}.</p>
      <div class="slot-choice">${slots.map((s) => `<button data-slot="${s.key}" data-lvl="${s.lvl}">${esc(s.label)}</button>`).join('')}</div>
      <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`;
    $$('[data-slot]').forEach((x) => x.addEventListener('click', () => go(x.dataset.slot, +x.dataset.lvl)));
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
    <label class="check"><input type="checkbox" id="aK"> Оставить на поле</label>
    <label class="check" title="Персонажи рядом смогут прервать его «Контрзаклинанием»"><input type="checkbox" id="aSp"> Заклинание выделенного существа</label>
    <label>Уровень заклинания<input id="aL" type="number" min="0" max="9" value="3"></label></div>
    <p class="muted small">Конус, линия и «вокруг себя» исходят от выбранного на поле существа — сначала выделите его. Заклинание тоже творит выделенное существо.</p>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="aOk">Разместить</button></div>`);
  $('#aOk').onclick = () => {
    const shape = $('#aS').value, abil = $('#aA').value;
    const needSrc = shape === 'cone' || shape === 'line' || shape === 'aura', spell = $('#aSp').checked;
    if ((needSrc || spell) && !(selId && game.tokens[selId])) { app.toast('Выделите существо-источник на поле'); return; }
    const info = { n: $('#aN').value.trim() || 'Область', shape, size: Math.max(5, +$('#aZ').value || 5), width: 5, save: abil, dc: +$('#aD').value || 10,
      f: $('#aF').value.trim(), dtype: $('#aT').value.trim(), half: $('#aH').checked, keepAlways: $('#aK').checked, self: needSrc,
      spell: spell ? Math.max(1, +$('#aL').value || 1) : 0 };
    app.closeModal();
    startCast({ dm: true, caster: needSrc || spell ? selId : null, info });
  };
}
function confirmCast() {
  const A = cast.area, I = cast.info;
  if (!castInRange()) { app.toast(`Слишком далеко: дистанция ${cast.range} фт`); return; }
  const ids = areaTokens(A);
  if (A.shape === 'target' && !ids.length) return;
  // Область задевает всех, кто в ней, включая союзников. Исключение — заклинания, где цели выбирает заклинатель
  // («враги», «существа по вашему выбору»): для них галочки, по умолчанию отмечены только враги.
  const tok = (id) => game.tokens[id], src = cast.caster && tok(cast.caster);
  const allies = src ? ids.filter((id) => team(tok(id)) === team(src)) : [];
  const pick = !!I.pick && A.shape !== 'target';
  // Лечение и баффы — для своих: предупреждение об уроне союзникам не нужно, по умолчанию отмечены союзники
  const F = I.fxDef, friendly = !!(F && (F.heal || F.fx));
  const nameHtml = (id) => `${esc(tok(id).name)}${allies.includes(id) && !friendly ? ' (союзник)' : ''}`;
  const descr = friendly ? (F.heal ? `Лечение ${esc(I.f)}${I.addMod ? ' + модификатор' : ''}` : `${esc(F.fx.n)}${I.cn ? ' · концентрация' : ''}`)
    : `${I.save ? `Спасбросок <b>${AB_N[I.save]}</b>, СЛ <b>${I.dc}</b>` : 'Без спасброска'}${I.f ? ` · ${esc(I.f)} ${esc(I.dtype || '')}${I.save ? (I.half ? ', половина при успехе' : ', при успехе — без урона') : ''}` : ''}${F && F.fail && F.fail.cond ? ` · при провале: ${condName(F.fail.cond).toLowerCase()}` : ''}`;
  app.openModal(`<h2>✨ ${esc(I.n)}</h2>
    <p class="small">${descr}</p>
    ${!ids.length ? '<p class="muted">В области никого нет.</p>'
      : pick ? `<div class="atk-ways">${ids.map((id) => `<label class="check"><input type="checkbox" data-tg="${id}" ${allies.includes(id) === friendly ? 'checked' : ''}> ${nameHtml(id)}</label>`).join('')}</div>
        <p class="muted small">Это заклинание затрагивает только выбранных вами существ${F && F.n ? ` (не больше ${F.n})` : ''}.</p>`
      : friendly ? `<p>Цели: ${ids.map((id) => `<b>${esc(tok(id).name)}</b>`).join(', ')}</p>`
      : `<p>Задевает: ${ids.map((id) => `<b class="${allies.includes(id) ? 'warn-text' : ''}">${esc(tok(id).name)}${allies.includes(id) ? ' (союзник!)' : ''}</b>`).join(', ')}</p>
        ${allies.length ? '<p class="small warn-text">⚠ В области союзники — они тоже получат урон.</p>' : ''}`}
    <div class="modal-actions"><button id="cBack">Назад</button><button class="primary" id="cOk">✨ Сотворить</button></div>`);
  $('#cBack').onclick = () => { app.closeModal(); if (A.shape === 'aura') cancelCast(); };
  $('#cOk').onclick = () => {
    let chosen = pick ? $$('[data-tg]').filter((x) => x.checked).map((x) => x.dataset.tg) : ids;
    if (F && F.n && A.shape !== 'target' && chosen.length > F.n) { app.toast(`Не больше ${F.n} существ`); chosen = chosen.slice(0, F.n); }
    app.closeModal();
    doCastArea(chosen);
  };
}
function doCastArea(chosen, gated) {
  const A = cast.area, I = cast.info, c = cast;
  // Заклинание (из листа или помеченное у существа) можно прервать «Контрзаклинанием»: сначала ждём реакции врагов рядом.
  // Ячейка тратится, только если заклинание сработало; при провале прерывания действие всё равно потрачено
  if (!gated && c.caster && (c.charId || I.spell)) {
    cast = null; hint(''); renderAll();
    csGate(c.caster, I.n, c.lvl || I.l || I.spell || 0, () => {
      cast = c;
      doCastArea(chosen.filter((id) => game.tokens[id]), true);
    }, () => castSpend(c));
    return;
  }
  let roll = null;
  if (c.charId) { roll = app.mute(() => app.castArea(c.charId, I.id, c.slotKey)); if (!roll) { cancelCast(); return; } }
  else if (I.f) roll = app.mute(() => app.rollFormula(I.f, I.n));
  const src = c.caster && game.tokens[c.caster], F = I.fxDef || null, names = chosen.map((id) => game.tokens[id].name).join(', ');
  const lvlTxt = roll && roll.castLvl > I.l ? ` (${roll.castLvl} ур.)` : '', who = src ? src.name : 'Мастер';
  const spend = () => castSpend(c);
  const until = inFight() ? (game.init.round || 1) + durRounds(I.dur) : null, conc = I.cn ? c.caster : null;
  // Лечение: всем выбранным столько, сколько выпало; применяют владельцы целей
  if (F && F.heal) {
    const amt = roll ? roll.dmg || 0 : 0;
    chosen.forEach((id) => addLog({ kind: 'heal', who, txt: I.n + lvlTxt, tgt: id, tgtName: game.tokens[id].name, heal: amt, from: c.caster, detail: roll ? roll.dmgDetail : '' }));
    if (A.shape !== 'target') addLog({ kind: 'area', who, txt: `✨ ${I.n}${lvlTxt}: +${amt} хитов · ${names}`, fx: fxShape({ ...A, color: '#5a9e5a' }) });
    spend(); cast = null; hint(''); renderAll();
    return;
  }
  // Бафф без спасброска: эффект на каждую цель; при концентрации пропадёт вместе с ней
  if (F && F.fx) {
    chosen.forEach((id) => addEffect(id, { ...F.fx, by: user.uid, from: c.caster, spell: I.n, conc, until }));
    addLog({ kind: 'area', who, txt: `✨ ${I.n}${lvlTxt}: ${names || 'нет целей'}` });
    spend(); cast = null; hint(''); renderAll();
    return;
  }
  // Область на поле остаётся, если заклинание длится; одиночные цели с эффектом держатся эффектом, а не областью
  const keep = c.dm ? !!I.keepAlways : (!!I.cn || !/мгновен/i.test(I.dur || '')) && A.shape !== 'target';
  const entry = { ...A, by: user.uid, who, n: I.n + lvlTxt, abil: I.save || '', dc: I.dc || 0, half: !!I.half,
    expr: (roll && roll.expr) || I.f || '', dmg: roll ? roll.dmg || roll.total || 0 : 0, dmgDetail: roll ? roll.dmgDetail || roll.detail || '' : '', dtype: I.dtype || '', keep, t: Date.now(),
    pick: !!I.pick, ck: src ? team(src) : '', from: c.caster || null, spell: I.n, conc, until,
    fail: F && F.fail ? F.fail : null, rep: F && F.rep && I.save ? { abil: I.save, dc: I.dc } : null };
  if (I.save && chosen.length) entry.tg = Object.fromEntries(chosen.map((id) => [id, { done: false }]));
  const k = R.push(ref(gpath('areas'))).key;
  R.set(ref(gpath(`areas/${k}`)), Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== undefined)))
    .catch((err) => app.toast(`Не удалось создать область: ${esc(err.code || err.message)}`));
  spend();
  // Способность существа с перезарядкой (дыхание) — до броска к6 в начале его хода
  if (c.npcAct != null && src && ((src.acts || [])[c.npcAct] || {}).rech) R.update(ref(gpath(`tokens/${c.caster}/rech`)), { [c.npcAct]: 1 }).catch(() => {});
  addLog({ kind: 'area', who: entry.who, txt: `✨ ${entry.n}${entry.dmg ? ` — ${entry.dmg} ${entry.dtype || ''}` : ''}${I.save ? ` · спасбросок ${AB_N[I.save]} СЛ ${entry.dc}` : ''}${chosen.length ? ` · цели: ${chosen.map((id) => game.tokens[id].name).join(', ')}` : ''}`,
    detail: entry.dmgDetail, fx: fxShape(entry) });
  if (!keep && !entry.tg) setTimeout(() => R.remove(ref(gpath(`areas/${k}`))).catch(() => {}), 8000);
  cast = null; hint('');
  renderAll();
}
// Расход действия на сотворение (легендарное действие оплачено при выборе)
function castSpend(c) {
  const I = c.info;
  if ((c.charId || c.npcAct != null) && inFight() && I.act !== 'legend')
    R.update(ref(gpath(`econ/${c.caster}`)), { [I.act === 'bonus' ? 'b' : I.act === 'reaction' ? 'r' : 'a']: 1 }).catch(() => {});
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
  const dexAdv = A.abil === 'dex' && (econ(tid).dodge || fxOf(tid).some(([, e]) => e.dexAdv));
  // Спутник бросает свой спасбросок (из статблока зверя), урон — в его карточку
  const r = t.comp ? (() => { const d = die(20), b = +((t.sv || {})[A.abil]) || 0; return { total: d + b, ok: d + b >= A.dc, detail: `к20 [${d}] ${fmtMod(b)}` }; })()
    : app.mute(() => app.rollSave(m.charId, A.abil, A.dc, { label: A.n, adv: dexAdv ? ['Уклонение / Ускорение'] : [], dice: fxDice(tid) }));
  if (!r) return;
  const dmg = saveDmg(A, r.ok, !t.comp && (app.summary(m.charId) || {}).evasion);
  R.update(ref(gpath(`areas/${k}/tg/${tid}`)), { done: true, ok: r.ok, roll: r.total, dmg }).catch(() => {});
  if (dmg) { if (t.comp) app.compHp(m.charId, t.comp, -dmg); else app.takeDamage(m.charId, dmg); }
  saveOutcome(A, tid, r.ok);
  addLog({ kind: 'save', who: t.name, txt: `${A.n}: спасбросок ${AB_N[A.abil]} ${r.total} — ${r.ok ? 'успех' : 'провал'}${dmg ? `, ${dmg} ${A.dtype || 'урона'}` : ', без урона'}`, detail: r.detail,
    res: [{ id: tid, dmg, ok: r.ok }] });
  finishArea(k, [tid]);
}
// Итог спасброска против эффекта: провал — состояние/эффект; успех повторного спасброска — эффект снимается
function saveOutcome(A, tid, ok) {
  if (!ok && A.fail) applyFail(A, tid);
  if (ok && A.rem) R.remove(ref(gpath(`effects/${A.rem}`))).catch(() => {});
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
  const upd = {}, parts = [], res = [];
  ids.forEach((id) => {
    const t = game.tokens[id], cond = t.cond || [], bonus = +((t.sv || {})[A.abil]) || 0;
    let ok, total, note = '';
    if ((A.abil === 'str' || A.abil === 'dex') && ((t.hpMax && (+t.hp || 0) <= 0) || cond.some((x) => AUTO_FAIL_T.includes(x)))) { ok = false; total = '—'; note = ' (автопровал)'; }
    else {
      const dexAdv = A.abil === 'dex' && (econ(id).dodge || fxOf(id).some(([, e]) => e.dexAdv));
      const mode = (dexAdv ? 1 : 0) - (cond.includes('restrained') && A.abil === 'dex' ? 1 : 0);
      const d1 = die(20), d2 = die(20), nat = mode > 0 ? Math.max(d1, d2) : mode < 0 ? Math.min(d1, d2) : d1;
      const ex = fxDice(id).map((x) => { const neg = String(x.e).startsWith('-'), r = rollExpr(String(x.e).replace(/^[+-]/, '')); return neg ? -r.total : r.total; });
      total = nat + bonus + ex.reduce((s, v) => s + v, 0); ok = total >= A.dc;
      if (mode) note = mode > 0 ? ` (преим. ${d1}, ${d2})` : ` (помеха ${d1}, ${d2})`;
      if (ex.length) note += ` (${ex.map((v) => (v >= 0 ? `+${v}` : `−${-v}`)).join(' ')})`;
    }
    // Легендарное сопротивление: провал превращается в успех — тратится только против состояний и эффектов, не ради половины урона
    const lr = +t.lr || 0;
    if (!ok && A.fail && lr > 0) { ok = true; upd[`tokens/${id}/lr`] = lr - 1; note += ` → 👑 Легендарное сопротивление (осталось ${lr - 1})`; }
    saveOutcome(A, id, ok);
    const dmg = saveDmg(A, ok, false), du = dmg ? npcDamageUpd(id, t, dmg, false) : {};
    const after = { ...t, hp: du[`tokens/${id}/hp`] ?? t.hp, dsF: du[`tokens/${id}/dsF`] ?? t.dsF }, died = !!dmg && isDead(after) && !isDead(t);
    upd[`areas/${k}/tg/${id}`] = { done: true, ok, roll: total, dmg };
    Object.assign(upd, du);
    res.push({ id, dmg, ok, down: died });
    parts.push(`${t.name} ${total}${note} ${ok ? '✔' : '✘'}${dmg ? ` −${dmg}` : ''}${died ? ' ☠' : dmg && isDown(after) ? ' (без сознания)' : ''}`);
  });
  R.update(ref(gpath()), upd).catch((err) => app.toast(`Ошибка: ${esc(err.code || err.message)}`));
  addLog({ kind: 'save', who: '', txt: `${A.n} — спасброски ${AB_N[A.abil]} (СЛ ${A.dc}): ${parts.join('; ')}`, res });
  finishArea(k, ids);
}
// Повторное срабатывание (Духовные стражи, Лунный луч…): новый бросок урона и спасброски для тех, кто сейчас в области
function areaAgain(k) {
  const A = game.areas[k];
  if (!A) return;
  // Для заклинаний с выбором целей снова срабатывает только по врагам заклинателя
  const r = A.expr ? app.mute(() => app.rollFormula(A.expr, A.n)) : null, ids = areaTokens(A).filter((id) => !A.pick || !A.ck || team(game.tokens[id]) !== A.ck);
  if (!ids.length) { app.toast('В области никого нет'); return; }
  R.update(ref(gpath(`areas/${k}`)), { dmg: r ? r.total : 0, dmgDetail: r ? r.detail : '', tg: Object.fromEntries(ids.map((id) => [id, { done: false }])) });
  addLog({ kind: 'area', who: A.who, txt: `⟳ ${A.n}${r ? ` — ${r.total} ${A.dtype || ''}` : ''} · цели: ${ids.map((id) => game.tokens[id].name).join(', ')}`, detail: r ? r.detail : '', fx: fxShape(A) });
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
  // «Контрзаклинание»: запрос моим существам и ожидание моего заклинания
  csMine().forEach(({ k, r, id }) => rows.push(`<div class="sv-area cs-ask"><div>🚫 <b>${esc((game.tokens[r.caster] || {}).name || '')}</b> творит «${esc(r.n)}»${r.lvl && !/ур\./.test(r.n) ? ` (${r.lvl} ур.)` : ''}</div>
    <div class="row between mt"><span>${esc(game.tokens[id].name)}: «Контрзаклинание»?${game.tokens[id].kind === 'npc' ? ` <span class="muted small">осталось ${+game.tokens[id].cs || 0}, СЛ ${+game.tokens[id].sdc || 13}</span>` : ''}</span>
      <span><button class="primary" data-tbl="csUse" data-k="${k}" data-id="${id}">Прервать</button><button data-tbl="csNo" data-k="${k}" data-id="${id}">Нет</button></span></div></div>`));
  if (csWait) rows.push(`<div class="sv-area"><div>⏳ Ваше заклинание ждёт: враги рядом решают, прерывать ли его (до ${CS_WAIT / 1000} с)</div></div>`);
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
  box.innerHTML = `<h3>Области, спасброски и реакции</h3>${rows.join('')}`;
}
function renderCastBar() {
  const bar = $('#tblCastBar');
  if (!bar) return;
  bar.hidden = !cast;
  if (!cast) return;
  const multi = cast.area.tgts;
  bar.innerHTML = `✨ <b>${esc(cast.info.n)}</b>: ${multi ? `цели ${multi.length}/${cast.info.nT}` : cast.area.shape === 'target' ? 'нажмите на цель' : 'наведите область и нажмите на поле'}
    <span>${multi && multi.length ? '<button class="primary" data-tbl="castDone">Готово</button>' : ''}<button data-tbl="castOff">Отмена</button></span>`;
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
  const mine = game.tokens[`pc_${user.uid}`];
  app.toast(mine && isDown(mine) && !isStable(mine) && !isDead(mine) ? '💀 Ваш ход: вы без сознания — бросьте спасбросок от смерти' : '⚔ Ваш ход!', 'crit');
  // С начала 2-го раунда каждый ваш ход сдвигает эффекты в листе на раунд
  if (game.init.round > 1) app.tickRound(m.charId);
}

/* ---------- Эффекты заклинаний, лечение и состояния ---------- */
// games/{id}/effects/{key}: { tgt, n, ic, by (uid), from (токен заклинателя), spell, conc (заклинатель держит концентрацию),
//   die ('1d4' / '-1d4' к атакам и спасброскам), ac, spd ('x2' | 'half' | число), dexAdv, lit (атаки по цели с преимуществом),
//   sap (помеха на следующую атаку цели), vex (преимущество на следующую атаку по этому токену), cond / cond2 (состояния,
//   пока эффект действует), once (только наложить состояние — эффект сразу снимается), rep ({ abil, dc } — повторный
//   спасбросок в конце хода цели), until (последний раунд) }
// Состояния накладывает и снимает браузер владельца цели: игрок — в своём листе, мастер — у существ.
// Таблица заклинаний: heal — лечение; n/up — сколько целей (и +за уровень ячейки); fx — бафф без спасброска;
// fail — что получает провалившая спасбросок цель; rep — повторный спасбросок в конце её хода
const SPELL_FX = {
  'Cure Wounds': { heal: 1 }, 'Healing Word': { heal: 1 }, 'Mass Healing Word': { heal: 1, n: 6 }, 'Mass Cure Wounds': { heal: 1, n: 6 }, 'Prayer of Healing': { heal: 1, n: 5 },
  'Bless': { n: 3, up: 1, fx: { n: 'Благословение', ic: '✨', die: '1d4' } },
  'Bane': { n: 3, up: 1, fail: { n: 'Порча', ic: '⬇', die: '-1d4' } },
  'Shield of Faith': { n: 1, fx: { n: 'Щит веры', ic: '🛡', ac: 2 } },
  'Haste': { n: 1, fx: { n: 'Ускорение', ic: '⚡', ac: 2, spd: 'x2', dexAdv: true } },
  'Slow': { n: 6, fail: { n: 'Замедление', ic: '🐌', ac: -2, spd: 'half' }, rep: true },
  'Hold Person': { n: 1, up: 1, fail: { n: 'Удержание', ic: '⛓', cond: 'paralyzed' }, rep: true },
  'Hold Monster': { n: 1, up: 1, fail: { n: 'Удержание', ic: '⛓', cond: 'paralyzed' }, rep: true },
  'Command': { n: 1, up: 1, fail: { n: 'Приказ «Пади»', cond: 'prone', once: true } },
  'Blindness/Deafness': { n: 1, up: 1, fail: { n: 'Слепота', ic: '🙈', cond: 'blinded' }, rep: true },
  'Cause Fear': { n: 1, up: 1, fail: { n: 'Страх', ic: '😱', cond: 'frightened' }, rep: true },
  'Hideous Laughter': { n: 1, fail: { n: 'Жуткий смех', ic: '😂', cond: 'incapacitated', cond2: 'prone' }, rep: true },
  "Tasha's Hideous Laughter": { n: 1, fail: { n: 'Жуткий смех', ic: '😂', cond: 'incapacitated', cond2: 'prone' }, rep: true },
  'Thunderwave': { fail: { n: 'Волна грома', push: 2, once: true } },
  'Entangle': { fail: { n: 'Опутывание', ic: '🌿', cond: 'restrained' } },
  'Web': { fail: { n: 'Паутина', ic: '🕸', cond: 'restrained' } },
  'Grease': { fail: { n: 'Скольжение', cond: 'prone', once: true } },
  'Hypnotic Pattern': { fail: { n: 'Гипнотический узор', ic: '🌀', cond: 'charmed', cond2: 'incapacitated' } },
  'Sleep': { fail: { n: 'Усыпление', ic: '💤', cond: 'incapacitated' }, rep: true },
  'Faerie Fire': { fail: { n: 'Огонь фей', ic: '🔆', lit: true } },
  'Fear': { fail: { n: 'Ужас', ic: '😱', cond: 'frightened' }, rep: true },
};
const fxOf = (tid) => Object.entries(game.effects || {}).filter(([, e]) => e.tgt === tid);
const acOf = (t, id) => (+t.ac || 10) + fxOf(id).reduce((s, [, e]) => s + (+e.ac || 0), 0);
const fxDice = (id) => fxOf(id).filter(([, e]) => e.die).map(([, e]) => ({ e: e.die, n: e.n }));
const durRounds = (d) => { const m = String(d || '').match(/(\d+)\s*(минут|час|раунд)/); return !m ? 10 : m[2] === 'час' ? +m[1] * 600 : m[2] === 'раунд' ? +m[1] : +m[1] * 10; };
function addEffect(tgt, spec) {
  const k = R.push(ref(gpath('effects'))).key, clean = Object.fromEntries(Object.entries({ ...spec, tgt, t: Date.now() }).filter(([, v]) => v != null && v !== ''));
  return R.set(ref(gpath(`effects/${k}`)), clean).catch((err) => app.toast(`Не удалось наложить эффект: ${esc(err.code || err.message)}`));
}
// Владелец цели: игрок — свой персонаж, мастер — существа
const ownsTarget = (t) => (t.kind === 'pc' ? user && t.owner === user.uid : isDM());
function setTokCond(id, cond, on) {
  const t = game.tokens[id];
  if (!t || !cond) return;
  if (t.kind === 'pc') { const m = me(); if (m && m.charId && t.owner === user.uid) app.setCond(m.charId, cond, on); return; }
  const list = new Set(t.cond || []);
  if (on) list.add(cond); else list.delete(cond);
  R.update(ref(gpath(`tokens/${id}`)), { cond: [...list] }).catch(() => {});
}
// Синхронизация эффектов: наложить/снять состояния у своих целей, снять эффекты по концентрации и времени
const fxApplied = new Map();
function syncEffects() {
  if (!game || !user) return;
  const eff = game.effects || {}, live = new Map();
  Object.entries(eff).forEach(([k, e]) => {
    const t = game.tokens[e.tgt];
    if (!t || !ownsTarget(t)) return;
    if (e.once) { // разовое: состояние (сбит с ног) или толчок — применить и убрать эффект
      if (!fxApplied.has(k)) {
        fxApplied.set(k, null);
        [e.cond, e.cond2].forEach((c) => setTokCond(e.tgt, c, true));
        if (e.push) pushToken(e.tgt, e.from, +e.push);
        R.remove(ref(gpath(`effects/${k}`))).catch(() => {});
      }
      return;
    }
    // Захват кончается, если схвативший недееспособен или цель оказалась дальше 5 фт
    if (e.grab) {
      const g = game.tokens[e.grab];
      if (!g || incapTok(g) || distFt(g, t) > 5) { R.remove(ref(gpath(`effects/${k}`))).catch(() => {}); return; }
    }
    if (e.cond || e.cond2) live.set(k, { tid: e.tgt, conds: [e.cond, e.cond2].filter(Boolean) });
  });
  live.forEach((v, k) => { if (!fxApplied.has(k)) { fxApplied.set(k, v); v.conds.forEach((c) => setTokCond(v.tid, c, true)); } });
  fxApplied.forEach((v, k) => {
    if (live.has(k) || eff[k]) return;
    fxApplied.delete(k);
    if (!v) return;
    // Снять состояние, если его не держит другой эффект
    v.conds.forEach((c) => { if (![...live.values()].some((o) => o.tid === v.tid && o.conds.includes(c))) setTokCond(v.tid, c, false); });
  });
  // Концентрация: заклинатель-персонаж сменил или потерял её, упал без сознания — его эффекты пропадают
  const m = me(), mySum = m && m.charId ? app.summary(m.charId) : null, myTok = user && game.tokens[`pc_${user.uid}`];
  const drop = Object.entries(eff).filter(([, e]) => e.conc && (
    (e.by === user.uid && !isDM() && mySum && (mySum.conc !== e.spell || (myTok && isDown(myTok))))
    || (isDM() && e.from && game.tokens[e.from] && game.tokens[e.from].kind === 'npc' && isDown(game.tokens[e.from]))
    || (isDM() && e.from && !game.tokens[e.from])));
  // Время действия: мастер снимает истёкшие в начале нового раунда
  const round = game.init && game.init.active ? game.init.round || 1 : 0;
  if (isDM() && round) Object.entries(eff).forEach(([k, e]) => { if (e.until && round > e.until && !drop.some(([x]) => x === k)) drop.push([k, e]); });
  if (drop.length) R.update(ref(gpath('effects')), Object.fromEntries(drop.map(([k]) => [k, null]))).catch(() => {});
}
// Толчок: на n клеток прочь от источника, пока не упрётся в стену, закрытую дверь, край поля или другое существо
function pushToken(id, fromId, n) {
  const t = game.tokens[id], src = fromId && game.tokens[fromId];
  if (!t || !src || !n) return;
  const sx = Math.sign(t.x - src.x), sy = Math.sign(t.y - src.y), s = t.size || 1;
  if (!sx && !sy) return;
  let x = t.x, y = t.y;
  for (let i = 0; i < n; i++) {
    const nx = x + sx, ny = y + sy;
    if (nx < 0 || ny < 0 || nx + s > W() || ny + s > H()) break;
    let blocked = false;
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) {
      const k = `${nx + dx}_${ny + dy}`;
      if ((game.map || {})[k] === 'wall' || doorShut(k)) blocked = true;
      if (Object.entries(game.tokens).some(([oid, o]) => oid !== id && nx + dx >= o.x && nx + dx < o.x + (o.size || 1) && ny + dy >= o.y && ny + dy < o.y + (o.size || 1))) blocked = true;
    }
    if (blocked) break;
    x = nx; y = ny;
  }
  if (x !== t.x || y !== t.y) {
    R.update(ref(gpath(`tokens/${id}`)), { x, y }).catch(() => {});
    addLog({ kind: 'act', who: t.name, txt: `отброшен на ${5 * Math.max(Math.abs(x - t.x), Math.abs(y - t.y))} фт` });
  }
}
// Провал спасброска против заклинания или приёма: состояние / эффект на цель
function applyFail(A, tid) {
  if (!A.fail) return;
  addEffect(tid, { ...A.fail, by: A.by, from: A.from, spell: A.spell, conc: A.conc, until: A.until, rep: A.rep && !A.fail.once ? A.rep : null });
}
// Запрос спасброска одной цели (приём оружия, атака чудовища, повторный спасбросок): та же панель «Спасброски»
function saveRequest(tid, spec) {
  const t = game.tokens[tid];
  if (!t) return;
  const k = R.push(ref(gpath('areas'))).key;
  const A = { shape: 'target', tgt: tid, size: 0, by: user.uid, who: spec.who || '', n: spec.n, abil: spec.abil, dc: spec.dc, half: !!spec.half, dmg: +spec.dmg || 0, keep: false,
    dmgDetail: spec.dmgDetail || '', dtype: spec.dtype || '',
    color: '#9b6fd1', t: Date.now(), tg: { [tid]: { done: false } }, ...(spec.fail ? { fail: spec.fail } : {}), ...(spec.rem ? { rem: spec.rem } : {}),
    ...(spec.rep ? { rep: spec.rep } : {}), ...(spec.from ? { from: spec.from } : {}) };
  R.set(ref(gpath(`areas/${k}`)), A).catch(() => {});
}
// Конец хода: у кого «повторяет спасбросок в конце каждого своего хода» — запрос спасброска, успех снимает эффект
function repeatSaves(tokenId) {
  fxOf(tokenId).filter(([, e]) => e.rep && e.rep.abil).forEach(([k, e]) => saveRequest(tokenId, { n: `${e.n}: повторный спасбросок`, abil: e.rep.abil, dc: e.rep.dc, rem: k, who: e.n }));
}
// Лечение: применяет владелец цели (игрок — в листе, мастер — существу); на нуле хитов существо приходит в себя
function healUpd(id, t, n) {
  const p = `tokens/${id}/`;
  return { [`${p}hp`]: Math.min(+t.hpMax || 1, (+t.hp || 0) + n), ...(isDown(t) ? { [`${p}dsS`]: null, [`${p}dsF`]: null } : {}) };
}
// Двери: мастер открывает, закрывает и (с Shift) запирает; игрок — если его персонаж рядом и сейчас его ход
const doorShut = (k) => { const d = (game.doors || {})[k]; return !!d && !d.o; };
function toggleDoor(k, shift) {
  const d = game.doors[k], [x, y] = k.split('_').map(Number), dm = isDM();
  if (dm && shift) { R.update(ref(gpath(`doors/${k}`)), { l: d.l ? 0 : 1, o: 0 }); app.toast(d.l ? 'Дверь отперта' : '🔒 Дверь заперта'); return; }
  if (!dm) {
    const my = game.tokens[`pc_${user.uid}`];
    if (!my) return;
    if (d.l) { app.toast('🔒 Заперто'); return; }
    if (distFt(my, { x, y, size: 1 }) > 5) { app.toast('Дверь далеко — подойдите вплотную'); return; }
    if (inFight() && !isTurnOf(`pc_${user.uid}`)) { app.toast('Сейчас не ваш ход'); return; }
  }
  if (d.o && Object.values(game.tokens).some((t) => t.x <= x && x < t.x + (t.size || 1) && t.y <= y && y < t.y + (t.size || 1))) { app.toast('В проёме кто-то стоит'); return; }
  R.update(ref(gpath(`doors/${k}`)), { o: d.o ? 0 : 1 }).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
  const who = dm ? '' : (game.tokens[`pc_${user.uid}`] || {}).name;
  if (who) addLog({ kind: 'act', who, txt: d.o ? 'закрывает дверь' : 'открывает дверь' });
}
const LIGHTS = [['', 'нет'], ['20/20', 'факел'], ['30/30', 'фонарь'], ['20/20', 'заговор «Свет»'], ['5/5', 'свеча'], ['60/60', 'фонарь «бычий глаз» (упрощённо)']];

/* ---------- Опыт ---------- */
// games/{id}/xp/kills/{tokenId}: { n, name } — опыт за побеждённых врагов (считает браузер мастера);
// games/{id}/xpAward/{uid}/{key}: { n, why } — начислено игроку; его браузер прибавляет опыт в листе и удаляет запись
const xpOf = (t) => (t.xp != null ? +t.xp || 0 : typeof XP_CR !== 'undefined' && t.cr != null ? XP_CR[t.cr] || 0 : 0);
function awardKills() {
  if (!game || !isDM()) return;
  const kills = (game.xp || {}).kills || {}, upd = {};
  Object.entries(game.tokens || {}).forEach(([id, t]) => {
    if (t.kind !== 'npc' || team(t) !== 'npc' || !isDead(t) || kills[id]) return;
    const n = xpOf(t);
    upd[`kills/${id}`] = { n, name: t.name };
    if (n) addLog({ kind: 'sys', txt: `⭐ ${t.name} побеждён: +${n} опыта в общий котёл` });
  });
  if (Object.keys(upd).length) R.update(ref(gpath('xp')), upd).catch(() => {});
}
// Мастер раздаёт опыт: котёл делится поровну между отмеченными персонажами
function xpDialog(after) {
  const kills = Object.values((game.xp || {}).kills || {}), total = kills.reduce((s, k) => s + (+k.n || 0), 0);
  const pcs = Object.values(game.tokens || {}).filter((t) => t.kind === 'pc' && t.owner);
  app.openModal(`<h2>⭐ Опыт${after ? ' за бой' : ''}</h2>
    ${kills.length ? `<p class="small">Побеждены: ${kills.map((k) => `${esc(k.name)} (${k.n})`).join(', ')}</p>` : ''}
    <div class="form-grid"><label>Всего опыта<input type="number" id="xTot" min="0" value="${total}"></label></div>
    <div class="atk-ways mt">${pcs.map((t) => `<label class="check"><input type="checkbox" data-xp="${esc(t.owner)}" checked> ${esc(t.name)}</label>`).join('') || '<p class="muted">На поле нет персонажей.</p>'}</div>
    <p class="small" id="xEach"></p>
    <div class="modal-actions"><button data-act="closeModal">${after ? 'Не раздавать' : 'Отмена'}</button><button class="primary" id="xOk">Раздать</button></div>`);
  const each = () => { const n = $$('[data-xp]').filter((x) => x.checked).length; return n ? Math.floor((+$('#xTot').value || 0) / n) : 0; };
  const upd = () => { $('#xEach').textContent = `Каждому: ${each()} опыта`; };
  $$('#modalBody input').forEach((x) => x.addEventListener('input', upd)); upd();
  $('#xOk').onclick = async () => {
    const n = each(), uids = $$('[data-xp]').filter((x) => x.checked).map((x) => x.dataset.xp);
    app.closeModal();
    if (!n || !uids.length) return;
    const k = R.push(ref(gpath('xpAward'))).key, upd2 = { xp: null };
    uids.forEach((u) => { upd2[`xpAward/${u}/${k}`] = { n, why: after ? 'бой' : 'мастер' }; });
    await R.update(ref(gpath()), upd2);
    addLog({ kind: 'sys', txt: `⭐ Опыт: ${n} каждому (${uids.map((u) => (game.tokens[`pc_${u}`] || {}).name || '?').join(', ')})` });
  };
}
// Игрок: прибавить начисленный опыт в лист; хватает на уровень — сразу мастер повышения уровня
const xpDone = new Set();
// Начисление может прийти раньше списка участников — тогда применится, когда он загрузится
function applyXp() {
  const m = me(), v = game && game.award;
  if (!v || !m || !m.charId) return;
  let level = false;
  Object.entries(v).forEach(([k, a]) => {
    if (xpDone.has(k)) return;
    xpDone.add(k);
    const r = app.addXp(m.charId, +a.n || 0);
    R.remove(ref(gpath(`xpAward/${user.uid}/${k}`))).catch(() => {});
    if (r) { app.toast(`⭐ +${a.n} опыта (всего ${r.xp})`, 'crit'); level = level || r.canLevel; }
  });
  if (level) setTimeout(() => { app.toast('⬆ Достаточно опыта для нового уровня!', 'crit'); app.openLevelUp(m.charId); }, 600);
}

/* ---------- Сцены ---------- */
// games/{id}/scenes/{sid}: { n, t } — список (его видят все); games/{id}/sceneData/{sid} — снимок поля: размер, карта, двери, свет,
// туман, картинка, существа мастера и места персонажей. Его читает только мастер при переключении. meta.scene — текущая сцена
function sceneSnap() {
  const npcs = {}, pcs = {}, m = game.meta || {};
  Object.entries(game.tokens || {}).forEach(([id, t]) => { if (t.kind === 'npc') npcs[id] = t; else pcs[id] = { x: t.x, y: t.y }; });
  return { w: W(), h: H(), bg: m.bg || null, fog: m.fog || null, map: game.map || null, doors: game.doors || null, lights: game.lights || null,
    reveal: game.reveal || null, seen: game.seen || null, bgimg: bgSrc ? { data: bgSrc } : null, npcs, pcs };
}
// Сохранить текущее поле в его сцену (или в новую «Сцена N»)
function saveScene() {
  const m = game.meta || {}, sid = m.scene || R.push(ref(gpath('scenes'))).key;
  const name = ((game.scenes || {})[sid] || {}).n || `Сцена ${Object.keys(game.scenes || {}).length + 1}`;
  return R.update(ref(gpath()), { [`sceneData/${sid}`]: sceneSnap(), [`scenes/${sid}`]: { n: name, t: Date.now() }, 'meta/scene': sid }).then(() => sid);
}
// Перейти в сцену: текущая сохраняется, поле заменяется снимком; бой заканчивается, персонажи встают на свои места в той сцене
async function loadScene(sid, empty, name) {
  await saveScene();
  const snap = empty ? { w: 30, h: 20 } : (await R.get(ref(gpath(`sceneData/${sid}`)))).val() || {};
  const upd = { map: snap.map || null, doors: snap.doors || null, lights: snap.lights || null, reveal: snap.reveal || null, seen: snap.seen || null,
    bgimg: snap.bgimg || null, 'meta/w': snap.w || 30, 'meta/h': snap.h || 20, 'meta/bg': snap.bg || null, 'meta/fog': snap.fog || null, 'meta/scene': sid,
    areas: null, init: null, econ: null };
  Object.entries(game.tokens || {}).forEach(([id, t]) => {
    if (t.kind === 'npc') { upd[`tokens/${id}`] = null; return; }
    const p = (snap.pcs || {})[id], w = snap.w || 30, h = snap.h || 20;
    upd[`tokens/${id}/x`] = p ? p.x : Math.min(t.x, w - 1); upd[`tokens/${id}/y`] = p ? p.y : Math.min(t.y, h - 1);
  });
  Object.entries(snap.npcs || {}).forEach(([id, t]) => { upd[`tokens/${id}`] = t; });
  Object.entries(game.effects || {}).forEach(([k, e]) => { if (!game.tokens[e.tgt] || game.tokens[e.tgt].kind === 'npc') upd[`effects/${k}`] = null; });
  await R.update(ref(gpath()), upd);
  addLog({ kind: 'sys', txt: `🎬 Сцена: ${name || ((game.scenes || {})[sid] || {}).n || 'новая'}` });
}
function sceneDialog() {
  const cur = (game.meta || {}).scene, list = Object.entries(game.scenes || {}).sort((a, b) => (a[1].t || 0) - (b[1].t || 0));
  app.openModal(`<h2>🎬 Сцены</h2>
    <p class="muted small">Сцена — отдельное поле со своей картой, стенами, дверями, светом, туманом и существами. При переходе текущая сохраняется сама, бой заканчивается.</p>
    <div class="list">${list.map(([id, s]) => `<div class="li"><div class="li-head"><span class="li-title">${esc(s.n)}${id === cur ? ' <span class="tag g">сейчас</span>' : ''}</span>
      <span class="btns">${id === cur ? '' : `<button class="primary" data-scn="go" data-id="${id}">Перейти</button>`}<button class="ghost" data-scn="ren" data-id="${id}" title="Переименовать">✎</button>
      ${id === cur ? '' : `<button class="ghost" data-scn="del" data-id="${id}" title="Удалить">✕</button>`}</span></div></div>`).join('') || '<p class="muted small">Сцен пока нет — текущее поле сохранится как первая.</p>'}</div>
    <div class="row gap wrap mt"><input id="scnName" placeholder="Название новой сцены" style="flex:1"><button data-scn="new">＋ Новая пустая сцена</button></div>
    <div class="modal-actions"><button data-scn="save">💾 Сохранить текущую</button><button class="primary" data-act="closeModal">Готово</button></div>`);
  $$('[data-scn]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.scn, id = b.dataset.id;
    try {
      if (k === 'go') {
        if (inFight() && !app.confirm('Идёт бой. Перейти в другую сцену и закончить бой?')) return;
        app.closeModal(); await loadScene(id);
      } else if (k === 'new') {
        const n = $('#scnName').value.trim() || `Сцена ${Object.keys(game.scenes || {}).length + 2}`, nid = R.push(ref(gpath('scenes'))).key;
        app.closeModal();
        await R.set(ref(gpath(`scenes/${nid}`)), { n, t: Date.now() });
        await loadScene(nid, true, n);
      } else if (k === 'ren') {
        const n = prompt('Название сцены', (game.scenes[id] || {}).n || '');
        if (n && n.trim()) { await R.update(ref(gpath(`scenes/${id}`)), { n: n.trim() }); app.closeModal(); sceneDialog(); }
      } else if (k === 'del') {
        if (!app.confirm(`Удалить сцену «${(game.scenes[id] || {}).n}»?`)) return;
        await R.update(ref(gpath()), { [`scenes/${id}`]: null, [`sceneData/${id}`]: null }); app.closeModal(); sceneDialog();
      } else if (k === 'save') { await saveScene(); app.toast('💾 Сцена сохранена'); app.closeModal(); sceneDialog(); }
    } catch (err) { app.toast(`Не удалось: ${esc(err.code || err.message)}`); }
  }));
}

/* ---------- Отдых для всей группы ---------- */
// games/{id}/rest: { kind: short | long, id, t } — объявляет мастер; браузер каждого игрока применяет его один раз
function restDialog() {
  app.openModal(`<h2>🏕 Отдых</h2>
    <p class="small"><b>Короткий</b> (1 час): у каждого игрока откроется окно костей хитов; восстановятся ресурсы короткого отдыха.<br>
    <b>Долгий</b> (8 часов): у всех восстановятся хиты, ячейки, ресурсы и кости хитов; бой и эффекты заклинаний заканчиваются.</p>
    <label class="check"><input type="checkbox" id="rNpc"> Существам на поле тоже восстановить хиты (при долгом отдыхе)</label>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button data-rest="short">☕ Короткий отдых</button><button class="primary" data-rest="long">🌙 Долгий отдых</button></div>`);
  $$('[data-rest]').forEach((b) => b.addEventListener('click', async () => {
    const kind = b.dataset.rest, healNpc = $('#rNpc').checked, upd = { rest: { kind, id: R.push(ref(gpath('rest'))).key, t: Date.now() } };
    if (kind === 'long') {
      Object.assign(upd, { init: null, econ: null, effects: null });
      if (healNpc) Object.entries(game.tokens).forEach(([id, t]) => { if (t.kind === 'npc' && !isDead(t)) Object.assign(upd, { [`tokens/${id}/hp`]: t.hpMax, [`tokens/${id}/dsS`]: null, [`tokens/${id}/dsF`]: null }); });
    }
    app.closeModal();
    await R.update(ref(gpath()), upd);
    addLog({ kind: 'sys', txt: kind === 'long' ? '🌙 Долгий отдых: 8 часов' : '☕ Короткий отдых: 1 час' });
  }));
}
function handleRest() {
  const m = me(), v = game && game.rest;
  if (!v || !m || !m.charId || isDM()) return;
  const key = `dnd55-rest-${game.id}`;
  if (ls.get(key) === v.id) return;
  ls.set(key, v.id);
  if (Date.now() - (v.t || 0) > 30 * 60 * 1000) return; // давнее объявление — не повторять
  if (v.kind === 'long') { app.longRest(m.charId); app.toast('🌙 Мастер объявил долгий отдых — всё восстановлено', 'crit'); }
  else { app.toast('☕ Мастер объявил короткий отдых — потратьте кости хитов', 'crit'); app.shortRest(m.charId); }
}

/* ---------- Анимации ---------- */
// Запускаются у всех участников по новым записям журнала: снаряд или удар → число урона над целью,
// вспышка области, ☠ при гибели. Записи, бывшие до открытия страницы, не анимируются.
const animated = new Set(), skulls = new Set();
let fxAreas = [], fxRaf = 0;
const calm = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
function fxShape(A) {
  const g = geo(A);
  return { shape: g.shape, size: g.size || 0, width: g.width || 5, ox: g.ox != null ? g.ox : 0, oy: g.oy != null ? g.oy : 0, ang: g.ang || 0,
    r: g.r || null, tgt: g.tgt || null, color: A.color || colorFor(A.dtype) };
}
function tokCenter(id) {
  const t = game.tokens[id];
  if (!t || (t.hidden && !isDM()) || fogHides(t)) return null;
  const s = (t.size || 1) * CELL;
  return { x: t.x * CELL + s / 2, y: t.y * CELL + s / 2, s };
}
function fxLog() {
  if (!game) return;
  logList().slice().reverse().forEach((e) => {
    if (!animated.has(e.k)) {
      animated.add(e.k);
      if ((e.t || 0) < openedAt || Date.now() - (e.t || 0) > 15000) { if (e.down) skulls.add(e.k); return; }
      if (e.kind === 'atk' && e.graze) fxHit(e.tgt, e.dmg, {});
      else if (e.kind === 'atk') fxAttack(e);
      else if (e.kind === 'heal') floatText(e.tgt, `+${e.heal}`, 'fx-heal');
      else if (e.kind === 'area' && e.fx) fxArea(e.fx);
      else if (e.kind === 'save' && e.res) e.res.forEach((r, i) => setTimeout(() => fxHit(r.id, r.dmg, { saved: r.ok, down: r.down }), 200 + i * 140));
      if (e.down) skulls.add(e.k);
      return;
    }
    // Гибель от атаки отмечает браузер мастера чуть позже — тогда и показываем ☠
    if (e.down && !skulls.has(e.k)) { skulls.add(e.k); setTimeout(() => floatText(e.tgt, '☠', 'fx-skull'), 250); }
  });
}
function fxAttack(e) {
  const A = tokCenter(e.from), B = tokCenter(e.tgt);
  if (!B) return;
  const impact = () => fxHit(e.tgt, e.hit ? e.dmg : null, { crit: e.crit, miss: !e.hit, down: e.down });
  if (!A || calm()) { impact(); return; }
  const color = colorFor(e.dtype);
  if (e.anim === 'melee' || !e.anim) { fxSlash(B, color, e.crit); setTimeout(impact, 200); return; }
  const dist = Math.hypot(B.x - A.x, B.y - A.y) || 1, ux = (B.x - A.x) / dist, uy = (B.y - A.y) / dist, side = (e.nat || 0) % 2 ? 1 : -1;
  // Промах: снаряд проходит мимо цели
  const end = e.hit ? B : { x: B.x + ux * CELL * 1.6 - uy * CELL * 0.55 * side, y: B.y + uy * CELL * 1.6 + ux * CELL * 0.55 * side };
  const dur = Math.min(650, 160 + dist * 0.9);
  fxProjectile(A, end, e.anim, color, e.hit ? dur : dur * 1.3);
  setTimeout(impact, dur);
}
function fxEl(cls, color) {
  const el = document.createElement('div');
  el.className = cls;
  if (color) el.style.setProperty('--c', color);
  $('#tblFx').appendChild(el);
  return el;
}
function fxProjectile(A, B, kind, color, dur) {
  const el = fxEl(`fx-proj fx-${kind}`, color), ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI;
  const at = (p, rot) => `translate(${p.x}px, ${p.y}px) rotate(${rot}deg)`;
  const kf = kind === 'throw' ? [{ transform: at(A, ang) }, { transform: at(B, ang + 900) }]
    : kind === 'bolt' ? [{ transform: `${at(A, ang)} scale(.5)`, opacity: 0.6 }, { transform: `${at(B, ang)} scale(1.15)`, opacity: 1 }]
      : [{ transform: at(A, ang) }, { transform: at(B, ang) }];
  el.animate(kf, { duration: dur, easing: kind === 'bolt' ? 'ease-in' : 'linear' }).onfinish = () => el.remove();
}
function fxSlash(B, color, crit) {
  const el = fxEl(`fx-slash${crit ? ' crit' : ''}`, color), at = `translate(${B.x}px, ${B.y}px)`;
  el.animate([{ transform: `${at} rotate(-100deg) scale(.6)`, opacity: 0 }, { opacity: 1, offset: 0.35 }, { transform: `${at} rotate(70deg) scale(1.15)`, opacity: 0 }],
    { duration: 320, easing: 'ease-out' }).onfinish = () => el.remove();
}
// Попадание: встряска и вспышка токена, число урона; промах — уклон в сторону и «промах»
function fxHit(id, dmg, o = {}) {
  const face = $(`[data-tok="${id}"] .tok-face`);
  if (face && !calm()) {
    if (o.miss || (o.saved && !dmg)) face.animate([{ transform: 'none' }, { transform: 'translateX(9px)' }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
    else face.animate([{ transform: 'none', filter: 'brightness(2.2) saturate(1.6)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none', filter: 'none' }],
      { duration: o.crit ? 480 : 340 });
  }
  if (o.miss) floatText(id, 'промах', 'fx-miss');
  else if (dmg) floatText(id, `${o.crit ? 'КРИТ! ' : ''}−${dmg}`, o.crit ? 'fx-crit' : o.saved ? 'fx-dmg half' : 'fx-dmg');
  else if (o.saved) floatText(id, 'спасся', 'fx-miss');
  if (o.down) setTimeout(() => floatText(id, '☠', 'fx-skull'), 450);
}
const floatAt = {}; // несколько чисел над одной целью подряд — друг над другом, а не внахлёст
function floatText(id, text, cls) {
  const c = tokCenter(id);
  if (!c) return;
  const now = Date.now(), prev = floatAt[id], n = prev && now - prev.t < 700 ? prev.n + 1 : 0;
  floatAt[id] = { t: now, n };
  const el = fxEl(`fx-float ${cls}`), y = c.y - c.s / 2 - n * 22;
  el.textContent = text;
  el.animate([{ transform: `translate(${c.x}px, ${y}px) translate(-50%, 0) scale(.6)`, opacity: 0 },
    { transform: `translate(${c.x}px, ${y - 14}px) translate(-50%, 0) scale(1.15)`, opacity: 1, offset: 0.18 },
    { transform: `translate(${c.x}px, ${y - 46}px) translate(-50%, 0) scale(1)`, opacity: 0 }],
  { duration: calm() ? 1600 : 1400, easing: 'ease-out' }).onfinish = () => el.remove();
}
// Вспышка области: сфера и конус «раскрываются» от точки начала, линия — бьёт лучом, затем гаснут
function fxArea(f) {
  if (calm()) return;
  fxAreas.push({ f, t0: performance.now() });
  if (f.shape === 'sphere' && f.size >= 20) $('#tblBoard').animate([{ translate: '0 0' }, { translate: '3px -2px' }, { translate: '-3px 2px' }, { translate: '2px 1px' }, { translate: '0 0' }], { duration: 300, delay: 250 });
  if (!fxRaf) fxRaf = requestAnimationFrame(fxFrame);
}
function fxFrame(now) {
  const cv = $('#tblFxCv'), g = cv.getContext('2d'), D = 1000;
  g.clearRect(0, 0, cv.width, cv.height);
  fxAreas = fxAreas.filter((a) => now - a.t0 < D);
  fxAreas.forEach(({ f, t0 }) => {
    const p = (now - t0) / D, grow = 1 - Math.pow(1 - Math.min(1, p * 2.2), 3), alpha = p < 0.35 ? 0.7 : 0.7 * (1 - (p - 0.35) / 0.65);
    g.save();
    if (f.shape === 'target') {
      const c = tokCenter(f.tgt);
      if (c) { g.fillStyle = rgba(f.color, alpha); g.beginPath(); g.arc(c.x, c.y, (c.s / 2 + 10) * grow, 0, Math.PI * 2); g.fill(); }
    } else {
      const s = f.shape === 'cube' || f.shape === 'aura' ? f : { ...f, size: f.size * grow, r: f.r ? f.r * grow : null };
      g.fillStyle = rgba(f.color, alpha * 0.8); g.strokeStyle = `rgba(255,255,255,${alpha})`; g.lineWidth = 3;
      g.beginPath(); shapePath(g, s); g.fill(); g.stroke();
      if (f.shape === 'sphere') { // раскалённое ядро
        const r = ((f.r || f.size / 5) * CELL) * grow * 0.55, gr = g.createRadialGradient(f.ox * CELL, f.oy * CELL, 0, f.ox * CELL, f.oy * CELL, Math.max(1, r));
        gr.addColorStop(0, `rgba(255,255,230,${alpha})`); gr.addColorStop(1, 'rgba(255,255,230,0)');
        g.fillStyle = gr; g.beginPath(); g.arc(f.ox * CELL, f.oy * CELL, Math.max(1, r), 0, Math.PI * 2); g.fill();
      }
    }
    g.restore();
  });
  fxRaf = fxAreas.length ? requestAnimationFrame(fxFrame) : 0;
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
  drawFog();
  drawAreas();
  renderTokens();
  renderTurn();
  renderInit();
  renderSide();
  renderMembers();
  renderLog();
  renderChatBar();
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
    ${isDM() ? t('wall', '▮ Стена') + t('difficult', '▦ Трудная') + t('water', '≈ Вода') + t('erase', '⌫ Ластик') + t('enemy', '＋ Существо', 'Нажмите на клетку, чтобы поставить врага или NPC из бестиария')
      + t('door', '🚪 Дверь', 'Поставить или убрать дверь. Открыть — нажатием с «Двигать», запереть — с Shift')
      + t('light', '💡 Свет', 'Поставить или убрать источник света (20 фт яркого + 20 тусклого)')
      + t('area', '◯ Область', 'Область со спасброском: дыхание, ловушка… Конус и линия — от выделенного существа')
      + `<button class="${freeMove ? 'on' : ''}" data-tbl="freeMove" title="Двигать любые токены без учёта хода и скорости (толчок, перенос тела). То же — перетаскивание с Shift">🔓 Свободно</button>`
      + `<button data-tbl="mapCfg" title="Карта-подложка, размер поля, туман войны">🗺 Карта и туман</button>`
      + `<button data-tbl="scenes" title="Несколько полей: таверна, подземелье, логово — переключение одной кнопкой">🎬 Сцены${(game.meta || {}).scene && (game.scenes || {})[game.meta.scene] ? `: ${esc(game.scenes[game.meta.scene].n)}` : ''}</button>`
      + '<button data-tbl="rest" title="Короткий или долгий отдых для всей группы">🏕 Отдых</button>'
      + (fogOn() ? t('reveal', '👁 Открыть', 'Кисть: открыть клетки для игроков') + t('conceal', '🌫 Скрыть', 'Кисть: закрыть клетки туманом')
        + `<button class="${fogPreview ? 'on' : ''}" data-tbl="fogPreview" title="Показать поле так, как его видят игроки">👁 Вид игроков</button>` : '') : ''}
    ${!isDM() && !(hasMine && inFight()) ? t('place', hasMine ? '📍 Переставить меня' : '📍 Поставить персонажа', 'Нажмите на клетку') : ''}
    ${!isDM() && me() && me().charId && app.companions(me().charId).length ? `<button class="${tool === 'placeComp' ? 'on' : ''}" data-tbl="compPick" title="Поставить спутника из листа на поле">🐾 Спутник</button>` : ''}</div>`;
}
// Карточка хода: игроку — свой персонаж, мастеру — существо, чей сейчас ход
function renderTurn() {
  const box = $('#tblTurn'), dm = isDM();
  let id = null;
  if (inFight()) {
    const c = currentEntry();
    // Ход логова (счёт инициативы 20): мастер применяет эффект логова областью или описывает его
    if (dm && c && c.kind === 'lair') {
      box.hidden = false;
      box.innerHTML = `<div class="row between"><h3>🏰 Ход логова</h3></div>
        <p class="muted small">Логово действует на счёт инициативы 20: обвал, ядовитый туман, всплеск магии… Используйте область со спасброском или опишите эффект в чате.</p>
        <div class="row gap wrap"><button data-tool="area">◯ Область</button><button class="primary" data-tbl="next">▶ Дальше</button></div>${legendHtml(null)}`;
      return;
    }
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
  // На нуле хитов (персонаж или существо со спасбросками): вместо действий — спасбросок от смерти
  if (isDown(t) && usesDS(t)) {
    const pips = (n, cls) => [0, 1, 2].map((i) => `<span class="dpip ${i < n ? cls : ''}"></span>`).join('');
    box.innerHTML = `<div class="row between"><h3>${dm ? `Ход: ${esc(t.name)}` : turn ? 'Ваш ход' : 'Без сознания'}</h3>${turn && !dm ? '<span class="badge">сейчас</span>' : ''}</div>
      <div class="death-row"><span>Успехи ${pips(+t.dsS || 0, 'ok')}</span><span>Провалы ${pips(+t.dsF || 0, 'bad')}</span></div>
      ${isDead(t) ? '<p class="warn-text">☠ Погиб.</p>' : isStable(t) ? '<p class="muted small">Стабилизирован: спасбросков больше нет, через 1к4 часа — 1 хит.</p>'
        : `<p class="muted small">0 хитов — без сознания. В начале своего хода — спасбросок от смерти: 10+ успех, иначе провал; 1 — два провала; 20 — приходит в себя с 1 хитом.
          Урон в этом состоянии — провал (от крита — два), урон не меньше максимума хитов — смерть. Три успеха — стабилизирован, три провала — смерть.</p>`}
      ${!dm && turn && !isDead(t) && !isStable(t) && !e.ds ? `<button class="primary" data-tbl="deathSave" data-id="${id}">💀 Спасбросок от смерти</button>` : ''}
      ${!dm && turn && (isStable(t) || e.ds) ? '<button class="primary" data-tbl="endTurn">✓ Закончить ход</button>' : ''}
      ${dm && turn ? '<p class="muted small">Спасбросок за существо бросается автоматически, ход передаётся дальше.</p>' : ''}`;
    return;
  }
  box.innerHTML = `<div class="row between"><h3>${dm ? `Ход: ${esc(t.name)}` : turn ? 'Ваш ход' : 'Ваши ресурсы хода'}</h3>${turn && !dm ? '<span class="badge">сейчас</span>' : ''}</div>
    ${turn || dm ? `<div class="small">Перемещение: <b>${mv.left}</b> из ${mv.total} фт${e.dash ? ` · Рывок ×${e.dash}` : ''}${mv.prone ? ' · ползком (×2)' : ''}</div>
    <div class="mvbar"><div style="width:${mv.total ? Math.min(100, (mv.left / mv.total) * 100) : 0}%"></div></div>`
    : `<div class="small muted" style="margin-bottom:8px">Скорость ${mv.speed} фт — перемещение и действия в ваш ход, реакция доступна всегда</div>`}
    <div class="pips">${pip('a', 'Действие', 'Атака, заклинание, Рывок и т. п. — нажмите, когда потратите')}${pip('b', 'Бонусное', 'Нажмите, когда потратите бонусное действие')}${pip('r', 'Реакция', 'Атака по возможности, «Щит» и т. п.; восстанавливается в начале вашего хода')}</div>
    ${mv.incap ? '<p class="small warn-text">Недееспособен — не может совершать действия, бонусные действия и реакции.</p>' : ''}
    ${e.atk > 0 ? `<div class="small mt">Дополнительная атака: осталось атак — <b>${e.atk}</b></div>` : ''}
    ${aim && (aim.from === id || (!dm && game.tokens[aim.from] && game.tokens[aim.from].owner === user.uid) || (dm && aim.way === 'legend'))
      ? `<div class="aim-bar mt">🎯 ${aim.from !== id ? `${esc(game.tokens[aim.from].name)}: ` : ''}выберите цель для «${esc(aim.atk.n)}»${aim.left > 1 ? ` · атак: ${aim.left}` : ''}<button data-tbl="aimOff">${aim.way === 'action' && aim.left < (aim.npc ? +game.tokens[aim.from].multi || 1 : (app.summary(aim.charId) || {}).atks || 1) ? 'Готово' : 'Отмена'}</button></div>`
      : !dm && !mv.incap && ((turn && (e.atk > 0 || !e.a || !e.b)) || !e.r) ? `<div class="row gap wrap mt"><button class="primary" data-tbl="attack" data-id="${id}">⚔ Атака${e.atk > 0 ? ` (ещё ${e.atk})` : !turn ? ' реакцией' : ''}</button>
        ${!(e.atk > 0) ? `<button class="primary" data-tbl="spell" data-id="${id}">✨ Заклинание</button>` : ''}</div>`
      : dm && t.kind === 'npc' && !mv.incap && (e.atk > 0 || !e.a || !e.b) ? `<div class="mt"><button class="primary" data-tbl="npcAttack" data-id="${id}">⚔ Атака${e.atk > 0 ? ` (ещё ${e.atk})` : ''}</button></div>` : ''}
    ${canAct && turn ? `<div class="row gap wrap mt">
      ${btn('dash', '🏃 Рывок', 'Действие: ещё одна скорость перемещения на этот ход', !e.a && mv.speed > 0)}
      ${btn('dis', '↩ Отход', 'Действие: до конца хода ваше перемещение не провоцирует атаки по возможности', !e.a && !e.dis)}
      ${btn('dodge', '🛡 Уклонение', 'Действие: до начала вашего следующего хода атаки по вам с помехой, спасброски Ловкости с преимуществом', !e.a && !e.dodge)}
      ${btn('dashB', '🏃 Рывок бонусным', 'Хитрое действие / Шаг ветра: Рывок бонусным действием', mv.bonus.includes('dash') && !e.b && mv.speed > 0)}
      ${btn('disB', '↩ Отход бонусным', 'Хитрое действие / Терпеливая оборона: Отход бонусным действием', mv.bonus.includes('dis') && !e.b && !e.dis)}
      ${btn('stand', `⬆ Встать (${half} фт)`, 'Тратит половину скорости и снимает «Лежит ничком»', mv.prone && !dm && mv.speed > 0 && mv.left >= half)}
    </div>` : ''}
    ${e.dis || e.dodge ? `<div class="chips mt">${e.dis ? '<span class="chip on"><span>Отход</span></span>' : ''}${e.dodge ? '<span class="chip on"><span>Уклонение</span></span>' : ''}</div>` : ''}
    ${(() => {
      // Вырваться из захвата (действие); реакции на попадание по мне или по союзнику рядом
      const grab = fxOf(id).find(([, f]) => f.grab);
      return `${grab && turn && !e.a && !mv.incap ? `<div class="mt"><button data-tbl="escape" data-id="${id}" data-k="${grab[0]}">🤼 Вырваться (действие, СЛ ${grab[1].gdc})</button></div>` : ''}
        ${reactionsHtml(id, t, e, mv.incap)}`;
    })()}
    ${!dm ? compTurnHtml(turn) : legendHtml(id)}
    ${turn && !dm ? '<div class="mt"><button class="primary" data-tbl="endTurn">✓ Закончить ход</button></div>' : ''}`;
}
// Мои спутники на поле: атака — в ход хозяина действием спутника, вне хода — его реакцией
function compTurnHtml(turn) {
  const list = Object.entries(game.tokens).filter(([, o]) => o.comp && o.owner === user.uid && !incapTok(o));
  if (!list.length || (aim && game.tokens[aim.from] && game.tokens[aim.from].comp)) return '';
  const rows = list.map(([cid, o]) => {
    const ce = econ(cid), ok = (turn && (ce.atk > 0 || !ce.a)) || !ce.r;
    return ok && (o.atk || []).length ? `<button data-tbl="compAttack" data-id="${cid}">🐾 ${esc(o.name)}: ⚔ ${turn && (ce.atk > 0 || !ce.a) ? 'атака' : 'реакцией'}</button>` : '';
  }).join('');
  return rows ? `<div class="row gap wrap mt">${rows}</div>` : '';
}
// Мастер: легендарные действия существ вне их хода — после хода другого участника
function legendHtml(curId) {
  if (!inFight()) return '';
  const list = Object.entries(game.tokens).filter(([k, o]) => o.kind === 'npc' && +o.leg && !isDead(o) && k !== curId);
  if (!list.length) return '';
  return `<div class="legend-box mt"><div class="muted small">👑 Легендарные действия (после хода другого участника):</div>
    ${list.map(([k, o]) => `<div class="row between"><span>${esc(o.name)} <span class="leg-pips">${Array.from({ length: +o.leg }, (_, i) => `<span class="dpip ${i < legendLeft(k) ? 'ok' : ''}"></span>`).join('')}</span></span>
      <button data-tbl="legend" data-id="${k}" ${legendOk(k) ? '' : 'disabled'}>👑 Действие</button></div>`).join('')}</div>`;
}
function renderInit() {
  const l = initList(), cur = currentEntry(), inList = user && game.init && game.init.list && game.init.list[user.uid];
  const active = game.init && game.init.active;
  $('#tblRound').textContent = active ? `Раунд ${game.init.round || 1}` : 'вне боя';
  $('#tblInit').innerHTML = (l.length ? `<div class="list">${l.map((e) => `<div class="init-row ${cur && cur.id === e.id ? 'cur' : ''} ${e.kind}">
      <b>${e.roll}</b><span>${esc(e.name)}</span>${isDM() ? `<button class="ghost" data-tbl="initDel" data-id="${e.id}" title="Убрать">✕</button>` : ''}</div>`).join('')}</div>` : '<p class="muted small">Пока никто не бросил инициативу.</p>')
    + `<div class="row gap wrap mt">
      ${!isDM() && me() && !inList ? '<button class="primary" data-tbl="rollInit">🎲 Бросить инициативу</button>' : ''}
      ${isDM() ? `<button data-tbl="lair" title="Логово действует на счёт инициативы 20 (проигрывая ничьи)">🏰 ${game.init && game.init.list && game.init.list.lair ? 'Убрать логово' : 'Логово'}</button><button data-tbl="rollNpc" title="Бросить за всех существ на поле">🎲 Враги</button><button data-tbl="xpGive" title="Раздать опыт персонажам (котёл: ${Object.values((game.xp || {}).kills || {}).reduce((s, k) => s + (+k.n || 0), 0)})">⭐ Опыт</button>
        ${active ? '<button class="primary" data-tbl="next">▶ Следующий ход</button><button class="ghost" data-tbl="endFight">Закончить бой</button>'
          : `<button class="primary" data-tbl="startFight" ${l.length ? '' : 'disabled'}>⚔ Начать бой</button>`}` : ''}</div>`;
}
// Статблок существа для мастера: характеристики, атаки, особенности
function npcStatHtml(t) {
  if (!t.ab && !(t.atk || []).length) return '';
  const atks = npcAttacks(t);
  return `<div class="statblock mt">${t.cr != null ? `<div class="muted small">ПО ${esc(t.cr)}${t.spd ? ` · скорость ${esc(t.spd)}` : ''}</div>` : ''}
    ${t.ab ? `<div class="sb-ab">${ABK.map((k, i) => `<span><b>${ABS[k]}</b>${t.ab[i]} (${fmtMod(abMod(t.ab[i]))})</span>`).join('')}</div>` : ''}
    ${(+t.multi || 1) > 1 ? `<div class="small">Мультиатака: ${t.multi} атаки за действие</div>` : ''}
    ${atks.map((a) => `<div class="small">⚔ <b>${esc(a.n)}</b> ${fmtMod(a.bonus)}${a.dmg ? `, ${esc(a.dmg)} ${esc(a.type)}` : ''}${a.rng.near ? ` · ${a.rng.near}/${a.rng.far} фт` : a.rng.reach > 5 ? ` · досягаемость ${a.rng.reach} фт` : ''}</div>`).join('')}
    ${(t.acts || []).map((a, i) => `<div class="small">🔥 <b>${esc(a.n)}</b>: ${SHAPE_N[a.shape]} ${a.size} фт, ${AB_N[a.save]} СЛ ${a.dc}, ${esc(a.f)} ${esc(a.dtype)}${a.rech ? ` · ${(t.rech || {})[i] ? '<span class="warn-text">ждёт перезарядки</span>' : 'готово'}` : ''}</div>`).join('')}
    ${t.tr ? `<div class="muted small">${esc(t.tr)}</div>` : ''}</div>`;
}
function renderSide() {
  const box = $('#tblSel'), t = selId && game.tokens[selId];
  if (!t) { box.hidden = true; return; }
  box.hidden = false;
  const dm = isDM(), mine = user && t.owner === user.uid, nums = t.kind === 'pc' || dm;
  const pips = (n, cls) => [0, 1, 2].map((i) => `<span class="dpip ${i < n ? cls : ''}"></span>`).join('');
  box.innerHTML = `<div class="row between"><h3>${esc(isDown(t) ? downLabel(t) : t.name)}</h3><button class="ghost" data-tbl="unsel">✕</button></div>
    ${t.hpMax ? `<div>${nums ? `Хиты <b>${t.hp}</b> / ${t.hpMax}${t.temp ? ` (+${t.temp})` : ''}${t.ac ? ` · КД <b>${t.ac}</b>` : ''}` : `<span class="muted">${isDown(t) ? (isDead(t) ? 'мёртв' : 'без сознания') : t.hp / t.hpMax > .5 ? 'бодр' : t.hp / t.hpMax > .25 ? 'ранен' : 'тяжело ранен'}</span>`}</div>` : ''}
    ${isDown(t) && usesDS(t) && nums ? `<div class="death-row"><span>Успехи ${pips(+t.dsS || 0, 'ok')}</span><span>Провалы ${pips(+t.dsF || 0, 'bad')}</span></div>` : ''}
    ${t.speed ? `<div class="muted small">Скорость ${t.speed} фт${t.init != null ? ` · инициатива ${t.init >= 0 ? '+' : ''}${t.init}` : ''}</div>` : ''}
    ${(t.cond || []).length ? `<div class="chips mt">${t.cond.map((c) => `<span class="chip on"><span>${esc(condName(c))}</span></span>`).join('')}</div>` : ''}
    ${fxOf(selId).length ? `<div class="chips mt">${fxOf(selId).map(([k, f]) => `<span class="chip on" title="${esc(f.spell || '')}"><span>${f.ic || '✦'} ${esc(f.n || '')}</span>${dm || mine || f.by === user.uid ? `<button data-tbl="fxDel" data-k="${k}" title="Снять эффект">✕</button>` : ''}</span>`).join('')}</div>` : ''}
    ${dm || mine ? `<div class="row gap wrap mt"><label>Свет <select data-tbl-light>${LIGHTS.map(([v, n], i) => `<option value="${i}" ${(t.lt ? +t.lt.i || 0 : 0) === i ? 'selected' : ''}>${n}${v ? ` (${v.replace('/', '+')} фт)` : ''}</option>`).join('')}</select></label></div>` : ''}
    ${dm && t.kind === 'npc' ? `${npcStatHtml(t)}
      ${isDead(t) ? '<p class="muted small">Тело остаётся на поле: его можно оживить лечением (например, для второй фазы боя) и вернуть в инициативу.</p>' : ''}
      <div class="row gap wrap mt"><label>Сторона <select data-tbl-side>${[['enemy', 'враг'], ['neutral', 'нейтральный'], ['ally', 'союзник игроков']].map(([v, n]) => `<option value="${v}" ${(t.side || 'enemy') === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="check" title="На нуле хитов не умирает сразу, а делает спасброски от смерти, как персонажи"><input type="checkbox" data-tbl-ds ${t.dsOn ? 'checked' : ''}> Спасброски от смерти (босс, важный NPC)</label>
        <label>Опыт <input type="number" min="0" style="width:80px" data-tbl-xp value="${xpOf(t)}"></label></div>
      ${fxOf(selId).some(([, f]) => f.grab) && !incapTok(t) ? `<div class="mt"><button data-tbl="npcEscape" data-id="${selId}">🤼 Вырваться из захвата</button></div>` : ''}
      ${aim && aim.from === selId || incapTok(t) ? '' : `<div class="row gap wrap mt"><button class="primary" data-tbl="npcAttack" data-id="${selId}" title="${inFight() && !isTurnOf(selId) ? 'Не его ход — атака реакцией (по возможности)' : ''}">⚔ Атака${inFight() && !isTurnOf(selId) ? ' реакцией' : ''}</button>
        ${legendOk(selId) ? `<button data-tbl="legend" data-id="${selId}">👑 Легендарное действие (${legendLeft(selId)})</button>` : ''}</div>`}
      <div class="leg-grid mt" title="Легендарные действия восстанавливаются в начале его хода; сопротивление тратится само на провал спасброска против состояния или эффекта">
        <label>👑 Легенд. действий<input type="number" min="0" max="5" data-tbl-num="leg" value="${+t.leg || 0}"></label>
        <label>Легенд. сопротивл.<input type="number" min="0" max="5" data-tbl-num="lr" value="${+t.lr || 0}"></label>
        <label>🚫 Контрзаклинаний<input type="number" min="0" max="9" data-tbl-num="cs" value="${+t.cs || 0}"></label>
        <label>СЛ заклинаний<input type="number" min="0" max="30" data-tbl-num="sdc" value="${+t.sdc || 0}"></label></div>
      <div class="row gap wrap mt"><input type="number" id="tblDmg" min="0" placeholder="0" style="width:70px"><button data-tbl="npcDmg">− Урон</button><button data-tbl="npcHeal">＋ Лечение</button></div>
      <div class="row gap wrap mt"><label class="check"><input type="checkbox" data-tbl-hidden ${t.hidden ? 'checked' : ''}> Скрыт от игроков</label>
      <button data-tbl="npcCopy">⧉ Копия</button><button data-tbl="npcInit">🎲 В инициативу</button></div>
      <div class="muted small mt">Бонусы спасбросков (бросаются автоматически):</div>
      <div class="sv-grid">${Object.entries(AB_N).map(([k]) => `<label>${{ str: 'СИЛ', dex: 'ЛОВ', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР' }[k]}<input type="number" data-tbl-sv="${k}" value="${+((t.sv || {})[k]) || 0}"></label>`).join('')}</div>` : ''}
    ${t.kind === 'pc' && mine ? `<p class="muted small">${t.comp ? 'Хиты спутника — в его карточке в листе (вкладка «Бой»).' : 'Хиты и состояния меняются в вашем листе — на поле они обновятся сами.'}</p>` : ''}
    ${t.comp && mine && !incapTok(t) && !(aim && aim.from === selId) ? `<div class="mt"><button class="primary" data-tbl="compAttack" data-id="${selId}">⚔ Атака спутника</button></div>` : ''}
    ${dm || mine ? `<div class="row gap wrap mt"><label class="btn-file">🖼 Портрет<input type="file" accept="image/*" data-tbl-img hidden></label>${t.img ? '<button class="ghost" data-tbl="imgDel">убрать портрет</button>' : ''}</div>` : ''}
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
      const m = me(), roll = app.mute(() => app.rollInit(m.charId)), s = app.summary(m.charId);
      await R.set(ref(gpath(`init/list/${user.uid}`)), { name: s.name, roll, owner: user.uid, kind: 'pc', tokenId: `pc_${user.uid}` });
    } else if (a === 'rollNpc') {
      const upd = {};
      Object.entries(game.tokens).forEach(([id, t]) => {
        if (t.kind !== 'npc' || isDead(t) || (game.init && game.init.list && game.init.list[id])) return;
        upd[`list/${id}`] = { name: t.name, roll: die(20) + (+t.init || 0), owner: user.uid, kind: 'npc', tokenId: id };
      });
      if (!Object.keys(upd).length) { app.toast('Нет существ без инициативы'); return; }
      await R.update(ref(gpath('init')), upd);
    } else if (a === 'npcInit') {
      const t = game.tokens[selId];
      await R.set(ref(gpath(`init/list/${selId}`)), { name: t.name, roll: die(20) + (+t.init || 0), owner: user.uid, kind: 'npc', tokenId: selId });
    } else if (a === 'startFight') { await R.update(ref(gpath()), { 'init/active': true, 'init/round': 1, 'init/turn': 0, econ: null }); addLog({ kind: 'sys', txt: '⚔ Бой начался · раунд 1' }); }
    else if (a === 'next' || a === 'endTurn') nextTurn();
    else if (a === 'endFight') { if (app.confirm('Закончить бой и очистить инициативу?')) { await R.update(ref(gpath()), { init: null, econ: null }); addLog({ kind: 'sys', txt: 'Бой окончен' });
      if (Object.keys((game.xp || {}).kills || {}).length) xpDialog(true); } }
    else if (a === 'xpGive') xpDialog(false);
    else if (a === 'attack') openAttack(b.dataset.id);
    else if (a === 'aimOff') { aim = null; hint(''); renderAll(); }
    else if (a === 'spell') openCast(b.dataset.id);
    else if (a === 'npcAttack') openNpcAttack(b.dataset.id);
    else if (a === 'legend') openNpcAttack(b.dataset.id, true);
    else if (a === 'compAttack') openCompAttack(b.dataset.id);
    else if (['uncanny', 'deflect', 'rebuke', 'protect'].includes(a)) doReaction(a, b.dataset.id);
    else if (a === 'csUse') csUse(b.dataset.k, b.dataset.id);
    else if (a === 'csNo') await R.update(ref(gpath(`cs/${b.dataset.k}/no`)), { [b.dataset.id]: 1 });
    else if (a === 'lair') {
      const on = game.init && game.init.list && game.init.list.lair;
      if (on) await removeFromInit('lair');
      else {
        // Логово встаёт в очередь раньше текущего участника — сдвинуть указатель хода, чтобы ход не перескочил
        const cur = currentEntry(), upd = { 'list/lair': { name: '🏰 Логово', roll: 20, owner: user.uid, kind: 'lair' } };
        if (cur && cur.roll < 20) upd.turn = (game.init.turn || 0) + 1;
        await R.update(ref(gpath('init')), upd);
      }
    }
    else if (a === 'deathSave') {
      // Спасбросок от смерти из листа; после него ход заканчивается (при 20 — персонаж в сознании и ходит дальше)
      const m = me(), id = b.dataset.id, t = game.tokens[id];
      if (!m || !m.charId || !t) return;
      const r = app.mute(() => app.deathSave(m.charId));
      if (!r) return;
      await R.update(ref(gpath(`econ/${id}`)), { ds: 1 });
      const RES = { revive: 'натуральная 20 — приходит в себя с 1 хитом!', fail2: 'натуральная 1 — два провала', ok: 'успех', fail: 'провал' };
      addLog({ kind: 'death', who: t.name, txt: `спасбросок от смерти ${r.total} — ${RES[r.res]} (успехи ${r.s}/3, провалы ${r.f}/3)${r.s >= 3 ? ' — стабилизирован' : ''}${r.f >= 3 ? ' — погибает' : ''}` });
      if (r.res !== 'revive') setTimeout(() => { if (isTurnOf(id)) nextTurn(); }, 1500);
    }
    else if (a === 'chatSend') sendChat();
    else if (a === 'escape' || a === 'npcEscape') {
      // Вырваться из захвата: игрок — Атлетика или Акробатика из листа, существо — к20 + лучший из мод. Сил/Лов
      const id = b.dataset.id, t = game.tokens[id], g = fxOf(id).find(([, f]) => f.grab);
      if (!t || !g) return;
      let ok, txt;
      if (a === 'escape') { const r = app.mute(() => app.escape(me().charId, g[1].gdc)); if (!r) return; ok = r.ok; txt = `${r.skill} ${r.total}`; }
      else { const bon = Math.max(abMod((t.ab || [])[0]), abMod((t.ab || [])[1])), d = die(20); ok = d + bon >= g[1].gdc; txt = `к20 [${d}] ${fmtMod(bon)} = ${d + bon}`; }
      if (ok) await R.remove(ref(gpath(`effects/${g[0]}`)));
      if (inFight()) await R.update(ref(gpath(`econ/${id}`)), { a: 1 });
      addLog({ kind: 'act', who: t.name, txt: `вырваться из захвата (СЛ ${g[1].gdc}): ${txt} — ${ok ? 'свободен' : 'не вышло'}` });
    }
    else if (a === 'shield') {
      const id = b.dataset.id, t = game.tokens[id], m = me(), O = app.combatOpts(m.charId);
      if (!O.shieldSlots.length || !lastHit) return;
      app.castShield(m.charId, O.shieldSlots[0].key);
      if (inFight()) await R.update(ref(gpath(`econ/${id}`)), { r: 1 });
      await addEffect(id, { n: 'Щит', ic: '🛡', ac: 5, untilTurn: id, by: user.uid, from: id });
      // Попадание с новым КД — промах: урон возвращается
      if (lastHit.dmg) app.heal(m.charId, lastHit.dmg);
      addLog({ kind: 'act', who: t.name, txt: `🛡 «Щит» реакцией: +5 КД — попадание (${lastHit.total}) отменено${lastHit.dmg ? `, ${lastHit.dmg} урона не получено` : ''}` });
      lastHit = null;
    }
    else if (a === 'compPick') {
      const list = app.companions(me().charId), pick = (id) => { compPlace = id; tool = 'placeComp'; renderTools(); app.toast('🐾 Нажмите на клетку, куда поставить спутника'); };
      if (list.length === 1) pick(list[0].id);
      else {
        app.openModal(`<h2>🐾 Спутник на поле</h2><div class="list">${list.map((p) => `<button class="atk-pick" data-cmp="${p.id}"><b>${esc(p.n)}</b><span class="muted small">${esc(p.kind)} · ${p.hp}/${p.hpMax} хитов</span></button>`).join('')}</div>
          <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
        $$('[data-cmp]').forEach((x) => x.addEventListener('click', () => { app.closeModal(); pick(x.dataset.cmp); }));
      }
    }
    else if (a === 'imgDel') {
      const t = game.tokens[selId], m = me();
      if (t && t.kind === 'pc' && !t.comp && m && t.owner === user.uid) app.setPortrait(m.charId, '');
      await R.update(ref(gpath(`tokens/${selId}`)), { img: null });
    }
    else if (a === 'scenes') sceneDialog();
    else if (a === 'rest') restDialog();
    else if (a === 'mapCfg') mapDialog();
    else if (a === 'fogPreview') { fogPreview = !fogPreview; renderAll(); }
    else if (a === 'freeMove') { freeMove = !freeMove; renderTools(); app.toast(freeMove ? '🔓 Свободное перемещение: токены двигаются без учёта хода и скорости' : 'Свободное перемещение выключено'); }
    else if (a === 'castOff') cancelCast();
    else if (a === 'castDone') { if (cast) confirmCast(); }
    else if (a === 'fxDel') await R.remove(ref(gpath(`effects/${b.dataset.k}`)));
    else if (a === 'saveMine') saveMine(b.dataset.k, b.dataset.id);
    else if (a === 'areaAgain') areaAgain(b.dataset.k);
    else if (a === 'areaDel') await R.remove(ref(gpath(`areas/${b.dataset.k}`)));
    else if (a === 'logClear') { if (app.confirm('Очистить журнал для всех?')) await R.remove(ref(gpath('log'))); }
    else if (['eco', 'dash', 'dashB', 'dis', 'disB', 'dodge', 'stand'].includes(a)) await econAct(a, b.dataset.id, b.dataset.k);
    else if (a === 'initDel') await removeFromInit(b.dataset.id);
    else if (a === 'unsel') { selId = null; renderSide(); renderTokens(); }
    else if (a === 'tokDel') { if (app.confirm('Убрать токен с поля?')) { await R.remove(ref(gpath(`tokens/${selId}`))); selId = null; } }
    else if (a === 'npcDmg' || a === 'npcHeal') {
      const t = game.tokens[selId], n = Math.max(0, +$('#tblDmg').value || 0);
      if (!n) return;
      // Лечение существа на нуле хитов возвращает его в сознание и сбрасывает спасброски от смерти
      const upd = a === 'npcDmg' ? npcDamageUpd(selId, t, n, false)
        : { [`tokens/${selId}/hp`]: Math.min(t.hpMax, (+t.hp || 0) + n), ...(isDown(t) ? { [`tokens/${selId}/dsS`]: null, [`tokens/${selId}/dsF`]: null } : {}) };
      await R.update(ref(gpath()), upd);
      if (a === 'npcHeal' && isDown(t)) app.toast(`${esc(t.name)} приходит в себя${isDead(t) ? ' — не забудьте вернуть его в инициативу' : ''}`);
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
  if (e.target.matches('[data-tbl-img]') && game && selId && e.target.files[0]) {
    const id = selId, t = game.tokens[id], m = me();
    portraitFrom(e.target.files[0]).then((img) => {
      // Портрет своего персонажа сохраняется в листе — он будет и в других играх
      if (t && t.kind === 'pc' && !t.comp && m && t.owner === user.uid) app.setPortrait(m.charId, img);
      return R.update(ref(gpath(`tokens/${id}`)), { img });
    }).catch(() => app.toast('Не удалось прочитать картинку'));
  }
  if (e.target.matches('[data-tbl-secret]')) dmSecret = e.target.checked;
  if (e.target.matches('[data-tbl-share]')) ls.set('dnd55-share-rolls', e.target.checked ? '1' : '0');
  if (e.target.matches('[data-tbl-light]') && game && selId) {
    const i = +e.target.value, [b, d] = (LIGHTS[i][0] || '').split('/').map(Number);
    R.update(ref(gpath(`tokens/${selId}`)), { lt: i ? { b, d, i } : null }).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
  }
  if (e.target.matches('[data-tbl-xp]') && game && selId) R.update(ref(gpath(`tokens/${selId}`)), { xp: Math.max(0, +e.target.value || 0) });
  if (e.target.matches('[data-tbl-side]') && game && selId) R.update(ref(gpath(`tokens/${selId}`)), { side: e.target.value });
  if (e.target.matches('[data-tbl-ds]') && game && selId) R.update(ref(gpath(`tokens/${selId}`)), { dsOn: e.target.checked });
  if (e.target.matches('[data-tbl-num]') && game && selId) R.update(ref(gpath(`tokens/${selId}`)), { [e.target.dataset.tblNum]: Math.max(0, +e.target.value || 0) });
  if (e.target.matches('[data-tbl-sv]') && game && selId) R.update(ref(gpath(`tokens/${selId}/sv`)), { [e.target.dataset.tblSv]: +e.target.value || 0 });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'tblChat') { e.preventDefault(); sendChat(); return; }
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
