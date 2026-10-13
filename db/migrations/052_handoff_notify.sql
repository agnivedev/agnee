-- Nomor WhatsApp yang diberi tahu saat AI menjanjikan "aku teruskan ke tim".
--
-- Tanpa ini kalimat itu hanya kalimat: tidak ada tugas, notifikasi, atau pesan
-- ke siapa pun, dan customer menunggu jawaban yang tidak pernah diminta dari
-- manusia. Diisi per company; kosong = tidak ada yang dikirimi (perilaku lama).
-- Dikirim dari nomor WhatsApp company itu sendiri. Format bebas (08…, +62…),
-- dinormalkan saat dikirim.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS handoff_notify_numbers TEXT[] NOT NULL DEFAULT '{}';
