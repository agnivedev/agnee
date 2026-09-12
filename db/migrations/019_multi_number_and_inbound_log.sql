-- Dua hal yang ternyata satu kebutuhan yang sama.
--
-- (a) Rotator nomor lewat QR (whatsapp-web.js): satu company boleh punya
--     beberapa nomor, masing-masing profil Chromium sendiri.
-- (b) Export ke Google Sheets butuh kolom "pesan terakhir" yang andal.
--
-- Keduanya butuh jawaban atas pertanyaan yang sama: pesan ini masuk lewat
-- nomor yang mana. Sebelum ini tidak ada tempat untuk menyimpannya — untuk
-- jalur whatsapp-web.js, DB hanya menyimpan balasan KITA (outbound_replies),
-- sedangkan isi chat customer hanya hidup di dalam browser Chromium.

-- ── (a) Banyak nomor per company, jalur whatsapp-web.js ─────────────────────
-- Kolomnya sudah mendukung sejak awal: UNIQUE (company_id, connection_key).
-- Yang kurang hanya label yang bisa dibaca manusia dan penanda rotasi.
ALTER TABLE whatsapp_connections ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- Percakapan menempel pada satu nomor, sama seperti cloud_chat_numbers.
-- Alasannya sama: balasan dari nomor lain, di sisi customer, bukan kelanjutan
-- percakapan melainkan chat baru dari nomor asing.
CREATE TABLE IF NOT EXISTS whatsapp_chat_numbers (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  connection_id UUID NOT NULL REFERENCES whatsapp_connections(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id)
);
CREATE INDEX IF NOT EXISTS whatsapp_chat_numbers_connection_idx
  ON whatsapp_chat_numbers (connection_id);

-- ── (b) Catatan pesan masuk, kedua provider ─────────────────────────────────
-- cloud_messages tetap dipakai jalur Cloud API untuk menyajikan /v1/chats.
-- Tabel ini tujuannya berbeda: ringkasan tahan-lama per percakapan supaya
-- kolom "pesan terakhir" tidak ikut mati ketika client WhatsApp bermasalah.
CREATE TABLE IF NOT EXISTS inbound_messages (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  -- Nomor penerima. NULL untuk pesan yang tercatat sebelum nomornya diketahui.
  connection_id UUID,
  provider TEXT NOT NULL CHECK (provider IN ('whatsapp_web', 'cloud_api')),
  wa_message_id TEXT,
  body TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Pesan yang sama bisa sampai dua kali: whatsapp-web.js menembakkan ulang
  -- event setelah reconnect, dan Meta mengirim ulang webhook yang belum
  -- di-ACK. Tanpa ini, "pesan terakhir" bisa terhitung ganda.
  UNIQUE (company_id, wa_message_id)
);
CREATE INDEX IF NOT EXISTS inbound_messages_chat_idx
  ON inbound_messages (company_id, chat_id, timestamp DESC);
