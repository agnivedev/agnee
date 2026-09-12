-- Rotator nomor WhatsApp lewat Cloud API.
--
-- Sebelumnya satu company hanya boleh punya satu nomor Cloud API
-- (UNIQUE (company_id)). Cloud API dipilih sebagai jalur rotator karena tidak
-- memakai Chromium sama sekali: satu nomor lewat whatsapp-web.js terukur
-- ~400 MB dan ~118 pid di produksi, sedangkan Cloud API mendekati nol.
ALTER TABLE whatsapp_cloud_connections DROP CONSTRAINT IF EXISTS whatsapp_cloud_connections_company_id_key;
ALTER TABLE whatsapp_cloud_connections ADD COLUMN IF NOT EXISTS label TEXT;
-- Nomor yang dinonaktifkan berhenti menerima chat BARU, tetapi tetap melayani
-- percakapan yang sudah terlanjur menempel padanya. Menghapus nomor dari
-- rotasi tidak boleh memutus percakapan yang sedang berjalan.
ALTER TABLE whatsapp_cloud_connections ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'whatsapp_cloud_connections_company_phone_key'
  ) THEN
    ALTER TABLE whatsapp_cloud_connections
      ADD CONSTRAINT whatsapp_cloud_connections_company_phone_key
      UNIQUE (company_id, phone_number_id);
  END IF;
END $$;

-- phone_number_id tetap unik global: webhook Meta memetakan pesan masuk ke
-- company lewat kolom ini, jadi dua company tidak boleh mengklaim nomor sama.

-- Percakapan menempel pada satu nomor.
--
-- Tanpa ini, customer yang chat ke nomor A bisa dibalas dari nomor B. Di
-- WhatsApp itu bukan satu percakapan — balasannya muncul sebagai chat baru
-- dari nomor asing, dan riwayatnya pecah. Jadi rotasi hanya berlaku saat
-- memilih nomor untuk percakapan BARU.
CREATE TABLE IF NOT EXISTS cloud_chat_numbers (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  connection_id UUID NOT NULL REFERENCES whatsapp_cloud_connections(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id)
);
CREATE INDEX IF NOT EXISTS cloud_chat_numbers_connection_idx
  ON cloud_chat_numbers (connection_id);
