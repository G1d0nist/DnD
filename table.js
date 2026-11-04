// Игровой стол: комната по коду, поле в клетку, токены, местность, инициатива.
// Данные — Firebase Realtime Database: codes/{КОД} = gameId; games/{gameId}/{meta, members, tokens, map, init}.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = window.dndApp;
const esc = app.esc;
const CELL = 40; // пикселей на клетку (5 фт) при масштабе 100%
const GAME_KEY = 'dnd55-game';
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// block — не пройти, opaque — закрывает обзор и свет, cost — трудная местность
const TERRAIN = {
  wall: { n: 'Стена', color: '#4a4038', block: true, opaque: true },
  difficult: { n: 'Труднопроходимая', color: 'rgba(140,100,40,.45)', cost: 2 },
  water: { n: 'Вода', color: 'rgba(60,110,170,.55)', cost: 2 },
  tree: { n: 'Дерево', color: 'rgba(30,60,28,.55)', block: true, opaque: true, ic: '🌲' },
  rock: { n: 'Скала', color: '#5a554d', block: true, opaque: true, ic: '🪨' },
  bush: { n: 'Кусты', color: 'rgba(70,120,50,.45)', cost: 2, ic: '🌿' },
  road: { n: 'Дорога', color: 'rgba(150,115,70,.4)', ic: '🟫' },
  sand: { n: 'Песок', color: 'rgba(210,180,110,.25)', ic: '🏖' },
  bridge: { n: 'Мост', color: 'rgba(120,80,40,.85)', ic: '🌉' },
  furn: { n: 'Мебель', color: 'rgba(110,70,35,.9)', block: true, ic: '🪑' },
  floor: { n: 'Пол', color: 'rgba(170,148,112,.42)', ic: '⬜' },
  // Труднопроходимая местность разного вида (правила 2024: каждый фут стоит 2)
  thicket: { n: 'Густой лес', color: 'rgba(24,62,26,.62)', cost: 2, ic: '🌳' },
  bog: { n: 'Глубокое болото', color: 'rgba(52,66,34,.72)', cost: 2, ic: '🐸' },
  rubble: { n: 'Завалы', color: 'rgba(105,96,84,.55)', cost: 2, ic: '🧱' },
  slope: { n: 'Крутой склон', color: 'rgba(122,100,70,.42)', cost: 2, ic: '⛰' },
  snow: { n: 'Снег', color: 'rgba(228,234,244,.55)', cost: 2, ic: '❄' },
  ice: { n: 'Лёд', color: 'rgba(160,210,236,.55)', cost: 2, ic: '🧊' },
};
// Цвет земли под картой (meta.ground) — задаёт генератор
const GROUND = { grass: '#24301d', stone: '#2a2622', sand: '#4a3f2a', swamp: '#222b1f', dirt: '#302820', wood: '#33261a', snow: '#4b525a' };
const SIZE_N = { 'Крошечный': 1, 'Маленький': 1, 'Средний': 1, 'Большой': 2, 'Огромный': 3, 'Громадный': 4 };
const PALETTE = ['#d4a64a', '#5b8fc9', '#5a9e5a', '#9b6fd1', '#c97a3d', '#3db0a8', '#c95b8f'];

