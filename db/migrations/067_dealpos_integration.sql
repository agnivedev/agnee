-- Integrasi DealPOS per company + daftar tab integrasi yang dinyalakan di
-- Pengaturan > Integrasi.
--
-- Kredensial per company, pola yang sama dengan mayar_connections: client
-- secret dienkripsi pgcrypto, tidak pernah dikembalikan ke browser.
CREATE TABLE IF NOT EXISTS dealpos_connections (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  -- Host akun DealPOS, mis. esbeje.dealpos.co.id (bukan URL penuh).
  host TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_enc BYTEA NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Satu baris per customer DealPOS. Belum digabung ke Lead List: itu tahap
-- berikutnya (sumber lead ke-6), jadi tabel ini hanya menampung hasil tarikan.
CREATE TABLE IF NOT EXISTS dealpos_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  dealpos_customer_id TEXT NOT NULL,
  code TEXT,
  name TEXT,
  email TEXT,
  -- Format 62xxx, sama dengan mayar_leads.phone dan phone chat WhatsApp.
  phone TEXT,
  joined_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, dealpos_customer_id)
);

CREATE INDEX IF NOT EXISTS dealpos_customers_company_phone_idx
  ON dealpos_customers (company_id, phone);

-- Integrasi yang tabnya ditampilkan di Pengaturan, dibagi seluruh supervisor
-- company. Kuncinya bebas teks; server membatasi ke daftar yang dikenal.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS integration_tabs TEXT[] NOT NULL DEFAULT '{}';

-- Perusahaan yang sudah memakai sebuah integrasi tetap melihat tabnya: tanpa
-- ini, restrukturisasi menyembunyikan Mayar/Export/dst. dari mereka. MCP tidak
-- punya tabel koneksi, jadi dinyalakan untuk semua seperti sebelumnya.
-- Migrasi hanya berjalan sekali (schema_migrations), jadi ini tidak menimpa
-- saklar yang diubah sesudahnya.
UPDATE companies c SET integration_tabs = ARRAY_REMOVE(ARRAY[
  'mcp',
  CASE WHEN EXISTS (SELECT 1 FROM mayar_connections m WHERE m.company_id = c.id) THEN 'mayar' END,
  CASE WHEN EXISTS (SELECT 1 FROM onedrive_connections o WHERE o.company_id = c.id)
         OR EXISTS (SELECT 1 FROM gsheets_connections g WHERE g.company_id = c.id) THEN 'export' END,
  CASE WHEN EXISTS (SELECT 1 FROM lead_webhooks w WHERE w.company_id = c.id) THEN 'webhook' END,
  CASE WHEN EXISTS (SELECT 1 FROM external_sources s WHERE s.company_id = c.id) THEN 'sources' END
]::text[], NULL);
