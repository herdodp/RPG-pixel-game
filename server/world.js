'use strict';
const { makeRng } = require('./util');

const TILE = { GRASS: 0, TREE: 1, ROCK: 2, WATER: 3 };
const TERRAIN_BLOCKS = [false, true, true, true];
const NODE_DEFS = {
  [TILE.TREE]: { item: 'wood', hp: 60, min: 2, max: 4, respawnMs: 180000 },
  [TILE.ROCK]: { item: 'stone', hp: 90, min: 1, max: 3, respawnMs: 240000 }
};

class MinHeap {
  constructor() { this.ids = []; this.pri = []; }
  get size() { return this.ids.length; }
  clear() { this.ids.length = 0; this.pri.length = 0; }
  push(id, p) {
    const ids = this.ids, pri = this.pri;
    let i = ids.length;
    ids.push(id); pri.push(p);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= pri[i]) break;
      [ids[parent], ids[i]] = [ids[i], ids[parent]];
      [pri[parent], pri[i]] = [pri[i], pri[parent]];
      i = parent;
    }
  }
  pop() {
    const ids = this.ids, pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop();
    const lastP = pri.pop();
    if (ids.length > 0) {
      ids[0] = lastId; pri[0] = lastP;
      let i = 0;
      const n = ids.length;
      for (;;) {
        let l = i * 2 + 1, r = l + 1, m = i;
        if (l < n && pri[l] < pri[m]) m = l;
        if (r < n && pri[r] < pri[m]) m = r;
        if (m === i) break;
        [ids[m], ids[i]] = [ids[i], ids[m]];
        [pri[m], pri[i]] = [pri[i], pri[m]];
        i = m;
      }
    }
    return top;
  }
}

function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

class World {
  constructor(spawnCfg, seed) {
    this.ts = spawnCfg.world.tileSize;
    this.w = Math.floor(spawnCfg.world.width / this.ts);
    this.h = Math.floor(spawnCfg.world.height / this.ts);
    this.pxW = this.w * this.ts;
    this.pxH = this.h * this.ts;
    this.tiles = new Uint8Array(this.w * this.h);
    this.nodes = new Map();      // tile idx -> { type, hp, maxHp }
    this.depleted = [];          // { idx, type, at }
    this.structTiles = new Map(); // tile idx -> structure
    this.changes = [];           // terrain changes to broadcast
    this.seed = seed || 1337;

    // A* scratch buffers (reused between calls).
    const n = this.w * this.h;
    this._g = new Float32Array(n);
    this._stamp = new Uint32Array(n);
    this._closed = new Uint32Array(n);
    this._from = new Int32Array(n);
    this._runId = 0;
    this._heap = new MinHeap();

    this.generate(spawnCfg.zones || []);
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  toTile(v) { return Math.floor(v / this.ts); }

  generate(zones) {
    const rng = makeRng(this.seed);
    const W = this.w, H = this.h;
    const blob = (cx, cy, rad, type, prob) => {
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
          if (!this.inBounds(x, y)) continue;
          if (Math.hypot(x - cx, y - cy) > rad * (0.75 + rng() * 0.35)) continue;
          if (rng() < prob) this.tiles[this.idx(x, y)] = type;
        }
      }
    };

    for (let i = 0; i < 7; i++) blob(rng() * W, rng() * H, 3 + rng() * 4, TILE.WATER, 1);
    for (let i = 0; i < 45; i++) blob(rng() * W, rng() * H, 3 + rng() * 6, TILE.TREE, 0.4);

    const forest = zones.find(z => z.id === 'forest');
    if (forest) {
      const r = forest.rect, ts = this.ts;
      for (let i = 0; i < 40; i++) {
        blob((r.x + rng() * r.w) / ts, (r.y + rng() * r.h) / ts, 3 + rng() * 5, TILE.TREE, 0.55);
      }
    }
    for (let i = 0; i < 60; i++) blob(rng() * W, rng() * H, 1 + rng() * 2.5, TILE.ROCK, 0.7);

    // Keep the world edge walkable so nothing gets trapped against the border.
    for (let x = 0; x < W; x++) { this.tiles[this.idx(x, 0)] = TILE.GRASS; this.tiles[this.idx(x, H - 1)] = TILE.GRASS; }
    for (let y = 0; y < H; y++) { this.tiles[this.idx(0, y)] = TILE.GRASS; this.tiles[this.idx(W - 1, y)] = TILE.GRASS; }