let FB = null, R = null, db = null, user = null;
let game = null; // { id, code, meta, members, tokens, map, init }
let unsubs = [];
let myGames = null, myGamesLoading = false; // мастер: свои сохранённые игры (users/{uid}/games) для лобби
let openMenu = null; // открытое выпадающее меню панели мастера
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
let logSeen = +ls.get('dnd55-logseen') || 0, zoomInit = false; // телефон: прочитанный журнал, начальный масштаб
const touchPts = new Map(); // касания пальцев по полю
let pinch = null; // масштаб двумя пальцами: { d, z, mx, my }
const ref = (p) => R.ref(db, p);
const gpath = (p = '') => `games/${game.id}${p ? '/' + p : ''}`;
const isDM = () => !!(game && user && game.meta && game.meta.dm === user.uid);
const me = () => (game && user ? (game.members || {})[user.uid] : null);
const canMove = (t) => isDM() || (user && t.owner === user.uid);
const die = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return 1 + (a[0] % n); };
const colorOf = (s) => PALETTE[[...String(s)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const condName = (k) => ((typeof CONDITIONS !== 'undefined' && CONDITIONS.find((c) => c.k === k)) || { n: k }).n;
const INCAP = ['incapacitated', 'paralyzed', 'petrified', 'stunned', 'unconscious'];
// Масштаб: футов в клетке (meta.ft: 5, 10, 30, 100 или 5280 — миля). Всё, что в футах (скорость, дальность, области, свет), пересчитывается в клетки
const FT = () => +((game && game.meta && game.meta.ft) || 5);
const miles = (n) => (!Number.isInteger(n) ? 'мили' : n % 10 === 1 && n % 100 !== 11 ? 'миля' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'мили' : 'миль');
const fmtFt = (ft) => { if (ft < 5280) return `${ft} фт`; const n = +(ft / 5280).toFixed(1); return `${n} ${miles(n)}`; };
const speedOf = (t) =>(t.speed != null && t.speed !== '' ? +t.speed || 0 : 30);

/* ---------- Запуск ---------- */
function boot() {
  if (FB || !window.dndFirebase) return;
  FB = window.dndFirebase; R = FB.R; db = FB.rtdb;
  FB.onUser((u) => {
    const was = user && user.uid;
    user = u;
    if (!u) leaveLocal();
    else if (was !== u.uid) { if (game) { unsubs.forEach((f) => f()); unsubs = []; game = null; selId = null; } myGames = null; tryRejoin(); setTimeout(syncBestiary, 0); }
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
  await R.set(ref(`users/${user.uid}/games/${gid}`), { n: name || 'Новая игра', code, t: Date.now() }).catch(() => {});
  myGames = null;
  subscribe(gid, code);
  app.toast(`🗺 Игра создана. Код: <b>${code}</b> — отправьте его игрокам`, 'crit');
}
// Мастер: список своих игр — чтобы продолжить приключение после выхода
async function loadMyGames() {
  if (!user || !R || myGamesLoading) return;
  myGamesLoading = true;
  try { myGames = (await R.get(ref(`users/${user.uid}/games`))).val() || {}; } catch (e) { myGames = {}; }
  myGamesLoading = false;
  if (!game) renderLobby();
}
async function deleteGame(gid, code) {
  await R.remove(ref(`codes/${code}`)).catch(() => {});
  await R.remove(ref(`games/${gid}`)).catch(() => {});
  await R.remove(ref(`users/${user.uid}/games/${gid}`)).catch(() => {});
  myGames = null;
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
  // Мастер: игра в списке «Мои игры» (и для игр, созданных раньше, чем появился список)
  let indexed = false;
  on('meta', (v) => {
    if (!v) { app.toast('Игра завершена мастером'); if (user) R.remove(ref(`users/${user.uid}/games/${gid}`)).catch(() => {}); leaveLocal(); return; }
    game.meta = v; drawTerrain();
    if (!indexed && user && v.dm === user.uid) { indexed = true; R.update(ref(`users/${user.uid}/games/${gid}`), { n: v.name || 'Игра', code: v.code || code, t: Date.now() }).catch(() => {}); R.update(ref(gpath(`members/${user.uid}`)), { online: true }).catch(() => {}); }
  });
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
  on('loot', (v) => { game.loot = v || {}; syncChests(); });
  on('handouts', (v) => { game.handouts = v || {}; notifyHandouts(); });
  on('chests', (v) => { game.chests = v || {}; drawTerrain(); syncChests(); });
  on('drops', (v) => { game.drops = v || {}; drawTerrain(); });
  on('trades', (v) => { game.trades = v || {}; syncTrades(); });
  on('travel', (v) => { game.travel = v || {}; syncTravel(); });
  on(`lootAward/${user.uid}`, (v) => { game.lootAw = v; applyLoot(); });
  on('members', (v) => { game.members = v || {}; syncEffects(); applyXp(); applyLoot(); handleRest(); syncChests(); });
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
  game = null; selId = null; aim = null; cast = null; ruler = null; bgImg = null; bgSrc = ''; camFree = false; camKey = '';
  ls.set(GAME_KEY, '');
}
async function leaveGame() {
  if (isDM()) {
    // Игра сохраняется целиком: сцены, поле, существа, сундуки, материалы, добыча — продолжить можно из лобби
    const { id, code } = game;
    app.openModal(`<div><h2>Выйти из игры</h2>
      <p>Игра <b>${esc((game.meta || {}).name || '')}</b> сохранится: сцены, поле, существа, сундуки, материалы и добыча. Продолжить её можно в лобби, в «📂 Мои игры»; игроки вернутся по тому же коду <b>${esc(code)}</b>.</p>
      <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="danger" id="lgDel">🗑 Удалить навсегда</button><button class="primary" id="lgKeep">💾 Сохранить и выйти</button></div></div>`);
    $('#lgKeep').onclick = async () => {
      app.closeModal();
      await saveScene().catch(() => {});
      await R.update(ref(gpath(`members/${user.uid}`)), { online: false }).catch(() => {});
      await R.update(ref(`users/${user.uid}/games/${id}`), { n: (game.meta || {}).name || 'Игра', code, t: Date.now() }).catch(() => {});
      leaveLocal(); myGames = null; renderAll();
      app.toast('💾 Игра сохранена — продолжить можно в лобби, «📂 Мои игры»', 'crit');
    };
    $('#lgDel').onclick = async () => {
      if (!app.confirm('Удалить игру навсегда? Сцены, существа и всё на поле пропадут.')) return;
      app.closeModal();
      leaveLocal();
      await deleteGame(id, code);
      renderAll();
    };
    return;
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
// Портрет: квадрат 256×256 из середины картинки
function portraitFrom(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const S = 256, cv = document.createElement('canvas'), k = Math.min(img.naturalWidth, img.naturalHeight);
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
  camClamp();
  b.style.transform = `translate(${-cam.x}px, ${-cam.y}px) scale(${zoom})`;
  ['#tblTerrain', '#tblAreas', '#tblRange', '#tblFog', '#tblFxCv'].forEach((s) => { const cv = $(s); if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } });
  $('#tblZoom').textContent = Math.round(zoom * 100) + '%';
}
/* ---------- Камера ---------- */
// Поле сдвигается целиком, без полос прокрутки. Игрок: камера следует за своим персонажем; нажатие колёсика мыши
// (или перетаскивание пальцем по пустому месту) — свободная камера, ещё одно нажатие колёсика или «◎» — снова к персонажу.
// Мастер: камера всегда свободная, «◎» и колёсико — к выделенному существу или к тому, чей ход
let cam = { x: 0, y: 0 }, camFree = false, camKey = '', camMid = null;
const myTok = () => (user && game ? game.tokens[`pc_${user.uid}`] : null);
const camFollow = () => !isDM() && !camFree && !!myTok();
const ZMIN = 0.3, ZMAX = 2.5;
function camClamp() {
  const w = $('#tblWrap'), vw = w.clientWidth, vh = w.clientHeight;
  if (!vw || !vh) return;
  const bw = W() * CELL * zoom, bh = H() * CELL * zoom, m = Math.min(vw, vh) * 0.3;
  // Поле меньше окна — по центру; больше — не дальше трети окна за край
  cam.x = bw <= vw ? -(vw - bw) / 2 : Math.max(-m, Math.min(bw - vw + m, cam.x));
  cam.y = bh <= vh ? -(vh - bh) / 2 : Math.max(-m, Math.min(bh - vh + m, cam.y));
}
// Плавно (или сразу) поставить клетку x, y (можно дробную) в центр окна
function camCenter(x, y, smooth) {
  const w = $('#tblWrap'), b = $('#tblBoard');
  cam.x = x * CELL * zoom - w.clientWidth / 2; cam.y = y * CELL * zoom - w.clientHeight / 2;
  if (smooth) { b.style.transition = 'transform .3s ease'; clearTimeout(camCenter.t); camCenter.t = setTimeout(() => { b.style.transition = ''; }, 320); }
  layoutBoard();
}
const camOn = (t) => camCenter(t.x + (t.size || 1) / 2, t.y + (t.size || 1) / 2, true);
// После каждой перерисовки: если персонаж сдвинулся (или поменялся масштаб, размер окна) — камера за ним
function camUpdate() {
  renderCam();
  const t = camFollow() && myTok(), w = $('#tblWrap');
  if (!t || (drag && drag.kind === 'token' && drag.id === `pc_${user.uid}`)) return;
  const key = `${t.x}_${t.y}_${zoom}_${W()}x${H()}_${w.clientWidth}x${w.clientHeight}`;
  if (key === camKey) return;
  const first = !camKey;
  camKey = key;
  camCenter(t.x + (t.size || 1) / 2, t.y + (t.size || 1) / 2, !first);
}
function camHome() {
  if (isDM()) { const c = currentEntry(), t = game.tokens[selId] || (c && game.tokens[c.tokenId]); if (t) camOn(t); else zoomFit(); return; }
  camFree = false; camKey = ''; camUpdate();
}
function camSetFree(on) { if (camFree === on) return; camFree = on; if (!on) camKey = ''; camUpdate(); }
// Значок в углу поля: свободная камера и кнопка «◎»
function renderCam() {
  let el = $('#tblCam');
  if (!el) { el = document.createElement('button'); el.id = 'tblCam'; el.className = 'tbl-cam'; el.dataset.tbl = 'camHome'; $('#tblWrap').appendChild(el); }
  const dm = isDM(), mine = myTok();
  el.hidden = !game || (!dm && !mine);
  el.classList.toggle('free', !dm && camFree);
  el.textContent = dm ? '◎' : camFree ? '🎥 Свободно · ◎ к персонажу' : '◎';
  el.title = dm ? 'К выделенному существу или к тому, чей ход (нажатие колёсика мыши)' : camFree ? 'Вернуть камеру к персонажу (нажатие колёсика мыши)' : 'Камера следует за персонажем. Нажатие колёсика мыши — свободная камера';
}
// Масштаб вокруг точки окна (ox, oy); при слежении — вокруг персонажа
function zoomAt(z, ox, oy) {
  z = Math.max(ZMIN, Math.min(ZMAX, +z.toFixed(2)));
  if (z === zoom) return;
  const bx = (cam.x + ox) / zoom, by = (cam.y + oy) / zoom;
  zoom = z;
  cam.x = bx * zoom - ox; cam.y = by * zoom - oy;
  layoutBoard();
  camUpdate();
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
// Рисунок клетки поверх заливки (без карты-подложки): крона дерева, валун, кустики, доски моста, стол; v — разнообразие
function drawCell(g, type, px, py, v) {
  const c = CELL / 2;
  g.save();
  if (type === 'tree') {
    g.fillStyle = '#4a3220'; g.fillRect(px + c - 3, py + c + 4, 6, 10);
    g.fillStyle = ['#2f6b2a', '#3a7a30', '#2a5e26', '#356f2c', '#2d6629'][v];
    g.beginPath(); g.arc(px + c, py + c - 1, 14 + (v % 3), 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.arc(px + c - 5, py + c - 6, 6, 0, Math.PI * 2); g.fill();
  } else if (type === 'rock') {
    g.fillStyle = ['#7a746a', '#6d675e', '#827b70', '#746e64', '#696358'][v];
    g.beginPath(); g.moveTo(px + 6, py + 30); g.lineTo(px + 10 + v, py + 10); g.lineTo(px + 24, py + 6 + v); g.lineTo(px + 34, py + 16); g.lineTo(px + 32, py + 32); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
  } else if (type === 'bush') {
    g.fillStyle = '#4f8a3a';
    [[12, 26], [22, 20], [30, 28]].forEach(([dx, dy]) => { g.beginPath(); g.arc(px + dx, py + dy - v, 6, 0, Math.PI * 2); g.fill(); });
  } else if (type === 'bridge') {
    g.strokeStyle = 'rgba(60,35,15,.8)'; g.lineWidth = 2;
    for (let i = 8; i < CELL; i += 8) { g.beginPath(); g.moveTo(px + i, py + 1); g.lineTo(px + i, py + CELL - 1); g.stroke(); }
  } else if (type === 'furn') {
    g.strokeStyle = '#d4a64a'; g.lineWidth = 1.5; g.strokeRect(px + 4, py + 4, CELL - 8, CELL - 8);
  } else if (type === 'thicket') { // подлесок: несколько тёмных крон внахлёст
    [[11, 13, 9], [27, 12, 8], [19, 26, 10], [31, 29, 7]].forEach(([dx, dy, r], i) => {
      g.fillStyle = ['#1f4a20', '#28592a', '#224f22', '#2c5f2b'][(i + v) % 4]; g.beginPath(); g.arc(px + dx, py + dy, r, 0, Math.PI * 2); g.fill();
    });
  } else if (type === 'bog') { // трясина: тёмные лужи и пузыри
    g.fillStyle = 'rgba(30,40,22,.75)'; g.beginPath(); g.ellipse(px + c - 2 + v, py + c + 3, 13, 7, 0.3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(150,170,110,.55)'; g.lineWidth = 1.2;
    [[10, 10, 3], [30, 14, 2.5], [26, 31, 2]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(px + dx, py + dy - v, r, 0, Math.PI * 2); g.stroke(); });
  } else if (type === 'rubble') { // камни и обломки
    g.fillStyle = ['#8a8274', '#7a7366', '#968d7e'][v % 3]; g.strokeStyle = 'rgba(0,0,0,.35)';
    [[6, 24, 10], [20, 10, 9], [24, 26, 11], [10, 8, 6]].forEach(([dx, dy, s]) => { g.beginPath(); g.moveTo(px + dx, py + dy + s); g.lineTo(px + dx + s * 0.3, py + dy); g.lineTo(px + dx + s, py + dy + s * 0.25); g.lineTo(px + dx + s * 0.9, py + dy + s); g.closePath(); g.fill(); g.stroke(); });
  } else if (type === 'slope') { // склон: шевроны вверх
    g.strokeStyle = 'rgba(225,195,140,.6)'; g.lineWidth = 2.5;
    [12, 26].forEach((dy) => { g.beginPath(); g.moveTo(px + 8, py + dy + 6); g.lineTo(px + c, py + dy - 2); g.lineTo(px + CELL - 8, py + dy + 6); g.stroke(); });
  } else if (type === 'snow') { // снег: сугробы и снежинки
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(px + c, py + CELL - 9, 15, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; [[9, 9], [28, 7], [18, 18], [32, 22], [8, 24]].forEach(([dx, dy]) => { g.beginPath(); g.arc(px + dx + v, py + dy, 1.6, 0, Math.PI * 2); g.fill(); });
  } else if (type === 'ice') { // лёд: блики и трещины
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px + 8, py + 30); g.lineTo(px + 18, py + 20); g.moveTo(px + 20, py + 34); g.lineTo(px + 33, py + 21); g.stroke();
    g.strokeStyle = 'rgba(40,90,120,.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(px + 6 + v, py + 8); g.lineTo(px + 16, py + 14); g.lineTo(px + 14, py + 22); g.stroke();
  } else if (type === 'wall') {
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.moveTo(px, py + c); g.lineTo(px + CELL, py + c); g.moveTo(px + c * (v % 2), py); g.lineTo(px + c * (v % 2), py + c); g.stroke();
  }
  g.restore();
}
function drawTerrain() {
  if (!game) return;
  const cv = $('#tblTerrain'), g = cv.getContext('2d'), bg = bgSet();
  layoutBoard();
  g.clearRect(0, 0, cv.width, cv.height);
  g.fillStyle = GROUND[(game.meta || {}).ground] || '#1f1b16';
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
    if (type === 'difficult' || type === 'bush' || (bgImg && T.cost)) { // штриховка трудной местности (на карте-подложке — у всей)
      g.strokeStyle = type === 'bush' ? 'rgba(120,190,90,.45)' : 'rgba(200,150,70,.5)';
      g.beginPath();
      for (let i = -CELL; i < CELL; i += 10) { g.moveTo(x * CELL + i, y * CELL + CELL); g.lineTo(x * CELL + i + CELL, y * CELL); }
      g.stroke();
    }
    if (!bgImg) drawCell(g, type, x * CELL, y * CELL, (x * 7 + y * 13) % 5);
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
  // Сундуки: закрытый, открытый; мастер видит замок и ловушку
  Object.values(game.chests || {}).forEach((C) => {
    g.font = '22px system-ui'; g.fillText(C.o ? '📭' : '🧰', C.x * CELL + 8, C.y * CELL + 29);
    if (isDM() && !C.o) { g.font = '11px system-ui'; if (+C.lock && !C.lk) g.fillText('🔒', C.x * CELL + 1, C.y * CELL + 12); if (C.trap && !C.toff) g.fillText('⚠', C.x * CELL + CELL - 12, C.y * CELL + 12); }
  });
  // Брошенные вещи — маленький мешок в углу клетки (под токеном тоже видно)
  Object.values(game.drops || {}).forEach((D) => { g.font = '15px system-ui'; g.fillText('🎒', D.x * CELL + CELL - 18, D.y * CELL + CELL - 4); });
  drawPois(g);
  if (!bgImg || bg.grid) {
    g.strokeStyle = bgImg ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.07)';
    g.beginPath();
    for (let x = 0; x <= W(); x++) { g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, cv.height); }
    for (let y = 0; y <= H(); y++) { g.moveTo(0, y * CELL + 0.5); g.lineTo(cv.width, y * CELL + 0.5); }
    g.stroke();
  }
}
// Уменьшить картинку до 2400 пикселей по большей стороне и сжать в JPEG — чтобы быстро грузилась у всех
function shrinkImage(file, max = 2400, q = 0.82) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      ok({ data: cv.toDataURL('image/jpeg', q), w: cv.width, h: cv.height });
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
    <p class="muted small">Подгонка: посчитайте, сколько клеток (по ${fmtFt(FT())}) помещается на карте в ширину, и укажите это число. Сдвигом совместите линии сетки с картой. Стены рисуйте по стенам карты — они закрывают обзор в тумане.</p>
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
    if ((TERRAIN[(game.map || {})[`${cx}_${cy}`]] || {}).opaque || doorShut(`${cx}_${cy}`)) return false;
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
    const rb = L.b / FT(), rd = (L.b + L.d) / FT();
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
    const R2 = Math.max(1, f.sight / FT()), L = lightMap();
    Object.values(game.tokens || {}).filter((t) => team(t) === 'pc' && !isDown(t)).forEach((t) => {
      const s = t.size || 1, ox = t.x + s / 2, oy = t.y + s / 2, dv = (+t.dv || 0) / FT();
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
// Стоимость пути до клеток (футы): клетка по масштабу (5 фт) (по диагонали тоже, правила 2024), +5 в труднопроходимой, +5 ползком; стены непроходимы
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
      const nd = d + FT() * (1 + ((T && T.cost) || o === 'pass' ? 1 : 0) + (crawl ? 1 : 0));
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
    if (!(drag && drag.kind === 'token' && drag.id === id)) {
      // Шаг — плавно; чем дальше, тем дольше (но не дольше секунды), чтобы было видно, куда пошёл
      const n = el._pos ? Math.max(Math.abs(el._pos[0] - t.x), Math.abs(el._pos[1] - t.y)) : 0;
      if (n) el.style.transitionDuration = `${Math.min(1, 0.2 + n * 0.12).toFixed(2)}s`;
      el._pos = [t.x, t.y];
      el.style.left = t.x * CELL + 'px'; el.style.top = t.y * CELL + 'px';
    }
    el.style.width = el.style.height = s * CELL + 'px';
    el.style.setProperty('--tc', t.kind === 'npc' ? SIDE_COLOR[t.side || 'enemy'] : t.color || '#d4a64a');
    const down = isDown(t), dead = down && isDead(t), label = down ? downLabel(t) : t.name;
    el.className = `tok ${t.kind} side-${team(t)} ${canMove(t) ? 'mine' : ''} ${selId === id ? 'sel' : ''} ${cur && cur.tokenId === id ? 'turn' : ''} ${t.hidden ? 'hid' : ''} ${down ? 'down' : ''} ${dead ? 'dead' : ''} ${kbdPick === id && (aim || cast) ? 'kpick' : ''}`;
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
  if (!game || e.button > 0 || pinch || touchPts.size > 1) return;
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
  if (tool === 'encPlace') { tool = 'move'; renderTools(); placeEncounter(p.x, p.y); return; }
  if (tool === 'placeComp') { placeCompanion(p.x, p.y); tool = 'move'; renderTools(); return; }
  // Размещение области: нажатие фиксирует её; для заклинания на одну цель — нажатие на существо
  if (cast) {
    if (cast.area.shape === 'target') {
      if (!tokEl) return;
      const id = tokEl.dataset.tok, src = cast.caster && game.tokens[cast.caster];
      if (game.tokens[id] && isDead(game.tokens[id])) { app.toast('Это труп — заклинание на него не подействует'); return; }
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
  // Сундук: мастер ставит инструментом и правит нажатием, игрок — открывает, стоя рядом
  const chest = !tokEl && chestAt(p.x, p.y);
  if (tool === 'chest' && isDM()) { chestDialog(chest ? chest[0] : null, p.x, p.y); return; }
  if (tool === 'move' && chest) { if (isDM()) chestDialog(chest[0]); else chestPlayer(chest[0]); return; }
  const drop = tool === 'move' && !tokEl && dropAt(p.x, p.y);
  if (drop) { dropDialog(drop[0]); return; }
  const poi = tool === 'move' && !tokEl && poiAt(p.x, p.y);
  if (poi) { poiDialog(poi[0]); return; }
  if (TERRAIN[tool] || tool === 'erase' || tool === 'reveal' || tool === 'conceal') {
    drag = { kind: 'paint', pending: {}, root: tool === 'reveal' || tool === 'conceal' };
    paintAt(p);
  } else if (tool === 'ruler') {
    ruler = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    drag = { kind: 'ruler' };
    drawRuler();
  } else if (tokEl) {
    const id = tokEl.dataset.tok, t = game.tokens[id];
    selId = id; renderSide(); renderTokens(); mtab('turn', true);
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
        dist: reachMap(t.x, t.y, forced ? Infinity : mv.left + (mv.canDash ? mv.speed : 0), occ, mv.prone) });
      drawRange(dg.dist, counted ? mv.left : speed * 2, occ);
    } else {
      // Вне боя — до двойной скорости; на крупном масштабе (округа, путешествие) — свободнее: до 20 клеток
      dg.dist = reachMap(t.x, t.y, FT() > 10 ? FT() * 20 : speed * 2);
      // Вне боя игрок не видит, докуда может дойти, — только расстояние под указателем; мастеру — подсказка
      if (isDM()) drawRange(dg.dist, speed);
    }
    drag = dg;
    tokEl.classList.add('dragging');
  } else {
    // Пустое место: мастер и свободная камера — сдвиг поля; игроку пальцем — тоже, камера становится свободной;
    // мышью при слежении за персонажем поле не сдвигается (для этого — нажатие колёсика)
    if (selId) { selId = null; renderSide(); renderTokens(); }
    if (camFollow() && e.pointerType !== 'touch') return;
    drag = { kind: 'pan', x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
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
// Токен тащат к краю окна — поле подъезжает (без полос прокрутки иначе дальше края не дотянуться)
function edgePan(e) {
  const r = $('#tblWrap').getBoundingClientRect(), E = 36, sp = 14;
  const dx = e.clientX < r.left + E ? -sp : e.clientX > r.right - E ? sp : 0, dy = e.clientY < r.top + E ? -sp : e.clientY > r.bottom - E ? sp : 0;
  if (!dx && !dy) return;
  cam.x += dx; cam.y += dy; layoutBoard();
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
    hint(fmtFt(FT() * Math.max(Math.abs(p.x - ruler.x0), Math.abs(p.y - ruler.y0))), e);
  } else if (drag.kind === 'pan') {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    if (!drag.moved) { drag.moved = true; if (!isDM()) camSetFree(true); }
    cam.x = drag.cx - dx; cam.y = drag.cy - dy; layoutBoard();
  } else if (drag.kind === 'paint') paintAt(p);
  else if (drag.kind === 'token') {
    drag.moved = true;
    edgePan(e);
    const el = $(`[data-tok="${drag.id}"]`);
    if (el) { el.style.left = p.px - drag.offX + 'px'; el.style.top = p.py - drag.offY + 'px'; }
    const tx = Math.round((p.px - drag.offX) / CELL), ty = Math.round((p.py - drag.offY) / CELL);
    const d = drag.dist.get(`${tx}_${ty}`);
    let txt;
    if (tx === drag.sx && ty === drag.sy) txt = '';
    else if (!drag.fight) txt = d == null ? (FT() > 10 ? 'слишком далеко за один раз' : 'дальше двойной скорости') : `${fmtFt(d)}${d > drag.speed && FT() <= 10 ? ' — с Рывком' : ''}`;
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
        upd[`econ/${d.id}/move`] = (econ(d.id).move || 0) + (cost != null ? cost : FT() * Math.max(Math.abs(x - d.sx), Math.abs(y - d.sy)));
        checkOpportunity(d.id, { ...t, x, y }, d.sx, d.sy);
      }
    }
    t.x = x; t.y = y;
    renderTokens();
    travelStep(d.id, Math.max(Math.abs(x - d.sx), Math.abs(y - d.sy)));
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
// Бестиарий: встроенный + свои существа мастера (хранятся на его устройстве; своё с тем же e заменяет встроенное).
// Список отсортирован по опасности, затем по названию
let monCache = null;
const customMons = () => { try { return JSON.parse(ls.get('dnd55-bestiary')) || []; } catch (e) { return []; } };
function BEST() {
  if (monCache) return monCache;
  const base = typeof BESTIARY !== 'undefined' ? BESTIARY : [], mine = customMons().map((m) => ({ ...m, custom: true }));
  monCache = [...mine, ...base.filter((m) => !mine.some((c) => c.e === m.e))]
    .sort((a, b) => crNum(a.cr) - crNum(b.cr) || String(a.n).localeCompare(String(b.n), 'ru'));
  return monCache;
}
// Своё бестиарие мастера хранится и в браузере, и в аккаунте (users/{uid}/bestiary) — одно и то же на всех устройствах
function saveCustomMons(list) {
  ls.set('dnd55-bestiary', JSON.stringify(list)); monCache = null;
  if (user && R) R.set(ref(`users/${user.uid}/bestiary`), list).catch(() => {});
}
// При входе: объединить копию из аккаунта и из браузера (одно существо — более свежая правка, поле t)
async function syncBestiary() {
  if (!user || !R) return;
  try {
    const remote = (await R.get(ref(`users/${user.uid}/bestiary`))).val();
    const list = Array.isArray(remote) ? remote.filter(Boolean) : remote ? Object.values(remote) : [], byE = new Map();
    [...list, ...customMons()].forEach((m) => { if (!m || !m.e) return; const o = byE.get(m.e); if (!o || (+m.t || 0) >= (+o.t || 0)) byE.set(m.e, m); });
    const merged = [...byE.values()];
    ls.set('dnd55-bestiary', JSON.stringify(merged)); monCache = null;
    if (JSON.stringify(merged) !== JSON.stringify(list)) await R.set(ref(`users/${user.uid}/bestiary`), merged);
  } catch (e) { /* нет сети или прав — остаётся копия в браузере */ }
}
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
    $('#nList').innerHTML = group('✎ Мои существа', found.filter((m) => m.custom)) + group('Враги и чудовища', found.filter((m) => !m.custom && m.cat !== 'npc'))
      + group('NPC — жители мира', found.filter((m) => !m.custom && m.cat === 'npc'))
      || '<p class="muted small">Ничего не найдено — заполните поля вручную.</p>';
    $$('#nList [data-mon]').forEach((x) => x.addEventListener('click', () => pick(BEST().find((m) => m.e === x.dataset.mon))));
  };
  if (!base) { list(); $('#nFind').addEventListener('input', list); }
  $('#nOk').onclick = () => {
    const n = Math.max(1, Math.min(12, +$('#nC').value || 1)), size = +$('#nZ').value || 1, upd = {}, name = $('#nN').value.trim() || 'Существо';
    // Статблок: из бестиария, из копируемого существа или одна своя атака
    let stats;
    if (mon) stats = monStats(mon);
    else if (base) stats = { ...['mon', 'cr', 'ab', 'atk', 'acts', 'multi', 'tr', 'spd', 'sv', 'img', 'leg', 'lr', 'lrMax', 'cs', 'sdc', 'mt', 'hoard', 'lootFix', 'lootGp', 'lootRnd'].reduce((o, k) => (base[k] != null ? { ...o, [k]: base[k] } : o), {}) };
    else {
      const an = $('#nAn').value.trim();
      stats = { multi: 1, atk: an ? [{ n: an, hit: +$('#nAh').value || 0, dmg: $('#nAd').value.trim(), type: $('#nAt').value.trim(), reach: $('#nAr').value.trim() ? 0 : 5, range: $('#nAr').value.trim() }] : [] };
    }
    for (let i = 0; i < n; i++) {
      const id = R.push(ref(gpath('tokens'))).key, hp = mon && $('#nRoll').checked ? Math.max(1, rollExpr(mon.hp).total) : +$('#nH').value || 1;
      upd[id] = { kind: 'npc', owner: user.uid, name: n > 1 ? `${name} ${i + 1}` : name, x: Math.min(W() - size, x + i * size), y, size, color: '#c94a3d',
        hp, hpMax: hp, ac: +$('#nA').value || 10, speed: +$('#nS').value || 30, init: +$('#nI').value || 0, hidden: $('#nHid').checked, cond: [], side: $('#nSide').value, dsOn: $('#nDs').checked, ...stats, xp: Math.max(0, +$('#nXp').value || 0) };
      upd[id].loot = genLoot(upd[id]);
    }
    R.update(ref(gpath('tokens')), upd);
    app.closeModal();
    tool = 'move'; renderTools();
  };
}
// Статблок существа из бестиария для токена
function monStats(mon) {
  return { mon: mon.e, cr: mon.cr, ab: mon.ab, atk: mon.atk, acts: mon.acts || [], multi: mon.multi || 1, tr: mon.x || '', spd: mon.speed,
    sv: Object.fromEntries(ABK.map((k, i) => [k, mon.sv[k] != null ? mon.sv[k] : abMod(mon.ab[i])])),
    ...['leg', 'cs', 'sdc'].reduce((o, k) => (mon[k] ? { ...o, [k]: mon[k] } : o), {}), ...(mon.lr ? { lr: mon.lr, lrMax: mon.lr } : {}),
    // Вид и добыча: своя из бестиария (всегда), случайная по ПО, сокровищница у боссов
    mt: mon.type || 'monstrosity', ...(mon.hoard ? { hoard: true } : {}), ...(mon.loot ? { lootFix: mon.loot.fixed || [], lootGp: +mon.loot.gp || 0, lootRnd: mon.loot.rnd !== false } : {}) };
}

/* ---------- Конструктор столкновений ---------- */
// Бюджет опыта на персонажа по уровню (DMG 2024): низкая, умеренная, высокая сложность. Множителя за число врагов в 2024 нет
const ENC_BUDGET = [null, [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100], [600, 1000, 1400], [750, 1300, 1700],
  [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100], [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200],
  [3300, 5400, 7800], [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]];
const ENC_N = ['Низкая', 'Умеренная', 'Высокая'];
const crXp = (cr) => (typeof XP_CR !== 'undefined' ? XP_CR[cr] || 0 : 0);
// Черновик столкновения хранится на устройстве мастера: { list: [{ e, n }], party: { uid: { on, lvl } }, hid, roll, init }
let enc = null;
function encLoad() {
  if (enc) return enc;
  try { enc = JSON.parse(ls.get('dnd55-enc')) || null; } catch (e) { enc = null; }
  enc = { list: [], party: {}, hid: false, roll: false, init: true, ...(enc || {}) };
  return enc;
}
const encSave = () => ls.set('dnd55-enc', JSON.stringify(enc));
function encDialog() {
  encLoad();
  const players = Object.entries(game.members || {}).filter(([, m]) => m.role !== 'dm');
  app.openModal(`<div id="encBox"><h2>⚔ Конструктор столкновения</h2>
    <div class="muted small">Группа (уровни можно поправить):</div>
    <div class="enc-party">${players.map(([uid, m]) => { const p = enc.party[uid] || {}; return `<label class="check"><input type="checkbox" data-encp="${uid}" ${p.on === false ? '' : 'checked'}>
      ${esc((m.char || {}).name || m.name)}<input type="number" min="1" max="20" data-encl="${uid}" value="${p.lvl || (m.char || {}).lvl || 1}"></label>`; }).join('') || '<p class="muted small">Игроков ещё нет — добавьте уровни вручную:</p>'}
      <label class="check">Ещё персонажей<input type="number" min="0" max="8" id="encExtraN" value="${enc.extraN || 0}"> ур.<input type="number" min="1" max="20" id="encExtraL" value="${enc.extraL || 1}"></label></div>
    <div id="encMeter" class="enc-meter mt"></div>
    <div id="encList" class="list mt"></div>
    <label class="mt">Бестиарий<input id="encFind" placeholder="Поиск: гоблин, дракон, 1/4…" autocomplete="off"></label><div id="encMon" class="mon-list"></div>
    <div class="row gap wrap mt"><label class="check"><input type="checkbox" id="encHid" ${enc.hid ? 'checked' : ''}> Скрыты от игроков</label>
      <label class="check"><input type="checkbox" id="encRoll" ${enc.roll ? 'checked' : ''}> Бросить хиты</label>
      <label class="check"><input type="checkbox" id="encInit" ${enc.init ? 'checked' : ''}> Сразу в инициативу</label></div>
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button><button id="encClear">Очистить</button><button class="primary" id="encPut">📍 Поставить на поле</button></div></div>`);
  const party = () => {
    const lv = players.filter(([uid]) => ($(`[data-encp="${uid}"]`) || {}).checked).map(([uid]) => Math.max(1, Math.min(20, +$(`[data-encl="${uid}"]`).value || 1)));
    const n = Math.max(0, +$('#encExtraN').value || 0), l = Math.max(1, Math.min(20, +$('#encExtraL').value || 1));
    return [...lv, ...Array(n).fill(l)];
  };
  const draw = () => {
    const lv = party(), budget = [0, 1, 2].map((i) => lv.reduce((s, l) => s + ENC_BUDGET[l][i], 0));
    const mons = enc.list.map((x) => ({ ...x, m: BEST().find((m) => m.e === x.e) })).filter((x) => x.m);
    const xp = mons.reduce((s, x) => s + crXp(x.m.cr) * x.n, 0), lvl = lv.length ? Math.round(lv.reduce((a, b) => a + b, 0) / lv.length) : 1;
    const lvlIdx = budget.findIndex((b) => xp <= b), max = Math.max(budget[2] * 1.3, xp, 1);
    const label = !xp ? '—' : lvlIdx < 0 ? 'Выше высокой — смертельно опасно' : ENC_N[lvlIdx];
    $('#encMeter').innerHTML = `<div class="row between"><b>Опыт врагов: ${xp}</b><span class="enc-lbl d${lvlIdx < 0 ? 3 : lvlIdx}">${label}</span></div>
      <div class="enc-bar"><div style="width:${Math.min(100, (xp / max) * 100)}%" class="d${lvlIdx < 0 ? 3 : lvlIdx}"></div>${budget.map((b, i) => `<span class="enc-mark" style="left:${(b / max) * 100}%" title="${ENC_N[i]}: ${b}"></span>`).join('')}</div>
      <div class="muted small">Бюджет группы (${lv.length} перс.): ${budget.map((b, i) => `${ENC_N[i].toLowerCase()} ${b}`).join(' · ')}${mons.some((x) => crNum(x.m.cr) > lvl) ? ` · <span class="warn-text">⚠ существо с ПО выше среднего уровня группы (${lvl}) может убить персонажа одним ударом</span>` : ''}</div>`;
    $('#encList').innerHTML = mons.map((x, i) => `<div class="enc-row"><span><b>${esc(x.m.n)}</b> <span class="muted small">ПО ${x.m.cr} · ${crXp(x.m.cr)} оп.</span></span>
      <span class="qty"><button data-encd="${i}" data-d="-1">−</button><b>${x.n}</b><button data-encd="${i}" data-d="1">+</button></span></div>`).join('') || '<p class="muted small">Добавьте существ из бестиария ниже.</p>';
    $$('[data-encd]').forEach((b) => b.addEventListener('click', () => { const x = enc.list[+b.dataset.encd]; x.n += +b.dataset.d; if (x.n <= 0) enc.list.splice(+b.dataset.encd, 1); encSave(); draw(); }));
  };
  const monList = () => {
    const q = ($('#encFind').value || '').trim().toLowerCase();
    $('#encMon').innerHTML = BEST().filter((m) => !q || m.n.toLowerCase().includes(q) || m.e.toLowerCase().includes(q) || m.cr === q).map((m) =>
      `<button data-encm="${esc(m.e)}"><b>${esc(m.n)}</b><span class="muted small">ПО ${m.cr} · ${crXp(m.cr)} оп. · КД ${m.ac} · ${avgExpr(m.hp)} хитов</span></button>`).join('');
    $$('[data-encm]').forEach((b) => b.addEventListener('click', () => { const x = enc.list.find((y) => y.e === b.dataset.encm); if (x) x.n += 1; else enc.list.push({ e: b.dataset.encm, n: 1 }); encSave(); draw(); }));
  };
  // Состав группы и галочки запоминаются вместе с черновиком
  $('#encBox').addEventListener('input', (e) => {
    if (e.target.id === 'encFind') { monList(); return; }
    players.forEach(([uid]) => { enc.party[uid] = { on: $(`[data-encp="${uid}"]`).checked, lvl: +$(`[data-encl="${uid}"]`).value || 1 }; });
    Object.assign(enc, { extraN: +$('#encExtraN').value || 0, extraL: +$('#encExtraL').value || 1, hid: $('#encHid').checked, roll: $('#encRoll').checked, init: $('#encInit').checked });
    encSave(); draw();
  });
  $('#encClear').onclick = () => { enc.list = []; encSave(); draw(); };
  $('#encPut').onclick = () => {
    if (!enc.list.length) { app.toast('Добавьте существ'); return; }
    app.closeModal();
    tool = 'encPlace'; renderTools();
    app.toast('📍 Нажмите на клетку — существа встанут вокруг неё');
  };
  monList(); draw();
}
// Свободная клетка для существа размера s рядом с (x, y): по кольцам вокруг, без стен, дверей и других существ
function freeSpot(x, y, s, taken) {
  const busy = (cx, cy) => {
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) {
      const k = `${cx + dx}_${cy + dy}`, T = TERRAIN[(game.map || {})[k]];
      if (cx + dx >= W() || cy + dy >= H() || (T && T.block) || doorShut(k) || taken.has(k)) return true;
    }
    return false;
  };
  for (let r = 0; r < Math.max(W(), H()); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = x + dx, cy = y + dy;
      if (cx >= 0 && cy >= 0 && !busy(cx, cy)) return [cx, cy];
    }
  }
  return null;
}
function placeEncounter(x, y) {
  encLoad();
  const taken = new Set(), upd = {}, names = [];
  Object.values(game.tokens).forEach((t) => { for (let dx = 0; dx < (t.size || 1); dx++) for (let dy = 0; dy < (t.size || 1); dy++) taken.add(`${t.x + dx}_${t.y + dy}`); });
  enc.list.forEach(({ e, n }) => {
    const mon = BEST().find((m) => m.e === e);
    if (!mon) return;
    const size = SIZE_N[mon.size] || 1;
    for (let i = 0; i < n; i++) {
      const pos = freeSpot(x, y, size, taken);
      if (!pos) break;
      for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) taken.add(`${pos[0] + dx}_${pos[1] + dy}`);
      const id = R.push(ref(gpath('tokens'))).key, hp = enc.roll ? Math.max(1, rollExpr(mon.hp).total) : avgExpr(mon.hp), name = n > 1 ? `${mon.n} ${i + 1}` : mon.n;
      upd[`tokens/${id}`] = { kind: 'npc', owner: user.uid, name, x: pos[0], y: pos[1], size, color: '#c94a3d', hp, hpMax: hp, ac: mon.ac, speed: parseInt(mon.speed) || 30,
        init: abMod(mon.ab[1]), hidden: !!enc.hid, cond: [], side: 'enemy', dsOn: false, ...monStats(mon), xp: crXp(mon.cr) };
      upd[`tokens/${id}`].loot = genLoot(upd[`tokens/${id}`]);
      if (enc.init) upd[`init/list/${id}`] = { name, roll: die(20) + abMod(mon.ab[1]), owner: user.uid, kind: 'npc', tokenId: id };
      names.push(name);
    }
  });
  if (!names.length) { app.toast('Не нашлось свободного места'); return; }
  R.update(ref(gpath()), upd).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
  if (!enc.hid) addLog({ kind: 'sys', txt: `⚔ Появляются: ${names.join(', ')}` });
  app.toast(`Поставлено существ: ${names.length}${enc.init ? ' · инициатива брошена' : ''}`);
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
// Расстояние между существами (фт): по ближайшим клеткам, диагональ — как прямая. Соседние клетки — 5 фт (вплотную,
// ближний бой при любом масштабе), каждая следующая — ещё клетка по масштабу
function distFt(a, b) {
  const as = a.size || 1, bs = b.size || 1;
  const dx = Math.max(0, a.x - (b.x + bs - 1), b.x - (a.x + as - 1)), dy = Math.max(0, a.y - (b.y + bs - 1), b.y - (a.y + as - 1));
  const n = Math.max(dx, dy);
  return n ? 5 + (n - 1) * FT() : 0;
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
  if (isDead(T)) { app.toast('Это труп — атаковать некого'); return; }
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
    mtab('turn', true);
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
  return { ...A, ox: t.x + s / 2, oy: t.y + s / 2, r: A.size / FT() + s / 2 };
}
// Размер области в клетках при текущем масштабе (не меньше клетки) и полуширина линии
const aLen = (A) => Math.max(1, (+A.size || 0) / FT());
const aHalfW = (A) => Math.max(0.5, (+A.width || 5) / (2 * FT()));
function ptIn(A, px, py) {
  const vx = px - A.ox, vy = py - A.oy, L = aLen(A), e = 1e-6;
  if (A.shape === 'sphere' || A.shape === 'aura') return Math.hypot(vx, vy) <= (A.r || L) + e;
  const ux = Math.cos(A.ang || 0), uy = Math.sin(A.ang || 0), along = vx * ux + vy * uy, across = -vx * uy + vy * ux;
  if (A.shape === 'cone') return along > 0 && Math.hypot(vx, vy) <= L + e && Math.abs(Math.atan2(across, along)) <= CONE_HALF + e;
  if (A.shape === 'line') return along >= -e && along <= L + e && Math.abs(across) <= aHalfW(A) + e;
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
  const R = Math.max(g.r || 0, aLen(g)) + 1;
  for (let x = Math.max(0, Math.floor(g.ox - R)); x < Math.min(W(), Math.ceil(g.ox + R)); x++)
    for (let y = Math.max(0, Math.floor(g.oy - R)); y < Math.min(H(), Math.ceil(g.oy + R)); y++) if (cellIn(g, x, y)) out.push([x, y]);
  return out;
}
// Кого задевает область: мёртвых (трупы, три провала) — нет; без сознания, но живых — да (урон — провал спасброска от смерти)
function areaTokens(A) {
  if (A.shape === 'target') return (A.tgts && A.tgts.length ? A.tgts : A.tgt ? [A.tgt] : []).filter((id) => game.tokens[id] && !isDead(game.tokens[id]));
  const set = new Set(areaCells(A).map(([x, y]) => `${x}_${y}`));
  return Object.entries(game.tokens).filter(([id, t]) => {
    if ((A.shape === 'aura' && id === A.from) || (t.hidden && !isDM()) || isDead(t)) return false;
    const s = t.size || 1;
    for (let dx = 0; dx < s; dx++) for (let dy = 0; dy < s; dy++) if (set.has(`${t.x + dx}_${t.y + dy}`)) return true;
    return false;
  }).map(([id]) => id);
}
function shapePath(g, A) {
  const ox = A.ox * CELL, oy = A.oy * CELL, L = aLen(A) * CELL, ang = A.ang || 0, ux = Math.cos(ang), uy = Math.sin(ang);
  if (A.shape === 'sphere' || A.shape === 'aura') { g.arc(ox, oy, (A.r || aLen(A)) * CELL, 0, Math.PI * 2); return; }
  if (A.shape === 'cone') { g.moveTo(ox, oy); g.arc(ox, oy, L, ang - CONE_HALF, ang + CONE_HALF); g.closePath(); return; }
  const w = A.shape === 'line' ? aHalfW(A) * CELL : L / 2, nx = -uy * w, ny = ux * w;
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
    const n = Math.round(aLen(A)), snap = (v) => (n % 2 ? Math.floor(v) + 0.5 : Math.round(v)), cx = snap(mx), cy = snap(my);
    Object.assign(A, { ang: 0, ox: cx - n / 2, oy: cy });
  }
}
// Центр размещённой области в пределах дистанции заклинания
function castInRange() {
  const A = cast.area, src = cast.caster && game.tokens[cast.caster];
  if (!src || !cast.range || cast.self || A.shape === 'aura') return true;
  if (A.shape === 'target') { const ids = areaTokens(A); return ids.length > 0 && ids.every((id) => distFt(src, game.tokens[id]) <= cast.range); }
  const cx = A.shape === 'cube' ? A.ox + aLen(A) / 2 : A.ox;
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
  $$('[data-sp]').forEach((b) => b.addEventListener('click', () => spellPick(id, list.find((x) => x.id === b.dataset.sp))));
}
// Заклинание выбрано (из меню или с панели): ячейка — и размещение на поле
function spellPick(id, I) {
  const m = me(), F = SPELL_FX[I.e];
  if (!m || !m.charId) return;
  // Число целей растёт с уровнем ячейки («Благословение»: 3 + 1 за уровень выше 1)
  const go = (slotKey, lvl) => {
    app.closeModal();
    const nT = F && I.shape === 'target' ? (F.n || 1) + Math.max(0, (lvl || I.l) - I.l) * (F.up || 0) : 1;
    startCast({ info: { ...I, fxDef: F || null, nT, pick: I.pick || !!(F && F.heal) }, caster: id, charId: m.charId, slotKey, lvl: lvl || I.l });
  };
  const slots = I.slots.filter((s) => s.left > 0);
  if (!I.l) { go('free', 0); return; }
  if (!slots.length) { app.toast('Нет свободных ячеек'); return; }
  app.openModal(`<h2>${esc(I.n)}</h2><p class="muted small">Выберите ячейку${I.u ? ` — выше уровня: +${esc(I.u)} за уровень` : ''}${F && F.up ? ` — выше уровня: +${F.up} цель за уровень` : ''}.</p>
    <div class="slot-choice">${slots.map((s) => `<button data-slot="${s.key}" data-lvl="${s.lvl}">${esc(s.label)}</button>`).join('')}</div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  $$('[data-slot]').forEach((x) => x.addEventListener('click', () => go(x.dataset.slot, +x.dataset.lvl)));
}
// Можно ли сейчас это заклинание (вне боя — всегда; в бою — по своему действию, бонусному или реакции)
function spellCan(id, act) {
  const e = econ(id), turn = isTurnOf(id);
  return !inFight() || (act === 'reaction' ? !e.r : turn && (act === 'bonus' ? !e.b : !e.a && !(e.atk > 0)));
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
  // Погибшие, пока область ждала спасбросков, просто вычёркиваются — по трупу урон не идёт
  const live = Object.entries(A.tg || {}).filter(([id, v]) => !v.done && game.tokens[id] && game.tokens[id].kind === 'npc');
  const dead = live.filter(([id]) => isDead(game.tokens[id])).map(([id]) => id), ids = live.filter(([id]) => !isDead(game.tokens[id])).map(([id]) => id);
  if (dead.length) R.update(ref(gpath()), Object.fromEntries(dead.map((id) => [`areas/${k}/tg/${id}`, { done: true, ok: true, dmg: 0, dead: true }]))).catch(() => {});
  if (!ids.length) { if (dead.length) finishArea(k, dead); return; }
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
    if (t.kind === 'pc') { app.toast(`✨ ${esc(A.n)}: спасбросок ${AB_N[A.abil]} СЛ ${A.dc} — бросьте в панели «Спасброски»`, 'crit'); mtab('turn', true); }
  }));
}
function renderSaves() {
  const box = $('#tblSaves');
  if (!box) return;
  const dm = isDM(), rows = tradeRows(), nTrade = rows.length;
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
  box.innerHTML = `<h3>${rows.length === nTrade ? '🤝 Передачи и обмен' : 'Области, спасброски и реакции'}</h3>${rows.join('')}`;
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
  mtab('turn', true);
  camSetFree(false); // свой ход — камера к персонажу
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
  n = Math.round((n * 5) / FT()); // n — по 5 фт; в клетках при крупном масштабе толчок может не сдвинуть вовсе
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
      if ((TERRAIN[(game.map || {})[k]] || {}).block || doorShut(k)) blocked = true;
      if (Object.entries(game.tokens).some(([oid, o]) => oid !== id && nx + dx >= o.x && nx + dx < o.x + (o.size || 1) && ny + dy >= o.y && ny + dy < o.y + (o.size || 1))) blocked = true;
    }
    if (blocked) break;
    x = nx; y = ny;
  }
  if (x !== t.x || y !== t.y) {
    R.update(ref(gpath(`tokens/${id}`)), { x, y }).catch(() => {});
    addLog({ kind: 'act', who: t.name, txt: `отброшен на ${fmtFt(FT() * Math.max(Math.abs(x - t.x), Math.abs(y - t.y)))}` });
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

/* ---------- Добыча ---------- */
// games/{id}/loot: { gp, items: { k: предмет } } — общий котёл, пишет мастер; lootAward/{uid}/{k} — выдано персонажу:
// его браузер кладёт добычу в лист и удаляет запись. Предмет: { kind: item | magic, n, qty, mn — магический предмет,
// base — оружие или доспех для «+1», cat, cost, x — для обычных (свиток, камень), r — редкость }.
// У существа на поле своя добыча: tokens/{id}/loot = { gp, items: [] } — бросается при появлении, мастер видит и правит её
// Ступень опасности: 0 — ПО 0–4, 1 — 5–10, 2 — 11–16, 3 — 17+ (по уровню группы — те же границы)
const tierCR = (cr) => { const v = crNum(cr ?? 0); return v >= 17 ? 3 : v >= 11 ? 2 : v >= 5 ? 1 : 0; };
const tierLvl = (l) => (l >= 17 ? 3 : l >= 11 ? 2 : l >= 5 ? 1 : 0);
const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const MI = () => (typeof MAGIC_ITEMS !== 'undefined' ? MAGIC_ITEMS : []);
const RAR_N = ['обычный', 'необычный', 'редкий', 'очень редкий', 'легендарный'];
// Редкость магического предмета по ступени — в рамках рекомендаций DMG 2024 (вероятности в процентах)
const RAR_TIER = [[30, 60, 10, 0, 0], [0, 45, 45, 10, 0], [0, 10, 45, 40, 5], [0, 0, 25, 55, 20]];
function rollRarity(tier) {
  const w = RAR_TIER[Math.max(0, Math.min(3, tier))];
  let x = Math.random() * 100;
  for (let i = 0; i < 5; i++) { x -= w[i]; if (x < 0) return i; }
  return 1;
}
// Свиток заклинания: уровень по редкости — обычный 0–1, необычный 2–3, редкий 4–5, очень редкий 6–8, легендарный 9
const SCROLL_LV = [[0, 1], [2, 3], [4, 5], [6, 8], [9, 9]];
function scrollItem(s) {
  const lv = +s.l;
  return { kind: 'item', n: `Свиток: ${s.n}${lv ? ` (${lv} ур.)` : ' (заговор)'}`, qty: 1, cat: 'Расходник',
    x: `Свиток заклинания: прочитать — сотворить «${s.n}» без ячейки, свиток рассыпается. Чужое заклинание — проверка заклинательной характеристики.`,
    r: SCROLL_LV.findIndex(([a, b]) => lv >= a && lv <= b) };
}
function magicItem(M, baseN) {
  const base = !M.pick ? null : baseN ? (M.pick === 'w' ? WEAPONS.find((w) => w.n === baseN) : ARMOR.find((a) => a.id === baseN || a.n === baseN))
    : M.pick === 'w' ? pickOne(WEAPONS) : pickOne(ARMOR.filter((a) => a.type !== 'shield'));
  return { kind: 'magic', mn: M.n, n: magicName(M, base && base.n), qty: 1, r: M.r, ...(base ? { base: M.pick === 'w' ? base.n : base.id } : {}) };
}
// Случайный магический предмет редкости r; каждый четвёртый — свиток заклинания
function rollMagic(r) {
  if (chance(0.25) && typeof SPELLS !== 'undefined') {
    const [a, b] = SCROLL_LV[r], lv = a + Math.floor(Math.random() * (b - a + 1)), s = pickOne(SPELLS.filter((x) => +x.l === lv));
    if (s) return scrollItem(s);
  }
  const list = MI().filter((m) => m.r === r);
  return list.length ? magicItem(pickOne(list)) : null;
}
// Драгоценность или предмет искусства по ступени
const GEM_T = [[10, 50], [50, 100, 500], [500, 1000], [1000, 5000]], ART_T = [[25], [250, 750], [750, 2500], [2500, 7500]];
function valuable(v, art) { return { kind: 'item', n: `${pickOne((art ? ART : GEMS)[v])} (${v} зм)`, qty: 1, cat: 'Сокровище', cost: `${v} зм` }; }
const rollValuable = (tier) => { const art = chance(0.4); return valuable(pickOne((art ? ART_T : GEM_T)[tier]), art); };
// Одинаковые предметы — в одну строку с количеством
function mergeLoot(items) {
  const out = [];
  items.filter(Boolean).forEach((it) => { const same = out.find((x) => x.n === it.n && x.kind === it.kind); if (same) same.qty = (+same.qty || 1) + (+it.qty || 1); else out.push({ ...it }); });
  return out;
}
// Что носит существо по виду: доля монет, шанс драгоценности, снаряжение из атак, множитель шанса магического предмета
const CARRY = {
  beast: {}, ooze: {}, plant: {}, construct: {}, elemental: { val: 0.2 }, celestial: { val: 0.2, magic: 1 },
  undead: { coin: 0.5, val: 0.3, gear: true, magic: 1 }, humanoid: { coin: 1, val: 0.15, gear: true, magic: 1 }, giant: { coin: 1, val: 0.3, magic: 1 },
  dragon: { coin: 2, val: 0.6, magic: 1.5 }, fiend: { coin: 0.5, val: 0.2, magic: 1 }, fey: { coin: 0.5, val: 0.3, magic: 1 },
  aberration: { coin: 0.5, val: 0.3, magic: 1 }, monstrosity: { coin: 0.3, val: 0.2, magic: 0.5 },
};
const TYPE_N = { humanoid: 'гуманоид', beast: 'зверь', monstrosity: 'чудовище', undead: 'нежить', dragon: 'дракон', giant: 'великан', fiend: 'исчадие',
  celestial: 'небожитель', fey: 'фея', elemental: 'элементаль', construct: 'конструкт', aberration: 'аберрация', ooze: 'слизь', plant: 'растение' };
const MAGIC_P = [0.06, 0.15, 0.25, 0.35];
const monType = (t) => t.mt || (BEST().find((m) => m.e === t.mon) || {}).type || 'monstrosity';
// Добыча существа: монеты (индивидуальное сокровище по ПО) × доля по виду, снаряжение из атак, иногда драгоценность и магический предмет.
// Своя добыча из бестиария (lootFix, lootGp) — всегда; lootRnd === false — только она
function genLoot(t) {
  const fixed = (t.lootFix || []).map((x) => ({ ...x })), gpFix = +t.lootGp || 0;
  if (t.lootRnd === false) return { gp: gpFix, items: fixed };
  if (t.hoard) { const h = genHoard(tierCR(t.cr)); return { gp: h.gp + gpFix, items: mergeLoot([...fixed, ...h.items]) }; }
  const C = CARRY[monType(t)] || CARRY.monstrosity, tier = tierCR(t.cr), r = (e) => rollExpr(e).total;
  const coins = [r('3d6'), r('2d8') * 10, r('2d10') * 100, r('2d8') * 1000][tier];
  const items = [...fixed];
  if (C.gear) (t.atk || []).forEach((a) => { const w = WEAPONS.find((x) => x.n.toLowerCase() === String(a.n).toLowerCase()); if (w && !fixed.some((x) => x.n === w.n)) items.push({ kind: 'item', n: w.n, qty: 1 }); });
  if (C.val && chance(C.val)) items.push(rollValuable(tier));
  if (C.magic && chance(MAGIC_P[tier] * C.magic)) items.push(rollMagic(rollRarity(tier)));
  return { gp: Math.round(coins * (C.coin || 0)) + gpFix, items: mergeLoot(items) };
}
// Сокровищница (босс, логово): много монет, драгоценности и несколько магических предметов
function genHoard(tier) {
  const r = (e) => rollExpr(e).total, items = [];
  const gp = [r('2d4') * 100, r('6d6') * 100, r('4d6') * 1000, r('12d6') * 1000][tier];
  for (let i = r(['1d4', '2d4', '2d6', '3d6'][tier]); i > 0; i--) items.push(rollValuable(tier));
  for (let i = r(['1d2', '1d3', '1d4', '1d4+1'][tier]); i > 0; i--) items.push(rollMagic(rollRarity(Math.min(3, tier + (i === 1 ? 1 : 0)))));
  return { gp, items: mergeLoot(items) };
}
// Сундук по уровню локации: монеты, немного снаряжения, драгоценность, шанс магического предмета
function genChest(lvl) {
  const tier = tierLvl(+lvl || 1), r = (e) => rollExpr(e).total, items = [];
  const gp = [r('3d6') * 5, r('4d6') * 20, r('4d6') * 200, r('4d6') * 2000][tier];
  const gear = GEAR.filter((g) => /Расходник|Снаряжение/.test(g.cat));
  for (let i = r('1d3') - 1; i > 0; i--) items.push({ kind: 'item', n: pickOne(gear).n, qty: 1 });
  for (let i = r('1d3') - 1; i > 0; i--) items.push(rollValuable(tier));
  if (chance([0.25, 0.35, 0.45, 0.55][tier])) items.push(rollMagic(rollRarity(tier)));
  return { gp, items: mergeLoot(items) };
}
const lootText = (L) => (!L ? '—' : [L.gp ? `${L.gp} зм` : '', ...(L.items || []).map((it) => `${it.n}${+it.qty > 1 ? ` ×${it.qty}` : ''}${it.kind === 'magic' || it.r >= 2 ? ' ✨' : ''}`)].filter(Boolean).join(', ') || 'ничего');
// Список всех предметов для выбора: магические (с редкостью), снаряжение, оружие, доспехи, драгоценности, свитки заклинаний
function itemSearch(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const has = (s) => String(s).toLowerCase().includes(q), out = [];
  MI().forEach((M) => { if (has(M.n) || has(RAR_N[M.r])) out.push({ label: M.n, sub: `${RAR_N[M.r]}${M.att ? ' · настройка' : ''}`, M }); });
  GEAR.forEach((g) => { if (has(g.n)) out.push({ label: g.n, sub: `снаряжение · ${g.cost}`, make: () => ({ kind: 'item', n: g.n, qty: 1 }) }); });
  WEAPONS.forEach((w) => { if (has(w.n)) out.push({ label: w.n, sub: `оружие · ${w.cost}`, make: () => ({ kind: 'item', n: w.n, qty: 1 }) }); });
  ARMOR.forEach((a) => { if (has(a.n)) out.push({ label: a.n, sub: `доспех · ${a.cost}`, make: () => ({ kind: 'item', n: a.n, qty: 1 }) }); });
  [[GEMS, false], [ART, true]].forEach(([T, art]) => Object.entries(T).forEach(([v, list]) => list.forEach((n) => {
    if (has(n) || has(art ? 'искусств' : 'камень')) out.push({ label: `${n} (${v} зм)`, sub: art ? 'предмет искусства' : 'драгоценный камень', make: () => ({ kind: 'item', n: `${n} (${v} зм)`, qty: 1, cat: 'Сокровище', cost: `${v} зм` }) });
  })));
  // Свитки: «огненный шар» или «свиток огн…» — поиск по названию заклинания
  const sq = q.replace(/^свит\S*\s*/, '').trim();
  if (sq.length >= 3 && typeof SPELLS !== 'undefined') SPELLS.filter((s) => s.n.toLowerCase().includes(sq)).slice(0, 12)
    .forEach((s) => out.push({ label: `Свиток: ${s.n}`, sub: `${+s.l ? `${s.l} ур.` : 'заговор'} · ${RAR_N[scrollItem(s).r]}`, make: () => scrollItem(s) }));
  return out.slice(0, 40);
}
// Редактор добычи (встраивается в окно): золото, список с количеством, поиск по всем предметам, свой предмет по названию.
// L меняется на месте; onChange — после каждой правки
function lootEdit(box, L, onChange = () => {}) {
  L.items = L.items || [];
  box.innerHTML = `<div class="row gap wrap"><label>Монеты, зм<input type="number" min="0" data-le="gp" value="${+L.gp || 0}" style="width:110px"></label></div>
    <div class="list mt" data-le="list"></div>
    <div class="row gap mt"><input data-le="q" placeholder="Найти предмет: зелье, длинный меч, рубин, свиток огненного…" style="flex:1"><button data-le="own" title="Добавить как свой предмет">＋ Своё</button></div>
    <div class="pick-list" data-le="res"></div>`;
  const q = box.querySelector('[data-le="q"]');
  const drawList = () => {
    box.querySelector('[data-le="list"]').innerHTML = L.items.map((it, i) => `<div class="enc-row"><span><b>${esc(it.n)}</b>${it.kind === 'magic' || it.r >= 1 ? ` <span class="muted small">${RAR_N[it.r] || ''}</span>` : ''}</span>
      <span class="row gap"><input type="number" min="1" value="${+it.qty || 1}" data-leq="${i}" style="width:58px"><button class="ghost" data-led="${i}" title="Убрать">✕</button></span></div>`).join('')
      || '<p class="muted small">Предметов нет.</p>';
    box.querySelectorAll('[data-led]').forEach((b) => b.addEventListener('click', () => { L.items.splice(+b.dataset.led, 1); drawList(); onChange(); }));
    box.querySelectorAll('[data-leq]').forEach((x) => x.addEventListener('input', () => { L.items[+x.dataset.leq].qty = Math.max(1, +x.value || 1); onChange(); }));
  };
  const add = (it) => { if (!it) return; L.items = mergeLoot([...L.items, it]); drawList(); onChange(); };
  const drawRes = () => {
    const res = itemSearch(q.value), el = box.querySelector('[data-le="res"]');
    el.innerHTML = res.map((x, i) => `<div class="pick-row"><span>${esc(x.label)} <span class="muted small">${esc(x.sub)}</span></span>
      ${x.M && x.M.pick ? `<select data-lb="${i}"><option value="">случайное ${x.M.pick === 'w' ? 'оружие' : 'доспех'}</option>${(x.M.pick === 'w' ? WEAPONS : ARMOR.filter((a) => a.type !== 'shield')).map((b) => `<option value="${esc(x.M.pick === 'w' ? b.n : b.id)}">${esc(b.n)}</option>`).join('')}</select>` : ''}
      <button data-la="${i}">＋</button></div>`).join('') || (q.value.trim() ? '<p class="muted small">Ничего не найдено — можно добавить как свой предмет.</p>' : '');
    el.querySelectorAll('[data-la]').forEach((b) => b.addEventListener('click', () => {
      const x = res[+b.dataset.la], sel = el.querySelector(`[data-lb="${b.dataset.la}"]`);
      add(x.M ? magicItem(x.M, sel && sel.value) : x.make());
    }));
  };
  box.querySelector('[data-le="gp"]').addEventListener('input', (e) => { L.gp = Math.max(0, +e.target.value || 0); onChange(); });
  q.addEventListener('input', drawRes);
  box.querySelector('[data-le="own"]').addEventListener('click', () => { const n = q.value.trim(); if (n) { add({ kind: 'item', n, qty: 1 }); q.value = ''; drawRes(); } });
  drawList();
}
// Мастер: добыча одного существа — посмотреть, перебросить, сделать сокровищницей, изменить
function tokenLootDialog(id) {
  const t = game.tokens[id];
  if (!t) return;
  const L = JSON.parse(JSON.stringify(t.loot || genLoot(t)));
  app.openModal(`<div><h2>💰 Добыча: ${esc(t.name)}</h2>
    <p class="muted small">${TYPE_N[monType(t)] || ''} · ПО ${esc(t.cr ?? '?')}${t.looted ? ' · <b>уже обыскан</b>' : ''}. Игроки получат это, когда мастер обыщет павших.</p>
    <div class="row gap wrap"><button id="tlRe">🎲 Перебросить</button><button id="tlHoard" title="Крупная добыча: монеты, драгоценности, несколько магических предметов">👑 Сокровищница</button><button id="tlNone">Ничего</button></div>
    <div id="tlBox" class="loot-box mt"></div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="tlOk">Сохранить</button></div></div>`);
  const draw = () => lootEdit($('#tlBox'), L);
  const set = (x) => { L.gp = x.gp; L.items = x.items; draw(); };
  $('#tlRe').onclick = () => set(genLoot({ ...t, hoard: false }));
  $('#tlHoard').onclick = () => set(genHoard(tierCR(t.cr)));
  $('#tlNone').onclick = () => set({ gp: 0, items: [] });
  $('#tlOk').onclick = () => { R.update(ref(gpath(`tokens/${id}`)), { loot: { gp: +L.gp || 0, items: L.items } }).catch(() => {}); app.closeModal(); };
  draw();
}
// Примерная цена предмета — для честного дележа: магия по редкости, остальное по цене из справочника
function lootValue(it) {
  const q = +it.qty || 1;
  if (it.kind === 'magic' || /^Свиток/.test(it.n)) return magicPrice(it) * q;
  const ref_ = costGp(it.cost) ? null : [...WEAPONS, ...ARMOR, ...GEAR].find((x) => x.n === it.n);
  return (costGp(it.cost) || (ref_ ? costGp(ref_.cost) : 0)) * q;
}
let lootPick = {}; // кому отмечены предметы в окне добычи: { ключ предмета: uid } — не сбрасывается при обновлении окна
function lootDialog() {
  const L = game.loot || {}, gp = +L.gp || 0, items = Object.entries(L.items || {});
  const pcs = Object.entries(game.members || {}).filter(([, m]) => m.role !== 'dm'), pname = (uid) => ((game.members[uid] || {}).char || {}).name || (game.members[uid] || {}).name || 'Игрок';
  const bodies = Object.entries(game.tokens).filter(([, t]) => t.kind === 'npc' && team(t) === 'npc' && isDead(t) && !t.looted);
  Object.keys(lootPick).forEach((k) => { if (!(L.items || {})[k] || !game.members[lootPick[k]]) delete lootPick[k]; });
  const who = (k) => `<option value="">— кому —</option>${pcs.map(([uid]) => `<option value="${uid}" ${lootPick[k] === uid ? 'selected' : ''}>${esc(pname(uid))}</option>`).join('')}`;
  app.openModal(`<div><h2>💰 Добыча</h2>
    ${bodies.length ? `<div class="enc-row"><span class="small">Не обысканы: ${bodies.map(([, t]) => esc(t.name)).join(', ')}</span><button class="primary" id="lSearch">🎲 Обыскать</button></div>` : ''}
    <div class="enc-row mt"><b>Золото: ${gp} зм</b><button id="lSplit" ${gp && pcs.length ? '' : 'disabled'}>Поровну всем${pcs.length ? ` (по ${Math.floor(gp / pcs.length)} зм)` : ''}</button></div>
    ${items.length && pcs.length ? `<div class="row gap wrap mt"><span class="muted small">Быстро:</span><select id="lAll" style="width:auto"><option value="">всё — одному…</option>${pcs.map(([uid]) => `<option value="${uid}">${esc(pname(uid))}</option>`).join('')}</select>
      <button id="lFair" title="Раскладывает предметы так, чтобы общая ценность у всех была как можно ближе">⚖ Поровну по ценности</button><button class="ghost" id="lClear">Сбросить</button></div>` : ''}
    <div class="list mt">${items.map(([k, it]) => `<div class="enc-row"><span><b>${esc(it.n)}</b>${+it.qty > 1 ? ` ×${it.qty}` : ''}${it.kind === 'magic' ? ' ✨' : ''}${it.r >= 1 ? ` <span class="muted small">${RAR_N[it.r]}</span>` : ''}
      ${lootValue(it) ? ` <span class="muted small">≈ ${fmtPrice(lootValue(it))}</span>` : ''}</span>
      <span class="row gap"><select data-lwho="${k}">${who(k)}</select><button data-lgive="${k}">Отдать</button><button class="ghost" data-ldel="${k}" title="Убрать">✕</button></span></div>`).join('')
      || '<p class="muted small">Предметов пока нет — обыщите павших или добавьте вручную.</p>'}</div>
    <p class="small mt" id="lTally"></p>
    <h3 class="mt">Добавить в котёл</h3><div id="lAddBox"></div>
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button><button id="lAdd">＋ В добычу</button>
      <button class="primary" id="lGive" title="Отдать все отмеченные предметы и разделить золото поровну между всеми игроками">📦 Раздать отмеченное</button></div></div>`);
  const again = () => setTimeout(lootDialog, 150);
  // Сколько получит каждый: отмеченные предметы (по цене) и доля золота
  const tally = () => {
    const share = pcs.length ? Math.floor(gp / pcs.length) : 0, sum = Object.fromEntries(pcs.map(([uid]) => [uid, 0]));
    items.forEach(([k, it]) => { if (lootPick[k] in sum) sum[lootPick[k]] += lootValue(it); });
    const left = items.filter(([k]) => !lootPick[k]).length;
    if ($('#lTally')) $('#lTally').innerHTML = pcs.length ? `Получат: ${pcs.map(([uid]) => `<b>${esc(pname(uid))}</b> ≈ ${fmtPrice(sum[uid] + share)}`).join(' · ')}${share ? ` <span class="muted">(с долей золота по ${share} зм)</span>` : ''}${left && items.length ? ` · <span class="muted">не отмечено: ${left}</span>` : ''}` : '';
  };
  const setPick = (k, uid) => { if (uid) lootPick[k] = uid; else delete lootPick[k]; const s = $(`[data-lwho="${k}"]`); if (s) s.value = uid || ''; };
  $$('[data-lwho]').forEach((s) => s.addEventListener('change', () => { setPick(s.dataset.lwho, s.value); tally(); }));
  if ($('#lAll')) $('#lAll').onchange = () => { items.forEach(([k]) => setPick(k, $('#lAll').value)); $('#lAll').value = ''; tally(); };
  if ($('#lClear')) $('#lClear').onclick = () => { items.forEach(([k]) => setPick(k, '')); tally(); };
  // Поровну по ценности: дорогие предметы по очереди тому, у кого сейчас меньше всего
  if ($('#lFair')) $('#lFair').onclick = () => {
    const sum = Object.fromEntries(pcs.map(([uid]) => [uid, 0]));
    items.slice().sort((a, b) => lootValue(b[1]) - lootValue(a[1])).forEach(([k, it]) => {
      const uid = Object.keys(sum).sort((a, b) => sum[a] - sum[b])[0];
      setPick(k, uid); sum[uid] += lootValue(it);
    });
    tally();
  };
  tally();
  $('#lGive').onclick = async () => {
    const give = items.filter(([k]) => lootPick[k]), each = pcs.length ? Math.floor(gp / pcs.length) : 0;
    if (!give.length && !each) { app.toast('Отметьте, кому что отдать'); return; }
    const upd = {}, got = {}, gk = R.push(ref(gpath('lootAward'))).key;
    give.forEach(([k, it]) => { const uid = lootPick[k]; upd[`lootAward/${uid}/${k}`] = it; upd[`loot/items/${k}`] = null; (got[uid] = got[uid] || []).push(`${it.n}${+it.qty > 1 ? ` ×${it.qty}` : ''}`); delete lootPick[k]; });
    if (each) { pcs.forEach(([uid]) => { upd[`lootAward/${uid}/${gk}`] = { kind: 'gold', gp: each }; (got[uid] = got[uid] || []).push(`${each} зм`); }); upd['loot/gp'] = gp - each * pcs.length; }
    await R.update(ref(gpath()), upd);
    addLog({ kind: 'sys', txt: `💰 Раздано: ${Object.entries(got).map(([uid, list]) => `${pname(uid)} — ${list.join(', ')}`).join('; ')}` });
    // Котёл опустел — окно больше не нужно
    if (give.length === items.length) { app.closeModal(); app.toast('💰 Добыча роздана', 'crit'); } else again();
  };
  const push = (upd, it) => { upd[`loot/items/${R.push(ref(gpath('loot'))).key}`] = it; };
  const add = { gp: 0, items: [] };
  lootEdit($('#lAddBox'), add);
  // Добыча каждого павшего — та, что бросилась при его появлении (или бросается сейчас, если её не было)
  if ($('#lSearch')) $('#lSearch').onclick = async () => {
    const upd = {}, found = [];
    let sum = 0;
    bodies.forEach(([id, t]) => {
      const r = t.loot || genLoot(t);
      sum += +r.gp || 0;
      (r.items || []).forEach((it) => { push(upd, it); found.push(it.n); });
      upd[`tokens/${id}/looted`] = true;
    });
    upd['loot/gp'] = gp + sum;
    await R.update(ref(gpath()), upd);
    addLog({ kind: 'sys', txt: `💰 Обысканы павшие: ${sum} зм${found.length ? `, ${found.join(', ')}` : ''}` });
    again();
  };
  $('#lSplit').onclick = async () => {
    const each = Math.floor(gp / pcs.length), k = R.push(ref(gpath('lootAward'))).key, upd = { 'loot/gp': gp - each * pcs.length };
    if (!each) return;
    pcs.forEach(([uid]) => { upd[`lootAward/${uid}/${k}`] = { kind: 'gold', gp: each }; });
    await R.update(ref(gpath()), upd);
    addLog({ kind: 'sys', txt: `💰 Золото поровну: по ${each} зм` });
    again();
  };
  $('#lAdd').onclick = async () => {
    const upd = {};
    if (add.gp > 0) upd['loot/gp'] = gp + add.gp;
    add.items.forEach((it) => push(upd, it));
    if (!Object.keys(upd).length) { app.toast('Укажите монеты или найдите предмет'); return; }
    await R.update(ref(gpath()), upd);
    again();
  };
  $$('[data-lgive]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.lgive, uid = $(`[data-lwho="${k}"]`).value, it = L.items[k];
    if (!uid) { app.toast('Выберите, кому отдать'); return; }
    delete lootPick[k];
    await R.update(ref(gpath()), { [`lootAward/${uid}/${k}`]: it, [`loot/items/${k}`]: null });
    addLog({ kind: 'sys', txt: `💰 ${pname(uid)} получает: ${it.n}${+it.qty > 1 ? ` ×${it.qty}` : ''}` });
    again();
  }));
  $$('[data-ldel]').forEach((b) => b.addEventListener('click', async () => { await R.remove(ref(gpath(`loot/items/${b.dataset.ldel}`))); again(); }));
}

/* ---------- Сундуки ---------- */
// games/{id}/chests/{k}: { x, y, lvl — уровень локации, lock — СЛ замка (0 — не заперт), trap: { n, abil, dc, f, dtype, cond } | null,
//   loot: { gp, items }, lk — замок открыт, tf — ловушку искали успешно, toff — ловушка обезврежена или сработала,
//   o — uid открывшего, moved — содержимое уже в общей добыче }. Игроки пишут только lk, tf, toff, o; содержимое в котёл переносит мастер
const TRAPS = [
  { id: 'needle', n: 'Отравленная игла', abil: 'con', dtype: 'ядом', cond: 'poisoned' },
  { id: 'fire', n: 'Огненная руна', abil: 'dex', dtype: 'огнём' },
  { id: 'acid', n: 'Кислотные брызги', abil: 'dex', dtype: 'кислотой' },
  { id: 'shock', n: 'Разряд молнии', abil: 'dex', dtype: 'электричеством' },
  { id: 'gas', n: 'Усыпляющий газ', abil: 'con', dtype: '', cond: 'unconscious' },
];
const TRAP_DMG = ['2d10', '4d10', '10d10', '18d10'], TRAP_DC = [13, 15, 17, 19];
const LOCKS = [[0, 'не заперт'], [10, 'простой замок (СЛ 10)'], [15, 'хороший замок (СЛ 15)'], [20, 'сложный замок (СЛ 20)'], [25, 'мастерский замок (СЛ 25)']];
const chestAt = (x, y) => Object.entries(game.chests || {}).find(([, c]) => c.x === x && c.y === y);
const partyLevel = () => { const l = Object.values(game.members || {}).filter((m) => m.role !== 'dm').map((m) => +(m.char || {}).lvl || 1); return l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 1; };
function makeTrap(id, lvl) {
  const T = TRAPS.find((x) => x.id === id), tier = tierLvl(+lvl || 1);
  return T ? { id: T.id, n: T.n, abil: T.abil, dc: TRAP_DC[tier], f: T.dtype ? TRAP_DMG[tier] : '', dtype: T.dtype, ...(T.cond ? { cond: T.cond } : {}) } : null;
}
// Мастер: поставить или изменить сундук
function chestDialog(k, x, y) {
  const lvl0 = partyLevel(), C = k ? JSON.parse(JSON.stringify(game.chests[k])) : { x, y, lvl: lvl0, lock: 0, trap: null, loot: genChest(lvl0) };
  const L = C.loot || { gp: 0, items: [] };
  const opener = C.o && (C.o === user.uid ? 'мастер' : ((game.members[C.o] || {}).char || {}).name || 'игрок');
  app.openModal(`<div><h2>🧰 ${k ? 'Сундук' : 'Новый сундук'}</h2>
    ${C.o ? `<p class="small">Открыт: ${esc(opener)}${C.moved ? ' — содержимое в общей добыче' : ''}</p>` : ''}
    <div class="form-grid"><label>Уровень локации<input type="number" id="chL" min="1" max="20" value="${+C.lvl || 1}"></label>
      <label>Замок<select id="chLock">${LOCKS.map(([v, n]) => `<option value="${v}" ${+C.lock === v ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Ловушка<select id="chTrap"><option value="">нет</option>${TRAPS.map((T) => `<option value="${T.id}" ${C.trap && C.trap.id === T.id ? 'selected' : ''}>${T.n}</option>`).join('')}</select></label></div>
    <p class="muted small" id="chTrapInfo"></p>
    <div class="loot-box mt"><div class="row between"><b>Содержимое</b><button id="chRe">🎲 По уровню</button></div><div id="chLoot"></div></div>
    <div class="modal-actions">${k ? '<button class="danger" id="chDel">Убрать</button>' : ''}<button data-act="closeModal">Отмена</button>
      ${k && !C.o ? '<button id="chOpen" title="Открыть за игроков: содержимое уйдёт в общую добычу">Открыть</button>' : ''}<button class="primary" id="chOk">Сохранить</button></div></div>`);
  const trapInfo = () => { const T = makeTrap($('#chTrap').value, $('#chL').value); $('#chTrapInfo').textContent = T ? `Ловушка: спасбросок ${AB_N[T.abil]} СЛ ${T.dc}${T.f ? `, ${T.f} ${T.dtype}` : ''}${T.cond ? `, ${condName(T.cond).toLowerCase()}` : ''}. Найти и обезвредить — та же СЛ.` : ''; };
  const draw = () => lootEdit($('#chLoot'), L);
  $('#chTrap').onchange = trapInfo; $('#chL').oninput = trapInfo;
  $('#chRe').onclick = () => { const g = genChest($('#chL').value); L.gp = g.gp; L.items = g.items; draw(); };
  $('#chOk').onclick = () => {
    const lvl = Math.max(1, Math.min(20, +$('#chL').value || 1)), tid = $('#chTrap').value, same = C.trap && C.trap.id === tid;
    const key = k || R.push(ref(gpath('chests'))).key;
    R.update(ref(gpath(`chests/${key}`)), { x: C.x, y: C.y, lvl, lock: +$('#chLock').value || 0, trap: makeTrap(tid, lvl),
      ...(same ? {} : { tf: null, toff: null }), loot: { gp: +L.gp || 0, items: L.items } }).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
    app.closeModal();
  };
  if ($('#chDel')) $('#chDel').onclick = () => { if (app.confirm('Убрать сундук с поля?')) { R.remove(ref(gpath(`chests/${k}`))); app.closeModal(); } };
  if ($('#chOpen')) $('#chOpen').onclick = () => { R.update(ref(gpath(`chests/${k}`)), { o: user.uid }); app.closeModal(); };
  draw(); trapInfo();
}
// Игрок у сундука: осмотреть на ловушки, обезвредить, вскрыть или взломать замок, открыть
function chestPlayer(k) {
  const C = game.chests[k], mine = game.tokens[`pc_${user.uid}`], m = me();
  if (!C || !m || !m.charId) return;
  if (!mine || distFt(mine, { x: C.x, y: C.y, size: 1 }) > 5) { app.toast('Подойдите к сундуку вплотную'); return; }
  if (C.o) { app.toast(`Сундук уже открыт${C.moved ? ' — содержимое у мастера в добыче' : ''}`); return; }
  const locked = +C.lock && !C.lk, trapKnown = C.trap && C.tf && !C.toff, fight = inFight(), e = econ(`pc_${user.uid}`);
  const needAct = fight && (!isTurnOf(`pc_${user.uid}`) || e.a);
  app.openModal(`<div><h2>🧰 Сундук</h2>
    <p class="small">${locked ? '🔒 Заперт.' : C.lk ? '🔓 Замок открыт.' : 'Не заперт.'}${trapKnown ? ` ⚠ Ловушка: ${esc(C.trap.n)}.` : C.tf ? ' Ловушек не найдено.' : ''}</p>
    <div class="list">
      ${!C.tf ? `<button class="atk-pick" data-chs="search" ${needAct ? 'disabled' : ''}><b>🔍 Осмотреть на ловушки</b><span class="muted small">Интеллект (Анализ)</span></button>` : ''}
      ${trapKnown ? `<button class="atk-pick" data-chs="disarm" ${needAct ? 'disabled' : ''}><b>🛠 Обезвредить ловушку</b><span class="muted small">Ловкость + воровские инструменты, СЛ ${C.trap.dc}; провал на 5 и больше — ловушка сработает</span></button>` : ''}
      ${locked ? `<button class="atk-pick" data-chs="pick" ${needAct ? 'disabled' : ''}><b>🔓 Вскрыть замок</b><span class="muted small">Ловкость + воровские инструменты, СЛ ${C.lock}</span></button>
        <button class="atk-pick" data-chs="force" ${needAct ? 'disabled' : ''}><b>💪 Взломать</b><span class="muted small">Сила (Атлетика), СЛ ${+C.lock + 5}; шумно</span></button>` : ''}
      <button class="atk-pick" data-chs="open" ${locked ? 'disabled' : ''}><b>📦 Открыть</b><span class="muted small">${locked ? 'сначала отоприте замок' : 'содержимое уйдёт в общую добычу группы'}</span></button></div>
    ${fight ? `<p class="muted small">В бою осмотр, вскрытие, взлом и обезвреживание тратят действие${needAct ? ' — сейчас действия нет' : ''}.</p>` : ''}
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button></div></div>`);
  const name = mine.name, upd = (o) => R.update(ref(gpath(`chests/${k}`)), o).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
  const spend = () => { if (fight) R.update(ref(gpath(`econ/pc_${user.uid}`)), { a: 1 }).catch(() => {}); };
  const check = (o) => app.mute(() => app.check(m.charId, o));
  const spring = () => {
    const T = C.trap, d = T.f ? rollExpr(T.f) : null;
    upd({ toff: true });
    saveRequest(`pc_${user.uid}`, { n: `Ловушка: ${T.n}`, who: 'Сундук', abil: T.abil, dc: T.dc, ...(d ? { dmg: d.total, dmgDetail: d.detail, dtype: T.dtype, half: true } : {}),
      ...(T.cond ? { fail: { n: T.n, ic: '⚠', cond: T.cond } } : {}) });
    addLog({ kind: 'act', who: name, txt: `⚠ Срабатывает ловушка сундука: ${T.n}${d ? ` — ${d.total} ${T.dtype}` : ''} (спасбросок ${AB_N[T.abil]} СЛ ${T.dc})` });
  };
  $$('[data-chs]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.chs;
    app.closeModal();
    if (a === 'search') {
      // Без ловушки СЛ 10 — чтобы по броску нельзя было понять, есть ли она
      const r = check({ skill: 'investigation', dc: C.trap ? C.trap.dc : 10, label: 'Осмотр сундука' });
      if (!r) return;
      spend();
      if (r.ok) upd({ tf: true });
      app.toast(r.ok ? (C.trap ? `⚠ Найдена ловушка: ${esc(C.trap.n)}` : 'Ловушек нет') : 'Ничего подозрительного не заметно…', r.ok && C.trap ? 'crit' : '');
      addLog({ kind: 'act', who: name, txt: `🔍 осматривает сундук: ${r.total}${r.ok && C.trap ? ' — находит ловушку' : ''}` });
    } else if (a === 'disarm') {
      const r = check({ abil: 'dex', tool: 'воровск', dc: C.trap.dc, label: `Обезвредить: ${C.trap.n}` });
      if (!r) return;
      spend();
      if (r.ok) { upd({ toff: true }); app.toast('🛠 Ловушка обезврежена', 'crit'); }
      else if (C.trap.dc - r.total >= 5) spring();
      else app.toast('Не вышло — можно попробовать ещё раз');
      addLog({ kind: 'act', who: name, txt: `🛠 обезвреживает ловушку: ${r.total} — ${r.ok ? 'успех' : C.trap.dc - r.total >= 5 ? 'ловушка срабатывает' : 'не вышло'}` });
    } else if (a === 'pick' || a === 'force') {
      const dc = +C.lock + (a === 'force' ? 5 : 0);
      const r = a === 'pick' ? check({ abil: 'dex', tool: 'воровск', dc, label: 'Вскрыть замок' }) : check({ skill: 'athletics', dc, label: 'Взломать сундук' });
      if (!r) return;
      spend();
      if (r.ok) upd({ lk: true });
      app.toast(r.ok ? '🔓 Замок открыт' : 'Замок не поддаётся', r.ok ? 'crit' : '');
      addLog({ kind: 'act', who: name, txt: `${a === 'pick' ? '🔓 вскрывает замок' : '💪 взламывает сундук'}: ${r.total} — ${r.ok ? 'открыто' : 'не вышло'}` });
    } else if (a === 'open') {
      if (C.trap && !C.toff) spring();
      upd({ o: user.uid });
      app.toast(`📦 Внутри: ${esc(lootText(C.loot))}`, 'crit');
    }
  }));
}
// Браузер мастера: содержимое открытого сундука — в общую добычу
const chestMoving = new Set();
function syncChests() {
  // Ждём участников и котёл: имя открывшего и текущее золото
  if (!game || !isDM() || !Object.keys(game.members || {}).length || game.loot === undefined) return;
  Object.entries(game.chests || {}).forEach(([k, C]) => {
    if (C.o && !C.moved) { if (chestMoving.has(k)) return; chestMoving.add(k); }
    if (!C.o || C.moved) return;
    const L = C.loot || {}, upd = { [`chests/${k}/moved`]: true, 'loot/gp': (+(game.loot || {}).gp || 0) + (+L.gp || 0) };
    (L.items || []).forEach((it) => { upd[`loot/items/${R.push(ref(gpath('loot'))).key}`] = it; });
    R.update(ref(gpath()), upd).catch(() => {});
    const who = C.o === user.uid ? 'Мастер' : ((game.members[C.o] || {}).char || {}).name || 'Игрок';
    addLog({ kind: 'sys', txt: `🧰 ${who} открывает сундук: ${lootText(L)} — в общей добыче` });
  });
}
// Игрок: выданное мастером — в лист (золото, предметы, магические предметы с бонусами)
const lootDone = new Set();
function applyLoot() {
  const m = me(), v = game && game.lootAw;
  if (!v || !m || !m.charId) return;
  Object.entries(v).forEach(([k, L]) => {
    if (lootDone.has(k)) return;
    lootDone.add(k);
    const n = app.addLoot(m.charId, L);
    R.remove(ref(gpath(`lootAward/${user.uid}/${k}`))).catch(() => {});
    if (n) app.toast(`💰 Получено: ${esc(n)}${L.kind !== 'gold' && +L.qty > 1 ? ` ×${L.qty}` : ''} — уже в листе`, 'crit');
  });
}

/* ---------- Редактор бестиария ---------- */
const CR_LIST = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
const SIZE_LIST = ['Крошечный', 'Маленький', 'Средний', 'Большой', 'Огромный', 'Громадный'];
const ON_CONDS = ['prone', 'grappled', 'restrained', 'poisoned', 'paralyzed', 'frightened', 'blinded', 'stunned', 'charmed', 'incapacitated', 'unconscious'];
const AREA_SHAPES = ['sphere', 'cone', 'line', 'cube', 'aura'];
// Статблок токена на поле — в формате бестиария
function monFromToken(t) {
  const size = ({ 1: 'Средний', 2: 'Большой', 3: 'Огромный', 4: 'Громадный' })[t.size || 1] || 'Средний';
  return { n: t.name, e: t.mon || '', cr: t.cr != null ? String(t.cr) : '0', size, ac: +t.ac || 10, hp: String(t.hpMax || 1), speed: t.spd || String(t.speed || 30),
    ab: t.ab || [10, 10, 10, 10, 10, 10], sv: t.sv || {}, multi: +t.multi || 1, atk: t.atk || [], x: t.tr || '', acts: t.acts || [],
    leg: +t.leg || 0, lr: +t.lrMax || +t.lr || 0, cs: +t.cs || 0, sdc: +t.sdc || 0, xp: xpOf(t), type: monType(t) };
}
// Редактор существа: tokenId — правка статблока существа на поле, иначе — своё существо в бестиарий (встроенное заменяется своей копией)
function monEditor(src, tokenId, done) {
  const M = JSON.parse(JSON.stringify(src || { n: 'Новое существо', cr: '1', size: 'Средний', ac: 12, hp: '4d8', speed: '30', ab: [10, 10, 10, 10, 10, 10], sv: {}, multi: 1, atk: [], acts: [], x: '' }));
  const atk = M.atk || [], acts = M.acts || [], ab = M.ab || [10, 10, 10, 10, 10, 10];
  // Добыча своего существа: всегда при нём (fixed, gp) и случайная по ПО и виду (rnd); сокровищница — у боссов
  const LT = { gp: 0, rnd: true, ...(M.loot || {}) }; LT.items = (LT.fixed || []).map((x) => ({ ...x }));
  const opt = (list, v, names) => list.map((k) => `<option value="${k}" ${String(v) === String(k) ? 'selected' : ''}>${names ? names(k) : k}</option>`).join('');
  const abOpt = (v) => `<option value="">—</option>${opt(ABK, v, (k) => ABS[k])}`;
  app.openModal(`<div id="meBox"><h2>✎ ${tokenId ? `Статблок: ${esc(M.n)}` : src && src.e ? `Существо: ${esc(M.n)}` : 'Новое существо'}</h2>
    ${!tokenId && src && src.e && !src.custom ? '<p class="muted small">Это встроенное существо — сохранится ваша копия, она заменит его в списке (вернуть исходное можно в бестиарии).</p>' : ''}
    <div class="form-grid"><label style="grid-column:1/-1">Название<input id="meN" value="${esc(M.n)}"></label>
      <label>Опасность (ПО)<select id="meCr">${opt(CR_LIST, M.cr)}</select></label><label>Размер<select id="meSz">${opt(SIZE_LIST, M.size)}</select></label>
      <label>КД<input id="meAc" type="number" value="${+M.ac || 10}"></label><label>Хиты${tokenId ? ' (максимум)' : ' (кости или число)'}<input id="meHp" value="${esc(M.hp)}"></label>
      <label>Скорость<input id="meSp" value="${esc(M.speed)}" placeholder="30, полёт 60"></label><label>Атак за действие<input id="meMu" type="number" min="1" max="8" value="${+M.multi || 1}"></label>
      ${tokenId ? `<label>Опыт за победу<input id="meXp" type="number" min="0" value="${+M.xp || 0}"></label>`
        : `<label>Вид<select id="meCat"><option value="">чудовище</option><option value="npc" ${M.cat === 'npc' ? 'selected' : ''}>NPC — житель мира</option></select></label>
          <label class="check"><input type="checkbox" id="meBeast" ${M.beast ? 'checked' : ''}> Зверь (дикий облик, спутник)</label>`}</div>
    <div class="muted small mt">Характеристики и бонусы спасбросков:</div>
    <div class="sv-grid">${ABK.map((k, i) => `<label>${ABS[k]}<input type="number" data-meab="${i}" data-mod="${abMod(+ab[i] || 10)}" value="${+ab[i] || 10}"><input type="number" data-mesv="${k}" title="Спасбросок" value="${(M.sv || {})[k] != null ? +M.sv[k] : abMod(+ab[i] || 10)}"></label>`).join('')}</div>
    <h3 class="mt">Атаки</h3><div id="meAtk" class="me-rows"></div><button id="meAtkAdd">＋ Атака</button>
    <h3 class="mt">Способности-области (дыхание, заклинания)</h3><div id="meAct" class="me-rows"></div><button id="meActAdd">＋ Способность</button>
    <div class="leg-grid mt"><label>👑 Легенд. действий<input type="number" min="0" max="5" id="meLeg" value="${+M.leg || 0}"></label><label>Легенд. сопротивл.<input type="number" min="0" max="5" id="meLr" value="${+M.lr || 0}"></label>
      <label>🚫 Контрзаклинаний<input type="number" min="0" max="9" id="meCs" value="${+M.cs || 0}"></label><label>СЛ заклинаний<input type="number" min="0" max="30" id="meSdc" value="${+M.sdc || 0}"></label></div>
    <label class="mt">Особенности<textarea id="meX" rows="3">${esc(M.x || '')}</textarea></label>
    <div class="form-grid mt"><label>Вид существа<select id="meType">${opt(Object.keys(TYPE_N), M.type || 'monstrosity', (k) => TYPE_N[k])}</select></label>
      ${tokenId ? '' : `<label class="check"><input type="checkbox" id="meHoard" ${M.hoard ? 'checked' : ''}> Сокровищница (босс, логово)</label>`}</div>
    ${tokenId || typeof HAB_N === 'undefined' ? '' : `<div class="muted small mt">Где водится (для «👥 Заселить» и генератора):</div><div class="row gap wrap">${Object.entries(HAB_N).map(([k, n]) => `<label class="check"><input type="checkbox" data-meenv="${k}" ${(M.env || []).includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div>`}
    ${tokenId ? '<p class="muted small">Добыча этого существа — в его карточке («💰 Добыча» → ✎).</p>' : `<h3 class="mt">Добыча</h3>
      <label class="check"><input type="checkbox" id="meLRnd" ${LT.rnd !== false ? 'checked' : ''}> Случайная добыча по опасности и виду (бросается, когда существо появляется)</label>
      <div class="muted small mt">Всегда при нём:</div><div id="meLoot" class="loot-box"></div>
      <div class="row gap mt"><button id="meLSug">🎲 Предложить по ПО</button></div><div id="meLSugBox" class="list mt"></div>`}
    ${tokenId ? '<label class="check mt"><input type="checkbox" id="meToBest"> Сохранить и в моё бестиарий</label>' : ''}
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="meOk">Сохранить</button></div></div>`);
  const drawAtk = () => {
    $('#meAtk').innerHTML = atk.map((a, i) => { const on = a.on || {}; return `<div class="me-row">
      <input data-ma="${i}" data-k="n" value="${esc(a.n)}" placeholder="Название"><input data-ma="${i}" data-k="hit" type="number" value="${+a.hit || 0}" title="Бонус к попаданию">
      <input data-ma="${i}" data-k="dmg" value="${esc(a.dmg || '')}" placeholder="1d8+3"><input data-ma="${i}" data-k="type" value="${esc(a.type || '')}" placeholder="тип урона">
      <input data-ma="${i}" data-k="reach" type="number" step="5" value="${a.reach === 0 || a.reach === '0' ? 0 : +a.reach || 5}" title="Досягаемость, фт (0 — только дальнобойная)"><input data-ma="${i}" data-k="range" value="${esc(a.range || '')}" placeholder="80/320">
      <select data-ma="${i}" data-k="cond" title="При попадании"><option value="">без эффекта</option>${opt(ON_CONDS, on.cond, (k) => condName(k).toLowerCase())}</select>
      <select data-ma="${i}" data-k="save" title="Спасбросок против эффекта">${abOpt(on.save)}</select><input data-ma="${i}" data-k="dc" type="number" value="${+on.dc || ''}" placeholder="СЛ">
      <label class="check" title="Повторный спасбросок в конце каждого хода цели"><input type="checkbox" data-ma="${i}" data-k="rep" ${on.rep ? 'checked' : ''}> повтор</label>
      <button class="ghost" data-mad="${i}" title="Убрать">✕</button></div>`; }).join('') || '<p class="muted small">Нет атак.</p>';
    $$('[data-mad]').forEach((b) => b.addEventListener('click', () => { atk.splice(+b.dataset.mad, 1); drawAtk(); }));
  };
  const drawAct = () => {
    $('#meAct').innerHTML = acts.map((a, i) => `<div class="me-row">
      <input data-mc="${i}" data-k="n" value="${esc(a.n)}" placeholder="Название"><select data-mc="${i}" data-k="shape">${opt(AREA_SHAPES, a.shape, (k) => SHAPE_N[k])}</select>
      <input data-mc="${i}" data-k="size" type="number" step="5" value="${+a.size || 15}" title="Размер, фт"><select data-mc="${i}" data-k="save">${abOpt(a.save)}</select>
      <input data-mc="${i}" data-k="dc" type="number" value="${+a.dc || 13}" title="СЛ"><input data-mc="${i}" data-k="f" value="${esc(a.f || '')}" placeholder="6d6">
      <input data-mc="${i}" data-k="dtype" value="${esc(a.dtype || '')}" placeholder="огнём"><select data-mc="${i}" data-k="rech" title="Перезарядка"><option value="0">без перезарядки</option>${opt([4, 5, 6], a.rech, (k) => `перезарядка ${k}–6`)}</select>
      <select data-mc="${i}" data-k="sp" title="Заклинание: можно прервать «Контрзаклинанием»"><option value="0">не заклинание</option>${opt([1, 2, 3, 4, 5, 6, 7, 8, 9], a.sp, (k) => `заклинание ${k} ур.`)}</select>
      <button class="ghost" data-mcd="${i}" title="Убрать">✕</button></div>`).join('') || '<p class="muted small">Нет способностей.</p>';
    $$('[data-mcd]').forEach((b) => b.addEventListener('click', () => { acts.splice(+b.dataset.mcd, 1); drawAct(); }));
  };
  // Правки строк сразу в массивы
  $('#meBox').addEventListener('input', (e) => {
    const t = e.target, val = t.type === 'checkbox' ? t.checked : t.type === 'number' || t.tagName === 'SELECT' && /^(rech|sp)$/.test(t.dataset.k) ? +t.value || 0 : t.value;
    // Спасбросок без владения следует за характеристикой; поправленный вручную — остаётся
    if (t.dataset.meab != null) {
      const sv = $(`[data-mesv="${ABK[+t.dataset.meab]}"]`), mod = abMod(+t.value || 10);
      if (+sv.value === +t.dataset.mod) sv.value = mod;
      t.dataset.mod = mod;
    }
    if (t.dataset.ma != null) {
      const a = atk[+t.dataset.ma];
      if (['cond', 'save', 'dc', 'rep'].includes(t.dataset.k)) { a.on = { ...(a.on || {}), [t.dataset.k]: val }; } else a[t.dataset.k] = val;
    }
    if (t.dataset.mc != null) acts[+t.dataset.mc][t.dataset.k] = val;
  });
  $('#meAtkAdd').onclick = () => { atk.push({ n: 'Атака', hit: 4, dmg: '1d6+2', type: 'рубящий', reach: 5, range: '' }); drawAtk(); };
  $('#meActAdd').onclick = () => { acts.push({ n: 'Дыхание', shape: 'cone', size: 15, save: 'dex', dc: 13, f: '6d6', dtype: 'огнём', half: true, rech: 5 }); drawAct(); };
  drawAtk(); drawAct();
  if (!tokenId) {
    lootEdit($('#meLoot'), LT);
    // Предложение по ПО и виду: несколько бросков добычи — отметить нужное и добавить в «всегда при нём»
    $('#meLSug').onclick = () => {
      const probe = { cr: $('#meCr').value, mt: $('#meType').value, atk };
      const rolls = [genLoot(probe), genLoot(probe), genLoot(probe), genHoard(tierCR(probe.cr))], sug = rolls.flatMap((r) => r.items).filter((it, i, a) => it && a.findIndex((x) => x && x.n === it.n) === i).map((it) => ({ ...it, qty: 1 })).slice(0, 14);
      const gps = rolls.slice(0, 3).map((r) => r.gp).sort((a, b) => a - b);
      $('#meLSugBox').innerHTML = `<p class="muted small">Монеты по ПО ${esc(probe.cr)} (${TYPE_N[probe.mt]}): обычно ${gps[0]}–${gps[2]} зм — случайная добыча бросит их сама.</p>
        ${sug.map((it, i) => `<label class="check"><input type="checkbox" data-sg="${i}"> ${esc(it.n)}${it.r >= 1 ? ` <span class="muted small">${RAR_N[it.r]}</span>` : ''}</label>`).join('') || '<p class="muted small">Такое существо ничего не носит — добавьте предметы вручную.</p>'}
        ${sug.length ? '<button id="meLSugAdd">＋ Добавить отмеченное</button>' : ''}`;
      if ($('#meLSugAdd')) $('#meLSugAdd').onclick = () => {
        LT.items = mergeLoot([...LT.items, ...$$('[data-sg]').filter((x) => x.checked).map((x) => sug[+x.dataset.sg])]);
        lootEdit($('#meLoot'), LT); $('#meLSugBox').innerHTML = '';
      };
    };
  }
  $('#meOk').onclick = () => {
    const abv = ABK.map((k, i) => +$(`[data-meab="${i}"]`).value || 10), svAll = Object.fromEntries(ABK.map((k) => [k, +$(`[data-mesv="${k}"]`).value || 0]));
    // Эффект атаки — только если выбрано состояние; пустые поля не сохраняются (база не принимает undefined)
    const cleanAtk = atk.filter((a) => String(a.n || '').trim()).map((a) => {
      const on = a.on && a.on.cond ? { cond: a.on.cond, ...(a.on.save ? { save: a.on.save, dc: +a.on.dc || 10 } : {}), ...(a.on.rep && a.on.save ? { rep: true } : {}) } : null;
      return { n: String(a.n).trim(), hit: +a.hit || 0, dmg: a.dmg || '', type: a.type || '', reach: +a.reach || 0, range: a.range || '', ...(on ? { on } : {}) };
    });
    const cleanActs = acts.filter((a) => String(a.n || '').trim()).map((a) => ({ n: String(a.n).trim(), shape: a.shape || 'sphere', size: +a.size || 5, save: a.save || 'dex', dc: +a.dc || 10,
      f: a.f || '', dtype: a.dtype || '', half: a.half !== false, rech: +a.rech || 0, ...(+a.sp ? { sp: +a.sp } : {}) }));
    const hpTxt = $('#meHp').value.trim() || '1', leg = +$('#meLeg').value || 0, lr = +$('#meLr').value || 0, cs = +$('#meCs').value || 0, sdc = +$('#meSdc').value || 0;
    const mon = { n: $('#meN').value.trim() || 'Существо', e: (src && src.e) || `custom_${Date.now().toString(36)}`, t: Date.now(), cr: $('#meCr').value, size: $('#meSz').value, ac: +$('#meAc').value || 10, hp: hpTxt,
      speed: $('#meSp').value.trim() || '30', ab: abv, sv: Object.fromEntries(ABK.filter((k, i) => svAll[k] !== abMod(abv[i])).map((k) => [k, svAll[k]])), multi: Math.max(1, +$('#meMu').value || 1),
      atk: cleanAtk, x: $('#meX').value.trim(), acts: cleanActs, ...(leg ? { leg } : {}), ...(lr ? { lr } : {}), ...(cs ? { cs } : {}), ...(sdc ? { sdc } : {}) };
    mon.type = $('#meType').value || 'monstrosity';
    if (!tokenId) {
      mon.cat = $('#meCat').value || '';
      if ($('#meBeast').checked) mon.beast = true;
      if ($('#meHoard').checked) mon.hoard = true;
      mon.env = $$('[data-meenv]').filter((x) => x.checked).map((x) => x.dataset.meenv);
      mon.loot = { fixed: LT.items, gp: +LT.gp || 0, rnd: $('#meLRnd').checked };
    }
    const toBest = !tokenId || ($('#meToBest') || {}).checked;
    if (toBest) {
      const list = customMons().filter((m) => m.e !== mon.e);
      saveCustomMons([...list, tokenId && !mon.e.startsWith('custom_') ? { ...mon, e: `custom_${Date.now().toString(36)}` } : mon]);
    }
    if (tokenId) {
      const t = game.tokens[tokenId];
      if (!t) return;
      const hpMax = Math.max(1, /d/i.test(hpTxt) ? avgExpr(hpTxt) : +hpTxt || 1);
      R.update(ref(gpath(`tokens/${tokenId}`)), { name: mon.n, cr: mon.cr, ac: mon.ac, hpMax, hp: +t.hp >= +t.hpMax ? hpMax : Math.min(+t.hp || 0, hpMax), speed: parseInt(mon.speed) || 30, spd: mon.speed,
        size: SIZE_N[mon.size] || 1, ab: abv, sv: svAll, multi: mon.multi, atk: cleanAtk, acts: cleanActs, tr: mon.x, leg: leg || null, lr: lr || null, lrMax: lr || null, cs: cs || null, sdc: sdc || null,
        xp: Math.max(0, +$('#meXp').value || 0), mt: mon.type }).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
    }
    app.closeModal();
    app.toast(tokenId ? `✎ Статблок «${esc(mon.n)}» обновлён${toBest ? ' и сохранён в бестиарий' : ''}` : `🐉 «${esc(mon.n)}» в вашем бестиарии`);
    if (done) setTimeout(done, 100);
  };
}
// Мастер: свои существа — создать, изменить, удалить, перенести на другое устройство файлом
function bestiaryDialog() {
  app.openModal(`<h2>🐉 Бестиарий</h2>
    <div class="row gap wrap"><input id="bmQ" placeholder="Поиск: название, ПО…" style="flex:1"><button class="primary" id="bmNew">＋ Новое существо</button></div>
    <div class="row gap wrap mt"><button id="bmExp">⤓ Сохранить моих в файл</button><label class="btn-file">⤒ Загрузить из файла<input type="file" id="bmImp" accept=".json,application/json" hidden></label></div>
    <p class="muted small" id="bmInfo"></p><div id="bmList" class="list"></div>
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button></div>`);
  const draw = () => {
    const q = ($('#bmQ').value || '').trim().toLowerCase(), mine = customMons(), all = BEST();
    $('#bmInfo').textContent = `Всего существ: ${all.length}, ваших: ${mine.length}. Ваши существа хранятся в этом браузере — чтобы перенести их, сохраните в файл.`;
    $('#bmList').innerHTML = all.filter((m) => !q || m.n.toLowerCase().includes(q) || String(m.e).toLowerCase().includes(q) || m.cr === q).slice(0, 120).map((m) => {
      const over = m.custom && typeof BESTIARY !== 'undefined' && BESTIARY.some((b) => b.e === m.e);
      return `<div class="enc-row"><span><b>${esc(m.n)}</b> <span class="muted small">ПО ${m.cr} · КД ${m.ac} · ${esc(m.hp)}${m.custom ? (over ? ' · ✎ изменено' : ' · ✎ ваше') : ''}${m.leg ? ' · 👑' : ''}</span></span>
        <span class="row gap"><button data-bme="${esc(m.e)}" title="Изменить">✎</button>${m.custom ? `<button class="ghost" data-bmd="${esc(m.e)}" title="${over ? 'Вернуть встроенное' : 'Удалить'}">${over ? '↺' : '✕'}</button>` : ''}</span></div>`;
    }).join('') || '<p class="muted small">Ничего не найдено.</p>';
    $$('[data-bme]').forEach((b) => b.addEventListener('click', () => monEditor(BEST().find((m) => m.e === b.dataset.bme), null, bestiaryDialog)));
    $$('[data-bmd]').forEach((b) => b.addEventListener('click', () => {
      if (!app.confirm('Убрать ваше существо из бестиария?')) return;
      saveCustomMons(customMons().filter((m) => m.e !== b.dataset.bmd)); draw();
    }));
  };
  $('#bmQ').addEventListener('input', draw);
  $('#bmNew').onclick = () => monEditor(null, null, bestiaryDialog);
  $('#bmExp').onclick = () => {
    const mine = customMons();
    if (!mine.length) { app.toast('Своих существ пока нет'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(mine, null, 1)], { type: 'application/json' }));
    a.download = 'bestiary-dnd55.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#bmImp').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      const arr = JSON.parse(txt);
      if (!Array.isArray(arr)) throw new Error('не список');
      const ok = arr.filter((m) => m && typeof m.n === 'string' && Array.isArray(m.ab) && m.ab.length === 6).map((m) => ({ ...m, e: String(m.e || `custom_${Math.random().toString(36).slice(2, 9)}`), custom: undefined }));
      const list = customMons().filter((m) => !ok.some((x) => x.e === m.e));
      saveCustomMons([...list, ...ok.map(({ custom, ...m }) => m)]);
      app.toast(`🐉 Загружено существ: ${ok.length}`);
      draw();
    }).catch(() => app.toast('Не удалось прочитать файл бестиария', 'fumble'));
  };
  draw();
}

/* ---------- Раздаточные материалы ---------- */
// games/{id}/handouts/{k}: { n, txt, img (уменьшенный JPEG), to: '' — всем | uid, t — когда показан (повторный показ меняет t) } — пишет мастер.
// Адресный материал прячется в интерфейсе, но данные игры читает каждый участник — это не тайник от любопытных
const hoSeen = () => { try { return JSON.parse(ls.get('dnd55-ho-seen')) || {}; } catch (e) { return {}; } };
const hoMine = () => Object.entries(game.handouts || {}).filter(([, h]) => isDM() || !h.to || h.to === user.uid).sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
function showHandout(k) {
  const h = (game.handouts || {})[k];
  if (!h) return;
  app.openModal(`<h2>📜 ${esc(h.n || 'Материал')}</h2>${h.img ? `<img class="ho-img" src="${h.img}" alt="">` : ''}${h.txt ? `<div class="ho-txt">${esc(h.txt)}</div>` : ''}
    <div class="modal-actions"><button data-tbl-ho-list>Все материалы</button><button class="primary" data-act="closeModal">Закрыть</button></div>`);
  $('[data-tbl-ho-list]').onclick = handoutsDialog;
}
// Игрок: новый или показанный заново материал открывается сам (старые, полученные до входа, — без всплывающего окна)
function notifyHandouts() {
  if (!game || !user || isDM()) return;
  const seen = hoSeen();
  const fresh = hoMine().filter(([k, h]) => seen[k] !== h.t);
  if (!fresh.length) return;
  fresh.forEach(([k, h]) => { seen[k] = h.t; });
  ls.set('dnd55-ho-seen', JSON.stringify(seen));
  const show = fresh.find(([, h]) => (h.t || 0) >= openedAt - 5000);
  if (!show) return;
  if (!$('#modal').hidden) app.toast(`📜 Мастер показывает: «${esc(show[1].n)}» — кнопка «📜 Материалы»`, 'crit');
  else showHandout(show[0]);
}
function handoutsDialog() {
  const dm = isDM(), list = hoMine(), pcs = Object.entries(game.members || {}).filter(([, m]) => m.role !== 'dm');
  const whoName = (to) => (!to ? 'всем' : ((game.members[to] || {}).char || {}).name || (game.members[to] || {}).name || 'игроку');
  let img = '';
  app.openModal(`<h2>📜 Материалы</h2>
    <div class="list">${list.map(([k, h]) => `<div class="enc-row"><span>${h.img ? '🖼 ' : ''}<b>${esc(h.n || 'Без названия')}</b>${dm ? ` <span class="muted small">— ${esc(whoName(h.to))}</span>` : ''}</span>
      <span class="row gap"><button data-hoo="${k}">Открыть</button>${dm ? `<button data-hoa="${k}" title="Показать игрокам ещё раз">👁 Снова</button><button class="ghost" data-hod="${k}" title="Удалить">✕</button>` : ''}</span></div>`).join('')
      || `<p class="muted small">${dm ? 'Пока ничего не показано.' : 'Мастер ещё ничего не показывал.'}</p>`}</div>
    ${dm ? `<h3 class="mt">Показать новое</h3>
      <div class="form-grid"><label style="grid-column:1/-1">Название<input id="hoN" placeholder="Письмо от барона, карта подземелья…"></label>
        <label style="grid-column:1/-1">Текст<textarea id="hoT" rows="4" placeholder="Необязательно"></textarea></label>
        <label class="btn-file">🖼 Картинка<input type="file" id="hoI" accept="image/*" hidden></label><span class="muted small" id="hoIInfo">без картинки</span>
        <label>Кому<select id="hoTo"><option value="">всем</option>${pcs.map(([uid, m]) => `<option value="${uid}">${esc((m.char || {}).name || m.name)}</option>`).join('')}</select></label></div>
      <p class="muted small">Адресный материал увидит только выбранный игрок (в интерфейсе), остальные о нём не узнают.</p>` : ''}
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button>${dm ? '<button class="primary" id="hoOk">📜 Показать</button>' : ''}</div>`);
  $$('[data-hoo]').forEach((b) => b.addEventListener('click', () => showHandout(b.dataset.hoo)));
  if (!dm) return;
  $$('[data-hoa]').forEach((b) => b.addEventListener('click', async () => { await R.update(ref(gpath(`handouts/${b.dataset.hoa}`)), { t: Date.now() }); app.toast('📜 Показано снова'); }));
  $$('[data-hod]').forEach((b) => b.addEventListener('click', async () => { if (app.confirm('Удалить материал у всех?')) { await R.remove(ref(gpath(`handouts/${b.dataset.hod}`))); setTimeout(handoutsDialog, 150); } }));
  $('#hoI').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('#hoIInfo').textContent = 'обработка…';
    shrinkImage(f, 1400, 0.8).then((r) => { img = r.data; $('#hoIInfo').textContent = `🖼 ${r.w}×${r.h}, ${Math.round(img.length / 1024)} КБ`; })
      .catch(() => { img = ''; $('#hoIInfo').textContent = 'не удалось прочитать картинку'; });
  };
  $('#hoOk').onclick = async () => {
    const n = $('#hoN').value.trim(), txt = $('#hoT').value.trim(), to = $('#hoTo').value;
    if (!n && !txt && !img) { app.toast('Добавьте название, текст или картинку'); return; }
    const k = R.push(ref(gpath('handouts'))).key;
    await R.set(ref(gpath(`handouts/${k}`)), { n: n || 'Материал', ...(txt ? { txt: txt.slice(0, 5000) } : {}), ...(img ? { img } : {}), to, t: Date.now() });
    app.toast(`📜 «${esc(n || 'Материал')}» показан: ${esc(whoName(to))}`);
    setTimeout(handoutsDialog, 150);
  };
}

/* ---------- Генератор местности и локаций ---------- */
// mapgen.js строит карту по шаблону и «зерну»; здесь — предпросмотр, сундуки с добычей и замена поля (по желанию — новой сценой)
// Цвета предпросмотра: стены тёмные, пол светлый — чтобы план читался с первого взгляда
const PREV_C = { wall: '#15120f', floor: '#6e604b', tree: '#2f6b2a', rock: '#7a746a', furn: '#a0662e', road: '#b08a55', bridge: '#8a5a2b', water: '#3c6eaa', thicket: '#2a5a2a', snow: '#dfe6ee', sand: '#c8b27a', slope: '#8a7454', bog: '#4a5a30' };
const AMB_N = [['bright', '☀ день'], ['dim', '🌆 сумерки'], ['dark', '🌑 темнота']], FOG_N = [['off', 'выключен'], ['vision', 'обзор персонажей'], ['manual', 'только открытое мастером']];
let genSeed = 0;
function genDialog() {
  if (typeof MAPGEN === 'undefined') { app.toast('Генератор не загрузился — обновите страницу'); return; }
  const T = MAPGEN.TEMPLATES;
  let st = {};
  try { st = JSON.parse(ls.get('dnd55-gen')) || {}; } catch (e) { st = {}; }
  let tpl = T[st.tpl] ? st.tpl : 'forest', res = null;
  genSeed = genSeed || Math.floor(Math.random() * 1e9);
  const group = (kind) => Object.entries(T).filter(([, t]) => t.kind === kind).map(([k, t]) => `<option value="${k}" ${k === tpl ? 'selected' : ''}>${t.n}</option>`).join('');
  const sel = (id, list) => `<select id="${id}">${list.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select>`;
  app.openModal(`<div id="genBox"><h2>🎲 Генератор местности и локаций</h2>
    <div class="form-grid"><label style="grid-column:1/-1">Шаблон<select id="gT"><optgroup label="Местность">${group('terrain')}</optgroup><optgroup label="Локации">${group('location')}</optgroup><optgroup label="Мир">${group('world')}</optgroup></select></label>
      <label>Ширина, клеток<input type="number" id="gW" min="12" max="80"></label><label>Высота, клеток<input type="number" id="gH" min="10" max="80"></label>
      <label>Густота<input type="range" id="gD" min="0" max="1" step="0.05" value="${st.d != null ? st.d : 0.3}"></label>
      <label id="gVBox">Вариант<select id="gV"></select></label>
      <label>Освещение${sel('gA', AMB_N)}</label><label>Туман войны${sel('gF', FOG_N)}</label>
      <label class="check"><input type="checkbox" id="gRoad"> Дорога</label>
      <label class="check"><input type="checkbox" id="gChest"> Сундуки с добычей</label></div>
    <h3 class="mt">Заселение</h3>
    <div class="form-grid"><label class="check" style="grid-column:1/-1"><input type="checkbox" id="gPop" checked> Расставить противников по уровню группы (в мирных местах — NPC с именами и торговцами)</label>
      ${popOptsHtml(Object.values(game.members || {}).filter((m) => m.role !== 'dm').length || 4, false)}</div>
    <div class="row between mt"><span class="muted small" id="gInfo"></span><button id="gRe">🎲 Другой вариант</button></div>
    <div class="gen-wrap"><canvas id="gPrev"></canvas></div>
    <div class="form-grid mt"><label class="check" style="grid-column:1/-1"><input type="checkbox" id="gScene" checked> Новой сценой — текущее поле сохранится в своей сцене, вернуться можно в «🎬 Сцены»</label>
      <label>Название сцены<input id="gName"></label><label class="check"><input type="checkbox" id="gNpc" checked> Убрать существ с поля</label></div>
    <p class="muted small">Персонажи встанут у входа (синяя точка). Сундуки получат добычу по уровню, в подземельях и пещерах — иногда с замком и ловушкой. Существ и NPC пока ставьте сами или конструктором столкновений.</p>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="gOk">Создать</button></div></div>`);
  const opts = () => ({ w: +$('#gW').value, h: +$('#gH').value, density: +$('#gD').value, road: $('#gRoad').checked, chests: $('#gChest').checked, variant: $('#gV').value, seed: genSeed });
  // Шаблон задаёт размер, дорогу, сундуки, свет и туман по умолчанию
  const setTpl = () => {
    tpl = $('#gT').value;
    const t = T[tpl], probe = MAPGEN.generate(tpl, { seed: 1 });
    $('#gW').value = t.w; $('#gH').value = t.h; $('#gRoad').checked = !!t.road; $('#gChest').checked = !!t.chests;
    $('#gRoad').closest('label').hidden = t.kind !== 'terrain';
    $('#gA').value = probe.amb; $('#gF').value = probe.fog; $('#popPeace').checked = !!t.peaceful;
    $('#gName').value = t.n.replace(/^\S+\s/, '');
    $('#gVBox').hidden = !t.variants;
    $('#gV').innerHTML = `<option value="">случайно</option>${(t.variants || []).map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}`;
  };
  const draw = () => {
    res = MAPGEN.generate(tpl, opts());
    const cv = $('#gPrev'), px = Math.max(4, Math.min(14, Math.floor(Math.min(560, cv.parentElement.clientWidth || 560) / res.w))), g = cv.getContext('2d');
    cv.width = res.w * px; cv.height = res.h * px;
    g.fillStyle = GROUND[res.ground] || '#1f1b16'; g.fillRect(0, 0, cv.width, cv.height);
    Object.entries(res.cells).forEach(([k, v]) => { const [x, y] = k.split('_').map(Number); g.fillStyle = PREV_C[v] || (TERRAIN[v] || {}).color || '#555'; g.fillRect(x * px, y * px, px, px); });
    Object.entries(res.doors).forEach(([k, d]) => { const [x, y] = k.split('_').map(Number); g.fillStyle = d.l ? '#e0703a' : '#8a5a2b'; g.fillRect(x * px + 1, y * px + 1, px - 2, px - 2); });
    res.lights.forEach((L) => { g.fillStyle = '#ffe58a'; g.beginPath(); g.arc(L.x * px + px / 2, L.y * px + px / 2, px / 3, 0, Math.PI * 2); g.fill(); });
    res.chests.forEach((c) => { g.fillStyle = '#ffd34d'; g.fillRect(c.x * px + 1, c.y * px + 1, px - 2, px - 2); g.strokeStyle = '#000'; g.strokeRect(c.x * px + 1, c.y * px + 1, px - 2, px - 2); });
    (res.pois || []).forEach((p) => { g.fillStyle = POI_C[p.k] || '#fff'; g.fillRect(p.x * px - 1, p.y * px - 1, px + 2, px + 2); g.strokeStyle = '#000'; g.strokeRect(p.x * px - 1, p.y * px - 1, px + 2, px + 2); });
    g.fillStyle = '#5b8fc9'; g.beginPath(); g.arc(res.start.x * px + px / 2, res.start.y * px + px / 2, px / 2, 0, Math.PI * 2); g.fill();
    const doors = Object.values(res.doors), rooms = res.rooms.filter((r) => r.kind !== 'cave');
    $('#gInfo').textContent = res.pois ? `${res.w}×${res.h} миль · мест: ${res.pois.length} (${res.pois.map((p) => POI_IC[p.k]).join('')}) · вариант ${genSeed % 100000}` : `${res.w}×${res.h} клеток${rooms.length ? ` · помещений: ${rooms.length}` : ''}${doors.length ? ` · дверей: ${doors.length}${doors.some((d) => d.l) ? ` (заперто ${doors.filter((d) => d.l).length})` : ''}` : ''}${res.chests.length ? ` · сундуков: ${res.chests.length}` : ''} · вариант ${genSeed % 100000}`;
    ls.set('dnd55-gen', JSON.stringify({ tpl, d: +$('#gD').value }));
  };
  $('#gT').onchange = () => { setTpl(); draw(); };
  ['#gW', '#gH', '#gD', '#gRoad', '#gChest', '#gV'].forEach((s) => $(s).addEventListener('change', draw));
  $('#gRe').onclick = () => { genSeed = Math.floor(Math.random() * 1e9); draw(); };
  $('#gOk').onclick = () => { const P = popOptsRead(), isWorld = T[tpl].kind === 'world'; genApply({ ...res, tpl }, { lvl: P.lvl, amb: $('#gA').value, fog: $('#gF').value, asScene: $('#gScene').checked,
    name: $('#gName').value.trim() || T[tpl].n.replace(/^\S+\s/, ''), clearNpc: $('#gNpc').checked || isWorld, peaceful: !!T[tpl].peaceful, pop: $('#gPop').checked && !isWorld ? P : null, seed: genSeed }); };
  setTpl(); draw();
}
async function genApply(res, o) {
  if (!res) return;
  const tier = tierLvl(o.lvl), key = (p) => R.push(ref(gpath(p))).key;
  const lights = Object.fromEntries(res.lights.map((L) => [key('lights'), L]));
  // Сундуки: в опасных местах чаще заперты и с ловушками; у главного зала подземелья — сокровищница
  const chests = Object.fromEntries(res.chests.map((c) => {
    const lockP = o.peaceful ? 0.6 : 0.4, trapP = o.peaceful ? 0 : 0.3;
    const trap = chance(trapP) ? makeTrap(pickOne(TRAPS).id, o.lvl) : null;
    return [key('chests'), { x: c.x, y: c.y, lvl: o.lvl, lock: chance(lockP) ? [10, 15, 15, 20][tier] : 0, trap, loot: c.boss ? genHoard(tier) : genChest(o.lvl) }];
  }));
  // Карта мира: миля на клетку, видно на 3 мили; места — с индексами, к ним потом привяжутся сцены
  const world = res.pois ? { seed: o.seed || 1, pois: Object.fromEntries(res.pois.map((p, i) => [i, p])) } : null;
  const fog = { ...fogSet(), mode: o.fog, amb: o.amb, ...(world ? { sight: 5280 * 3 } : {}) };
  const blocked = (k) => (TERRAIN[res.cells[k]] || {}).block || (res.doors[k] && !res.doors[k].o);
  // Персонажи и их спутники — на свободные клетки рядом со входом
  const taken = new Set(), spot = () => {
    for (let r = 0; r < Math.max(res.w, res.h); r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = res.start.x + dx, y = res.start.y + dy, k = `${x}_${y}`;
      if (x >= 0 && y >= 0 && x < res.w && y < res.h && !blocked(k) && !taken.has(k) && res.cells[k] !== 'water') { taken.add(k); return [x, y]; }
    }
    return [res.start.x, res.start.y];
  };
  if (o.asScene && (Object.keys(game.map || {}).length || Object.keys(game.tokens || {}).length)) await saveScene();
  const upd = { map: res.cells, doors: res.doors, lights, chests, reveal: null, seen: null, bgimg: null, 'meta/bg': null, 'meta/w': res.w, 'meta/h': res.h,
    'meta/fog': fog, 'meta/ground': res.ground || null, 'meta/ft': world ? 5280 : null, 'meta/world': world, 'meta/worldFrom': o.worldFrom || null,
    drops: null, areas: null, init: null, econ: null, ...(world ? { travel: { miles: 0, pace: 'normal', extra: 0, checks: 0 } } : {}) };
  const pcs = {};
  Object.entries(game.tokens || {}).forEach(([id, t]) => {
    if (t.kind === 'npc') { if (o.clearNpc) upd[`tokens/${id}`] = null; return; }
    const [x, y] = spot();
    upd[`tokens/${id}/x`] = x; upd[`tokens/${id}/y`] = y; pcs[id] = { x, y };
  });
  // План комнат и вход — для заселения сейчас и позже («👥 Заселить»)
  const gen = { tpl: res.tpl, rooms: res.rooms, start: res.start };
  upd['meta/gen'] = gen;
  const P = o.pop ? populate({ w: res.w, h: res.h, cells: res.cells, doors: res.doors, rooms: res.rooms, start: res.start, tpl: res.tpl }, { ...o.pop, keep: Object.values(pcs).map((p) => [p.x, p.y]) }) : null;
  if (P) Object.entries(P.tokens).forEach(([id, t]) => { upd[`tokens/${id}`] = t; });
  if (o.asScene) {
    const sid = key('scenes');
    upd['meta/scene'] = sid;
    upd[`scenes/${sid}`] = { n: o.name, t: Date.now() };
    upd[`sceneData/${sid}`] = { w: res.w, h: res.h, fog, ground: res.ground || null, gen, map: res.cells, doors: res.doors, lights, chests, npcs: P ? P.tokens : {}, pcs,
      ft: world ? 5280 : null, world, worldFrom: o.worldFrom || null };
    upd._sid = sid;
  }
  const sid = upd._sid || null;
  delete upd._sid;
  if (P && P.notes.length) addLog({ kind: 'sys', dmOnly: true, txt: `👥 Заселено (${Object.keys(P.tokens).length}): ${P.notes.join('; ')}` });
  app.closeModal();
  await R.update(ref(gpath()), upd).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
  addLog({ kind: 'sys', txt: `${world ? '🌍 Карта мира' : '🗺 Новая местность'}: ${o.name}` });
  app.toast(`${world ? '🌍' : '🗺'} «${esc(o.name)}» готово${Object.keys(chests).length ? ` · сундуков: ${Object.keys(chests).length}` : ''}${world ? ' · места на карте — нажмите, чтобы войти' : ''}`, 'crit');
  return sid;
}

/* ---------- Заселение: противники по уровню группы и NPC ---------- */
// Где искать существ для шаблона карты (метки env в бестиарии)
const TPL_ENV = { forest: ['forest'], river: ['forest', 'grassland', 'swamp'], mountains: ['mountain'], plains: ['grassland'], swamp: ['swamp'], desert: ['desert'], coast: ['coast'],
  dungeon: ['dungeon'], cave: ['underdark'], castle: ['urban', 'dungeon'], city: ['urban'], village: ['urban', 'forest', 'grassland'], tavern: ['urban'] };
const DIFF_N = ['низкая', 'умеренная', 'высокая'];
// Банды лагерей
const FACTION = { goblin: ['Goblin', 'Goblin Boss', 'Hobgoblin', 'Hobgoblin Captain', 'Bugbear', 'Worg', 'Wolf'],
  bandit: ['Bandit', 'Bandit Captain', 'Thug', 'Scout', 'Spy', 'Veteran', 'Berserker', 'Mastiff', 'Gladiator'] };
const NAMES_M = ['Борислав', 'Ратибор', 'Велимир', 'Остап', 'Мирон', 'Гордей', 'Тихон', 'Святогор', 'Добрыня', 'Еремей', 'Фома', 'Лука', 'Аким', 'Игнат', 'Савва', 'Прохор', 'Демид',
  'Торгрим', 'Бруни', 'Таэрон', 'Элдрик', 'Корвин', 'Гаррет', 'Освин', 'Бальдур', 'Финн'];
const NAMES_F = ['Милена', 'Ярина', 'Забава', 'Злата', 'Любава', 'Василиса', 'Агафья', 'Олеся', 'Дарина', 'Ведана', 'Марфа', 'Ульяна', 'Радмила', 'Есения', 'Аглая', 'Белослава',
  'Хельга', 'Элариэль', 'Мирабель', 'Иветта', 'Сельма', 'Тамсин'];
// Прозвища и роли — в мужском и женском роде
const NICKS = [['Рыжий', 'Рыжая'], ['Кривой', 'Кривая'], ['Тихий', 'Тихая'], ['Хромой', 'Хромая'], ['Седой', 'Седая'], ['Весёлый', 'Весёлая'], ['из Заречья'], ['с Холма'],
  ['Медовый', 'Медовая'], ['Кузнецов', 'Кузнецова'], ['Мельников', 'Мельникова'], ['Длинный', 'Длинная']];
const ROLE_F = { 'стражник': 'стражница', 'стражник у ворот': 'стражница у ворот', 'горожанин': 'горожанка', 'знатный горожанин': 'знатная горожанка', 'селянин': 'селянка',
  'трактирщик': 'трактирщица', 'посетитель': 'посетительница', 'торговец': 'торговка', 'бродячий торговец': 'бродячая торговка', 'лавочник': 'лавочница', 'жрец': 'жрица',
  'послушник': 'послушница', 'карманник': 'карманница', 'дозорный': 'дозорная', 'охотник': 'охотница', 'знатный гость': 'знатная гостья', 'владелец замка': 'владелица замка', 'путник': 'путница',
  'хозяин усадьбы': 'хозяйка усадьбы', 'кладовщик': 'кладовщица', 'рыбак': 'рыбачка', 'повар': 'повариха', 'садовник': 'садовница', 'отшельник': 'отшельница', 'постоялец': 'постоялица',
  'гость замка': 'гостья замка', 'оружейник': 'оружейница', 'часовой': 'часовая', 'лесник': 'лесничая' };
const ROLE_ONLY_F = ['кухарка', 'знахарка'];
const TRAITS = ['ворчливый', 'любопытный', 'трусоватый', 'болтливый', 'подозрительный', 'добродушный', 'жадный', 'набожный', 'рассеянный', 'хвастливый', 'молчаливый', 'весёлый',
  'строгий', 'суеверный', 'услужливый', 'гордый', 'усталый', 'хитрый', 'простодушный', 'обидчивый', 'щедрый', 'вспыльчивый', 'мечтательный', 'недоверчивый к чужакам'];
// Имя с прозвищем в нужном роде; used — уже выданные имена (без повторов в одном заселении)
function npcName(role, used) {
  const f = ROLE_ONLY_F.includes(role) || chance(0.45), list = (f ? NAMES_F : NAMES_M).filter((n) => !used.has(n));
  const first = pickOne(list.length ? list : f ? NAMES_F : NAMES_M), nick = chance(0.35) ? pickOne(NICKS) : null;
  used.add(first);
  return { name: `${first}${nick ? ` ${f ? nick[1] || nick[0] : nick[0]}` : ''}`, role: f ? ROLE_F[role] || role : role };
}
const pickN = (arr, n) => arr.slice().sort(() => Math.random() - 0.5).slice(0, n);
// Состав стычки на бюджет опыта: вожак из сильных подходящих, свита одного вида послабее, остаток — ещё такие же, как вожак
function encBuild(pool, budget, maxN, avoid = new Set()) {
  const xp = (m) => crXp(m.cr);
  let cand = pool.filter((m) => xp(m) <= budget && xp(m) >= budget / 12);
  if (!cand.length) cand = pool.filter((m) => xp(m) <= budget);
  if (!cand.length) return [];
  cand.sort((a, b) => xp(b) - xp(a));
  // Разные вожаки у разных групп на одной карте, если есть из кого выбирать
  if (cand.some((m) => !avoid.has(m.e))) cand = cand.filter((m) => !avoid.has(m.e));
  const lead = pickOne(cand.slice(0, Math.max(1, Math.ceil(cand.length / 2)))), out = [{ m: lead, n: 1 }];
  avoid.add(lead.e);
  let left = budget - xp(lead), count = 1;
  // Боссы (легендарные, с сокровищницей) — только поодиночке и никогда в свите
  const solo = (m) => !!(m.leg || m.hoard);
  // Свита — того же вида, что вожак (нежить с нежитью, гуманоиды с гуманоидами), если такие есть; у дракона — кто угодно, кроме драконов
  // До двух видов свиты; сильных (дороже шестой части бюджета) — не больше трёх, остальных — не больше шести
  for (let kinds = 0; kinds < 2 && left >= 10 && count < maxN && chance(kinds ? 0.5 : 0.75); kinds++) {
    const fit = pool.filter((m) => m !== lead && !solo(m) && !out.some((o) => o.m === m) && xp(m) <= Math.min(left, xp(lead)) && xp(m) >= Math.max(10, left / 8)
      && !(solo(lead) && m.type === lead.type));
    const kin = solo(lead) ? [] : fit.filter((m) => m.type === lead.type), minions = kin.length ? kin : fit;
    if (!minions.length) break;
    const mm = pickOne(minions), k = Math.min(maxN - count, xp(mm) > budget / 6 ? 3 : 6, Math.floor(left / xp(mm)));
    if (k <= 0) break;
    out.push({ m: mm, n: k }); left -= k * xp(mm); count += k;
  }
  while (!solo(lead) && left >= xp(lead) && count < maxN) { out[0].n += 1; left -= xp(lead); count += 1; }
  return out;
}
// Свободные клетки карты L ({ w, h, cells, doors }): не стена, не вода, не дверь и не занята
function spotFinder(L) {
  const taken = new Set();
  const free = (x, y, s = 1) => {
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
      const cx = x + dx, cy = y + dy, k = `${cx}_${cy}`, T = TERRAIN[(L.cells || {})[k]];
      if (cx < 0 || cy < 0 || cx >= L.w || cy >= L.h || (T && T.block) || (L.cells || {})[k] === 'water' || (L.doors || {})[k] || taken.has(k)) return false;
    }
    return true;
  };
  const take = (x, y, s = 1) => { for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) taken.add(`${x + dx}_${y + dy}`); };
  const near = (x, y, s = 1, rect = null, maxR = 10) => {
    for (let r = 0; r <= maxR; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = x + dx, cy = y + dy;
      if (rect && (cx < rect.x || cy < rect.y || cx + s > rect.x + rect.w || cy + s > rect.y + rect.h)) continue;
      if (free(cx, cy, s)) { take(cx, cy, s); return [cx, cy]; }
    }
    return null;
  };
  // Случайная свободная клетка подальше от входа и от уже занятых групп
  const far = (start, minD, others = []) => {
    for (let t = 0; t < 400; t++) {
      const x = Math.floor(Math.random() * L.w), y = Math.floor(Math.random() * L.h);
      if (!free(x, y)) continue;
      if (Math.max(Math.abs(x - start.x), Math.abs(y - start.y)) < minD - Math.floor(t / 80)) continue;
      if (others.some(([ox, oy]) => Math.max(Math.abs(x - ox), Math.abs(y - oy)) < 6)) continue;
      return [x, y];
    }
    return null;
  };
  const cells = (pred) => { const out = []; for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) if (pred((L.cells || {})[`${x}_${y}`]) && free(x, y)) out.push([x, y]); return out; };
  return { free, take, near, far, cells };
}
// Токен существа из бестиария с добычей; extra — сторона, имя роли, торговля
function monToken(mon, name, x, y, extra = {}) {
  const hp = avgExpr(mon.hp), size = SIZE_N[mon.size] || 1;
  const t = { kind: 'npc', owner: user.uid, name, x, y, size, color: '#c94a3d', hp, hpMax: hp, ac: mon.ac, speed: parseInt(mon.speed) || 30, init: abMod(mon.ab[1]),
    hidden: false, cond: [], side: 'enemy', dsOn: false, ...monStats(mon), xp: crXp(mon.cr), ...extra };
  t.loot = genLoot(t);
  return t;
}
// Заселить карту L ({ w, h, cells, doors, rooms, start, tpl }): o = { lvl, n, diff, groups, peaceful, hidden, keep: [[x, y]] }.
// Возвращает токены { id: токен } и описание для журнала мастера
function populate(L, o) {
  const F = spotFinder(L), tokens = {}, notes = [], key = () => R.push(ref(gpath('tokens'))).key;
  (o.keep || []).forEach(([x, y]) => F.take(x, y));
  // Вокруг входа — пусто, чтобы бой не начинался с порога
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) F.take(L.start.x + dx, L.start.y + dy);
  const env = TPL_ENV[L.tpl] || ['forest'], count = {};
  const num = (n) => { count[n] = (count[n] || 0) + 1; return count[n]; };
  if (o.peaceful) { peacefulNpcs(L, F, tokens, notes, key); return { tokens, notes }; }
  const lvl = Math.max(1, Math.min(20, o.lvl)), n = Math.max(1, o.n), budget = (d) => n * ENC_BUDGET[lvl][d];
  const all = BEST().filter((m) => m.cat !== 'npc' || env.includes('urban'));
  const inEnv = all.filter((m) => (m.env || []).some((e) => env.includes(e)));
  const pool = (cap) => { const p = inEnv.filter((m) => crNum(m.cr) <= cap); return p.length >= 3 ? p : all.filter((m) => crNum(m.cr) <= cap); };
  // Лагеря — первыми группами (банда своего лагеря); в остальные комнаты — по одной группе
  const camps = (L.rooms || []).filter((r) => r.kind === 'camp');
  const rooms = (L.rooms || []).filter((r) => !['entrance', 'cave', 'plaza', 'camp', 'hut', 'garden', 'pier', 'market', 'bar'].includes(r.kind));
  const bossRoom = rooms.find((r) => r.kind === 'boss');
  const auto = ['dungeon'].includes(L.tpl) ? Math.max(2, Math.min(6, Math.round(rooms.length / 2.5))) : L.tpl === 'cave' ? 3 : MAPGEN.TEMPLATES[L.tpl] && MAPGEN.TEMPLATES[L.tpl].kind === 'location' ? 3 : 2;
  const groups = Math.max(camps.length, o.groups > 0 ? o.groups : auto), used = new Set(), centers = [], leads = new Set();
  for (let i = 0; i < groups; i++) {
    const boss = (L.tpl === 'dungeon' || L.tpl === 'cave') && i === groups - 1 && groups > 1;
    const camp = camps[i], fpool = camp ? BEST().filter((m) => (FACTION[camp.faction] || []).includes(m.e) && crNum(m.cr) <= lvl + 2) : null;
    const comp = encBuild(fpool && fpool.length ? fpool : pool(lvl + (boss ? 3 : 1)), budget(boss ? 2 : o.diff), n * 2 + 2, leads);
    if (!comp.length) continue;
    // Где: в комнате (босс — в дальнем зале), иначе — в стороне от входа
    let room = camp || (boss && bossRoom && !used.has(bossRoom) ? bossRoom : null);
    if (!room && rooms.length) room = pickOne(rooms.filter((r) => !used.has(r) && r !== bossRoom)) || null;
    if (room) used.add(room);
    const c = room ? [room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2)] : F.far(L.start, Math.max(8, Math.floor(Math.max(L.w, L.h) / 3)), centers);
    if (!c) continue;
    centers.push(c);
    const placed = [];
    comp.forEach(({ m, n: k }) => {
      const s = SIZE_N[m.size] || 1;
      for (let j = 0; j < k; j++) {
        // Большим существам ищем место шире — в комнате, рядом с ней или в любом свободном углу карты
        const p = F.near(c[0], c[1], s, room, room ? 6 : 10) || F.near(c[0], c[1], s, null, 14) || (() => { const f = F.far(L.start, 6, []); return f && F.near(f[0], f[1], s, null, 8); })();
        if (!p) continue;
        tokens[key()] = monToken(m, `${m.n} ${num(m.n)}`, p[0], p[1], { hidden: !!o.hidden });
        placed.push(m);
      }
    });
    // В журнал — то, что действительно встало на поле
    const xp = placed.reduce((s, m) => s + crXp(m.cr), 0), got = comp.map(({ m }) => [m, placed.filter((x) => x === m).length]).filter(([, k]) => k);
    if (placed.length) notes.push(`${boss ? '👑 ' : ''}${got.map(([m, k]) => `${m.n}${k > 1 ? ` ×${k}` : ''}`).join(' + ')} — ${xp} оп.${room ? ` (${room.kind === 'boss' ? 'дальний зал' : room.kind === 'camp' ? `лагерь ${room.faction === 'goblin' ? 'гоблинов' : 'бандитов'}` : 'комната'})` : ''}`);
  }
  // В жилой лачуге — отшельник или лесник, мирный
  (L.rooms || []).filter((r) => r.kind === 'hut' && !r.abandoned).forEach((r) => {
    const [e, role] = pickOne([['Druid', 'отшельник'], ['Commoner', 'лесник'], ['Acolyte', 'отшельник'], ['Scout', 'охотник']]), mon = BEST().find((m) => m.e === e), p = mon && F.near(r.x + 1, r.y + 1, 1, r, 4);
    if (!p) return;
    const N = npcName(role, new Set());
    tokens[key()] = monToken(mon, `${N.name}, ${N.role}`, p[0], p[1], { side: 'neutral', dsOn: true, color: SIDE_COLOR.neutral, tr: `Характер: ${pickOne(TRAITS)}.` });
    notes.push(`в лачуге: ${N.name} (${N.role})`);
  });
  return { tokens, notes };
}
// Мирные локации: стража, жители, торговцы, жрецы — нейтральные NPC с именами и чертами характера
const SHOP_N = { general: 'лавка: снаряжение и припасы', smith: 'кузница: оружие и доспехи', alchemist: 'алхимик: зелья и свитки' };
function peacefulNpcs(L, F, tokens, notes, key) {
  const T = L.tpl, R_ = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)), roomsOf = (k) => (L.rooms || []).filter((r) => r.kind === k);
  // Кто где: [существо, роль, сколько, где — тип комнаты, 'road', 'gate', 'any' или сама комната]
  const n_ = (k) => roomsOf(k).length;
  const plan = T === 'city' ? [['Guard', 'стражник', R_(3, 5), 'road'], ['Veteran', 'капитан стражи', 1, 'plaza'], ['Commoner', 'горожанин', R_(6, 9), 'road'], ['Commoner', 'горожанин', R_(2, 4), 'house'],
    ['Noble', 'знатный горожанин', 1, 'plaza'], ['Noble', 'хозяин усадьбы', Math.min(2, n_('manor')), 'manor'], ['Priest', 'жрец', 1, 'temple'], ['Acolyte', 'послушник', 1, 'temple'],
    ['Commoner', 'трактирщик', n_('tavern'), 'tavern'], ['Commoner', 'кладовщик', Math.min(2, n_('warehouse')), 'warehouse'], ['Commoner', 'рыбак', Math.min(6, n_('pier') * 2), 'pier'],
    ['Commoner', 'зазывала', n_('market') ? 1 : 0, 'market'], ['Spy', 'карманник', chance(0.5) ? 1 : 0, n_('market') ? 'market' : 'road']]
    : T === 'village' ? [['Commoner', 'селянин', Math.min(6, n_('house')), 'house'], ['Commoner', 'трактирщик', 1, 'tavern'], ['Guard', 'дозорный', R_(1, 2), 'road'],
      ['Scout', 'охотник', 1, 'any'], ['Druid', 'знахарка', chance(0.4) ? 1 : 0, 'house'], ['Commoner', 'ребёнок', R_(0, 2), 'any']]
    : T === 'castle' ? [['Guard', 'стражник у ворот', 2, 'gate'], ['Guard', 'стражник', R_(1, 3), 'any'], ['Guard', 'часовой', Math.min(6, n_('tower')), 'tower'], ['Guard', 'стражник', n_('barracks') * 2, 'barracks'],
      ['Veteran', 'капитан', 1, n_('barracks') ? 'barracks' : 'any'], ['Knight', 'рыцарь', 1, 'hall'], ['Noble', 'владелец замка', 1, 'hall'], ['Noble', 'гость замка', chance(0.4) ? 1 : 0, 'chamber'],
      ['Priest', 'капеллан', n_('chapel') ? 1 : 0, 'chapel'], ['Commoner', 'конюх', n_('stable') ? 1 : 0, 'stable'], ['Commoner', 'повар', n_('kitchen') ? 1 : 0, 'kitchen'],
      ['Commoner', 'садовник', n_('garden') ? 1 : 0, 'garden'], ['Commoner', 'слуга', R_(2, 3), 'any']]
    : [['Commoner', 'трактирщик', 1, n_('bar') ? 'bar' : 'hall'], ['Commoner', 'посетитель', R_(4, 7), 'hall'], ['Thug', 'громила', chance(0.4) ? 1 : 0, 'hall'], ['Scout', 'путник', chance(0.5) ? 1 : 0, 'hall'],
      ['Noble', 'знатный гость', chance(0.4) ? 1 : 0, 'room'], ['Commoner', 'постоялец', R_(0, 2), 'room'], ['Commoner', 'кухарка', 1, 'kitchen'], ['Commoner', 'конюх', n_('stable') ? 1 : 0, 'stable']];
  // Торговцы: в городе — в лавках и на рынке, в деревне — лавочник, в замке — кузнец в кузнице, в таверне — иногда бродячий торговец
  const shops = T === 'city' ? [...roomsOf('shop').slice(0, 3).map((r, i) => ['Commoner', ['торговец', 'кузнец', 'алхимик'][i], 1, r, ['general', 'smith', 'alchemist'][i]]),
    ...roomsOf('market').flatMap((r) => [['Commoner', 'торговец', 1, r, 'general'], ['Commoner', 'алхимик', 1, r, 'alchemist'], ...(chance(0.5) ? [['Commoner', 'оружейник', 1, r, 'smith']] : [])])]
    : T === 'village' ? [['Commoner', 'лавочник', 1, 'house', 'general']] : T === 'castle' ? [['Commoner', 'кузнец', 1, n_('smithy') ? 'smithy' : 'barracks', 'smith']]
      : chance(0.4) ? [['Commoner', 'бродячий торговец', 1, 'hall', 'general']] : [];
  const big = T === 'city', place = (where, s) => {
    const room = typeof where === 'object' ? where : null;
    if (room) return F.near(room.x + Math.floor(room.w / 2), room.y + Math.floor(room.h / 2), s, room, 6);
    if (where === 'gate') return F.near(L.start.x, L.start.y, s, null, 9);
    if (['road', 'any'].includes(where)) { const list = F.cells(where === 'road' ? (v) => v === 'road' : (v) => !v || ['road', 'floor', 'sand', 'bridge'].includes(v)); const p = list.length ? pickOne(list) : null; if (p) F.take(p[0], p[1]); return p; }
    const rs = roomsOf(where);
    if (!rs.length) return null;
    const r = pickOne(rs);
    return F.near(r.x + Math.floor(r.w / 2), r.y + Math.floor(r.h / 2), s, r, 6);
  };
  const who = [], usedNames = new Set();
  [...plan, ...shops].forEach(([e, role, k, where, shop]) => {
    const mon = BEST().find((m) => m.e === e);
    if (!mon) return;
    for (let i = 0; i < k; i++) {
      const p = place(where, SIZE_N[mon.size] || 1) || place('any', 1);
      if (!p) continue;
      const N = npcName(role, usedNames), trait = pickOne(TRAITS);
      tokens[key()] = monToken(mon, `${N.name}, ${N.role}`, p[0], p[1], { side: 'neutral', dsOn: true, color: SIDE_COLOR.neutral, tr: `${mon.x ? `${mon.x} ` : ''}Характер: ${trait}.`,
        ...(shop ? { shop: { kind: shop, items: shopStock(shop, big) } } : {}) });
      who.push(`${N.name} (${N.role}${shop ? ', 🛒' : ''})`);
    }
  });
  if (who.length) notes.push(`NPC: ${who.join(', ')}`);
}
// Цена товара в золоте из записи «5 зм», «2 см», «1 мм»
const costGp = (s) => { const m = String(s || '').match(/([\d.,]+)\s*(зм|см|мм|эм|пм)/); return m ? +(parseFloat(m[1].replace(',', '.')) * { зм: 1, см: 0.1, мм: 0.01, эм: 0.5, пм: 10 }[m[2]]).toFixed(2) : 0; };
const fmtPrice = (gp) => (gp >= 1 ? `${+gp.toFixed(2)} зм` : gp >= 0.1 ? `${Math.round(gp * 10)} см` : `${Math.round(gp * 100)} мм`);
// Цена магического предмета по редкости (DMG 2024: 100 / 400 / 4000 / 40 000 / 200 000 зм), расходники — вдвое дешевле
const RAR_PRICE = [100, 400, 4000, 40000, 200000];
const magicPrice = (it) => { const p = RAR_PRICE[it.r] || 400; return it.n === 'Зелье лечения' ? 50 : /Свиток|Зелье/.test(it.n) ? p / 2 : p; };
function shopStock(kind, big) {
  const items = [], add = (L, price) => { if (L && price > 0 && !items.some((x) => x.n === L.n)) items.push({ ...L, price }); };
  if (kind === 'general') pickN(GEAR.filter((g) => costGp(g.cost) > 0 && costGp(g.cost) <= 60), big ? 16 : 10).forEach((g) => add({ kind: 'item', n: g.n, qty: 1 }, costGp(g.cost)));
  if (kind === 'smith') {
    pickN(WEAPONS, big ? 12 : 7).forEach((w) => add({ kind: 'item', n: w.n, qty: 1 }, costGp(w.cost)));
    pickN(ARMOR, big ? 6 : 3).forEach((a) => add({ kind: 'item', n: a.n, qty: 1 }, costGp(a.cost)));
    if (big && chance(0.6)) { const it = magicItem(MI().find((m) => m.n === 'Оружие +1')), base = WEAPONS.find((w) => w.n === it.base); add(it, 400 + costGp(base && base.cost)); }
  }
  if (kind === 'alchemist') {
    ['Зелье лечения', 'Зелье лазания'].forEach((n) => { const M = MI().find((m) => m.n === n); if (M) { const it = magicItem(M); add(it, magicPrice(it)); } });
    const anti = GEAR.find((g) => g.n === 'Противоядие'); if (anti) add({ kind: 'item', n: anti.n, qty: 1 }, costGp(anti.cost));
    pickN(MI().filter((m) => /^Зелье/.test(m.n) && m.r === 1), big ? 3 : 1).forEach((M) => { const it = magicItem(M); add(it, magicPrice(it)); });
    pickN(SPELLS.filter((s) => +s.l <= (big ? 2 : 1)), big ? 5 : 3).forEach((s) => { const it = scrollItem(s); add(it, magicPrice(it)); });
  }
  return items;
}
// Игрок у торговца: список товаров с ценами, покупка за деньги из листа
function shopDialog(id, sell = false) {
  const t = game.tokens[id], S = t && t.shop;
  if (!S) return;
  const dm = isDM(), m = me(), purse = !dm && m && m.charId ? app.purse(m.charId) : null, mine = user && game.tokens[`pc_${user.uid}`];
  const near = dm || (mine && distFt(mine, t) <= 5 + FT());
  const inv = !dm && m && m.charId ? app.inventory(m.charId) : null;
  sell = sell && !!inv;
  const sellList = sell ? inv.items.map((i) => ({ ...i, p: sellPrice(i) })) : [];
  app.openModal(`<div><h2>🛒 ${esc(t.name)}</h2>
    ${inv ? `<div class="seg mt"><button class="${sell ? '' : 'on'}" id="shBuy">Купить</button><button class="${sell ? 'on' : ''}" id="shSell">Продать</button></div>` : ''}
    <p class="muted small">${SHOP_N[S.kind] || 'товары'}${purse != null ? ` · у вас ${fmtPrice(purse)}` : ''}${!near ? ` · <b>подойдите ближе (через клетку или вплотную), чтобы ${sell ? 'продать' : 'купить'}</b>` : ''}</p>
    ${sell ? `<p class="muted small">Торговец платит половину цены; драгоценности и предметы искусства — полную стоимость. Надетый доспех сначала снимите.</p>
    <div class="list">${sellList.map((i) => `<div class="enc-row"><span><b>${esc(i.n)}</b>${i.qty > 1 ? ` <span class="muted small">×${i.qty}</span>` : ''}${wornArmor(i) ? ' <span class="muted small">надет</span>' : ''}</span>
      <span class="row gap">${i.p > 0 ? `<b>${fmtPrice(i.p)}</b><button data-sell="${i.id}" ${near && !wornArmor(i) ? '' : 'disabled'}>Продать</button>` : '<span class="muted small">не купит</span>'}</span></div>`).join('') || '<p class="muted">Продавать нечего.</p>'}</div>`
    : `<div class="list">${(S.items || []).map((it, i) => `<div class="enc-row"><span><b>${esc(it.n)}</b>${it.r >= 1 ? ` <span class="muted small">${RAR_N[it.r]}</span>` : ''}</span>
      <span class="row gap"><b>${fmtPrice(it.price)}</b>${dm ? '' : `<button data-buy="${i}" ${near && purse >= it.price ? '' : 'disabled'}>Купить</button>`}</span></div>`).join('') || '<p class="muted">Прилавок пуст.</p>'}</div>`}
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button></div></div>`);
  if ($('#shBuy')) { $('#shBuy').onclick = () => shopDialog(id, false); $('#shSell').onclick = () => shopDialog(id, true); }
  $$('[data-sell]').forEach((b) => b.addEventListener('click', () => {
    const i = sellList.find((x) => x.id === b.dataset.sell);
    if (!i || !app.takeItems(m.charId, [{ id: i.id, qty: 1 }], 0)) { app.toast('Этого предмета уже нет'); return; }
    app.giveItems(m.charId, [], i.p);
    addLog({ kind: 'act', who: mine ? mine.name : myName(), txt: `💰 продаёт «${i.n}» ${t.name} за ${fmtPrice(i.p)}` });
    app.toast(`💰 «${esc(i.n)}» продан за ${fmtPrice(i.p)}`, 'crit');
    shopDialog(id, true);
  }));
  $$('[data-buy]').forEach((b) => b.addEventListener('click', () => {
    const { price, ...L } = S.items[+b.dataset.buy];
    const r = app.mute(() => app.buy(m.charId, L, price));
    if (!r || !r.ok) { app.toast('Не хватает денег'); return; }
    addLog({ kind: 'act', who: mine ? mine.name : myName(), txt: `🛒 покупает «${r.name}» у ${t.name} за ${fmtPrice(price)}` });
    app.toast(`🛒 «${esc(r.name)}» — в инвентаре · осталось ${fmtPrice(r.left)}`, 'crit');
    shopDialog(id);
  }));
}
// Заселить текущее поле (созданное генератором или нарисованное вручную)
function popDialog() {
  const G = (game.meta || {}).gen || null, players = Object.values(game.members || {}).filter((m) => m.role !== 'dm').length || 4;
  const tpls = Object.entries(MAPGEN.TEMPLATES);
  app.openModal(`<div><h2>👥 Заселить поле</h2>
    <div class="form-grid"><label style="grid-column:1/-1">Местность<select id="pT">${tpls.map(([k, t]) => `<option value="${k}" ${G && G.tpl === k ? 'selected' : ''}>${t.n}</option>`).join('')}</select></label>
      ${popOptsHtml(players, G ? !!(MAPGEN.TEMPLATES[G.tpl] || {}).peaceful : false)}</div>
    <p class="muted small">${G ? 'Поле создано генератором: существа встанут по комнатам, босс — в дальнем зале.' : 'Поле нарисовано вручную: существа встанут группами в стороне от персонажей.'} В журнал (видит только мастер) — что получилось.</p>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="pOk">👥 Заселить</button></div></div>`);
  $('#pT').onchange = () => { $('#popPeace').checked = !!(MAPGEN.TEMPLATES[$('#pT').value] || {}).peaceful; };
  $('#pOk').onclick = () => {
    const pcs = Object.values(game.tokens).filter((t) => t.kind === 'pc');
    const start = G && G.start ? G.start : pcs.length ? { x: Math.round(pcs.reduce((s, t) => s + t.x, 0) / pcs.length), y: Math.round(pcs.reduce((s, t) => s + t.y, 0) / pcs.length) } : { x: 1, y: 1 };
    const L = { w: W(), h: H(), cells: game.map || {}, doors: game.doors || {}, rooms: G && G.tpl === $('#pT').value ? G.rooms || [] : [], start, tpl: $('#pT').value };
    const P = populate(L, { ...popOptsRead(), keep: Object.values(game.tokens).flatMap((t) => { const s = t.size || 1, out = []; for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) out.push([t.x + dx, t.y + dy]); return out; }) });
    app.closeModal();
    popApply(P);
  };
}
const popOptsHtml = (players, peaceful) => `<label>Уровень группы<input type="number" id="popLvl" min="1" max="20" value="${partyLevel()}"></label>
  <label>Персонажей<input type="number" id="popN" min="1" max="10" value="${players}"></label>
  <label>Сложность стычек<select id="popDiff">${DIFF_N.map((n, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
  <label>Стычек<input type="number" id="popGr" min="0" max="10" placeholder="авто"></label>
  <label class="check"><input type="checkbox" id="popPeace" ${peaceful ? 'checked' : ''}> Мирная: NPC вместо врагов</label>
  <label class="check"><input type="checkbox" id="popHid"> Скрыть врагов от игроков</label>`;
const popOptsRead = () => ({ lvl: Math.max(1, Math.min(20, +$('#popLvl').value || 1)), n: Math.max(1, +$('#popN').value || 4), diff: +$('#popDiff').value || 0,
  groups: Math.max(0, +$('#popGr').value || 0), peaceful: $('#popPeace').checked, hidden: $('#popHid').checked });
function popApply(P) {
  const ids = Object.keys(P.tokens);
  if (!ids.length) { app.toast('Не нашлось подходящих существ или места'); return; }
  R.update(ref(gpath()), Object.fromEntries(ids.map((id) => [`tokens/${id}`, P.tokens[id]]))).catch((err) => app.toast(`Не удалось: ${esc(err.code || err.message)}`));
  addLog({ kind: 'sys', dmOnly: true, txt: `👥 Заселено (${ids.length}): ${P.notes.join('; ')}` });
  app.toast(`👥 Поставлено: ${ids.length}`, 'crit');
}

/* ---------- Вещи игроков: передача, обмен, продажа, «на землю» ---------- */
// games/{id}/trades/{k}: { a, b — uid сторон, gift — подарок (ответ нужен только от b), t, state: open | declined | failed,
//   offer: { uid: { items: [{ id, n, qty }], gp } }, ok: { uid: true } — согласие (сбрасывается при любой правке),
//   sent / got / recv — исполнение: каждая сторона сама забирает своё из листа (sent) и кладёт снимки другой стороне (got/{uid});
//   получатель кладёт их в свой лист (recv) }. games/{id}/drops/{k}: { x, y, items: снимки, gp, by } — вещи на земле
const myChar = () => { const m = me(); return m && m.charId ? m.charId : null; };
const pnameU = (uid) => ((game.members[uid] || {}).char || {}).name || (game.members[uid] || {}).name || 'Игрок';
const offerText = (O) => [...((O && O.items) || []).map((i) => `${i.n}${+i.qty > 1 ? ` ×${i.qty}` : ''}`), ...(O && +O.gp ? [`${fmtPrice(+O.gp)}`] : [])].join(', ') || 'ничего';
const wornArmor = (i) => i.eq && /Доспех/.test(i.cat || '');
const itemsFor = (L) => (L.items || []).map((i) => ({ id: i.id, qty: +i.qty || 1 }));
// Окно «Вещи»: инвентарь из листа — передать игроку, бросить на землю; деньги; обмен
function itemsDialog() {
  const cid = myChar(), inv = cid && app.inventory(cid);
  if (!inv) { app.toast('Персонаж не найден на этом устройстве'); return; }
  const others = Object.entries(game.members || {}).filter(([uid, m]) => uid !== user.uid && m.role !== 'dm');
  const who = `<option value="">— кому —</option>${others.map(([uid]) => `<option value="${uid}">${esc(pnameU(uid))}</option>`).join('')}`;
  app.openModal(`<div><h2>🎒 Вещи</h2>
    <p class="muted small">Деньги: ${fmtPrice(inv.gp)}. Передать можно другому игроку (он должен принять) или бросить на землю — подберёт любой, кто окажется рядом.</p>
    ${others.length ? `<div class="enc-row"><span>🔁 Обмен с <select id="iwTradeWho" style="width:auto">${who}</select></span><button class="primary" id="iwTrade">Начать обмен</button></div>` : ''}
    <div class="enc-row mt"><span>Деньги: <input type="number" id="iwGp" min="0" step="0.1" style="width:90px" placeholder="зм"></span>
      <span class="row gap">${others.length ? `<select id="iwGpWho" style="width:auto">${who}</select><button id="iwGpGive">🤝 Передать</button>` : ''}<button id="iwGpDrop">⬇ Бросить</button></span></div>
    ${nearDrops().map(([k, D]) => `<div class="enc-row mt"><span>🎒 Рядом на земле: ${esc(offerText(D))}</span><button class="primary" data-iwpick="${k}">Подобрать</button></div>`).join('')}
    <div class="list mt">${inv.items.map((i) => `<div class="enc-row"><span><b>${esc(i.n)}</b>${i.qty > 1 ? ` <span class="muted small">×${i.qty}</span>` : ''}${wornArmor(i) ? ' <span class="muted small">надет — сначала снимите</span>' : ''}</span>
      <span class="row gap">${wornArmor(i) ? '' : `${i.qty > 1 ? `<input type="number" min="1" max="${i.qty}" value="1" data-iwq="${i.id}" style="width:56px">` : ''}
        ${others.length ? `<select data-iww="${i.id}" style="width:auto">${who}</select><button data-iwgive="${i.id}">🤝</button>` : ''}<button data-iwdrop="${i.id}" title="Бросить на землю">⬇</button>`}</span></div>`).join('') || '<p class="muted">Инвентарь пуст.</p>'}</div>
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button></div></div>`);
  $$('[data-iwpick]').forEach((b) => b.addEventListener('click', () => pickDrop(b.dataset.iwpick)));
  const qtyOf = (iid) => { const q = $(`[data-iwq="${iid}"]`); return q ? Math.max(1, +q.value || 1) : 1; };
  const nameOf = (iid) => (inv.items.find((i) => i.id === iid) || {}).n || '';
  $$('[data-iwgive]').forEach((b) => b.addEventListener('click', () => {
    const iid = b.dataset.iwgive, to = $(`[data-iww="${iid}"]`).value;
    if (!to) { app.toast('Выберите, кому передать'); return; }
    giftOffer(to, { items: [{ id: iid, n: nameOf(iid), qty: qtyOf(iid) }], gp: 0 });
  }));
  $$('[data-iwdrop]').forEach((b) => b.addEventListener('click', () => dropItems({ items: [{ id: b.dataset.iwdrop, n: nameOf(b.dataset.iwdrop), qty: qtyOf(b.dataset.iwdrop) }], gp: 0 })));
  if ($('#iwGpGive')) $('#iwGpGive').onclick = () => { const g = +$('#iwGp').value || 0, to = $('#iwGpWho').value; if (!g || !to) { app.toast('Укажите сумму и кому'); return; } giftOffer(to, { items: [], gp: g }); };
  $('#iwGpDrop').onclick = () => { const g = +$('#iwGp').value || 0; if (!g) { app.toast('Укажите сумму'); return; } dropItems({ items: [], gp: g }); };
  if ($('#iwTrade')) $('#iwTrade').onclick = async () => {
    const to = $('#iwTradeWho').value;
    if (!to) { app.toast('Выберите, с кем меняться'); return; }
    const k = R.push(ref(gpath('trades'))).key, T = { a: user.uid, b: to, t: Date.now(), state: 'open' };
    await R.set(ref(gpath(`trades/${k}`)), T);
    game.trades = { ...(game.trades || {}), [k]: T }; // окно — сразу, не дожидаясь подписки
    tradeDialog(k);
  };
}
// Подарок: предложение с согласием дарителя; получатель видит «Принять / Отказаться»
async function giftOffer(to, O) {
  const cid = myChar(), inv = app.inventory(cid);
  if (+O.gp > inv.gp + 1e-9) { app.toast('Столько денег нет'); return; }
  const k = R.push(ref(gpath('trades'))).key;
  await R.set(ref(gpath(`trades/${k}`)), { a: user.uid, b: to, gift: true, t: Date.now(), state: 'open', offer: { [user.uid]: O }, ok: { [user.uid]: true } });
  app.closeModal();
  app.toast(`🤝 ${esc(pnameU(to))} получит предложение: ${esc(offerText(O))}`);
}
// Бросить на землю: вещи уходят из листа и лежат на клетке рядом с персонажем
async function dropItems(O) {
  const cid = myChar(), mine = game.tokens[`pc_${user.uid}`];
  if (!mine) { app.toast('Сначала поставьте персонажа на поле'); return; }
  const snaps = app.takeItems(cid, itemsFor(O), +O.gp || 0);
  if (!snaps) { app.toast('Этих вещей уже нет'); return; }
  await R.set(ref(gpath(`drops/${R.push(ref(gpath('drops'))).key}`)), { x: mine.x, y: mine.y, items: snaps, gp: +O.gp || 0, by: user.uid, t: Date.now() });
  addLog({ kind: 'act', who: mine.name, txt: `⬇ бросает на землю: ${offerText({ items: snaps, gp: O.gp })}` });
  app.closeModal();
}
const dropAt = (x, y) => Object.entries(game.drops || {}).find(([, d]) => d.x === x && d.y === y);
const nearDrops = () => { const mine = user && game.tokens[`pc_${user.uid}`]; return mine ? Object.entries(game.drops || {}).filter(([, D]) => distFt(mine, { x: D.x, y: D.y, size: 1 }) <= 5) : []; };
async function pickDrop(k) {
  const cur = (game.drops || {})[k], mine = game.tokens[`pc_${user.uid}`];
  if (!cur) { app.closeModal(); app.toast('Кто-то уже подобрал'); return; }
  await R.remove(ref(gpath(`drops/${k}`)));
  app.giveItems(myChar(), cur.items || [], +cur.gp || 0);
  addLog({ kind: 'act', who: mine ? mine.name : pnameU(user.uid), txt: `🎒 подбирает: ${offerText(cur)}` });
  app.closeModal();
  app.toast(`🎒 Подобрано: ${esc(offerText(cur))}`, 'crit');
}
// Подобрать: игрок рядом забирает всё в лист; мастер может убрать вещи или переложить их в добычу
function dropDialog(k) {
  const D = (game.drops || {})[k], mine = user && game.tokens[`pc_${user.uid}`];
  if (!D) return;
  const near = mine && distFt(mine, { x: D.x, y: D.y, size: 1 }) <= 5;
  app.openModal(`<div><h2>🎒 На земле</h2><p>${esc(offerText(D))}</p>${!isDM() && !near ? '<p class="muted small">Подойдите вплотную, чтобы подобрать.</p>' : ''}
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button>${isDM() ? '<button id="dpLoot">💰 В добычу</button><button class="danger" id="dpDel">Убрать</button>' : ''}
      ${!isDM() ? `<button class="primary" id="dpTake" ${near ? '' : 'disabled'}>Подобрать всё</button>` : ''}</div></div>`);
  if ($('#dpTake')) $('#dpTake').onclick = () => pickDrop(k);
  if ($('#dpDel')) $('#dpDel').onclick = async () => { await R.remove(ref(gpath(`drops/${k}`))); app.closeModal(); };
  if ($('#dpLoot')) $('#dpLoot').onclick = async () => {
    const upd = { [`drops/${k}`]: null, 'loot/gp': (+(game.loot || {}).gp || 0) + (+D.gp || 0) };
    // snap — предмет целиком (магическое оружие с атакой), чтобы из добычи он вернулся в лист таким же
    (D.items || []).forEach((S) => { const { atk, eq, ...it } = S; upd[`loot/items/${R.push(ref(gpath('loot'))).key}`] = { ...it, kind: 'item', snap: S }; });
    await R.update(ref(gpath()), upd); app.closeModal(); app.toast('💰 Переложено в добычу');
  };
}
// Окно обмена: свои предложения слева, чужие справа; любая правка сбрасывает согласия обоих
let tradeOpen = null;
function tradeDialog(k) {
  const T = (game.trades || {})[k];
  if (!T) { if (tradeOpen === k) { tradeOpen = null; app.closeModal(); } return; }
  const meU = user.uid, other = T.a === meU ? T.b : T.a, mine = (T.offer || {})[meU] || { items: [], gp: 0 }, theirs = (T.offer || {})[other] || { items: [], gp: 0 };
  const ok = T.ok || {}, inv = app.inventory(myChar()) || { items: [], gp: 0 };
  tradeOpen = k;
  app.openModal(`<div><h2>🔁 Обмен с ${esc(pnameU(other))}</h2>
    <div class="trade-grid"><div class="loot-box"><b>Вы отдаёте</b>${ok[meU] ? ' <span class="tag g">согласны</span>' : ''}
      <div class="list mt">${(mine.items || []).map((i, n) => `<div class="enc-row"><span>${esc(i.n)}${+i.qty > 1 ? ` ×${i.qty}` : ''}</span><button class="ghost" data-tdel="${n}">✕</button></div>`).join('') || '<p class="muted small">Ничего</p>'}</div>
      <div class="row gap mt"><select id="tdItem" style="flex:1"><option value="">＋ предмет…</option>${inv.items.filter((i) => !wornArmor(i)).map((i) => `<option value="${i.id}">${esc(i.n)}${i.qty > 1 ? ` (${i.qty})` : ''}</option>`).join('')}</select>
        <input type="number" id="tdQty" min="1" value="1" style="width:56px"></div>
      <label class="mt">Деньги, зм<input type="number" id="tdGp" min="0" step="0.1" value="${+mine.gp || 0}"></label></div>
      <div class="loot-box"><b>Вы получаете</b>${ok[other] ? ' <span class="tag g">согласен</span>' : ''}
      <div class="list mt">${(theirs.items || []).map((i) => `<div class="enc-row"><span>${esc(i.n)}${+i.qty > 1 ? ` ×${i.qty}` : ''}</span></div>`).join('') || '<p class="muted small">Ничего</p>'}</div>
      ${+theirs.gp ? `<p class="mt">Деньги: ${fmtPrice(+theirs.gp)}</p>` : ''}</div></div>
    <p class="muted small">Сделка пройдёт, когда согласятся оба. Любая правка снимает согласие — посмотрите ещё раз.</p>
    <div class="modal-actions"><button class="danger" id="tdCancel">Отменить сделку</button><button data-act="closeModal">Свернуть</button>
      <button class="primary" id="tdOk">${ok[meU] ? '✓ Вы согласны' : '✓ Согласен'}</button></div></div>`);
  const setOffer = (O) => R.update(ref(gpath(`trades/${k}`)), { [`offer/${meU}`]: O, ok: null }).catch(() => {});
  $$('[data-tdel]').forEach((b) => b.addEventListener('click', () => { const items = (mine.items || []).filter((_, n) => n !== +b.dataset.tdel); setOffer({ ...mine, items }); }));
  $('#tdItem').onchange = () => {
    const iid = $('#tdItem').value, it = inv.items.find((i) => i.id === iid);
    if (!it) return;
    const have = (mine.items || []).filter((i) => i.id === iid).reduce((s, i) => s + (+i.qty || 1), 0), q = Math.min(it.qty - have, Math.max(1, +$('#tdQty').value || 1));
    if (q <= 0) { app.toast('Больше нет'); return; }
    setOffer({ ...mine, items: [...(mine.items || []), { id: iid, n: it.n, qty: q }] });
  };
  $('#tdGp').onchange = () => { const g = Math.max(0, Math.min(inv.gp, +$('#tdGp').value || 0)); setOffer({ ...mine, gp: g }); };
  $('#tdOk').onclick = () => {
    // Перед согласием — всё ли предложенное ещё есть в листе
    const lack = (mine.items || []).find((i) => !inv.items.some((x) => x.id === i.id && x.qty >= (+i.qty || 1)));
    if (lack || +mine.gp > inv.gp + 1e-9) { app.toast(lack ? `«${esc(lack.n)}» больше нет в инвентаре` : 'Столько денег нет'); return; }
    R.update(ref(gpath(`trades/${k}/ok`)), { [meU]: true }).catch(() => {});
  };
  $('#tdCancel').onclick = () => { R.update(ref(gpath(`trades/${k}`)), { state: 'declined', by: meU }).catch(() => {}); tradeOpen = null; app.closeModal(); };
}
// Исполнение сделок в браузере каждой стороны: отдать своё, принять чужое; инициатор убирает завершённую сделку
const tradeBusy = new Set(), tradeSeen = new Set();
function syncTrades() {
  if (!game || !user) return;
  const meU = user.uid, cid = myChar();
  Object.entries(game.trades || {}).forEach(([k, T]) => {
    if (T.a !== meU && T.b !== meU) return;
    const other = T.a === meU ? T.b : T.a, ok = T.ok || {};
    // Новое предложение — уведомление получателю
    if (T.b === meU && T.state === 'open' && !tradeSeen.has(k)) { tradeSeen.add(k); app.toast(T.gift ? `🎁 ${esc(pnameU(T.a))} передаёт вам: ${esc(offerText((T.offer || {})[T.a]))}` : `🔁 ${esc(pnameU(T.a))} предлагает обмен`, 'crit'); mtab('turn', true); }
    if (T.state === 'declined' || T.state === 'failed') {
      if (T.a === meU && !tradeBusy.has(k)) { tradeBusy.add(k); app.toast(T.state === 'failed' ? '🤝 Сделка не состоялась: у кого-то не оказалось вещей' : `🤝 ${esc(pnameU(T.by === meU ? other : T.by))} отказался`); R.remove(ref(gpath(`trades/${k}`))).catch(() => {}); }
      if (tradeOpen === k) { tradeOpen = null; app.closeModal(); }
      return;
    }
    if (!cid) return;
    const key = `${k}:${meU}`;
    if (ok[T.a] && ok[T.b] && !(T.sent || {})[meU] && !tradeBusy.has(`${key}:s`)) {
      tradeBusy.add(`${key}:s`);
      const O = (T.offer || {})[meU] || { items: [], gp: 0 }, snaps = app.takeItems(cid, itemsFor(O), +O.gp || 0);
      if (!snaps) { R.update(ref(gpath(`trades/${k}`)), { state: 'failed' }).catch(() => {}); return; }
      R.update(ref(gpath(`trades/${k}`)), { [`sent/${meU}`]: true, [`got/${other}`]: { items: snaps, gp: +O.gp || 0 } }).catch(() => {});
    }
    const G = (T.got || {})[meU];
    if (G && !(T.recv || {})[meU] && !tradeBusy.has(`${key}:r`)) {
      tradeBusy.add(`${key}:r`);
      app.giveItems(cid, G.items || [], +G.gp || 0);
      R.update(ref(gpath(`trades/${k}`)), { [`recv/${meU}`]: true }).catch(() => {});
      if (tradeOpen === k) { tradeOpen = null; app.closeModal(); }
      if ((G.items || []).length || +G.gp) app.toast(`🤝 Получено: ${esc(offerText(G))} — уже в листе`, 'crit');
      else app.toast(`🤝 ${esc(pnameU(other))} принял передачу`);
    }
    const recv = T.recv || {};
    if (T.a === meU && recv[T.a] && recv[T.b] && !tradeBusy.has(`${k}:done`)) {
      tradeBusy.add(`${k}:done`);
      R.remove(ref(gpath(`trades/${k}`))).catch(() => {});
      const oa = (T.offer || {})[T.a], ob = (T.offer || {})[T.b];
      addLog({ kind: 'act', who: pnameU(T.a), txt: T.gift ? `🤝 передаёт ${pnameU(T.b)}: ${offerText(oa)}` : `🔁 обмен с ${pnameU(T.b)}: отдаёт ${offerText(oa)}, получает ${offerText(ob)}` });
    }
    if (tradeOpen === k && $('#modal') && !$('#modal').hidden) tradeDialog(k);
  });
  if (tradeOpen && !(game.trades || {})[tradeOpen]) { tradeOpen = null; }
}
// Запросы в панели: подарок — принять/отказаться, обмен — открыть; у инициатора — ожидание
function tradeRows() {
  if (!game || !user) return [];
  return Object.entries(game.trades || {}).filter(([, T]) => (T.a === user.uid || T.b === user.uid) && T.state === 'open').map(([k, T]) => {
    const other = T.a === user.uid ? T.b : T.a;
    if (T.gift && T.b === user.uid && !(T.ok || {})[user.uid]) return `<div class="sv-area"><div>🎁 <b>${esc(pnameU(T.a))}</b> передаёт вам: ${esc(offerText((T.offer || {})[T.a]))}</div>
      <div class="row gap mt"><button class="primary" data-tbl="trAccept" data-k="${k}">Принять</button><button data-tbl="trDecline" data-k="${k}">Отказаться</button></div></div>`;
    if (T.gift) return `<div class="sv-area"><div class="muted small">⏳ Ждём, пока ${esc(pnameU(other))} примет: ${esc(offerText((T.offer || {})[T.a]))}</div><button class="ghost" data-tbl="trDecline" data-k="${k}">Отменить</button></div>`;
    return `<div class="sv-area"><div>🔁 Обмен с <b>${esc(pnameU(other))}</b>${(T.ok || {})[other] ? ' — он согласен' : ''}</div><div class="row gap mt"><button class="primary" data-tbl="trOpen" data-k="${k}">Открыть</button></div></div>`;
  });
}
// Продажа торговцу: за полцены (драгоценности и предметы искусства — по полной); без цены торговец не берёт
function sellPrice(i) {
  const RARE = typeof RARITY !== 'undefined' ? RARITY[i.cost] : undefined;
  if (RARE != null) { const p = RAR_PRICE[RARE] || 0; return Math.floor((/Расходник/.test(i.cat) || /^(Зелье|Свиток)/.test(i.n) ? p / 2 : p) / 2); }
  const v = costGp(i.cost) || costGp(([...WEAPONS, ...ARMOR, ...GEAR].find((x) => x.n === i.n) || {}).cost);
  return i.cat === 'Сокровище' ? v : Math.floor(v * 50) / 100;
}

/* ---------- Карта мира: места, вход в локации, путешествие ---------- */
const POI_IC = { city: '🏙', village: '🏡', castle: '🏰', tavern: '🍺', ruin: '🏚', cave: '🕳', camp: '⛺', tower: '🗼', temple: '⛪', crypt: '⚰', mine: '⛏', lair: '🐉' };
const POI_C = { city: '#f0c76a', village: '#e6d3a3', castle: '#d0d0e0', tavern: '#e0a050', ruin: '#b07a7a', cave: '#909090', camp: '#e05a3a', tower: '#a090e0', temple: '#f0f0f0', crypt: '#8a6a9a', mine: '#a08060', lair: '#e03030' };
const POI_N = { city: 'город', village: 'деревня', castle: 'замок', tavern: 'таверна', ruin: 'руины', cave: 'пещера', camp: 'лагерь', tower: 'башня', temple: 'храм', crypt: 'склеп', mine: 'шахта', lair: 'логово' };
const worldPois = () => Object.entries(((game && game.meta && game.meta.world) || {}).pois || {});
const poiAt = (x, y) => worldPois().find(([, p]) => p.x === x && p.y === y);
function drawPois(g) {
  worldPois().forEach(([, p]) => {
    const cx = p.x * CELL + CELL / 2, cy = p.y * CELL + CELL / 2;
    g.save();
    g.fillStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(cx, cy, CELL * 0.48, 0, Math.PI * 2); g.fill();
    g.strokeStyle = POI_C[p.k] || '#fff'; g.lineWidth = 2; g.stroke();
    g.font = `${Math.round(CELL * 0.6)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(POI_IC[p.k] || '📍', cx, cy + 1);
    g.font = '600 11px system-ui, sans-serif'; g.textBaseline = 'top'; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)';
    g.strokeText(p.n, cx, cy + CELL * 0.5); g.fillStyle = '#f3e3bf'; g.fillText(p.n, cx, cy + CELL * 0.5);
    g.restore();
  });
}
// Место на карте мира: мастер входит (локация создаётся из шаблона и запоминается), переименовывает; игрок видит название
function poiDialog(i) {
  const W_ = game.meta.world, P = W_ && W_.pois[i];
  if (!P) return;
  if (!isDM()) { app.toast(`${POI_IC[P.k] || '📍'} ${esc(P.n)}`); return; }
  const has = P.scene && (game.scenes || {})[P.scene];
  app.openModal(`<div><h2>${POI_IC[P.k] || '📍'} ${esc(P.n)}</h2>
    <p class="muted small">${POI_N[P.k] || 'место'} · шаблон «${esc(((MAPGEN.TEMPLATES[P.tpl] || {}).n || P.tpl).replace(/^\S+\s/, ''))}»${has ? ' · локация уже создана — войдёте туда же' : ' · при входе создастся локация (со своими существами), текущая карта мира сохранится'}</p>
    <label>Название<input id="poiN" value="${esc(P.n)}"></label>
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button><button id="poiSave">Сохранить название</button><button class="primary" id="poiGo">🚪 Войти</button></div></div>`);
  $('#poiSave').onclick = async () => { const n = $('#poiN').value.trim(); if (n) await R.update(ref(gpath(`meta/world/pois/${i}`)), { n }); app.closeModal(); };
  $('#poiGo').onclick = () => enterPoi(i, $('#poiN').value.trim() || P.n);
}
async function enterPoi(i, name) {
  const W_ = game.meta.world, P = W_.pois[i];
  if (name && name !== P.n) await R.update(ref(gpath(`meta/world/pois/${i}`)), { n: name });
  app.closeModal();
  if (P.scene && (game.scenes || {})[P.scene]) { await loadScene(P.scene); addLog({ kind: 'sys', txt: `🚪 Отряд входит: ${name || P.n}` }); return; }
  const T = MAPGEN.TEMPLATES[P.tpl] || MAPGEN.TEMPLATES.village;
  const wsid = await saveScene();
  const res = MAPGEN.generate(P.tpl, { seed: ((W_.seed || 1) + (+i + 1) * 7919) >>> 0, variant: P.v || '' });
  const players = Object.values(game.members || {}).filter((m) => m.role !== 'dm').length || 4;
  const sid = await genApply({ ...res, tpl: P.tpl }, { lvl: partyLevel(), amb: res.amb, fog: res.fog, asScene: true, name: name || P.n, clearNpc: true, peaceful: !!T.peaceful,
    pop: { lvl: partyLevel(), n: players, diff: 1, groups: 0, peaceful: !!T.peaceful, hidden: false }, worldFrom: { sid: wsid, poi: +i } });
  if (sid) await R.update(ref(gpath()), { [`sceneData/${wsid}/world/pois/${i}/scene`]: sid });
}
async function worldBack() {
  const F = game.meta && game.meta.worldFrom;
  if (!F || !(game.scenes || {})[F.sid]) { app.toast('Карта мира не найдена'); return; }
  await loadScene(F.sid);
  addLog({ kind: 'sys', txt: '🌍 Отряд возвращается на карту мира' });
}
// Путешествие (правила 2024): темп быстрый 4 мили/ч (−5 к Внимательности), обычный 3, медленный 2 (можно красться).
// games/{id}/travel: { miles — пройдено отрядом (по самому далеко ушедшему), tok: { id: мили }, pace, extra — часы привалов, checks — проверок встреч }
const PACE = { fast: [4, 'быстрый — 4 мили/ч, −5 к пассивной Внимательности'], normal: [3, 'обычный — 3 мили/ч'], slow: [2, 'медленный — 2 мили/ч, можно идти скрытно'] };
const TRAVEL_START = 8; // выход в 8 утра первого дня
const travelHours = (T) => (+T.miles || 0) / (PACE[T.pace] || PACE.normal)[0] + (+T.extra || 0);
function travelClock(T) { const h = TRAVEL_START + travelHours(T), day = 1 + Math.floor(h / 24), hh = h % 24; return `день ${day}, ${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.round((hh % 1) * 60) % 60).padStart(2, '0')}`; }
// Шаг персонажа по карте мира — мили в его счётчик; общий путь отряда — по самому далеко ушедшему
function travelStep(id, cells) {
  if (!game.meta || !game.meta.world || !cells) return;
  const t = game.tokens[id];
  if (!t || t.kind !== 'pc' || t.comp) return;
  const T = game.travel || {}, mine = (+((T.tok || {})[id]) || 0) + (cells * FT()) / 5280;
  const miles = Math.max(+T.miles || 0, mine);
  game.travel = { ...T, tok: { ...(T.tok || {}), [id]: mine }, miles };
  R.update(ref(gpath('travel')), { [`tok/${id}`]: +mine.toFixed(2), miles: +miles.toFixed(2) }).catch(() => {});
}
// Мастер: каждые 4 часа пути — проверка случайной встречи (к20, 18+); встреча — бой на местности под ногами отряда
const BIOME_TPL = { thicket: 'forest', tree: 'forest', bush: 'plains', '': 'plains', road: 'plains', bridge: 'river', sand: 'desert', slope: 'mountains', rock: 'mountains', snow: 'mountains', bog: 'swamp', water: 'coast', ice: 'mountains' };
function partyCell() {
  const pcs = Object.values(game.tokens).filter((t) => t.kind === 'pc' && !t.comp);
  if (!pcs.length) return null;
  const x = Math.round(pcs.reduce((s, t) => s + t.x, 0) / pcs.length), y = Math.round(pcs.reduce((s, t) => s + t.y, 0) / pcs.length);
  return { x, y, v: (game.map || {})[`${x}_${y}`] || '' };
}
let travelAsked = 0;
function syncTravel() {
  if (!isDM() || !game.meta || !game.meta.world) return;
  const T = game.travel || {}, due = Math.floor(travelHours(T) / 4);
  if (due <= (+T.checks || 0) || travelAsked === due) return;
  travelAsked = due;
  const roll = die(20), hit = roll >= 18;
  R.update(ref(gpath('travel')), { checks: due }).catch(() => {});
  addLog({ kind: 'sys', txt: `🧭 ${travelClock(T)} · пройдено ${(+T.miles || 0).toFixed(1)} мили` });
  addLog({ kind: 'sys', dmOnly: true, txt: `🎲 Проверка встречи: к20 = ${roll}${hit ? ' — встреча!' : ''}` });
  if (hit) encounterDialog();
}
function encounterDialog() {
  const pc = partyCell(), tpl = BIOME_TPL[pc ? pc.v : ''] || 'plains';
  app.openModal(`<div><h2>⚔ Случайная встреча</h2><p>Местность под отрядом: <b>${esc(((MAPGEN.TEMPLATES[tpl] || {}).n || tpl))}</b>. Противники — по уровню группы и местности.</p>
    <div class="form-grid"><label>Сложность<select id="encD">${DIFF_N.map((n, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="encPeace"> Мирная встреча (путники, торговец)</label></div>
    <div class="modal-actions"><button data-act="closeModal">Пропустить</button><button class="primary" id="encGo">⚔ Бой здесь — новая сцена</button></div></div>`);
  $('#encGo').onclick = async () => {
    const wsid = await saveScene(), peaceful = $('#encPeace').checked, diff = +$('#encD').value || 0;
    const res = MAPGEN.generate(tpl, { seed: Math.floor(Math.random() * 1e9), variant: 'none' });
    const players = Object.values(game.members || {}).filter((m) => m.role !== 'dm').length || 4;
    await genApply({ ...res, tpl }, { lvl: partyLevel(), amb: (game.meta.fog || {}).amb || 'bright', fog: 'off', asScene: true, name: `Встреча в пути`, clearNpc: true, peaceful,
      pop: { lvl: partyLevel(), n: players, diff, groups: 1, peaceful, hidden: false }, worldFrom: { sid: wsid } });
  };
}
function travelDialog() {
  const T = game.travel || {}, dm = isDM();
  app.openModal(`<div><h2>🧭 Путешествие</h2>
    <p><b>${travelClock(T)}</b> · пройдено <b>${(+T.miles || 0).toFixed(1)}</b> мили · в пути ${travelHours(T).toFixed(1)} ч</p>
    ${dm ? `<label>Темп<select id="trPace">${Object.entries(PACE).map(([k, [, n]]) => `<option value="${k}" ${(T.pace || 'normal') === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="row gap wrap mt"><button data-tr="1">⏱ +1 час</button><button data-tr="night">🏕 Ночлег до утра</button><button data-tr="enc">🎲 Проверить встречу</button><button data-tr="reset">↺ Сбросить счёт</button></div>
    <p class="muted small">Время идёт само, когда отряд двигается по карте мира (по самому далеко ушедшему персонажу). Каждые 4 часа пути — проверка встречи (к20, 18+). Длинный отдых — «🏕 Отдых» в меню «Игра».</p>
    <h3 class="mt">Места</h3><div class="list">${worldPois().map(([i, p]) => `<div class="enc-row"><span>${POI_IC[p.k] || '📍'} ${esc(p.n)} <span class="muted small">${POI_N[p.k] || ''}${p.scene ? ' · была' : ''}</span></span><button data-poi="${i}">🚪 Войти</button></div>`).join('')}</div>`
    : `<p class="muted small">Темп: ${(PACE[T.pace] || PACE.normal)[1]}.</p>`}
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button></div></div>`);
  if (!dm) return;
  $('#trPace').onchange = () => R.update(ref(gpath('travel')), { pace: $('#trPace').value }).then(travelDialog);
  $$('[data-tr]').forEach((b) => b.addEventListener('click', async () => {
    const k = b.dataset.tr, h = TRAVEL_START + travelHours(T);
    if (k === '1') await R.update(ref(gpath('travel')), { extra: (+T.extra || 0) + 1 });
    if (k === 'night') { const next = (Math.floor(h / 24) + 1) * 24 + TRAVEL_START; await R.update(ref(gpath('travel')), { extra: (+T.extra || 0) + (next - h) }); addLog({ kind: 'sys', txt: '🏕 Ночлег до утра' }); }
    if (k === 'enc') { app.closeModal(); const r = die(20); addLog({ kind: 'sys', dmOnly: true, txt: `🎲 Проверка встречи: к20 = ${r}${r >= 18 ? ' — встреча!' : ''}` }); if (r >= 18) encounterDialog(); else app.toast(`🎲 ${r} — без встреч`); return; }
    if (k === 'reset' && app.confirm('Сбросить пройденный путь и время?')) await R.set(ref(gpath('travel')), { miles: 0, pace: T.pace || 'normal', extra: 0, checks: 0 });
    travelDialog();
  }));
  $$('[data-poi]').forEach((b) => b.addEventListener('click', () => poiDialog(b.dataset.poi)));
}

/* ---------- Масштаб и размер поля ---------- */
const SCALES = [[5, '5 фт — бой, комнаты'], [10, '10 фт — большие залы'], [30, '30 фт — поселение, крепость'], [100, '100 фт — округа'], [5280, '1 миля — путешествие']];
// Границы нарисованного и поставленного: местность, двери, сундуки, свет, вещи, существа
function drawnBounds() {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, s = 1) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + s - 1); y1 = Math.max(y1, y + s - 1); };
  [game.map, game.doors].forEach((M) => Object.keys(M || {}).forEach((k) => { const [x, y] = k.split('_').map(Number); add(x, y); }));
  [game.chests, game.lights, game.drops].forEach((M) => Object.values(M || {}).forEach((o) => add(o.x, o.y)));
  Object.values(game.tokens || {}).forEach((t) => add(t.x, t.y, t.size || 1));
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
function scaleDialog() {
  const ft = FT(), bg = bgSet();
  app.openModal(`<div><h2>📐 Масштаб и размер поля</h2>
    <h3>Масштаб</h3>
    <div class="form-grid"><label style="grid-column:1/-1">В одной клетке<select id="scFt">${SCALES.map(([v, n]) => `<option value="${v}" ${v === ft ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${bgSrc ? `<label class="check" style="grid-column:1/-1"><input type="checkbox" id="scBg" checked> Пересчитать карту-подложку под новый масштаб</label>` : ''}</div>
    <p class="muted small">Линейка, скорость, дальность, области заклинаний, свет и обзор считаются по новому масштабу. Нарисованное остаётся по клеткам. Соседние клетки — всегда «вплотную» (5 фт, ближний бой).</p>
    <h3 class="mt">Размер поля: <span id="scSize"></span></h3>
    <p class="muted small">Сколько рядов добавить (+) или убрать (−) с каждой стороны. Всё на поле сдвинется вместе с картой; то, что окажется за краем, пропадёт, существа встанут у края.</p>
    <div class="sc-grid"><span></span><label>Сверху<input type="number" id="scT" value="0"></label><span></span>
      <label>Слева<input type="number" id="scL" value="0"></label><span class="sc-mid">🗺</span><label>Справа<input type="number" id="scR" value="0"></label>
      <span></span><label>Снизу<input type="number" id="scB" value="0"></label><span></span></div>
    <div class="row gap wrap mt"><button id="scTrim" title="Убрать пустые края: оставить нарисованное и всё, что стоит на поле, плюс клетка запаса">✂ Обрезать по нарисованному</button><button id="scZero">Сбросить</button></div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="scOk">Применить</button></div></div>`);
  const val = () => ({ t: Math.round(+$('#scT').value || 0), l: Math.round(+$('#scL').value || 0), r: Math.round(+$('#scR').value || 0), b: Math.round(+$('#scB').value || 0) });
  const show = () => { const v = val(), nw = W() + v.l + v.r, nh = H() + v.t + v.b, bad = nw < 5 || nh < 5 || nw > 80 || nh > 80;
    $('#scSize').innerHTML = `${W()}×${H()}${nw !== W() || nh !== H() ? ` → <b class="${bad ? 'warn-text' : ''}">${nw}×${nh}</b>${bad ? ' (от 5 до 80)' : ''}` : ''}`; };
  ['#scT', '#scL', '#scR', '#scB'].forEach((s) => $(s).addEventListener('input', show));
  show();
  $('#scZero').onclick = () => { ['#scT', '#scL', '#scR', '#scB'].forEach((s) => { $(s).value = 0; }); show(); };
  $('#scTrim').onclick = () => {
    const B = drawnBounds();
    if (!B) { app.toast('Поле пустое — обрезать не по чему'); return; }
    let l = -Math.max(0, B.x0 - 1), t = -Math.max(0, B.y0 - 1), r = -Math.max(0, W() - 2 - B.x1), b = -Math.max(0, H() - 2 - B.y1);
    // Не меньше 5×5 — недостающее добираем справа и снизу
    if (W() + l + r < 5) r += 5 - (W() + l + r);
    if (H() + t + b < 5) b += 5 - (H() + t + b);
    $('#scT').value = t; $('#scL').value = l; $('#scR').value = r; $('#scB').value = b; show();
  };
  $('#scOk').onclick = async () => {
    const v = val(), nw = W() + v.l + v.r, nh = H() + v.t + v.b, nft = +$('#scFt').value || 5;
    if (nw < 5 || nh < 5 || nw > 80 || nh > 80) { app.toast('Поле — от 5 до 80 клеток в каждую сторону'); return; }
    const dx = v.l, dy = v.t, inB = (x, y) => x >= 0 && y >= 0 && x < nw && y < nh, upd = {};
    if (dx || dy || nw !== W() || nh !== H()) {
      const keys = (M) => { const out = {}; Object.entries(M || {}).forEach(([k, val2]) => { const [x, y] = k.split('_').map(Number); if (inB(x + dx, y + dy)) out[`${x + dx}_${y + dy}`] = val2; }); return Object.keys(out).length ? out : null; };
      const objs = (M) => { const out = {}; Object.entries(M || {}).forEach(([k, o]) => { if (inB(o.x + dx, o.y + dy)) out[k] = { ...o, x: o.x + dx, y: o.y + dy }; }); return Object.keys(out).length ? out : null; };
      Object.assign(upd, { map: keys(game.map), doors: keys(game.doors), reveal: keys(game.reveal), seen: keys(game.seen), lights: objs(game.lights), chests: objs(game.chests), drops: objs(game.drops), areas: null, 'meta/w': nw, 'meta/h': nh });
      Object.entries(game.tokens || {}).forEach(([id, t]) => { const s = t.size || 1;
        upd[`tokens/${id}/x`] = Math.max(0, Math.min(nw - s, t.x + dx)); upd[`tokens/${id}/y`] = Math.max(0, Math.min(nh - s, t.y + dy)); });
      const G = (game.meta || {}).gen;
      if (G) upd['meta/gen'] = { ...G, rooms: (G.rooms || []).map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })), start: G.start ? { x: Math.max(0, Math.min(nw - 1, G.start.x + dx)), y: Math.max(0, Math.min(nh - 1, G.start.y + dy)) } : null };
    }
    // Подложка: сдвиг вместе с полем; при новом масштабе — та же местность занимает меньше (или больше) клеток
    const k = $('#scBg') && $('#scBg').checked ? ft / nft : 1;
    if (bgSrc && (dx || dy || k !== 1)) upd['meta/bg'] = { ...bg, w: +((bg.w || W()) * k).toFixed(6), ox: +(bg.ox * k + dx * CELL).toFixed(3), oy: +(bg.oy * k + dy * CELL).toFixed(3) };
    if (nft !== ft) upd['meta/ft'] = nft === 5 ? null : nft;
    if (!Object.keys(upd).length) { app.closeModal(); return; }
    await R.update(ref(gpath()), upd);
    app.closeModal();
    if (nft !== ft) addLog({ kind: 'sys', txt: `📐 Масштаб поля: ${fmtFt(nft)} в клетке` });
    app.toast(`📐 Поле ${nw}×${nh}, клетка — ${fmtFt(nft)}`);
  };
}

/* ---------- Сцены ---------- */
// games/{id}/scenes/{sid}: { n, t } — список (его видят все); games/{id}/sceneData/{sid} — снимок поля: размер, карта, двери, свет,
// туман, картинка, существа мастера и места персонажей. Его читает только мастер при переключении. meta.scene — текущая сцена
function sceneSnap() {
  const npcs = {}, pcs = {}, m = game.meta || {};
  Object.entries(game.tokens || {}).forEach(([id, t]) => { if (t.kind === 'npc') npcs[id] = t; else pcs[id] = { x: t.x, y: t.y }; });
  return { w: W(), h: H(), ft: m.ft || null, world: m.world || null, worldFrom: m.worldFrom || null, bg: m.bg || null, fog: m.fog || null, ground: m.ground || null, gen: m.gen || null, map: game.map || null, doors: game.doors || null, lights: game.lights || null, chests: game.chests || null,
    reveal: game.reveal || null, seen: game.seen || null, drops: game.drops || null, bgimg: bgSrc ? { data: bgSrc } : null, npcs, pcs };
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
    chests: snap.chests || null, 'meta/ground': snap.ground || null, 'meta/gen': snap.gen || null, 'meta/ft': snap.ft || null, 'meta/world': snap.world || null, 'meta/worldFrom': snap.worldFrom || null, drops: snap.drops || null,
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
        const r = ((f.r || aLen(f)) * CELL) * grow * 0.55, gr = g.createRadialGradient(f.ox * CELL, f.oy * CELL, 0, f.ox * CELL, f.oy * CELL, Math.max(1, r));
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
  if (!inGame) { if (fullOn) { fullOn = false; document.body.classList.remove('tbl-full-on'); $('#tblGame').classList.remove('tbl-full'); } renderLobby(); return; }
  $('#tblName').textContent = game.meta.name;
  $('#tblCode').textContent = `Код: ${game.code}`;
  $('#tblLeave').textContent = isDM() ? '⏏ Выйти из игры' : 'Покинуть';
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
  camUpdate();
  renderTurn();
  renderInit();
  renderSide();
  renderMembers();
  renderLog();
  renderChatBar();
  renderSaves();
  renderCastBar();
  renderMtabs();
  renderHud();
}
/* ---------- Телефон: вкладки панели, масштаб пальцами ---------- */
const narrow = () => window.matchMedia('(max-width: 760px)').matches;
function mtab(name, auto) {
  const side = $('#tblSide');
  if (!side || (auto && !narrow()) || side.dataset.mt === name) return;
  side.dataset.mt = name;
  if (name === 'log') { logSeen = Date.now(); ls.set('dnd55-logseen', String(logSeen)); }
  renderMtabs();
}
function renderMtabs() {
  const side = $('#tblSide');
  if (!side || !game) return;
  $$('#tblMtabs [data-mt]').forEach((b) => b.classList.toggle('on', b.dataset.mt === side.dataset.mt));
  // Непрочитанные записи журнала (кроме своих), пока открыта другая вкладка
  if (side.dataset.mt === 'log') logSeen = Date.now();
  const n = logList().filter((e) => (e.t || 0) > logSeen && e.by !== user.uid && (isDM() || !e.dmOnly)).length, badge = $('#tblLogBadge');
  badge.hidden = !n; badge.textContent = n > 9 ? '9+' : n;
  $('#tblMtHint').hidden = ['#tblCastBar', '#tblTurn', '#tblSaves', '#tblSel'].some((s) => !$(s).hidden);
  // На телефоне поле сначала мельче, чтобы было видно больше клеток
  if (!zoomInit) { zoomInit = true; if (narrow()) { zoom = 0.6; layoutBoard(); } }
}
function zoomFit() {
  const w = $('#tblWrap');
  zoom = Math.max(ZMIN, Math.min(ZMAX, +Math.min(w.clientWidth / (W() * CELL), w.clientHeight / (H() * CELL)).toFixed(2)));
  // Всё поле целиком — значит, камера не привязана к персонажу
  if (!isDM() && myTok()) camFree = true;
  camCenter(W() / 2, H() / 2);
  renderCam();
}
// Два пальца: масштаб с центром между ними; начатое перетаскивание отменяется
$('#tblWrap').addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touchPts.size !== 2) return;
  if (drag && drag.kind === 'token') { drawRange(null); hint(''); }
  if (drag && drag.kind === 'ruler') { ruler = null; drawRuler(); }
  drag = null;
  if (game) renderTokens();
  const [a, b] = [...touchPts.values()];
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
}, true);
window.addEventListener('pointermove', (e) => {
  if (!touchPts.has(e.pointerId)) return;
  touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!pinch || touchPts.size < 2) return;
  const [a, b] = [...touchPts.values()], r = $('#tblWrap').getBoundingClientRect();
  zoomAt((pinch.z * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d, pinch.mx - r.left, pinch.my - r.top);
}, true);
const touchEnd = (e) => { touchPts.delete(e.pointerId); if (touchPts.size < 2) pinch = null; };
window.addEventListener('pointerup', touchEnd, true);
window.addEventListener('pointercancel', touchEnd, true);
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
  if (myGames === null) loadMyGames();
  const mine = Object.entries(myGames || {}).sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
  lobby.innerHTML = `${mine.length ? `<div class="card"><h2>📂 Мои игры</h2><div class="list">${mine.map(([gid, g]) => `<div class="enc-row"><span><b>${esc(g.n || 'Игра')}</b>
      <span class="muted small">код ${esc(g.code || '')}${g.t ? ` · ${new Date(g.t).toLocaleDateString('ru')}` : ''}</span></span>
      <span class="row gap"><button class="primary" data-tbl="resume" data-id="${esc(gid)}" data-code="${esc(g.code || '')}">▶ Продолжить</button><button class="ghost" data-tbl="gameDel" data-id="${esc(gid)}" data-code="${esc(g.code || '')}" title="Удалить игру">🗑</button></span></div>`).join('')}</div>
      <p class="muted small">Игра продолжится с того места, где вы вышли: сцены, существа, сундуки и добыча на месте. Игроки подключаются по тому же коду.</p></div>` : ''}
    <div class="grid g-combat">
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
  const b = (a, label, title, on) => `<button class="${on ? 'on' : ''}" data-tbl="${a}" title="${title}">${label}${on && /Свободно|Вид игроков/.test(label) ? ' ✓' : ''}</button>`;
  const brushes = ['tree', 'rock', 'bush', 'road', 'sand', 'bridge', 'furn', 'floor'], rough = ['thicket', 'bog', 'rubble', 'slope', 'snow', 'ice'];
  const handouts = isDM() || hoMine().length ? b('handouts', `📜 Материалы${!isDM() && hoMine().length ? ` (${hoMine().length})` : ''}`, isDM() ? 'Показать игрокам картинку, письмо или карту' : 'Что показывал мастер') : '';
  const base = t('move', '✋ Двигать', 'Перетаскивайте токены; шаг — WASD или стрелки') + t('ruler', '📏 Линейка', 'Протяните, чтобы измерить расстояние')
    + b('keys', '⌨', 'Клавиши: шаг WASD, атака Q, заклинание E, спасбросок Alt… — посмотреть и переназначить (K)');
  if (!isDM()) {
    $('#tblTools').innerHTML = `<div class="seg">${base}${!(hasMine && inFight()) ? t('place', hasMine ? '📍 Переставить меня' : '📍 Поставить персонажа', 'Нажмите на клетку') : ''}
      ${me() && me().charId && app.companions(me().charId).length ? b('compPick', '🐾 Спутник', 'Поставить спутника из листа на поле', tool === 'placeComp') : ''}
      ${me() && me().charId ? b('items', '🎒 Вещи', 'Передать вещи или деньги другому игроку, обменяться, бросить на землю') : ''}
      ${(game.meta || {}).world ? b('travel', `🧭 ${travelClock(game.travel || {})}`, 'Путешествие: время и пройденный путь') : ''}${handouts}</div>`;
    return;
  }
  // Мастер: выпадающие меню по группам; на кнопке меню — выбранный в нём инструмент
  const TL = { wall: '▮ Стена', difficult: '▦ Трудная', water: '≈ Вода', erase: '⌫ Ластик', door: '🚪 Дверь', light: '💡 Свет', chest: '🧰 Сундук', reveal: '👁 Открыть туман',
    conceal: '🌫 Скрыть туманом', enemy: '＋ Существо', area: '◯ Область', encPlace: '⚔ Столкновение', ...Object.fromEntries([...rough, ...brushes].map((k) => [k, `${TERRAIN[k].ic} ${TERRAIN[k].n}`])) };
  const sep = '<div class="tm-sep"></div>';
  const menu = (id, title, keys, html, on) => {
    const cur = keys.includes(tool) ? TL[tool] : '';
    return `<div class="tmenu"><button class="tm-btn ${cur || on ? 'on' : ''}" data-tmenu="${id}">${cur || title} ▾</button><div class="tm-pop" data-tmpop="${id}" hidden>${html}</div></div>`;
  };
  const drawKeys = ['wall', 'difficult', 'water', ...rough, ...brushes, 'erase', 'door', 'light', 'chest', 'reveal', 'conceal'];
  $('#tblTools').innerHTML = `<div class="seg">${base}</div>`
    + menu('draw', '🖌 Рисовать', drawKeys, ['wall', 'difficult', 'water'].map((k) => t(k, TL[k])).join('') + sep + rough.map((k) => t(k, TL[k], 'Труднопроходимая местность: перемещение вдвое дороже')).join('') + sep + brushes.map((k) => t(k, TL[k])).join('') + sep
      + t('erase', TL.erase) + t('door', TL.door, 'Поставить или убрать дверь. Открыть — нажатием с «Двигать», запереть — с Shift')
      + t('light', TL.light, 'Поставить или убрать источник света (20 фт яркого + 20 тусклого)') + t('chest', TL.chest, 'Поставить сундук с добычей по уровню, замком и ловушкой; нажатие на сундук — изменить')
      + (fogOn() ? sep + t('reveal', TL.reveal, 'Кисть: открыть клетки для игроков') + t('conceal', TL.conceal, 'Кисть: закрыть клетки туманом') : ''))
    + menu('map', '🗺 Карта', [], b('gen', '🎲 Генератор', 'Создать местность или локацию по шаблону: лес, река, горы, подземелье, замок, город…')
      + b('mapCfg', '🗺 Карта и туман', 'Карта-подложка, размер поля, туман войны')
      + b('scale', `📐 Масштаб и размер · ${fmtFt(FT())}`, 'Сколько футов в клетке; добавить или убрать ряды с любой стороны; обрезать по нарисованному')
      + ((game.meta || {}).world ? b('travel', '🧭 Путешествие', 'Темп, время в пути, случайные встречи, список мест') : '')
      + ((game.meta || {}).worldFrom ? b('worldBack', '🌍 На карту мира', 'Вернуться на карту мира — отряд встанет там, откуда вошёл') : '')
      + b('scenes', `🎬 Сцены${(game.meta || {}).scene && (game.scenes || {})[game.meta.scene] ? `: ${esc(game.scenes[game.meta.scene].n)}` : ''}`, 'Несколько полей: таверна, подземелье, логово — переключение одной кнопкой')
      + (fogOn() ? b('fogPreview', '👁 Вид игроков', 'Показать поле так, как его видят игроки', fogPreview) : ''), fogPreview)
    + menu('mon', '🐉 Существа', ['enemy', 'encPlace'], t('enemy', TL.enemy, 'Нажмите на клетку, чтобы поставить врага или NPC из бестиария')
      + b('enc', '⚔ Столкновение', 'Собрать столкновение из бестиария, оценить сложность для группы и поставить его на поле', tool === 'encPlace')
      + b('pop', '👥 Заселить', 'Расставить противников по уровню группы или мирных NPC с торговцами')
      + b('bestiary', '🐉 Бестиарий', 'Свои существа: создать, изменить встроенное, перенести файлом') + sep
      + b('freeMove', '🔓 Свободно', 'Двигать любые токены без учёта хода и скорости (толчок, перенос тела). То же — перетаскивание с Shift', freeMove), freeMove)
    + menu('game', '🎲 Игра', ['area'], t('area', TL.area, 'Область со спасброском: дыхание, ловушка… Конус и линия — от выделенного существа')
      + b('rest', '🏕 Отдых', 'Короткий или долгий отдых для всей группы') + handouts);
  // Открытое меню остаётся открытым, когда стол перерисовывается от чужих действий
  if (openMenu) placeMenu(openMenu);
}
// Меню поверх страницы, под своей кнопкой, не выходя за край экрана
function placeMenu(id) {
  const btn = $(`[data-tmenu="${id}"]`), pop = $(`[data-tmpop="${id}"]`);
  if (!btn || !pop) { openMenu = null; return; }
  pop.hidden = false;
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  pop.style.top = `${r.bottom + 4}px`;
}
function closeMenu() { if (!openMenu) return; openMenu = null; $$('.tm-pop').forEach((p) => { p.hidden = true; }); }
document.addEventListener('click', (e) => { if (openMenu && !e.target.closest('.tmenu')) closeMenu(); }, true);
window.addEventListener('scroll', (e) => { if (!(e.target.closest && e.target.closest('.tm-pop'))) closeMenu(); }, true);
window.addEventListener('resize', () => { if (openMenu) placeMenu(openMenu); });
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
      ${isDM() ? `<button data-tbl="lair" title="Логово действует на счёт инициативы 20 (проигрывая ничьи)">🏰 ${game.init && game.init.list && game.init.list.lair ? 'Убрать логово' : 'Логово'}</button><button data-tbl="rollNpc" title="Бросить за всех существ на поле">🎲 Враги</button><button data-tbl="xpGive" title="Раздать опыт персонажам (котёл: ${Object.values((game.xp || {}).kills || {}).reduce((s, k) => s + (+k.n || 0), 0)})">⭐ Опыт</button><button data-tbl="loot" title="Обыскать павших и раздать добычу">💰 Добыча${(() => { const n = Object.values(game.tokens).filter((t) => t.kind === 'npc' && team(t) === 'npc' && isDead(t) && !t.looted).length; return n ? ` (${n})` : ''; })()}</button>
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
    ${t.shop ? `<div class="mt"><button class="primary" data-tbl="shop">🛒 Товары</button> <span class="muted small">${esc(SHOP_N[t.shop.kind] || '')}</span></div>` : ''}
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
      <button data-tbl="npcCopy">⧉ Копия</button><button data-tbl="npcInit">🎲 В инициативу</button><button data-tbl="npcEdit" title="Изменить характеристики, атаки и способности этого существа">✎ Статблок</button></div>
      <div class="loot-box mt"><div class="row between"><b>💰 Добыча${t.looted ? ' (обыскан)' : ''}</b><button data-tbl="lootTok" title="Посмотреть, перебросить или изменить">✎</button></div><div class="small">${esc(lootText(t.loot))}</div></div>
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

/* ---------- Во весь экран: очередь сверху, панель хода снизу ---------- */
// Поле на весь экран; журнал, ход и игроки — выдвижная панель справа; запросы (спасброски, передачи) — над панелью хода.
// Панель: слева портрет и хиты, по центру — ресурсы хода и ячейки 1–0 (атаки, заклинания, действия, зелья), справа — конец хода
let fullOn = false, hudTab = ls.get('dnd55-hudtab') || 'atk';
function setFull(on) {
  fullOn = on;
  document.body.classList.toggle('tbl-full-on', on);
  $('#tblGame').classList.toggle('tbl-full', on);
  $('#tblSide').classList.toggle('closed', on);
  const D = document.documentElement;
  try {
    if (on && D.requestFullscreen && !document.fullscreenElement) D.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) { /* без полноэкранного режима браузера — просто на всё окно */ }
  camKey = '';
  renderAll();
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && fullOn) setFull(false); });
// Чей ход и чья панель: игрок — свой персонаж; мастер — ходящее существо, вне боя — выделенное
function hudTokId() {
  if (!isDM()) return myTok() ? `pc_${user.uid}` : null;
  const c = currentEntry();
  if (c && game.tokens[c.tokenId]) return c.tokenId;
  return selId && game.tokens[selId] ? selId : null;
}
const faceHtml = (t, cls = '') => `<div class="hud-face ${cls}" style="--tc:${t.kind === 'npc' ? SIDE_COLOR[t.side || 'enemy'] : t.color || '#d4a64a'}">${t.img && !isDead(t) ? `<img src="${t.img}" alt="">` : `<span>${isDead(t) ? '☠' : esc((t.name || '?').trim().slice(0, 2))}</span>`}</div>`;
function renderFInit() {
  const box = $('#tblFInit');
  box.hidden = !fullOn || !inFight();
  if (box.hidden) return;
  const cur = currentEntry();
  box.innerHTML = `<span class="badge">Раунд ${game.init.round || 1}</span>${initList().map((e) => {
    const t = game.tokens[e.tokenId];
    if (t && t.hidden && !isDM()) return '';
    return `<div class="fi ${cur && cur.id === e.id ? 'cur' : ''} ${t && isDown(t) ? 'down' : ''}" title="${esc(e.name)} · ${e.roll}">${t ? faceHtml(t) : `<div class="hud-face"><span>${e.kind === 'lair' ? '🏰' : '?'}</span></div>`}<b>${e.roll}</b></div>`;
  }).join('')}`;
}
// Ячейки панели по вкладкам: [{ label, sub, act, data, ok }]
function hudSlots(id) {
  const t = game.tokens[id], m = me(), dm = isDM(), e = econ(id), mv = moveInfo(id), turn = isTurnOf(id), fight = inFight();
  const S = [];
  if (hudTab === 'atk') {
    if (dm) {
      if (t.kind === 'npc') npcAttacks(t).forEach((a) => S.push({ label: `⚔ ${a.n}`, sub: `${fmtMod(a.bonus)} · ${a.dmg || ''}`, act: 'npcAttack', data: { id }, ok: !mv.incap && (!fight || turn) && (e.atk > 0 || !e.a || !e.b) }));
    } else if (m && m.charId) {
      [...app.attacks(m.charId), ...SPECIAL_ATK].forEach((a) => S.push({ label: a.special ? a.n : `⚔ ${a.n}`, sub: a.special ? 'приём' : `${fmtMod(a.bonus)} · ${a.dmg || ''}`, act: 'hudAtk', data: { id, atk: a.id }, ok: !mv.incap && a.ammo !== 0 && (((turn || !fight) && (e.atk > 0 || !e.a || !e.b)) || !e.r) }));
    }
  } else if (hudTab === 'spell' && !dm && m && m.charId) {
    app.areaSpells(m.charId, Object.keys(SPELL_FX)).forEach((s) => S.push({ label: `✨ ${s.n}`, sub: s.l ? `${s.l} ур. · ${s.slots.filter((x) => x.left > 0).length ? 'есть ячейки' : 'нет ячеек'}` : 'заговор', act: 'hudSpell', data: { id, sp: s.id }, ok: !mv.incap && spellCan(id, s.act) && (!s.l || s.slots.some((x) => x.left > 0)) }));
  } else if (hudTab === 'act') {
    const can = !mv.incap && (turn || dm || !fight);
    [['dash', '🏃 Рывок', 'действие', !e.a && mv.speed > 0], ['dis', '↩ Отход', 'действие', !e.a && !e.dis], ['dodge', '🛡 Уклонение', 'действие', !e.a && !e.dodge],
      ['dashB', '🏃 Рывок', 'бонусное', mv.bonus.includes('dash') && !e.b && mv.speed > 0], ['disB', '↩ Отход', 'бонусное', mv.bonus.includes('dis') && !e.b && !e.dis],
      ['stand', '⬆ Встать', `${Math.ceil(mv.speed / 2)} фт`, mv.prone && mv.left >= Math.ceil(mv.speed / 2)]]
      .forEach(([a, label, sub, ok]) => { if (a.endsWith('B') && !mv.bonus.includes(a === 'dashB' ? 'dash' : 'dis')) return; if (a === 'stand' && !mv.prone) return; S.push({ label, sub, act: a, data: { id }, ok: can && fight && ok }); });
    if (!dm) S.push({ label: '🎲 Спасбросок', sub: 'Alt', act: 'hudSave', data: {}, ok: true }, { label: '🎒 Вещи', sub: 'I', act: 'items', data: {}, ok: true });
  } else if (hudTab === 'item' && !dm && m && m.charId) {
    ((app.inventory(m.charId) || {}).items || []).filter((i) => i.heal).forEach((i) => S.push({ label: `🧪 ${i.n}`, sub: `${i.heal}${i.qty > 1 ? ` · ×${i.qty}` : ''} · бонусное`, act: 'hudDrink', data: { id, it: i.id }, ok: !mv.incap && (!fight || (turn && !e.b)) }));
  }
  return S;
}
function renderHud() {
  const box = $('#tblHud');
  box.hidden = !fullOn;
  renderFInit();
  if (!fullOn) return;
  const id = hudTokId(), t = id && game.tokens[id], dm = isDM(), fight = inFight();
  const side = `<div class="hud-right">
      ${fight && t && isTurnOf(id) && !dm ? '<button class="primary hud-end" data-tbl="endTurn">✓ Закончить ход<small>Пробел</small></button>'
        : fight && dm ? '<button class="primary hud-end" data-tbl="next">▶ Дальше<small>Пробел</small></button>'
        : fight ? `<div class="hud-wait">Ходит: <b>${esc((currentEntry() || {}).name || '')}</b></div>` : dm && initList().length ? '<button class="primary hud-end" data-tbl="startFight">⚔ Начать бой</button>' : '<div class="hud-wait">Вне боя</div>'}
      <div class="row gap"><button data-tbl="hudSide" title="Журнал, чат, очередь и игроки">📜</button><button data-tbl="keys" title="Клавиши (K)">⌨</button><button data-tbl="full" title="Выйти из полноэкранного режима">✕</button></div></div>`;
  if (!t) { box.innerHTML = `<div class="hud-left"><div class="muted small">${dm ? 'Выделите существо — здесь появятся его действия' : 'Поставьте персонажа на поле'}</div></div><div class="hud-mid"></div>${side}`; return; }
  const e = econ(id), mv = moveInfo(id), pct = Math.max(0, Math.min(1, (t.hp || 0) / (t.hpMax || 1))), ch = !dm && charOf(t);
  const pip = (k, n) => `<span class="hpip ${e[k] ? 'used' : ''}" title="${n}${e[k] ? ' — потрачено' : ''}">${n}</span>`;
  const slots = hudSlots(id);
  const tabs = dm ? [['atk', '⚔ Атаки'], ['act', '🏃 Действия']] : [['atk', '⚔ Атаки'], ['spell', '✨ Заклинания'], ['act', '🏃 Действия'], ['item', '🧪 Зелья']];
  const ds = isDown(t) && usesDS(t);
  box.innerHTML = `<div class="hud-left">${faceHtml(t, 'big')}<div class="hud-stats">
      <b>${esc(isDown(t) ? downLabel(t) : t.name)}</b>
      ${t.hpMax ? `<div class="hud-hp"><div style="width:${pct * 100}%;background:${pct > 0.5 ? '#5a9e5a' : pct > 0.25 ? '#d4a64a' : '#c94a3d'}"></div><span>${t.hp}/${t.hpMax}${+t.temp ? ` +${t.temp}` : ''}</span></div>` : ''}
      <div class="muted small">КД ${t.ac || '—'}${ch && ch.conc ? ` · 🌀 ${esc(ch.conc)}` : ''}</div>
      ${(t.cond || []).length ? `<div class="hud-cond">${t.cond.map((k) => `<span class="chip on"><span>${esc(condName(k))}</span></span>`).join('')}</div>` : ''}</div></div>
    <div class="hud-mid">
      ${ds ? `<div class="hud-ds">💀 Успехи ${+t.dsS || 0}/3 · Провалы ${+t.dsF || 0}/3 ${!dm && isTurnOf(id) && !isDead(t) && !isStable(t) && !e.ds ? `<button class="primary" data-tbl="deathSave" data-id="${id}">Спасбросок от смерти</button>` : ''}</div>` : `
      <div class="hud-res">${pip('a', 'Действие')}${pip('b', 'Бонусное')}${pip('r', 'Реакция')}
        <span class="hud-mv" title="Перемещение"><span style="width:${fight && mv.total ? Math.min(100, (mv.left / mv.total) * 100) : 100}%"></span><em>${fight ? `${mv.left}/${mv.total}` : mv.speed} фт</em></span>
        ${e.atk > 0 ? `<span class="muted small">атак: ${e.atk}</span>` : ''}${aim && aim.from === id ? `<span class="aim-mini">🎯 ${esc(aim.atk.n)} — цель: нажмите или Tab, Enter <button data-tbl="aimOff">✕</button></span>` : ''}</div>
      <div class="hud-tabs">${tabs.map(([k, n]) => `<button class="${hudTab === k ? 'on' : ''}" data-tbl="hudTab" data-k="${k}">${n}</button>`).join('')}</div>
      <div class="hud-slots">${slots.map((s, i) => `<button class="hud-slot" data-tbl="${s.act}" ${Object.entries(s.data).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')} ${s.ok ? '' : 'disabled'} title="${esc(s.label)} · ${esc(s.sub || '')}">
          ${i < 10 ? `<kbd>${(i + 1) % 10}</kbd>` : ''}<span>${esc(s.label)}</span><small>${esc(s.sub || '')}</small></button>`).join('') || '<span class="muted small">Пусто</span>'}</div>
      ${!dm ? `<div class="hud-react">${reactionsHtml(id, t, e, mv.incap)}${compTurnHtml(isTurnOf(id))}</div>` : `<div class="hud-react">${legendHtml(id)}</div>`}`}
    </div>${side}`;
}
// Атака с панели: как в меню «Атака», первым подходящим способом (действие → бонусное → реакция)
function quickAttack(id, atkId) {
  const t = game.tokens[id], m = me(), e = econ(id), turn = isTurnOf(id);
  if (!t || !m || !m.charId) return;
  if (incapTok(t)) { app.toast('Вы недееспособны и не можете атаковать'); return; }
  const A = app.attacks(m.charId).find((a) => a.id === atkId) || SPECIAL_ATK.find((a) => a.id === atkId);
  if (!A) return;
  const per = (app.summary(m.charId) || {}).atks || 1, fight = inFight();
  let way = (turn || !fight) && (e.atk > 0 || !e.a) ? 'action' : turn && !e.b ? 'bonus' : !e.r ? 'reaction' : null;
  if (A.cantrip) {
    if (fight && (!turn || e.atk > 0 || e.a)) { app.toast(turn ? 'Заговор накладывается действием «Магия», а действие уже потрачено' : 'Заговор накладывается действием — только в свой ход'); return; }
    way = 'magic';
  }
  if (!way) { app.toast('Нет доступных действий для атаки'); return; }
  aim = { from: id, charId: m.charId, atk: A, way, left: way === 'action' ? (e.atk > 0 ? e.atk : per) : way === 'magic' ? A.beams || 1 : 1, man: '', smite: '' };
  renderAll();
  keyHint('Цель: нажмите на неё или Tab, затем Enter', id);
}
// Зелье с панели: в бою — бонусным действием (правила 2024), лечение бросается и идёт в лист
function hudDrink(id, itemId) {
  const m = me(), t = game.tokens[id], e = econ(id);
  if (!m || !m.charId || !t) return;
  if (inFight() && (!isTurnOf(id) || e.b)) { app.toast(isTurnOf(id) ? 'Бонусное действие уже потрачено' : 'Выпить зелье — в свой ход'); return; }
  const it = ((app.inventory(m.charId) || {}).items || []).find((i) => i.id === itemId);
  if (!it || !app.takeItems(m.charId, [{ id: it.id, qty: 1 }], 0)) { app.toast('Зелья уже нет'); return; }
  const r = app.rollFormula(it.heal, it.n);
  if (r) app.heal(m.charId, r.total);
  if (inFight()) R.update(ref(gpath(`econ/${id}`)), { b: 1 }).catch(() => {});
  addLog({ kind: 'act', who: t.name, txt: `🧪 пьёт «${it.n}»${r ? `: +${r.total} хитов` : ''}` });
}

/* ---------- Клавиатура ---------- */
// Клавиши — по физическому положению (e.code), поэтому работают и в русской раскладке. Назначения хранятся на устройстве
const KEY_ACTS = [
  ['up', 'Шаг вверх', ['KeyW', 'ArrowUp']], ['down', 'Шаг вниз', ['KeyS', 'ArrowDown']], ['left', 'Шаг влево', ['KeyA', 'ArrowLeft']], ['right', 'Шаг вправо', ['KeyD', 'ArrowRight']],
  ['attack', 'Атака — выбор атаки', ['KeyQ']], ['spell', 'Заклинание — выбор заклинания', ['KeyE']], ['saves', 'Спасбросок (запрос или вручную)', ['AltLeft', 'KeyR']],
  ['next', 'Следующая цель', ['Tab']], ['ok', 'Подтвердить: удар, заклинание', ['Enter']],
  ['endTurn', 'Закончить ход', ['Space']], ['dash', 'Рывок', ['KeyF']], ['dis', 'Отход', ['KeyG']], ['dodge', 'Уклонение', ['KeyH']],
  ['items', 'Вещи', ['KeyI']], ['chat', 'Журнал и чат', ['KeyJ']], ['cam', 'Камера: к персонажу / свободная', ['KeyM']], ['keys', 'Это окно — клавиши', ['KeyK']],
];
const KEY_STORE = 'dnd55-keys';
let keyMap = null;
function keysLoad() {
  let saved = {};
  try { saved = JSON.parse(ls.get(KEY_STORE)) || {}; } catch (e) { saved = {}; }
  keyMap = Object.fromEntries(KEY_ACTS.map(([k, , def]) => [k, Array.isArray(saved[k]) ? saved[k] : def]));
}
const keyAct = (code) => { if (!keyMap) keysLoad(); return Object.keys(keyMap).find((k) => keyMap[k].includes(code)) || null; };
const keyName = (c) => ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Пробел', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc', AltLeft: 'Alt', AltRight: 'Alt (правый)',
  ShiftLeft: 'Shift', ShiftRight: 'Shift (правый)', ControlLeft: 'Ctrl', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\' }[c]
  || c.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num '));
// Окно «⌨ Клавиши»: нажмите на поле и затем клавишу; Backspace — очистить, Esc — отмена
let keyCapture = null;
function keysDialog() {
  if (!keyMap) keysLoad();
  const slot = (k, i) => { const c = keyMap[k][i]; return `<button class="key-slot ${keyCapture && keyCapture.k === k && keyCapture.i === i ? 'on' : ''}" data-ks="${k}" data-ki="${i}">${keyCapture && keyCapture.k === k && keyCapture.i === i ? 'нажмите клавишу…' : c ? esc(keyName(c)) : '—'}</button>`; };
  app.openModal(`<div><h2>⌨ Клавиши</h2>
    <p class="muted small">Нажмите на поле, затем клавишу. Backspace — очистить, Esc — отмена. Назначения хранятся на этом устройстве.
      Удерживайте шаг — персонаж идёт дальше (по трудной местности медленнее); в бою он остановится, когда кончится скорость, — Рывок отдельной клавишей.
      Alt + 1…6 — спасбросок Силы…Харизмы вручную. В окне выбора атаки или заклинания цифры 1–9 выбирают пункт.</p>
    <div class="key-list">${KEY_ACTS.map(([k, n]) => `<div class="enc-row"><span>${esc(n)}</span><span class="row gap">${slot(k, 0)}${slot(k, 1)}</span></div>`).join('')}</div>
    <div class="modal-actions"><button id="kReset">Как было</button><button data-act="closeModal">Готово</button></div></div>`);
  $$('[data-ks]').forEach((b) => b.addEventListener('click', () => { keyCapture = { k: b.dataset.ks, i: +b.dataset.ki }; keysDialog(); }));
  $('#kReset').onclick = () => { ls.set(KEY_STORE, ''); keyCapture = null; keysLoad(); keysDialog(); };
}
function keyAssign(code) {
  const { k, i } = keyCapture;
  keyCapture = null;
  if (code !== 'Escape') {
    Object.keys(keyMap).forEach((a) => { keyMap[a] = keyMap[a].filter((c) => c !== code); }); // одна клавиша — одно действие
    const L = keyMap[k].slice();
    if (code === 'Backspace') L.splice(i, 1); else L[i] = code;
    keyMap[k] = L.filter(Boolean);
    ls.set(KEY_STORE, JSON.stringify(keyMap));
  }
  keysDialog();
}
// Подсказка у токена (как при перетаскивании), сама гаснет
let keyHintT = null;
function keyHint(text, id) {
  const el = id && $(`[data-tok="${id}"]`);
  if (!el || !text) { hint(''); return; }
  const r = el.getBoundingClientRect();
  hint(text, { clientX: r.right, clientY: r.top + 8 });
  clearTimeout(keyHintT); keyHintT = setTimeout(() => hint(''), 1800);
}
// Кого двигают клавиши: игрок — своего персонажа, мастер — выделенное существо
const keyTokId = () => (isDM() ? (selId && game.tokens[selId] ? selId : null) : myTok() ? `pc_${user.uid}` : null);
// Шаг на клетку: те же правила, что при перетаскивании. Возвращает { slow } — шаг по трудной местности; 'stop' — кончилась скорость
function stepMove(dx, dy) {
  const id = keyTokId(), t = id && game.tokens[id];
  if (!t) { if (isDM()) keyHint(''); return false; }
  const s = t.size || 1, forced = isDM() && freeMove, x = t.x + dx, y = t.y + dy;
  if (isDown(t) && !forced) { keyHint(isDead(t) ? 'Это труп' : 'Без сознания — не может двигаться', id); return 'stop'; }
  if (x < 0 || y < 0 || x + s > W() || y + s > H()) return false;
  let mv = null;
  if (inFight() && !forced) {
    if (!(isTurnOf(id) || (t.comp && isTurnOf(`pc_${t.owner}`)))) { keyHint(isDM() ? 'Сейчас не его ход' : 'Сейчас не ваш ход', id); return 'stop'; }
    mv = moveInfo(id);
  }
  const occ = occupancy(id);
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) {
    const k = `${x + i}_${y + j}`, T = TERRAIN[(game.map || {})[k]];
    if (T && T.block) { keyHint(`Там ${T.n.toLowerCase()}`, id); return false; }
    if (doorShut(k)) { keyHint('Дверь закрыта', id); return false; }
    if (occ.has(k) && !forced) { keyHint('Клетка занята', id); return false; }
  }
  const cost = reachMap(t.x, t.y, FT() * 4, forced ? null : occ, mv && mv.prone).get(`${x}_${y}`);
  if (cost == null) return false;
  const upd = { [`tokens/${id}/x`]: x, [`tokens/${id}/y`]: y };
  if (mv) {
    if (cost > mv.left) { keyHint(mv.left ? `Шаг ${cost} фт, осталось ${mv.left} фт` : `Скорость потрачена${mv.canDash ? ' — Рывок (F)' : ''}`, id); return 'stop'; }
    const used = (econ(id).move || 0) + cost;
    upd[`econ/${id}/move`] = used;
    game.econ = { ...(game.econ || {}), [id]: { ...econ(id), move: used } }; // следующий шаг — от свежего остатка, не дожидаясь базы
    checkOpportunity(id, { ...t, x, y }, t.x, t.y);
  }
  t.x = x; t.y = y;
  renderTokens(); camUpdate();
  travelStep(id, 1);
  R.update(ref(gpath()), upd).catch((err) => app.toast(`Не удалось переместить: ${esc(err.code || err.message)}`));
  if (mv) keyHint(`осталось ${Math.max(0, mv.left - cost)} фт`, id);
  return { slow: cost > FT() * (mv && mv.prone ? 2 : 1) };
}
// Ходьба при удержании: первый шаг сразу (с короткой паузой, чтобы поймать диагональ), дальше — размеренно
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }, WALK_MS = 280;
const held = new Set();
let walkT = null, walkN = 0, walkStop = false;
const dirNow = () => { let dx = 0, dy = 0; held.forEach((k) => { dx += DIRS[k][0]; dy += DIRS[k][1]; }); return [Math.sign(dx), Math.sign(dy)]; };
function walk() {
  walkT = null;
  const [dx, dy] = dirNow();
  if ((!dx && !dy) || walkStop || !game) return;
  if (cast) { castKey(dx, dy); walkT = setTimeout(walk, WALK_MS * (walkN++ ? 0.6 : 1.4)); return; }
  if (aim) return;
  const r = stepMove(dx, dy);
  if (r === 'stop') { walkStop = true; return; }
  if (!r) return;
  walkT = setTimeout(walk, WALK_MS * (r.slow ? 2 : 1) * (walkN++ ? 1 : 1.4));
}
// Размещение области клавишами: сфера и куб двигаются по клетке, конус и линия от себя — поворачиваются
function castKey(dx, dy) {
  const A = cast.area, src = cast.caster && game.tokens[cast.caster];
  if (A.shape === 'target' || A.shape === 'aura') return;
  if ((A.shape === 'cone' || A.shape === 'line' || (A.shape === 'cube' && cast.self)) && src) {
    const s = src.size || 1;
    castFollow(src.x + s / 2 + dx * 3, src.y + s / 2 + dy * 3);
  } else {
    if (!cast.kp) cast.kp = A.ox != null ? { x: A.ox, y: A.oy } : src ? { x: src.x + (src.size || 1) / 2, y: src.y + (src.size || 1) / 2 } : { x: W() / 2, y: H() / 2 };
    cast.kp.x = Math.max(0, Math.min(W(), cast.kp.x + dx)); cast.kp.y = Math.max(0, Math.min(H(), cast.kp.y + dy));
    castFollow(cast.kp.x, cast.kp.y);
  }
  drawAreas();
}
// Tab: перебор целей атаки или заклинания — ближние первыми; выбранная обведена пунктиром
let kbdPick = null;
function pickNext(back) {
  const from = aim ? game.tokens[aim.from] : cast && cast.caster ? game.tokens[cast.caster] : null;
  if (!from) return;
  const fromId = aim ? aim.from : cast.caster, reach = aim ? (aim.atk.rng.far || aim.atk.rng.reach || 5) : cast.range || Infinity;
  const L = Object.entries(game.tokens).filter(([id, t]) => id !== fromId && !isDead(t) && !(t.hidden && !isDM()) && !fogHides(t) && distFt(from, t) <= reach)
    .sort((a, b) => (hostile(b[1], from) - hostile(a[1], from)) || distFt(from, a[1]) - distFt(from, b[1])).map(([id]) => id);
  if (!L.length) { keyHint(aim ? 'Нет целей в досягаемости' : 'Нет целей на дистанции', fromId); return; }
  const i = L.indexOf(kbdPick);
  kbdPick = L[(i + (back ? -1 : 1) + L.length) % L.length];
  if (cast && cast.area.shape === 'target' && !cast.area.tgts) { cast.area.tgt = kbdPick; drawAreas(); }
  renderTokens();
  const T = game.tokens[kbdPick];
  keyHint(`${T.name} · ${distFt(from, T)} фт · Enter`, kbdPick);
  if (!camFollow()) camOn(T);
}
function keyOk() {
  if (aim && kbdPick && game.tokens[kbdPick]) { const id = kbdPick; kbdPick = null; attackTarget(id); renderTokens(); return; }
  if (!cast) return;
  if (cast.area.shape === 'target') {
    if (!kbdPick) { pickNext(); return; }
    if (cast.area.tgts) {
      const L = cast.area.tgts;
      if (L.includes(kbdPick)) L.splice(L.indexOf(kbdPick), 1); else if (L.length < cast.info.nT) L.push(kbdPick);
      drawAreas(); renderCastBar();
      if (L.length >= cast.info.nT) { kbdPick = null; confirmCast(); }
      return;
    }
    cast.area.tgt = kbdPick; kbdPick = null; confirmCast(); return;
  }
  if (cast.area.ox != null || cast.area.shape === 'aura') confirmCast();
  else keyHint('Наведите область: мышью или клавишами шага', cast.caster);
}
// Нажать видимую кнопку стола (те же проверки, что у мыши); нет кнопки — подсказка
function pressBtn(names, fallback) {
  const b = names.map((n) => $$(`[data-tbl="${n}"]`).find((x) => x.offsetParent && !x.disabled)).find(Boolean);
  if (b) { b.click(); return true; }
  if (fallback) return fallback();
  keyHint('Сейчас недоступно', keyTokId());
  return false;
}
// Рывок, Отход, Уклонение клавишей: действием, а если оно потрачено — бонусным, когда класс это позволяет
function keyEcon(k) {
  const id = keyTokId() || hudTokId(), t = id && game.tokens[id];
  if (!t || !inFight() || !isTurnOf(id)) { keyHint(inFight() ? 'Только в свой ход' : 'Это действие — в бою', id); return; }
  const e = econ(id), mv = moveInfo(id);
  if (mv.incap) { keyHint('Недееспособен', id); return; }
  if (k === 'dash' && mv.speed > 0 && !e.a) econAct('dash', id);
  else if (k === 'dash' && mv.speed > 0 && mv.bonus.includes('dash') && !e.b) econAct('dashB', id);
  else if (k === 'dis' && !e.dis && !e.a) econAct('dis', id);
  else if (k === 'dis' && !e.dis && mv.bonus.includes('dis') && !e.b) econAct('disB', id);
  else if (k === 'dodge' && !e.dodge && !e.a) econAct('dodge', id);
  else { keyHint('Действие уже потрачено', id); return; }
  keyHint({ dash: '🏃 Рывок', dis: '↩ Отход', dodge: '🛡 Уклонение' }[k], id);
}
// Спасброски вручную: Alt + 1…6 или окно с шестью кнопками
function manualSave(abil) {
  const m = me();
  if (!m || !m.charId) return;
  const r = app.rollSave(m.charId, abil, undefined, { label: 'вручную' });
  if (r) addLog({ kind: 'act', who: (myTok() || {}).name || myName(), txt: `🎲 спасбросок ${AB_N[abil]}: ${r.total}` });
}
function savesKey() {
  if (pressBtn(['saveMine', 'trAccept'], () => false)) return;
  const m = me();
  if (!m || !m.charId) return;
  app.openModal(`<div><h2>🎲 Спасбросок</h2><p class="muted small">Нет запросов на спасбросок. Бросить вручную (Alt + 1…6):</p>
    <div class="slot-choice">${ABK.map((k, i) => `<button data-msv="${k}">${i + 1}. ${['Сила', 'Ловкость', 'Телосложение', 'Интеллект', 'Мудрость', 'Харизма'][i]}</button>`).join('')}</div>
    <div class="modal-actions"><button data-act="closeModal">Закрыть</button></div></div>`);
  $$('[data-msv]').forEach((b) => b.addEventListener('click', () => { app.closeModal(); manualSave(b.dataset.msv); }));
}
function keyAction(a) {
  const pid = keyTokId();
  if (a === 'keys') keysDialog();
  else if (a === 'attack') pressBtn(['attack', 'npcAttack', 'compAttack'], () => {
    if (!isDM() && myTok()) { openAttack(`pc_${user.uid}`); return true; }
    const id = hudTokId(); if (isDM() && id && game.tokens[id].kind === 'npc') { openNpcAttack(id); return true; }
    return false;
  });
  else if (a === 'spell') pressBtn(['spell'], () => { if (!isDM() && myTok()) { openCast(`pc_${user.uid}`); return true; } return false; });
  else if (a === 'saves') savesKey();
  else if (a === 'endTurn') pressBtn(['endTurn', 'next']);
  else if (a === 'dash' || a === 'dis' || a === 'dodge') keyEcon(a);
  else if (a === 'items') { if (!isDM()) itemsDialog(); }
  else if (a === 'chat') { mtab('log'); const c = $('#tblChat'); if (c) { c.focus(); c.scrollIntoView({ block: 'nearest' }); } }
  else if (a === 'cam') { if (isDM() || camFree) camHome(); else camSetFree(true); }
  else if (a === 'next') pickNext();
  else if (a === 'ok') keyOk();
  return pid;
}
let altCombo = false;
function onKeyDown(e) {
  if (keyCapture && !($('#modal') && !$('#modal').hidden && $('[data-ks]'))) keyCapture = null; // окно закрыли, не нажав клавишу
  if (keyCapture) { e.preventDefault(); keyAssign(e.code); return; }
  if (e.key === 'Enter' && e.target.id === 'tblChat') { e.preventDefault(); sendChat(); return; }
  if (!game || !$('#tblBoard') || !$('#tblBoard').offsetParent) return; // стол не на экране
  const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
  const modal = $('#modal') && !$('#modal').hidden;
  if (e.key === 'Escape') {
    if (modal || typing) return;
    kbdPick = null;
    if (cast) cancelCast(); else if (aim) { aim = null; hint(''); renderAll(); }
    return;
  }
  if (typing) return;
  // В окне выбора атаки, заклинания или ячейки цифры выбирают пункт
  if (modal) {
    const n = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (n) { const L = $$('#modalBody .atk-pick, #modalBody [data-slot], #modalBody [data-msv]').filter((b) => !b.disabled && b.offsetParent); if (L[+n[2] - 1]) { e.preventDefault(); L[+n[2] - 1].click(); } }
    // Enter — главная кнопка окна («Сотворить», «Готово»…), если фокус не на другой кнопке
    if (keyAct(e.code) === 'ok' && !(e.target.closest && e.target.closest('button'))) {
      const p = $$('#modalBody .modal-actions .primary').find((b) => !b.disabled && b.offsetParent);
      if (p) { e.preventDefault(); p.click(); }
    }
    return;
  }
  if (e.ctrlKey || e.metaKey) return;
  // Alt + цифра — спасбросок вручную; одиночный Alt срабатывает при отпускании
  if (e.altKey && /^Digit[1-6]$/.test(e.code)) { e.preventDefault(); altCombo = true; manualSave(ABK[+e.code.slice(5) - 1]); return; }
  // Во весь экран: 1…9, 0 — ячейки панели хода
  if (fullOn && !e.altKey && /^Digit[0-9]$/.test(e.code)) {
    const n = +e.code.slice(5), b = $$('#tblHud .hud-slot')[n === 0 ? 9 : n - 1];
    if (b) { e.preventDefault(); if (!b.disabled) b.click(); return; }
  }
  const a = keyAct(e.code);
  if (!a) return;
  e.preventDefault();
  if (DIRS[a]) {
    if (e.repeat) return;
    held.add(a);
    if (!walkT && !walkStop) { walkN = 0; walkT = setTimeout(walk, 45); }
    return;
  }
  if (e.repeat) return;
  if (a === 'saves' && /^Alt/.test(e.code)) { altCombo = false; return; }
  if (a === 'next' && e.shiftKey) { pickNext(true); return; }
  keyAction(a);
}
function onKeyUp(e) {
  const a = keyAct(e.code);
  if (a && DIRS[a]) {
    // Короткое нажатие: клавишу отпустили раньше первого шага — шагнуть сейчас
    if (walkT && walkN === 0 && held.has(a)) { clearTimeout(walkT); walk(); }
    held.delete(a);
    if (![...held].some((k) => DIRS[k])) { clearTimeout(walkT); walkT = null; walkStop = false; }
  }
  if (a === 'saves' && /^Alt/.test(e.code)) { e.preventDefault(); if (!altCombo && game && !($('#modal') && !$('#modal').hidden)) keyAction('saves'); altCombo = false; }
}
window.addEventListener('blur', () => { held.clear(); clearTimeout(walkT); walkT = null; walkStop = false; });

