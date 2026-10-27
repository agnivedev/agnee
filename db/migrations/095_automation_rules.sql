-- Aturan otomasi per company (pemicu -> aksi), dibuat lewat Latih AI atau layar
-- Pengaturan. Pemicu dan aksi disimpan sebagai JSON dan divalidasi di kode
-- (src/automation.js); tabel ini tidak perlu berubah saat jenis pemicu atau
-- aksi bertambah. Tidak ada aksi yang mengirim pesan ke customer.
CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- {"type":"keyword","words":["grosir"]} atau {"type":"new_chat"}
  trigger JSONB NOT NULL,
  -- [{"type":"set_pipeline_stage","stage":"hot"}, {"type":"assign_to_user","userId":"..."}]
  actions JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Jam sebelum aturan yang sama boleh memicu chat yang sama lagi; 0 = tiap pesan.
  cooldown_hours INTEGER NOT NULL DEFAULT 24 CHECK (cooldown_hours BETWEEN 0 AND 720),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS automation_rules_company_idx ON automation_rules (company_id, created_at);

-- Catatan tiap pemicuan: dasar jeda ulang dan jejak "kenapa chat ini pindah".
CREATE TABLE IF NOT EXISTS automation_runs (
  id BIGSERIAL PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  results JSONB
);

CREATE INDEX IF NOT EXISTS automation_runs_rule_chat_idx ON automation_runs (rule_id, chat_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_company_idx ON automation_runs (company_id, ran_at DESC);
