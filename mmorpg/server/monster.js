'use strict';
const { monsters: MDEF } = require('./data');
const { nextId, dist, randRange } = require('./util');

const ST = { IDLE: 0, WANDER: 1, CHASE: 2, ATTACK: 3, RETURN: 4, DEAD: 5 };
const DEATH_MS = 1200;
const LEASH = 420;
const SCAN_MS = 300;

class Monster {
  constructor(type, x, y, opts) {
    const def = MDEF[type];
    if (!def) throw new Error('Monster tidak dikenal: ' + type);
    opts = opts || {};
    this.id = nextId();
    this.kind = 'monster';
    this.type = type;
    this.def = def;
    this.name = def.name;
    this.level = def.level;
    this.x = x;
    this.y = y;
    this.homeX = x;
    this.homeY = y;
    this.radius = def.radius;
    this.facing = Math.random() * Math.PI * 2;
    this.maxHp = def.hp;
    this.hp = def.hp;
    this.zoneIdx = opts.zoneIdx === undefined ? -1 : opts.zoneIdx;
    this.summoned = !!opts.summoned;
    this.ownerBoss = opts.ownerBoss || 0;
    this.state = ST.IDLE;
    this.stateUntil = 0;
    this.wanderTarget = null;
    this.targetId = 0;
    this.nextScanAt = Date.now() + Math.random() * SCAN_MS;
    this.attackReadyAt = 0;
    this.pendingHitAt = 0;
    this.slowUntil = 0;
    this.slowFactor = 1;
    this.dead = false;
    this.deadAt = 0;
    this.threat = new Map(); // charId -> damage dealt
    this.lastHitBy = 0;
    this.stuckAt = 0;
    this.stuckX = x;
    this.stuckY = y;
  }

  setState(st, now, ms) {
    this.state = st;
    this.stateUntil = ms ? now + ms : 0;
  }

  // Returns true if this hit killed the monster.
  takeDamage(amount, attackerId, now) {
    if (this.dead || amount <= 0) return false;
    this.hp -= amount;
    if (attackerId) {
      this.threat.set(attackerId, (this.threat.get(attackerId) || 0) + amount);
      this.lastHitBy = attackerId;
      if (this.state !== ST.ATTACK) { this.targetId = attackerId; this.setState(ST.CHASE, now); }
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deadAt = now;
      this.state = ST.DEAD;
      return true;
    }
    return false;
  }

  applySlow(factor, now, ms) {
    this.slowFactor = factor;
    this.slowUntil = now + ms;
  }

  // ctx: { world, nearestPlayer(x,y,r), getPlayer(id), hitPlayer(monster, player, dmg, now), emit }
  update(ctx, dt, now) {
    if (this.dead) return;
    const slow = now < this.slowUntil ? this.slowFactor : 1;

    if (this.pendingHitAt && now >= this.pendingHitAt) {
      this.pendingHitAt = 0;
      const t = ctx.getPlayer(this.targetId);
      if (t && !t.dead && dist(this.x, this.y, t.x, t.y) <= this.def.attackRange + t.radius + 10) {
        ctx.hitPlayer(this, t, this.def.atk, now);
      }
    }

    switch (this.state) {
      case ST.IDLE: this.updateIdle(ctx, now); break;
      case ST.WANDER: this.updateWander(ctx, dt, now, slow); break;
      case ST.CHASE: this.updateChase(ctx, dt, now, slow); break;
      case ST.ATTACK: this.updateAttack(ctx, now); break;
      case ST.RETURN: this.updateReturn(ctx, dt, now); break;
    }
    this.checkStuck(ctx, now);
  }

  scan(ctx, now) {
    if (now < this.nextScanAt) return null;
    this.nextScanAt = now + SCAN_MS;
    const p = ctx.nearestPlayer(this.x, this.y, this.def.aggro);
    if (!p) return null;
    if (ctx.world.hasLineOfSight(this.x, this.y, p.x, p.y) || dist(this.x, this.y, p.x, p.y) < this.def.aggro * 0.4) return p;
    return null;
  }

  aggro(p, now) {
    this.targetId = p.id;
    this.setState(ST.CHASE, now);
  }

  updateIdle(ctx, now) {
    if (!this.stateUntil) this.stateUntil = now + randRange(1500, 5000);
    const p = this.scan(ctx, now);
    if (p) { this.aggro(p, now); return; }
    if (now >= this.stateUntil) { this.wanderTarget = null; this.setState(ST.WANDER, now, randRange(3000, 7000)); }
  }

