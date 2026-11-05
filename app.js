'use strict';

/* ---------- Утилиты ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n) => (n >= 0 ? '+' : '−') + Math.abs(n);
const mod = (v) => Math.floor(((+v || 0) - 10) / 2);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

const STORE = 'dnd55-sheet-v1';
const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
const RECHARGE = { short: 'короткий отдых', long: 'долгий отдых', none: 'вручную' };

/* ---------- Данные персонажа ---------- */
function blankChar() {
  const abil = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  return {
    id: uid(),
    updatedAt: Date.now(),
    info: { name: 'Новый персонаж', cls: '', subclass: '', level: 1, species: '', background: '', alignment: '', xp: 0, size: 'Средний', clsApplied: '' },
    abil,
    saves: Object.fromEntries(Object.keys(abil).map((k) => [k, false])),
    skills: {},
    multi: [], // дополнительные классы мультикласса: { id, cls, sub, lvl }
    combat: { ac: 10, initBonus: 0, speed: 30, hp: 10, hpMax: 10, temp: 0, hdDie: 8, hdUsed: 0, hdUsedBy: {}, deathS: 0, deathF: 0, inspiration: false, exhaustion: 0, conc: '', conditions: [], jack: false, defenses: '', round: 1 },
    armor: { mode: 'auto', id: '', shield: false, unarmored: '', bonus: 0, v: 1 },
    effects: [],
    feats: [], // { id, key, slot, a, a1, a2, mode, lvl, bg, spells, list }
    masteries: [], // виды оружия с изученными приёмами (Weapon Mastery)
    bgAbil: {}, // прибавки к характеристикам от предыстории: { str: 2, dex: 1 }
    abilSet: false, // характеристики уже заданы (генерацией, мастером или вручную) — кнопка «Генерация» скрывается
    attacks: [{ id: uid(), n: 'Безоружный удар', ability: 'str', prof: true, hit: 0, dmg: '1', addMod: true, dmgBonus: 0, type: 'дробящий', mastery: '', range: '5 фт', x: '' }],
    spellcasting: { ability: 'int', casterType: 'none', bonus: 0 },
    slots: Array.from({ length: 9 }, () => ({ max: 0, used: 0 })),
    pact: { max: 0, level: 1, used: 0 },
    spells: [], resources: [], features: [], items: [],
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    prof: { senses: '', other: '' },
    profs: { armor: [], weapons: [], tools: [], langs: ['Общий'] }, // владения из списков
    profPicks: [], // невыбранные владения: { id, kind: 'tool'|'lang', cats, n, src, inv }
    notes: { traits: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '', allies: '', journal: '' },
  };
}
function deepFill(t, s) {
  for (const k in s) {
    if (t[k] === undefined || t[k] === null) t[k] = s[k];
    else if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && typeof t[k] === 'object') deepFill(t[k], s[k]);
  }
}
function parseOldProfs(p) {
  const profs = { armor: [], weapons: [], tools: [], langs: [] }, picks = [], rest = [];
  const add = (k, v) => { if (!profs[k].includes(v)) profs[k].push(v); };
  const a = String(p.armor || '');
  if (/все доспехи/i.test(a)) ['Лёгкие доспехи', 'Средние доспехи', 'Тяжёлые доспехи'].forEach((v) => add('armor', v));
  else { if (/л[её]гк/i.test(a)) add('armor', 'Лёгкие доспехи'); if (/средн/i.test(a)) add('armor', 'Средние доспехи'); if (/тяж[её]л/i.test(a)) add('armor', 'Тяжёлые доспехи'); }
  if (/щит/i.test(a)) add('armor', 'Щиты');
  const w = String(p.weapons || '');
  if (/прост/i.test(w)) add('weapons', 'Простое оружие');
  if (/воинск/i.test(w)) add('weapons', /фехтов/i.test(w) ? 'Воинское оружие со свойством «Фехтовальное» или «Лёгкое»' : /л[её]гк/i.test(w) ? 'Воинское оружие со свойством «Лёгкое»' : 'Воинское оружие');
  WEAPONS.forEach((x) => { if (w.toLowerCase().includes(x.n.toLowerCase())) add('weapons', x.n); });
  String(p.tools || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const t = TOOLS.find((x) => x.n.toLowerCase() === s.toLowerCase());
    if (t) add('tools', t.n);
    else if (BG_TOOL_PICK[s]) picks.push({ id: uid(), kind: 'tool', cats: BG_TOOL_PICK[s], n: 1, src: 'прежний лист', inv: false });
    else if (/музыкальн/i.test(s)) picks.push({ id: uid(), kind: 'tool', cats: /ремесл/i.test(s) ? ['artisan', 'music'] : ['music'], n: /три/i.test(s) ? 3 : 1, src: 'прежний лист', inv: false });
    else rest.push(`Инструменты: ${s}`);
  });
  String(p.languages || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const l = [...LANGS.standard, ...LANGS.rare].find((x) => x.toLowerCase() === s.toLowerCase());
    if (l) add('langs', l);
    else if (/два языка/i.test(s)) picks.push({ id: uid(), kind: 'lang', cats: ['standard'], n: 2, src: 'создание персонажа', inv: false });
    else rest.push(`Языки: ${s}`);
  });
  const other = [p.other, ...rest].filter(Boolean).join('\n');
  if (!profs.langs.length) profs.langs.push('Общий');
  return { profs, profPicks: picks, prof: { senses: p.senses || '', other } };
}
/* ---------- Владения ---------- */
const PROF_KINDS = { armor: 'Доспехи', weapons: 'Оружие', tools: 'Инструменты', langs: 'Языки' };
// Инструмент в инвентарь (если его там ещё нет)
function addToolItem(c, name) {
  const t = TOOLS.find((x) => x.n === name);
  if (c.items.some((i) => i.n === name)) return false;
  addInvItem(c, { n: name, cat: 'Снаряжение', w: t ? t.w : 0, cost: t ? t.cost : '', x: 'Инструмент: владение позволяет добавлять бонус мастерства к проверкам с ним.' });
  return true;
}
function addProf(c, kind, v, inv) {
  if (!c.profs[kind].includes(v)) c.profs[kind].push(v);
  if (kind === 'tools' && inv) addToolItem(c, v);
}
// Варианты для невыбранного владения: инструменты нужных категорий или языки, которых ещё нет
function pickOptions(c, p) {
  if (p.kind === 'tool') return TOOLS.filter((t) => p.cats.includes(t.cat) && !c.profs.tools.includes(t.n)).map((t) => t.n);
  return p.cats.flatMap((k) => LANGS[k] || []).filter((l) => !c.profs.langs.includes(l));
}
function resolvePick(c, id, v) {
  const p = c.profPicks.find((x) => x.id === id);
  if (!p) return;
  addProf(c, p.kind === 'tool' ? 'tools' : 'langs', v, p.inv);
  p.n -= 1;
  c.profPicks = c.profPicks.filter((x) => x.n > 0);
  toast(`Добавлено: ${esc(v)}${p.kind === 'tool' && p.inv ? ' — и в инвентарь' : ''}`);
}
const addPick = (c, kind, cats, n, src, inv) => c.profPicks.push({ id: uid(), kind, cats, n, src, inv: !!inv });
// Владения класса на 1 уровне (новый персонаж)
function applyClassProfs(c, cls) {
  const P = CLASS_PROFS[cls] || {};
  (P.armor || []).forEach((v) => addProf(c, 'armor', v));
  (P.weapons || []).forEach((v) => addProf(c, 'weapons', v));
  (P.tools || []).forEach((v) => addProf(c, 'tools', v, true));
  (P.langs || []).forEach((v) => addProf(c, 'langs', v));
  if (P.toolPick) addPick(c, 'tool', P.toolPick.cats, P.toolPick.n, cls, cls === 'Монах');
  if (P.langPick) addPick(c, 'lang', P.langPick.cats, P.langPick.n, cls);
}
function renderProfs() {
  const c = ch(), kindN = { tool: 'инструмент', lang: 'язык' };
  $('#profPicks').innerHTML = c.profPicks.map((p) => `<div class="prof-pick"><span>Выберите ${kindN[p.kind]}${p.n > 1 ? ` (ещё ${p.n})` : ''}${p.cats.length && p.kind === 'tool' ? ` — ${p.cats.map((k) => TOOL_CATS[k].toLowerCase()).join(' или ')}` : ''} <span class="muted small">· ${esc(p.src)}${p.inv ? ', попадёт в инвентарь' : ''}</span></span>
      <select data-pick="${p.id}"><option value="">— выбрать —</option>${pickOptions(c, p).map((v) => `<option>${esc(v)}</option>`).join('')}</select>
      <button class="ghost" data-act="pickDrop" data-id="${p.id}" title="Не выбирать">✕</button></div>`).join('');
  const optsFor = (kind) => {
    const have = new Set(c.profs[kind]);
    const opt = (v) => (have.has(v) ? '' : `<option>${esc(v)}</option>`);
    if (kind === 'armor') return ARMOR_PROFS.map(opt).join('');
    if (kind === 'weapons') return `<optgroup label="Группы">${WEAPON_PROF_GROUPS.map(opt).join('')}</optgroup>`
      + Object.entries(WEAPON_CATS).map(([k, t]) => `<optgroup label="${t}">${WEAPONS.filter((w) => w.cat === k).map((w) => opt(w.n)).join('')}</optgroup>`).join('');
    if (kind === 'tools') return Object.entries(TOOL_CATS).map(([k, t]) => `<optgroup label="${t}">${TOOLS.filter((x) => x.cat === k).map((x) => opt(x.n)).join('')}</optgroup>`).join('');
    return `<optgroup label="Стандартные">${LANGS.standard.map(opt).join('')}</optgroup><optgroup label="Редкие">${LANGS.rare.map(opt).join('')}</optgroup>`;
  };
  $('#profBox').innerHTML = Object.entries(PROF_KINDS).map(([kind, title]) => `<div class="prof-sec"><h3>${title}</h3><div class="chips">
      ${c.profs[kind].map((v) => `<span class="chip"><span>${esc(v)}</span>${kind === 'tools' && !c.items.some((i) => i.n === v) ? `<button data-act="profInv" data-v="${esc(v)}" title="Добавить в инвентарь">🎒</button>` : ''}<button data-act="profDel" data-k="${kind}" data-v="${esc(v)}" title="Убрать">✕</button></span>`).join('')}
      <select class="prof-add" data-k="${kind}"><option value="">＋ добавить</option>${optsFor(kind)}</select></div></div>`).join('');
}
function migrate(c) {
  const old = { armorV: c.armor && c.armor.v, clsApplied: c.info && c.info.clsApplied, abilSet: c.abilSet, profs: c.profs };
  // Старые текстовые поля владений → списки (нераспознанное — в «Прочие владения»)
  if (!old.profs && c.prof) Object.assign(c, parseOldProfs(c.prof));
  // У старых персонажей характеристики считаются заданными, если хоть одна отличается от 10
  if (old.abilSet === undefined && c.abil) c.abilSet = Object.values(c.abil).some((v) => +v !== 10);
  deepFill(c, blankChar());
  // Авто-КД стал режимом по умолчанию: старых персонажей переводим, только если ручной КД
  // не задан (10) или совпадает с расчётом — иначе там учтено что-то, чего сайт не знает
  if (!old.armorV) {
    const ac = +c.combat.ac;
    c.armor.mode = c.armor.mode === 'auto' || ac === 10 || computeAC(c).ac === ac ? 'auto' : 'manual';
    c.armor.v = 1;
  }
  // У старых персонажей шаблон класса уже применён (или настроен вручную) — не переприменяем
  if (old.clsApplied === undefined) c.info.clsApplied = c.info.cls.trim();
  c.features.forEach((f) => { if (f.src === 'Вид') f.src = 'Раса'; }); // «Вид» переименован в «Раса»
  return c;
}

let state;
function loadState() {
  try { state = JSON.parse(lsGet(STORE)); } catch (e) { state = null; }
  if (!state || !state.chars || !Object.keys(state.chars).length) {
    const c = blankChar();
    state = { current: c.id, chars: { [c.id]: c } };
  }
  Object.values(state.chars).forEach(migrate);
  if (!state.chars[state.current]) state.current = Object.keys(state.chars)[0];
}
let saveTimer;
const dirty = new Set(); // id персонажей, изменённых с последней отправки в облако
// touch=false — сохранить локально, не помечая персонажа изменённым (например, данные пришли из облака)
function save(touch = true) {
  if (touch && ch()) { ch().updatedAt = Date.now(); dirty.add(ch().id); }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!lsSet(STORE, JSON.stringify(state))) toast('⚠ Не удалось сохранить в браузере — сделайте экспорт');
    dirty.forEach((id) => { if (state.chars[id] && window.dndSync) window.dndSync.push(state.chars[id]); });
    dirty.clear();
  }, 250);
}
const ch = () => state.chars[state.current];

// Мост для sync.js (облачная синхронизация)
window.dndApp = {
  chars: () => state.chars,
  // docs: [{ id, deleted, updatedAt, data }] — побеждает более позднее изменение
  applyRemote(docs) {
    let changed = false;
    docs.forEach((d) => {
      const local = state.chars[d.id];
      const localAt = local ? local.updatedAt || 0 : 0;
      if (d.deleted) {
        if (local && localAt <= d.updatedAt) { delete state.chars[d.id]; changed = true; }
      } else if (!local || localAt < d.updatedAt) {
        state.chars[d.id] = migrate(d.data); changed = true;
        delete undoStacks[d.id]; // история отмены относится к прежней версии
      }
    });
    if (!changed) return;
    if (!Object.keys(state.chars).length) { const n = blankChar(); state.chars[n.id] = n; }
    if (!state.chars[state.current]) state.current = Object.keys(state.chars)[0];
    save(false); render();
    if (curTab === 'ref') renderRef();
  },
  toast: (html, cls) => toast(html, cls),
  openModal: (html) => openModal(html),
  closeModal: () => closeModal(),
  // Для игрового стола: сводка персонажа, бросок инициативы, отсчёт раунда в начале своего хода
  summary(id) {
    const c = state.chars[id];
    if (!c) return null;
    const cb = c.combat;
    return { name: (c.info.name || 'Без имени') + (c.shape ? ` (${c.shape.n})` : ''), img: c.info.portrait || '', cls: classLabel(c), hp: +cb.hp || 0, hpMax: +cb.hpMax || 1, temp: +cb.temp || 0, ac: +cb.ac || 10,
      cond: [...cb.conditions, ...(cb.exhaustion ? [`истощение ${cb.exhaustion}`] : [])], conc: cb.conc || '', speed: curSpeed(c), init: initBonus(c), size: c.info.size || 'Средний',
      // Рывок и Отход бонусным действием: Хитрое действие плута, Шаг ветра / Терпеливая оборона монаха
      bonus: clsLvl(c, 'Плут') >= 2 || clsLvl(c, 'Монах') >= 2 ? ['dash', 'dis'] : [], atks: attacksPerAction(c), evasion: hasEvasion(c), dsS: +cb.deathS || 0, dsF: +cb.deathF || 0,
      dv: +((String(c.prof.senses || '').match(/тёмное зрение\D*(\d+)/i) || [])[1] || 0),
      // Спасброски Силы и Ловкости — цель захвата или толчка выбирает лучший
      svs: [saveBonus(c, 'str'), saveBonus(c, 'dex')], grapDC: 8 + am(c, 'str') + pb(c),
      // «Контрзаклинание» наготове (подготовлено и есть ячейка 3+ уровня) и спасбросок Телосложения — против чужого
      cs: reactSlots(c, 'Counterspell').length > 0, svc: saveBonus(c, 'con'), lvl: lvl(c) };
  },
  // Добыча со стола: золото — в кошелёк, магический предмет — как из каталога, прочее — в инвентарь; возвращает название
  addLoot(id, L) {
    const c = state.chars[id];
    if (!c || !L) return null;
    if (state.current !== id) state.current = id;
    let name = '';
    tracked('добыча', () => { name = lootInto(c, L); });
    save(); render();
    return name;
  },
  // Покупка у торговца на столе: хватает денег — платим (сдача монетами) и кладём товар в инвентарь
  buy(id, L, price) {
    const c = state.chars[id];
    if (!c || !L) return null;
    if (state.current !== id) state.current = id;
    if (coinGp(c.coins) + 1e-9 < price) return { ok: false, left: coinGp(c.coins) };
    let name = '';
    tracked(`покупка: ${L.n}`, () => { payCoins(c, price); name = lootInto(c, L); });
    save(); render();
    return { ok: true, name, left: +coinGp(c.coins).toFixed(2) };
  },
  purse(id) { const c = state.chars[id]; return c ? +coinGp(c.coins).toFixed(2) : 0; },
  // Вещи для стола (передача, обмен, продажа, «бросить на землю»): инвентарь и кошелёк в золоте
  inventory(id) {
    const c = state.chars[id];
    if (!c) return null;
    return { items: c.items.map((i) => ({ id: i.id, n: i.n, qty: +i.qty || 1, cat: i.cat || '', cost: i.cost || '', att: !!i.att, eq: !!i.eq, heal: i.heal || '' })), gp: +coinGp(c.coins).toFixed(2) };
  },
  // Забрать из листа предметы [{ id, qty }] и золото. Возвращает снимки предметов для получателя (с атакой магического оружия)
  // или null, если чего-то уже нет
  takeItems(id, list = [], gp = 0) {
    const c = state.chars[id];
    if (!c || (+gp || 0) > coinGp(c.coins) + 1e-9) return null;
    if (list.some(({ id: iid, qty }) => { const it = findById(c.items, iid); return !it || (+it.qty || 1) < (+qty || 1); })) return null;
    if (state.current !== id) state.current = id;
    const out = [];
    tracked('передача вещей', () => {
      list.forEach(({ id: iid, qty }) => {
        const it = findById(c.items, iid), q = Math.min(+it.qty || 1, +qty || 1);
        const atk = c.attacks.filter((a) => a.item === it.id).map(({ id: _a, item: _b, ...a }) => a);
        const { id: _c, attuned: _d, ...snap } = it;
        out.push({ ...snap, qty: q, eq: false, ...(atk.length ? { atk } : {}) });
        if (q >= (+it.qty || 1)) { c.items = c.items.filter((x) => x !== it); c.attacks = c.attacks.filter((a) => a.item !== it.id); } else it.qty = (+it.qty || 1) - q;
      });
      if (+gp > 0) payCoins(c, +gp);
    });
    save(); render();
    return out;
  },
  // Положить в лист снимки предметов (обычные — стопкой к таким же) и золото
  giveItems(id, snaps = [], gp = 0) {
    const c = state.chars[id];
    if (!c) return false;
    if (state.current !== id) state.current = id;
    tracked('получение вещей', () => {
      (snaps || []).forEach((S) => putSnap(c, S));
      if (+gp > 0) addCoins(c, +gp);
    });
    save(); render();
    return true;
  },
  // Заклинания с областью или спасброском: подготовленные, всегда подготовленные и заговоры
  // extra — английские названия заклинаний, которые стол умеет применять без области (лечение, баффы)
  areaSpells(id, extra = []) {
    const c = state.chars[id];
    if (!c) return [];
    const plain = (s) => ({ shape: 'target', size: 0, width: 5, save: '', half: false, self: false, range: /касан/i.test(s.r || '') ? 5 : parseInt(s.r) || 0,
      dtype: dmgWord(s.x), act: /бонусн/i.test(s.t || '') ? 'bonus' : /реакц/i.test(s.t || '') ? 'reaction' : 'action', pick: false });
    return c.spells.filter((s) => +s.l === 0 || s.prep || s.always).map((s) => ({ s, a: spellArea(s) || (extra.includes(s.e) ? plain(s) : null) })).filter((x) => x.a)
      .map(({ s, a }) => ({ id: s.id, e: s.e || '', n: s.n, l: +s.l, f: s.f || '', u: s.u || '', addMod: !!s.addMod, cn: !!s.cn, dur: s.d || '', comp: s.c || '', dc: spellDCFor(c, s), slots: slotOptions(c, s), ...a }));
  },
  // Портрет персонажа (маленький JPEG) — хранится в листе, стол показывает его на токене
  setPortrait(id, data) { const c = state.chars[id]; if (!c) return; c.info.portrait = data || ''; c.updatedAt = Date.now(); if (c === ch()) { save(); render(); } else lsSet(STORE, JSON.stringify(state)); },
  // Спутники: список для стола и изменение хитов (урон/лечение со стола)
  companions(id) { const c = state.chars[id]; return c ? (c.companions || []) : []; },
  compHp(id, compId, delta) {
    const c = state.chars[id], p = c && (c.companions || []).find((x) => x.id === compId);
    if (!p) return;
    if (state.current !== id) state.current = id;
    tracked(delta < 0 ? 'урон спутнику' : 'лечение спутника', () => { p.hp = clamp(p.hp + delta, 0, p.hpMax); });
    save(); render();
  },
  // Боевые возможности для окна атаки на столе: приёмы превосходства, Божественная кара, Скрытая атака, «Щит»
  combatOpts(id) {
    const c = state.chars[id];
    if (!c) return {};
    const sup = c.resources.find((x) => x.auto === 'superiority');
    const smite = c.spells.find((s) => s.e === 'Divine Smite' && (s.prep || s.always));
    const shield = c.spells.find((s) => s.e === 'Shield' && (s.prep || s.always));
    const M = clsLvl(c, 'Монах'), focus = c.resources.find((x) => x.auto === 'focus');
    return {
      maneuvers: sup ? ((c.cpicks || {}).man || []) : [], supLeft: sup ? sup.max - sup.used : 0, supDie: supDie(c),
      smiteSlots: smite ? slotOptions(c, smite).filter((s) => s.left > 0 && s.key !== 'free' && s.key !== 'ritual') : [],
      sneak: Math.ceil(clsLvl(c, 'Плут') / 2),
      shieldSlots: shield ? slotOptions(c, shield).filter((s) => s.left > 0 && s.key !== 'free' && s.key !== 'ritual') : [], shieldId: shield ? shield.id : '',
      grapDC: 8 + am(c, 'str') + pb(c), svStr: saveBonus(c, 'str'), svDex: saveBonus(c, 'dex'),
      // Реакции: «Адское возмездие», «Контрзаклинание», Невероятное уклонение (плут 5), Отражение атак (монах 3),
      // боевой стиль «Защита» (нужен щит в руке)
      rebukeSlots: reactSlots(c, 'Hellish Rebuke'), counterSlots: reactSlots(c, 'Counterspell'),
      uncanny: clsLvl(c, 'Плут') >= 5, protection: hasFeat(c, 'protection') && !!c.armor.shield,
      deflect: M >= 3 ? { any: M >= 13, focus: focus ? focus.max - focus.used : 0, dc: 8 + am(c, 'wis') + pb(c), die: M >= 17 ? 12 : M >= 11 ? 10 : M >= 5 ? 8 : 6, dex: am(c, 'dex') } : null,
    };
  },
  // Заклинание-реакция со стола («Адское возмездие», «Контрзаклинание»): тратит ячейку (по умолчанию — самую низкую)
  castReaction(id, e, slotKey) {
    if (!state.chars[id]) return null;
    if (state.current !== id) state.current = id;
    const c = ch(), s = c.spells.find((x) => x.e === e && (+x.l === 0 || x.prep || x.always)), key = slotKey || (reactSlots(c, e)[0] || {}).key;
    if (!s || !key) return null;
    let r = null;
    tracked(s.n, () => { r = { ...spendSlot(c, s, key), dc: spellDCFor(c, s), n: s.n }; });
    save(); render();
    return r;
  },
  // Отражение атак: урон уменьшается на 1к10 + Лов + уровень монаха
  deflect(id) {
    if (!state.chars[id]) return null;
    if (state.current !== id) state.current = id;
    const c = ch(), r = rollDice('Отражение атак', `1d10+${am(c, 'dex') + clsLvl(c, 'Монах')}`);
    return r ? { total: Math.max(0, r.total), detail: r.detail } : null;
  },
  spendFocus(id, n = 1) {
    const c = state.chars[id], f = c && c.resources.find((x) => x.auto === 'focus');
    if (!f || f.max - f.used < n) return false;
    if (state.current !== id) state.current = id;
    tracked('очки сосредоточенности', () => { f.used += n; });
    save(); render();
    return true;
  },
  // Проверка со стола: навык или характеристика; tool — владение инструментом добавляет бонус мастерства (воровские инструменты)
  check(id, o) {
    if (!state.chars[id]) return null;
    if (state.current !== id) state.current = id;
    const c = ch(), S = o.skill && SKILLS.find((s) => s.k === o.skill), abil = S ? S.a : o.abil;
    const tool = !!o.tool && (c.profs.tools || []).some((t) => new RegExp(o.tool, 'i').test(t));
    const r = rollD20(`${o.label}${tool ? ' (с инструментами)' : ''}`, (S ? skillBonus(c, S) : am(c, abil)) + (tool ? pb(c) : 0), { kind: 'check', abil, ...(S ? { skill: S.k } : {}), dc: o.dc });
    save(); render();
    return { total: r.total, ok: r.total >= o.dc, tool };
  },
  // Вырваться из захвата: проверка Атлетики или Акробатики (что лучше) против СЛ
  escape(id, dc) {
    if (!state.chars[id]) return null;
    if (state.current !== id) state.current = id;
    const c = ch(), ath = SKILLS.find((s) => s.k === 'athletics'), acr = SKILLS.find((s) => s.k === 'acrobatics');
    const s = skillBonus(c, ath) >= skillBonus(c, acr) ? ath : acr;
    const r = rollD20(`Вырваться из захвата (${s.n}, СЛ ${dc})`, skillBonus(c, s), { kind: 'check', abil: s.a, skill: s.k, dc });
    save(); render();
    return { total: r.total, ok: r.total >= dc, skill: s.n };
  },
  // «Щит» реакцией: тратит ячейку, как в листе
  castShield(id, slotKey) {
    if (!state.chars[id]) return null;
    if (state.current !== id) state.current = id;
    const c = ch(), s = c.spells.find((x) => x.e === 'Shield');
    if (!s) return null;
    let r = null;
    tracked('Щит', () => { r = spendSlot(c, s, slotKey); toast('🛡 Щит: +5 КД до начала вашего хода'); });
    save(); render();
    return r;
  },
  // Выполнить fn без отправки бросков в общий журнал (стол пишет туда сам)
  mute(fn) { rollMute++; try { return fn(); } finally { rollMute--; } },
  // Отдых, объявленный мастером на столе
  longRest(id) { if (!state.chars[id]) return; if (state.current !== id) state.current = id; tracked('долгий отдых', () => doLongRest(ch())); save(); render(); },
  shortRest(id) { if (!state.chars[id]) return; if (state.current !== id) { state.current = id; render(); } ACT.shortRest(); },
  // Опыт со стола; canLevel — хватает на следующий уровень
  addXp(id, n) {
    const c = state.chars[id];
    if (!c || !(n > 0)) return null;
    if (state.current !== id) state.current = id;
    tracked('опыт', () => { c.info.xp = (+c.info.xp || 0) + n; });
    save(); render();
    const L = lvl(c);
    return { xp: c.info.xp, canLevel: L < 20 && c.info.xp >= XP_TABLE[L] };
  },
  openLevelUp(id) {
    if (!state.chars[id]) return;
    if (state.current !== id) { state.current = id; render(); }
    openLevelUp();
  },
  heal(id, n) {
    if (!state.chars[id] || !(n > 0)) return;
    if (state.current !== id) state.current = id;
    tracked('лечение', () => applyHeal(n));
    save(); render();
  },
  // Сотворить со стола: ячейка, концентрация и эффекты — как в листе; возвращает бросок урона (или null)
  castArea(id, spellId, slotKey) {
    if (!state.chars[id]) return null;
    if (state.current !== id) { state.current = id; render(); }
    const c = ch(), s = findById(c.spells, spellId);
    if (!s) return null;
    let out = null;
    tracked(`сотворение: ${s.n}`, () => {
      const { castLvl, how } = spendSlot(c, s, slotKey);
      const r = doCast(s, castLvl, how);
      out = { castLvl, how, dmg: r ? Math.max(0, r.total) : 0, dmgDetail: r ? r.detail : '', expr: r ? r.expr : '' };
    });
    save(); render();
    return out;
  },
  // Концентрация прервана со стола (Метель, Землетрясение)
  dropConc(id) {
    const c = state.chars[id];
    if (!c || !c.combat.conc) return;
    if (state.current !== id) state.current = id;
    toast(`Концентрация на «${esc(c.combat.conc)}» прервана`, 'fumble');
    endConc(c); pendingConc = 0; save(); render();
  },
  // Концентрация: ждёт ли спасбросок после урона (СЛ) и бросок со стола
  concPending(id) { const c = state.chars[id]; return c && state.current === id && c.combat.conc ? pendingConc : 0; },
  concRoll(id) {
    const c = state.chars[id];
    if (!c) return null;
    if (state.current !== id) state.current = id;
    const dc = pendingConc || 10, spell = c.combat.conc;
    const r = rollD20(`Концентрация (СЛ ${dc})`, saveBonus(c, 'con'), { dc, kind: 'save', abil: 'con', conc: true });
    const ok = r.total >= dc;
    if (!ok && spell) { toast(`Концентрация на «${esc(spell)}» потеряна`, 'fumble'); endConc(c); }
    pendingConc = 0;
    save(); render();
    return { total: r.total, dc, ok, spell, detail: r.detail || '' };
  },
  rollSave(id, abil, dc, o = {}) {
    if (!state.chars[id]) return null;
    if (state.current !== id) { state.current = id; render(); }
    const c = ch(), a = ABILITIES.find((x) => x.k === abil);
    const r = rollD20(`Спасбросок: ${a ? a.n : abil}${o.label ? ` — ${o.label}` : ''}`, saveBonus(c, abil), { kind: 'save', abil, dc, adv: o.adv, dis: o.dis, dice: o.dice });
    save(); render();
    return { total: r.total, nat: r.nat, ok: r.total >= dc, detail: r.detail || 'автоматический провал' };
  },
  rollFormula(expr, label) { const r = rollDice(label || 'Бросок', expr); return r ? { total: Math.max(0, r.total), detail: r.detail } : null; },
  attacks(id) { const c = state.chars[id]; return c ? tableAttacks(c) : []; },
  // Атака по цели со стола: бросок с преимуществом/помехой от обстановки, при попадании — урон (крит удваивает кости)
  attack(id, atkId, o = {}) {
    if (!state.chars[id]) return null;
    if (state.current !== id) { state.current = id; render(); }
    const c = ch(), A = tableAttacks(c).find((x) => x.id === atkId), a = findById(c.attacks, atkId);
    if (!A) return null;
    let res = null;
    tracked(`атака: ${A.n}`, () => {
      if (!spendAmmo(c, a)) return;
      // Приём превосходства (Мастер боевых искусств): «Точная атака» — кость к броску атаки, остальные — к урону при попадании
      const sup = o.maneuver && c.resources.find((x) => x.auto === 'superiority' && x.used < x.max), sd = `1d${supDie(c)}`;
      const dice = [...(o.dice || []), ...(sup && o.maneuver === 'Точная атака' ? [{ e: sd, n: 'Точная атака' }] : [])];
      if (sup && o.maneuver === 'Точная атака') sup.used += 1;
      const r = rollD20(`${A.n} → ${o.target || 'цель'}`, A.bonus, { attack: true, kind: 'attack', weapon: !A.spell, adv: o.adv, dis: o.dis, ac: o.ac, dice });
      const hit = r.nat !== 1 && (r.crit || r.total >= o.ac);
      const crit = hit && (r.crit || !!o.autoCrit);
      let expr = A.beast ? (crit ? scaleDice(A.dmg, 2) : A.dmg) : A.cantrip ? withMod(crit ? scaleDice(A.dice, 2) : A.dice, A.mod) : A.dmg ? dmgExpr(c, a, crit) : '';
      const extra = [], X = (e) => (crit ? scaleDice(e, 2) : e);
      // Скрытая атака: раз в ход, фехтовальное или дальнобойное, есть преимущество или союзник рядом с целью (и нет помехи)
      const sneakDice = Math.ceil(clsLvl(c, 'Плут') / 2);
      if (hit && o.sneakOk && sneakDice && A.fin && (r.mode > 0 || (o.allyNear && r.mode === 0))) { expr += `+${X(`${sneakDice}d6`)}`; extra.push('Скрытая атака'); }
      // Божественная кара: ячейка тратится только при попадании, 2к8 + 1к8 за уровень выше 1
      let smite = 0;
      const smSpell = o.smite && c.spells.find((s) => s.e === 'Divine Smite');
      if (hit && smSpell && !A.spell) { smite = spendSlot(c, smSpell, o.smite).castLvl || 1; expr += `+${X(`${1 + smite}d8`)}`; extra.push(`Божественная кара (${smite} ур.)`); }
      if (hit && sup && o.maneuver !== 'Точная атака') { sup.used += 1; expr += `+${X(sd)}`; extra.push(o.maneuver); }
      let d = null;
      if (hit && expr) d = rollDice(`${crit ? 'КРИТ ' : ''}Урон: ${A.n}${A.type ? ` (${A.type})` : ''}${extra.length ? ` + ${extra.join(', ')}` : ''}`, expr);
      ammoWarn(c, a);
      // Приём оружия: ключ, СЛ спасброска (8 + модификатор атаки + БМ) и модификатор (урон «Задевания»)
      const mk = a && masteryActive(c, a) ? a.mastery : '';
      res = { total: r.total, nat: r.nat, detail: r.detail, hit, crit, dmg: d ? Math.max(0, d.total) : 0, dmgDetail: d ? d.detail : '', type: A.type,
        mastery: mk, mdc: a ? 8 + abilFor(c, a) + pb(c) : 0, mmod: a ? abilFor(c, a) : 0, extra,
        sneak: extra.includes('Скрытая атака'), smite, man: sup ? o.maneuver : '', manDC: 8 + pb(c) + Math.max(am(c, 'str'), am(c, 'dex')), repel: !!A.repel && hit };
    });
    save(); render();
    return res;
  },
  takeDamage(id, n, crit) {
    if (!state.chars[id] || !(n > 0)) return;
    if (state.current !== id) state.current = id;
    tracked('урон', () => applyDamage(n, crit));
    save(); render();
  },
  // Спасбросок от смерти со стола (в начале хода персонажа без сознания)
  deathSave(id) {
    if (!state.chars[id]) return null;
    if (state.current !== id) state.current = id;
    let r = null;
    tracked('спасбросок от смерти', () => { r = doDeathSave(ch()); });
    save(); render();
    return r;
  },
  setCond(id, k, on) {
    const c = state.chars[id];
    if (!c || c.combat.conditions.includes(k) === !!on) return;
    c.combat.conditions = on ? [...c.combat.conditions, k] : c.combat.conditions.filter((x) => x !== k);
    if (c === ch()) { save(); render(); } else { c.updatedAt = Date.now(); lsSet(STORE, JSON.stringify(state)); }
  },
  rollInit(id) {
    if (state.current !== id && state.chars[id]) { state.current = id; render(); }
    return rollD20('Инициатива', initBonus(ch()), { kind: 'init', abil: 'dex' }).total;
  },
  tickRound(id) {
    const c = state.chars[id];
    if (!c) return;
    c.combat.round = (+c.combat.round || 1) + 1;
    advanceEffects(c, 1);
    if (c === ch()) { save(); render(); } else { c.updatedAt = Date.now(); lsSet(STORE, JSON.stringify(state)); }
  },
  esc: (s) => esc(s),
  confirm: (t) => confirmBox(t),
};

