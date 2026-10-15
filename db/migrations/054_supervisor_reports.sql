-- Laporan hasil chat berkala ke supervisor.
--
-- Satu baris per supervisor per company: seberapa sering laporan dikirim
-- (harian/mingguan/bulanan, atau mati) dan ke nomor WhatsApp mana. Frekuensi
-- diatur per orang karena tidak semua supervisor mau laporan yang sama sering.
-- Dikirim dari nomor WhatsApp company itu sendiri, pukul 08.00 zona waktunya.
-- Tanpa baris = tidak dikirimi apa pun (perilaku lama).
CREATE TABLE IF NOT EXISTS supervisor_report_settings (
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'off' CHECK (frequency IN ('off', 'daily', 'weekly', 'monthly')),
  whatsapp_number TEXT,
  -- Patokan "jadwal yang belum dikirim": jadwal sebelum saat ini tidak dikejar.
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, user_id)
);

CREATE INDEX IF NOT EXISTS supervisor_report_settings_active_idx
  ON supervisor_report_settings (frequency) WHERE frequency <> 'off';
