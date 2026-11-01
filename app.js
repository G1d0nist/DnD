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
    feats: [], // { id, key, slot, a, a1, a2, mode, lvl }
    attacks: [{ id: uid(), n: 'Безоружный удар', ability: 'str', prof: true, hit: 0, dmg: '1', addMod: true, dmgBonus: 0, type: 'дробящий', mastery: '', range: '5 фт', x: '' }],
    spellcasting: { ability: 'int', casterType: 'none', bonus: 0 },
    slots: Array.from({ length: 9 }, () => ({ max: 0, used: 0 })),
    pact: { max: 0, level: 1, used: 0 },
    spells: [], resources: [], features: [], items: [],
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    prof: { armor: '', weapons: '', tools: '', languages: 'Общий', senses: '' },
    notes: { traits: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '', allies: '', journal: '' },
  };
}
function deepFill(t, s) {
  for (const k in s) {
    if (t[k] === undefined || t[k] === null) t[k] = s[k];
    else if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && typeof t[k] === 'object') deepFill(t[k], s[k]);
  }
}
function migrate(c) {
  const old = { armorV: c.armor && c.armor.v, clsApplied: c.info && c.info.clsApplied };
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
};

/* ---------- Производные значения ---------- */
// Поле «Уровень» — уровень основного класса; дополнительные классы мультикласса в c.multi.
// lvl(c) — общий уровень персонажа (бонус мастерства, заговоры, кости хитов), clsLvl — уровень в классе.
const pLvl = (c) => clamp(parseInt(c.info.level) || 1, 1, 20);
function classList(c) {
  return [{ cls: c.info.cls.trim(), sub: c.info.subclass || '', lvl: pLvl(c), primary: true },
    ...(c.multi || []).map((m) => ({ cls: String(m.cls || '').trim(), sub: m.sub || '', lvl: clamp(parseInt(m.lvl) || 1, 1, 20), id: m.id }))];
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
// Итоговое значение характеристики: базовое (введённое) + черты + умение 20 уровня
function score(c, k) {
  const base = +c.abil[k] || 0, { gen, epic } = featAbilBonus(c, k);
  let v = base + gen > 20 ? Math.max(base, 20) : base + gen;
  if (Object.entries(CAPSTONE).some(([n, cap]) => clsLvl(c, n) >= 20 && cap[1].includes(k))) v = Math.max(v, Math.min(25, v + 4));
  if (epic) v = Math.max(v, Math.min(30, v + epic));
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
const saveBonus = (c, k) => am(c, k) + (saveProf(c, k) ? pb(c) : 0) + auraBonus(c);
const initBonus = (c) => am(c, 'dex') + (+c.combat.initBonus || 0) + (hasFeat(c, 'alert') ? pb(c) : 0);
const spellMod = (c) => am(c, c.spellcasting.ability);
const spellDC = (c) => 8 + pb(c) + spellMod(c) + (+c.spellcasting.bonus || 0);
const spellAtk = (c) => pb(c) + spellMod(c) + (+c.spellcasting.bonus || 0);
const SPEED_ZERO = ['grappled', 'paralyzed', 'petrified', 'restrained', 'unconscious'];
// Расчёт КД по доспеху/щиту/защите без доспехов; notes — предупреждения для отображения
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
  : Math.max(0, (+c.combat.speed || 0) + speedBonuses(c).reduce((s, [, v]) => s + v, 0) - 5 * (c.combat.exhaustion || 0) - armorSlow(c)));
// Ярость варвара — активна, пока в эффектах есть «Ярость»
const raging = (c) => c.effects.some((e) => e.n === 'Ярость');
const rageDmg = (c) => { const B = clsLvl(c, 'Варвар'); return B >= 16 ? 4 : B >= 9 ? 3 : 2; };
const usesStr = (c, a) => a.ability === 'str' || (a.ability === 'fin' && am(c, 'str') >= am(c, 'dex'));
const isLucky = (c) => /полурослик|halfling/i.test(c.info.species);
const hpPerLevelBonus = (c) => (/дварф|dwarf/i.test(c.info.species) ? 1 : 0) + (hasFeat(c, 'tough') || c.features.some((f) => /крепкий|tough/i.test(f.n)) ? 2 : 0);
// Дальнобойное оружие — дистанция вида «80/320 фт» (метательное записано как «5 фт · бросок …»)
const isRangedWeapon = (a) => a.ability !== 'spell' && /^\d+\/\d+/.test(a.range || '');
// ability: характеристика, 'spell' — заклинательная, 'fin' — лучшая из Силы и Ловкости (фехтовальное оружие)
const abilFor = (c, a) => (a.ability === 'spell' ? spellMod(c) : a.ability === 'fin' ? Math.max(am(c, 'str'), am(c, 'dex')) : am(c, a.ability));
const atkAbilMod = (c, a) => abilFor(c, a) + (a.ability === 'spell' ? (+c.spellcasting.bonus || 0) : 0);
const attackBonus = (c, a) => atkAbilMod(c, a) + (a.prof ? pb(c) : 0) + (+a.hit || 0) + (hasFeat(c, 'archery') && isRangedWeapon(a) ? 2 : 0);
const dmgMod = (c, a) => (a.addMod ? abilFor(c, a) : 0) + (+a.dmgBonus || 0) + (raging(c) && a.ability !== 'spell' && usesStr(c, a) ? rageDmg(c) : 0);
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
  const t = c.spellcasting.casterType;
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
  return map;
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
  const total = used + bonus - pen;
  detail += ` ${fmt(bonus)}` + (pen ? ` −${pen} (истощение)` : '') + (notes.length ? ` · ${notes.join(', ')}` : '');
  let cls = nat === 20 ? 'crit' : nat === 1 ? 'fumble' : '';
  let extra = '';
  if (opts.dc != null) { extra = total >= opts.dc ? ' ✔ успех' : ' ✘ провал'; }
  if (opts.attack && nat === 20) extra = ' — КРИТ!';
  if (opts.attack && nat === 1) extra = ' — промах';
  logRoll(label + extra, total, detail, cls);
  setAdv(0);
  return { total, nat };
}
function rollDice(label, expr) {
  const r = evalDice(expr);
  if (!r) { toast(`Не понял выражение «${esc(expr)}»`); return null; }
  logRoll(label, r.total, `${expr}: ${r.detail}`);
  return r;
}
function logRoll(label, total, detail, cls = '') {
  rollLog.unshift({ label, total, detail, cls, t: new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) });
  rollLog.length = Math.min(rollLog.length, 60);
  renderLog();
  toast(`<b class="big">${total}</b>${esc(label)}<div class="rd">${esc(detail)}</div>`, cls);
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
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; modalRefresh = null; }
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

