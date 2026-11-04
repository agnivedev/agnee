-- Eskalasi model: giliran yang dinilai bermasalah oleh penjaga diulang dengan
-- model lebih kuat (src/escalation.js). Bawaan HIDUP; supervisor bisa mematikannya
-- per company di Pengaturan > AI.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_escalation BOOLEAN NOT NULL DEFAULT TRUE;
