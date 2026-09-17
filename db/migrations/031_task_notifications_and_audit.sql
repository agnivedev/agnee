-- Notifikasi penugasan + jejak audit tindakan di luar Agnee.

-- ── Notifikasi tugas ──────────────────────────────────────────────────────
-- Sebelumnya hanya mention dan balasan catatan yang menghasilkan notifikasi.
-- Penugasan chat ke seorang agent adalah kejadian yang jauh lebih penting bagi
-- orang itu — sampai sekarang satu-satunya cara mengetahuinya adalah membuka
-- daftar tugas dan memeriksanya sendiri.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check
  CHECK (kind IN ('mention', 'reply', 'task'));

-- ── Audit ─────────────────────────────────────────────────────────────────
-- audit_logs sudah ada sejak migration 002 tapi tidak pernah dipakai. Baris
-- pertamanya adalah agent yang membuka percakapan di WhatsApp pribadinya
-- lewat wa.me: dialognya memperingatkan risikonya, tapi tidak meninggalkan
-- jejak apa pun untuk supervisor.
--
-- Index ini melayani pembacaan per jenis tindakan; index bawaan migration 002
-- hanya (company_id, created_at).
CREATE INDEX IF NOT EXISTS audit_logs_company_action_idx
  ON audit_logs (company_id, action, created_at DESC);
