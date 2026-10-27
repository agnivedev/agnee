-- Katalog dari Mayar: produk dan paket yang dijual lewat Mayar (webinar, ebook,
-- link pembayaran, langganan) ikut masuk katalog dengan source 'mayar', supaya
-- AI bisa menyebut harga dan memberi link beli, sama seperti item DealPOS.
--
-- `url` = link checkout/halaman produk. Milik sumbernya: ditimpa tiap sinkron.
-- Item manual boleh kosong. Nomor 085 sengaja melompati 082-084 (dipakai
-- cabang lain yang belum masuk main).
ALTER TABLE catalog_items DROP CONSTRAINT IF EXISTS catalog_items_source_check;
ALTER TABLE catalog_items ADD CONSTRAINT catalog_items_source_check
  CHECK (source IN ('manual', 'dealpos', 'mayar'));
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS url TEXT;