function render() {
  const c = ch();
  // Класс выбран (или сменён) — применить его шаблон автоматически
  if (CLASSES[c.info.cls.trim()] && c.info.clsApplied !== c.info.cls.trim()) {
    applyClassTemplate(c);
    toast(`Применён шаблон класса «${esc(c.info.cls.trim())}»: кость хитов, спасброски, колдовство, ресурсы`);
  }
  autoSlots(c);
  autoResources(c);
  if (c.armor.mode === 'auto') c.combat.ac = computeAC(c).ac;
  autoMartialArts(c);
  renderMulti();
  fillBound();
  renderUndo();
  renderHeader(); renderAbil(); renderSkills(); renderCombat(); renderClassPanel(); renderQuickSpells(); renderSpells(); renderInventory(); renderFeatures();
}

// Список дополнительных классов; перестраивается только при добавлении/удалении, чтобы не сбивать ввод
let multiSig = null;
function renderMulti() {
  const c = ch(), sig = c.id + ':' + c.multi.map((m) => m.id).join(',');
  if (sig !== multiSig) {
    multiSig = sig;
    $('#multiBox').innerHTML = (c.multi.length ? `<h3>Мультикласс</h3>` + c.multi.map((m, i) => `<div class="multi-row">
        <label>Класс<input data-bind="multi.${i}.cls" list="dlClasses"></label>
        <label>Подкласс<input data-bind="multi.${i}.sub"></label>
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

function renderAbil() {
  const c = ch();
  ABILITIES.forEach((a) => {
    $(`#am-${a.k}`).textContent = fmt(am(c, a.k));
    $(`#as-${a.k}`).textContent = `Спас ${fmt(saveBonus(c, a.k))}`;
    const s = score(c, a.k), base = +c.abil[a.k] || 0;
    $(`#af-${a.k}`).textContent = s !== base ? `итог ${s} (${fmt(s - base)})` : '';
    $(`#af-${a.k}`).title = s !== base ? 'Базовое значение + черты / умения класса' : '';
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
      ${a.ma ? `<span class="tag e" title="Кость урона растёт с уровнем: к6 → к8 (5) → к10 (11) → к12 (17)">Боевые искусства</span>` : ''}
      ${a.mastery && m ? `<span class="tag g" data-act="masteryInfo" data-k="${a.mastery}" style="cursor:pointer">⚔ ${m.n}</span>` : ''}
      <span class="btns"><button data-act="atkRoll" data-id="${a.id}">🎯 Атака</button><button data-act="dmgRoll" data-id="${a.id}">Урон</button><button data-act="dmgRoll" data-crit="1" data-id="${a.id}">Крит</button>
      <button class="ghost" data-act="editAttack" data-id="${a.id}" title="Изменить">✎</button><button class="ghost" data-act="delAttack" data-id="${a.id}" title="Удалить">✕</button></span>
    </div>${openSet.has(a.id) && (a.x || m?.d) ? `<div class="li-desc">${esc(a.x)}${a.x && m?.d ? '\n\n' : ''}${m?.d ? '<b>' + m.n + ':</b> ' + esc(m.d) : ''}</div>` : ''}</div>`;
  }).join('') || '<div class="muted">Нет атак</div>';

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

function renderSpells() {
  const c = ch(), sc = c.spellcasting, t = sc.casterType;
  $('#spellStats').innerHTML = `<div class="stat"><b>${spellDC(c)}</b><span>СЛ спасброска</span></div>
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
  const prepared = c.spells.filter((s) => s.l > 0 && s.prep).length;
  $('#prepCount').textContent = c.spells.length ? `— всего ${c.spells.length}, подготовлено ${prepared}` : '';
  let html = '';
  for (let l = 0; l <= 9; l++) {
    const list = c.spells.filter((s) => +s.l === l && (!q || (s.n + ' ' + (s.e || '')).toLowerCase().includes(q)) && (!onlyPrep || l === 0 || s.prep))
      .sort((a, b) => a.n.localeCompare(b.n, 'ru'));
    if (!list.length) continue;
    const slot = l ? c.slots[l - 1] : null;
    html += `<div class="spell-lvl"><h3>${l ? l + ' уровень' : 'Заговоры'}${slot && slot.max ? pipsHtml(slot.max, slot.used, 'slotPip', `data-l="${l - 1}"`) : ''}</h3><div class="list">`;
    html += list.map((s) => `<div class="li ${l && !s.prep ? 'dim' : ''}"><div class="li-head">
        ${l ? `<input type="checkbox" class="prep" data-act="togglePrep" data-id="${s.id}" ${s.prep ? 'checked' : ''} title="Подготовлено">` : ''}
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
function renderFeatures() {
  const c = ch();
  $('#resList').innerHTML = c.resources.map((r) => resCardHtml(c, r, false)).join('')
    || '<div class="muted">Укажите класс во вкладке «Персонаж» — ресурсы (Ци, Ярость, Вдохновение…) появятся сами. Свои ресурсы можно добавить кнопкой выше.</div>';

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
      ${f.lvl ? `<span class="li-sub">${f.lvl} ур.</span>` : ''}
      <span class="btns"><button class="ghost" data-act="delFeat" data-id="${f.id}" title="Убрать черту">✕</button></span>
    </div>${openSet.has(f.id) ? `<div class="li-desc">${esc(d.x)}</div>` : ''}</div>`;
  }).join('') || '<div class="muted small">Черт пока нет. Черту происхождения даёт предыстория на 1 уровне.</div>';

  $('#featList').innerHTML = c.features.map((f) => `<div class="li"><div class="li-head">
      <span class="li-title" data-act="toggleOpen" data-id="${f.id}">${esc(f.n)}</span>${f.src ? `<span class="tag">${esc(f.src)}</span>` : ''}
      <span class="btns"><button class="ghost" data-act="editFeature" data-id="${f.id}">✎</button><button class="ghost" data-act="delFeature" data-id="${f.id}">✕</button></span>
    </div>${openSet.has(f.id) && f.x ? `<div class="li-desc">${esc(f.x)}</div>` : ''}</div>`).join('') || '<div class="muted">Добавьте умения класса, черты (feats), особенности вида и предыстории.</div>';
}

// Боевые умения класса/вида: значения по уровню и кнопки бросков
function classPanelItems(c) {
  const items = [], CL = (n) => clsLvl(c, n);
  const left = (k) => { const r = c.resources.find((x) => x.auto === k); return r ? `осталось ${r.max - r.used} из ${r.max}` : ''; };
  // Дополнительные атаки разных классов не складываются — берётся лучшая
  const F = CL('Воин');
  const atk = Math.max(F >= 20 ? 4 : F >= 11 ? 3 : F >= 5 ? 2 : 1, ['Варвар', 'Монах', 'Паладин', 'Следопыт'].some((n) => CL(n) >= 5) ? 2 : 1);
  if (atk > 1) items.push({ n: 'Атак за действие «Атака»', v: atk });
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
  $('#classCard').hidden = !items.length && !res.length;
  $('#classRes').innerHTML = res.map((r) => resCardHtml(c, r, true)).join('');
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
  const list = c.spells.filter((s) => +s.l === 0 || s.prep).sort((a, b) => a.l - b.l || a.n.localeCompare(b.n, 'ru'));
  $('#qsList').innerHTML = list.map((s) => `<div class="li qs"><div class="li-head">
      <span class="lvl-badge" title="${s.l ? s.l + ' уровень' : 'Заговор'}">${s.l || 'З'}</span>
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
    html = SPELLS.map((s, i) => [s, i]).filter(([s]) => match(s.n, s.e, s.s) && (lv === '' || s.l === +lv) && (!cl || s.k.includes(cl)))
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

function renderGen() {
  const box = $('#genBody');
  if (!box) return;
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

  const bonusSum = ABILITIES.reduce((s, a) => s + (+gen.bonus[a.k] || 0), 0);
  html += `<div class="gen-grid mt"><div class="gen-row head"><span>Характеристика</span><span>Значение</span><span>Бонус</span><span>Итог</span></div>`;
  html += ABILITIES.map((a) => {
    const base = genBase(a.k), b = +gen.bonus[a.k] || 0;
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
      <select data-gbonus="${a.k}" title="Бонус предыстории/расы">${[0, 1, 2].map((n) => `<option value="${n}" ${b === n ? 'selected' : ''}>+${n}</option>`).join('')}</select>
      <span class="gtotal">${total ?? '—'}<small>${total == null ? '' : fmt(mod(total))}</small></span></div>`;
  }).join('') + '</div>';

  html += `<p class="muted small">Бонус: в D&D 2024 предыстория даёт +2 и +1 или +1 к трём характеристикам; в 5e 2014 — бонусы расы. Итог не выше 20.</p>`;
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
  const mb = $('#modalBody');
  mb.onchange = (e) => {
    const el = e.target;
    if (el.dataset.gsel) {
      if (el.value === '') genAssign()[el.dataset.gsel] = null; else genPlace(el.dataset.gsel, +el.value);
      renderGen();
    } else if (el.dataset.gbonus) { gen.bonus[el.dataset.gbonus] = +el.value; renderGen(); }
  };
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
  renderGen();
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
  delAttack: 'удаление атаки', delSpell: 'удаление заклинания', delItem: 'удаление предмета', delRes: 'удаление ресурса', delFeature: 'удаление умения',
  addAutoRes: 'ресурс класса', calcHp: 'расчёт хитов', applyClass: 'шаблон класса',
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
// Черты, меняющие максимум хитов при добавлении/удалении
function featHp(c, key, sign) {
  const d = key === 'tough' ? 2 * lvl(c) : key === 'boonFortitude' ? 40 : 0;
  if (!d) return;
  c.combat.hpMax = Math.max(1, (+c.combat.hpMax || 0) + sign * d);
  c.combat.hp = clamp((+c.combat.hp || 0) + sign * d, 0, c.combat.hpMax);
}
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
function featuresAt(cls, subclass, L) {
  const row = (CLASS_FEATURES[cls] || [])[L - 1] || '';
  const sub = 'Умение подкласса' + (subclass ? `: ${subclass}` : '');
  return row.split(';').map((s) => s.trim()).filter((s) => s && s !== 'ASI' && s !== 'EPIC' && !s.startsWith('Боевой стиль'))
    .map((s) => (s === 'SUB' ? sub : s));
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
function applyAdvance(c, S) {
  if (S.target === 'p') c.info.level = pLvl(c) + 1;
  else if (S.target === 'new') c.multi.push({ id: uid(), cls: S.newCls, sub: '', lvl: 1 });
  else { const m = c.multi.find((x) => x.id === S.target); m.lvl = (parseInt(m.lvl) || 1) + 1; }
}
function lvlResetPicks(c) {
  const S = lvlState, t = lvlTarget(c, S);
  S.slots = t.cls ? featSlotsAt(t.cls, t.lvl + 1) : [];
  S.picks = {};
  S.slots.forEach((k) => { S.picks[k] = defaultPick(c, k); });
  S.skip = new Set();
  S.roll = null;
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
  const feats = T.cls ? featuresAt(T.cls, T.sub, CN) : [];
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
  const picksOk = S.slots.every((k) => pickValid(S.picks[k]));

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
    <h3>Хиты</h3>
    <div class="row gap wrap">
      <label class="check"><input type="radio" name="hpMode" value="avg" ${S.hpMode === 'avg' ? 'checked' : ''}> Среднее (${hd / 2 + 1})</label>
      <label class="check"><input type="radio" name="hpMode" value="roll" ${S.hpMode === 'roll' ? 'checked' : ''}> Бросок к${hd}</label>
      ${S.hpMode === 'roll' ? `<button data-act="lvlRoll">🎲 ${S.roll == null ? 'Бросить' : `Выпало ${S.roll} — перебросить`}</button>` : ''}
    </div>
    <p>${gain == null ? '<span class="muted">Бросьте кость хитов</span>' : `+<b>${gain}</b> хитов (${S.hpMode === 'avg' ? hd / 2 + 1 : S.roll} ${fmt(con)} Тел${hpPerLevelBonus(c) ? ` +${hpPerLevelBonus(c)} вид/черта` : ''}) · максимум ${c.combat.hpMax} → <b>${+c.combat.hpMax + gain}</b>`}</p>
    <h3>Что изменится</h3><ul class="lvl-list">${changes.map((x) => `<li>${x}</li>`).join('')}</ul>
    ${feats.length ? `<h3>Новые умения</h3><p class="muted small">Отмеченные добавятся во вкладку «Способности». Описания — в Книге игрока.</p>
      <div class="lvl-feats">${feats.map((f, i) => `<label class="check"><input type="checkbox" data-feat="${i}" ${S.skip.has(i) ? '' : 'checked'}> ${esc(f)}</label>`).join('')}</div>`
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
  $('#catSeg').innerHTML = [['weapons', 'Оружие'], ['armor', 'Доспехи'], ['gear', 'Снаряжение']]
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
  };
}

/* ---------- Действия ---------- */
let pendingConc = 0;
const findById = (arr, id) => arr.find((x) => x.id === id);
const hpAmount = () => { const v = parseInt($('#hpAmount').value); return isNaN(v) || v < 0 ? 0 : v; };

function applyDamage(n) {
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
    if (wasZero && rest > 0) { cb.deathF = Math.min(3, cb.deathF + 1); msg += '. Провал спасброска от смерти'; }
    else if (over >= (+cb.hpMax || 0) && rest > 0) msg += '. ☠ Мгновенная смерть: остаток урона ≥ максимума хитов!';
    else if (!wasZero) {
      msg += '. 0 хитов — без сознания';
      if (!cb.conditions.includes('unconscious')) cb.conditions.push('unconscious');
      if (cb.conc) { msg += `, концентрация на «${cb.conc}» прервана`; endConc(c); }
    }
  }
  if (cb.conc && n > 0) { pendingConc = Math.min(30, Math.max(10, Math.floor(n / 2))); msg += `. Спасбросок концентрации: СЛ ${pendingConc}`; }
  toast(esc(msg), 'fumble');
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
    if (s.addMod) expr = withMod(expr, spellMod(c));
    rollDice(`${s.n}${castLvl > s.l ? ` (${castLvl} ур.)` : ''}`, expr);
  }
}
const ATTACK_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'ability', label: 'Характеристика', type: 'select', options: [...ABILITIES.map((a) => [a.k, a.n]), ['fin', 'Сила или Ловкость (фехтовальное)'], ['spell', 'Заклинательная']] },
  { k: 'hit', label: 'Доп. бонус к попаданию', type: 'number' },
  { k: 'dmg', label: 'Кости урона', ph: '1d8' },
  { k: 'dmgBonus', label: 'Доп. бонус к урону', type: 'number' },
  { k: 'type', label: 'Тип урона', type: 'select', options: DAMAGE_TYPES },
  { k: 'range', label: 'Дистанция', ph: '5 фт / 80/320 фт' },
  { k: 'mastery', label: 'Приём оружия (Mastery)', type: 'select', options: Object.entries(MASTERY).map(([k, m]) => [k, m.n]) },
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
  { k: 'x', label: 'Описание', type: 'textarea', rows: 5 },
];
const RES_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'max', label: 'Максимум', type: 'number' },
  { k: 'recharge', label: 'Восстановление', type: 'select', options: Object.entries(RECHARGE) },
  { k: 'autoOn', label: 'Считать максимум автоматически по уровню', type: 'check' },
  { k: 'x', label: 'Описание', type: 'textarea', rows: 4 },
];
const FEAT_FIELDS = () => [
  { k: 'n', label: 'Название', full: true },
  { k: 'src', label: 'Источник', ph: 'Класс / Черта / Вид / Предыстория', list: 'dlFeatSrc', full: true },
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
    $('#dbList').innerHTML = SPELLS.map((s, i) => [s, i]).filter(([s]) => (!q || (s.n + ' ' + s.e).toLowerCase().includes(q)) && (l === '' || s.l === +l) && (!cl || s.k.includes(cl)))
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
  newChar() { const c = blankChar(); state.chars[c.id] = c; state.current = c.id; openSet.clear(); switchTab('main'); toast('Создан новый персонаж'); },
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
    const c = ch(), cb = c.combat;
    cb.hp = cb.hpMax; cb.temp = 0; cb.hdUsed = 0; cb.hdUsedBy = {}; cb.deathS = 0; cb.deathF = 0;
    cb.exhaustion = Math.max(0, cb.exhaustion - 1);
    cb.conditions = cb.conditions.filter((k) => k !== 'unconscious');
    c.effects = []; endConc(c); pendingConc = 0;
    c.slots.forEach((s) => { s.used = 0; }); c.pact.used = 0;
    c.resources.forEach((r) => { if (r.recharge !== 'none') r.used = 0; });
    toast('🌙 Долгий отдых завершён — всё восстановлено');
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
    if (!confirmBox(`Установить максимум хитов = ${max}? (${how}: максимум кости на 1 уровне, дальше среднее; мод. Тел ${fmt(con)}${extra ? `, +${extra} за уровень от вида/черты` : ''})`)) return;
    if (c.combat.hp >= c.combat.hpMax) c.combat.hp = max;
    c.combat.hpMax = max;
    c.combat.hp = Math.min(c.combat.hp, max);
  },
  rollCheck(el) { const a = ABILITIES.find((x) => x.k === el.dataset.k); rollD20(`Проверка: ${a.n}`, am(ch(), a.k), { kind: 'check', abil: a.k }); },
  rollSave(el) { const a = ABILITIES.find((x) => x.k === el.dataset.k); rollD20(`Спасбросок: ${a.n}`, saveBonus(ch(), a.k), { kind: 'save', abil: a.k }); },
  rollSkill(el) {
    const c = ch(), s = SKILLS.find((x) => x.k === el.dataset.k);
    rollD20(s.n, skillBonus(c, s), { kind: 'check', abil: s.a, skill: s.k, floor10: clsLvl(c, 'Плут') >= 7 && (c.skills[s.k] || 0) > 0 });
  },
  skillProf(el) { const c = ch(), k = el.dataset.k; c.skills[k] = ((c.skills[k] || 0) + 1) % 3; },
  skillInfo(el) {
    const s = SKILLS.find((x) => x.k === el.dataset.k), a = ABILITIES.find((x) => x.k === s.a);
    openModal(`<h2>${s.n}</h2><p class="muted">Характеристика: ${a.n}</p><p>${esc(s.d)}</p><div class="modal-actions"><button data-act="rollSkill" data-k="${s.k}">🎲 Бросить ${fmt(skillBonus(ch(), s))}</button><button data-act="closeModal">Закрыть</button></div>`);
  },
  spendHd(el) { spendHitDie(el.dataset.die); },
  deathSave() {
    const cb = ch().combat;
    const { nat, total } = rollD20('Спасбросок от смерти', 0, { kind: 'death' });
    if (nat === 20) { cb.hp = 1; cb.deathS = 0; cb.deathF = 0; cb.conditions = cb.conditions.filter((k) => k !== 'unconscious'); toast('🌟 Натуральная 20 — вы приходите в себя с 1 хитом!', 'crit'); }
    else if (nat === 1) cb.deathF = Math.min(3, cb.deathF + 2);
    else if (total >= 10) cb.deathS = Math.min(3, cb.deathS + 1);
    else cb.deathF = Math.min(3, cb.deathF + 1);
    if (cb.deathS >= 3) toast('Стабилизирован: 0 хитов, но без спасбросков. Через 1к4 часа — 1 хит.');
    if (cb.deathF >= 3) toast('☠ Три провала — персонаж погиб', 'fumble');
  },
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
    rollD20(`Атака: ${a.n}`, attackBonus(c, a), { attack: true, kind: 'attack' });
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
  togglePrep(el) { const s = findById(ch().spells, el.dataset.id); s.prep = !s.prep; },
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
    const c = ch(), s = findById(c.spells, el.dataset.id), slot = el.dataset.slot;
    let castLvl = +s.l, how = '';
    if (slot === 'pact') { c.pact.used++; castLvl = c.pact.level; how = `ячейка договора ${castLvl} ур.`; }
    else if (slot === 'ritual') how = 'ритуал';
    else if (slot === 'free') how = 'без ячейки';
    else { c.slots[+slot].used++; castLvl = +slot + 1; how = `ячейка ${castLvl} ур.`; }
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
  addClassRes() {
    const c = ch();
    const opts = Object.entries(CLASS_RESOURCES).map(([k, r]) => `<button data-act="addAutoRes" data-k="${k}" ${c.resources.some((x) => x.auto === k) ? 'disabled' : ''}>${r.n}</button>`).join('');
    openModal(`<h2>Ресурсы классов</h2><p class="muted small">Максимум считается автоматически по уровню персонажа (для мультикласса отключите авторасчёт в настройках ресурса).</p><div class="slot-choice">${opts}</div><div class="modal-actions"><button data-act="closeModal">Готово</button></div>`);
  },
  addAutoRes(el) {
    const k = el.dataset.k, R = CLASS_RESOURCES[k];
    ch().resources.push({ id: uid(), n: R.n, max: 0, used: 0, recharge: 'long', auto: k, x: R.d, manual: true });
    el.disabled = true; toast(`Добавлено: ${R.n}`);
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
  addFeat() { openFeatAdd(); },
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
    const feats = T.cls ? featuresAt(T.cls, T.sub, CN) : [];
    if (!S.slots.every((k) => pickValid(S.picks[k]))) return;
    // Одна и та же неповторяемая черта не может быть выбрана в двух ячейках
    const keys = S.slots.map((k) => S.picks[k].key);
    if (keys.some((k, i) => keys.indexOf(k) !== i && !FEATS_BY[k].rep)) { toast('Одну черту нельзя взять дважды'); return; }
    if (S.target === 'new') {
      const bad = [S.newCls, ...classList(c).map((e) => e.cls)].filter((n) => n && !mcOk(c, n));
      if (bad.length && !confirmBox(`Требования мультикласса не выполнены (${bad.map((n) => `${n}: ${mcReqText(n)}`).join('; ')}). Всё равно взять класс «${S.newCls}» (с разрешения Мастера)?`)) return;
    }
    applyAdvance(c, S);
    c.combat.hpMax = (+c.combat.hpMax || 0) + gain;
    c.combat.hp = (+c.combat.hp || 0) + gain;
    const notes = [`+${gain} хитов`];
    S.slots.forEach((k) => {
      const p = S.picks[k];
      addFeat(c, k, p, N);
      const eff = featEffectText(c.feats[c.feats.length - 1]);
      notes.push(`${FEATS_BY[p.key].n}${eff ? ` (${eff})` : ''}`);
    });
    const src = `${T.cls} ${CN}`;
    feats.forEach((f, i) => {
      if (S.skip.has(i)) return;
      if (!c.features.some((x) => x.n === f && x.src === src)) c.features.push({ id: uid(), n: f, src, x: '' });
    });
    if (T.cls === 'Бард' && CN >= 2) c.combat.jack = true;
    const cap = CN === 20 && CAPSTONE[T.cls];
    if (cap) notes.push(`${cap[0]}: +4`);
    closeModal();
    toast(`⬆ ${T.cls ? `${esc(T.cls)} ${CN}` : ''} · общий ${N} уровень! ${notes.join(' · ')}`, 'crit');
  },
  openCatalog(el) { openCatalog(el.dataset.t); },
  catTab(el) { catTab = el.dataset.t; renderCatalog(); },
  catWeapon(el) {
    const c = ch(), w = WEAPONS[+el.dataset.i];
    if (el.dataset.to === 'atk') { c.attacks.push(weaponAttack(w)); toast(`⚔ ${esc(w.n)} добавлен в атаки`); }
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
    const vals = Object.fromEntries(ABILITIES.map((a) => [a.k, Math.min(20, genBase(a.k) + (+gen.bonus[a.k] || 0))]));
    if (!confirmBox(`Заменить характеристики персонажа?\n${ABILITIES.map((a) => `${a.s} ${vals[a.k]}`).join(' · ')}`)) return;
    Object.assign(c.abil, vals);
    closeModal(); toast('Характеристики применены');
  },
  toggleOpen(el) { const id = el.dataset.id; openSet.has(id) ? openSet.delete(id) : openSet.add(id); if (id.startsWith('db') && modalRefresh) modalRefresh(); },
  toggleDice() { $('#dicePanel').classList.toggle('open'); },
  clearLog() { rollLog.length = 0; renderLog(); },
  closeModal() { closeModal(); },
  goTab(el) { switchTab(el.dataset.tabGo); },
};
// Действия, которые не меняют персонажа (не нужно сохранять/перерисовывать)
const NO_RENDER = new Set(['exportChar', 'importChar', 'toggleDice', 'clearLog', 'closeModal', 'skillInfo', 'condInfo', 'masteryInfo', 'addSpellDb', 'addClassRes', 'shortRest','addAttack', 'editAttack', 'addSpellCustom', 'editSpell', 'addItem', 'editItem', 'addResource', 'editRes', 'addFeature', 'editFeature', 'goTab', 'abilGen', 'genMode', 'genPb', 'genRoll', 'genReset', 'levelUp', 'lvlRoll', 'openCatalog', 'catTab', 'addEffect', 'sneak', 'bardDie', 'radiantStrike', 'addFeat', 'undo']);

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
}

