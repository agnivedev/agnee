-- Daftar periksa onboarding kembali dipasang di versi React (3 Okt 2026).
-- Sejak migrasi ke React tidak ada yang memanggil POST /v1/auth/onboarded,
-- jadi hampir semua akun yang sudah lama berjalan masih onboarded_at NULL.
-- Mereka sudah tersetel; tanpa baris ini semuanya disambut wizard "mulai di
-- sini" pada login berikutnya. Hanya akun yang dibuat SETELAH migrasi ini
-- yang melihatnya.
UPDATE users SET onboarded_at = NOW() WHERE onboarded_at IS NULL;
