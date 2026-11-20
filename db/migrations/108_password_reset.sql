-- Lupa password: token reset sekali pakai. Yang disimpan hanya hash SHA-256 token
-- (token asli hanya ada di email). Migrasi dijalankan di bawah advisory lock
-- oleh runner di src/database.js (MIGRATION_LOCK_KEY), seperti migrasi lain.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id, created_at DESC);

-- Sesi (cookie) yang diterbitkan sebelum waktu ini dianggap tidak berlaku.
-- Dipakai untuk mencabut semua sesi lama saat password direset.
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ;
