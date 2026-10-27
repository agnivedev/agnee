-- Ribbon yang mengikuti tag bawaan DealPOS: satu ribbon = satu nama tag POS.
-- Item yang memuat tag itu otomatis mendapat ribbon (pasangan 'auto').
ALTER TABLE catalog_tags ADD COLUMN IF NOT EXISTS pos_tag TEXT CHECK (pos_tag IS NULL OR btrim(pos_tag) <> '');
CREATE UNIQUE INDEX IF NOT EXISTS catalog_tags_company_pos_tag_idx
  ON catalog_tags (company_id, lower(btrim(pos_tag))) WHERE pos_tag IS NOT NULL;

-- Tag DealPOS ada di /Product/Detail (satu per produk, bukan per varian), jadi
-- varian menyimpan id produknya dan kapan tag-nya terakhir ditarik.
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS pos_product_id TEXT;
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS pos_tags_synced_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS catalog_items_pos_product_idx ON catalog_items (company_id, pos_product_id) WHERE pos_product_id IS NOT NULL;
