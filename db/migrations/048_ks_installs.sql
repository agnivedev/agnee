-- Paket Knowledge Source (KS) yang terpasang di sebuah company.
--
-- `package` adalah salinan paket saat dipasang (manifest, General Knowledge,
-- skema isian, skenario simulasi): balasan ke customer tidak boleh bergantung
-- pada sumber paketnya (folder bawaan atau Expertz) yang sedang tidak bisa
-- dijangkau. `specific` adalah isian Specific Knowledge milik company dan
-- tidak pernah meninggalkan database ini.
--
-- Satu paket per jenis (closing, complain) per company. `active` hanya boleh
-- menyala setelah simulasi terakhir lulus untuk isian yang sekarang; mengubah
-- isian mematikannya dan menghapus hasil simulasinya.
CREATE TABLE IF NOT EXISTS ks_installs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  package JSONB NOT NULL,
  specific JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  last_simulation JSONB,
  installed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ks_installs_company_kind_idx
  ON ks_installs (company_id, kind);
