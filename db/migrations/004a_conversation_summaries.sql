-- conversation_summaries existed in the running database before this repo tracked
-- its schema (it was created by hand, not by a migration). Migration 005 already
-- ALTERs it, so this must sort and run before 005 on any fresh install.
CREATE TABLE IF NOT EXISTS conversation_summaries (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'id' CHECK (locale IN ('id', 'en')),
  summary TEXT NOT NULL CHECK (LENGTH(TRIM(summary)) > 0),
  source_message_id TEXT,
  source_timestamp BIGINT NOT NULL DEFAULT 0,
  source_count INTEGER NOT NULL DEFAULT 0 CHECK (source_count >= 0),
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id, locale)
);

CREATE INDEX IF NOT EXISTS conversation_summaries_updated_idx
  ON conversation_summaries (company_id, updated_at DESC);