/* ---------- Инициализация ---------- */
function buildStatic() {
  $('#abilGrid').innerHTML = ABILITIES.map((a) => `<div class="abil"><div class="an">${a.n}</div>
    <button class="amod" data-act="rollCheck" data-k="${a.k}" id="am-${a.k}" title="Проверка ${a.n}"></button>
    <input type="number" min="1" max="30" data-bind="abil.${a.k}" data-num aria-label="${a.n}" title="Базовое значение (без черт)">
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
  fs.innerHTML = ['Класс', 'Подкласс', 'Черта', 'Вид', 'Предыстория', 'Предмет', 'Прочее'].map((x) => `<option value="${x}">`).join('');
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
    save(); render();
    // Ввод подряд в одно поле — одна запись в истории отмены
    const fresh = !bindUndo || bindUndo.path !== p || bindUndo.id !== c.id || Date.now() - bindUndo.t > 3000;
    if (fresh && snap(c) !== before) {
      const name = (el.closest('label')?.childNodes[0]?.textContent || el.getAttribute('aria-label') || 'поле').trim();
      pushUndo(c.id, before, `поле «${name}»`);
    }
    bindUndo = { path: p, id: c.id, t: Date.now() };
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
  $('#charSelect').addEventListener('change', (e) => { state.current = e.target.value; openSet.clear(); pendingConc = 0; save(false); render(); });
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
