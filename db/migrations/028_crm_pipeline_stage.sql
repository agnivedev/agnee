-- Pipeline CRM manual (Cold/Warm/Hot/Closing/Lost/On Hold), terpisah dari
-- lead_states.stage yang cuma flag kualifikasi AI (inbox/qualified/assigned).
-- AI hanya boleh USUL; perpindahan stage aktif butuh konfirmasi manusia.
ALTER TABLE lead_states
  ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT 'cold'
    CHECK (pipeline_stage IN ('cold', 'warm', 'hot', 'closing', 'lost', 'on_hold')),
  ADD COLUMN IF NOT EXISTS pipeline_stage_suggested TEXT
    CHECK (pipeline_stage_suggested IS NULL OR pipeline_stage_suggested IN ('cold', 'warm', 'hot', 'closing', 'lost', 'on_hold')),
  ADD COLUMN IF NOT EXISTS pipeline_stage_suggested_reason TEXT,
  ADD COLUMN IF NOT EXISTS pipeline_stage_suggested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pipeline_stage_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pipeline_stage_updated_by TEXT;

CREATE INDEX IF NOT EXISTS lead_states_company_pipeline_idx ON lead_states (company_id, pipeline_stage, updated_at DESC);
