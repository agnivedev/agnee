-- Aturan promo per company (Pengaturan > Promo). Saat ini satu jenis:
-- 'free_shipping' (gratis ongkir untuk wilayah tertentu). Syarat dan wilayah
-- disimpan sebagai JSON supaya jenis promo lain bisa menyusul tanpa migrasi:
--   areas      [{ province, city, district }]  kosong = semua wilayah
--   conditions { minSubtotal, minQty, products: [kata kunci] }
-- max_subsidy = batas ongkir yang ditanggung toko (Rp); kosong = gratis penuh.
CREATE TABLE IF NOT EXISTS promo_rules (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'free_shipping' CHECK (kind IN ('free_shipping')),
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_subsidy NUMERIC(14, 0),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS promo_rules_company_idx ON promo_rules (company_id, kind);
