-- Skor keyakinan balasan AI, tahap shadow: hanya dicatat untuk kalibrasi ambang,
-- tidak mengubah balasan. Lihat src/confidence-score.js.
CREATE TABLE IF NOT EXISTS ai_confidence_scores (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT,
  score SMALLINT NOT NULL,
  band TEXT NOT NULL CHECK (band IN ('send', 'safe', 'hold')),
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  topic TEXT,
  guard_unsure BOOLEAN NOT NULL DEFAULT FALSE,
  customer_text TEXT,
  reply_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_confidence_scores_company_idx
  ON ai_confidence_scores (company_id, created_at DESC);
