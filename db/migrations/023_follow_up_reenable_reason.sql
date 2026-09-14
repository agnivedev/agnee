-- Alasan berhenti baru: rangkaian ditutup karena fitur tindak lanjut
-- dinyalakan kembali.
--
-- `armFollowUp` hanya memasang rangkaian saat kita membalas customer, jadi
-- rangkaian yang masih terpasang dari periode menyala sebelumnya mewakili
-- kesenyapan yang sudah basi — tidak ada yang meninjaunya sejak fitur
-- dimatikan. Menyalakan kembali menutupnya supaya satu klik "aktifkan" tidak
-- melepaskan antrean lama sekaligus.
--
-- Dipisahkan dari 'manual' supaya penutupan massal ini bisa dibedakan dari
-- supervisor yang menutup satu percakapan. Setelah insiden 2026-09-14, bisa
-- menjawab "kenapa rangkaian ini berhenti" tanpa menebak itu penting.
ALTER TABLE follow_up_state
  DROP CONSTRAINT IF EXISTS follow_up_state_stop_reason_check;
ALTER TABLE follow_up_state
  ADD CONSTRAINT follow_up_state_stop_reason_check
  CHECK (stop_reason = ANY (ARRAY[
    'replied', 'human_takeover', 'exhausted', 'opted_out',
    'manual', 'undeliverable', 'feature_reenabled'
  ]));
