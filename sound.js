// Звуки стола — всё синтезируется в браузере, без файлов.
// SFX.play(kind, o) — короткие звуки: кубики, удары по типу урона, стрелы, заклинания по стихии, лечение, «ваш ход».
// SFX.ambient(key) — фон по месту и погоде: «day|rain», «night», «dungeon», «interior»… Пустая строка — тишина.
// Настройки (на устройстве): эффекты и фон включаются отдельно, у каждого своя громкость.
(() => {
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
  const SET = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* без хранилища */ } };
  const S = {
    fx: LS('dnd55-snd', '1') !== '0', fxV: +LS('dnd55-sndv', '0.7'),
    amb: LS('dnd55-amb', '1') !== '0', ambV: +LS('dnd55-ambv', '0.5'),
  };
  let ctx = null, fxBus = null, ambBus = null, noiseBuf = null, last = 0, armed = false;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
      fxBus = ctx.createGain(); fxBus.gain.value = S.fxV * 0.32; fxBus.connect(comp);
      ambBus = ctx.createGain(); ambBus.gain.value = 0; ambBus.connect(comp);
      // Общий буфер шума (2 с) — из него берутся все шорохи, удары, ветер и дождь
      const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate); const ch = noiseBuf.getChannelData(0);
      let b = 0; for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b = 0.97 * b + 0.03 * w; ch[i] = w * 0.6 + b * 2.2; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Браузер разрешает звук только после первого нажатия — тогда и запускаем фон
  const arm = () => { if (armed) return; armed = true; if (audio()) applyAmb(); };
  ['pointerdown', 'keydown'].forEach((ev) => window.addEventListener(ev, arm, { once: false, passive: true }));

  // ---------- Кирпичики ----------
  const T0 = () => ctx.currentTime + 0.01;
  function env(g, t, a, d, peak) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
  function tone(f, d, o = {}) {
    const t = T0() + (o.at || 0), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t); if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + d);
    if (o.det) osc.detune.value = o.det;
    env(g, t, o.a || 0.01, d, o.peak ?? 0.6); osc.connect(g); g.connect(o.out || fxBus); osc.start(t); osc.stop(t + d + 0.05);
  }
  function noise(d, o = {}) {
    const t = T0() + (o.at || 0), s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = d > 1.9; f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f || 1000, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + d); f.Q.value = o.q ?? 1;
    env(g, t, o.a || 0.006, d, o.peak ?? 0.7); s.connect(f); f.connect(g); g.connect(o.out || fxBus); s.start(t, Math.random() * 1.5); s.stop(t + d + 0.05);
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---------- Короткие звуки ----------
  const ELEM = [[/огн|fire/i, 'fire'], [/холод|cold|лёд|лед/i, 'cold'], [/электр|молни|lightning/i, 'lightning'], [/гром|звук|thunder/i, 'thunder'], [/кисл|acid/i, 'acid'],
    [/яд|poison/i, 'poison'], [/некрот|necrot/i, 'necrotic'], [/излуч|свет|radiant/i, 'radiant'], [/психич|psych/i, 'psychic'], [/силов|force/i, 'force'],
    [/рубящ|slash/i, 'slash'], [/колющ|pierc/i, 'pierce'], [/дробящ|bludg/i, 'bludg']];
  const elemOf = (s) => { const h = ELEM.find(([re]) => re.test(s || '')); return h ? h[1] : ''; };
  const P = {
    // Кубики катятся по столу: несколько стуков, всё реже и тише
    dice(o) {
      const n = Math.min(6, o.n || 1);
      for (let k = 0; k < n; k++) { let at = rnd(0, 0.06) + k * 0.03, gap = 0.07, pk = 0.55;
        for (let i = 0; i < 7; i++) { noise(0.03, { at, f: rnd(2400, 4200), q: 3, peak: pk }); tone(rnd(900, 1500), 0.03, { at, type: 'triangle', peak: pk * 0.25 }); at += gap; gap *= 1.35; pk *= 0.72; } }
    },
    swing() { noise(0.22, { f: 700, f2: 2400, q: 1.4, peak: 0.35, a: 0.06 }); },
    slash() { P.swing(); noise(0.08, { at: 0.16, f: 3200, q: 2, peak: 0.6 }); tone(1900, 0.18, { at: 0.16, type: 'triangle', peak: 0.12, f2: 1600 }); },
    pierce() { P.swing(); noise(0.06, { at: 0.16, f: 1800, q: 2.5, peak: 0.6 }); tone(220, 0.08, { at: 0.16, type: 'triangle', peak: 0.4, f2: 90 }); },
    bludg() { P.swing(); noise(0.12, { at: 0.16, f: 260, q: 0.8, peak: 0.9 }); tone(110, 0.2, { at: 0.16, type: 'sine', peak: 0.7, f2: 45 }); },
    hit(o) { const e = elemOf(o.dtype); if (P[e] && ['slash', 'pierce', 'bludg'].includes(e)) P[e](); else if (P[e]) P[e](o); else P.bludg(); },
    arrow() { noise(0.28, { f: 2600, f2: 900, q: 3, peak: 0.3, a: 0.02 }); },
    thunk() { noise(0.05, { f: 900, q: 1.5, peak: 0.7 }); tone(160, 0.12, { type: 'triangle', peak: 0.5, f2: 70 }); },
    miss() { noise(0.25, { f: 1800, f2: 3800, q: 1, peak: 0.3, a: 0.05 }); },
    crit() { tone(523, 0.18, { type: 'triangle', peak: 0.3 }); tone(784, 0.22, { at: 0.08, type: 'triangle', peak: 0.3 }); tone(1047, 0.45, { at: 0.16, type: 'triangle', peak: 0.32 }); tone(1568, 0.5, { at: 0.16, peak: 0.12 }); },
    // Стихии заклинаний
    fire() { noise(0.9, { type: 'lowpass', f: 300, f2: 1600, q: 0.5, peak: 0.9, a: 0.05 }); noise(0.5, { at: 0.05, f: 2400, q: 0.6, peak: 0.25 }); tone(70, 0.6, { peak: 0.5, f2: 40 }); },
    cold() { for (let i = 0; i < 6; i++) tone(rnd(2200, 4200), 0.25, { at: i * 0.05, peak: 0.12 }); noise(0.6, { f: 6000, q: 2, peak: 0.25, a: 0.05 }); },
    lightning() { noise(0.12, { f: 3000, q: 0.4, peak: 1 }); noise(0.09, { at: 0.07, f: 2000, q: 0.4, peak: 0.8 }); noise(1.2, { at: 0.12, type: 'lowpass', f: 200, q: 0.3, peak: 0.6, a: 0.04 }); },
    thunder() { tone(55, 0.9, { peak: 0.9, f2: 30 }); noise(1.1, { type: 'lowpass', f: 160, q: 0.4, peak: 1, a: 0.01 }); noise(0.15, { f: 900, q: 0.5, peak: 0.6 }); },
    acid() { for (let i = 0; i < 10; i++) noise(0.05, { at: rnd(0, 0.6), f: rnd(3000, 6000), q: 4, peak: 0.25 }); noise(0.7, { f: 5000, q: 1, peak: 0.15, a: 0.05 }); },
    poison() { noise(0.8, { f: 900, f2: 400, q: 2, peak: 0.25, a: 0.1 }); tone(180, 0.6, { type: 'sawtooth', peak: 0.06, f2: 120 }); },
    necrotic() { tone(98, 0.9, { type: 'sawtooth', peak: 0.12, f2: 60, a: 0.1 }); tone(103, 0.9, { type: 'sawtooth', peak: 0.1, f2: 62, a: 0.1 }); noise(0.9, { type: 'lowpass', f: 500, q: 1, peak: 0.25, a: 0.2 }); },
    radiant() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 1.1, { at: i * 0.03, peak: 0.13, a: 0.15 })); noise(0.8, { f: 7000, q: 3, peak: 0.08, a: 0.2 }); },
    psychic() { tone(440, 0.8, { f2: 330, peak: 0.15, det: 0 }); tone(452, 0.8, { f2: 310, peak: 0.15 }); tone(880, 0.6, { at: 0.1, f2: 700, peak: 0.06 }); },
    force() { tone(300, 0.35, { type: 'triangle', f2: 900, peak: 0.25 }); noise(0.2, { at: 0.2, f: 1200, q: 1, peak: 0.5 }); tone(120, 0.25, { at: 0.2, peak: 0.5, f2: 60 }); },
    // Заклинание без стихии — переливчатый звон
    spell(o) { const e = elemOf(o.dtype); if (P[e] && !['slash', 'pierce', 'bludg'].includes(e)) { P[e](o); return; } tone(520, 0.45, { f2: 1100, peak: 0.25 }); tone(780, 0.5, { at: 0.07, type: 'triangle', f2: 1600, peak: 0.16 }); noise(0.35, { at: 0.05, f: 5000, q: 2, peak: 0.15 }); },
    cast() { noise(0.45, { f: 1500, f2: 5000, q: 2, peak: 0.12, a: 0.2 }); tone(660, 0.5, { f2: 990, peak: 0.08, a: 0.2 }); },
    heal() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, { at: i * 0.08, peak: 0.22 })); noise(0.6, { at: 0.1, f: 8000, q: 4, peak: 0.07, a: 0.2 }); },
    down() { tone(220, 0.8, { type: 'sawtooth', peak: 0.16, f2: 60 }); noise(0.25, { f: 200, q: 0.6, peak: 0.6 }); },
    turn() { tone(660, 0.14, { peak: 0.35 }); tone(990, 0.3, { at: 0.11, peak: 0.35 }); },
  };
  function play(kind, o = {}) {
    if (!S.fx || !audio()) return;
    const now = performance.now();
    if (kind !== 'dice' && now - last < 40) return; // пачка записей журнала — не какофония
    last = now;
    try { (P[kind] || P.spell)(o); } catch (e) { /* звук недоступен — молча */ }
  }

  // ---------- Фон ----------
  // Слой: постоянный шум через фильтр с медленным колыханием + случайные события (птица, капля, треск, гром)
  let ambKey = '', layers = [], timer = 0, visible = () => true;
  function bed(o) {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true; f.type = o.type || 'lowpass'; f.frequency.value = o.f; f.Q.value = o.q ?? 0.7;
    g.gain.value = 0; g.gain.setTargetAtTime(o.v, ctx.currentTime, 1.5);
    lfo.frequency.value = o.lfo || 0.08; lg.gain.value = o.sway || 0; lfo.connect(lg); lg.connect(f.frequency);
    s.connect(f); f.connect(g); g.connect(ambBus); s.start(0, Math.random() * 1.5); lfo.start();
    return { stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 0.8); setTimeout(() => { try { s.stop(); lfo.stop(); } catch (e) { /* уже */ } }, 3500); } };
  }
  function drone(f, v) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; g.gain.value = 0; g.gain.setTargetAtTime(v, ctx.currentTime, 2); o.connect(g); g.connect(ambBus); o.start();
    return { stop() { g.gain.setTargetAtTime(0, ctx.currentTime, 0.8); setTimeout(() => { try { o.stop(); } catch (e) { /* уже */ } }, 3500); } };
  }
  const A = { out: null };
  const EV = {
    bird() { const n = 2 + Math.floor(Math.random() * 4), b = rnd(2400, 4200); for (let i = 0; i < n; i++) tone(b * rnd(0.9, 1.15), 0.07, { at: i * rnd(0.08, 0.14), f2: b * rnd(1.2, 1.5), peak: 0.07, out: ambBus }); },
    cricket() { const f = rnd(4200, 4800); for (let i = 0; i < 3; i++) tone(f, 0.035, { at: i * 0.06, peak: 0.035, out: ambBus }); },
    drip() { const f = rnd(900, 1500); tone(f, 0.09, { f2: f * 0.5, peak: 0.08, out: ambBus }); tone(f * 0.7, 0.12, { at: 0.13, f2: f * 0.35, peak: 0.025, out: ambBus }); },
    crackle() { const n = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) noise(0.02, { at: i * rnd(0.03, 0.09), f: rnd(1500, 3500), q: 2, peak: rnd(0.08, 0.2), out: ambBus }); },
    thunder() { const at = rnd(0, 0.3); noise(3, { at, type: 'lowpass', f: 140, f2: 60, q: 0.4, peak: 0.45, a: 0.25, out: ambBus }); noise(0.2, { at, f: 600, q: 0.4, peak: 0.12, out: ambBus }); },
    howl() { tone(rnd(380, 460), 1.6, { f2: rnd(300, 340), peak: 0.03, a: 0.5, type: 'triangle', out: ambBus }); },
  };
  function build(key) {
    const [place, wx] = key.split('|'), L = [], ev = [];
    if (place === 'day' || place === 'night') {
      L.push(bed({ f: wx === 'snow' ? 520 : 380, q: 0.6, v: wx === 'snow' ? 0.35 : wx ? 0.16 : 0.12, lfo: 0.06, sway: wx === 'snow' ? 260 : 160 }));
      if (!wx || wx === 'fog') ev.push(place === 'day' ? ['bird', 0.35] : ['cricket', 1.6]);
      if (place === 'night' && !wx) ev.push(['howl', 0.015]);
    } else if (place === 'dungeon') {
      L.push(drone(55, 0.02), drone(58.3, 0.016), bed({ f: 140, q: 0.5, v: 0.12, lfo: 0.04, sway: 50 }));
      ev.push(['drip', 0.3]);
    } else if (place === 'interior') {
      L.push(bed({ f: 260, q: 0.6, v: 0.1, lfo: 0.3, sway: 90 }));
      ev.push(['crackle', 2.5]);
    }
    if (wx === 'rain' || wx === 'storm') { L.push(bed({ type: 'bandpass', f: 2500, q: 0.35, v: wx === 'storm' ? 0.4 : 0.26, lfo: 0.15, sway: 400 }), bed({ f: 500, q: 0.5, v: wx === 'storm' ? 0.22 : 0.1 })); }
    if (wx === 'storm') ev.push(['thunder', 0.06]);
    return { L, ev };
  }
  function applyAmb() {
    if (!ctx) return;
    const want = S.amb && visible() && !document.hidden ? ambKey : '';
    ambBus.gain.setTargetAtTime(want ? S.ambV * 0.5 : 0, ctx.currentTime, 0.6);
    if (want === A.cur) return;
    A.cur = want; layers.forEach((l) => l.stop()); layers = []; clearInterval(timer); timer = 0;
    if (!want) return;
    const { L, ev } = build(want); layers = L;
    timer = setInterval(() => { if (ctx.state !== 'running') return; ev.forEach(([k, rate]) => { if (Math.random() < rate * 0.25) EV[k](); }); }, 250);
  }
  function ambient(key, vis) { if (vis) visible = vis; if (key === ambKey && armed) { applyAmb(); return; } ambKey = key || ''; if (armed && audio()) applyAmb(); }
  document.addEventListener('visibilitychange', () => applyAmb());
  setInterval(() => { if (ctx && armed) applyAmb(); }, 1500); // ушли с вкладки стола — фон стихает

  function set(k, v) {
    S[k] = v; SET({ fx: 'dnd55-snd', fxV: 'dnd55-sndv', amb: 'dnd55-amb', ambV: 'dnd55-ambv' }[k], typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
    if (ctx) { fxBus.gain.value = S.fxV * 0.32; applyAmb(); }
  }
  window.SFX = { play, ambient, set, get: () => ({ ...S }), elemOf };
})();
