'use strict';
const assert = require('assert');

// Fake clock so the simulation runs far faster than real time and is repeatable.
let fake = 1700000000000;
Date.now = () => fake;

const { Game } = require('../server/game');
const { ST } = require('../server/zombie');
const { items } = require('../server/data');
const { dist } = require('../server/util');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    const msg = e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : String(e);
    console.log('FAIL ' + name + '\n     ' + msg);
  }
}

function fakeWs() {
  return { readyState: 1, bufferedAmount: 0, sent: [], send(m) { this.sent.push(JSON.parse(m)); }, close() {}, terminate() {} };
}

function makeGame(opts) {
  const g = new Game(opts);
  g.startMs = fake;
  g.lastTick = fake;
  return g;
}

function run(g, seconds) {
  const n = Math.round(seconds * 20);
  for (let i = 0; i < n; i++) { fake += 50; g.tick(); }
}

function joinPlayer(g, name, mortal) {
  const ws = fakeWs();
  const p = g.join(ws, name);
  if (!mortal) { p.maxHealth = 1e9; p.health = 1e9; }
  return { ws, p };
}

function clearZombies(g) {
  for (const z of Array.from(g.zombies.values())) g.removeZombie(z, 'test');
  g.rebuildHash();
}

// ------------------------------------------------------------------ main game
const g = makeGame({ seed: 1, waves: false });
const { ws, p } = joinPlayer(g, 'Tester');
const spawned = [];
const origAdd = g.addZombie.bind(g);
g.addZombie = (type, x, y, o) => { spawned.push({ type, d: dist(x, y, p.x, p.y) }); return origAdd(type, x, y, o); };
let barricade = null;

test('player joins and receives init with world and definitions', () => {
  const init = ws.sent[0];
  assert.strictEqual(init.t, 'init');
  assert(init.world.tiles.length > 0, 'tiles present');
  assert(init.defs.weapons.pistol && init.defs.zombies.tank && init.defs.structures.gate);
});

test('ambient spawner creates zombies away from the player during the day', () => {
  assert.strictEqual(g.isNight(), false);
  run(g, 40);
  assert(spawned.length > 5, 'spawned only ' + spawned.length);
  const min = Math.min(...spawned.map(s => s.d));
  assert(min >= 259, 'min spawn distance was ' + min);
  assert(!spawned.some(s => s.type === 'night'), 'night zombies must not spawn by day');
});

test('night allows night zombies and keeps spawning', () => {
  clearZombies(g);
  spawned.length = 0;
  g.startMs = fake - 300000; // time of day 0.7 = night
  for (let i = 0; i < 12; i++) { run(g, 5); clearZombies(g); }
  assert(g.isNight(), 'should be night');
  assert(spawned.length > 20, 'spawned only ' + spawned.length);
  assert(spawned.some(s => s.type === 'night'), 'night zombie type should appear');
  assert(Math.min(...spawned.map(s => s.d)) >= 259, 'spawned too close to the player');
});

test('melee weapon applies damage, respects cooldown and loses durability', () => {
  g.spawner.setEnabled(false);
  clearZombies(g);
  const slot = p.inv.slot(0);
  assert.strictEqual(slot.id, 'wooden_bat');
  const d0 = slot.durability;
  const z = g.addZombie('normal', p.x + 22, p.y);
  g.handle(p, { t: 'attack', facing: 0 }, fake);
  assert.strictEqual(z.health, 42);
  assert.strictEqual(slot.durability, d0 - 1);
  g.handle(p, { t: 'attack', facing: 0 }, fake);
  assert.strictEqual(z.health, 42, 'cooldown should block the second hit');
  fake += 700;
  g.handle(p, { t: 'attack', facing: 0 }, fake);
  assert.strictEqual(z.health, 24);
});

test('killing a zombie gives the player a kill', () => {
  clearZombies(g);
  const k0 = p.kills;
  const z = g.addZombie('normal', p.x + 22, p.y);
  z.health = 1;
  fake += 700;
  g.handle(p, { t: 'attack', facing: 0 }, fake);
  assert(z.dead, 'zombie should be dead');
  assert.strictEqual(p.kills, k0 + 1);
});

test('drop tables only roll valid items and can produce rare drops', () => {
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    for (const d of g.loot.roll('tank')) {
      assert(items[d.item], 'unknown item ' + d.item);
      assert(d.count > 0);
      seen.add(d.item);
    }
  }
  assert(seen.has('scrap') && seen.has('medkit'), 'common drops missing');
});

test('loot pickup is validated by distance', () => {
  const near = g.loot.spawnAt(p.x, p.y, 'wood', 3, null, fake);
  const before = p.inv.count('wood');
  g.handle(p, { t: 'pickup', id: near.id }, fake);
  assert.strictEqual(p.inv.count('wood'), before + 3);
  assert(!g.loot.drops.has(near.id));
  const far = g.loot.spawnAt(p.x + 300, p.y, 'wood', 3, null, fake);
  p.events = [];
  g.handle(p, { t: 'pickup', id: far.id }, fake);
  assert(g.loot.drops.has(far.id), 'far loot must not be picked up');
  assert(p.events.some(e => e.t === 'err' && e.code === 'too_far'));
});