/* ---------- Производные значения ---------- */
// Поле «Уровень» — уровень основного класса; дополнительные классы мультикласса в c.multi.
// lvl(c) — общий уровень персонажа (бонус мастерства, заговоры, кости хитов), clsLvl — уровень в классе.
const pLvl = (c) => clamp(parseInt(c.info.level) || 1, 1, 20);
// Повторяющийся класс в мультиклассе не учитывается; подкласс действует, только если он относится к этому классу
// и уровень именно этого класса дошёл до уровня подкласса (для классов не из списка — как вписано)
function classList(c) {
  const seen = new Set();
  return [{ cls: c.info.cls.trim(), sub: c.info.subclass || '', lvl: pLvl(c), primary: true },
    ...(c.multi || []).map((m) => ({ cls: String(m.cls || '').trim(), sub: m.sub || '', lvl: clamp(parseInt(m.lvl) || 1, 1, 20), id: m.id }))]
    .filter((e) => { if (!e.cls) return !!e.primary; if (seen.has(e.cls)) return false; seen.add(e.cls); return true; })
    .map((e) => ({ ...e, sub: subAllowed(e) ? e.sub : '' }));
}
const subAllowed = (e) => !SUBCLASSES[e.cls] || (e.lvl >= subclassLevel(e.cls) && !!subclassOf(e.cls, e.sub));
// Выпадающий список подклассов только своего класса; до уровня подкласса — недоступен
function fillSubSelect(sel, txt, cls, L, val) {
  const list = SUBCLASSES[cls];
  if (!list) { sel.hidden = true; if (txt) txt.hidden = false; return; }
  sel.hidden = false;
  if (txt) txt.hidden = true;
  const need = subclassLevel(cls), locked = L < need, valid = list.some((s) => s.n === val);
  const sig = [cls, locked, val, valid].join('|');
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  sel.disabled = locked;
  sel.title = locked ? `Подкласс выбирается на ${need} уровне класса «${cls}»` : '';
  sel.innerHTML = locked ? `<option value="${esc(val)}">с ${need} уровня класса</option>`
    : `<option value="">— выберите —</option>${list.map((s) => `<option ${s.n === val ? 'selected' : ''}>${s.n}</option>`).join('')}${val && !valid ? `<option value="${esc(val)}" selected>⚠ ${esc(val)} — не подкласс класса «${cls}»</option>` : ''}`;
}
// Список классов для строки мультикласса: без уже выбранных в других строках
function fillClassSelect(sel, c, m) {
  const used = new Set([c.info.cls.trim(), ...c.multi.filter((x) => x !== m).map((x) => String(x.cls || '').trim())]);
  const opts = Object.keys(CLASSES).filter((n) => !used.has(n) || n === m.cls);
  const dup = m.cls && used.has(m.cls);
  const sig = opts.join('|') + (dup ? '!' : '');
  if (sel.dataset.sig === sig) return;
  sel.dataset.sig = sig;
  sel.innerHTML = `<option value="">— класс —</option>${opts.map((n) => `<option>${n}</option>`).join('')}${dup ? `<option value="${esc(m.cls)}">⚠ ${esc(m.cls)} — уже есть, не учитывается</option>` : ''}`;
}
const lvl = (c) => clamp(classList(c).reduce((s, e) => s + e.lvl, 0), 1, 20);
const clsLvl = (c, n) => classList(c).filter((e) => e.cls === n).reduce((s, e) => s + e.lvl, 0);
const isMulti = (c) => (c.multi || []).length > 0;
const classLabel = (c) => classList(c).filter((e) => e.cls).map((e) => `${e.cls}${e.sub ? ` (${e.sub})` : ''} ${e.lvl}`).join(' / ');
// Кость хитов класса (основной класс — из поля «Кость хитов», т.к. её можно поправить вручную)
const hdOf = (c, e) => (e.primary ? +c.combat.hdDie : (CLASSES[e.cls] || {}).hd || 8);
// Запасы костей хитов по размеру кости: [{ die, total, used }]
function hitDicePools(c) {
  if (!isMulti(c)) return [{ die: +c.combat.hdDie, total: lvl(c), used: clamp(+c.combat.hdUsed || 0, 0, lvl(c)) }];
  const by = {};
  classList(c).forEach((e) => { const d = hdOf(c, e); by[d] = (by[d] || 0) + e.lvl; });
  return Object.keys(by).map(Number).sort((a, b) => b - a)
    .map((d) => ({ die: d, total: by[d], used: clamp(+(c.combat.hdUsedBy || {})[d] || 0, 0, by[d]) }));
}
const pb = (c) => 2 + Math.floor((lvl(c) - 1) / 4);
const hasFeat = (c, key) => c.feats.some((f) => f.key === key);
// Прибавки к характеристике от черт: обычные (до 20) и эпические дары (до 30)
function featAbilBonus(c, k) {
  let gen = 0, epic = 0;
  c.feats.forEach((f) => {
    const d = FEATS_BY[f.key];
    if (!d || !d.abil) return;
    const add = d.abil === 'asi' ? (f.mode === 'plus11' ? (f.a1 === k) + (f.a2 === k) : f.a1 === k ? 2 : 0) : f.a === k ? 1 : 0;
    if (d.cat === 'epic') epic += add; else gen += add;
  });
  return { gen, epic };
}
// Итоговое значение характеристики: базовое (введённое) + предыстория + черты + умение 20 уровня
function score(c, k) {
  // Дикий облик: Сила, Ловкость и Телосложение — зверя
  if (c.shape && SHAPE_AB[k] != null) return +c.shape.ab[SHAPE_AB[k]] || 10;
  const base = +c.abil[k] || 0, fb = featAbilBonus(c, k), epic = fb.epic, gen = fb.gen + (+(c.bgAbil || {})[k] || 0);
  let v = base + gen > 20 ? Math.max(base, 20) : base + gen;
  if (Object.entries(CAPSTONE).some(([n, cap]) => clsLvl(c, n) >= 20 && cap[1].includes(k))) v = Math.max(v, Math.min(25, v + 4));
  if (epic) v = Math.max(v, Math.min(30, v + epic));
  // Предметы, задающие характеристику (Амулет здоровья — ТЕЛ 19): действует, если она выше
  activeItems(c).forEach((i) => { if (i.mSetK === k && +i.mSetV > v) v = +i.mSetV; });
  return v;
}
const am = (c, k) => mod(score(c, k));
// Умения 20 уровня, повышающие характеристики (максимум 25)
const CAPSTONE = { 'Варвар': ['Первобытный чемпион', ['str', 'con']], 'Монах': ['Тело и разум', ['dex', 'wis']] };
const exhPen = (c) => 2 * (c.combat.exhaustion || 0);
const skillBonus = (c, s) => {
  const p = c.skills[s.k] || 0;
  return am(c, s.a) + (p === 2 ? 2 * pb(c) : p === 1 ? pb(c) : c.combat.jack ? Math.floor(pb(c) / 2) : 0);
};
// Аура защиты паладина (6+ ур. паладина): +Хар (мин. +1) ко всем спасброскам, пока паладин в сознании
const auraBonus = (c) => (clsLvl(c, 'Паладин') >= 6 && (+c.combat.hp || 0) > 0 ? Math.max(1, am(c, 'cha')) : 0);
// Владение спасброском: отмечено в листе или дано чертой «Устойчивый»
const saveProf = (c, k) => !!c.saves[k] || c.feats.some((f) => f.key === 'resilient' && f.a === k);
const saveBonus = (c, k) => am(c, k) + (saveProf(c, k) ? pb(c) : 0) + auraBonus(c) + magicSum(c, 'mSave');
const initBonus = (c) => am(c, 'dex') + (+c.combat.initBonus || 0) + (hasFeat(c, 'alert') ? pb(c) : 0);
const spellMod = (c) => am(c, c.spellcasting.ability);
const spellDC = (c) => 8 + pb(c) + spellMod(c) + (+c.spellcasting.bonus || 0);
const spellAtk = (c) => pb(c) + spellMod(c) + (+c.spellcasting.bonus || 0);
// Мультикласс: у каждого класса-заклинателя своя характеристика (паладин — Харизма, волшебник — Интеллект)
const CASTER_ABIL = { 'Бард': 'cha', 'Жрец': 'wis', 'Друид': 'wis', 'Паладин': 'cha', 'Следопыт': 'wis', 'Чародей': 'cha', 'Колдун': 'cha', 'Волшебник': 'int' };
const SUB_CASTER = { 'Мистический рыцарь': 'int', 'Мистический ловкач': 'int' };
const casterClasses = (c) => classList(c).filter((e) => CASTER_ABIL[e.cls] || SUB_CASTER[e.sub]).map((e) => ({ cls: e.cls, sub: e.sub, ab: CASTER_ABIL[e.cls] || SUB_CASTER[e.sub] }));
// Чьё это заклинание: подкласс, давший его, или первый свой класс, в списке которого оно есть
function spellClassOf(c, s) {
  const cc = casterClasses(c);
  if (cc.length < 2) return null;
  return cc.find((x) => s.auto && (s.auto === x.sub || String(s.auto).includes(x.cls))) || cc.find((x) => String(s.k || '').includes(x.cls) || (x.sub && x.cls === 'Воин' && /Волшебник/.test(s.k || '')) || (x.sub && x.cls === 'Плут' && /Волшебник/.test(s.k || ''))) || null;
}
const spellModFor = (c, s) => { const x = s && spellClassOf(c, s); return x ? am(c, x.ab) : spellMod(c); };
const spellDCFor = (c, s) => 8 + pb(c) + spellModFor(c, s) + (+c.spellcasting.bonus || 0);
const spellAtkFor = (c, s) => pb(c) + spellModFor(c, s) + (+c.spellcasting.bonus || 0);
// Владения при взятии нового класса мультиклассом (PHB 2024) — меньше, чем при старте этим классом
const MC_PROFS = {
  'Варвар': { armor: ['Щиты'], weapons: ['Воинское оружие'] },
  'Бард': { armor: ['Лёгкие доспехи'], skill: 'любой', tool: 'music' },
  'Жрец': { armor: ['Лёгкие доспехи', 'Средние доспехи', 'Щиты'] },
  'Друид': { armor: ['Лёгкие доспехи', 'Щиты'] },
  'Воин': { armor: ['Лёгкие доспехи', 'Средние доспехи', 'Щиты'], weapons: ['Воинское оружие'] },
  'Паладин': { armor: ['Лёгкие доспехи', 'Средние доспехи', 'Щиты'], weapons: ['Воинское оружие'] },
  'Следопыт': { armor: ['Лёгкие доспехи', 'Средние доспехи', 'Щиты'], weapons: ['Воинское оружие'], skill: 'из списка следопыта' },
  'Плут': { armor: ['Лёгкие доспехи'], tools: ['Воровские инструменты'], skill: 'из списка плута' },
  'Колдун': { armor: ['Лёгкие доспехи'] },
};
function applyMcProfs(c, cls) {
  const P = MC_PROFS[cls];
  if (!P) return '';
  (P.armor || []).forEach((v) => addProf(c, 'armor', v));
  (P.weapons || []).forEach((v) => addProf(c, 'weapons', v));
  (P.tools || []).forEach((v) => addProf(c, 'tools', v, true));
  if (P.tool) addPick(c, 'tool', [P.tool], 1, `${cls} (мультикласс)`);
  return [...(P.armor || []), ...(P.weapons || []), ...(P.tools || [])].join(', ') + (P.skill ? `; отметьте 1 навык (${P.skill})` : '');
}
const SPEED_ZERO = ['grappled', 'paralyzed', 'petrified', 'restrained', 'unconscious'];
// Расчёт КД по доспеху/щиту/защите без доспехов; notes — предупреждения для отображения
/* ---------- Дикий облик и спутники ---------- */
// Дикий облик (PHB 2024): хиты остаются свои + временные хиты = уровень друида (Круг луны — ×3); КД, скорость,
// Сила, Ловкость и Телосложение и атаки — зверя. Друид 2 — ПО до 1/4 без полёта, 4 — 1/2 без полёта, 8 — 1 с полётом;
// Круг луны — ПО до уровня друида / 3 (не ниже 1), КД не ниже 13 + мод. Мудрости
const crNum = (cr) => (String(cr).includes('/') ? 1 / +String(cr).split('/')[1] : +cr);
const BEASTS = () => (typeof BESTIARY !== 'undefined' ? BESTIARY.filter((m) => m.beast) : []);
const isMoon = (c) => classList(c).some((e) => e.cls === 'Друид' && e.sub === 'Круг луны');
function wildLimit(c) {
  const D = clsLvl(c, 'Друид');
  if (D < 2) return null;
  let cr = D >= 8 ? 1 : D >= 4 ? 0.5 : 0.25;
  if (isMoon(c)) cr = Math.max(cr, Math.max(1, Math.floor(D / 3)));
  return { cr, fly: D >= 8, temp: isMoon(c) ? 3 * D : D };
}
const SHAPE_AB = { str: 0, dex: 1, con: 2 };
const shapeAC = (c) => (isMoon(c) ? Math.max(c.shape.ac, 13 + am(c, 'wis')) : c.shape.ac);
const beastAtk = (m) => (m.atk || []).map((a, i) => ({ id: `b${i}`, n: a.n, hit: +a.hit || 0, dmg: a.dmg || '', type: a.type || '', range: a.range ? `${a.range} фт` : `${a.reach || 5} фт` }));
function startShape(c, m) {
  const L = wildLimit(c);
  const res = c.resources.find((r) => /Дикий облик/.test(r.n));
  if (res && res.used >= res.max) { toast('Использования Дикого облика закончились'); return; }
  if (res) res.used += 1;
  c.shape = { n: m.n, e: m.e, ac: m.ac, speed: m.speed, ab: m.ab.slice(0, 3), atk: beastAtk(m), x: m.x || '', prevAc: c.combat.ac };
  c.combat.temp = Math.max(+c.combat.temp || 0, L ? L.temp : 0);
  toast(`🐾 Облик: ${esc(m.n)} · +${L ? L.temp : 0} временных хитов`, 'crit');
}
function endShape(c) {
  if (!c.shape) return;
  if (c.armor.mode !== 'auto') c.combat.ac = c.shape.prevAc;
  toast(`Вы вернулись в свой облик (${esc(c.shape.n)})`);
  c.shape = null;
}
function renderShape() {
  const c = ch(), L = wildLimit(c), S = c.shape;
  $('#shapeBtns').innerHTML = `${L && !S ? '<button class="primary" data-act="shapePick">🐾 Дикий облик</button>' : ''}${S ? '<button data-act="shapeEnd">Вернуться в свой облик</button>' : ''}
    <button data-act="compAdd" title="Фамильяр, зверь-спутник следопыта, ездовое животное">＋ Спутник</button>`;
  const AB = ['СИЛ', 'ЛОВ', 'ТЕЛ'];
  $('#shapeBox').innerHTML = S ? `<div class="li equipped"><div class="li-head"><span class="li-title">Облик: ${esc(S.n)}</span>
      <span class="li-sub">КД ${shapeAC(c)} · скорость ${esc(S.speed)} · ${S.ab.map((v, i) => `${AB[i]} ${v}`).join(' · ')} · врем. хиты ${c.combat.temp}</span></div>
      ${S.atk.map((a, i) => `<div class="row gap wrap mt"><b>${esc(a.n)}</b> <span class="muted small">${fmt(a.hit)} · ${esc(a.dmg)} ${esc(a.type)}</span>
        <button data-act="beastRoll" data-i="${i}">🎯 Атака</button>${a.dmg ? `<button data-act="beastDmg" data-i="${i}">Урон</button><button data-act="beastDmg" data-i="${i}" data-crit="1">Крит</button>` : ''}</div>`).join('')}
      <div class="muted small mt">Хиты — ваши; в облике заклинания не накладываются. ${esc(S.x)}</div></div>`
    : L ? `<p class="muted small">Дикий облик: звери с ПО до ${L.cr < 1 ? `1/${Math.round(1 / L.cr)}` : L.cr}${L.fly ? '' : ', без полёта'}; временные хиты ${L.temp}.</p>` : '';
  $('#compList').innerHTML = (c.companions || []).map((p) => `<div class="li"><div class="li-head"><span class="li-title">${esc(p.n)}</span>
      <span class="li-sub">${esc(p.kind)} · КД ${p.ac} · скорость ${esc(p.speed)}</span>
      <span class="qty"><button data-act="compHp" data-id="${p.id}" data-d="-1">−</button><b>${p.hp}/${p.hpMax}</b><button data-act="compHp" data-id="${p.id}" data-d="1">+</button></span>
      <span class="btns">${p.atk.map((a, i) => `<button data-act="compRoll" data-id="${p.id}" data-i="${i}" title="${fmt(a.hit)} · ${esc(a.dmg)} ${esc(a.type)}">🎯 ${esc(a.n)}</button>`).join('')}
      <button class="ghost" data-act="compDel" data-id="${p.id}" title="Убрать">✕</button></span></div></div>`).join('')
    || (S || L ? '' : '<p class="muted small">Фамильяр («Поиск фамильяра»), зверь-спутник, ездовое животное — карточка с хитами и атаками.</p>');
}
function beastPicker(title, list, onPick, withName) {
  openModal(`<h2>${esc(title)}</h2>${withName ? '<label>Имя<input id="bpName" placeholder="Например, Уголёк"></label>' : ''}
    <div class="list mt">${list.map((m) => `<button class="atk-pick" data-beast="${esc(m.e)}"><b>${esc(m.n)}</b><span class="muted small">ПО ${m.cr} · КД ${m.ac} · ${esc(m.speed)} · ${(m.atk || []).map((a) => `${a.n} ${fmt(+a.hit)} ${a.dmg}`).join(', ') || 'без атак'}</span></button>`).join('') || '<p class="muted">Нет подходящих зверей.</p>'}</div>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button></div>`);
  $$('[data-beast]').forEach((b) => b.addEventListener('click', () => {
    const m = list.find((x) => x.e === b.dataset.beast), nm = withName ? $('#bpName').value.trim() : '';
    closeModal();
    tracked(title.toLowerCase(), () => onPick(m, nm));
    save(); render();
  }));
}
/* ---------- Магические предметы ---------- */
// Предмет действует, если экипирован и (если требует) настроен. Поля: mAtk — бонус оружия к попаданию и урону,
// mAc — к КД, mSave — к спасброскам, mSetK/mSetV — характеристика не ниже значения (Амулет здоровья: ТЕЛ 19), heal — зелье
const itemActive = (i) => !!i.eq && (!i.att || !!i.attuned);
const activeItems = (c) => (c.items || []).filter(itemActive);
const magicSum = (c, f) => activeItems(c).reduce((s, i) => s + (+i[f] || 0), 0);
// Магическое оружие атаки: связано полем «Магический предмет» или по названию («Длинный меч +1» → атака «Длинный меч»)
const atkItem = (c, a) => activeItems(c).find((i) => +i.mAtk && (a.item ? i.id === a.item : i.n.toLowerCase().startsWith(String(a.n || '').toLowerCase())));
const itemAtk = (c, a) => { const i = a && a.ability !== 'spell' && atkItem(c, a); return i ? +i.mAtk : 0; };
function magicTags(i) {
  const AB = (k) => (ABILITIES.find((a) => a.k === k) || {}).s || k;
  return [+i.mAtk ? `+${i.mAtk} атака и урон` : '', +i.mAc ? `+${i.mAc} КД` : '', +i.mSave ? `+${i.mSave} спасброски` : '', i.mSetK && +i.mSetV ? `${AB(i.mSetK)} ${i.mSetV}` : '', i.heal ? `лечение ${i.heal}` : '']
    .filter(Boolean).join(', ');
}
function computeAC(c) {
  const A = c.armor, dex = am(c, 'dex'), notes = [];
  const arm = ARMOR.find((x) => x.id === A.id);
  let ac, src;
  if (arm) {
    const medMax = hasFeat(c, 'mediumArmorMaster') ? 3 : 2;
    const d = arm.type === 'heavy' ? 0 : arm.type === 'medium' ? Math.min(medMax, dex) : dex;
    ac = arm.ac + d;
    src = `${arm.n} ${arm.ac}${arm.type === 'heavy' ? '' : ` ${fmt(d)} Лов${arm.type === 'medium' ? ` (макс. +${medMax})` : ''}`}`;
    if (hasFeat(c, 'defense')) { ac += 1; src += ' + Оборона 1'; }
    if (arm.stealth && !(arm.type === 'medium' && hasFeat(c, 'mediumArmorMaster'))) notes.push('помеха на Ловкость (Скрытность)');
    if (arm.str && score(c, 'str') < arm.str) notes.push(`Сила ниже ${arm.str} — скорость −10 фт`);
  } else {
    let u = UNARMORED[A.unarmored] || UNARMORED[''];
    if (u.noShield && A.shield) { notes.push('защита монаха не работает со щитом'); u = UNARMORED['']; }
    const k = u.k ? am(c, u.k) : 0;
    ac = u.base + dex + k;
    src = `${u.base} ${fmt(dex)} Лов${u.k ? ` ${fmt(k)} ${ABILITIES.find((a) => a.k === u.k).s}` : ''}`;
  }
  if (A.shield) { ac += 2; src += ' + щит 2'; }
  if (+A.bonus) { ac += +A.bonus; src += ` ${fmt(+A.bonus)} прочее`; }
  const mac = magicSum(c, 'mAc');
  if (mac) { ac += mac; src += ` ${fmt(mac)} магия (${activeItems(c).filter((i) => +i.mAc).map((i) => i.n).join(', ')})`; }
  return { ac, src, notes, arm };
}
const armorStealthDis = (c) => c.armor.mode === 'auto' && !!ARMOR.find((x) => x.id === c.armor.id && x.stealth && !(x.type === 'medium' && hasFeat(c, 'mediumArmorMaster')));
const armorSlow = (c) => { const a = c.armor.mode === 'auto' && ARMOR.find((x) => x.id === c.armor.id); return a && a.str && score(c, 'str') < a.str ? 10 : 0; };
// Доспех известен только в режиме авто-КД; в ручном режиме считаем, что доспеха нет
const wearingArmor = (c) => c.armor.mode === 'auto' && !!c.armor.id;
const heavyArmor = (c) => c.armor.mode === 'auto' && ARMOR.find((x) => x.id === c.armor.id)?.type === 'heavy';
function speedBonuses(c) {
  const out = [], M = clsLvl(c, 'Монах');
  if (M >= 2 && !wearingArmor(c) && !c.armor.shield) out.push(['Движение без доспехов', M >= 18 ? 30 : M >= 14 ? 25 : M >= 10 ? 20 : M >= 6 ? 15 : 10]);
  if (clsLvl(c, 'Варвар') >= 5 && !heavyArmor(c)) out.push(['Быстрое передвижение', 10]);
  if (clsLvl(c, 'Следопыт') >= 6 && !heavyArmor(c)) out.push(['Бродяга', 10]);
  if (hasFeat(c, 'speedy')) out.push(['Черта «Быстрый»', 10]);
  if (hasFeat(c, 'boonSpeed')) out.push(['Дар скорости', 30]);
  return out;
}
const curSpeed = (c) => (c.combat.conditions.some((k) => SPEED_ZERO.includes(k)) ? 0
  : c.shape ? Math.max(0, (parseInt(c.shape.speed) || 30) - 5 * (c.combat.exhaustion || 0))
  : Math.max(0, (+c.combat.speed || 0) + speedBonuses(c).reduce((s, [, v]) => s + v, 0) - 5 * (c.combat.exhaustion || 0) - armorSlow(c)));
// Ярость варвара — активна, пока в эффектах есть «Ярость»
const raging = (c) => c.effects.some((e) => e.n === 'Ярость');
const rageDmg = (c) => { const B = clsLvl(c, 'Варвар'); return B >= 16 ? 4 : B >= 9 ? 3 : 2; };
// «Сила или Ловкость» (фехтовальное оружие, безоружный удар монаха): берётся вариант с бо́льшим уроном.
// В ярости урон Силой получает бонус ярости — поэтому Сила может оказаться выгоднее даже при меньшем модификаторе.
const finUsesStr = (c) => am(c, 'str') + (raging(c) ? rageDmg(c) : 0) >= am(c, 'dex');
const usesStr = (c, a) => a.ability === 'str' || (a.ability === 'fin' && finUsesStr(c));
// Максимум хитов = кости хитов без модификаторов (hpRolled) + за каждый уровень мод. Телосложения и бонусы
// (дварф, «Крепкий») + «Дар стойкости». Растёт Телосложение — растёт и максимум, на 1 за каждый уровень
// Кость превосходства Мастера боевых искусств: к8, с 10 уровня — к10, с 18 — к12
const supDie = (c) => { const L = classList(c).filter((e) => e.cls === 'Воин' && e.sub === 'Мастер боевых искусств').reduce((s, e) => s + e.lvl, 0); return L >= 18 ? 12 : L >= 10 ? 10 : 8; };
const hpPerLvl = (c) => am(c, 'con') + hpPerLevelBonus(c);
const hpExtra = (c) => (hasFeat(c, 'boonFortitude') ? 40 : 0);
const hpPart = (c) => lvl(c) * hpPerLvl(c) + hpExtra(c);
function syncHpMax(c) {
  const cb = c.combat;
  if (c.shape) return; // в диком облике Телосложение зверя не меняет ваши хиты
  if (cb.hpRolled == null) { cb.hpRolled = (+cb.hpMax || 0) - hpPart(c); return; } // персонаж из старой версии — запомнить как есть
  const want = Math.max(1, cb.hpRolled + hpPart(c)), d = want - (+cb.hpMax || 0);
  if (!d) return;
  cb.hpMax = want;
  cb.hp = clamp((+cb.hp || 0) + Math.max(0, d), 0, want);
}
const isLucky = (c) => /полурослик|halfling/i.test(c.info.species);
const hpPerLevelBonus = (c) => (/дварф|dwarf/i.test(c.info.species) ? 1 : 0) + (hasFeat(c, 'tough') || c.features.some((f) => /крепкий|tough/i.test(f.n)) ? 2 : 0);
// Дальнобойное оружие — дистанция вида «80/320 фт» (метательное записано как «5 фт · бросок …»)
const isRangedWeapon = (a) => a.ability !== 'spell' && /^\d+\/\d+/.test(a.range || '');
// ability: характеристика, 'spell' — заклинательная, 'fin' — лучшая из Силы и Ловкости (фехтовальное оружие)
const abilFor = (c, a) => (a.ability === 'spell' ? spellMod(c) : a.ability === 'fin' ? am(c, finUsesStr(c) ? 'str' : 'dex') : am(c, a.ability));
const atkAbilMod = (c, a) => abilFor(c, a) + (a.ability === 'spell' ? (+c.spellcasting.bonus || 0) : 0);
const attackBonus = (c, a) => atkAbilMod(c, a) + (a.prof ? pb(c) : 0) + (+a.hit || 0) + (hasFeat(c, 'archery') && isRangedWeapon(a) ? 2 : 0) + itemAtk(c, a);
const dmgMod = (c, a) => (a.addMod ? abilFor(c, a) : 0) + (+a.dmgBonus || 0) + (raging(c) && a.ability !== 'spell' && usesStr(c, a) ? rageDmg(c) : 0) + itemAtk(c, a);
// Боевые искусства монаха (2024): кость урона безоружного удара по уровню
const martialDie = (L) => (L >= 17 ? '1d12' : L >= 11 ? '1d10' : L >= 5 ? '1d8' : '1d6');
function autoMartialArts(c) {
  const monk = clsLvl(c, 'Монах') > 0;
  c.attacks.forEach((a) => {
    // Нетронутый безоружный удар по умолчанию у монаха переводим на Боевые искусства
    if (monk && !a.ma && a.n === 'Безоружный удар' && String(a.dmg) === '1' && a.ability === 'str') { a.ma = true; a.maAuto = true; a.ability = 'fin'; }
    // Класс сменился с монаха — вернуть автоматически переведённый удар к обычному
    if (!monk && a.ma && a.maAuto) { a.ma = false; a.maAuto = false; a.dmg = '1'; a.ability = 'str'; }
    if (a.ma) a.dmg = martialDie(clsLvl(c, 'Монах') || lvl(c));
  });
}
const scaleDice = (e, k) => String(e).replace(/(\d*)[dк](\d+)/gi, (_, n, s) => `${(parseInt(n || '1')) * k}d${s}`);
const withMod = (e, m) => (m ? `${e}${m > 0 ? '+' : '-'}${Math.abs(m)}` : e);
const dmgExpr = (c, a, crit) => withMod(crit ? scaleDice(a.dmg || '0', 2) : (a.dmg || '0'), dmgMod(c, a));
const coinGp = (co) => (+co.cp || 0) / 100 + (+co.sp || 0) / 10 + (+co.ep || 0) / 2 + (+co.gp || 0) + (+co.pp || 0) * 10;

// Ячейки по типу заклинателя и уровню (без Магии договора)
function slotsFor(t, L) {
  if (t === 'full') return SLOT_TABLE[L - 1];
  if (t === 'half') return SLOT_TABLE[Math.ceil(L / 2) - 1];
  if (t === 'third') return L >= 3 ? SLOT_TABLE[Math.ceil(L / 3) - 1] : [];
  return [];
}
// Тип заклинателя класса в мультиклассе (мистический рыцарь/ловкач определяется по подклассу)
function casterOf(e) {
  const d = CLASSES[e.cls];
  if (!d) return 'none';
  if (d.caster !== 'none') return d.caster;
  return (e.cls === 'Воин' || e.cls === 'Плут') && /мистическ|eldritch|arcane/i.test(e.sub) ? 'third' : 'none';
}
function autoSlots(c) {
  // Воин/плут без своей магии становятся третью заклинателя с подклассом Мистический рыцарь/ловкач
  const t = c.spellcasting.casterType === 'none' ? casterOf(classList(c)[0]) : c.spellcasting.casterType;
  if (t !== 'manual') {
    let arr, pact = null;
    if (!isMulti(c)) {
      arr = slotsFor(t, lvl(c));
      if (t === 'pact') pact = PACT_TABLE[lvl(c) - 1];
    } else {
      // Мультикласс (PHB 2024): полные заклинатели + ½ паладина/следопыта (вверх) + ⅓ мист. рыцаря/ловкача (вниз);
      // если ячейки даёт только один класс — по его собственной таблице. Магия договора считается отдельно.
      const casters = classList(c).map((e) => [casterOf(e), e.lvl]).filter(([k]) => k !== 'none' && k !== 'pact');
      if (casters.length === 1) arr = slotsFor(casters[0][0], casters[0][1]);
      else {
        const cl = casters.reduce((s, [k, L]) => s + (k === 'full' ? L : k === 'half' ? Math.ceil(L / 2) : Math.floor(L / 3)), 0);
        arr = cl ? SLOT_TABLE[Math.min(20, cl) - 1] : [];
      }
      const W = clsLvl(c, 'Колдун');
      if (W) pact = PACT_TABLE[W - 1];
    }
    c.slots.forEach((s, i) => { s.max = arr[i] || 0; });
    if (pact) { c.pact.max = pact[0]; c.pact.level = pact[1]; } else c.pact.max = 0;
  }
  c.slots.forEach((s) => { s.used = clamp(s.used, 0, s.max); });
  c.pact.used = clamp(c.pact.used, 0, c.pact.max);
}
// Шаблон класса: кость хитов, спасброски, колдовство, защита без доспехов
function applyClassTemplate(c) {
  const name = c.info.cls.trim(), def = CLASSES[name];
  if (!def) return;
  c.combat.hdDie = def.hd;
  ABILITIES.forEach((a) => { c.saves[a.k] = def.saves.includes(a.k); });
  c.spellcasting.ability = def.sa;
  c.spellcasting.casterType = def.caster;
  if (name === 'Бард') c.combat.jack = clsLvl(c, 'Бард') >= 2;
  const ua = name === 'Монах' ? 'monk' : name === 'Варвар' ? 'barbarian' : '';
  if (ua && !c.armor.id) Object.assign(c.armor, { mode: 'auto', unarmored: ua });
  else if (!ua && (c.armor.unarmored === 'monk' || c.armor.unarmored === 'barbarian')) c.armor.unarmored = '';
  c.info.clsApplied = name;
}
// Ресурсы, которые даёт класс или черта, — добавляются и убираются сами.
// manual: ресурс добавлен вручную из списка «Ресурсы класса» (например, для мультикласса) — его не трогаем.
// Уровень, по которому считается ресурс: уровень класса, который его даёт (иначе общий)
function resLevels(c) {
  const map = {};
  classList(c).forEach((e) => { (CLASSES[e.cls] || { res: [] }).res.forEach((k) => { map[k] = (map[k] || 0) + e.lvl; }); });
  if (hasFeat(c, 'lucky')) map.luckyFeat = lvl(c);
  const bm = classList(c).find((e) => e.cls === 'Воин' && e.sub === 'Мастер боевых искусств');
  if (bm) map.superiority = bm.lvl;
  (speciesOf(c)?.res || []).forEach((k) => { map[k] = lvl(c); });
  return map;
}
const speciesOf = (c) => SPECIES_DATA.find((s) => s.n === String(c.info.species || '').trim());
const backgroundOf = (c) => BACKGROUND_DATA.find((b) => b.n === String(c.info.background || '').trim());
// Применить расу: скорость, размер, тёмное зрение, черты расы (заменяют прежние), навыки на выбор
function applySpecies(c, sp, o = {}) {
  const lin = o.lin || '';
  c.info.species = sp.n;
  c.info.size = sp.size.includes(o.size) ? o.size : sp.size[0];
  c.info.lineage = lin;
  c.combat.speed = /Лесной эльф/.test(lin) ? 35 : sp.speed;
  const dv = /Дроу/.test(lin) ? 120 : sp.dv;
  c.prof.senses = dv ? `Тёмное зрение ${dv} фт` : '';
  c.features = c.features.filter((f) => f.src !== 'Раса' && f.src !== 'Вид');
  sp.t.forEach(([n, x]) => c.features.push({ id: uid(), n, src: 'Раса', x }));
  if (lin) c.features.push({ id: uid(), n: `Происхождение: ${lin}`, src: 'Раса', x: 'Подробности выбранного происхождения — в Книге игрока.' });
  (o.skills || []).forEach((k) => { c.skills[k] = Math.max(1, c.skills[k] || 0); });
}
// Применить предысторию: навыки, инструмент, бонусы характеристик, черта происхождения
function applyBackground(c, bg, o) {
  c.info.background = bg.n;
  bg.sk.forEach((k) => { c.skills[k] = Math.max(1, c.skills[k] || 0); });
  // Инструмент предыстории входит в её снаряжение — сразу в инвентарь (если он на выбор — задание «выберите»)
  if (BG_TOOL_PICK[bg.tool]) addPick(c, 'tool', BG_TOOL_PICK[bg.tool], 1, `предыстория «${bg.n}»`, true);
  else addProf(c, 'tools', bg.tool, true);
  c.bgAbil = o.mode === '111' ? Object.fromEntries(bg.abil.map((k) => [k, 1])) : { [o.a1]: 2, [o.a2]: 1 };
  const old = c.feats.find((f) => f.bg);
  if (old) { featHp(c, old.key, -1); c.feats = c.feats.filter((f) => f !== old); }
  if (featFree(c, 'origin') > 0) addFeat(c, 'origin', { key: bg.feat }, lvl(c));
  const f = c.feats[c.feats.length - 1];
  if (f && f.key === bg.feat) { f.bg = true; if (bg.featNote) f.note = bg.featNote; }
}
function autoResources(c) {
  const levels = resLevels(c), wanted = Object.keys(levels);
  c.resources = c.resources.filter((r) => !r.auto || r.manual || wanted.includes(r.auto));
  wanted.forEach((k) => {
    if (c.resources.some((r) => r.auto === k)) return;
    const R = CLASS_RESOURCES[k];
    c.resources.push({ id: uid(), n: R.n, max: 0, used: 0, recharge: 'long', auto: k, x: R.d });
  });
  c.resources.forEach((r) => {
    const d = CLASS_RESOURCES[r.auto];
    if (d) {
      const v = d.f(levels[r.auto] || lvl(c), c); r.max = v.max; r.recharge = v.recharge;
      if (r.auto === 'focus' && /^Очки сосредоточенности/.test(r.n)) r.n = d.n;
    }
    r.used = clamp(r.used, 0, r.max);
  });
}
// С какого уровня ресурс становится доступен (для подсказки)
function resFromLevel(c, r) {
  const d = CLASS_RESOURCES[r.auto];
  if (!d) return 0;
  for (let L = 1; L <= 20; L++) if (d.f(L, c).max > 0) return L;
  return 0;
}

