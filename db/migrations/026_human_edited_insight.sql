-- Ringkasan dan label boleh disunting manusia, dan AI tetap boleh memperbarui.
--
-- Dua hal yang tampak bertabrakan, tapi keduanya dibutuhkan:
--
--   Kalau suntingan manusia mengunci field itu selamanya, ringkasan berhenti
--   mengikuti percakapan dan lama-lama menyesatkan.
--
--   Kalau AI menimpa begitu saja, koreksi yang ditulis agent hilang diam-diam
--   pada analisis berikutnya — lebih buruk daripada tidak bisa disunting sama
--   sekali, karena orang mengira suntingannya tersimpan.
--
-- Jalan keluarnya bukan mengunci, melainkan MEMBERI TAHU. Kolom ini mencatat
-- siapa yang terakhir menyunting tiap field; nilai itu ikut dikirim ke AI saat
-- analisis berikutnya, dengan perintah mempertahankan fakta yang ditulis orang
-- dan hanya menambah atau memperbarui yang benar-benar berubah.

ALTER TABLE conversation_summaries
  ADD COLUMN IF NOT EXISTS summary_edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS summary_edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS labels_edited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labels_edited_at TIMESTAMPTZ;
