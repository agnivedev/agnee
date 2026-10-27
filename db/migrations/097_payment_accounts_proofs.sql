-- Rekening pembayaran per company (Pengaturan > Paket & Pembayaran) dan hasil
-- pemeriksaan bukti transfer yang dikirim customer di chat.
--
-- payment_accounts: boleh lebih dari satu rekening aktif. 'retired' = rekening
-- lama yang sudah tidak dipakai; AI tidak pernah memberikannya, tetapi bukti
-- transfer ke rekening itu dikenali ("transfer ke rekening lama").
-- Kolom bank_* lama di companies tetap dibaca sebagai cadangan; isinya disalin
-- sekali di sini untuk company yang sudah mengisinya.
CREATE TABLE IF NOT EXISTS payment_accounts (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_holder TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_accounts_company_idx ON payment_accounts (company_id, status, sort_order);

INSERT INTO payment_accounts (company_id, bank_name, account_number, account_holder)
SELECT id, COALESCE(NULLIF(bank_name, ''), 'Bank'), bank_account, bank_holder
FROM companies
WHERE COALESCE(bank_account, '') <> ''
  AND NOT EXISTS (SELECT 1 FROM payment_accounts pa WHERE pa.company_id = companies.id);

-- Saklar per company: mati bawaan. Foto dikirim ke model penglihat hanya bila menyala.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_proof_check BOOLEAN NOT NULL DEFAULT FALSE;

-- Satu baris per foto yang diperiksa. `verdict` dinilai server dari hasil baca
-- model; keputusan akhir "sudah dibayar" tetap di staf (review_status).
CREATE TABLE IF NOT EXISTS payment_proofs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  wa_message_id TEXT,
  image_sha256 TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('cocok', 'perlu_dicek', 'tidak_cocok', 'bukan_bukti')),
  flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  extracted JSONB NOT NULL DEFAULT '{}'::jsonb,
  expected_amount NUMERIC(14, 0),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'accepted', 'rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payment_proofs_chat_idx ON payment_proofs (company_id, chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_proofs_hash_idx ON payment_proofs (company_id, image_sha256) WHERE image_sha256 IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_proofs_msg_uniq ON payment_proofs (company_id, wa_message_id) WHERE wa_message_id IS NOT NULL;

-- AI membaca foto/video referensi dari customer (deskripsi, cocokkan ke katalog,
-- cari di web bila belum ketemu). Hidup bawaan; tiap foto satu panggilan model.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_read_media BOOLEAN NOT NULL DEFAULT TRUE;