/* ---------- Кости ---------- */
let advMode = 0;
const rollLog = [];
function die(n) { const a = new Uint32Array(1); crypto.getRandomValues(a); return 1 + (a[0] % n); }
function evalDice(expr) {
  const s = String(expr).replace(/\s+/g, '').toLowerCase().replace(/к/g, 'd');
  const re = /([+-])?(?:(\d*)d(\d+)|(\d+))/g;
  let m, idx = 0, total = 0;
  const parts = [];
  while ((m = re.exec(s)) && m[0]) {
    if (m.index !== idx) return null;
    idx = re.lastIndex;
    const sign = m[1] === '-' ? -1 : 1;
    if (m[3]) {
      const n = Math.min(200, parseInt(m[2] || '1')), sides = parseInt(m[3]);
      if (!sides) return null;
      const rs = Array.from({ length: n }, () => die(sides));
      total += sign * rs.reduce((a, b) => a + b, 0);
      parts.push(`${sign < 0 ? '− ' : parts.length ? '+ ' : ''}${n}d${sides} [${rs.join(', ')}]`);
    } else {
      total += sign * parseInt(m[4]);
      parts.push(`${sign < 0 ? '−' : '+'} ${m[4]}`);
    }
  }
  if (idx !== s.length || !parts.length) return null;
  return { total, detail: parts.join(' ') };
}
function setAdv(v) { advMode = v; $$('.advmode button').forEach((b) => b.classList.toggle('on', +b.dataset.adv === v)); }
// Источники преимущества и помехи для броска: состояния, ярость, доспех, черты.
// kind: attack | check | save | init | death; abil — характеристика; skill — навык
const AUTO_FAIL = ['paralyzed', 'stunned', 'unconscious', 'petrified'];
const critMin = (c) => {
  const f = classList(c).find((e) => e.cls === 'Воин' && e.sub === 'Чемпион');
  return !f || f.lvl < 3 ? 20 : f.lvl >= 15 ? 18 : 19;
};
function autoAdv(c, o) {
  const has = (k) => c.combat.conditions.includes(k), n = (k) => CONDITIONS.find((x) => x.k === k).n.toLowerCase();
  const adv = [], dis = [], k = o.kind;
  if (k === 'attack') {
    ['blinded', 'frightened', 'poisoned', 'prone', 'restrained'].forEach((x) => { if (has(x)) dis.push(n(x)); });
    if (has('invisible')) adv.push(n('invisible'));
  }
  // Инициатива — проверка Ловкости, поэтому действуют и правила проверок
  if (k === 'check' || k === 'init') ['frightened', 'poisoned'].forEach((x) => { if (has(x)) dis.push(n(x)); });
  if (k === 'init') { if (has('invisible')) adv.push(n('invisible')); if (has('incapacitated')) dis.push(n('incapacitated')); }
  if (k === 'save' && o.abil === 'dex' && has('restrained')) dis.push(n('restrained'));
  if ((k === 'check' || k === 'save') && o.abil === 'str' && raging(c) && !heavyArmor(c)) adv.push('ярость');
  if (o.skill === 'stealth' && armorStealthDis(c)) dis.push('доспех');
  if (o.conc && hasFeat(c, 'warCaster')) adv.push('Боевой заклинатель');
  return { adv, dis };
}
function rollD20(label, bonus, opts = {}) {
  const c = ch();
  // Автоматический провал спасбросков Силы и Ловкости при некоторых состояниях
  const fail = opts.kind === 'save' && (opts.abil === 'str' || opts.abil === 'dex') && AUTO_FAIL.find((k) => c.combat.conditions.includes(k));
  if (fail) {
    logRoll(`${label} ✘ автоматический провал`, '—', `Состояние «${CONDITIONS.find((x) => x.k === fail).n}»: спасброски Силы и Ловкости проваливаются`, 'fumble');
    setAdv(0);
    return { total: -99, nat: 1 };
  }
  // Преимущество и помеха: ручной выбор + источники из листа. Хотя бы одно и того и другого — обычный бросок.
  const src = autoAdv(c, opts);
  // Источники со стола: состояние цели, дистанция, враг рядом при дальнобойной атаке
  if (opts.adv) src.adv.push(...opts.adv);
  if (opts.dis) src.dis.push(...opts.dis);
  if (advMode === 1) src.adv.push('выбрано вручную');
  if (advMode === -1) src.dis.push('выбрано вручную');
  const mode = src.adv.length && !src.dis.length ? 1 : src.dis.length && !src.adv.length ? -1 : 0;
  const pen = exhPen(c);
  const notes = [];
  // Удача полурослика: выпавшая 1 на к20 перебрасывается, новый результат обязателен
  const roll = () => { const r = die(20); if (r === 1 && isLucky(c)) { const n = die(20); notes.push(`Удача: 1→${n}`); return n; } return r; };
  const r1 = roll(), r2 = mode ? roll() : null;
  let nat = r1, detail = `к20 [${r1}]`;
  if (mode === 1) { nat = Math.max(r1, r2); detail = `преимущество (${src.adv.join(', ')}) [${r1}, ${r2}]`; }
  if (mode === -1) { nat = Math.min(r1, r2); detail = `помеха (${src.dis.join(', ')}) [${r1}, ${r2}]`; }
  if (!mode && src.adv.length && src.dis.length) detail += ` · преимущество и помеха взаимно отменились (${[...src.adv, ...src.dis].join(', ')})`;
  // Надёжный талант: при проверке с владением результат кубика ниже 10 считается 10
  let used = nat;
  if (opts.floor10 && nat < 10) { used = 10; notes.push(`Надёжный талант: ${nat}→10`); }
  // Кости от эффектов стола: +1к4 «Благословения», −1к4 «Порчи»
  let extraSum = 0;
  const diceTxt = (opts.dice || []).map((x) => {
    const neg = String(x.e).startsWith('-'), r = evalDice(String(x.e).replace(/^[+-]/, ''));
    if (!r) return '';
    extraSum += neg ? -r.total : r.total;
    return ` ${neg ? '−' : '+'}${r.total} (${x.n})`;
  }).join('');
  const total = used + bonus - pen + extraSum;
  detail += ` ${fmt(bonus)}` + diceTxt + (pen ? ` −${pen} (истощение)` : '') + (notes.length ? ` · ${notes.join(', ')}` : '');
  // Чемпион: критическое попадание оружием на 19–20 (с 15 уровня — на 18–20)
  const critAt = opts.weapon ? critMin(c) : 20;
  let cls = nat >= critAt && opts.attack ? 'crit' : nat === 20 ? 'crit' : nat === 1 ? 'fumble' : '';
  let extra = '';
  if (opts.dc != null) { extra = total >= opts.dc ? ' ✔ успех' : ' ✘ провал'; }
  if (opts.attack && opts.ac != null) extra = total >= opts.ac ? ' — попадание' : ' — промах';
  if (opts.attack && nat >= critAt) extra = ' — КРИТ!';
  if (opts.attack && nat === 1) extra = ' — промах';
  logRoll(label + extra, total, detail, cls);
  setAdv(0);
  return { total, nat, crit: !!opts.attack && nat >= critAt, detail, mode };
}
function rollDice(label, expr) {
  const r = evalDice(expr);
  if (!r) { toast(`Не понял выражение «${esc(expr)}»`); return null; }
  logRoll(label, r.total, `${expr}: ${r.detail}`);
  return r;
}
// rollMute > 0 — бросок сделан столом (атака, спасбросок), он сам пишет его в общий журнал
let rollMute = 0;
function logRoll(label, total, detail, cls = '') {
  rollLog.unshift({ label, total, detail, cls, t: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) });
  rollLog.length = Math.min(rollLog.length, 60);
  renderLog();
  toast(`<b class="big">${total}</b>${esc(label)}<div class="rd">${esc(detail)}</div>`, cls);
  // Остальные броски из листа (проверки, спасброски, урон) стол может показать всем
  if (!rollMute) document.dispatchEvent(new CustomEvent('dnd-roll', { detail: { label, total, detail, cls } }));
}
function renderLog() {
  $('#rollLog').innerHTML = rollLog.map((r) => `<div class="roll ${r.cls}"><div class="rt"><span>${esc(r.label)}</span><b>${r.total}</b></div><div class="rd">${esc(r.detail)} · ${r.t}</div></div>`).join('') || '<div class="muted small">Бросков пока не было</div>';
}
function toast(html, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls;
  el.innerHTML = html;
  $('#toasts').appendChild(el);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(() => el.remove(), 4000);
}

/* ---------- Модальные окна ---------- */
let modalRefresh = null;
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; $('#modalBody').onmouseover = null; modalRefresh = null; }
function fieldHtml(f, v) {
  const span = f.full ? ' style="grid-column:1/-1"' : '';
  if (f.type === 'check') return `<label class="check"${span}><input type="checkbox" name="${f.k}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
  if (f.type === 'textarea') return `<label style="grid-column:1/-1">${esc(f.label)}<textarea name="${f.k}" rows="${f.rows || 5}">${esc(v ?? '')}</textarea></label>`;
  if (f.type === 'select') {
    const opts = f.options.map((o) => { const [val, txt] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v ?? '') ? 'selected' : ''}>${esc(txt)}</option>`; }).join('');
    return `<label${span}>${esc(f.label)}<select name="${f.k}">${opts}</select></label>`;
  }
  return `<label${span}>${esc(f.label)}<input name="${f.k}" type="${f.type || 'text'}" value="${esc(v ?? '')}" ${f.ph ? `placeholder="${esc(f.ph)}"` : ''} ${f.list ? `list="${f.list}"` : ''}></label>`;
}
function formModal(title, fields, vals, onSave) {
  openModal(`<h2>${esc(title)}</h2><form id="mform" class="form-grid">${fields.map((f) => fieldHtml(f, vals[f.k])).join('')}</form>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="mSave">Сохранить</button></div>`);
  const submit = () => {
    const out = {};
    fields.forEach((f) => {
      const el = $(`#mform [name="${f.k}"]`);
      out[f.k] = f.type === 'check' ? el.checked : f.type === 'number' ? (el.value === '' ? 0 : Number(el.value)) : el.value;
    });
    if (fields[0] && !String(out[fields[0].k]).trim()) { $(`#mform [name="${fields[0].k}"]`).focus(); return; }
    tracked(title.toLowerCase(), () => onSave(out));
    closeModal(); save(); render();
  };
  $('#mSave').onclick = submit;
  $('#mform').onsubmit = (e) => { e.preventDefault(); submit(); };
  setTimeout(() => $('#mform [name]')?.focus(), 30);
}
const confirmBox = (text) => window.confirm(text);

/* ---------- Отрисовка ---------- */
const openSet = new Set();
let curTab = lsGet('dnd55-tab') || 'main';
let refMode = 'spells';

