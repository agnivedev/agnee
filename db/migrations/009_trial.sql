-- Self-serve signup: new companies start on a 7-day trial. plan_status gains
-- 'trial'; trial_ends_at drives expiry (checked lazily on read — see
-- database.js getCompanyConfig — no cron needed).
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_plan_status_check;
ALTER TABLE companies ADD CONSTRAINT companies_plan_status_check
  CHECK (plan_status IN ('trial', 'beta', 'active', 'suspended'));

ALTER TABLE companies ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
