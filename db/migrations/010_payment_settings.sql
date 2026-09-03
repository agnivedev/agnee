-- Payment & closing configuration per company.
-- Supervisors configure how AI should guide customers to payment at closing stage.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20) DEFAULT 'none'
  CHECK (payment_method IN ('none', 'link', 'bank_transfer'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_link   VARCHAR(500);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_name      VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_account   VARCHAR(50);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS bank_holder    VARCHAR(100);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_notes  TEXT;
