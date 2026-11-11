'use strict';
// Механика заклинаний для игрового стола (правила 2024). Ключ — английское название заклинания (поле e в листе).
// Что здесь задано, то главнее разбора текста описания (spellArea в app.js); чего нет — берётся из описания.
//
// Форма и размеры: shape — sphere (сфера/цилиндр, size — радиус), cone, line (size — длина, width — ширина), cube (size — ребро),
//   aura (исходит от заклинателя и ходит вместе с ним, size — радиус), target (цели), size, width — в футах;
//   range — дистанция в футах (0 — от себя), save — характеристика спасброска, half — половина урона при успехе,
//   pick — заклинатель выбирает, кого область не трогает (союзников), act — action | bonus | reaction.
// Длительность и концентрация — из листа (поля d и cn); область держится на поле, пока они длятся.
// zone — постоянная область, которая срабатывает снова:
//   trig — когда: 'enter' (существо входит впервые за ход или область накрывает его), 'start' (начинает ход в ней),
//     'end' (заканчивает ход в ней); существо проходит это не чаще раза за ход;
//   dmg — кости урона при срабатывании (если не задано — те же, что при сотворении, с учётом ячейки), dtype;
//   noSave — урон без спасброска; fail — что получает провалившая спасбросок цель (как в SPELL_FX стола);
//   move — 'bonus' (бонусным действием до moveFt) или 'auto' (сама уходит на autoFt от заклинателя в начале его хода);
//   difficult — труднопроходима (для тех, кого задевает); perCell — урон за каждые 5 фт перемещения внутри (без спасброска);
//   obscure — 'heavy' | 'light' (сильно/слабо заслонено), dark — магическая тьма, silence — тишина (блок 3).
// wall — стена из клеток (shape: 'wall'): len — наибольшая длина в футах; modes — как ставить: 'line' (прямая), 'path' (ломаная
//   из соседних участков), 'ring' (кольцо диаметром ring фт); block — непроходима (и полное укрытие), opaque — заслоняет обзор и свет,
//   cover — укрытие для атак сквозь неё (+2/+5), difficult — сквозь неё — как по труднопроходимой, side — одна сторона опасна на
//   side фт (выбирает заклинатель), wind — дальнобойные атаки оружием сквозь неё отклоняются, hp/ac — прочность участка (5 фт),
//   permanent — если концентрация продержалась всё время, стена остаётся навсегда, style — как рисовать, prism — радужные слои
// Ещё: upSize — область растёт на столько футов за каждый уровень ячейки выше; persist — остаётся на поле, пока её не уберут;
//   leave — после мгновенного заклинания остаётся след { n, difficult, rounds } (лёд после Града);
//   shape 'multi' — несколько частей: part { shape, size }, nParts, contiguous (части касаются друг друга);
//   zone.trig 'cstart' — в начале хода заклинателя срабатывает для всех внутри (Землетрясение);
//   zone.restrike — действием (act) можно ударить снова: та же форма в пределах moveFt от первой точки (Призыв молнии) или от себя (Солнечный луч);
//   zone.concCheck — начавшие ход внутри проверяют концентрацию (Метель); fail.rounds — эффект провала на столько раундов
// Блок 4. shape 'atk' — атака заклинанием с ячейкой: dmg — кости одного попадания, up — плюс за уровень ячейки, rays/upRays — лучей
//   (каждый — отдельная атака), distinct — каждой цели не больше одного, onHit — эффект попавшей атаки (vex1 — следующая атака по цели
//   с преимуществом), drain — заклинатель лечится на половину урона, melee — рукопашная атака заклинанием (5 фт);
// darts — дротики «Волшебной стрелы» (+1 за уровень): цели можно повторять, каждый попадает; chain — цепь: первая цель и до n других
//   в chainFt от неё (+1 за уровень); shape 'tp' — телепорт на range фт, passenger — можно взять соседнего союзника;
// shape 'summon' — призыв токеном: summon { n, ic, size, ac, hp, speed, fly, invul (неуязвим, без хитов), atk: [{ n, dmg, type, reach, range }],
//   multi, cmdBonus (атака — бонусным действием заклинателя), atkOnCast (сразу атакует при сотворении), aura (область от призванного — как zone + save/dmg/up/dtype/size/pick, cap — всего урона,
//   после которого исчезает), forms (выбор вида из бестиария, англ. названия), count/upCount (сколько существ). В статах: L — уровень ячейки,
//   M — модификатор заклинательной характеристики; попадание — бонус атаки заклинаниями заклинателя
const SPELL_MECH = {
  'Scorching Ray': { shape: 'atk', rays: 3, upRays: 1, dmg: '2d6', dtype: 'огнём' },
  'Guiding Bolt': { shape: 'atk', dmg: '4d6', up: '1d6', dtype: 'излучением', onHit: { n: 'Отмечен светом', ic: '✨', vex1: true, rounds: 1 } },
  'Chromatic Orb': { shape: 'atk', dmg: '3d8', up: '1d8', dtype: 'стихией (на выбор)' },
  'Ray of Sickness': { shape: 'atk', dmg: '2d8', up: '1d8', dtype: 'ядом', onHit: { n: 'Тошнота', ic: '🤢', cond: 'poisoned', rounds: 1 } },
  'Witch Bolt': { shape: 'atk', dmg: '2d12', up: '1d12', dtype: 'электричеством' },
  "Melf's Acid Arrow": { shape: 'atk', dmg: '4d4', up: '1d4', dtype: 'кислотой', miss: 'half' },
  'Vampiric Touch': { shape: 'atk', melee: true, dmg: '3d6', up: '1d6', dtype: 'некротической энергией', drain: 'half' },
  'Steel Wind Strike': { shape: 'atk', melee: true, rays: 5, distinct: true, dmg: '6d10', dtype: 'силовым полем', range: 30 },
  // Области, которые описание не задаёт явно: волна вокруг себя, сфера 60 фт, конус 60 фт (тип луча — по броску, урон стихией)
  'Destructive Wave': { shape: 'aura', size: 30, save: 'con', half: true, pick: true, dtype: 'звуком и излучением' },
  'Sunburst': { shape: 'sphere', size: 60, range: 150, save: 'con', half: true, dtype: 'излучением' },
  'Prismatic Spray': { shape: 'cone', size: 60, range: 0, save: 'dex', half: true, dtype: 'стихией (по цвету луча)' },
  'Magic Missile': { shape: 'target', darts: 3, dmg: '1d4+1', dtype: 'силовым полем', range: 120 },
  'Chain Lightning': { shape: 'target', save: 'dex', half: true, chain: { n: 3, ft: 30 }, dtype: 'электричеством', range: 150 },
  'Misty Step': { shape: 'tp', range: 30, act: 'bonus' },
  'Dimension Door': { shape: 'tp', range: 500, passenger: true },
  // Иллюзии: токен, который другие видят как настоящий; изучение (Анализ против СЛ заклинателя) или удар раскрывают
  'Silent Image': { shape: 'summon', range: 60, summon: { n: 'Иллюзия', invul: true, illus: true, speed: 15 } },
  'Major Image': { shape: 'summon', range: 120, summon: { n: 'Иллюзия', invul: true, illus: true, speed: 30 } },
  // Призывы
  'Spiritual Weapon': { shape: 'summon', range: 60, summon: { n: 'Духовное оружие', ic: '🗡', invul: true, fly: true, speed: 20, cmdBonus: true, atkOnCast: true, atk: [{ n: 'Удар', dmg: '1d8+M', up: '1d8', type: 'силовым полем', reach: 5 }] } },
  'Flaming Sphere': { shape: 'summon', range: 60, summon: { n: 'Пылающий шар', ic: '🔥', invul: true, speed: 30,
    aura: { size: 5, save: 'dex', half: true, dmg: '2d6', up: '1d6', dtype: 'огнём', trig: ['end'] } } },
  'Guardian of Faith': { shape: 'summon', range: 30, summon: { n: 'Страж веры', ic: '🛡', invul: true, size: 2, speed: 0,
    aura: { size: 10, save: 'dex', half: true, dmg: '20', dtype: 'излучением', trig: ['enter', 'start'], pick: true, cap: 60 } } },
  'Minor Illusion': { shape: 'summon', range: 30, summon: { n: 'Малая иллюзия', ic: '🪞', invul: true, illus: true, speed: 0 } },
  'Mage Hand': { shape: 'summon', range: 30, summon: { n: 'Волшебная рука', ic: '✋', invul: true, fly: true, speed: 30 } },
  'Find Familiar': { shape: 'summon', range: 10, summon: { forms: ['Owl', 'Cat', 'Bat', 'Raven', 'Hawk', 'Spider', 'Frog', 'Rat', 'Weasel', 'Crab', 'Lizard', 'Octopus', 'Poisonous Snake'], noAtk: true } },
  'Find Steed': { shape: 'summon', range: 30, summon: { n: 'Потусторонний скакун', ic: '🐎', size: 2, ac: '10+L', hp: '5+10*L', speed: 60, atk: [{ n: 'Удар копытом', dmg: '1d8+L', type: 'дробящим', reach: 5 }] } },
  'Animate Dead': { shape: 'summon', range: 10, summon: { forms: ['Skeleton', 'Zombie'], count: 1, upCount: 2 } },
  'Summon Beast': { shape: 'summon', range: 90, summon: { n: 'Дух зверя', ic: '🐾', ac: '11+L', hp: '20+5*(L-2)', speed: 30, multi: 'L/2', atk: [{ n: 'Укус', dmg: '1d8+4+L', type: 'колющим', reach: 5 }] } },
  'Summon Fey': { shape: 'summon', range: 90, summon: { n: 'Дух феи', ic: '🧚', ac: '12+L', hp: '30+10*(L-3)', speed: 30, multi: 'L/2', atk: [{ n: 'Клинок фей', dmg: '2d6+3+L', type: 'силовым полем', reach: 5 }] } },
  'Summon Undead': { shape: 'summon', range: 90, summon: { n: 'Дух нежити', ic: '💀', ac: '11+L', hp: '30+10*(L-3)', speed: 30, fly: true, multi: 'L/2', atk: [{ n: 'Смертельное касание', dmg: '1d8+3+L', type: 'некротической энергией', reach: 5 }] } },
  'Summon Aberration': { shape: 'summon', range: 90, summon: { n: 'Дух аберрации', ic: '👁', ac: '11+L', hp: '40+10*(L-4)', speed: 30, multi: 'L/2', atk: [{ n: 'Психический удар', dmg: '1d8+3+L', type: 'психической энергией', reach: 5 }] } },
  'Summon Construct': { shape: 'summon', range: 90, summon: { n: 'Дух конструкта', ic: '🤖', ac: '13+L', hp: '40+15*(L-4)', speed: 30, multi: 'L/2', atk: [{ n: 'Удар', dmg: '1d8+4+L', type: 'дробящим', reach: 5 }] } },
  'Summon Elemental': { shape: 'summon', range: 90, summon: { n: 'Дух стихии', ic: '🌪', size: 2, ac: '11+L', hp: '50+10*(L-4)', speed: 40, multi: 'L/2', atk: [{ n: 'Удар', dmg: '1d10+4+L', type: 'дробящим', reach: 5 }] } },
  'Summon Celestial': { shape: 'summon', range: 90, summon: { n: 'Дух небожителя', ic: '😇', size: 2, ac: '11+L', hp: '40+10*(L-5)', speed: 30, fly: true, multi: 'L/2', atk: [{ n: 'Лучистый лук', dmg: '2d6+2+L', type: 'излучением', range: '150/600' }] } },
  'Summon Dragon': { shape: 'summon', range: 60, summon: { n: 'Дух дракона', ic: '🐉', size: 2, ac: '14+L', hp: '50+10*(L-5)', speed: 30, fly: true, multi: 'L/2', atk: [{ n: 'Когти', dmg: '1d6+4+L', type: 'колющим', reach: 10 }] } },
  'Summon Fiend': { shape: 'summon', range: 90, summon: { n: 'Дух исчадия', ic: '😈', size: 2, ac: '12+L', hp: '50+15*(L-6)', speed: 40, multi: 'L/2', atk: [{ n: 'Укус', dmg: '1d12+3+L', type: 'некротической энергией', reach: 5 }] } },
  'Giant Insect': { shape: 'summon', range: 60, summon: { n: 'Гигантское насекомое', ic: '🕷', size: 2, ac: '11+L', hp: '30+10*(L-4)', speed: 40, multi: 'L/2', atk: [{ n: 'Ядовитый укус', dmg: '1d6+3+L', type: 'колющим', reach: 5 }] } },
  "Bigby's Hand": { shape: 'summon', range: 120, summon: { n: 'Рука Бигби', ic: '✊', size: 2, ac: '20', hp: 'HP', speed: 60, cmdBonus: true, atkOnCast: true, atk: [{ n: 'Сжатый кулак', dmg: '5d8', up: '2d8', type: 'силовым полем', reach: 5 }] } },
  "Mordenkainen's Sword": { shape: 'summon', range: 90, summon: { n: 'Меч Морденкайнена', ic: '⚔', invul: true, speed: 30, fly: true, cmdBonus: true, atkOnCast: true, atk: [{ n: 'Удар', dmg: '4d12+M', type: 'силовым полем', reach: 5 }] } },
  "Mordenkainen's Faithful Hound": { shape: 'summon', range: 30, summon: { n: 'Верный пёс', ic: '🐕', invul: true, speed: 0, atk: [{ n: 'Укус', dmg: '4d8', type: 'колющим', reach: 5 }] } },
  // Призыв животных (2024): стая призрачных зверей; кто входит в 10 фт от неё или заканчивает там ход — Ловкость, 3к10 рубящего
  'Conjure Animals': { shape: 'summon', range: 60, summon: { n: 'Стая духов', ic: '🐺', invul: true, size: 2, speed: 30,
    aura: { size: 10, save: 'dex', half: true, dmg: '3d10', up: '1d10', dtype: 'рубящим', trig: ['enter', 'end'], pick: true } } },
  // Призыв лесных обитателей (2024): духи природы вокруг вас 10 фт — Мудрость, 5к8 силовым полем
  'Conjure Woodland Beings': { shape: 'aura', size: 10, save: 'wis', half: true, pick: true, dtype: 'силовым полем', zone: { trig: ['enter', 'end'] } },
  // Туманное облако: сфера 20 фт (+20 за уровень), сильно заслонено — сквозь неё не видно
  'Fog Cloud': { shape: 'sphere', size: 20, upSize: 20, range: 120, zone: { trig: [], obscure: 'heavy' } },
  // Тьма: сфера 15 фт магической тьмы — гасит свет, тёмное зрение не помогает
  'Darkness': { shape: 'sphere', size: 15, range: 60, zone: { trig: [], dark: true, obscure: 'heavy' } },
  // Области, которые описание не даёт разобрать: сфера, спасбросок, вид урона
  'Vitriolic Sphere': { shape: 'sphere', size: 20, range: 150, save: 'dex', half: true, dtype: 'кислотой' },
  'Synaptic Static': { shape: 'sphere', size: 20, range: 120, save: 'int', half: true, dtype: 'психической энергией' },
  'Weird': { shape: 'sphere', size: 30, range: 120, save: 'wis', half: true, dtype: 'психической энергией' },
  'Delayed Blast Fireball': { shape: 'sphere', size: 20, range: 150, save: 'dex', half: true, dtype: 'огнём' },
  'Contagion': { shape: 'target', range: 5, save: 'con', dtype: 'некротической энергией' },
  'Heat Metal': { shape: 'target', range: 60, dtype: 'огнём' },
  "Yolande's Regal Presence": { shape: 'aura', size: 10, save: 'wis', half: true, pick: true, dtype: 'психической энергией',
    zone: { trig: ['enter', 'end'], fail: { n: 'Царственное присутствие', cond: 'prone', once: true } } },
  "Jallarzi's Storm of Radiance": { shape: 'sphere', size: 10, range: 120, save: 'con', half: true, dtype: 'излучением',
    zone: { trig: ['enter', 'end'], fail: { n: 'Буря сияния', ic: '☀', cond: 'blinded', rounds: 1 } } },
  // Ауры-благословения: ходят с заклинателем, действуют на его союзников внутри (zone.buff):
  // saveAdv — преимущество на спасброски, atkDis — атаки по ним с помехой, dmgDie — +кость к урону оружием, resist — сопротивление
  'Holy Aura': { shape: 'aura', size: 30, zone: { trig: [], buff: { saveAdv: true, atkDis: true } } },
  'Circle of Power': { shape: 'aura', size: 30, zone: { trig: [], buff: { saveAdv: true } } },
  "Crusader's Mantle": { shape: 'aura', size: 30, zone: { trig: [], buff: { dmgDie: '1d4' } } },
  'Aura of Life': { shape: 'aura', size: 30, zone: { trig: [], buff: { resist: ['necrotic'] } } },
  'Aura of Vitality': { shape: 'aura', size: 30, zone: { trig: [] } },
  // Обнаружение магии: заклинатель чувствует магию в 30 фт — магические существа, эффекты, предметы подсвечены; иллюзии видны как иллюзии
  'Detect Magic': { shape: 'aura', size: 30, zone: { trig: [], detect: true } },
  // Глиф оберегания: скрытый глиф в клетке; враг входит — взрыв сферой 20 фт, спасбросок Ловкости, урон выбранной стихией
  'Glyph of Warding': { shape: 'cube', size: 5, range: 5, save: 'dex', half: true, glyph: { size: 20 },
    choose: [['кислотой', 'кислота'], ['холодом', 'холод'], ['огнём', 'огонь'], ['электричеством', 'электричество'], ['звуком', 'звук']] },
  // Дневной свет: сфера 60 фт яркого света и ещё 60 фт тусклого; рассеивает Тьму 3 уровня и ниже, которую задевает
  'Daylight': { shape: 'sphere', size: 60, range: 60, light: { b: 60, d: 60 }, dispel: 3, zone: { trig: [] } },
  // Пляшущие огоньки: четыре огонька, каждый — тусклый свет 10 фт; летают, ходить не мешают
  'Dancing Lights': { shape: 'summon', range: 120, summon: { n: 'Огонёк', ic: '✨', invul: true, fly: true, speed: 60, count: 4, lt: { b: 0, d: 10 }, ghost: true } },
  // Тишина: сфера 20 фт — внутри нельзя творить заклинания со словесным компонентом
  'Silence': { shape: 'sphere', size: 20, range: 120, zone: { trig: [], silence: true } },
  // Метель: цилиндр радиусом 40 фт — сильно заслонено, труднопроходимо; вход и начало хода — Ловкость или падает; концентрация под угрозой
  'Sleet Storm': { shape: 'sphere', size: 40, range: 150, save: 'dex',
    zone: { trig: ['enter', 'start'], obscure: 'heavy', difficult: true, concCheck: true, fail: { n: 'Скольжение', cond: 'prone', once: true } } },
  // Град: цилиндр радиусом 20 фт, 2к10 дробящего + 4к6 холодом; земля — труднопроходима до конца следующего хода заклинателя
  'Ice Storm': { shape: 'sphere', size: 20, range: 300, save: 'dex', half: true, dtype: 'дробящим и холодом', leave: { n: 'Лёд после града', difficult: true, rounds: 1 } },
  // Рост растений: всё в радиусе 100 фт зарастает — труднопроходимо, пока не расчистят
  'Plant Growth': { shape: 'sphere', size: 100, range: 150, persist: true, zone: { trig: [], difficult: true } },
  // Огненная буря: до десяти кубов по 10 фт, каждый касается другого; Ловкость, 7к10 огнём
  'Fire Storm': { shape: 'multi', part: { shape: 'cube', size: 10 }, nParts: 10, contiguous: true, range: 150, save: 'dex', half: true, dtype: 'огнём' },
  // Метеоритный дождь: четыре сферы по 40 фт; кто в нескольких — урон один раз
  'Meteor Swarm': { shape: 'multi', part: { shape: 'sphere', size: 40 }, nParts: 4, range: 5280, save: 'dex', half: true, dtype: 'огнём и дробящим' },
  // Землетрясение: радиус 100 фт; в начале каждого хода заклинателя все на земле внутри — Ловкость или падают; труднопроходимо
  'Earthquake': { shape: 'sphere', size: 100, range: 500, save: 'dex',
    zone: { trig: ['cstart'], difficult: true, concCheck: true, fail: { n: 'Землетрясение', cond: 'prone', once: true } } },
  // Призыв молнии: удар радиусом 5 фт — 3к10 электричеством; потом действием — снова, в пределах 60 фт
  'Call Lightning': { shape: 'sphere', size: 5, range: 120, save: 'dex', half: true, dtype: 'электричеством', zone: { trig: [], restrike: true, act: 'action', moveFt: 60 } },
  // Солнечный луч: линия 60 фт от себя, Телосложение — 6к8 излучением и слепота до следующего хода; действием — снова
  'Sunbeam': { shape: 'line', size: 60, width: 5, range: 0, save: 'con', half: true, dtype: 'излучением',
    zone: { trig: [], restrike: true, act: 'action', self: true, fail: { n: 'Ослеплён солнцем', ic: '☀', cond: 'blinded', rounds: 1 } } },
  // Стена огня: прямая до 60 фт или кольцо диаметром 20 фт; непрозрачна; при появлении — спасбросок Ловкости 5к8;
  // одна сторона жжёт тех, кто заканчивает ход в 10 фт от неё или в стене, и тех, кто входит в стену — 5к8 без спасброска
  'Wall of Fire': { shape: 'wall', range: 120, save: 'dex', half: true, dtype: 'огнём',
    wall: { len: 60, ring: 20, modes: ['line', 'ring'], opaque: true, side: 10, style: 'fire' }, zone: { trig: ['enter', 'end'], noSave: true } },
  // Терновая стена: 60 фт или кольцо 20 фт; заслоняет обзор; сквозь неё — вчетверо медленнее (здесь — как труднопроходимая);
  // вошёл или закончил ход в ней — спасбросок Ловкости, 7к8 колющего
  'Wall of Thorns': { shape: 'wall', range: 120, save: 'dex', half: true, dtype: 'колющим',
    wall: { len: 60, ring: 20, modes: ['line', 'ring'], opaque: true, difficult: true, style: 'thorns' }, zone: { trig: ['enter', 'end'], difficult: true } },
  // Стена клинков: 100 фт или кольцо 60 фт; укрытие на три четверти, труднопроходима; вход или конец хода в ней — Ловкость, 6к10
  'Blade Barrier': { shape: 'wall', range: 90, save: 'dex', half: true, dtype: 'рубящим',
    wall: { len: 100, ring: 60, modes: ['line', 'ring'], cover: 5, difficult: true, style: 'blades' }, zone: { trig: ['enter', 'end'], difficult: true } },
  // Стена силы: до 10 панелей 10×10 фт подряд или купол; непроницаема, неразрушима обычным оружием
  'Wall of Force': { shape: 'wall', range: 120, wall: { len: 100, ring: 20, modes: ['path', 'ring'], block: true, style: 'force' } },
  // Каменная стена: 10 панелей 10×10 фт подряд, непрозрачна; участок — КД 15, 180 хитов; продержал концентрацию — навсегда
  'Wall of Stone': { shape: 'wall', range: 120, wall: { len: 100, modes: ['path'], block: true, opaque: true, style: 'stone', hp: 180, ac: 15, permanent: true } },
  // Ледяная стена: панели 10×10 фт или купол; при появлении — Ловкость, 10к6 холодом; участок — КД 12, 30 хитов
  'Wall of Ice': { shape: 'wall', range: 120, save: 'dex', half: true, dtype: 'холодом',
    wall: { len: 100, ring: 20, modes: ['path', 'ring'], block: true, style: 'ice', hp: 30, ac: 12 } },
  // Стена ветров: 50 фт по земле; при появлении — Сила, 4к8 дробящего; дальнобойные атаки оружием сквозь неё отклоняются
  'Wind Wall': { shape: 'wall', range: 120, save: 'str', half: true, dtype: 'дробящим', wall: { len: 50, modes: ['path'], wind: true, style: 'wind' } },
  // Радужная стена: 90 фт или сфера 30 фт; непрозрачна; кто входит — спасброски против каждого из семи слоёв
  'Prismatic Wall': { shape: 'wall', range: 60, wall: { len: 90, ring: 30, modes: ['line', 'ring'], opaque: true, style: 'prism', prism: true }, zone: { trig: ['enter'], prism: true } },
  // Духовные стражи: аура 15 фт, союзников заклинатель исключает; скорость остальных вдвое меньше
  'Spirit Guardians': { shape: 'aura', size: 15, save: 'wis', half: true, pick: true, dtype: 'излучением',
    zone: { trig: ['enter', 'end'], difficult: true } },
  // Лунный луч: цилиндр радиусом 5 фт; бонусным действием сдвигается на 60 фт
  'Moonbeam': { shape: 'sphere', size: 5, range: 120, save: 'con', half: true, dtype: 'излучением',
    zone: { trig: ['enter', 'end'], move: 'bonus', moveFt: 60 } },
  // Облако смерти: сфера 20 фт, сильно заслонено, само уходит на 10 фт от заклинателя в начале его хода
  'Cloudkill': { shape: 'sphere', size: 20, range: 120, save: 'con', half: true, dtype: 'ядом',
    zone: { trig: ['enter', 'end'], move: 'auto', autoFt: 10, obscure: 'heavy' } },
  // Испепеляющее облако: то же, урон огнём, спасбросок Ловкости
  'Incendiary Cloud': { shape: 'sphere', size: 20, range: 150, save: 'dex', half: true, dtype: 'огнём',
    zone: { trig: ['enter', 'end'], move: 'auto', autoFt: 10, obscure: 'heavy' } },
  // Зловонное облако: без урона; начал ход внутри — спасбросок Телосложения, иначе отравлен и без действий до конца хода
  'Stinking Cloud': { shape: 'sphere', size: 20, range: 90, save: 'con',
    zone: { trig: ['start'], obscure: 'heavy', fail: { n: 'Тошнота', ic: '🤢', cond: 'poisoned', cond2: 'incapacitated', eot: true } } },
  // Облако кинжалов: куб 5 фт, 4к4 рубящего без спасброска
  'Cloud of Daggers': { shape: 'cube', size: 5, range: 60, dtype: 'рубящим', zone: { trig: ['enter', 'end'], noSave: true } },
  // Нашествие насекомых: сфера 20 фт, слабо заслонено, труднопроходимо
  'Insect Plague': { shape: 'sphere', size: 20, range: 300, save: 'con', half: true, dtype: 'колющим',
    zone: { trig: ['enter', 'end'], difficult: true, obscure: 'light' } },
  // Чёрные щупальца Эварда: квадрат 20 фт, труднопроходимо; спасбросок Силы — урон и опутан
  "Evard's Black Tentacles": { shape: 'cube', size: 20, range: 90, save: 'str', dtype: 'дробящим',
    zone: { trig: ['enter', 'start'], difficult: true, fail: { n: 'Щупальца', ic: '🐙', cond: 'restrained' } } },
  // Паутина: куб 20 фт, труднопроходимо, слабо заслонено; спасбросок Ловкости — опутан
  'Web': { shape: 'cube', size: 20, range: 60, save: 'dex',
    zone: { trig: ['enter', 'start'], difficult: true, obscure: 'light', fail: { n: 'Паутина', ic: '🕸', cond: 'restrained' } } },
  // Слизь: квадрат 10 фт, труднопроходимо; вошёл или закончил ход — спасбросок Ловкости, иначе падает
  'Grease': { shape: 'cube', size: 10, range: 60, save: 'dex',
    zone: { trig: ['enter', 'end'], difficult: true, fail: { n: 'Скольжение', cond: 'prone', once: true } } },
  // Опутывание: квадрат 20 фт, труднопроходимо; спасбросок Силы только при сотворении
  'Entangle': { shape: 'cube', size: 20, range: 90, save: 'str', zone: { trig: [], difficult: true } },
  // Голод Хадара: сфера 20 фт тьмы; начал ход — 2к6 холодом, закончил — спасбросок Ловкости или 2к6 кислотой
  'Hunger of Hadar': { shape: 'sphere', size: 20, range: 150, save: 'dex',
    zone: { trig: ['start', 'end'], startDmg: '2d6', startType: 'холодом', dmg: '2d6', dtype: 'кислотой', difficult: true, obscure: 'heavy', dark: true } },
  // Рост шипов: сфера 20 фт, труднопроходимо, 2к4 колющего за каждые 5 фт перемещения
  'Spike Growth': { shape: 'sphere', size: 20, range: 150, dtype: 'колющим', zone: { trig: [], difficult: true, perCell: '2d4', dtype: 'колющим' } },
};
