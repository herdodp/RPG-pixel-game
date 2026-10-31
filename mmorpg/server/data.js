'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function load(name) {
  const file = path.join(DATA_DIR, name + '.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error('Gagal memuat data/' + name + '.json: ' + err.message);
  }
}

const config = load('config');
const classes = load('classes');
const itemsFile = load('items');
const monstersFile = load('monsters');
const bossesFile = load('bosses');
const npcsFile = load('npcs');
const questsFile = load('quests');

const rarities = itemsFile.rarities;
const items = {};
for (const [id, def] of Object.entries(itemsFile.items)) {
  items[id] = Object.assign({ id }, def);
  if (items[id].type === 'equip') items[id].stack = 1;
}

const zones = monstersFile.zones;
const monsters = monstersFile.monsters;
const aggroMul = (config.ai && config.ai.monsterAggroMul) || 1;
for (const m of Object.values(monsters)) m.aggro = Math.max(40, Math.round(m.aggro * aggroMul));
const spawns = monstersFile.spawns;
const bosses = bossesFile.bosses;
const npcs = npcsFile.npcs;
const quests = questsFile.quests;
const questById = {};
for (const q of quests) questById[q.id] = q;

const EQUIP_SLOTS = ['weapon', 'helm', 'armor', 'boots', 'ring'];

function validate() {
  const problems = [];
  const checkDrops = (owner, drops) => {
    for (const d of drops || []) {
      if (!items[d.item]) problems.push(owner + ' drop memakai item tidak dikenal: ' + d.item);
      if (d.chance < 0 || d.chance > 1) problems.push(owner + ' chance di luar 0-1 untuk ' + d.item);
      if (d.min > d.max) problems.push(owner + ' min>max untuk ' + d.item);
    }
  };

  for (const [id, it] of Object.entries(items)) {
    if (!rarities[it.rarity]) problems.push('item ' + id + ' rarity tidak dikenal: ' + it.rarity);
    if (it.type === 'equip') {
      if (!EQUIP_SLOTS.includes(it.slot)) problems.push('item ' + id + ' slot tidak valid: ' + it.slot);
      if (it.slot === 'weapon' && !it.weaponType) problems.push('item ' + id + ' senjata tanpa weaponType');
    }
  }
  for (const [id, m] of Object.entries(monsters)) checkDrops('monster ' + id, m.drops);
  for (const [id, b] of Object.entries(bosses)) {
    checkDrops('boss ' + id, b.drops);
    for (const ph of b.phases) {
      for (const sk of ph.skills) {
        if (sk.type === 'summon' && !monsters[sk.monster]) problems.push('boss ' + id + ' summon monster tidak dikenal: ' + sk.monster);
      }
    }
    if (!zones.find(z => z.id === b.zone)) problems.push('boss ' + id + ' zona tidak dikenal: ' + b.zone);
  }
  for (const sp of spawns) {
    if (!zones.find(z => z.id === sp.zone)) problems.push('spawn zona tidak dikenal: ' + sp.zone);
    for (const m of Object.keys(sp.mix)) if (!monsters[m]) problems.push('spawn ' + sp.zone + ' monster tidak dikenal: ' + m);
  }
  for (const n of npcs) {
    for (const s of n.stock || []) if (!items[s]) problems.push('npc ' + n.id + ' stock item tidak dikenal: ' + s);
  }
  for (const [cid, c] of Object.entries(classes)) {
    if (!c.skills || c.skills.length === 0) problems.push('class ' + cid + ' tidak punya skill');
  }
  const questIds = new Set(quests.map(q => q.id));
  for (const q of quests) {
    if (q.prereq && !questIds.has(q.prereq)) problems.push('quest ' + q.id + ' prereq tidak dikenal: ' + q.prereq);
    if (q.type === 'kill' && !monsters[q.target]) problems.push('quest ' + q.id + ' target monster tidak dikenal: ' + q.target);
    if (q.type === 'boss' && !bosses[q.target]) problems.push('quest ' + q.id + ' target boss tidak dikenal: ' + q.target);
    if (q.type === 'collect' && !items[q.target]) problems.push('quest ' + q.id + ' target item tidak dikenal: ' + q.target);
    for (const it of Object.keys((q.reward && q.reward.items) || {})) if (!items[it]) problems.push('quest ' + q.id + ' hadiah item tidak dikenal: ' + it);
  }
  for (const id of Object.keys(config.player.startingItems)) {
    if (!items[id]) problems.push('player.startingItems item tidak dikenal: ' + id);
  }
  if (problems.length) throw new Error('Validasi data gagal:\n - ' + problems.join('\n - '));
}
validate();

module.exports = { config, classes, items, rarities, zones, monsters, spawns, bosses, npcs, quests, questById, EQUIP_SLOTS };
