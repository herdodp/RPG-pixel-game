'use strict';
const { structures: SDEF, config } = require('./data');
const { nextId, dist } = require('./util');

const BUILD_RANGE = 110;
const INTERACT_RANGE = 90;

function rectHitsCircle(rx, ry, rw, rh, cx, cy, r) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

class StructureManager {
  constructor(world) {
    this.world = world;
    this.list = new Map();   // id -> structure
    this.events = [];        // { t:'sadd'|'shp'|'sdel'|'sgate', ... } broadcast to nearby clients
  }

  static tilesFor(def, ts) {
    return { tw: Math.max(1, Math.ceil(def.size.w / ts)), th: Math.max(1, Math.ceil(def.size.h / ts)) };
  }

  // Validates and builds a structure. All checks happen on the server.
  tryPlace(player, typeId, wx, wy, ctx, now) {
    const def = SDEF[typeId];
    if (!def) return { ok: false, error: 'unknown_structure' };
    if (player.dead) return { ok: false, error: 'dead' };
    if (!Number.isFinite(wx) || !Number.isFinite(wy)) return { ok: false, error: 'bad_position' };
    if (dist(player.x, player.y, wx, wy) > BUILD_RANGE) return { ok: false, error: 'too_far' };

    const ts = this.world.ts;
    const { tw, th } = StructureManager.tilesFor(def, ts);
    const tx = this.world.toTile(wx) - Math.floor((tw - 1) / 2);
    const ty = this.world.toTile(wy) - Math.floor((th - 1) / 2);
    if (!this.world.canPlace(tx, ty, tw, th)) return { ok: false, error: 'blocked_tile' };

    if (def.blocksMovement) {
      const rx = tx * ts, ry = ty * ts, rw = tw * ts, rh = th * ts;
      for (const p of ctx.playerList()) {
        if (!p.dead && rectHitsCircle(rx, ry, rw, rh, p.x, p.y, p.radius)) return { ok: false, error: 'entity_in_the_way' };
      }
      for (const z of ctx.zombiesNear(rx + rw / 2, ry + rh / 2, Math.max(rw, rh))) {
        if (!z.dead && rectHitsCircle(rx, ry, rw, rh, z.x, z.y, z.radius)) return { ok: false, error: 'entity_in_the_way' };
      }
    }

    if (!player.inv.pay(def.cost)) return { ok: false, error: 'not_enough_resources' };

    const s = {
      id: nextId(),
      type: typeId,
      def,
      tx, ty, tw, th,
      cx: tx * ts + (tw * ts) / 2,
      cy: ty * ts + (th * ts) / 2,
      health: def.health,
      maxHealth: def.health,
      ownerId: player.id,
      open: false,
      dead: false,
      trapReadyAt: 0,
      createdAt: now
    };
    this.list.set(s.id, s);
    this.world.addStructure(s);
    this.events.push({ t: 'sadd', s: this.publicState(s) });
    return { ok: true, structure: s };
  }

  get(id) { return this.list.get(id) || null; }

