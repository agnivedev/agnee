-- AI belajar dari chat: usulan knowledge yang lahir dari balasan CS di inbox.
--
-- Alurnya: ringkasan chat menangkap tanya-jawab baru dari balasan CS, CS
-- menawarkannya ("Ajarkan ke AI"), supervisor melihat simulasi sebelum/sesudah,
-- lalu menerapkannya sebagai Fakta di playbook. Tidak ada yang masuk playbook
-- tanpa persetujuan manusia dan simulasi.

-- Saklar per company, mati secara bawaan: dinyalakan satu company dulu.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS knowledge_learning_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Fakta yang diterapkan dari usulan diberi asal 'chat', supaya bisa dilaporkan
-- dan dilacak terpisah dari Fakta hasil wawancara / ketikan tangan.
ALTER TABLE playbook_facts DROP CONSTRAINT IF EXISTS playbook_facts_source_check;
ALTER TABLE playbook_facts ADD CONSTRAINT playbook_facts_source_check
  CHECK (source IN ('interview', 'manual', 'simulation', 'chat'));

CREATE TABLE IF NOT EXISTS knowledge_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL,
  -- Bubble CS yang memicu usulan; chip ditampilkan di bawahnya.
  source_message_id TEXT,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  -- Kalimat asli customer yang memicu usulan (sudah dibersihkan); dipakai
  -- sebagai pertanyaan uji pertama di simulasi.
  customer_message TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'faq' CHECK (category IN
    ('profile', 'product', 'pricing', 'faq', 'funnel', 'objection', 'closing')),
  -- suggested : ditawarkan ke CS, belum ditanggapi
  -- submitted : CS (atau supervisor) menekan "Ajarkan ke AI", menunggu tinjauan
  -- applied   : sudah jadi Fakta
  -- rejected  : ditolak supervisor
  -- dismissed : CS menekan "Bukan", atau ternyata sudah ada di playbook
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN
    ('suggested', 'submitted', 'applied', 'rejected', 'dismissed')),
  origin TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto', 'manual')),
  proposed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reject_reason TEXT,
  -- Hasil cek bentrok saat diajukan. NULL = belum dicek.
  conflict_status TEXT CHECK (conflict_status IN ('new', 'conflict')),
  conflict_note TEXT,
  -- Potongan chat sumber (sudah dibersihkan dari nomor/email), untuk supervisor.
  chat_excerpt TEXT NOT NULL DEFAULT '',
  -- Hasil simulasi sebelum/sesudah; NULL berarti belum disimulasikan, dan
  -- disetel NULL lagi setiap kali pertanyaan/jawaban disunting.
  simulation JSONB,
  simulated_at TIMESTAMPTZ,
  fingerprint TEXT NOT NULL,
  fact_id UUID,
  wa_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ
);

-- Satu chip aktif per chat: kandidat baru tidak muncul selama yang lama belum
-- dijawab.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_proposals_one_open_per_chat
  ON knowledge_proposals (company_id, chat_id) WHERE status = 'suggested';

CREATE INDEX IF NOT EXISTS knowledge_proposals_queue_idx
  ON knowledge_proposals (company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_proposals_fingerprint_idx
  ON knowledge_proposals (company_id, fingerprint);

-- PERHATIAN: migrasi lain yang kelak menulis ulang constraint ini harus ikut
-- memuat 'knowledge', kalau tidak notifikasi usulan knowledge akan ditolak.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('mention', 'reply', 'task', 'sla', 'hub', 'department_question', 'credit', 'knowledge'));