  updateWander(ctx, dt, now, slow) {
    const p = this.scan(ctx, now);
    if (p) { this.aggro(p, now); return; }
    if (!this.wanderTarget) {
      const pt = ctx.world.findFreePoint(this.homeX, this.homeY, this.radius, 110, 10);
      if (!pt) { this.setState(ST.IDLE, now, randRange(1000, 3000)); return; }
      this.wanderTarget = pt;
    }
    const t = this.wanderTarget;
    if (dist(this.x, this.y, t.x, t.y) < 6 || now >= this.stateUntil) {
      this.wanderTarget = null;
      this.setState(ST.IDLE, now, randRange(1500, 4500));
      return;
    }
    const res = this.step(ctx.world, t.x, t.y, this.def.speed * 0.4 * slow, dt);
    if (res.blocked) this.wanderTarget = null;
  }

  updateChase(ctx, dt, now, slow) {
    const t = ctx.getPlayer(this.targetId);
    if (!t || t.dead) { this.dropTarget(ctx, now); return; }
    const d = dist(this.x, this.y, t.x, t.y);
    if (dist(this.x, this.y, this.homeX, this.homeY) > LEASH || d > this.def.aggro * 3) { this.setState(ST.RETURN, now); this.targetId = 0; return; }
    if (d <= this.def.attackRange + t.radius) { this.setState(ST.ATTACK, now); return; }
    this.step(ctx.world, t.x, t.y, this.def.speed * slow, dt);
  }

  dropTarget(ctx, now) {
    // Try another nearby player before giving up.
    const p = ctx.nearestPlayer(this.x, this.y, this.def.aggro);
    if (p) { this.aggro(p, now); return; }
    this.targetId = 0;
    this.setState(ST.RETURN, now);
  }

  updateAttack(ctx, now) {
    const t = ctx.getPlayer(this.targetId);
    if (!t || t.dead) { this.dropTarget(ctx, now); return; }
    const d = dist(this.x, this.y, t.x, t.y);
    this.facing = Math.atan2(t.y - this.y, t.x - this.x);
    if (d > this.def.attackRange + t.radius + 8 && !this.pendingHitAt) { this.setState(ST.CHASE, now); return; }
    if (!this.pendingHitAt && now >= this.attackReadyAt) {
      this.pendingHitAt = now + 260;
      this.attackReadyAt = now + this.def.attackCdMs;
      ctx.emit({ t: 'matk', id: this.id, x: Math.round(this.x), y: Math.round(this.y), f: Math.round(this.facing * 100) / 100 });
    }
  }

  updateReturn(ctx, dt, now) {
    const d = dist(this.x, this.y, this.homeX, this.homeY);
    // Regenerate while walking home.
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.25 * dt);
    if (d < 8) { this.threat.clear(); this.setState(ST.IDLE, now, randRange(1000, 3000)); return; }
    const p = this.scan(ctx, now);
    if (p && this.hp >= this.maxHp * 0.9) { this.aggro(p, now); return; }
    this.step(ctx.world, this.homeX, this.homeY, this.def.speed * 1.3, dt);
  }

  step(world, tx, ty, speed, dt) {
    const dx = tx - this.x, dy = ty - this.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return { blocked: false };
    const ux = dx / len, uy = dy / len;
    this.facing = Math.atan2(uy, ux);
    const stepLen = Math.min(speed * dt, len);
    const r = world.moveCircle(this.x, this.y, ux * stepLen, uy * stepLen, this.radius);
    const moved = r.x !== this.x || r.y !== this.y;
    this.x = r.x;
    this.y = r.y;
    return { blocked: !moved };
  }

  checkStuck(ctx, now) {
    if (this.state !== ST.CHASE && this.state !== ST.RETURN && this.state !== ST.WANDER) { this.stuckAt = 0; return; }
    if (!this.stuckAt) { this.stuckAt = now + 1500; this.stuckX = this.x; this.stuckY = this.y; return; }
    if (now < this.stuckAt) return;
    if (dist(this.x, this.y, this.stuckX, this.stuckY) < 2) {
      const pt = ctx.world.findFreePoint(this.x, this.y, this.radius, 28, 8);
      if (pt) { this.x = pt.x; this.y = pt.y; }
      if (this.state === ST.RETURN) { this.x = this.homeX; this.y = this.homeY; }
    }
    this.stuckAt = now + 1500;
    this.stuckX = this.x;
    this.stuckY = this.y;
  }

  publicState() {
    return {
      id: this.id, ty: this.type, x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10,
      f: Math.round(this.facing * 100) / 100, hp: Math.round(this.hp), mhp: this.maxHp, st: this.state
    };
  }
}

module.exports = { Monster, ST, DEATH_MS };
