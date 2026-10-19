-- Sistem credit (docs/credit-system.md). Opt-in per company: credit_mode = false
-- berarti company berjalan persis seperti sebelumnya (kuota pesan lama).

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_plan_check;
ALTER TABLE companies ADD CONSTRAINT companies_plan_check
  CHECK (plan IN ('personal', 'company', 'lifetime', 'starter', 'growth', 'pro', 'enterprise'));

ALTER TABLE companies ADD COLUMN IF NOT EXISTS credit_mode BOOLEAN NOT NULL DEFAULT FALSE;
-- Kantong paket: diisi tiap langganan, hangus di akhir periode + masa tenggang.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS credit_plan_balance NUMERIC(16,4) NOT NULL DEFAULT 0;
-- Kantong top-up (pay as you go): tidak hangus.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS credit_topup_balance NUMERIC(16,4) NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS credit_period_end TIMESTAMPTZ;
-- Credit paket terakhir yang diisi; dasar ambang "saldo rendah".
ALTER TABLE companies ADD COLUMN IF NOT EXISTS credit_last_grant NUMERIC(16,4) NOT NULL DEFAULT 0;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS credit_discount_pct SMALLINT NOT NULL DEFAULT 0
  CHECK (credit_discount_pct BETWEEN 0 AND 60);
-- NULL | 'p20' | 'p10' | 'p1' | 'empty': supervisor sudah dikabari pada tingkat ini; direset saat diisi ulang.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS credit_alert_level TEXT
  CHECK (credit_alert_level IN ('p20', 'p10', 'p1', 'empty'));

CREATE TABLE IF NOT EXISTS credit_ledger (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('subscription', 'topup', 'usage', 'adjust', 'expire')),
  amount NUMERIC(16,4) NOT NULL,            -- + masuk, - keluar
  shortfall NUMERIC(16,4) NOT NULL DEFAULT 0, -- bagian potongan yang tidak tertutup saldo
  plan_after NUMERIC(16,4) NOT NULL,
  topup_after NUMERIC(16,4) NOT NULL,
  cost_usd NUMERIC(14,8),
  purpose TEXT,
  note TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS credit_ledger_company_idx ON credit_ledger (company_id, id DESC);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('mention', 'reply', 'task', 'sla', 'hub', 'department_question', 'credit'));

-- Kuota promo: perusahaan yang mendaftar sendiri (jalur publik) sementara kuota
-- bulan itu masih ada ditandai; penghitungnya membaca kolom ini, bukan angka
-- karangan. Akun yang dibuat staf tidak ditandai.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS promo_signup BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS companies_promo_idx ON companies (created_at) WHERE promo_signup;

-- Paket Lifetime berbasis credit: dibayar sekali, credit awal sekali saja.
