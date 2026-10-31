'use strict';
const { weapons, items, config, loot } = require('./data');
const { NODE_DEFS } = require('./world');
const { dist, angleDiff, randInt } = require('./util');

const CC = config.combat;

// Bare hands: weak, but lets a new player gather and defend themselves.
const FISTS = {
  name: 'Fists', type: 'melee', damage: 4, cooldownMs: 700, range: 22, arcDeg: 80,
  knockback: 5, durability: null, sound: 'swing_fist'
};

function weaponOf(player) {
  const slot = player.selectedSlot();
  if (slot && weapons[slot.id]) return { slot, id: slot.id, def: weapons[slot.id] };
  return { slot: null, id: 'fists', def: FISTS };
}

// Closest approach of a ray to a circle. Returns distance along the ray, or -1 if it misses.
function rayCircle(ox, oy, dx, dy, len, cx, cy, r) {
  const px = cx - ox, py = cy - oy;
  const t = Math.max(0, Math.min(len, px * dx + py * dy));
  const qx = ox + dx * t - cx, qy = oy + dy * t - cy;
  return qx * qx + qy * qy <= r * r ? t : -1;
}

// How far a bullet can travel before hitting terrain or a solid structure.
function rayBlockedAt(world, ox, oy, dx, dy, len) {
  const step = world.ts * 0.5;
  for (let d = step; d <= len; d += step) {
    if (world.tileBlocked(world.toTile(ox + dx * d), world.toTile(oy + dy * d))) return d - step * 0.5;
  }
  return len;
}

class Combat {
  constructor(game) {
    this.game = game;
  }

  // ---------------- attack ----------------
  attack(player, now) {
    if (player.dead || player.reload || player.using) return;
    if (now < player.attackReadyAt) return;
    const w = weaponOf(player);
    const def = w.def;

    if (def.type === 'ranged') this.shoot(player, w, now);
    else this.swing(player, w, now);
  }

  swing(player, w, now) {
    const game = this.game, world = game.world, def = w.def;
    player.attackReadyAt = now + def.cooldownMs;

    const range = def.range + CC.maxHitDistanceForgiveness;
    const half = ((def.arcDeg || 60) * Math.PI) / 180 / 2;
    const candidates = [];
    for (const z of game.zombiesNear(player.x, player.y, range + 14)) {
      if (z.dead) continue;
      const d = dist(player.x, player.y, z.x, z.y);
      if (d - z.radius > range) continue;
      const ang = Math.atan2(z.y - player.y, z.x - player.x);
      if (d > z.radius + 4 && Math.abs(angleDiff(player.facing, ang)) > half) continue;
      if (!world.hasLineOfSight(player.x, player.y, z.x, z.y)) continue;
      candidates.push({ z, d, ang });
    }
    candidates.sort((a, b) => a.d - b.d);
    const targets = candidates.slice(0, 4);

    game.emit({ t: 'swing', id: player.id, w: w.id, f: Math.round(player.facing * 100) / 100, x: Math.round(player.x), y: Math.round(player.y), snd: def.sound });

    let hitSomething = false;
    for (const c of targets) {
      hitSomething = true;
      game.damageZombie(c.z, def.damage, player.id, now, w.id);
      if (def.knockback) {
        const k = def.knockback * 0.1;
        c.z.applyKnockback(world, Math.cos(c.ang) * k, Math.sin(c.ang) * k);
      }
    }
    game.alertZombies(player.x, player.y, 60, now);

    if (!hitSomething) hitSomething = this.tryHarvest(player, w, now);
    if (hitSomething) this.wear(player, w);
  }

  tryHarvest(player, w, now) {
    const game = this.game, world = game.world, def = w.def;
    const reach = player.radius + world.ts * 0.7;
    const tx = world.toTile(player.x + Math.cos(player.facing) * reach);
    const ty = world.toTile(player.y + Math.sin(player.facing) * reach);
    const node = world.nodeAt(tx, ty);
    if (!node) return false;
    const nd = NODE_DEFS[node.type];
    const mult = def.gatherBonus && def.gatherBonus[nd.item] ? def.gatherBonus[nd.item] : 0.4;
    const res = world.harvest(tx, ty, Math.max(1, def.damage * mult));
    game.emit({ t: 'gather', x: Math.round((tx + 0.5) * world.ts), y: Math.round((ty + 0.5) * world.ts), it: nd.item });
    if (res && res.depleted) {
      const n = randInt(nd.min, nd.max);
      const left = player.inv.add(nd.item, n);
      if (left > 0) game.loot.spawnAt(player.x, player.y, nd.item, left, null, now);
    }
    return true;
  }