  nearest(x, y, maxDist, filter) {
    let best = null, bd = maxDist;
    for (const s of this.list.values()) {
      if (s.dead) continue;
      if (filter && !filter(s)) continue;
      const d = dist(x, y, s.cx, s.cy);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // Returns true if the structure was destroyed.
  damage(s, amount, source) {
    if (!s || s.dead || amount <= 0) return false;
    s.health = Math.max(0, s.health - amount);
    if (s.health <= 0) {
      this.destroy(s);
      return true;
    }
    this.events.push({ t: 'shp', id: s.id, hp: Math.round(s.health) });
    return false;
  }

  destroy(s) {
    if (s.dead) return;
    s.dead = true;
    this.world.removeStructure(s);
    this.list.delete(s.id);
    this.events.push({ t: 'sdel', id: s.id, x: Math.round(s.cx), y: Math.round(s.cy) });
  }

  repair(player, id) {
    const s = this.get(id);
    if (!s) return { ok: false, error: 'not_found' };
    if (player.dead) return { ok: false, error: 'dead' };
    if (dist(player.x, player.y, s.cx, s.cy) > INTERACT_RANGE) return { ok: false, error: 'too_far' };
    if (!s.def.repair) return { ok: false, error: 'not_repairable' };
    if (s.health >= s.maxHealth) return { ok: false, error: 'already_full' };
    if (!player.inv.pay(s.def.repair.cost)) return { ok: false, error: 'not_enough_resources' };
    s.health = Math.min(s.maxHealth, s.health + s.def.repair.amount);
    this.events.push({ t: 'shp', id: s.id, hp: Math.round(s.health) });
    return { ok: true, structure: s };
  }

  // Dismantle: refunds half of the build cost, only for the owner.
  dismantle(player, id) {
    const s = this.get(id);
    if (!s) return { ok: false, error: 'not_found' };
    if (s.ownerId !== player.id) return { ok: false, error: 'not_owner' };
    if (dist(player.x, player.y, s.cx, s.cy) > INTERACT_RANGE) return { ok: false, error: 'too_far' };
    const healthFrac = s.health / s.maxHealth;
    for (const [item, n] of Object.entries(s.def.cost)) {
      const back = Math.floor(n * 0.5 * healthFrac);
      if (back > 0) player.inv.add(item, back);
    }
    this.destroy(s);
    return { ok: true };
  }

  toggleGate(player, id, ctx) {
    const s = this.get(id);
    if (!s || !s.def.gate) return { ok: false, error: 'not_a_gate' };
    if (player.dead) return { ok: false, error: 'dead' };
    if (dist(player.x, player.y, s.cx, s.cy) > INTERACT_RANGE) return { ok: false, error: 'too_far' };
    if (s.open) {
      // Do not close a gate on top of someone.
      const ts = this.world.ts;
      const rx = s.tx * ts, ry = s.ty * ts, rw = s.tw * ts, rh = s.th * ts;
      for (const p of ctx.playerList()) {
        if (!p.dead && rectHitsCircle(rx, ry, rw, rh, p.x, p.y, p.radius)) return { ok: false, error: 'entity_in_the_way' };
      }
      for (const z of ctx.zombiesNear(s.cx, s.cy, Math.max(rw, rh))) {
        if (!z.dead && rectHitsCircle(rx, ry, rw, rh, z.x, z.y, z.radius)) return { ok: false, error: 'entity_in_the_way' };
      }
    }
    s.open = !s.open;
    this.events.push({ t: 'sgate', id: s.id, open: s.open });
    return { ok: true, structure: s };
  }

  // Spike traps hurt zombies that stand on them; campfires heal nearby players.
  update(dt, now, ctx) {
    for (const s of this.list.values()) {
      if (s.dead) continue;
      const trap = s.def.trap;
      if (trap && now >= s.trapReadyAt) {
        const ts = this.world.ts;
        const rx = s.tx * ts, ry = s.ty * ts, rw = s.tw * ts, rh = s.th * ts;
        let triggered = false;
        for (const z of ctx.zombiesNear(s.cx, s.cy, Math.max(rw, rh) + 20)) {
          if (z.dead) continue;
          if (!rectHitsCircle(rx, ry, rw, rh, z.x, z.y, z.radius)) continue;
          triggered = true;
          z.applySlow(trap.slowFactor, now, 600);
          ctx.damageZombie(z, trap.damage, 0, now, 'trap');
        }
        if (triggered) {
          s.trapReadyAt = now + trap.cooldownMs;
          this.damage(s, trap.durabilityLoss, null);
        }
      }
      const heal = s.def.heal;
      if (heal) {
        for (const p of ctx.playerList()) {
          if (p.dead || p.health >= p.maxHealth) continue;
          if (dist(p.x, p.y, s.cx, s.cy) <= heal.radius) p.heal(heal.healthPerSec * dt);
        }
      }
    }
  }

  lights() {
    const out = [];
    for (const s of this.list.values()) {
      if (s.def.light) out.push({ x: s.cx, y: s.cy, r: s.def.light.radius });
    }
    return out;
  }

  // Whether a point is lit by a torch/campfire (used to calm night zombies if desired).
  isLit(x, y) {
    for (const s of this.list.values()) {
      if (s.def.light && dist(x, y, s.cx, s.cy) <= s.def.light.radius) return true;
    }
    return false;
  }

  publicState(s) {
    return {
      id: s.id,
      ty: s.type,
      tx: s.tx,
      tyy: s.ty,
      x: Math.round(s.cx),
      y: Math.round(s.cy),
      w: s.tw,
      h: s.th,
      hp: Math.round(s.health),
      mhp: s.maxHealth,
      o: s.ownerId,
      open: s.open
    };
  }

  snapshotAll() {
    return Array.from(this.list.values()).map(s => this.publicState(s));
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

module.exports = { StructureManager, BUILD_RANGE, INTERACT_RANGE };
