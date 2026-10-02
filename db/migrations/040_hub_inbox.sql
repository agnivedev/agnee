-- Agnee Express, Fase 1: the Agnive Hub inbox for Agnive staff.
--
-- 1. A bell for supervisors when a funder starts or continues a Hub
--    conversation ('hub').
-- 2. Each outside source can be switched off per company. Off hides it and
--    stops the bell — messages still arrive and are kept, so nothing is lost
--    and switching back on shows everything.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('mention', 'reply', 'task', 'sla', 'hub'));
-- A Hub bell has no person behind it: it is the source itself speaking.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_actor_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_actor_kind_check
  CHECK (actor_kind IN ('human', 'ai', 'system'));

CREATE TABLE IF NOT EXISTS external_sources (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_received_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, source)
);
