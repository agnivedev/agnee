ALTER TABLE conversation_summaries
  ADD COLUMN IF NOT EXISTS qualification_stage TEXT
    CHECK (qualification_stage IN ('inbox', 'qualified')),
  ADD COLUMN IF NOT EXISTS qualification_score SMALLINT
    CHECK (qualification_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS qualification_title TEXT,
  ADD COLUMN IF NOT EXISTS qualification_detail TEXT,
  ADD COLUMN IF NOT EXISTS labels JSONB NOT NULL DEFAULT '[]'::jsonb;

