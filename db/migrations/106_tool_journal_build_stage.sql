-- Jurnal panggilan alat AI per chat (untuk baris "Sudah dicek" di pertanyaan ke departemen) dan
-- tebakan tahap pembangunan per chat (asumsi Agnes, bisa dikoreksi Management).
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  query TEXT,
  result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_tool_calls_chat_idx ON ai_tool_calls (company_id, chat_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_build_stage (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  stage SMALLINT CHECK (stage IS NULL OR stage BETWEEN 1 AND 6),
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'agnes' CHECK (source IN ('agnes', 'management')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id)
);
