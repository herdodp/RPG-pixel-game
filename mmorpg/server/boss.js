'use strict';
const { bosses: BDEF, monsters: MDEF } = require('./data');
const { nextId, dist, randRange } = require('./util');

const ST = { IDLE: 0, CHASE: 1, ATTACK: 2, RETURN: 3, DEAD: 4 };
const DEATH_MS = 3000;
const SCAN_MS = 400;

class Boss {
  constructor(key, now) {
    const def = BDEF[key];
    if (!def) throw new Error('Boss tidak dikenal: ' + key);
    this.id = nextId();
    this.kind = 'boss';
    this.key = key;
    this.def = def;
    this.name = def.name;
    this.level = def.level;
    this.radius = def.radius;
    this.homeX = def.pos.x;
    this.homeY = def.pos.y;
    this.respawnAt = 0;
    this.reset(now || Date.now());
  }

  reset(now) {
    this.x = this.homeX;
    this.y = this.homeY;
    this.maxHp = this.def.hp;
    this.hp = this.def.hp;
    this.facing = Math.PI / 2;
    this.state = ST.IDLE;
    this.targetId = 0;
    this.dead = false;
    this.deadAt = 0;
    this.phaseIdx = 0;
    this.attackReadyAt = 0;
    this.pendingHitAt = 0;
    this.skillReadyAt = {};
    this.casting = null;       // { skill, doneAt, x, y }
    this.nextScanAt = now;
    this.threat = new Map();   // charId -> damage dealt
    this.lastHitBy = 0;
    this.engagedAt = 0;
    this.slowUntil = 0;
    this.slowFactor = 1;
    this.summons = new Set();
  }

  get phase() { return this.def.phases[this.phaseIdx]; }

  // Phases are ordered from hpPct 1.0 downwards.
  updatePhase(ctx) {
    const frac = this.hp / this.maxHp;
    let idx = 0;
    for (let i = 0; i < this.def.phases.length; i++) if (frac <= this.def.phases[i].hpPct) idx = i;
    if (idx !== this.phaseIdx) {
      this.phaseIdx = idx;
      ctx.emit({ t: 'bphase', id: this.id, name: this.name, phase: idx + 1 });
    }
  }

  applySlow(factor, now, ms) {
    this.slowFactor = Math.max(factor, 0.6); // bosses are only partially slowed
    this.slowUntil = now + ms;
  }

  // Returns true if this hit killed the boss.
  takeDamage(amount, attackerId, now) {
    if (this.dead || amount <= 0) return false;
    this.hp -= amount;
    if (attackerId) {
      this.threat.set(attackerId, (this.threat.get(attackerId) || 0) + amount);
      this.lastHitBy = attackerId;
      if (!this.engagedAt) this.engagedAt = now;
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deadAt = now;
      this.state = ST.DEAD;
      this.casting = null;
      return true;
    }
    return false;
  }

  topThreatTarget(ctx) {
    let best = null, bd = 0;
    for (const [id, dmg] of this.threat) {
      const p = ctx.getPlayer(id);
      if (!p || p.dead) continue;
      if (dist(this.x, this.y, p.x, p.y) > this.def.leash) continue;
      if (dmg > bd) { bd = dmg; best = p; }
    }
    return best;
  }

  update(ctx, dt, now) {
    if (this.dead) return;
    this.updatePhase(ctx);
    const slow = now < this.slowUntil ? this.slowFactor : 1;

    if (this.casting && now >= this.casting.doneAt) {
      const c = this.casting;
      this.casting = null;
      this.resolveSkill(ctx, c, now);
    }
    if (this.pendingHitAt && now >= this.pendingHitAt) {
      this.pendingHitAt = 0;
      const t = ctx.getPlayer(this.targetId);
      if (t && !t.dead && dist(this.x, this.y, t.x, t.y) <= this.phase.range + t.radius + 14) {
        ctx.hitPlayer(this, t, this.phase.atk, now);
      }
    }

    switch (this.state) {
      case ST.IDLE: this.updateIdle(ctx, now); break;
      case ST.CHASE: this.updateChase(ctx, dt, now, slow); break;
      case ST.ATTACK: this.updateAttack(ctx, dt, now, slow); break;
      case ST.RETURN: this.updateReturn(ctx, dt, now); break;
    }
  }

  updateIdle(ctx, now) {
    if (now < this.nextScanAt) return;
    this.nextScanAt = now + SCAN_MS;
    const p = ctx.nearestPlayer(this.x, this.y, this.def.aggro);
    if (p) { this.targetId = p.id; this.state = ST.CHASE; this.engagedAt = now; }
  }

  retarget(ctx, now) {
    const t = this.topThreatTarget(ctx) || ctx.nearestPlayer(this.x, this.y, this.def.aggro);
    if (!t) {
      this.targetId = 0;
      this.state = ST.RETURN;
      return null;
    }
    this.targetId = t.id;
    return t;
  }

