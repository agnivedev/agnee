-- Saklar rotasi nomor per company.
--
-- Sebelum ini rotasi selalu hidup begitu sebuah company punya lebih dari satu
-- nomor aktif, tanpa cara mematikannya. Padahal ada saat orang memang ingin
-- semua percakapan baru keluar dari satu nomor saja — nomor kedua baru
-- dipasang dan belum mau dipakai, atau salah satu nomor sedang bermasalah di
-- sisi WhatsApp dan ingin diistirahatkan tanpa mencabutnya dari rotasi.
--
-- Default TRUE supaya perilaku company yang sudah ada tidak berubah diam-diam:
-- yang selama ini berotasi tetap berotasi.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS rotation_enabled BOOLEAN NOT NULL DEFAULT TRUE;
