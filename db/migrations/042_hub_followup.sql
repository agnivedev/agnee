-- Agnee Express, Fase 4: follow-up on Agnive Hub conversations.
--
-- assignee_user_id: the Agnive staff member who follows the conversation up
--   with the research team (PJ). Staff only — the team still answers funders
--   from Agnive Insight.
-- awaiting_since: the funder's last unanswered message; null when the team had
--   the last word. Kept by every delivery so the overdue sweep is one query.
-- sla_notified_for: the awaiting_since a reminder already went out for, so
--   each wait rings once.
ALTER TABLE external_threads ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE external_threads ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE external_threads ADD COLUMN IF NOT EXISTS awaiting_since TIMESTAMPTZ;
ALTER TABLE external_threads ADD COLUMN IF NOT EXISTS sla_notified_for TIMESTAMPTZ;

UPDATE external_threads t SET awaiting_since = (
  SELECT CASE WHEN m.author = 'contact' THEN m.occurred_at END
  FROM external_messages m WHERE m.thread_id = t.id ORDER BY m.occurred_at DESC LIMIT 1
) WHERE t.status = 'open' AND t.anonymized_at IS NULL;

CREATE INDEX IF NOT EXISTS external_threads_awaiting_idx
  ON external_threads (awaiting_since) WHERE awaiting_since IS NOT NULL;