  updateChase(ctx, dt, now, slow) {
    let t = ctx.getPlayer(this.targetId);
    if (!t || t.dead) t = this.retarget(ctx, now);
    if (!t) return;
    if (dist(this.x, this.y, this.homeX, this.homeY) > this.def.leash) { this.targetId = 0; this.state = ST.RETURN; return; }
    this.tryCast(ctx, t, now);
    if (this.casting) return;
    const d = dist(this.x, this.y, t.x, t.y);
    if (d <= this.phase.range + t.radius) { this.state = ST.ATTACK; return; }
    this.step(ctx.world, t.x, t.y, this.def.speed * slow, dt);
  }

  updateAttack(ctx, dt, now, slow) {
    let t = ctx.getPlayer(this.targetId);
    if (!t || t.dead) t = this.retarget(ctx, now);
    if (!t) return;
    this.tryCast(ctx, t, now);
    if (this.casting) return;
    const d = dist(this.x, this.y, t.x, t.y);
    this.facing = Math.atan2(t.y - this.y, t.x - this.x);
    if (d > this.phase.range + t.radius + 10 && !this.pendingHitAt) { this.state = ST.CHASE; return; }
    if (!this.pendingHitAt && now >= this.attackReadyAt) {
      this.pendingHitAt = now + 300;
      this.attackReadyAt = now + this.phase.attackCdMs;
      ctx.emit({ t: 'matk', id: this.id, x: Math.round(this.x), y: Math.round(this.y), f: Math.round(this.facing * 100) / 100 });
    }
  }

  updateReturn(ctx, dt, now) {
    // Full reset: the boss heals fully and forgets everyone (anti-exploit).
    const d = dist(this.x, this.y, this.homeX, this.homeY);
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.2 * dt);
    this.casting = null;
    this.threat.clear();
    this.engagedAt = 0;
    if (d < 10) {
      this.hp = this.maxHp;
      this.phaseIdx = 0;
      this.state = ST.IDLE;
      return;
    }
    this.step(ctx.world, this.homeX, this.homeY, this.def.speed * 2.2, dt);
  }

  // ---------- skills ----------
  tryCast(ctx, target, now) {
    if (this.casting) return;
    for (const sk of this.phase.skills) {
      if (now < (this.skillReadyAt[sk.id] || 0)) continue;
      this.skillReadyAt[sk.id] = now + sk.cdMs;
      const c = { skill: sk, doneAt: now + sk.telegraphMs, x: this.x, y: this.y };
      if (sk.type === 'aoe_target') { c.x = target.x; c.y = target.y; }
      if (sk.type === 'summon') { c.x = this.x; c.y = this.y; }
      this.casting = c;
      this.pendingHitAt = 0;
      ctx.emit({
        t: 'bcast', id: this.id, sk: sk.id, name: sk.name, ty: sk.type,
        x: Math.round(c.x), y: Math.round(c.y), r: sk.radius || 0, ms: sk.telegraphMs
      });
      return;
    }
  }

  resolveSkill(ctx, c, now) {
    const sk = c.skill;
    if (sk.type === 'summon') {
      for (let i = 0; i < sk.count; i++) {
        if (!MDEF[sk.monster]) continue;
        const a = (Math.PI * 2 * i) / sk.count + Math.random() * 0.5;
        const pt = ctx.world.findFreePoint(this.x + Math.cos(a) * 60, this.y + Math.sin(a) * 60, 10, 40, 10);
        if (!pt) continue;
        const m = ctx.spawnMinion(sk.monster, pt.x, pt.y, this.id, now);
        if (m) this.summons.add(m.id);
      }
      ctx.emit({ t: 'bsummon', id: this.id, x: Math.round(this.x), y: Math.round(this.y) });
      return;
    }
    // aoe_self / aoe_target: damage everyone inside the circle at resolve time.
    const dmg = this.phase.atk * sk.mult;
    ctx.emit({ t: 'bhit', id: this.id, sk: sk.id, x: Math.round(c.x), y: Math.round(c.y), r: sk.radius });
    for (const p of ctx.playersNear(c.x, c.y, sk.radius + 20)) {
      if (p.dead) continue;
      if (dist(c.x, c.y, p.x, p.y) <= sk.radius + p.radius) ctx.hitPlayer(this, p, dmg, now);
    }
  }

  step(world, tx, ty, speed, dt) {
    const dx = tx - this.x, dy = ty - this.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const ux = dx / len, uy = dy / len;
    this.facing = Math.atan2(uy, ux);
    const s = Math.min(speed * dt, len);
    const r = world.moveCircle(this.x, this.y, ux * s, uy * s, this.radius);
    this.x = r.x;
    this.y = r.y;
  }

  publicState() {
    return {
      id: this.id, key: this.key, name: this.name, lv: this.level,
      x: Math.round(this.x * 10) / 10, y: Math.round(this.y * 10) / 10,
      f: Math.round(this.facing * 100) / 100, hp: Math.round(this.hp), mhp: this.maxHp,
      st: this.state, ph: this.phaseIdx + 1, cast: this.casting ? this.casting.skill.id : null
    };
  }
}

module.exports = { Boss, ST, DEATH_MS };
