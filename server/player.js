'use strict';
const { config, items } = require('./data');
const { Inventory } = require('./inventory');
const { clamp, nextId } = require('./util');

const P = config.player;
const S = config.survival;

class Player {
  constructor(name, ws) {
    this.id = nextId();
    this.kind = 'player';
    this.name = String(name || 'Survivor').slice(0, 16);
    this.ws = ws;
    this.x = 0;
    this.y = 0;
    this.radius = P.radius;
    this.facing = 0;
    this.input = { dx: 0, dy: 0, sprint: false };
    this.maxHealth = P.maxHealth;
    this.health = P.maxHealth;
    this.hunger = P.maxHunger;
    this.thirst = P.maxThirst;
    this.stamina = P.maxStamina;
    this.staminaLockUntil = 0;
    this.bleeding = false;
    this.infectedAt = 0;      // timestamp when infection started, 0 = none
    this.infectionActive = false;
    this.dead = false;
    this.respawnAt = 0;
    this.inv = new Inventory(P.inventorySlots);
    this.selected = 0;
    this.attackReadyAt = 0;
    this.reload = null;       // { slotIndex, doneAt }
    this.using = null;        // { slotIndex, doneAt }
    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.lastSeq = 0;
    this.statsDirty = true;
    this.events = [];         // private events queued for this client
    this.giveStarting();
  }

  giveStarting() {
    for (const [id, n] of Object.entries(P.startingItems)) this.inv.add(id, n);
  }

  setInput(msg) {
    const dx = Number(msg.dx), dy = Number(msg.dy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const len = Math.hypot(dx, dy);
    this.input.dx = len > 0 ? dx / Math.max(1, len) : 0;
    this.input.dy = len > 0 ? dy / Math.max(1, len) : 0;
    this.input.sprint = !!msg.sprint;
    if (Number.isFinite(Number(msg.facing))) this.facing = Number(msg.facing);
  }

  move(world, dt, now, speedMul) {
    if (this.dead) return;
    const wantsMove = this.input.dx !== 0 || this.input.dy !== 0;
    let speed = P.speed * (speedMul || 1);
    if (this.input.sprint && wantsMove && this.stamina > 1 && now >= this.staminaLockUntil) {
      speed *= P.sprintMultiplier;
      this.stamina = Math.max(0, this.stamina - S.staminaDrainPerSec * dt);
      this.statsDirty = true;
      if (this.stamina <= 0) this.staminaLockUntil = now + 1500;
    } else if (this.stamina < P.maxStamina && now >= this.staminaLockUntil) {
      const regen = wantsMove ? S.staminaRegenPerSec * 0.5 : S.staminaRegenPerSec;
      this.stamina = Math.min(P.maxStamina, this.stamina + regen * dt);
      this.statsDirty = true;
    }
    if (!wantsMove) return;
    const r = world.moveCircle(this.x, this.y, this.input.dx * speed * dt, this.input.dy * speed * dt, this.radius);
    this.x = r.x;
    this.y = r.y;
  }

  // Hunger, thirst, bleeding and infection. Returns true if the player died from it.
  tickSurvival(dt, now) {
    if (this.dead) return null;
    let cause = null;
    const hadHunger = this.hunger;

    this.hunger = Math.max(0, this.hunger - S.hungerDrainPerSec * dt);
    this.thirst = Math.max(0, this.thirst - S.thirstDrainPerSec * dt);
    if (Math.floor(hadHunger) !== Math.floor(this.hunger)) this.statsDirty = true;

    let dmg = 0;
    if (this.hunger <= 0) dmg += S.starvationDamagePerSec * dt;
    if (this.thirst <= 0) dmg += S.dehydrationDamagePerSec * dt;
    if (this.bleeding && S.bleeding.enabled) dmg += S.bleeding.damagePerSec * dt;

    if (S.infection.enabled && this.infectedAt) {
      if (!this.infectionActive && now - this.infectedAt >= S.infection.incubationMs) {
        this.infectionActive = true;
        this.events.push({ t: 'status', msg: 'infection_active' });
      }
      if (this.infectionActive) dmg += S.infection.damagePerSec * dt;
    }

    if (dmg > 0) {
      this.health = Math.max(0, this.health - dmg);
      this.statsDirty = true;
      if (this.health <= 0) {
        if (this.bleeding) cause = 'bleeding';
        else if (this.infectionActive) cause = 'infection';
        else if (this.thirst <= 0) cause = 'dehydration';
        else cause = 'starvation';
      }
    }
    return cause;
  }

  // Combat damage. Returns true if this hit killed the player.
  takeDamage(amount, now) {
    if (this.dead || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    this.statsDirty = true;
    this.events.push({ t: 'hurt', amount: Math.round(amount) });
    return this.health <= 0;
  }

  rollAfflictions(now, rng) {
    const r = rng || Math.random;
    if (S.bleeding.enabled && !this.bleeding && r() < S.bleeding.chanceOnHit) {
      this.bleeding = true;
      this.events.push({ t: 'status', msg: 'bleeding' });
      this.statsDirty = true;
    }
    if (S.infection.enabled && !this.infectedAt && r() < S.infection.chanceOnHit) {
      this.infectedAt = now;
      this.statsDirty = true;
    }
  }

  heal(amount) {
    this.health = clamp(this.health + amount, 0, this.maxHealth);
    this.statsDirty = true;
  }

  // Apply a consumable's effects. Item removal is done by the caller after this returns true.
  applyConsumable(def) {
    const fx = def.effects || {};
    let used = false;
    if (fx.health && this.health < this.maxHealth) { this.heal(fx.health); used = true; }
    if (fx.hunger && this.hunger < P.maxHunger) { this.hunger = Math.min(P.maxHunger, this.hunger + fx.hunger); used = true; }
    if (fx.thirst && this.thirst < P.maxThirst) { this.thirst = Math.min(P.maxThirst, this.thirst + fx.thirst); used = true; }
    if (fx.stopBleeding && this.bleeding) { this.bleeding = false; used = true; }
    if (fx.cureInfection && this.infectedAt) { this.infectedAt = 0; this.infectionActive = false; used = true; }
    if (used) this.statsDirty = true;
    return used;
  }

  respawnReset() {
    this.health = this.maxHealth;
    this.hunger = P.maxHunger * 0.6;
    this.thirst = P.maxThirst * 0.6;
    this.stamina = P.maxStamina;
    this.bleeding = false;
    this.infectedAt = 0;
    this.infectionActive = false;
    this.dead = false;
    this.reload = null;
    this.using = null;
    this.input = { dx: 0, dy: 0, sprint: false };
    this.statsDirty = true;
    if (!P.respawnKeepsInventory) {
      this.inv.clear();
      this.giveStarting();
    }
  }

  selectedSlot() {
    return this.inv.slot(this.selected);
  }

  stats() {
    return {
      hp: Math.round(this.health),
      hunger: Math.round(this.hunger),
      thirst: Math.round(this.thirst),
      stamina: Math.round(this.stamina),
      bleeding: this.bleeding,
      infected: !!this.infectedAt,
      kills: this.kills,
      deaths: this.deaths,
      score: this.score
    };
  }

  publicState() {
    return {
      id: this.id,
      name: this.name,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      f: Math.round(this.facing * 100) / 100,
      hp: Math.round(this.health),
      dead: this.dead,
      w: (this.selectedSlot() && items[this.selectedSlot().id] && items[this.selectedSlot().id].weapon) ? this.selectedSlot().id : null
    };
  }
}

module.exports = { Player };
