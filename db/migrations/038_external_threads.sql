-- Percakapan yang datang dari luar WhatsApp — pertama: Agnive Hub, lewat
-- Insight. Bentuknya sengaja umum (source + external_id) supaya Instagram,
-- Facebook, Shopee nanti masuk ke tabel yang sama tanpa desain ulang.
--
-- Agnee hanya menyimpan SALINAN. Sumber kebenarannya tetap di aplikasi asal
-- (untuk Hub: tabel hubInquiry/hubMessage di Insight); setiap kiriman membawa
-- keadaan lengkap satu thread dan menimpa salinan ini.
CREATE TABLE IF NOT EXISTS external_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  contact_name TEXT,
  contact_email TEXT,
  contact_org TEXT,
  -- Khusus source: untuk Hub listing, jenis dukungan, nominal, tim.
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Diisi saat sumber menghapus data pribadi pengirim (masa simpan habis);
  -- salinan di sini ikut dikosongkan pada kiriman yang sama.
  anonymized_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS external_threads_company_recent_idx
  ON external_threads (company_id, source, last_message_at DESC);

CREATE TABLE IF NOT EXISTS external_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES external_threads(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  -- 'contact' (pengirim dari luar) atau 'team' (pihak yang membalas di sumber).
  author TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL,
  UNIQUE (thread_id, external_id)
);
