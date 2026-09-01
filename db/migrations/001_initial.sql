CREATE TABLE IF NOT EXISTS lead_states (
  chat_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'inbox' CHECK (stage IN ('inbox', 'qualified', 'assigned')),
  score SMALLINT CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  assignee TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS playground_runs (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT NOT NULL CHECK (client_id IN ('bzone', 'agnee')),
  message TEXT NOT NULL,
  reply TEXT NOT NULL,
  model TEXT NOT NULL,
  matched_faqs JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  cost_usd NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  style_passed BOOLEAN NOT NULL DEFAULT TRUE,
  style_warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  elapsed_ms INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS playground_runs_created_at_idx
  ON playground_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS playground_runs_client_created_idx
  ON playground_runs (client_id, created_at DESC);
