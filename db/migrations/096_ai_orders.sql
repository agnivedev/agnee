-- Proforma dan invoice DealPOS yang dibuat AI dari percakapan (ESBEJE), plus
-- setelan per company. Saklar mati bawaan: tanpa dinyalakan supervisor, AI
-- tidak pernah menulis ke DealPOS atau memesan kurir.
ALTER TABLE dealpos_connections ADD COLUMN IF NOT EXISTS ai_orders_enabled BOOLEAN NOT NULL DEFAULT false;
-- Nilai bawaan dokumen penjualan: outlet (ID atau nama), tag, dan jenis pajak
-- sesuai yang dipakai kasir; DealPOS mewajibkannya di POST /Invoice dan /Estimate.
ALTER TABLE dealpos_connections ADD COLUMN IF NOT EXISTS order_outlet TEXT;
ALTER TABLE dealpos_connections ADD COLUMN IF NOT EXISTS order_tag TEXT;
ALTER TABLE dealpos_connections ADD COLUMN IF NOT EXISTS order_tax_type TEXT;
-- Kode varian "Ongkir" di DealPOS. Kosong = ongkir hanya ditulis di catatan invoice.
ALTER TABLE dealpos_connections ADD COLUMN IF NOT EXISTS shipping_variant_code TEXT;

CREATE TABLE IF NOT EXISTS ai_sales_documents (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('proforma', 'invoice')),
  dealpos_id TEXT,
  number TEXT NOT NULL,
  -- open: menunggu persetujuan customer; invoiced: sudah dijadikan invoice;
  -- superseded: digantikan proforma yang lebih baru.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'invoiced', 'superseded')),
  total NUMERIC(14, 2) NOT NULL,
  -- Barang, harga, ongkir, dan titik antar persis seperti yang dilihat customer;
  -- invoice dibuat dari sini, bukan dari ingatan model.
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_sales_documents_chat_idx ON ai_sales_documents (company_id, chat_id, created_at DESC);