    // Clear a safe landing area around the world centre.
    const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.hypot(x - cx, y - cy) < 7) this.tiles[this.idx(x, y)] = TILE.GRASS;
      }
    }

    for (let i = 0; i < this.tiles.length; i++) {
      const def = NODE_DEFS[this.tiles[i]];
      if (def) this.nodes.set(i, { type: this.tiles[i], hp: def.hp, maxHp: def.hp });
    }
  }

  // ---------- structures ----------
  canPlace(tx, ty, tw, th) {
    for (let y = ty; y < ty + th; y++) {
      for (let x = tx; x < tx + tw; x++) {
        if (!this.inBounds(x, y)) return false;
        const i = this.idx(x, y);
        if (this.tiles[i] !== TILE.GRASS) return false;
        if (this.structTiles.has(i)) return false;
      }
    }
    return true;
  }

  addStructure(s) {
    for (let y = s.ty; y < s.ty + s.th; y++) {
      for (let x = s.tx; x < s.tx + s.tw; x++) this.structTiles.set(this.idx(x, y), s);
    }
  }

  removeStructure(s) {
    for (let y = s.ty; y < s.ty + s.th; y++) {
      for (let x = s.tx; x < s.tx + s.tw; x++) {
        const i = this.idx(x, y);
        if (this.structTiles.get(i) === s) this.structTiles.delete(i);
      }
    }
  }

  structureAtTile(tx, ty) {
    return this.structTiles.get(this.idx(tx, ty)) || null;
  }

  static structureBlocks(s) {
    return !!(s && !s.dead && s.def.blocksMovement && !s.open);
  }

  tileBlocked(tx, ty) {
    if (!this.inBounds(tx, ty)) return true;
    const i = this.idx(tx, ty);
    if (TERRAIN_BLOCKS[this.tiles[i]]) return true;
    return World.structureBlocks(this.structTiles.get(i));
  }

  // ---------- collision ----------
  circleBlocked(x, y, r) {
    if (x - r < 0 || y - r < 0 || x + r > this.pxW || y + r > this.pxH) return true;
    const ts = this.ts;
    const x0 = Math.floor((x - r) / ts), x1 = Math.floor((x + r) / ts);
    const y0 = Math.floor((y - r) / ts), y1 = Math.floor((y + r) / ts);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.tileBlocked(tx, ty)) continue;
        if (circleHitsRect(x, y, r, tx * ts, ty * ts, ts, ts)) return true;
      }
    }
    return false;
  }

  // Axis-separated movement so entities slide along walls.
  moveCircle(x, y, dx, dy, r) {
    let nx = x, ny = y;
    if (dx !== 0 && !this.circleBlocked(x + dx, y, r)) nx = x + dx;
    if (dy !== 0 && !this.circleBlocked(nx, y + dy, r)) ny = y + dy;
    return { x: nx, y: ny, blockedX: nx === x && dx !== 0, blockedY: ny === y && dy !== 0 };
  }

  hasLineOfSight(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / (this.ts * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.tileBlocked(this.toTile(ax + dx * t), this.toTile(ay + dy * t))) return false;
    }
    return true;
  }

  // First structure hit by a straight segment, or null (used by bullets and zombie melee).
  firstBlockerOnSegment(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / (this.ts * 0.5)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = ax + dx * t, py = ay + dy * t;
      const tx = this.toTile(px), ty = this.toTile(py);
      if (!this.inBounds(tx, ty)) return { x: px, y: py, kind: 'edge' };
      const k = this.idx(tx, ty);
      if (TERRAIN_BLOCKS[this.tiles[k]]) return { x: px, y: py, kind: 'terrain' };
    }
    return null;
  }

  // ---------- resources ----------
  nodeAt(tx, ty) {
    if (!this.inBounds(tx, ty)) return null;
    return this.nodes.get(this.idx(tx, ty)) || null;
  }

  harvest(tx, ty, amount) {
    if (!this.inBounds(tx, ty)) return null;
    const i = this.idx(tx, ty);
    const node = this.nodes.get(i);
    if (!node) return null;
    const def = NODE_DEFS[node.type];
    node.hp -= amount;
    if (node.hp > 0) return { depleted: false, def };
    this.nodes.delete(i);
    this.tiles[i] = TILE.GRASS;
    this.depleted.push({ idx: i, type: node.type, at: Date.now() + def.respawnMs });
    this.changes.push({ tx, ty, t: TILE.GRASS });
    return { depleted: true, def };
  }

  update(now) {
    if (this.depleted.length === 0) return;
    const keep = [];
    for (const d of this.depleted) {
      if (now < d.at) { keep.push(d); continue; }
      if (this.structTiles.has(d.idx)) { d.at = now + 30000; keep.push(d); continue; }
      const def = NODE_DEFS[d.type];
      this.tiles[d.idx] = d.type;
      this.nodes.set(d.idx, { type: d.type, hp: def.hp, maxHp: def.hp });
      this.changes.push({ tx: d.idx % this.w, ty: Math.floor(d.idx / this.w), t: d.type });
    }
    this.depleted = keep;
  }

  drainChanges() {
    const c = this.changes;
    this.changes = [];
    return c;
  }

  // ---------- free point helpers ----------
  findFreePoint(x, y, r, spread, tries, rng) {
    const rand = rng || Math.random;
    for (let i = 0; i < (tries || 30); i++) {
      const a = rand() * Math.PI * 2;
      const d = rand() * spread;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (!this.circleBlocked(px, py, r)) return { x: px, y: py };
    }
    return null;
  }

  randomFreePointInRect(rect, r, tries, rng) {
    const rand = rng || Math.random;
    for (let i = 0; i < (tries || 20); i++) {
      const px = rect.x + rand() * rect.w, py = rect.y + rand() * rect.h;
      if (!this.circleBlocked(px, py, r)) return { x: px, y: py };
    }
    return null;
  }

  // ---------- pathfinding (A*) ----------
  // Closed, destructible structures are passable at a high cost so zombies prefer a detour
  // but will break through when there is none. Indestructible blockers are impassable.
  findPath(sx, sy, gx, gy, opts) {
    const maxNodes = (opts && opts.maxNodes) || 1500;
    const structCost = (opts && opts.structureCost) || 8;
    const W = this.w;
    const stx = this.toTile(sx), sty = this.toTile(sy);
    const gtx = this.toTile(gx), gty = this.toTile(gy);
    if (!this.inBounds(stx, sty) || !this.inBounds(gtx, gty)) return null;

    const passCost = (tx, ty) => {
      if (!this.inBounds(tx, ty)) return -1;
      const i = this.idx(tx, ty);
      if (TERRAIN_BLOCKS[this.tiles[i]]) return -1;
      const s = this.structTiles.get(i);
      if (World.structureBlocks(s)) return s.def.zombieDamageable ? structCost : -1;
      return 0;
    };

    if (passCost(gtx, gty) < 0) return null;
    const start = this.idx(stx, sty), goal = this.idx(gtx, gty);
    if (start === goal) return [{ x: gx, y: gy }];

    const run = ++this._runId;
    const heap = this._heap;
    heap.clear();
    const g = this._g, stamp = this._stamp, closed = this._closed, from = this._from;
    const heur = (tx, ty) => {
      const dx = Math.abs(tx - gtx), dy = Math.abs(ty - gty);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    g[start] = 0; stamp[start] = run; from[start] = -1;
    heap.push(start, heur(stx, sty));
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let expanded = 0;
    let found = false;

    while (heap.size > 0 && expanded < maxNodes) {
      const cur = heap.pop();
      if (closed[cur] === run) continue;
      closed[cur] = run;
      expanded++;
      if (cur === goal) { found = true; break; }
      const cx = cur % W, cy = (cur - cx) / W;
      for (const [ox, oy] of DIRS) {
        const nx = cx + ox, ny = cy + oy;
        const c = passCost(nx, ny);
        if (c < 0) continue;
        if (ox !== 0 && oy !== 0) {
          // No corner cutting through walls or terrain.
          if (passCost(cx + ox, cy) < 0 || passCost(cx, cy + oy) < 0) continue;
        }
        const ni = this.idx(nx, ny);
        if (closed[ni] === run) continue;
        const ng = g[cur] + (ox !== 0 && oy !== 0 ? 1.414 : 1) + c;
        if (stamp[ni] !== run || ng < g[ni]) {
          stamp[ni] = run;
          g[ni] = ng;
          from[ni] = cur;
          heap.push(ni, ng + heur(nx, ny));
        }
      }
    }
    if (!found) return null;

    const path = [];
    let n = goal;
    while (n !== -1 && n !== start) {
      const tx = n % W, ty = (n - tx) / W;
      path.push({ x: tx * this.ts + this.ts / 2, y: ty * this.ts + this.ts / 2 });
      n = from[n];
    }
    path.reverse();
    if (path.length > 0) path[path.length - 1] = { x: gx, y: gy };
    return path;
  }
}

module.exports = { World, TILE, NODE_DEFS };
