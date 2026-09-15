-- Memulai rangkaian tindak lanjut baru untuk percakapan yang rangkaiannya
-- sudah selesai.
--
-- Tanpa ini, sekali sebuah percakapan habis plafonnya, tidak ada jalan kembali
-- selain customer yang bicara duluan. Supervisor yang ingin menyapa lagi
-- sebulan kemudian tidak punya tombol apa pun.
--
-- Dua angka menjaganya supaya tidak berubah jadi jalan memutar plafon:
--
--   restart_after_days  Berapa hari harus lewat sejak rangkaian berhenti
--                       sebelum boleh dimulai lagi. Disetel supervisor.
--                       0 = tidak boleh sama sekali.
--   restart_count       Berapa kali percakapan ini pernah dimulai ulang.
--                       Tidak membatasi apa pun; dipakai antarmuka untuk
--                       memperingatkan supervisor yang mengulang terlalu
--                       sering ke orang yang sama.

ALTER TABLE follow_up_state
  ADD COLUMN IF NOT EXISTS restart_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE follow_up_settings
  ADD COLUMN IF NOT EXISTS restart_after_days INTEGER NOT NULL DEFAULT 2;

ALTER TABLE follow_up_settings
  DROP CONSTRAINT IF EXISTS follow_up_settings_restart_after_days_check;
ALTER TABLE follow_up_settings
  ADD CONSTRAINT follow_up_settings_restart_after_days_check
  CHECK (restart_after_days >= 0 AND restart_after_days <= 90);

-- Rangkaian yang dimulai ulang berhenti dengan alasannya sendiri, supaya
-- riwayatnya bisa dibedakan dari rangkaian yang memang habis sendiri.
ALTER TABLE follow_up_state
  DROP CONSTRAINT IF EXISTS follow_up_state_stop_reason_check;
ALTER TABLE follow_up_state
  ADD CONSTRAINT follow_up_state_stop_reason_check
  CHECK (stop_reason = ANY (ARRAY[
    'replied', 'human_takeover', 'exhausted', 'opted_out',
    'manual', 'undeliverable', 'feature_reenabled', 'restarted'
  ]));

-- Rangkaian butuh identitas, kalau tidak dua pengaman lama menolak rangkaian
-- baru sebelum satu pesan pun keluar:
--
--   1. Plafon absolut menghitung SEMUA baris follow_up_sends untuk chat itu.
--      Percakapan yang plafonnya sudah habis langsung habis lagi.
--   2. UNIQUE (company_id, chat_id, day_index, attempt_in_day) bertabrakan:
--      rangkaian baru memakai hari ke-0 percobaan ke-1, yang sudah dipakai
--      rangkaian sebelumnya.
--
-- `sequence_no` menyimpan `restart_count` saat pesan itu dikirim. Rangkaian
-- pertama bernomor 0, jadi baris lama tetap sah apa adanya.
ALTER TABLE follow_up_sends
  ADD COLUMN IF NOT EXISTS sequence_no INTEGER NOT NULL DEFAULT 0;

ALTER TABLE follow_up_sends
  DROP CONSTRAINT IF EXISTS follow_up_sends_slot_key;
ALTER TABLE follow_up_sends
  ADD CONSTRAINT follow_up_sends_slot_key
  UNIQUE (company_id, chat_id, sequence_no, day_index, attempt_in_day);
