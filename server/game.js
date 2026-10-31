'use strict';
const data = require('./data');
const { config, zombies: ZDEF, weapons, items, structures: SDEF, spawn: SPAWN, loot: LOOTCFG } = data;
const recipes = data.recipes || {};
const { World } = require('./world');
const { Player } = require('./player');
const { Zombie, ST, DEATH_ANIM_MS } = require('./zombie');
const { StructureManager } = require('./structures');
const { LootManager } = require('./loot');
const { Combat } = require('./combat');
const { Spawner } = require('./spawner');
const { WaveManager } = require('./waves');
const { dist, dist2, clamp } = require('./util');

const NET = config.network;
const DN = config.dayNight;
const HASH = 64;
const ACTIVE_RADIUS = 1000;
const PATHS_PER_TICK = 10;
const MSG_BURST = 60;
const MSG_RATE = 90;

const num = v => typeof v === 'number' && Number.isFinite(v);

class Game {
  constructor(opts) {
    opts = opts || {};
    this.world = new World(SPAWN, opts.seed || 1337);
    this.players = new Map();
    this.zombies = new Map();
    this.zombieDefs = ZDEF;
    this.hash = new Map();
    this.events = [];
    this._pl = [];
    this.tickCount = 0;
    this.startMs = Date.now();
    this.lastTick = Date.now();
    this.timeOfDay = DN.startTime;
    this.night = false;
    this.avgTickMs = 0;
    this.maxTickMs = 0;
    this.nextDawnCheck = 0;
    this.timer = null;

    this.structures = new StructureManager(this.world);
    this.loot = new LootManager(this.world);
    this.combat = new Combat(this);
    this.spawner = new Spawner(this);
    this.waves = new WaveManager(this);
    this.wavesRequested = opts.waves !== undefined ? !!opts.waves : !!config.waves.enabled;

    this.zctx = {
      world: this.world,
      isNight: false,
      pathBudget: { left: PATHS_PER_TICK },
      nearestPlayer: (x, y, r) => this.nearestPlayer(x, y, r),
      getPlayer: id => this.players.get(id) || null,
      emit: e => this.emit(e),
      damageStructure: (s, d, z) => this.structures.damage(s, d, z),
      zombieHitPlayer: (z, p, d, now) => this.zombieHitPlayer(z, p, d, now),
      zombiesNear: (x, y, r) => this.zombiesNear(x, y, r)
    };

    this.clientDefs = this.buildClientDefs();
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.lastTick = Date.now();
    this.waves.setEnabled(this.wavesRequested, Date.now());
    this.timer = setInterval(() => this.tick(), Math.round(1000 / config.server.tickRate));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------------------------------------------------------------- helpers
  emit(e) { this.events.push(e); }
  refreshPlayers() { this._pl = Array.from(this.players.values()); }
  alivePlayers() { return this._pl.filter(p => !p.dead); }
  isNight() { return this.night; }

  // Structure manager treats the game as its context object.
  // (Named playerList because this.players is the id -> Player Map.)
  playerList() { return this._pl; }

  nearestPlayer(x, y, r) {
    let best = null, bd = r * r;
    for (const p of this._pl) {
      if (p.dead) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  cellKey(cx, cy) { return cx * 4096 + cy; }

  hashAdd(z) {
    const k = this.cellKey(Math.floor(z.x / HASH), Math.floor(z.y / HASH));
    let a = this.hash.get(k);
    if (!a) { a = []; this.hash.set(k, a); }
    a.push(z);
  }

  rebuildHash() {
    this.hash.clear();
    for (const z of this.zombies.values()) this.hashAdd(z);
  }

  zombiesNear(x, y, r) {
    const out = [];
    const x0 = Math.max(0, Math.floor((x - r) / HASH)), x1 = Math.max(0, Math.floor((x + r) / HASH));
    const y0 = Math.max(0, Math.floor((y - r) / HASH)), y1 = Math.max(0, Math.floor((y + r) / HASH));
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const a = this.hash.get(this.cellKey(cx, cy));
        if (a) for (const z of a) out.push(z);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- zombies
  addZombie(type, x, y, opts) {
    const z = new Zombie(type, x, y, opts);
    this.zombies.set(z.id, z);
    this.hashAdd(z);
    return z;
  }

  removeZombie(z, reason) {
    z.dead = true;
    z.state = ST.DEAD;
    this.zombies.delete(z.id);
    if (reason === 'dawn') this.emit({ t: 'zburn', id: z.id, x: Math.round(z.x), y: Math.round(z.y) });
  }

  damageZombie(z, dmg, attackerId, now, source) {
    if (z.dead) return false;
    const killed = z.takeDamage(dmg, attackerId, now);
    this.emit({ t: 'zhit', id: z.id, x: Math.round(z.x), y: Math.round(z.y), dmg: Math.round(dmg) });
    if (killed) this.onZombieDeath(z, now, source);
    return killed;
  }

  onZombieDeath(z, now, source) {
    this.emit({ t: 'zdie', id: z.id, ty: z.type, x: Math.round(z.x), y: Math.round(z.y) });
    this.loot.dropFromZombie(z, now);
    const killer = this.players.get(z.killerId);
    if (killer) {
      killer.kills++;
      killer.score += Math.max(1, Math.round(z.maxHealth / 10));
      killer.statsDirty = true;
    }
    this.spawner.onZombieKilled(z, now);
    this.waves.onZombieKilled(z);
  }

  alertZombies(x, y, radius, now) {
    for (const z of this.zombiesNear(x, y, radius)) {
      if (z.dead) continue;
      if (dist(x, y, z.x, z.y) <= radius) z.hearNoise(x, y, now);
    }
  }

  zombieHitPlayer(z, p, dmg, now) {
    if (p.dead) return;
    const killed = p.takeDamage(dmg, now);
    this.emit({ t: 'phit', id: p.id, zid: z.id, x: Math.round(p.x), y: Math.round(p.y), dmg: Math.round(dmg) });
    p.rollAfflictions(now);
    if (killed) this.killPlayer(p, 'zombie:' + z.type, now);
  }

  // ---------------------------------------------------------------- players
  join(ws, name) {
    if (this.players.size >= config.server.maxPlayers) {
      this.send(ws, { t: 'full' });
      try { ws.close(1013, 'full'); } catch (e) { /* ignore */ }
      return null;
    }
    const cleaned = String(name || '').replace(/[^\w \-]/g, '').trim();
    const p = new Player(cleaned || 'Survivor', ws);
    p.bucket = MSG_BURST;
    p.bucketAt = Date.now();
    p.violations = 0;
    p.knownZ = new Map();
    p.knownL = new Map();
    const c = { x: this.world.pxW / 2, y: this.world.pxH / 2 };
    const pt = this.world.findFreePoint(c.x, c.y, p.radius, 150, 50) || c;
    p.x = pt.x;
    p.y = pt.y;
    ws.player = p;
    this.players.set(p.id, p);
    this.refreshPlayers();
    this.send(ws, this.initMessage(p));
    return p;
  }

  leave(p) {
    if (!p) return;
    this.players.delete(p.id);
    if (p.ws) p.ws.player = null;
    this.refreshPlayers();
    this.emit({ t: 'pleave', id: p.id });
  }

  killPlayer(p, cause, now) {
    if (p.dead) return;
    p.dead = true;
    p.deaths++;
    p.health = 0;
    p.respawnAt = now + config.player.respawnDelayMs;
    p.reload = null;
    p.using = null;
    p.input = { dx: 0, dy: 0, sprint: false };
    p.statsDirty = true;
    if (!config.player.respawnKeepsInventory) this.loot.dropInventory(p, now);
    this.emit({ t: 'pdie', id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), cause });
    p.events.push({ t: 'died', cause, ms: config.player.respawnDelayMs });
  }

  respawn(p, now) {
    const c = { x: this.world.pxW / 2, y: this.world.pxH / 2 };
    const pt = this.world.findFreePoint(c.x, c.y, p.radius, 150, 50) || c;
    p.x = pt.x;
    p.y = pt.y;
    p.respawnReset();
    p.events.push({ t: 'respawn' });
    this.emit({ t: 'prespawn', id: p.id, x: Math.round(p.x), y: Math.round(p.y) });
  }

  // ---------------------------------------------------------------- messages
  onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'join') {
      if (!ws.player) this.join(ws, msg.name);
      return;
    }
    const p = ws.player;
    if (!p) return;

    // Token bucket: protects the server from message floods.
    const nowMs = Date.now();
    p.bucket = Math.min(MSG_BURST, p.bucket + ((nowMs - p.bucketAt) / 1000) * MSG_RATE);
    p.bucketAt = nowMs;
    if (p.bucket < 1) {
      if (++p.violations > 300) { try { ws.close(1008, 'rate limit'); } catch (e) { /* ignore */ } }
      return;
    }
    p.bucket -= 1;
    this.handle(p, msg, nowMs);
  }

  err(p, code) { p.events.push({ t: 'err', code }); }

  handle(p, msg, now) {
    switch (msg.t) {
      case 'input':
        if (!p.dead) p.setInput(msg);
        break;
      case 'attack':
        if (num(msg.facing)) p.facing = msg.facing;
        this.combat.attack(p, now);
        break;
      case 'reload':
        this.combat.startReload(p, now);
        break;
      case 'select':
        if (Number.isInteger(msg.slot) && msg.slot >= 0 && msg.slot < p.inv.size && !p.dead) {
          if (p.selected !== msg.slot) { p.selected = msg.slot; p.reload = null; p.statsDirty = true; }
        }
        break;
      case 'use':
        if (Number.isInteger(msg.slot)) {
          if (!this.combat.useItem(p, msg.slot, now)) this.err(p, 'cannot_use');
        }
        break;
      case 'swap':
        if (!p.dead) p.inv.swap(msg.a, msg.b);
        break;
      case 'drop':
        this.dropItem(p, msg, now);
        break;
      case 'pickup': {
        if (!Number.isInteger(msg.id)) break;
        const r = this.loot.pickup(p, msg.id);
        if (!r.ok) this.err(p, r.error);
        break;
      }
      case 'build': {
        if (typeof msg.type !== 'string' || !num(msg.x) || !num(msg.y)) break;
        const r = this.structures.tryPlace(p, msg.type, msg.x, msg.y, this, now);
        if (!r.ok) this.err(p, r.error);
        break;
      }
      case 'repair': {
        if (!Number.isInteger(msg.id)) break;
        const r = this.structures.repair(p, msg.id);
        if (!r.ok) this.err(p, r.error);
        break;
      }
      case 'dismantle': {
        if (!Number.isInteger(msg.id)) break;
        const r = this.structures.dismantle(p, msg.id);
        if (!r.ok) this.err(p, r.error);
        break;
      }
      case 'gate': {
        if (!Number.isInteger(msg.id)) break;
        const r = this.structures.toggleGate(p, msg.id, this);
        if (!r.ok) this.err(p, r.error);
        break;
      }
      case 'craft':
        if (typeof msg.id === 'string') this.craft(p, msg.id, now);
        break;
      case 'ping':
        this.send(p.ws, { t: 'pong', ts: msg.ts });
        break;
      default:
        break;
    }
  }

  dropItem(p, msg, now) {
    if (p.dead || p.using || !Number.isInteger(msg.slot)) return;
    const s = p.inv.slot(msg.slot);
    if (!s) return;
    let n = Number.isInteger(msg.n) ? msg.n : s.count;
    n = clamp(n, 1, s.count);
    const id = s.id;
    const extra = { durability: s.durability, mag: s.mag };
    s.count -= n;
    if (s.count <= 0) p.inv.clearSlot(msg.slot);
    p.inv.dirty = true;
    this.loot.spawnAt(p.x + Math.cos(p.facing) * 18, p.y + Math.sin(p.facing) * 18, id, n, extra, now);
  }

  craft(p, id, now) {
    const r = recipes[id];
    if (!r) return this.err(p, 'unknown_recipe');
    if (p.dead || p.reload || p.using) return;
    if (!p.inv.pay(r.cost)) return this.err(p, 'not_enough_resources');
    const left = p.inv.add(r.output, r.count || 1);
    if (left > 0) this.loot.spawnAt(p.x, p.y, r.output, left, null, now);
  }

  // ---------------------------------------------------------------- main tick
  tick() {
    const t0 = process.hrtime.bigint();
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt <= 0) return;
    if (dt > 0.1) dt = 0.1;
    this.tickCount++;

    // day / night
    this.timeOfDay = (DN.startTime + (now - this.startMs) / 1000 / DN.dayLengthSec) % 1;
    this.night = this.timeOfDay >= DN.nightStart && this.timeOfDay < DN.nightEnd;
    this.zctx.isNight = this.night;
    this.zctx.pathBudget.left = PATHS_PER_TICK;

    this.refreshPlayers();
    this.world.update(now);

    for (const p of this._pl) {
      if (p.dead) {
        if (now >= p.respawnAt) this.respawn(p, now);
        continue;
      }
      this.combat.update(p, now);
      p.move(this.world, dt, now, p.reload || p.using ? 0.7 : 1);
      const cause = p.tickSurvival(dt, now);
      if (cause) this.killPlayer(p, cause, now);
    }

    this.spawner.update(now);
    this.waves.update(now);

    this.rebuildHash();
    const activeR2 = ACTIVE_RADIUS * ACTIVE_RADIUS;
    const alive = this.alivePlayers();
    for (const z of Array.from(this.zombies.values())) {
      if (z.dead) {
        if (now - z.deadAt >= DEATH_ANIM_MS) this.zombies.delete(z.id);
        continue;
      }
      let active = false;
      for (const p of alive) {
        if (dist2(z.x, z.y, p.x, p.y) < activeR2) { active = true; break; }
      }
      if (active) z.update(this.zctx, dt, now);
    }

    this.structures.update(dt, now, this);
    this.loot.update(now);

    // Night-only zombies burn away at dawn.
    if (!this.night && now >= this.nextDawnCheck) {
      this.nextDawnCheck = now + 1000;
      for (const z of Array.from(this.zombies.values())) {
        if (!z.dead && z.def.nightOnly && !z.fromWave && Math.random() < 0.15) this.removeZombie(z, 'dawn');
      }
    }

    const every = Math.max(1, Math.round(config.server.tickRate / config.server.snapshotRate));
    if (this.tickCount % every === 0) this.sendSnapshots(now);

    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    this.avgTickMs = this.avgTickMs * 0.95 + ms * 0.05;
    if (ms > this.maxTickMs) this.maxTickMs = ms;
  }

