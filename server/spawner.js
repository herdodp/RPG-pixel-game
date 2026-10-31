'use strict';
const { spawn: SPAWN } = require('./data');
const { dist, weightedPick } = require('./util');

const POP = SPAWN.population;
const SAFE = SPAWN.safeSpawn;
const NIGHT = SPAWN.night;
const MAX_ATTEMPTS = 8;

function inRect(x, y, r) {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

class Spawner {
  constructor(game) {
    this.game = game;
    this.zones = SPAWN.zones.map(z => ({ cfg: z, area: z.rect.w * z.rect.h, pending: [] }));
    this.zoneById = new Map(this.zones.map(z => [z.cfg.id, z]));
    this.nextSpawnAt = 0;
    this.playerCursor = 0;
    this.nextDespawnAt = 0;
    this.enabled = true; // wave mode turns the ambient spawner off
  }

  setEnabled(v) { this.enabled = !!v; }

  // The most specific (smallest) zone containing the point wins, so a town inside the
  // outskirts uses the town's density and type mix.
  zoneAt(x, y) {
    let best = null;
    for (const z of this.zones) {
      if (!inRect(x, y, z.cfg.rect)) continue;
      if (!best || z.area < best.area) best = z;
    }
    return best;
  }

  // Called by the game when an ambient zombie dies. The slot stays reserved until the
  // respawn delay passes, so respawns are paced and still respect the population caps.
  onZombieKilled(zombie, now) {
    if (zombie.fromWave || !zombie.zoneId) return;
    const z = this.zoneById.get(zombie.zoneId);
    if (z) z.pending.push(now + POP.respawnDelayMs);
  }

  zoneTarget(z, isNight) {
    const base = z.cfg.maxZombies * z.cfg.density;
    return Math.max(0, Math.round(base * (isNight ? NIGHT.maxMultiplier : 1)));
  }

  update(now) {
    const game = this.game;
    if (!this.enabled) return;

    for (const z of this.zones) {
      if (z.pending.length) z.pending = z.pending.filter(t => t > now);
    }
    if (now >= this.nextDespawnAt) {
      this.nextDespawnAt = now + 3000;
      this.despawnFar();
    }
    if (now < this.nextSpawnAt) return;

    const isNight = game.isNight();
    const interval = POP.spawnIntervalMs / (isNight ? NIGHT.spawnRateMultiplier : 1);
    this.nextSpawnAt = now + interval;

    const players = game.alivePlayers();
    if (players.length === 0) return;

    // Counts of ambient zombies, per zone and globally.
    const counts = new Map();
    let ambient = 0;
    for (const zb of game.zombies.values()) {
      if (zb.dead || zb.fromWave) continue;
      ambient++;
      counts.set(zb.zoneId, (counts.get(zb.zoneId) || 0) + 1);
    }
    if (ambient >= POP.globalMax) return;

    // One spawn attempt per tick, around one player at a time (round robin).
    const p = players[this.playerCursor++ % players.length];
    if (this.zombiesNearPlayer(p) >= POP.perPlayerMax) return;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const d = SAFE.minDistanceFromPlayer + Math.random() * (SAFE.maxDistanceFromPlayer - SAFE.minDistanceFromPlayer);
      const x = p.x + Math.cos(ang) * d;
      const y = p.y + Math.sin(ang) * d;
      const zone = this.zoneAt(x, y);
      if (!zone) continue;

      const alive = counts.get(zone.cfg.id) || 0;
      if (alive + zone.pending.length >= this.zoneTarget(zone, isNight)) continue;
      if (!this.isSafeSpawn(x, y)) continue;

      const weights = isNight ? zone.cfg.nightTypes : zone.cfg.dayTypes;
      const type = weightedPick(weights);
      if (!type) continue;
      const def = game.zombieDefs[type];
      if (!def) continue;

      game.addZombie(type, x, y, { zoneId: zone.cfg.id });
      return;
    }
  }

  isSafeSpawn(x, y) {
    const game = this.game;
    if (game.world.circleBlocked(x, y, 10)) return false;
    for (const pl of game.alivePlayers()) {
      if (dist(x, y, pl.x, pl.y) < SAFE.minDistanceFromPlayer) return false;
    }
    if (game.structures.nearest(x, y, SAFE.avoidStructureRadius)) return false;
    return true;
  }

  zombiesNearPlayer(p) {
    let n = 0;
    for (const zb of this.game.zombiesNear(p.x, p.y, SAFE.maxDistanceFromPlayer + 200)) {
      if (!zb.dead && !zb.fromWave) n++;
    }
    return n;
  }

  // Ambient zombies that wandered far from every player are removed silently so the
  // population budget stays near active players. This is not a kill and gives no loot.
  despawnFar() {
    const game = this.game;
    const players = game.alivePlayers();
    for (const zb of Array.from(game.zombies.values())) {
      if (zb.dead || zb.fromWave) continue;
      let near = false;
      for (const p of players) {
        if (dist(zb.x, zb.y, p.x, p.y) < POP.despawnDistance) { near = true; break; }
      }
      if (!near) game.removeZombie(zb, 'despawn');
    }
  }
}

module.exports = { Spawner };
