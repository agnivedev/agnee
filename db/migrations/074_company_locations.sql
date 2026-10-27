-- Lokasi fisik company: toko dan gudang, diatur di Pengaturan > Lokasi.
-- Satu tempat untuk semua yang butuh alamat: titik jemput kurir (Lalamove
-- dan kurir lain kelak), jawaban AI soal alamat dan jam buka, toko terdekat.
-- Titik peta wajib (lat/lng): lokasi tanpa pin tidak bisa jadi titik jemput
-- atau dihitung jaraknya.
CREATE TABLE IF NOT EXISTS company_locations (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'store' CHECK (kind IN ('store', 'warehouse')),
  address TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  maps_url TEXT,
  -- Penanggung jawab: nama dan nomor pengirim saat kurir dipesan.
  contact_name TEXT,
  contact_phone TEXT,
  opening_hours TEXT,
  -- Gudang biasanya tidak menerima customer datang langsung.
  open_to_customers BOOLEAN NOT NULL DEFAULT TRUE,
  -- Titik jemput pengiriman. Paling banyak satu per company.
  is_pickup BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS company_locations_company_idx ON company_locations (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS company_locations_one_pickup ON company_locations (company_id) WHERE is_pickup;

-- Titik jemput yang dulu disimpan di lalamove_connections (migrasi 072) pindah
-- ke sini. Kolom lamanya dibiarkan tetapi tidak dibaca lagi.
INSERT INTO company_locations (company_id, name, kind, address, lat, lng, maps_url, is_pickup)
SELECT company_id, 'Toko', 'store', COALESCE(pickup_address, ''), pickup_lat, pickup_lng,
       'https://www.google.com/maps?q=' || pickup_lat || ',' || pickup_lng, TRUE
FROM lalamove_connections
WHERE pickup_lat IS NOT NULL AND pickup_lng IS NOT NULL
ON CONFLICT DO NOTHING;
