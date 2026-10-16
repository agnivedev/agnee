-- Pihak ketiga (supplier, pabrik, dll.) yang bisa ditanya AI lewat WhatsApp.
-- Ditandai dengan tag bebas ('semen', 'keramik', 'pabrik'); AI memilih lewat
-- tag + catatan. Balasan dari nomor mereka dicegat dan menunggu tinjauan staf
-- sebelum diteruskan ke customer.
CREATE TABLE IF NOT EXISTS third_parties (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  whatsapp_number TEXT NOT NULL,
  notes           TEXT NOT NULL DEFAULT '',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS third_parties_company_name_key ON third_parties (company_id, lower(name));
CREATE INDEX IF NOT EXISTS third_parties_number_idx ON third_parties (company_id, whatsapp_number);

ALTER TABLE department_questions
  ADD COLUMN IF NOT EXISTS third_party_id UUID REFERENCES third_parties(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS third_party_reply TEXT,
  ADD COLUMN IF NOT EXISTS third_party_replied_at TIMESTAMPTZ;
ALTER TABLE department_questions DROP CONSTRAINT IF EXISTS department_questions_status_check;
ALTER TABLE department_questions ADD CONSTRAINT department_questions_status_check
  CHECK (status IN ('open', 'review', 'answered', 'expired', 'unresolved'));
CREATE INDEX IF NOT EXISTS department_questions_tp_idx ON department_questions (company_id, third_party_id, status);
