-- Email yang dipakai lead mendaftar di broker (Valetax mengenali member lewat
-- email, bukan nomor account). Bisa berbeda dari email member di website, jadi
-- disimpan terpisah dari website_leads.email dan ikut dicocokkan saat verifikasi.
ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS broker_email TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS website_leads_broker_email_idx
  ON website_leads (company_id, lower(broker_email)) WHERE broker_email <> '';
