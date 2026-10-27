-- Outlet DealPOS terhubung ke Lokasi (toko/gudang), dan merek + tag bawaan
-- DealPOS per item katalog. Outlet DealPOS (/Outlet) hanya berisi ID, nama,
-- dan kode, tanpa alamat atau titik peta, jadi Lokasi tetap sumber alamat;
-- yang disimpan di sini hanya penghubungnya.
ALTER TABLE company_locations ADD COLUMN IF NOT EXISTS dealpos_outlet_id TEXT;
ALTER TABLE company_locations ADD COLUMN IF NOT EXISTS dealpos_outlet_name TEXT;

-- Merek dan tag dari /Product/Detail, hanya terisi untuk item yang ditarik
-- detailnya (Best Seller dan Promo): satu permintaan per produk di API
-- ber-rate-limit tidak mungkin untuk ribuan varian.
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS pos_tags TEXT[] NOT NULL DEFAULT '{}';

-- Satuan (UOM) dan merek per varian dari /Variant/Detail, satu permintaan per
-- varian; diisi bertahap oleh pekerjaan latar. NULL = belum pernah ditarik.
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS detail_synced_at TIMESTAMPTZ;
