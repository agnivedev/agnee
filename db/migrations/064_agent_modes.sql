-- Mode agent per nomor WhatsApp.
--
-- Satu company boleh punya banyak nomor (semuanya dalam SATU paket), dan tiap
-- nomor punya peran: sales, CS, atau operasi antar-departemen (melayani anggota
-- internal dan supplier, bukan customer). 'standard' adalah perilaku sebelum
-- fitur ini ada, jadi nomor yang sudah berjalan tidak berubah sama sekali.
ALTER TABLE whatsapp_connections
  ADD COLUMN IF NOT EXISTS agent_mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE whatsapp_connections DROP CONSTRAINT IF EXISTS whatsapp_connections_agent_mode_check;
ALTER TABLE whatsapp_connections ADD CONSTRAINT whatsapp_connections_agent_mode_check
  CHECK (agent_mode IN ('standard', 'sales', 'cs', 'internal_ops'));

-- Panduan tambahan per mode, dikelola supervisor. Kosong/tidak ada baris =
-- pakai panduan bawaan Agnee untuk mode itu. Per company, bukan per nomor:
-- beberapa nomor dengan mode yang sama berbagi panduan yang sama.
CREATE TABLE IF NOT EXISTS agent_mode_instructions (
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('sales', 'cs', 'internal_ops')),
  instructions TEXT NOT NULL DEFAULT '',
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, mode)
);
