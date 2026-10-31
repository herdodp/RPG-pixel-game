'use strict';

let _id = 0;
const nextId = () => ++_id;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(min, max, rng) {
  const r = rng || Math.random;
  return Math.floor(r() * (max - min + 1)) + min;
}

function randRange(min, max, rng) {
  const r = rng || Math.random;
  return min + r() * (max - min);
}

// weights: { key: weight }. Returns a key, or null if empty.
function weightedPick(weights, rng) {
  const r = rng || Math.random;
  let total = 0;
  for (const w of Object.values(weights)) total += w;
  if (total <= 0) return null;
  let x = r() * total;
  for (const [k, w] of Object.entries(weights)) {
    x -= w;
    if (x <= 0) return k;
  }
  return Object.keys(weights)[0];
}

// Smallest signed difference between two angles (radians).
function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

module.exports = { nextId, clamp, dist, dist2, makeRng, randInt, randRange, weightedPick, angleDiff };
