-- Profil lead dari website (landing Bull Babe), disimpan terpisah dari lead_states.
--
-- lead_states hanya tahu chat WhatsApp-nya. Untuk mencocokkan lead dengan daftar
-- klien di portal IB broker (dibaca robot Anduman) kita butuh email, broker,
-- dan nomor account yang diisi orangnya. Satu baris per submission form.
--
-- status: 'new' sampai robot menemukan lead ini terdaftar di broker, lalu
-- 'verified'. confirmation_sent_at terisi setelah WhatsApp konfirmasi benar-benar
-- terkirim, supaya kiriman ulang dari robot tidak mengirim dua kali.
CREATE TABLE IF NOT EXISTS website_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  broker TEXT NOT NULL DEFAULT '',
  account_status TEXT NOT NULL DEFAULT 'new' CHECK (account_status IN ('new', 'have')),
  account_number TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT 'id' CHECK (language IN ('id', 'en')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'verified')),
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  confirmation_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, submission_id)
);

CREATE INDEX IF NOT EXISTS website_leads_email_idx
  ON website_leads (company_id, lower(email)) WHERE email <> '';
CREATE INDEX IF NOT EXISTS website_leads_account_idx
  ON website_leads (company_id, account_number) WHERE account_number <> '';
CREATE INDEX IF NOT EXISTS website_leads_pending_idx
  ON website_leads (company_id, status, confirmation_sent_at);
