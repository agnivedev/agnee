-- AI belajar dari jawaban departemen: usulan knowledge yang lahir dari jawaban
-- staf (grup WhatsApp atau web) atas pertanyaan AI lewat ask_department.
--
-- Memakai tabel knowledge_proposals yang sama. Bedanya: tidak ada tahap chip CS,
-- usulan langsung 'submitted' ke antrean supervisor, dan setiap baris membawa
-- "kasus" lengkap: pesan customer, pertanyaan AI, siapa menjawab dan apa
-- jawabannya persis. Tidak ada yang masuk playbook tanpa persetujuan + simulasi.

ALTER TABLE knowledge_proposals DROP CONSTRAINT IF EXISTS knowledge_proposals_origin_check;
ALTER TABLE knowledge_proposals ADD CONSTRAINT knowledge_proposals_origin_check
  CHECK (origin IN ('auto', 'manual', 'department'));

ALTER TABLE knowledge_proposals
  ADD COLUMN IF NOT EXISTS department_question_id UUID REFERENCES department_questions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS department_name TEXT,
  -- Apa yang ditanyakan AI ke departemen (sudah dibersihkan dari data pribadi).
  ADD COLUMN IF NOT EXISTS asked_question TEXT NOT NULL DEFAULT '',
  -- Jawaban staf persis seperti diketik (sudah dibersihkan dari data pribadi).
  ADD COLUMN IF NOT EXISTS raw_answer TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS answered_by_name TEXT,
  ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ,
  -- 'group' (balasan di grup WhatsApp departemen) atau 'web' (Agnee).
  ADD COLUMN IF NOT EXISTS answer_channel TEXT CHECK (answer_channel IN ('group', 'web')),
  -- Grup WhatsApp tempat jawaban diberikan, untuk tautan ke chat grupnya.
  ADD COLUMN IF NOT EXISTS answer_group_id TEXT;

-- Satu usulan per pertanyaan departemen.
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_proposals_one_per_department_question
  ON knowledge_proposals (department_question_id) WHERE department_question_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS knowledge_proposals_origin_idx
  ON knowledge_proposals (company_id, origin, created_at DESC);
