'use strict';
const { config, classes, items, EQUIP_SLOTS } = require('./data');
const { nextId, clamp } = require('./util');

const P = config.player;
const SKILL_MAX_RANK = 5;

function xpForLevel(lv) {
  // XP needed to go from lv to lv+1.
  return Math.round(config.xp.base * Math.pow(config.xp.growth, lv - 1));
}

class Character {
  constructor(data, ws) {
    this.id = nextId();
    this.ws = ws;
    this.name = data.name;
    this.cls = data.cls;
    this.level = data.level || 1;
    this.xp = data.xp || 0;
    this.gold = data.gold === undefined ? P.startGold : data.gold;
    this.x = data.x || config.world.spawn.x;
    this.y = data.y || config.world.spawn.y;
    this.radius = P.radius;
    this.facing = 0;
    this.input = { dx: 0, dy: 0 };
    this.equip = Object.assign({ weapon: null, helm: null, armor: null, boots: null, ring: null }, data.equip || {});
    this.inv = new Array(P.inventorySlots).fill(null);
    if (Array.isArray(data.inv)) {
      for (let i = 0; i < P.inventorySlots; i++) this.inv[i] = data.inv[i] || null;
    }
    this.buffs = [];
    this.cooldowns = {};
    this.attackReadyAt = 0;
    this.globalReadyAt = 0;
    this.potionReadyAt = 0;
    this.slowUntil = 0;
    this.slowFactor = 1;
    this.dead = false;
    this.respawnAt = 0;
    this.lastCombatAt = 0;
    this.kills = data.kills || 0;
    this.deaths = data.deaths || 0;
    this.bossKills = data.bossKills || 0;
    this.playTime = data.playTime || 0;
    this.createdAt = data.createdAt || Date.now();
    this.skillRanks = Object.assign({}, data.skillRanks || {});
    this.quests = { done: Array.isArray(data.quests && data.quests.done) ? data.quests.done.slice() : [], active: Object.assign({}, (data.quests && data.quests.active) || {}) };
    this.events = [];
    this.dirtyInv = true;
    this.dirtyStats = true;
    this.knownEnt = new Map();
    this.chatAt = 0;
    this.recalc();
    this.hp = data.hp > 0 ? Math.min(data.hp, this.max.hp) : this.max.hp;
    this.mp = data.mp >= 0 && data.mp !== undefined ? Math.min(data.mp, this.max.mp) : this.max.mp;
  }

  static newCharacter(name, cls) {
    const c = new Character({ name, cls, level: 1, xp: 0 });
    for (const [id, n] of Object.entries(P.startingItems)) c.addItem(id, n);
    return c;
  }

  get def() { return classes[this.cls]; }

  // ---------- stats ----------
  baseStats() {
    const d = this.def, lv = this.level - 1;
    const s = {};
    for (const k of Object.keys(d.base)) s[k] = d.base[k] + (d.growth[k] || 0) * lv;
    return s;
  }

  recalc() {
    const s = this.baseStats();
    for (const slot of EQUIP_SLOTS) {
      const it = this.equip[slot];
      if (!it || !items[it]) continue;
      for (const [k, v] of Object.entries(items[it].stats || {})) s[k] = (s[k] || 0) + v;
    }
    const now = Date.now();
    this.buffs = this.buffs.filter(b => b.until > now);
    for (const b of this.buffs) {
      if (b.mul) s[b.stat] = (s[b.stat] || 0) * b.mul;
      if (b.add) s[b.stat] = (s[b.stat] || 0) + b.add;
    }
    this.stats = s;
    this.max = { hp: Math.round(s.hp), mp: Math.round(s.mp) };
    this.speed = P.baseSpeed * (s.speed || 1);
    if (this.hp !== undefined) this.hp = Math.min(this.hp, this.max.hp);
    if (this.mp !== undefined) this.mp = Math.min(this.mp, this.max.mp);
    this.dirtyStats = true;
  }

  addBuff(b, ms) {
    this.buffs = this.buffs.filter(x => x.id !== b.id);
    this.buffs.push({ id: b.id, stat: b.stat, mul: b.mul, add: b.add, until: Date.now() + (ms || b.ms) });
    this.recalc();
  }

