'use strict';
const { items } = require('./data');

// Slot shape: { id, count, durability?, mag? }
// durability is set for weapons, mag (rounds in magazine) for ranged weapons.
class Inventory {
  constructor(size) {
    this.size = size;
    this.slots = new Array(size).fill(null);
    this.dirty = true;
  }

  static makeSlot(id, count) {
    const def = items[id];
    const slot = { id, count: count || 1 };
    if (def && def.weapon && def.durability) slot.durability = def.durability;
    return slot;
  }

  // Returns the number of items that did NOT fit.
  add(id, count) {
    const def = items[id];
    if (!def || !Number.isInteger(count) || count <= 0) return count > 0 ? count : 0;
    let left = count;

    if (def.stack > 1) {
      for (const s of this.slots) {
        if (left <= 0) break;
        if (s && s.id === id && s.count < def.stack) {
          const put = Math.min(def.stack - s.count, left);
          s.count += put;
          left -= put;
        }
      }
    }
    for (let i = 0; i < this.size && left > 0; i++) {
      if (this.slots[i]) continue;
      const put = Math.min(def.stack, left);
      this.slots[i] = Inventory.makeSlot(id, put);
      left -= put;
    }
    if (left !== count) this.dirty = true;
    return left;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  has(id, count) {
    return this.count(id) >= (count || 1);
  }

  canAfford(cost) {
    for (const [id, n] of Object.entries(cost)) if (!this.has(id, n)) return false;
    return true;
  }

  // Removes up to `count` items. Returns true only if the full amount was removed.
  remove(id, count) {
    if (!this.has(id, count)) return false;
    let left = count;
    for (let i = this.size - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) this.slots[i] = null;
    }
    this.dirty = true;
    return true;
  }

  // Atomic: either the whole cost is paid or nothing changes.
  pay(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [id, n] of Object.entries(cost)) this.remove(id, n);
    return true;
  }

  slot(i) {
    return Number.isInteger(i) && i >= 0 && i < this.size ? this.slots[i] : null;
  }

  clearSlot(i) {
    if (this.slots[i]) { this.slots[i] = null; this.dirty = true; }
  }

  swap(a, b) {
    if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
    if (a < 0 || b < 0 || a >= this.size || b >= this.size || a === b) return false;
    const t = this.slots[a];
    this.slots[a] = this.slots[b];
    this.slots[b] = t;
    this.dirty = true;
    return true;
  }

  clear() {
    this.slots.fill(null);
    this.dirty = true;
  }

  // Remove everything and return it (used for the death drop).
  takeAll() {
    const out = [];
    for (let i = 0; i < this.size; i++) {
      if (this.slots[i]) { out.push(this.slots[i]); this.slots[i] = null; }
    }
    this.dirty = true;
    return out;
  }

  serialize() {
    return this.slots.map(s => (s ? { id: s.id, n: s.count, d: s.durability, m: s.mag } : null));
  }
}

module.exports = { Inventory };
