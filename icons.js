'use strict';
// Набор иконок интерфейса (SVG-спрайт). В разметке: <svg class="ic"><use href="#i-имя"/></svg>,
// в коде: ic('имя') возвращает ту же строку. Рисунок — контур 24×24, цвет берётся из currentColor.
// Эмодзи, которые выводят app.js и table.js, на лету заменяются этими иконками (EMOJI_IC ниже);
// остальные эмодзи заворачиваются в <span class="emo"> и приглушаются под общую палитру.
const ICONS = {
  sword: '<path d="M20 4l-.6 4.4-8.7 8.7-3.8-3.8L15.6 4.6z"/><path d="M5.2 12.4l6.4 6.4M8.4 15.6L4 20"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 15.5V4.5M7 9l5-5 5 5M5 20h14"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="3.5" y="9" width="17" height="7.5" rx="2"/><path d="M7 14h10v6H7z"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6 7l1 13h10l1-13M10 11v5.5M14 11v5.5"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.4 3.4 0 0 0 7 18.5z"/>',
  undo: '<path d="M9 14.5L4 9.5l5-5"/><path d="M4 9.5h10a5.5 5.5 0 0 1 0 11h-3"/>',
  campfire: '<path d="M12 3c2.6 3 4 4.7 4 7.3a4 4 0 0 1-8 0c0-1.6.8-2.9 1.9-3.9.2 1.3.9 2.1 1.9 2.4C11 7 11.3 5 12 3z"/><path d="M4.5 20.5l15-4M4.5 16.5l15 4"/>',
  moon: '<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/><path d="M17 4l.5 1.5L19 6l-1.5.5L17 8l-.5-1.5L15 6l1.5-.5z"/>',
  map: '<path d="M3 6.5l6-2.5 6 2.5 6-2.5v14l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v14M15 6.5v14"/>',
  d20: '<path d="M12 2.5l8.5 4.9v9.2L12 21.5l-8.5-4.9V7.4z"/><path d="M12 7l4.6 7.6H7.4z"/><path d="M12 2.5V7M3.5 7.4l3.9 7.2M20.5 7.4l-3.9 7.2M7.4 14.6l-3.9 2M16.6 14.6l3.9 2M7.4 14.6L12 21.5l4.6-6.9"/>',
  quill: '<path d="M19.5 4.5C13 5 8.6 9 7 15.5L5 20"/><path d="M19.5 4.5c-.5 6.5-5 10.6-11.6 11.1M11 12.5l2.5 2"/>',
  levelup: '<path d="M7 12l5-5 5 5M7 18l5-5 5 5"/><path d="M6 4h12"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5c.8-4 3.6-6.2 7-6.2s6.2 2.2 7 6.2"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c.6-3.4 3-5.3 6-5.3s5.4 1.9 6 5.3M15.5 4.9a3.2 3.2 0 0 1 0 6.2M17.5 14.4c1.9.6 3.2 2.4 3.5 5.1"/>',
  refresh: '<path d="M19.5 11A7.6 7.6 0 0 0 5.6 7M4.5 3.5V7.5h4"/><path d="M4.5 13a7.6 7.6 0 0 0 13.9 4M19.5 20.5v-4h-4"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8-7.5 9.5-4.3-1.5-7.5-4.9-7.5-9.5V6z"/>',
  boot: '<path d="M8 3.5h6v8l5.2 2.6A2.6 2.6 0 0 1 20.5 16.4V19H5.5c-.3-3.6.6-6 2.5-7.5z"/><path d="M5.5 16h15"/>',
  sparkle: '<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8z"/><path d="M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  bag: '<path d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path d="M6 8h12l1.3 12.5H4.7z"/><path d="M9.5 12.5h5"/>',
  book: '<path d="M5 4.5h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17.5a3 3 0 0 1 3-3h11M9 8.5h6"/>',
  scroll: '<path d="M7 4h11a2 2 0 0 1 2 2v1.5h-4"/><path d="M16 6v12.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V17h10"/><path d="M7 4a2 2 0 0 0-2 2v11M8.5 9h4.5M8.5 12.5h4.5"/>',
  crossed: '<path d="M4 4l6.5 6.5M4 4h3.5M4 4v3.5M20 4l-16 16M20 4h-3.5M20 4v3.5"/><path d="M14 14l6 6M17 17l-1.8 1.8M17 17l1.8-1.8"/>',
  hourglass: '<path d="M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 4.8 4.5 5.5 4.5 8.5s-4.5 3.7-4.5 8.5M16.5 3.5c0 4.8-4.5 5.5-4.5 8.5s4.5 3.7 4.5 8.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
  warning: '<path d="M12 3.5l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  paw: '<circle cx="6.8" cy="10.2" r="1.8"/><circle cx="9.8" cy="5.9" r="1.8"/><circle cx="14.2" cy="5.9" r="1.8"/><circle cx="17.2" cy="10.2" r="1.8"/><path d="M12 12c-3 0-5.5 3.2-5.5 5.5 0 1.6 1.3 2.5 2.8 2.5 1 0 1.7-.5 2.7-.5s1.7.5 2.7.5c1.5 0 2.8-.9 2.8-2.5 0-2.3-2.5-5.5-5.5-5.5z"/>',
  skull: '<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5c0 2.6 1.3 4.4 3 5.4v3.6h9v-3.6c1.7-1 3-2.8 3-5.4A7.5 7.5 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.6"/><circle cx="15" cy="11" r="1.6"/><path d="M10.5 19.5v-2M13.5 19.5v-2M12 13.5l-.8 1.5h1.6z"/>',
  coins: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  note: '<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.6 2.6-5.7 3.9-9.3 1.5 1.6 2 3.2 1.8 4.9 1.3-1 2.3-2.6 2.4-4.4 2.9 2.3 4.9 5.3 4.9 8.8 0 3.6-2.6 6.2-6.5 6.2z"/><path d="M12 21c-1.6 0-2.7-1.1-2.7-2.6 0-1.6 1.3-2.6 2.7-4.4 1.4 1.8 2.7 2.8 2.7 4.4 0 1.5-1.1 2.6-2.7 2.6z"/>',
  bolt: '<path d="M13.5 2.5L5 13.5h6l-1 8 8.5-11h-6z"/>',
  swirl: '<path d="M12 12a2 2 0 1 1 2-2c0 2.8-2.5 4.5-5 4.5A4.5 4.5 0 0 1 4.5 10 7.5 7.5 0 0 1 12 2.5a9.5 9.5 0 0 1 9.5 9.5A9.5 9.5 0 0 1 12 21.5"/>',
  door: '<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M4 21h16"/><circle cx="15" cy="12.5" r=".9"/>',
  crown: '<path d="M4 17.5L3 7.5l5 4 4-7 4 7 5-4-1 10z"/><path d="M4 21h16"/>',
  orb: '<circle cx="12" cy="10.5" r="6.5"/><path d="M7.5 21h9l-1.5-3.5H9zM9.5 8A3 3 0 0 1 12 6.5"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  leaf: '<path d="M5 19C5 10 10 5 20 4c-.5 10-5.5 15-14 15z"/><path d="M5 19l8-8"/>',
  ladder: '<path d="M7 3v18M17 3v18M7 7.5h10M7 12h10M7 16.5h10"/>',
  fog: '<path d="M4 7.5h12M7 11.5h13M3 15.5h10M15.5 15.5h5M6 19.5h9"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.8-1.3"/>',
  gear: '<path d="M12 2.5l1.6 2.3 2.7-.8.5 2.8 2.7.9-.8 2.7L21.5 12l-2.3 1.6.8 2.7-2.8.5-.9 2.7-2.7-.8L12 21.5l-1.6-2.3-2.7.8-.5-2.8-2.7-.9.8-2.7L2.5 12l2.3-1.6-.8-2.7 2.8-.5.9-2.7 2.7.8z"/><circle cx="12" cy="12" r="3"/>',
  bow: '<path d="M5 3.5c8 1 14.5 7.5 15.5 15.5M5 3.5L20.5 19"/><path d="M3.5 20.5l10-10M13.5 10.5l-3.4.4M13.5 10.5l-.4 3.4M3.5 20.5l.4-2.4M3.5 20.5l2.4-.4"/>',
  potion: '<path d="M9.5 3h5M10 3v5.5L5.3 17a2.7 2.7 0 0 0 2.4 4h8.6a2.7 2.7 0 0 0 2.4-4L14 8.5V3"/><path d="M7 14.5h10"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17.5l5-5 4 4 2.5-2.5 5 4.5"/>',
  wall: '<rect x="3" y="5" width="18" height="14"/><path d="M3 9.7h18M3 14.3h18M9 5v4.7M15 5v4.7M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6M9 14.3V19M15 14.3V19"/>',
  dagger: '<path d="M19.5 4.5L19 8l-6.5 6.5-3-3L16 5z"/><path d="M7.5 10l6.5 6.5M9.5 14.5L5 19"/><circle cx="4.5" cy="19.5" r="1"/>',
  wave: '<path d="M3 9c2 0 2-2 4.5-2S9.5 9 12 9s2.5-2 4.5-2 2.5 2 4.5 2M3 14c2 0 2-2 4.5-2s2 2 4.5 2 2.5-2 4.5-2 2.5 2 4.5 2M3 19c2 0 2-2 4.5-2s2 2 4.5 2 2.5-2 4.5-2 2.5 2 4.5 2"/>',
  forbid: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 6.5l2.5-2M9.5 19.5L12 17.5l2.5 2"/>',
  chest: '<path d="M4 10h16v9.5H4zM4 10V8.5A4.5 4.5 0 0 1 8.5 4h7A4.5 4.5 0 0 1 20 8.5V10"/><path d="M10.5 10v3h3v-3"/>',
  burst: '<path d="M12 2.5l1.8 5.4 5.2-2.6-2.6 5.2 5.4 1.8-5.4 1.8 2.6 5.2-5.2-2.6L12 21.5l-1.8-5.4-5.2 2.6 2.6-5.2L2.5 12l5.4-1.8L5.3 5l5.2 2.6z"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.5M9.5 10h.5M13 10h.5M16.5 10h1M6.5 14.5h11"/>',
  castle: '<path d="M3 21V8h3v2h2V8h3v2h2V8h3v2h2V8h3v13z"/><path d="M10 21v-4a2 2 0 0 1 4 0v4"/>',
  tent: '<path d="M12 4L2.5 20h19z"/><path d="M9 20l3-6 3 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.6 5.3 3.6 8.5s-1.1 6-3.6 8.5c-2.5-2.5-3.6-5.3-3.6-8.5S9.5 6 12 3.5z"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  ruler: '<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7.5 12l2 2M10.5 9l1.5 1.5M13.5 6l2 2"/>',
  bulb: '<path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1.9 1.8v1.8h5.2v-1.8c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3z"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  save: '<path d="M5 3.5h11.5l4 4v13H5z"/><path d="M8 3.5v5h8v-5"/><rect x="8" y="13" width="8" height="7.5"/>',
  tree: '<path d="M12 3l5.5 7.5h-2.7L19 16H5l4.2-5.5H6.5z"/><path d="M12 16v5"/>',
  mountain: '<path d="M2.5 19.5L9 8l3.5 6 2.5-4 6.5 9.5z"/><path d="M7.4 10.8l1.6 1.2 1.5-1.4"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.9M12 17v.3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.7v.3"/>',
  house: '<path d="M4 11l8-7 8 7M6 9.5V20h12V9.5M10 20v-5h4v5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5M14 10.5V5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.6 0-4.2-1.3-5.6-3.6L3.8 14.7a1.4 1.4 0 0 1 2.3-1.6L8 15"/>',
};
// Эмодзи → иконка (класс ic-<имя> даёт иконке свой цвет в theme.css)
const EMOJI_IC = {
  '🎲': 'd20', '⚔': 'crossed', '✨': 'sparkle', '💫': 'sparkle', '🛡': 'shield', '🎯': 'target', '✎': 'quill', '📝': 'quill', '🖌': 'quill',
  '⚠': 'warning', '🎒': 'bag', '🛒': 'bag', '🐾': 'paw', '☠': 'skull', '💀': 'skull', '📜': 'scroll', '💰': 'coins', '☀': 'sun', '🔆': 'sun',
  '🎵': 'note', '🔥': 'flame', '⚡': 'bolt', '🌀': 'swirl', '👁': 'eye', '👀': 'eye', '🗺': 'map', '🚪': 'door', '👑': 'crown',
  '⏳': 'hourglass', '⌛': 'hourglass', '🕰': 'hourglass', '⏱': 'hourglass', '🔮': 'orb', '📍': 'pin', '👥': 'people', '🌿': 'leaf', '🍃': 'leaf',
  '🪜': 'ladder', '☁': 'cloud', '🌫': 'fog', '🔓': 'unlock', '🔒': 'lock', '⚙': 'gear', '🛠': 'gear', '🔧': 'gear', '🏹': 'bow', '🧪': 'potion',
  '🌙': 'moon', '🔇': 'mute', '🔊': 'sound', '🖼': 'image', '📖': 'book', '📓': 'book', '🙈': 'eyeoff', '🫥': 'eyeoff', '🏃': 'boot', '👟': 'boot',
  '🧱': 'wall', '🗡': 'dagger', '💚': 'heart', '💗': 'heart', '❤': 'heart', '🌊': 'wave', '🚫': 'forbid', '🌟': 'star', '⭐': 'star',
  '☕': 'campfire', '🏕': 'tent', '⛺': 'tent', '❄': 'snow', '🧊': 'snow', '🧰': 'chest', '📦': 'chest', '💥': 'burst', '⌨': 'keyboard',
  '🔁': 'refresh', '🔄': 'refresh', '🏰': 'castle', '🗑': 'trash', '💾': 'save', '🔗': 'link', '🔍': 'search', '🔎': 'search', '🌍': 'globe',
  '🧭': 'compass', '📐': 'ruler', '📏': 'ruler', '💡': 'bulb', '📂': 'folder', '🖨': 'print', '🧬': 'person', '👤': 'person', '✋': 'hand', '🤲': 'hand',
  '🌳': 'tree', '🌲': 'tree', '⛰': 'mountain', '❓': 'question', 'ℹ': 'info', '🏠': 'house', '🏡': 'house', '▶': 'play', '↩': 'undo',
};
(function () {
  const sym = Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join('');
  const box = document.createElement('div');
  box.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${sym}</svg>`;
  (document.body || document.documentElement).prepend(box.firstChild);
})();
function ic(name, cls) { return `<svg class="ic ic-${name}${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`; }

// ---------- Замена эмодзи в отрисованном интерфейсе ----------
(function () {
  // Иконка из таблицы, иначе любой цветной эмодзи (с вариантным селектором и составными ZWJ-последовательностями)
  const RE = /(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*)/u;
  const RE_G = new RegExp(RE.source, 'gu');
  // Где эмодзи не трогаем: поле стола (фишки), поля ввода, выпадающие списки, печать кубиков, сам спрайт
  const SKIP = 'script,style,textarea,select,option,svg,.tbl-board,.tok,.noico,[contenteditable]';
  const plain = (s) => s.replace(/️/g, '');
  const NS = 'http://www.w3.org/2000/svg';
  function icEl(name) {
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('class', `ic ic-${name}`); s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use'); u.setAttribute('href', `#i-${name}`); s.appendChild(u); return s;
  }
  function fixText(t) {
    const v = t.nodeValue;
    if (!v || !RE.test(v)) return;
    const p = t.parentNode;
    if (!p || p.nodeType !== 1 || p.closest(SKIP) || p.classList.contains('emo')) return;
    const parts = v.split(RE_G), frag = document.createDocumentFragment();
    let changed = false;
    parts.forEach((s, i) => {
      if (!s) return;
      if (i % 2 === 0) { frag.appendChild(document.createTextNode(s)); return; }
      const name = EMOJI_IC[plain(s)];
      if (name) frag.appendChild(icEl(name));
      else { const e = document.createElement('span'); e.className = 'emo'; e.textContent = s; frag.appendChild(e); }
      changed = true;
    });
    if (changed) p.replaceChild(frag, t);
  }
  function scan(root) {
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), list = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (RE.test(n.nodeValue)) list.push(n);
    list.forEach(fixText);
  }
  window.iconize = scan;
  let queue = new Set(), planned = false;
  const flush = () => { planned = false; const q = queue; queue = new Set(); q.forEach((n) => { if (n.isConnected) scan(n); }); };
  const mo = new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === 'characterData') queue.add(m.target);
      else m.addedNodes.forEach((n) => queue.add(n));
    }
    // Сразу, в той же микрозадаче: без мигания эмодзи перед заменой
    if (!planned) { planned = true; queueMicrotask(flush); }
  });
  const start = () => { scan(document.body); mo.observe(document.body, { childList: true, subtree: true, characterData: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
