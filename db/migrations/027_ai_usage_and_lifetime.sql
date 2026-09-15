-- Pencatatan token dan biaya per company, dan paket lifetime.
--
-- Sampai sekarang yang dihitung hanya JUMLAH PESAN (`companies.ai_message_count`).
-- Itu tidak cukup untuk menjual token: satu pesan bisa 200 token atau 4.000
-- token tergantung panjang playbook dan riwayat percakapan. Menagih per pesan
-- berarti company dengan playbook panjang justru paling merugikan, dan selisih
-- biayanya ditanggung kita tanpa terlihat di mana pun.

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Untuk apa panggilan ini: auto_reply, summary, follow_up, coach, playground.
  -- Dipakai memisahkan biaya yang melayani customer dari biaya internal.
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  -- Biaya yang DILAPORKAN penyedia, bukan hasil hitungan kita. Harga per model
  -- berubah dan masuk tidak sama dengan keluar; menghitung sendiri berarti
  -- angkanya menyimpang diam-diam setiap kali penyedia mengubah harga.
  cost_usd NUMERIC(18, 8) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tagihan selalu dibaca per company per periode.
CREATE INDEX IF NOT EXISTS ai_usage_logs_company_idx
  ON ai_usage_logs (company_id, created_at DESC);

-- Paket lifetime: dibayar sekali, tidak kedaluwarsa.
--
-- `ai_message_limit = 0` sudah berarti tanpa batas di kode yang ada, jadi
-- lifetime tidak memerlukan jalur plafon tersendiri. Yang dibedakan hanya
-- planya, supaya penagihan berkala tahu harus melewatinya — dan supaya nanti
-- bisa ada lifetime yang fiturnya dibatasi tanpa mengubah arti 'company'.
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_plan_check;
ALTER TABLE companies
  ADD CONSTRAINT companies_plan_check CHECK (plan IN ('personal', 'company', 'lifetime'));
