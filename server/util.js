'use strict';

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function normalize(x, y) {
  const l = Math.hypot(x, y);
  return l === 0 ? { x: 0, y: 0 } : { x: x / l, y: y / l };
}

// Deterministic RNG (mulberry32) used for world generation.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(min, max, rng) {
  const r = rng || Math.random;
  return min + r() * (max - min);
}

function randInt(min, max, rng) {
  const r = rng || Math.random;
  return Math.floor(min + r() * (max - min + 1));
}

// weights: { key: weight }. Returns a key, or null if empty.
function weightedPick(weights, rng) {
  const r = rng || Math.random;
  let total = 0;
  for (const w of Object.values(weights)) total += w;
  if (total <= 0) return null;
  let roll = r() * total;
  for (const [key, w] of Object.entries(weights)) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return Object.keys(weights)[0];
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let idCounter = 1;
function nextId() {
  return idCounter++;
}

module.exports = {
  clamp,
  dist,
  dist2,
  normalize,
  makeRng,
  randRange,
  randInt,
  weightedPick,
  angleDiff,
  nextId
};
