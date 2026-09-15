-- Membedakan percakapan yang diambil alih SENGAJA dari yang berpindah ke mode
-- manusia hanya karena seorang agent mengetik.
--
-- Agent yang membalas percakapan bermode AI sekarang otomatis mengambil alih —
-- kalau tidak, dua penulis menjawab customer yang sama tanpa saling tahu, dan
-- janji yang satu bisa dibatalkan yang lain.
--
-- Tapi pengambilalihan otomatis itu harus bisa kedaluwarsa sendiri: agent yang
-- menyapa sekali lalu pergi tidak boleh membekukan percakapan selamanya.
-- Sedangkan penugasan yang dipilih supervisor lewat panel TIDAK boleh
-- kedaluwarsa — itu keputusan orang, bukan efek samping.
--
-- Kolom ini yang memisahkan keduanya. Hanya baris bertanda true yang boleh
-- dikembalikan ke AI oleh penyapu berkala.

ALTER TABLE conversation_routing
  ADD COLUMN IF NOT EXISTS auto_assigned BOOLEAN NOT NULL DEFAULT false;

-- Penyapu mencari baris mode 'human' yang auto_assigned dan sudah lama diam.
CREATE INDEX IF NOT EXISTS conversation_routing_auto_idx
  ON conversation_routing (auto_assigned, updated_at)
  WHERE handling_mode = 'human' AND auto_assigned;
