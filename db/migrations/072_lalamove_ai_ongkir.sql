-- Ongkir otomatis di chat: AI menghitung estimasi ongkir Lalamove dari lokasi
-- toko ke lokasi customer. Titik jemput disimpan sekali per company; kendaraan
-- bawaan dipakai bila AI tidak memilih sendiri. Mati secara bawaan: pemilik
-- yang menyalakan, dan di chat sungguhan hanya berlaku pada mode production
-- (harga sandbox bukan harga asli).
ALTER TABLE lalamove_connections
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS default_service TEXT,
  ADD COLUMN IF NOT EXISTS ai_quotes_enabled BOOLEAN NOT NULL DEFAULT FALSE;