// Портрет в «Основном»: квадрат слева; нажатие — загрузить и кадрировать. Он же — на токене, в панели хода и в очереди стола
function renderPortrait() {
  const box = $('#portraitBox');
  if (!box) return;
  const p = ch().info.portrait || '';
  if (box.dataset.src === p) return;
  box.dataset.src = p;
  box.classList.toggle('has', !!p);
  box.innerHTML = p ? `<img src="${p}" alt="Портрет"><button class="portrait-del" data-act="portraitDel" title="Убрать портрет">✕</button>` : '<span>🖼<br>Портрет</span>';
}
// Кадрирование: картинку двигают и приближают в квадрате, сохраняется 256×256 JPEG
function portraitCrop(file) {
  const url = URL.createObjectURL(file), img = new Image();
  img.onerror = () => { URL.revokeObjectURL(url); toast('Не удалось открыть картинку'); };
  img.onload = () => {
    const V = 260, nw = img.naturalWidth, nh = img.naturalHeight, base = V / Math.min(nw, nh);
    let z = 1, sc = base, ox = (V - nw * sc) / 2, oy = (V - nh * sc) / 2, dragP = null;
    openModal(`<h2>🖼 Портрет</h2><p class="muted small">Перетащите картинку и приблизьте, чтобы в квадрате оказалось лицо.</p>
      <div class="crop-view" id="cropView" style="width:${V}px;height:${V}px"><img id="cropImg" src="${url}" alt="" draggable="false"></div>
      <label class="mt">Приближение<input type="range" id="cropZ" min="1" max="4" step="0.01" value="1"></label>
      <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" id="cropOk">Сохранить</button></div>`);
    const view = $('#cropView'), im = $('#cropImg');
    const clampO = () => { ox = Math.min(0, Math.max(V - nw * sc, ox)); oy = Math.min(0, Math.max(V - nh * sc, oy)); };
    const draw = () => { clampO(); im.style.width = `${nw * sc}px`; im.style.height = `${nh * sc}px`; im.style.transform = `translate(${ox}px, ${oy}px)`; };
    const zoomTo = (nz, cx = V / 2, cy = V / 2) => { const ix = (cx - ox) / sc, iy = (cy - oy) / sc; z = Math.max(1, Math.min(4, nz)); sc = base * z; ox = cx - ix * sc; oy = cy - iy * sc; $('#cropZ').value = z; draw(); };
    draw();
    view.addEventListener('pointerdown', (e) => { dragP = { x: e.clientX, y: e.clientY, ox, oy }; try { view.setPointerCapture(e.pointerId); } catch (err) { /* указатель уже отпущен */ } e.preventDefault(); });
    view.addEventListener('pointermove', (e) => { if (!dragP) return; ox = dragP.ox + e.clientX - dragP.x; oy = dragP.oy + e.clientY - dragP.y; draw(); });
    view.addEventListener('pointerup', () => { dragP = null; });
    view.addEventListener('wheel', (e) => { e.preventDefault(); const r = view.getBoundingClientRect(); zoomTo(z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    $('#cropZ').addEventListener('input', (e) => zoomTo(+e.target.value));
    $('#cropOk').onclick = () => {
      const S = 256, cv = document.createElement('canvas');
      cv.width = cv.height = S;
      cv.getContext('2d').drawImage(img, -ox / sc, -oy / sc, V / sc, V / sc, 0, 0, S, S);
      URL.revokeObjectURL(url);
      const c = ch();
      c.info.portrait = cv.toDataURL('image/jpeg', 0.85); c.updatedAt = Date.now();
      closeModal(); save(); render();
      toast('🖼 Портрет сохранён — он появится и на столе');
    };
  };
  img.src = url;
}
function render() {
  const c = ch();
  // Класс выбран (или сменён) — применить его шаблон автоматически
  if (CLASSES[c.info.cls.trim()] && c.info.clsApplied !== c.info.cls.trim()) {
    applyClassTemplate(c);
    toast(`Применён шаблон класса «${esc(c.info.cls.trim())}»: кость хитов, спасброски, колдовство, ресурсы`);
  }
  autoSlots(c);
  autoResources(c);
  syncHpMax(c);
  if (c.shape) c.combat.ac = shapeAC(c);
  else if (c.armor.mode === 'auto') c.combat.ac = computeAC(c).ac;
  autoMartialArts(c);
  autoSubclassFeatures(c);
  autoSpells(c);
  renderMulti();
  // Подкласс — только из списка своего класса и только с уровня подкласса
  fillSubSelect($('#subSel'), $('#subTxt'), c.info.cls.trim(), pLvl(c), c.info.subclass || '');
  c.multi.forEach((m, i) => {
    fillClassSelect($(`[data-bind="multi.${i}.cls"]`), c, m);
    fillSubSelect($(`[data-bind="multi.${i}.sub"]`), null, String(m.cls || '').trim(), clamp(parseInt(m.lvl) || 1, 1, 20), m.sub || '');
  });
  fillBound();
  renderUndo();
  renderPortrait();
  renderHeader(); renderAbil(); renderSkills(); renderProfs(); renderCombat(); renderClassPanel(); renderQuickSpells(); renderSpells(); renderInventory(); renderFeatures();
  document.dispatchEvent(new Event('dnd-render')); // игровой стол обновляет токен персонажа
}

// Список дополнительных классов; перестраивается только при добавлении/удалении, чтобы не сбивать ввод
let multiSig = null;
function renderMulti() {
  const c = ch(), sig = c.id + ':' + c.multi.map((m) => m.id).join(',');
  if (sig !== multiSig) {
    multiSig = sig;
    $('#multiBox').innerHTML = (c.multi.length ? `<h3>Мультикласс</h3>` + c.multi.map((m, i) => `<div class="multi-row">
        <label>Класс<select data-bind="multi.${i}.cls"></select></label>
        <label>Подкласс<select data-bind="multi.${i}.sub"></select></label>
        <label>Уровень<input type="number" min="1" max="19" data-bind="multi.${i}.lvl" data-num></label>
        <button class="ghost" data-act="delMulti" data-id="${m.id}" title="Убрать класс">✕</button></div>`).join('') : '')
      + `<div class="row gap wrap mt"><span class="badge" id="totalLvl"></span><button class="ghost" data-act="addMulti" title="Добавить второй класс (новый уровень лучше брать через «Новый уровень»)">＋ мультикласс</button></div>`;
  }
  const L = classList(c).reduce((s, e) => s + e.lvl, 0);
  $('#totalLvl').innerHTML = isMulti(c) ? `Общий уровень: <b>${lvl(c)}</b>${L > 20 ? ' <span class="gen-warn">— сумма уровней больше 20</span>' : ''}` : `Уровень персонажа: <b>${lvl(c)}</b>`;
}
function fillBound() {
  const c = ch();
  $$('[data-bind]').forEach((el) => {
    if (el === document.activeElement) return;
    const v = getPath(c, el.dataset.bind);
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
  const manual = c.spellcasting.casterType === 'manual';
  $$('#slotList input').forEach((i) => { i.disabled = !manual; });
  const acAuto = c.armor.mode === 'auto';
  $('#acInput').disabled = acAuto;
  $('#acAuto').hidden = !acAuto;
}

function renderHeader() {
  const c = ch(), cb = c.combat;
  $('#charSelect').innerHTML = Object.values(state.chars).map((x) => `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.info.name || 'Без имени')}${x.info.cls ? ` — ${esc(classList(x).filter((e) => e.cls).map((e) => `${e.cls} ${e.lvl}`).join(' / '))}` : ''}</option>`).join('');
  $('#qbName').textContent = c.info.name || 'Без имени';
  $('#qbSub').textContent = [c.info.species, c.info.cls && (isMulti(c) ? classLabel(c) : `${c.info.cls}${c.info.subclass ? ' (' + c.info.subclass + ')' : ''}`), `${lvl(c)} уровень`].filter(Boolean).join(' · ');
  document.title = `${c.info.name || 'Персонаж'} — Лист D&D 5.5`;
  const max = Math.max(1, +cb.hpMax || 1), hp = +cb.hp || 0, temp = +cb.temp || 0;
  const pct = clamp(hp / max, 0, 1) * 100;
  $('#hpFill').style.width = pct + '%';
  $('#hpFill').style.background = pct > 50 ? 'linear-gradient(90deg,#2f6b2f,#5a9e5a)' : pct > 25 ? 'linear-gradient(90deg,#8a6a1f,#d4a64a)' : 'linear-gradient(90deg,#8d2a20,#c94a3d)';
  const tw = clamp(temp / max, 0, 1) * 100;
  $('#hpTempFill').style.left = Math.min(pct, 100 - tw) + '%';
  $('#hpTempFill').style.width = tw + '%';
  $('#hpText').textContent = `${hp} / ${max}${temp ? ` (+${temp} врем.)` : ''}`;
  $('#qbAc').textContent = cb.ac;
  $('#qbInit').textContent = fmt(initBonus(c));
  $('#qbSpeed').textContent = curSpeed(c);
  $('#qbPb').textContent = fmt(pb(c));
  $('#qbInsp').classList.toggle('on', !!cb.inspiration);

  const al = [];
  if (hp <= 0) al.push(`<span class="alert" data-act="goTab" data-tab-go="combat">💀 0 хитов — спасброски от смерти (${cb.deathS}✔ / ${cb.deathF}✘)</span>`);
  if (pendingConc) al.push(`<span class="alert gold" data-act="concSave">🎯 Спасбросок концентрации ТЕЛ, СЛ ${pendingConc} — бросить</span>`);
  if (cb.conc) {
    const ce = c.effects.find((e) => e.conc);
    al.push(`<span class="alert info" data-act="goTab" data-tab-go="combat">◎ Концентрация: ${esc(cb.conc)}${ce ? ' · ' + fmtRounds(ce.left) : ''}</span>`);
  }
  c.effects.filter((e) => !e.conc).forEach((e) => al.push(`<span class="alert info" data-act="goTab" data-tab-go="combat">⏳ ${esc(e.n)} · ${fmtRounds(e.left)}</span>`));
  if (cb.exhaustion) al.push(`<span class="alert" data-act="condInfo" data-k="exhaustion">Истощение ${cb.exhaustion}: −${exhPen(c)} к к20, −${cb.exhaustion * 5} фт</span>`);
  cb.conditions.forEach((k) => { const d = CONDITIONS.find((x) => x.k === k); if (d) al.push(`<span class="alert" data-act="condInfo" data-k="${k}">${esc(d.n)}</span>`); });
  const L = lvl(c);
  if (L < 20 && (+c.info.xp || 0) >= XP_TABLE[L]) al.push(`<span class="alert gold" data-act="levelUp">⬆ Достаточно опыта для ${L + 1} уровня — повысить</span>`);
  $('#qbAlerts').innerHTML = al.join('');
  $('#xpHint').textContent = L < 20 ? `До ${L + 1} уровня: ${Math.max(0, XP_TABLE[L] - (+c.info.xp || 0))} опыта` : 'Максимальный уровень';
}

// Режим правки базовых значений (кнопка «Изменить»); в обычном режиме поля скрыты
let abilEdit = false;
function renderAbil() {
  const c = ch();
  $('#abilGrid').classList.toggle('editing', abilEdit);
  $('#abilEditBtn').textContent = abilEdit ? '✓ Готово' : '✎ Изменить';
  $('#abilEditBtn').classList.toggle('primary', abilEdit);
  $('#abilGenBtn').hidden = !!c.abilSet && !abilEdit;
  $('#abilHint').textContent = abilEdit
    ? 'Правка базовых значений — без бонусов предыстории и черт (они добавятся сами). Используйте, например, при потере конечности или по решению мастера.'
    : 'Нажмите на модификатор — проверка, на «Спас» — спасбросок. Галочка — владение спасброском. Наведите на значение, чтобы увидеть, из чего оно складывается.';
  ABILITIES.forEach((a) => {
    $(`#am-${a.k}`).textContent = fmt(am(c, a.k));
    $(`#as-${a.k}`).textContent = `Спас ${fmt(saveBonus(c, a.k))}`;
    // Крупно — итоговое значение; раскладка (база + предыстория + черты) — в подсказке и в режиме правки
    const s = score(c, a.k), base = +c.abil[a.k] || 0, bg = +(c.bgAbil || {})[a.k] || 0;
    const parts = [`база ${base}`, bg ? `предыстория +${bg}` : '', s - base - bg ? `черты/умения ${fmt(s - base - bg)}` : ''].filter(Boolean);
    $(`#sc-${a.k}`).textContent = s;
    $(`#sc-${a.k}`).title = s !== base ? `${a.n} ${s}: ${parts.join(', ')}` : `${a.n} ${s}`;
    $(`#sc-${a.k}`).classList.toggle('boosted', s !== base);
    $(`#af-${a.k}`).textContent = abilEdit && s !== base ? `итог ${s}` : '';
    $(`#as-${a.k}`).title = !c.saves[a.k] && saveProf(c, a.k) ? 'Владение от черты «Устойчивый»' : '';
  });
}

function renderSkills() {
  const c = ch();
  $('#skillList').innerHTML = SKILLS.map((s) => {
    const p = c.skills[s.k] || 0;
    const ab = ABILITIES.find((a) => a.k === s.a);
    return `<div class="skill"><button class="prof-dot p${p}" data-act="skillProf" data-k="${s.k}" title="${['Нет владения', 'Владение', 'Компетентность'][p]}"></button>
      <button class="sname" data-act="skillInfo" data-k="${s.k}">${s.n}${s.k === 'stealth' && armorStealthDis(c) ? ' <span class="tag" title="Из-за доспеха">помеха</span>' : ''}</button><span class="sabil">${ab.s}</span>
      <button class="sbonus" data-act="rollSkill" data-k="${s.k}">${fmt(skillBonus(c, s))}</button></div>`;
  }).join('');
  const pas = (k) => 10 + skillBonus(c, SKILLS.find((s) => s.k === k));
  $('#passives').innerHTML = `<span class="badge">Пасс. Внимательность <b>${pas('perception')}</b></span><span class="badge">Пасс. Проницательность <b>${pas('insight')}</b></span><span class="badge">Пасс. Анализ <b>${pas('investigation')}</b></span>${c.prof.senses ? `<span class="badge">${esc(c.prof.senses)}</span>` : ''}`;
}

function pipsHtml(max, used, act, data) {
  let h = '';
  for (let i = 0; i < max; i++) {
    const u = i >= max - used;
    h += `<button class="pip ${u ? 'used' : ''}" data-act="${act}" ${data} data-u="${u ? 1 : 0}" title="${u ? 'Восстановить' : 'Потратить'}"></button>`;
  }
  return `<span class="pips">${h}</span>`;
}

function renderCombat() {
  const c = ch(), cb = c.combat;
  $('#hdInfo').innerHTML = hitDicePools(c).map((p) => `<span class="badge">к${p.die}: <b>${p.total - p.used}</b> / ${p.total}
    <button class="ghost" data-act="spendHd" data-die="${p.die}" title="Потратить кость к${p.die}" ${p.total - p.used ? '' : 'disabled'}>🎲</button></span>`).join(' ');
  $('#hdDieWrap').hidden = isMulti(c);
  const dp = (n, cls, type) => [0, 1, 2].map((i) => `<button class="pip ${cls} ${i < n ? 'fill' : ''}" data-act="deathPip" data-type="${type}" data-i="${i}"></button>`).join('');
  let status = '';
  if (cb.deathF >= 3) status = '<b style="color:var(--red)">☠ Персонаж погиб</b>';
  else if (cb.deathS >= 3) status = '<b style="color:var(--green)">Стабилизирован</b>';
  $('#deathBox').innerHTML = `<div><div class="muted small">Успехи</div><span class="pips">${dp(cb.deathS, 'ok', 'S')}</span></div>
    <div><div class="muted small">Провалы</div><span class="pips">${dp(cb.deathF, 'bad', 'F')}</span></div>
    <button data-act="deathSave">🎲 Спасбросок от смерти</button><button class="ghost" data-act="deathReset">сброс</button> ${status}`;
  $('#deathBox').style.opacity = (+cb.hp || 0) <= 0 ? 1 : 0.55;

  $('#exhBox').innerHTML = [0, 1, 2, 3, 4, 5, 6].map((v) => `<button class="${v && v <= cb.exhaustion ? 'on' : ''} ${v === 0 && !cb.exhaustion ? 'on' : ''}" data-act="exh" data-v="${v}">${v}</button>`).join('') +
    `<button class="ghost" data-act="condInfo" data-k="exhaustion">ℹ</button><span class="muted small">${cb.exhaustion ? `−${exhPen(c)} к к20-тестам, скорость −${cb.exhaustion * 5} фт${cb.exhaustion >= 6 ? ' — СМЕРТЬ' : ''}` : 'нет'}</span>`;

  $('#condList').innerHTML = CONDITIONS.map((d) => `<span class="chip ${cb.conditions.includes(d.k) ? 'on' : ''}"><button data-act="cond" data-k="${d.k}">${d.n}</button><button class="info" data-act="condInfo" data-k="${d.k}" title="Описание">ℹ</button></span>`).join('');

  $('#attackList').innerHTML = c.attacks.map((a) => {
    const m = MASTERY[a.mastery];
    return `<div class="li"><div class="li-head">
      <span class="li-title" data-act="toggleOpen" data-id="${a.id}">${esc(a.n)}</span>
      <span class="li-sub">${fmt(attackBonus(c, a))} к попаданию · ${esc(dmgExpr(c, a))} ${esc(a.type)}${a.range ? ' · ' + esc(a.range) : ''}</span>
      ${a.ammo ? `<span class="tag ${ammoLeft(c, a) ? 'r' : 'c'}" title="Боеприпасы из инвентаря">🏹 ${esc(a.ammo)}: ${ammoLeft(c, a)}</span>` : ''}
      ${a.ability === 'fin' ? `<span class="tag" title="Сила или Ловкость выбирается автоматически — по большему урону (в ярости учитывается её бонус к урону Силой)">${finUsesStr(c) ? 'СИЛ' : 'ЛОВ'}${raging(c) && finUsesStr(c) ? ' · ярость' : ''}</span>` : ''}
      ${a.ma ? `<span class="tag e" title="Кость урона растёт с уровнем: к6 → к8 (5) → к10 (11) → к12 (17)">Боевые искусства</span>` : ''}
      ${a.mastery && m ? (masteryActive(c, a)
        ? `<span class="tag g" data-act="masteryInfo" data-k="${a.mastery}" style="cursor:pointer">⚔ ${m.n}</span>`
        : `<span class="tag off" data-act="masteryPick" style="cursor:pointer" title="Приём «${m.n}» не изучен для вида «${esc(weaponKind(a))}» — нажмите, чтобы выбрать в «Приёмах оружия»">⚔ ${m.n} · не изучен</span>`) : ''}
      <span class="btns"><button data-act="atkRoll" data-id="${a.id}">🎯 Атака</button><button data-act="dmgRoll" data-id="${a.id}">Урон</button><button data-act="dmgRoll" data-crit="1" data-id="${a.id}">Крит</button>
      <button class="ghost" data-act="editAttack" data-id="${a.id}" title="Изменить">✎</button><button class="ghost" data-act="delAttack" data-id="${a.id}" title="Удалить">✕</button></span>
    </div>${openSet.has(a.id) && (a.x || m?.d) ? `<div class="li-desc">${esc(a.x)}${a.x && m?.d ? '\n\n' : ''}${m?.d ? '<b>' + m.n + ':</b> ' + esc(m.d) : ''}</div>` : ''}</div>`;
  }).join('') || '<div class="muted">Нет атак</div>';
  const lim = masteryLimit(c);
  $('#masteryBox').hidden = !lim && !c.masteries.length;
  $('#masteryBox').innerHTML = `<span class="muted small" title="Сколько видов оружия с приёмами (Weapon Mastery) вы знаете">Приёмы оружия ${c.masteries.length}/${lim}:</span>
    ${c.masteries.map((w) => { const wp = WEAPONS.find((x) => x.n === w); return `<span class="chip"><span>${esc(w)}${wp ? ` · ${MASTERY[wp.m].n}` : ''}</span><button data-act="masteryDel" data-w="${esc(w)}" title="Убрать">✕</button></span>`; }).join('')}
    <button data-act="masteryPick" class="${c.masteries.length < lim ? 'primary' : ''}">${c.masteries.length < lim ? '＋ Выбрать' : 'Изменить'}</button>`;
  const spent = Object.values(cb.ammoSpent || {}).reduce((s, n) => s + n, 0);
  $('#recoverAmmo').hidden = !spent;
  $('#recoverAmmo').textContent = `🏹 Собрать боеприпасы (${Math.floor(spent / 2)} из ${spent})`;
  renderShape();

  if (c.armor.mode === 'auto') {
    const r = computeAC(c);
    $('#acInfo').innerHTML = `КД <b>${r.ac}</b> = ${esc(r.src)}${r.notes.map((n) => `<div class="gen-warn">⚠ ${esc(n)}</div>`).join('')}`;
  }

  const sb = speedBonuses(c), slow = armorSlow(c);
  $('#speedInfo').textContent = sb.length || slow || cb.exhaustion
    ? `Итоговая скорость ${curSpeed(c)} фт: ${[`база ${+cb.speed || 0}`, ...sb.map(([n, v]) => `+${v} ${n}`), slow ? `−${slow} доспех` : '', cb.exhaustion ? `−${cb.exhaustion * 5} истощение` : ''].filter(Boolean).join(', ')}`
    : '';

  $('#roundNum').textContent = cb.round;
  $('#effList').innerHTML = c.effects.map((e) => `<div class="li eff"><div class="li-head">
      <span class="li-title" data-act="toggleOpen" data-id="${e.id}">${esc(e.n)}</span>${e.conc ? '<span class="tag c">К</span>' : ''}
      <span class="eff-left">${fmtRounds(e.left)}</span>
      <span class="btns"><button data-act="effAdj" data-id="${e.id}" data-d="-1" title="−1 раунд">−1р</button><button data-act="effAdj" data-id="${e.id}" data-d="1" title="+1 раунд">+1р</button>
      <button class="ghost" data-act="delEffect" data-id="${e.id}" title="Завершить">✕</button></span></div>
      <div class="meter"><div style="width:${e.total ? Math.min(100, e.left / e.total * 100) : 0}%"></div></div>
      ${openSet.has(e.id) && e.x ? `<div class="li-desc">${esc(e.x)}</div>` : ''}</div>`).join('') ||
    '<div class="muted small">Нет активных эффектов. Заклинания с длительностью добавляются сюда автоматически при сотворении.</div>';
}

// Сколько заклинаний можно подготовить и сколько знать заговоров (сумма по классам); null — класс без таблицы
function spellLimits(c) {
  let prep = null, cantrips = null;
  const parts = [];
  classList(c).forEach((e) => {
    const p = PREP_TABLE[e.cls], k = CANTRIP_TABLE[e.cls];
    if (p) { prep = (prep || 0) + p[e.lvl - 1]; parts.push(`${e.cls}: ${p[e.lvl - 1]}`); }
    if (k) cantrips = (cantrips || 0) + k[e.lvl >= 10 ? 2 : e.lvl >= 4 ? 1 : 0];
  });
  return { prep, cantrips, note: parts.length ? `Подготовленных заклинаний — ${parts.join(', ')}. «Всегда подготовленные» не считаются.` : '' };
}
const spellCounts = (c) => ({ prep: c.spells.filter((s) => s.l > 0 && s.prep && !s.always).length, cantrips: c.spells.filter((s) => +s.l === 0 && !s.always).length });
function renderSpells() {
  const c = ch(), sc = c.spellcasting, t = sc.casterType;
  const cc = casterClasses(c), AB = (k) => ABILITIES.find((a) => a.k === k).s;
  $('#spellStats').innerHTML = cc.length > 1
    // Мультикласс: у каждого класса свои СЛ и атака
    ? cc.map((x) => { const m = am(c, x.ab), b = +c.spellcasting.bonus || 0; return `<div class="stat" title="${esc(x.sub || x.cls)}: ${AB(x.ab)}"><b>${8 + pb(c) + m + b} · ${fmt(pb(c) + m + b)}</b><span>${esc(x.cls)} (${AB(x.ab)}): СЛ · атака</span></div>`; }).join('')
    : `<div class="stat"><b>${spellDC(c)}</b><span>СЛ спасброска</span></div>
    <button class="stat" data-act="spellAttack"><b>${fmt(spellAtk(c))}</b><span>Атака заклинанием</span></button>
    <div class="stat"><b>${fmt(spellMod(c))}</b><span>Модификатор</span></div>`;
  const manual = t === 'manual';
  c.slots.forEach((s, i) => {
    const row = $(`#slotRow${i}`);
    row.hidden = !manual && !s.max;
    $(`#slotPips${i}`).innerHTML = pipsHtml(s.max, s.used, 'slotPip', `data-l="${i}"`);
    $(`#slotCnt${i}`).textContent = s.max ? `${s.max - s.used}/${s.max}` : '';
  });
  $('#pactRow').hidden = !manual && !c.pact.max;
  $('#pactPips').innerHTML = pipsHtml(c.pact.max, c.pact.used, 'pactPip', '');
  $('#pactCnt').textContent = c.pact.max ? `${c.pact.max - c.pact.used}/${c.pact.max} · ${c.pact.level} ур.` : '';
  $('#slotHint').textContent = manual ? 'Ручной режим: задайте максимум ячеек сами.'
    : isMulti(c) ? 'Мультикласс: ячейки считаются по таблице мультикласса из уровней ваших классов (Магия договора — отдельно по уровню колдуна).'
      : t === 'none' ? 'Выберите тип заклинателя — ячейки рассчитаются по уровню автоматически.'
        : 'Ячейки рассчитываются по уровню автоматически. Кликните по кружку, чтобы потратить/вернуть.';

  const q = $('#spellFilter').value.trim().toLowerCase();
  const onlyPrep = $('#spellOnlyPrep').checked;
  const lim = spellLimits(c), cnt = spellCounts(c);
  const over = (n, m) => (m != null && n > m ? ' over' : '');
  $('#prepCount').innerHTML = lim.prep == null && lim.cantrips == null
    ? (c.spells.length ? `— всего ${c.spells.length}, подготовлено ${cnt.prep}` : '')
    : `<span class="badge${over(cnt.prep, lim.prep)}" title="${esc(lim.note)}">Подготовлено <b>${cnt.prep}/${lim.prep ?? '—'}</b></span>
       <span class="badge${over(cnt.cantrips, lim.cantrips)}">Заговоры <b>${cnt.cantrips}/${lim.cantrips ?? '—'}</b></span>
       ${cnt.prep > (lim.prep ?? 99) || cnt.cantrips > (lim.cantrips ?? 99) ? '<span class="small gen-warn">больше, чем позволяют правила</span>' : ''}`;
  let html = '';
  for (let l = 0; l <= 9; l++) {
    const list = c.spells.filter((s) => +s.l === l && (!q || (s.n + ' ' + (s.e || '')).toLowerCase().includes(q)) && (!onlyPrep || l === 0 || s.prep || s.always))
      .sort((a, b) => a.n.localeCompare(b.n, 'ru'));
    if (!list.length) continue;
    const slot = l ? c.slots[l - 1] : null;
    html += `<div class="spell-lvl"><h3>${l ? l + ' уровень' : 'Заговоры'}${slot && slot.max ? pipsHtml(slot.max, slot.used, 'slotPip', `data-l="${l - 1}"`) : ''}</h3><div class="list">`;
    html += list.map((s) => `<div class="li ${l && !s.prep && !s.always ? 'dim' : ''}"><div class="li-head">
        ${s.always ? `<span class="tag g" title="Всегда подготовлено${s.auto || s.autoAlways ? ` — ${esc(s.auto || s.autoAlways)}` : ''}; не входит в лимит">${esc(s.auto || s.autoAlways || 'всегда')}</span>` : l ? `<input type="checkbox" class="prep" data-act="togglePrep" data-id="${s.id}" ${s.prep ? 'checked' : ''} title="Подготовлено">` : ''}
        <span class="li-title" data-act="toggleOpen" data-id="${s.id}">${esc(s.n)}</span>
        ${s.cn ? '<span class="tag c" title="Концентрация">К</span>' : ''}${s.rt ? '<span class="tag r" title="Ритуал">Р</span>' : ''}
        <span class="li-sub">${esc(s.t || '')}${s.r ? ' · ' + esc(s.r) : ''}</span>
        <span class="btns"><button data-act="castSpell" data-id="${s.id}">✨ Сотворить</button>
        <button class="ghost" data-act="editSpell" data-id="${s.id}" title="Изменить">✎</button><button class="ghost" data-act="delSpell" data-id="${s.id}" title="Удалить">✕</button></span>
      </div>${openSet.has(s.id) ? `<div class="li-desc">${spellMetaHtml(s)}<p>${esc(s.x || '')}</p></div>` : ''}</div>`).join('');
    html += '</div></div>';
  }
  $('#spellList').innerHTML = html || '<p class="muted">Заклинаний нет. Добавьте их из справочника или создайте своё.</p>';
}
function spellMetaHtml(s) {
  return `<div class="spell-meta"><span>Школа: <b>${esc(s.s || '—')}</b></span><span>Время: <b>${esc(s.t || '—')}</b></span><span>Дистанция: <b>${esc(s.r || '—')}</b></span>
    <span>Компоненты: <b>${esc(s.c || '—')}</b></span><span>Длительность: <b>${esc(s.d || '—')}</b></span>${s.k ? `<span>Классы: <b>${esc(s.k)}</b></span>` : ''}${s.f ? `<span>Бросок: <b>${esc(s.f)}${s.u ? ` (+${esc(s.u)}/ур.)` : ''}</b></span>` : ''}</div>`;
}

function renderInventory() {
  const c = ch();
  const q = $('#itemFilter').value.trim().toLowerCase(), cat = $('#itemCat').value;
  const items = c.items.filter((i) => (!q || (i.n + ' ' + (i.x || '')).toLowerCase().includes(q)) && (!cat || i.cat === cat));
  $('#itemList').innerHTML = items.map((i) => `<div class="li ${i.eq ? 'equipped' : ''}"><div class="li-head">
      <span class="li-title" data-act="toggleOpen" data-id="${i.id}">${esc(i.n)}</span>
      <span class="tag">${esc(i.cat)}</span>${i.eq ? '<span class="tag g">экипировано</span>' : ''}${i.att ? `<span class="tag ${i.attuned ? 'e' : ''}">${i.attuned ? 'настроен' : 'требует настройки'}</span>` : ''}
      ${magicTags(i) ? `<span class="tag ${itemActive(i) ? 'g' : 'off'}" title="${itemActive(i) ? 'Действует' : 'Не действует: экипируйте' + (i.att ? ' и настройтесь' : '')}">✨ ${esc(magicTags(i))}</span>` : ''}
      ${i.heal && +i.qty > 0 ? `<button data-act="drink" data-id="${i.id}" title="Выпить: ${esc(i.heal)} хитов">🧪 Выпить</button>` : ''}
      ${+i.chMax ? `<span class="qty" title="Заряды"><span class="muted small">заряды</span><button data-act="charge" data-id="${i.id}" data-d="-1">−</button><b>${i.ch}/${i.chMax}</b><button data-act="charge" data-id="${i.id}" data-d="1">+</button></span>` : ''}
      <span class="qty"><button data-act="qty" data-id="${i.id}" data-d="-1">−</button><b>${i.qty}</b><button data-act="qty" data-id="${i.id}" data-d="1">+</button></span>
      <span class="li-sub">${+i.w ? +(i.w * i.qty).toFixed(2) + ' фнт' : ''}</span>
      <span class="btns"><button data-act="toggleEquip" data-id="${i.id}" title="Экипировать/снять">${i.eq ? '◉' : '○'}</button>
      ${i.att ? `<button data-act="toggleAttune" data-id="${i.id}" title="Настройка">${i.attuned ? '✦' : '✧'}</button>` : ''}
      <button class="ghost" data-act="editItem" data-id="${i.id}">✎</button><button class="ghost" data-act="delItem" data-id="${i.id}">✕</button></span>
    </div>${openSet.has(i.id) && (i.x || i.cost) ? `<div class="li-desc">${i.cost ? `Цена: ${esc(i.cost)}\n` : ''}${esc(i.x)}</div>` : ''}</div>`).join('') || '<div class="muted">Пусто</div>';

  const coins = ['cp', 'sp', 'ep', 'gp', 'pp'].reduce((a, k) => a + (+c.coins[k] || 0), 0);
  const weight = c.items.reduce((a, i) => a + (+i.w || 0) * (+i.qty || 0), 0) + coins / 50;
  const sizeK = { 'Крошечный': 0.5, 'Маленький': 1, 'Средний': 1, 'Большой': 2 }[c.info.size] || 1;
  const cap = score(c, 'str') * 15 * sizeK;
  const pct = cap ? weight / cap * 100 : 0;
  const attuned = c.items.filter((i) => i.att && i.attuned).length;
  $('#loadBox').innerHTML = `<div class="row between"><span>Вес: <b>${+weight.toFixed(1)}</b> / ${cap} фнт</span><span class="muted small">монеты: ${+(coins / 50).toFixed(1)} фнт</span></div>
    <div class="meter ${pct > 100 ? 'over' : pct > 66 ? 'warn' : ''}"><div style="width:${Math.min(100, pct)}%"></div></div>
    ${pct > 100 ? '<div class="small" style="color:#f3b1a8">Перегруз! Скорость не больше 5 фт.</div>' : ''}
    <div class="mt">Настройка: <b style="color:${attuned > 3 ? 'var(--red)' : 'var(--gold2)'}">${attuned} / 3</b></div>
    <div class="muted small">Тащить/толкать/поднять: до ${cap * 2} фнт</div>`;
  $('#coinTotal').textContent = `Всего ≈ ${+coinGp(c.coins).toFixed(2)} зм`;
}

// Карточка ресурса; compact — для вкладки «Бой» (без правки и удаления)
function resCardHtml(c, r, compact) {
  const left = r.max - r.used, big = r.max > 20;
  const managed = r.auto && !r.manual && CLASS_RESOURCES[r.auto];
  const from = !r.max && managed ? resFromLevel(c, r) : 0;
  return `<div class="res ${r.max ? '' : 'dim'}"><div class="row between gap"><span class="rn" data-act="toggleOpen" data-id="${r.id}">${esc(r.n)}</span><span class="rcount">${left}<span class="muted small"> / ${r.max}</span></span></div>
    ${compact ? '' : `<div class="muted small">восстановление: ${RECHARGE[r.recharge] || r.recharge}${r.auto ? ' · авто по уровню' : ''}${from ? ` · появится с ${from} уровня` : !r.max && r.auto ? ' · недоступно на этом уровне' : ''}</div>`}
    ${!big && r.max ? `<div class="mt">${pipsHtml(r.max, r.used, 'resPip', `data-id="${r.id}"`)}</div>` : ''}
    ${r.max ? `<div class="rctl">${big ? `<input type="number" min="1" placeholder="кол-во" class="resAmt"><button data-act="resUse" data-id="${r.id}" data-d="1" data-amt="1">Потратить</button><button data-act="resUse" data-id="${r.id}" data-d="-1" data-amt="1">Вернуть</button>`
      : `<button data-act="resUse" data-id="${r.id}" data-d="1">−1</button><button data-act="resUse" data-id="${r.id}" data-d="-1">+1</button>`}
      <button class="ghost" data-act="resReset" data-id="${r.id}" title="Восстановить всё">⟲</button>
      ${compact ? '' : `<button class="ghost" data-act="editRes" data-id="${r.id}">✎</button>${managed ? '' : `<button class="ghost" data-act="delRes" data-id="${r.id}">✕</button>`}`}</div>` : ''}
    ${openSet.has(r.id) && r.x ? `<div class="li-desc">${esc(r.x)}</div>` : ''}</div>`;
}
// Вдохновение, полученное от других: героическое (от мастера) и кость вдохновения барда (держится 1 час)
const bardicHeld = (c) => c.effects.find((e) => e.bardic);
function receivedHtml(c) {
  const insp = !!c.combat.inspiration, b = bardicHeld(c);
  return `<div class="res recv"><div class="row between gap"><span class="rn">★ Героическое вдохновение</span><span class="rcount">${insp ? 1 : 0}<span class="muted small"> / 1</span></span></div>
      <div class="muted small">От мастера за хорошую игру или от «Находчивости» человека. Можно перебросить любой свой кубик — нужно взять новый результат.</div>
      <div class="rctl"><button data-act="toggleInsp" class="${insp ? '' : 'primary'}">${insp ? 'Потратить' : 'Получить'}</button></div></div>
    <div class="res recv"><div class="row between gap"><span class="rn">🎵 Вдохновение барда (получено)</span>${b ? `<span class="rcount">к${b.die}</span>` : '<span class="muted small">нет</span>'}</div>
      <div class="muted small">Кость от барда-союзника: после проваленного к20-теста (атака, проверка, спасбросок) бросьте её и добавьте к результату. Действует 1 час, одновременно — только одна.</div>
      <div class="rctl">${b ? `<button class="primary" data-act="bardicUse">🎲 Бросить к${b.die}</button><span class="muted small">ещё ${fmtRounds(b.left)}</span><button class="ghost" data-act="bardicDrop" title="Убрать">✕</button>`
        : `<span class="muted small">Получить:</span>${[6, 8, 10, 12].map((d) => `<button data-act="bardicGet" data-d="${d}">к${d}</button>`).join('')}`}</div></div>`;
}
/* ---------- Выборы класса с лимитами ---------- */
// Компетентность (PHB 2024): плут 1 — 2, 6 — ещё 2; бард 2 — 2, 9 — ещё 2; следопыт 2 — 1, 9 — ещё 2;
// волшебник 2 («Учёный») — 1; черты «Эксперт навыков» и «Дар мастерства навыков» — по 1
function expertiseLimit(c) {
  const R = clsLvl(c, 'Плут'), B = clsLvl(c, 'Бард'), S = clsLvl(c, 'Следопыт'), Wz = clsLvl(c, 'Волшебник');
  return (R >= 6 ? 4 : R >= 1 ? 2 : 0) + (B >= 9 ? 4 : B >= 2 ? 2 : 0) + (S >= 9 ? 3 : S >= 2 ? 1 : 0) + (Wz >= 2 ? 1 : 0)
    + c.feats.filter((f) => f.key === 'skillExpert' || f.key === 'boonSkill').length;
}
const expertiseCount = (c) => SKILLS.filter((s) => (c.skills[s.k] || 0) === 2).length;
// Уровень класса для выбора (приёмы — только у Мастера боевых искусств)
const pickLevel = (c, P) => classList(c).filter((x) => x.cls === P.cls && (!P.sub || x.sub === P.sub)).reduce((s, x) => s + x.lvl, 0);
const isLandDruid = (c) => classList(c).some((e) => e.cls === 'Друид' && e.sub === 'Круг земли');
function renderClassPicks() {
  const c = ch(), rows = [], picks = c.cpicks || {};
  Object.entries(CLASS_PICKS).forEach(([k, P]) => {
    const L = pickLevel(c, P), lim = L ? P.limit(L) : 0, have = picks[k] || [];
    if (!lim && !have.length) return;
    rows.push(`<div class="li"><div class="li-head"><span class="li-title">${P.n}</span>
      <span class="badge${have.length > lim ? ' over' : ''}" title="Выбрано / положено на этом уровне">${have.length}/${lim}</span>
      <span class="btns"><button data-act="cpick" data-k="${k}" class="${have.length < lim ? 'primary' : ''}">${have.length < lim ? '＋ Выбрать' : 'Изменить'}</button></span></div>
      ${have.length ? `<div class="chips">${have.map((n) => `<span class="chip on" title="${esc((P.list.find((x) => x[0] === n) || [])[2] || '')}"><span>${esc(n)}</span></span>`).join('')}</div>` : ''}</div>`);
  });
  const el = expertiseLimit(c), ec = expertiseCount(c);
  if (el || ec) rows.push(`<div class="li"><div class="li-head"><span class="li-title">Компетентность</span><span class="badge${ec > el ? ' over' : ''}">${ec}/${el}</span></div>
    <div class="muted small">Навыки с удвоенным бонусом мастерства: на вкладке «Персонаж» нажмите кружок у навыка второй раз.</div></div>`);
  if (clsLvl(c, 'Бард') >= 10) rows.push(`<div class="li"><div class="li-head"><span class="li-title">Магические тайны</span><span class="btns"><button data-act="addSpellDb">📖 Заклинания</button></span></div>
    <div class="muted small">Заклинания жреца, друида и волшебника считаются заклинаниями барда — в списке «Бард» они тоже есть.</div></div>`);
  if (isLandDruid(c)) rows.push(`<div class="li"><div class="li-head"><span class="li-title">Круг земли — местность</span>
    <select data-bind="info.land" style="width:auto">${['', ...Object.keys(LAND_SPELLS)].map((n) => `<option value="${n}">${n || '— выберите —'}</option>`).join('')}</select></div>
    <div class="muted small">Заклинания местности всегда подготовлены и добавляются сами. Сменить местность можно после долгого отдыха.</div></div>`);
  $('#cpickCard').hidden = !rows.length;
  $('#cpickBox').innerHTML = rows.join('');
}
function openClassPick(k) {
  const c = ch(), P = CLASS_PICKS[k], L = pickLevel(c, P), lim = P.limit(L);
  const draw = () => {
    const have = (c.cpicks || {})[k] || [];
    $('#modalBody').innerHTML = `<h2>${P.n}</h2><p class="muted small">Выбрано ${have.length} из ${lim} · ${P.sub || P.cls} ${L} уровня. Новые варианты открываются с уровнем.</p>
      <div class="list">${P.list.map(([n, ml, d]) => {
        const on = have.includes(n), off = !on && (ml > L || have.length >= lim);
        return `<label class="check cp-row ${off ? 'off' : ''}"><input type="checkbox" data-cp="${esc(n)}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''}>
          <span><b>${esc(n)}</b>${ml > 1 ? ` <span class="muted small">с ${ml} ур.</span>` : ''}<span class="muted small" style="display:block">${esc(d)}</span></span></label>`;
      }).join('')}</div>
      <div class="modal-actions"><button class="primary" data-act="closeModal">Готово</button></div>`;
    $$('[data-cp]').forEach((x) => x.addEventListener('change', () => {
      if (x.checked && ((c.cpicks || {})[k] || []).length >= lim) { x.checked = false; toast(`Не больше ${lim} на этом уровне`); return; }
      tracked(P.n.toLowerCase(), () => {
        const h = new Set((c.cpicks = c.cpicks || {})[k] || []);
        if (x.checked) h.add(x.dataset.cp); else h.delete(x.dataset.cp);
        c.cpicks[k] = [...h];
      });
      save(); render(); draw();
    }));
  };
  openModal('');
  draw();
}
function renderFeatures() {
  renderClassPicks();
  const c = ch();
  $('#resList').innerHTML = receivedHtml(c) + c.resources.map((r) => resCardHtml(c, r, false)).join('');

  const slots = featSlots(c);
  $('#featSlots').innerHTML = Object.entries(FEAT_SLOTS).filter(([k]) => slots[k]).map(([k, s]) => {
    const used = c.feats.filter((f) => f.slot === k).length;
    return `<span class="badge ${used < slots[k] ? 'free' : ''}">${s.n}: <b>${used}/${slots[k]}</b></span>`;
  }).join('');
  $('#featChosen').innerHTML = c.feats.map((f) => {
    const d = FEATS_BY[f.key] || { n: f.key, x: '', cat: '' }, eff = featEffectText(f);
    return `<div class="li"><div class="li-head">
      <span class="li-title" data-act="toggleOpen" data-id="${f.id}">${esc(d.n)}</span>
      <span class="tag">${esc(FEAT_SLOTS[f.slot] ? FEAT_SLOTS[f.slot].n : '')}</span>${eff ? `<span class="tag e">${eff}</span>` : ''}
      ${f.bg ? `<span class="tag g" title="Черта от предыстории">предыстория${f.note ? `: ${esc(f.note)}` : ''}</span>` : ''}
      ${f.lvl ? `<span class="li-sub">${f.lvl} ур.</span>` : ''}
      <span class="btns">${featPickNeed(f) ? `<button class="${(f.spells || []).length >= featPickNeed(f) ? '' : 'primary'}" data-act="featSpells" data-id="${f.id}" title="Выбрать заклинания черты">✨ Заклинания ${(f.spells || []).length}/${featPickNeed(f)}</button>` : ''}
      <button class="ghost" data-act="delFeat" data-id="${f.id}" title="Убрать черту">✕</button></span>
    </div>${openSet.has(f.id) ? `<div class="li-desc">${esc(d.x)}${(f.spells || []).length ? `\nЗаклинания: ${f.spells.map((e) => spellByE(e)?.n || e).join(', ')}${f.list ? ` (список: ${f.list})` : ''}` : ''}</div>` : ''}</div>`;
  }).join('') || '<div class="muted small">Черт пока нет. Черту происхождения даёт предыстория на 1 уровне.</div>';

  // Описание: своё (если вписано) или из справочника по классу из источника («Монах 5» → Монах)
  $('#featList').innerHTML = c.features.map((f) => {
    const desc = f.x || featureDesc(String(f.src || '').split(' ')[0], f.n);
    return `<div class="li"><div class="li-head">
      <span class="li-title" data-act="toggleOpen" data-id="${f.id}">${esc(f.n)}${desc ? ' <span class="muted small">▾</span>' : ''}</span>${f.src ? `<span class="tag">${esc(f.src)}</span>` : ''}
      <span class="btns"><button class="ghost" data-act="editFeature" data-id="${f.id}">✎</button><button class="ghost" data-act="delFeature" data-id="${f.id}">✕</button></span>
    </div>${openSet.has(f.id) && desc ? `<div class="li-desc">${esc(desc)}</div>` : ''}</div>`;
  }).join('') || '<div class="muted">Добавьте умения класса, черты (feats), особенности расы и предыстории.</div>';
}

// Боевые умения класса/расы: значения по уровню и кнопки бросков
function classPanelItems(c) {
  const items = [], CL = (n) => clsLvl(c, n);
  const left = (k) => { const r = c.resources.find((x) => x.auto === k); return r ? `осталось ${r.max - r.used} из ${r.max}` : ''; };
  // Дополнительные атаки разных классов не складываются — берётся лучшая
  const F = CL('Воин');
  const atk = Math.max(F >= 20 ? 4 : F >= 11 ? 3 : F >= 5 ? 2 : 1, ['Варвар', 'Монах', 'Паладин', 'Следопыт'].some((n) => CL(n) >= 5) ? 2 : 1);
  if (atk > 1) items.push({ n: 'Атак за действие «Атака»', v: atk });
  if (critMin(c) < 20) items.push({ n: 'Критическое попадание', v: `на ${critMin(c)}–20`, sub: 'Чемпион — учитывается при атаке оружием' });
  if (CL('Варвар')) {
    const on = raging(c);
    items.push({ n: 'Ярость', v: `+${rageDmg(c)} к урону Силой`, sub: on ? 'активна: сопротивление дроб./кол./руб., преимущество Силы' : left('rage'),
      btn: `<button data-act="rageToggle" class="${on ? 'danger' : 'primary'}">${on ? 'Закончить ярость' : '🔥 Впасть в ярость'}</button>`, on });
  }
  if (CL('Монах')) {
    items.push({ n: 'Кость Боевых искусств', v: martialDie(CL('Монах')).replace('1d', 'к') });
    items.push({ n: 'СЛ умений монаха', v: 8 + am(c, 'wis') + pb(c), sub: 'Ошеломляющий удар и др.' });
  }
  if (CL('Плут')) {
    const n = Math.ceil(CL('Плут') / 2);
    items.push({ n: 'Скрытая атака', v: `${n}к6`, sub: 'раз в ход, фехтовальное или дальнобойное оружие',
      btn: `<button data-act="sneak">🎲 Урон</button><button data-act="sneak" data-crit="1">Крит</button>` });
    if (CL('Плут') >= 7) items.push({ n: 'Надёжный талант', v: 'к20 < 10 → 10', sub: 'навыки с владением — учитывается при броске' });
  }
  if (F) items.push({ n: 'Второе дыхание', v: `к10 + ${F}`, sub: left('secondWind'), btn: '<button data-act="secondWind">❤ Использовать</button>' });
  if (CL('Бард')) {
    const B = CL('Бард'), d = B >= 15 ? 12 : B >= 10 ? 10 : B >= 5 ? 8 : 6;
    items.push({ n: 'Кость вдохновения', v: `к${d}`, sub: left('bardic'), btn: `<button data-act="bardDie" data-d="${d}">🎲 Бросить</button>` });
  }
  if (CL('Паладин')) {
    const P = CL('Паладин');
    if (P >= 6) items.push({ n: 'Аура защиты', v: `+${Math.max(1, am(c, 'cha'))} к спасброскам`, sub: `радиус ${P >= 18 ? 30 : 10} фт · уже учтена в ваших спасбросках` });
    if (P >= 11) items.push({ n: 'Сияющие удары', v: '+1к8 излучением', sub: 'попадание рукопашным оружием или безоружным ударом', btn: '<button data-act="radiantStrike">🎲</button>' });
  }
  speedBonuses(c).forEach(([n, v]) => items.push({ n, v: `+${v} фт`, sub: 'уже учтено в скорости' }));
  if (isLucky(c)) items.push({ n: 'Удача полурослика', v: '1 на к20 → переброс', sub: 'учитывается при бросках' });
  if (hpPerLevelBonus(c)) items.push({ n: 'Доп. хиты за уровень', v: `+${hpPerLevelBonus(c)}`, sub: 'дварф / черта «Крепкий» — в расчёте хитов' });
  return items;
}
function renderClassPanel() {
  const c = ch(), items = classPanelItems(c), res = c.resources.filter((r) => r.max > 0);
  $('#classCard').hidden = false; // всегда есть блок полученного вдохновения
  $('#classRes').innerHTML = receivedHtml(c) + res.map((r) => resCardHtml(c, r, true)).join('');
  $('#classPanel').innerHTML = items.map((i) => `<div class="cp-item ${i.on ? 'on' : ''}"><div class="cp-n">${esc(i.n)}</div><div class="cp-v">${esc(String(i.v))}</div>
    ${i.sub ? `<div class="muted small">${esc(i.sub)}</div>` : ''}${i.btn ? `<div class="cp-btns">${i.btn}</div>` : ''}</div>`).join('');
}
// Быстрый доступ к заклинаниям во вкладке «Бой»
function renderQuickSpells() {
  const c = ch(), show = c.spells.length > 0 || c.spellcasting.casterType !== 'none' || c.slots.some((s) => s.max) || c.pact.max > 0;
  $('#qsCard').hidden = !show;
  if (!show) return;
  $('#qsStats').innerHTML = `<span class="badge">СЛ <b>${spellDC(c)}</b></span><button data-act="spellAttack">🎯 Атака ${fmt(spellAtk(c))}</button>`;
  $('#qsSlots').innerHTML = c.slots.map((s, i) => (s.max ? `<span class="qs-slot"><b>${i + 1}</b>${pipsHtml(s.max, s.used, 'slotPip', `data-l="${i}"`)}</span>` : '')).join('')
    + (c.pact.max ? `<span class="qs-slot pact"><b>Д${c.pact.level}</b>${pipsHtml(c.pact.max, c.pact.used, 'pactPip', '')}</span>` : '');
  const list = c.spells.filter((s) => +s.l === 0 || s.prep || s.always).sort((a, b) => a.l - b.l || a.n.localeCompare(b.n, 'ru'));
  $('#qsList').innerHTML = list.map((s) => `<div class="li qs"><div class="li-head">
      <span class="lvl-badge ${s.l ? '' : 'cantrip'}" title="${s.l ? s.l + ' уровень' : 'Заговор (0 уровень)'}">${s.l || '0'}</span>
      <span class="li-title" data-act="toggleOpen" data-id="${s.id}">${esc(s.n)}</span>
      ${s.cn ? '<span class="tag c" title="Концентрация">К</span>' : ''}${s.rt ? '<span class="tag r" title="Ритуал">Р</span>' : ''}
      <span class="li-sub">${esc(s.t || '')}${s.r ? ' · ' + esc(s.r) : ''}${s.f ? ' · ' + esc(s.f) : ''}</span>
      <span class="btns"><button data-act="castSpell" data-id="${s.id}">✨ Сотворить</button></span>
    </div>${openSet.has(s.id) ? `<div class="li-desc">${spellMetaHtml(s)}<p>${esc(s.x || '')}</p></div>` : ''}</div>`).join('')
    || '<div class="muted small">Нет подготовленных заклинаний — отметьте их галочкой во вкладке «Заклинания».</div>';
}

function renderRef() {
  const q = $('#refFilter').value.trim().toLowerCase();
  const isSp = refMode === 'spells';
  $('#refLevel').hidden = !isSp; $('#refClass').hidden = !isSp;
  const match = (...t) => !q || t.join(' ').toLowerCase().includes(q);
  const det = (title, body, extra = '') => `<details class="ref-item"><summary>${title}${extra}</summary>${body}</details>`;
  let html = '';
  if (isSp) {
    const lv = $('#refLevel').value, cl = $('#refClass').value;
    const have = new Set(ch().spells.map((s) => s.n));
    html = SPELLS.map((s, i) => [s, i]).filter(([s]) => match(s.n, s.e, s.s) && (lv === '' || s.l === +lv) && (!cl || s.k.includes(cl) || (cl === 'Бард' && clsLvl(ch(), 'Бард') >= 10 && /Жрец|Друид|Волшебник/.test(s.k))))
      .map(([s, i]) => det(`${esc(s.n)} <span class="muted small">${esc(s.e)} · ${s.l ? s.l + ' ур.' : 'заговор'} · ${esc(s.s)}</span>${s.cn ? ' <span class="tag c">К</span>' : ''}${s.rt ? ' <span class="tag r">Р</span>' : ''}`,
        `${spellMetaHtml(s)}<p>${esc(s.x)}</p><div class="mt"><button data-act="addSpellFromDb" data-i="${i}" ${have.has(s.n) ? 'disabled' : ''}>${have.has(s.n) ? '✓ В листе' : '＋ Добавить в лист'}</button></div>`)).join('');
  } else if (refMode === 'skills') {
    html = SKILLS.filter((s) => match(s.n, s.d)).map((s) => det(`${s.n} <span class="muted small">${ABILITIES.find((a) => a.k === s.a).n}</span>`, `<p>${esc(s.d)}</p>`)).join('');
  } else if (refMode === 'conditions') {
    html = CONDITIONS.filter((s) => match(s.n, s.d)).map((s) => det(s.n, `<p>${esc(s.d)}</p>`)).join('') + (match('Истощение', EXHAUSTION_TEXT) ? det('Истощение', `<p>${EXHAUSTION_TEXT}</p>`) : '');
  } else if (refMode === 'actions') {
    html = ACTIONS_REF.filter((s) => match(s.n, s.d)).map((s) => det(esc(s.n), `<p>${esc(s.d)}</p>`)).join('');
  } else if (refMode === 'mastery') {
    html = Object.values(MASTERY).filter((m) => m.d && match(m.n, m.d)).map((m) => det(m.n, `<p>${esc(m.d)}</p>`)).join('');
  } else {
    html = RULES_REF.filter((s) => match(s.n, s.d)).map((s) => det(esc(s.n), `<p>${esc(s.d)}</p>`)).join('');
  }
  $('#refList').innerHTML = html || '<p class="muted">Ничего не найдено</p>';
}

/* ---------- Генерация характеристик ---------- */
const STD_ARRAY = [15, 14, 13, 12, 10, 8];
const PB_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
const PB_POOL = 27;
const perAbil = (v) => Object.fromEntries(ABILITIES.map((a) => [a.k, v]));
// std и roll хранят индекс числа из набора (а не само число), т.к. при бросках числа могут повторяться
const gen = { mode: 'standard', std: perAbil(null), pb: perAbil(8), rolls: [], roll: perAbil(null), bonus: perAbil(0) };
const pbSpent = () => ABILITIES.reduce((s, a) => s + PB_COST[gen.pb[a.k]], 0);
const genPool = () => (gen.mode === 'standard' ? STD_ARRAY : gen.rolls.map((r) => r.total));
const genAssign = () => (gen.mode === 'standard' ? gen.std : gen.roll);
const genBase = (k) => { if (gen.mode === 'pointbuy') return gen.pb[k]; const i = genAssign()[k]; return i == null ? null : genPool()[i]; };
function genPlace(k, idx) {
  const asg = genAssign();
  for (const kk in asg) if (asg[kk] === idx) asg[kk] = null;
  asg[k] = idx;
}

// embed — генератор встроен в мастер создания: бонусы берутся из выбранной предыстории, без своих кнопок
function renderGen() {
  const box = $('#genBody');
  if (!box) return;
  const embed = box.dataset.embed === '1';
  // Бонусы предыстории уже учтены в листе отдельно — показываем их только для справки, чтобы не задвоить
  const fixed = embed ? wizBgAbil() : (Object.keys(ch().bgAbil || {}).length ? ch().bgAbil : null);
  const bonusOf = (k) => (fixed ? (+fixed[k] || 0) : +gen.bonus[k] || 0);
  const mode = gen.mode, pool = genPool(), asg = genAssign();
  const left = PB_POOL - pbSpent();
  const tabs = [['standard', 'Стандартный набор'], ['pointbuy', 'Покупка очков'], ['roll', 'Бросок 4d6']]
    .map(([m, t]) => `<button data-act="genMode" data-mode="${m}" class="${mode === m ? 'on' : ''}">${t}</button>`).join('');
  let html = `<div class="seg">${tabs}</div>`;

  if (mode === 'standard') html += `<p class="muted small">Распределите числа ${STD_ARRAY.join(', ')}: перетащите число на характеристику или выберите его в списке. Каждое число используется один раз.</p>`;
  if (mode === 'pointbuy') html += `<p class="muted small">Все характеристики начинаются с 8, значения от 8 до 15. Шаги 9–13 стоят по 1 очку, 14 и 15 — по 2 очка.</p>
    <div class="pb-left ${left === 0 ? 'done' : ''}">Осталось очков: <b>${left}</b> / ${PB_POOL}</div>`;
  if (mode === 'roll') {
    html += `<div class="row gap wrap mt"><button class="primary" data-act="genRoll">🎲 ${gen.rolls.length ? 'Перебросить' : 'Бросить кубы'}</button><span class="muted small">Для каждой характеристики 4d6, наименьший куб отбрасывается.</span></div>`;
    if (gen.rolls.length) {
      html += `<div class="rollsets">${gen.rolls.map((r) => `<div class="rollset">${r.dice.map((d, i) => `<span class="d6 ${i === r.drop ? 'drop' : ''}">${d}</span>`).join('')}<b>${r.total}</b></div>`).join('')}</div>
        <p class="muted small">Сумма: ${pool.reduce((a, b) => a + b, 0)}. Распределите результаты по характеристикам.</p>`;
    }
  }

  if (mode !== 'pointbuy' && pool.length) {
    const used = new Set(Object.values(asg).filter((v) => v != null));
    const chips = pool.map((v, i) => (used.has(i) ? '' : `<span class="gchip" draggable="true" data-gidx="${i}">${v}</span>`)).join('');
    html += `<div class="gen-pool" data-gpool>${chips || '<span class="muted small">Все числа распределены — можно перетаскивать между характеристиками</span>'}</div>`;
  }

  const bonusSum = ABILITIES.reduce((s, a) => s + bonusOf(a.k), 0);
  html += `<div class="gen-grid mt"><div class="gen-row head"><span>Характеристика</span><span>Значение</span><span>${fixed ? 'Предыст.' : 'Бонус'}</span><span>Итог</span></div>`;
  html += ABILITIES.map((a) => {
    const base = genBase(a.k), b = bonusOf(a.k);
    const total = base == null ? null : Math.min(20, base + b);
    let ctl;
    if (mode === 'pointbuy') {
      const v = gen.pb[a.k];
      const canUp = v < 15 && PB_COST[v + 1] - PB_COST[v] <= left;
      ctl = `<span class="qty"><button data-act="genPb" data-k="${a.k}" data-d="-1" ${v <= 8 ? 'disabled' : ''}>−</button><b>${v}</b><button data-act="genPb" data-k="${a.k}" data-d="1" ${canUp ? '' : 'disabled'}>+</button></span><span class="muted small">стоимость ${PB_COST[v]}</span>`;
    } else if (!pool.length) {
      ctl = '<span class="muted small">Сначала бросьте кубы</span>';
    } else {
      const i = asg[a.k];
      const opts = pool.map((v, j) => {
        const other = Object.entries(asg).some(([kk, x]) => kk !== a.k && x === j);
        return `<option value="${j}" ${i === j ? 'selected' : ''} ${other ? 'disabled' : ''}>${v}</option>`;
      }).join('');
      ctl = `<div class="gslot" data-gk="${a.k}">${i != null ? `<span class="gchip" draggable="true" data-gidx="${i}" data-from="${a.k}">${pool[i]}</span>` : '<span class="muted small">сюда</span>'}</div>
        <select data-gsel="${a.k}" aria-label="${a.n}"><option value="">—</option>${opts}</select>`;
    }
    return `<div class="gen-row"><span class="gname">${a.n}</span><div class="gctl">${ctl}</div>
      ${fixed ? `<span class="muted">${b ? '+' + b : '—'}</span>` : `<select data-gbonus="${a.k}" title="Бонус предыстории/расы">${[0, 1, 2].map((n) => `<option value="${n}" ${b === n ? 'selected' : ''}>+${n}</option>`).join('')}</select>`}
      <span class="gtotal">${total ?? '—'}<small>${total == null ? '' : fmt(mod(total))}</small></span></div>`;
  }).join('') + '</div>';
  if (embed) { box.innerHTML = html; renderWizNav(); return; }

  html += fixed ? '<p class="muted small">Бонусы предыстории уже учтены в листе — применятся только базовые значения.</p>'
    : '<p class="muted small">Бонус: в D&D 2024 предыстория даёт +2 и +1 или +1 к трём характеристикам; в 5e 2014 — бонусы расы. Итог не выше 20.</p>';
  if (bonusSum > 3) html += `<p class="small gen-warn">Сумма бонусов ${bonusSum} — обычно не больше 3.</p>`;

  const complete = ABILITIES.every((a) => genBase(a.k) != null);
  const why = mode === 'pointbuy' ? (left > 0 ? `Осталось ${left} неистраченных очков (применить всё равно можно).` : '') : (!complete ? 'Распределите все шесть чисел.' : '');
  html += `<div class="modal-actions"><span class="muted small" style="margin-right:auto">${why}</span><button data-act="genReset">Сбросить</button><button data-act="closeModal">Отмена</button>
    <button class="primary" data-act="genApply" ${complete ? '' : 'disabled'}>Применить к персонажу</button></div>`;
  box.innerHTML = html;
}

function openAbilGen() {
  openModal('<h2>Генерация характеристик</h2><div id="genBody"></div>');
  modalRefresh = renderGen;
  $('#modalBody').onchange = genChange;
  installGenDrag($('#modalBody'));
  renderGen();
}
// Изменения в генераторе (выбор числа, бонус); true — событие обработано
function genChange(e) {
  const el = e.target;
  if (el.dataset.gsel) {
    if (el.value === '') genAssign()[el.dataset.gsel] = null; else genPlace(el.dataset.gsel, +el.value);
    renderGen();
    return true;
  }
  if (el.dataset.gbonus) { gen.bonus[el.dataset.gbonus] = +el.value; renderGen(); return true; }
  return false;
}
// Перетаскивание чисел генератора внутри контейнера mb
function installGenDrag(mb) {
  mb.ondragstart = (e) => {
    const chip = e.target.closest && e.target.closest('[data-gidx]');
    if (!chip) return;
    e.dataTransfer.setData('text/plain', JSON.stringify({ i: +chip.dataset.gidx, from: chip.dataset.from || null }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const target = (e) => e.target.closest && e.target.closest('[data-gk],[data-gpool]');
  mb.ondragover = (e) => { const t = target(e); if (!t) return; e.preventDefault(); $$('.over', mb).forEach((x) => x !== t && x.classList.remove('over')); t.classList.add('over'); };
  mb.ondragleave = (e) => { const t = target(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('over'); };
  mb.ondrop = (e) => {
    const t = target(e);
    if (!t) return;
    e.preventDefault();
    let d;
    try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) { return; }
    const asg = genAssign();
    if (t.dataset.gk) {
      const k = t.dataset.gk, prev = asg[k];
      genPlace(k, d.i);
      if (d.from && d.from !== k) asg[d.from] = prev; // обмен значениями между характеристиками
    } else if (d.from) asg[d.from] = null; // вернуть число в общий набор
    renderGen();
  };
}

/* ---------- Мастер создания персонажа ---------- */
// mode: 'new' — новый персонаж (все шаги), 'origin' — раса и предыстория для текущего персонажа
let W = null;
const WIZ_STEPS = ['Раса', 'Предыстория', 'Класс', 'Характеристики', 'Итог'];
const skillName = (k) => SKILLS.find((s) => s.k === k).n;
const abilS = (k) => ABILITIES.find((a) => a.k === k).s;
const wizSp = () => SPECIES_DATA.find((s) => s.n === W.sp);
const wizBg = () => BACKGROUND_DATA.find((b) => b.n === W.bg);
function wizBgAbil() {
  const bg = W && wizBg();
  if (!bg) return {};
  return W.bgMode === '111' ? Object.fromEntries(bg.abil.map((k) => [k, 1])) : { [W.a1]: 2, [W.a2]: 1 };
}
// Навыки, уже полученные на других шагах (нельзя выбрать дважды)
function wizTaken(except) {
  const s = new Set();
  if (except !== 'sp') W.spSkills.forEach((k) => s.add(k));
  if (except !== 'bg' && wizBg()) wizBg().sk.forEach((k) => s.add(k));
  if (except !== 'cls') W.clsSkills.forEach((k) => s.add(k));
  return s;
}
function openWizard(mode) {
  W = { mode, step: 0, name: '', sp: '', size: '', lin: '', spSkills: [], bg: '', bgMode: '21', a1: '', a2: '', cls: '', clsSkills: [], gold: 'kit' };
  if (mode === 'origin') {
    const c = ch();
    W.sp = speciesOf(c)?.n || ''; W.size = c.info.size; W.lin = c.info.lineage || '';
    W.bg = backgroundOf(c)?.n || '';
    if (wizBg()) [W.a1, W.a2] = wizBg().abil;
  }
  Object.assign(gen, { mode: 'standard', std: perAbil(null), pb: perAbil(8), rolls: [], roll: perAbil(null), bonus: perAbil(0) });
  openModal(`<h2>${mode === 'new' ? '✨ Создание персонажа' : '🧬 Раса и предыстория'}</h2><div id="wizSteps" class="seg wiz-steps"></div><div id="wizBody" class="mt"></div><div class="modal-actions" id="wizNav"></div>`);
  modalRefresh = renderWizard;
  const mb = $('#modalBody');
  mb.onchange = (e) => { if (e.target.closest('#genBody')) genChange(e); else wizChange(e); };
  mb.onmouseover = wizSkillHover;
  installGenDrag(mb);
  renderWizard();
}
function wizChange(e) {
  const el = e.target;
  if (el.dataset.w) {
    const f = el.dataset.w;
    W[f] = el.value;
    if (f === 'sp') { W.size = ''; W.lin = ''; W.spSkills = []; }
    if (f === 'bg' && wizBg()) { [W.a1, W.a2] = wizBg().abil; W.clsSkills = W.clsSkills.filter((k) => !wizBg().sk.includes(k)); W.spSkills = W.spSkills.filter((k) => !wizBg().sk.includes(k)); }
    // +2 и +1 — к разным характеристикам: если совпали, +1 переходит на другую
    if (f === 'a1' && W.a2 === W.a1 && wizBg()) W.a2 = wizBg().abil.find((k) => k !== W.a1);
    if (f === 'cls') W.clsSkills = [];
    if (f === 'name') return;
  } else if (el.dataset.wsk) {
    const key = el.dataset.wsk;
    W[key] = el.checked ? [...new Set([...W[key], el.value])] : W[key].filter((k) => k !== el.value);
  } else if (el.name === 'wgold') W.gold = el.value === 'kit' ? 'kit' : el.value === '1';
  else return;
  renderWizard();
}
// Ошибка шага (пустая строка — шаг заполнен)
function wizError(step) {
  const sp = wizSp(), bg = wizBg();
  if (step === 0) {
    if (!sp) return 'Выберите расу';
    if (sp.lin && !W.lin) return 'Выберите происхождение';
    if (sp.skill && W.spSkills.length !== sp.skill[0]) return `Выберите навык расы (${sp.skill[0]})`;
  }
  if (step === 1) {
    if (!bg) return 'Выберите предысторию';
    if (W.bgMode === '21' && (W.a1 === W.a2 || !bg.abil.includes(W.a1) || !bg.abil.includes(W.a2))) return 'Выберите две разные характеристики для +2 и +1';
  }
  if (step === 2) {
    if (!CLASSES[W.cls]) return 'Выберите класс';
    if (W.clsSkills.length !== CLASS_SKILLS[W.cls][0]) return `Выберите навыки класса: ${CLASS_SKILLS[W.cls][0]}`;
  }
  if (step === 3 && !ABILITIES.every((a) => genBase(a.k) != null)) return 'Распределите все шесть значений';
  return '';
}
const wizLast = () => (W.mode === 'origin' ? 1 : WIZ_STEPS.length - 1);
// Чекбоксы выбора навыков: count — сколько выбрать, list — из каких (null — любые)
function skillPickHtml(field, count, list, except) {
  const taken = wizTaken(except), cur = W[field];
  return `<div class="skill-pick" data-field="${field}">${(list || SKILLS.map((s) => s.k)).map((k) => {
    const dis = taken.has(k) || (!cur.includes(k) && cur.length >= count);
    return `<label class="check ${taken.has(k) ? 'muted' : ''}" data-skill="${k}"><input type="checkbox" data-wsk="${field}" value="${k}" ${cur.includes(k) ? 'checked' : ''} ${dis ? 'disabled' : ''}> ${skillName(k)}${taken.has(k) ? ' (уже есть)' : ''}</label>`;
  }).join('')}</div><p class="muted small">Выбрано ${cur.length} из ${count}</p>
  <div class="skill-desc" id="skillDesc-${field}">${skillDescHtml(cur)}</div>`;
}
// Описание навыков: что проверяется и от какой характеристики — подсказка для новичков
function skillDescHtml(keys, hover) {
  if (!keys.length) return '<span class="muted">Наведите на навык или выберите его, чтобы увидеть, для чего он нужен.</span>';
  return keys.map((k) => {
    const s = SKILLS.find((x) => x.k === k), a = ABILITIES.find((x) => x.k === s.a);
    return `<div><b>${s.n}</b> <span class="muted small">(${a.n})${hover ? '' : ' · выбран'}</span><br>${esc(s.d)}</div>`;
  }).join('');
}
// Наведение на навык в мастере — показать его описание; уход с навыка — снова описания выбранных
function wizSkillHover(e) {
  const pick = e.target.closest && e.target.closest('.skill-pick');
  $$('.skill-pick').forEach((p) => {
    const box = $(`#skillDesc-${p.dataset.field}`);
    if (!box) return;
    const lab = p === pick && e.target.closest('[data-skill]');
    const key = lab ? `h:${lab.dataset.skill}` : 'sel';
    if (box.dataset.shown === key) return;
    box.dataset.shown = key;
    box.innerHTML = lab ? skillDescHtml([lab.dataset.skill], true) : skillDescHtml(W[p.dataset.field]);
  });
}
function renderWizard() {
  const box = $('#wizBody');
  if (!box) return;
  const last = wizLast(), sp = wizSp(), bg = wizBg();
  $('#wizSteps').innerHTML = WIZ_STEPS.slice(0, last + 1).map((n, i) => `<button class="${W.step === i ? 'on' : ''}" ${i > W.step ? 'disabled' : ''} data-act="wizGo" data-i="${i}">${i + 1}. ${n}</button>`).join('');
  let h = '';
  if (W.step === 0) {
    h = `<label>Раса<select data-w="sp"><option value="">— выберите —</option>${SPECIES_DATA.map((s) => `<option ${W.sp === s.n ? 'selected' : ''}>${s.n}</option>`).join('')}</select></label>`;
    if (sp) {
      h += `<div class="row gap wrap">${sp.size.length > 1 ? `<label class="inline">Размер <select data-w="size">${sp.size.map((z) => `<option ${(W.size || sp.size[0]) === z ? 'selected' : ''}>${z}</option>`).join('')}</select></label>` : `<span class="badge">Размер: ${sp.size[0]}</span>`}
        <span class="badge">Скорость: ${/Лесной эльф/.test(W.lin) ? 35 : sp.speed} фт</span>${sp.dv ? `<span class="badge">Тёмное зрение: ${/Дроу/.test(W.lin) ? 120 : sp.dv} фт</span>` : ''}</div>`;
      if (sp.lin) h += `<label class="mt">Происхождение<select data-w="lin"><option value="">— выберите —</option>${sp.lin.map((l) => `<option ${W.lin === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
      h += `<ul class="lvl-list">${sp.t.map(([n, x]) => `<li><b>${n}.</b> ${esc(x)}</li>`).join('')}</ul>`;
      if (sp.skill) h += `<h3>Навык расы</h3>${skillPickHtml('spSkills', sp.skill[0], sp.skill[1], 'sp')}`;
    }
  } else if (W.step === 1) {
    if (bg && W.a1 === W.a2) W.a2 = bg.abil.find((k) => k !== W.a1);
    h = `<label>Предыстория<select data-w="bg"><option value="">— выберите —</option>${BACKGROUND_DATA.map((b) => `<option ${W.bg === b.n ? 'selected' : ''}>${b.n}</option>`).join('')}</select></label>`;
    if (bg) {
      const f = FEATS_BY[bg.feat];
      h += `<ul class="lvl-list"><li><b>Навыки:</b> ${bg.sk.map(skillName).join(', ')}</li><li><b>Инструмент:</b> ${bg.tool}</li>
        <li><b>Черта происхождения:</b> ${f.n}${bg.featNote ? ` (${bg.featNote})` : ''} — ${esc(bg.feat === 'magicInitiate' && bg.featNote ? `Два заговора и одно заклинание 1 уровня из списка ${{ жрец: 'жреца', друид: 'друида', волшебник: 'волшебника' }[bg.featNote] || bg.featNote}; заклинание 1 ур. раз в долгий отдых без ячейки.` : f.x)}</li></ul>
        <h3>Увеличение характеристик (${bg.abil.map(abilS).join(', ')})</h3>
        <div class="row gap wrap"><select data-w="bgMode"><option value="21" ${W.bgMode === '21' ? 'selected' : ''}>+2 и +1</option><option value="111" ${W.bgMode === '111' ? 'selected' : ''}>+1 к каждой из трёх</option></select>
        ${W.bgMode === '21' ? `<label class="inline">+2 <select data-w="a1">${bg.abil.map((k) => `<option value="${k}" ${W.a1 === k ? 'selected' : ''}>${abilS(k)}</option>`).join('')}</select></label>
        <label class="inline">+1 <select data-w="a2">${bg.abil.filter((k) => k !== W.a1).map((k) => `<option value="${k}" ${W.a2 === k ? 'selected' : ''}>${abilS(k)}</option>`).join('')}</select></label>` : ''}</div>
        ${W.mode === 'origin' ? '<p class="muted small">Прежние навыки останутся; черта прежней предыстории будет заменена.</p>' : ''}`;
    }
  } else if (W.step === 2) {
    h = `<label>Класс<select data-w="cls"><option value="">— выберите —</option>${Object.keys(CLASSES).map((n) => `<option ${W.cls === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
    const d = CLASSES[W.cls], P = CLASS_PROF[W.cls];
    if (d) {
      h += `<ul class="lvl-list"><li><b>Кость хитов:</b> к${d.hd}</li><li><b>Спасброски:</b> ${d.saves.map(abilS).join(', ')}</li>
        <li><b>Доспехи:</b> ${P.armor || 'нет'}</li><li><b>Оружие:</b> ${P.weapons}</li>${P.tools ? `<li><b>Инструменты:</b> ${P.tools}</li>` : ''}
        <li><b>Умения 1 уровня:</b> ${featuresAt(W.cls, '', 1).join(', ')}${featSlotsAt(W.cls, 1).includes('style') ? ', Боевой стиль' : ''}</li></ul>
        <h3>Навыки класса</h3>${skillPickHtml('clsSkills', CLASS_SKILLS[W.cls][0], CLASS_SKILLS[W.cls][1], 'cls')}`;
    }
  } else if (W.step === 3) {
    h = '<p class="muted small">Базовые значения характеристик. Прибавки предыстории показаны отдельно и добавятся автоматически.</p><div id="genBody" data-embed="1"></div>';
  } else {
    const P = CLASS_PROF[W.cls], bonus = wizBgAbil(), d = CLASSES[W.cls];
    const fin = (k) => Math.min(20, (genBase(k) || 10) + (bonus[k] || 0));
    const con = mod(fin('con')), hp = Math.max(1, d.hd + con + (/Дварф/.test(W.sp) ? 1 : 0) + (wizBg()?.feat === 'tough' ? 2 : 0));
    h = `<label>Имя персонажа<input data-w="name" value="${esc(W.name)}" placeholder="Новый персонаж"></label>
      <ul class="lvl-list"><li><b>${esc(W.sp)}${W.lin ? ` (${esc(W.lin)})` : ''}</b>, ${esc(W.bg)}, <b>${esc(W.cls)} 1</b></li>
      <li>${ABILITIES.map((a) => `${a.s} ${fin(a.k)} (${fmt(mod(fin(a.k)))})`).join(' · ')}</li>
      <li>Хиты: <b>${hp}</b> (к${d.hd} + Тел ${fmt(con)})</li>
      <li>Навыки: ${[...new Set([...W.spSkills, ...(wizBg()?.sk || []), ...W.clsSkills])].map(skillName).join(', ')}</li>
      <li>Черта происхождения: ${FEATS_BY[wizBg().feat].n}</li></ul>
      <h3>Снаряжение</h3>
      <label class="check"><input type="radio" name="wgold" value="kit" ${W.gold === 'kit' ? 'checked' : ''}> Комплект снаряжения (вариант A): класса и предыстории — оружие, доспех и золото сразу в листе</label>
      <label class="check"><input type="radio" name="wgold" value="1" ${W.gold === true ? 'checked' : ''}> Стартовые деньги: ${P.gold} зм (класс) + 50 зм (предыстория) — купить в каталоге</label>
      <label class="check"><input type="radio" name="wgold" value="0" ${!W.gold ? 'checked' : ''}> Добавлю снаряжение сам</label>`;
  }
  box.innerHTML = h;
  if (W.step === 3) renderGen(); // сам обновит кнопки мастера
  else renderWizNav();
}
// Кнопки мастера (обновляются и при изменениях во встроенном генераторе)
function renderWizNav() {
  if (!$('#wizNav')) return;
  const last = wizLast(), err = wizError(W.step);
  $('#wizNav').innerHTML = `${W.mode === 'new' && W.step === 0 ? '<button class="ghost" data-act="newBlank" style="margin-right:auto">Пустой лист без мастера</button>' : ''}
    ${err ? `<span class="muted small">${esc(err)}</span>` : ''}
    ${W.step > 0 ? '<button data-act="wizPrev">← Назад</button>' : '<button data-act="closeModal">Отмена</button>'}
    ${W.step < last ? `<button class="primary" data-act="wizNext" ${err ? 'disabled' : ''}>Далее →</button>`
      : `<button class="primary" data-act="wizFinish" ${err ? 'disabled' : ''}>${W.mode === 'new' ? 'Создать персонажа' : 'Применить'}</button>`}`;
}
// Стартовое снаряжение, вариант A (PHB 2024). w — оружие [название, кол-во] (в атаки и инвентарь), armor/shield — надеть,
// i — предметы [название, кол-во], gp — золото. Инструменты, которые выдаёт владение (выбор в «Владениях»), не дублируются
const KIT_CLASS = {
  'Варвар': { w: [['Секира', 1], ['Ручной топор', 4]], i: [['Набор путешественника', 1]], gp: 15 },
  'Бард': { armor: 'leather', w: [['Кинжал', 2]], i: [['Набор артиста', 1]], gp: 19 },
  'Жрец': { armor: 'chainshirt', shield: 1, w: [['Булава', 1]], i: [['Священный символ', 1], ['Набор священника', 1]], gp: 7 },
  'Друид': { armor: 'leather', shield: 1, w: [['Серп', 1], ['Боевой посох', 1]], i: [['Набор путешественника', 1], ['Набор травника', 1]], gp: 9 },
  'Воин': { armor: 'chain', w: [['Двуручный меч', 1], ['Цеп', 1], ['Метательное копьё', 8]], i: [['Набор исследователя подземелий', 1]], gp: 4 },
  'Монах': { w: [['Копьё', 1], ['Кинжал', 5]], i: [['Набор путешественника', 1]], gp: 11 },
  'Паладин': { armor: 'chain', shield: 1, w: [['Длинный меч', 1], ['Метательное копьё', 6]], i: [['Священный символ', 1], ['Набор священника', 1]], gp: 9 },
  'Следопыт': { armor: 'studded', w: [['Скимитар', 1], ['Короткий меч', 1], ['Длинный лук', 1]], i: [['Стрелы (20)', 1], ['Колчан', 1], ['Друидическая фокусировка', 1], ['Набор путешественника', 1]], gp: 7 },
  'Плут': { armor: 'leather', w: [['Кинжал', 2], ['Короткий меч', 1], ['Короткий лук', 1]], i: [['Стрелы (20)', 1], ['Колчан', 1], ['Воровские инструменты', 1], ['Набор взломщика', 1]], gp: 8 },
  'Чародей': { w: [['Копьё', 1], ['Кинжал', 2]], i: [['Магическая фокусировка (кристалл)', 1], ['Набор исследователя подземелий', 1]], gp: 28 },
  'Колдун': { armor: 'leather', w: [['Серп', 1], ['Кинжал', 2]], i: [['Магическая фокусировка (сфера)', 1], ['Книга (тайное знание)', 1], ['Набор учёного', 1]], gp: 15 },
  'Волшебник': { w: [['Кинжал', 2], ['Боевой посох', 1]], i: [['Мантия', 1], ['Книга заклинаний', 1], ['Набор учёного', 1]], gp: 5 },
};
const KIT_BG = {
  'Аколит': { i: [['Книга (молитвы)', 1], ['Священный символ', 1], ['Пергамент (лист)', 10], ['Мантия', 1]], gp: 8 },
  'Артист': { i: [['Костюм', 2], ['Зеркало', 1], ['Духи', 1], ['Дорожная одежда', 1]], gp: 11 },
  'Благородный': { i: [['Изысканная одежда', 1], ['Духи', 1]], gp: 29 },
  'Мудрец': { w: [['Боевой посох', 1]], i: [['Книга (история)', 1], ['Пергамент (лист)', 8], ['Мантия', 1]], gp: 8 },
  'Моряк': { w: [['Кинжал', 1]], i: [['Верёвка (50 фт)', 1], ['Дорожная одежда', 1]], gp: 20 },
  'Отшельник': { w: [['Боевой посох', 1]], i: [['Спальный мешок', 1], ['Книга (философия)', 1], ['Лампа', 1], ['Масло (фляга)', 3], ['Дорожная одежда', 1]], gp: 16 },
  'Писарь': { i: [['Изысканная одежда', 1], ['Лампа', 1], ['Масло (фляга)', 3], ['Пергамент (лист)', 12]], gp: 23 },
  'Преступник': { w: [['Кинжал', 2]], i: [['Ломик', 1], ['Мешочек', 2], ['Дорожная одежда', 1]], gp: 16 },
  'Проводник': { w: [['Короткий лук', 1]], i: [['Стрелы (20)', 1], ['Спальный мешок', 1], ['Колчан', 1], ['Палатка (на двоих)', 1], ['Дорожная одежда', 1]], gp: 3 },
  'Путешественник': { w: [['Кинжал', 2]], i: [['Спальный мешок', 1], ['Мешочек', 2], ['Дорожная одежда', 1]], gp: 16 },
  'Ремесленник': { i: [['Мешочек', 2], ['Дорожная одежда', 1]], gp: 32 },
  'Солдат': { w: [['Копьё', 1], ['Короткий лук', 1]], i: [['Стрелы (20)', 1], ['Набор целителя', 1], ['Колчан', 1], ['Дорожная одежда', 1]], gp: 14 },
  'Стражник': { w: [['Копьё', 1], ['Лёгкий арбалет', 1]], i: [['Болты (20)', 1], ['Фонарь закрытый', 1], ['Кандалы', 1], ['Колчан', 1], ['Дорожная одежда', 1]], gp: 12 },
  'Торговец': { i: [['Мешочек', 2], ['Дорожная одежда', 1]], gp: 22 },
  'Фермер': { w: [['Серп', 1]], i: [['Набор целителя', 1], ['Железный котелок', 1], ['Лопата', 1], ['Дорожная одежда', 1]], gp: 30 },
  'Шарлатан': { i: [['Костюм', 1], ['Изысканная одежда', 1]], gp: 15 },
};
function applyKit(c, K) {
  if (!K) return;
  (K.w || []).forEach(([n, q]) => {
    const w = WEAPONS.find((x) => x.n === n);
    if (!w) return;
    addInvItem(c, { n: w.n, cat: 'Оружие', w: w.w, cost: w.cost, qty: q, eq: true, x: `${w.dmg} ${w.type}. ${w.props}. Приём: ${MASTERY[w.m].n}.` });
    if (!c.attacks.some((a) => a.n === w.n)) c.attacks.push(weaponAttack(w));
  });
  if (K.armor) {
    const a = ARMOR.find((x) => x.id === K.armor);
    addInvItem(c, { n: a.n, cat: 'Доспех', w: a.w, cost: a.cost, eq: true });
    Object.assign(c.armor, { mode: 'auto', id: a.id, unarmored: '' });
  }
  if (K.shield) { addInvItem(c, { n: SHIELD.n, cat: 'Доспех', w: SHIELD.w, cost: SHIELD.cost, eq: true }); c.armor.shield = true; }
  (K.i || []).forEach(([n, q]) => {
    const g = GEAR.find((x) => x.n === n);
    if (!g && c.items.some((x) => x.n === n)) return; // инструмент уже выдан владением
    addInvItem(c, g ? { n: g.n, cat: g.cat, w: g.w, cost: g.cost, x: g.x, qty: q * (g.qty || 1), chMax: g.ch || 0, ch: g.ch || 0 } : { n, cat: 'Снаряжение', qty: q });
  });
  c.coins.gp = (+c.coins.gp || 0) + (K.gp || 0);
}
function wizFinish() {
  const sp = wizSp(), bg = wizBg();
  for (let i = 0; i <= wizLast(); i++) if (wizError(i)) { W.step = i; renderWizard(); return; }
  if (W.mode === 'origin') {
    const c = ch();
    applySpecies(c, sp, { size: W.size, lin: W.lin, skills: W.spSkills });
    applyBackground(c, bg, { mode: W.bgMode, a1: W.a1, a2: W.a2 });
    closeModal();
    toast(`Применены раса «${esc(sp.n)}» и предыстория «${esc(bg.n)}»`);
    return;
  }
  const c = blankChar(), P = CLASS_PROF[W.cls];
  c.info.name = W.name.trim() || 'Новый персонаж';
  c.info.cls = W.cls;
  applyClassTemplate(c);
  applySpecies(c, sp, { size: W.size, lin: W.lin, skills: W.spSkills });
  ABILITIES.forEach((a) => { c.abil[a.k] = genBase(a.k) ?? 10; });
  c.abilSet = true;
  applyBackground(c, bg, { mode: W.bgMode, a1: W.a1, a2: W.a2 });
  W.clsSkills.forEach((k) => { c.skills[k] = Math.max(1, c.skills[k] || 0); });
  applyClassProfs(c, W.cls);
  addPick(c, 'lang', ['standard'], 2, 'создание персонажа');
  featuresAt(W.cls, '', 1).forEach((n) => c.features.push({ id: uid(), n, src: `${W.cls} 1`, x: featureDesc(W.cls, n) }));
  const hp = Math.max(1, +c.combat.hdDie + am(c, 'con') + hpPerLevelBonus(c));
  c.combat.hpMax = hp; c.combat.hp = hp; c.combat.hpRolled = +c.combat.hdDie;
  if (W.gold === 'kit') { applyKit(c, KIT_CLASS[W.cls]); applyKit(c, KIT_BG[bg.n]); }
  else if (W.gold) c.coins.gp = P.gold + 50;
  state.chars[c.id] = c; state.current = c.id;
  openSet.clear(); multiSig = null;
  closeModal();
  switchTab('main');
  const todo = [];
  if (featFree(c, 'origin') > 0) todo.push('вторая черта происхождения (человек)');
  if (featFree(c, 'style') > 0) todo.push('черта боевого стиля');
  if (c.feats.some((f) => f.key === 'magicInitiate')) todo.push('заклинания «Посвящённого в магию»');
  if (!W.gold) todo.push('снаряжение');
  if (c.profPicks.length) todo.push('языки и инструменты (вкладка «Персонаж» → «Владения и языки»)');
  if (PREP_TABLE[W.cls]) todo.push('заклинания класса');
  toast(`✨ ${esc(c.info.name)} создан!${todo.length ? `<div class="rd">Осталось выбрать: ${esc(todo.join(', '))}</div>` : ''}`, 'crit');
}

/* ---------- Отмена действий ---------- */
// История по каждому персонажу: снимки до изменения (без updatedAt, чтобы сравнение было честным)
const undoStacks = {};
let bindUndo = null; // последнее редактируемое поле — ввод в одно поле подряд отменяется целиком
const snap = (c) => JSON.stringify(c, (k, v) => (k === 'updatedAt' ? undefined : v));
const ACT_LABELS = {
  damage: 'урон', heal: 'лечение', tempHp: 'временные хиты', toggleInsp: 'вдохновение', finishShortRest: 'короткий отдых', longRest: 'долгий отдых',
  spendHd: 'кость хитов', deathSave: 'спасбросок от смерти', deathPip: 'спасброски от смерти', deathReset: 'спасброски от смерти', exh: 'истощение',
  cond: 'состояние', dropConc: 'концентрация', concSave: 'спасбросок концентрации', slotPip: 'ячейка заклинания', pactPip: 'ячейка договора',
  castSpell: 'сотворение заклинания', castWith: 'сотворение заклинания', resPip: 'ресурс', resUse: 'ресурс', resReset: 'восстановление ресурса',
  qty: 'количество предмета', charge: 'заряды предмета', toggleEquip: 'экипировка', toggleAttune: 'настройка', lvlApply: 'повышение уровня',
  genApply: 'генерация характеристик', featAddApply: 'черта', delFeat: 'удаление черты', rageToggle: 'ярость', secondWind: 'второе дыхание',
  nextRound: 'следующий раунд', passMinute: '+1 минута', roundReset: 'новый бой', effAdj: 'длительность эффекта', delEffect: 'удаление эффекта',
  skillProf: 'владение навыком', togglePrep: 'подготовка заклинания', addSpellFromDb: 'добавление заклинания', catWeapon: 'снаряжение из каталога',
  catArmor: 'доспех из каталога', catShield: 'щит', catGear: 'снаряжение из каталога', addMulti: 'мультикласс', delMulti: 'удаление класса',
  delAttack: 'удаление атаки', atkRoll: 'боеприпас', recoverAmmo: 'сбор боеприпасов', delSpell: 'удаление заклинания', delItem: 'удаление предмета', delRes: 'удаление ресурса', delFeature: 'удаление умения',
  calcHp: 'расчёт хитов', applyClass: 'шаблон класса', abilEdit: 'характеристики', profDel: 'владение', profInv: 'инструмент в инвентарь', pickDrop: 'выбор владения', featSpellsSave: 'заклинания черты', masteryAdd: 'приём оружия', masteryDel: 'приём оружия',
  bardicGet: 'вдохновение барда', bardicUse: 'вдохновение барда', bardicDrop: 'вдохновение барда',
};
function pushUndo(id, before, label) {
  const st = undoStacks[id] || (undoStacks[id] = []);
  st.push({ s: before, label });
  if (st.length > 50) st.shift();
  renderUndo();
}
// Выполнить изменение и записать его в историю, если персонаж действительно изменился
function tracked(label, fn) {
  const id = ch().id, before = snap(ch());
  fn();
  if (state.chars[id] && snap(state.chars[id]) !== before) pushUndo(id, before, label);
}
function undo() {
  const c = ch(), st = undoStacks[c.id];
  if (!st || !st.length) { toast('Нечего отменять'); return; }
  const { s, label } = st.pop();
  state.chars[c.id] = JSON.parse(s);
  pendingConc = 0; bindUndo = null; multiSig = null;
  save(); render();
  if (curTab === 'ref') renderRef();
  toast(`↶ Отменено: ${esc(label)}`);
}
function renderUndo() {
  const st = undoStacks[state.current] || [], b = $('#undoBtn');
  b.disabled = !st.length;
  b.title = st.length ? `Отменить: ${st[st.length - 1].label} (Ctrl+Z)` : 'Нечего отменять';
}

/* ---------- Эффекты и длительности (в раундах: 1 минута = 10 раундов) ---------- */
function parseDuration(d) {
  const m = String(d || '').toLowerCase().match(/(\d+)\s*(раунд|минут|час|д[не])/);
  if (!m) return 0;
  const n = +m[1], u = m[2];
  return u.startsWith('раунд') ? n : u.startsWith('минут') ? n * 10 : u.startsWith('час') ? n * 600 : n * 14400;
}
function fmtRounds(r) {
  if (r < 10) return `${r} р.`;
  if (r < 600) return `${Math.floor(r / 10)} мин${r % 10 ? ` ${r % 10} р.` : ''}`;
  const m = Math.floor((r % 600) / 10);
  return `${Math.floor(r / 600)} ч${m ? ` ${m} мин` : ''}`;
}
// Новый эффект заменяет одноимённый; новый эффект с концентрацией заменяет прежний
function addEffect(c, e) {
  c.effects = c.effects.filter((x) => x.n !== e.n && !(e.conc && x.conc));
  c.effects.push({ id: uid(), x: '', ...e, total: e.left });
}
function advanceEffects(c, rounds) {
  const ended = [];
  c.effects.forEach((e) => { e.left -= rounds; if (e.left <= 0) ended.push(e); });
  if (!ended.length) return;
  c.effects = c.effects.filter((e) => e.left > 0);
  ended.forEach((e) => { if (e.conc && c.combat.conc === e.n) c.combat.conc = ''; });
  toast(`⌛ Закончилось: ${ended.map((e) => esc(e.n)).join(', ')}`);
}
function endConc(c) { c.combat.conc = ''; c.effects = c.effects.filter((e) => !e.conc); }

/* ---------- Черты ---------- */
// Какие ячейки черт даёт уровень L класса cls (по таблице класса; для класса не из списка — стандартные 4/8/12/16 и 19)
function featSlotsAt(cls, L) {
  const row = CLASS_FEATURES[cls];
  if (!row) return [4, 8, 12, 16].includes(L) ? ['general'] : L === 19 ? ['epic'] : [];
  return (row[L - 1] || '').split(';').map((s) => s.trim())
    .flatMap((s) => (s === 'ASI' ? ['general'] : s === 'EPIC' ? ['epic'] : s.startsWith('Боевой стиль') ? ['style'] : []));
}
// Всего ячеек черт: происхождение (+1 человеку) и выданные каждым классом по его уровню
function featSlots(c) {
  const s = { origin: 1 + (/человек|human/i.test(c.info.species) ? 1 : 0), general: 0, style: 0, epic: 0 };
  classList(c).forEach((e) => { for (let L = 1; L <= e.lvl; L++) featSlotsAt(e.cls, L).forEach((k) => { s[k]++; }); });
  return s;
}
const featFree = (c, slot) => featSlots(c)[slot] - c.feats.filter((f) => f.slot === slot).length;
const featChoices = (c, slot) => FEATS.filter((f) => FEAT_SLOTS[slot].allows.includes(f.cat) && (f.rep || !hasFeat(c, f.key)));
function normPick(p) {
  const d = FEATS_BY[p.key];
  if (d && Array.isArray(d.abil) && !d.abil.includes(p.a)) p.a = d.abil[0];
  return p;
}
function defaultPick(c, slot) {
  const opts = featChoices(c, slot);
  const f = slot === 'general' && opts.includes(FEATS_BY.asi) ? FEATS_BY.asi : opts[0];
  return normPick({ key: f ? f.key : '', mode: 'plus2', a1: 'str', a2: 'dex', a: '' });
}
const pickValid = (p) => { const d = FEATS_BY[p.key]; return !!d && !(d.abil === 'asi' && p.mode === 'plus11' && p.a1 === p.a2); };
// Выбор черты для ячейки slot: список черт + выбор характеристик, которые она повышает
function featPickerHtml(c, slot, p) {
  const opts = featChoices(c, slot);
  const groups = FEAT_SLOTS[slot].allows.map((cat) => {
    const list = opts.filter((f) => f.cat === cat);
    return list.length ? `<optgroup label="${FEAT_CATS[cat]}">${list.map((f) => `<option value="${f.key}" ${p.key === f.key ? 'selected' : ''}>${esc(f.n)}</option>`).join('')}</optgroup>` : '';
  }).join('');
  const d = FEATS_BY[p.key];
  const sel = (list, v, field) => `<select data-fp="${field}">${list.map((k) => `<option value="${k}" ${v === k ? 'selected' : ''}>${ABILITIES.find((a) => a.k === k).n} (${score(c, k)})</option>`).join('')}</select>`;
  let abil = '';
  if (d && d.abil === 'asi') {
    abil = `<select data-fp="mode"><option value="plus2" ${p.mode === 'plus2' ? 'selected' : ''}>+2 к одной</option><option value="plus11" ${p.mode === 'plus11' ? 'selected' : ''}>+1 к двум</option></select>`
      + sel(ALL6, p.a1, 'a1') + (p.mode === 'plus11' ? sel(ALL6, p.a2, 'a2') : '');
  } else if (d && d.abil) abil = `<span class="muted small">+1 к</span>${sel(d.abil, p.a, 'a')}`;
  return `<div class="feat-pick" data-pslot="${slot}"><div class="row gap wrap"><select data-fp="key">${groups}</select>${abil}</div>
    ${d ? `<p class="muted small">${esc(d.x)}${d.cat === 'epic' ? ' Характеристика до 30.' : d.abil ? ' Характеристика до 20.' : ''}</p>` : ''}
    ${d && d.abil === 'asi' && p.mode === 'plus11' && p.a1 === p.a2 ? '<p class="small gen-warn">Выберите две разные характеристики</p>' : ''}</div>`;
}
// Изменение в выборе черты: picks — объект { slot: pick }
function pickChange(picks, el) {
  const box = el.closest('[data-pslot]');
  if (!box || !el.dataset.fp) return false;
  const p = picks[box.dataset.pslot];
  p[el.dataset.fp] = el.value;
  normPick(p);
  return true;
}
// Черты, меняющие максимум хитов («Крепкий», «Дар стойкости»), учитывает syncHpMax при отрисовке
function featHp() {}
function addFeat(c, slot, p, L) {
  c.feats.push({ id: uid(), key: p.key, slot, a: p.a, a1: p.a1, a2: p.a2, mode: p.mode, lvl: L });
  featHp(c, p.key, 1);
}
function featEffectText(f) {
  const d = FEATS_BY[f.key], s = (k) => ABILITIES.find((a) => a.k === k).s;
  if (!d || !d.abil) return '';
  if (d.abil === 'asi') return f.mode === 'plus11' ? `${s(f.a1)} +1, ${s(f.a2)} +1` : `${s(f.a1)} +2`;
  return `${s(f.a)} +1`;
}
let featAdd = null; // состояние окна «Добавить черту»: { slot, picks }
function openFeatAdd() {
  const c = ch();
  const free = Object.keys(FEAT_SLOTS).filter((k) => featFree(c, k) > 0);
  if (!free.length) {
    openModal(`<h2>Черты</h2><p>Все доступные ячейки черт заняты.</p><p class="muted small">Новые черты дают уровни с «Увеличением характеристик» (обычно 4, 8, 12, 16), эпический дар на 19 уровне и «Боевой стиль» у воина, паладина и следопыта. Человек получает дополнительную черту происхождения.</p>
      <div class="modal-actions"><button data-act="closeModal">Закрыть</button></div>`);
    return;
  }
  featAdd = { slot: free[0], picks: Object.fromEntries(free.map((k) => [k, defaultPick(c, k)])) };
  openModal('<h2>＋ Черта</h2><div id="featAddBody"></div>');
  modalRefresh = renderFeatAdd;
  $('#modalBody').onchange = (e) => {
    if (e.target.name === 'featSlot') featAdd.slot = e.target.value;
    else if (!pickChange(featAdd.picks, e.target)) return;
    renderFeatAdd();
  };
  renderFeatAdd();
}
function renderFeatAdd() {
  const box = $('#featAddBody');
  if (!box) return;
  const c = ch(), slots = featSlots(c), S = featAdd, p = S.picks[S.slot];
  box.innerHTML = `<p class="muted small">Выберите ячейку, в которую берёте черту:</p>
    <div class="row gap wrap">${Object.entries(FEAT_SLOTS).filter(([k]) => slots[k]).map(([k, s]) => {
      const free = featFree(c, k);
      return `<label class="check"><input type="radio" name="featSlot" value="${k}" ${S.slot === k ? 'checked' : ''} ${free > 0 ? '' : 'disabled'}> ${s.n} (${slots[k] - free}/${slots[k]})</label>`;
    }).join('')}</div>
    <h3>${FEAT_SLOTS[S.slot].n}</h3>${featPickerHtml(c, S.slot, p)}
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" data-act="featAddApply" ${pickValid(p) ? '' : 'disabled'}>Добавить</button></div>`;
}

/* ---------- Повышение уровня ---------- */
let lvlState = null;
// Названия умений класса cls на его уровне L; токены ячеек черт (ASI, EPIC, Боевой стиль) выбираются отдельно
// Если подкласс известен, токены «Подкласс»/«SUB» заменяются его умениями этого уровня
function featuresAt(cls, subclass, L) {
  const row = (CLASS_FEATURES[cls] || [])[L - 1] || '';
  const sc = subclassOf(cls, subclass);
  const sub = 'Умение подкласса' + (subclass ? `: ${subclass}` : '');
  return row.split(';').map((s) => s.trim()).filter((s) => s && s !== 'ASI' && s !== 'EPIC' && !s.startsWith('Боевой стиль'))
    .flatMap((s) => {
      if (s !== 'SUB' && s !== 'Подкласс') return [s];
      if (sc) return (sc.f[L] || []).map(([n]) => n);
      return [s === 'SUB' ? sub : s];
    });
}
// Заклинания «всегда подготовлено» от подкласса, расы (и её происхождения) и черт
function wantedSpells(c) {
  const out = [];
  classList(c).forEach((e) => {
    const sc = subclassOf(e.cls, e.sub);
    if (sc) Object.entries(sc.sp).forEach(([L, list]) => { if (e.lvl >= +L) list.forEach((n) => out.push({ e: n, src: sc.n })); });
    // Круг земли: заклинания выбранной местности
    if (e.cls === 'Друид' && e.sub === 'Круг земли' && LAND_SPELLS[c.info.land])
      Object.entries(LAND_SPELLS[c.info.land]).forEach(([L, list]) => { if (e.lvl >= +L) list.forEach((n) => out.push({ e: n, src: `Круг земли: ${c.info.land}` })); });
  });
  const sp = speciesOf(c), lin = c.info.lineage || '';
  if (sp) {
    Object.entries(RACE_SPELLS).forEach(([k, list]) => {
      if (k === sp.n || (lin && lin.startsWith(k))) list.forEach(([L, n]) => { if (lvl(c) >= L) out.push({ e: n, src: k === sp.n ? sp.n : k }); });
    });
  }
  c.feats.forEach((f) => {
    const d = FEAT_SPELLS[f.key];
    if (!d) return;
    [...(d.fixed || []), ...(f.spells || [])].forEach((n) => out.push({ e: n, src: `черта «${FEATS_BY[f.key].n}»` }));
  });
  return out;
}
function autoSpells(c) {
  const want = wantedSpells(c), keep = new Set();
  want.forEach((w) => {
    const d = spellByE(w.e), name = d ? d.n : w.e;
    keep.add(name);
    let s = c.spells.find((x) => x.n === name || (d && x.e === d.e));
    if (!s) {
      s = d ? { ...d, id: uid() } : { id: uid(), n: w.e, e: w.e, l: 1, x: 'Описание — в Книге игрока.' };
      Object.assign(s, { always: true, prep: false, auto: w.src });
      c.spells.push(s);
    } else if (s.auto) s.auto = w.src;
    else if (!s.always || s.autoAlways) { s.always = true; s.autoAlways = w.src; }
  });
  // Источник пропал (сменили подкласс, расу, убрали черту) — авто-заклинания убираются, свои остаются, но без «всегда»
  c.spells = c.spells.filter((s) => !s.auto || keep.has(s.n));
  c.spells.forEach((s) => { if (s.autoAlways && !keep.has(s.n)) { s.always = false; delete s.autoAlways; } });
}
// Сколько заклинаний черта даёт на выбор (0 — выбирать нечего)
const featPickNeed = (f) => ((FEAT_SPELLS[f.key] || {}).pick || []).reduce((s, g) => s + g.n, 0);
const isAttackCantrip = (s) => s.l === 0 && /атака заклинанием|атака оружием/i.test(s.x);
let featSp = null; // окно выбора заклинаний черты: { featId, fixed, list, chosen: Set }
const noteList = (note) => ({ жрец: 'Жрец', друид: 'Друид', волшебник: 'Волшебник' }[note] || '');
function openFeatSpells(f) {
  const d = FEAT_SPELLS[f.key];
  // У черты от предыстории список заклинаний задан (Аколит — жрец, Проводник — друид, Мудрец — волшебник)
  featSp = { featId: f.id, fixed: noteList(f.note), list: noteList(f.note) || f.list || (d.lists ? d.lists[0] : ''), chosen: new Set(f.spells || []) };
  openModal(`<h2>✨ Заклинания: ${esc(FEATS_BY[f.key].n)}</h2><div id="featSpBody"></div>`);
  modalRefresh = renderFeatSpells;
  $('#modalBody').onchange = (e) => {
    const el = e.target;
    if (el.id === 'fspList') { featSp.list = el.value; featSp.chosen = new Set(); }
    else if (el.dataset.fsp) { el.checked ? featSp.chosen.add(el.value) : featSp.chosen.delete(el.value); }
    else return;
    renderFeatSpells();
  };
  renderFeatSpells();
}
// Варианты для группы выбора: уровень, школы, список класса, только заговоры с атакой
function featSpellOptions(g) {
  const SNIPER = ['Жрец', 'Друид', 'Чародей', 'Колдун', 'Волшебник'];
  return SPELLS.filter((s) => s.l === g.l
    && (!g.schools || g.schools.includes(s.s))
    && (!g.attack || (isAttackCantrip(s) && SNIPER.some((k) => s.k.includes(k))))
    && (!featSp.list || g.schools || g.attack || s.k.includes(featSp.list)));
}
function renderFeatSpells() {
  const box = $('#featSpBody');
  if (!box) return;
  const c = ch(), f = findById(c.feats, featSp.featId), d = FEAT_SPELLS[f.key];
  let ok = true;
  const groups = d.pick.map((g) => {
    const opts = featSpellOptions(g), got = opts.filter((s) => featSp.chosen.has(s.e)).length;
    if (got !== g.n) ok = false;
    return `<h3>${g.l ? `Заклинание ${g.l} уровня` : 'Заговоры'}${g.schools ? ` (${g.schools.join(' / ')})` : ''}${g.attack ? ' с броском атаки' : ''} — ${got}/${g.n}</h3>
      <div class="skill-pick">${opts.map((s) => {
        const on = featSp.chosen.has(s.e);
        return `<label class="check" title="${esc(s.x)}"><input type="checkbox" data-fsp="1" value="${esc(s.e)}" ${on ? 'checked' : ''} ${!on && got >= g.n ? 'disabled' : ''}> ${esc(s.n)}</label>`;
      }).join('')}</div>`;
  }).join('');
  box.innerHTML = `${d.lists ? (featSp.fixed ? `<p>Список заклинаний: <b>${featSp.fixed}</b> <span class="muted small">(задан предысторией)</span></p>`
    : `<label class="inline">Список заклинаний <select id="fspList">${d.lists.map((k) => `<option ${featSp.list === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>`) : ''}
    ${d.fixed ? `<p class="muted small">Всегда даёт: ${d.fixed.map((e) => spellByE(e)?.n || e).join(', ')}.</p>` : ''}
    ${groups}<p class="muted small">Выбранные заклинания всегда подготовлены и не входят в лимит. Наведите на название, чтобы увидеть описание.</p>
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" data-act="featSpellsSave" ${ok ? '' : 'disabled'}>Сохранить</button></div>`;
}
// Уровень класса, на котором выбирается подкласс (по таблице — токен «Подкласс»)
const subclassLevel = (cls) => (CLASS_FEATURES[cls] || []).findIndex((r) => r.split(';').map((s) => s.trim()).includes('Подкласс')) + 1;
// Умения подклассов добавляются сами по уровню класса; заглушки «Подкласс»/«Умение подкласса» убираются
function autoSubclassFeatures(c) {
  classList(c).forEach((e) => {
    const sc = subclassOf(e.cls, e.sub);
    const mine = (f) => String(f.src || '').startsWith(e.cls + ' ');
    // Сменили подкласс — убрать умения прежнего
    c.features = c.features.filter((f) => !(f.subOf === e.cls && (!sc || f.sub !== sc.n)));
    if (!sc) return;
    c.features = c.features.filter((f) => !(mine(f) && (f.n === 'Подкласс' || f.n.startsWith('Умение подкласса'))));
    Object.entries(sc.f).forEach(([L, list]) => {
      if (e.lvl < +L) return;
      list.forEach(([n, x]) => {
        const src = `${e.cls} ${L}`;
        if (!c.features.some((f) => f.n === n && f.src === src)) c.features.push({ id: uid(), n, src, x, sub: sc.n, subOf: e.cls });
      });
    });
  });
}
// Требования мультикласса (PHB 2024): 13+ в основной характеристике; группа — «любая из»
const MC_REQ = {
  'Бард': [['cha']], 'Варвар': [['str']], 'Воин': [['str', 'dex']], 'Волшебник': [['int']], 'Друид': [['wis']], 'Жрец': [['wis']],
  'Колдун': [['cha']], 'Монах': [['dex'], ['wis']], 'Паладин': [['str'], ['cha']], 'Плут': [['dex']], 'Следопыт': [['dex'], ['wis']], 'Чародей': [['cha']],
};
const mcOk = (c, cls) => !MC_REQ[cls] || MC_REQ[cls].every((g) => g.some((k) => score(c, k) >= 13));
const mcReqText = (cls) => (MC_REQ[cls] || []).map((g) => g.map((k) => ABILITIES.find((a) => a.k === k).s).join(' или ') + ' 13').join(' и ');
// Класс, который повышается: target — 'p' (основной), id доп. класса или 'new'
function lvlTarget(c, S) {
  if (S.target === 'new') return { cls: S.newCls, sub: '', lvl: 0, hd: (CLASSES[S.newCls] || {}).hd || 8, isNew: true };
  const e = S.target === 'p' ? classList(c)[0] : classList(c).find((x) => x.id === S.target);
  return { ...e, hd: hdOf(c, e) };
}
// Применить повышение к персонажу (используется и для предпросмотра на копии)
// S.sub — подкласс, выбранный на уровне подкласса
function applyAdvance(c, S) {
  if (S.target === 'p') { c.info.level = pLvl(c) + 1; if (S.sub) c.info.subclass = S.sub; }
  else if (S.target === 'new') {
    c.multi.push({ id: uid(), cls: S.newCls, sub: '', lvl: 1 });
    const got = applyMcProfs(c, S.newCls);
    if (got) toast(`Владения мультикласса «${esc(S.newCls)}»: ${esc(got)}`);
  }
  else { const m = c.multi.find((x) => x.id === S.target); m.lvl = (parseInt(m.lvl) || 1) + 1; if (S.sub) m.sub = S.sub; }
}
// Нужно ли выбрать подкласс: достигнут уровень подкласса, а подкласс ещё не выбран (или не из списка)
const lvlNeedsSub = (T) => !!T.cls && T.lvl + 1 === subclassLevel(T.cls) && !subclassOf(T.cls, T.sub) && (SUBCLASSES[T.cls] || []).length > 0;
function lvlResetPicks(c) {
  const S = lvlState, t = lvlTarget(c, S);
  S.slots = t.cls ? featSlotsAt(t.cls, t.lvl + 1) : [];
  S.picks = {};
  S.slots.forEach((k) => { S.picks[k] = defaultPick(c, k); });
  S.skip = new Set();
  S.roll = null;
  S.sub = '';
}
function openLevelUp() {
  const c = ch();
  if (lvl(c) >= 20) { toast('Персонаж уже 20 уровня'); return; }
  const others = Object.keys(CLASSES).filter((n) => !classList(c).some((e) => e.cls === n));
  lvlState = { hpMode: 'avg', target: 'p', newCls: others[0] || '' };
  lvlResetPicks(c);
  openModal('<h2>⬆ Повышение уровня</h2><div id="lvlBody"></div>');
  modalRefresh = renderLevelUp;
  $('#modalBody').onchange = (e) => {
    const el = e.target, S = lvlState;
    if (el.name === 'hpMode') S.hpMode = el.value;
    else if (el.name === 'lvlTarget') { S.target = el.value; lvlResetPicks(c); }
    else if (el.id === 'lvlNewCls') { S.newCls = el.value; S.target = 'new'; lvlResetPicks(c); }
    else if (el.id === 'lvlSub') { S.sub = el.value; S.skip = new Set(); }
    else if (el.dataset.feat != null) { el.checked ? S.skip.delete(+el.dataset.feat) : S.skip.add(+el.dataset.feat); return; }
    else if (!pickChange(S.picks, el)) return;
    renderLevelUp();
  };
  renderLevelUp();
}
function lvlGain(c) {
  const S = lvlState, hd = lvlTarget(c, S).hd;
  const base = S.hpMode === 'avg' ? hd / 2 + 1 : S.roll;
  return base == null ? null : Math.max(1, base + am(c, 'con')) + hpPerLevelBonus(c);
}
function renderLevelUp() {
  const box = $('#lvlBody');
  if (!box) return;
  const c = ch(), S = lvlState, L = lvl(c), N = L + 1, con = am(c, 'con');
  const T = lvlTarget(c, S), hd = T.hd, CN = T.lvl + 1;
  const gain = lvlGain(c);
  const needSub = lvlNeedsSub(T);
  const feats = T.cls ? featuresAt(T.cls, S.sub || T.sub, CN) : [];
  const changes = [];
  const pbN = 2 + Math.floor((N - 1) / 4);
  if (pbN !== pb(c)) changes.push(`Бонус мастерства: ${fmt(pb(c))} → <b>${fmt(pbN)}</b>`);
  changes.push(`Кости хитов: +1 к${hd} (всего ${N})`);
  // Предпросмотр: применить повышение к копии и сравнить ячейки и ресурсы
  const after = JSON.parse(JSON.stringify(c));
  applyAdvance(after, S); autoSlots(after); autoResources(after);
  after.slots.forEach((s, i) => { if (s.max !== c.slots[i].max) changes.push(`Ячейки ${i + 1} ур.: ${c.slots[i].max} → <b>${s.max}</b>`); });
  if (after.pact.max !== c.pact.max || after.pact.level !== c.pact.level) changes.push(`Магия договора: ${c.pact.max} × ${c.pact.level} ур. → <b>${after.pact.max} × ${after.pact.level} ур.</b>`);
  after.resources.filter((r) => CLASS_RESOURCES[r.auto]).forEach((r) => {
    const before = c.resources.find((x) => x.auto === r.auto);
    if (!before) changes.push(`Новый ресурс: <b>${esc(r.n)}</b> (${r.max})`);
    else if (before.max !== r.max) changes.push(`${esc(r.n)}: ${before.max} → <b>${r.max}</b>`);
  });
  if (casterOf(T) !== 'none' || T.cls === 'Колдун') changes.push('Подготовьте новые заклинания, если положено по таблице класса');
  const cap = CN === 20 && CAPSTONE[T.cls];
  if (cap) changes.push(`${cap[0]}: ${cap[1].map((k) => `${ABILITIES.find((a) => a.k === k).s} ${score(c, k)} → <b>${Math.min(25, score(c, k) + 4)}</b>`).join(', ')}`);
  const newSp = S.sub ? Object.entries(subclassOf(T.cls, S.sub)?.sp || {}).filter(([Lv]) => CN >= +Lv).flatMap(([, l]) => l) : [];
  if (newSp.length) changes.push(`Заклинания подкласса (всегда подготовлены): ${newSp.map((e) => spellByE(e)?.n || e).join(', ')}`);
  const picksOk = S.slots.every((k) => pickValid(S.picks[k])) && (!needSub || !!S.sub);

  // Выбор класса: существующие классы или новый (мультикласс)
  const others = Object.keys(CLASSES).filter((n) => !classList(c).some((e) => e.cls === n));
  const reqWarn = S.target === 'new' && S.newCls ? [S.newCls, ...classList(c).map((e) => e.cls)].filter((n) => n && !mcOk(c, n)) : [];
  const targets = classList(c).map((e) => `<label class="check"><input type="radio" name="lvlTarget" value="${e.primary ? 'p' : e.id}" ${S.target === (e.primary ? 'p' : e.id) ? 'checked' : ''}> ${esc(e.cls || 'Класс не указан')} ${e.lvl} → ${e.lvl + 1}</label>`).join('')
    + (others.length ? `<label class="check"><input type="radio" name="lvlTarget" value="new" ${S.target === 'new' ? 'checked' : ''}> Новый класс:</label>
      <select id="lvlNewCls">${others.map((n) => `<option ${S.newCls === n ? 'selected' : ''}>${n}</option>`).join('')}</select>` : '');

  box.innerHTML = `<p class="muted">${esc(c.info.name)}: общий уровень <b>${L} → ${N}</b></p>
    <h3>Класс</h3><div class="row gap wrap">${targets}</div>
    ${S.target === 'new' ? `<p class="muted small">Требования мультикласса: ${esc(S.newCls)} — ${mcReqText(S.newCls)}; для текущих классов — их основные характеристики 13+.
      Новый класс даёт лишь часть владений (см. правила мультикласса), спасброски не добавляются.</p>` : ''}
    ${reqWarn.length ? `<p class="small gen-warn">⚠ Не выполнены требования мультикласса: ${reqWarn.map((n) => `${esc(n)} (${mcReqText(n)})`).join(', ')}. По правилам такой мультикласс недоступен — только с разрешения Мастера.</p>` : ''}
    ${needSub ? `<h3>Подкласс</h3><select id="lvlSub"><option value="">— выберите подкласс —</option>${SUBCLASSES[T.cls].map((s) => `<option ${S.sub === s.n ? 'selected' : ''}>${s.n}</option>`).join('')}</select>
      ${S.sub ? `<ul class="lvl-list">${Object.entries(subclassOf(T.cls, S.sub).f).map(([Lv, list]) => `<li><b>${Lv} ур.:</b> ${list.map(([n]) => esc(n)).join(', ')}</li>`).join('')}</ul>` : '<p class="muted small">Подкласс определяет умения на этом и следующих уровнях.</p>'}` : ''}
    <h3>Хиты</h3>
    <div class="row gap wrap">
      <label class="check"><input type="radio" name="hpMode" value="avg" ${S.hpMode === 'avg' ? 'checked' : ''}> Среднее (${hd / 2 + 1})</label>
      <label class="check"><input type="radio" name="hpMode" value="roll" ${S.hpMode === 'roll' ? 'checked' : ''}> Бросок к${hd}</label>
      ${S.hpMode === 'roll' ? `<button data-act="lvlRoll">🎲 ${S.roll == null ? 'Бросить' : `Выпало ${S.roll} — перебросить`}</button>` : ''}
    </div>
    <p>${gain == null ? '<span class="muted">Бросьте кость хитов</span>' : `+<b>${gain}</b> хитов (${S.hpMode === 'avg' ? hd / 2 + 1 : S.roll} ${fmt(con)} Тел${hpPerLevelBonus(c) ? ` +${hpPerLevelBonus(c)} раса/черта` : ''}) · максимум ${c.combat.hpMax} → <b>${+c.combat.hpMax + gain}</b>`}</p>
    <h3>Что изменится</h3><ul class="lvl-list">${changes.map((x) => `<li>${x}</li>`).join('')}</ul>
    ${feats.length ? `<h3>Новые умения</h3><p class="muted small">Отмеченные добавятся во вкладку «Способности». Описания — в Книге игрока.</p>
      <div class="lvl-feats">${feats.map((f, i) => { const d = featureDesc(T.cls, f); return `<label class="check lvl-feat"><input type="checkbox" data-feat="${i}" ${S.skip.has(i) ? '' : 'checked'}> <span><b>${esc(f)}</b>${d ? `<span class="muted small"> — ${esc(d)}</span>` : ''}</span></label>`; }).join('')}</div>`
    : S.slots.length ? ''
    : T.cls && !CLASS_FEATURES[T.cls] ? '<p class="muted small">Класс не из списка — умения добавьте вручную.</p>' : !T.cls ? '<p class="muted small">Укажите класс, чтобы увидеть новые умения.</p>' : ''}
    ${S.slots.map((k) => `<h3>${k === 'general' ? 'Увеличение характеристик или черта' : FEAT_SLOTS[k].n}</h3>${featPickerHtml(c, k, S.picks[k])}`).join('')}
    <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" data-act="lvlApply" ${gain == null || !picksOk ? 'disabled' : ''}>${S.target === 'new' ? `Взять ${esc(S.newCls)} 1 ур.` : `Повысить: ${esc(T.cls || 'класс')} ${CN}`}</button></div>`;
}

/* ---------- Каталог снаряжения ---------- */
let catTab = 'weapons';
function openCatalog(tab) {
  if (tab) catTab = tab;
  openModal(`<h2>📖 Каталог снаряжения</h2><div class="row gap wrap"><div class="seg" id="catSeg"></div><input id="catQ" placeholder="Поиск…" style="flex:1;min-width:140px"></div><div id="catList" class="db-list"></div>
    <p class="muted small">Цены и вес — по Книге игрока 2024. Оружие добавляется в атаки с владением; фехтовальное использует лучшую из Силы и Ловкости.</p>`);
  modalRefresh = renderCatalog;
  $('#catQ').addEventListener('input', renderCatalog);
  renderCatalog();
  setTimeout(() => $('#catQ')?.focus(), 30);
}
function renderCatalog() {
  if (!$('#catList')) return;
  const c = ch(), q = $('#catQ').value.trim().toLowerCase();
  const match = (...t) => !q || t.join(' ').toLowerCase().includes(q);
  $('#catSeg').innerHTML = [['weapons', 'Оружие'], ['armor', 'Доспехи'], ['gear', 'Снаряжение'], ['magic', 'Магия']]
    .map(([k, t]) => `<button data-act="catTab" data-t="${k}" class="${catTab === k ? 'on' : ''}">${t}</button>`).join('');
  let html = '';
  if (catTab === 'weapons') {
    Object.entries(WEAPON_CATS).forEach(([cat, title]) => {
      const rows = WEAPONS.map((w, i) => [w, i]).filter(([w]) => w.cat === cat && match(w.n, w.props, MASTERY[w.m].n));
      if (!rows.length) return;
      html += `<h3>${title}</h3>` + rows.map(([w, i]) => `<div class="db-row"><span class="li-title">${esc(w.n)}
        <span class="muted small">${w.dmg} ${w.type} · ${esc(w.props)} · ⚔ ${MASTERY[w.m].n} · ${w.w} фнт · ${w.cost}</span></span>
        <button data-act="catWeapon" data-i="${i}" data-to="atk" title="Добавить в атаки">⚔ В атаки</button><button data-act="catWeapon" data-i="${i}" data-to="inv" title="Добавить в инвентарь">🎒</button></div>`).join('');
    });
  } else if (catTab === 'armor') {
    Object.entries(ARMOR_TYPES).forEach(([type, title]) => {
      const rows = ARMOR.filter((a) => a.type === type && match(a.n));
      if (!rows.length) return;
      html += `<h3>${title} доспех</h3>` + rows.map((a) => `<div class="db-row"><span class="li-title">${esc(a.n)}
        <span class="muted small">КД ${a.ac}${type === 'light' ? ' + Лов' : type === 'medium' ? ' + Лов (макс. 2)' : ''}${a.str ? ` · Сила ${a.str}` : ''}${a.stealth ? ' · помеха Скрытности' : ''} · ${a.w} фнт · ${a.cost}</span></span>
        ${c.armor.mode === 'auto' && c.armor.id === a.id ? '<span class="tag g">надет</span>' : `<button data-act="catArmor" data-id="${a.id}">Надеть</button>`}<button data-act="catArmor" data-id="${a.id}" data-to="inv" title="Только в инвентарь">🎒</button></div>`).join('');
    });
    if (match(SHIELD.n)) html += `<h3>Щит</h3><div class="db-row"><span class="li-title">${SHIELD.n} <span class="muted small">+2 КД · ${SHIELD.w} фнт · ${SHIELD.cost}</span></span>
      ${c.armor.shield ? '<span class="tag g">в руке</span>' : '<button data-act="catShield">Взять</button>'}</div>`;
  } else if (catTab === 'magic') {
    html = MAGIC_ITEMS.map((m, i) => [m, i]).filter(([m]) => match(m.n, m.x || '')).map(([m, i]) => `<div class="db-row"><span class="li-title">${esc(m.n)}
      <span class="muted small">${esc(m.cost || '')}${magicTags(m) ? ` · ${esc(magicTags(m))}` : ''}${m.att ? ' · настройка' : ''}${m.chMax ? ` · ${m.chMax} зарядов` : ''}${m.x ? ` · ${esc(m.x)}` : ''}</span></span>
      ${m.pick ? `<select data-mpick="${i}" style="width:auto"><option value="">— ${m.pick === 'w' ? 'оружие' : 'доспех'} —</option>${(m.pick === 'w' ? WEAPONS : ARMOR).map((x, j) => `<option value="${m.pick === 'w' ? j : x.id}">${esc(x.n)}</option>`).join('')}</select>` : ''}
      <button data-act="catMagic" data-i="${i}">🎒 Добавить</button></div>`).join('');
  } else {
    html = GEAR.map((g, i) => [g, i]).filter(([g]) => match(g.n, g.x)).map(([g, i]) => `<div class="db-row"><span class="li-title">${esc(g.n)}
      <span class="muted small">${g.cost} · ${g.w} фнт${g.x ? ' · ' + esc(g.x) : ''}</span></span><button data-act="catGear" data-i="${i}">🎒 Добавить</button></div>`).join('');
  }
  $('#catList').innerHTML = html || '<p class="muted">Ничего не найдено</p>';
}
function addInvItem(c, item) {
  const same = c.items.find((x) => x.n === item.n && !x.att);
  if (same) { same.qty = (+same.qty || 0) + (item.qty || 1); return same; }
  const it = { id: uid(), cat: 'Снаряжение', qty: 1, w: 0, cost: '', chMax: 0, ch: 0, eq: false, att: false, attuned: false, x: '', ...item };
  c.items.push(it);
  return it;
}
function weaponAttack(w) {
  const thrown = w.props.match(/Метательное \((\d+\/\d+)\)/), ammo = w.props.match(/Боеприпасы \((\d+\/\d+)\)/);
  const ranged = w.cat === 'sr' || w.cat === 'mr';
  const reach = w.props.includes('Досягаемость') ? '10 фт' : '5 фт';
  return {
    id: uid(), n: w.n, ability: w.props.includes('Фехтовальное') ? 'fin' : ranged ? 'dex' : 'str', prof: true, hit: 0, dmg: w.dmg,
    addMod: true, dmgBonus: 0, type: w.type, mastery: w.m,
    range: ammo ? `${ammo[1]} фт` : thrown ? `${reach} · бросок ${thrown[1]} фт` : reach, x: w.props === '—' ? '' : w.props,
    ammo: AMMO_FOR[w.n] || '', wkind: w.n,
  };
}
// Приёмы оружия (Weapon Mastery): сколько видов оружия известно (лучший из классов + черта «Мастер оружия»)
function masteryLimit(c) {
  const base = Math.max(0, ...classList(c).map((e) => (MASTERY_COUNT[e.cls] ? MASTERY_COUNT[e.cls](e.lvl) : 0)));
  return base + c.feats.filter((f) => f.key === 'weaponMaster').length;
}
const weaponKind = (a) => a.wkind || (WEAPONS.some((w) => w.n === a.n) ? a.n : '');
// Приём работает, если вид оружия изучен; у своего оружия (не из каталога) — как указано
const masteryActive = (c, a) => !!a.mastery && (!weaponKind(a) || c.masteries.includes(weaponKind(a)));
function openMasteryPick() {
  openModal('<h2>⚔ Приёмы оружия</h2><div id="mstBody"></div>');
  modalRefresh = renderMasteryPick;
  renderMasteryPick();
}
function renderMasteryPick() {
  const box = $('#mstBody');
  if (!box) return;
  const c = ch(), lim = masteryLimit(c), full = c.masteries.length >= lim;
  box.innerHTML = `<p class="muted small">Выбрано <b>${c.masteries.length} из ${lim}</b>. Приём работает, только если этот вид оружия выбран здесь. По правилам выбор можно менять после долгого отдыха.</p>
    <div class="mst-list">${Object.entries(WEAPON_CATS).map(([cat, title]) => `<h3>${title}</h3>${WEAPONS.filter((w) => w.cat === cat).map((w) => {
      const on = c.masteries.includes(w.n);
      return `<div class="db-row ${on ? 'on' : ''}"><span class="li-title">${esc(w.n)} <span class="muted small">⚔ ${MASTERY[w.m].n} — ${esc(MASTERY[w.m].d)}</span></span>
        ${on ? `<button data-act="masteryDel" data-w="${esc(w.n)}">✓ Убрать</button>` : `<button data-act="masteryAdd" data-w="${esc(w.n)}" ${full ? 'disabled' : ''}>＋ Выбрать</button>`}</div>`;
    }).join('')}`).join('')}</div>
    <div class="modal-actions"><button data-act="closeModal">Готово</button></div>`;
}
// Боеприпасы атаки — предмет инвентаря, название которого начинается с a.ammo (например, «Стрелы (20)»)
const ammoItem = (c, a) => (a.ammo ? c.items.find((i) => i.n.toLowerCase().startsWith(a.ammo.toLowerCase().trim()) && +i.qty > 0)
  || c.items.find((i) => i.n.toLowerCase().startsWith(a.ammo.toLowerCase().trim())) : null);
const ammoLeft = (c, a) => { const it = ammoItem(c, a); return it ? +it.qty || 0 : 0; };
// Списать боеприпас перед атакой; false — боеприпасов нет
function spendAmmo(c, a) {
  if (!a || !a.ammo) return true;
  const it = ammoItem(c, a);
  if (!it || +it.qty <= 0) { toast(`🏹 Нет боеприпасов «${esc(a.ammo)}» в инвентаре — добавьте их из каталога`, 'fumble'); return false; }
  it.qty = +it.qty - 1;
  c.combat.ammoSpent = { ...(c.combat.ammoSpent || {}), [it.id]: ((c.combat.ammoSpent || {})[it.id] || 0) + 1 };
  return true;
}
function ammoWarn(c, a) { if (a && a.ammo) { const left = ammoLeft(c, a); if (left <= 5) toast(`🏹 ${esc(a.ammo)}: осталось ${left}`); } }

/* ---------- Атаки для игрового стола ---------- */
// Дистанция: reach — досягаемость в ближнем бою (0 — только дальнобойная); near/far — обычная и максимальная дальность
function atkRange(range, spell) {
  const s = String(range || '');
  if (spell) { const n = parseInt(s); return /касан/i.test(s) || !n ? { reach: 5 } : { reach: 0, near: n, far: n }; }
  const rng = s.match(/(\d+)\s*\/\s*(\d+)/), reach = s.match(/^\s*(\d+)\s*фт/);
  if (rng && !/бросок/i.test(s)) return { reach: 0, near: +rng[1], far: +rng[2] };
  return { reach: reach ? +reach[1] : 5, ...(rng ? { near: +rng[1], far: +rng[2], thrown: true } : {}) };
}
// Заговоры с броском атаки (Огненный снаряд, Луч холода…): урон растёт на 5, 11 и 17 уровнях.
// У Мистического заряда растёт не урон, а число лучей — каждый луч отдельная атака.
const tableCantrip = (s) => +s.l === 0 && s.f && /атак\S* заклинани/i.test(s.x || '');
const cantripTier = (c) => 1 + (lvl(c) >= 5) + (lvl(c) >= 11) + (lvl(c) >= 17);
const dmgWord = (x) => (String(x || '').match(/урона\s+([а-яё]+(?:\s+полем)?)/i) || [])[1] || '';
// Сколько атак даёт действие «Атака» (Дополнительная атака)
const attacksPerAction = (c) => Math.max(1, ...classList(c).map((e) => (e.cls === 'Воин' ? (e.lvl >= 20 ? 4 : e.lvl >= 11 ? 3 : e.lvl >= 5 ? 2 : 1)
  : ['Варвар', 'Монах', 'Паладин', 'Следопыт'].includes(e.cls) && e.lvl >= 5 ? 2 : 1)));
function tableAttacks(c) {
  // В диком облике атакуют только атаками зверя
  if (c.shape) return c.shape.atk.map((a) => ({ id: a.id, n: `${a.n} (${c.shape.n})`, bonus: a.hit, dmg: a.dmg, type: a.type, rng: atkRange(a.range, false), beast: true }));
  return [
    ...c.attacks.map((a) => ({ id: a.id, n: a.n, bonus: attackBonus(c, a), dmg: dmgExpr(c, a), type: a.type || '', rng: atkRange(a.range, a.ability === 'spell'), fin: a.ability === 'fin' || isRangedWeapon(a),
      spell: a.ability === 'spell', ammo: a.ammo ? ammoLeft(c, a) : null, ammoName: a.ammo || '', mastery: masteryActive(c, a) && MASTERY[a.mastery] ? MASTERY[a.mastery].n : '' })),
    ...c.spells.filter(tableCantrip).map((s) => {
      // «Мучительный взрыв» (воззвание): +мод. Харизмы к урону Мистического заряда; «Отталкивающий взрыв» — толчок на 10 фт
      const EB = s.e === 'Eldritch Blast', inv = (c.cpicks || {}).inv || [];
      const beams = EB ? cantripTier(c) : 1, dice = beams > 1 ? s.f : scaleDice(s.f, cantripTier(c)), mod = (s.addMod ? spellModFor(c, s) : 0) + (EB && inv.includes('Мучительный взрыв') ? am(c, 'cha') : 0);
      return { id: 'sp:' + s.id, n: s.n, bonus: spellAtkFor(c, s), dmg: withMod(dice, mod), dice, mod, type: dmgWord(s.x), rng: atkRange(s.r, true), spell: true, cantrip: true, beams, repel: EB && inv.includes('Отталкивающий взрыв') };
    }),
  ];
}

/* ---------- Действия ---------- */
let pendingConc = 0;
const findById = (arr, id) => arr.find((x) => x.id === id);
const hpAmount = () => { const v = parseInt($('#hpAmount').value); return isNaN(v) || v < 0 ? 0 : v; };

// Урон по правилам 2024: при 0 хитов — провал спасброска от смерти (крит — два), урон ≥ максимума хитов — смерть;
// стабилизированный, получив урон, снова начинает умирать
function applyDamage(n, crit) {
  const c = ch(), cb = c.combat;
  let rest = n;
  const absorbed = Math.min(+cb.temp || 0, rest);
  cb.temp = (+cb.temp || 0) - absorbed; rest -= absorbed;
  const wasZero = (+cb.hp || 0) <= 0;
  cb.hp = (+cb.hp || 0) - rest;
  let msg = `Получено ${n} урона${absorbed ? ` (${absorbed} поглощено врем. хитами)` : ''}`;
  if (cb.hp <= 0) {
    const over = -cb.hp;
    cb.hp = 0;
    if (wasZero && rest > 0) {
      if (rest >= (+cb.hpMax || 0)) { cb.deathF = 3; msg += '. ☠ Урон не меньше максимума хитов — персонаж погиб'; }
      else {
        if (cb.deathS >= 3) { cb.deathS = 0; msg += '. Стабилизация потеряна'; }
        cb.deathF = Math.min(3, cb.deathF + (crit ? 2 : 1));
        msg += crit ? '. Критический удар — два провала спасброска от смерти' : '. Провал спасброска от смерти';
        if (cb.deathF >= 3) msg += '. ☠ Персонаж погиб';
      }
    } else if (over >= (+cb.hpMax || 0) && rest > 0) { cb.deathF = 3; cb.deathS = 0; msg += '. ☠ Мгновенная смерть: остаток урона ≥ максимума хитов!'; }
    else if (!wasZero) {
      msg += '. 0 хитов — без сознания';
      cb.deathS = 0; cb.deathF = 0;
      if (!cb.conditions.includes('unconscious')) cb.conditions.push('unconscious');
      if (cb.conc) { msg += `, концентрация на «${cb.conc}» прервана`; endConc(c); }
    }
  }
  if (cb.conc && n > 0) { pendingConc = Math.min(30, Math.max(10, Math.floor(n / 2))); msg += `. Спасбросок концентрации: СЛ ${pendingConc}`; }
  toast(esc(msg), 'fumble');
}
// Спасбросок от смерти (2024): к20 без модификаторов; 10+ — успех, иначе провал; 1 — два провала; 20 — 1 хит и в сознании.
// Три успеха — стабилизирован, три провала — смерть
function doDeathSave(c) {
  const cb = c.combat;
  const { nat, total } = rollD20('Спасбросок от смерти', 0, { kind: 'death' });
  let res;
  if (nat === 20) { cb.hp = 1; cb.deathS = 0; cb.deathF = 0; cb.conditions = cb.conditions.filter((k) => k !== 'unconscious'); res = 'revive'; toast('🌟 Натуральная 20 — вы приходите в себя с 1 хитом!', 'crit'); }
  else if (nat === 1) { cb.deathF = Math.min(3, cb.deathF + 2); res = 'fail2'; }
  else if (total >= 10) { cb.deathS = Math.min(3, cb.deathS + 1); res = 'ok'; }
  else { cb.deathF = Math.min(3, cb.deathF + 1); res = 'fail'; }
  if (cb.deathS >= 3) toast('Стабилизирован: 0 хитов, но без спасбросков. Через 1к4 часа — 1 хит.');
  if (cb.deathF >= 3) toast('☠ Три провала — персонаж погиб', 'fumble');
  return { nat, total, res, s: cb.deathS, f: cb.deathF };
}
function doLongRest(c) {
  const cb = c.combat;
  cb.hp = cb.hpMax; cb.temp = 0; cb.hdUsed = 0; cb.hdUsedBy = {}; cb.deathS = 0; cb.deathF = 0;
  cb.exhaustion = Math.max(0, cb.exhaustion - 1);
  cb.conditions = cb.conditions.filter((k) => k !== 'unconscious');
  c.effects = []; endConc(c); pendingConc = 0;
  c.shape = null;
  c.slots.forEach((s) => { s.used = 0; }); c.pact.used = 0;
  c.resources.forEach((r) => { if (r.recharge !== 'none') r.used = 0; });
  (c.companions || []).forEach((p) => { p.hp = p.hpMax; });
  toast('🌙 Долгий отдых завершён — всё восстановлено');
}
function applyHeal(n) {
  const cb = ch().combat;
  if (n <= 0) return;
  if ((+cb.hp || 0) <= 0) { cb.deathS = 0; cb.deathF = 0; cb.conditions = cb.conditions.filter((k) => k !== 'unconscious'); }
  cb.hp = Math.min(+cb.hpMax || 0, (+cb.hp || 0) + n);
}
// die — размер кости; без него берётся самая большая из оставшихся
function spendHitDie(die) {
  const c = ch(), cb = c.combat;
  const pool = hitDicePools(c).find((p) => (die ? p.die === +die : true) && p.used < p.total);
  if (!pool) { toast('Кости хитов закончились'); return; }
  if (isMulti(c)) cb.hdUsedBy = { ...cb.hdUsedBy, [pool.die]: pool.used + 1 };
  else cb.hdUsed = pool.used + 1;
  const r = rollDice(`Кость хитов к${pool.die}`, withMod(`1d${pool.die}`, am(c, 'con')));
  if (r) applyHeal(Math.max(0, r.total));
}
function updateShortRestInfo() {
  const c = ch();
  if (!$('#srHd')) return;
  $('#srHd').innerHTML = hitDicePools(c).map((p) => `<button data-act="spendHd" data-die="${p.die}" ${p.total - p.used ? '' : 'disabled'}>🎲 к${p.die}: ${p.total - p.used} / ${p.total}</button>`).join(' ');
  $('#srHp').textContent = `${c.combat.hp} / ${c.combat.hpMax}`;
}
function addSpell(src) {
  const c = ch();
  if (c.spells.some((s) => s.n === src.n)) { toast('Это заклинание уже есть в листе'); return; }
  c.spells.push({ ...src, id: uid(), prep: src.l === 0 });
  toast(`Добавлено: ${esc(src.n)}`);
}
function doCast(s, castLvl, how) {
  const c = ch(), cb = c.combat;
  let msg = `✨ ${esc(s.n)}${how ? ' — ' + how : ''}`;
  if (s.cn) {
    if (cb.conc && cb.conc !== s.n) msg += `<div class="rd">Концентрация на «${esc(cb.conc)}» прервана</div>`;
    endConc(c);
    cb.conc = s.n; pendingConc = 0;
  }
  const dur = parseDuration(s.d);
  if (dur) { addEffect(c, { n: s.n, left: dur, conc: !!s.cn, x: s.d }); msg += `<div class="rd">⏳ ${esc(s.d)} — добавлено в эффекты</div>`; }
  toast(msg);
  if (s.f) {
    let expr = s.f;
    if (+s.l === 0) { const L = lvl(c); expr = scaleDice(expr, 1 + (L >= 5) + (L >= 11) + (L >= 17)); }
    else if (s.u && castLvl > s.l) for (let i = 0; i < castLvl - s.l; i++) expr += '+' + s.u;
    if (s.addMod) expr = withMod(expr, spellModFor(c, s));
    const r = rollDice(`${s.n}${castLvl > s.l ? ` (${castLvl} ур.)` : ''}`, expr);
    return r && { ...r, expr };
  }
  return null;
}
// Ячейки для сотворения: [{ key, label, lvl, left }] — key передаётся в spendSlot
function slotOptions(c, s) {
  if (+s.l === 0) return [{ key: 'free', label: 'Заговор', lvl: 0, left: 1 }];
  const out = [];
  c.slots.forEach((sl, i) => { if (i + 1 >= s.l && sl.max) out.push({ key: String(i), label: `${i + 1} уровень (${sl.max - sl.used}/${sl.max})`, lvl: i + 1, left: sl.max - sl.used }); });
  if (c.pact.max && c.pact.level >= s.l) out.push({ key: 'pact', label: `Договор ${c.pact.level} ур. (${c.pact.max - c.pact.used}/${c.pact.max})`, lvl: c.pact.level, left: c.pact.max - c.pact.used });
  if (s.rt) out.push({ key: 'ritual', label: 'Как ритуал (+10 мин)', lvl: +s.l, left: 1 });
  out.push({ key: 'free', label: 'Без ячейки (умение/предмет)', lvl: +s.l, left: 1 });
  return out;
}
// Свободные ячейки для заклинания-реакции (без «без ячейки» и ритуала); заклинание должно быть подготовлено
// Добыча или покупка в лист: золото — в кошелёк, магический предмет — как из каталога, прочее — в инвентарь; возвращает название
// Положить в лист снимок предмета из другого листа: обычные — стопкой к таким же, с настройкой или атакой — отдельно
function putSnap(c, S) {
  const { atk, ...s } = S;
  let it;
  if (s.att || atk) { it = { ...s, id: uid(), attuned: false }; c.items.push(it); } else it = addInvItem(c, s);
  (atk || []).forEach((a) => c.attacks.push({ ...a, id: uid(), item: it.id }));
  return it;
}
function lootInto(c, L) {
  if (L.kind === 'gold') { c.coins.gp = (+c.coins.gp || 0) + (+L.gp || 0); return `${L.gp} зм`; }
  // Предмет, брошенный игроком и переложенный в добычу, — снимок из листа (с атакой магического оружия)
  if (L.snap) return putSnap(c, L.snap).n;
  const M = L.kind === 'magic' && MAGIC_ITEMS.find((m) => m.n === L.mn);
  if (M) {
    const base = !M.pick ? null : M.pick === 'w' ? WEAPONS.find((w) => w.n === L.base) : ARMOR.find((a) => a.id === L.base);
    if (!M.pick || base) return addMagicItem(c, M, base).n;
  }
  // Обычный предмет: вес и цена — из списков оружия, доспехов и снаряжения; свиток, камень и т. п. — с описанием и ценой
  const w = WEAPONS.find((x) => x.n === L.n), a = ARMOR.find((x) => x.n === L.n), g = GEAR.find((x) => x.n === L.n);
  const base = w ? { cat: 'Оружие', w: w.w, cost: w.cost } : a ? { cat: 'Доспехи', w: a.w, cost: a.cost } : g ? { cat: g.cat, w: g.w, cost: g.cost, x: g.x, chMax: g.ch || 0, ch: g.ch || 0 } : {};
  return addInvItem(c, { n: L.n, qty: +L.qty || 1, ...base, ...(L.cat ? { cat: L.cat } : {}), ...(L.cost ? { cost: L.cost } : {}), ...(L.x ? { x: L.x } : {}) }).n;
}
// Начислить сумму в золоте монетами: золото, серебро, медь (0,5 зм → 5 см)
function addCoins(c, gp) {
  let cp = Math.round(gp * 100);
  c.coins.gp = (+c.coins.gp || 0) + Math.floor(cp / 100); cp %= 100;
  c.coins.sp = (+c.coins.sp || 0) + Math.floor(cp / 10); c.coins.cp = (+c.coins.cp || 0) + (cp % 10);
}
// Оплата: сначала золотом, затем платиной, электрумом, серебром и медью; сдача — золотом, серебром и медью
function payCoins(c, gp) {
  const val = { gp: 100, pp: 1000, ep: 50, sp: 10, cp: 1 };
  let need = Math.round(gp * 100);
  for (const k of Object.keys(val)) {
    if (need <= 0) break;
    const have = +c.coins[k] || 0, use = Math.min(have, Math.ceil(need / val[k]));
    c.coins[k] = have - use;
    need -= use * val[k];
  }
  let change = -need;
  if (change > 0) { c.coins.gp = (+c.coins.gp || 0) + Math.floor(change / 100); change %= 100; c.coins.sp = (+c.coins.sp || 0) + Math.floor(change / 10); c.coins.cp = (+c.coins.cp || 0) + (change % 10); }
}
function reactSlots(c, e) {
  const s = c.spells.find((x) => x.e === e && (x.prep || x.always));
  return s ? slotOptions(c, s).filter((x) => x.left > 0 && x.key !== 'free' && x.key !== 'ritual') : [];
}
function spendSlot(c, s, key) {
  if (+s.l === 0) return { castLvl: 0, how: '' };
  if (key === 'pact') { c.pact.used++; return { castLvl: c.pact.level, how: `ячейка договора ${c.pact.level} ур.` }; }
  if (key === 'ritual') return { castLvl: +s.l, how: 'ритуал' };
  if (key === 'free') return { castLvl: +s.l, how: 'без ячейки' };
  c.slots[+key].used++;
  return { castLvl: +key + 1, how: `ячейка ${+key + 1} ур.` };
}

/* ---------- Заклинания с областью и спасброском — для игрового стола ---------- */
const SAVE_AB = { 'силы': 'str', 'ловкости': 'dex', 'телосложения': 'con', 'интеллекта': 'int', 'мудрости': 'wis', 'харизмы': 'cha' };
// Форма и размер из дистанции и описания: «На себя (конус 15 фт)», «сферой радиусом 20 фт», «Линия 100×5 фт», «На себя (15 фт)»
// Форма заклинания для стола: таблица механики (spellmech.js) главнее разбора описания
function spellArea(s) {
  const M = typeof SPELL_MECH !== 'undefined' && SPELL_MECH[s.e], base = spellAreaText(s);
  if (!M) return base;
  const r = String(s.r || ''), self = M.shape === 'aura' || M.range === 0;
  return { shape: 'target', size: 0, width: 5, save: '', half: false, heal: false, pick: false,
    dtype: dmgWord(s.x), act: /бонусн/i.test(s.t || '') ? 'bonus' : /реакц/i.test(s.t || '') ? 'reaction' : 'action', ...(base || {}),
    ...Object.fromEntries(['shape', 'size', 'width', 'save', 'half', 'pick', 'act', 'dtype'].filter((k) => M[k] != null).map((k) => [k, M[k]])),
    self, range: self ? 0 : M.range != null ? M.range : base ? base.range : /касан/i.test(r) ? 5 : parseInt(r) || 0, zone: M.zone || null, wall: M.wall || null,
    ...Object.fromEntries(['upSize', 'persist', 'leave', 'part', 'nParts', 'contiguous'].filter((k) => M[k] != null).map((k) => [k, M[k]])) };
}
function spellAreaText(s) {
  const r = String(s.r || ''), t = `${r} ${s.x || ''}`, num = (re) => { const m = t.match(re); return m ? +m[1] : 0; };
  let shape = null, size = 0, width = 5;
  if ((size = num(/конус\S*\s+(\d+)/i))) shape = 'cone';
  else if ((size = num(/линия\S*\s+(\d+)/i))) { shape = 'line'; const w = t.match(/(\d+)\s*[×x]\s*(\d+)\s*фт/); if (w) width = +w[2]; }
  else if ((size = num(/(?:куб|квадрат)\S*\s+(\d+)/i))) shape = 'cube';
  else if ((size = num(/(?:сфер|цилиндр)\S*\s+радиусом\s+(\d+)/i))) shape = 'sphere';
  else if ((size = num(/^на себя\s*\((\d+)/i))) shape = 'aura';
  else if ((size = num(/радиусом\s+(\d+)/i))) shape = 'sphere';
  const sv = t.match(/спасброс\S*\s+(Силы|Ловкости|Телосложения|Интеллекта|Мудрости|Харизмы)/i);
  const save = sv ? SAVE_AB[sv[1].toLowerCase()] : '';
  if (!shape && save) shape = 'target';
  if (!shape) return null;
  const self = /^на себя/i.test(r);
  return { shape, size, width, save, half: /половин\S* при успехе/i.test(s.x || ''), self, range: self ? 0 : /касан/i.test(r) ? 5 : parseInt(r) || 0,
    heal: /восстанавлива\S* .*хит|лечит/i.test(s.x || '') && !save, dtype: dmgWord(s.x), act: /бонусн/i.test(s.t || '') ? 'bonus' : /реакц/i.test(s.t || '') ? 'reaction' : 'action',
    // Цели на выбор заклинателя («враги», «существа по вашему выбору») — только для таких заклинаний можно исключать существ
    pick: /враг|(по|на) ваш(ему)? выбор/i.test(s.x || '') };
}
const hasEvasion = (c) => clsLvl(c, 'Плут') >= 7 || clsLvl(c, 'Монах') >= 7;
const ATTACK_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'ability', label: 'Характеристика', type: 'select', options: [...ABILITIES.map((a) => [a.k, a.n]), ['fin', 'Сила или Ловкость (фехтовальное)'], ['spell', 'Заклинательная']] },
  { k: 'hit', label: 'Доп. бонус к попаданию', type: 'number' },
  { k: 'dmg', label: 'Кости урона', ph: '1d8' },
  { k: 'dmgBonus', label: 'Доп. бонус к урону', type: 'number' },
  { k: 'type', label: 'Тип урона', type: 'select', options: DAMAGE_TYPES },
  { k: 'range', label: 'Дистанция', ph: '5 фт / 80/320 фт' },
  { k: 'ammo', label: 'Боеприпасы (начало названия предмета)', ph: 'Стрелы' },
  { k: 'mastery', label: 'Приём оружия (Mastery)', type: 'select', options: Object.entries(MASTERY).map(([k, m]) => [k, m.n]) },
  { k: 'wkind', label: 'Вид оружия (для приёма)', type: 'select', options: [['', '— своё, не из каталога —'], ...WEAPONS.map((w) => [w.n, w.n])] },
  { k: 'item', label: 'Магический предмет (бонус к атаке и урону)', type: 'select', options: [['', '— нет —'], ...(ch().items || []).filter((i) => +i.mAtk).map((i) => [i.id, `${i.n} (+${i.mAtk})`])] },
  { k: 'prof', label: 'Владение (+БМ к попаданию)', type: 'check' },
  { k: 'addMod', label: 'Модификатор к урону', type: 'check' },
  { k: 'ma', label: 'Боевые искусства монаха (кость урона по уровню)', type: 'check', full: true },
  { k: 'x', label: 'Свойства и заметки', type: 'textarea', rows: 3 },
];
const SPELL_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'l', label: 'Уровень', type: 'select', options: [[0, 'Заговор'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [i, i + ' уровень'])] },
  { k: 's', label: 'Школа', type: 'select', options: ['', ...SCHOOLS] },
  { k: 't', label: 'Время накладывания', ph: '1 действие' },
  { k: 'r', label: 'Дистанция' },
  { k: 'c', label: 'Компоненты', ph: 'В, С, М' },
  { k: 'd', label: 'Длительность' },
  { k: 'f', label: 'Бросок (урон/лечение)', ph: '8d6' },
  { k: 'u', label: 'За уровень ячейки выше', ph: '1d6' },
  { k: 'cn', label: 'Концентрация', type: 'check' },
  { k: 'rt', label: 'Ритуал', type: 'check' },
  { k: 'addMod', label: '+ модификатор к броску', type: 'check' },
  { k: 'prep', label: 'Подготовлено', type: 'check' },
  { k: 'always', label: 'Всегда подготовлено (от подкласса, расы, черты — не входит в лимит)', type: 'check', full: true },
  { k: 'x', label: 'Описание', type: 'textarea', rows: 6 },
];
const ITEM_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'cat', label: 'Категория', type: 'select', options: ITEM_CATEGORIES },
  { k: 'qty', label: 'Количество', type: 'number' },
  { k: 'w', label: 'Вес одного, фнт', type: 'number' },
  { k: 'cost', label: 'Цена', ph: '15 зм' },
  { k: 'chMax', label: 'Макс. зарядов (0 — нет)', type: 'number' },
  { k: 'eq', label: 'Экипировано', type: 'check' },
  { k: 'att', label: 'Требует настройки', type: 'check' },
  { k: 'mAtk', label: 'Магия: бонус оружия к атаке и урону', type: 'number' },
  { k: 'mAc', label: 'Магия: бонус к КД', type: 'number' },
  { k: 'mSave', label: 'Магия: бонус к спасброскам', type: 'number' },
  { k: 'mSetK', label: 'Магия: характеристика становится…', type: 'select', options: [['', '—'], ...ABILITIES.map((a) => [a.k, a.n])] },
  { k: 'mSetV', label: '…не ниже', type: 'number' },
  { k: 'heal', label: 'Зелье: лечение (формула)', ph: '2d4+2' },
  { k: 'x', label: 'Описание', type: 'textarea', rows: 5 },
];
// Частые магические предметы (DMG 2024, упрощённо). pick: 'w' — выбрать оружие, 'a' — доспех
const MAGIC_ITEMS = [
  { n: 'Оружие +1', pick: 'w', mAtk: 1, cost: 'необычный' }, { n: 'Оружие +2', pick: 'w', mAtk: 2, cost: 'редкий' }, { n: 'Оружие +3', pick: 'w', mAtk: 3, cost: 'очень редкий' },
  { n: 'Доспех +1', pick: 'a', mAc: 1, cost: 'редкий' }, { n: 'Доспех +2', pick: 'a', mAc: 2, cost: 'очень редкий' }, { n: 'Доспех +3', pick: 'a', mAc: 3, cost: 'легендарный' },
  { n: 'Щит +1', mAc: 1, cat: 'Доспехи', cost: 'необычный', x: 'Прибавляется к обычному щиту (+2).' }, { n: 'Щит +2', mAc: 2, cat: 'Доспехи', cost: 'редкий', x: 'Прибавляется к обычному щиту (+2).' },
  { n: 'Кольцо защиты', mAc: 1, mSave: 1, att: true, cost: 'редкий' },
  { n: 'Плащ защиты', mAc: 1, mSave: 1, att: true, cost: 'необычный' },
  { n: 'Амулет здоровья', mSetK: 'con', mSetV: 19, att: true, cost: 'редкий' },
  { n: 'Рукавицы силы огра', mSetK: 'str', mSetV: 19, att: true, cost: 'необычный' },
  { n: 'Повязка интеллекта', mSetK: 'int', mSetV: 19, att: true, cost: 'необычный' },
  { n: 'Пояс силы холмового великана', mSetK: 'str', mSetV: 21, att: true, cost: 'редкий' },
  { n: 'Зелье лечения', heal: '2d4+2', cat: 'Расходник', cost: '50 зм' },
  { n: 'Зелье большого лечения', heal: '4d4+4', cat: 'Расходник', cost: 'необычный' },
  { n: 'Зелье превосходного лечения', heal: '8d4+8', cat: 'Расходник', cost: 'редкий' },
  { n: 'Зелье высшего лечения', heal: '10d4+20', cat: 'Расходник', cost: 'очень редкий' },
  { n: 'Палочка магических снарядов', chMax: 7, cost: 'необычный', x: 'Тратите 1–3 заряда: «Волшебная стрела» 1–3 уровня. Восстанавливает 1к6+1 зарядов на рассвете.' },
  { n: 'Сумка хранения', cost: 'необычный', x: 'Вмещает до 500 фнт, весит 15 фнт.' },
  { n: 'Сапоги эльфов', cost: 'необычный', x: 'Ваши шаги бесшумны: преимущество на Скрытность, основанную на тишине.' },
  { n: 'Плащ эльфов', att: true, cost: 'необычный', x: 'Капюшон: проверки Мудрости (Внимательность), чтобы заметить вас, с помехой; преимущество на Скрытность.' },
];
// Расширенный каталог (SRD, упрощённо): механика — как у предметов выше, остальное — описанием
MAGIC_ITEMS.push(
  { n: 'Щит +3', mAc: 3, cat: 'Доспехи', cost: 'очень редкий', x: 'Прибавляется к обычному щиту (+2).' },
  { n: 'Зелье лазания', cat: 'Расходник', cost: 'обычный', x: '1 час: скорость лазания равна скорости, преимущество на проверки лазания.' },
  { n: 'Зелье водного дыхания', cat: 'Расходник', cost: 'необычный', x: 'Дышать под водой 1 час.' },
  { n: 'Зелье сопротивления', cat: 'Расходник', cost: 'необычный', x: 'Сопротивление одному виду урона на 1 час (выбирает мастер).' },
  { n: 'Зелье силы холмового великана', cat: 'Расходник', cost: 'необычный', x: 'Сила становится 21 на 1 час.' },
  { n: 'Зелье роста', cat: 'Расходник', cost: 'необычный', x: 'Эффект «Увеличения» на 1к4 часа.' },
  { n: 'Зелье героизма', cat: 'Расходник', cost: 'редкий', x: '10 временных хитов и «Благословение» на 1 час.' },
  { n: 'Зелье невидимости', cat: 'Расходник', cost: 'очень редкий', x: 'Невидимость на 1 час; заканчивается, если атаковать или сотворить заклинание.' },
  { n: 'Зелье ускорения', cat: 'Расходник', cost: 'очень редкий', x: 'Эффект «Ускорения» на 1 минуту без концентрации.' },
  { n: 'Зелье полёта', cat: 'Расходник', cost: 'очень редкий', x: 'Скорость полёта равна скорости на 1 час.' },
  { n: 'Кольцо прыжков', att: true, cost: 'необычный', x: 'Бонусным действием — «Прыжок» на себя.' },
  { n: 'Кольцо хождения по воде', cost: 'необычный', x: 'Ходить по любой жидкости как по твёрдой земле.' },
  { n: 'Кольцо плавания', cost: 'необычный', x: 'Скорость плавания 40 фт.' },
  { n: 'Кольцо сопротивления', att: true, cost: 'редкий', x: 'Сопротивление одному виду урона (по камню кольца).' },
  { n: 'Кольцо свободы действий', att: true, cost: 'редкий', x: 'Трудная местность не замедляет; магия не может парализовать или опутать.' },
  { n: 'Кольцо регенерации', att: true, cost: 'очень редкий', x: '1к6 хитов каждые 10 минут; отращивает утраченные части тела.' },
  { n: 'Кольцо трёх желаний', cost: 'легендарный', chMax: 3, x: 'Три заряда: заклинание «Исполнение желаний».' },
  { n: 'Очки ночного зрения', cost: 'необычный', x: 'Тёмное зрение 60 фт (или +60 фт к имеющемуся).' },
  { n: 'Перчатки ловли снарядов', att: true, cost: 'необычный', x: 'Реакцией уменьшить урон от дальнобойной атаки на 1к10 + Лов.' },
  { n: 'Шлем понимания языков', cost: 'необычный', x: 'Действием — «Понимание языков».' },
  { n: 'Медальон мыслей', att: true, cost: 'необычный', chMax: 5, x: 'Заряд: «Обнаружение мыслей» (СЛ 13).' },
  { n: 'Сапоги ходьбы и прыжков', att: true, cost: 'необычный', x: 'Скорость не ниже 30 фт, прыжки втрое дальше.' },
  { n: 'Колчан Элонны', cost: 'необычный', x: 'Вмещает 60 стрел, 18 метательных копий и 6 длинных предметов.' },
  { n: 'Палочка паутины', att: true, cost: 'необычный', chMax: 7, x: 'Заряд: «Паутина» (СЛ 15).' },
  { n: 'Палочка обнаружения магии', cost: 'необычный', chMax: 3, x: 'Заряд: «Обнаружение магии».' },
  { n: 'Брошь щита', att: true, cost: 'необычный', x: 'Сопротивление урону силовым полем, иммунитет к «Волшебной стреле».' },
  { n: 'Пламенный язык', pick: 'w', att: true, cost: 'редкий', x: 'Бонусным действием клинок вспыхивает: +2к6 урона огнём, свет 40 фт.' },
  { n: 'Плащ смещения', att: true, cost: 'редкий', x: 'Атаки по вам с помехой, пока вы не получите урон.' },
  { n: 'Плащ летучей мыши', att: true, cost: 'редкий', x: 'Полёт 40 фт в темноте, превращение в летучую мышь.' },
  { n: 'Сапоги левитации', att: true, cost: 'редкий', x: '«Левитация» на себя по желанию.' },
  { n: 'Палочка огненных шаров', att: true, cost: 'редкий', chMax: 7, x: 'Заряды: «Огненный шар» 3 ур. (+1 ур. за заряд), СЛ 15.' },
  { n: 'Палочка молний', att: true, cost: 'редкий', chMax: 7, x: 'Заряды: «Молния» 3 ур. (+1 ур. за заряд), СЛ 15.' },
  { n: 'Посох лечения', att: true, cost: 'редкий', chMax: 10, x: 'Заряды: «Лечение ран», «Восстановление», «Массовое лечение ран».' },
  { n: 'Пояс силы ледяного великана', mSetK: 'str', mSetV: 23, att: true, cost: 'очень редкий' },
  { n: 'Танцующий меч', pick: 'w', att: true, cost: 'очень редкий', x: 'Бонусным действием меч летает и атакует сам 4 хода.' },
  { n: 'Плащ невидимости', att: true, cost: 'легендарный', x: 'Капюшон: невидимость, до 2 часов в день.' },
  { n: 'Святой мститель', pick: 'w', mAtk: 3, att: true, cost: 'легендарный', x: 'Только паладин: +3, +2к10 излучением исчадиям и нежити, аура сопротивления магии 10 фт.' },
  { n: 'Вострый меч', pick: 'w', mAtk: 3, att: true, cost: 'легендарный', x: '+3; на 20 по броску атаки отсекает голову.' },
  { n: 'Посох магов', att: true, cost: 'легендарный', chMax: 50, x: '+2 к атакам заклинаниями, поглощение заклинаний, ретрибутивный удар.' },
);
// Редкость — для генератора добычи: из поля «стоимость»; 2024: обычное зелье лечения — обычный предмет
const RARITY = { 'обычный': 0, 'необычный': 1, 'редкий': 2, 'очень редкий': 3, 'легендарный': 4 };
MAGIC_ITEMS.forEach((m) => { m.r = m.n === 'Зелье лечения' ? 0 : RARITY[m.cost] != null ? RARITY[m.cost] : 1; });
// Драгоценные камни и предметы искусства по стоимости (для сокровищ и сундуков)
const GEMS = { 10: ['Азурит', 'Синий кварц', 'Гематит', 'Лазурит', 'Малахит', 'Бирюза'], 50: ['Сердолик', 'Халцедон', 'Цитрин', 'Яшма', 'Лунный камень', 'Оникс'],
  100: ['Янтарь', 'Аметист', 'Гранат', 'Нефрит', 'Жемчуг', 'Турмалин'], 500: ['Александрит', 'Аквамарин', 'Чёрный жемчуг', 'Топаз', 'Шпинель'],
  1000: ['Чёрный опал', 'Изумруд', 'Огненный опал', 'Звёздчатый рубин', 'Голубой сапфир'], 5000: ['Бриллиант', 'Чёрный сапфир', 'Жакинт', 'Рубин'] };
const ART = { 25: ['Серебряный кувшин', 'Резная костяная статуэтка', 'Шёлковая мантия с серебряной нитью', 'Медная чаша с серебряной филигранью'],
  250: ['Золотое кольцо с гелиотропом', 'Резная статуэтка из слоновой кости', 'Бронзовая корона', 'Шёлковый гобелен'],
  750: ['Серебряная чаша с лунными камнями', 'Позолоченный кинжал с жемчугом', 'Нефритовая игральная доска', 'Золотая музыкальная шкатулка'],
  2500: ['Золотая цепь с огненным опалом', 'Старинный шедевр живописи', 'Платиновый браслет с сапфиром', 'Ларец из драгоценных пород дерева'],
  7500: ['Корона с драгоценными камнями', 'Золотая статуэтка с рубинами', 'Платиновое кольцо с бриллиантом', 'Нефритовая статуя божества'] };
// «Длинный меч +1» для оружия и доспехов +N, «Пламенный язык (длинный меч)» для именных
const magicName = (M, baseN) => (!baseN ? M.n : /\+\d/.test(M.n) ? `${baseN} ${M.n.match(/\+\d/)[0]}` : `${M.n} (${baseN.toLowerCase()})`);
function addMagicItem(c, M, base) {
  const it = { id: uid(), cat: M.cat || (M.pick === 'w' ? 'Оружие' : M.pick === 'a' ? 'Доспехи' : 'Магический предмет'), qty: 1, w: base ? base.w : 0, cost: M.cost || '',
    chMax: M.chMax || 0, ch: M.chMax || 0, eq: !M.heal, att: !!M.att, attuned: false, x: M.x || '',
    n: magicName(M, base && base.n), mAtk: M.mAtk || 0, mAc: M.mAc || 0, mSave: M.mSave || 0, mSetK: M.mSetK || '', mSetV: M.mSetV || 0, heal: M.heal || '' };
  if (M.heal) { const same = c.items.find((i) => i.n === it.n); if (same) { same.qty = (+same.qty || 0) + 1; return same; } }
  c.items.push(it);
  // Магическое оружие сразу в атаки (связано с предметом), магический доспех надевается
  if (M.pick === 'w' && base) c.attacks.push({ ...weaponAttack(base), n: it.n, item: it.id });
  if (M.pick === 'a' && base) { c.armor.mode = 'auto'; c.armor.id = base.id; }
  return it;
}
const RES_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'max', label: 'Максимум', type: 'number' },
  { k: 'recharge', label: 'Восстановление', type: 'select', options: Object.entries(RECHARGE) },
  { k: 'autoOn', label: 'Считать максимум автоматически по уровню', type: 'check' },
  { k: 'x', label: 'Описание', type: 'textarea', rows: 4 },
];
const FEAT_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'src', label: 'Источник', ph: 'Класс / Черта / Раса / Предыстория', list: 'dlFeatSrc', full: true },
  { k: 'x', label: 'Описание', type: 'textarea', rows: 8 },
];

function showSpellDb() {
  openModal(`<h2>Справочник заклинаний</h2>
    <div class="row gap wrap"><input id="dbQ" placeholder="Поиск по названию…" style="flex:1"><select id="dbL" style="width:auto"><option value="">Все уровни</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<option value="${l}">${l ? l + ' уровень' : 'Заговоры'}</option>`).join('')}</select>
    <select id="dbC" style="width:auto"><option value="">Все классы</option>${SPELL_CLASSES.map((k) => `<option ${k === ch().info.cls ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
    <div id="dbList" class="db-list"></div><p class="muted small">Справочник содержит популярные заклинания (SRD 5.2). Недостающие можно добавить через «＋ Своё».</p>`);
  modalRefresh = () => {
    const q = $('#dbQ').value.trim().toLowerCase(), l = $('#dbL').value, cl = $('#dbC').value;
    const have = new Set(ch().spells.map((s) => s.n));
    $('#dbList').innerHTML = SPELLS.map((s, i) => [s, i]).filter(([s]) => (!q || (s.n + ' ' + s.e).toLowerCase().includes(q)) && (l === '' || s.l === +l) && (!cl || s.k.includes(cl) || (cl === 'Бард' && clsLvl(ch(), 'Бард') >= 10 && /Жрец|Друид|Волшебник/.test(s.k))))
      .map(([s, i]) => `<div><div class="db-row"><span class="li-title" data-act="toggleOpen" data-id="db${i}">${esc(s.n)} <span class="muted small">${s.l ? s.l + ' ур.' : 'заговор'} · ${esc(s.s)}</span></span>
        ${s.cn ? '<span class="tag c">К</span>' : ''}${s.rt ? '<span class="tag r">Р</span>' : ''}
        <button data-act="addSpellFromDb" data-i="${i}" ${have.has(s.n) ? 'disabled' : ''}>${have.has(s.n) ? '✓' : '＋'}</button></div>
        ${openSet.has('db' + i) ? `<div class="li-desc">${spellMetaHtml(s)}<p>${esc(s.x)}</p></div>` : ''}</div>`).join('') || '<p class="muted">Ничего не найдено</p>';
  };
  ['#dbQ', '#dbL', '#dbC'].forEach((s) => $(s).addEventListener('input', modalRefresh));
  modalRefresh();
  setTimeout(() => $('#dbQ')?.focus(), 30);
}

const ACT = {
  portraitPick() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => { if (inp.files[0]) portraitCrop(inp.files[0]); };
    inp.click();
  },
  portraitDel() { const c = ch(); if (!c.info.portrait || !confirmBox('Убрать портрет?')) return; c.info.portrait = ''; c.updatedAt = Date.now(); save(); render(); },
  newChar() { openWizard('new'); },
  newBlank() { closeModal(); const c = blankChar(); state.chars[c.id] = c; state.current = c.id; openSet.clear(); switchTab('main'); toast('Создан новый персонаж'); },
  originWizard() { openWizard('origin'); },
  wizNext() { if (!wizError(W.step)) { W.step = Math.min(wizLast(), W.step + 1); renderWizard(); } },
  wizPrev() { W.step = Math.max(0, W.step - 1); renderWizard(); },
  wizGo(el) { const i = +el.dataset.i; if (i <= W.step) { W.step = i; renderWizard(); } },
  wizFinish() { wizFinish(); },
  dupChar() { const c = JSON.parse(JSON.stringify(ch())); c.id = uid(); c.info.name += ' (копия)'; state.chars[c.id] = c; state.current = c.id; toast('Создана копия'); },
  deleteChar() {
    const c = ch();
    if (!confirmBox(`Удалить персонажа «${c.info.name}»? Это действие нельзя отменить. Рекомендуем сначала сделать экспорт.`)) return;
    delete state.chars[c.id];
    if (window.dndSync) window.dndSync.remove(c.id);
    if (!Object.keys(state.chars).length) { const n = blankChar(); state.chars[n.id] = n; }
    state.current = Object.keys(state.chars)[0];
  },
  exportChar() {
    const c = ch();
    const blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(c.info.name || 'character').replace(/[\\/:*?"<>|]+/g, '_')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  importChar() { $('#importFile').click(); },
  damage() { const n = hpAmount(); if (!n) return $('#hpAmount').focus(); applyDamage(n); $('#hpAmount').value = ''; },
  heal() { const n = hpAmount(); if (!n) return $('#hpAmount').focus(); applyHeal(n); toast(`Восстановлено ${n} хитов`, 'crit'); $('#hpAmount').value = ''; },
  tempHp() {
    const n = hpAmount(); if (!n) return $('#hpAmount').focus();
    const cb = ch().combat;
    if (n > cb.temp) { cb.temp = n; toast(`Временные хиты: ${n}`); } else toast('Временные хиты не суммируются — оставлено большее значение');
    $('#hpAmount').value = '';
  },
  rollInit() {
    const c = ch();
    rollD20('Инициатива', initBonus(c), { kind: 'init', abil: 'dex' });
  },
  toggleInsp() { const cb = ch().combat; cb.inspiration = !cb.inspiration; toast(cb.inspiration ? '★ Получено героическое вдохновение' : 'Вдохновение потрачено — перебросьте кость'); },
  bardicGet(el) {
    const c = ch(), d = +el.dataset.d;
    addEffect(c, { n: 'Вдохновение барда', left: 600, conc: false, bardic: true, die: d, x: `Кость к${d}: добавьте к проваленному к20-тесту в течение часа.` });
    toast(`🎵 Получена кость вдохновения барда к${d}`, 'crit');
  },
  bardicUse() {
    const c = ch(), b = bardicHeld(c);
    if (!b) return;
    const r = rollDice('Вдохновение барда — добавьте к броску', `1d${b.die}`);
    c.effects = c.effects.filter((e) => e !== b);
    if (r) toast(`🎵 +${r.total} к проваленному броску`);
  },
  bardicDrop() { const c = ch(); c.effects = c.effects.filter((e) => !e.bardic); },
  shortRest() {
    openModal(`<h2>☕ Короткий отдых</h2><p>Хиты: <b id="srHp"></b></p>
      <p class="muted small">Потратить кость хитов (бросок + мод. Телосложения):</p><div id="srHd" class="row gap wrap"></div>
      <p class="muted small">По завершении восстановятся ячейки Магии договора и все ресурсы с восстановлением «короткий отдых» (Ци, Всплеск действий, Второе дыхание, Божественный канал…).</p>
      <div class="modal-actions"><button data-act="closeModal">Отмена</button><button class="primary" data-act="finishShortRest">Завершить отдых</button></div>`);
    updateShortRestInfo();
  },
  finishShortRest() {
    const c = ch();
    c.pact.used = 0;
    c.resources.forEach((r) => { if (r.recharge === 'short') r.used = 0; });
    advanceEffects(c, 600); // прошёл час
    closeModal(); toast('☕ Короткий отдых завершён');
  },
  longRest() {
    if (!confirmBox('Завершить долгий отдых? Восстановятся хиты, все кости хитов, ячейки и ресурсы; истощение уменьшится на 1.')) return;
    doLongRest(ch());
  },
  applyClass() {
    const c = ch(), name = c.info.cls.trim();
    if (!CLASSES[name]) { toast('Выберите класс из списка (поле «Класс»)'); return; }
    if (!confirmBox(`Применить шаблон класса «${name}» заново? Будут заданы кость хитов, спасброски, заклинательная характеристика и тип заклинателя.`)) return;
    applyClassTemplate(c);
    toast(`Шаблон «${name}» применён`);
  },
  calcHp() {
    // 1 уровень основного класса — максимум кости, остальные уровни — среднее кости своего класса
    const c = ch(), con = am(c, 'con'), L = lvl(c), extra = hpPerLevelBonus(c), hd = +c.combat.hdDie;
    const avg = (d) => Math.max(1, d / 2 + 1 + con);
    const max = Math.max(1, classList(c).reduce((s, e) => s + (e.primary ? hd + con + (e.lvl - 1) * avg(hd) : e.lvl * avg(hdOf(c, e))), 0) + extra * L);
    const how = classList(c).map((e) => `${e.cls || 'класс'} к${hdOf(c, e)}×${e.lvl}`).join(', ');
    if (!confirmBox(`Установить максимум хитов = ${max}? (${how}: максимум кости на 1 уровне, дальше среднее; мод. Тел ${fmt(con)}${extra ? `, +${extra} за уровень от расы/черты` : ''})`)) return;
    if (c.combat.hp >= c.combat.hpMax) c.combat.hp = max;
    c.combat.hpMax = max;
    c.combat.hpRolled = max - hpPart(c);
    c.combat.hp = Math.min(c.combat.hp, max);
  },
  rollCheck(el) { const a = ABILITIES.find((x) => x.k === el.dataset.k); rollD20(`Проверка: ${a.n}`, am(ch(), a.k), { kind: 'check', abil: a.k }); },
  rollSave(el) { const a = ABILITIES.find((x) => x.k === el.dataset.k); rollD20(`Спасбросок: ${a.n}`, saveBonus(ch(), a.k), { kind: 'save', abil: a.k }); },
  rollSkill(el) {
    const c = ch(), s = SKILLS.find((x) => x.k === el.dataset.k);
    rollD20(s.n, skillBonus(c, s), { kind: 'check', abil: s.a, skill: s.k, floor10: clsLvl(c, 'Плут') >= 7 && (c.skills[s.k] || 0) > 0 });
  },
  skillProf(el) {
    const c = ch(), k = el.dataset.k, nv = ((c.skills[k] || 0) + 1) % 3;
    // Компетентность — не больше, чем дают класс и черты
    if (nv === 2 && expertiseCount(c) >= expertiseLimit(c)) { c.skills[k] = 0; toast(`Компетентность исчерпана: ${expertiseLimit(c)} по классу и чертам`); return; }
    c.skills[k] = nv;
  },
  cpick(el) { openClassPick(el.dataset.k); },
  skillInfo(el) {
    const s = SKILLS.find((x) => x.k === el.dataset.k), a = ABILITIES.find((x) => x.k === s.a);
    openModal(`<h2>${s.n}</h2><p class="muted">Характеристика: ${a.n}</p><p>${esc(s.d)}</p><div class="modal-actions"><button data-act="rollSkill" data-k="${s.k}">🎲 Бросить ${fmt(skillBonus(ch(), s))}</button><button data-act="closeModal">Закрыть</button></div>`);
  },
  spendHd(el) { spendHitDie(el.dataset.die); },
  deathSave() { doDeathSave(ch()); },
  deathPip(el) { const cb = ch().combat, key = el.dataset.type === 'S' ? 'deathS' : 'deathF', i = +el.dataset.i; cb[key] = cb[key] === i + 1 ? i : i + 1; },
  deathReset() { const cb = ch().combat; cb.deathS = 0; cb.deathF = 0; },
  exh(el) { ch().combat.exhaustion = +el.dataset.v; },
  dropConc() { if (ch().combat.conc) toast(`Концентрация на «${esc(ch().combat.conc)}» прервана`); endConc(ch()); pendingConc = 0; },
  concSave() {
    const c = ch(), dc = pendingConc || 10;
    const r = rollD20(`Концентрация (СЛ ${dc})`, saveBonus(c, 'con'), { dc, kind: 'save', abil: 'con', conc: true });
    if (r.total < dc && c.combat.conc) { toast(`Концентрация на «${esc(c.combat.conc)}» потеряна`, 'fumble'); endConc(c); }
    pendingConc = 0;
  },
  cond(el) { const cb = ch().combat, k = el.dataset.k; cb.conditions = cb.conditions.includes(k) ? cb.conditions.filter((x) => x !== k) : [...cb.conditions, k]; },
  condInfo(el) {
    const k = el.dataset.k;
    const d = k === 'exhaustion' ? { n: 'Истощение', d: EXHAUSTION_TEXT } : CONDITIONS.find((x) => x.k === k);
    openModal(`<h2>${d.n}</h2><p>${esc(d.d)}</p><div class="modal-actions"><button data-act="closeModal">Закрыть</button></div>`);
  },
  masteryInfo(el) { const m = MASTERY[el.dataset.k]; openModal(`<h2>Приём: ${m.n}</h2><p>${esc(m.d)}</p><div class="modal-actions"><button data-act="closeModal">Закрыть</button></div>`); },
  addAttack() {
    formModal('Новая атака', ATTACK_FIELDS(), { ability: 'str', prof: true, addMod: true, dmg: '1d8', type: 'рубящий', range: '5 фт', mastery: '' },
      (v) => ch().attacks.push({ id: uid(), ...v }));
  },
  editAttack(el) { const a = findById(ch().attacks, el.dataset.id); formModal('Изменить атаку', ATTACK_FIELDS(), a, (v) => Object.assign(a, v)); },
  delAttack(el) { const c = ch(), a = findById(c.attacks, el.dataset.id); if (confirmBox(`Удалить атаку «${a.n}»?`)) c.attacks = c.attacks.filter((x) => x !== a); },
  atkRoll(el) {
    const c = ch(), a = findById(c.attacks, el.dataset.id);
    if (!spendAmmo(c, a)) return;
    rollD20(`Атака: ${a.n}`, attackBonus(c, a), { attack: true, kind: 'attack', weapon: a.ability !== 'spell' });
    ammoWarn(c, a);
  },
  // После боя можно найти половину потраченных боеприпасов (округление вниз)
  shapePick() {
    const c = ch(), L = wildLimit(c);
    if (!L) return;
    beastPicker('Дикий облик', BEASTS().filter((m) => crNum(m.cr) <= L.cr && (L.fly || !/полёт/.test(m.speed))), (m) => startShape(c, m));
  },
  shapeEnd() { endShape(ch()); },
  beastRoll(el) { const a = ch().shape.atk[+el.dataset.i]; rollD20(`${ch().shape.n}: ${a.n}`, a.hit, { attack: true, kind: 'attack' }); },
  beastDmg(el) { const a = ch().shape.atk[+el.dataset.i], crit = !!el.dataset.crit; rollDice(`${crit ? 'КРИТ ' : ''}${ch().shape.n}: ${a.n}`, crit ? scaleDice(a.dmg, 2) : a.dmg); },
  compAdd() {
    beastPicker('Новый спутник', BEASTS(), (m, nm) => {
      const c = ch(), hp = (() => { let t = 0; String(m.hp).replace(/(\d+)d(\d+)|([+-]\d+)/g, (_, n, s, k) => { t += k ? +k : (+n * (+s + 1)) / 2; return ''; }); return Math.max(1, Math.floor(t)); })();
      (c.companions = c.companions || []).push({ id: uid(), n: nm || m.n, kind: m.n, ac: m.ac, speed: m.speed, hp, hpMax: hp, atk: beastAtk(m) });
    }, true);
  },
  compHp(el) { const p = findById(ch().companions || [], el.dataset.id); p.hp = clamp(p.hp + +el.dataset.d, 0, p.hpMax); },
  compRoll(el) {
    const p = findById(ch().companions || [], el.dataset.id), a = p.atk[+el.dataset.i];
    rollD20(`${p.n}: ${a.n}`, a.hit, { attack: true, kind: 'attack' });
    if (a.dmg) rollDice(`${p.n}: урон`, a.dmg);
  },
  compDel(el) { const c = ch(), p = findById(c.companions || [], el.dataset.id); if (confirmBox(`Убрать «${p.n}»?`)) c.companions = c.companions.filter((x) => x !== p); },
  recoverAmmo() {
    const c = ch(), spent = c.combat.ammoSpent || {}, got = [];
    Object.entries(spent).forEach(([id, n]) => {
      const it = findById(c.items, id), back = Math.floor(n / 2);
      if (it && back) { it.qty = (+it.qty || 0) + back; got.push(`${it.n}: +${back}`); }
    });
    c.combat.ammoSpent = {};
    toast(got.length ? `🏹 Собрано: ${esc(got.join(', '))}` : 'Нечего собирать');
  },
  dmgRoll(el) { const c = ch(), a = findById(c.attacks, el.dataset.id), crit = !!el.dataset.crit; rollDice(`${crit ? 'КРИТ ' : ''}Урон: ${a.n} (${a.type})`, dmgExpr(c, a, crit)); },
  spellAttack() { rollD20('Атака заклинанием', spellAtk(ch()), { attack: true, kind: 'attack' }); },
  slotPip(el) { const s = ch().slots[+el.dataset.l]; s.used = clamp(s.used + (el.dataset.u === '1' ? -1 : 1), 0, s.max); },
  pactPip(el) { const p = ch().pact; p.used = clamp(p.used + (el.dataset.u === '1' ? -1 : 1), 0, p.max); },
  addSpellDb() { showSpellDb(); },
  addSpellFromDb(el) { addSpell(SPELLS[+el.dataset.i]); save(); if (modalRefresh) modalRefresh(); renderRef(); },
  addSpellCustom() {
    formModal('Своё заклинание', SPELL_FIELDS(), { l: 1, t: '1 действие', prep: true }, (v) => { v.l = +v.l; ch().spells.push({ id: uid(), ...v }); });
  },
  editSpell(el) { const s = findById(ch().spells, el.dataset.id); formModal('Изменить заклинание', SPELL_FIELDS(), s, (v) => { Object.assign(s, v); s.l = +s.l; }); },
  delSpell(el) { const c = ch(), s = findById(c.spells, el.dataset.id); if (confirmBox(`Удалить заклинание «${s.n}»?`)) c.spells = c.spells.filter((x) => x !== s); },
  togglePrep(el) {
    const c = ch(), s = findById(c.spells, el.dataset.id);
    s.prep = !s.prep;
    const lim = spellLimits(c).prep;
    if (s.prep && lim != null && spellCounts(c).prep > lim) toast(`⚠ Подготовлено больше, чем позволяют правила (${lim}). Снимите галочку с другого заклинания.`, 'fumble');
  },
  castSpell(el) {
    const c = ch(), s = findById(c.spells, el.dataset.id);
    if (+s.l === 0) { doCast(s, 0); return; }
    let btns = '';
    c.slots.forEach((sl, i) => {
      if (i + 1 < s.l || !sl.max) return;
      const left = sl.max - sl.used;
      btns += `<button data-act="castWith" data-id="${s.id}" data-slot="${i}" ${left ? '' : 'disabled'}>${i + 1} уровень <span class="muted small">(${left}/${sl.max})</span></button>`;
    });
    if (c.pact.max && c.pact.level >= s.l) { const left = c.pact.max - c.pact.used; btns += `<button data-act="castWith" data-id="${s.id}" data-slot="pact" ${left ? '' : 'disabled'}>Договор ${c.pact.level} ур. <span class="muted small">(${left}/${c.pact.max})</span></button>`; }
    if (s.rt) btns += `<button data-act="castWith" data-id="${s.id}" data-slot="ritual">📜 Как ритуал (+10 мин)</button>`;
    btns += `<button data-act="castWith" data-id="${s.id}" data-slot="free">Без ячейки (умение/предмет)</button>`;
    openModal(`<h2>Сотворить: ${esc(s.n)}</h2>${spellMetaHtml(s)}<p class="muted small">Выберите ячейку. ${s.u ? 'При ячейке выше уровня заклинания бросок усилится автоматически.' : ''}</p><div class="slot-choice">${btns}</div>`);
  },
  castWith(el) {
    const c = ch(), s = findById(c.spells, el.dataset.id);
    const { castLvl, how } = spendSlot(c, s, el.dataset.slot);
    closeModal();
    doCast(s, castLvl, how);
  },
  addItem() { formModal('Новый предмет', ITEM_FIELDS(), { cat: 'Снаряжение', qty: 1, w: 0, chMax: 0 }, (v) => ch().items.push({ id: uid(), ...v, ch: v.chMax, attuned: false })); },
  editItem(el) { const i = findById(ch().items, el.dataset.id); formModal('Изменить предмет', ITEM_FIELDS(), i, (v) => { Object.assign(i, v); i.ch = clamp(+i.ch || 0, 0, +i.chMax || 0); if (!i.att) i.attuned = false; }); },
  delItem(el) { const c = ch(), i = findById(c.items, el.dataset.id); if (confirmBox(`Удалить «${i.n}»?`)) c.items = c.items.filter((x) => x !== i); },
  qty(el) {
    const c = ch(), i = findById(c.items, el.dataset.id);
    i.qty = Math.max(0, (+i.qty || 0) + +el.dataset.d);
    if (i.qty === 0 && i.cat === 'Расходник' && confirmBox(`«${i.n}» закончился. Удалить из инвентаря?`)) c.items = c.items.filter((x) => x !== i);
  },
  charge(el) { const i = findById(ch().items, el.dataset.id); i.ch = clamp((+i.ch || 0) + +el.dataset.d, 0, +i.chMax); },
  toggleEquip(el) { const i = findById(ch().items, el.dataset.id); i.eq = !i.eq; },
  toggleAttune(el) {
    const c = ch(), i = findById(c.items, el.dataset.id);
    if (!i.attuned && c.items.filter((x) => x.attuned).length >= 3) { toast('Нельзя настроиться больше чем на 3 предмета'); return; }
    i.attuned = !i.attuned;
  },
  addResource() { formModal('Свой ресурс', RES_FIELDS().filter((f) => f.k !== 'autoOn'), { max: 3, recharge: 'long' }, (v) => ch().resources.push({ id: uid(), ...v, used: 0, auto: '' })); },
  editRes(el) {
    const r = findById(ch().resources, el.dataset.id);
    const fields = RES_FIELDS().filter((f) => f.k !== 'autoOn' || r.auto || r.autoWas);
    formModal('Изменить ресурс', fields, { ...r, autoOn: !!r.auto }, (v) => {
      const auto = r.auto || r.autoWas;
      Object.assign(r, { n: v.n, max: v.max, recharge: v.recharge, x: v.x });
      if ('autoOn' in v) { r.autoWas = auto; r.auto = v.autoOn ? auto : ''; }
    });
  },
  delRes(el) { const c = ch(), r = findById(c.resources, el.dataset.id); if (confirmBox(`Удалить ресурс «${r.n}»?`)) c.resources = c.resources.filter((x) => x !== r); },
  resPip(el) { const r = findById(ch().resources, el.dataset.id); r.used = clamp(r.used + (el.dataset.u === '1' ? -1 : 1), 0, r.max); },
  resUse(el) {
    const r = findById(ch().resources, el.dataset.id);
    let n = 1;
    if (el.dataset.amt) { const inp = el.closest('.res').querySelector('.resAmt'); n = parseInt(inp.value) || 0; if (!n) { inp.focus(); return; } }
    const d = +el.dataset.d * n;
    if (d > 0 && r.max - r.used < d) { toast(`Недостаточно: осталось ${r.max - r.used}`); return; }
    r.used = clamp(r.used + d, 0, r.max);
  },
  resReset(el) { findById(ch().resources, el.dataset.id).used = 0; },
  addFeature() { formModal('Новое умение', FEAT_FIELDS(), {}, (v) => ch().features.push({ id: uid(), ...v })); },
  editFeature(el) { const f = findById(ch().features, el.dataset.id); formModal('Изменить умение', FEAT_FIELDS(), f, (v) => Object.assign(f, v)); },
  delFeature(el) { const c = ch(), f = findById(c.features, el.dataset.id); if (confirmBox(`Удалить «${f.n}»?`)) c.features = c.features.filter((x) => x !== f); },
  rageToggle() {
    const c = ch();
    if (raging(c)) { c.effects = c.effects.filter((e) => e.n !== 'Ярость'); toast('Ярость закончилась'); return; }
    const r = c.resources.find((x) => x.auto === 'rage');
    if (r && r.max - r.used <= 0) { toast('Нет использований Ярости — нужен отдых'); return; }
    if (r) r.used++;
    if (heavyArmor(c)) toast('⚠ В тяжёлом доспехе Ярость не даёт преимуществ', 'fumble');
    if (c.combat.conc) { toast(`Концентрация на «${esc(c.combat.conc)}» прервана: в ярости нельзя концентрироваться`); endConc(c); }
    addEffect(c, { n: 'Ярость', left: 100, conc: false, x: `Сопротивление дробящему, колющему и рубящему урону; преимущество на проверки и спасброски Силы; +${rageDmg(c)} к урону атак Силой; нельзя творить заклинания и концентрироваться. Длится до конца вашего следующего хода, продлевается атакой, вынужденным спасброском или бонусным действием; максимум 10 минут.` });
    toast(`🔥 Ярость! +${rageDmg(c)} к урону атак Силой`, 'crit');
  },
  sneak(el) { const n = Math.ceil(clsLvl(ch(), 'Плут') / 2) * (el.dataset.crit ? 2 : 1); rollDice(`${el.dataset.crit ? 'КРИТ ' : ''}Скрытая атака`, `${n}d6`); },
  secondWind() {
    const c = ch(), r = c.resources.find((x) => x.auto === 'secondWind');
    if (r && r.max - r.used <= 0) { toast('Второе дыхание исчерпано — нужен отдых'); return; }
    if (r) r.used++;
    const res = rollDice('Второе дыхание', `1d10+${clsLvl(c, 'Воин') || lvl(c)}`);
    if (res) applyHeal(res.total);
  },
  bardDie(el) { rollDice('Кость вдохновения барда', `1d${el.dataset.d}`); },
  radiantStrike() { rollDice('Сияющие удары (излучение)', '1d8'); },
  profDel(el) { const c = ch(), k = el.dataset.k; c.profs[k] = c.profs[k].filter((v) => v !== el.dataset.v); },
  profInv(el) { if (addToolItem(ch(), el.dataset.v)) toast(`🎒 ${esc(el.dataset.v)} в инвентаре`); },
  pickDrop(el) { const c = ch(); c.profPicks = c.profPicks.filter((p) => p.id !== el.dataset.id); },
  addFeat() { openFeatAdd(); },
  featSpells(el) { openFeatSpells(findById(ch().feats, el.dataset.id)); },
  featSpellsSave() {
    const c = ch(), f = findById(c.feats, featSp.featId);
    f.spells = [...featSp.chosen];
    if (FEAT_SPELLS[f.key].lists) f.list = featSp.list;
    closeModal();
    toast(`✨ Заклинания черты «${esc(FEATS_BY[f.key].n)}» выбраны — они всегда подготовлены`);
  },
  masteryPick() { openMasteryPick(); },
  masteryAdd(el) {
    const c = ch(), w = el.dataset.w;
    if (c.masteries.includes(w) || c.masteries.length >= masteryLimit(c)) return;
    c.masteries.push(w);
    renderMasteryPick();
  },
  masteryDel(el) { const c = ch(); c.masteries = c.masteries.filter((x) => x !== el.dataset.w); if ($('#mstBody')) renderMasteryPick(); },
  featAddApply() {
    const c = ch(), S = featAdd, p = S.picks[S.slot];
    if (!pickValid(p) || featFree(c, S.slot) <= 0) return;
    addFeat(c, S.slot, p, lvl(c));
    toast(`Черта «${esc(FEATS_BY[p.key].n)}» добавлена`);
    closeModal();
  },
  delFeat(el) {
    const c = ch(), f = findById(c.feats, el.dataset.id), d = FEATS_BY[f.key];
    if (!confirmBox(`Убрать черту «${d ? d.n : f.key}»? Её эффекты (прибавки к характеристикам и т.п.) будут сняты.`)) return;
    featHp(c, f.key, -1);
    c.feats = c.feats.filter((x) => x !== f);
  },
  addMulti() {
    const c = ch();
    if (lvl(c) >= 20) { toast('Общий уровень уже 20'); return; }
    c.multi.push({ id: uid(), cls: '', sub: '', lvl: 1 });
  },
  delMulti(el) {
    const c = ch(), m = c.multi.find((x) => x.id === el.dataset.id);
    if (!confirmBox(`Убрать класс «${m.cls || 'без названия'}» (${m.lvl} ур.) из мультикласса?`)) return;
    c.multi = c.multi.filter((x) => x !== m);
  },
  undo() { undo(); },
  levelUp() { openLevelUp(); },
  lvlRoll() { const c = ch(), hd = lvlTarget(c, lvlState).hd; lvlState.roll = die(hd); logRoll('Хиты за уровень', lvlState.roll, `к${hd} [${lvlState.roll}]`); renderLevelUp(); },
  lvlApply() {
    const c = ch(), S = lvlState, N = lvl(c) + 1, gain = lvlGain(c), T = lvlTarget(c, S), CN = T.lvl + 1;
    if (gain == null || N > 20 || !T.cls && S.target === 'new') return;
    if (lvlNeedsSub(T) && !S.sub) { toast('Выберите подкласс'); return; }
    const feats = T.cls ? featuresAt(T.cls, S.sub || T.sub, CN) : [];
    if (!S.slots.every((k) => pickValid(S.picks[k]))) return;
    // Одна и та же неповторяемая черта не может быть выбрана в двух ячейках
    const keys = S.slots.map((k) => S.picks[k].key);
    if (keys.some((k, i) => keys.indexOf(k) !== i && !FEATS_BY[k].rep)) { toast('Одну черту нельзя взять дважды'); return; }
    if (S.target === 'new') {
      const bad = [S.newCls, ...classList(c).map((e) => e.cls)].filter((n) => n && !mcOk(c, n));
      if (bad.length && !confirmBox(`Требования мультикласса не выполнены (${bad.map((n) => `${n}: ${mcReqText(n)}`).join('; ')}). Всё равно взять класс «${S.newCls}» (с разрешения Мастера)?`)) return;
    }
    // Хиты за уровень: в основу идёт только кость, модификаторы досчитает syncHpMax (с учётом нового Тел)
    syncHpMax(c);
    const dieGain = gain - hpPerLvl(c);
    applyAdvance(c, S);
    c.combat.hpRolled = (+c.combat.hpRolled || 0) + dieGain;
    const notes = [`+${gain} хитов`];
    S.slots.forEach((k) => {
      const p = S.picks[k];
      addFeat(c, k, p, N);
      const eff = featEffectText(c.feats[c.feats.length - 1]);
      notes.push(`${FEATS_BY[p.key].n}${eff ? ` (${eff})` : ''}`);
    });
    const src = `${T.cls} ${CN}`;
    const scNow = subclassOf(T.cls, S.sub || T.sub);
    const subNames = new Set(scNow ? (scNow.f[CN] || []).map(([n]) => n) : []);
    feats.forEach((f, i) => {
      if (S.skip.has(i)) return;
      // Умения подкласса добавляет autoSubclassFeatures (с привязкой к подклассу)
      if (subNames.has(f)) return;
      if (!c.features.some((x) => x.n === f && x.src === src)) c.features.push({ id: uid(), n: f, src, x: featureDesc(T.cls, f) });
    });
    if (T.cls === 'Бард' && CN >= 2) c.combat.jack = true;
    // Следопыт 2 ур. «Искусный исследователь»: два языка на выбор
    if (T.cls === 'Следопыт' && CN === 2) addPick(c, 'lang', ['standard', 'rare'], 2, 'Искусный исследователь');
    const cap = CN === 20 && CAPSTONE[T.cls];
    if (cap) notes.push(`${cap[0]}: +4`);
    closeModal();
    toast(`⬆ ${T.cls ? `${esc(T.cls)} ${CN}` : ''} · общий ${N} уровень! ${notes.join(' · ')}`, 'crit');
  },
  openCatalog(el) { openCatalog(el.dataset.t); },
  catTab(el) { catTab = el.dataset.t; renderCatalog(); },
  catWeapon(el) {
    const c = ch(), w = WEAPONS[+el.dataset.i];
    if (el.dataset.to === 'atk') {
      c.attacks.push(weaponAttack(w));
      // Есть свободный приём оружия — изучить приём этого вида сразу
      const learn = !c.masteries.includes(w.n) && c.masteries.length < masteryLimit(c);
      if (learn) c.masteries.push(w.n);
      toast(`⚔ ${esc(w.n)} добавлен в атаки${learn ? ` · изучен приём «${MASTERY[w.m].n}»` : ''}`);
    }
    else { addInvItem(c, { n: w.n, cat: 'Оружие', w: w.w, cost: w.cost, x: `${w.dmg} ${w.type}. ${w.props}. Приём: ${MASTERY[w.m].n}.` }); toast(`🎒 ${esc(w.n)} в инвентаре`); }
    renderCatalog();
  },
  catArmor(el) {
    const c = ch(), a = ARMOR.find((x) => x.id === el.dataset.id);
    const it = addInvItem(c, { n: a.n, cat: 'Доспех', w: a.w, cost: a.cost, x: `КД ${a.ac}${a.type === 'light' ? ' + Лов' : a.type === 'medium' ? ' + Лов (макс. 2)' : ''}. ${ARMOR_TYPES[a.type]} доспех.${a.str ? ` Сила ${a.str}.` : ''}${a.stealth ? ' Помеха Скрытности.' : ''}` });
    if (el.dataset.to === 'inv') { toast(`🎒 ${esc(a.n)} в инвентаре`); renderCatalog(); return; }
    c.items.forEach((x) => { if (x.cat === 'Доспех' && x !== it) x.eq = false; });
    it.eq = true;
    Object.assign(c.armor, { mode: 'auto', id: a.id, unarmored: '' });
    toast(`🛡 Надет: ${esc(a.n)} — КД ${computeAC(c).ac}`);
    renderCatalog();
  },
  catShield() {
    const c = ch();
    addInvItem(c, { n: SHIELD.n, cat: 'Доспех', w: SHIELD.w, cost: SHIELD.cost, x: '+2 к КД.' }).eq = true;
    c.armor.shield = true;
    if (c.armor.mode !== 'auto') { c.armor.mode = 'auto'; }
    toast(`🛡 Щит в руке — КД ${computeAC(c).ac}`);
    renderCatalog();
  },
  catMagic(el) {
    const c = ch(), M = MAGIC_ITEMS[+el.dataset.i], sel = $(`[data-mpick="${el.dataset.i}"]`);
    let base = null;
    if (M.pick) {
      if (!sel || !sel.value) { toast(`Выберите ${M.pick === 'w' ? 'оружие' : 'доспех'} в списке рядом`); return; }
      base = M.pick === 'w' ? WEAPONS[+sel.value] : ARMOR.find((a) => a.id === sel.value);
    }
    const it = addMagicItem(c, M, base);
    toast(`✨ ${esc(it.n)} добавлен${M.att ? ' — не забудьте настроиться (✦)' : ''}`);
  },
  drink(el) {
    const c = ch(), i = findById(c.items, el.dataset.id), r = rollDice(`🧪 ${i.n}`, i.heal);
    if (!r) return;
    applyHeal(Math.max(0, r.total));
    i.qty = Math.max(0, (+i.qty || 0) - 1);
    toast(`🧪 ${esc(i.n)}: +${r.total} хитов`, 'crit');
  },
  catGear(el) {
    const g = GEAR[+el.dataset.i];
    addInvItem(ch(), { n: g.n, cat: g.cat, w: g.w, cost: g.cost, x: g.x, qty: g.qty || 1, chMax: g.ch || 0, ch: g.ch || 0 });
    toast(`🎒 ${esc(g.n)} добавлено`);
  },
  nextRound() { const c = ch(); c.combat.round = (+c.combat.round || 1) + 1; advanceEffects(c, 1); },
  passMinute() { advanceEffects(ch(), 10); toast('Прошла 1 минута (10 раундов)'); },
  roundReset() { ch().combat.round = 1; toast('Новый бой: раунд 1'); },
  addEffect() {
    formModal('Новый эффект', [
      { k: 'n', label: 'Название', full: true, ph: 'Благословение, Ярость, Ускорение…' },
      { k: 'num', label: 'Длительность', type: 'number' },
      { k: 'unit', label: 'Единицы', type: 'select', options: [['1', 'раунды'], ['10', 'минуты'], ['600', 'часы']] },
      { k: 'conc', label: 'Концентрация', type: 'check' },
      { k: 'x', label: 'Заметка', type: 'textarea', rows: 2 },
    ], { num: 1, unit: '10' }, (v) => {
      const c = ch(), left = Math.max(1, Math.round((+v.num || 1) * +v.unit));
      if (v.conc) { endConc(c); c.combat.conc = v.n; }
      addEffect(c, { n: v.n, left, conc: v.conc, x: v.x });
    });
  },
  effAdj(el) { const e = findById(ch().effects, el.dataset.id); e.left = Math.max(1, e.left + +el.dataset.d); e.total = Math.max(e.total, e.left); },
  delEffect(el) {
    const c = ch(), e = findById(c.effects, el.dataset.id);
    if (e.conc && c.combat.conc === e.n) c.combat.conc = '';
    c.effects = c.effects.filter((x) => x !== e);
  },
  abilGen() { openAbilGen(); },
  abilEdit() {
    const c = ch();
    abilEdit = !abilEdit;
    // Закончили правку — характеристики считаются заданными, «Генерация» больше не нужна
    if (!abilEdit && Object.values(c.abil).some((v) => +v !== 10)) c.abilSet = true;
    if (abilEdit) setTimeout(() => $('#abilGrid .abase input')?.focus(), 30);
  },
  genMode(el) { gen.mode = el.dataset.mode; renderGen(); },
  genPb(el) {
    const k = el.dataset.k, v = gen.pb[k] + +el.dataset.d;
    if (v < 8 || v > 15 || pbSpent() - PB_COST[gen.pb[k]] + PB_COST[v] > PB_POOL) return;
    gen.pb[k] = v; renderGen();
  },
  genRoll() {
    gen.rolls = ABILITIES.map(() => {
      const dice = Array.from({ length: 4 }, () => die(6));
      const drop = dice.indexOf(Math.min(...dice));
      return { dice, drop, total: dice.reduce((a, b) => a + b, 0) - dice[drop] };
    });
    gen.roll = perAbil(null);
    const totals = gen.rolls.map((r) => r.total);
    logRoll('Характеристики 4d6 (сумма)', totals.reduce((a, b) => a + b, 0), totals.join(', '));
    renderGen();
  },
  genReset() {
    if (gen.mode === 'standard') gen.std = perAbil(null);
    else if (gen.mode === 'pointbuy') gen.pb = perAbil(8);
    else gen.roll = perAbil(null);
    gen.bonus = perAbil(0);
    renderGen();
  },
  genApply() {
    const c = ch();
    if (ABILITIES.some((a) => genBase(a.k) == null)) return;
    const hasBg = Object.keys(c.bgAbil || {}).length > 0;
    const vals = Object.fromEntries(ABILITIES.map((a) => [a.k, Math.min(20, genBase(a.k) + (hasBg ? 0 : +gen.bonus[a.k] || 0))]));
    if (!confirmBox(`Заменить характеристики персонажа?\n${ABILITIES.map((a) => `${a.s} ${vals[a.k]}`).join(' · ')}`)) return;
    Object.assign(c.abil, vals);
    c.abilSet = true;
    closeModal(); toast('Характеристики применены');
  },
  toggleOpen(el) { const id = el.dataset.id; openSet.has(id) ? openSet.delete(id) : openSet.add(id); if (id.startsWith('db') && modalRefresh) modalRefresh(); },
  toggleDice() { $('#dicePanel').classList.toggle('open'); },
  clearLog() { rollLog.length = 0; renderLog(); },
  closeModal() { closeModal(); },
  goTab(el) { switchTab(el.dataset.tabGo); },
};
// Действия, которые не меняют персонажа (не нужно сохранять/перерисовывать)
const NO_RENDER = new Set(['exportChar', 'importChar', 'toggleDice', 'clearLog', 'closeModal', 'skillInfo', 'condInfo', 'masteryInfo', 'addSpellDb', 'shortRest','addAttack', 'editAttack', 'addSpellCustom', 'editSpell', 'addItem', 'editItem', 'addResource', 'editRes', 'addFeature', 'editFeature', 'goTab', 'abilGen', 'genMode', 'genPb', 'genRoll', 'genReset', 'levelUp', 'lvlRoll', 'openCatalog', 'catTab', 'addEffect', 'sneak', 'bardDie', 'radiantStrike', 'addFeat', 'featSpells', 'masteryPick', 'undo', 'newChar', 'originWizard', 'wizNext', 'wizPrev', 'wizGo']);

// Высота закреплённой шапки — под ней закрепляется панель вкладок (на телефоне шапка не закреплена)
function syncStickyOffset() {
  const qb = $('.quickbar');
  document.documentElement.style.setProperty('--qbh', getComputedStyle(qb).position === 'sticky' ? qb.offsetHeight + 'px' : '0px');
}
function switchTab(t) {
  // Если страница прокручена ниже начала вкладок — вернуться к началу новой вкладки
  const qbh = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--qbh')) || 0;
  const top = $('main').getBoundingClientRect().top + window.scrollY - $('#tabs').offsetHeight - qbh;
  if (curTab !== t && window.scrollY > top) window.scrollTo(0, top);
  curTab = t; lsSet('dnd55-tab', t);
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  $$('.tab').forEach((s) => s.classList.toggle('on', s.id === 'tab-' + t));
  if (t === 'ref') renderRef();
  document.dispatchEvent(new CustomEvent('dnd-tab', { detail: t }));
}

/* ---------- Инициализация ---------- */
function buildStatic() {
  $('#abilGrid').innerHTML = ABILITIES.map((a) => `<div class="abil"><div class="an">${a.n}</div>
    <button class="amod" data-act="rollCheck" data-k="${a.k}" id="am-${a.k}" title="Проверка ${a.n}"></button>
    <div class="ascore" id="sc-${a.k}"></div>
    <label class="abase">база<input type="number" min="1" max="30" data-bind="abil.${a.k}" data-num aria-label="${a.n} — базовое значение"></label>
    <div class="afinal" id="af-${a.k}"></div>
    <div class="asave"><input type="checkbox" data-bind="saves.${a.k}" title="Владение спасброском"><button data-act="rollSave" data-k="${a.k}" id="as-${a.k}"></button></div></div>`).join('');
  $('#slotList').innerHTML = Array.from({ length: 9 }, (_, i) => `<div class="slot-row" id="slotRow${i}"><span class="lv">${i + 1} ур.</span>
      <input type="number" min="0" max="9" data-bind="slots.${i}.max" data-num title="Максимум"><span id="slotPips${i}"></span><span class="muted small" id="slotCnt${i}"></span></div>`).join('') +
    `<div class="slot-row pact" id="pactRow"><span class="lv">Договор</span><input type="number" min="0" max="4" data-bind="pact.max" data-num title="Кол-во ячеек"><span id="pactPips"></span>
      <span class="row gap"><span class="muted small" id="pactCnt"></span><input type="number" min="1" max="5" data-bind="pact.level" data-num title="Уровень ячеек договора" style="width:48px"></span></div>`;
  $('#saSelect').innerHTML = ABILITIES.map((a) => `<option value="${a.k}">${a.n}</option>`).join('');
  $('#armorSelect').innerHTML = '<option value="">Без доспеха</option>' + Object.entries(ARMOR_TYPES).map(([t, title]) =>
    `<optgroup label="${title}">${ARMOR.filter((a) => a.type === t).map((a) => `<option value="${a.id}">${a.n} (${a.ac})</option>`).join('')}</optgroup>`).join('');
  $('#unarmSelect').innerHTML = Object.entries(UNARMORED).map(([k, u]) => `<option value="${k}">${u.n}</option>`).join('');
  $('#itemCat').innerHTML += ITEM_CATEGORIES.map((c) => `<option>${c}</option>`).join('');
  $('#refLevel').innerHTML += [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => `<option value="${l}">${l ? l + ' уровень' : 'Заговоры'}</option>`).join('');
  $('#refClass').innerHTML += SPELL_CLASSES.map((c) => `<option>${c}</option>`).join('');
  const dl = (id, arr) => { $(id).innerHTML = arr.map((x) => `<option value="${esc(x)}">`).join(''); };
  dl('#dlClasses', Object.keys(CLASSES)); dl('#dlSpecies', SPECIES); dl('#dlBackgrounds', BACKGROUNDS); dl('#dlAlign', ALIGNMENTS);
  const fs = document.createElement('datalist'); fs.id = 'dlFeatSrc';
  fs.innerHTML = ['Класс', 'Подкласс', 'Черта', 'Раса', 'Предыстория', 'Предмет', 'Прочее'].map((x) => `<option value="${x}">`).join('');
  document.body.appendChild(fs);
}

function bindEvents() {
  document.addEventListener('input', (e) => {
    const el = e.target, p = el.dataset.bind;
    if (!p) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if ('num' in el.dataset) v = el.value === '' ? 0 : Number(el.value);
    const c = ch(), before = snap(c);
    setPath(c, p, v);
    // Максимум хитов, заданный вручную, — новая основа для пересчёта
    if (p === 'combat.hpMax') c.combat.hpRolled = (+v || 0) - hpPart(c);
    save(); render();
    // Ввод подряд в одно поле — одна запись в истории отмены
    const fresh = !bindUndo || bindUndo.path !== p || bindUndo.id !== c.id || Date.now() - bindUndo.t > 3000;
    if (fresh && snap(c) !== before) {
      const name = (el.closest('label')?.childNodes[0]?.textContent || el.getAttribute('aria-label') || 'поле').trim();
      pushUndo(c.id, before, `поле «${name}»`);
    }
    bindUndo = { path: p, id: c.id, t: Date.now() };
  });
  // Выбор владения из списка или по заданию «выберите»
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.value || el.closest('#modal')) return;
    if (el.classList.contains('prof-add')) tracked('владение', () => addProf(ch(), el.dataset.k, el.value, false));
    else if (el.dataset.pick) tracked('выбор владения', () => resolvePick(ch(), el.dataset.pick, el.value));
    else return;
    save(); render();
  });
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { switchTab(tab.dataset.tab); return; }
    const adv = e.target.closest('[data-adv]');
    if (adv) { setAdv(+adv.dataset.adv); return; }
    const rl = e.target.closest('[data-roll]');
    if (rl) { rollDice(`Бросок ${rl.textContent}`, rl.dataset.roll); return; }
    const rf = e.target.closest('[data-ref]');
    if (rf) { refMode = rf.dataset.ref; $$('#refSeg button').forEach((b) => b.classList.toggle('on', b === rf)); renderRef(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const name = el.dataset.act, fn = ACT[name];
    if (!fn) return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') e.preventDefault();
    const id = ch().id, before = name === 'undo' ? null : snap(ch());
    fn(el, e);
    if (!NO_RENDER.has(name)) { save(); render(); updateShortRestInfo(); if (curTab === 'ref') renderRef(); }
    if (before && state.chars[id] && snap(state.chars[id]) !== before) { pushUndo(id, before, ACT_LABELS[name] || 'изменение'); bindUndo = null; }
  });
  $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else $('#dicePanel').classList.remove('open'); }
    // Ctrl+Z вне полей ввода — отменить последнее действие (в полях работает обычная отмена браузера)
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey && !typing && $('#modal').hidden) { e.preventDefault(); undo(); }
  });
  $('#hpAmount').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tracked('урон', () => ACT.damage()); save(); render(); } });
  $('#charSelect').addEventListener('change', (e) => { state.current = e.target.value; openSet.clear(); pendingConc = 0; abilEdit = false; save(false); render(); });
  $('#importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data !== 'object' || !data.info || !data.abil) throw new Error('bad');
      data.id = uid();
      state.chars[data.id] = migrate(data);
      state.current = data.id;
      save(); render(); toast(`Импортирован: ${esc(data.info.name)}`);
    } catch (err) { toast('Не удалось прочитать файл персонажа'); }
  });
  $('#diceForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('#diceExpr').value.trim(); if (v) rollDice(v, v); });
  ['#spellFilter', '#spellOnlyPrep'].forEach((s) => $(s).addEventListener('input', renderSpells));
  ['#itemFilter', '#itemCat'].forEach((s) => $(s).addEventListener('input', renderInventory));
  ['#refFilter', '#refLevel', '#refClass'].forEach((s) => $(s).addEventListener('input', renderRef));
  new ResizeObserver(syncStickyOffset).observe($('.quickbar'));
  window.addEventListener('resize', syncStickyOffset);
}

loadState();
buildStatic();
bindEvents();
render();
renderLog();
switchTab(curTab);
