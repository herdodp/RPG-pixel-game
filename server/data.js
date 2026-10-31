'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function load(name) {
  const file = path.join(DATA_DIR, name + '.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error('Failed to load data/' + name + '.json: ' + err.message);
  }
}

const config = load('config');
const weapons = load('weapons');
const zombies = load('zombies');
const spawn = load('spawn');
const loot = load('loot');
const structures = load('structures');
const recipes = load('recipes');

// Single item registry: loot items + weapons (weapons are non-stackable).
const items = {};
for (const [id, def] of Object.entries(loot.items)) {
  items[id] = Object.assign({ id }, def);
}
for (const [id, def] of Object.entries(weapons)) {
  items[id] = {
    id,
    name: def.name,
    stack: 1,
    category: 'weapon',
    weapon: true,
    durability: def.durability || null
  };
}

function validate() {
  const problems = [];

  for (const [tid, table] of Object.entries(loot.dropTables)) {
    for (const e of table.entries) {
      if (!items[e.item]) problems.push('dropTable ' + tid + ' references unknown item ' + e.item);
      if (e.chance < 0 || e.chance > 1) problems.push('dropTable ' + tid + ' chance out of range for ' + e.item);
      if (e.min > e.max) problems.push('dropTable ' + tid + ' min>max for ' + e.item);
    }
  }

  for (const [zid, z] of Object.entries(zombies)) {
    if (!loot.dropTables[z.drops]) problems.push('zombie ' + zid + ' uses unknown drop table ' + z.drops);
  }

  for (const zone of spawn.zones) {
    for (const key of ['dayTypes', 'nightTypes']) {
      for (const t of Object.keys(zone[key])) {
        if (!zombies[t]) problems.push('zone ' + zone.id + ' ' + key + ' uses unknown zombie type ' + t);
      }
    }
  }

  for (const [sid, s] of Object.entries(structures)) {
    for (const k of Object.keys(s.cost)) {
      if (!items[k]) problems.push('structure ' + sid + ' cost uses unknown item ' + k);
    }
    if (s.repair) {
      for (const k of Object.keys(s.repair.cost)) {
        if (!items[k]) problems.push('structure ' + sid + ' repair uses unknown item ' + k);
      }
    }
  }

  for (const [wid, w] of Object.entries(weapons)) {
    if (w.type === 'ranged' && !items[w.ammoType]) {
      problems.push('weapon ' + wid + ' uses unknown ammo ' + w.ammoType);
    }
  }

  for (const [rid, r] of Object.entries(recipes)) {
    if (!items[r.output]) problems.push('recipe ' + rid + ' outputs unknown item ' + r.output);
    for (const k of Object.keys(r.cost)) {
      if (!items[k]) problems.push('recipe ' + rid + ' cost uses unknown item ' + k);
    }
  }

  for (const id of Object.keys(config.player.startingItems)) {
    if (!items[id]) problems.push('player.startingItems uses unknown item ' + id);
  }
  for (const id of Object.keys(config.waves.rewardPerWave)) {
    if (!items[id]) problems.push('waves.rewardPerWave uses unknown item ' + id);
  }

  if (problems.length) {
    throw new Error('Data validation failed:\n - ' + problems.join('\n - '));
  }
}

validate();

module.exports = { config, weapons, zombies, spawn, loot, structures, recipes, items };
