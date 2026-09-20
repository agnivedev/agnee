-- AI enable/model-chain per company — sebelumnya satu objek proses (aiSettings
-- di server.js) dibagi oleh SEMUA tenant sekaligus. Efeknya: supervisor company
-- mana pun yang menekan tombol "matikan AI" atau mengganti model chain lewat
-- /v1/admin/ai-settings mematikan/mengganti AI untuk SETIAP company lain di
-- server yang sama, bukan cuma perusahaannya sendiri. Kolom ini memindahkan
-- setting itu ke baris company masing-masing, sejajar dengan max_users/
-- ai_message_limit yang memang sudah per-company.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- NULL/kosong berarti "pakai model default platform" (config.openrouterModel).
-- Tidak diberi default non-null supaya perubahan model default platform tetap
-- otomatis berlaku ke company yang belum pernah menyetel chain-nya sendiri.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai_model_chain TEXT[];
