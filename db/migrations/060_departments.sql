-- Departemen per company dan pertanyaan internal dari AI.
--
-- AI yang tidak tahu jawaban tidak boleh mengarang: ia bertanya ke departemen
-- terkait, SEMUA anggotanya diberi tahu, jawaban pertama yang masuk dipakai
-- untuk melanjutkan balasan ke customer.

CREATE TABLE IF NOT EXISTS departments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Nama unik per company tanpa membedakan huruf besar/kecil.
CREATE UNIQUE INDEX IF NOT EXISTS departments_company_name_key
  ON departments (company_id, lower(name));

CREATE TABLE IF NOT EXISTS department_members (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS department_members_user_idx ON department_members (company_id, user_id);

-- Nomor WhatsApp anggota untuk dipanggil saat ada pertanyaan dari AI.
-- Kosong = hanya notifikasi di Agnee.
ALTER TABLE company_members ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;

CREATE TABLE IF NOT EXISTS department_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  chat_id       TEXT NOT NULL,
  customer_text TEXT NOT NULL DEFAULT '',
  question      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'expired')),
  answer        TEXT,
  answered_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  answered_at   TIMESTAMPTZ,
  relayed_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS department_questions_open_idx
  ON department_questions (company_id, status, created_at);
CREATE INDEX IF NOT EXISTS department_questions_chat_idx
  ON department_questions (company_id, chat_id, created_at);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('mention', 'reply', 'task', 'sla', 'hub', 'department_question'));

-- Departemen bawaan untuk company yang sudah ada.
INSERT INTO departments (company_id, name, description)
SELECT c.id, d.name, d.description
FROM companies c
CROSS JOIN (VALUES
  ('Management', 'Keputusan bisnis, kebijakan, persetujuan, dan hal di luar wewenang CS.'),
  ('Product', 'Fitur, spesifikasi, ketersediaan, dan detail teknis produk.'),
  ('Procurement', 'Stok, pengadaan, harga modal, pemasok, dan waktu pengiriman barang.')
) AS d(name, description)
ON CONFLICT DO NOTHING;
