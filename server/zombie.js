'use strict';
const { zombies: ZDEF } = require('./data');
const { World } = require('./world');
const { nextId, dist, randRange } = require('./util');

const ST = { IDLE: 0, WANDER: 1, CHASE: 2, ATTACK: 3, DEAD: 4 };
const DEATH_ANIM_MS = 1500;
const ATTACK_WINDUP_MS = 250;
const SCAN_INTERVAL_MS = 250;
const REPATH_INTERVAL_MS = 700;

class Zombie {
  constructor(type, x, y, opts) {
    const def = ZDEF[type];
    if (!def) throw new Error('Unknown zombie type: ' + type);
    opts = opts || {};
    this.id = nextId();
    this.kind = 'zombie';
    this.type = type;
    this.def = def;
    this.x = x;
    this.y = y;
    this.radius = def.radius;
    this.facing = Math.random() * Math.PI * 2;
    this.healthScale = opts.healthScale || 1;
    this.damageScale = opts.damageScale || 1;
    this.maxHealth = Math.round(def.health * this.healthScale);
    this.health = this.maxHealth;
    this.zoneId = opts.zoneId || null;
    this.fromWave = !!opts.fromWave;

    this.state = ST.IDLE;
    this.stateUntil = 0;
    this.targetId = 0;
    this.structTarget = null;
    this.wanderTarget = null;
    this.investigate = null;
    this.path = null;
    this.pathIdx = 0;
    this.nextPathAt = 0;
    this.nextScanAt = Date.now() + Math.random() * SCAN_INTERVAL_MS;
    this.lastSeenAt = 0;
    this.attackReadyAt = 0;
    this.pendingHitAt = 0;
    this.attackSeq = 0;
    this.dead = false;
    this.deadAt = 0;
    this.killerId = 0;
    this.stuckCheckAt = 0;
    this.stuckX = x;
    this.stuckY = y;
    this.slowUntil = 0;
    this.slowFactor = 1;
    this.trapCooldownUntil = 0;
    this.lastKnownX = 0;
    this.lastKnownY = 0;
  }

  // Night/day stat multipliers from data/zombies.json.
  mods(isNight) {
    const src = isNight ? this.def.nightMultipliers : this.def.dayMultipliers;
    return {
      speed: (src && src.speed) || 1,
      damage: (src && src.damage) || 1,
      detect: (src && src.detectRadius) || 1
    };
  }

  setState(st, now, durationMs) {
    this.state = st;
    this.stateUntil = durationMs ? now + durationMs : 0;
    if (st !== ST.CHASE && st !== ST.ATTACK) { this.path = null; this.structTarget = null; }
  }

  aggro(playerId, now) {
    if (this.dead) return;
    this.targetId = playerId;
    this.lastSeenAt = now;
    this.investigate = null;
    if (this.state !== ST.ATTACK) this.setState(ST.CHASE, now);
    this.nextPathAt = 0;
  }

  hearNoise(x, y, now) {
    if (this.dead || this.state === ST.CHASE || this.state === ST.ATTACK) return;
    this.investigate = { x, y };
    this.setState(ST.WANDER, now);
    this.wanderTarget = null;
  }