  // ---------- xp / level ----------
  addXp(amount) {
    if (amount <= 0) return false;
    this.xp += Math.round(amount);
    let leveled = false;
    while (this.level < P.maxLevel && this.xp >= xpForLevel(this.level)) {
      this.xp -= xpForLevel(this.level);
      this.level++;
      leveled = true;
    }
    if (this.level >= P.maxLevel) this.xp = 0;
    if (leveled) {
      this.recalc();
      this.hp = this.max.hp;
      this.mp = this.max.mp;
      this.events.push({ t: 'levelup', level: this.level });
    }
    this.dirtyStats = true;
    return leveled;
  }

  xpNeeded() { return this.level >= P.maxLevel ? 0 : xpForLevel(this.level); }

  // ---------- skill tree ----------
  // 1 poin skill per level (mulai level 2). Tiap skill punya rank 0..SKILL_MAX_RANK.
  skillPointsTotal() { return Math.max(0, this.level - 1); }
  skillPointsUsed() { let n = 0; for (const v of Object.values(this.skillRanks)) n += v; return n; }
  skillPointsFree() { return this.skillPointsTotal() - this.skillPointsUsed(); }
  skillRank(id) { return this.skillRanks[id] || 0; }

  skillUp(id) {
    const sk = this.def.skills.find(s => s.id === id);
    if (!sk) return 'skill_tidak_ada';
    if (this.level < sk.level) return 'level_kurang';
    if (this.skillRank(id) >= SKILL_MAX_RANK) return 'rank_maks';
    if (this.skillPointsFree() <= 0) return 'poin_kurang';
    this.skillRanks[id] = this.skillRank(id) + 1;
    this.dirtyStats = true;
    return null;
  }

  skillReset(cost) {
    if (this.skillPointsUsed() === 0) return 'tidak_perlu';
    if (this.gold < cost) return 'gold_kurang';
    this.gold -= cost;
    this.skillRanks = {};
    this.dirtyStats = true;
    return null;
  }

  // Efek rank: +12% damage, -4% MP, -3% cooldown per rank.
  skillMods(id) {
    const r = this.skillRank(id);
    return { mult: 1 + r * 0.12, mp: Math.max(0.5, 1 - r * 0.04), cd: Math.max(0.5, 1 - r * 0.03) };
  }

  // ---------- inventory ----------
  makeSlot(id, n) { return { id, n: n || 1 }; }

  // Returns the count that did NOT fit.
  addItem(id, n) {
    const def = items[id];
    if (!def || !Number.isInteger(n) || n <= 0) return n > 0 ? n : 0;
    let left = n;
    if (def.stack > 1) {
      for (const s of this.inv) {
        if (left <= 0) break;
        if (s && s.id === id && s.n < def.stack) {
          const put = Math.min(def.stack - s.n, left);
          s.n += put;
          left -= put;
        }
      }
    }
    for (let i = 0; i < this.inv.length && left > 0; i++) {
      if (this.inv[i]) continue;
      const put = Math.min(def.stack, left);
      this.inv[i] = this.makeSlot(id, put);
      left -= put;
    }
    if (left !== n) this.dirtyInv = true;
    return left;
  }

  countItem(id) {
    let n = 0;
    for (const s of this.inv) if (s && s.id === id) n += s.n;
    return n;
  }

  removeItem(id, n) {
    if (this.countItem(id) < n) return false;
    let left = n;
    for (let i = this.inv.length - 1; i >= 0 && left > 0; i--) {
      const s = this.inv[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.n, left);
      s.n -= take;
      left -= take;
      if (s.n <= 0) this.inv[i] = null;
    }
    this.dirtyInv = true;
    return true;
  }

  freeSlots() { let n = 0; for (const s of this.inv) if (!s) n++; return n; }

  // ---------- equipment ----------
  canEquip(id) {
    const def = items[id];
    if (!def || def.type !== 'equip') return 'bukan_equipment';
    if (this.level < def.reqLevel) return 'level_kurang';
    if (def.slot === 'weapon' && def.weaponType !== this.def.weaponType) return 'senjata_tidak_cocok';
    return null;
  }

  equipFromSlot(i) {
    const s = this.inv[i];
    if (!s) return 'kosong';
    const err = this.canEquip(s.id);
    if (err) return err;
    const slot = items[s.id].slot;
    const old = this.equip[slot];
    this.equip[slot] = s.id;
    this.inv[i] = old ? this.makeSlot(old, 1) : null;
    this.dirtyInv = true;
    this.recalc();
    return null;
  }

