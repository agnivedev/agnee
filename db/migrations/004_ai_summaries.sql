-- Plan management and per-company knowledge client
ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'personal'
  CHECK (plan IN ('personal', 'company'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'beta'
  CHECK (plan_status IN ('beta', 'active', 'suspended'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS knowledge_client TEXT NOT NULL DEFAULT 'agnee';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_message_limit INTEGER NOT NULL DEFAULT 500;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_count_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()) + interval '1 month';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_users INTEGER NOT NULL DEFAULT 1;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_playbooks INTEGER NOT NULL DEFAULT 1;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_whatsapp INTEGER NOT NULL DEFAULT 1;

-- Update default company to reflect current setup
UPDATE companies SET
  plan = 'company',
  plan_status = 'beta',
  knowledge_client = 'bzone',
  ai_message_limit = 0,  -- 0 = unlimited for company tier
  max_users = 5,
  max_playbooks = 0,     -- 0 = unlimited
  max_whatsapp = 0       -- 0 = unlimited
WHERE slug = 'default';