test('pistol reloads over time and uses one round per shot', () => {
  clearZombies(g);
  p.inv.add('pistol', 1);
  p.inv.add('ammo_pistol', 30);
  const idx = p.inv.slots.findIndex(s => s && s.id === 'pistol');
  g.handle(p, { t: 'select', slot: idx }, fake);
  assert.strictEqual(p.selected, idx);
  g.handle(p, { t: 'reload' }, fake);
  assert(p.reload, 'reload should start');
  run(g, 2);
  const slot = p.inv.slot(idx);
  assert.strictEqual(slot.mag, 12);
  assert.strictEqual(p.inv.count('ammo_pistol'), 18);
  const z = g.addZombie('normal', p.x + 100, p.y);
  g.handle(p, { t: 'attack', facing: 0 }, fake);
  assert.strictEqual(slot.mag, 11);
  assert.strictEqual(z.health, 60 - 22);
});

test('shotgun pellets all hit at close range', () => {
  clearZombies(g);
  p.inv.add('shotgun', 1);
  p.inv.add('ammo_shotgun', 12);
  const idx = p.inv.slots.findIndex(s => s && s.id === 'shotgun');
  g.handle(p, { t: 'select', slot: idx }, fake);
  g.handle(p, { t: 'reload' }, fake);
  run(g, 3);
  assert.strictEqual(p.inv.slot(idx).mag, 6);
  const z = g.addZombie('normal', p.x + 60, p.y);
  g.handle(p, { t: 'attack', facing: 0 }, fake);
  assert(z.dead, 'six pellets of 12 damage should kill a normal zombie');
  g.handle(p, { t: 'select', slot: 0 }, fake);
});

test('zombie AI detects, chases, attacks, loses interest and wanders again', () => {
  clearZombies(g);
  const px = p.x, py = p.y;
  const z = g.addZombie('normal', p.x + 100, p.y);
  run(g, 0.6);
  assert([ST.CHASE, ST.ATTACK].includes(z.state), 'expected chase/attack, got ' + z.state);
  assert.strictEqual(z.targetId, p.id);
  run(g, 6);
  assert.strictEqual(z.state, ST.ATTACK, 'zombie should be attacking, got ' + z.state);
  p.x = px + 600; p.y = py;
  run(g, 1);
  assert([ST.WANDER, ST.IDLE].includes(z.state), 'zombie should give up, got ' + z.state);
  assert.strictEqual(z.targetId, 0);
  p.x = px; p.y = py;
});

test('building validates range, space and cost, and charges resources', () => {
  clearZombies(g);
  p.inv.add('wood', 40);
  p.inv.add('nails', 40);
  p.inv.add('scrap', 20);
  const w0 = p.inv.count('wood');
  assert.strictEqual(g.structures.tryPlace(p, 'wooden_barricade', p.x + 500, p.y, g, fake).error, 'too_far');
  assert.strictEqual(g.structures.tryPlace(p, 'wooden_barricade', p.x, p.y, g, fake).error, 'entity_in_the_way');
  assert.strictEqual(g.structures.tryPlace(p, 'nonsense', p.x + 40, p.y, g, fake).error, 'unknown_structure');
  const ok = g.structures.tryPlace(p, 'wooden_barricade', p.x + 64, p.y, g, fake);
  assert(ok.ok, 'placement failed: ' + ok.error);
  barricade = ok.structure;
  assert.strictEqual(p.inv.count('wood'), w0 - 6);
  assert.strictEqual(g.structures.tryPlace(p, 'wooden_barricade', p.x + 64, p.y, g, fake).error, 'blocked_tile');
});

test('pathfinding routes around player-built structures', () => {
  const s = barricade;
  const path = g.world.findPath(s.cx - 64, s.cy, s.cx + 64, s.cy, { maxNodes: 2000, structureCost: 8 });
  assert(path && path.length >= 3, 'no path found');
  for (const wp of path.slice(0, -1)) {
    assert(!g.world.structureAtTile(g.world.toTile(wp.x), g.world.toTile(wp.y)), 'path runs through the barricade');
  }
});

test('structures can be damaged, repaired and destroyed', () => {
  const s = barricade;
  g.structures.damage(s, 50, null);
  assert.strictEqual(s.health, 70);
  const wood0 = p.inv.count('wood');
  const r = g.structures.repair(p, s.id);
  assert(r.ok, 'repair failed: ' + r.error);
  assert.strictEqual(s.health, 110);
  assert.strictEqual(p.inv.count('wood'), wood0 - 2);
  assert.strictEqual(g.structures.damage(s, 9999, null), true);
  assert(!g.world.structureAtTile(s.tx, s.ty), 'tile should be free');
  assert.strictEqual(g.structures.get(s.id), null);
});

