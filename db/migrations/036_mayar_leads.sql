-- Integrasi Mayar per company — lead/customer yang datang dari Mayar
-- (webinar, ebook, payment link) tapi belum tentu pernah chat WhatsApp.
--
-- Kredensial disimpan PER COMPANY, pola yang sama dengan onedrive_connections
-- dan gsheets_connections: satu supervisor connect sekali, seluruh tim
-- company itu otomatis kebagian datanya. Tidak pernah jadi konfigurasi
-- global — company lain tidak boleh ikut melihat data Mayar company ini.
CREATE TABLE IF NOT EXISTS mayar_connections (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  api_key_enc BYTEA NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Satu baris per CUSTOMER Mayar (bukan per transaksi) — ringkasan hasil
-- agregasi transaksi mereka, supaya Lead List tetap "satu baris per orang".
CREATE TABLE IF NOT EXISTS mayar_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  mayar_customer_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  -- Dinormalisasi ke format 62xxx (tanpa '0' depan, tanpa '+', tanpa '@...'),
  -- SAMA PERSIS dengan cara `listContactExportRows` menurunkan `phone` dari
  -- chat_id WhatsApp (regexp_replace(chat_id, '@.*$', '')). Tanpa kesamaan
  -- format ini, penggabungan baris Mayar+WhatsApp yang bernomor sama tidak
  -- akan pernah cocok.
  phone TEXT,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  products TEXT,
  last_transaction_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, mayar_customer_id)
);

CREATE INDEX IF NOT EXISTS mayar_leads_company_phone_idx
  ON mayar_leads (company_id, phone);
