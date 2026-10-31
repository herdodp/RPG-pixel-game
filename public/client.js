'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas');
  const dctx = dark.getContext('2d');
  const S = 2;
  let W = 0, H = 0;
  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    dark.width = W; dark.height = H;
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  resize();

  const extra = document.createElement('style');
  extra.textContent = `
    .slot .dbar{position:absolute;left:0;bottom:0;height:3px;background:#8bc34a}
    .slot .r{position:absolute;right:3px;top:2px;font-size:9px;color:#e8d36a}
    #inv{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);display:none;width:430px}
    #inv .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;margin-top:6px}
    #inv .slot{width:100%}
    #inv small{color:#8a9a85;font-size:10px}`;
  document.head.appendChild(extra);
  const invPanel = document.createElement('div');
  invPanel.id = 'inv';
  invPanel.className = 'panel';
  document.body.appendChild(invPanel);

  // ------------------------------------------------------------ state
  let ws = null, myId = 0, cfg = null, defs = null, world = null;
  let playing = false, pingMs = 0, lastErr = '';
  const structs = new Map(), structTiles = new Map();
  const zombies = new Map(), others = new Map(), loot = new Map();
  const me = { x: 0, y: 0, f: 0, dead: false, init: false };
  let inv = [], sel = 0, selLock = 0, busy = null;
  let stats = { hp: 100, hunger: 100, thirst: 100, stamina: 100, bleeding: false, infected: false, kills: 0, deaths: 0, score: 0 };
  let tod = 0.2, wave = null, wasNight = false;
  let buildOpen = false, buildType = null, craftOpen = false, invOpen = false;
  let hurtFlash = 0, shake = 0, lastAttack = 0, lastSend = 0, lastSentKey = '';
  let inputDx = 0, inputDy = 0, sprintHeld = false, msgTimer = 0;
  const keys = new Set();
  const mouse = { x: 0, y: 0, wx: 0, wy: 0, down: false };
  const floaters = [], parts = [];
  let fx = [];

  const TB = [false, true, true, true];
  const CONSUMABLE = { food: 1, drink: 1, medical: 1 };
  const count = id => { let n = 0; for (const s of inv) if (s && s.id === id) n += s.n; return n; };
  const canAfford = cost => Object.entries(cost).every(([id, n]) => count(id) >= n);
  const itemName = id => (defs.items[id] && defs.items[id].name) || id;
  const costStr = cost => Object.entries(cost).map(([id, n]) => itemName(id) + ' ' + n).join(', ');
  function nz(tx, ty) {
    let h = (Math.imul(tx, 374761393) + Math.imul(ty, 668265263)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return h & 255;
  }
  function R(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }

  // ------------------------------------------------------------ audio
  let actx = null, noiseBuf = null, sndCount = 0, sndWindow = 0;
  function initAudio() {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }
  function tone(f1, f2, dur, type, v) {
    if (!actx || v < 0.003) return;
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, v, cut) {
    if (!actx || v < 0.003) return;
    if (!noiseBuf) {
      noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = actx.createBufferSource(), g = actx.createGain(), f = actx.createBiquadFilter(), t = actx.currentTime;
    src.buffer = noiseBuf;
    f.type = 'lowpass'; f.frequency.value = cut;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(actx.destination);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }
  function sfx(name, x, y) {
    if (!actx) return;
    const now = performance.now();
    if (now - sndWindow > 100) { sndWindow = now; sndCount = 0; }
    if (++sndCount > 14) return;
    const k = x === undefined ? 1 : Math.max(0, 1 - Math.hypot(x - me.x, y - me.y) / 520);
    if (k <= 0) return;
    switch (name) {
      case 'swing_blunt': case 'swing_heavy': case 'swing_light': case 'swing_thrust': case 'swing_fist':
        noise(0.12, 0.16 * k, name === 'swing_heavy' ? 900 : 2200); break;
      case 'shot_pistol': noise(0.14, 0.3 * k, 5000); tone(180, 40, 0.14, 'square', 0.14 * k); break;
      case 'shot_shotgun': noise(0.32, 0.5 * k, 3200); tone(120, 30, 0.3, 'sawtooth', 0.2 * k); break;
      case 'reload': tone(500, 300, 0.05, 'square', 0.08 * k); setTimeout(() => tone(380, 600, 0.06, 'square', 0.08 * k), 220); break;
      case 'empty': tone(900, 700, 0.03, 'square', 0.07 * k); break;
      case 'hit': tone(130, 60, 0.09, 'square', 0.12 * k); break;
      case 'zdie': tone(170, 35, 0.45, 'sawtooth', 0.14 * k); break;
      case 'zattack': tone(95, 60, 0.25, 'sawtooth', 0.08 * k); break;
      case 'phit': tone(220, 70, 0.18, 'sawtooth', 0.2 * k); break;
      case 'pickup': tone(660, 990, 0.08, 'triangle', 0.1 * k); break;
      case 'gather': noise(0.1, 0.12 * k, 1500); break;
      case 'build': tone(320, 200, 0.1, 'triangle', 0.14 * k); break;
      case 'broke': tone(300, 60, 0.3, 'square', 0.15); break;
      case 'use': tone(440, 660, 0.15, 'sine', 0.12); break;
      case 'wave': tone(110, 90, 0.9, 'sawtooth', 0.22); break;
      default: break;
    }
  }

  // ------------------------------------------------------------ messages / feed
  const ERR = {
    too_far: 'Too far away', blocked_tile: 'Cannot build there', entity_in_the_way: 'Something is in the way',
    not_enough_resources: 'Not enough resources', inventory_full: 'Inventory full', not_owner: 'Only the owner can dismantle',
    cannot_use: 'Cannot use that now', already_full: 'Already at full health', not_repairable: 'Cannot be repaired',
    unknown_recipe: 'Unknown recipe', not_found: 'Nothing there'
  };
  function causeText(c) {
    if (!c) return 'unknown causes';
    if (c.indexOf('zombie:') === 0) {
      const z = defs && defs.zombies[c.slice(7)];
      return 'killed by a ' + (z ? z.name : 'zombie');
    }
    return { starvation: 'starved', dehydration: 'died of thirst', bleeding: 'bled out', infection: 'infection' }[c] || c;
  }
  function addFeed(text, color) {
    const f = $('feed');
    const d = document.createElement('div');
    d.textContent = text;
    d.style.color = color || '#d7e3d0';
    f.appendChild(d);
    while (f.children.length > 6) f.removeChild(f.firstChild);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 7000);
  }
  function bigMsg(text, ms) {
    const el = $('msg');
    el.textContent = text;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.textContent = ''; }, ms || 2500);
  }

  // ------------------------------------------------------------ network
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function connect(name) {
    lastErr = '';
    $('connmsg').textContent = 'Connecting...';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host);
    ws.onopen = () => send({ t: 'join', name });
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMsg(m);
    };
    ws.onclose = () => {
      playing = false;
      showMenu(lastErr || 'Disconnected from server.');
    };
  }
  function showMenu(msg) {
    $('menu').style.display = 'flex';
    $('dead').style.display = 'none';
    for (const id of ['hud', 'hotbar', 'top', 'clock', 'side', 'feed', 'net', 'panelBuild', 'panelCraft']) $(id).style.display = 'none';
    invPanel.style.display = 'none';
    $('connmsg').textContent = msg || '';
  }
  function onMsg(m) {
    switch (m.t) {
      case 'init': onInit(m); break;
      case 'snap': if (playing) onSnap(m); break;
      case 'pong': pingMs = Date.now() - m.ts; break;
      case 'full': lastErr = 'Server is full.'; break;
      default: break;
    }
  }
  function onInit(m) {
    myId = m.id; cfg = m.cfg; defs = m.defs;
    const bin = atob(m.world.tiles);
    const tiles = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) tiles[i] = bin.charCodeAt(i);
    world = { w: m.world.w, h: m.world.h, ts: m.world.ts, tiles };
    structs.clear(); structTiles.clear(); zombies.clear(); others.clear(); loot.clear();
    for (const s of m.structures) addStruct(s);
    me.init = false; me.dead = false;
    inv = []; sel = 0; busy = null;
    $('menu').style.display = 'none';
    $('dead').style.display = 'none';
    for (const id of ['hud', 'top', 'clock', 'side', 'feed', 'net']) $(id).style.display = 'block';
    $('hotbar').style.display = 'flex';
    buildHotbar();
    playing = true;
  }

  function addStruct(s) {
    structs.set(s.id, s);
    for (let y = s.tyy; y < s.tyy + s.h; y++) for (let x = s.tx; x < s.tx + s.w; x++) structTiles.set(y * world.w + x, s);
  }
  function delStruct(id) {
    const s = structs.get(id);
    if (!s) return;
    for (let y = s.tyy; y < s.tyy + s.h; y++) {
      for (let x = s.tx; x < s.tx + s.w; x++) {
        const k = y * world.w + x;
        if (structTiles.get(k) === s) structTiles.delete(k);
      }
    }
    structs.delete(id);
  }

  // ------------------------------------------------------------ snapshots
  function onSnap(m) {
    tod = m.tod;
    const dx = m.me.x - me.x, dy = m.me.y - me.y;
    if (!me.init || me.dead || Math.hypot(dx, dy) > 50) { me.x = m.me.x; me.y = m.me.y; me.init = true; }
    else { me.x += dx * 0.15; me.y += dy * 0.15; }

    const seen = new Set();
    for (const p of m.pl) {
      if (p.id === myId) { me.dead = p.dead; continue; }
      seen.add(p.id);
      let o = others.get(p.id);
      if (!o) { o = { id: p.id, x: p.x, y: p.y }; others.set(p.id, o); }
      o.gx = p.x; o.gy = p.y; o.f = p.f; o.hp = p.hp; o.dead = p.dead; o.w = p.w; o.name = p.name;
    }
    for (const id of Array.from(others.keys())) if (!seen.has(id)) others.delete(id);

    if (m.z) {
      for (const s of (m.z.a || []).concat(m.z.u || [])) {
        let z = zombies.get(s.id);
        if (!z) { z = { id: s.id, x: s.x, y: s.y, lunge: 0, deadAt: 0 }; zombies.set(s.id, z); }
        z.type = s.ty; z.gx = s.x; z.gy = s.y; z.f = s.f; z.hp = s.hp; z.mhp = s.mhp; z.st = s.st; z.tg = s.tg;
      }
      for (const id of m.z.d || []) zombies.delete(id);
    }
    if (m.l) {
      for (const l of m.l.a || []) loot.set(l.id, l);
      for (const id of m.l.d || []) loot.delete(id);
    }
    if (m.se) {
      for (const e of m.se) {
        if (e.t === 'sadd') { delStruct(e.s.id); addStruct(e.s); sfx('build', e.s.x, e.s.y); }
        else if (e.t === 'shp') { const s = structs.get(e.id); if (s) s.hp = e.hp; }
        else if (e.t === 'sdel') {
          delStruct(e.id);
          sfx('hit', e.x, e.y);
          for (let i = 0; i < 10; i++) addPart(e.x, e.y, '#8a6a3a', 500, 60);
        } else if (e.t === 'sgate') { const s = structs.get(e.id); if (s) s.open = e.open; }
      }
    }
    if (m.tc) for (const c of m.tc) world.tiles[c.ty * world.w + c.tx] = c.t;
    if (m.ev) for (const e of m.ev) handleEvent(e);
    if (m.inv) { inv = m.inv; refreshInv(); }
    if (m.st) stats = m.st;
    if (performance.now() > selLock && m.sel !== sel) { sel = m.sel; refreshInv(); }
    busy = m.busy;
    wave = m.wv || null;
    updateHud();
  }

  function handleEvent(e) {
    const now = performance.now();
    switch (e.t) {
      case 'swing': {
        const w = defs.weapons[e.w];
        fx.push({ k: 'swing', x: e.x, y: e.y, f: e.f, r: w ? w.range : 22, a: w ? (w.arcDeg || 60) : 80, t0: now });
        sfx(e.snd, e.x, e.y);
        break;
      }
      case 'shot':
        fx.push({ k: 'shot', x: e.x, y: e.y, tr: e.tr, t0: now });
        sfx(e.snd, e.x, e.y);
        if (e.id === myId) shake = Math.max(shake, e.w === 'shotgun' ? 5 : 2);
        break;
      case 'reload': sfx('reload', e.x, e.y); break;
      case 'zattack': {
        const z = zombies.get(e.id);
        if (z) z.lunge = now;
        sfx('zattack', e.x, e.y);
        break;
      }
      case 'zhit':
        floaters.push({ x: e.x, y: e.y - 14, text: String(e.dmg), color: '#ffffff', t0: now, life: 700 });
        for (let i = 0; i < 5; i++) addPart(e.x, e.y - 6, '#8c1c1c', 450, 70);
        sfx('hit', e.x, e.y);
        break;
      case 'zdie':
        for (let i = 0; i < 14; i++) addPart(e.x, e.y - 6, '#5e1010', 700, 90);
        sfx('zdie', e.x, e.y);
        break;
      case 'zburn':
        for (let i = 0; i < 8; i++) addPart(e.x, e.y - 8, '#777777', 900, 30);
        break;
      case 'phit':
        floaters.push({ x: e.x, y: e.y - 16, text: '-' + e.dmg, color: '#ff5a4a', t0: now, life: 800 });
        if (e.id === myId) { hurtFlash = 1; shake = Math.max(shake, 6); }
        sfx('phit', e.x, e.y);
        break;
      case 'pdie': addFeed(e.name + ' died (' + causeText(e.cause) + ')', '#e07b6b'); break;
      case 'gather':
        floaters.push({ x: e.x, y: e.y - 8, text: '+' + itemName(e.it), color: '#c9d98a', t0: now, life: 700 });
        sfx('gather', e.x, e.y);
        break;
      case 'wave': bigMsg(e.boss ? 'BOSS WAVE ' + e.wave + '!' : 'WAVE ' + e.wave, 3000); sfx('wave'); break;
      case 'wave_clear': bigMsg('WAVE ' + e.wave + ' CLEARED', 3000); break;
      case 'hurt': hurtFlash = 1; break;
      case 'status':
        if (e.msg === 'bleeding') addFeed('You are bleeding! Use a bandage.', '#ff6b5b');
        if (e.msg === 'infection_active') addFeed('The infection is spreading! Find antibiotics.', '#b6e35b');
        break;
      case 'err': addFeed(ERR[e.code] || e.code, '#e8c46a'); break;
      case 'empty': sfx('empty'); break;
      case 'noammo': addFeed('No ammo for this weapon', '#e8c46a'); break;
      case 'broke': addFeed('Your ' + ((defs.weapons[e.w] && defs.weapons[e.w].name) || 'weapon') + ' broke!', '#e8c46a'); sfx('broke'); break;
      case 'used': sfx('use'); break;
      case 'wave_reward': addFeed('Wave reward received', '#8bc34a'); break;
      case 'died':
        $('dead').style.display = 'flex';
        $('deadcause').textContent = 'You ' + causeText(e.cause);
        $('deadtimer').textContent = 'Respawning...';
        me.dead = true;
        break;
      case 'respawn':
        $('dead').style.display = 'none';
        me.dead = false;
        lastSentKey = '';
        break;
      default: break;
    }
  }

  function addPart(x, y, color, life, speed) {
    const a = Math.random() * Math.PI * 2, v = Math.random() * (speed || 60);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 10, color, t0: performance.now(), life });
  }

  // ------------------------------------------------------------ inventory / panels UI
  const hotSlots = [];
  function buildHotbar() {
    const hb = $('hotbar');
    hb.innerHTML = '';
    hotSlots.length = 0;
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      d.onclick = () => selectSlot(i);
      hb.appendChild(d);
      hotSlots.push(d);
    }
  }
  function selectSlot(i) {
    if (!cfg || i < 0 || i >= cfg.slots) return;
    sel = i;
    selLock = performance.now() + 350;
    send({ t: 'select', slot: i });
    refreshInv();
  }
  function slotInner(i) {
    const s = inv[i];
    const key = i < 9 ? String(i + 1) : '';
    if (!s) return `<span class='k'>${key}</span>`;
    const d = defs.items[s.id] || { name: s.id };
    const w = defs.weapons[s.id];
    let h = `<span class='k'>${key}</span><div class='nm'>${d.name}</div>`;
    if (w && w.type === 'ranged') h += `<span class='n'>${s.m || 0}/${w.magazineSize}</span><span class='r'>${count(w.ammoType)}</span>`;
    else if (s.n > 1) h += `<span class='n'>${s.n}</span>`;
    if (w && s.d !== undefined && w.durability) h += `<div class='dbar' style='width:${Math.max(0, s.d / w.durability * 100)}%'></div>`;
    return h;
  }
  function refreshInv() {
    if (!defs) return;
    for (let i = 0; i < hotSlots.length; i++) {
      hotSlots[i].innerHTML = slotInner(i);
      hotSlots[i].className = 'slot' + (i === sel ? ' sel' : '');
    }
    if (invOpen) renderInvPanel();
    if (buildOpen) renderBuild();
    if (craftOpen) renderCraft();
  }
  function renderInvPanel() {
    invPanel.innerHTML = `<b>INVENTORY</b> <small>click: select | shift+click: swap with selected | right-click: drop</small><div class='grid'></div>`;
    const grid = invPanel.querySelector('.grid');
    for (let i = 0; i < cfg.slots; i++) {
      const d = document.createElement('div');
      d.className = 'slot' + (i === sel ? ' sel' : '');
      d.innerHTML = slotInner(i);
      d.onclick = e => { if (e.shiftKey) send({ t: 'swap', a: sel, b: i }); else selectSlot(i); };
      d.oncontextmenu = e => { e.preventDefault(); send({ t: 'drop', slot: i }); };
      grid.appendChild(d);
    }
  }
  function rowEl(left, right, cls, onclick) {
    const r = document.createElement('div');
    r.className = 'row ' + cls;
    const a = document.createElement('span'), b = document.createElement('span');
    a.textContent = left; b.textContent = right;
    r.appendChild(a); r.appendChild(b);
    r.onclick = onclick;
    return r;
  }
  function renderBuild() {
    const el = $('panelBuild');
    el.innerHTML = '';
    const t = document.createElement('div');
    t.textContent = 'BUILD: pick one, left-click the world to place, right-click to stop';
    el.appendChild(t);
    for (const [id, s] of Object.entries(defs.structures)) {
      const cls = (canAfford(s.cost) ? '' : 'no ') + (buildType === id ? 'sel' : '');
      el.appendChild(rowEl(s.name, costStr(s.cost), cls, () => { buildType = id; renderBuild(); }));
    }
  }
  function renderCraft() {
    const el = $('panelCraft');
    el.innerHTML = '';
    const t = document.createElement('div');
    t.textContent = 'CRAFTING: click to craft';
    el.appendChild(t);
    for (const [id, r] of Object.entries(defs.recipes || {})) {
      el.appendChild(rowEl(r.name, costStr(r.cost), canAfford(r.cost) ? '' : 'no', () => send({ t: 'craft', id })));
    }
  }
  function togglePanel(which) {
    if (which === 'build') { buildOpen = !buildOpen; if (!buildOpen) buildType = null; }
    if (which === 'craft') craftOpen = !craftOpen;
    if (which === 'inv') invOpen = !invOpen;
    $('panelBuild').style.display = buildOpen ? 'block' : 'none';
    $('panelCraft').style.display = craftOpen ? 'block' : 'none';
    invPanel.style.display = invOpen ? 'block' : 'none';
    refreshInv();
  }

  // ------------------------------------------------------------ HUD
  function setBar(id, v, max) {
    const el = $(id);
    el.querySelector('.fill').style.width = Math.max(0, Math.min(100, v / max * 100)) + '%';
    el.querySelector('.v').textContent = Math.round(v);
  }
  function nightFactor() {
    const ns = cfg.nightStart, ne = cfg.nightEnd, f = 0.04;
    let n = 0;
    if (tod >= ns && tod < ne) n = 1;
    else if (tod >= ns - f && tod < ns) n = (tod - (ns - f)) / f;
    else if (tod >= ne && tod < ne + f) n = 1 - (tod - ne) / f;
    return n * n * (3 - 2 * n);
  }
  function updateHud() {
    setBar('b-hp', stats.hp, cfg.maxHealth);
    setBar('b-hu', stats.hunger, 100);
    setBar('b-th', stats.thirst, 100);
    setBar('b-st', stats.stamina, 100);
    const flags = [];
    if (stats.bleeding) flags.push('BLEEDING');
    if (stats.infected) flags.push('INFECTED');
    if (stats.hunger < 20) flags.push('HUNGRY');
    if (stats.thirst < 20) flags.push('THIRSTY');
    if (busy === 'reload') flags.push('RELOADING');
    if (busy === 'use') flags.push('USING ITEM');
    $('flags').textContent = flags.join(' | ');

    const top = $('top');
    if (wave && wave.on) {
      top.style.display = 'block';
      top.textContent = wave.phase === 'intermission'
        ? 'WAVE ' + (wave.wave + 1) + ' starts in ' + wave.next + 's'
        : 'WAVE ' + wave.wave + ' | zombies left: ' + wave.left;
    } else top.style.display = 'none';

    const night = nightFactor() > 0.5;
    if (night && !wasNight) bigMsg('NIGHT FALLS - stay near light', 3500);
    if (!night && wasNight) bigMsg('DAWN BREAKS', 2500);
    wasNight = night;
    const hh = Math.floor(tod * 24), mm = Math.floor((tod * 24 - hh) * 60);
    $('clock').textContent = (night ? 'NIGHT ' : 'DAY ') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
    $('clock').style.color = night ? '#ff8a7a' : '#d7e3d0';
    $('side').textContent = 'Kills ' + stats.kills + '  Score ' + stats.score + '  Deaths ' + stats.deaths + '  Nearby survivors ' + (others.size + 1);
    $('net').textContent = 'ping ' + pingMs + 'ms | zombies in view ' + zombies.size + ' | loot ' + loot.size;
  }

  // ------------------------------------------------------------ collision (client prediction)
  function tileBlocked(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return true;
    const i = ty * world.w + tx;
    if (TB[world.tiles[i]]) return true;
    const s = structTiles.get(i);
    if (!s || s.open) return false;
    const d = defs.structures[s.ty];
    return !!(d && d.blocks);
  }
  function circleBlocked(x, y, r) {
    const ts = world.ts;
    if (x - r < 0 || y - r < 0 || x + r > world.w * ts || y + r > world.h * ts) return true;
    const x0 = Math.floor((x - r) / ts), x1 = Math.floor((x + r) / ts);
    const y0 = Math.floor((y - r) / ts), y1 = Math.floor((y + r) / ts);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!tileBlocked(tx, ty)) continue;
        const nx = Math.max(tx * ts, Math.min(x, tx * ts + ts)), ny = Math.max(ty * ts, Math.min(y, ty * ts + ts));
        if ((x - nx) * (x - nx) + (y - ny) * (y - ny) < r * r) return true;
      }
    }
    return false;
  }
  function moveLocal(dt) {
    inputDx = 0; inputDy = 0;
    if (me.dead) return;
    if (keys.has('KeyW') || keys.has('ArrowUp')) inputDy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) inputDy += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) inputDx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) inputDx += 1;
    const len = Math.hypot(inputDx, inputDy);
    if (len > 1) { inputDx /= len; inputDy /= len; }
    sprintHeld = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (!inputDx && !inputDy) return;
    let speed = cfg.speed * (busy ? 0.7 : 1);
    if (sprintHeld && stats.stamina > 1) speed *= cfg.sprintMultiplier;
    const mx = inputDx * speed * dt, my = inputDy * speed * dt;
    if (mx && !circleBlocked(me.x + mx, me.y, cfg.playerRadius)) me.x += mx;
    if (my && !circleBlocked(me.x, me.y + my, cfg.playerRadius)) me.y += my;
  }
  function sendInput(now) {
    const f = Math.round(me.f * 20) / 20;
    const key = inputDx.toFixed(2) + ',' + inputDy.toFixed(2) + ',' + sprintHeld + ',' + f;
    const changed = key !== lastSentKey && now - lastSend > 45;
    if (changed || now - lastSend > 400) {
      send({ t: 'input', dx: inputDx, dy: inputDy, sprint: sprintHeld, facing: me.f });
      lastSentKey = key;
      lastSend = now;
    }
  }

  // ------------------------------------------------------------ update
  function update(dt, now) {
    moveLocal(dt);
    mouse.wx = me.x + (mouse.x - W / 2) / S;
    mouse.wy = me.y + (mouse.y - H / 2) / S;
    me.f = Math.atan2(mouse.wy - me.y, mouse.wx - me.x);
    const k = Math.min(1, dt * 14);
    for (const z of zombies.values()) { z.x += (z.gx - z.x) * k; z.y += (z.gy - z.y) * k; }
    for (const o of others.values()) { o.x += (o.gx - o.x) * k; o.y += (o.gy - o.y) * k; }
    shake = Math.max(0, shake - dt * 18);
    hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
    if (mouse.down && !me.dead && !(buildOpen && buildType) && now - lastAttack > 90) {
      send({ t: 'attack', facing: me.f });
      lastAttack = now;
    }
    sendInput(now);
    fx = fx.filter(e => now - e.t0 < 300);
    for (let i = floaters.length - 1; i >= 0; i--) if (now - floaters[i].t0 > floaters[i].life) floaters.splice(i, 1);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (now - p.t0 > p.life) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt;
    }
  }

  // ------------------------------------------------------------ drawing
  const ZCOL = {
    normal: ['#6f8f5a', '#4a6340', '#8c3b3b'], runner: ['#a3b64f', '#6e7d38', '#b04a2a'],
    tank: ['#58745c', '#3b523f', '#7a2a2a'], night: ['#6a74b5', '#454d86', '#e8f06a']
  };
  function drawZombie(z, now) {
    const r = (defs.zombies[z.type] || { radius: 8 }).radius;
    const c = ZCOL[z.type] || ZCOL.normal;
    const dead = z.st === 4;
    if (dead && !z.deadAt) z.deadAt = now;
    const t = dead ? Math.min(1, (now - z.deadAt) / 1500) : 0;
    let x = z.x, y = z.y;
    if (now - z.lunge < 260) {
      const k = Math.sin((now - z.lunge) / 260 * Math.PI) * 4;
      x += Math.cos(z.f) * k; y += Math.sin(z.f) * k;
    }
    ctx.save();
    ctx.globalAlpha = 1 - t * 0.65;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(x - r), Math.round(y + r - 2), r * 2, 3);
    ctx.translate(Math.round(x), Math.round(y + r));
    if (dead) ctx.rotate(t * Math.PI / 2 * (z.id % 2 ? 1 : -1));
    const moving = !dead && (z.st === 1 || z.st === 2);
    const bob = moving ? Math.sin(now / 90 + z.id) * 1.2 : 0;
    ctx.fillStyle = c[1];
    ctx.fillRect(-r * 0.6, -r * 0.7, r * 0.5, r * 0.7 + bob);
    ctx.fillRect(r * 0.1, -r * 0.7, r * 0.5, r * 0.7 - bob);
    ctx.fillStyle = c[0];
    ctx.fillRect(-r * 0.8, -r * 1.7, r * 1.6, r * 1.1);
    ctx.fillRect(-r * 0.55, -r * 2.4, r * 1.1, r * 0.9);
    const dir = Math.cos(z.f) >= 0 ? 1 : -1;
    ctx.fillStyle = dead ? '#222' : c[2];
    ctx.fillRect(dir > 0 ? r * 0.1 : -r * 0.45, -r * 2.1, r * 0.35, r * 0.3);
    ctx.fillStyle = c[1];
    ctx.fillRect(dir > 0 ? r * 0.7 : -r * 1.6, -r * 1.6, r * 0.9, r * 0.35);
    ctx.restore();
    if (!dead) {
      if (z.hp < z.mhp) {
        R(x - 8, y - r * 2.9, 16, 2, '#300');
        R(x - 8, y - r * 2.9, 16 * Math.max(0, z.hp / z.mhp), 2, '#d33');
      }
      if (z.st === 2 || z.st === 3) { ctx.fillStyle = '#ff4a3a'; ctx.font = 'bold 8px monospace'; ctx.fillText('!', Math.round(x) - 2, Math.round(y - r * 3.1)); }
    }
  }

  function drawPlayer(p, isMe, now) {
    const r = cfg.playerRadius;
    const dead = isMe ? me.dead : p.dead;
    const x = p.x, y = p.y, f = isMe ? me.f : (p.f || 0);
    const hue = (p.id * 47) % 360;
    const body = 'hsl(' + hue + ',45%,42%)', legs = 'hsl(' + hue + ',30%,25%)';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(x - r), Math.round(y + r - 2), r * 2, 3);
    if (dead) {
      R(x - r, y + r - 5, r * 2, 5, body);
      R(x + r - 2, y + r - 6, 5, 5, '#d9b48c');
      return;
    }
    const moving = isMe ? (inputDx || inputDy) : (Math.hypot(p.gx - p.x, p.gy - p.y) > 0.8);
    const bob = moving ? Math.sin(now / 80) * 1.5 : 0;
    R(x - r * 0.6, y + r * 0.2, r * 0.5, r * 0.8 + bob, legs);
    R(x + r * 0.1, y + r * 0.2, r * 0.5, r * 0.8 - bob, legs);
    R(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.1, body);
    R(x - r * 0.55, y - r * 1.6, r * 1.1, r * 0.9, '#d9b48c');
    R(Math.cos(f) >= 0 ? x + 1 : x - 4, y - r * 1.3, 3, 2, '#222');
    const wid = isMe ? (inv[sel] && defs.weapons[inv[sel].id] ? inv[sel].id : null) : p.w;
    if (wid && defs.weapons[wid]) {
      const w = defs.weapons[wid];
      const len = w.type === 'ranged' ? 13 : Math.min(22, w.range * 0.55);
      ctx.strokeStyle = w.type === 'ranged' ? '#9aa0a8' : '#a88b5a';
      ctx.lineWidth = w.type === 'ranged' ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x + Math.cos(f) * len, y - 3 + Math.sin(f) * len);
      ctx.stroke();
    }
    if (!isMe) {
      ctx.fillStyle = '#e8e8e8'; ctx.font = '7px monospace';
      ctx.fillText(p.name || '', Math.round(x - (p.name || '').length * 2), Math.round(y - r * 2));
    }
  }

  function drawStruct(s, now) {
    const ts = world.ts, x = s.tx * ts, y = s.tyy * ts, w = s.w * ts, h = s.h * ts;
    const cx = s.x, cy = s.y;
    switch (s.ty) {
      case 'wooden_barricade':
        R(x + 3, y + 4, 4, h - 6, '#4d3319'); R(x + w - 7, y + 4, 4, h - 6, '#4d3319');
        R(x + 1, y + 8, w - 2, h - 12, '#6a4727');
        R(x + 1, y + 8, w - 2, 3, '#8a6339'); R(x + 1, y + 16, w - 2, 3, '#8a6339'); R(x + 1, y + 24, w - 2, 3, '#8a6339');
        break;
      case 'reinforced_wall':
        R(x, y + 4, w, h - 6, '#5d5f66'); R(x, y + 4, w, 4, '#7b7e86');
        R(x + 10, y + 10, 2, h - 12, '#44464c'); R(x + 22, y + 10, 2, h - 12, '#44464c');
        R(x + 3, y + 12, 2, 2, '#9a9ca3'); R(x + w - 5, y + 12, 2, 2, '#9a9ca3');
        break;
      case 'spike_trap':
        R(x + 2, y + 14, w - 4, h - 18, '#3a2e22');
        for (let i = 0; i < 5; i++) { R(x + 4 + i * 6, y + 8, 2, 10, '#b9bcc2'); R(x + 3 + i * 6, y + 14, 4, 3, '#8a8d93'); }
        break;
      case 'watchtower':
        R(x + 6, y + 14, 5, h - 18, '#5a3d22'); R(x + w - 11, y + 14, 5, h - 18, '#5a3d22');
        R(x + 2, y + 8, w - 4, 8, '#7a5530');
        R(x + 10, y - 10, w - 20, 18, '#6b4a2a');
        R(x + 6, y - 16, w - 12, 6, '#3d2a17');
        break;
      case 'torch': {
        R(cx - 1, cy - 4, 3, 12, '#5a3d22');
        const fl = 5 + Math.sin(now / 70 + s.id) * 1.5;
        R(cx - 2, cy - 4 - fl, 5, fl, '#ffb030'); R(cx - 1, cy - 3 - fl * 0.6, 3, fl * 0.6, '#fff3a0');
        break;
      }
      case 'campfire': {
        R(cx - 8, cy + 2, 16, 4, '#5a3d22'); R(cx - 6, cy + 5, 12, 3, '#46301a');
        const fl = 9 + Math.sin(now / 60 + s.id) * 2.5;
        R(cx - 4, cy + 2 - fl, 9, fl, '#ff7a1a'); R(cx - 2, cy + 2 - fl * 0.6, 5, fl * 0.6, '#ffd34a');
        break;
      }
      case 'gate':
        R(x + 1, y + 6, 4, h - 8, '#4d3319'); R(x + w - 5, y + 6, 4, h - 8, '#4d3319');
        if (s.open) { R(x + 5, y + 12, 5, 3, '#8a6339'); R(x + w - 10, y + 12, 5, 3, '#8a6339'); }
        else { R(x + 5, y + 10, w - 10, 3, '#8a6339'); R(x + 5, y + 20, w - 10, 3, '#8a6339'); R(x + 14, y + 8, 4, h - 12, '#6a4727'); }
        break;
      default: R(x + 2, y + 2, w - 4, h - 4, '#777');
    }
    if (s.hp < s.mhp) {
      R(cx - 12, y - 4, 24, 3, '#200'); R(cx - 12, y - 4, 24 * Math.max(0, s.hp / s.mhp), 3, s.hp / s.mhp < 0.35 ? '#d33' : '#7c7');
    }
  }

  const LCOL = { material: '#a98657', food: '#d98a2b', drink: '#3f8fd6', medical: '#d9d9d9', ammo: '#d6b13a', weapon: '#9aa0a8', rare: '#b45fe0' };
  function drawLoot(l, now, near) {
    const def = defs.items[l.it] || {};
    const bob = Math.sin(now / 300 + l.id) * 1.5;
    const col = LCOL[def.category] || '#ccc';
    R(l.x - 4, l.y + 3, 8, 2, 'rgba(0,0,0,0.35)');
    R(l.x - 4, l.y - 4 + bob, 8, 7, col);
    R(l.x - 4, l.y - 4 + bob, 8, 2, 'rgba(255,255,255,0.35)');
    if (def.category === 'rare') { ctx.fillStyle = 'rgba(200,120,255,' + (0.25 + 0.15 * Math.sin(now / 200)) + ')'; ctx.fillRect(l.x - 7, l.y - 8 + bob, 14, 14); }
    if (near) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 7px monospace';
      const label = '[E] ' + (def.name || l.it) + (l.n > 1 ? ' x' + l.n : '');
      ctx.fillText(label, Math.round(l.x - label.length * 2), Math.round(l.y - 10));
    }
  }

  function drawTiles(tx0, ty0, tx1, ty1, now, drawables) {
    const ts = world.ts;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const px = tx * ts, py = ty * ts;
        if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) { R(px, py, ts, ts, '#050605'); continue; }
        const t = world.tiles[ty * world.w + tx], n = nz(tx, ty);
        if (t === 3) {
          R(px, py, ts, ts, '#1d3f5e');
          ctx.fillStyle = 'rgba(130,180,230,' + (0.08 + 0.06 * Math.sin(now / 400 + tx + ty)) + ')';
          ctx.fillRect(px + 4, py + (n % 20) + 4, 18, 2);
          continue;
        }
        R(px, py, ts, ts, n < 50 ? '#335230' : n < 110 ? '#2a4426' : '#2e4a29');
        if (n % 3 === 0) R(px + (n % 26) + 2, py + ((n >> 3) % 26) + 2, 2, 2, '#3f6838');
        if (t === 1) {
          drawables.push({ y: py + ts, fn: () => {
            R(px + 13, py + 14, 6, 16, '#5a3d22');
            R(px + 3, py - 6, 26, 24, '#1f4a22'); R(px + 6, py - 4, 18, 10, '#2b6a2c');
            R(px + 9 + (n % 8), py + 2, 3, 3, '#3a8a3a'); R(px + 17, py + 8 + (n % 5), 3, 3, '#18391b');
          } });
        } else if (t === 2) {
          R(px + 3, py + 8, 26, 18, '#4a4d4a'); R(px + 4, py + 7, 24, 16, '#6b6f6b'); R(px + 7, py + 7, 14, 6, '#8a8e8a');
        }
      }
    }
  }

  function drawGhost() {
    if (!(buildOpen && buildType) || me.dead) return;
    const def = defs.structures[buildType];
    const ts = world.ts;
    const tw = Math.max(1, Math.ceil(def.size.w / ts)), th = Math.max(1, Math.ceil(def.size.h / ts));
    const tx = Math.floor(mouse.wx / ts) - Math.floor((tw - 1) / 2), ty = Math.floor(mouse.wy / ts) - Math.floor((th - 1) / 2);
    let ok = Math.hypot(mouse.wx - me.x, mouse.wy - me.y) <= cfg.buildRange && canAfford(def.cost);
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        if (x < 0 || y < 0 || x >= world.w || y >= world.h || world.tiles[y * world.w + x] !== 0 || structTiles.has(y * world.w + x)) ok = false;
      }
    }
    ctx.fillStyle = ok ? 'rgba(80,220,100,0.35)' : 'rgba(230,70,60,0.35)';
    ctx.fillRect(tx * ts, ty * ts, tw * ts, th * ts);
    ctx.strokeStyle = ok ? '#6fe08a' : '#e85a4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx * ts + 0.5, ty * ts + 0.5, tw * ts - 1, th * ts - 1);
  }

  function drawEffects(now) {
    for (const e of fx) {
      const age = now - e.t0;
      if (e.k === 'swing' && age < 160) {
        const half = e.a * Math.PI / 360;
        ctx.fillStyle = 'rgba(255,255,255,' + (0.28 * (1 - age / 160)) + ')';
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 4);
        ctx.arc(e.x, e.y - 4, e.r, e.f - half, e.f + half);
        ctx.closePath();
        ctx.fill();
      } else if (e.k === 'shot' && age < 100) {
        const a = 1 - age / 100;
        ctx.strokeStyle = 'rgba(255,235,160,' + a + ')';
        ctx.lineWidth = 1;
        for (const t of e.tr) {
          ctx.beginPath(); ctx.moveTo(e.x, e.y - 4); ctx.lineTo(t.x, t.y - 4); ctx.stroke();
          if (t.hit) { ctx.fillStyle = 'rgba(255,80,60,' + a + ')'; ctx.fillRect(t.x - 2, t.y - 6, 4, 4); }
        }
        ctx.fillStyle = 'rgba(255,220,120,' + a + ')';
        ctx.fillRect(e.x - 3, e.y - 7, 6, 6);
      }
    }
    for (const p of parts) {
      const a = 1 - (now - p.t0) / p.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
    ctx.globalAlpha = 1;
    ctx.font = 'bold 8px monospace';
    for (const f of floaters) {
      const age = now - f.t0;
      ctx.globalAlpha = Math.max(0, 1 - age / f.life);
      ctx.fillStyle = '#000';
      ctx.fillText(f.text, Math.round(f.x) + 1, Math.round(f.y - age * 0.03) + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, Math.round(f.x), Math.round(f.y - age * 0.03));
    }
    ctx.globalAlpha = 1;
  }

  function hole(x, y, r) {
    const g = dctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.9)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g;
    dctx.beginPath();
    dctx.arc(x, y, r, 0, Math.PI * 2);
    dctx.fill();
  }
  function drawDarkness(camX, camY, now, n) {
    if (n < 0.01) return;
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, W, H);
    dctx.fillStyle = 'rgba(3,5,16,' + (0.95 * n).toFixed(3) + ')';
    dctx.fillRect(0, 0, W, H);
    dctx.globalCompositeOperation = 'destination-out';
    const vis = cfg.dayVisionRadius + (cfg.nightVisionRadius - cfg.dayVisionRadius) * n;
    hole(me.x * S - camX, me.y * S - camY, vis * S);
    const lights = [];
    for (const s of structs.values()) {
      const d = defs.structures[s.ty];
      if (!d || !d.light) continue;
      const sx = s.x * S - camX, sy = s.y * S - camY, r = d.light * S * (1 + 0.04 * Math.sin(now / 90 + s.id));
      if (sx < -r || sy < -r || sx > W + r || sy > H + r) continue;
      hole(sx, sy, r);
      lights.push({ sx, sy, r });
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(dark, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const g = ctx.createRadialGradient(l.sx, l.sy, 2, l.sx, l.sy, l.r);
      g.addColorStop(0, 'rgba(255,150,50,' + (0.22 * n).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,150,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(l.sx - l.r, l.sy - l.r, l.r * 2, l.r * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const z of zombies.values()) {
      if (z.type !== 'night' || z.st === 4) continue;
      const ex = z.x * S - camX, ey = (z.y - 12) * S - camY;
      ctx.fillStyle = '#e8f06a';
      ctx.fillRect(Math.round(ex - 5), Math.round(ey), 3, 3);
      ctx.fillRect(Math.round(ex + 2), Math.round(ey), 3, 3);
    }
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#050605';
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    const sx = shake > 0.1 ? (Math.random() - 0.5) * shake * S : 0;
    const sy = shake > 0.1 ? (Math.random() - 0.5) * shake * S : 0;
    const camX = Math.round(me.x * S - W / 2 + sx), camY = Math.round(me.y * S - H / 2 + sy);
    ctx.setTransform(S, 0, 0, S, -camX, -camY);
    const ts = world.ts;
    const x0 = camX / S - 40, y0 = camY / S - 60, x1 = (camX + W) / S + 40, y1 = (camY + H) / S + 40;
    const drawables = [];
    drawTiles(Math.floor(x0 / ts), Math.floor(y0 / ts), Math.floor(x1 / ts), Math.floor(y1 / ts), now, drawables);

    let nearLoot = null, nd = cfg.pickupRadius + cfg.playerRadius;
    for (const l of loot.values()) {
      const d = Math.hypot(l.x - me.x, l.y - me.y);
      if (d < nd) { nd = d; nearLoot = l; }
    }
    for (const l of loot.values()) if (l.x > x0 && l.x < x1 && l.y > y0 && l.y < y1) drawLoot(l, now, l === nearLoot);

    for (const s of structs.values()) {
      const d = defs.structures[s.ty];
      const ground = d && !d.blocks && s.ty === 'spike_trap';
      if (s.x < x0 - 40 || s.x > x1 + 40 || s.y < y0 - 40 || s.y > y1 + 40) continue;
      if (ground) drawStruct(s, now);
      else drawables.push({ y: s.tyy * ts + s.h * ts, fn: () => drawStruct(s, now) });
    }
    for (const z of zombies.values()) drawables.push({ y: z.y + 1, fn: () => drawZombie(z, now) });
    for (const o of others.values()) drawables.push({ y: o.y, fn: () => drawPlayer(o, false, now) });
    drawables.push({ y: me.y, fn: () => drawPlayer({ id: myId, x: me.x, y: me.y, name: '' }, true, now) });
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.fn();

    drawGhost();
    drawEffects(now);
    drawDarkness(camX, camY, now, nightFactor());

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (hurtFlash > 0.02) { ctx.fillStyle = 'rgba(190,0,0,' + (hurtFlash * 0.3) + ')'; ctx.fillRect(0, 0, W, H); }
    if (stats.hp < 30 && !me.dead) {
      const pulse = 0.25 + 0.15 * Math.sin(now / 250);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(160,0,0,0)');
      g.addColorStop(1, 'rgba(160,0,0,' + pulse + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ------------------------------------------------------------ input
  function nearestStruct(filter, range) {
    let best = null, bd = range;
    for (const s of structs.values()) {
      if (filter && !filter(s)) continue;
      const d = Math.hypot(s.x - me.x, s.y - me.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function pickupNearest() {
    let best = null, bd = cfg.pickupRadius + cfg.playerRadius;
    for (const l of loot.values()) {
      const d = Math.hypot(l.x - me.x, l.y - me.y);
      if (d < bd) { bd = d; best = l; }
    }
    if (best) { send({ t: 'pickup', id: best.id }); sfx('pickup'); }
  }
  window.addEventListener('keydown', e => {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (!playing) return;
    keys.add(e.code);
    if (e.repeat) return;
    const dg = e.code.match ? null : null;
    if (e.code.indexOf('Digit') === 0) { const n = Number(e.code.slice(5)); if (n >= 1 && n <= 9) selectSlot(n - 1); return; }
    switch (e.code) {
      case 'KeyR': send({ t: 'reload' }); break;
      case 'KeyF': {
        const s = inv[sel];
        const d = s && defs.items[s.id];
        if (d && CONSUMABLE[d.category]) send({ t: 'use', slot: sel });
        else addFeed('Select a food, drink or medical item first', '#e8c46a');
        break;
      }
      case 'KeyE': pickupNearest(); break;
      case 'KeyZ': send({ t: 'drop', slot: sel }); break;
      case 'KeyB': togglePanel('build'); break;
      case 'KeyC': togglePanel('craft'); break;
      case 'Tab': e.preventDefault(); togglePanel('inv'); break;
      case 'KeyG': { const s = nearestStruct(o => defs.structures[o.ty] && defs.structures[o.ty].gate, 90); if (s) send({ t: 'gate', id: s.id }); break; }
      case 'KeyX': { const s = nearestStruct(o => defs.structures[o.ty] && defs.structures[o.ty].repair && o.hp < o.mhp, 90); if (s) send({ t: 'repair', id: s.id }); else addFeed('Nothing damaged nearby', '#e8c46a'); break; }
      case 'KeyV': { const s = nearestStruct(o => o.o === myId, 90); if (s) send({ t: 'dismantle', id: s.id }); break; }
      case 'Escape':
        buildType = null;
        if (buildOpen) togglePanel('build');
        if (craftOpen) togglePanel('craft');
        if (invOpen) togglePanel('inv');
        break;
      default: break;
    }
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); });
  window.addEventListener('blur', () => { keys.clear(); mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', e => {
    initAudio();
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!playing || me.dead) return;
    if (e.button === 2) { if (buildType) { buildType = null; renderBuild(); } return; }
    if (e.button !== 0) return;
    mouse.wx = me.x + (mouse.x - W / 2) / S;
    mouse.wy = me.y + (mouse.y - H / 2) / S;
    if (buildOpen && buildType) send({ t: 'build', type: buildType, x: mouse.wx, y: mouse.wy });
    else mouse.down = true;
  });
  window.addEventListener('mouseup', () => { mouse.down = false; });
  window.addEventListener('wheel', e => {
    if (!playing) return;
    selectSlot((sel + (e.deltaY > 0 ? 1 : 8)) % 9);
  }, { passive: true });

  function startGame() {
    initAudio();
    const name = $('name').value.trim() || 'Survivor';
    try { localStorage.setItem('zomfield_name', name); } catch (e) { /* ignore */ }
    connect(name);
  }
  $('play').onclick = startGame;
  $('name').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
  try { $('name').value = localStorage.getItem('zomfield_name') || ''; } catch (e) { /* ignore */ }

  setInterval(() => { if (playing) send({ t: 'ping', ts: Date.now() }); }, 2000);
  setInterval(() => {
    if (playing && me.dead) $('deadtimer').textContent = 'Respawning shortly...';
  }, 500);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (playing) {
      try { update(dt, now); draw(now); } catch (err) { console.error(err); }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
