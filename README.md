# Zomfield

Game **survival zombie 2D pixel-art multiplayer** dengan simulasi yang diatur penuh oleh server (server-authoritative). Repo ini berisi dua game berbasis browser:

| Game | Folder | Port default | Perintah |
|------|--------|--------------|----------|
| **Zomfield**: survival zombie | `server/`, `public/`, `data/` | `3000` | `npm start` |
| **MMORPG**: RPG online | `mmorpg/` | `3100` | `npm run start:mmorpg` |

## Persyaratan

- [Node.js](https://nodejs.org/) versi 18 atau lebih baru
- npm (sudah termasuk bersama Node.js)

## Cara Memulai

```bash
# 1. Clone repo
git clone <url-repo-kamu>.git
cd zomfield

# 2. Install dependensi
npm install

# 3a. Jalankan Zomfield (game zombie)
npm start

# 3b. ATAU jalankan MMORPG
npm run start:mmorpg
```

Setelah server berjalan, buka browser ke:

- Zomfield: http://localhost:3000
- MMORPG: http://localhost:3100

Lalu masukkan nama (Zomfield) atau buat akun/login (MMORPG) dan mulai bermain. Untuk bermain bersama teman di jaringan yang sama, buka `http://<IP-komputer-host>:<port>`.

### Opsi Server

```bash
# Ganti port
PORT=8080 npm start            # Linux/macOS
set PORT=8080 && npm start     # Windows (cmd)

# Aktifkan mode wave (Zomfield)
npm start -- --waves
WAVES=1 npm start              # Linux/macOS
```

Cek status server lewat endpoint `/status` (contoh: http://localhost:3000/status).

---

## Zomfield: Survival Zombie

Bertahanlah di dunia penuh zombie bersama pemain lain (maksimal 16 pemain). Cari loot, kumpulkan bahan, buat senjata, dan bangun pertahanan.

### Fitur

- Multiplayer real-time lewat WebSocket, simulasi dijalankan di server
- Siklus siang dan malam: malam lebih gelap, jarak pandang menyempit
- Sistem bertahan hidup: lapar, haus, stamina, dan pendarahan
- Inventori 24 slot, loot, dan crafting
- Membangun struktur pertahanan (termasuk gerbang) dan memperbaikinya
- Berbagai jenis zombie
- **Mode Wave** (opsional): gelombang zombie yang makin kuat, dengan hadiah per wave dan boss berkala

### Kontrol

| Tombol | Fungsi |
|--------|--------|
| `W A S D` / Panah | Bergerak |
| `Shift` | Lari (sprint, memakai stamina) |
| Klik kiri | Menyerang (atau menaruh bangunan saat mode build) |
| Klik kanan | Batalkan bangunan yang dipilih |
| `1`-`9` / Scroll mouse | Pilih slot hotbar |
| `R` | Reload |
| `F` | Pakai item terpilih (makanan, minuman, medis) |
| `E` | Ambil loot terdekat |
| `Z` | Buang item terpilih |
| `Tab` | Buka/tutup inventori |
| `C` | Panel crafting |
| `B` | Panel membangun |
| `G` | Buka/tutup gerbang terdekat |
| `X` | Perbaiki bangunan yang rusak |
| `V` | Bongkar bangunan milikmu |
| `Esc` | Tutup panel / batalkan build |

---

## MMORPG

RPG online dengan dunia luas 7200x7200, hingga 100 pemain, quest, NPC, monster, dan raid boss. Progres akun tersimpan otomatis di server.

### Fitur

- Sistem akun (daftar dan login) dengan penyimpanan otomatis
- 5 kelas, masing-masing dengan 3 skill
- Level maksimal 50
- Quest, NPC, toko, dan item
- Monster dan **raid boss** dengan hadiah kontribusi
- Chat antar pemain
- Siklus siang dan malam

### Kelas

| Kelas | Peran |
|-------|-------|
| Prajurit | Petarung jarak dekat dengan HP dan pertahanan tinggi |
| Penyihir | Sihir area besar, tetapi rapuh |
| Pemanah | Serangan jarak jauh cepat dengan kritikal tinggi |
| Pendeta | Penyembuh party, juga bisa menyerang dengan sihir suci |
| Pembunuh | Serangan cepat dengan kritikal mematikan |

### Kontrol

| Tombol | Fungsi |
|--------|--------|
| `W A S D` / Panah | Bergerak |
| `Spasi` / Klik kiri | Serangan dasar |
| Klik kanan | Skill 1 |
| `1` `2` `3` | Gunakan skill |
| `Q` / `E` | Potion HP / MP |
| `F` | Interaksi (NPC, dll.) |
| `I` | Inventori |
| `J` | Quest |
| `K` | Skill |
| `P` | Profil |
| `L` | Papan peringkat |
| `M` | Peta dunia |
| `N` | Tampilkan/sembunyikan minimap |
| `T` | Auto-serang |
| `Enter` | Buka chat / kirim pesan |
| `Esc` | Tutup jendela |

---

## Struktur Proyek

```
zomfield/
â”œâ”€â”€ server/        # Server game zombie (logika game, zombie, loot, wave, dll.)
â”œâ”€â”€ public/        # Client game zombie (HTML + JS canvas)
â”œâ”€â”€ data/          # Data game zombie (senjata, zombie, resep, loot, config)
â”œâ”€â”€ mmorpg/
â”‚   â”œâ”€â”€ server/    # Server MMORPG
â”‚   â”œâ”€â”€ public/    # Client MMORPG
â”‚   â”œâ”€â”€ data/      # Kelas, item, monster, boss, quest, NPC, config
â”‚   â””â”€â”€ save/      # Data akun pemain (tidak ikut di-push)
â”œâ”€â”€ test/          # Smoke test
â””â”€â”€ package.json
```

## Konfigurasi

Pengaturan gameplay bisa diubah lewat file JSON tanpa menyentuh kode:

- Zomfield: `data/config.json` (port, jumlah pemain, kecepatan, laju lapar/haus, wave, dll.)
- MMORPG: `mmorpg/data/config.json` (port, ukuran dunia, XP, level maksimal, raid, dll.)

Untuk mengecek sintaks tanpa menjalankan server: `npm run check` atau `npm run check:mmorpg`.

## Teknologi

- Node.js + [`ws`](https://github.com/websockets/ws) (WebSocket)
- HTML5 Canvas (tanpa framework, tanpa build step)

## Lisensi

Belum ditentukan. Tambahkan file `LICENSE` sesuai kebutuhan.
