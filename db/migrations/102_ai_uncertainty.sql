-- "Kalau tidak yakin, jangan menebak": mode per company dan jejak keputusannya.
--
-- uncertainty_guard: 'off' (penjaga mati), 'on' (bawaan: AI mengakui belum yakin
-- lalu bertanya ke customer/departemen atau memberi tahu staf, AI tetap
-- membalas), 'handoff' (seperti 'on', tetapi tanpa departemen yang tepat chat
-- diserahkan ke manusia).
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS uncertainty_guard TEXT NOT NULL DEFAULT 'on'
    CHECK (uncertainty_guard IN ('off', 'on', 'handoff'));

-- Tiap kali AI memilih tidak menebak: apa topiknya, sinyal apa yang
-- memicunya, tindakan apa yang diambil. Supervisor membacanya di Latih AI.
CREATE TABLE IF NOT EXISTS ai_uncertainty_events (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT,
  topic TEXT NOT NULL,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  action TEXT NOT NULL,
  department TEXT,
  customer_text TEXT,
  model_text TEXT,
  reply_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_uncertainty_events_company_idx
  ON ai_uncertainty_events (company_id, created_at DESC);