  // ---------------------------------------------------------------- networking
  send(ws, obj) {
    try {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
    } catch (e) { /* ignore */ }
  }

  buildClientDefs() {
    const wp = {};
    for (const [id, w] of Object.entries(weapons)) {
      wp[id] = { name: w.name, type: w.type, range: w.range, arcDeg: w.arcDeg, cooldownMs: w.cooldownMs, magazineSize: w.magazineSize, ammoType: w.ammoType, reloadMs: w.reloadMs, durability: w.durability, sound: w.sound };
    }
    const its = {};
    for (const [id, i] of Object.entries(items)) its[id] = { name: i.name, stack: i.stack, category: i.category, weapon: !!i.weapon };
    const st = {};
    for (const [id, s] of Object.entries(SDEF)) {
      st[id] = { name: s.name, size: s.size, cost: s.cost, health: s.health, blocks: s.blocksMovement, light: s.light ? s.light.radius : 0, gate: !!s.gate, trap: !!s.trap, repair: s.repair ? s.repair.cost : null };
    }
    const zb = {};
    for (const [id, z] of Object.entries(ZDEF)) zb[id] = { name: z.name, radius: z.radius };
    return { weapons: wp, items: its, structures: st, zombies: zb, recipes };
  }

  initMessage(p) {
    return {
      t: 'init',
      id: p.id,
      world: { w: this.world.w, h: this.world.h, ts: this.world.ts, tiles: Buffer.from(this.world.tiles).toString('base64') },
      structures: this.structures.snapshotAll(),
      cfg: {
        tickRate: config.server.tickRate,
        snapshotRate: config.server.snapshotRate,
        interestRadius: NET.interestRadius,
        dayLengthSec: DN.dayLengthSec,
        nightStart: DN.nightStart,
        nightEnd: DN.nightEnd,
        nightVisionRadius: DN.nightVisionRadius,
        dayVisionRadius: DN.dayVisionRadius,
        speed: config.player.speed,
        sprintMultiplier: config.player.sprintMultiplier,
        playerRadius: config.player.radius,
        maxHealth: config.player.maxHealth,
        slots: config.player.inventorySlots,
        pickupRadius: LOOTCFG.pickupRadius,
        buildRange: 110
      },
      defs: this.clientDefs
    };
  }

