-- SLA tugas: memberi tahu saat customer sudah menunggu terlalu lama.
--
-- Notifikasi penugasan (migration 031) memberi tahu saat tugas BERPINDAH.
-- Tidak ada yang berbunyi saat tugas yang sudah dipegang dibiarkan terlalu
-- lama — satu-satunya cara mengetahuinya adalah membuka daftar tugas dan
-- memeriksanya sendiri, yang justru tidak dilakukan orang yang sedang sibuk.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('mention', 'reply', 'task', 'sla'));

-- Dua stempel, bukan satu bendera: peringatan ke pemegang tugas dan eskalasi ke
-- supervisor adalah dua kejadian berbeda yang masing-masing hanya boleh terjadi
-- sekali per penantian.
--
-- Keduanya dibandingkan dengan waktu pesan customer terakhir, bukan dipakai
-- sebagai bendera benar/salah. Dengan begitu penantian BARU (customer mengirim
-- pesan lagi setelah dibalas) otomatis memasang ulang SLA-nya tanpa perlu ada
-- yang membersihkan kolom ini — dan tidak ada kondisi balapan antara
-- penjadwal yang menulis dan agent yang membalas.
ALTER TABLE conversation_routing
  ADD COLUMN IF NOT EXISTS sla_warned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sla_escalated_at TIMESTAMPTZ;
