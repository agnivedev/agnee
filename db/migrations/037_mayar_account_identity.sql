-- Identitas akun Mayar yang tersambung — supaya layar Settings menunjukkan
-- akun/bisnis MANA yang connect, bukan cuma "Mayar" generik. Diisi dari klaim
-- di dalam API key-nya sendiri (JWT), bukan panggilan API terpisah — Mayar
-- tidak punya endpoint profil merchant publik, tapi CLI resminya (`mayar
-- whoami`) men-decode identitas dari key itu sendiri secara lokal.
ALTER TABLE mayar_connections
  ADD COLUMN IF NOT EXISTS account_name TEXT,
  ADD COLUMN IF NOT EXISTS account_email TEXT;
