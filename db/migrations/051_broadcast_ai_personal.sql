-- Pembuka yang disesuaikan per penerima: AI menulis satu kalimat yang
-- menyambung ke percakapan terakhir orang itu, lalu pesan broadcast dikirim
-- persis apa adanya. Diminta Hanny 11 Okt untuk menyapa ulang chat yang
-- belum dibalas selama Bang Al (AL Gold FX) sakit.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS ai_personal BOOLEAN NOT NULL DEFAULT FALSE;
