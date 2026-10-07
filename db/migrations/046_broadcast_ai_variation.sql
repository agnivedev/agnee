-- Variasi kata oleh AI: tiap penerima mendapat kalimat yang sedikit berbeda
-- dengan arti yang sama. Ratusan pesan identik dari satu nomor adalah pola
-- yang dikenali WhatsApp sebagai spam.
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS ai_variation BOOLEAN NOT NULL DEFAULT FALSE;

-- Teks yang benar-benar diterima customer, setelah {nama}, variasi, dan
-- kalimat cara berhenti. Tanpa ini supervisor tidak bisa melihat apa yang
-- ditulis AI atas nama perusahaannya.
ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS sent_body TEXT;
