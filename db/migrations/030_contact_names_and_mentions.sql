-- Nama customer, mention, dan notifikasi antar pengguna Agnee.

-- ── Nama customer ─────────────────────────────────────────────────────────
-- Inbox menampilkan nama karena membacanya langsung dari WhatsApp; Lead List
-- dibangun dari database dan tidak punya sumber nama sama sekali. Nama
-- direkam di sini saat pesan masuk.
--
-- Baris lama tidak bisa diisi surut: namanya memang tidak pernah tersimpan.
-- Sebuah chat baru mendapat namanya saat customer mengirim pesan berikutnya.
CREATE TABLE IF NOT EXISTS contact_names (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  name TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, chat_id)
);

-- ── Mention dan balasan di catatan ────────────────────────────────────────
ALTER TABLE conversation_notes
  -- Satu tingkat balasan saja, bukan pohon: balasan-atas-balasan membuat UI
  -- berat untuk sesuatu yang jarang dipakai.
  ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES conversation_notes(id) ON DELETE CASCADE,
  -- author_user_id NULL sudah berarti "pengguna dihapus", jadi AI butuh
  -- penanda sendiri supaya keduanya bisa dibedakan.
  ADD COLUMN IF NOT EXISTS author_kind TEXT NOT NULL DEFAULT 'human'
    CHECK (author_kind IN ('human', 'ai')),
  -- Catatan serah terima ikut masuk aliran yang sama supaya tim membaca satu
  -- lini masa, bukan dua tempat terpisah.
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'note'
    CHECK (kind IN ('note', 'handover')),
  -- [{"kind":"user","id":"<uuid>"}, {"kind":"chat","chatId":"628...@c.us"}]
  -- kind 'user' memicu notifikasi; kind 'chat' HANYA tautan navigasi dan
  -- tidak pernah mengirim apa pun ke customer.
  ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS conversation_notes_parent_idx
  ON conversation_notes (parent_id) WHERE parent_id IS NOT NULL;

-- ── Notifikasi ────────────────────────────────────────────────────────────
-- Hanya untuk pengguna Agnee. Customer tidak pernah punya baris di sini.
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('mention', 'reply')),
  chat_id TEXT,
  note_id BIGINT REFERENCES conversation_notes(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL DEFAULT 'human' CHECK (actor_kind IN ('human', 'ai')),
  body TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications (company_id, user_id, read_at NULLS FIRST, created_at DESC);
