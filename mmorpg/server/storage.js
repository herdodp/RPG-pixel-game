'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SAVE_DIR = path.join(__dirname, '..', 'save');
const FILE = path.join(SAVE_DIR, 'accounts.json');
const TMP = FILE + '.tmp';

class Storage {
  constructor() {
    this.accounts = {};
    this.dirty = false;
    if (!fs.existsSync(SAVE_DIR)) fs.mkdirSync(SAVE_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      try {
        this.accounts = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      } catch (e) {
        // Keep the broken file for inspection and start clean instead of crashing.
        try { fs.copyFileSync(FILE, FILE + '.corrupt-' + Date.now()); } catch (e2) { /* ignore */ }
        console.error('accounts.json rusak, dicadangkan dan dimulai ulang:', e.message);
        this.accounts = {};
      }
    }
  }

  static key(name) { return String(name || '').trim().toLowerCase(); }

  static validName(name) { return /^[A-Za-z0-9_]{3,16}$/.test(String(name || '')); }

  static hash(password, salt) {
    return crypto.scryptSync(String(password), salt, 32).toString('hex');
  }

  exists(name) { return !!this.accounts[Storage.key(name)]; }

  register(name, password, charData) {
    const k = Storage.key(name);
    if (this.accounts[k]) return null;
    const salt = crypto.randomBytes(16).toString('hex');
    this.accounts[k] = { name: String(name).trim(), salt, hash: Storage.hash(password, salt), createdAt: Date.now(), character: charData };
    this.dirty = true;
    this.flush();
    return this.accounts[k];
  }

  verify(name, password) {
    const a = this.accounts[Storage.key(name)];
    if (!a) return null;
    const h = Buffer.from(Storage.hash(password, a.salt), 'hex');
    const exp = Buffer.from(a.hash, 'hex');
    if (h.length !== exp.length || !crypto.timingSafeEqual(h, exp)) return null;
    return a;
  }

  saveCharacter(name, charData) {
    const a = this.accounts[Storage.key(name)];
    if (!a) return;
    a.character = charData;
    this.dirty = true;
  }

  // Atomic write: temp file first, then rename over the real file.
  flush() {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(TMP, JSON.stringify(this.accounts));
      fs.renameSync(TMP, FILE);
      this.dirty = false;
    } catch (e) {
      console.error('Gagal menyimpan akun:', e.message);
    }
  }

  leaderboard(limit) {
    return Object.values(this.accounts)
      .filter(a => a.character)
      .map(a => ({ name: a.character.name, cls: a.character.cls, lv: a.character.level, kills: a.character.kills || 0 }))
      .sort((x, y) => y.lv - x.lv || y.kills - x.kills)
      .slice(0, limit || 10);
  }
}

module.exports = { Storage };
