'use strict';
const { config, zones } = require('./data');
const { makeRng } = require('./util');

const TILE = { GRASS: 0, TREE: 1, ROCK: 2, WATER: 3, SAND: 4, SNOW: 5, CAVE: 6, PATH: 7 };
const BLOCKS = [false, true, true, true, false, false, false, false];

function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

class World {
  constructor(seed) {
    const W = config.world;
    this.ts = W.tileSize;
    this.w = Math.floor(W.width / this.ts);
    this.h = Math.floor(W.height / this.ts);
    this.pxW = this.w * this.ts;
    this.pxH = this.h * this.ts;
    this.tiles = new Uint8Array(this.w * this.h);
    this.ground = new Uint8Array(this.w * this.h); // base ground type per tile (visual)
    this.seed = seed || 4242;
    this.generate();
  }

  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  toTile(v) { return Math.floor(v / this.ts); }
  isWater(x, y) {
    const tx = this.toTile(x), ty = this.toTile(y);
    return this.inBounds(tx, ty) && this.tiles[this.idx(tx, ty)] === TILE.WATER;
  }

  zoneAt(x, y) {
    let best = null, ba = Infinity;
    for (const z of zones) {
      const r = z.rect;
      if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) continue;
      const a = r.w * r.h;
      if (a < ba) { ba = a; best = z; }
    }
    return best;
  }

  generate() {
    const rng = makeRng(this.seed);
    const W = this.w, H = this.h, ts = this.ts;

    // Ground per zone.
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const z = this.zoneAt((tx + 0.5) * ts, (ty + 0.5) * ts);
        let g = TILE.GRASS;
        if (z && z.id === 'tundra') g = TILE.SNOW;
        else if (z && z.id === 'cave') g = TILE.CAVE;
        this.ground[this.idx(tx, ty)] = g;
        this.tiles[this.idx(tx, ty)] = g;
      }
    }

    const blob = (cx, cy, rad, type, prob) => {
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
          if (!this.inBounds(x, y)) continue;
          if (Math.hypot(x - cx, y - cy) > rad * (0.75 + rng() * 0.35)) continue;
          if (rng() < prob) this.tiles[this.idx(x, y)] = type;
        }
      }
    };

    const AREA = (W * H) / (150 * 150);
    for (let i = 0; i < Math.round(9 * AREA); i++) blob(rng() * W, rng() * H, 3 + rng() * 5, TILE.WATER, 1);
    for (let i = 0; i < Math.round(6 * AREA); i++) blob(rng() * W, rng() * H, 7 + rng() * 8, TILE.WATER, 1);
    for (let i = 0; i < Math.round(60 * AREA); i++) {
      const cx = rng() * W, cy = rng() * H;
      const z = this.zoneAt(cx * ts, cy * ts);
      if (z && z.id === 'cave') continue;
      blob(cx, cy, 3 + rng() * 6, TILE.TREE, z && z.id === 'forest' ? 0.55 : 0.3);
    }
    for (let i = 0; i < Math.round(70 * AREA); i++) blob(rng() * W, rng() * H, 1 + rng() * 3, TILE.ROCK, 0.7);
    const cave = zones.find(z => z.id === 'cave');
    if (cave) {
      for (let i = 0; i < 50; i++) {
        blob((cave.rect.x + rng() * cave.rect.w) / ts, (cave.rect.y + rng() * cave.rect.h) / ts, 1 + rng() * 3, TILE.ROCK, 0.8);
      }
    }

    // Sebar objek: jarangkan pohon/batu supaya tidak rapat bertumpuk.
    const kept = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = this.tiles[this.idx(x, y)];
        if (t !== TILE.TREE && t !== TILE.ROCK) continue;
        const s = t === TILE.ROCK ? 3 : 2;
        let ok = rng() < 0.6;
        for (let dy = -s; dy <= s && ok; dy++) {
          for (let dx = -s; dx <= s; dx++) {
            const nx = x + dx, ny = y + dy;
            if (this.inBounds(nx, ny) && kept[this.idx(nx, ny)]) { ok = false; break; }
          }
        }
        if (ok) kept[this.idx(x, y)] = 1;
        else this.tiles[this.idx(x, y)] = this.ground[this.idx(x, y)];
      }
    }

    // Keep the world border walkable.
    for (let x = 0; x < W; x++) { this.tiles[this.idx(x, 0)] = this.ground[this.idx(x, 0)]; this.tiles[this.idx(x, H - 1)] = this.ground[this.idx(x, H - 1)]; }
    for (let y = 0; y < H; y++) { this.tiles[this.idx(0, y)] = this.ground[this.idx(0, y)]; this.tiles[this.idx(W - 1, y)] = this.ground[this.idx(W - 1, y)]; }

    // Laut di sisi timur: hanya bisa diseberangi dengan berenang.
    const shoreBase = Math.floor(W * 0.78);
    for (let y = 0; y < H; y++) {
      const shore = shoreBase + Math.round(Math.sin(y * 0.09) * 4 + Math.sin(y * 0.031) * 7);
      for (let x = shore; x < W; x++) this.tiles[this.idx(x, y)] = TILE.WATER;
    }
    // Pulau kecil di tengah laut.
    const ix = Math.floor(W * 0.9), iy = Math.floor(H * 0.5);
    for (let y = iy - 8; y <= iy + 8; y++) {
      for (let x = ix - 8; x <= ix + 8; x++) {
        if (this.inBounds(x, y) && Math.hypot(x - ix, y - iy) < 6.5) this.tiles[this.idx(x, y)] = TILE.SAND;
      }
    }

    // Town square around spawn: cleared, with sand paths in a cross.
    const sx = config.world.spawn.x / ts, sy = config.world.spawn.y / ts;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - sx, y - sy);
        if (d < 10) this.tiles[this.idx(x, y)] = d < 3.2 ? TILE.PATH : TILE.GRASS;
        if ((Math.abs(x - sx) < 1.2 && d < 14) || (Math.abs(y - sy) < 1.2 && d < 14)) this.tiles[this.idx(x, y)] = TILE.PATH;
      }
    }

    // Clear a landing area around each boss spawn.
    const { bosses } = require('./data');
    for (const b of Object.values(bosses)) {
      const bx = b.pos.x / ts, by = b.pos.y / ts;
      for (let y = Math.floor(by - 7); y <= by + 7; y++) {
        for (let x = Math.floor(bx - 7); x <= bx + 7; x++) {
          if (!this.inBounds(x, y)) continue;
          if (Math.hypot(x - bx, y - by) < 7) this.tiles[this.idx(x, y)] = this.ground[this.idx(x, y)];
        }
      }
    }
  }

  // swim=true: air tidak menghalangi (dipakai player dan proyektil).
  tileBlocked(tx, ty, swim) {
    if (!this.inBounds(tx, ty)) return true;
    const t = this.tiles[this.idx(tx, ty)];
    if (swim && t === TILE.WATER) return false;
    return BLOCKS[t];
  }

  circleBlocked(x, y, r, swim) {
    if (x - r < 0 || y - r < 0 || x + r > this.pxW || y + r > this.pxH) return true;
    const ts = this.ts;
    const x0 = Math.floor((x - r) / ts), x1 = Math.floor((x + r) / ts);
    const y0 = Math.floor((y - r) / ts), y1 = Math.floor((y + r) / ts);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.tileBlocked(tx, ty, swim)) continue;
        if (circleHitsRect(x, y, r, tx * ts, ty * ts, ts, ts)) return true;
      }
    }
    return false;
  }

  // Axis-separated movement so entities slide along obstacles.
  moveCircle(x, y, dx, dy, r, swim) {
    let nx = x, ny = y;
    if (dx !== 0 && !this.circleBlocked(x + dx, y, r, swim)) nx = x + dx;
    if (dy !== 0 && !this.circleBlocked(nx, y + dy, r, swim)) ny = y + dy;
    return { x: nx, y: ny, blocked: (dx !== 0 && nx === x) || (dy !== 0 && ny === y) };
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

  // Cari titik bebas terdekat (spiral keluar dari x,y). Titik air dianggap bebas untuk player (swim).
  nearestFree(x, y, r, swim, maxR) {
    if (!this.circleBlocked(x, y, r, swim)) return { x, y };
    const lim = maxR || 480;
    for (let d = 8; d <= lim; d += 8) {
      const n = Math.max(8, Math.round((Math.PI * 2 * d) / 12));
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n;
        const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        if (!this.circleBlocked(px, py, r, swim)) return { x: px, y: py };
      }
    }
    return null;
  }

  findFreePoint(x, y, r, spread, tries) {
    for (let i = 0; i < (tries || 30); i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * spread;
      const px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
      if (!this.circleBlocked(px, py, r)) return { x: px, y: py };
    }
    return null;
  }

  randomFreePointInRect(rect, r, tries) {
    for (let i = 0; i < (tries || 20); i++) {
      const px = rect.x + Math.random() * rect.w, py = rect.y + Math.random() * rect.h;
      if (!this.circleBlocked(px, py, r)) return { x: px, y: py };
    }
    return null;
  }
}

module.exports = { World, TILE };
