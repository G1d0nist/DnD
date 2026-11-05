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
const SPELL_MECH = {
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
