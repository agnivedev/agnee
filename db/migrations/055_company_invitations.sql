-- Satu email, beberapa company.
--
-- `users` adalah identitas bersama; `company_members` sudah banyak-ke-banyak.
-- Yang menahan selama ini: menambah email yang sudah punya akun di company lain
-- dulu menimpa password-nya (celah ambil alih akun, ditutup 3 Okt), jadi
-- ditolak. Sekarang email itu menerima UNDANGAN: baris di company_invitations
-- yang hanya bisa diterima oleh orang yang sudah login dengan email tersebut.
-- Tanpa token lewat email (SMTP belum diisi): undangan muncul setelah login.

-- Peran 'supervisor' dipakai aplikasi sejak 003 tetapi CHECK undangan belum tahu.
ALTER TABLE company_invitations DROP CONSTRAINT IF EXISTS company_invitations_role_check;
ALTER TABLE company_invitations ADD CONSTRAINT company_invitations_role_check
  CHECK (role IN ('supervisor', 'admin', 'agent', 'viewer'));

ALTER TABLE company_invitations ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

-- Daftar "undangan untuk saya" dicari menurut email.
CREATE INDEX IF NOT EXISTS company_invitations_email_pending_idx
  ON company_invitations (LOWER(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Company yang terakhir dipakai orang ini; login membuka company itu, bukan
-- selalu yang tertua.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_company_id UUID REFERENCES companies(id) ON DELETE SET NULL;
