# SSB Great Ark — backend online + client integration

Identitas: hitam premium, emas-putih. Arsitektur: Website/PWA + Android Flutter → HTTPS REST API → PostgreSQL terpusat.

> Penting: kode ini sudah disiapkan untuk koneksi online, tetapi belum dapat tersambung ke database publik sampai pemilik proyek membuat database dan server, lalu mengisi URL/kredensialnya. Jangan mengirimkan password database atau JWT secret di chat atau ke aplikasi klien.

## A. Siapkan database PostgreSQL online

Buat PostgreSQL database di penyedia yang Anda pilih (misalnya Neon, Supabase Database, atau PostgreSQL terkelola). Salin connection string dari dashboard penyedia. Untuk layanan yang mewajibkan TLS, gunakan `DATABASE_SSL=true`.

Jalankan skema di `backend/sql/schema.sql` pada database baru. Contoh melalui terminal:

```bash
psql "$DATABASE_URL" -f backend/sql/schema.sql
```

## B. Deploy REST API

Deploy folder `backend/` sebagai Node.js web service (misalnya Render atau Railway), gunakan Node.js 20+ dan perintah start `npm start`. Atur environment variables di dashboard hosting:

- `DATABASE_URL` = connection string database online
- `DATABASE_SSL` = `true` bila penyedia database memerlukan TLS
- `JWT_SECRET` = string acak rahasia minimal 32 karakter
- `WEB_ORIGIN` = URL website yang sudah di-host melalui HTTPS; beberapa origin boleh dipisahkan koma
- `PORT` biasanya diisi otomatis oleh platform hosting

Setelah deploy, buka `https://URL-API-ANDA/api/health`. Hasil yang diharapkan: `{"ok":true,"service":"ssb-great-ark-api","database":"connected"}`.

## C. Buat akun admin pertama

Jalankan sekali dari terminal/console yang memiliki akses ke environment API dan database:

```bash
cd backend
npm install
node src/create-admin.js "Admin Great Ark" admin@domainanda.id "GantiDenganPasswordKuat12!"
```

Pilih password unik dan jangan gunakan contoh password di atas. Akun pelatih dan orang tua dapat dibuat setelah alur provisioning akun dan relasi pemain ditetapkan. Jangan membuka database langsung ke browser/mobile.

## D. Hubungkan website

1. Host folder `web/` sebagai static site dengan HTTPS (contoh Cloudflare Pages, Netlify, atau layanan static hosting lain).
2. Buka website, tekan **Hubungkan Online** di bagian atas.
3. Masukkan URL API HTTPS dan akun admin yang sudah dibuat.
4. Website akan mencoba memuat data dari API. Data yang ditambahkan atau diedit akan dikirim ke API untuk modul yang sudah dipetakan.

Catatan: data contoh yang sudah tersimpan di `localStorage` tidak otomatis diimpor ke database. Ekspor/bersihkan data demo terlebih dahulu; buat data awal di mode online agar tidak tercampur dengan contoh lokal. Untuk data absensi, iuran, dan penilaian, pemain harus sudah ada di database.

## E. Hubungkan aplikasi Android

Persyaratan: Flutter SDK, Android SDK, dan perangkat/emulator Android. Di folder `android/`:

```bash
flutter pub get
flutter run --dart-define=API_BASE_URL=https://URL-API-ANDA
```

Untuk APK release:

```bash
flutter build apk --release --dart-define=API_BASE_URL=https://URL-API-ANDA
```

URL API wajib HTTPS dan bukan `localhost` saat aplikasi dijalankan di ponsel. Aplikasi Android starter ini memiliki login, penyimpanan token menggunakan secure storage, serta membaca jadwal, pemain, dan pengumuman dari API. Halaman CRUD admin penuh, alur lupa password, dan build APK bertanda tangan untuk rilis masih perlu dikerjakan.

## Modul API

- `POST /api/auth/login`
- `GET /api/health`
- `GET /api/dashboard`
- Resource `GET/POST/PUT/DELETE`: `/api/players`, `/api/coaches`, `/api/attendance`, `/api/schedule`, `/api/fees`, `/api/registration`, `/api/matches`, `/api/development`, `/api/notifications`

Login menerima `{ "email": "...", "password": "..." }`. Endpoint privat memerlukan header `Authorization: Bearer <token>`.

## Catatan keamanan dan pekerjaan sebelum produksi

- Backend memakai hash password bcrypt, JWT, CORS, Helmet, parameter query SQL, dan pemeriksaan role dasar.
- Atur CORS hanya ke origin web resmi; pakai HTTPS, password admin kuat, backup otomatis, monitoring, dan rotasi secret.
- Sebelum digunakan untuk data anak sungguhan, lengkapi otorisasi per record (orang tua hanya melihat anak yang terhubung; pelatih hanya kelompok binaannya), audit log, rate limit, reset password, verifikasi kontak, dan uji keamanan.
- Hubungkan orang tua ke `players.parent_user_id` melalui proses admin yang terverifikasi. Jangan membiarkan pengguna memilih ID pemain orang lain.
- Integrasi WhatsApp belum aktif; gunakan WhatsApp Business Platform/API resmi dan simpan kredensial hanya di backend.
- Status iuran saat ini adalah catatan administrasi, bukan pembayaran online. Gateway pembayaran memerlukan integrasi dan verifikasi webhook tersendiri.
- Jalankan `npm audit` dan uji semua endpoint di staging sebelum membuka akses ke pengguna.
