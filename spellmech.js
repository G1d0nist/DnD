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
const SPELL_MECH = {
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
