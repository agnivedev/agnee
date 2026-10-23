-- Balasan yang tim ketik langsung di aplikasi WhatsApp (HP / WhatsApp Web),
-- bukan lewat Agnee.
--
-- Sampai sekarang pesan itu tidak tercatat di mana pun, jadi laporan
-- supervisor menganggap customer yang sudah dibalas dari HP masih "menunggu
-- balasan" berhari-hari dan "Dibalas tim" selalu 0. Tabel terpisah, bukan
-- outbound_replies: tabel itu dibaca review mode, daftar chat, dan riwayat
-- percakapan, dan pesan dari HP tidak boleh tiba-tiba ikut ke sana.
--
-- Hanya chat yang customernya pernah mengirim pesan ke Agnee yang dicatat;
-- obrolan pribadi pemilik HP dengan orang lain tidak ikut tersimpan.
CREATE TABLE IF NOT EXISTS phone_replies (
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id      TEXT NOT NULL,
  message_id   TEXT NOT NULL,
  body         TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'chat',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, message_id)
);

CREATE INDEX IF NOT EXISTS phone_replies_chat_idx ON phone_replies (company_id, chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS phone_replies_company_idx ON phone_replies (company_id, created_at DESC);

-- Dipakai untuk memastikan pesan yang dikirim Agnee sendiri tidak ikut
-- tercatat sebagai balasan dari HP.
CREATE INDEX IF NOT EXISTS outbound_replies_message_idx ON outbound_replies (company_id, message_id)
  WHERE message_id IS NOT NULL;