  shoot(player, w, now) {
    const game = this.game, world = game.world, def = w.def, slot = w.slot;
    if (slot.mag === undefined) slot.mag = 0;
    if (slot.mag <= 0) {
      player.attackReadyAt = now + 400;
      player.events.push({ t: 'empty' });
      this.startReload(player, now); // auto-reload when empty and ammo is available
      return;
    }
    if (slot.durability !== undefined && slot.durability <= 0) return;

    slot.mag--;
    player.inv.dirty = true;
    player.attackReadyAt = now + def.cooldownMs;

    const ox = player.x, oy = player.y;
    const spread = ((def.spreadDeg || 0) * Math.PI) / 180;
    const shots = [];
    const hitMap = new Map(); // zombie -> total damage this volley

    for (let i = 0; i < (def.pellets || 1); i++) {
      const ang = player.facing + (Math.random() - 0.5) * spread;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const maxLen = rayBlockedAt(world, ox, oy, dx, dy, def.range);
      let best = null, bestT = maxLen;
      for (const z of game.zombiesNear(ox + dx * maxLen / 2, oy + dy * maxLen / 2, maxLen / 2 + 20)) {
        if (z.dead) continue;
        const t = rayCircle(ox, oy, dx, dy, bestT, z.x, z.y, z.radius + 2);
        if (t >= 0 && t <= bestT) { best = z; bestT = t; }
      }
      if (best) hitMap.set(best, (hitMap.get(best) || 0) + def.damage);
      shots.push({ x: Math.round(ox + dx * bestT), y: Math.round(oy + dy * bestT), hit: !!best });
    }

    game.emit({ t: 'shot', id: player.id, w: w.id, x: Math.round(ox), y: Math.round(oy), tr: shots, snd: def.sound });

    for (const [z, dmg] of hitMap) {
      game.damageZombie(z, dmg, player.id, now, w.id);
      if (def.knockback && !z.dead) {
        const ang = Math.atan2(z.y - oy, z.x - ox);
        const k = def.knockback * 0.1;
        z.applyKnockback(world, Math.cos(ang) * k, Math.sin(ang) * k);
      }
    }
    game.alertZombies(ox, oy, def.noiseRadius || 200, now);
    this.wear(player, w);
  }

  // ---------------- durability ----------------
  wear(player, w) {
    const slot = w.slot;
    if (!slot || slot.durability === undefined) return;
    slot.durability -= CC.durabilityLossPerUse;
    player.inv.dirty = true;
    if (slot.durability <= 0) {
      const idx = player.inv.slots.indexOf(slot);
      if (idx !== -1) player.inv.clearSlot(idx);
      player.reload = null;
      player.events.push({ t: 'broke', w: w.id });
    }
  }

  // ---------------- reload ----------------
  startReload(player, now) {
    if (player.dead || player.reload || player.using) return false;
    const w = weaponOf(player);
    if (w.def.type !== 'ranged' || !w.slot) return false;
    if (w.slot.mag === undefined) w.slot.mag = 0;
    if (w.slot.mag >= w.def.magazineSize) return false;
    if (!player.inv.has(w.def.ammoType, 1)) {
      player.events.push({ t: 'noammo' });
      return false;
    }
    player.reload = { slotIndex: player.selected, doneAt: now + w.def.reloadMs };
    this.game.emit({ t: 'reload', id: player.id, x: Math.round(player.x), y: Math.round(player.y), ms: w.def.reloadMs });
    return true;
  }

  update(player, now) {
    const r = player.reload;
    if (r) {
      const slot = player.inv.slot(r.slotIndex);
      // Reload is cancelled if the player switched weapon or the weapon is gone.
      if (!slot || r.slotIndex !== player.selected || !weapons[slot.id]) { player.reload = null; }
      else if (now >= r.doneAt) {
        const def = weapons[slot.id];
        const need = def.magazineSize - (slot.mag || 0);
        const have = player.inv.count(def.ammoType);
        const take = Math.min(need, have);
        if (take > 0 && player.inv.remove(def.ammoType, take)) {
          slot.mag = (slot.mag || 0) + take;
          player.inv.dirty = true;
        }
        player.reload = null;
      }
    }

    const u = player.using;
    if (u) {
      const slot = player.inv.slot(u.slotIndex);
      if (!slot || slot.id !== u.itemId) { player.using = null; }
      else if (now >= u.doneAt) {
        player.using = null;
        const def = items[slot.id];
        if (player.applyConsumable(def)) {
          player.inv.remove(slot.id, 1);
          player.events.push({ t: 'used', it: slot.id });
        }
      }
    }
  }

  // ---------------- consumables ----------------
  useItem(player, slotIndex, now) {
    if (player.dead || player.reload || player.using) return false;
    const slot = player.inv.slot(slotIndex);
    if (!slot) return false;
    const def = items[slot.id];
    if (!def || !def.effects) return false;
    // Refuse to waste an item that would have no effect.
    const fx = def.effects;
    const useful =
      (fx.health && player.health < player.maxHealth) ||
      (fx.hunger && player.hunger < config.player.maxHunger) ||
      (fx.thirst && player.thirst < config.player.maxThirst) ||
      (fx.stopBleeding && player.bleeding) ||
      (fx.cureInfection && player.infectedAt);
    if (!useful) return false;
    player.using = { slotIndex, itemId: slot.id, doneAt: now + (def.useMs || 600) };
    return true;
  }
}

module.exports = { Combat, weaponOf, FISTS };
