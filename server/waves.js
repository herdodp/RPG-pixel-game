'use strict';
const { config, zombies: ZDEF } = require('./data');
const { dist, weightedPick } = require('./util');

const W = config.waves;
const SPAWN_BATCH = 4;
const SPAWN_STEP_MS = 700;
const MIN_DIST = 280;
const MAX_DIST = 620;

// Phases
const PH = { OFF: 'off', INTERMISSION: 'intermission', SPAWNING: 'spawning', ACTIVE: 'active' };

class WaveManager {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.phase = PH.OFF;
    this.wave = 0;
    this.toSpawn = 0;      // zombies still waiting to be spawned this wave
    this.total = 0;        // total zombies in this wave
    this.nextAt = 0;       // next phase/spawn timestamp
    this.dirty = true;
  }

  // Turn wave mode on/off. While on, the ambient spawner is disabled.
  setEnabled(on, now) {
    on = !!on;
    if (on === this.enabled) return;
    this.enabled = on;
    this.game.spawner.setEnabled(!on);
    if (on) {
      this.wave = 0;
      this.phase = PH.INTERMISSION;
      this.nextAt = now + 5000;
    } else {
      this.phase = PH.OFF;
      this.toSpawn = 0;
      this.total = 0;
      // Wave zombies are removed silently when the mode is turned off.
      for (const z of Array.from(this.game.zombies.values())) {
        if (z.fromWave) this.game.removeZombie(z, 'wave_end');
      }
    }
    this.dirty = true;
  }

  countForWave(n) {
    return Math.max(1, Math.round(W.baseCount * Math.pow(W.countGrowth, n - 1)));
  }

  isBossWave(n) {
    return W.bossEvery > 0 && n % W.bossEvery === 0;
  }

  typeWeights(n) {
    const weights = {};
    for (const [type, unlock] of Object.entries(W.typeUnlocks)) {
      if (!ZDEF[type] || n < unlock) continue;
      // Newly unlocked types ramp up in frequency over the next few waves.
      const age = n - unlock + 1;
      let w = type === 'normal' ? 10 : Math.min(6, 1 + age * 0.8);
      if (type === 'tank') w = Math.min(3, 0.5 + age * 0.4);
      weights[type] = w;
    }
    if (Object.keys(weights).length === 0) weights.normal = 1;
    return weights;
  }

  remaining() {
    let alive = 0;
    for (const z of this.game.zombies.values()) if (z.fromWave && !z.dead) alive++;
    return alive + this.toSpawn;
  }

  startWave(now) {
    this.wave++;
    this.total = this.countForWave(this.wave) + (this.isBossWave(this.wave) ? 1 : 0);
    this.toSpawn = this.total;
    this.phase = PH.SPAWNING;
    this.nextAt = now;
    this.dirty = true;
    this.game.emit({ t: 'wave', wave: this.wave, boss: this.isBossWave(this.wave), total: this.total });
  }

  spawnBatch(now) {
    const game = this.game;
    const players = game.alivePlayers();
    if (players.length === 0) return;
    const healthScale = 1 + W.healthScalePerWave * (this.wave - 1);
    const damageScale = 1 + W.damageScalePerWave * (this.wave - 1);
    const weights = this.typeWeights(this.wave);

    let spawned = 0;
    for (let i = 0; i < SPAWN_BATCH && this.toSpawn > 0; i++) {
      const p = players[Math.floor(Math.random() * players.length)];
      let placed = false;
      for (let attempt = 0; attempt < 10 && !placed; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const d = MIN_DIST + Math.random() * (MAX_DIST - MIN_DIST);
        const x = p.x + Math.cos(ang) * d, y = p.y + Math.sin(ang) * d;
        if (game.world.circleBlocked(x, y, 12)) continue;
        let tooClose = false;
        for (const o of players) if (dist(x, y, o.x, o.y) < MIN_DIST * 0.8) { tooClose = true; break; }
        if (tooClose) continue;

        // The last zombie of a boss wave is an empowered tank.
        const isBoss = this.isBossWave(this.wave) && this.toSpawn === 1;
        const type = isBoss ? 'tank' : weightedPick(weights);
        const z = game.addZombie(type, x, y, {
          fromWave: true,
          healthScale: healthScale * (isBoss ? 3 : 1),
          damageScale: damageScale * (isBoss ? 1.5 : 1)
        });
        // Wave zombies know roughly where the players are so the wave keeps pressure on.
        z.aggro(p.id, now);
        this.toSpawn--;
        spawned++;
        placed = true;
      }
      if (!placed) break;
    }
    if (spawned) this.dirty = true;
  }

  // Rewards are granted by the server to every living player. Overflow drops on the ground.
  grantRewards(now) {
    const game = this.game;
    const bonus = this.isBossWave(this.wave) ? 2 : 1;
    for (const p of game.alivePlayers()) {
      for (const [item, n] of Object.entries(W.rewardPerWave)) {
        const amount = Math.round(n * bonus * (1 + (this.wave - 1) * 0.15));
        const left = p.inv.add(item, amount);
        if (left > 0) game.loot.spawnAt(p.x, p.y, item, left, null, now);
      }
      p.score += 50 * this.wave;
      p.statsDirty = true;
      p.events.push({ t: 'wave_reward', wave: this.wave });
    }
  }

  update(now) {
    if (!this.enabled) return;
    const game = this.game;

    // Pause the wave progression while nobody is alive.
    if (game.alivePlayers().length === 0) {
      if (this.phase === PH.ACTIVE || this.phase === PH.SPAWNING) this.nextAt = Math.max(this.nextAt, now + 1000);
      return;
    }

    switch (this.phase) {
      case PH.INTERMISSION:
        if (now >= this.nextAt) this.startWave(now);
        break;
      case PH.SPAWNING:
        if (now >= this.nextAt) {
          this.spawnBatch(now);
          this.nextAt = now + SPAWN_STEP_MS;
        }
        if (this.toSpawn <= 0) this.phase = PH.ACTIVE;
        break;
      case PH.ACTIVE:
        if (this.remaining() === 0) {
          this.grantRewards(now);
          game.emit({ t: 'wave_clear', wave: this.wave });
          this.phase = PH.INTERMISSION;
          this.nextAt = now + W.intermissionMs;
          this.dirty = true;
        }
        break;
    }
  }

  onZombieKilled(zombie) {
    if (zombie.fromWave) this.dirty = true;
  }

  publicState(now) {
    return {
      on: this.enabled,
      wave: this.wave,
      phase: this.phase,
      left: this.enabled ? this.remaining() : 0,
      total: this.total,
      next: this.phase === PH.INTERMISSION ? Math.max(0, Math.ceil((this.nextAt - now) / 1000)) : 0
    };
  }
}

module.exports = { WaveManager };
