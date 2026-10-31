'use strict';
const { config, classes, items } = require('./data');
const { dist, angleDiff, randRange } = require('./util');

const CC = config.combat;

// Damage formula: attack stat * multiplier, reduced by defense with diminishing returns.
function calcDamage(attackerStats, stat, mult, targetDef, critBonus, rng) {
  const r = rng || Math.random;
  const raw = (attackerStats[stat] || 0) * mult;
  const defStat = stat === 'matk' ? 'mdef' : 'def';
  const dv = typeof targetDef === 'number' ? targetDef : 0;
  const reduction = dv / (dv + 60 + raw * 0.15);
  let dmg = raw * (1 - reduction) * randRange(0.9, 1.1, r);
  const critChance = Math.min(0.85, (attackerStats.crit || 0) + (critBonus || 0));
  const crit = r() < critChance;
  if (crit) dmg *= CC.critMultiplier;
  return { dmg: Math.max(1, Math.round(dmg)), crit };
}

// Monster damage vs player: uses player's def.
function monsterDamage(atk, playerStats, mult) {
  const dv = playerStats.def || 0;
  const raw = atk * (mult || 1);
  const reduction = dv / (dv + 40 + raw * 0.2);
  return Math.max(1, Math.round(raw * (1 - reduction) * randRange(0.9, 1.1)));
}