  sendSnapshots(now) {
    const R = NET.interestRadius;
    const structEvents = this.structures.drainEvents();
    const terrain = this.world.drainChanges();
    this.loot.drainEvents(); // loot is synchronised by interest diff, not by events
    const events = this.events;
    this.events = [];
    const waveState = this.waves.enabled ? this.waves.publicState(now) : null;
    const tod = Math.round(this.timeOfDay * 10000) / 10000;

    for (const p of this._pl) {
      const ws = p.ws;
      if (!ws || ws.readyState !== 1) continue;
      if (ws.bufferedAmount > 1000000) continue; // slow client: skip this snapshot

      // Zombies in this player's area of interest.
      const cand = [];
      for (const z of this.zombiesNear(p.x, p.y, R)) {
        const d = dist2(p.x, p.y, z.x, z.y);
        if (d <= R * R) cand.push({ z, d });
      }
      cand.sort((a, b) => a.d - b.d);
      if (cand.length > NET.maxZombiesPerSnapshot) cand.length = NET.maxZombiesPerSnapshot;

      const add = [], upd = [], seen = new Set();
      for (const { z } of cand) {
        if (!this.zombies.has(z.id)) continue;
        seen.add(z.id);
        const s = z.publicState();
        const key = s.x + '|' + s.y + '|' + s.f + '|' + s.hp + '|' + s.st + '|' + s.tg;
        const prev = p.knownZ.get(z.id);
        if (prev === undefined) { add.push(s); p.knownZ.set(z.id, key); }
        else if (prev !== key) { upd.push(s); p.knownZ.set(z.id, key); }
      }
      const del = [];
      for (const id of p.knownZ.keys()) {
        if (!seen.has(id)) { del.push(id); p.knownZ.delete(id); }
      }

      // Loot in range.
      const ladd = [], lseen = new Set();
      for (const d of this.loot.drops.values()) {
        if (dist2(p.x, p.y, d.x, d.y) > R * R) continue;
        lseen.add(d.id);
        if (p.knownL.get(d.id) !== d.count) { ladd.push(this.loot.publicState(d)); p.knownL.set(d.id, d.count); }
      }
      const ldel = [];
      for (const id of p.knownL.keys()) {
        if (!lseen.has(id)) { ldel.push(id); p.knownL.delete(id); }
      }

      // Other players nearby.
      const pls = [];
      const pr2 = R * R * 1.7;
      for (const o of this._pl) {
        if (o === p || dist2(p.x, p.y, o.x, o.y) <= pr2) pls.push(o.publicState());
      }

      // Events: positional ones only if nearby, others (waves) for everyone.
      const er2 = R * R * 1.44;
      const ev = [];
      for (const e of events) {
        if (e.x === undefined || dist2(p.x, p.y, e.x, e.y) <= er2) ev.push(e);
      }
      for (const e of p.events) ev.push(e);
      p.events = [];

      const msg = {
        t: 'snap',
        n: this.tickCount,
        tod,
        me: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 },
        pl: pls
      };
      if (add.length || upd.length || del.length) msg.z = { a: add, u: upd, d: del };
      if (ladd.length || ldel.length) msg.l = { a: ladd, d: ldel };
      if (ev.length) msg.ev = ev;
      if (structEvents.length) msg.se = structEvents;
      if (terrain.length) msg.tc = terrain;
      if (waveState) msg.wv = waveState;
      if (p.inv.dirty) { msg.inv = p.inv.serialize(); p.inv.dirty = false; }
      if (p.statsDirty) { msg.st = p.stats(); p.statsDirty = false; }
      msg.sel = p.selected;
      msg.busy = p.reload ? 'reload' : p.using ? 'use' : null;
      this.send(ws, msg);
    }
  }

  status() {
    let zAlive = 0;
    for (const z of this.zombies.values()) if (!z.dead) zAlive++;
    return {
      players: this.players.size,
      zombies: zAlive,
      structures: this.structures.list.size,
      loot: this.loot.drops.size,
      night: this.night,
      timeOfDay: Math.round(this.timeOfDay * 1000) / 1000,
      avgTickMs: Math.round(this.avgTickMs * 100) / 100,
      maxTickMs: Math.round(this.maxTickMs * 100) / 100,
      waves: this.waves.publicState(Date.now())
    };
  }
}

module.exports = { Game };
