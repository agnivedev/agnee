-- Integrasi Lalamove per company: kunci Partner API v3 (bukan login aplikasi
-- Lalamove). Pola yang sama dengan dealpos_connections: API secret dienkripsi
-- pgcrypto, tidak pernah dikembalikan ke browser.
CREATE TABLE IF NOT EXISTS lalamove_connections (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  -- sandbox = host uji, order tidak memanggil kurir sungguhan.
  environment TEXT NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  market TEXT NOT NULL DEFAULT 'ID',
  api_key TEXT NOT NULL,
  api_secret_enc BYTEA NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  -- Kota yang dilayani dan jenis kendaraannya, dari GET /v3/cities saat
  -- kunci terakhir diperiksa: [{ locode, name, services: [{ key, description }] }].
  cities JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