class Combat {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
  }

  // ---------- helpers ----------
  hostiles(x, y, r) {
    const out = [];
    for (const m of this.game.monstersNear(x, y, r + 40)) if (!m.dead) out.push(m);
    for (const b of this.game.bosses.values()) if (!b.dead && dist(x, y, b.x, b.y) <= r + b.radius + 40) out.push(b);
    return out;
  }

  hitTarget(p, target, stat, mult, now, critBonus) {
    const g = this.game;
    const { dmg, crit } = calcDamage(p.stats, stat, mult, target.def && target.def.def !== undefined ? target.def.def : 0, critBonus);
    const killed = target.takeDamage(dmg, p.id, now);
    p.lastCombatAt = now;
    g.emit({ t: 'dmg', id: target.id, x: Math.round(target.x), y: Math.round(target.y), v: dmg, crit, by: p.id });
    if (killed) g.onEnemyDeath(target, now);
    return killed;
  }

  // ---------- basic attack ----------
  basicAttack(p, now) {
    if (p.dead || now < p.attackReadyAt) return;
    const b = p.def.basic;
    const cd = b.cooldownMs || CC.basicAttackCooldownMs;
    p.attackReadyAt = now + cd;
    if (b.type === 'melee') this.meleeHit(p, b, now, null);
    else this.fireProjectile(p, b, now, b);
  }

  meleeHit(p, spec, now, critBonus) {
    const g = this.game;
    const half = ((spec.arcDeg || 90) * Math.PI) / 180 / 2;
    const targets = [];
    for (const t of this.hostiles(p.x, p.y, spec.range + 20)) {
      const d = dist(p.x, p.y, t.x, t.y);
      if (d - t.radius > spec.range) continue;
      const ang = Math.atan2(t.y - p.y, t.x - p.x);
      if (d > t.radius + 6 && Math.abs(angleDiff(p.facing, ang)) > half) continue;
      targets.push({ t, d });
    }
    targets.sort((a, b) => a.d - b.d);
    g.emit({ t: 'swing', id: p.id, x: Math.round(p.x), y: Math.round(p.y), f: Math.round(p.facing * 100) / 100, r: spec.range, a: spec.arcDeg || 90, fx: spec.fx || 'slash' });
    for (const { t } of targets.slice(0, 5)) this.hitTarget(p, t, spec.stat, spec.mult, now, critBonus);
  }

  fireProjectile(p, spec, now, visual) {
    const range = spec.range || 220;
    this.projectiles.push({
      ownerId: p.id, x: p.x, y: p.y,
      dx: Math.cos(p.facing), dy: Math.sin(p.facing),
      speed: spec.speed || 320, left: range,
      stat: spec.stat, mult: spec.mult, radius: spec.radius || 0,
      color: (visual && visual.color) || spec.color || '#fff', fx: spec.fx || null,
      id: Math.floor(Math.random() * 1e9)
    });
    this.game.emit({ t: 'shoot', id: p.id, x: Math.round(p.x), y: Math.round(p.y), f: Math.round(p.facing * 100) / 100, c: (visual && visual.color) || spec.color || '#fff', sp: spec.speed || 320, rg: range });
  }

  updateProjectiles(dt, now) {
    const g = this.game;
    const keep = [];
    for (const pr of this.projectiles) {
      const owner = g.players.get(pr.ownerId);
      const step = pr.speed * dt;
      let hit = null;
      const sub = Math.max(1, Math.ceil(step / 8));
      for (let i = 0; i < sub && !hit; i++) {
        pr.x += (pr.dx * step) / sub;
        pr.y += (pr.dy * step) / sub;
        if (g.world.tileBlocked(g.world.toTile(pr.x), g.world.toTile(pr.y), true)) { pr.left = 0; break; }
        for (const t of this.hostiles(pr.x, pr.y, 10)) {
          if (dist(pr.x, pr.y, t.x, t.y) <= t.radius + 5) { hit = t; break; }
        }
      }
      pr.left -= step;
      if (hit && owner && !owner.dead) {
        if (pr.radius > 0) {
          g.emit({ t: 'boom', x: Math.round(pr.x), y: Math.round(pr.y), r: pr.radius, c: pr.color });
          for (const t of this.hostiles(pr.x, pr.y, pr.radius)) {
            if (dist(pr.x, pr.y, t.x, t.y) <= pr.radius + t.radius) this.hitTarget(owner, t, pr.stat, pr.mult, now);
          }
        } else {
          this.hitTarget(owner, hit, pr.stat, pr.mult, now);
        }
        continue;
      }
      if (pr.left > 0) keep.push(pr);
    }
    this.projectiles = keep;
  }

  // ---------- skills ----------
  useSkill(p, idx, tx, ty, now) {
    if (p.dead) return 'mati';
    const base = p.def.skills[idx];
    if (!base) return 'skill_tidak_ada';
    // Rank dari skill tree: damage naik, biaya MP dan cooldown turun.
    const mods = p.skillMods(base.id);
    const sk = Object.assign({}, base, {
      mp: Math.max(1, Math.round(base.mp * mods.mp)),
      cooldownMs: Math.round(base.cooldownMs * mods.cd)
    });
    if (typeof base.mult === 'number') sk.mult = base.mult * mods.mult;
    if (p.level < sk.level) return 'level_kurang';
    if (now < (p.cooldowns[sk.id] || 0)) return 'cooldown';
    if (now < p.globalReadyAt) return 'cooldown';
    if (p.mp < sk.mp) return 'mp_kurang';

    const g = this.game;
    p.mp -= sk.mp;
    p.cooldowns[sk.id] = now + sk.cooldownMs;
    p.globalReadyAt = now + CC.globalSkillCooldownMs;
    p.dirtyStats = true;
    p.lastCombatAt = now;

    switch (sk.type) {
      case 'melee':
        this.meleeHit(p, sk, now, sk.critBonus);
        break;
      case 'projectile':
        this.fireProjectile(p, sk, now, sk);
        break;
      case 'aoe': {
        g.emit({ t: 'boom', x: Math.round(p.x), y: Math.round(p.y), r: sk.radius, c: sk.fx === 'frost' ? '#9fd4ff' : '#ffd27a' });
        for (const t of this.hostiles(p.x, p.y, sk.radius)) {
          if (dist(p.x, p.y, t.x, t.y) > sk.radius + t.radius) continue;
          this.hitTarget(p, t, sk.stat, sk.mult, now);
          if (sk.slow && t.applySlow) t.applySlow(sk.slow.factor, now, sk.slow.ms);
        }
        break;
      }
      case 'aoe_target': {
        const range = sk.range || 240;
        let ax = tx, ay = ty;
        if (!Number.isFinite(ax) || !Number.isFinite(ay)) { ax = p.x + Math.cos(p.facing) * range; ay = p.y + Math.sin(p.facing) * range; }
        const d = dist(p.x, p.y, ax, ay);
        if (d > range) { ax = p.x + ((ax - p.x) / d) * range; ay = p.y + ((ay - p.y) / d) * range; }
        g.emit({ t: 'warn', x: Math.round(ax), y: Math.round(ay), r: sk.radius, ms: 600, c: sk.fx === 'meteor' ? '#ff7a1a' : '#d9c27a' });
        g.schedule(now + 600, () => {
          const owner = g.players.get(p.id);
          if (!owner || owner.dead) return;
          g.emit({ t: 'boom', x: Math.round(ax), y: Math.round(ay), r: sk.radius, c: sk.fx === 'meteor' ? '#ff5a1a' : '#f1e08a' });
          const t2 = Date.now();
          for (const t of this.hostiles(ax, ay, sk.radius)) {
            if (dist(ax, ay, t.x, t.y) <= sk.radius + t.radius) this.hitTarget(owner, t, sk.stat, sk.mult, t2);
          }
        });
        break;
      }
      case 'heal_aoe': {
        const amount = p.stats[sk.stat] * sk.mult;
        g.emit({ t: 'heal', x: Math.round(p.x), y: Math.round(p.y), r: sk.radius });
        for (const o of g.players.values()) {
          if (o.dead || dist(p.x, p.y, o.x, o.y) > sk.radius) continue;
          const got = o.heal(amount);
          if (got > 0) g.emit({ t: 'dmg', id: o.id, x: Math.round(o.x), y: Math.round(o.y), v: Math.round(got), heal: true });
        }
        break;
      }
      case 'buff':
        p.addBuff(sk.buff);
        g.emit({ t: 'buff', id: p.id, x: Math.round(p.x), y: Math.round(p.y), c: p.def.color });
        break;
      case 'buff_aoe':
        for (const o of g.players.values()) {
          if (o.dead || dist(p.x, p.y, o.x, o.y) > sk.radius) continue;
          o.addBuff(sk.buff);
        }
        g.emit({ t: 'buff', id: p.id, x: Math.round(p.x), y: Math.round(p.y), c: p.def.color, r: sk.radius });
        break;
      case 'dash': {
        const ux = Math.cos(p.facing), uy = Math.sin(p.facing);
        let moved = 0;
        for (let s = 8; s <= sk.distance; s += 8) {
          if (g.world.circleBlocked(p.x + ux * 8, p.y + uy * 8, p.radius, true)) break;
          p.x += ux * 8; p.y += uy * 8; moved = s;
        }
        g.emit({ t: 'dash', id: p.id, x: Math.round(p.x), y: Math.round(p.y), f: Math.round(p.facing * 100) / 100 });
        for (const t of this.hostiles(p.x, p.y, sk.range)) {
          if (dist(p.x, p.y, t.x, t.y) <= sk.range + t.radius) this.hitTarget(p, t, sk.stat, sk.mult, now);
        }
        break;
      }
      default:
        break;
    }
    return null;
  }

  // ---------- consumables ----------
  usePotion(p, slotIdx, now) {
    if (p.dead) return 'mati';
    const s = p.inv[slotIdx];
    if (!s) return 'kosong';
    const def = items[s.id];
    if (!def || def.type !== 'consumable') return 'bukan_consumable';
    if (now < p.potionReadyAt) return 'cooldown';
    const fx = def.effect || {};
    const needHp = fx.hp && p.hp < p.max.hp;
    const needMp = fx.mp && p.mp < p.max.mp;
    if (!needHp && !needMp) return 'tidak_perlu';
    if (fx.hp) p.heal(fx.hp);
    if (fx.mp) p.restoreMp(fx.mp);
    p.removeItem(s.id, 1);
    p.potionReadyAt = now + (def.cooldownMs || 2000);
    this.game.emit({ t: 'heal', x: Math.round(p.x), y: Math.round(p.y), r: 20 });
    return null;
  }
}

module.exports = { Combat, calcDamage, monsterDamage };