  unequip(slot) {
    const id = this.equip[slot];
    if (!id) return 'kosong';
    if (this.freeSlots() === 0) return 'inventaris_penuh';
    this.equip[slot] = null;
    this.addItem(id, 1);
    this.recalc();
    return null;
  }

  // ---------- damage / heal ----------
  takeDamage(amount, now) {
    if (this.dead || amount <= 0) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.lastCombatAt = now;
    this.dirtyStats = true;
    return this.hp <= 0;
  }

  heal(amount) {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp = clamp(this.hp + amount, 0, this.max.hp);
    this.dirtyStats = true;
    return this.hp - before;
  }

  restoreMp(amount) {
    const before = this.mp;
    this.mp = clamp(this.mp + amount, 0, this.max.mp);
    this.dirtyStats = true;
    return this.mp - before;
  }

  regen(dt, now) {
    if (this.dead) return;
    if (now - this.lastCombatAt > P.outOfCombatMs) {
      if (this.hp < this.max.hp) { this.hp = Math.min(this.max.hp, this.hp + (P.hpRegenPerSec * dt * (1 + this.level * 0.05))); this.dirtyStats = true; }
    }
    if (this.mp < this.max.mp) { this.mp = Math.min(this.max.mp, this.mp + P.mpRegenPerSec * dt * (1 + this.level * 0.04)); this.dirtyStats = true; }
  }

  move(world, dt, now) {
    if (this.dead) return;
    const { dx, dy } = this.input;
    if (!dx && !dy) return;
    const slow = now < this.slowUntil ? this.slowFactor : 1;
    this.swimming = world.isWater(this.x, this.y);
    const sp = this.speed * slow * (this.swimming ? 0.6 : 1) * dt;
    const r = world.moveCircle(this.x, this.y, dx * sp, dy * sp, this.radius, true);
    this.swimming = world.isWater(r.x, r.y);
    this.x = r.x;
    this.y = r.y;
  }

  setInput(msg) {
    const dx = Number(msg.dx), dy = Number(msg.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const len = Math.hypot(dx, dy);
    this.input.dx = len > 0 ? dx / Math.max(1, len) : 0;
    this.input.dy = len > 0 ? dy / Math.max(1, len) : 0;
    if (Number.isFinite(Number(msg.facing))) this.facing = Number(msg.facing);
  }

  // ---------- persistence ----------
  toSave() {
    return {
      name: this.name, cls: this.cls, level: this.level, xp: this.xp, gold: this.gold,
      x: Math.round(this.x), y: Math.round(this.y), hp: Math.round(this.hp), mp: Math.round(this.mp),
      equip: this.equip, inv: this.inv, kills: this.kills, deaths: this.deaths,
      bossKills: this.bossKills, playTime: Math.round(this.playTime), createdAt: this.createdAt,
      skillRanks: this.skillRanks, quests: this.quests
    };
  }

  publicState() {
    return {
      id: this.id, name: this.name, cls: this.cls, lv: this.level,
      x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10,
      f: Math.round(this.facing * 100) / 100,
      hp: Math.round(this.hp), mhp: this.max.hp, dead: this.dead,
      w: this.equip.weapon, sw: this.swimming ? 1 : 0
    };
  }

  selfStats() {
    const s = this.stats;
    return {
      hp: Math.round(this.hp), mhp: this.max.hp, mp: Math.round(this.mp), mmp: this.max.mp,
      lv: this.level, xp: this.xp, xpn: this.xpNeeded(), gold: this.gold,
      atk: Math.round(s.atk), matk: Math.round(s.matk), def: Math.round(s.def), mdef: Math.round(s.mdef),
      crit: Math.round(s.crit * 1000) / 10, spd: Math.round((s.speed || 1) * 100),
      kills: this.kills, deaths: this.deaths, equip: this.equip,
      bossKills: this.bossKills, playTime: Math.round(this.playTime),
      sp: this.skillPointsFree(), ranks: this.skillRanks, maxRank: SKILL_MAX_RANK,
      qdone: this.quests.done, qact: this.quests.active,
      maxhp: this.max.hp, maxmp: this.max.mp,
      buffs: this.buffs.map(b => ({ id: b.id, ms: Math.max(0, b.until - Date.now()) }))
    };
  }
}

module.exports = { Character, xpForLevel, SKILL_MAX_RANK };
