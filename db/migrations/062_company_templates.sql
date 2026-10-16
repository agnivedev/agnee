-- Template potret konfigurasi per company.
--
-- Menyimpan isi yang bisa dipakai ulang (playbook umum, fakta terjawab, brief,
-- departemen tanpa anggota, identitas AI). Tidak memuat nomor WhatsApp, data
-- customer, kredensial, atau kunci. Memasang template tidak pernah menghapus.

CREATE TABLE IF NOT EXISTS company_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sections    JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INTEGER NOT NULL DEFAULT 1,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS company_templates_company_name_key
  ON company_templates (company_id, lower(name));
