'use strict';
const { loot, items } = require('./data');
const { nextId, dist, randInt } = require('./util');

class LootManager {
  constructor(world) {
    this.world = world;
    this.drops = new Map(); // id -> { id, item, count, x, y, expiresAt, d, m }
    this.events = [];       // { t:'ladd', l } / { t:'ldel', id }
  }

  // Roll a drop table. Pure server-side: clients never decide what drops.
  roll(tableId, rng, bonus) {
    const table = loot.dropTables[tableId];
    if (!table) return [];
    const r = rng || Math.random;
    const mult = bonus || 1;
    const out = new Map();
    for (let i = 0; i < table.rolls; i++) {
      for (const e of table.entries) {
        if (r() < Math.min(1, e.chance * mult / table.rolls * 1.0)) {
          const n = randInt(e.min, e.max, r);
          out.set(e.item, (out.get(e.item) || 0) + n);
        }
      }
    }
    return Array.from(out, ([item, count]) => ({ item, count }));
  }

  spawnAt(x, y, item, count, extra, now) {
    const def = items[item];
    if (!def || !Number.isInteger(count) || count <= 0) return null;
    const spot = this.world.findFreePoint(x, y, 4, 22, 10) || { x, y };
    const d = {
      id: nextId(),
      item,
      count,
      x: spot.x,
      y: spot.y,
      expiresAt: now + loot.lootDespawnMs,
      d: extra && extra.durability,
      m: extra && extra.mag
    };
    this.drops.set(d.id, d);
    this.events.push({ t: 'ladd', l: this.publicState(d) });
    return d;
  }

  dropFromZombie(zombie, now) {
    const list = this.roll(zombie.def.drops);
    for (const { item, count } of list) this.spawnAt(zombie.x, zombie.y, item, count, null, now);
    return list;
  }

  // Death drop: everything the player carried.
  dropInventory(player, now) {
    const slots = player.inv.takeAll();
    for (const s of slots) {
      this.spawnAt(player.x, player.y, s.id, s.count, { durability: s.durability, mag: s.mag }, now);
    }
  }

  pickup(player, dropId) {
    const d = this.drops.get(dropId);
    if (!d) return { ok: false, error: 'not_found' };
    if (player.dead) return { ok: false, error: 'dead' };
    if (dist(player.x, player.y, d.x, d.y) > loot.pickupRadius + player.radius) return { ok: false, error: 'too_far' };

    const def = items[d.item];
    let left;
    if (def.weapon) {
      // Weapons keep their own durability/magazine, so they need a free slot.
      const free = player.inv.slots.findIndex(s => !s);
      if (free === -1) return { ok: false, error: 'inventory_full' };
      const slot = { id: d.item, count: 1 };
      if (d.d !== undefined) slot.durability = d.d; else if (def.durability) slot.durability = def.durability;
      if (d.m !== undefined) slot.mag = d.m;
      player.inv.slots[free] = slot;
      player.inv.dirty = true;
      left = d.count - 1;
    } else {
      left = player.inv.add(d.item, d.count);
    }

    if (left >= d.count) return { ok: false, error: 'inventory_full' };
    if (left <= 0) {
      this.drops.delete(d.id);
      this.events.push({ t: 'ldel', id: d.id });
    } else {
      d.count = left;
      this.events.push({ t: 'ladd', l: this.publicState(d) });
    }
    return { ok: true, item: d.item, taken: d.count };
  }

  update(now) {
    for (const d of this.drops.values()) {
      if (now >= d.expiresAt) {
        this.drops.delete(d.id);
        this.events.push({ t: 'ldel', id: d.id });
      }
    }
  }

  publicState(d) {
    return { id: d.id, it: d.item, n: d.count, x: Math.round(d.x), y: Math.round(d.y) };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

module.exports = { LootManager };
