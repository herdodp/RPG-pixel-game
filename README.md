# RPG Pixel Game

**MMORPG 2D pixel-art online berbasis browser.** Dunia dan semua perhitungan game dijalankan oleh server (server-authoritative), sehingga banyak pemain bisa bermain bersama secara real-time lewat WebSocket.

## Fitur

- Sistem akun (daftar dan login) dengan penyimpanan progres otomatis di server
- 5 kelas, masing-masing punya 3 skill: Prajurit, Penyihir, Pemanah, Pendeta, Pembunuh
- Dunia luas 7200x7200, hingga 100 pemain sekaligus
- Level maksimal 50
- Quest, NPC, toko, dan item
- Monster dan **raid boss** dengan hadiah berdasarkan kontribusi
- Chat antar pemain
- Siklus siang dan malam

## Kelas

| Kelas | Peran |
|-------|-------|
| Prajurit | Petarung jarak dekat dengan HP dan pertahanan tinggi |
| Penyihir | Sihir area besar, tetapi rapuh |
| Pemanah | Serangan jarak jauh cepat dengan kritikal tinggi |
| Pendeta | Penyembuh party, juga bisa menyerang dengan sihir suci |
| Pembunuh | Serangan cepat dengan kritikal mematikan |

## Persyaratan

- [Node.js](https://nodejs.org/) (disarankan versi LTS terbaru)
- npm (sudah termasuk bersama Node.js)

## Cara Memulai

```bash
# 1. Clone repo
git clone https://github.com/herdodp/RPG-pixel-game.git
cd RPG-pixel-game

# 2. Install dependensi
npm install

# 3. Jalankan server
npm start
```

Buka browser ke **http://localhost:3100**, buat akun baru, pilih kelas, lalu mulai bermain.

Untuk bermain bersama teman di jaringan yang sama, buka `http://<IP-komputer-host>:3100`.

### Opsi Server

```bash
# Ganti port (default 3100)
PORT=8080 npm start            # Linux/macOS
set PORT=8080 && npm start     # Windows (cmd)
```

Cek status server lewat `http://localhost:3100/status`.

## Kontrol

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

## Struktur Proyek

```
RPG-pixel-game/
â”œâ”€â”€ mmorpg/
â”‚   â”œâ”€â”€ server/    # Logika server (game, dunia, karakter, combat, monster, boss)
â”‚   â”œâ”€â”€ public/    # Client browser (HTML + JS canvas)
â”‚   â”œâ”€â”€ data/      # Kelas, item, monster, boss, quest, NPC, config
â”‚   â””â”€â”€ save/      # Data akun pemain (tidak ikut di-push)
â””â”€â”€ package.json
```

## Konfigurasi

Pengaturan game bisa diubah lewat `mmorpg/data/config.json` tanpa menyentuh kode: port, ukuran dunia, kecepatan, XP, level maksimal, jumlah pemain, pengaturan raid, dan lainnya.

Untuk mengecek sintaks tanpa menjalankan server: `npm run check`.

## Teknologi

- Node.js + [`ws`](https://github.com/websockets/ws) (WebSocket)
- HTML5 Canvas (tanpa framework, tanpa build step)

## Lisensi

Belum ditentukan. Tambahkan file `LICENSE` sesuai kebutuhan.
