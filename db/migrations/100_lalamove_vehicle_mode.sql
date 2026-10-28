-- Kendaraan Lalamove ditentukan Management, bukan AI. Saat 'management', AI
-- bertanya dulu ke departemen Management kendaraan apa yang dipakai (motor,
-- engkel box, dst. sesuai daftar dari API Lalamove) lalu menghitung ongkirnya
-- dari jawaban itu. 'ai' (bawaan) = perilaku lama: AI memilih sendiri.
ALTER TABLE lalamove_connections
  ADD COLUMN IF NOT EXISTS vehicle_mode TEXT NOT NULL DEFAULT 'ai'
    CHECK (vehicle_mode IN ('ai', 'management'));

-- Pertanyaan departemen berjenis: 'general' (bawaan) atau 'lalamove_vehicle'.
-- `payload` menyimpan yang dibutuhkan untuk melanjutkan setelah dijawab
-- (argumen ongkir, tujuan, dan kendaraan yang dipilih).
ALTER TABLE department_questions
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS payload JSONB;
CREATE INDEX IF NOT EXISTS department_questions_vehicle_idx
  ON department_questions (company_id, chat_id, created_at DESC) WHERE kind = 'lalamove_vehicle';
