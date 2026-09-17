-- Peran platform: staf Agnive yang mengelola SEMUA tenant.
--
-- Sampai sekarang peran tertinggi di sistem ini adalah 'owner' di
-- company_members — dan itu peran PELANGGAN atas perusahaannya sendiri.
-- Tidak ada satu pun cara menyatakan "orang ini di atas semua company",
-- sehingga setiap pertanyaan operasional kita (tenant mana yang trialnya
-- habis besok, siapa yang plafon AI-nya mepet) hanya bisa dijawab dengan
-- membuka psql.
--
-- Bendera ini sengaja TIDAK diletakkan di company_members: peran di sana
-- selalu berpasangan dengan satu company, dan menaruhnya di situ berarti
-- seorang superadmin harus "anggota" sebuah tenant untuk berkuasa atas
-- tenant lain. Ia milik orangnya, bukan milik keanggotaannya.
--
-- Cara memberikannya: scripts/grant-platform-admin.js — bukan lewat UI mana
-- pun. Tidak ada halaman yang bisa mengangkat superadmin baru, jadi bug di
-- halaman mana pun tidak bisa berujung pada eskalasi ke peran ini.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Barisnya akan selalu segelintir. Index ini bukan untuk kecepatan, melainkan
-- supaya "siapa saja yang punya akses lintas tenant" adalah satu pembacaan
-- murah yang bisa dijalankan kapan saja saat audit.
CREATE INDEX IF NOT EXISTS users_platform_admin_idx
  ON users (email) WHERE is_platform_admin;
