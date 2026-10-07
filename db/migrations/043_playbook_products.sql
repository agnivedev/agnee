-- Playbook per produk.
--
-- Satu company bisa menjual beberapa layanan yang cara bicaranya berbeda.
-- Beweix Digital misalnya melayani AI CGI, ads optimization, dan viral content.
-- Satu set playbook untuk semuanya membuat AI mencampur aturan: harga, alur
-- discovery, dan keberatan milik produk A terbaca saat customer bertanya B.
--
-- Bentuknya:
--   playbook_products  : daftar produk per company.
--   playbook_docs      : product_id NULL = playbook umum (berlaku untuk semua
--                        produk, perilaku lama); terisi = khusus produk itu.
--   chat_products      : produk yang sedang dibahas tiap percakapan, supaya
--                        AI hanya membaca playbook produk itu.

CREATE TABLE IF NOT EXISTS playbook_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  -- Dibaca AI untuk menebak produk mana yang dibahas customer, dan ditampilkan
  -- sebagai katalog saat percakapan belum jelas. Tulis seperti menjelaskan
  -- produknya ke orang baru dalam satu-dua kalimat.
  description TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Target foreign key komposit di bawah: dengan (company_id, id), database
  -- sendiri yang menolak dokumen atau chat company A menunjuk produk company B.
  UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS playbook_products_company_name_idx
  ON playbook_products (company_id, lower(btrim(name)));

ALTER TABLE playbook_docs ADD COLUMN IF NOT EXISTS product_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playbook_docs_product_fk'
  ) THEN
    ALTER TABLE playbook_docs
      ADD CONSTRAINT playbook_docs_product_fk
      FOREIGN KEY (company_id, product_id)
      REFERENCES playbook_products (company_id, id) ON DELETE CASCADE;
  END IF;
END
$$;

-- Satu dokumen per (company, produk, jenis). NULLS NOT DISTINCT membuat
-- playbook umum (product_id NULL) tetap satu per jenis, persis seperti index
-- lama. Tanpa itu dua baris NULL dianggap berbeda dan upsert menggandakan.
CREATE UNIQUE INDEX IF NOT EXISTS playbook_docs_company_product_kind_idx
  ON playbook_docs (company_id, product_id, kind) NULLS NOT DISTINCT;
DROP INDEX IF EXISTS playbook_docs_company_kind_idx;

CREATE TABLE IF NOT EXISTS chat_products (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  product_id UUID NOT NULL,
  -- 'auto' = ditebak dari pesan customer, boleh berpindah kalau customer jelas
  -- menyebut produk lain. 'manual' = dipilih tim di inbox, tidak pernah ditimpa
  -- tebakan.
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id),
  FOREIGN KEY (company_id, product_id)
    REFERENCES playbook_products (company_id, id) ON DELETE CASCADE
);
