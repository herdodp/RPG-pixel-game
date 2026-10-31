'use strict';
const data = require('./data');
const { config, classes, items, zones, monsters: MDEF, spawns, bosses: BDEF, npcs, quests, questById } = data;
const { World } = require('./world');
const { Character } = require('./character');
const { Monster, ST: MST, DEATH_MS } = require('./monster');
const { Boss, DEATH_MS: BOSS_DEATH_MS } = require('./boss');
const { Combat, monsterDamage } = require('./combat');
const { Storage } = require('./storage');
const { dist, dist2, weightedPick, randInt, clamp } = require('./util');

const NET = config.network;
const DN = config.dayNight;
const HASH = 96;
const ACTIVE_RADIUS = 1100;
const MSG_BURST = 60;
const MSG_RATE = 80;
const NPC_RANGE = 90;
const LOOT_RADIUS = 36;
const LOOT_TTL = 90000;

const num = v => typeof v === 'number' && Number.isFinite(v);

class Game {
  constructor() {
    this.world = new World(4242);
    this.storage = new Storage();
    this.players = new Map();
    this.byName = new Map();
    this.monsters = new Map();
    this.bosses = new Map();
    this.hash = new Map();
    this.loot = new Map();
    this.events = [];
    this.timers = [];
    this.respawnQueue = [];
    this.tickCount = 0;
    this.startMs = Date.now();
    this.lastTick = Date.now();
    this.nextSave = Date.now() + config.server.saveIntervalSec * 1000;
    this.timeOfDay = DN.startTime;
    this.night = false;
    this.timer = null;
    this.combat = new Combat(this);
    this._pl = [];
    this.chatLog = [];

    this.mctx = {
      world: this.world,
      nearestPlayer: (x, y, r) => this.nearestPlayer(x, y, r),
      getPlayer: id => this.players.get(id) || null,
      playersNear: (x, y, r) => this._pl.filter(p => dist2(x, y, p.x, p.y) <= r * r),
      hitPlayer: (m, p, dmg, now) => this.monsterHitPlayer(m, p, dmg, now),
      emit: e => this.emit(e),
      spawnMinion: (type, x, y, owner, now) => this.spawnMinion(type, x, y, owner, now)
    };

    this.zoneSlots = spawns.map(sp => ({ cfg: sp, zone: zones.find(z => z.id === sp.zone), count: 0 }));
    this.populate();
    for (const key of Object.keys(BDEF)) this.bosses.set(key, new Boss(key, Date.now()));

    this.clientDefs = this.buildClientDefs();
  }

  // ---------------------------------------------------------------- lifecycle
  start() {
    this.lastTick = Date.now();
    this.timer = setInterval(() => this.tick(), Math.round(1000 / config.server.tickRate));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.saveAll();
    this.storage.flush();
  }

  emit(e) { this.events.push(e); }
  schedule(at, fn) { this.timers.push({ at, fn }); }
  refreshPlayers() { this._pl = Array.from(this.players.values()); }

