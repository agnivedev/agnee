-- Pengaman tingkat database untuk tindak lanjut.
--
-- Insiden 2026-09-14: satu customer menerima pesan tindak lanjut identik 20
-- kali. Penyebabnya pencatatan yang tidak pernah tertulis, sehingga plafon
-- harian dan jarak minimum — yang keduanya dihitung dari catatan itu —
-- tidak menahan apa pun.
--
-- Batasan di bawah tidak bergantung pada kode aplikasi sama sekali. Kalau
-- logika penjadwalnya salah lagi, percobaan kedua untuk slot yang sama akan
-- ditolak Postgres, bukan diteruskan ke customer.
DELETE FROM follow_up_sends a USING follow_up_sends b
WHERE a.id > b.id
  AND a.company_id = b.company_id
  AND a.chat_id = b.chat_id
  AND a.day_index = b.day_index
  AND a.attempt_in_day = b.attempt_in_day;

ALTER TABLE follow_up_sends
  DROP CONSTRAINT IF EXISTS follow_up_sends_slot_key;
ALTER TABLE follow_up_sends
  ADD CONSTRAINT follow_up_sends_slot_key
  UNIQUE (company_id, chat_id, day_index, attempt_in_day);
