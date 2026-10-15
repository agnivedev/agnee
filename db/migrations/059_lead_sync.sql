-- Sinkronisasi dua arah lead antara Agnee dan pihak ketiga.
--
-- updated_at: kapan profil lead berubah (kiriman ulang yang berbeda, verifikasi,
-- konfirmasi terkirim). Pihak ketiga menarik perubahan sejak kursor terakhirnya
-- lewat GET /webhook/company/<slug>/leads; tahap pipeline dari lead_states ikut
-- dihitung saat menentukan "baru berubah".
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS website_leads_sync_idx ON website_leads (company_id, updated_at, id);

-- Secret ketiga per company, khusus untuk menarik data (pull).
ALTER TABLE lead_webhooks ADD COLUMN IF NOT EXISTS pull_secret_enc BYTEA;
