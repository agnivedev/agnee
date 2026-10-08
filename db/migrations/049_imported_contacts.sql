-- Chat yang dibaca dari WhatsApp yang sudah tersambung, bukan dari pesan yang
-- dicatat Agnee.
--
-- Agnee baru mencatat pesan sejak nomor tersambung, jadi percakapan yang sudah
-- ada di ponsel sebelum itu tidak ada di database. Inbox membacanya langsung
-- dari WhatsApp, tetapi Lead List dan broadcast dibangun dari database, jadi
-- keduanya tampak "kosong" untuk nomor yang sudah lama dipakai (Beweix, 8 Okt:
-- 3 lawan bicara di database, ratusan di ponsel).
--
-- Tabel ini menampung hasil membaca daftar chat itu. Ia TIDAK menyalin isi
-- pesan: yang disimpan hanya apa yang dibutuhkan untuk mengelompokkan.
--
-- relation:
--   replied  = ada pesan MASUK dari kontak itu di riwayat yang terbaca.
--   unproven = tidak ada pesan masuk di riwayat yang terbaca. Bukan berarti
--              kontak itu tidak pernah membalas (jendela bacanya terbatas),
--              hanya belum terlihat. Namanya sengaja bukan "never replied".
--
-- Pembeda ini yang menjaga aturan broadcast: pesan massal ke nomor yang tidak
-- pernah menghubungi kita adalah jalan tercepat nomor diblokir.

CREATE TABLE IF NOT EXISTS imported_contacts (
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id         TEXT NOT NULL,
  relation        TEXT NOT NULL CHECK (relation IN ('replied', 'unproven')),
  -- Detik epoch, sama dengan inbound_messages.timestamp.
  last_message_at BIGINT,
  last_inbound_at BIGINT,
  -- Label WhatsApp Business ("Pelanggan baru", "Sudah bayar", ...). Kosong
  -- untuk akun WhatsApp biasa, yang memang tidak punya label.
  wa_labels       JSONB NOT NULL DEFAULT '[]'::jsonb,
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id)
);

CREATE INDEX IF NOT EXISTS imported_contacts_relation_idx
  ON imported_contacts (company_id, relation);
