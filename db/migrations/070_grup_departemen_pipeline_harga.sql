-- Grup WhatsApp per departemen. Pertanyaan AI (cek stok, cek transfer, dst.)
-- dikirim ke anggota yang dipilih, ke grup ini, atau keduanya. Nomor WhatsApp
-- company harus menjadi anggota grupnya.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS whatsapp_group_id TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS whatsapp_group_name TEXT;

-- Id pesan (stanza) pemberitahuan di grup. Staf yang membalas dengan
-- "reply" ke pemberitahuan itu menjawab pertanyaannya langsung dari grup.
ALTER TABLE department_questions ADD COLUMN IF NOT EXISTS group_message_ids TEXT[] NOT NULL DEFAULT '{}';

-- Pipeline dipindah AI otomatis mengikuti isi chat (bukan lagi usulan yang
-- harus diterima). Alasannya disimpan supaya tim tahu kenapa kartu pindah.
ALTER TABLE lead_states ADD COLUMN IF NOT EXISTS pipeline_stage_reason TEXT;

-- Harga jual dari DealPOS (varian aktif berharga), ditarik berkala. AI hanya
-- menerima varian yang cocok dengan percakapan, bukan seluruh katalog.
CREATE TABLE IF NOT EXISTS dealpos_products (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT,
  unit_price NUMERIC(14, 2) NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, variant_id)
);
ALTER TABLE dealpos_connections ADD COLUMN IF NOT EXISTS products_synced_at TIMESTAMPTZ;
ALTER TABLE dealpos_connections ADD COLUMN IF NOT EXISTS products_error TEXT;