/* ---------- Кнопки ---------- */
async function onClick(e) {
  const mt = e.target.closest('#tblMtabs [data-mt]');
  if (mt) { mtab(mt.dataset.mt); return; }
  // Выпадающие меню панели: кнопка открывает или закрывает своё; выбор пункта закрывает меню и выполняется как обычно
  const tm = e.target.closest('[data-tmenu]');
  if (tm) { const id = tm.dataset.tmenu, was = openMenu; closeMenu(); if (was !== id) { openMenu = id; placeMenu(id); } return; }
  if (e.target.closest('.tm-pop')) closeMenu();
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
    else if (a === 'resume') { subscribe(b.dataset.id, b.dataset.code); app.toast('▶ Игра продолжается — код для игроков: <b>' + esc(b.dataset.code) + '</b>', 'crit'); }
    else if (a === 'gameDel') { if (app.confirm('Удалить игру навсегда? Сцены, существа и всё на поле пропадут.')) { await deleteGame(b.dataset.id, b.dataset.code); renderAll(); } }
    else if (a === 'zoomIn' || a === 'zoomOut') { const w = $('#tblWrap'); zoomAt(zoom * (a === 'zoomIn' ? 1.25 : 0.8), w.clientWidth / 2, w.clientHeight / 2); }
    else if (a === 'camHome') camHome();
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
    else if (a === 'enc') encDialog();
    else if (a === 'gen') genDialog();
    else if (a === 'pop') popDialog();
    else if (a === 'shop') shopDialog(selId);
    else if (a === 'bestiary') bestiaryDialog();
    else if (a === 'lootTok') tokenLootDialog(selId);
    else if (a === 'handouts') handoutsDialog();
    else if (a === 'npcEdit') { const t = game.tokens[selId]; if (t) monEditor(monFromToken(t), selId); }
    else if (a === 'loot') lootDialog();
    else if (a === 'zoomFit') zoomFit();
    else if (a === 'attack') openAttack(b.dataset.id);
    else if (a === 'aimOff') { aim = null; hint(''); renderAll(); }
    else if (a === 'spell') openCast(b.dataset.id);
    else if (a === 'npcAttack') openNpcAttack(b.dataset.id);
    else if (a === 'legend') openNpcAttack(b.dataset.id, true);
    else if (a === 'compAttack') openCompAttack(b.dataset.id);
    else if (['uncanny', 'deflect', 'rebuke', 'protect'].includes(a)) doReaction(a, b.dataset.id);
    else if (a === 'csUse') csUse(b.dataset.k, b.dataset.id);
    else if (a === 'csNo') await R.update(ref(gpath(`cs/${b.dataset.k}/no`)), { [b.dataset.id]: 1 });
    else if (a === 'items') itemsDialog();
    else if (a === 'scale') scaleDialog();
    else if (a === 'keys') keysDialog();
    else if (a === 'full') setFull(!fullOn);
    else if (a === 'travel') travelDialog();
    else if (a === 'worldBack') await worldBack();
    else if (a === 'hudSide') { $('#tblSide').classList.toggle('closed'); }
    else if (a === 'hudTab') { hudTab = b.dataset.k; ls.set('dnd55-hudtab', hudTab); renderHud(); }
    else if (a === 'hudAtk') quickAttack(b.dataset.id, b.dataset.atk);
    else if (a === 'hudSpell') { const m = me(), I = m && app.areaSpells(m.charId, Object.keys(SPELL_FX)).find((s) => s.id === b.dataset.sp); if (I) spellPick(b.dataset.id, I); }
    else if (a === 'hudSave') savesKey();
    else if (a === 'hudDrink') hudDrink(b.dataset.id, b.dataset.it);
    else if (a === 'trOpen') tradeDialog(b.dataset.k);
    else if (a === 'trDecline') await R.update(ref(gpath(`trades/${b.dataset.k}`)), { state: 'declined', by: user.uid });
    else if (a === 'trAccept') {
      if (!myChar()) { app.toast('Персонаж не найден на этом устройстве'); return; }
      await R.update(ref(gpath(`trades/${b.dataset.k}/ok`)), { [user.uid]: true });
    }
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
  if (e.target.matches('[data-tbl-brush]')) { tool = e.target.value || 'move'; renderTools(); $('#tblBoard').dataset.tool = tool; }
  if (e.target.matches('[data-tbl-num]') && game && selId) R.update(ref(gpath(`tokens/${selId}`)), { [e.target.dataset.tblNum]: Math.max(0, +e.target.value || 0) });
  if (e.target.matches('[data-tbl-sv]') && game && selId) R.update(ref(gpath(`tokens/${selId}/sv`)), { [e.target.dataset.tblSv]: +e.target.value || 0 });
});
document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
const board = $('#tblBoard');
board.addEventListener('pointerdown', onDown);
// Движение и отпускание слушаем на всём окне: палец может «уйти» с поля или с токена во время перетаскивания
window.addEventListener('pointermove', onMove);
window.addEventListener('pointerup', onUp);
window.addEventListener('pointercancel', onUp);
// Колесо — масштаб к указателю (прокрутки у поля больше нет)
$('#tblWrap').addEventListener('wheel', (e) => {
  if (!game) return;
  e.preventDefault();
  const r = $('#tblWrap').getBoundingClientRect();
  zoomAt(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
// Колёсико мыши (нажатие): без сдвига — переключить свободную камеру; с перетаскиванием — сдвинуть поле
$('#tblWrap').addEventListener('pointerdown', (e) => {
  if (e.button !== 1 || !game) return;
  e.preventDefault();
  camMid = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false, id: e.pointerId };
  try { $('#tblWrap').setPointerCapture(e.pointerId); } catch (err) { /* уже отпущен */ }
});
$('#tblWrap').addEventListener('pointermove', (e) => {
  if (!camMid || e.pointerId !== camMid.id) return;
  const dx = e.clientX - camMid.x, dy = e.clientY - camMid.y;
  if (!camMid.moved && Math.hypot(dx, dy) < 6) return;
  if (!camMid.moved) { camMid.moved = true; if (!isDM()) camSetFree(true); }
  cam.x = camMid.cx - dx; cam.y = camMid.cy - dy; layoutBoard();
});
$('#tblWrap').addEventListener('pointerup', (e) => {
  if (!camMid || e.pointerId !== camMid.id) return;
  const was = camMid; camMid = null;
  if (was.moved) return;
  if (isDM() || camFree) camHome(); else camSetFree(true);
});
// Без автопрокрутки браузера по колёсику
$('#tblWrap').addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
$('#tblWrap').addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
window.addEventListener('resize', () => { if (game) { layoutBoard(); camUpdate(); } });
renderAll();