test('snapshots only include zombies inside the interest radius and send death events', () => {
  clearZombies(g);
  const near = g.addZombie('normal', p.x + 120, p.y);
  const far = g.addZombie('normal', p.x + 1200, p.y);
  ws.sent.length = 0;
  run(g, 0.5);
  const ids = new Set();
  for (const m of ws.sent) {
    if (m.t === 'snap' && m.z) for (const s of (m.z.a || []).concat(m.z.u || [])) ids.add(s.id);
  }
  assert(ids.has(near.id), 'nearby zombie missing from snapshots');
  assert(!ids.has(far.id), 'distant zombie must not be sent');
  g.damageZombie(near, 9999, p.id, fake, 'test');
  ws.sent.length = 0;
  run(g, 0.3);
  const evs = ws.sent.flatMap(m => m.ev || []);
  assert(evs.some(e => e.t === 'zdie' && e.id === near.id), 'death event missing');
});

test('player death drops inventory and respawns after the delay', () => {
  clearZombies(g);
  p.inv.add('wood', 5);
  const drops0 = g.loot.drops.size;
  g.killPlayer(p, 'test', fake);
  assert(p.dead);
  assert(g.loot.drops.size > drops0, 'inventory should drop');
  assert.strictEqual(p.inv.count('wood'), 0);
  run(g, 6);
  assert.strictEqual(p.dead, false, 'player should have respawned');
  assert(p.inv.count('wooden_bat') >= 1, 'starting kit expected');
});

test('survival: hunger drains, bandage stops bleeding, dehydration kills', () => {
  const g3 = makeGame({ seed: 2, waves: false });
  g3.spawner.setEnabled(false);
  const { ws: ws3, p: q } = joinPlayer(g3, 'Hungry', true);
  const h0 = q.hunger;
  run(g3, 10);
  assert(q.hunger < h0, 'hunger should drain');
  q.bleeding = true;
  q.health = 50;
  const idx = q.inv.slots.findIndex(s => s && s.id === 'bandage');
  g3.handle(q, { t: 'use', slot: idx }, fake);
  assert(q.using, 'bandage use should start');
  run(g3, 2);
  assert.strictEqual(q.bleeding, false);
  assert(q.health > 50, 'health was ' + q.health);
  q.hunger = 0;
  q.thirst = 0;
  run(g3, 60);
  assert(q.deaths >= 1, 'player should have died');
  const evs = ws3.sent.flatMap(m => m.ev || []);
  assert(evs.some(e => e.t === 'pdie' && e.cause === 'dehydration'), 'death cause event missing');
});

test('wave mode spawns waves, tracks remaining and pays rewards', () => {
  const g4 = makeGame({ seed: 3, waves: true });
  g4.waves.setEnabled(true, fake);
  const { p: q } = joinPlayer(g4, 'Wave', false);
  run(g4, 8);
  assert.strictEqual(g4.waves.wave, 1, 'wave 1 should have started');
  const zs = Array.from(g4.zombies.values()).filter(z => !z.dead);
  assert(zs.length > 0 && zs.every(z => z.fromWave), 'only wave zombies expected');
  assert(g4.waves.publicState(fake).left > 0);
  const score0 = q.score;
  const ammo0 = q.inv.count('ammo_pistol');
  for (const z of zs) g4.damageZombie(z, 99999, q.id, fake, 'test');
  run(g4, 1);
  assert(q.score > score0, 'wave reward score expected');
  assert(q.inv.count('ammo_pistol') > ammo0, 'wave reward items expected');
  assert.strictEqual(g4.waves.phase, 'intermission');
});

test('zombies break through player-built walls', () => {
  const g2 = makeGame({ seed: 1, waves: false });
  g2.spawner.setEnabled(false);
  const { p: q } = joinPlayer(g2, 'Builder');
  const ts = g2.world.ts;
  const tx = g2.world.toTile(q.x), ty = g2.world.toTile(q.y);
  q.x = (tx + 0.5) * ts;
  q.y = (ty + 0.5) * ts;
  q.inv.add('wood', 50);
  q.inv.add('nails', 50);
  let built = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const r = g2.structures.tryPlace(q, 'wooden_barricade', (tx + dx + 0.5) * ts, (ty + dy + 0.5) * ts, g2, fake);
      if (r.ok) built++;
    }
  }
  assert.strictEqual(built, 8, 'ring should be complete');
  const z = g2.addZombie('tank', q.x + 150, q.y);
  z.aggro(q.id, fake);
  run(g2, 40);
  const list = Array.from(g2.structures.list.values());
  const damaged = list.some(s => s.health < s.maxHealth) || list.length < 8;
  assert(damaged, 'zombie never attacked the walls (state ' + z.state + ')');
});

console.log('\n' + (failed ? failed + ' test(s) FAILED' : 'All tests passed'));
process.exit(failed ? 1 : 0);