  nearestPlayer(x, y, r) {
    let best = null, bd = r * r;
    for (const p of this._pl) {
      if (p.dead) continue;
      const d = dist2(x, y, p.x, p.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------------- spatial hash
  cellKey(cx, cy) { return cx * 4096 + cy; }
  rebuildHash() {
    this.hash.clear();
    for (const m of this.monsters.values()) {
      const k = this.cellKey(Math.floor(m.x / HASH), Math.floor(m.y / HASH));
      let a = this.hash.get(k);
      if (!a) { a = []; this.hash.set(k, a); }
      a.push(m);
    }
  }
  monstersNear(x, y, r) {
    const out = [];
    const x0 = Math.max(0, Math.floor((x - r) / HASH)), x1 = Math.max(0, Math.floor((x + r) / HASH));
    const y0 = Math.max(0, Math.floor((y - r) / HASH)), y1 = Math.max(0, Math.floor((y + r) / HASH));
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const a = this.hash.get(this.cellKey(cx, cy));
      if (a) for (const m of a) out.push(m);
    }
    return out;
  }

  // ---------------------------------------------------------------- monsters
  populate() {
    for (let zi = 0; zi < this.zoneSlots.length; zi++) {
      const zs = this.zoneSlots[zi];
      for (let i = 0; i < zs.cfg.max; i++) this.spawnInZone(zi, true);
    }
  }

  spawnInZone(zi, initial) {
    const zs = this.zoneSlots[zi];
    const pt = this.world.randomFreePointInRect(zs.zone.rect, 12, 25);
    if (!pt) return null;
    if (dist(pt.x, pt.y, config.world.spawn.x, config.world.spawn.y) < 320) return null;
    for (const b of this.bosses.values()) if (dist(pt.x, pt.y, b.homeX, b.homeY) < 220) return null;
    const type = weightedPick(zs.cfg.mix);
    if (!type) return null;
    const m = new Monster(type, pt.x, pt.y, { zoneIdx: zi });
    this.monsters.set(m.id, m);
    zs.count++;
    return m;
  }

  spawnMinion(type, x, y, ownerId, now) {
    if (!MDEF[type]) return null;
    const m = new Monster(type, x, y, { summoned: true, ownerBoss: ownerId });
    this.monsters.set(m.id, m);
    const boss = Array.from(this.bosses.values()).find(b => b.id === ownerId);
    if (boss && boss.targetId) {
      m.targetId = boss.targetId;
      m.setState(MST.CHASE, now);
    }
    return m;
  }

  // ---------------------------------------------------------------- combat results
  monsterHitPlayer(m, p, rawAtk, now) {
    if (p.dead) return;
    const isBoss = m.kind === 'boss';
    const dmg = monsterDamage(rawAtk, p.stats, 1);
    const killed = p.takeDamage(dmg, now);
    this.emit({ t: 'dmg', id: p.id, x: Math.round(p.x), y: Math.round(p.y), v: dmg, me: true });
    if (killed) this.killPlayer(p, m.name, now);
  }

  killPlayer(p, by, now) {
    if (p.dead) return;
    p.dead = true;
    p.deaths++;
    p.hp = 0;
    p.respawnAt = now + config.player.respawnDelayMs;
    p.input = { dx: 0, dy: 0 };
    const loss = Math.round(p.xpNeeded() * config.player.deathXpLossPct);
    p.xp = Math.max(0, p.xp - loss);
    p.dirtyStats = true;
    this.emit({ t: 'pdie', id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y) });
    p.events.push({ t: 'died', by, loss, ms: config.player.respawnDelayMs });
  }

  // Pindahkan player ke titik bebas terdekat kalau posisinya terblokir (batu/pohon).
  // force=true: cek ke titik spawn kalau tidak ada titik bebas di sekitar.
  unstick(p, force) {
    const r = p.radius;
    if (!this.world.circleBlocked(p.x, p.y, r, true)) return false;
    const pt = this.world.nearestFree(p.x, p.y, r, true, 640) || this.world.nearestFree(config.world.spawn.x, config.world.spawn.y, r, true, 640);
    if (!pt) return false;
    p.x = pt.x;
    p.y = pt.y;
    p.dirtyStats = true;
    return true;
  }

  respawn(p) {
    p.dead = false;
    p.x = config.world.spawn.x + (Math.random() - 0.5) * 60;
    p.y = config.world.spawn.y + (Math.random() - 0.5) * 60;
    this.unstick(p, true);
    p.hp = p.max.hp;
    p.mp = p.max.mp;
    p.dirtyStats = true;
    p.events.push({ t: 'respawn' });
  }

  // Rolls a drop table and puts the items on the ground for these owners.
  rollDrops(drops, x, y, now, owners) {
    for (const d of drops || []) {
      if (Math.random() < d.chance) {
        const n = randInt(d.min, d.max);
        this.spawnLoot(x, y, d.item, n, now, owners);
      }
    }
  }

  spawnLoot(x, y, item, n, now, owners) {
    if (!items[item] || n <= 0) return;
    const spot = this.world.findFreePoint(x, y, 4, 26, 10) || { x, y };
    const l = {
      id: Math.floor(Math.random() * 1e9) + 1, item, n,
      x: spot.x, y: spot.y, expires: now + LOOT_TTL,
      owners: owners && owners.length ? new Set(owners) : null,
      ownerUntil: now + 15000
    };
    this.loot.set(l.id, l);
  }

  onEnemyDeath(t, now) {
    if (t.kind === 'boss') return this.onBossDeath(t, now);
    const killer = this.players.get(t.lastHitBy);
    // XP goes to everyone who contributed, split by damage share.
    let total = 0;
    for (const v of t.threat.values()) total += v;
    const owners = [];
    for (const [pid, dmg] of t.threat) {
      const p = this.players.get(pid);
      if (!p || p.dead) continue;
      owners.push(pid);
      const share = total > 0 ? dmg / total : 0;
      this.grantXp(p, t, t.def.xp * share, now);
    }
    if (killer) killer.kills++;
    for (const pid of owners) { const op = this.players.get(pid); if (op) this.questProgress(op, 'kill', t.type); }
    const goldPlayer = killer || null;
    const gold = randInt(t.def.gold[0], t.def.gold[1]);
    if (goldPlayer && !goldPlayer.dead) { goldPlayer.gold += gold; goldPlayer.dirtyStats = true; }
    this.rollDrops(t.def.drops, t.x, t.y, now, owners.length ? owners : (killer ? [killer.id] : []));
    this.emit({ t: 'mdie', id: t.id, x: Math.round(t.x), y: Math.round(t.y) });
    if (t.zoneIdx >= 0) {
      const zs = this.zoneSlots[t.zoneIdx];
      this.respawnQueue.push({ at: now + zs.cfg.respawnMs, zi: t.zoneIdx });
    }
  }

  grantXp(p, monster, baseXp, now) {
    const diff = p.level - monster.level;
    let mul = 1;
    if (diff > 0) mul = Math.max(config.xp.minLevelDiffMul, 1 - diff * config.xp.levelDiffPenaltyPerLevel);
    const xp = Math.round(baseXp * mul);
    if (xp <= 0) return;
    const leveled = p.addXp(xp);
    p.events.push({ t: 'xp', v: xp });
    if (leveled) this.emit({ t: 'levelup', id: p.id, x: Math.round(p.x), y: Math.round(p.y), lv: p.level, name: p.name });
  }

  onBossDeath(b, now) {
    let total = 0;
    for (const v of b.threat.values()) total += v;
    const R = config.raid;
    const contributors = [];
    for (const [pid, dmg] of b.threat) {
      const share = total > 0 ? dmg / total : 0;
      if (share < R.minContributionPct) continue;
      const p = this.players.get(pid);
      if (!p) continue;
      contributors.push({ p, share });
    }
    for (const { p, share } of contributors) {
      const xp = Math.round(b.def.xp * share);
      const gold = Math.round(randInt(b.def.gold[0], b.def.gold[1]) * share + (p.id === b.lastHitBy ? R.lastHitBonusGold : 0));
      if (!p.dead) { p.gold += gold; p.dirtyStats = true; }
      this.grantBossXp(p, xp);
      p.bossKills++;
      this.questProgress(p, 'boss', b.key);
      p.events.push({ t: 'raidreward', boss: b.name, share: Math.round(share * 100), xp, gold });
      // Each contributor rolls the boss drop table for themselves (no ninja looting).
      this.rollDrops(b.def.drops, b.x, b.y, now, [p.id]);
    }
    for (const mid of b.summons) {
      const m = this.monsters.get(mid);
      if (m && !m.dead) { m.hp = 0; m.dead = true; m.deadAt = now; m.state = MST.RETURN; this.monsters.delete(mid); }
    }
    b.respawnAt = now + b.def.respawnSec * 1000;
    this.emit({ t: 'bdie', id: b.id, name: b.name, x: Math.round(b.x), y: Math.round(b.y) });
    this.emit({ t: 'announce', msg: b.name + ' telah dikalahkan oleh ' + contributors.length + ' petualang!' });
  }

  grantBossXp(p, xp) {
    if (xp <= 0) return;
    const leveled = p.addXp(xp);
    p.events.push({ t: 'xp', v: xp });
    if (leveled) this.emit({ t: 'levelup', id: p.id, x: Math.round(p.x), y: Math.round(p.y), lv: p.level, name: p.name });
  }

  // ---------------------------------------------------------------- accounts / join
  handleAuth(ws, msg) {
    const name = String(msg.name || '').trim();
    const pass = String(msg.pass || '');
    if (!Storage.validName(name)) return this.send(ws, { t: 'autherr', msg: 'Nama harus 3-16 karakter: huruf, angka, atau _.' });
    if (pass.length < 4 || pass.length > 64) return this.send(ws, { t: 'autherr', msg: 'Password minimal 4 karakter.' });
    if (this.players.size >= config.server.maxPlayers) return this.send(ws, { t: 'autherr', msg: 'Server penuh.' });
    if (ws.player) return;
    if (ws.authBusy) return;

    let acc;
    if (msg.t === 'register') {
      const cls = String(msg.cls || '');
      if (!classes[cls]) return this.send(ws, { t: 'autherr', msg: 'Class tidak valid.' });
      if (this.storage.exists(name)) return this.send(ws, { t: 'autherr', msg: 'Nama sudah dipakai.' });
      const c = Character.newCharacter(name, cls);
      acc = this.storage.register(name, pass, c.toSave());
    } else {
      acc = this.storage.verify(name, pass);
      if (!acc) return this.send(ws, { t: 'autherr', msg: 'Nama atau password salah.' });
    }
    if (this.byName.has(Storage.key(acc.name))) return this.send(ws, { t: 'autherr', msg: 'Akun ini sedang online.' });
    this.join(ws, acc);
  }

  join(ws, acc) {
    const p = new Character(acc.character, ws);
    p.accountKey = Storage.key(acc.name);
    p.bucket = MSG_BURST;
    p.bucketAt = Date.now();
    p.violations = 0;
    p.knownMon = new Map();
    p.knownBoss = new Map();
    p.knownLoot = new Map();
    p.lastSave = Date.now();
    if (p.dead || p.hp <= 0) { p.hp = p.max.hp; }
    this.unstick(p, true);
    ws.player = p;
    this.players.set(p.id, p);
    this.byName.set(p.accountKey, p);
    this.refreshPlayers();
    this.send(ws, this.initMessage(p));
    this.emit({ t: 'announce', msg: p.name + ' bergabung ke dunia.' });
  }

  leave(p) {
    if (!p) return;
    this.saveCharacter(p);
    this.storage.flush();
    this.players.delete(p.id);
    this.byName.delete(p.accountKey);
    if (p.ws) p.ws.player = null;
    this.refreshPlayers();
    this.emit({ t: 'pleave', id: p.id });
  }

  saveCharacter(p) {
    this.storage.saveCharacter(p.name, p.toSave());
  }

  saveAll() {
    for (const p of this.players.values()) this.saveCharacter(p);
  }

  // ---------------------------------------------------------------- messages
  onMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'login' || msg.t === 'register') return this.handleAuth(ws, msg);
    const p = ws.player;
    if (!p) return;

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
        this.combat.basicAttack(p, now);
        break;
      case 'skill': {
        if (!Number.isInteger(msg.i)) break;
        if (num(msg.facing)) p.facing = msg.facing;
        const e = this.combat.useSkill(p, msg.i, num(msg.x) ? msg.x : NaN, num(msg.y) ? msg.y : NaN, now);
        if (e) this.err(p, e);
        break;
      }
      case 'use': {
        if (!Number.isInteger(msg.slot)) break;
        const e = this.combat.usePotion(p, msg.slot, now);
        if (e) this.err(p, e);
        break;
      }
      case 'equip': {
        if (p.dead || !Number.isInteger(msg.slot)) break;
        const e = p.equipFromSlot(msg.slot);
        if (e) this.err(p, e);
        break;
      }
      case 'unequip': {
        if (p.dead || typeof msg.slot !== 'string') break;
        const e = p.unequip(msg.slot);
        if (e) this.err(p, e);
        break;
      }
      case 'drop': {
        if (p.dead || !Number.isInteger(msg.slot)) break;
        const s = p.inv[msg.slot];
        if (!s) break;
        p.inv[msg.slot] = null;
        p.dirtyInv = true;
        this.spawnLoot(p.x + Math.cos(p.facing) * 20, p.y + Math.sin(p.facing) * 20, s.id, s.n, now, [p.id]);
        break;
      }
      case 'pickup': {
        if (p.dead || !Number.isInteger(msg.id)) break;
        const e = this.pickup(p, msg.id, now);
        if (e) this.err(p, e);
        break;
      }
      case 'swap':
        if (!p.dead && Number.isInteger(msg.a) && Number.isInteger(msg.b) && msg.a !== msg.b &&
            msg.a >= 0 && msg.b >= 0 && msg.a < p.inv.length && msg.b < p.inv.length) {
          const t = p.inv[msg.a]; p.inv[msg.a] = p.inv[msg.b]; p.inv[msg.b] = t; p.dirtyInv = true;
        }
        break;
      case 'buy': {
        const e = this.buy(p, msg);
        if (e) this.err(p, e);
        break;
      }
      case 'sell': {
        const e = this.sell(p, msg);
        if (e) this.err(p, e);
        break;
      }
      case 'heal_npc': {
        const e = this.healNpc(p);
        if (e) this.err(p, e);
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, config.chat.maxLength);
        if (!text || now - p.chatAt < config.chat.cooldownMs) break;
        p.chatAt = now;
        this.emit({ t: 'chat', id: p.id, name: p.name, lv: p.level, text });
        break;
      }
      case 'quest_accept': {
        const e = typeof msg.id === 'string' ? this.questAccept(p, msg.id) : 'quest_tidak_ada';
        if (e) this.err(p, e);
        break;
      }
      case 'quest_claim': {
        const e = typeof msg.id === 'string' ? this.questClaim(p, msg.id, now) : 'quest_tidak_ada';
        if (e) this.err(p, e);
        break;
      }
      case 'skill_up': {
        const e = typeof msg.id === 'string' ? p.skillUp(msg.id) : 'skill_tidak_ada';
        if (e) this.err(p, e);
        break;
      }
      case 'skill_reset': {
        const e = p.skillReset(Math.max(0, p.level * 50));
        if (e) this.err(p, e);
        break;
      }
      case 'board':
        this.send(p.ws, { t: 'board', rows: this.storage.leaderboard(10) });
        break;
      case 'ping':
        this.send(p.ws, { t: 'pong', ts: msg.ts });
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- quests
  questCount(p, q) {
    if (q.type === 'collect') return Math.min(q.count, p.countItem(q.target));
    return Math.min(q.count, p.quests.active[q.id] || 0);
  }

  questProgress(p, type, target) {
    for (const id of Object.keys(p.quests.active)) {
      const q = questById[id];
      if (!q || q.type !== type || q.target !== target) continue;
      const before = p.quests.active[id] || 0;
      if (before >= q.count) continue;
      p.quests.active[id] = before + 1;
      p.dirtyStats = true;
      if (before + 1 >= q.count) p.events.push({ t: 'qready', name: q.name });
    }
  }

  questAccept(p, id) {
    const q = questById[id];
    if (!q) return 'quest_tidak_ada';
    if (p.quests.done.includes(id) || p.quests.active[id] !== undefined) return 'quest_sudah';
    if (p.level < q.minLevel) return 'level_kurang';
    if (q.prereq && !p.quests.done.includes(q.prereq)) return 'quest_prereq';
    p.quests.active[id] = 0;
    p.dirtyStats = true;
    p.events.push({ t: 'qaccept', name: q.name });
    return null;
  }

  questClaim(p, id, now) {
    const q = questById[id];
    if (!q || p.quests.active[id] === undefined) return 'quest_tidak_ada';
    if (this.questCount(p, q) < q.count) return 'quest_belum';
    const rewards = Object.entries((q.reward && q.reward.items) || {});
    if (p.freeSlots() < rewards.length) return 'inventaris_penuh';
    if (q.type === 'collect') p.removeItem(q.target, q.count);
    for (const [it, n] of rewards) {
      const left = p.addItem(it, n);
      if (left > 0) this.spawnLoot(p.x, p.y, it, left, now, [p.id]);
    }
    const xp = (q.reward && q.reward.xp) || 0;
    const gold = (q.reward && q.reward.gold) || 0;
    p.gold += gold;
    delete p.quests.active[id];
    p.quests.done.push(id);
    p.dirtyStats = true;
    p.dirtyInv = true;
    if (xp > 0) {
      const leveled = p.addXp(xp);
      if (leveled) this.emit({ t: 'levelup', id: p.id, x: Math.round(p.x), y: Math.round(p.y), lv: p.level, name: p.name });
    }
    p.events.push({ t: 'qdone', name: q.name, xp, gold });
    return null;
  }

  pickup(p, id, now) {
    const l = this.loot.get(id);
    if (!l) return 'tidak_ditemukan';
    if (dist(p.x, p.y, l.x, l.y) > LOOT_RADIUS + p.radius) return 'terlalu_jauh';
    if (l.owners && now < l.ownerUntil && !l.owners.has(p.id)) return 'bukan_milikmu';
    const left = p.addItem(l.item, l.n);
    if (left >= l.n) return 'inventaris_penuh';
    if (left <= 0) this.loot.delete(l.id);
    else l.n = left;
    p.events.push({ t: 'got', item: l.item, n: l.n - left });
    return null;
  }

  npcNear(p, role) {
    for (const n of npcs) {
      if (role && n.role !== role) continue;
      if (dist(p.x, p.y, n.x, n.y) <= NPC_RANGE) return n;
    }
    return null;
  }

  buy(p, msg) {
    if (p.dead || typeof msg.item !== 'string') return 'mati';
    const npc = this.npcNear(p, 'shop');
    if (!npc) return 'terlalu_jauh';
    if (!npc.stock.includes(msg.item)) return 'tidak_dijual';
    const def = items[msg.item];
    const n = Number.isInteger(msg.n) ? clamp(msg.n, 1, 99) : 1;
    const cost = def.price * n;
    if (p.gold < cost) return 'gold_kurang';
    const need = def.stack > 1 ? Math.ceil(n / def.stack) : n;
    if (p.freeSlots() < 1 && def.stack <= 1) return 'inventaris_penuh';
    if (def.stack <= 1 && p.freeSlots() < need) return 'inventaris_penuh';
    const left = p.addItem(msg.item, n);
    const bought = n - left;
    if (bought <= 0) return 'inventaris_penuh';
    p.gold -= def.price * bought;
    p.dirtyStats = true;
    return null;
  }

  sell(p, msg) {
    if (p.dead || !Number.isInteger(msg.slot)) return 'mati';
    if (!this.npcNear(p, 'shop')) return 'terlalu_jauh';
    const s = p.inv[msg.slot];
    if (!s) return 'kosong';
    const def = items[s.id];
    const n = Number.isInteger(msg.n) ? clamp(msg.n, 1, s.n) : s.n;
    const gain = Math.floor(def.price * config.shop.sellRatio * n);
    s.n -= n;
    if (s.n <= 0) p.inv[msg.slot] = null;
    p.gold += Math.max(1, gain);
    p.dirtyInv = true;
    p.dirtyStats = true;
    return null;
  }

  healNpc(p) {
    if (p.dead) return 'mati';
    if (!this.npcNear(p, 'healer')) return 'terlalu_jauh';
    const cost = Math.max(0, Math.round(p.level * 2));
    if (p.gold < cost) return 'gold_kurang';
    p.gold -= cost;
    p.hp = p.max.hp;
    p.mp = p.max.mp;
    p.dirtyStats = true;
    this.emit({ t: 'heal', x: Math.round(p.x), y: Math.round(p.y), r: 30 });
    return null;
  }

  // ---------------------------------------------------------------- main tick
  tick() {
    const now = Date.now();
    let dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    if (dt <= 0) return;
    if (dt > 0.1) dt = 0.1;
    this.tickCount++;

    this.timeOfDay = (DN.startTime + (now - this.startMs) / 1000 / DN.dayLengthSec) % 1;
    this.night = this.timeOfDay >= DN.nightStart && this.timeOfDay < DN.nightEnd;

    this.refreshPlayers();

    for (const p of this._pl) {
      if (p.dead) { if (now >= p.respawnAt) this.respawn(p); continue; }
      p.recalcIfBuffsExpired && p.recalcIfBuffsExpired();
      if (p.buffs.length && p.buffs.some(b => b.until <= now)) p.recalc();
      p.move(this.world, dt, now);
      if (this.tickCount % 20 === 0) this.unstick(p, false);
      p.regen(dt, now);
      p.playTime += dt;
    }

    // timers (delayed skill effects)
    if (this.timers.length) {
      const due = this.timers.filter(t => t.at <= now);
      this.timers = this.timers.filter(t => t.at > now);
      for (const t of due) { try { t.fn(); } catch (e) { console.error(e); } }
    }

    this.combat.updateProjectiles(dt, now);

    // monster respawns
    if (this.respawnQueue.length) {
      const due = [];
      const keep = [];
      for (const r of this.respawnQueue) (r.at <= now ? due : keep).push(r);
      this.respawnQueue = keep;
      for (const r of due) {
        if (!this.spawnInZone(r.zi)) this.respawnQueue.push({ at: now + 3000, zi: r.zi });
      }
    }

    this.rebuildHash();
    const alive = this._pl.filter(p => !p.dead);
    const act2 = ACTIVE_RADIUS * ACTIVE_RADIUS;
    for (const m of Array.from(this.monsters.values())) {
      if (m.dead) {
        if (now - m.deadAt >= DEATH_MS) this.monsters.delete(m.id);
        continue;
      }
      let active = false;
      for (const p of alive) if (dist2(m.x, m.y, p.x, p.y) < act2) { active = true; break; }
      if (active || m.summoned) m.update(this.mctx, dt, now);
    }

    for (const b of this.bosses.values()) {
      if (b.dead) {
        if (now - b.deadAt > BOSS_DEATH_MS && now >= b.respawnAt) {
          b.reset(now);
          this.emit({ t: 'announce', msg: b.name + ' telah muncul kembali!' });
        }
        continue;
      }
      b.update(this.mctx, dt, now);
    }

    // loot expiry
    for (const l of Array.from(this.loot.values())) if (now >= l.expires) this.loot.delete(l.id);

    // periodic save
    if (now >= this.nextSave) {
      this.nextSave = now + config.server.saveIntervalSec * 1000;
      this.saveAll();
      this.storage.flush();
    }

    const every = Math.max(1, Math.round(config.server.tickRate / config.server.snapshotRate));
    if (this.tickCount % every === 0) this.sendSnapshots(now);
  }

  // ---------------------------------------------------------------- networking
  send(ws, obj) {
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  buildClientDefs() {
    const cl = {};
    for (const [id, c] of Object.entries(classes)) {
      cl[id] = {
        name: c.name, desc: c.desc, color: c.color, weaponType: c.weaponType,
        basic: c.basic,
        skills: c.skills.map(s => ({ id: s.id, name: s.name, level: s.level, mp: s.mp, cooldownMs: s.cooldownMs, type: s.type, radius: s.radius || 0, range: s.range || 0, fx: s.fx || null }))
      };
    }
    const its = {};
    for (const [id, i] of Object.entries(items)) {
      its[id] = { name: i.name, type: i.type, slot: i.slot || null, weaponType: i.weaponType || null, reqLevel: i.reqLevel || 0, price: i.price, rarity: i.rarity, stats: i.stats || null, effect: i.effect || null, stack: i.stack };
    }
    const mon = {};
    for (const [id, m] of Object.entries(MDEF)) mon[id] = { name: m.name, level: m.level, radius: m.radius, color: m.color, shape: m.shape };
    const bs = {};
    for (const [id, b] of Object.entries(BDEF)) bs[id] = { name: b.name, level: b.level, radius: b.radius, color: b.color, shape: b.shape };
    return {
      classes: cl, items: its, rarities: data.rarities, monsters: mon, bosses: bs,
      quests: quests.map(q => ({ id: q.id, name: q.name, desc: q.desc, minLevel: q.minLevel, prereq: q.prereq, type: q.type, target: q.target, count: q.count, reward: q.reward })),
      zones: zones.map(z => ({ id: z.id, name: z.name, rect: z.rect, levelRange: z.levelRange, color: z.color })),
      npcs: npcs.map(n => ({ id: n.id, name: n.name, role: n.role, x: n.x, y: n.y, color: n.color, greeting: n.greeting, stock: n.stock || null }))
    };
  }

  initMessage(p) {
    return {
      t: 'init',
      id: p.id,
      world: { w: this.world.w, h: this.world.h, ts: this.world.ts, tiles: Buffer.from(this.world.tiles).toString('base64') },
      cfg: {
        maxLevel: config.player.maxLevel,
        slots: config.player.inventorySlots,
        dayLengthSec: DN.dayLengthSec,
        nightStart: DN.nightStart,
        nightEnd: DN.nightEnd,
        interestRadius: NET.interestRadius,
        playerRadius: config.player.radius,
        spawn: config.world.spawn,
        sellRatio: config.shop.sellRatio
      },
      defs: this.clientDefs
    };
  }

  sendSnapshots(now) {
    const R = NET.interestRadius;
    const R2 = R * R;
    const events = this.events;
    this.events = [];
    const tod = Math.round(this.timeOfDay * 10000) / 10000;

    for (const p of this._pl) {
      const ws = p.ws;
      if (!ws || ws.readyState !== 1) continue;
      if (ws.bufferedAmount > 1000000) continue;

      // monsters
      const madd = [], mupd = [], mseen = new Set();
      for (const m of this.monstersNear(p.x, p.y, R)) {
        if (dist2(p.x, p.y, m.x, m.y) > R2) continue;
        mseen.add(m.id);
        const s = m.publicState();
        const key = s.x + '|' + s.y + '|' + s.f + '|' + s.hp + '|' + s.st;
        const prev = p.knownMon.get(m.id);
        if (prev === undefined) { madd.push(s); p.knownMon.set(m.id, key); }
        else if (prev !== key) { mupd.push(s); p.knownMon.set(m.id, key); }
      }
      const mdel = [];
      for (const id of p.knownMon.keys()) if (!mseen.has(id)) { mdel.push(id); p.knownMon.delete(id); }

      // bosses (visible from further away so raids can be seen coming)
      const bl = [];
      for (const b of this.bosses.values()) {
        if (dist2(p.x, p.y, b.x, b.y) <= R2 * 2.2) bl.push(b.publicState());
      }

      // loot
      const ladd = [], lseen = new Set();
      for (const l of this.loot.values()) {
        if (dist2(p.x, p.y, l.x, l.y) > R2) continue;
        lseen.add(l.id);
        const mine = !l.owners || now >= l.ownerUntil || l.owners.has(p.id);
        const key = l.n + '|' + (mine ? 1 : 0);
        if (p.knownLoot.get(l.id) !== key) { ladd.push({ id: l.id, it: l.item, n: l.n, x: Math.round(l.x), y: Math.round(l.y), mine }); p.knownLoot.set(l.id, key); }
      }
      const ldel = [];
      for (const id of p.knownLoot.keys()) if (!lseen.has(id)) { ldel.push(id); p.knownLoot.delete(id); }

      // other players
      const pls = [];
      const pr2 = R2 * 1.7;
      for (const o of this._pl) if (o === p || dist2(p.x, p.y, o.x, o.y) <= pr2) pls.push(o.publicState());

      // events
      const er2 = R2 * 1.44;
      const ev = [];
      for (const e of events) if (e.x === undefined || dist2(p.x, p.y, e.x, e.y) <= er2) ev.push(e);
      for (const e of p.events) ev.push(e);
      p.events = [];

      const msg = { t: 'snap', n: this.tickCount, tod, me: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, pl: pls };
      if (madd.length || mupd.length || mdel.length) msg.m = { a: madd, u: mupd, d: mdel };
      if (bl.length) msg.b = bl;
      if (ladd.length || ldel.length) msg.l = { a: ladd, d: ldel };
      if (ev.length) msg.ev = ev;
      if (p.dirtyInv) { msg.inv = p.inv; p.dirtyInv = false; }
      if (p.dirtyStats) { msg.st = p.selfStats(); p.dirtyStats = false; }
      msg.cd = p.cooldowns;
      this.send(ws, msg);
    }
  }

  status() {
    let alive = 0;
    for (const m of this.monsters.values()) if (!m.dead) alive++;
    return {
      players: this.players.size,
      monsters: alive,
      bosses: Array.from(this.bosses.values()).map(b => ({ name: b.name, hp: Math.round(b.hp), dead: b.dead })),
      night: this.night,
      timeOfDay: Math.round(this.timeOfDay * 1000) / 1000
    };
  }
}

module.exports = { Game };
