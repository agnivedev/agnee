-- Stok per varian dari DealPOS /Inventory (Available = OnHand - Allocated).
-- NULL = stok tidak diketahui (tidak terbaca atau varian tidak dipantau), BUKAN nol.
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS stock_available NUMERIC(14, 2);
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS stock_synced_at TIMESTAMPTZ;
ALTER TABLE dealpos_products ADD COLUMN IF NOT EXISTS stock_available NUMERIC(14, 2);
ALTER TABLE dealpos_products ADD COLUMN IF NOT EXISTS stock_synced_at TIMESTAMPTZ;
