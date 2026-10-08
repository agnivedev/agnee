-- Kapan staf terakhir dikabari bahwa biaya AI sebuah perusahaan melewati ambang
-- (lihat src/cost-alerts.js).
--
-- Tanpa kolom ini pemantau per jam akan mengirim email yang sama setiap jam
-- selama tenant itu masih di atas ambang. NULL = belum pernah dikabari, atau
-- sudah turun di bawah ambang sehingga lonjakan berikutnya dikabari lagi.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS cost_alert_notified_at TIMESTAMPTZ;