  // Returns true if this hit killed the zombie.
  takeDamage(amount, attackerId, now, kb) {
    if (this.dead || amount <= 0) return false;
    this.health -= amount;
    if (attackerId) this.aggro(attackerId, now);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deadAt = now;
      this.killerId = attackerId || 0;
      this.state = ST.DEAD;
      this.path = null;
      this.structTarget = null;
      return true;
    }
    return false;
  }

  applyKnockback(world, dx, dy) {
    if (this.dead) return;
    const r = world.moveCircle(this.x, this.y, dx, dy, this.radius);
    this.x = r.x;
    this.y = r.y;
  }

  applySlow(factor, now, ms) {
    this.slowFactor = factor;
    this.slowUntil = now + ms;
  }

  // ---------------------------------------------------------------
  update(ctx, dt, now) {
    if (this.dead) return;
    const world = ctx.world;
    const m = this.mods(ctx.isNight);
    const slow = now < this.slowUntil ? this.slowFactor : 1;

    // Resolve a pending melee hit after its windup.
    if (this.pendingHitAt && now >= this.pendingHitAt) {
      this.pendingHitAt = 0;
      this.resolveHit(ctx, m, now);
    }

    switch (this.state) {
      case ST.IDLE: this.updateIdle(ctx, m, now); break;
      case ST.WANDER: this.updateWander(ctx, m, dt, now, slow); break;
      case ST.CHASE: this.updateChase(ctx, m, dt, now, slow); break;
      case ST.ATTACK: this.updateAttack(ctx, m, dt, now); break;
    }

    this.separate(ctx, dt);
    this.checkStuck(ctx, now);
  }

  // ---------- detection ----------
  scan(ctx, m, now) {
    if (now < this.nextScanAt) return null;
    this.nextScanAt = now + SCAN_INTERVAL_MS;
    const detectR = this.def.detectRadius * m.detect;
    const p = ctx.nearestPlayer(this.x, this.y, detectR);
    if (!p) return null;
    const d = dist(this.x, this.y, p.x, p.y);
    if (d <= detectR * 0.35 || ctx.world.hasLineOfSight(this.x, this.y, p.x, p.y)) return p;
    return null;
  }

  updateIdle(ctx, m, now) {
    if (!this.stateUntil) this.stateUntil = now + randRange(1500, 5000);
    const p = this.scan(ctx, m, now);
    if (p) { this.aggro(p.id, now); return; }
    if (now >= this.stateUntil) {
      this.wanderTarget = null;
      this.setState(ST.WANDER, now, randRange(4000, 9000));
    }
  }

  updateWander(ctx, m, dt, now, slow) {
    const world = ctx.world;
    const p = this.scan(ctx, m, now);
    if (p) { this.aggro(p.id, now); return; }

    const investigating = !!this.investigate;
    if (!this.wanderTarget) {
      if (investigating) {
        this.wanderTarget = { x: this.investigate.x, y: this.investigate.y };
      } else {
        const pt = world.findFreePoint(this.x, this.y, this.radius, 140, 12);
        if (!pt) { this.setState(ST.IDLE, now, randRange(1000, 3000)); return; }
        this.wanderTarget = pt;
      }
      if (!this.stateUntil) this.stateUntil = now + randRange(4000, 9000);
    }

    const t = this.wanderTarget;
    const d = dist(this.x, this.y, t.x, t.y);
    if (d < 8 || now >= this.stateUntil) {
      this.wanderTarget = null;
      this.investigate = null;
      this.setState(ST.IDLE, now, randRange(1500, 5000));
      return;
    }
    const speed = (investigating ? this.def.speed * 0.7 : this.def.wanderSpeed) * m.speed * slow;
    const res = this.stepToward(world, t.x, t.y, speed, dt);
    if (res.blockedBoth) {
      this.wanderTarget = null;
      this.investigate = null;
    }
  }

  // ---------- chase ----------
  updateChase(ctx, m, dt, now, slow) {
    const world = ctx.world;
    const target = ctx.getPlayer(this.targetId);
    if (!target || target.dead) { this.loseInterest(now); return; }

    const d = dist(this.x, this.y, target.x, target.y);
    const detectR = this.def.detectRadius * m.detect;
    const loseR = this.def.loseInterestRadius * m.detect;

    const canSee = d <= detectR * 1.2 && (d < 40 || world.hasLineOfSight(this.x, this.y, target.x, target.y));
    if (canSee) {
      this.lastSeenAt = now;
      this.lastKnownX = target.x;
      this.lastKnownY = target.y;
    }
    if (d > loseR || now - this.lastSeenAt > this.def.loseInterestMs) {
      this.loseInterest(now);
      return;
    }

    // Break through a structure that is in the way.
    if (this.structTarget) {
      if (this.structTarget.dead || !World.structureBlocks(this.structTarget)) {
        this.structTarget = null;
        this.nextPathAt = 0;
      } else {
        const s = this.structTarget;
        const sd = dist(this.x, this.y, s.cx, s.cy);
        if (sd <= this.def.attackRange + Math.max(s.def.size.w, s.def.size.h) / 2) {
          this.state = ST.ATTACK;
          return;
        }
      }
    }

    if (d <= this.def.attackRange) {
      this.state = ST.ATTACK;
      return;
    }

    // Pick where to path to: live target if seen, otherwise last known position.
    const gx = canSee ? target.x : this.lastKnownX || target.x;
    const gy = canSee ? target.y : this.lastKnownY || target.y;

    if ((!this.path || now >= this.nextPathAt) && ctx.pathBudget.left > 0 && d > this.def.attackRange * 1.5) {
      const direct = d < 90 && world.hasLineOfSight(this.x, this.y, gx, gy);
      if (direct) {
        this.path = null;
      } else {
        ctx.pathBudget.left--;
        this.path = world.findPath(this.x, this.y, gx, gy, { maxNodes: 1400, structureCost: 8 });
        this.pathIdx = 0;
      }
      this.nextPathAt = now + REPATH_INTERVAL_MS + Math.random() * 300;
    }

    const speed = this.def.speed * m.speed * slow;
    let tx = gx, ty = gy;
    if (this.path && this.path.length > 0) {
      while (this.pathIdx < this.path.length - 1 &&
             dist(this.x, this.y, this.path[this.pathIdx].x, this.path[this.pathIdx].y) < 6) {
        this.pathIdx++;
      }
      const wp = this.path[Math.min(this.pathIdx, this.path.length - 1)];
      tx = wp.x; ty = wp.y;
    }
    const res = this.stepToward(world, tx, ty, speed, dt);
    if (res.blockerStruct && res.blockerStruct.def.zombieDamageable) {
      this.structTarget = res.blockerStruct;
    } else if (res.blockedBoth) {
      this.nextPathAt = 0;
    }
  }

  loseInterest(now) {
    this.targetId = 0;
    this.path = null;
    this.structTarget = null;
    this.setState(ST.WANDER, now, randRange(4000, 8000));
    this.wanderTarget = null;
  }

  // ---------- attack ----------
  updateAttack(ctx, m, dt, now) {
    const world = ctx.world;
    const target = ctx.getPlayer(this.targetId);
    const s = this.structTarget;

    let tx, ty, inRange = false;
    if (s && !s.dead && World.structureBlocks(s)) {
      tx = s.cx; ty = s.cy;
      inRange = dist(this.x, this.y, tx, ty) <= this.def.attackRange + Math.max(s.def.size.w, s.def.size.h) / 2 + 4;
    } else {
      this.structTarget = null;
      if (!target || target.dead) { this.loseInterest(now); return; }
      tx = target.x; ty = target.y;
      inRange = dist(this.x, this.y, tx, ty) <= this.def.attackRange * 1.3;
    }

    this.facing = Math.atan2(ty - this.y, tx - this.x);

    if (!inRange && !this.pendingHitAt) {
      this.state = ST.CHASE;
      this.nextPathAt = 0;
      return;
    }

    if (!this.pendingHitAt && now >= this.attackReadyAt) {
      this.pendingHitAt = now + ATTACK_WINDUP_MS;
      this.attackReadyAt = now + this.def.attackCooldownMs;
      this.attackSeq++;
      ctx.emit({ t: 'zattack', id: this.id, x: Math.round(this.x), y: Math.round(this.y) });
    }
  }

  resolveHit(ctx, m, now) {
    const s = this.structTarget;
    if (s && !s.dead && World.structureBlocks(s)) {
      const dmg = this.def.structureDamage * this.damageScale;
      if (dist(this.x, this.y, s.cx, s.cy) <= this.def.attackRange + Math.max(s.def.size.w, s.def.size.h) / 2 + 8) {
        ctx.damageStructure(s, dmg, this);
      }
      return;
    }
    const target = ctx.getPlayer(this.targetId);
    if (!target || target.dead) return;
    if (dist(this.x, this.y, target.x, target.y) > this.def.attackRange * 1.5) return;
    // A wall between zombie and player stops the hit.
    if (!ctx.world.hasLineOfSight(this.x, this.y, target.x, target.y)) return;
    ctx.zombieHitPlayer(this, target, this.def.damage * m.damage * this.damageScale, now);
  }

  // ---------- movement ----------
  stepToward(world, tx, ty, speed, dt) {
    const dx = tx - this.x, dy = ty - this.y;
    const len = Math.hypot(dx, dy);
    const out = { moved: false, blockedBoth: false, blockerStruct: null };
    if (len < 0.5) return out;
    const ux = dx / len, uy = dy / len;
    this.facing = Math.atan2(uy, ux);
    const step = Math.min(speed * dt, len);
    const r = world.moveCircle(this.x, this.y, ux * step, uy * step, this.radius);
    out.moved = r.x !== this.x || r.y !== this.y;
    if (!out.moved) {
      out.blockedBoth = true;
      const ts = world.ts;
      const ax = this.x + ux * (this.radius + ts * 0.5);
      const ay = this.y + uy * (this.radius + ts * 0.5);
      const s = world.structureAtTile(world.toTile(ax), world.toTile(ay));
      if (s && World.structureBlocks(s)) out.blockerStruct = s;
    }
    this.x = r.x;
    this.y = r.y;
    return out;
  }

  // Light push so zombies do not stack on one pixel.
  separate(ctx, dt) {
    const near = ctx.zombiesNear(this.x, this.y, this.radius * 2);
    let px = 0, py = 0;
    for (const o of near) {
      if (o === this || o.dead) continue;
      const d = dist(this.x, this.y, o.x, o.y);
      const min = this.radius + o.radius;
      if (d < min) {
        if (d < 0.01) { px += Math.random() - 0.5; py += Math.random() - 0.5; continue; }
        px += ((this.x - o.x) / d) * (min - d);
        py += ((this.y - o.y) / d) * (min - d);
      }
    }
    if (px !== 0 || py !== 0) {
      const k = Math.min(1, 6 * dt);
      const r = ctx.world.moveCircle(this.x, this.y, px * k, py * k, this.radius);
      this.x = r.x;
      this.y = r.y;
    }
  }

  checkStuck(ctx, now) {
    if (this.state !== ST.CHASE && this.state !== ST.WANDER) { this.stuckCheckAt = 0; return; }
    if (!this.stuckCheckAt) {
      this.stuckCheckAt = now + 1200;
      this.stuckX = this.x;
      this.stuckY = this.y;
      return;
    }
    if (now < this.stuckCheckAt) return;
    if (dist(this.x, this.y, this.stuckX, this.stuckY) < 2) {
      this.path = null;
      this.nextPathAt = 0;
      this.wanderTarget = null;
      const pt = ctx.world.findFreePoint(this.x, this.y, this.radius, 16, 8);
      if (pt) { this.x = pt.x; this.y = pt.y; }
    }
    this.stuckCheckAt = now + 1200;
    this.stuckX = this.x;
    this.stuckY = this.y;
  }

  publicState() {
    return {
      id: this.id,
      ty: this.type,
      x: Math.round(this.x * 10) / 10,
      y: Math.round(this.y * 10) / 10,
      f: Math.round(this.facing * 100) / 100,
      hp: this.health,
      mhp: this.maxHealth,
      st: this.state,
      tg: this.targetId || 0
    };
  }
}

module.exports = { Zombie, ST, DEATH_ANIM_MS };
