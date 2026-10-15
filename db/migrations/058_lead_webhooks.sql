-- Webhook lead universal per company: pihak ketiga (website, WordPress, robot,
-- CRM) mengirim lead dan verifikasi "account terhubung" ke
-- /webhook/company/<slug>/lead dan /lead-verify, ditandatangani HMAC dengan
-- secret milik company itu. Tanpa baris di sini, rute per company 404.
--
-- Secret disimpan terenkripsi (pola mayar_connections) karena HMAC butuh
-- nilai aslinya. Dua secret terpisah supaya pengirim form dan pengirim
-- verifikasi tidak saling bisa meniru. Template kosong = teks bawaan umum.
-- Penanda: {name} {first_name} {broker} {company}.
CREATE TABLE IF NOT EXISTS lead_webhooks (
  company_id UUID PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  lead_secret_enc BYTEA,
  verify_secret_enc BYTEA,
  enabled BOOLEAN NOT NULL DEFAULT true,
  welcome_text_id TEXT NOT NULL DEFAULT '',
  welcome_text_en TEXT NOT NULL DEFAULT '',
  confirm_text_id TEXT NOT NULL DEFAULT '',
  confirm_text_en TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
