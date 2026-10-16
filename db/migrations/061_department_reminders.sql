-- Pengingat bertahap ke departemen: 5 mnt, 15 mnt, 2 jam, 12 jam, lalu berhenti.
-- Setelah pengingat terakhir tanpa jawaban, pertanyaan menjadi 'unresolved':
-- customer tercatat "belum terjawab karena belum ada kepastian dari internal".
ALTER TABLE department_questions
  ADD COLUMN IF NOT EXISTS reminder_count SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;
ALTER TABLE department_questions DROP CONSTRAINT IF EXISTS department_questions_status_check;
ALTER TABLE department_questions ADD CONSTRAINT department_questions_status_check
  CHECK (status IN ('open', 'answered', 'expired', 'unresolved'));
